import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseFrame,
  stableFrame,
  clampScale,
  parseZoom,
  zoomByCrown,
  zoomStep,
  dotsAlong,
  MAP_VIEW,
  fitsView,
  MIN_PX_PER_KM,
  MAX_PX_PER_KM,
  DEFAULT_PX_PER_KM
} from '../shared/map-frame.js'

// O ponto m (metros) cabe no retângulo da vista do enquadramento?
const fits = (frame, m) => fitsView(frame, m, MAP_VIEW)

test('chooseFrame automático: centro no meio, ônibus e ponto cabem', () => {
  const f = chooseFrame({ busXY: [0, -1800] })
  assert.equal(f.auto, true)
  assert.deepEqual(f.center, [0, -900])
  // Na vertical o retângulo é mais alto (hy): a escala sai dele.
  assert.equal(f.k, Math.round((MAP_VIEW.hy * 2000) / 1800))
  assert.ok(fits(f, [0, 0]))
  assert.ok(fits(f, [0, -1800]))
  // Na horizontal, pela meia largura (hx).
  const h = chooseFrame({ busXY: [1800, 0] })
  assert.equal(h.k, Math.round((MAP_VIEW.hx * 2000) / 1800))
  assert.ok(fits(h, [0, 0]) && fits(h, [1800, 0]))
})

test('chooseFrame: limites de escala e ônibus colado no ponto', () => {
  assert.equal(chooseFrame({ busXY: [10, 0] }).k, MAX_PX_PER_KM)
  assert.ok(chooseFrame({ busXY: [0, 0] }).k <= MAX_PX_PER_KM)
  // Muito longe: escala mínima e o ponto continua dentro do mapa.
  const far = chooseFrame({ busXY: [20000, 0] })
  assert.equal(far.k, MIN_PX_PER_KM)
  assert.ok(fits(far, [0, 0]))
  assert.equal(fits(far, [20000, 0]), false)
})

test('chooseFrame: zoom manual centra no ponto; sem ônibus usa a escala padrão', () => {
  assert.deepEqual(chooseFrame({ busXY: [0, -1800], zoom: 200 }), { k: 200, center: [0, 0], auto: false })
  assert.deepEqual(chooseFrame({}), { k: DEFAULT_PX_PER_KM, center: [0, 0], auto: true })
  assert.equal(chooseFrame({ busXY: [0, -1800], zoom: 9999 }).auto, true)
})

test('stableFrame mantém o enquadramento enquanto serve', () => {
  const prev = chooseFrame({ busXY: [0, -1800] })
  // Ônibus andou 300 m para perto: ainda cabe e a escala ideal não passou de 1,6×.
  const ideal = chooseFrame({ busXY: [0, -1500] })
  assert.equal(stableFrame(prev, ideal, [0, -1500]), prev)
  // Chegou bem perto: a escala ideal é bem maior, troca.
  const close = chooseFrame({ busXY: [0, -400] })
  assert.equal(stableFrame(prev, close, [0, -400]), close)
  // Ônibus saiu do enquadramento: troca.
  const away = chooseFrame({ busXY: [0, -2600] })
  assert.equal(stableFrame(prev, away, [0, -2600]), away)
  // Manual nunca é reaproveitado no automático.
  const manual = chooseFrame({ zoom: 100 })
  assert.equal(stableFrame(manual, ideal, [0, -1500]), ideal)
  assert.equal(stableFrame(null, ideal, [0, -1500]), ideal)
})

test('parseZoom, clampScale, coroa e botões', () => {
  assert.equal(parseZoom('120'), 120)
  assert.equal(parseZoom(29), null)
  assert.equal(parseZoom(261), null)
  assert.equal(parseZoom(true), null)
  assert.equal(parseZoom(''), null)
  assert.equal(clampScale(5), MIN_PX_PER_KM)
  assert.equal(clampScale(1000), MAX_PX_PER_KM)
  assert.equal(clampScale('x'), DEFAULT_PX_PER_KM)
  assert.ok(zoomByCrown(100, 15) > 130 && zoomByCrown(100, 15) < 140)
  assert.ok(zoomByCrown(100, -15) < 100)
  assert.equal(zoomByCrown(100, 0), 100)
  assert.equal(zoomByCrown(250, 90), MAX_PX_PER_KM)
  assert.equal(zoomStep(100, 1), 130)
  assert.equal(zoomStep(100, -1), 77)
  assert.equal(zoomStep(31, -1), MIN_PX_PER_KM)
})

test('dotsAlong: bolinhas espaçadas pelo caminho, com limite', () => {
  assert.deepEqual(dotsAlong([[0, 0, 25, 0]], 10), [0, 0, 10, 0, 20, 0])
  // Espaçamento continua na quina.
  assert.deepEqual(dotsAlong([[0, 0, 5, 0, 5, 10]], 10), [0, 0, 5, 5])
  assert.equal(dotsAlong([[0, 0, 1000, 0]], 10, 5).length, 10)
  assert.deepEqual(dotsAlong([[1, 2]]), [])
  assert.deepEqual(dotsAlong(null), [])
})

test('níveis fixos do mapa de ruas: automático escolhe o maior que enquadra', async () => {
  const { parseLevels, parseLevelIndex, chooseLevelFrame } = await import('../shared/map-frame.js')
  const levels = [41.2, 82.4, 164.81]
  assert.deepEqual(parseLevels([41.2, 82.4, 164.81]), levels)
  assert.equal(parseLevels([80, 40]), null)
  assert.equal(parseLevels([10]), null)
  assert.equal(parseLevels('x'), null)
  assert.equal(parseLevelIndex(2, 3), 2)
  assert.equal(parseLevelIndex(3, 3), null)
  assert.equal(parseLevelIndex('', 3), null)
  // Ônibus a 1,8 km: escala ideal ~95 px/km -> nível 82,4.
  const f = chooseFrame({ busXY: [0, -1800], levels })
  assert.equal(f.level, 1)
  assert.equal(f.k, 82.4)
  assert.equal(f.auto, true)
  assert.ok(fits(f, [0, 0]))
  assert.ok(fits(f, [0, -1800]))
  // Bem perto: o maior nível. Muito longe: o menor (o ponto continua no mapa).
  assert.equal(chooseFrame({ busXY: [0, -300], levels }).level, 2)
  const far = chooseFrame({ busXY: [20000, 0], levels })
  assert.equal(far.level, 0)
  assert.ok(fits(far, [0, 0]))
  // Manual: o nível pedido, centrado no ponto.
  assert.deepEqual(chooseFrame({ busXY: [0, -1800], levels, level: 0 }), { k: 41.2, center: [0, 0], auto: false, level: 0 })
  // Sem ônibus: o nível mais perto da escala padrão.
  assert.equal(chooseLevelFrame({ busXY: null, levels, level: null }).level, 2)
})

test('stableFrame não mistura mapa de ruas com escala livre', () => {
  const levels = [41.2, 82.4, 164.81]
  const withTiles = chooseFrame({ busXY: [0, -1800], levels })
  const free = chooseFrame({ busXY: [0, -1800] })
  assert.equal(stableFrame(free, withTiles, [0, -1800]), withTiles)
  assert.equal(stableFrame(withTiles, free, [0, -1800]), free)
  // Mesmo modo, ainda cabe: mantém.
  assert.equal(stableFrame(withTiles, chooseFrame({ busXY: [0, -1700], levels }), [0, -1700]), withTiles)
})
