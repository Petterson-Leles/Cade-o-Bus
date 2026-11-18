// Mapa de BH em blocos (tiles) de imagem: manifesto, lista de blocos, mapa de
// bits do que já chegou ao relógio e quais blocos cobrem o círculo do mini mapa.
// Lógica pura (sem APIs do Zepp OS), testada em test/map-tiles.test.mjs.
//
// Os blocos são PNGs de 256 px publicados em MAP_BASE_URL (manifest.json):
// projeção equiretangular com origem no canto noroeste de BH,
//   x = (lon - origin.lon) * mPerDeg * cos(latRef) * pxPerKm / 1000
//   y = (origin.lat - lat) * mPerDeg * pxPerKm / 1000
// e três níveis (40, 80 e 160 px por km), cada um com cols x rows blocos.
// No relógio 1 px do bloco = 1 px físico da tela (sem esticar a imagem).

export const MAP_BASE_URL = 'https://raw.githubusercontent.com/Petterson-Leles/cade-o-bus-mapa/main/'
export const MAP_MANIFEST_URL = MAP_BASE_URL + 'manifest.json'
export const MAP_THEMES = ['dark', 'light']
export const MAP_ATTRIBUTION = 'Mapa © colaboradores do OpenStreetMap'
// Pasta do app no relógio onde os blocos ficam (data:// = /data do app, Zepp OS 3+:
// https://docs.zepp.com/docs/guides/framework/device/fs/).
export const WATCH_MAP_DIR = 'map'
const MAX_LEVELS = 6
const MAX_DIM = 64

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

function cleanLevel(l) {
  if (!l || typeof l !== 'object') return null
  const k = Number(l.pxPerKm)
  const cols = Number(l.cols)
  const rows = Number(l.rows)
  if (!(k >= 5 && k <= 2000) || !isInt(cols, 1, MAX_DIM) || !isInt(rows, 1, MAX_DIM)) return null
  const path = typeof l.path === 'string' && /^[A-Za-z0-9_./{}-]+$/.test(l.path) && l.path.indexOf('..') < 0 ? l.path : null
  return {
    pxPerKm: k,
    cols,
    rows,
    path,
    bytes: isNum(l.bytes) && l.bytes >= 0 ? Math.round(l.bytes) : 0,
    count: cols * rows
  }
}

// manifest.json publicado -> manifesto validado ou null.
export function parseManifest(raw) {
  let m = raw
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw)
    } catch (e) {
      return null
    }
  }
  if (!m || typeof m !== 'object' || !m.projection || !m.themes) return null
  const p = m.projection
  const origin = p.origin || {}
  const proj = {
    mPerDeg: Number(p.mPerDeg) || 111320,
    latRef: Number(p.latRef),
    originLat: Number(origin.lat),
    originLon: Number(origin.lon)
  }
  if (![proj.latRef, proj.originLat, proj.originLon].every(isNum)) return null
  const tileSize = Number(m.tileSize)
  if (!isInt(tileSize, 16, 1024)) return null
  const themes = {}
  MAP_THEMES.forEach((name) => {
    const t = m.themes[name]
    if (!t || !Array.isArray(t.levels)) return
    const levels = t.levels.slice(0, MAX_LEVELS).map(cleanLevel)
    if (levels.length === 0 || levels.some((l) => !l || !l.path)) return
    levels.sort((a, b) => a.pxPerKm - b.pxPerKm)
    const bytes = isNum(t.bytes) ? Math.round(t.bytes) : levels.reduce((s, l) => s + l.bytes, 0)
    themes[name] = { levels, bytes, count: levels.reduce((s, l) => s + l.count, 0) }
  })
  if (Object.keys(themes).length === 0) return null
  return {
    version: isNum(Number(m.version)) ? Number(m.version) : 1,
    generated: typeof m.generated === 'string' ? m.generated.slice(0, 20) : '',
    projection: proj,
    tileSize,
    themes,
    attribution: typeof m.attribution === 'string' ? m.attribution.slice(0, 80) : ''
  }
}

// Versão curta do manifesto que vai para o relógio (só o que o desenho precisa).
export function compactManifest(manifest) {
  if (!manifest) return null
  const levels = {}
  Object.keys(manifest.themes).forEach((name) => {
    levels[name] = manifest.themes[name].levels.map((l) => ({ k: l.pxPerKm, c: l.cols, r: l.rows }))
  })
  const p = manifest.projection
  return { v: manifest.version, g: manifest.generated, m: p.mPerDeg, lr: p.latRef, oa: p.originLat, oo: p.originLon, ts: manifest.tileSize, levels }
}

// Valida a versão curta no relógio (veio por mensagem/armazenamento): objeto ou null.
export function parseCompactManifest(c) {
  if (!c || typeof c !== 'object') return null
  if (![c.m, c.lr, c.oa, c.oo].every(isNum) || !isInt(c.ts, 16, 1024) || !c.levels || typeof c.levels !== 'object') return null
  const levels = {}
  MAP_THEMES.forEach((name) => {
    const list = c.levels[name]
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_LEVELS) return
    const ok = list.every((l) => l && l.k >= 5 && l.k <= 2000 && isInt(l.c, 1, MAX_DIM) && isInt(l.r, 1, MAX_DIM))
    if (ok) levels[name] = list.map((l) => ({ k: Number(l.k), c: l.c, r: l.r })).sort((a, b) => a.k - b.k)
  })
  if (Object.keys(levels).length === 0) return null
  return { v: isNum(c.v) ? c.v : 1, g: typeof c.g === 'string' ? c.g : '', m: c.m, lr: c.lr, oa: c.oa, oo: c.oo, ts: c.ts, levels }
}

// Total de blocos de um tema (versão curta).
export function compactTotal(compact, theme) {
  const list = compact && compact.levels && compact.levels[theme]
  return Array.isArray(list) ? list.reduce((s, l) => s + l.c * l.r, 0) : 0
}

// Nome do arquivo do bloco (o mesmo no celular e no relógio).
export function tileFileName(theme, k, x, y) {
  return `${theme}-${Math.round(k)}-${x}_${y}.png`
}

// Caminho do bloco no relógio (src do IMG).
export function watchTilePath(theme, k, x, y) {
  return `data://${WATCH_MAP_DIR}/${tileFileName(theme, k, x, y)}`
}

// Lista de blocos de um tema, na ordem dos níveis (40, 80, 160) e linha a linha.
// i = índice global (posição no mapa de bits). [{ i, level, k, x, y, url, name }]
export function tileList(manifest, theme) {
  const t = manifest && manifest.themes && manifest.themes[theme]
  if (!t) return []
  const out = []
  t.levels.forEach((l, level) => {
    for (let y = 0; y < l.rows; y++) {
      for (let x = 0; x < l.cols; x++) {
        out.push({
          i: out.length,
          level,
          k: l.pxPerKm,
          x,
          y,
          url: MAP_BASE_URL + l.path.replace('{theme}', theme).replace('{K}', String(l.pxPerKm)).replace('{x}', String(x)).replace('{y}', String(y)),
          name: tileFileName(theme, l.pxPerKm, x, y)
        })
      }
    }
  })
  return out
}

// Índice global do bloco (x, y) do nível `level` (versão curta ou levels do manifesto).
export function tileIndex(levels, level, x, y) {
  let i = 0
  for (let l = 0; l < level; l++) i += levels[l].c * levels[l].r
  return i + y * levels[level].c + x
}

// ---- Mapa de bits (o que já chegou), em hexadecimal: 400 blocos = 100 caracteres ----

export function emptyBits(n) {
  return '0'.repeat(Math.ceil(Math.max(0, n) / 4))
}

// Normaliza para n bits: aceita só hexadecimal; corta ou completa com zeros.
export function normalizeBits(hex, n) {
  const len = Math.ceil(Math.max(0, n) / 4)
  const clean = typeof hex === 'string' && /^[0-9a-f]*$/i.test(hex) ? hex.toLowerCase() : ''
  return (clean + '0'.repeat(len)).slice(0, len)
}

export function hasBit(hex, i) {
  if (typeof hex !== 'string' || i < 0) return false
  const d = parseInt(hex.charAt(i >> 2), 16)
  return Number.isFinite(d) && ((d >> (3 - (i & 3))) & 1) === 1
}

export function setBit(hex, i, on = true) {
  const pos = i >> 2
  if (typeof hex !== 'string' || i < 0 || pos >= hex.length) return hex
  const d = parseInt(hex.charAt(pos), 16) || 0
  const mask = 1 << (3 - (i & 3))
  const v = on ? d | mask : d & ~mask
  return hex.slice(0, pos) + v.toString(16) + hex.slice(pos + 1)
}

export function countBits(hex, n) {
  let c = 0
  for (let i = 0; i < n; i++) if (hasBit(hex, i)) c++
  return c
}

// União de dois mapas de bits de n blocos.
export function mergeBits(a, b, n) {
  let out = emptyBits(n)
  for (let i = 0; i < n; i++) if (hasBit(a, i) || hasBit(b, i)) out = setBit(out, i)
  return out
}

// ---- Níveis de zoom ----

// Níveis do tema em px de design por km: o bloco tem px físicos, e px() do
// relógio converte design -> físico multiplicando por `scale` (466/480 no Active 3).
// Ex.: 40 px físicos/km com scale 0,97 = 41,2 px de design/km.
export function designLevels(compact, theme, scale) {
  const list = compact && compact.levels && compact.levels[theme]
  const s = Number(scale) > 0 ? Number(scale) : 1
  return Array.isArray(list) ? list.map((l) => Math.round((l.k / s) * 100) / 100) : []
}

// Nível mais próximo de uma escala qualquer (px/km): índice.
export function nearestLevel(levels, k) {
  let best = 0
  for (let i = 1; i < levels.length; i++) {
    if (Math.abs(Math.log(levels[i] / k)) < Math.abs(Math.log(levels[best] / k))) best = i
  }
  return best
}

// Coroa: acumula os graus e dá um passo de nível a cada `threshold` graus.
// Devolve { steps (inteiro, + aproxima), acc (o que sobrou) }.
export function crownSteps(acc, degree, threshold = 15) {
  const total = (Number(acc) || 0) + (Number(degree) || 0)
  const steps = total >= 0 ? Math.floor(total / threshold) : -Math.floor(-total / threshold)
  return { steps, acc: total - steps * threshold }
}

// Muda de nível (preso aos limites).
export function stepLevel(index, steps, count) {
  const i = Number.isInteger(index) ? index : 0
  return Math.max(0, Math.min(count - 1, i + (Number(steps) || 0)))
}

// ---- Blocos que cobrem o mini mapa ----

// Centro do enquadramento (metros relativos ao ponto, x leste e y sul, como o
// side service manda) -> { lat, lon }. Mesma projeção de shared/route-map.js.
export function centerLatLon(stop, centerM, mPerDeg = 111320) {
  const lat0 = Number(stop.lat)
  const lon0 = Number(stop.lon)
  const cx = centerM && isNum(centerM[0]) ? centerM[0] : 0
  const cy = centerM && isNum(centerM[1]) ? centerM[1] : 0
  return { lat: lat0 - cy / mPerDeg, lon: lon0 + cx / (mPerDeg * Math.cos((lat0 * Math.PI) / 180)) }
}

// (lat, lon) -> pixel global do nível de pxPerKm k (projeção do manifesto).
export function globalPixel(compact, k, lat, lon) {
  const kx = compact.m * Math.cos((compact.lr * Math.PI) / 180)
  return [((lon - compact.oo) * kx * k) / 1000, ((compact.oa - lat) * compact.m * k) / 1000]
}

// Blocos que cobrem o círculo do mapa e onde desenhar cada um, em px físicos da tela.
// - compact/theme/level: versão curta do manifesto, tema e índice do nível;
// - center: { lat, lon } do centro do mapa; cx, cy: centro do mapa na tela; r: raio;
// - box (opcional): retângulo { x, y, w, h } que recorta os blocos (quadrado do mapa).
// Cada item: { tx, ty, i, x, y, w, h, pos_x, pos_y }: o IMG fica em (x, y, w, h)
// (já recortado) e a imagem é deslocada por (pos_x, pos_y) dentro dele.
export function tilesForView({ compact, theme, level, center, cx, cy, r, box = null }) {
  const levels = compact && compact.levels && compact.levels[theme]
  if (!levels || !levels[level] || !center || !(r > 0)) return []
  const L = levels[level]
  const ts = compact.ts
  const [gx, gy] = globalPixel(compact, L.k, center.lat, center.lon)
  // Canto superior esquerdo do mapa global na tela.
  const ox = cx - gx
  const oy = cy - gy
  const clip = box || { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }
  const x0 = Math.max(0, Math.floor((gx - r) / ts))
  const x1 = Math.min(L.c - 1, Math.floor((gx + r) / ts))
  const y0 = Math.max(0, Math.floor((gy - r) / ts))
  const y1 = Math.min(L.r - 1, Math.floor((gy + r) / ts))
  const out = []
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const left = Math.round(ox + tx * ts)
      const top = Math.round(oy + ty * ts)
      // O bloco toca o círculo? (ponto do bloco mais perto do centro)
      const nx = Math.max(left, Math.min(cx, left + ts))
      const ny = Math.max(top, Math.min(cy, top + ts))
      if (Math.hypot(nx - cx, ny - cy) > r) continue
      const x = Math.max(left, Math.round(clip.x))
      const y = Math.max(top, Math.round(clip.y))
      const right = Math.min(left + ts, Math.round(clip.x + clip.w))
      const bottom = Math.min(top + ts, Math.round(clip.y + clip.h))
      if (right <= x || bottom <= y) continue
      out.push({ tx, ty, i: tileIndex(levels, level, tx, ty), x, y, w: right - x, h: bottom - y, pos_x: left - x, pos_y: top - y })
    }
  }
  return out
}

// Ordem de download que deixa o mapa útil logo: primeiro a cidade inteira no
// zoom mais afastado (poucos blocos), depois os blocos perto dos seus pontos
// (mais perto primeiro, todos os níveis), e por último o resto da cidade.
// points: [{ lat, lon }] dos pontos salvos. nearKm: raio "perto".
export function prioritizeTiles(tiles, manifest, points, nearKm = 2.5) {
  const list = Array.isArray(tiles) ? tiles.slice() : []
  if (!manifest || !manifest.projection) return list
  const p = manifest.projection
  const ts = manifest.tileSize
  const kx = p.mPerDeg * Math.cos((p.latRef * Math.PI) / 180)
  const pts = (Array.isArray(points) ? points : [])
    .map((q) => [Number(q && q.lat), Number(q && q.lon)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  // Distância (km) do centro do bloco ao ponto salvo mais perto.
  const dist = (t) => {
    if (pts.length === 0) return 0
    const cx = ((t.x + 0.5) * ts * 1000) / t.k // metros a leste da origem
    const cy = ((t.y + 0.5) * ts * 1000) / t.k // metros ao sul da origem
    let best = Infinity
    pts.forEach(([lat, lon]) => {
      const px = (lon - p.originLon) * kx
      const py = (p.originLat - lat) * p.mPerDeg
      const d = Math.hypot(px - cx, py - cy) / 1000
      if (d < best) best = d
    })
    return best
  }
  const rank = (t) => {
    if (t.level === 0) return 0
    return dist(t) <= nearKm ? 1 : 2
  }
  return list
    .map((t) => ({ t, r: rank(t), d: t.level === 0 ? 0 : dist(t) }))
    .sort((a, b) => a.r - b.r || a.d - b.d || a.t.i - b.t.i)
    .map((o) => o.t)
}
