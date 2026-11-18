// Número grande da tela do ponto em imagens (sem APIs do relógio, testado no Node).
//
// A fonte do sistema não fica grossa o bastante e o TEXT não tem contorno, então os
// algarismos são PNGs (Archivo Black, contorno leve: escuro no tema escuro, claro no
// claro) gerados por scripts/build-eta-digits.py em assets/common.r/eta/. O IMG do
// Zepp OS não pinta a imagem (sem cor/tint), então há um PNG por cor de faixa
// (ETA_BANDS) e por tema, mas só os algarismos que a faixa usa (ex.: "chegando" vai
// até 2 min: só 0, 1 e 2). Uma só altura: 2 e 3 dígitos usam auto_scale do IMG.
// "min" também é PNG (negrito com o mesmo contorno), um por tema.
import { ETA_BANDS, BUS_ICON_SLUGS, etaBand, normalizeThemeName } from './colors.js'
import { ETA_DIGIT_DATA } from './eta-digits-data.js'

// Maior número desenhado em imagens (acima disso, ou não inteiro: texto comum).
export const ETA_MAX = 999
// Escala de cada quantidade de dígitos (1 dígito = fonte de 230 px de design).
export const ETA_FONT = 230
export const ETA_SCALES = Object.freeze([1, 170 / 230, 120 / 230])
// Grupo "número + min" centrado em x = ETA_CX; número centrado na altura em ETA_MID_Y.
export const ETA_CX = 160
export const ETA_MID_Y = 228
// Espaço entre os algarismos (já com o contorno, px de design, escala do dígito)
// e entre o número e o "min".
export const ETA_DIGIT_GAP = 6
export const ETA_MIN_GAP = 8

// px físicos (tela de 466) -> px de design (480).
const design = (v) => v / ETA_DIGIT_DATA.k

export function etaSlug(min) {
  return BUS_ICON_SLUGS[ETA_BANDS.indexOf(etaBand(min))] || BUS_ICON_SLUGS[BUS_ICON_SLUGS.length - 1]
}

// Minutos que viram imagem: inteiro de 0 a ETA_MAX. Devolve o texto ou null.
export function etaDigitsText(min) {
  const n = typeof min === 'number' ? min : typeof min === 'string' && /^\d+$/.test(min.trim()) ? Number(min) : NaN
  return Number.isInteger(n) && n >= 0 && n <= ETA_MAX ? String(n) : null
}

export function etaDigitSrc(digit, min, theme) {
  return `eta/${normalizeThemeName(theme)}-${etaSlug(min)}-${digit}.png`
}

export function etaMinSrc(theme) {
  return `eta/${normalizeThemeName(theme)}-min.png`
}

// Algarismos que cada faixa precisa (0..maxMin), { slug: [0, 1, ...] }: o que o
// gerador desenha e o que o teste confere em assets/.
export function digitsByBand(maxMin = ETA_MAX) {
  const sets = {}
  BUS_ICON_SLUGS.forEach((slug) => (sets[slug] = {}))
  for (let n = 0; n <= maxMin; n++) {
    const slug = etaSlug(n)
    String(n)
      .split('')
      .forEach((d) => (sets[slug][d] = true))
  }
  const out = {}
  Object.keys(sets).forEach((slug) => (out[slug] = Object.keys(sets[slug]).map(Number).sort((a, b) => a - b)))
  return out
}

// Posições (px de design) do número em imagens e do "min", alinhado à base do número:
// { scale, digits: [{ d, x, y, w, h }], min: { x, y, w, h }, box: { x, y, w, h } }
// ou null se o número não vira imagem (etaDigitsText).
export function etaNumberLayout(min, data = ETA_DIGIT_DATA) {
  const text = etaDigitsText(min)
  if (text === null) return null
  const k = data.k
  const s = ETA_SCALES[Math.min(text.length, ETA_SCALES.length) - 1]
  const h = (data.h / k) * s
  const gap = ETA_DIGIT_GAP * s
  const widths = text.split('').map((d) => (data.widths[Number(d)] / k) * s)
  const numW = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
  const minW = data.min.w / k
  const minH = data.min.h / k
  const total = numW + ETA_MIN_GAP + minW
  const top = ETA_MID_Y - h / 2
  const baseY = top + (data.base / k) * s
  let x = ETA_CX - total / 2
  const left = x
  const digits = text.split('').map((d, i) => {
    const b = { d: Number(d), x, y: top, w: widths[i], h }
    x += widths[i] + gap
    return b
  })
  const minBox = { x: left + numW + ETA_MIN_GAP, y: baseY - design(data.min.base), w: minW, h: minH }
  return {
    scale: s,
    digits,
    min: minBox,
    box: { x: left, y: Math.min(top, minBox.y), w: total, h: Math.max(top + h, minBox.y + minH) - Math.min(top, minBox.y) }
  }
}
