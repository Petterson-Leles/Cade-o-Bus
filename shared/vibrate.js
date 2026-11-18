// Quando vibrar o pulso na tela do ponto (lógica pura, testada em test/vibrate.test.mjs).
// - 'soon': o próximo ônibus entrou em "já já" (≤ 5 min): uma vibração curta;
// - 'now': entrou em "chegando: corre!" (≤ 2 min): vibração forte e longa;
// - 'passed': o ônibus que vinha passou pelo ponto ("Esse passou"): duas curtas.
// Cada aviso só uma vez por veículo; se o tempo do mesmo veículo voltar a subir
// bastante (RESET_MIN acima do limiar já avisado), ele pode avisar de novo.

export const SOON_MIN = 5
export const NOW_MIN = 2
// Quanto o ETA precisa voltar a subir acima do limiar para "esquecer" o aviso.
export const RESET_MIN = 3
const KEEP_PASSED = 6

// Nível da faixa: 0 = longe, 1 = já já, 2 = chegando.
export function etaLevel(min) {
  const n = Number(min)
  if (min === null || min === undefined || min === '' || !Number.isFinite(n)) return 0
  if (n <= NOW_MIN) return 2
  if (n <= SOON_MIN) return 1
  return 0
}

// memory: { vehicle, level, passed: [chaves] } ou null (acabou de abrir a tela).
// reading: { vehicle, etaMin, passedKey } do ônibus em destaque (vehicle null = nenhum).
// Devolve { memory, alert: 'passed' | 'now' | 'soon' | null }.
// A primeira leitura depois de abrir só marca o ponto de partida (não vibra
// porque o ônibus JÁ estava perto: avisa quando ele ENTRA na faixa).
export function decideVibration(memory, reading) {
  const r = reading || {}
  const first = !memory
  const mem = memory ? { vehicle: memory.vehicle, level: memory.level || 0, passed: (memory.passed || []).slice() } : { vehicle: null, level: 0, passed: [] }
  let alert = null
  // "Esse passou": uma vez por chave (veículo + horário).
  if (r.passedKey && mem.passed.indexOf(r.passedKey) < 0) {
    mem.passed.push(r.passedKey)
    if (mem.passed.length > KEEP_PASSED) mem.passed = mem.passed.slice(-KEEP_PASSED)
    if (!first) alert = 'passed'
  }
  const vehicle = r.vehicle === undefined || r.vehicle === null || r.vehicle === '' ? null : String(r.vehicle)
  const level = etaLevel(r.etaMin)
  if (vehicle === null) return { memory: { ...mem, vehicle: null, level: 0 }, alert }
  if (vehicle !== mem.vehicle) {
    // Outro ônibus em destaque: começa do zero (avisa se ele já chega na faixa,
    // exceto na primeira leitura).
    const a = !first && level > 0 ? (level === 2 ? 'now' : 'soon') : null
    return { memory: { ...mem, vehicle, level }, alert: alert || a }
  }
  if (level > mem.level) {
    return { memory: { ...mem, level }, alert: alert || (first ? null : level === 2 ? 'now' : 'soon') }
  }
  // Voltou a subir bastante (trânsito, GPS): libera o aviso de novo.
  const threshold = mem.level === 2 ? NOW_MIN : mem.level === 1 ? SOON_MIN : Infinity
  const n = Number(r.etaMin)
  if (mem.level > 0 && Number.isFinite(n) && n >= threshold + RESET_MIN) {
    return { memory: { ...mem, level }, alert }
  }
  return { memory: mem, alert }
}
