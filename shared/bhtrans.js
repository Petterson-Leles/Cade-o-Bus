// Lógica pura (sem APIs do Zepp OS) para ler o feed de tempo real da BHTrans.
// Fica separada para poder ser testada com `npm test` no Node.

// Feed público de posições GPS dos ônibus de BH (dados abertos da PBH).
export const BHTRANS_REALTIME_URL = 'https://temporeal.pbh.gov.br/?param=C'

// Nomes das colunas do CSV. Se a BHTrans mudar o cabeçalho, ajuste aqui.
export const COLUMNS = {
  line: 'NL', // código interno da linha
  vehicle: 'NV', // número do veículo
  lat: 'LT',
  lon: 'LG',
  speed: 'VL', // km/h
  time: 'HR' // AAAAMMDDhhmmss
}

// Velocidade usada na estimativa quando o ônibus está parado ou sem dado.
const MIN_SPEED_KMH = 15

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

export function parseTimestamp(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value || '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  return new Date(y, mo - 1, d, h, mi, s).getTime()
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

// Devolve os `limit` ônibus da linha mais próximos do ponto (lat, lon).
export function nearestBuses(rows, { line, lat, lon, now = Date.now(), limit = 3 }) {
  const wanted = String(line).trim()
  const stopLat = toNumber(lat)
  const stopLon = toNumber(lon)
  return rows
    .filter((r) => String(r[COLUMNS.line]).trim() === wanted)
    .map((r) => {
      const bLat = toNumber(r[COLUMNS.lat])
      const bLon = toNumber(r[COLUMNS.lon])
      if (!Number.isFinite(bLat) || !Number.isFinite(bLon)) return null
      const distance = distanceMeters(stopLat, stopLon, bLat, bLon)
      const speed = toNumber(r[COLUMNS.speed])
      const kmh = Number.isFinite(speed) && speed > MIN_SPEED_KMH ? speed : MIN_SPEED_KMH
      const ts = parseTimestamp(r[COLUMNS.time])
      return {
        vehicle: r[COLUMNS.vehicle] || '?',
        distanceM: Math.round(distance),
        etaMin: Math.max(1, Math.round(distance / 1000 / kmh * 60)),
        ageSec: ts ? Math.max(0, Math.round((now - ts) / 1000)) : null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit)
}

export function formatDistance(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}
