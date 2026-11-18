import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS,
  MAP_STATE_KEY,
  cleanThemeState,
  readMapStates,
  writeMapStates,
  applyWatchBits,
  markDone,
  missingTiles,
  statusText,
  formatBytes,
  parseCommand,
  makeCommand,
  runQueue,
  tileParams,
  parseTileParams,
  shouldPrompt,
  PROMPT_SNOOZE_MS
} from '../shared/map-download.js'

const memoryStorage = (init = {}) => {
  const data = { ...init }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), removeItem: (k) => delete data[k], data }
}

test('estado por tema: limpo, lido e gravado no settingsStorage', () => {
  const s = memoryStorage()
  assert.deepEqual(readMapStates(s).dark.status, STATUS.NONE)
  writeMapStates(s, { dark: { status: STATUS.DOWNLOADING, total: 8, have: 'c0' } })
  const back = readMapStates(s)
  assert.equal(back.dark.done, 2)
  assert.equal(back.dark.status, STATUS.DOWNLOADING)
  assert.equal(back.light.status, STATUS.NONE)
  assert.ok(JSON.parse(s.data[MAP_STATE_KEY]).dark)
  // "Pronto" sem todos os blocos não vale.
  assert.equal(cleanThemeState({ status: STATUS.READY, total: 8, have: 'c0' }).status, STATUS.PAUSED)
  assert.equal(cleanThemeState({ status: 'xx' }).status, STATUS.NONE)
  assert.equal(readMapStates(memoryStorage({ [MAP_STATE_KEY]: '{x' })).dark.done, 0)
})

test('o relógio manda no que já tem (applyWatchBits)', () => {
  const st = { status: STATUS.READY, total: 8, have: 'ff' }
  // Relógio perdeu tudo (reinstalado): volta a não baixado.
  assert.equal(applyWatchBits(st, '00', 8).status, STATUS.NONE)
  // Perdeu parte: pausado, falta baixar de novo.
  const p = applyWatchBits(st, 'f0', 8)
  assert.equal(p.status, STATUS.PAUSED)
  assert.equal(p.done, 4)
  // Tem tudo: pronto.
  assert.equal(applyWatchBits({ status: STATUS.DOWNLOADING, total: 8, have: '00' }, 'ff', 8).status, STATUS.READY)
  // Apagando continua apagando.
  assert.equal(applyWatchBits({ status: STATUS.DELETING, total: 8, have: 'ff' }, 'ff', 8).status, STATUS.DELETING)
})

test('markDone e missingTiles: fila retomável', () => {
  const list = [0, 1, 2, 3].map((i) => ({ i }))
  let st = cleanThemeState({ status: STATUS.DOWNLOADING, total: 4, have: '0' })
  st = markDone(st, 1, 5)
  assert.deepEqual(missingTiles(list, st.have).map((t) => t.i), [0, 2, 3])
  st = markDone(markDone(markDone(st, 0), 2), 3)
  assert.equal(st.status, STATUS.READY)
  assert.deepEqual(missingTiles(list, st.have), [])
})

test('statusText e formatBytes', () => {
  assert.equal(statusText({ status: STATUS.DOWNLOADING, total: 8, have: 'e0' }), 'Baixando 3 de 8')
  assert.equal(statusText({}), 'Não baixado')
  assert.equal(statusText({ status: STATUS.READY, total: 4, have: 'f' }), 'Pronto no relógio')
  assert.match(statusText({ status: STATUS.PAUSED, total: 4, have: '8', error: 'longe' }), /Pausado em 1 de 4 · longe/)
  assert.equal(formatBytes(3715213), '3,5 MB')
  assert.equal(formatBytes(4754), '5 KB')
  assert.equal(formatBytes(0), '')
})

test('comandos da tela de configurações', () => {
  assert.deepEqual(parseCommand(makeCommand('download', 'light', 10)), { action: 'download', theme: 'light', at: 10 })
  assert.deepEqual(parseCommand({ action: 'delete', theme: 'all', at: 1 }), { action: 'delete', theme: 'all', at: 1 })
  assert.equal(parseCommand({ action: 'download', theme: 'all' }), null)
  assert.equal(parseCommand({ action: 'formatar', theme: 'dark' }), null)
  assert.equal(parseCommand('{x'), null)
})

test('runQueue: um de cada vez, tenta de novo e pausa depois de MAX_TRIES', async () => {
  const tiles = [{ i: 0 }, { i: 1 }, { i: 2 }]
  let running = 0
  let maxRunning = 0
  const fails = { 1: 2 } // o bloco 1 falha 2 vezes e depois vai
  const done = []
  const r = await runQueue({
    tiles,
    process: async (t) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((res) => setTimeout(res, 1))
      running--
      if (fails[t.i] > 0) {
        fails[t.i]--
        throw new Error('bluetooth')
      }
    },
    onDone: (t) => done.push(t.i)
  })
  assert.equal(r.status, 'finished')
  assert.deepEqual(done, [0, 1, 2])
  assert.equal(maxRunning, 1)

  // Sempre falha: para no bloco e diz o erro.
  const r2 = await runQueue({ tiles, process: () => Promise.reject(new Error('longe')), onDone: () => assert.fail() })
  assert.deepEqual(r2, { status: 'failed', done: 0, error: 'longe' })

  // Pedido para parar no meio.
  let n = 0
  const r3 = await runQueue({ tiles, process: () => n++, shouldStop: () => n >= 2 })
  assert.equal(r3.status, 'stopped')
  assert.equal(r3.done, 2)
})

test('runQueue retomável: rodar de novo com o que falta termina o resto', async () => {
  const list = [0, 1, 2, 3].map((i) => ({ i }))
  let st = cleanThemeState({ status: STATUS.DOWNLOADING, total: 4, have: '0' })
  let calls = 0
  const first = await runQueue({
    tiles: missingTiles(list, st.have),
    process: () => {
      calls++
      if (calls > 2) throw new Error('caiu')
    },
    onDone: (t) => (st = markDone(st, t.i)),
    maxTries: 1
  })
  assert.equal(first.status, 'failed')
  assert.equal(st.done, 2)
  const sent = []
  await runQueue({ tiles: missingTiles(list, st.have), process: (t) => sent.push(t.i), onDone: (t) => (st = markDone(st, t.i)) })
  assert.deepEqual(sent, [2, 3])
  assert.equal(st.status, STATUS.READY)
})

test('tileParams ida e volta e validação no relógio', () => {
  const p = tileParams('dark', { i: 21, k: 80, x: 1, y: 0, name: 'dark-80-1_0.png' }, 400)
  assert.deepEqual(parseTileParams(JSON.parse(JSON.stringify(p))), { theme: 'dark', i: 21, k: 80, x: 1, y: 0, total: 400 })
  assert.equal(parseTileParams({ ...p, kind: 'x' }), null)
  assert.equal(parseTileParams({ ...p, i: '400' }), null)
  assert.equal(parseTileParams({ ...p, theme: 'roxo' }), null)
})

test('shouldPrompt: aviso no relógio só sem mapa e sem insistir', () => {
  const now = 10 * PROMPT_SNOOZE_MS
  assert.equal(shouldPrompt({ ready: false, prompt: null, phoneStatus: STATUS.NONE, now }), true)
  assert.equal(shouldPrompt({ ready: true, prompt: null, now }), false)
  assert.equal(shouldPrompt({ ready: false, prompt: null, phoneStatus: STATUS.DOWNLOADING, now }), false)
  assert.equal(shouldPrompt({ ready: false, prompt: { choice: 'later', at: now - 1000 }, phoneStatus: STATUS.NONE, now }), false)
  assert.equal(shouldPrompt({ ready: false, prompt: { choice: 'later', at: now - PROMPT_SNOOZE_MS - 1 }, phoneStatus: STATUS.NONE, now }), true)
  assert.equal(shouldPrompt({ ready: false, prompt: { choice: 'yes', at: now - 1000 }, phoneStatus: STATUS.NONE, now }), false)
  assert.equal(shouldPrompt({ ready: false, prompt: { choice: 'yes', at: 0 }, phoneStatus: STATUS.ERROR, now }), false)
})
