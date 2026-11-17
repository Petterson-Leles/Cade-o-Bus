// Enquadramento do mini mapa (lógica pura, testada em test/map-frame.test.mjs).
// O side service escolhe a escala e o centro; o relógio só manda o zoom manual.

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

// Escala e centro do mapa, em metros na projeção centrada no ponto do usuário
// (x leste, y sul). busXY: posição do ônibus em destaque ([x, y] em metros) ou null.
// - zoom (manual): centro no ponto, escala pedida.
// - automático: centro no meio do ônibus e do ponto, escala para caber os dois
//   (limitada a MIN..MAX). Se a escala bater no mínimo, o centro vai para perto
//   do ponto, para o ponto nunca sair do mapa.
// Devolve { k, center: [x, y], auto }.
// Com `levels` (mapa de ruas baixado no relógio: escalas fixas dos blocos, em px
// de design por km, crescentes), a escala só pode ser um desses níveis:
// - level (manual): índice do nível pedido pela coroa/botões;
// - automático: o maior nível em que ônibus e ponto cabem (ou o menor de todos).
// Nesse modo a saída leva também `level` (índice) e k não é arredondado.
export function chooseFrame({ busXY = null, zoom = null, levels = null, level = null, viewR = MAP_VIEW_R, iconR = FRAME_ICON_R } = {}) {
  const lv = parseLevels(levels)
  if (lv) return chooseLevelFrame({ busXY, levels: lv, level: parseLevelIndex(level, lv.length), viewR, iconR })
  const manual = parseZoom(zoom)
  if (manual !== null) return { k: manual, center: [0, 0], auto: false }
  const ok = Array.isArray(busXY) && Number.isFinite(busXY[0]) && Number.isFinite(busXY[1])
  if (!ok) return { k: DEFAULT_PX_PER_KM, center: [0, 0], auto: true }
  const d = Math.hypot(busXY[0], busXY[1])
  const span = Math.max(MIN_FRAME_SPAN_M, d)
  const k = clampScale(((viewR - iconR) * 2 * 1000) / span)
  if (d === 0) return { k: Math.round(k), center: [0, 0], auto: true }
  // Centro a no máximo isso do ponto (em metros) para o ponto caber com folga.
  const maxShiftM = ((viewR - iconR) * 1000) / k
  const shift = Math.min(d / 2, maxShiftM)
  const ux = busXY[0] / d
  const uy = busXY[1] / d
  return { k: Math.round(k), center: [ux * shift, uy * shift], auto: true }
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
export function chooseLevelFrame({ busXY, levels, level, viewR = MAP_VIEW_R, iconR = FRAME_ICON_R }) {
  if (level !== null && level !== undefined) return { k: levels[level], center: [0, 0], auto: false, level }
  const ok = Array.isArray(busXY) && Number.isFinite(busXY[0]) && Number.isFinite(busXY[1])
  // Sem ônibus: o nível mais perto da escala padrão.
  let i = 0
  if (!ok) {
    for (let j = 1; j < levels.length; j++) if (Math.abs(levels[j] - DEFAULT_PX_PER_KM) < Math.abs(levels[i] - DEFAULT_PX_PER_KM)) i = j
    return { k: levels[i], center: [0, 0], auto: true, level: i }
  }
  const d = Math.hypot(busXY[0], busXY[1])
  const ideal = ((viewR - iconR) * 2 * 1000) / Math.max(MIN_FRAME_SPAN_M, d)
  for (let j = 0; j < levels.length; j++) if (levels[j] <= ideal) i = j
  const k = levels[i]
  if (d === 0) return { k, center: [0, 0], auto: true, level: i }
  const shift = Math.min(d / 2, ((viewR - iconR) * 1000) / k)
  return { k, center: [(busXY[0] / d) * shift, (busXY[1] / d) * shift], auto: true, level: i }
}

// Fica no enquadramento automático anterior enquanto ele ainda serve: ônibus e
// ponto cabem com folga e a escala não ficou longe demais da ideal (menos de
// `maxZoomOut` vezes). Assim o mapa não "pula" a cada atualização e o ícone
// continua deslizando. prev/ideal: saídas de chooseFrame.
export function stableFrame(prev, ideal, busXY, { viewR = MAP_VIEW_R, iconR = FRAME_ICON_R, maxZoomOut = 1.6 } = {}) {
  if (!prev || !ideal || !prev.auto || !ideal.auto || !Array.isArray(prev.center)) return ideal
  // Mapa de ruas ligado/desligado (ou níveis diferentes): não reaproveita.
  const lv = (f) => (Number.isInteger(f.level) ? f.level : null)
  if ((lv(prev) === null) !== (lv(ideal) === null)) return ideal
  if (!(prev.k > 0) || ideal.k / prev.k > maxZoomOut || prev.k > ideal.k * 1.05) return ideal
  const fits = (m) => {
    if (!m) return true
    const x = ((m[0] - prev.center[0]) * prev.k) / 1000
    const y = ((m[1] - prev.center[1]) * prev.k) / 1000
    return Math.hypot(x, y) <= viewR - iconR + 2 // +2: a escala é arredondada
  }
  return fits([0, 0]) && fits(busXY) ? prev : ideal
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
