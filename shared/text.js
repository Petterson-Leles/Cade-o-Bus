// Textos curtos usados no relógio e na tela de configurações (lógica pura,
// testada em test/text.test.mjs).

// Prefixos de logradouro abreviados (só no começo do nome) e palavras do meio.
const PREFIXES = [
  [/^Avenida\s+/i, 'Av. '],
  [/^Rua\s+/i, 'R. '],
  [/^Rodovia\s+/i, 'Rod. '],
  [/^Praça\s+/i, 'Pç. '],
  [/^Estação\s+/i, 'Est. '],
  [/^Alameda\s+/i, 'Al. '],
  [/^Viaduto\s+/i, 'Vd. '],
  [/^Travessa\s+/i, 'Tv. ']
]
const WORDS = [
  [/\sPresidente\s/g, ' Pres. '],
  [/\sDoutor\s/g, ' Dr. '],
  [/\sProfessor\s/g, ' Prof. '],
  [/\sSenador\s/g, ' Sen. ']
]

// "Avenida Presidente Antônio Carlos, 123" -> "Av. Pres. Antônio Carlos, 123".
export function abbreviateStreet(name) {
  if (typeof name !== 'string') return ''
  let s = name.trim().replace(/\s+/g, ' ')
  for (const [re, to] of PREFIXES) {
    if (re.test(s)) {
      s = s.replace(re, to)
      break
    }
  }
  s = ` ${s} `
  WORDS.forEach(([re, to]) => {
    s = s.replace(re, to)
  })
  return s.trim()
}

// Sem acentos e em maiúsculas, para comparar buscas ("são josé" == "SAO JOSE").
export function foldText(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return s.toUpperCase().replace(/\s+/g, ' ').trim()
}

// "Estação Barreiro (Principal)" -> "Para Estação Barreiro".
export function directionTitle(headsign) {
  const h = String(headsign === undefined || headsign === null ? '' : headsign)
    .replace(/\s*\(Principal\)\s*/gi, ' ')
    .trim()
  return h ? `Para ${h}` : 'Sentido único'
}

// Saudação pela hora local (0–23).
export function greeting(hour) {
  const h = Number(hour)
  if (!Number.isFinite(h) || h < 12) return 'Bom dia!'
  if (h < 18) return 'Boa tarde!'
  return 'Boa noite!'
}

// Rodapé da tela do ponto: "zoom automático · 700 m por 100 px".
export function scaleLabel(pxPerKm, auto) {
  const k = Number(pxPerKm)
  const mode = auto ? 'zoom automático' : 'zoom manual'
  if (!(k > 0)) return mode
  const per100 = k >= 100 ? `${Math.round(100000 / k)} m` : `${(100 / k).toFixed(1).replace('.', ',')} km`
  return `${mode} · ${per100} por 100 px`
}
