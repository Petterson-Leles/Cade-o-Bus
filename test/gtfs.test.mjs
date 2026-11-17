import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLineNumber, findLine, lineStops, stopById, lineShape, searchLines } from '../shared/gtfs.js'
import { encodePolyline } from '../shared/polyline.js'
import GTFS_INDEX from '../data/gtfs-index.js'
import GTFS_SHAPES from '../data/gtfs-shapes.js'

const index = {
  v: 1,
  stops: { id: ['10', '20', '30'], name: ['A', 'B', 'C'], lat: [-1990000, -1991000, -1992000], lon: [-4390000, -4391000, -4392000] },
  lines: [
    ['101', 'Linha 101', [[0, 'Centro', [0, 1, 2]], [1, 'Bairro', [2, 0]]]],
    ['1010', 'Outra', [[0, 'X', [1]]]],
    ['SC03A', 'Circular', [[0, 'Volta', [2]]]]
  ]
}

test('normalizeLineNumber', () => {
  assert.equal(normalizeLineNumber(' 9250 '), '9250')
  assert.equal(normalizeLineNumber('sc 03a'), 'SC03A')
  assert.equal(normalizeLineNumber(9250), '9250')
  assert.equal(normalizeLineNumber({}), '')
  assert.equal(normalizeLineNumber(null), '')
})

test('findLine acha pelo número e resume os sentidos', () => {
  assert.deepEqual(findLine(index, 'sc03a'), { number: 'SC03A', name: 'Circular', dirs: [{ dir: 0, headsign: 'Volta', stops: 1 }] })
  assert.equal(findLine(index, '999'), null)
  assert.equal(findLine(index, ''), null)
  assert.equal(findLine(null, '101'), null)
})

test('lineStops devolve os pontos na ordem da viagem', () => {
  assert.deepEqual(lineStops(index, '101', 1), [
    { id: '30', name: 'C', lat: -19.92, lon: -43.92, seq: 1 },
    { id: '10', name: 'A', lat: -19.9, lon: -43.9, seq: 2 }
  ])
  assert.deepEqual(lineStops(index, '101', '0').map((s) => s.id), ['10', '20', '30'])
  assert.deepEqual(lineStops(index, '101', 5), [])
  assert.deepEqual(lineStops(index, 'nada', 0), [])
})

test('stopById', () => {
  assert.deepEqual(stopById(index, ' 20 '), { id: '20', name: 'B', lat: -19.91, lon: -43.91 })
  assert.equal(stopById(index, '99'), null)
  assert.equal(stopById(index, null), null)
})

test('lineShape decodifica o trajeto do sentido', () => {
  const shapes = { shapes: { '101|0': encodePolyline([[-19.9, -43.9], [-19.91, -43.91]]) } }
  assert.deepEqual(lineShape(shapes, '101', 0), [[-19.9, -43.9], [-19.91, -43.91]])
  assert.deepEqual(lineShape(shapes, '101', 1), [])
  assert.deepEqual(lineShape(shapes, 'constructor', 0), [])
  assert.deepEqual(lineShape(null, '101', 0), [])
})

test('searchLines sugere pelo começo do número', () => {
  assert.deepEqual(searchLines(index, '10').map((l) => l.number), ['101', '1010'])
  assert.deepEqual(searchLines(index, '10', 1).map((l) => l.number), ['101'])
  assert.deepEqual(searchLines(index, ''), [])
})

test('pacote real (data/): linha 9250 com dois sentidos, pontos e trajeto em BH', () => {
  assert.equal(GTFS_INDEX.v, 1)
  assert.ok(GTFS_INDEX.lines.length > 250)
  const line = findLine(GTFS_INDEX, '9250')
  assert.ok(line, 'linha 9250 existe')
  assert.equal(line.dirs.length, 2)
  line.dirs.forEach((d) => {
    const stops = lineStops(GTFS_INDEX, '9250', d.dir)
    assert.ok(stops.length > 20)
    stops.forEach((s) => {
      assert.ok(s.lat > -20.3 && s.lat < -19.5 && s.lon > -44.4 && s.lon < -43.5, `${s.id} em BH`)
    })
    const shape = lineShape(GTFS_SHAPES, '9250', d.dir)
    assert.ok(shape.length > 20)
  })
  // Toda referência de ponto aponta para a tabela.
  const n = GTFS_INDEX.stops.id.length
  GTFS_INDEX.lines.forEach(([, , dirs]) => dirs.forEach(([, , seq]) => seq.forEach((i) => assert.ok(i >= 0 && i < n))))
})
