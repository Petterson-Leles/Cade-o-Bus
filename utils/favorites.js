// Favoritos = pontos de ônibus que você cadastra nas configurações do app
// (no app Zepp do celular). Cada um: { id, name, line, lat, lon }.
// Sem APIs do Zepp OS: roda no relógio, no celular e nos testes do Node.
export const FAVORITES_KEY = 'favorites'
export const MAX_TEXT_LEN = 30

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().slice(0, MAX_TEXT_LEN)
}

function cleanCoord(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const n = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(n) ? String(n) : null
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
  return a.name === b.name && a.line === b.line && a.lat === b.lat && a.lon === b.lon
}

// Remove um favorito: pelo id ou, nos antigos sem id, pelo conteúdo (só o primeiro igual).
export function removeFavorite(list, target) {
  const index = target && target.id
    ? list.findIndex((f) => f.id === target.id)
    : list.findIndex((f) => !f.id && sameContent(f, target))
  return index < 0 ? list.slice() : list.filter((_, i) => i !== index)
}
