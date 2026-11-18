import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapOffset, etaFontSize, infoLine, MAP_MAX_R } from '../utils/detail-view.js'

const stop = { lat: '-19.9191', lon: '-43.9386' }

test('mapOffset: mesmo lugar fica no centro', () => {
  assert.deepEqual(mapOffset(stop, { lat: -19.9191, lon: -43.9386 }), { dx: 0, dy: 0, clamped: false })
})

test('mapOffset: 1 km ao norte = 90 px para cima', () => {
  const o = mapOffset(stop, { lat: -19.9191 + 1000 / 111320, lon: -43.9386 })
  assert.equal(o.dx, 0)
  assert.equal(o.dy, -90)
  assert.equal(o.clamped, false)
})

test('mapOffset: leste vai para a direita, sul para baixo', () => {
  const o = mapOffset(stop, { lat: -19.9241, lon: -43.9336 })
  assert.ok(o.dx > 0 && o.dy > 0)
})

test('mapOffset: ônibus longe fica preso na borda do círculo', () => {
  const o = mapOffset(stop, { lat: -19.9691, lon: -43.9386 }) // ~5,6 km ao sul
  assert.equal(o.clamped, true)
  assert.equal(o.dx, 0)
  assert.equal(o.dy, MAP_MAX_R)
  const p = mapOffset(stop, { lat: -19.8691, lon: -43.8886 }, { maxR: 50 })
  assert.ok(Math.hypot(p.dx, p.dy) <= 51)
})

test('mapOffset: sem coordenada devolve null', () => {
  assert.equal(mapOffset(stop, { lat: undefined, lon: -43.9 }), null)
  assert.equal(mapOffset({ lat: 'abc', lon: '1' }, { lat: 1, lon: 1 }), null)
  assert.equal(mapOffset(null, { lat: 1, lon: 1 }), null)
})

test('etaFontSize diminui com o número de dígitos', () => {
  assert.equal(etaFontSize(5), 160)
  assert.equal(etaFontSize(12), 120)
  assert.equal(etaFontSize(120), 84)
})

test('infoLine', () => {
  const first = { distanceM: 1200, vehicle: '40001', etaMin: 4 }
  assert.equal(infoLine(first, [{ etaMin: 11 }, { etaMin: 19 }, { etaMin: 30 }]), '1,2 km · depois 11 e 19 min')
  assert.equal(infoLine(first, [{ etaMin: 11 }]), '1,2 km · depois 11 min')
  assert.equal(infoLine(first, []), '1,2 km · ônibus 40001')
  assert.equal(infoLine(null, []), '')
})

test('parseBusesResult aceita { buses, map } e o formato antigo', async () => {
  const { parseBusesResult } = await import('../utils/detail-view.js')
  const bus = { etaMin: 3, distanceM: 500, vehicle: '1' }
  assert.deepEqual(parseBusesResult([bus]), { buses: [bus], map: null })
  const r = parseBusesResult({ buses: [bus], map: { r: 96, route: [[0, 0, 5, 5]], hi: [], stops: [], buses: [{ x: 1, y: 2 }] } })
  assert.deepEqual(r.buses, [bus])
  assert.deepEqual(r.map.route, [[0, 0, 5, 5]])
  assert.deepEqual(r.map.buses, [{ x: 1, y: 2, clamped: false }])
  assert.deepEqual(parseBusesResult(null), { buses: [], map: null })
  assert.deepEqual(parseBusesResult({ buses: 'x' }), { buses: [], map: null })
})
