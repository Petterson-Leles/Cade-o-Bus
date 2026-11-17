// Resumo da tela inicial (próximo ônibus de cada ponto salvo), cache do feed e
// nomes de rua dos favoritos. Lógica pura, testada em test/summary.test.mjs.
import { stopById } from './gtfs.js'
import { abbreviateStreet } from './text.js'

// Chave de um favorito no resumo: o id ou, nos antigos sem id, a posição.
export function favoriteKey(fav, index) {
  return fav && typeof fav.id === 'string' && fav.id ? fav.id : `#${index}`
}

// favorites: lista sanitizada; etaFor(fav) -> minutos do próximo ônibus ou null.
// Erro num ponto vira null só nele. Devolve [{ key, eta }].
export function summarizeEtas(favorites, etaFor) {
  return (Array.isArray(favorites) ? favorites : []).map((fav, i) => {
    let eta = null
    try {
      const v = etaFor(fav, i)
      eta = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
    } catch (e) {
      eta = null
    }
    return { key: favoriteKey(fav, i), eta }
  })
}

// No relógio: minutos do favorito na resposta do resumo (ou null).
export function etaFromSummary(result, fav, index) {
  const items = result && Array.isArray(result.items) ? result.items : []
  const key = favoriteKey(fav, index)
  const item = items.find((it) => it && it.key === key)
  if (!item || typeof item.eta !== 'number' || !Number.isFinite(item.eta) || item.eta < 0 || item.eta > 999) return null
  return Math.round(item.eta)
}

// Acrescenta `street` (nome do ponto abreviado, do GTFS) a cada favorito com stopId.
export function withStreets(favorites, index) {
  return (Array.isArray(favorites) ? favorites : []).map((fav) => {
    if (!fav || !fav.stopId) return fav
    const stop = stopById(index, fav.stopId)
    return stop && stop.name ? { ...fav, street: abbreviateStreet(stop.name) } : fav
  })
}

// Um download do feed serve vários pedidos: guarda o resultado por ttlMs e
// junta pedidos simultâneos na mesma promessa. Falha não fica guardada.
export function createFeedCache(load, ttlMs, clock = () => Date.now()) {
  let value = null
  let at = 0
  let pending = null
  return {
    get() {
      if (value !== null && clock() - at <= ttlMs) return Promise.resolve(value)
      if (pending) return pending
      pending = Promise.resolve()
        .then(load)
        .then(
          (v) => {
            value = v
            at = clock()
            pending = null
            return v
          },
          (e) => {
            pending = null
            throw e
          }
        )
      return pending
    }
  }
}
