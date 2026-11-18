// Layout da tela do ponto (pixels de design, tela redonda de 480): informações numa
// coluna à esquerda e o mapa ocupando a metade direita inteira, sem moldura, com
// uma faixa de transição (PNG com gradiente de alpha) na borda esquerda do mapa e,
// mais leve, no topo e na base. Lógica pura, testada em test/detail-layout.test.mjs
// (tudo cabe no círculo da tela; ícones do mapa fora da faixa de transição).
import { MAP_VIEW, MAP_CLIP } from './map-frame.js'

export const SCREEN = 480
export const SCREEN_R = SCREEN / 2

// Coluna da esquerda: todas as caixas centradas em COL_CX, sem passar de COL_RIGHT.
export const COL_CX = 140
export const COL_RIGHT = 225
const col = (y, h, w = 170) => ({ x: COL_CX - w / 2, y, w, h })

export const LAYOUT = Object.freeze({
  title: { x: 112, y: 40, w: 256, h: 30, size: 22 },
  eta: { ...col(90, 164), size: 160 },
  etaMin: { ...col(252, 32), size: 28 },
  etaLabel: { ...col(284, 30), size: 22 },
  etaAge: { ...col(314, 22), size: 16 },
  dist: { ...col(338, 28), size: 22 },
  next: { ...col(366, 26, 166), size: 18 },
  // Sem ônibus agora (com o mapa): três linhas na coluna.
  emptyTitle: { ...col(160, 60), size: 48 },
  emptyLine1: { ...col(222, 32), size: 22 },
  emptyLine2: { ...col(254, 32), size: 22 },
  quiet: { x: 110, y: 398, w: 260, h: 22, size: 15 },
  pill: { x: 105, y: 78, w: 270, h: 36 },
  // Estado do mapa quando a vista não tem nenhum bloco (texto pequeno no canto).
  mapDiag: { x: 232, y: 350, w: 180, h: 40, size: 14 },
  // Recado das telas sem dados ("Nova tentativa em 30 s").
  footer: { x: 80, y: 344, w: 320, h: 26, size: 17 }
})

// Mapa: centro (onde fica o centro do enquadramento) e o retângulo desenhado.
export const MAP_CX = 340
export const MAP_CY = 240
export const MAP_RECT = Object.freeze({ x: MAP_CX + MAP_CLIP.x0, y: MAP_CY + MAP_CLIP.y0, w: MAP_CLIP.x1 - MAP_CLIP.x0, h: MAP_CLIP.y1 - MAP_CLIP.y0 })
// Faixas de transição (assets/common.r/map/fade-*.png, scripts/build-map-fades.mjs).
export const FADE_W = 64
export const FADE_TOP_H = 56
export const FADE_BOTTOM_H = 56
// Ícones do ônibus/ponto: meia largura (o ícone do ônibus tem 48 px).
export const ICON_HALF = 24

export const fadeSrc = (theme, side = 'left') => `map/fade-${side === 'left' ? '' : side + '-'}${theme === 'light' ? 'light' : 'dark'}.png`

// Onde desenhar os blocos (px físicos): centro do mapa, retângulo do canvas e o
// círculo da tela (blocos fora dele não são usados). px: função de design -> físico.
export function tileView(px) {
  return {
    cx: px(MAP_CX),
    cy: px(MAP_CY),
    rect: { x: px(MAP_RECT.x), y: px(MAP_RECT.y), w: px(MAP_RECT.w), h: px(MAP_RECT.h) },
    circle: { x: px(SCREEN_R), y: px(SCREEN_R), r: px(SCREEN_R) }
  }
}

// O mesmo, relativo ao centro do mapa, para o pedido de blocos ao celular
// ([l, t, w, h, sx, sy, sr], shared/map-demand.js buildDemandParams).
export function demandView(px) {
  const v = tileView(px)
  return [v.rect.x - v.cx, v.rect.y - v.cy, v.rect.w, v.rect.h, v.circle.x - v.cx, v.circle.y - v.cy, v.circle.r].map(Math.round)
}

// Caixa { x, y, w, h } inteira dentro do círculo da tela (com margem)?
export function boxInsideCircle(b, margin = 0) {
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h]
  ]
  return corners.every(([x, y]) => Math.hypot(x - SCREEN_R, y - SCREEN_R) <= SCREEN_R - margin + 1e-9)
}

// Área dos centros dos ícones do mapa, em px de design da tela.
export function iconArea(view = MAP_VIEW) {
  return { x0: MAP_CX - view.hx, x1: MAP_CX + view.hx, y0: MAP_CY - view.hy, y1: MAP_CY + view.hy }
}
