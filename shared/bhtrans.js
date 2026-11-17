// Lógica pura (sem APIs do Zepp OS) para ler o feed de tempo real da BHTrans.
// Fica separada para poder ser testada com `npm test` no Node.
import { lineCodesFor, matchesLine } from './line-codes.js'

// Feed público de posições GPS dos ônibus de BH (dados abertos da PBH).
export const BHTRANS_REALTIME_URL = 'https://temporeal.pbh.gov.br/?param=C'

// Nomes das colunas do CSV. Se a BHTrans mudar o cabeçalho, ajuste aqui.
export const COLUMNS = {
  line: 'NL', // código interno da linha
  vehicle: 'NV', // número do veículo
  lat: 'LT',
  lon: 'LG',
  speed: 'VL', // km/h
  heading: 'DG', // direção em graus (0 = norte), se o feed trouxer
  time: 'HR' // AAAAMMDDhhmmss
}

// Colunas sem as quais o feed não serve para nada.
export const REQUIRED_COLUMNS = [COLUMNS.line, COLUMNS.lat, COLUMNS.lon]

// Feed maior que isso é recusado (o normal fica bem abaixo).
export const MAX_FEED_CHARS = 5 * 1000 * 1000

// Velocidade usada na estimativa quando o ônibus está parado ou sem dado.
const MIN_SPEED_KMH = 15
// Teto da velocidade na estimativa: picos de GPS não viram ETA irreal.
const MAX_SPEED_KMH = 60
// Posição do GPS mais velha que isso é descartada.
export const MAX_AGE_SEC = 10 * 60
// HR vem no horário de Brasília (UTC-3, sem horário de verão desde 2019).
const BRT_OFFSET_HOURS = 3

function toNumber(value) {
  if (value === undefined || value === null) return NaN
  return Number(String(value).trim().replace(',', '.'))
}

export function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return []
  const sep = lines[0].includes(';') ? ';' : ','
  const header = lines[0].split(sep).map((h) => h.trim().toUpperCase())
  return lines.slice(1).map((line) => {
    const cells = line.split(sep)
    const row = {}
    header.forEach((h, i) => {
      row[h] = cells[i] !== undefined ? cells[i].trim() : ''
    })
    return row
  })
}

// true se o texto parece o CSV da BHTrans: tamanho razoável e cabeçalho com NL, LT e LG.
export function isValidFeed(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FEED_CHARS) return false
  const firstLine = text.split(/\r?\n/, 1)[0].trim()
  const sep = firstLine.includes(';') ? ';' : ','
  const header = firstLine.split(sep).map((h) => h.trim().toUpperCase())
  return REQUIRED_COLUMNS.every((c) => header.includes(c))
}

// Confere a resposta do fetch e devolve o corpo; lança erro se não der para usar.
export function readFeedResponse(response) {
  if (!response) throw new Error('Resposta vazia')
  const status = Number(response.status)
  if (!(status >= 200 && status < 300)) throw new Error(`HTTP ${response.status}`)
  const body = response.body
  if (typeof body !== 'string') throw new Error('Corpo não é texto')
  if (body.length > MAX_FEED_CHARS) throw new Error('Corpo grande demais')
  if (!isValidFeed(body)) throw new Error('Formato do feed inesperado')
  return body
}

// Rejeita se a promessa não terminar em `ms` milissegundos.
export function withTimeout(promise, ms) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado (${ms} ms)`)), ms)
  })
  return Promise.race([promise, timeout]).then(
    (v) => {
      clearTimeout(timer)
      return v
    },
    (e) => {
      clearTimeout(timer)
      throw e
    }
  )
}

// Valida os parâmetros de GET_BUSES. Devolve { line, lat, lon } ou null.
export function parseBusParams(params) {
  if (!params || typeof params !== 'object') return null
  const line = typeof params.line === 'string' || typeof params.line === 'number' ? String(params.line).trim() : ''
  const lat = toNumber(params.lat)
  const lon = toNumber(params.lon)
  if (!line || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const out = { line, lat, lon }
  // Opcionais (ponto escolhido na lista do GTFS): sentido (0/1) e id do ponto.
  const dir = params.dir === '' || params.dir === null || params.dir === undefined ? NaN : Number(params.dir)
  if (dir === 0 || dir === 1) out.dir = dir
  const stopId = typeof params.stopId === 'string' || typeof params.stopId === 'number' ? String(params.stopId).trim() : ''
  if (/^[A-Za-z0-9_-]{1,30}$/.test(stopId)) out.stopId = stopId
  return out
}

// AAAAMMDDhhmmss no horário de Brasília -> milissegundos UTC (não depende do fuso do aparelho).
export function parseTimestamp(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value || '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  return Date.UTC(y, mo - 1, d, h + BRT_OFFSET_HOURS, mi, s)
}

// Distância em metros entre dois pontos (fórmula de haversine).
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Devolve os `limit` ônibus da linha que chegam primeiro ao ponto (lat, lon).
// Posições com mais de `maxAgeSec` segundos são descartadas.
// - codes: códigos NL aceitos (padrão: lineCodesFor(line), ver shared/line-codes.js).
// - routeDistance(lat, lon, { speed, heading }): opcional; devolve { toStopM, passed } medido ao longo
//   do trajeto, ou null (ônibus fora da rota: fica a linha reta). Ônibus que já
//   passou do ponto (passed) sai da lista.
export function nearestBuses(rows, { line, codes, lat, lon, now = Date.now(), limit = 3, maxAgeSec = MAX_AGE_SEC, routeDistance = null }) {
  const wanted = Array.isArray(codes) && codes.length > 0 ? codes : lineCodesFor(line)
  const stopLat = toNumber(lat)
  const stopLon = toNumber(lon)
  if (!Number.isFinite(stopLat) || !Number.isFinite(stopLon)) return []
  return rows
    .filter((r) => matchesLine(r[COLUMNS.line], wanted))
    .map((r) => {
      const bLat = toNumber(r[COLUMNS.lat])
      const bLon = toNumber(r[COLUMNS.lon])
      if (!Number.isFinite(bLat) || !Number.isFinite(bLon)) return null
      const ts = parseTimestamp(r[COLUMNS.time])
      const ageSec = ts ? Math.max(0, Math.round((now - ts) / 1000)) : null
      if (ageSec !== null && ageSec > maxAgeSec) return null
      let distance = distanceMeters(stopLat, stopLon, bLat, bLon)
      let alongRoute = false
      if (typeof routeDistance === 'function') {
        const onRoute = routeDistance(bLat, bLon, { speed: toNumber(r[COLUMNS.speed]), heading: toNumber(r[COLUMNS.heading]) })
        if (onRoute && onRoute.passed) return null
        if (onRoute && Number.isFinite(onRoute.toStopM)) {
          distance = onRoute.toStopM
          alongRoute = true
        }
      }
      const speed = toNumber(r[COLUMNS.speed])
      const kmh = Number.isFinite(speed) ? Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, speed)) : MIN_SPEED_KMH
      const bus = {
        vehicle: r[COLUMNS.vehicle] || '?',
        // Posição do ônibus (graus), para o mini mapa do relógio.
        lat: bLat,
        lon: bLon,
        distanceM: Math.round(distance),
        etaMin: Math.max(1, Math.round(distance / 1000 / kmh * 60)),
        ageSec,
        // Velocidade usada na estimativa (VL limitada a 15–60 km/h).
        speedKmh: kmh
      }
      // Distância medida pela rua (ao longo do trajeto), não em linha reta.
      if (alongRoute) bus.alongRoute = true
      return bus
    })
    .filter(Boolean)
    .sort((a, b) => a.etaMin - b.etaMin || a.distanceM - b.distanceM)
    .slice(0, limit)
}

export function formatDistance(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}
