import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  parseTimestamp,
  distanceMeters,
  nearestBuses,
  formatDistance,
  isValidFeed,
  readFeedResponse,
  parseBusParams,
  withTimeout,
  MAX_FEED_CHARS
} from '../shared/bhtrans.js'

const CSV = [
  'EV;HR;LT;LG;NV;VL;NL;DG;SV;DT',
  '105;20261117120000;-19,9191;-43,9386;40001;30;1234;0;1;100',
  '105;20261117120000;-19,9300;-43,9386;40002;0;1234;0;1;100',
  '105;20261117120000;-19,9195;-43,9386;40003;20;9999;0;1;100',
  '105;20261117115930;-19,9200;-43,9386;40004;45;1234;0;1;100'
].join('\r\n')

test('parseCsv lê cabeçalho e linhas com ;', () => {
  const rows = parseCsv(CSV)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].NV, '40001')
  assert.equal(rows[0].LT, '-19,9191')
})

test('parseCsv aceita vírgula como separador e texto vazio', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.equal(parseCsv('NL,LT\n1,2')[0].LT, '2')
})

test('parseTimestamp lê HR como horário de Brasília (UTC-3), qualquer que seja o fuso do aparelho', () => {
  assert.equal(parseTimestamp('20261117120000'), Date.UTC(2026, 10, 17, 15, 0, 0))
  // virada do dia: 22h em BH = 01h UTC do dia seguinte
  assert.equal(parseTimestamp('20261231220000'), Date.UTC(2027, 0, 1, 1, 0, 0))
  assert.equal(parseTimestamp('lixo'), null)
})

test('distanceMeters: 0,01 grau de latitude ≈ 1,1 km', () => {
  const d = distanceMeters(-19.92, -43.94, -19.93, -43.94)
  assert.ok(d > 1100 && d < 1120, `d=${d}`)
})

// 12:00:30 em Brasília
const NOW = Date.UTC(2026, 10, 17, 15, 0, 30)

test('nearestBuses filtra pela linha e ordena pela chegada', () => {
  const now = NOW
  const buses = nearestBuses(parseCsv(CSV), { line: '1234', codes: ['1234'], lat: -19.9191, lon: -43.9386, now })
  assert.deepEqual(
    buses.map((b) => b.vehicle),
    ['40001', '40004', '40002']
  )
  assert.equal(buses[0].distanceM, 0)
  assert.equal(buses[0].etaMin, 1)
  assert.equal(buses[0].ageSec, 30)
  // ônibus parado usa a velocidade mínima de 15 km/h: ~1,2 km → ~5 min
  assert.equal(buses[2].etaMin, 5)
})

test('nearestBuses devolve a posição (lat/lon) de cada ônibus', () => {
  const buses = nearestBuses(parseCsv(CSV), { line: '1234', codes: ['1234'], lat: -19.9191, lon: -43.9386, now: NOW })
  assert.deepEqual(
    buses.map((b) => [b.vehicle, b.lat, b.lon]),
    [
      ['40001', -19.9191, -43.9386],
      ['40004', -19.92, -43.9386],
      ['40002', -19.93, -43.9386]
    ]
  )
  for (const b of buses) assert.ok(Number.isFinite(b.lat) && Number.isFinite(b.lon))
})

test('formatDistance', () => {
  assert.equal(formatDistance(350), '350 m')
  assert.equal(formatDistance(1530), '1,5 km')
})

test('nearestBuses: ponto com coordenada inválida devolve []', () => {
  const rows = parseCsv(CSV)
  assert.deepEqual(nearestBuses(rows, { line: '1234', codes: ['1234'], lat: 'abc', lon: -43.9, now: NOW }), [])
  assert.deepEqual(nearestBuses(rows, { line: '1234', codes: ['1234'], lat: undefined, lon: -43.9, now: NOW }), [])
})

test('nearestBuses descarta posição com mais de maxAgeSec (padrão 10 min)', () => {
  const csv = [
    'HR;LT;LG;NV;VL;NL',
    '20261117120000;-19,9191;-43,9386;novo;30;1',
    '20261117114900;-19,9191;-43,9386;velho;30;1',
    'sem-hora;-19,9195;-43,9386;semhora;30;1'
  ].join('\n')
  const rows = parseCsv(csv)
  assert.deepEqual(nearestBuses(rows, { line: '1', codes: ['1'], lat: -19.9191, lon: -43.9386, now: NOW }).map((b) => b.vehicle), ['novo', 'semhora'])
  assert.deepEqual(
    nearestBuses(rows, { line: '1', codes: ['1'], lat: -19.9191, lon: -43.9386, now: NOW, maxAgeSec: 20 * 60 }).map((b) => b.vehicle),
    ['novo', 'velho', 'semhora']
  )
})

test('nearestBuses limita a velocidade do ETA a 60 km/h e ordena por etaMin, depois distância', () => {
  const csv = [
    'HR;LT;LG;NV;VL;NL',
    // ~5,6 km a 200 km/h (pico de GPS): com teto de 60 km/h dá ~6 min, não 2
    '20261117120000;-19,9691;-43,9386;rapido;200;1',
    // ~2,2 km parado (15 km/h) -> ~9 min
    '20261117120000;-19,9391;-43,9386;parado;0;1',
    // ~1,1 km a 60 km/h -> 1 min; mesmo ETA que o seguinte, mas mais longe
    '20261117120000;-19,9291;-43,9386;longe;60;1',
    '20261117120000;-19,9201;-43,9386;perto;60;1'
  ].join('\n')
  const buses = nearestBuses(parseCsv(csv), { line: '1', codes: ['1'], lat: -19.9191, lon: -43.9386, now: NOW, limit: 4 })
  assert.deepEqual(buses.map((b) => b.vehicle), ['perto', 'longe', 'rapido', 'parado'])
  assert.equal(buses[2].etaMin, 6)
  assert.equal(buses[3].etaMin, 9)
})

test('isValidFeed exige cabeçalho com NL, LT e LG e tamanho razoável', () => {
  assert.equal(isValidFeed(CSV), true)
  assert.equal(isValidFeed('nl,lt,lg\n1,2,3'), true)
  assert.equal(isValidFeed('<html>Acesso Bloqueado</html>'), false)
  assert.equal(isValidFeed('HR;LT;LG;NV\n1;2;3;4'), false)
  assert.equal(isValidFeed(''), false)
  assert.equal(isValidFeed(null), false)
  assert.equal(isValidFeed({}), false)
  assert.equal(isValidFeed('NL;LT;LG\n' + 'x'.repeat(MAX_FEED_CHARS)), false)
})

test('readFeedResponse lança erro em status, corpo ou cabeçalho ruins', () => {
  assert.equal(readFeedResponse({ status: 200, body: CSV }), CSV)
  assert.throws(() => readFeedResponse({ status: 403, body: CSV }), /HTTP 403/)
  assert.throws(() => readFeedResponse({ status: 500, body: '' }), /HTTP 500/)
  assert.throws(() => readFeedResponse({ status: 200, body: { a: 1 } }), /texto/)
  assert.throws(() => readFeedResponse({ status: 200, body: undefined }), /texto/)
  assert.throws(() => readFeedResponse({ status: 200, body: 'Acesso Bloqueado' }), /Formato/)
  assert.throws(() => readFeedResponse({ status: 200, body: 'x'.repeat(MAX_FEED_CHARS + 1) }), /grande/)
  assert.throws(() => readFeedResponse(null))
})

test('parseBusParams valida linha e coordenadas', () => {
  assert.deepEqual(parseBusParams({ line: ' 1234 ', lat: '-19.9', lon: -43.9 }), { line: '1234', lat: -19.9, lon: -43.9 })
  assert.deepEqual(parseBusParams({ line: 1234, lat: '-19,9', lon: '-43,9' }), { line: '1234', lat: -19.9, lon: -43.9 })
  assert.equal(parseBusParams({ line: '', lat: 1, lon: 1 }), null)
  assert.equal(parseBusParams({ line: '1', lat: 'x', lon: 1 }), null)
  assert.equal(parseBusParams({ line: '1', lat: 1 }), null)
  assert.equal(parseBusParams({ line: {}, lat: 1, lon: 1 }), null)
  assert.equal(parseBusParams(null), null)
})

test('withTimeout rejeita se demorar e repassa o resultado se não', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50), 42)
  await assert.rejects(withTimeout(new Promise(() => {}), 20), /Tempo esgotado/)
  await assert.rejects(withTimeout(Promise.reject(new Error('falhou')), 50), /falhou/)
})

test('parseBusParams aceita sentido e ponto do GTFS (opcionais)', () => {
  assert.deepEqual(parseBusParams({ line: '9250', lat: -19.9, lon: -43.9, dir: '1', stopId: 14784087 }), {
    line: '9250', lat: -19.9, lon: -43.9, dir: 1, stopId: '14784087'
  })
  assert.deepEqual(parseBusParams({ line: '9250', lat: -19.9, lon: -43.9, dir: 3, stopId: 'x y' }), {
    line: '9250', lat: -19.9, lon: -43.9
  })
})

test('nearestBuses: codes (tabela NL) e distância pela rua (routeDistance)', () => {
  const csv = [
    'NL;NV;LT;LG;VL;HR;DG',
    '557;a;-19,9200;-43,9386;20;;90',
    '557;b;-19,9300;-43,9386;20;;90',
    '9250;c;-19,9191;-43,9390;20;;90',
    '557;d;-19,9191;-43,9387;20;;90'
  ].join('\n')
  const rows = parseCsv(csv)
  // Pela tabela real, a 9250 é o NL 660: o ônibus com NL "9250" é de outra linha e fica de fora.
  assert.deepEqual(nearestBuses(rows, { line: '9250', lat: -19.9191, lon: -43.9386, now: NOW }).map((x) => x.vehicle), [])
  assert.deepEqual(nearestBuses(rows, { line: '9250', codes: ['9250'], lat: -19.9191, lon: -43.9386, now: NOW }).map((x) => x.vehicle), ['c'])
  const seen = []
  const routeDistance = (lat, lon, extra) => {
    seen.push(extra.heading)
    if (lat > -19.92) return { toStopM: null, passed: true } // d: já passou
    if (lat > -19.925) return { toStopM: 3000, passed: false } // a: pela rua é longe
    return null // b: fora da rota, fica a linha reta
  }
  const buses = nearestBuses(rows, { line: '9250', codes: ['557'], lat: -19.9191, lon: -43.9386, now: NOW, routeDistance })
  assert.deepEqual(buses.map((x) => [x.vehicle, x.distanceM, !!x.alongRoute]), [['b', 1212, false], ['a', 3000, true]])
  assert.deepEqual(seen, [90, 90, 90])
})

test('parseBusParams aceita zoom manual só dentro dos limites', () => {
  const base = { line: '9250', lat: '-19.9', lon: '-43.9' }
  assert.equal(parseBusParams({ ...base, zoom: 120 }).zoom, 120)
  assert.equal(parseBusParams({ ...base, zoom: '200' }).zoom, 200)
  assert.equal(parseBusParams({ ...base, zoom: 5 }).zoom, undefined)
  assert.equal(parseBusParams({ ...base, zoom: 'x' }).zoom, undefined)
})

test('nearestBuses passa o número do veículo para routeDistance', () => {
  const rows = parseCsv('NL;NV;LT;LG;VL\n9250;40210;-19.91;-43.93;20')
  const seen = []
  nearestBuses(rows, { line: '9250', codes: ['9250'], lat: -19.92, lon: -43.94, routeDistance: (lat, lon, extra) => (seen.push(extra.vehicle), null) })
  assert.deepEqual(seen, ['40210'])
})
