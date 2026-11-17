// Lógica do formulário de configurações (sem APIs do Zepp OS), testada em test/settings-form.test.mjs.
import { MAX_TEXT_LEN } from '../utils/favorites.js'

export const DRAFT_FIELDS = [
  { key: 'name', label: 'Nome do ponto', placeholder: 'Ex.: Casa' },
  { key: 'line', label: 'Código da linha BHTrans (campo NL)', placeholder: 'Ex.: 1234' },
  { key: 'lat', label: 'Latitude do ponto', placeholder: 'Ex.: -19.9191 (ou cole "lat, lon")' },
  { key: 'lon', label: 'Longitude do ponto', placeholder: 'Ex.: -43.9386' }
]

// Região plausível de BH e arredores.
export const BH_BOUNDS = { minLat: -20.3, maxLat: -19.5, minLon: -44.4, maxLon: -43.5 }

export function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return fallback
    const value = JSON.parse(raw)
    return value === null || value === undefined ? fallback : value
  } catch (e) {
    return fallback
  }
}

export function toCoord(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) return NaN
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// "lat, lon" copiado do Google Maps (ex.: "-19.919100, -43.938600") -> { lat, lon }.
// Também aceita separar por espaço ou ";". Devolve null se não for um par.
export function splitLatLon(value) {
  const text = String(value || '').trim().replace(/^\(|\)$/g, '').trim()
  const num = '(-?\\d{1,3}(?:[.,]\\d+)?)'
  const dotNum = '(-?\\d{1,3}\\.\\d+)'
  const m =
    new RegExp(`^${dotNum}\\s*,\\s*${dotNum}$`).exec(text) ||
    new RegExp(`^${num}\\s*[;\\s]\\s*${num}$`).exec(text)
  if (!m) return null
  return { lat: m[1].replace(',', '.'), lon: m[2].replace(',', '.') }
}

const inRange = (n, min, max) => n >= min && n <= max

// Devolve a lista de problemas do rascunho (vazia = pode salvar).
export function validate(draft) {
  const d = draft || {}
  const errors = []
  DRAFT_FIELDS.forEach((f) => {
    if (!String(d[f.key] || '').trim()) errors.push(`Preencha "${f.label}".`)
  })
  ;['name', 'line'].forEach((key) => {
    if (String(d[key] || '').trim().length > MAX_TEXT_LEN) {
      const label = DRAFT_FIELDS.find((f) => f.key === key).label
      errors.push(`"${label}" pode ter no máximo ${MAX_TEXT_LEN} caracteres.`)
    }
  })
  const lat = toCoord(d.lat)
  const lon = toCoord(d.lon)
  const latOk = Number.isFinite(lat) && inRange(lat, BH_BOUNDS.minLat, BH_BOUNDS.maxLat)
  const lonOk = Number.isFinite(lon) && inRange(lon, BH_BOUNDS.minLon, BH_BOUNDS.maxLon)
  if (d.lat && d.lon && !latOk && !lonOk &&
      inRange(lat, BH_BOUNDS.minLon, BH_BOUNDS.maxLon) && inRange(lon, BH_BOUNDS.minLat, BH_BOUNDS.maxLat)) {
    errors.push('Latitude e longitude parecem trocadas: em BH a latitude fica perto de -19,9 e a longitude perto de -43,9.')
    return errors
  }
  if (d.lat && !Number.isFinite(lat)) {
    errors.push('Latitude inválida: use número com ponto, ex.: -19.9191.')
  } else if (d.lat && !latOk) {
    errors.push('Latitude fora de BH: deve ficar entre -20.3 e -19.5.')
  }
  if (d.lon && !Number.isFinite(lon)) {
    errors.push('Longitude inválida: use número com ponto, ex.: -43.9386.')
  } else if (d.lon && !lonOk) {
    errors.push('Longitude fora de BH: deve ficar entre -44.4 e -43.5.')
  }
  return errors
}

// Aplica a edição de um campo ao rascunho. Colar "lat, lon" no campo de latitude
// (ou de longitude) preenche os dois.
export function applyDraftChange(draft, key, value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (key === 'lat' || key === 'lon') {
    const pair = splitLatLon(text)
    if (pair) return { ...draft, lat: pair.lat, lon: pair.lon }
  }
  return { ...draft, [key]: text }
}

export function buildFavorite(draft, id) {
  return {
    id,
    name: String(draft.name).trim(),
    line: String(draft.line).trim(),
    lat: String(toCoord(draft.lat)),
    lon: String(toCoord(draft.lon))
  }
}
