// Animação do ícone do ônibus no mini mapa (lógica pura, testada em
// test/bus-anim.test.mjs). O relógio chama animFrame a cada ~150 ms com o
// relógio real (Date.now()), então a posição depende do tempo decorrido e não
// do número de passos: se um quadro atrasa, o ônibus não fica para trás.
//
// Tudo anda AO LONGO do trajeto: o caminho é a polyline (px) do ônibus até o
// ponto e a posição é a distância percorrida nela (along). Quando chega posição
// nova, a correção interpola a distância que falta até o ponto (de onde o ícone
// estava para onde o ônibus está), nunca x/y em linha reta, então o ícone
// contorna as curvas também na correção.
import { advanceAlong, pathLength } from './route-map.js'

// Intervalo entre quadros no relógio (ms).
export const ANIM_TICK_MS = 150
// Correção suave até a posição nova quando chega dado do celular (ms).
export const ANIM_FIX_MS = 900
// Diferença acima disso (px de design, ao longo do trajeto) pula direto.
export const ANIM_JUMP_PX = 80
// Para sozinha depois disso sem posição nova (bateria).
export const ANIM_MAX_MS = 45 * 1000

// Desaceleração (ease-out cúbico): rápido no começo, suave no fim. t de 0 a 1.
export function easeOut(t) {
  const x = Math.max(0, Math.min(1, Number(t) || 0))
  return 1 - Math.pow(1 - x, 3)
}

// Começo de uma animação.
// - path: polyline plana [x0, y0, ...] do ônibus até o ponto (fim = ponto);
// - speed: px/s; prevRemain: quanto faltava (px ao longo do trajeto) para o ícone
//   chegar ao ponto no quadro atual, ou null (sem posição antiga no mesmo enquadramento).
// Devolve { path, length, speed, startedAt, delta } ou null (sem caminho: o
// relógio põe o ícone direto na posição). delta = prevRemain - length: a
// diferença que a correção desfaz com ease-out (0 = sem correção).
export function startAnimation({ path, speed = 0, prevRemain = null, now = Date.now(), jumpPx = ANIM_JUMP_PX }) {
  if (!Array.isArray(path) || path.length < 4) return null
  const length = pathLength(path)
  if (!(length > 0)) return null
  let delta = 0
  if (typeof prevRemain === 'number' && Number.isFinite(prevRemain)) {
    const d = prevRemain - length
    if (Math.abs(d) <= jumpPx) delta = d
  }
  const v = speed > 0 ? speed : 0
  if (v === 0 && Math.abs(delta) < 0.5) return null
  return { path, length, speed: v, startedAt: now, delta }
}

// Onde o ícone deve estar no instante `now`: { x, y, along, remain, done }.
// along = speed * t - delta * (1 - easeOut(t / fixMs)), preso entre 0 e o fim.
// done: chegou ao ponto e a correção acabou, ou passou de maxMs (bateria).
export function animFrame(anim, now = Date.now(), { fixMs = ANIM_FIX_MS, maxMs = ANIM_MAX_MS } = {}) {
  if (!anim) return null
  const elapsed = Math.max(0, now - anim.startedAt)
  const t = Math.min(elapsed, maxMs)
  const fixing = anim.delta !== 0 && elapsed < fixMs
  const corr = anim.delta * (1 - (fixing ? easeOut(elapsed / fixMs) : 1))
  const along = Math.max(0, Math.min(anim.length, (anim.speed * t) / 1000 - corr))
  const pos = advanceAlong(anim.path, along)
  return { x: pos.x, y: pos.y, along, remain: anim.length - along, done: elapsed >= maxMs || (!fixing && (along >= anim.length || anim.speed === 0)) }
}
