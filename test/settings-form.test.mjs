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
