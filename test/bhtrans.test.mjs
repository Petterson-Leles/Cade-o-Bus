import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  parseTimestamp,
  distanceMeters,
  nearestBuses,
  formatDistance
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

test('parseTimestamp', () => {
  assert.equal(parseTimestamp('20261117120000'), new Date(2026, 10, 17, 12, 0, 0).getTime())
  assert.equal(parseTimestamp('lixo'), null)
})

test('distanceMeters: 0,01 grau de latitude ≈ 1,1 km', () => {
  const d = distanceMeters(-19.92, -43.94, -19.93, -43.94)
  assert.ok(d > 1100 && d < 1120, `d=${d}`)
})

test('nearestBuses filtra pela linha e ordena pela distância', () => {
  const now = new Date(2026, 10, 17, 12, 0, 30).getTime()
  const buses = nearestBuses(parseCsv(CSV), { line: '1234', lat: -19.9191, lon: -43.9386, now })
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

test('formatDistance', () => {
  assert.equal(formatDistance(350), '350 m')
  assert.equal(formatDistance(1530), '1,5 km')
})
