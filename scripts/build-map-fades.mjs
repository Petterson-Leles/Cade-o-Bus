// Gera as faixas de transição do mapa da tela do ponto (assets/common.r/map/):
// PNG RGBA na cor de fundo de cada tema com alpha em gradiente (opaco -> transparente).
// - fade-<tema>.png: borda esquerda do mapa (FADE_W x 480), por cima dos blocos e
//   do trajeto e embaixo dos textos, para a coluna de informações ficar legível;
// - fade-top-<tema>.png / fade-bottom-<tema>.png: topo e base do mapa, mais leves.
// Tamanho em px de design (o IMG usa auto_scale com w/h em px()).
// Uso: node scripts/build-map-fades.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { THEMES } from '../utils/colors.js'
import { FADE_W, FADE_TOP_H, FADE_BOTTOM_H, MAP_RECT, SCREEN } from '../shared/detail-layout.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'assets/common.r/map')

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

export function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const rgb = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
// t de 0 (borda opaca) a 1 (transparente): curva suave (smoothstep invertido).
export const fadeAlpha = (t, max = 1) => {
  const u = Math.max(0, Math.min(1, t))
  return Math.round(255 * max * (1 - u * u * (3 - 2 * u)))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const name of ['dark', 'light']) {
    const bg = rgb(THEMES[name].bg)
    const files = [
      [`fade-${name}.png`, png(FADE_W, SCREEN, (x) => [...bg, fadeAlpha((x + 0.5) / FADE_W)])],
      [`fade-top-${name}.png`, png(MAP_RECT.w, FADE_TOP_H, (x, y) => [...bg, fadeAlpha((y + 0.5) / FADE_TOP_H, 0.85)])],
      [`fade-bottom-${name}.png`, png(MAP_RECT.w, FADE_BOTTOM_H, (x, y) => [...bg, fadeAlpha(1 - (y + 0.5) / FADE_BOTTOM_H, 0.85)])]
    ]
    files.forEach(([file, buf]) => {
      fs.writeFileSync(path.join(outDir, file), buf)
      console.log(`assets/common.r/map/${file}: ${buf.length} bytes`)
    })
  }
}
