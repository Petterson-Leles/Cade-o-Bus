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
export function chooseFrame({ busXY = null, zoom = null, viewR = MAP_VIEW_R, iconR = FRAME_ICON_R } = {}) {
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
