// Layout da tela do ponto (pixels de design, tela redonda de 480): o mapa ocupa a
// TELA TODA, sem moldura, sem cartão e sem esfumado; o texto fica direto sobre o mapa
// (cores conferidas contra os blocos em test/colors.test.mjs e algarismos em PNG com
// contorno, utils/eta-digits.js).
// - topo, centralizado: nome do ponto e, logo abaixo, o selo da linha;
// - à esquerda: número grande dos minutos e "min" (utils/eta-digits.js etaNumberLayout);
// - embaixo, centralizado: "recado · distância" e "depois 7 e 15 min".
// O centro do enquadramento do mapa (onde fica o ponto sem ônibus) é à direita e um
// pouco abaixo do centro da tela (MAP_CX, MAP_CY), para o ponto não ficar atrás do
// número. Lógica pura, testada em test/detail-map.test.mjs (tudo cabe no círculo da
// tela; ícones do mapa inteiros dentro da tela redonda).
import { MAP_VIEW, MAP_CLIP } from './map-frame.js'

export const SCREEN = 480
export const SCREEN_R = SCREEN / 2

export const LAYOUT = Object.freeze({
  // Nome do ponto (texto) e selo da linha (largura pela medida do texto, chipBox).
  title: { x: 126, y: 30, w: 228, h: 30, size: 24 },
  chip: { y: 64, h: 26, size: 17, padX: 12, minW: 52, maxW: 200 },
  // Número em texto comum (minuto fora de 0..999, raro): mesma área do número.
  eta: { x: 40, y: 150, w: 250, h: 156, size: 120 },
  // GPS velho: embaixo do número.
  etaAge: { x: 60, y: 326, w: 200, h: 22, size: 16 },
  // Rodapé: "já já · 1,0 km" e "depois 7 e 15 min".
  info: { x: 90, y: 392, w: 300, h: 24, size: 18 },
  next: { x: 112, y: 420, w: 256, h: 22, size: 16 },
  // Sem ônibus agora (com o mapa): três linhas à esquerda, onde fica o número.
  emptyTitle: { x: 40, y: 156, w: 250, h: 60, size: 48 },
  emptyLine1: { x: 40, y: 218, w: 250, h: 32, size: 22 },
  emptyLine2: { x: 40, y: 250, w: 250, h: 32, size: 22 },
  // Fora da janela de aviso: recado discreto no pé da tela.
  quiet: { x: 150, y: 444, w: 180, h: 18, size: 13 },
  // "Esse passou · vem o próximo": por cima do rodapé, some sozinha.
  pill: { x: 105, y: 386, w: 270, h: 36 },
  // Estado do mapa quando a vista não tem nenhum bloco (texto pequeno embaixo do
  // número, fora da área dos ícones do mapa).
  mapDiag: { x: 60, y: 350, w: 200, h: 38, size: 14 },
  // Recado das telas sem dados ("Nova tentativa em 30 s").
  footer: { x: 80, y: 344, w: 320, h: 26, size: 17 }
})

// Selo da linha centrado na tela, com a largura do texto (textW em px de design).
export function chipBox(textW) {
  const c = LAYOUT.chip
  const w = Math.max(c.minW, Math.min(c.maxW, Math.round((Number(textW) || 0) + 2 * c.padX)))
  return { x: SCREEN_R - w / 2, y: c.y, w, h: c.h }
}

// Largura aproximada de um texto curto (px de design), sem medir: para o selo
// quando getTextLayout não existe. Algarismos e maiúsculas ~0,62 da fonte.
export function estimateTextWidth(text, size) {
  return String(text || '').length * size * 0.62
}

// Mapa: centro do enquadramento na tela e o retângulo desenhado (a tela toda).
export const MAP_CX = 352
export const MAP_CY = 280
export const MAP_RECT = Object.freeze({ x: MAP_CX + MAP_CLIP.x0, y: MAP_CY + MAP_CLIP.y0, w: MAP_CLIP.x1 - MAP_CLIP.x0, h: MAP_CLIP.y1 - MAP_CLIP.y0 })
// Ícones do ônibus/ponto: meia largura (o ícone do ônibus tem 48 px).
export const ICON_HALF = 24

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

// Caixas se sobrepõem?
export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// Área dos centros dos ícones do mapa, em px de design da tela.
export function iconArea(view = MAP_VIEW) {
  return { x0: MAP_CX - view.hx, x1: MAP_CX + view.hx, y0: MAP_CY - view.hy, y1: MAP_CY + view.hy }
}

// Ícones grandes dos pontos no mapa ("M" das estações MOVE e hexágono das estações
// centrais, shared/stop-icons.js): não podem ficar atrás do nome do ponto, do selo,
// do número grande e dos textos do rodapé. Caixas em px de design da tela (o selo
// com a largura máxima, o número com a área toda do LAYOUT.eta).
export const STOP_ICON_KEEP_OUT = Object.freeze(
  [
    LAYOUT.title,
    { x: SCREEN_R - LAYOUT.chip.maxW / 2, y: LAYOUT.chip.y, w: LAYOUT.chip.maxW, h: LAYOUT.chip.h },
    LAYOUT.eta,
    LAYOUT.etaAge,
    LAYOUT.mapDiag,
    LAYOUT.info,
    LAYOUT.next,
    LAYOUT.quiet
  ].map((b) => Object.freeze({ x: b.x, y: b.y, w: b.w, h: b.h }))
)

// O ícone grande de meia largura `half` com centro em (x, y) (px de design relativos
// ao centro do mapa) cabe: inteiro dentro da tela redonda e fora dos textos?
export function stopIconFits(x, y, half) {
  const b = { x: MAP_CX + x - half, y: MAP_CY + y - half, w: 2 * half, h: 2 * half }
  if (!boxInsideCircle(b, 2)) return false
  return STOP_ICON_KEEP_OUT.every((k) => !boxesOverlap(b, k))
}
