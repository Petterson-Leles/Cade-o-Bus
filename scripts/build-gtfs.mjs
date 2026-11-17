#!/usr/bin/env node
// Gera o pacote compacto de linhas, pontos e trajetos a partir do GTFS oficial de BH.
//
//   node scripts/build-gtfs.mjs [caminho/do/gtfs.zip] [pasta/de/saída]
//
// Padrões: data-src/gtfs-bh.zip -> data/. Lê o zip direto (stop_times.txt tem
// ~475 MB descompactado e é lido em streaming, sem extrair nada no disco).
// Só usa módulos do Node (sem dependências). Saída:
//   data/gtfs-index.js  -> linhas, sentidos, sequência de pontos e tabela de pontos
//   data/gtfs-shapes.js -> trajeto simplificado (polyline codificada) por linha e sentido
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  parseCsvLine,
  headerIndex,
  selectPatterns,
  chooseStopSequence,
  orderStops,
  buildPackage,
  toModule,
  DEFAULT_TOLERANCE_M
} from '../shared/gtfs-build.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const zipPath = path.resolve(process.argv[2] || path.join(root, 'data-src/gtfs-bh.zip'))
const outDir = path.resolve(process.argv[3] || path.join(root, 'data'))

// ---- Leitura mínima de zip (diretório central + deflate), sem zip64 ----
function listZip(file) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const tailLen = Math.min(size, 65557)
  const tail = Buffer.alloc(tailLen)
  fs.readSync(fd, tail, 0, tailLen, size - tailLen)
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Zip sem diretório central')
  const count = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOff = tail.readUInt32LE(eocd + 16)
  const cd = Buffer.alloc(cdSize)
  fs.readSync(fd, cd, 0, cdSize, cdOff)
  const entries = new Map()
  let p = 0
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Diretório central inválido')
    const method = cd.readUInt16LE(p + 10)
    const compSize = cd.readUInt32LE(p + 20)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const localOff = cd.readUInt32LE(p + 42)
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compSize, localOff })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { fd, entries }
}

function openEntry(zip, file, name) {
  const e = zip.entries.get(name)
  if (!e) throw new Error(`${name} não está no zip`)
  const head = Buffer.alloc(30)
  fs.readSync(zip.fd, head, 0, 30, e.localOff)
  const start = e.localOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const raw = fs.createReadStream(file, { start, end: start + e.compSize - 1, highWaterMark: 1 << 20 })
  if (e.method === 0) return raw
  if (e.method !== 8) throw new Error(`Compressão ${e.method} não suportada`)
  return raw.pipe(zlib.createInflateRaw({ chunkSize: 1 << 20 }))
}

// Lê um CSV do zip linha a linha; onRow(campos, idx) para cada linha de dados.
async function eachRow(zip, name, onRow) {
  const rl = readline.createInterface({ input: openEntry(zip, zipPath, name), crlfDelay: Infinity })
  let idx = null
  for await (const line of rl) {
    if (idx === null) {
      idx = headerIndex(line)
      continue
    }
    if (line) onRow(line, idx)
  }
  return idx
}

async function readTable(zip, name) {
  const rows = []
  await eachRow(zip, name, (line, idx) => {
    const f = parseCsvLine(line)
    const o = {}
    for (const k in idx) o[k] = f[idx[k]] !== undefined ? f[idx[k]] : ''
    rows.push(o)
  })
  return rows
}

async function main() {
  const t0 = Date.now()
  if (!fs.existsSync(zipPath)) throw new Error(`Não achei ${zipPath}`)
  const zip = listZip(zipPath)
  const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${msg}`)

  const feed = (await readTable(zip, 'feed_info.txt'))[0] || {}
  const routes = await readTable(zip, 'routes.txt')
  const trips = await readTable(zip, 'trips.txt')
  log(`${routes.length} linhas, ${trips.length} viagens`)

  const patterns = selectPatterns(trips)
  const wantedShapes = new Set()
  const tripToPattern = new Map()
  patterns.forEach((p) => {
    wantedShapes.add(p.shapeId)
    p.candidateTrips.forEach((id) => tripToPattern.set(id, p.key))
    // Variantes (outros shapes do mesmo sentido): também os trajetos e as paradas.
    p.variants.forEach((v) => {
      wantedShapes.add(v.shapeId)
      v.candidateTrips.forEach((id) => tripToPattern.set(id, v.key))
    })
  })
  log(`${patterns.size} padrões (linha + sentido)`)

  // Trajetos: só os shapes escolhidos.
  const shapeRows = new Map()
  await eachRow(zip, 'shapes.txt', (line, idx) => {
    const f = parseCsvLine(line)
    const id = f[idx.shape_id]
    if (!wantedShapes.has(id)) return
    if (!shapeRows.has(id)) shapeRows.set(id, [])
    shapeRows.get(id).push([Number(f[idx.shape_pt_sequence]), Number(f[idx.shape_pt_lat]), Number(f[idx.shape_pt_lon])])
  })
  const shapes = new Map()
  shapeRows.forEach((rows, id) => {
    rows.sort((a, b) => a[0] - b[0])
    shapes.set(id, rows.filter((r) => Number.isFinite(r[1]) && Number.isFinite(r[2])).map((r) => [r[1], r[2]]))
  })
  log(`${shapes.size} trajetos lidos`)

  // stop_times em streaming: guarda só as viagens candidatas.
  const tripStops = new Map()
  let n = 0
  await eachRow(zip, 'stop_times.txt', (line, idx) => {
    n++
    // Atalho: o trip_id é o 1º campo; só faz o parse completo das candidatas.
    const comma = line.indexOf(',')
    const quick = line[0] === '"' ? null : line.slice(0, comma)
    if (quick !== null && idx.trip_id === 0 && !tripToPattern.has(quick)) return
    const f = parseCsvLine(line)
    const trip = f[idx.trip_id]
    if (!tripToPattern.has(trip)) return
    if (!tripStops.has(trip)) tripStops.set(trip, [])
    tripStops.get(trip).push({ stop_id: f[idx.stop_id], stop_sequence: f[idx.stop_sequence] })
  })
  log(`${n} stop_times lidos, ${tripStops.size} viagens candidatas`)

  const stopSeqs = new Map()
  patterns.forEach((p) => {
    const seqs = p.candidateTrips.map((id) => (tripStops.has(id) ? orderStops(tripStops.get(id)) : []))
    stopSeqs.set(p.key, chooseStopSequence(seqs))
    p.variants.forEach((v) => {
      const vs = v.candidateTrips.map((id) => (tripStops.has(id) ? orderStops(tripStops.get(id)) : []))
      stopSeqs.set(v.key, chooseStopSequence(vs))
    })
  })

  const stops = new Map()
  ;(await readTable(zip, 'stops.txt')).forEach((s) => {
    const lat = Number(s.stop_lat)
    const lon = Number(s.stop_lon)
    if (s.stop_id && Number.isFinite(lat) && Number.isFinite(lon)) stops.set(s.stop_id, { name: s.stop_name, lat, lon })
  })
  fs.closeSync(zip.fd)

  const { index, shapes: shapePkg, stats } = buildPackage({ feed, routes, patterns, shapes, stopSeqs, stops, toleranceM: DEFAULT_TOLERANCE_M })
  const credit =
    'Gerado por scripts/build-gtfs.mjs a partir do GTFS oficial de Belo Horizonte\n' +
    `(SUMOB/PBH, publicado por ${feed.feed_publisher_name || 'Bus2'}; versão ${index.feed}, válido até ${index.until}).\n` +
    'Não edite à mão: rode `npm run build:data`.'
  fs.mkdirSync(outDir, { recursive: true })
  const files = {
    'gtfs-index.js': toModule(index, credit),
    'gtfs-shapes.js': toModule(shapePkg, credit)
  }
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(outDir, name)
    fs.writeFileSync(file, text)
    const gz = zlib.gzipSync(text).length
    log(`${path.relative(root, file)}: ${(text.length / 1024).toFixed(0)} KB (gzip ${(gz / 1024).toFixed(0)} KB)`)
  }
  log(`${stats.lines} linhas, ${stats.stops} pontos, trajetos ${stats.rawPoints} -> ${stats.keptPoints} vértices (DP ${DEFAULT_TOLERANCE_M} m), ${stats.variants} variantes`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
