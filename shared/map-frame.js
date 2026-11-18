// Enquadramento do mini mapa (lógica pura, testada em test/map-frame.test.mjs).
// O side service escolhe a escala e o centro (zoom só automático na tela do ponto).

// Raio útil do mapa no relógio (pixels de design): o conteúdo é recortado a ele.
export const MAP_VIEW_R = 114
// Centro do ícone do ônibus (48 px) até no máximo isso do centro do mapa.
export const MAP_BUS_MAX_R = 90
// Folga para o ícone do ônibus (meio ícone + respiro) ao enquadrar.
export const FRAME_ICON_R = 28
// Limites da escala (pixels de design por km).
export const MIN_PX_PER_KM = 30
export const MAX_PX_PER_KM = 260
// Sem ônibus: mesma escala de antes (~1,8 km de diâmetro).
export const DEFAULT_PX_PER_KM = 128
// Distância mínima considerada ao enquadrar (ônibus colado no ponto não vira zoom máximo).
export const MIN_FRAME_SPAN_M = 250
// Rastro pontilhado: até tantos metros de trajeto atrás do ônibus.
export const TRAIL_M = 4000
// Espaço entre as bolinhas do rastro (px) e no máximo quantas.
export const TRAIL_SPACING_PX = 10
export const MAX_TRAIL_DOTS = 70

export function clampScale(k) {
  const n = Number(k)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PX_PER_KM
  return Math.max(MIN_PX_PER_KM, Math.min(MAX_PX_PER_KM, n))
}

// Zoom manual pedido pelo relógio: número dentro dos limites ou null (automático).
export function parseZoom(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < MIN_PX_PER_KM || n > MAX_PX_PER_KM) return null
  return Math.round(n)
}

// Área visível do mapa na tela do ponto (pixels de design, relativos ao centro do
// mapa): o mapa ocupa a metade direita da tela e os ícones do ônibus e do ponto
// ficam dentro deste retângulo (descontando a faixa de transição da esquerda e a
// borda redonda). hx/hy: meia largura/altura para o CENTRO dos ícones.
export const MAP_VIEW = Object.freeze({ hx: 76, hy: 116 })
// Retângulo desenhado (canvas do mapa), relativo ao centro do mapa.
export const MAP_CLIP = Object.freeze({ x0: -140, x1: 140, y0: -240, y1: 240 })
// Aproxima um nível só quando ônibus e ponto cabem com essa folga (histerese: o
// mapa não fica indo e voltando entre dois níveis a cada atualização).
export const LEVEL_ZOOM_IN_MARGIN = 1.15

const okXY = (m) => Array.isArray(m) && Number.isFinite(m[0]) && Number.isFinite(m[1])
const cleanView = (v) => (v && v.hx > 0 && v.hy > 0 ? v : MAP_VIEW)

// Escala ideal (px/km, sem limites) para o ponto (0, 0) e o ônibus caberem no
// retângulo da vista com o centro no meio dos dois; null sem ônibus.
export function idealScale(busXY, view = MAP_VIEW) {
  if (!okXY(busXY)) return null
  const v = cleanView(view)
  const ax = Math.abs(busXY[0])
  const ay = Math.abs(busXY[1])
  const kx = ax > 0 ? (2 * v.hx * 1000) / ax : Infinity
  const ky = ay > 0 ? (2 * v.hy * 1000) / ay : Infinity
  const kSpan = (2 * Math.min(v.hx, v.hy) * 1000) / MIN_FRAME_SPAN_M
  return Math.min(kx, ky, kSpan)
}

// Centro (metros) para a escala k: o meio entre ponto e ônibus, preso para o ponto
// nunca sair da vista (se o ônibus não couber, ele fica na borda: o side service
// o leva pelo trajeto até lá).
export function frameCenter(busXY, k, view = MAP_VIEW) {
  if (!okXY(busXY) || !(k > 0)) return [0, 0]
  const v = cleanView(view)
  // +2 px: a mesma folga de fitsView (a escala livre é arredondada).
  const lx = ((v.hx + 2) * 1000) / k
  const ly = ((v.hy + 2) * 1000) / k
  const c = (val, lim) => Math.max(-lim, Math.min(lim, val / 2))
  return [c(busXY[0], lx), c(busXY[1], ly)]
}

// O ponto m (metros) cabe na vista do enquadramento f? (folga de 2 px: arredondamento)
export function fitsView(f, m, view = MAP_VIEW) {
  if (!f || !okXY(m) || !Array.isArray(f.center)) return false
  const v = cleanView(view)
  const x = ((m[0] - f.center[0]) * f.k) / 1000
  const y = ((m[1] - f.center[1]) * f.k) / 1000
  return Math.abs(x) <= v.hx + 2 && Math.abs(y) <= v.hy + 2
}

// Nível para a escala ideal, com histerese: o maior nível <= ideal; se for mais
// perto que o nível anterior, só aproxima com folga (margin).
export function pickLevel(levels, ideal, prevLevel = null, margin = LEVEL_ZOOM_IN_MARGIN) {
  if (!Array.isArray(levels) || levels.length === 0) return null
  if (!(ideal > 0)) return 0
  let cand = 0
  for (let j = 0; j < levels.length; j++) if (levels[j] <= ideal) cand = j
  const prev = Number.isInteger(prevLevel) && prevLevel >= 0 && prevLevel < levels.length ? prevLevel : null
  if (prev === null || cand <= prev) return cand
  let loose = 0
  for (let j = 0; j < levels.length; j++) if (levels[j] * margin <= ideal) loose = j
  return Math.max(prev, loose)
}

// Escala e centro do mapa, em metros na projeção centrada no ponto do usuário
// (x leste, y sul). busXY: posição do ônibus em destaque ([x, y] em metros) ou null.
// - zoom (manual, formato antigo): centro no ponto, escala pedida.
// - automático: centro no meio do ônibus e do ponto, escala para caber os dois no
//   retângulo da vista (MAP_VIEW), limitada a MIN..MAX. Se a escala bater no
//   mínimo, o centro vai para perto do ponto, para o ponto nunca sair do mapa.
// Devolve { k, center: [x, y], auto }.
// Com `levels` (mapa de ruas: escalas fixas dos blocos, em px de design por km,
// crescentes), a escala só pode ser um desses níveis (chooseLevelFrame) e a saída
// leva também `level` (índice); prevLevel: nível do enquadramento anterior (histerese).
export function chooseFrame({ busXY = null, zoom = null, levels = null, level = null, prevLevel = null, view = MAP_VIEW } = {}) {
  const lv = parseLevels(levels)
  if (lv) return chooseLevelFrame({ busXY, levels: lv, level: parseLevelIndex(level, lv.length), prevLevel, view })
  const manual = parseZoom(zoom)
  if (manual !== null) return { k: manual, center: [0, 0], auto: false }
  const ideal = idealScale(busXY, view)
  if (ideal === null) return { k: DEFAULT_PX_PER_KM, center: [0, 0], auto: true }
  const k = Math.round(clampScale(ideal))
  return { k, center: frameCenter(busXY, k, view), auto: true }
}

// Níveis fixos do mapa baixado: lista crescente de 1 a 6 escalas entre
// MIN_PX_PER_KM e MAX_PX_PER_KM (px de design por km, até 2 casas) ou null.
export function parseLevels(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) return null
  const out = value.map(Number)
  if (!out.every((k) => Number.isFinite(k) && k >= MIN_PX_PER_KM && k <= MAX_PX_PER_KM)) return null
  for (let i = 1; i < out.length; i++) if (!(out[i] > out[i - 1])) return null
  return out.map((k) => Math.round(k * 100) / 100)
}

// Índice de nível manual (inteiro dentro da lista) ou null (automático).
export function parseLevelIndex(value, count) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n < count ? n : null
}

// Enquadramento nos níveis fixos (ver chooseFrame).
export function chooseLevelFrame({ busXY, levels, level = null, prevLevel = null, view = MAP_VIEW }) {
  if (level !== null && level !== undefined) return { k: levels[level], center: [0, 0], auto: false, level }
  const ideal = idealScale(busXY, view)
  // Sem ônibus: o nível mais perto da escala padrão.
  if (ideal === null) {
    let i = 0
    for (let j = 1; j < levels.length; j++) if (Math.abs(levels[j] - DEFAULT_PX_PER_KM) < Math.abs(levels[i] - DEFAULT_PX_PER_KM)) i = j
    return { k: levels[i], center: [0, 0], auto: true, level: i }
  }
  const i = pickLevel(levels, ideal, prevLevel)
  const k = levels[i]
  return { k, center: frameCenter(busXY, k, view), auto: true, level: i }
}

// Fica no enquadramento automático anterior enquanto ele ainda serve: ônibus e
// ponto cabem na vista e a escala não ficou longe demais da ideal. Assim o mapa
// não "pula" a cada atualização e o ícone continua deslizando. prev/ideal: saídas
// de chooseFrame (com níveis, ideal já vem com a histerese de pickLevel).
export function stableFrame(prev, ideal, busXY, { view = MAP_VIEW, maxZoomOut = 1.6 } = {}) {
  if (!prev || !ideal || !prev.auto || !ideal.auto || !Array.isArray(prev.center)) return ideal
  // Mapa de ruas ligado/desligado: não reaproveita.
  const lv = (f) => (Number.isInteger(f.level) ? f.level : null)
  if ((lv(prev) === null) !== (lv(ideal) === null)) return ideal
  const fits = fitsView(prev, [0, 0], view) && (!okXY(busXY) || fitsView(prev, busXY, view))
  if (lv(prev) !== null) return lv(prev) === lv(ideal) && prev.k === ideal.k && fits ? prev : ideal
  if (!(prev.k > 0) || ideal.k / prev.k > maxZoomOut || prev.k > ideal.k * 1.05) return ideal
  return fits ? prev : ideal
}

// Coroa digital: graus girados -> nova escala (15° ≈ 1,35×). Positivo aproxima.
export function zoomByCrown(k, degree) {
  const d = Number(degree)
  if (!Number.isFinite(d) || d === 0) return Math.round(clampScale(k))
  return Math.round(clampScale(clampScale(k) * Math.pow(1.02, d)))
}

// Botões +/− (sem coroa): um passo de 1,3×.
export function zoomStep(k, dir) {
  const f = dir > 0 ? 1.3 : 1 / 1.3
  return Math.round(clampScale(clampScale(k) * f))
}

// Bolinhas a cada `spacing` px ao longo de pedaços planos [x0, y0, x1, y1, ...]:
// devolve [x, y, x, y, ...] em inteiros, no máximo maxDots bolinhas.
export function dotsAlong(pieces, spacing = TRAIL_SPACING_PX, maxDots = MAX_TRAIL_DOTS) {
  const out = []
  if (!Array.isArray(pieces) || !(spacing > 0)) return out
  for (let p = 0; p < pieces.length; p++) {
    const flat = pieces[p]
    if (!Array.isArray(flat) || flat.length < 4) continue
    let next = 0 // distância até a próxima bolinha neste pedaço
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const x0 = flat[i]
      const y0 = flat[i + 1]
      const seg = Math.hypot(flat[i + 2] - x0, flat[i + 3] - y0)
      while (next <= seg) {
        if (out.length >= maxDots * 2) return out
        const t = seg > 0 ? next / seg : 0
        out.push(Math.round(x0 + t * (flat[i + 2] - x0)) || 0, Math.round(y0 + t * (flat[i + 3] - y0)) || 0)
        next += spacing
      }
      next -= seg
    }
  }
  return out
}
