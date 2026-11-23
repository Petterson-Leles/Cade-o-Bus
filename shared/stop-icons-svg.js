// Ícones dos pontos na lista "Seu ponto" da tela de configurações (celular): os
// mesmos do mapa do relógio (shared/stop-icons.js), em SVG como data URI para o
// componente Image. Separado para o SVG não ir no bundle do relógio.
// Lógica pura, testada em test/stop-icons.test.mjs.
import { svgDataUri } from './theme-icons.js'

// Silhueta do ônibus (frente) num quadro de 24 x 24 (mesma do gerador dos PNG).
function busSvg(cx, cy, s, ink, hole) {
  const k = s / 24
  return (
    `<g transform="translate(${cx - s / 2} ${cy - s / 2}) scale(${k})">` +
    `<rect x="4" y="3" width="16" height="15" rx="3" fill="${ink}"/>` +
    `<rect x="6.5" y="6" width="11" height="4.5" rx="1" fill="${hole}"/>` +
    `<circle cx="8" cy="15" r="1.4" fill="${hole}"/><circle cx="16" cy="15" r="1.4" fill="${hole}"/>` +
    `<rect x="6" y="18" width="3" height="3" rx="1" fill="${ink}"/><rect x="15" y="18" width="3" height="3" rx="1" fill="${ink}"/></g>`
  )
}

// "M" grosso como polígono (sem depender de fonte), num quadro de 24 x 24.
export const M_PATH = 'M5.2 17.4V6.6h3.6L12 11.4l3.2-4.8h3.6v10.8h-3.4v-5.3L12 16.6l-3.4-4.5v5.3z'

// Tamanho do ícone na lista (px CSS) por tipo.
export const SETTING_ICON_PX = Object.freeze({ street: 14, move: 22, central: 24 })

// SVG do ícone do ponto na lista "Seu ponto". C: paleta CSS (utils/colors.js
// cssTheme); bg: cor atrás do ícone (linha da lista); selected: o ponto escolhido
// (losango cheio; estações com anel).
export function stopIconSvg(kind, C, { bg, selected = false } = {}) {
  const back = bg || C.card
  const s = SETTING_ICON_PX[kind] || SETTING_ICON_PX.street
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24">`
  if (kind === 'move') {
    const ring = selected ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${C.chosenText}" stroke-width="2"/>` : ''
    return `${head}<circle cx="12" cy="12" r="${selected ? 8.6 : 11}" fill="${C.chip}" stroke="${back}" stroke-width="1.4"/>${ring}<g transform="translate(12 12) scale(${selected ? 0.72 : 0.92}) translate(-12 -12)"><path d="${M_PATH}" fill="${C.chipText}"/></g></svg>`
  }
  if (kind === 'central') {
    const r = selected ? 9.6 : 11.6
    const pts = [0, 1, 2, 3, 4, 5]
      .map((j) => {
        const a = -Math.PI / 2 + (j * Math.PI) / 3
        return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`
      })
      .join(' ')
    const ring = selected ? `<circle cx="12" cy="12" r="11.2" fill="none" stroke="${C.chosenText}" stroke-width="1.6"/>` : ''
    return `${head}<polygon points="${pts}" fill="${C.chip}" stroke="${back}" stroke-width="1.2"/>${ring}${busSvg(12, 12, selected ? 11 : 13.5, C.chipText, C.chip)}</svg>`
  }
  // Losango: vazado com contorno secundário (como no relógio); escolhido = cheio.
  return `${head}<rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" fill="${selected ? C.primary : back}" stroke="${selected ? C.primary : C.muted}" stroke-width="3"/></svg>`
}

export function stopIconUri(kind, C, opts) {
  return svgDataUri(stopIconSvg(kind, C, opts))
}
