// Lista da tela inicial do relógio (sem APIs do relógio, testada no Node em
// test/home-list.test.mjs): qual ponto vai no cartão e as cores do selo da linha.

// Índice do ponto cujo ônibus chega primeiro (menor minuto; empate = o primeiro
// da lista). Sem nenhum tempo válido: -1 (nenhum cartão).
export function nearestIndex(etas) {
  let best = -1
  ;(Array.isArray(etas) ? etas : []).forEach((m, i) => {
    if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return
    if (best < 0 || m < etas[best]) best = i
  })
  return best
}

// Selo da linha: cheio no cartão destacado, suave (fundo misturado) nos outros.
export function chipColors(colors, highlighted) {
  return highlighted ? { bg: colors.chip, text: colors.chipText } : { bg: colors.chipSoft, text: colors.chipSoftText }
}
