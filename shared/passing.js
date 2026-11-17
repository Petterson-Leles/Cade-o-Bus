// "Esse passou": detectar no celular o ônibus que acabou de passar do ponto e
// animar o sumiço no relógio. Lógica pura, testada em test/passing.test.mjs.

// Só conta como "passou" o ônibus que estava chegando perto (até isso do ponto)...
export const PASS_NEAR_M = 2500
// ...na leitura anterior, feita no máximo há tanto tempo.
export const PASS_MAX_GAP_MS = 2 * 60 * 1000
// Por quanto tempo o celular continua avisando (o relógio ignora repetidos).
export const PASS_KEEP_MS = 45 * 1000
// Sumiço suave do ícone no relógio e tempo da pílula "Esse passou · vem o próximo".
export const PASS_FADE_MS = 4500
export const PASS_PILL_MS = 3500
// Ícones esmaecidos pré-gerados (assets/common.r/bus/<tema>-passou-<nível>.png).
export const FADE_LEVELS = Object.freeze([100, 80, 60, 40, 20])

const validVehicle = (v) => typeof v === 'string' && v !== '' && v !== '?'

// Atualiza a memória de um ponto com as leituras novas.
// prev: { at, near: { [veículo]: metros até o ponto }, recent: [{ vehicle, lat, lon, along, at }] } ou null.
// obs: [{ vehicle, lat, lon, along, passed, wrongWay, toStopM }] (uma por ônibus no trajeto).
// Devolve { state, justPassed } (justPassed: os que passaram nesta leitura).
export function trackPassing(prev, obs, now, { nearM = PASS_NEAR_M, maxGapMs = PASS_MAX_GAP_MS, keepMs = PASS_KEEP_MS } = {}) {
  const fresh = prev && typeof prev.at === 'number' && now - prev.at <= maxGapMs && now >= prev.at
  const before = fresh && prev.near ? prev.near : {}
  const near = {}
  const justPassed = []
  ;(Array.isArray(obs) ? obs : []).forEach((o) => {
    if (!o || !validVehicle(o.vehicle)) return
    if (!o.passed && Number.isFinite(o.toStopM)) {
      if (o.toStopM <= nearM) near[o.vehicle] = o.toStopM
      return
    }
    // Passou agora: estava chegando na leitura anterior e não está na contramão.
    if (o.passed && !o.wrongWay && Object.prototype.hasOwnProperty.call(before, o.vehicle)) {
      justPassed.push({ vehicle: o.vehicle, lat: o.lat, lon: o.lon, along: o.along, at: now })
    }
  })
  const kept = (prev && Array.isArray(prev.recent) ? prev.recent : []).filter(
    (r) => r && now - r.at <= keepMs && !justPassed.some((j) => j.vehicle === r.vehicle)
  )
  return { state: { at: now, near, recent: kept.concat(justPassed) }, justPassed }
}

// O mais recente que ainda vale avisar, ou null.
export function latestPassed(state, now, keepMs = PASS_KEEP_MS) {
  const list = state && Array.isArray(state.recent) ? state.recent.filter((r) => now - r.at <= keepMs) : []
  if (list.length === 0) return null
  return list.reduce((a, b) => (b.at > a.at ? b : a))
}

// Curva suave (ease-in-out quadrática), k de 0 a 1.
export function easeInOut(k) {
  const t = Math.max(0, Math.min(1, Number(k) || 0))
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// Quadro do sumiço após `elapsedMs`:
// { done, opacity (0–1), level (ícone pré-gerado), alpha (0–255 para a prop alpha do IMG) }.
// level * alpha / 255 = opacidade: se o relógio aplicar o alpha, o sumiço é contínuo;
// se ignorar, fica em degraus pelos ícones esmaecidos.
export function fadeFrame(elapsedMs, totalMs = PASS_FADE_MS) {
  const k = totalMs > 0 ? Math.max(0, Number(elapsedMs) || 0) / totalMs : 1
  const opacity = 1 - easeInOut(k)
  if (k >= 1 || opacity <= 0.01) return { done: true, opacity: 0, level: FADE_LEVELS[FADE_LEVELS.length - 1], alpha: 0 }
  const pct = opacity * 100
  let level = FADE_LEVELS[0]
  for (let i = FADE_LEVELS.length - 1; i >= 0; i--) {
    if (FADE_LEVELS[i] >= pct - 1e-9) {
      level = FADE_LEVELS[i]
      break
    }
  }
  return { done: false, opacity, level, alpha: Math.max(0, Math.min(255, Math.round((255 * pct) / level))) }
}

// Chave para o relógio não repetir o mesmo aviso.
export function passedKey(passed) {
  return passed && passed.vehicle ? `${passed.vehicle}@${passed.at}` : ''
}
