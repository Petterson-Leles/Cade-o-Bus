import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseManifest,
  compactManifest,
  parseCompactManifest,
  compactTotal,
  tileList,
  tileIndex,
  tileFileName,
  watchTilePath,
  emptyBits,
  normalizeBits,
  hasBit,
  setBit,
  countBits,
  mergeBits,
  designLevels,
  nearestLevel,
  crownSteps,
  stepLevel,
  centerLatLon,
  globalPixel,
  tilesForView,
  MAP_BASE_URL
} from '../shared/map-tiles.js'

// Igual ao manifest.json publicado (resumido).
const RAW = {
  version: 1,
  generated: '2026-11-17',
  projection: { type: 'equirectangular', mPerDeg: 111320, latRef: -19.9023, origin: { lat: -19.7642, lon: -44.0714 } },
  tileSize: 256,
  themes: {
    dark: {
      levels: [
        { pxPerKm: 80, cols: 8, rows: 10, path: 'dark/80/{x}_{y}.png', bytes: 1005806, count: 80 },
        { pxPerKm: 40, cols: 4, rows: 5, path: 'dark/40/{x}_{y}.png', bytes: 153852, count: 20 },
        { pxPerKm: 160, cols: 15, rows: 20, path: 'dark/160/{x}_{y}.png', bytes: 2555555, count: 300 }
      ],
      bytes: 3715213
    },
    light: { levels: [{ pxPerKm: 40, cols: 4, rows: 5, path: 'light/40/{x}_{y}.png' }] },
    roxo: { levels: [] }
  }
}

test('parseManifest valida e ordena os níveis', () => {
  const m = parseManifest(JSON.stringify(RAW))
  assert.deepEqual(m.themes.dark.levels.map((l) => l.pxPerKm), [40, 80, 160])
  assert.equal(m.themes.dark.count, 400)
  assert.equal(m.themes.dark.bytes, 3715213)
  assert.equal(m.themes.light.count, 20)
  assert.equal(m.themes.roxo, undefined)
  assert.equal(m.tileSize, 256)
  assert.equal(parseManifest('{x'), null)
  assert.equal(parseManifest({ ...RAW, tileSize: 3 }), null)
  // Caminho com "..": tema descartado.
  const bad = { ...RAW, themes: { dark: { levels: [{ pxPerKm: 40, cols: 1, rows: 1, path: '../x.png' }] } } }
  assert.equal(parseManifest(bad), null)
})

test('compactManifest ida e volta', () => {
  const c = parseCompactManifest(JSON.parse(JSON.stringify(compactManifest(parseManifest(RAW)))))
  assert.equal(c.ts, 256)
  assert.deepEqual(c.levels.dark, [{ k: 40, c: 4, r: 5 }, { k: 80, c: 8, r: 10 }, { k: 160, c: 15, r: 20 }])
  assert.equal(compactTotal(c, 'dark'), 400)
  assert.equal(compactTotal(c, 'light'), 20)
  assert.equal(parseCompactManifest({ m: 1 }), null)
})

test('tileList: ordem dos níveis, índice global e URL do arquivo', () => {
  const m = parseManifest(RAW)
  const list = tileList(m, 'dark')
  assert.equal(list.length, 400)
  assert.deepEqual(list[0], { i: 0, level: 0, k: 40, x: 0, y: 0, url: MAP_BASE_URL + 'dark/40/0_0.png', name: 'dark-40-0_0.png' })
  assert.equal(list[20].k, 80)
  const t = list.find((x) => x.k === 160 && x.x === 3 && x.y === 2)
  assert.equal(t.url, MAP_BASE_URL + 'dark/160/3_2.png')
  const c = compactManifest(m)
  assert.equal(tileIndex(c.levels.dark, 2, 3, 2), t.i)
  assert.equal(tileFileName('light', 80, 1, 2), 'light-80-1_2.png')
  assert.equal(watchTilePath('dark', 40, 0, 0), 'data://map/dark-40-0_0.png')
  assert.deepEqual(tileList(m, 'roxo'), [])
})

test('mapa de bits em hexadecimal', () => {
  let b = emptyBits(10)
  assert.equal(b, '000')
  b = setBit(b, 0)
  b = setBit(b, 9)
  assert.equal(b, '804')
  assert.ok(hasBit(b, 0) && hasBit(b, 9) && !hasBit(b, 1))
  assert.equal(countBits(b, 10), 2)
  assert.equal(setBit(b, 0, false), '004')
  assert.equal(normalizeBits('zz', 8), '00')
  assert.equal(normalizeBits('F', 8), 'f0')
  assert.equal(normalizeBits('ffff', 8), 'ff')
  assert.equal(mergeBits('80', '01', 8), '81')
  assert.equal(setBit('00', 99), '00')
})

test('níveis em px de design, nível mais próximo e coroa', () => {
  const c = compactManifest(parseManifest(RAW))
  assert.deepEqual(designLevels(c, 'dark', 466 / 480), [41.2, 82.4, 164.81])
  assert.deepEqual(designLevels(c, 'dark', 1), [40, 80, 160])
  assert.equal(nearestLevel([40, 80, 160], 128), 2)
  assert.equal(nearestLevel([40, 80, 160], 30), 0)
  assert.deepEqual(crownSteps(0, 10), { steps: 0, acc: 10 })
  assert.deepEqual(crownSteps(10, 10), { steps: 1, acc: 5 })
  assert.deepEqual(crownSteps(0, -31), { steps: -2, acc: -1 })
  assert.equal(stepLevel(1, 1, 3), 2)
  assert.equal(stepLevel(2, 5, 3), 2)
  assert.equal(stepLevel(0, -1, 3), 0)
})

test('centerLatLon e globalPixel seguem a projeção do manifesto', () => {
  const c = compactManifest(parseManifest(RAW))
  // A origem é o pixel (0, 0); 1 km ao sul a 40 px/km = y 40.
  assert.deepEqual(globalPixel(c, 40, -19.7642, -44.0714), [0, 0])
  const [, y] = globalPixel(c, 40, -19.7642 - 1000 / 111320, -44.0714)
  assert.ok(Math.abs(y - 40) < 1e-9)
  const stop = { lat: -19.92, lon: -43.94 }
  const ctr = centerLatLon(stop, [0, 1000])
  assert.ok(Math.abs(ctr.lat - (-19.92 - 1000 / 111320)) < 1e-12)
  assert.equal(centerLatLon(stop, null).lon, -43.94)
})

test('tilesForView: blocos que cobrem o círculo, recortados ao quadrado do mapa', () => {
  const c = compactManifest(parseManifest(RAW))
  const K = 80
  // Centro exatamente no canto entre 4 blocos: (2*256, 3*256) no nível 80.
  const kx = c.m * Math.cos((c.lr * Math.PI) / 180)
  const center = { lat: c.oa - (3 * 256 * 1000) / (c.m * K), lon: c.oo + (2 * 256 * 1000) / (kx * K) }
  const r = 116
  const list = tilesForView({ compact: c, theme: 'dark', level: 1, center, cx: 330, cy: 229, r, box: { x: 214, y: 113, w: 232, h: 232 } })
  assert.deepEqual(list.map((t) => [t.tx, t.ty]), [[1, 2], [2, 2], [1, 3], [2, 3]])
  const tl = list[0]
  // Bloco (1,2) termina no centro: canto em (330-256, 229-256), recortado ao quadrado.
  assert.deepEqual(tl, { tx: 1, ty: 2, i: tileIndex(c.levels.dark, 1, 1, 2), x: 214, y: 113, w: 116, h: 116, pos_x: 74 - 214, pos_y: -27 - 113 })
  const br = list[3]
  assert.deepEqual([br.x, br.y, br.w, br.h, br.pos_x, br.pos_y], [330, 229, 116, 116, 0, 0])
  // Centro no meio de um bloco: só ele cobre (círculo menor que o bloco).
  const mid = { lat: c.oa - (2.5 * 256 * 1000) / (c.m * K), lon: c.oo + (2.5 * 256 * 1000) / (kx * K) }
  assert.deepEqual(tilesForView({ compact: c, theme: 'dark', level: 1, center: mid, cx: 330, cy: 229, r: 100 }).map((t) => [t.tx, t.ty]), [[2, 2]])
  // Fora do mapa (oeste da origem): nenhum bloco de índice negativo.
  const west = { lat: c.oa - 0.01, lon: c.oo - 0.5 }
  assert.deepEqual(tilesForView({ compact: c, theme: 'dark', level: 1, center: west, cx: 330, cy: 229, r: 116 }), [])
  assert.deepEqual(tilesForView({ compact: c, theme: 'light', level: 2, center, cx: 0, cy: 0, r: 10 }), [])
})
