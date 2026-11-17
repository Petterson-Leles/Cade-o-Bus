// Consultas ao pacote de dados GTFS (data/gtfs-index.js e data/gtfs-shapes.js).
// Lógica pura: roda na tela de configurações (celular), no side service e no Node.
import { decodePolyline } from './polyline.js'

// Número da linha como o usuário digita: "  9250 " -> "9250", "sc03a" -> "SC03A".
export function normalizeLineNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().toUpperCase().replace(/\s+/g, '')
}

// Índices em memória, feitos uma vez por pacote (o objeto do pacote é a chave).
const cache = typeof WeakMap === 'function' ? new WeakMap() : null

function lookup(index) {
  if (!index || !index.stops || !Array.isArray(index.lines)) return null
  let c = cache && cache.get(index)
  if (!c) {
    c = { lines: new Map(), stops: new Map() }
    index.lines.forEach((l, i) => c.lines.set(normalizeLineNumber(l[0]), i))
    index.stops.id.forEach((id, i) => c.stops.set(String(id), i))
    if (cache) cache.set(index, c)
  }
  return c
}

function stopAt(index, i) {
  const s = index.stops
  if (!(i >= 0 && i < s.id.length)) return null
  return { id: String(s.id[i]), name: s.name[i], lat: s.lat[i] / 1e5, lon: s.lon[i] / 1e5 }
}

// Linha pelo número -> { number, name, dirs: [{ dir, headsign, stops }] } ou null.
export function findLine(index, number) {
  const c = lookup(index)
  const key = normalizeLineNumber(number)
  if (!c || !key || !c.lines.has(key)) return null
  const [num, name, dirs] = index.lines[c.lines.get(key)]
  return {
    number: num,
    name,
    dirs: dirs.map(([dir, headsign, seq]) => ({ dir, headsign, stops: seq.length }))
  }
}

function findDir(index, number, dir) {
  const c = lookup(index)
  const key = normalizeLineNumber(number)
  if (!c || !key || !c.lines.has(key)) return null
  const d = Number(dir)
  return index.lines[c.lines.get(key)][2].find((x) => x[0] === d) || null
}

// Pontos da linha naquele sentido, na ordem da viagem: [{ id, name, lat, lon, seq }].
export function lineStops(index, number, dir) {
  const d = findDir(index, number, dir)
  if (!d) return []
  return d[2].map((i, seq) => ({ ...stopAt(index, i), seq: seq + 1 })).filter((s) => s.id)
}

export function stopById(index, id) {
  const c = lookup(index)
  if (!c || id === undefined || id === null) return null
  const i = c.stops.get(String(id).trim())
  return i === undefined ? null : stopAt(index, i)
}

// Trajeto da linha naquele sentido: [[lat, lon], ...] (vazio se não houver).
export function lineShape(shapesPkg, number, dir) {
  const map = shapesPkg && shapesPkg.shapes
  if (!map) return []
  const key = `${normalizeLineNumber(number)}|${Number(dir)}`
  return Object.prototype.hasOwnProperty.call(map, key) ? decodePolyline(map[key]) : []
}

// Busca linhas pelo começo do número (para sugerir enquanto digita): ["9250", ...].
export function searchLines(index, prefix, limit = 8) {
  const key = normalizeLineNumber(prefix)
  if (!index || !Array.isArray(index.lines) || !key) return []
  const out = []
  for (let i = 0; i < index.lines.length && out.length < limit; i++) {
    const [num, name] = index.lines[i]
    if (normalizeLineNumber(num).startsWith(key)) out.push({ number: num, name })
  }
  return out
}
