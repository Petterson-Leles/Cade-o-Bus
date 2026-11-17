import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodePolyline, decodePolyline, simplifyXY, simplifyLatLon } from '../shared/polyline.js'

test('encodePolyline segue o exemplo do Google', () => {
  const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
  assert.equal(encodePolyline(pts), '_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), pts)
})

test('polyline ida e volta arredonda a 5 casas', () => {
  const pts = [[-19.919123, -43.938649], [-19.92, -43.94], [-19.9, -43.9]]
  const back = decodePolyline(encodePolyline(pts))
  assert.deepEqual(back, [[-19.91912, -43.93865], [-19.92, -43.94], [-19.9, -43.9]])
})

test('decodePolyline tolera lixo e vazio', () => {
  assert.deepEqual(decodePolyline(''), [])
  assert.deepEqual(decodePolyline(null), [])
  assert.deepEqual(decodePolyline('_p~iF'), []) // só a latitude: descarta
  assert.ok(Array.isArray(decodePolyline('\u0001\u0002')))
})

test('simplifyXY tira pontos colineares e mantém a quina', () => {
  const pts = [[0, 0], [1, 0.01], [2, 0], [3, 0], [3, 1], [3, 2]]
  assert.deepEqual(simplifyXY(pts, 0.1), [[0, 0], [3, 0], [3, 2]])
  assert.deepEqual(simplifyXY([[0, 0], [1, 1]], 5), [[0, 0], [1, 1]])
})

test('simplifyLatLon usa tolerância em metros', () => {
  // ~5 m de desvio no meio de 1 km: some com 8 m, fica com 2 m.
  const mid = [-19.9, -43.9 + 0.0047]
  mid[0] += 5 / 111320
  const pts = [[-19.9, -43.9], mid, [-19.9, -43.9 + 0.0095]]
  assert.equal(simplifyLatLon(pts, 8).length, 2)
  assert.equal(simplifyLatLon(pts, 2).length, 3)
})
