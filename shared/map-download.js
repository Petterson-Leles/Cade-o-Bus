// Download do mapa de BH (celular -> relógio): estado guardado no settingsStorage,
// fila sequencial e retomável, comandos da tela de configurações e o aviso do relógio.
// Lógica pura (sem APIs do Zepp OS), testada em test/map-download.test.mjs.
import { MAP_THEMES, normalizeBits, countBits, hasBit, setBit } from './map-tiles.js'

// settingsStorage (celular): estado por tema, manifesto em cache e o último comando.
export const MAP_STATE_KEY = 'mapDownload'
export const MAP_MANIFEST_KEY = 'mapManifest'
export const MAP_COMMAND_KEY = 'mapCommand'
// Status de cada tema.
export const STATUS = Object.freeze({
  NONE: 'none', // não baixado
  DOWNLOADING: 'downloading', // baixando n de N
  PAUSED: 'paused', // parou no meio (relógio longe, app fechado...): continua depois
  READY: 'ready', // pronto
  ERROR: 'error',
  DELETING: 'deleting' // apagar no relógio na próxima conexão
})
const STATUS_LIST = Object.keys(STATUS).map((k) => STATUS[k])
// Tentativas por bloco antes de pausar a fila.
export const MAX_TRIES = 3
// Aviso "Baixar o mapa?" no relógio: depois de "Agora não", só volta depois disso.
export const PROMPT_SNOOZE_MS = 3 * 24 * 3600 * 1000

const isTheme = (t) => MAP_THEMES.indexOf(t) >= 0

export function emptyThemeState() {
  return { status: STATUS.NONE, done: 0, total: 0, have: '', error: '', updatedAt: 0, stored: 0 }
}

// Estado de um tema (sempre um objeto completo e coerente).
export function cleanThemeState(raw) {
  const s = emptyThemeState()
  if (!raw || typeof raw !== 'object') return s
  if (STATUS_LIST.indexOf(raw.status) >= 0) s.status = raw.status
  s.total = Number.isInteger(raw.total) && raw.total >= 0 && raw.total <= 10000 ? raw.total : 0
  s.have = normalizeBits(raw.have, s.total)
  s.done = countBits(s.have, s.total)
  s.error = typeof raw.error === 'string' ? raw.error.slice(0, 120) : ''
  s.updatedAt = Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : 0
  s.stored = Number(raw.stored) > 0 ? Math.round(Number(raw.stored)) : 0
  if (s.status === STATUS.READY && (s.total === 0 || s.done < s.total)) s.status = s.done > 0 ? STATUS.PAUSED : STATUS.NONE
  return s
}

export function readMapStates(storage) {
  let raw = null
  try {
    raw = JSON.parse(storage.getItem(MAP_STATE_KEY) || 'null')
  } catch (e) {
    raw = null
  }
  const out = {}
  MAP_THEMES.forEach((t) => {
    out[t] = cleanThemeState(raw && raw[t])
  })
  return out
}

export function writeMapStates(storage, states) {
  const out = {}
  MAP_THEMES.forEach((t) => {
    out[t] = cleanThemeState(states && states[t])
  })
  storage.setItem(MAP_STATE_KEY, JSON.stringify(out))
  return out
}

// Junta o que o relógio diz ter (mapa de bits) ao estado do celular. O relógio é
// quem manda: se ele perdeu blocos (app reinstalado), eles voltam para a fila.
export function applyWatchBits(state, watchHex, total) {
  const s = cleanThemeState(state)
  const n = Number.isInteger(total) && total > 0 ? total : s.total
  const have = normalizeBits(watchHex, n)
  const done = countBits(have, n)
  const next = { ...s, total: n, have, done }
  if (s.status === STATUS.DELETING) return next
  if (n > 0 && done >= n) return { ...next, status: STATUS.READY, error: '' }
  if (s.status === STATUS.READY) return { ...next, status: done > 0 ? STATUS.PAUSED : STATUS.NONE }
  return next
}

// Marca o bloco i como entregue.
export function markDone(state, i, now = Date.now()) {
  const have = setBit(normalizeBits(state.have, state.total), i)
  const done = countBits(have, state.total)
  const status = done >= state.total && state.total > 0 ? STATUS.READY : state.status
  return { ...state, have, done, status, updatedAt: now, error: status === STATUS.READY ? '' : state.error }
}

// Próximos blocos que faltam (na ordem da lista).
export function missingTiles(list, have) {
  return (list || []).filter((t) => !hasBit(have, t.i))
}

// Texto do estado para a tela de configurações.
export function statusText(state) {
  const s = cleanThemeState(state)
  switch (s.status) {
    case STATUS.DOWNLOADING:
      return s.total > 0 ? `Baixando ${s.done} de ${s.total}` : 'Baixando…'
    case STATUS.PAUSED:
      return `Pausado em ${s.done} de ${s.total}${s.error ? ` · ${s.error}` : ''}`
    case STATUS.READY:
      return 'Pronto no relógio'
    case STATUS.ERROR:
      return `Erro${s.error ? `: ${s.error}` : ''}`
    case STATUS.DELETING:
      return 'Apagando (abra o app no relógio)'
    default:
      return 'Não baixado'
  }
}

// "3,7 MB"
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!(n > 0)) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

// ---- Comandos (tela de configurações -> side service, pelo settingsStorage) ----

export const COMMANDS = ['download', 'pause', 'delete']

// { action, theme, at } ou null. theme 'all' vale só para delete.
export function parseCommand(raw) {
  let c = raw
  if (typeof raw === 'string') {
    try {
      c = JSON.parse(raw)
    } catch (e) {
      return null
    }
  }
  if (!c || typeof c !== 'object' || COMMANDS.indexOf(c.action) < 0) return null
  const theme = c.theme === 'all' && c.action !== 'download' ? 'all' : isTheme(c.theme) ? c.theme : null
  if (!theme) return null
  const at = Number(c.at)
  return { action: c.action, theme, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

export function makeCommand(action, theme, now = Date.now()) {
  return JSON.stringify({ action, theme, at: now })
}

// ---- Fila sequencial e retomável ----

// Processa os blocos um de cada vez (nunca dois ao mesmo tempo no Bluetooth).
// - tiles: blocos que faltam; process(tile) -> Promise (baixar, converter, enviar);
// - onDone(tile): bloco entregue (salvar o progresso); onFail(tile, err, tries);
// - shouldStop(): pedido para parar (pausar/apagar/trocar de tema);
// - wait(ms) -> Promise: pausa entre blocos e antes de tentar de novo.
// Um bloco que falha MAX_TRIES vezes seguidas para a fila (status 'paused'), para
// não ficar martelando um relógio longe. Devolve Promise<{ status, done, error }>.
// Como o progresso fica salvo em onDone, rodar de novo continua de onde parou.
export function runQueue({ tiles, process, onDone, onFail, shouldStop, wait, maxTries = MAX_TRIES, gapMs = 150, retryMs = 2000 }) {
  const list = Array.isArray(tiles) ? tiles.slice() : []
  const sleep = typeof wait === 'function' ? wait : () => Promise.resolve()
  const stop = typeof shouldStop === 'function' ? shouldStop : () => false
  let done = 0
  const step = (index, tries) => {
    if (stop()) return Promise.resolve({ status: 'stopped', done, error: '' })
    if (index >= list.length) return Promise.resolve({ status: 'finished', done, error: '' })
    const tile = list[index]
    let p
    try {
      p = Promise.resolve(process(tile))
    } catch (e) {
      p = Promise.reject(e)
    }
    return p.then(
      () => {
        done++
        if (onDone) onDone(tile)
        return sleep(gapMs).then(() => step(index + 1, 0))
      },
      (err) => {
        const n = tries + 1
        if (onFail) onFail(tile, err, n)
        if (n >= maxTries) return { status: 'failed', done, error: err && err.message ? String(err.message) : String(err) }
        return sleep(retryMs).then(() => step(index, n))
      }
    )
  }
  return step(0, 0)
}

// ---- Parâmetros de cada arquivo enviado ao relógio (TransferFile) ----

// O que vai junto de cada bloco (strings, para passar pelo Bluetooth sem surpresa).
export function tileParams(theme, tile, total) {
  return { kind: 'cob-tile', theme, i: String(tile.i), k: String(Math.round(tile.k)), x: String(tile.x), y: String(tile.y), n: String(total), name: tile.name }
}

// No relógio: params recebidos -> { theme, i, k, x, y, total, name } ou null.
export function parseTileParams(p) {
  if (!p || typeof p !== 'object' || p.kind !== 'cob-tile' || !isTheme(p.theme)) return null
  const int = (v, max) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null
  }
  const i = int(p.i, 9999)
  const k = int(p.k, 5000)
  const x = int(p.x, 999)
  const y = int(p.y, 999)
  const total = int(p.n, 10000)
  if ([i, k, x, y, total].some((v) => v === null) || i >= total) return null
  return { theme: p.theme, i, k, x, y, total }
}

// ---- Aviso "Baixar o mapa de BH?" no relógio ----

// prompt: { choice: 'later' | 'yes', at } guardado no relógio.
// Mostra se o mapa do tema não está pronto, ninguém pediu para baixar e o
// "Agora não" já passou de PROMPT_SNOOZE_MS.
export function shouldPrompt({ ready, prompt, phoneStatus, now = Date.now() }) {
  if (ready) return false
  if (phoneStatus === STATUS.DOWNLOADING || phoneStatus === STATUS.PAUSED || phoneStatus === STATUS.READY) return false
  if (!prompt || typeof prompt !== 'object') return true
  if (prompt.choice === 'yes') return phoneStatus === STATUS.NONE && now - (Number(prompt.at) || 0) > PROMPT_SNOOZE_MS
  if (prompt.choice === 'later') return now - (Number(prompt.at) || 0) > PROMPT_SNOOZE_MS
  return true
}
