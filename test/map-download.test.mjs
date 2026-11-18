import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAP_STATE_KEY,
  cleanThemeState,
  readMapStates,
  writeMapStates,
  applyWatchBits,
  storedCount,
  storedText,
  markDeleting,
  parseCommand,
  makeCommand,
  tileParams,
  parseTileParams
} from '../shared/map-download.js'

const memoryStorage = (init = {}) => {
  const data = { ...init }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), removeItem: (k) => delete data[k], data }
}

test('estado por tema: limpo, lido e gravado no settingsStorage', () => {
  const s = memoryStorage()
  assert.equal(readMapStates(s).dark.done, 0)
  writeMapStates(s, { dark: { total: 8, have: 'c0' } })
  const back = readMapStates(s)
  assert.equal(back.dark.done, 2)
  assert.equal(back.light.done, 0)
  assert.ok(JSON.parse(s.data[MAP_STATE_KEY]).dark)
  assert.equal(readMapStates(memoryStorage({ [MAP_STATE_KEY]: '{x' })).dark.done, 0)
  // Formato antigo: status 'deleting' vira deleting.
  assert.equal(cleanThemeState({ status: 'deleting', total: 4, have: 'f' }).deleting, true)
  assert.equal(cleanThemeState({ status: 'ready', total: 4, have: 'f' }).deleting, false)
})

test('o relógio manda no que tem (applyWatchBits): o cache LRU pode ter apagado blocos', () => {
  const st = { total: 8, have: 'ff' }
  assert.equal(applyWatchBits(st, '00', 8).done, 0)
  assert.equal(applyWatchBits(st, 'f0', 8).done, 4)
  assert.equal(applyWatchBits({}, 'f', 4).total, 4)
  assert.equal(applyWatchBits({ total: 8, have: '', deleting: true }, 'ff', 8).deleting, true)
})

test('contagem e texto da tela de configurações; "Limpar" marca na hora', () => {
  const states = { dark: { total: 8, have: 'e0' }, light: { total: 4, have: '8' } }
  assert.equal(storedCount(states), 4)
  assert.equal(storedText(states), 'Ruas aparecem conforme você usa · 4 blocos guardados no relógio')
  assert.equal(storedText({ dark: { total: 4, have: '8' } }), 'Ruas aparecem conforme você usa · 1 bloco guardado no relógio')
  assert.equal(storedText({}), 'Ruas aparecem conforme você usa · 0 blocos guardados no relógio')
  const del = markDeleting(states, 5)
  assert.equal(del.dark.deleting, true)
  assert.equal(del.light.deleting, true)
  assert.match(storedText(del), /Limpando/)
  // Tema vazio não precisa limpar.
  assert.equal(markDeleting({ dark: {} }).dark.deleting, false)
})

test('comandos da tela de configurações: só "delete"', () => {
  assert.deepEqual(parseCommand(makeCommand('delete', 'all', 10)), { action: 'delete', theme: 'all', at: 10 })
  assert.deepEqual(parseCommand({ action: 'delete', theme: 'light', at: 1 }), { action: 'delete', theme: 'light', at: 1 })
  assert.equal(parseCommand({ action: 'download', theme: 'dark' }), null)
  assert.equal(parseCommand({ action: 'delete', theme: 'roxo' }), null)
  assert.equal(parseCommand('{x'), null)
})

test('tileParams ida e volta e validação no relógio', () => {
  const p = tileParams('dark', { i: 21, k: 80, x: 1, y: 0, name: 'dark-80-1_0.png' }, 400)
  assert.deepEqual(parseTileParams(JSON.parse(JSON.stringify(p))), { theme: 'dark', i: 21, k: 80, x: 1, y: 0, total: 400 })
  assert.equal(parseTileParams({ ...p, kind: 'x' }), null)
  assert.equal(parseTileParams({ ...p, i: '400' }), null)
  assert.equal(parseTileParams({ ...p, theme: 'roxo' }), null)
})
