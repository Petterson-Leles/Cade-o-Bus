import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readJson,
  toCoord,
  splitLatLon,
  validate,
  applyDraftChange,
  buildFavorite
} from '../shared/settings-form.js'

const ok = { name: 'Casa', line: '1234', lat: '-19.9191', lon: '-43.9386' }

test('readJson devolve fallback em vazio, nulo ou JSON quebrado', () => {
  const s = (v) => ({ getItem: () => v })
  assert.deepEqual(readJson(s(null), 'k', {}), {})
  assert.deepEqual(readJson(s('null'), 'k', {}), {})
  assert.deepEqual(readJson(s('{x'), 'k', { a: 1 }), { a: 1 })
  assert.deepEqual(readJson(s('{"a":2}'), 'k', {}), { a: 2 })
  assert.deepEqual(readJson({ getItem: () => { throw new Error('x') } }, 'k', 7), 7)
})

test('toCoord aceita vírgula decimal e rejeita lixo', () => {
  assert.equal(toCoord('-19,9191'), -19.9191)
  assert.equal(toCoord(' -43.9 '), -43.9)
  assert.ok(Number.isNaN(toCoord('')))
  assert.ok(Number.isNaN(toCoord('abc')))
  assert.ok(Number.isNaN(toCoord(undefined)))
})

test('splitLatLon separa "lat, lon" do Google Maps', () => {
  assert.deepEqual(splitLatLon('-19.919100, -43.938600'), { lat: '-19.919100', lon: '-43.938600' })
  assert.deepEqual(splitLatLon('-19.9191,-43.9386'), { lat: '-19.9191', lon: '-43.9386' })
  assert.deepEqual(splitLatLon('(-19.9191, -43.9386)'), { lat: '-19.9191', lon: '-43.9386' })
  assert.deepEqual(splitLatLon('-19,9191 -43,9386'), { lat: '-19.9191', lon: '-43.9386' })
  assert.deepEqual(splitLatLon('-19,9191; -43,9386'), { lat: '-19.9191', lon: '-43.9386' })
  // um número só, com vírgula decimal, não é par
  assert.equal(splitLatLon('-19,9191'), null)
  assert.equal(splitLatLon('-19.9191'), null)
  assert.equal(splitLatLon('abc'), null)
})

test('applyDraftChange preenche lat e lon ao colar par no campo de latitude', () => {
  assert.deepEqual(applyDraftChange({ name: 'A' }, 'lat', ' -19.9191, -43.9386 '), {
    name: 'A',
    lat: '-19.9191',
    lon: '-43.9386'
  })
  assert.deepEqual(applyDraftChange({ lon: '-43.9' }, 'lat', '-19,9'), { lon: '-43.9', lat: '-19,9' })
  assert.deepEqual(applyDraftChange({}, 'name', '  Casa '), { name: 'Casa' })
})

test('validate aceita ponto em BH', () => {
  assert.deepEqual(validate(ok), [])
  assert.deepEqual(validate({ ...ok, lat: '-19,9191', lon: '-43,9386' }), [])
})

test('validate pede campos vazios', () => {
  const errors = validate({})
  assert.equal(errors.length, 4)
  assert.ok(errors[0].includes('Nome do ponto'))
  assert.equal(validate(null).length, 4)
})

test('validate recusa coordenadas fora de BH ou inválidas', () => {
  assert.match(validate({ ...ok, lat: '-23.55' }).join(' '), /Latitude fora de BH/)
  assert.match(validate({ ...ok, lon: '-46.63' }).join(' '), /Longitude fora de BH/)
  assert.match(validate({ ...ok, lat: 'abc' }).join(' '), /Latitude inválida/)
  assert.match(validate({ ...ok, lon: '19.9' }).join(' '), /Longitude fora de BH/)
})

test('validate avisa quando latitude e longitude parecem trocadas', () => {
  const errors = validate({ ...ok, lat: '-43.9386', lon: '-19.9191' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /trocadas/)
})

test('validate limita nome e linha a 30 caracteres', () => {
  assert.match(validate({ ...ok, name: 'x'.repeat(31) }).join(' '), /no máximo 30/)
  assert.match(validate({ ...ok, line: '1'.repeat(31) }).join(' '), /no máximo 30/)
})

test('buildFavorite normaliza o rascunho', () => {
  assert.deepEqual(buildFavorite({ name: ' Casa ', line: ' 1 ', lat: '-19,9', lon: '-43,9' }, 'id1'), {
    id: 'id1',
    name: 'Casa',
    line: '1',
    lat: '-19.9',
    lon: '-43.9'
  })
})

// ---- Fluxo pela lista do GTFS: linha -> sentido -> ponto ----
import { validateDraft, draftChoices, selectValue } from '../shared/settings-form.js'

const INDEX = {
  v: 1,
  stops: {
    id: ['10', '20', '30'],
    name: ['Avenida Afonso Pena 1500', 'Rua da Bahia 100', 'Praça Sete'],
    lat: [-1992000, -1991900, -1991800],
    lon: [-4393000, -4393100, -4393200]
  },
  lines: [
    ['9250', 'Caetano Furquim/Nova Cintra', [[0, 'Nova Cintra', [0, 1]], [1, 'São Geraldo', [1, 2]]]],
    ['SC03A', 'Circular', [[0, 'Volta', [2, 0]]]]
  ]
}

test('applyDraftChange: trocar linha limpa sentido e ponto; trocar sentido limpa ponto', () => {
  const d = { line: '9250', dir: '1', stopId: '20', name: 'X' }
  assert.deepEqual(applyDraftChange(d, 'line', ' 9250 '), { line: '9250', dir: '1', stopId: '20', name: 'X' })
  assert.deepEqual(applyDraftChange(d, 'line', '5102'), { line: '5102', name: 'X' })
  assert.deepEqual(applyDraftChange(d, 'dir', '0'), { line: '9250', dir: '0', name: 'X' })
  assert.deepEqual(applyDraftChange(d, 'dir', { value: '1' }), d)
  assert.deepEqual(applyDraftChange(d, 'stopId', { value: 30 }), { ...d, stopId: '30' })
  assert.deepEqual(applyDraftChange({}, 'manual', true), { manual: true })
  assert.deepEqual(applyDraftChange({ manual: true }, 'manual', 'sim'), { manual: false })
  assert.deepEqual(applyDraftChange(null, 'name', 'A'), { name: 'A' })
})

test('selectValue aceita texto, número ou { value }', () => {
  assert.equal(selectValue('1'), '1')
  assert.equal(selectValue(0), '0')
  assert.equal(selectValue({ value: ' 20 ' }), '20')
  assert.equal(selectValue(null), '')
})

test('draftChoices: sugestões, sentidos e pontos da linha', () => {
  assert.deepEqual(draftChoices({}, INDEX).dirOptions, [])
  assert.deepEqual(draftChoices({ line: '92' }, INDEX).suggestions.map((l) => l.number), ['9250'])
  const c = draftChoices({ line: '9250' }, INDEX)
  assert.deepEqual(c.dirOptions, [
    { name: 'Sentido Nova Cintra', value: '0' },
    { name: 'Sentido São Geraldo', value: '1' }
  ])
  assert.equal(c.dir, null)
  const d = draftChoices({ line: '9250', dir: '1', stopId: '30' }, INDEX)
  assert.deepEqual(d.stopOptions, [
    { name: '1. Rua da Bahia 100', value: '20' },
    { name: '2. Praça Sete', value: '30' }
  ])
  assert.equal(d.stop.name, 'Praça Sete')
  // Ponto de outro sentido não vale.
  assert.equal(draftChoices({ line: '9250', dir: '0', stopId: '30' }, INDEX).stop, null)
  // Sentido único já vem escolhido.
  assert.equal(draftChoices({ line: 'sc03a' }, INDEX).dir, 0)
})

test('validateDraft pela lista', () => {
  assert.deepEqual(validateDraft({}, INDEX), ['Preencha "Número da linha".'])
  assert.match(validateDraft({ line: '1' }, INDEX)[0], /Linha 1 não encontrada/)
  assert.deepEqual(validateDraft({ line: '9250' }, INDEX), ['Escolha o sentido.'])
  assert.deepEqual(validateDraft({ line: '9250', dir: '0' }, INDEX), ['Escolha o ponto na lista.'])
  assert.deepEqual(validateDraft({ line: '9250', dir: '0', stopId: '10' }, INDEX), [])
  assert.match(validateDraft({ line: '9250', dir: '0', stopId: '10', name: 'n'.repeat(31) }, INDEX).join(' '), /no máximo 30/)
})

test('validateDraft no modo avançado usa a validação manual', () => {
  assert.deepEqual(validateDraft({ ...ok, manual: true }, INDEX), [])
  assert.equal(validateDraft({ manual: true }, INDEX).length, 4)
  assert.match(validateDraft({ ...ok, manual: true, dir: '5' }, INDEX).join(' '), /Sentido inválido/)
  assert.deepEqual(validateDraft(ok), []) // sem índice: manual
})

test('buildFavorite pela lista guarda line, dir, stopId, name, lat e lon', () => {
  assert.deepEqual(buildFavorite({ line: ' 9250', dir: '1', stopId: '30' }, 'id1', INDEX), {
    id: 'id1',
    name: 'Praça Sete',
    line: '9250',
    dir: 1,
    stopId: '30',
    lat: '-19.918',
    lon: '-43.932'
  })
  const longName = buildFavorite({ line: '9250', dir: '0', stopId: '10', name: '  Trabalho ' }, 'id2', INDEX)
  assert.equal(longName.name, 'Trabalho')
  assert.deepEqual(buildFavorite({ ...ok, manual: true, dir: '0' }, 'id3', INDEX), {
    id: 'id3', name: 'Casa', line: '1234', lat: '-19.9191', lon: '-43.9386', dir: 0
  })
})
