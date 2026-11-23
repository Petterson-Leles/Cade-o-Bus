import test from 'node:test'
import assert from 'node:assert/strict'
import { stationLabel } from '../shared/text.js'
import { buildFavorite, filterStops, autoStopName } from '../shared/settings-form.js'
import { lineStops } from '../shared/gtfs.js'
import INDEX from '../data/gtfs-index.js'

test('stationLabel normaliza os nomes de estação do GTFS', () => {
  assert.equal(stationLabel('Estacao Move Sao Judas Tadeu'), 'Estação São Judas Tadeu')
  assert.equal(stationLabel('Estação São Gabriel'), 'Estação São Gabriel')
  assert.equal(stationLabel('Estação Rio de Janeiro - Plataforma 1B'), 'Estação Rio de Janeiro')
  assert.equal(stationLabel('Mineirão'), 'Estação Mineirão')
  assert.equal(stationLabel(''), '')
  assert.equal(stationLabel(null), '')
})

test('pontos dentro das estações grandes vêm com o nome da estação', () => {
  const names = new Set(INDEX.stops.st.filter(Boolean))
  ;['Estação São Gabriel', 'Estação Pampulha', 'Estação Diamante', 'Estação Vilarinho', 'Estação Barreiro', 'Estação Venda Nova'].forEach((n) => assert.ok(names.has(n), n))
})

test('favorito sem nome num ponto de estação recebe o nome da estação', () => {
  const line = INDEX.lines.find((l) => l[2].some((d) => d[2].some((i) => INDEX.stops.st[i] === 'Estação São Gabriel')))
  assert.ok(line, 'alguma linha passa na Estação São Gabriel')
  const dir = line[2].find((d) => d[2].some((i) => INDEX.stops.st[i] === 'Estação São Gabriel'))
  const stop = lineStops(INDEX, line[0], dir[0]).find((s) => s.station === 'Estação São Gabriel')
  assert.equal(autoStopName(stop), 'Estação São Gabriel')
  const fav = buildFavorite({ line: line[0], dir: String(dir[0]), stopId: stop.id, name: '' }, 'x', INDEX)
  assert.equal(fav.name, 'Estação São Gabriel')
  const named = buildFavorite({ line: line[0], dir: String(dir[0]), stopId: stop.id, name: 'Trabalho' }, 'x', INDEX)
  assert.equal(named.name, 'Trabalho')
  assert.ok(filterStops([{ ...stop, street: 'R. X' }], 'sao gabriel').length === 1)
})

test('stopKind separa rua, MOVE e estação central', async () => {
  const { stopKind } = await import('../shared/text.js')
  assert.equal(stopKind({ name: 'Rua X' }), 'street')
  assert.equal(stopKind({ station: 'Estação Mineirão' }), 'move')
  assert.equal(stopKind({ station: 'Estação São Gabriel' }), 'central')
  assert.equal(stopKind(null), 'street')
  const names = new Set(INDEX.stops.st.filter(Boolean))
  ;['Estação São Gabriel', 'Estação Pampulha', 'Estação Vilarinho', 'Estação Venda Nova', 'Estação Barreiro', 'Estação Diamante'].forEach((n) => assert.ok(names.has(n), n))
})
