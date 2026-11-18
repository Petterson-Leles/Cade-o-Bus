import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsvLine,
  headerIndex,
  mostCommon,
  selectPatterns,
  chooseStopSequence,
  orderStops,
  compareLineNumbers,
  buildPackage,
  toModule
} from '../shared/gtfs-build.js'
import { decodePolyline } from '../shared/polyline.js'
import { findLine, lineStops, lineShape } from '../shared/gtfs.js'

test('parseCsvLine entende aspas, vírgula dentro de aspas e campos vazios', () => {
  assert.deepEqual(parseCsvLine('a,b,,d'), ['a', 'b', '', 'd'])
  assert.deepEqual(parseCsvLine('1,"Rua A, 10","diz ""oi""",'), ['1', 'Rua A, 10', 'diz "oi"', ''])
  assert.deepEqual(parseCsvLine('326   011080310414,04:14:00'), ['326   011080310414', '04:14:00'])
})

test('headerIndex tira BOM e espaços', () => {
  assert.deepEqual(headerIndex('﻿stop_id, stop_name'), { stop_id: 0, stop_name: 1 })
})

test('mostCommon desempata pelo menor valor', () => {
  assert.equal(mostCommon(new Map([['b', 2], ['a', 2], ['c', 1]])), 'a')
  assert.equal(mostCommon(new Map()), null)
})

const trips = [
  { route_id: 'R1', direction_id: '0', shape_id: 'S1', trip_headsign: 'Centro', trip_id: 't3' },
  { route_id: 'R1', direction_id: '0', shape_id: 'S1', trip_headsign: 'Centro', trip_id: 't1' },
  { route_id: 'R1', direction_id: '0', shape_id: 'S9', trip_headsign: 'Centro via X', trip_id: 't2' },
  { route_id: 'R1', direction_id: '1', shape_id: 'S2', trip_headsign: 'Bairro', trip_id: 't4' },
  { route_id: 'R2', direction_id: '', shape_id: 'S3', trip_headsign: '', trip_id: 't5' }
]

test('selectPatterns escolhe o shape mais usado e o headsign mais comum por sentido', () => {
  const p = selectPatterns(trips)
  assert.deepEqual([...p.keys()].sort(), ['R1|0', 'R1|1', 'R2|0'])
  const a = p.get('R1|0')
  assert.equal(a.shapeId, 'S1')
  assert.equal(a.headsign, 'Centro')
  assert.equal(a.tripCount, 2)
  assert.deepEqual(a.candidateTrips, ['t1', 't3'])
  assert.equal(p.get('R2|0').dir, 0)
  assert.equal(p.get('R2|0').headsign, '')
  assert.deepEqual(selectPatterns(trips, 1).get('R1|0').candidateTrips, ['t1'])
})

test('chooseStopSequence: a mais frequente; empate fica a mais longa', () => {
  assert.deepEqual(chooseStopSequence([['a', 'b'], ['a', 'b', 'c'], ['a', 'b']]), ['a', 'b'])
  assert.deepEqual(chooseStopSequence([['a', 'b'], ['a', 'b', 'c']]), ['a', 'b', 'c'])
  assert.deepEqual(chooseStopSequence([['x'], ['y']]), ['x'])
  assert.deepEqual(chooseStopSequence([[], null]), [])
})

test('orderStops ordena por stop_sequence numérico', () => {
  const rows = [
    { stop_id: 'c', stop_sequence: '10' },
    { stop_id: 'a', stop_sequence: '2' },
    { stop_id: 'b', stop_sequence: '3' }
  ]
  assert.deepEqual(orderStops(rows), ['a', 'b', 'c'])
})

test('compareLineNumbers: números antes de códigos com letra', () => {
  assert.deepEqual(['SC03A', '9250', '101', '4103'].sort(compareLineNumbers), ['101', '4103', '9250', 'SC03A'])
})

function fixture() {
  const routes = [
    { route_id: 'R1', route_short_name: '9250', route_long_name: 'Caetano Furquim/Nova Cintra' },
    { route_id: 'R2', route_short_name: 'SC03A', route_long_name: 'Circular' },
    { route_id: 'R3', route_short_name: '999', route_long_name: 'Sem viagens' }
  ]
  const patterns = selectPatterns(trips)
  // Trajeto reto para leste com um ponto intermediário quase colinear (some na simplificação).
  const shapes = new Map([
    ['S1', [[-19.9, -43.95], [-19.90001, -43.945], [-19.9, -43.94]]],
    ['S2', [[-19.9, -43.94], [-19.9, -43.95]]]
  ])
  const stopSeqs = new Map([
    ['R1|0', ['100', '200', 'XX']], // XX não existe em stops: some
    ['R1|1', ['200', '100']],
    ['R2|0', ['300']]
  ])
  const stops = new Map([
    ['100', { name: ' Rua A 10 ', lat: -19.900004, lon: -43.949996 }],
    ['200', { name: 'Rua B 20', lat: -19.9, lon: -43.94 }],
    ['300', { name: 'Praça', lat: -19.95, lon: -43.93 }],
    ['400', { name: 'Não usado', lat: -19.8, lon: -43.9 }]
  ])
  return { feed: { feed_version: 'v1', feed_end_date: '20270315' }, routes, patterns, shapes, stopSeqs, stops }
}

test('buildPackage monta índice e trajetos compactos', () => {
  const { index, shapes, stats } = buildPackage(fixture())
  assert.equal(index.v, 1)
  assert.equal(index.feed, 'v1')
  assert.equal(index.until, '20270315')
  // Só pontos usados, ordenados por id, coordenadas em inteiros 1e5.
  assert.deepEqual(index.stops, {
    id: ['100', '200', '300'],
    name: ['Rua A 10', 'Rua B 20', 'Praça'],
    lat: [-1990000, -1990000, -1995000],
    lon: [-4395000, -4394000, -4393000]
  })
  assert.deepEqual(index.lines, [
    ['9250', 'Caetano Furquim/Nova Cintra', [[0, 'Centro', [0, 1]], [1, 'Bairro', [1, 0]]]],
    ['SC03A', 'Circular', [[0, '', [2]]]]
  ])
  assert.deepEqual(Object.keys(shapes.shapes).sort(), ['9250|0', '9250|1'])
  assert.deepEqual(decodePolyline(shapes.shapes['9250|0']), [[-19.9, -43.95], [-19.9, -43.94]])
  assert.equal(stats.lines, 2)
  assert.equal(stats.stops, 3)
  assert.equal(stats.rawPoints, 5)
  assert.equal(stats.keptPoints, 4)
})

test('pacote gerado é lido pelas consultas de shared/gtfs.js', () => {
  const { index, shapes } = buildPackage(fixture())
  // Passa por JSON, como no módulo gerado.
  const idx = JSON.parse(JSON.stringify(index))
  const shp = JSON.parse(JSON.stringify(shapes))
  assert.deepEqual(findLine(idx, ' 9250 ').dirs, [
    { dir: 0, headsign: 'Centro', stops: 2 },
    { dir: 1, headsign: 'Bairro', stops: 2 }
  ])
  assert.deepEqual(lineStops(idx, '9250', 1).map((s) => [s.id, s.seq]), [['200', 1], ['100', 2]])
  assert.equal(lineShape(shp, '9250', '1').length, 2)
})

test('toModule gera um módulo ES com comentário', () => {
  const text = toModule({ a: 1 }, 'linha 1\nlinha 2')
  assert.equal(text, '// linha 1\n// linha 2\nexport default {"a":1}\n')
})

test('variantes: outros shapes do sentido com seus pontos, lidos por lineVariants', async () => {
  const { lineVariants } = await import('../shared/gtfs.js')
  const f = fixture()
  // S9 (t2) é variante de R1|0, com sequência própria.
  f.shapes.set('S9', [[-19.9, -43.95], [-19.91, -43.945], [-19.9, -43.94]])
  const p = f.patterns.get('R1|0')
  assert.deepEqual(p.variants.map((v) => [v.key, v.shapeId, v.candidateTrips]), [['R1|0#S9', 'S9', ['t2']]])
  f.stopSeqs.set('R1|0#S9', ['100', '400', '200'])
  const { index, shapes, stats } = buildPackage(f)
  assert.equal(stats.variants, 1)
  // O ponto 400 entra na tabela (é usado pela variante).
  assert.ok(index.stops.id.includes('400'))
  const idx = JSON.parse(JSON.stringify(index))
  const shp = JSON.parse(JSON.stringify(shapes))
  const vs = lineVariants(shp, idx, '9250', 0)
  assert.equal(vs.length, 2)
  assert.equal(vs[0].main, true)
  assert.equal(vs[1].main, false)
  assert.deepEqual(vs[1].stops.map((s) => s.id), ['100', '400', '200'])
  assert.equal(vs[1].shape.length, 3)
  // Pacote antigo (sem variants): só o principal.
  assert.equal(lineVariants({ shapes: shp.shapes }, idx, '9250', 0).length, 1)
})
