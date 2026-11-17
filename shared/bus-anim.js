// Animação do ícone do ônibus no mini mapa (lógica pura, testada em
// test/bus-anim.test.mjs). O relógio chama animFrame a cada ~150 ms com o
// relógio real (Date.now()), então a posição depende do tempo decorrido e não
// do número de passos: se um quadro atrasa, o ônibus não fica para trás.
import { advanceAlong, blend } from './route-map.js'

// Intervalo entre quadros no relógio (ms).
export const ANIM_TICK_MS = 150
// Correção suave até a posição nova quando chega dado do celular (ms).
export const ANIM_FIX_MS = 900
// Diferença acima disso (px de design) pula direto em vez de deslizar.
export const ANIM_JUMP_PX = 80
// Para sozinha depois disso sem posição nova (bateria).
export const ANIM_MAX_MS = 45 * 1000

// Desaceleração (ease-out cúbico): rápido no começo, suave no fim. t de 0 a 1.
export function easeOut(t) {
  const x = Math.max(0, Math.min(1, Number(t) || 0))
  return 1 - Math.pow(1 - x, 3)
}

// Começo de uma animação. prev: onde o ícone está agora ({ x, y } ou null);
// target: posição real nova; path: polyline do ônibus ao ponto (px); speed: px/s.
// Devolve o objeto da animação (sem timer) ou null se não há o que animar.
export function startAnimation({ prev = null, target, path = [], speed = 0, now = Date.now(), jumpPx = ANIM_JUMP_PX }) {
  if (!target) return null
  const moving = Array.isArray(path) && path.length >= 4 && speed > 0
  const gap = prev ? Math.hypot(prev.x - target.x, prev.y - target.y) : Infinity
  const fixFrom = prev && gap > 0.5 && gap <= jumpPx ? { x: prev.x, y: prev.y } : null
  if (!moving && !fixFrom) return null
  return { path: moving ? path : [], speed: moving ? speed : 0, startedAt: now, fixFrom, target: { x: target.x, y: target.y } }
}

// Onde o ícone deve estar no instante `now`: { x, y, done }.
// - anda pelo caminho a `speed` px/s desde startedAt (para no ponto do usuário);
// - nos primeiros fixMs mistura, com ease-out, a posição antiga do ícone com a do caminho;
// - done: chegou ao fim do caminho e a correção acabou, ou passou de maxMs.
export function animFrame(anim, now = Date.now(), { fixMs = ANIM_FIX_MS, maxMs = ANIM_MAX_MS } = {}) {
  if (!anim) return null
  const elapsed = Math.max(0, now - anim.startedAt)
  let pos = anim.path.length >= 4 ? advanceAlong(anim.path, (anim.speed * Math.min(elapsed, maxMs)) / 1000) : null
  const atEnd = !pos || pos.done
  if (!pos) pos = { x: anim.target.x, y: anim.target.y }
  const fixing = !!anim.fixFrom && elapsed < fixMs
  if (anim.fixFrom) pos = blend(anim.fixFrom, pos, fixing ? easeOut(elapsed / fixMs) : 1)
  return { x: pos.x, y: pos.y, done: elapsed >= maxMs || (atEnd && !fixing) }
}
