// Lógica do formulário de configurações (sem APIs do Zepp OS), testada em test/settings-form.test.mjs.
//
// Dois jeitos de cadastrar um ponto:
// - pela lista (padrão): número da linha -> sentido (headsign) -> ponto da linha,
//   tudo do pacote GTFS (data/gtfs-index.js). Guarda line, dir, stopId, name, lat, lon.
// - avançado (draft.manual): nome, linha, latitude e longitude digitados.
import { MAX_TEXT_LEN } from '../utils/favorites.js'
import { findLine, lineStops, stopById, normalizeLineNumber, searchLines } from './gtfs.js'

// Campos do modo avançado (manual).
export const DRAFT_FIELDS = [
  { key: 'name', label: 'Nome do ponto', placeholder: 'Ex.: Casa' },
  { key: 'line', label: 'Número da linha', placeholder: 'Ex.: 9250' },
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

// Valor que o Select devolve: texto, número ou { value }.
export function selectValue(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value.value : value
  return v === undefined || v === null ? '' : String(v).trim()
}

// Aplica a edição de um campo ao rascunho. Colar "lat, lon" no campo de latitude
// (ou de longitude) preenche os dois. Trocar a linha limpa sentido e ponto;
// trocar o sentido limpa o ponto.
export function applyDraftChange(draft, key, value) {
  const base = draft && typeof draft === 'object' ? draft : {}
  if (key === 'manual') return { ...base, manual: value === true }
  const text = key === 'dir' || key === 'stopId' ? selectValue(value) : String(value === undefined || value === null ? '' : value).trim()
  if (key === 'lat' || key === 'lon') {
    const pair = splitLatLon(text)
    if (pair) return { ...base, lat: pair.lat, lon: pair.lon }
  }
  if (key === 'line') {
    const next = { ...base, line: text }
    if (normalizeLineNumber(text) !== normalizeLineNumber(base.line)) {
      delete next.dir
      delete next.stopId
    }
    return next
  }
  if (key === 'dir') {
    const next = { ...base, dir: text }
    if (text !== String(base.dir === undefined ? '' : base.dir)) delete next.stopId
    return next
  }
  return { ...base, [key]: text }
}

// Sentido válido do rascunho (0/1) ou null.
function draftDir(draft) {
  const t = String(draft && draft.dir !== undefined && draft.dir !== null ? draft.dir : '').trim()
  return t === '0' || t === '1' ? Number(t) : null
}

// O que a tela mostra para o rascunho atual (modo lista):
// { line, suggestions, dirOptions, dir, stopOptions, stop }.
// Com um sentido só, ele já vem escolhido.
export function draftChoices(draft, index) {
  const d = draft || {}
  const out = { line: null, suggestions: [], dirOptions: [], dir: null, stopOptions: [], stop: null }
  const typed = normalizeLineNumber(d.line)
  if (!typed) return out
  const line = findLine(index, typed)
  if (!line) {
    out.suggestions = searchLines(index, typed, 6)
    return out
  }
  out.line = line
  out.dirOptions = line.dirs.map((x) => ({ name: `Sentido ${x.headsign || x.dir}`, value: String(x.dir) }))
  let dir = draftDir(d)
  if (dir === null && line.dirs.length === 1) dir = line.dirs[0].dir
  if (dir === null || !line.dirs.some((x) => x.dir === dir)) return out
  out.dir = dir
  const stops = lineStops(index, line.number, dir)
  out.stopOptions = stops.map((st) => ({ name: `${st.seq}. ${st.name}`, value: st.id }))
  const wanted = String(d.stopId || '').trim()
  out.stop = stops.find((st) => st.id === wanted) || null
  return out
}

// Problemas do rascunho (vazia = pode salvar). Sem índice ou no modo avançado,
// vale a validação manual (validate).
export function validateDraft(draft, index) {
  const d = draft || {}
  if (d.manual || !index) {
    const errors = validate(d)
    const dirText = String(d.dir === undefined || d.dir === null ? '' : d.dir).trim()
    if (dirText && draftDir(d) === null) errors.push('Sentido inválido.')
    return errors
  }
  const errors = []
  const typed = normalizeLineNumber(d.line)
  if (!typed) return ['Preencha "Número da linha".']
  if (String(d.name || '').trim().length > MAX_TEXT_LEN) {
    errors.push(`"Nome do ponto" pode ter no máximo ${MAX_TEXT_LEN} caracteres.`)
  }
  const c = draftChoices(d, index)
  if (!c.line) {
    errors.push(`Linha ${typed} não encontrada na lista de linhas de BH. Confira o número ou use a opção avançada.`)
    return errors
  }
  if (c.dir === null) errors.push('Escolha o sentido.')
  else if (!c.stop) errors.push('Escolha o ponto na lista.')
  return errors
}

// Rascunho válido -> favorito { id, name, line, lat, lon, dir?, stopId? }.
// Sem índice ou no modo avançado: os campos digitados (o sentido vai junto se escolhido).
export function buildFavorite(draft, id, index) {
  const d = draft || {}
  if (d.manual || !index) {
    const fav = {
      id,
      name: String(d.name).trim(),
      line: String(d.line).trim(),
      lat: String(toCoord(d.lat)),
      lon: String(toCoord(d.lon))
    }
    const dir = draftDir(d)
    if (dir !== null) fav.dir = dir
    return fav
  }
  const c = draftChoices(d, index)
  const stop = c.stop || stopById(index, d.stopId)
  const name = String(d.name || '').trim() || stop.name
  return {
    id,
    name: name.slice(0, MAX_TEXT_LEN).trim(),
    line: c.line.number,
    dir: c.dir,
    stopId: stop.id,
    lat: String(stop.lat),
    lon: String(stop.lon)
  }
}
