// Conversão do número do ônibus (o que aparece no letreiro e no GTFS, ex. "9250")
// para o código interno da linha no feed de tempo real da BHTrans (coluna NL).
//
// O feed não está acessível daqui, então a tabela começa vazia. Para preencher:
//   1. Baixe o CSV de tempo real (https://temporeal.pbh.gov.br/?param=C) com um
//      ônibus da linha rodando e anote o NL dele, ou use a tabela de linhas do
//      conjunto "Tempo Real Ônibus - Coordenada" em dados.pbh.gov.br.
//   2. Acrescente aqui: '9250': ['1234'] (uma linha pode ter vários NL, ex.
//      sublinhas ou um código por sentido).
// Com a tabela preenchida, linha sem entrada não casa com nada: comparar o NL com o número
// mostraria ônibus de outra linha (o NL é um código interno, ex. 6350 -> 4023).
import { INFERRED_LINE_CODES } from './line-codes-data.js'

// Correções manuais têm prioridade sobre a tabela inferida (scripts/infer-line-codes.mjs).
const MANUAL_LINE_CODES = {
  // '9250': ['660'],
}
export const LINE_CODES = Object.freeze({ ...INFERRED_LINE_CODES, ...MANUAL_LINE_CODES })

function clean(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().toUpperCase()
}

// Sem zeros à esquerda: "09250" e "9250" contam como iguais.
function canonical(value) {
  const v = clean(value)
  return /^\d+$/.test(v) ? String(Number(v)) : v
}

// Códigos NL aceitos para uma linha. Sem mapeamento: o próprio número.
export function lineCodesFor(line, table = LINE_CODES) {
  const key = clean(line)
  if (!key) return []
  const mapped = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null
  const list = Array.isArray(mapped) ? mapped : mapped !== null && mapped !== undefined ? [mapped] : []
  const codes = list.map(canonical).filter(Boolean)
  if (codes.length > 0) return codes
  // Tabela vazia (ex. testes): compara direto com o número.
  return table && Object.keys(table).length > 0 ? [] : [canonical(key)]
}

// true se o NL do feed é de uma das linhas pedidas (lista de lineCodesFor).
export function matchesLine(nl, codes) {
  const v = canonical(nl)
  return !!v && Array.isArray(codes) && codes.indexOf(v) >= 0
}
