// Favoritos = pontos de ônibus que você cadastra nas configurações do app
// (no app Zepp do celular). Cada um: { name, line, lat, lon }.
export const FAVORITES_KEY = 'favorites'

export function readFavorites(storage) {
  try {
    const raw = storage.getItem(FAVORITES_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

export function writeFavorites(storage, list) {
  storage.setItem(FAVORITES_KEY, JSON.stringify(list))
}
