import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest, compactManifest, tileIndex, tileList, setBit, emptyBits, hasBit, countBits, tilesForView } from '../shared/map-tiles.js'
import {
  manifestTag,
  buildDemandParams,
  parseDemandParams,
  viewTiles,
  pendingCount,
  needsTile,
  demandPlan,
  enqueueDemand,
  takeNext,
  dropTheme,
  cleanLru,
  lruTouch,
  lruEvict,
  cleanPhoneCache,
  phoneTilePath,
  tilesNearPoints,
  PRIO,
  SENT_TTL_MS,
  MAX_PREFETCH,
  WATCH_TILE_LIMIT
} from '../shared/map-demand.js'

const RAW = {
  version: 1,
  generated: '2026-11-17',
  projection: { type: 'equirectangular', mPerDeg: 111320, latRef: -19.9023, origin: { lat: -19.7642, lon: -44.0714 } },
  tileSize: 256,
  themes: {
    dark: {
      levels: [
        { pxPerKm: 40, cols: 4, rows: 5, path: 'dark/40/{x}_{y}.png' },
        { pxPerKm: 80, cols: 8, rows: 10, path: 'dark/80/{x}_{y}.png' },
        { pxPerKm: 160, cols: 15, rows: 20, path: 'dark/160/{x}_{y}.png' }
      ]
    },
    light: { levels: [{ pxPerKm: 40, cols: 4, rows: 5, path: 'light/40/{x}_{y}.png' }] }
  }
}
const M = parseManifest(RAW)
const C = compactManifest(M)
const kx = C.m * Math.cos((C.lr * Math.PI) / 180)
// (lat, lon) do pixel global (px, py) no nível de k px/km.
const at = (k, px, py) => ({ lat: C.oa - (py * 1000) / (C.m * k), lon: C.oo + (px * 1000) / (kx * k) })
const R = 114 // raio do mapa em px físicos (Active 3: px(118))
const TOTAL = 400

test('parâmetros do relógio: ida e volta e validação', () => {
  const p = buildDemandParams({ theme: 'dark', have: 'F0', r: 114.6, scale: 0.97083, mv: manifestTag(C) })
  assert.deepEqual(parseDemandParams(JSON.parse(JSON.stringify(p))), { theme: 'dark', have: 'f0', r: 115, scale: 0.9708, mv: '1:2026-11-17' })
  assert.equal(parseDemandParams({ theme: 'roxo' }), null)
  assert.equal(parseDemandParams(null), null)
  const bad = parseDemandParams({ theme: 'light', have: 'xyz', r: 5000, scale: -1 })
  assert.deepEqual([bad.have, bad.r, bad.scale, bad.mv], ['', 0, 1, ''])
})

test('viewTiles: os mesmos blocos que o relógio desenha (tilesForView)', () => {
  // Centro no canto entre 4 blocos do nível 80.
  const center = at(80, 2 * 256, 3 * 256)
  const v = viewTiles({ compact: C, theme: 'dark', level: 1, center, r: R })
  assert.deepEqual(v.map((t) => [t.x, t.y]), [[1, 2], [2, 2], [1, 3], [2, 3]])
  assert.equal(v[0].i, tileIndex(C.levels.dark, 1, 1, 2))
  // Mesmo conjunto que o relógio calcula com o centro da tela e o recorte.
  const watch = tilesForView({ compact: C, theme: 'dark', level: 1, center, cx: 330, cy: 229, r: R, box: { x: 330 - 116, y: 229 - 116, w: 232, h: 232 } })
  assert.deepEqual(watch.map((t) => t.i), v.map((t) => t.i))
  // No meio de um bloco: só ele (1 bloco por vista).
  assert.equal(viewTiles({ compact: C, theme: 'dark', level: 1, center: at(80, 2.5 * 256, 2.5 * 256), r: R }).length, 1)
})

test('needsTile/pendingCount: não reenvia o que o relógio tem nem o que acabou de ir', () => {
  const have = setBit(emptyBits(TOTAL), 5)
  assert.equal(needsTile(5, have, null), false)
  assert.equal(needsTile(6, have, null), true)
  assert.equal(needsTile(6, have, { 6: 1000 }, 1000 + SENT_TTL_MS - 1), false)
  // Depois do prazo, vale o que o relógio diz (o LRU pode ter apagado).
  assert.equal(needsTile(6, have, { 6: 1000 }, 1000 + SENT_TTL_MS + 1), true)
  assert.equal(pendingCount([{ i: 5 }, { i: 6 }, { i: 7 }], have), 2)
})

test('demandPlan: vista primeiro, depois vizinhos (mais perto antes) e níveis vizinhos', () => {
  const center = at(80, 2 * 256 + 10, 3 * 256 + 10)
  const plan = demandPlan({ compact: C, theme: 'dark', level: 1, center, r: R, have: emptyBits(TOTAL), now: 0 })
  const view = plan.filter((p) => p.prio === PRIO.VIEW)
  assert.equal(view.length, 4)
  assert.deepEqual(plan.slice(0, 4), view) // vista na frente
  const extra = plan.slice(4)
  assert.ok(extra.length > 0 && extra.length <= MAX_PREFETCH)
  // Prioridades não decrescem; vizinhos do mesmo nível antes dos outros níveis.
  for (let k = 1; k < plan.length; k++) assert.ok(plan[k].prio >= plan[k - 1].prio)
  assert.ok(extra.every((p) => p.prio === PRIO.NEAR || p.prio === PRIO.LEVEL))
  assert.ok(extra.filter((p) => p.prio === PRIO.NEAR).every((p) => p.level === 1))
  // Sem repetição.
  assert.equal(new Set(plan.map((p) => p.i)).size, plan.length)
  // Relógio já tem a vista: só o pré-envio; sem prefetch, nada.
  let have = emptyBits(TOTAL)
  view.forEach((t) => (have = setBit(have, t.i)))
  const again = demandPlan({ compact: C, theme: 'dark', level: 1, center, r: R, have, now: 0 })
  assert.ok(again.every((p) => p.prio !== PRIO.VIEW))
  assert.deepEqual(demandPlan({ compact: C, theme: 'dark', level: 1, center, r: R, have, prefetch: false }), [])
  // Nível do zoom mais afastado: o vizinho é só o de cima.
  const far = demandPlan({ compact: C, theme: 'dark', level: 0, center: at(40, 300, 300), r: R, have: emptyBits(TOTAL), maxPrefetch: 50 })
  assert.ok(far.filter((p) => p.prio === PRIO.LEVEL).every((p) => p.level === 1))
  // Entradas ruins.
  assert.deepEqual(demandPlan({ compact: C, theme: 'dark', level: 7, center, r: R }), [])
  assert.deepEqual(demandPlan({ compact: null, theme: 'dark', level: 1, center, r: R }), [])
})

test('fila: a vista do pedido mais novo vai na frente; sem duplicados; corta no máximo', () => {
  let q = enqueueDemand([], [{ i: 1, prio: PRIO.NEAR }, { i: 2, prio: PRIO.VIEW }], { theme: 'dark', seq: 1 })
  assert.deepEqual(q.map((x) => x.i), [2, 1])
  q = enqueueDemand(q, [{ i: 9, prio: PRIO.VIEW }, { i: 1, prio: PRIO.VIEW }], { theme: 'dark', seq: 2 })
  assert.deepEqual(q.map((x) => [x.i, x.prio]), [[9, 0], [1, 0], [2, 0]])
  // Pedir de novo com prioridade pior não rebaixa.
  q = enqueueDemand(q, [{ i: 9, prio: PRIO.LEVEL }], { theme: 'dark', seq: 3 })
  assert.equal(q.find((x) => x.i === 9).prio, PRIO.VIEW)
  // Outro tema é outro bloco.
  q = enqueueDemand(q, [{ i: 9, prio: PRIO.LEVEL }], { theme: 'light', seq: 3 })
  assert.equal(q.length, 4)
  const { item, rest } = takeNext(q)
  assert.equal(item.i, 9)
  assert.equal(rest.length, 3)
  assert.deepEqual(takeNext([]), { item: null, rest: [] })
  assert.equal(dropTheme(q, 'light').length, 3)
  assert.equal(dropTheme(q, 'all').length, 0)
  const many = enqueueDemand([], Array.from({ length: 50 }, (_, i) => ({ i, prio: i < 3 ? PRIO.VIEW : PRIO.NEAR })), { theme: 'dark', seq: 1, max: 10 })
  assert.equal(many.length, 10)
  assert.deepEqual(many.slice(0, 3).map((x) => x.i), [0, 1, 2])
})

test('LRU do relógio: apaga os usados há mais tempo, nunca o que acabou de chegar', () => {
  assert.deepEqual(cleanLru('[3,3,1,"x",999,-1]', 10), [3, 1])
  assert.deepEqual(cleanLru('{x', 10), [])
  assert.deepEqual(lruTouch([1, 2, 3], [1]), [2, 3, 1])
  assert.deepEqual(lruTouch([1, 2, 3], [4, 2]), [1, 3, 4, 2])
  let have = emptyBits(20)
  ;[0, 1, 2, 3, 4, 5].forEach((i) => (have = setBit(have, i)))
  // 0 e 5 estão no relógio mas fora da lista (vieram antes do LRU): saem primeiro.
  const r = lruEvict({ lru: [3, 1, 2, 4], have, total: 20, limit: 3, keep: [4] })
  assert.deepEqual(r.evict, [0, 5, 3])
  assert.equal(countBits(r.have, 20), 3)
  assert.ok(!hasBit(r.have, 3) && hasBit(r.have, 4))
  assert.deepEqual(r.lru, [1, 2, 4])
  // Dentro do limite: nada.
  assert.deepEqual(lruEvict({ lru: [1], have, total: 20, limit: WATCH_TILE_LIMIT }).evict, [])
  // No máximo maxEvict por vez.
  assert.equal(lruEvict({ lru: [], have, total: 20, limit: 0, maxEvict: 2 }).evict.length, 2)
})

test('cache do celular: bits por tema valem só para a mesma etiqueta do manifesto', () => {
  const c = cleanPhoneCache(JSON.stringify({ tag: 'a', themes: { dark: 'f' } }), 'a', { dark: 8, light: 4 })
  assert.equal(c.themes.dark, 'f0')
  assert.equal(c.themes.light, '0')
  assert.equal(cleanPhoneCache({ tag: 'a', themes: { dark: 'f' } }, 'b', { dark: 8 }).themes.dark, '00')
  assert.equal(cleanPhoneCache('{x', 'a', { dark: 4 }).themes.dark, '0')
  assert.equal(phoneTilePath('dark', 80, 1, 2), 'data://download/cob-c-dark-80-1_2.png')
})

test('tilesNearPoints: blocos em volta dos pontos salvos, mais perto primeiro', () => {
  const list = tileList(M, 'dark')
  const p = at(160, 5 * 256 + 128, 6 * 256 + 128) // meio do bloco (5,6) do nível 160
  const near = tilesNearPoints(list, M, [p], 1, 100)
  assert.ok(near.length > 3)
  assert.equal(near[0].level, 0) // distância 0 em todos os níveis: o afastado primeiro
  assert.ok(near.some((t) => t.level === 2 && t.x === 5 && t.y === 6))
  assert.equal(tilesNearPoints(list, M, [p], 0.5, 2).length, 2)
  assert.deepEqual(tilesNearPoints(list, M, [], 1), [])
  assert.deepEqual(tilesNearPoints(list, null, [p], 1), [])
})
