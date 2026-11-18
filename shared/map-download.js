// Mapa de BH (celular -> relógio): o que o celular sabe do cache do relógio (guardado
// no settingsStorage, para a tela de configurações), o comando "Limpar mapa do
// relógio" e os parâmetros de cada bloco enviado.
// Lógica pura (sem APIs do Zepp OS), testada em test/map-download.test.mjs.
// O envio sob demanda (quais blocos, prioridade, LRU) fica em shared/map-demand.js.
import { MAP_THEMES, normalizeBits, countBits } from './map-tiles.js'

// settingsStorage (celular): estado por tema, manifesto em cache e o último comando.
export const MAP_STATE_KEY = 'mapDownload'
export const MAP_MANIFEST_KEY = 'mapManifest'
export const MAP_COMMAND_KEY = 'mapCommand'
// Cache do celular (blocos já convertidos): shared/map-demand.js cleanPhoneCache.
export const MAP_PHONE_CACHE_KEY = 'mapPhoneCache'

const isTheme = (t) => MAP_THEMES.indexOf(t) >= 0

export function emptyThemeState() {
  // have/total: bits do que o relógio diz ter; deleting: apagar no relógio na próxima conexão.
  return { done: 0, total: 0, have: '', deleting: false, updatedAt: 0 }
}

// Estado de um tema (sempre um objeto completo e coerente).
export function cleanThemeState(raw) {
  const s = emptyThemeState()
  if (!raw || typeof raw !== 'object') return s
  s.total = Number.isInteger(raw.total) && raw.total >= 0 && raw.total <= 10000 ? raw.total : 0
  s.have = normalizeBits(raw.have, s.total)
  s.done = countBits(s.have, s.total)
  // Formato antigo: status 'deleting'.
  s.deleting = raw.deleting === true || raw.status === 'deleting'
  s.updatedAt = Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : 0
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

// O relógio é quem manda no que tem (ele apaga blocos velhos do cache LRU).
export function applyWatchBits(state, watchHex, total, now = Date.now()) {
  const s = cleanThemeState(state)
  const n = Number.isInteger(total) && total > 0 ? total : s.total
  const have = normalizeBits(watchHex, n)
  return { ...s, total: n, have, done: countBits(have, n), updatedAt: now }
}

// Blocos guardados no relógio (somando os temas).
export function storedCount(states) {
  return MAP_THEMES.reduce((sum, t) => sum + (states && states[t] ? cleanThemeState(states[t]).done : 0), 0)
}

// Texto da tela de configurações.
export function storedText(states) {
  const s = MAP_THEMES.map((t) => cleanThemeState(states && states[t]))
  if (s.some((x) => x.deleting)) return 'Limpando: abra o Cadê o Busão no relógio'
  const n = storedCount(states)
  return `Ruas aparecem conforme você usa · ${n} ${n === 1 ? 'bloco guardado' : 'blocos guardados'} no relógio`
}

// "Limpar" na tela de configurações: marca na hora (o serviço do celular pode estar parado).
export function markDeleting(states, now = Date.now()) {
  const out = {}
  MAP_THEMES.forEach((t) => {
    const s = cleanThemeState(states && states[t])
    out[t] = s.done > 0 || s.total > 0 ? { ...s, deleting: true, updatedAt: now } : s
  })
  return out
}

// ---- Comandos (tela de configurações -> side service, pelo settingsStorage) ----

export const COMMANDS = ['delete']

// { action, theme, at } ou null.
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
  const theme = c.theme === 'all' ? 'all' : isTheme(c.theme) ? c.theme : null
  if (!theme) return null
  const at = Number(c.at)
  return { action: c.action, theme, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

export function makeCommand(action, theme, now = Date.now()) {
  return JSON.stringify({ action, theme, at: now })
}

// ---- Parâmetros de cada arquivo enviado ao relógio (TransferFile) ----

// O que vai junto de cada bloco (strings, para passar pelo Bluetooth sem surpresa).
export function tileParams(theme, tile, total) {
  return { kind: 'cob-tile', theme, i: String(tile.i), k: String(Math.round(tile.k)), x: String(tile.x), y: String(tile.y), n: String(total), name: tile.name }
}

// No relógio: params recebidos -> { theme, i, k, x, y, total } ou null.
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
