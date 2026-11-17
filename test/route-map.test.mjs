import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeProjection,
  cumulative,
  projectPoint,
  pointAt,
  subPolyline,
  routeContext,
  busOnRoute,
  clipToCircle,
  toPixelPieces,
  pixelPosition,
  buildMapPayload,
  sanitizeMapPayload,
  segmentBearing,
  angleDiff,
  pathLength,
  advanceAlong,
  blend,
  speedPxPerSec,
  animationPath,
  M_PER_DEG,
  MAP_RADIUS_PX
} from '../shared/route-map.js'

const STOP = { lat: -19.92, lon: -43.94 }
const kx = M_PER_DEG * Math.cos((STOP.lat * Math.PI) / 180)
// (leste m, norte m) -> [lat, lon] em volta do ponto.
const ll = (eastM, northM) => [STOP.lat + northM / M_PER_DEG, STOP.lon + eastM / kx]
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

test('makeProjection: leste = x+, norte = y- (y da tela cresce para baixo)', () => {
  const p = makeProjection(STOP)
  const [x, y] = p(...ll(100, 200))
  assert.ok(near(x, 100, 0.01) && near(y, -200, 0.01))
  assert.deepEqual(p(STOP.lat, STOP.lon), [0, -0])
})

test('cumulative, pointAt e subPolyline', () => {
  const pts = [[0, 0], [100, 0], [100, 50]]
  const cum = cumulative(pts)
  assert.deepEqual(cum, [0, 100, 150])
  assert.deepEqual(pointAt(pts, cum, 120), [100, 20])
  assert.deepEqual(pointAt(pts, cum, -5), [0, 0])
  assert.deepEqual(pointAt(pts, cum, 999), [100, 50])
  assert.deepEqual(subPolyline(pts, cum, 50, 125), [[50, 0], [100, 0], [100, 25]])
  assert.deepEqual(subPolyline(pts, cum, 80, 20), [])
})

test('projectPoint acha o segmento mais perto e a distância ao longo', () => {
  const pts = [[0, 0], [100, 0], [100, 100]]
  const q = projectPoint(pts, cumulative(pts), [40, 10])
  assert.equal(q.seg, 0)
  assert.equal(q.along, 40)
  assert.equal(q.dist, 10)
  assert.equal(projectPoint([[0, 0]], [0], [1, 1]), null)
})

// Trajeto de oeste para leste passando pelo ponto (2 km antes, 1 km depois).
const straight = [ll(-2000, 0), ll(-1000, 0), ll(0, 5), ll(1000, 0)]

test('routeContext coloca o ponto ao longo do trajeto', () => {
  const ctx = routeContext(straight, STOP)
  assert.ok(near(ctx.stopAlong, 2000, 2))
  assert.ok(near(ctx.total, 3000, 2))
  assert.equal(ctx.loop, false)
  assert.equal(routeContext(straight, { lat: 'x', lon: 1 }), null)
  assert.deepEqual(routeContext([], STOP).pts, [])
})

test('busOnRoute mede pela rua e sabe se já passou', () => {
  const ctx = routeContext(straight, STOP)
  const before = busOnRoute(ctx, { lat: ll(-1500, 30)[0], lon: ll(-1500, 30)[1] })
  assert.equal(before.passed, false)
  assert.ok(near(before.toStopM, 1500, 3))
  assert.ok(near(before.offM, 30, 2))
  const after = busOnRoute(ctx, { lat: ll(500, 0)[0], lon: ll(500, 0)[1] })
  assert.equal(after.passed, true)
  assert.equal(after.toStopM, null)
  // Logo depois do ponto (GPS impreciso) ainda conta como chegando.
  assert.equal(busOnRoute(ctx, { lat: ll(20, 0)[0], lon: ll(20, 0)[1] }).passed, false)
  // Longe do trajeto: null (o app cai na linha reta).
  assert.equal(busOnRoute(ctx, { lat: ll(-1500, 400)[0], lon: ll(-1500, 400)[1] }), null)
  assert.equal(busOnRoute(ctx, { lat: 'x', lon: 1 }), null)
  assert.equal(busOnRoute(null, { lat: 1, lon: 1 }), null)
})

test('busOnRoute em rota circular conta a volta', () => {
  // Quadrado de 1 km que começa e termina no mesmo canto; ponto no meio do 1º lado.
  const loop = [ll(-500, 0), ll(500, 0), ll(500, -1000), ll(-500, -1000), ll(-500, 0)]
  const ctx = routeContext(loop, STOP)
  assert.equal(ctx.loop, true)
  const p = ll(500, -500) // no 2º lado: já passou, mas volta em 2500 m
  const r = busOnRoute(ctx, { lat: p[0], lon: p[1] })
  assert.equal(r.passed, false)
  assert.ok(near(r.toStopM, 3000, 3))
})

test('busOnRoute com rumo (DG): sentido contrário sai da lista', () => {
  const ctx = routeContext(straight, STOP)
  const p = ll(-1500, 0)
  // Trajeto vai para leste (90°).
  assert.equal(busOnRoute(ctx, { lat: p[0], lon: p[1], heading: 80, speed: 30 }).passed, false)
  const back = busOnRoute(ctx, { lat: p[0], lon: p[1], heading: 270, speed: 30 })
  assert.equal(back.passed, true)
  assert.equal(back.wrongWay, true)
  // Parado: rumo não é confiável, ignora.
  assert.equal(busOnRoute(ctx, { lat: p[0], lon: p[1], heading: 270, speed: 0 }).passed, false)
})

test('segmentBearing e angleDiff', () => {
  assert.equal(Math.round(segmentBearing([[0, 0], [10, 0]], 0)), 90)
  assert.equal(Math.round(segmentBearing([[0, 0], [0, -10]], 0)), 0)
  assert.equal(Math.round(segmentBearing([[0, 0], [0, 10]], 0)), 180)
  assert.equal(angleDiff(350, 10), 20)
  assert.equal(angleDiff(90, 270), 180)
})

test('clipToCircle recorta, interpola na borda e separa pedaços', () => {
  assert.deepEqual(clipToCircle([[-20, 0], [20, 0]], 10), [[[-10, 0], [10, 0]]])
  const pieces = clipToCircle([[0, 0], [5, 0], [20, 0], [20, 20], [0, 5], [0, 0]], 10)
  assert.equal(pieces.length, 2)
  assert.deepEqual(pieces[0], [[0, 0], [5, 0], [10, 0]])
  assert.deepEqual(pieces[1][pieces[1].length - 1], [0, 0])
  assert.deepEqual(clipToCircle([[20, 20], [30, 30]], 10), [])
})

test('toPixelPieces escala, arredonda e simplifica', () => {
  assert.deepEqual(toPixelPieces([[[0, 0], [50, 0.1], [100, 0]]], 0.128), [[0, 0, 13, 0]])
  assert.deepEqual(toPixelPieces([[[0, 0], [1, 1]]], 0.128), []) // vira um ponto só
})

test('pixelPosition prende ao raio', () => {
  const p = makeProjection(STOP)
  assert.deepEqual(pixelPosition(p, ...ll(0, 500), 0.128, 92), { x: 0, y: -64, clamped: false })
  assert.deepEqual(pixelPosition(p, ...ll(5000, 0), 0.128, 80), { x: 80, y: 0, clamped: true })
})

test('buildMapPayload: trajeto recortado, trecho destacado, pontos e ônibus em pixels', () => {
  const ctx = routeContext(straight, STOP)
  const busLL = ll(-500, 0)
  const bus = { lat: busLL[0], lon: busLL[1] }
  bus.route = busOnRoute(ctx, bus)
  const far = { lat: ll(-1800, 0)[0], lon: ll(-1800, 0)[1] }
  far.route = busOnRoute(ctx, far)
  const lineStops = [
    { id: 'eu', lat: STOP.lat, lon: STOP.lon },
    { id: 'a', lat: ll(-300, 0)[0], lon: ll(-300, 0)[1] },
    { id: 'longe', lat: ll(-1500, 0)[0], lon: ll(-1500, 0)[1] }
  ]
  const map = buildMapPayload({ ctx, stop: { id: 'eu', ...STOP }, buses: [bus, far], lineStops, busMaxR: 80 })
  assert.equal(map.r, MAP_RADIUS_PX)
  assert.equal(map.route.length, 1)
  const route = map.route[0]
  assert.equal(route[0], -96) // entra no círculo a 750 m a oeste
  assert.equal(route[route.length - 2], 96)
  // Destaque: do ônibus (-500 m = -64 px) até o ponto (0, ~0).
  assert.equal(map.hi.length, 1)
  assert.equal(map.hi[0][0], -64)
  assert.ok(Math.abs(map.hi[0][map.hi[0].length - 2]) <= 1)
  // Só o ponto "a" (o do usuário fica de fora, o longe fica fora do círculo).
  assert.deepEqual(map.stops, [-38, 0])
  assert.deepEqual(map.buses, [{ x: -64, y: 0, clamped: false }, { x: -80, y: 0, clamped: true }])
  // Mensagem pequena para o Bluetooth.
  assert.ok(JSON.stringify(map).length < 400)
})

test('buildMapPayload sem trajeto: só os ônibus em linha reta', () => {
  const map = buildMapPayload({ ctx: null, stop: STOP, buses: [{ lat: ll(0, 500)[0], lon: ll(0, 500)[1] }] })
  assert.deepEqual(map.route, [])
  assert.deepEqual(map.hi, [])
  assert.deepEqual(map.buses, [{ x: 0, y: -64, clamped: false }])
  assert.deepEqual(buildMapPayload({ ctx: null, stop: null }).buses, [])
})

test('sanitizeMapPayload descarta o que não for inteiro em faixa', () => {
  const m = sanitizeMapPayload({
    r: 96,
    route: [[0, 0, 10, 10], [1, 2, 3], 'x', [0, 0, 9999, 0]],
    hi: null,
    stops: [1, 2, 3, 4],
    buses: [{ x: 1.4, y: -2, clamped: 1 }, { x: 'a', y: 0 }, null]
  })
  assert.deepEqual(m, {
    r: 96,
    k: null,
    auto: true,
    speed: 0,
    stop: { x: 0, y: 0, clamped: false },
    route: [[0, 0, 10, 10]],
    hi: [],
    trail: [],
    stops: [1, 2, 3, 4],
    buses: [{ x: 1, y: -2, clamped: true }, null, null],
    passed: null
  })
  assert.equal(sanitizeMapPayload(null), null)
  assert.deepEqual(sanitizeMapPayload({ stops: [1] }).stops, [])
})

test('advanceAlong anda pela polyline sem passar do fim', () => {
  const path = [0, 0, 10, 0, 10, 10]
  assert.equal(pathLength(path), 20)
  assert.deepEqual(advanceAlong(path, 0), { x: 0, y: 0, along: 0, done: false })
  assert.deepEqual(advanceAlong(path, 4), { x: 4, y: 0, along: 4, done: false })
  assert.deepEqual(advanceAlong(path, 15), { x: 10, y: 5, along: 15, done: false })
  assert.deepEqual(advanceAlong(path, 99), { x: 10, y: 10, along: 20, done: true })
  assert.deepEqual(advanceAlong(path, -3), { x: 0, y: 0, along: 0, done: false })
  assert.deepEqual(advanceAlong([5, 5], 3), { x: 5, y: 5, along: 0, done: true })
  assert.equal(advanceAlong([], 3), null)
  assert.equal(advanceAlong(null, 3), null)
})

test('blend e speedPxPerSec', () => {
  assert.deepEqual(blend({ x: 0, y: 0 }, { x: 10, y: -4 }, 0.5), { x: 5, y: -2 })
  assert.deepEqual(blend({ x: 0, y: 0 }, { x: 10, y: 0 }, 2), { x: 10, y: 0 })
  // 36 km/h = 10 m/s = 1,28 px/s na escala de 128 px/km; limites 15–60 km/h.
  assert.ok(Math.abs(speedPxPerSec(36) - 1.28) < 1e-9)
  assert.equal(speedPxPerSec(0), speedPxPerSec(15))
  assert.equal(speedPxPerSec(200), speedPxPerSec(60))
})

test('animationPath: trecho destacado que começa no ônibus', () => {
  const map = { hi: [[-64, 0, 0, 0]], buses: [{ x: -64, y: 0, clamped: false }] }
  assert.deepEqual(animationPath(map), [-64, 0, 0, 0])
  assert.deepEqual(animationPath({ ...map, buses: [{ x: -80, y: 0, clamped: true }] }), [])
  assert.deepEqual(animationPath({ ...map, buses: [{ x: 30, y: 30, clamped: false }] }), [])
  assert.deepEqual(animationPath({ hi: [], buses: [] }), [])
  assert.deepEqual(animationPath(null), [])
})

test('sanitizeMapPayload: escala, ponto, rastro e ônibus que passou', () => {
  const m = sanitizeMapPayload({
    k: 95.6,
    auto: false,
    stop: { x: 40, y: -30 },
    trail: [1, 2, 3, 4, 'x'],
    passed: { x: 10, y: 12, vehicle: '40210', at: 123 }
  })
  assert.equal(m.k, 96)
  assert.equal(m.auto, false)
  assert.deepEqual(m.stop, { x: 40, y: -30, clamped: false })
  assert.deepEqual(m.trail, []) // ímpar/inválido: descartado
  assert.deepEqual(m.passed, { x: 10, y: 12, clamped: false, vehicle: '40210', at: 123 })
  assert.deepEqual(sanitizeMapPayload({ trail: [1, 2, 3, 4] }).trail, [1, 2, 3, 4])
  assert.equal(sanitizeMapPayload({ passed: { x: 1, y: 1 } }).passed, null)
  assert.equal(sanitizeMapPayload({ k: 5000 }).k, null)
})

test('buildMapPayload com centro e escala: ponto deslocado, destaque sai do ônibus e rastro atrás dele', () => {
  const ctx = routeContext(straight, STOP)
  const busLL = ll(-1000, 40) // 40 m fora do trajeto: o ícone vai para o trajeto
  const bus = { lat: busLL[0], lon: busLL[1] }
  bus.route = busOnRoute(ctx, bus)
  // Centro no meio do ônibus e do ponto, 100 px/km.
  const map = buildMapPayload({ ctx, stop: { id: 'eu', ...STOP }, buses: [bus], pxPerKm: 100, radiusM: 1140, center: [-500, 0], busMaxR: 90 })
  assert.equal(map.k, 100)
  assert.deepEqual(map.stop, { x: 50, y: 0 })
  // Ônibus no trajeto (não no GPS): (-1000 m -> -50 px a partir do centro).
  assert.equal(map.buses[0].x, -50)
  assert.ok(Math.abs(map.buses[0].y) <= 1)
  // Destaque começa exatamente onde o ícone está.
  assert.equal(map.hi[0][0], map.buses[0].x)
  assert.equal(map.hi[0][1], map.buses[0].y)
  assert.deepEqual(animationPath(map), map.hi[0])
  // Rastro: bolinhas a cada 10 px atrás do ônibus (oeste dele), até a borda do recorte.
  assert.ok(map.trail.length >= 8 && map.trail.length % 2 === 0)
  for (let i = 0; i < map.trail.length; i += 2) assert.ok(map.trail[i] <= map.buses[0].x)
  assert.equal(map.trail[2] - map.trail[0], 10)
})

test('buildMapPayload: rastro limitado a trailM e ônibus que passou na escala do mapa', () => {
  const ctx = routeContext(straight, STOP)
  const bus = { lat: ll(-1000, 0)[0], lon: ll(-1000, 0)[1] }
  bus.route = busOnRoute(ctx, bus)
  const map = buildMapPayload({
    ctx,
    stop: STOP,
    buses: [bus],
    pxPerKm: 100,
    radiusM: 5000,
    busMaxR: 90,
    trailM: 300,
    passed: { lat: ll(300, 0)[0], lon: ll(300, 0)[1], along: 2300, vehicle: '40210', at: 99 }
  })
  // 300 m a 100 px/km = 30 px: bolinhas em 0, 10, 20, 30 px.
  assert.equal(map.trail.length, 8)
  assert.deepEqual(map.passed, { x: 30, y: 0, clamped: false, vehicle: '40210', at: 99 })
  // Sem ônibus no trajeto: sem destaque nem rastro.
  const none = buildMapPayload({ ctx, stop: STOP, buses: [], pxPerKm: 100, radiusM: 1000 })
  assert.deepEqual(none.hi, [])
  assert.deepEqual(none.trail, [])
  assert.equal(none.passed, undefined)
})
