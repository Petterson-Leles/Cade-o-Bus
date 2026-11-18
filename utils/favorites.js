// Favoritos = pontos de ônibus que você cadastra nas configurações do app
// (no app Zepp do celular). Cada um: { id, name, line, lat, lon } e, quando o
// ponto foi escolhido na lista do GTFS, também dir (sentido 0/1) e stopId.
// Na ida ao relógio o side service acrescenta street (rua do ponto abreviada).
// Sem APIs do Zepp OS: roda no relógio, no celular e nos testes do Node.
import { normalizeThemeName, readThemeName } from './colors.js'

export const FAVORITES_KEY = 'favorites'
// Interruptor "Vibrar no relógio" (settingsStorage: '0' desliga; padrão ligado).
export const VIBRATE_KEY = 'vibrate'
export const MAX_TEXT_LEN = 30
export const MAX_STREET_LEN = 48

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().slice(0, MAX_TEXT_LEN)
}

function cleanCoord(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const n = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(n) ? String(n) : null
}

// Sentido do GTFS (direction_id): só 0 ou 1.
function cleanDir(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null
  const n = Number(value)
  return n === 0 || n === 1 ? n : null
}

// stop_id do GTFS: letras, números, "_" e "-" (até 30).
function cleanStopId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const v = String(value).trim()
  return /^[A-Za-z0-9_-]{1,30}$/.test(v) ? v : ''
}

// Mantém só itens utilizáveis e corta nome e linha em MAX_TEXT_LEN caracteres.
export function sanitizeFavorites(list) {
  if (!Array.isArray(list)) return []
  const out = []
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const name = cleanText(item.name)
    const line = cleanText(item.line)
    const lat = cleanCoord(item.lat)
    const lon = cleanCoord(item.lon)
    if (!name || !line || lat === null || lon === null) return
    const fav = { name, line, lat, lon }
    if (typeof item.id === 'string' && item.id) fav.id = item.id
    const dir = cleanDir(item.dir)
    if (dir !== null) fav.dir = dir
    const stopId = cleanStopId(item.stopId)
    if (stopId) fav.stopId = stopId
    // Nome do ponto abreviado, acrescentado pelo side service (não é salvo no celular).
    const street = typeof item.street === 'string' ? item.street.trim().slice(0, MAX_STREET_LEN) : ''
    if (street) fav.street = street
    out.push(fav)
  })
  return out
}

export function readFavorites(storage) {
  try {
    const raw = storage.getItem(FAVORITES_KEY)
    return sanitizeFavorites(raw ? JSON.parse(raw) : [])
  } catch (e) {
    return []
  }
}

export function writeFavorites(storage, list) {
  storage.setItem(FAVORITES_KEY, JSON.stringify(sanitizeFavorites(list)))
}

export function newFavoriteId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 1e9).toString(36)}`
}

function sameContent(a, b) {
  return a.name === b.name && a.line === b.line && a.lat === b.lat && a.lon === b.lon &&
    a.dir === b.dir && a.stopId === b.stopId
}

// Remove um favorito: pelo id ou, nos antigos sem id, pelo conteúdo (só o primeiro igual).
export function removeFavorite(list, target) {
  const index = target && target.id
    ? list.findIndex((f) => f.id === target.id)
    : list.findIndex((f) => !f.id && sameContent(f, target))
  return index < 0 ? list.slice() : list.filter((_, i) => i !== index)
}

export function readVibrate(storage) {
  try {
    return storage.getItem(VIBRATE_KEY) !== '0'
  } catch (e) {
    return true
  }
}

export function writeVibrate(storage, on) {
  storage.setItem(VIBRATE_KEY, on ? '1' : '0')
}

// O que o celular manda ao relógio (GET_FAVORITES e SETTINGS_CHANGED).
export function settingsPayload(storage) {
  return { favorites: readFavorites(storage), theme: readThemeName(storage), vibrate: readVibrate(storage) }
}

// Lê a resposta no relógio. Aceita o formato antigo (só a lista de favoritos):
// nesse caso o tema fica o atual (fallbackTheme). vibrate: padrão ligado
// (ou fallbackVibrate, quando a resposta não traz).
export function parseSettingsResult(result, fallbackTheme, fallbackVibrate = true) {
  const vib = fallbackVibrate !== false
  if (Array.isArray(result)) {
    return { favorites: sanitizeFavorites(result), theme: normalizeThemeName(fallbackTheme), vibrate: vib }
  }
  if (!result || typeof result !== 'object') {
    return { favorites: [], theme: normalizeThemeName(fallbackTheme), vibrate: vib }
  }
  return {
    favorites: sanitizeFavorites(result.favorites),
    theme: normalizeThemeName(result.theme === undefined ? fallbackTheme : result.theme),
    vibrate: typeof result.vibrate === 'boolean' ? result.vibrate : vib
  }
}

// Params da tela de detalhe: JSON de { fav, theme }. Aceita também o favorito puro
// (formato antigo). fav fica null se o ponto não for utilizável.
export function parseDetailParams(params) {
  let data = null
  try {
    data = typeof params === 'string' ? JSON.parse(params) : params
  } catch (e) {
    data = null
  }
  if (!data || typeof data !== 'object') return { fav: null, theme: normalizeThemeName(null), vibrate: true }
  const raw = data.fav && typeof data.fav === 'object' ? data.fav : data
  const fav = sanitizeFavorites([raw])[0] || null
  return { fav, theme: normalizeThemeName(data.theme), vibrate: data.vibrate !== false }
}
