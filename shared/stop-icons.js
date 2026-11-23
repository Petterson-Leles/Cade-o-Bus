// Ícones dos pontos de ônibus no mapa da tela do ponto e na lista "Seu ponto" das
// configurações (lógica pura, testada em test/stop-icons.test.mjs):
// - ponto de rua: losango pequeno vazado (miolo na cor do fundo, contorno secundário);
// - estação MOVE/BRT: círculo cheio na cor de destaque com "M";
// - estação central (São Gabriel, Pampulha...): hexágono de ponta para cima com um ônibus.
// O tipo vem de shared/text.js stopKind; no payload do mapa vai compacto, uma letra
// por ponto ('s' | 'm' | 'c', campo `kinds`, na mesma ordem de `stops`).
import { stopKind } from './text.js'

export const KIND_CODE = Object.freeze({ street: 's', move: 'm', central: 'c' })
export const CODE_KIND = Object.freeze({ s: 'street', m: 'move', c: 'central' })

// Tamanho de cada ícone (px de design): o losango é um quadrado de 10 px girado
// (14 px de ponta a ponta); "M" e hexágono são PNG (assets/common.r/stop/).
export const STOP_ICON_SIZE = Object.freeze({ street: 10, move: 24, central: 34 })
// Meia largura usada para sobreposição (o losango vai de ponta a ponta).
export const STOP_ICON_HALF = Object.freeze({ street: 7, move: 12, central: 17 })
// Maior número = mais importante (desenhado por cima e preferido na sobreposição).
export const STOP_ICON_PRIORITY = Object.freeze({ street: 1, move: 2, central: 3 })
// Dois ícones "se sobrepõem muito" quando os centros ficam a menos dessa fração da
// soma das meias larguras: fica só o mais importante.
export const OVERLAP_FACTOR = 0.7
// Seu ponto no mapa (halo de 13 px de raio): ícones colados nele saem.
export const USER_STOP_HALF = 13
// No máximo tantos ícones grandes (cada um é um IMG no relógio).
export const MAX_BIG_ICONS = 6

// Letra do tipo de um ponto ({ station? }) para o payload.
export function stopKindCode(stop) {
  return KIND_CODE[stopKind(stop)]
}

// Valida o campo `kinds` recebido: n letras 's'|'m'|'c'; qualquer outra coisa vira
// tudo 's' (ponto de rua), para o relógio nunca desenhar ícone errado.
export function parseStopKinds(value, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0))
  if (typeof value === 'string' && value.length === count && /^[smc]*$/.test(value)) return value
  return 's'.repeat(count)
}

// PNG do ícone grande (relativo a assets/common.r/): stop/move-dark.png etc.
export function stopIconSrc(kind, themeName) {
  return `stop/${kind}-${themeName === 'light' ? 'light' : 'dark'}.png`
}

// Losango de rua com centro (x, y) e meia diagonal h: pontos para drawPoly/strokePoly
// do CANVAS (fechado: repete o primeiro).
export function diamondPoints(x, y, h) {
  return [
    { x, y: y - h },
    { x: x + h, y },
    { x, y: y + h },
    { x: x - h, y },
    { x, y: y - h }
  ]
}

// Escolhe o que desenhar. stops: [x0, y0, x1, y1, ...] (px de design relativos ao
// centro do mapa); kinds: uma letra por ponto. Opções:
// - user: { x, y } do seu ponto (sempre fica; ícones muito em cima dele saem);
// - showStreets: false esconde os losangos (zoom longe);
// - fitsBig(x, y, half): o ícone grande cabe ali (fora do número e dos textos)?
//   Se não couber, ou passar de maxBig, vira losango.
// Devolve [{ x, y, kind }] na ordem de desenho: losangos, depois "M", depois
// hexágonos (o mais importante por cima).
export function pickStopIcons(stops, kinds, { user = null, showStreets = true, fitsBig = null, maxBig = MAX_BIG_ICONS } = {}) {
  const list = Array.isArray(stops) ? stops : []
  const n = Math.floor(list.length / 2)
  const codes = parseStopKinds(kinds, n)
  const items = []
  for (let i = 0; i < n; i++) items.push({ x: list[2 * i], y: list[2 * i + 1], kind: CODE_KIND[codes[i]], i })
  const placed = []
  if (user && Number.isFinite(user.x) && Number.isFinite(user.y)) placed.push({ x: user.x, y: user.y, half: USER_STOP_HALF })
  const free = (x, y, half) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= OVERLAP_FACTOR * (p.half + half))
  const out = []
  let big = 0
  const tryPlace = (it, kind) => {
    const half = STOP_ICON_HALF[kind]
    if (!free(it.x, it.y, half)) return false
    placed.push({ x: it.x, y: it.y, half })
    out.push({ x: it.x, y: it.y, kind, i: it.i })
    return true
  }
  const streets = []
  // Mais importantes primeiro (central, depois move), na ordem do trajeto.
  ;['central', 'move'].forEach((kind) => {
    items
      .filter((it) => it.kind === kind)
      .forEach((it) => {
        const fits = big < maxBig && (!fitsBig || fitsBig(it.x, it.y, STOP_ICON_HALF[kind]))
        if (fits) {
          if (tryPlace(it, kind)) big++
          return
        }
        streets.push(it)
      })
  })
  if (showStreets) {
    items.filter((it) => it.kind === 'street').forEach((it) => streets.push(it))
    streets.sort((a, b) => a.i - b.i).forEach((it) => tryPlace(it, 'street'))
  }
  return out
    .sort((a, b) => STOP_ICON_PRIORITY[a.kind] - STOP_ICON_PRIORITY[b.kind] || a.i - b.i)
    .map(({ x, y, kind }) => ({ x, y, kind }))
}
