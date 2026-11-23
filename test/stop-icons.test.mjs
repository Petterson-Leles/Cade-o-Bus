import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  stopKindCode,
  parseStopKinds,
  pickStopIcons,
  stopIconSrc,
  diamondPoints,
  STOP_ICON_HALF,
  STOP_ICON_SIZE,
  USER_STOP_HALF,
  MAX_BIG_ICONS
} from '../shared/stop-icons.js'
import { stopIconSvg, stopIconUri, SETTING_ICON_PX } from '../shared/stop-icons-svg.js'
import { buildMapPayload, sanitizeMapPayload, M_PER_DEG } from '../shared/route-map.js'
import { parseBusesResult } from '../utils/detail-view.js'
import { stopIconFits, STOP_ICON_KEEP_OUT, MAP_CX, MAP_CY, iconArea, boxInsideCircle } from '../shared/detail-layout.js'
import { cssTheme } from '../utils/colors.js'

const STOP = { lat: -19.92, lon: -43.94 }
const kx = M_PER_DEG * Math.cos((STOP.lat * Math.PI) / 180)
const ll = (eastM, northM) => ({ lat: STOP.lat + northM / M_PER_DEG, lon: STOP.lon + eastM / kx })

test('stopKindCode: rua, MOVE e estação central', () => {
  assert.equal(stopKindCode({ name: 'Rua X' }), 's')
  assert.equal(stopKindCode({ station: 'Estação Santa Rosa' }), 'm')
  assert.equal(stopKindCode({ station: 'Estação Pampulha' }), 'c')
  assert.equal(stopKindCode(null), 's')
})

test('parseStopKinds: só letras s/m/c no tamanho certo; senão tudo rua', () => {
  assert.equal(parseStopKinds('smc', 3), 'smc')
  assert.equal(parseStopKinds('smx', 3), 'sss')
  assert.equal(parseStopKinds('sm', 3), 'sss')
  assert.equal(parseStopKinds(undefined, 2), 'ss')
  assert.equal(parseStopKinds(42, 0), '')
})

test('buildMapPayload manda o tipo de cada ponto em kinds, na ordem de stops', () => {
  const lineStops = [
    { id: '1', ...ll(-200, 0) },
    { id: '2', ...ll(-100, 0), station: 'Estação Santa Rosa' },
    { id: 'eu', ...STOP },
    { id: '3', ...ll(100, 0), station: 'Estação Pampulha' }
  ]
  const map = buildMapPayload({ ctx: null, stop: { id: 'eu', ...STOP }, lineStops, pxPerKm: 100, radiusM: 1000 })
  assert.equal(map.stops.length, 6)
  assert.equal(map.kinds, 'smc')
  assert.deepEqual([map.stops[0], map.stops[2], map.stops[4]], [-20, -10, 10])
})

test('buildMapPayload: passando de maxStops, as estações ficam (central, depois MOVE)', () => {
  const lineStops = []
  for (let i = 1; i <= 10; i++) lineStops.push({ id: `r${i}`, ...ll(i * 20, 0) })
  lineStops.push({ id: 'm', ...ll(300, 0), station: 'Estação Mineirão' })
  lineStops.push({ id: 'c', ...ll(320, 0), station: 'Estação Pampulha' })
  const map = buildMapPayload({ ctx: null, stop: STOP, lineStops, pxPerKm: 100, radiusM: 1000, maxStops: 4 })
  assert.equal(map.kinds, 'ssmc')
  // Ordem do trajeto mantida: os dois primeiros de rua e depois as estações.
  assert.deepEqual(map.stops, [2, 0, 4, 0, 30, 0, 32, 0])
})

test('sanitizeMapPayload/parseBusesResult mantêm kinds válido e corrigem o inválido', () => {
  assert.equal(sanitizeMapPayload({ stops: [1, 2, 3, 4], kinds: 'cm' }).kinds, 'cm')
  assert.equal(sanitizeMapPayload({ stops: [1, 2, 3, 4], kinds: 'c' }).kinds, 'ss')
  assert.equal(sanitizeMapPayload({ stops: [1, 2, 3, 4], kinds: ['c', 'm'] }).kinds, 'ss')
  // Pontos inválidos descartados: kinds acompanha (vazio).
  assert.equal(sanitizeMapPayload({ stops: [1, 'x'], kinds: 'c' }).kinds, '')
  assert.equal(parseBusesResult({ buses: [], map: { stops: [5, 5], kinds: 'm' } }).map.kinds, 'm')
})

test('pickStopIcons: sobreposição forte fica só o mais importante (central > MOVE > rua)', () => {
  // Rua, MOVE e central quase no mesmo lugar: só o hexágono.
  const one = pickStopIcons([0, 0, 2, 0, 4, 0], 'smc', {})
  assert.deepEqual(one, [{ x: 4, y: 0, kind: 'central' }])
  // MOVE e rua colados: fica o MOVE.
  assert.deepEqual(pickStopIcons([0, 0, 5, 0], 'sm', {}), [{ x: 5, y: 0, kind: 'move' }])
  // Longe uns dos outros: todos, na ordem de desenho (rua, MOVE, central por cima).
  const all = pickStopIcons([100, 0, 0, 0, 50, 0], 'csm', {})
  assert.deepEqual(
    all.map((i) => i.kind),
    ['street', 'move', 'central']
  )
  // Encostados só um pouco (bordas se tocando) não contam como sobreposição forte.
  const d = STOP_ICON_HALF.move * 2
  assert.equal(pickStopIcons([0, 0, d, 0], 'mm', {}).length, 2)
})

test('pickStopIcons: o seu ponto sempre fica; ícones em cima dele saem', () => {
  const got = pickStopIcons([3, 0, 60, 0, 6, 0], 'ssc', { user: { x: 0, y: 0 } })
  assert.deepEqual(got, [{ x: 60, y: 0, kind: 'street' }])
  // Um losango logo além do halo fica.
  const h = USER_STOP_HALF + STOP_ICON_HALF.street
  assert.equal(pickStopIcons([h, 0], 's', { user: { x: 0, y: 0 } }).length, 1)
})

test('pickStopIcons: grande que não cabe (texto/borda) ou passa do limite vira losango', () => {
  const got = pickStopIcons([0, 0, 100, 0], 'cm', { fitsBig: (x) => x > 50 })
  assert.deepEqual(got, [
    { x: 0, y: 0, kind: 'street' },
    { x: 100, y: 0, kind: 'move' }
  ])
  const many = []
  for (let i = 0; i < MAX_BIG_ICONS + 2; i++) many.push(i * 50, 0)
  const res = pickStopIcons(many, 'm'.repeat(MAX_BIG_ICONS + 2), {})
  assert.equal(res.filter((i) => i.kind === 'move').length, MAX_BIG_ICONS)
  assert.equal(res.filter((i) => i.kind === 'street').length, 2)
  assert.equal(pickStopIcons(many, 'm'.repeat(MAX_BIG_ICONS + 2), { maxBig: 1 }).filter((i) => i.kind === 'move').length, 1)
})

test('pickStopIcons: zoom longe esconde só os losangos', () => {
  const got = pickStopIcons([0, 0, 60, 0, 120, 0], 'smc', { showStreets: false })
  assert.deepEqual(
    got.map((i) => i.kind),
    ['move', 'central']
  )
  // Estação que não cabe e vira losango também some.
  assert.deepEqual(pickStopIcons([0, 0], 'c', { showStreets: false, fitsBig: () => false }), [])
  assert.deepEqual(pickStopIcons(null, 'c', {}), [])
})

test('stopIconFits: fora do número grande e dos textos, dentro da tela redonda', () => {
  // Centro do enquadramento (onde fica o ponto): cabe.
  assert.equal(stopIconFits(0, 0, STOP_ICON_HALF.central), true)
  // Em cima do número grande (à esquerda): não cabe.
  assert.equal(stopIconFits(150 - MAP_CX, 220 - MAP_CY, STOP_ICON_HALF.move), false)
  // No rodapé: não cabe.
  assert.equal(stopIconFits(240 - MAP_CX, 404 - MAP_CY, STOP_ICON_HALF.move), false)
  // Na borda da tela redonda: não cabe.
  assert.equal(stopIconFits(470 - MAP_CX, 240 - MAP_CY, STOP_ICON_HALF.move), false)
  // O lado direito da área dos ícones do ônibus/ponto aceita o "M" (o esquerdo
  // encosta no número grande).
  const a = iconArea()
  for (const [x, y] of [[a.x1, a.y0], [a.x1, a.y1], [(a.x0 + a.x1) / 2 + 20, (a.y0 + a.y1) / 2]]) {
    assert.equal(stopIconFits(x - MAP_CX, y - MAP_CY, STOP_ICON_HALF.move), true, `${x},${y}`)
  }
  assert.ok(STOP_ICON_KEEP_OUT.length >= 6)
})

test('diamondPoints: losango fechado em volta do centro', () => {
  const p = diamondPoints(10, 20, 7)
  assert.equal(p.length, 5)
  assert.deepEqual(p[0], p[4])
  assert.deepEqual(p[1], { x: 17, y: 20 })
})

test('PNG dos ícones grandes: um por tipo e tema, no tamanho físico do design, leves', () => {
  for (const kind of ['move', 'central']) {
    for (const theme of ['dark', 'light']) {
      const src = stopIconSrc(kind, theme)
      assert.equal(src, `stop/${kind}-${theme}.png`)
      const buf = fs.readFileSync(new URL(`../assets/common.r/${src}`, import.meta.url))
      assert.equal(buf.readUInt32BE(16), Math.round((STOP_ICON_SIZE[kind] * 466) / 480))
      assert.ok(buf.length < 2048, `${src}: ${buf.length} bytes`)
    }
  }
  assert.equal(stopIconSrc('move', 'azul'), 'stop/move-dark.png')
  assert.ok(boxInsideCircle({ x: 230, y: 230, w: 20, h: 20 }))
})

test('stopIconSvg: losango vazado, "M" e hexágono com as cores do tema', () => {
  const C = cssTheme('dark')
  const street = stopIconSvg('street', C, { bg: C.card })
  assert.ok(street.includes('rotate(45') && street.includes(`fill="${C.card}"`) && street.includes(`stroke="${C.muted}"`))
  assert.ok(stopIconSvg('street', C, { selected: true }).includes(`fill="${C.primary}"`))
  const move = stopIconSvg('move', C, {})
  assert.ok(move.includes('<circle') && move.includes(`fill="${C.chip}"`) && move.includes(`fill="${C.chipText}"`))
  const central = stopIconSvg('central', C, {})
  assert.ok(central.includes('<polygon') && central.includes(`fill="${C.chipText}"`))
  assert.ok(stopIconUri('central', C, {}).startsWith('data:image/svg+xml;base64,'))
  assert.equal(SETTING_ICON_PX.central > SETTING_ICON_PX.move && SETTING_ICON_PX.move > SETTING_ICON_PX.street, true)
})
