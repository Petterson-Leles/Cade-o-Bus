import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeFavorites,
  readFavorites,
  writeFavorites,
  removeFavorite,
  newFavoriteId,
  FAVORITES_KEY,
  MAX_TEXT_LEN
} from '../utils/favorites.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => delete data[k],
    data
  }
}

test('sanitizeFavorites descarta itens inválidos', () => {
  const list = sanitizeFavorites([
    null,
    'texto',
    { name: 'Casa', line: '1234', lat: '-19.9', lon: '-43.9' },
    { name: '', line: '1', lat: 1, lon: 1 },
    { name: 'Sem linha', lat: 1, lon: 1 },
    { name: 'Coord ruim', line: '1', lat: 'abc', lon: 1 },
    { name: { x: 1 }, line: '1', lat: 1, lon: 1 },
    { id: 'abc', name: ' Trabalho ', line: 5102, lat: '-19,92', lon: -43.93 }
  ])
  assert.deepEqual(list, [
    { name: 'Casa', line: '1234', lat: '-19.9', lon: '-43.9' },
    { id: 'abc', name: 'Trabalho', line: '5102', lat: '-19.92', lon: '-43.93' }
  ])
  assert.deepEqual(sanitizeFavorites('não é lista'), [])
})

test('sanitizeFavorites corta nome e linha em 30 caracteres', () => {
  const [fav] = sanitizeFavorites([{ name: 'n'.repeat(100), line: 'l'.repeat(50), lat: 1, lon: 2 }])
  assert.equal(MAX_TEXT_LEN, 30)
  assert.equal(fav.name.length, 30)
  assert.equal(fav.line.length, 30)
})

test('readFavorites tolera JSON quebrado e filtra; writeFavorites grava limpo', () => {
  assert.deepEqual(readFavorites(memoryStorage({ [FAVORITES_KEY]: '{quebrado' })), [])
  assert.deepEqual(readFavorites(memoryStorage({ [FAVORITES_KEY]: '{"a":1}' })), [])
  const s = memoryStorage()
  writeFavorites(s, [{ name: 'A', line: '1', lat: 1, lon: 2 }, { lixo: true }])
  assert.deepEqual(JSON.parse(s.data[FAVORITES_KEY]), [{ name: 'A', line: '1', lat: '1', lon: '2' }])
})

test('removeFavorite remove por id, ou por conteúdo nos antigos sem id', () => {
  const a = { id: 'a', name: 'Casa', line: '1', lat: '1', lon: '2' }
  const b = { id: 'b', name: 'Casa', line: '1', lat: '1', lon: '2' }
  const old1 = { name: 'Velho', line: '2', lat: '3', lon: '4' }
  const old2 = { name: 'Velho', line: '2', lat: '3', lon: '4' }
  const list = [a, old1, b, old2]
  assert.deepEqual(removeFavorite(list, b), [a, old1, old2])
  // só o primeiro igual sai
  assert.deepEqual(removeFavorite(list, { ...old1 }), [a, b, old2])
  // id que não existe mais (lista mudou em outra tela): nada sai
  assert.deepEqual(removeFavorite(list, { id: 'zzz' }), list)
})

test('newFavoriteId gera ids diferentes', () => {
  assert.notEqual(newFavoriteId(1, () => 0.1), newFavoriteId(1, () => 0.2))
  assert.equal(typeof newFavoriteId(), 'string')
})
