// Montagem do pacote de dados GTFS (lógica pura, usada por scripts/build-gtfs.mjs
// e testada em test/gtfs-build.test.mjs). Não lê arquivos: recebe as linhas já lidas.
import { encodePolyline, simplifyLatLon } from './polyline.js'

export const PACKAGE_VERSION = 1
// Tolerância da simplificação do trajeto (metros).
export const DEFAULT_TOLERANCE_M = 8
// Viagens por padrão (linha + sentido + shape) cujas paradas são comparadas.
export const MAX_CANDIDATE_TRIPS = 40

// Uma linha de CSV (RFC 4180, sem quebra de linha dentro de aspas) -> campos.
export function parseCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

// Cabeçalho -> { nomeDaColuna: índice }. Tira o BOM e espaços.
export function headerIndex(line) {
  const idx = {}
  parseCsvLine(String(line).replace(/^﻿/, '')).forEach((h, i) => {
    idx[h.trim()] = i
  })
  return idx
}

// Mais frequente de um Map(valor -> contagem). Empate: menor valor (resultado estável).
export function mostCommon(counts) {
  let best = null
  let bestN = -1
  counts.forEach((n, key) => {
    if (n > bestN || (n === bestN && String(key) < String(best))) {
      best = key
      bestN = n
    }
  })
  return best
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

// Viagens -> um padrão por (route_id, direction_id): o shape mais usado, o
// headsign mais comum do sentido e as viagens candidatas daquele shape.
// trips: [{ route_id, direction_id, shape_id, trip_headsign, trip_id }]
export function selectPatterns(trips, maxCandidates = MAX_CANDIDATE_TRIPS) {
  const groups = new Map()
  trips.forEach((t) => {
    const dir = String(t.direction_id || '0').trim() || '0'
    const key = `${t.route_id}|${dir}`
    let g = groups.get(key)
    if (!g) {
      g = { routeId: t.route_id, dir: Number(dir) || 0, shapes: new Map(), heads: new Map(), tripsByShape: new Map() }
      groups.set(key, g)
    }
    const shape = String(t.shape_id || '').trim()
    bump(g.shapes, shape)
    const head = String(t.trip_headsign || '').trim()
    if (head) bump(g.heads, head)
    if (!g.tripsByShape.has(shape)) g.tripsByShape.set(shape, [])
    g.tripsByShape.get(shape).push(t.trip_id)
  })
  const patterns = new Map()
  groups.forEach((g, key) => {
    const shapeId = mostCommon(g.shapes)
    const ids = g.tripsByShape.get(shapeId).slice().sort()
    patterns.set(key, {
      key,
      routeId: g.routeId,
      dir: g.dir,
      shapeId,
      headsign: mostCommon(g.heads) || '',
      tripCount: g.shapes.get(shapeId),
      candidateTrips: ids.slice(0, maxCandidates)
    })
  })
  return patterns
}

// Sequências de stop_ids das viagens candidatas -> a mais frequente
// (empate: a mais longa; depois a primeira).
export function chooseStopSequence(sequences) {
  const counts = new Map()
  const first = new Map()
  sequences.forEach((seq, i) => {
    if (!seq || seq.length === 0) return
    const k = seq.join(',')
    bump(counts, k)
    if (!first.has(k)) first.set(k, i)
  })
  let best = null
  counts.forEach((n, k) => {
    if (!best) {
      best = k
      return
    }
    const bn = counts.get(best)
    const len = k.split(',').length
    const blen = best.split(',').length
    if (n > bn || (n === bn && (len > blen || (len === blen && first.get(k) < first.get(best))))) best = k
  })
  return best ? best.split(',') : []
}

// stop_times de uma viagem: [{ stop_id, stop_sequence }] em qualquer ordem -> stop_ids em ordem.
export function orderStops(rows) {
  return rows
    .slice()
    .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    .map((r) => String(r.stop_id))
}

// Comparação "natural" de números de linha: 101 < 9250 < SC03A.
export function compareLineNumbers(a, b) {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

const round5 = (v) => Math.round(Number(v) * 1e5)

// Junta tudo no pacote final. Devolve { index, shapes, stats }.
// - routes: [{ route_id, route_short_name, route_long_name }]
// - patterns: saída de selectPatterns
// - shapes: Map(shape_id -> [[lat, lon], ...]) já em ordem
// - stopSeqs: Map(chave do padrão -> [stop_id, ...])
// - stops: Map(stop_id -> { name, lat, lon })
export function buildPackage({ feed = {}, routes, patterns, shapes, stopSeqs, stops, toleranceM = DEFAULT_TOLERANCE_M }) {
  const usedStops = new Set()
  const lines = []
  const shapeOut = {}
  let rawPoints = 0
  let keptPoints = 0
  const byRoute = new Map()
  patterns.forEach((p) => {
    if (!byRoute.has(p.routeId)) byRoute.set(p.routeId, [])
    byRoute.get(p.routeId).push(p)
  })
  routes.forEach((r) => {
    const number = String(r.route_short_name || '').trim()
    const pats = (byRoute.get(r.route_id) || []).slice().sort((a, b) => a.dir - b.dir)
    if (!number || pats.length === 0) return
    const dirs = []
    pats.forEach((p) => {
      const seq = (stopSeqs.get(p.key) || []).filter((id) => stops.has(id))
      const pts = shapes.get(p.shapeId) || []
      if (seq.length === 0 && pts.length < 2) return
      seq.forEach((id) => usedStops.add(id))
      dirs.push({ dir: p.dir, headsign: p.headsign, seq })
      if (pts.length >= 2) {
        const simple = simplifyLatLon(pts, toleranceM)
        rawPoints += pts.length
        keptPoints += simple.length
        shapeOut[`${number}|${p.dir}`] = encodePolyline(simple)
      }
    })
    if (dirs.length > 0) lines.push({ number, name: String(r.route_long_name || '').trim(), dirs })
  })
  lines.sort((a, b) => compareLineNumbers(a.number, b.number))

  // Tabela de pontos (só os usados), ordenada por id; as linhas apontam por índice.
  const ids = Array.from(usedStops).sort((a, b) => compareLineNumbers(a, b))
  const pos = new Map(ids.map((id, i) => [id, i]))
  const table = { id: [], name: [], lat: [], lon: [] }
  ids.forEach((id) => {
    const s = stops.get(id)
    table.id.push(id)
    table.name.push(String(s.name || '').trim())
    table.lat.push(round5(s.lat))
    table.lon.push(round5(s.lon))
  })

  const index = {
    v: PACKAGE_VERSION,
    feed: String(feed.feed_version || ''),
    until: String(feed.feed_end_date || ''),
    stops: table,
    // [número, nome, [[sentido, headsign, [índices dos pontos]], ...]]
    lines: lines.map((l) => [l.number, l.name, l.dirs.map((d) => [d.dir, d.headsign, d.seq.map((id) => pos.get(id))])])
  }
  return {
    index,
    shapes: { v: PACKAGE_VERSION, feed: index.feed, shapes: shapeOut },
    stats: { lines: lines.length, stops: ids.length, rawPoints, keptPoints }
  }
}

// Objeto -> texto de um módulo ES (export default).
export function toModule(obj, comment) {
  const head = comment ? `// ${comment.split('\n').join('\n// ')}\n` : ''
  return `${head}export default ${JSON.stringify(obj)}\n`
}
