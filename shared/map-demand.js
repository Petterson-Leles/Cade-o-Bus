// Mapa sob demanda: o celular guarda os blocos e o relógio só "espelha" o pedaço que
// está na tela. Lógica pura (sem APIs do Zepp OS), testada em test/map-demand.test.mjs:
// - quais blocos cobrem a vista e quais faltam no relógio (mesma projeção do relógio,
//   shared/map-tiles.js tilesForView);
// - vizinhos e níveis adjacentes para pré-enviar com baixa prioridade;
// - fila com prioridade do celular (a vista atual sempre na frente);
// - cache LRU do relógio (limite de blocos por tema);
// - parâmetros que o relógio manda junto do GET_BUSES (o que ele tem, em bits).
import { MAP_THEMES, tilesForView, globalPixel, hasBit, setBit, normalizeBits, countBits, tileFileName } from './map-tiles.js'

// No máximo tantos blocos por tema guardados no relógio (~8–10 KB cada: ~1 MB).
export const WATCH_TILE_LIMIT = 120
// Apaga no máximo tantos de uma vez (cada um é um rmSync no relógio).
export const MAX_EVICT_PER_CALL = 8
// Bloco enviado há menos que isso não é reenviado, mesmo que o relógio ainda não o
// conte (pode estar a caminho). Depois disso vale o que o relógio diz ter.
export const SENT_TTL_MS = 60 * 1000
// Relógio: com blocos da vista faltando, relê o que chegou a cada tanto e desiste
// depois de um tempo (a próxima atualização de 30 s pede de novo).
export const DEMAND_POLL_MS = 1500
export const DEMAND_POLL_MAX_MS = 60 * 1000
// Fila do celular: tamanho máximo e quantos blocos de pré-envio por pedido.
export const DEMAND_QUEUE_MAX = 40
export const MAX_PREFETCH = 8
// Prioridades (menor = antes).
export const PRIO = Object.freeze({ VIEW: 0, NEAR: 1, LEVEL: 2 })

const isTheme = (t) => MAP_THEMES.indexOf(t) >= 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Etiqueta do manifesto (versão curta): muda quando o mapa publicado muda.
export function manifestTag(compact) {
  return compact ? `${compact.v}:${compact.g}` : ''
}

// ---- Parâmetros do relógio (junto do GET_BUSES) ----

// { theme, have (hex do tema), r (raio do mapa em px físicos), scale (px físicos por
// px de design), mv (etiqueta do manifesto que o relógio tem) }.
export function buildDemandParams({ theme, have, r, scale, mv }) {
  return { theme, have: typeof have === 'string' ? have : '', r: Math.round(Number(r) || 0), scale: Math.round((Number(scale) || 1) * 10000) / 10000, mv: mv || '' }
}

export function parseDemandParams(p) {
  if (!p || typeof p !== 'object' || !isTheme(p.theme)) return null
  const r = Number(p.r)
  const scale = Number(p.scale)
  const have = typeof p.have === 'string' && /^[0-9a-f]*$/i.test(p.have) && p.have.length <= 2500 ? p.have.toLowerCase() : ''
  return {
    theme: p.theme,
    have,
    r: r >= 20 && r <= 1000 ? r : 0,
    scale: scale > 0.2 && scale <= 5 ? scale : 1,
    mv: typeof p.mv === 'string' ? p.mv.slice(0, 40) : ''
  }
}

// ---- Blocos da vista ----

// Blocos que cobrem o círculo de raio r (px físicos) em volta de center ({ lat, lon })
// no nível `level`: [{ i, level, x, y }].
export function viewTiles({ compact, theme, level, center, r }) {
  return tilesForView({ compact, theme, level, center, cx: 0, cy: 0, r }).map((t) => ({ i: t.i, level, x: t.tx, y: t.ty }))
}

// Contagem de blocos de uma lista (da vista) que o relógio ainda não tem.
export function pendingCount(list, have) {
  return (Array.isArray(list) ? list : []).filter((t) => !hasBit(have, t.i)).length
}

// O relógio precisa deste bloco? (não tem e não foi mandado há pouco)
export function needsTile(i, have, sentAt, now = Date.now(), ttl = SENT_TTL_MS) {
  if (hasBit(have, i)) return false
  const t = sentAt && sentAt[i]
  return !(t && now - t < ttl)
}

// Plano de envio para uma vista: primeiro os blocos da vista que faltam (PRIO.VIEW),
// depois (prefetch) os vizinhos do mesmo nível, mais perto primeiro (PRIO.NEAR), e os
// da mesma vista nos níveis vizinhos (PRIO.LEVEL), até maxPrefetch.
// - r: raio do mapa em px físicos (o celular usa uma folga de 2 px: nunca falta um
//   bloco que o relógio desenha por diferença de arredondamento);
// - have: bits do relógio; sentAt: { i: quando foi enviado }.
export function demandPlan({ compact, theme, level, center, r, have = '', sentAt = null, now = Date.now(), prefetch = true, maxPrefetch = MAX_PREFETCH }) {
  const levels = compact && compact.levels && compact.levels[theme]
  if (!levels || !levels[level] || !center || !(r > 0)) return []
  const need = (i) => needsTile(i, have, sentAt, now)
  const seen = new Set()
  const out = []
  viewTiles({ compact, theme, level, center, r: r + 2 }).forEach((t) => {
    seen.add(t.i)
    if (need(t.i)) out.push({ ...t, prio: PRIO.VIEW })
  })
  if (!prefetch || maxPrefetch <= 0) return out
  const extra = []
  // Vizinhos no mesmo nível: anel de ~3/4 de bloco em volta da vista.
  const ts = compact.ts
  const L = levels[level]
  const [gx, gy] = globalPixel(compact, L.k, center.lat, center.lon)
  viewTiles({ compact, theme, level, center, r: r + 2 + Math.round(ts * 0.75) })
    .filter((t) => !seen.has(t.i))
    .map((t) => ({ t, d: Math.hypot((t.x + 0.5) * ts - gx, (t.y + 0.5) * ts - gy) }))
    .sort((a, b) => a.d - b.d || a.t.i - b.t.i)
    .forEach(({ t }) => {
      seen.add(t.i)
      if (need(t.i)) extra.push({ ...t, prio: PRIO.NEAR })
    })
  // Mesma vista nos níveis vizinhos (a coroa costuma ir um passo para cada lado).
  ;[level + 1, level - 1].forEach((l) => {
    if (!levels[l]) return
    viewTiles({ compact, theme, level: l, center, r: r + 2 }).forEach((t) => {
      if (seen.has(t.i)) return
      seen.add(t.i)
      if (need(t.i)) extra.push({ ...t, prio: PRIO.LEVEL })
    })
  })
  extra.sort((a, b) => a.prio - b.prio)
  return out.concat(extra.slice(0, maxPrefetch))
}

// ---- Fila com prioridade (celular) ----

const qKey = (q) => `${q.theme}:${q.i}`

// Junta itens novos à fila: um item por bloco, com a menor prioridade pedida; os do
// pedido mais novo (seq maior) vêm antes dos antigos de mesma prioridade. Corta em max
// (os de menor prioridade saem).
export function enqueueDemand(queue, items, { theme, seq = 0, max = DEMAND_QUEUE_MAX } = {}) {
  const byKey = new Map()
  ;(Array.isArray(queue) ? queue : []).forEach((q, n) => byKey.set(qKey(q), { ...q, n }))
  let n = byKey.size
  ;(Array.isArray(items) ? items : []).forEach((it) => {
    const item = { theme: it.theme || theme, i: it.i, level: it.level, x: it.x, y: it.y, prio: isNum(it.prio) ? it.prio : PRIO.VIEW, seq, n: n++ }
    if (!isTheme(item.theme) || !Number.isInteger(item.i)) return
    const old = byKey.get(qKey(item))
    if (!old || item.prio <= old.prio) byKey.set(qKey(item), item)
  })
  return Array.from(byKey.values())
    .sort((a, b) => a.prio - b.prio || b.seq - a.seq || a.n - b.n)
    .slice(0, max)
    .map(({ n: _n, ...q }) => q) // eslint-disable-line no-unused-vars
}

// Próximo da fila: { item, rest } (item null com a fila vazia).
export function takeNext(queue) {
  const list = Array.isArray(queue) ? queue : []
  return { item: list[0] || null, rest: list.slice(1) }
}

// Tira da fila os blocos de um tema (apagado) ou todos.
export function dropTheme(queue, theme) {
  return (Array.isArray(queue) ? queue : []).filter((q) => theme !== 'all' && q.theme !== theme)
}

// ---- Cache LRU do relógio ----

// Lista de índices, o usado há mais tempo primeiro. Aceita texto ou array.
export function cleanLru(raw, total) {
  let list = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch (e) {
      list = null
    }
  }
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  list.forEach((i) => {
    if (Number.isInteger(i) && i >= 0 && i < total && !seen.has(i)) {
      seen.add(i)
      out.push(i)
    }
  })
  return out
}

// Marca os blocos como usados agora (vão para o fim, na ordem dada).
export function lruTouch(lru, indices) {
  const touch = (Array.isArray(indices) ? indices : []).filter(Number.isInteger)
  const set = new Set(touch)
  return (Array.isArray(lru) ? lru : []).filter((i) => !set.has(i)).concat(Array.from(set))
}

// Blocos a apagar para ficar em `limit`: primeiro os que o relógio tem mas não estão
// na lista (de antes do LRU), depois os usados há mais tempo. Nunca os de `keep`.
// Devolve { evict: [i], lru (sem os apagados), have (sem os apagados) }.
export function lruEvict({ lru, have, total, limit = WATCH_TILE_LIMIT, keep = [], maxEvict = MAX_EVICT_PER_CALL }) {
  const bits = normalizeBits(have, total)
  const list = cleanLru(lru, total)
  const excess = countBits(bits, total) - limit
  if (excess <= 0) return { evict: [], lru: list, have: bits }
  const protect = new Set(Array.isArray(keep) ? keep : [])
  const inList = new Set(list)
  const candidates = []
  for (let i = 0; i < total; i++) if (hasBit(bits, i) && !inList.has(i) && !protect.has(i)) candidates.push(i)
  list.forEach((i) => {
    if (hasBit(bits, i) && !protect.has(i)) candidates.push(i)
  })
  const evict = candidates.slice(0, Math.min(excess, maxEvict))
  const gone = new Set(evict)
  let out = bits
  evict.forEach((i) => {
    out = setBit(out, i, false)
  })
  return { evict, lru: list.filter((i) => !gone.has(i)), have: out }
}

// ---- Cache do celular (blocos já baixados e convertidos em data://download/) ----

// O side service não tem API de arquivos: o celular anota num mapa de bits por tema
// quais blocos já converteu (vale para uma etiqueta de manifesto).
export function cleanPhoneCache(raw, tag, totals) {
  let c = raw
  if (typeof raw === 'string') {
    try {
      c = JSON.parse(raw)
    } catch (e) {
      c = null
    }
  }
  const out = { tag: tag || '', themes: {} }
  const same = c && typeof c === 'object' && c.tag === out.tag
  MAP_THEMES.forEach((t) => {
    const n = totals && totals[t] > 0 ? totals[t] : 0
    if (n > 0) out.themes[t] = normalizeBits(same && c.themes ? c.themes[t] : '', n)
  })
  return out
}

// Caminho do bloco convertido no celular.
export function phoneTilePath(theme, k, x, y) {
  return `data://download/cob-c-${tileFileName(theme, k, x, y)}`
}

// ---- Pré-cache no celular em volta dos pontos salvos ----

// Blocos (da lista do manifesto) a até `km` de algum ponto, mais perto primeiro,
// todos os níveis; corta em max.
export function tilesNearPoints(tiles, manifest, points, km = 1, max = 60) {
  if (!manifest || !manifest.projection) return []
  const p = manifest.projection
  const ts = manifest.tileSize
  const kx = p.mPerDeg * Math.cos((p.latRef * Math.PI) / 180)
  const pts = (Array.isArray(points) ? points : [])
    .map((q) => [Number(q && q.lat), Number(q && q.lon)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .map(([lat, lon]) => [(lon - p.originLon) * kx, (p.originLat - lat) * p.mPerDeg])
  if (pts.length === 0) return []
  const out = []
  ;(Array.isArray(tiles) ? tiles : []).forEach((t) => {
    // Distância do ponto ao retângulo do bloco (metros).
    const size = (ts * 1000) / t.k
    const x0 = t.x * size
    const y0 = t.y * size
    let best = Infinity
    pts.forEach(([px, py]) => {
      const dx = Math.max(x0 - px, 0, px - (x0 + size))
      const dy = Math.max(y0 - py, 0, py - (y0 + size))
      best = Math.min(best, Math.hypot(dx, dy))
    })
    if (best <= km * 1000) out.push({ t, d: best })
  })
  return out
    .sort((a, b) => a.d - b.d || a.t.level - b.t.level || a.t.i - b.t.i)
    .slice(0, max)
    .map((o) => o.t)
}
