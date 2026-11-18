// Tela do ponto nova: layout em coluna à esquerda + mapa na metade direita, zoom só
// automático com histerese e blocos/diagnóstico do mapa no retângulo novo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAYOUT, COL_RIGHT, MAP_CX, MAP_CY, MAP_RECT, FADE_W, ICON_HALF, SCREEN_R, boxInsideCircle, iconArea, tileView, demandView, fadeSrc } from '../shared/detail-layout.js'
import { MAP_VIEW, MAP_CLIP, chooseFrame, stableFrame, pickLevel, idealScale, frameCenter, fitsView, LEVEL_ZOOM_IN_MARGIN } from '../shared/map-frame.js'
import { parseManifest, compactManifest, tilesForView, emptyBits, setBit } from '../shared/map-tiles.js'
import { demandPlan, viewTiles, buildDemandParams, parseDemandParams, cleanViewRect, mapDiagText, confirmTiles, PRIO } from '../shared/map-demand.js'
import { clipToRect, buildMapPayload, sanitizeMapPayload, makeProjection } from '../shared/route-map.js'
import { cleanDiag, diagCount, diagError, diagManifest, diagWatch, diagLines, clockText } from '../shared/map-download.js'
import { watchInbox, receivedPathCandidates, fileKey } from '../shared/transfer.js'
import { fadeAlpha } from '../scripts/build-map-fades.mjs'

const LEVELS = [41.2, 82.4, 164.81]
const SCALE = 466 / 480
const px = (v) => v * SCALE

// ---- Layout ----

test('layout: tudo cabe na tela redonda e a coluna termina em x = 225', () => {
  Object.entries(LAYOUT).forEach(([name, b]) => {
    assert.ok(boxInsideCircle(b), `${name} sai da tela redonda`)
  })
  ;['eta', 'etaMin', 'etaLabel', 'etaAge', 'dist', 'next', 'emptyTitle', 'emptyLine1', 'emptyLine2'].forEach((name) => {
    const b = LAYOUT[name]
    assert.ok(b.x + b.w <= COL_RIGHT, `${name} passa da coluna`)
    // Coluna alinhada: todas centradas no mesmo x.
    assert.ok(Math.abs(b.x + b.w / 2 - 140) <= 0.5, `${name} fora do eixo da coluna`)
  })
  // Linhas de baixo em ordem, sem sobrepor.
  const order = ['eta', 'etaMin', 'etaLabel', 'etaAge', 'dist', 'next']
  for (let i = 1; i < order.length; i++) assert.ok(LAYOUT[order[i]].y >= LAYOUT[order[i - 1]].y + LAYOUT[order[i - 1]].h - 4, order[i])
})

test('layout: mapa na metade direita inteira e ícones dentro da área visível', () => {
  assert.deepEqual(MAP_RECT, { x: 200, y: 0, w: 280, h: 480 })
  assert.equal(MAP_RECT.x + MAP_RECT.w, 2 * SCREEN_R)
  const a = iconArea()
  // Fora da faixa de transição da esquerda.
  assert.ok(a.x0 >= MAP_RECT.x + FADE_W, 'ícone na faixa de transição')
  // Cantos da área (com o ícone inteiro) dentro da tela redonda.
  ;[
    [a.x0, a.y0],
    [a.x1, a.y0],
    [a.x0, a.y1],
    [a.x1, a.y1]
  ].forEach(([x, y]) => assert.ok(Math.hypot(x - SCREEN_R, y - SCREEN_R) + ICON_HALF <= SCREEN_R, `${x},${y}`))
  // O recorte do canvas é o retângulo do mapa (relativo ao centro).
  assert.deepEqual([MAP_CX + MAP_CLIP.x0, MAP_CY + MAP_CLIP.y0, MAP_CLIP.x1 - MAP_CLIP.x0, MAP_CLIP.y1 - MAP_CLIP.y0], [200, 0, 280, 480])
  assert.equal(fadeSrc('light'), 'map/fade-light.png')
  assert.equal(fadeSrc('x', 'top'), 'map/fade-top-dark.png')
})

test('faixa de transição: opaca na borda, transparente no fim, sem degraus para trás', () => {
  assert.equal(fadeAlpha(0), 255)
  assert.equal(fadeAlpha(1), 0)
  let prev = 256
  for (let i = 0; i <= 20; i++) {
    const a = fadeAlpha(i / 20)
    assert.ok(a <= prev)
    prev = a
  }
  assert.ok(fadeAlpha(0, 0.85) < 255)
})

// ---- Enquadramento no retângulo ----

test('idealScale/frameCenter: ponto e ônibus cabem no retângulo', () => {
  assert.equal(idealScale(null), null)
  for (const bus of [
    [0, -1800],
    [1500, 300],
    [-700, 900],
    [3000, -3000]
  ]) {
    const k = idealScale(bus)
    const f = { k, center: frameCenter(bus, k) }
    assert.ok(fitsView(f, [0, 0]) && fitsView(f, bus), String(bus))
  }
  // Retângulo mais alto que largo: na vertical cabe mais longe.
  assert.ok(idealScale([0, 1000]) > idealScale([1000, 0]))
})

test('chooseFrame com níveis: escolhe o nível e enquadra no retângulo', () => {
  const f = chooseFrame({ busXY: [900, -1200], levels: LEVELS })
  assert.equal(f.auto, true)
  assert.ok(fitsView(f, [0, 0]) && fitsView(f, [900, -1200]))
  // Muito longe: nível 0 e o ponto sempre na vista.
  const far = chooseFrame({ busXY: [-9000, 4000], levels: LEVELS })
  assert.equal(far.level, 0)
  assert.ok(fitsView(far, [0, 0]))
})

test('pickLevel: histerese só para aproximar', () => {
  // Ideal 90: maior nível <= 90 é o 1.
  assert.equal(pickLevel(LEVELS, 90, null), 1)
  // Vindo do nível 0: 1 só se 82,4 × margem couber (94,8).
  assert.equal(pickLevel(LEVELS, 90, 0), 0)
  assert.equal(pickLevel(LEVELS, 82.4 * LEVEL_ZOOM_IN_MARGIN + 0.1, 0), 1)
  // Afastar é na hora (o ônibus não cabe mais).
  assert.equal(pickLevel(LEVELS, 60, 2), 0)
  assert.equal(pickLevel(LEVELS, 120, 2), 1)
  assert.equal(pickLevel(LEVELS, 0, 1), 0)
  assert.equal(pickLevel([], 100, null), null)
})

// Simula o celular a cada 30 s (chooseFrame + stableFrame com a memória do ponto).
function simulate(path) {
  let prev = null
  return path.map((bus) => {
    const prevLevel = prev && prev.auto && Number.isInteger(prev.level) ? prev.level : null
    const ideal = chooseFrame({ busXY: bus, levels: LEVELS, prevLevel })
    prev = stableFrame(prev, ideal, bus)
    return prev
  })
}

test('zoom automático: ônibus chegando aproxima sem voltar atrás', () => {
  const path = []
  for (let d = 6000; d >= 0; d -= 150) path.push([d * 0.3, -d])
  const frames = simulate(path)
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].level >= frames[i - 1].level, `voltou no passo ${i}`)
  assert.equal(frames[0].level, 0)
  assert.equal(frames[frames.length - 1].level, 2)
  // Sempre com o ponto na vista; o ônibus também a partir de onde cabe no nível 0.
  frames.forEach((f, i) => {
    assert.ok(fitsView(f, [0, 0]), `ponto fora no passo ${i}`)
    if (idealScale(path[i]) >= LEVELS[0]) assert.ok(fitsView(f, path[i]), `ônibus fora no passo ${i}`)
  })
  // Centro não muda a cada atualização (só ao trocar de nível ou quando sai da vista).
  const changes = frames.filter((f, i) => i > 0 && f !== frames[i - 1]).length
  assert.ok(changes < frames.length / 2, `mudou ${changes} vezes`)
})

test('zoom automático: ônibus indo e vindo perto do limite não fica trocando de nível', () => {
  // Distância em que o nível 1 (82,4) passa a caber: 2·hy·1000/82,4 ≈ 2,8 km na vertical.
  const limit = (2 * MAP_VIEW.hy * 1000) / LEVELS[1]
  const path = []
  for (let i = 0; i < 20; i++) path.push([0, -(limit + (i % 2 ? 60 : -60))])
  const frames = simulate(path)
  const switches = frames.filter((f, i) => i > 0 && f.level !== frames[i - 1].level).length
  assert.ok(switches <= 1, `trocou ${switches} vezes`)
})

// ---- Trajeto no retângulo ----

test('clipToRect: recorta, sai e volta, atravessa sem vértice dentro', () => {
  const R = { x0: -10, x1: 10, y0: -20, y1: 20 }
  assert.deepEqual(clipToRect([[0, 0], [5, 5]], R), [[[0, 0], [5, 5]]])
  assert.deepEqual(clipToRect([[0, 0], [20, 0]], R), [[[0, 0], [10, 0]]])
  assert.deepEqual(clipToRect([[-20, 0], [20, 0]], R), [[[-10, 0], [10, 0]]])
  // Sai e volta: dois pedaços.
  const two = clipToRect([[0, 0], [30, 0], [30, 10], [0, 10]], R)
  assert.equal(two.length, 2)
  assert.deepEqual(two[1], [[10, 10], [0, 10]])
  assert.deepEqual(clipToRect([[30, 30], [40, 40]], R), [])
})

test('buildMapPayload no retângulo: trajeto até a borda do canvas e ônibus presos à área', () => {
  const stop = { lat: -19.92, lon: -43.94 }
  const project = makeProjection(stop)
  // Trajeto reto norte -> sul passando pelo ponto, 6 km.
  const shape = []
  for (let m = -3000; m <= 3000; m += 100) shape.push([stop.lat - m / 111320, stop.lon])
  const k = 80
  const map = buildMapPayload({
    ctx: null,
    stop,
    buses: [{ lat: stop.lat + 0.03, lon: stop.lon + 0.02 }],
    lineStops: [],
    pxPerKm: k,
    clip: MAP_CLIP,
    busBox: MAP_VIEW,
    radiusM: 99999
  })
  const b = map.buses[0]
  assert.equal(b.clamped, true)
  assert.ok(Math.abs(b.x) <= MAP_VIEW.hx && Math.abs(b.y) <= MAP_VIEW.hy)
  // Encostado na borda da área (um dos lados).
  assert.ok(Math.abs(b.x) === MAP_VIEW.hx || Math.abs(b.y) === MAP_VIEW.hy)
  assert.ok(project)
  // sanitize aceita y até ±240 (canvas da altura da tela).
  const s = sanitizeMapPayload({ route: [[0, -240, 0, 240]], buses: [], stop: { x: 0, y: 0 } })
  assert.deepEqual(s.route, [[0, -240, 0, 240]])
})

// ---- Blocos para o retângulo ----

const RAW = {
  version: 1,
  generated: '2026-11-17',
  projection: { type: 'equirectangular', mPerDeg: 111320, latRef: -19.9023, origin: { lat: -19.7642, lon: -44.0714 } },
  tileSize: 256,
  themes: {
    light: {
      levels: [
        { pxPerKm: 40, cols: 4, rows: 5, path: 'light/40/{x}_{y}.png' },
        { pxPerKm: 80, cols: 8, rows: 10, path: 'light/80/{x}_{y}.png' },
        { pxPerKm: 160, cols: 15, rows: 20, path: 'light/160/{x}_{y}.png' }
      ]
    }
  }
}
const C = compactManifest(parseManifest(RAW))
const kx = C.m * Math.cos((C.lr * Math.PI) / 180)
const latLonAt = (k, gx, gy) => ({ lat: C.oa - (gy * 1000) / (C.m * k), lon: C.oo + (gx * 1000) / (kx * k) })

test('tilesForView no retângulo do mapa: cobre o canvas inteiro, sem blocos fora da tela redonda', () => {
  const view = tileView(px)
  // Centro no meio de um bloco do nível 160: o retângulo (272 x 466 px físicos) pega 3 x 3.
  const center = latLonAt(160, 5 * 256 + 128, 8 * 256 + 128)
  const list = tilesForView({ compact: C, theme: 'light', level: 2, center, ...view })
  assert.ok(list.length >= 4 && list.length <= 9, `${list.length} blocos`)
  // Os recortes ficam dentro do retângulo e cobrem toda a área dele dentro da tela.
  let area = 0
  list.forEach((t) => {
    assert.ok(t.x >= Math.round(view.rect.x) && t.x + t.w <= Math.round(view.rect.x + view.rect.w))
    assert.ok(t.y >= Math.round(view.rect.y) - 0 && t.y + t.h <= Math.round(view.rect.y + view.rect.h))
    area += t.w * t.h
  })
  // Sem o círculo da tela, cobre o retângulo inteiro (sem buracos nem sobra).
  const all = tilesForView({ compact: C, theme: 'light', level: 2, center, cx: view.cx, cy: view.cy, rect: view.rect })
  const total = all.reduce((s, t) => s + t.w * t.h, 0)
  assert.ok(Math.abs(total - Math.round(view.rect.w) * Math.round(view.rect.h)) <= 2 * (view.rect.w + view.rect.h), `${total}`)
  assert.ok(area <= total)
})

test('demandView/viewTiles: o celular calcula os mesmos blocos que o relógio desenha', () => {
  const v = demandView(px)
  assert.deepEqual(cleanViewRect(v), v)
  const center = latLonAt(80, 3 * 256 + 40, 4 * 256 + 200)
  const watch = tilesForView({ compact: C, theme: 'light', level: 1, center, ...tileView(px) }).map((t) => t.i).sort((a, b) => a - b)
  const phone = viewTiles({ compact: C, theme: 'light', level: 1, center, view: v }).map((t) => t.i).sort((a, b) => a - b)
  assert.deepEqual(phone, watch)
  // Com a folga de 2 px do plano, nenhum bloco desenhado fica de fora.
  const plan = demandPlan({ compact: C, theme: 'light', level: 1, center, view: v, have: emptyBits(400), prefetch: false })
  watch.forEach((i) => assert.ok(plan.some((p) => p.i === i && p.prio === PRIO.VIEW), `bloco ${i}`))
  // O que o relógio já tem não entra; prefetch vem atrás.
  const have = setBit(emptyBits(400), watch[0])
  const p2 = demandPlan({ compact: C, theme: 'light', level: 1, center, view: v, have, now: 0 })
  assert.equal(p2.some((p) => p.i === watch[0]), false)
  const firstLow = p2.findIndex((p) => p.prio !== PRIO.VIEW)
  if (firstLow >= 0) assert.ok(p2.slice(firstLow).every((p) => p.prio !== PRIO.VIEW))
})

test('buildDemandParams/parseDemandParams levam o retângulo e os contadores do relógio', () => {
  const v = demandView(px)
  const p = parseDemandParams(JSON.parse(JSON.stringify(buildDemandParams({ theme: 'light', have: '', r: 97, view: v, scale: SCALE, mv: '1:x', diag: { rx: 3, ok: 2, bad: 1, err: 'params inválidos' } }))))
  assert.deepEqual(p.view, v)
  assert.deepEqual(p.diag, { rx: 3, ok: 2, bad: 1, err: 'params inválidos' })
  assert.equal(parseDemandParams({ theme: 'light', view: [1, 2, 3] }).view, undefined)
  assert.equal(cleanViewRect([0, 0, 5, 5, 0, 0, 1]), null)
})

// ---- Diagnóstico ----

test('mapDiagText: diz por que a vista não tem bloco', () => {
  assert.equal(mapDiagText({ shown: 1 }), '')
  assert.equal(mapDiagText({ files: false }), 'mapa: relógio não recebe arquivos')
  assert.equal(mapDiagText({ manifest: false }), 'mapa: sem manifesto')
  assert.equal(mapDiagText({ manifest: true, level: null }), 'mapa: celular sem nível')
  assert.equal(mapDiagText({ manifest: true, level: 1, pending: 4 }), 'mapa: aguardando blocos (4)')
  assert.equal(
    mapDiagText({ manifest: true, level: 1, pending: 4, watch: { rx: 2, ok: 0, bad: 2, err: 'params inválidos' }, phone: { sent: 2, fail: 0 } }),
    'mapa: aguardando blocos (4)\nrel 0/2 ✗2 · cel 2 · params inválidos'
  )
  assert.equal(mapDiagText({ manifest: true, level: 0, pending: 0 }), 'mapa: sem blocos aqui')
  assert.ok(mapDiagText({ manifest: false, phone: { err: 'celular sem manifesto' } }).endsWith('celular sem manifesto'))
})

test('diagnóstico do celular: contadores, erro com hora e linhas das configurações', () => {
  let d = cleanDiag(null)
  d = diagCount(d, 'req', 4, 1000)
  d = diagCount(d, 'sent', 1, 2000)
  d = diagCount(d, 'conf', 1, 3000)
  d = diagCount(d, 'nada', 5)
  d = diagError(diagCount(d, 'fail'), 'light-80-3_4: download: HTTP 404', new Date(2026, 10, 18, 9, 5, 7).getTime())
  d = diagManifest(d, 'ok v1 2026-11-17', 5000)
  d = diagWatch(d, { rx: 2, ok: 1, bad: 1, err: 'arquivo sumiu' })
  const back = cleanDiag(JSON.stringify(d))
  assert.equal(back.req, 4)
  assert.equal(back.sent, 1)
  assert.equal(back.conf, 1)
  assert.equal(back.fail, 1)
  const lines = diagLines(back)
  assert.equal(lines[0], 'Blocos: 4 pedidos · 1 enviados · 1 confirmados pelo relógio · 1 com erro')
  assert.equal(lines[1], 'Relógio: 2 recebidos · 1 guardados · 1 ignorados · arquivo sumiu')
  assert.ok(lines[2].startsWith('Manifesto: ok v1 2026-11-17'))
  assert.equal(lines[3], 'Último erro: light-80-3_4: download: HTTP 404 às 09:05:07')
  assert.equal(clockText(0), '')
  assert.deepEqual(diagLines('lixo'), ['Blocos: 0 pedidos · 0 enviados · 0 confirmados pelo relógio'])
})

test('confirmTiles: enviados que o relógio já tem viram confirmados', () => {
  const have = setBit(setBit(emptyBits(20), 3), 7)
  assert.deepEqual(confirmTiles([3, 5, 7], have), { confirmed: 2, rest: [5] })
  assert.deepEqual(confirmTiles(null, have), { confirmed: 0, rest: [] })
})

// ---- Recebimento no relógio ----

test('watchInbox: ouve NEWFILE/newfile/FILE/file, esvazia a fila e reconfere no FILE', () => {
  const handlers = {}
  const queue = ['f1', 'f2']
  const inbox = { on: (ev, h) => (handlers[ev] = h), getNextFile: () => queue.shift() || null }
  const got = []
  let finished = 0
  assert.equal(watchInbox(inbox, { onFile: (f) => got.push(f), onFinished: () => finished++ }), true)
  assert.deepEqual(Object.keys(handlers).sort(), ['FILE', 'NEWFILE', 'file', 'newfile'])
  handlers.NEWFILE()
  assert.deepEqual(got, ['f1', 'f2'])
  handlers.file()
  assert.equal(finished, 1)
  // getNextFile que devolve sempre o mesmo objeto não trava.
  const same = { a: 1 }
  const got2 = []
  const h2 = {}
  watchInbox({ on: (ev, h) => (h2[ev] = h), getNextFile: () => same }, { onFile: (f) => got2.push(f) })
  h2.newfile()
  assert.equal(got2.length, 1)
  assert.equal(watchInbox(null, {}), false)
})

test('receivedPathCandidates: filePath com/sem data:// e a pasta download', () => {
  assert.deepEqual(receivedPathCandidates({ filePath: 'data://download/a.png', fileName: 'a.png' }), ['data://download/a.png', 'data://a.png'])
  assert.deepEqual(receivedPathCandidates({ filePath: 'download/a.png', fileName: 'a.png' }), ['download/a.png', 'data://download/a.png', 'data://a.png'])
  assert.deepEqual(receivedPathCandidates({ filePath: '/data/download/a.png' }), ['/data/download/a.png', 'data://download/a.png'])
  assert.deepEqual(receivedPathCandidates({ fileName: 'x/b.png' }), ['data://download/b.png', 'data://b.png'])
  assert.deepEqual(receivedPathCandidates(null), [])
  assert.notEqual(fileKey({ fileName: 'a', sessionId: 1 }), fileKey({ fileName: 'a', sessionId: 2 }))
})
