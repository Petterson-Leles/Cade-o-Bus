// Cálculos puros da tela do ponto (sem APIs do relógio), testados no Node.
import { formatDistance } from '../shared/bhtrans.js'
import { sanitizeMapPayload } from '../shared/route-map.js'

// Metros por grau de latitude (aproximação esférica, boa para alguns km).
const M_PER_DEG = 111320

// Escala fixa do mini mapa e raio máximo (em pixels de design, antes do px()).
export const MAP_PX_PER_KM = 90
export const MAP_MAX_R = 100

function num(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(String(v).trim().replace(',', '.'))
}

// Deslocamento do ônibus em relação ao ponto, em pixels de tela:
// dx > 0 = leste (direita), dy > 0 = sul (para baixo). Fica limitado ao
// círculo de raio maxR (clamped = true quando foi puxado para a borda).
// Devolve null se faltar coordenada.
export function mapOffset(stop, bus, { pxPerKm = MAP_PX_PER_KM, maxR = MAP_MAX_R } = {}) {
  if (!stop || !bus) return null
  const sLat = num(stop.lat)
  const sLon = num(stop.lon)
  const bLat = num(bus.lat)
  const bLon = num(bus.lon)
  if (![sLat, sLon, bLat, bLon].every(Number.isFinite)) return null
  const northM = (bLat - sLat) * M_PER_DEG
  const eastM = (bLon - sLon) * M_PER_DEG * Math.cos((sLat * Math.PI) / 180)
  let dx = (eastM / 1000) * pxPerKm
  let dy = (-northM / 1000) * pxPerKm
  const r = Math.sqrt(dx * dx + dy * dy)
  const clamped = r > maxR
  if (clamped) {
    dx = (dx / r) * maxR
    dy = (dy / r) * maxR
  }
  return { dx: Math.round(dx) || 0, dy: Math.round(dy) || 0, clamped }
}

// Tamanho da fonte do número grande para caber na coluna da esquerda (170 px).
export function etaFontSize(min) {
  const digits = String(min).length
  if (digits <= 1) return 160
  if (digits === 2) return 120
  return 84
}

// Linha de baixo: "1,2 km · depois 11 e 19 min".
export function infoLine(first, rest) {
  const p = infoParts(first, rest)
  return p.dist ? `${p.dist} · ${p.next}` : ''
}

// A mesma informação em duas linhas (a coluna da esquerda é estreita):
// { dist: '1,2 km', next: 'depois 11 e 19 min' }.
export function infoParts(first, rest) {
  if (!first) return { dist: '', next: '' }
  const dist = formatDistance(first.distanceM)
  const next = (rest || []).slice(0, 2).map((b) => b.etaMin)
  if (next.length === 0) return { dist, next: `ônibus ${first.vehicle}` }
  if (next.length === 1) return { dist, next: `depois ${next[0]} min` }
  return { dist, next: `depois ${next[0]} e ${next[1]} min` }
}

// Resposta de GET_BUSES -> { buses, map }. Aceita o formato antigo (só a lista).
// map passa por sanitizeMapPayload (números inteiros em faixa segura) ou vira null.
export function parseBusesResult(result) {
  if (Array.isArray(result)) return { buses: result, map: null }
  if (!result || typeof result !== 'object') return { buses: [], map: null }
  return {
    buses: Array.isArray(result.buses) ? result.buses : [],
    map: sanitizeMapPayload(result.map)
  }
}
