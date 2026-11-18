// Gera as máscaras do mini mapa (assets/common.r/map/mask-<tema>.png): um quadrado
// do tamanho do círculo do mapa, opaco na cor de fundo do tema fora do círculo,
// com o anel fino (cor `divider`) na borda e o centro transparente. Fica por cima
// dos blocos do mapa de ruas e esconde os cantos que saem do círculo.
// Tamanho em px FÍSICOS do Active 3 (466 px de tela, design 480): o círculo do
// mapa tem raio 120 px de design (MAP_RING_R em page/detail) = 116,5 px físicos.
// Uso: node scripts/build-map-masks.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { THEMES } from '../utils/colors.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'assets/common.r/map')
const SCALE = 466 / 480
const RING_R = 120 // px de design
const RING_W = 2

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const rgb = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
const clamp01 = (v) => Math.max(0, Math.min(1, v))

const size = Math.round(2 * RING_R * SCALE)
const outer = (RING_R * SCALE * size) / (2 * RING_R * SCALE) // = size / 2
const inner = (RING_R - RING_W) * SCALE
fs.mkdirSync(outDir, { recursive: true })
for (const name of ['dark', 'light']) {
  const bg = rgb(THEMES[name].bg)
  const ring = rgb(THEMES[name].divider)
  const c = size / 2
  const buf = png(size, (x, y) => {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c)
    // Cobertura suave (anti-serrilhado) de cada faixa.
    const ringA = clamp01(d - inner + 0.5) // 0 dentro, 1 a partir do anel
    const bgA = clamp01(d - outer + 0.5) // 1 fora do círculo
    const col = bg.map((v, i) => Math.round(ring[i] + (v - ring[i]) * bgA))
    return [...col, Math.round(255 * ringA)]
  })
  fs.writeFileSync(path.join(outDir, `mask-${name}.png`), buf)
  console.log(`assets/common.r/map/mask-${name}.png: ${size}x${size}, ${buf.length} bytes`)
}
