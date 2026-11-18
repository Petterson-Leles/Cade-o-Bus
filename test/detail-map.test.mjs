// Tela do ponto: mapa na tela toda com o texto direto sobre ele (sem fundo), zoom só
// automático com histerese e blocos/diagnóstico do mapa no retângulo da tela.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAYOUT, MAP_CX, MAP_CY, MAP_RECT, ICON_HALF, SCREEN_R, boxInsideCircle, boxesOverlap, iconArea, tileView, demandView, chipBox, estimateTextWidth } from '../shared/detail-layout.js'
import { etaNumberLayout, etaDigitsText, etaDigitSrc, etaMinSrc, digitsByBand, etaSlug, ETA_SCALES } from '../utils/eta-digits.js'
import { ETA_DIGIT_DATA } from '../utils/eta-digits-data.js'
import { MAP_COORD_LIMIT, parseBusesResult } from '../utils/detail-view.js'
import fs from 'node:fs'
import { MAP_VIEW, MAP_CLIP, chooseFrame, stableFrame, pickLevel, idealScale, frameCenter, fitsView, LEVEL_ZOOM_IN_MARGIN } from '../shared/map-frame.js'
import { parseManifest, compactManifest, tilesForView, emptyBits, setBit } from '../shared/map-tiles.js'
import { demandPlan, viewTiles, buildDemandParams, parseDemandParams, cleanViewRect, mapDiagText, confirmTiles, PRIO } from '../shared/map-demand.js'
import { clipToRect, buildMapPayload, sanitizeMapPayload, makeProjection } from '../shared/route-map.js'
import { cleanDiag, diagCount, diagError, diagManifest, diagWatch, diagLines, clockText } from '../shared/map-download.js'
import { watchInbox, receivedPathCandidates, fileKey } from '../shared/transfer.js'

const LEVELS = [41.2, 82.4, 164.81]
const SCALE = 466 / 480
const px = (v) => v * SCALE

// ---- Layout ----

test('layout: tudo cabe na tela redonda; topo e rodapé centralizados, em ordem', () => {
  Object.entries(LAYOUT).forEach(([name, b]) => {
    if (name === 'chip') return
    assert.ok(boxInsideCircle(b), `${name} sai da tela redonda`)
  })
  // Topo e rodapé centralizados na tela.
  ;['title', 'info', 'next', 'quiet', 'pill', 'footer'].forEach((name) => {
    const b = LAYOUT[name]
    assert.ok(Math.abs(b.x + b.w / 2 - SCREEN_R) <= 0.5, `${name} fora do centro`)
  })
  // Nome, selo, número, rodapé: de cima para baixo sem sobrepor.
  const chip = chipBox(60)
  assert.ok(chip.y >= LAYOUT.title.y + LAYOUT.title.h)
  for (const min of [4, 12, 120]) {
    const n = etaNumberLayout(min)
    assert.ok(n.box.y >= chip.y + chip.h, `${min}: número no selo`)
    assert.ok(n.box.y + n.box.h <= LAYOUT.etaAge.y + 2, `${min}: número no aviso de GPS`)
  }
  assert.ok(LAYOUT.info.y >= LAYOUT.etaAge.y + LAYOUT.etaAge.h)
  assert.ok(LAYOUT.next.y >= LAYOUT.info.y + LAYOUT.info.h)
  assert.ok(LAYOUT.quiet.y >= LAYOUT.next.y + LAYOUT.next.h)
  // Sem ônibus: as três linhas em ordem.
  assert.ok(LAYOUT.emptyLine1.y >= LAYOUT.emptyTitle.y + LAYOUT.emptyTitle.h)
  assert.ok(LAYOUT.emptyLine2.y >= LAYOUT.emptyLine1.y + LAYOUT.emptyLine1.h)
})

test('selo da linha: centrado, largura pelo texto, dentro da tela', () => {
  const a = chipBox(40)
  assert.equal(a.x + a.w / 2, SCREEN_R)
  assert.equal(a.w, 64)
  assert.equal(chipBox(0).w, LAYOUT.chip.minW)
  assert.equal(chipBox(9999).w, LAYOUT.chip.maxW)
  assert.equal(chipBox('x').w, LAYOUT.chip.minW)
  assert.ok(boxInsideCircle(chipBox(9999)))
  assert.ok(estimateTextWidth('9250', 17) > 30 && estimateTextWidth('', 17) === 0)
})

test('mapa na tela toda, ponto à direita do centro e ícones inteiros na tela redonda', () => {
  assert.deepEqual(MAP_RECT, { x: 0, y: 0, w: 480, h: 480 })
  // Ponto (centro do enquadramento sem ônibus) ~ 0,75 da largura e ~ 0,6 da altura.
  assert.ok(MAP_CX >= 0.7 * 480 && MAP_CX <= 0.78 * 480)
  assert.ok(MAP_CY >= 0.55 * 480 && MAP_CY <= 0.62 * 480)
  const a = iconArea()
  ;[
    [a.x0, a.y0],
    [a.x1, a.y0],
    [a.x0, a.y1],
    [a.x1, a.y1]
  ].forEach(([x, y]) => assert.ok(Math.hypot(x - SCREEN_R, y - SCREEN_R) + ICON_HALF <= SCREEN_R, `${x},${y}`))
  // O recorte do canvas é a tela (relativo ao centro do mapa).
  assert.deepEqual([MAP_CX + MAP_CLIP.x0, MAP_CY + MAP_CLIP.y0, MAP_CLIP.x1 - MAP_CLIP.x0, MAP_CLIP.y1 - MAP_CLIP.y0], [0, 0, 480, 480])
  // O ponto (com o anel de 13 px) não fica atrás do número em nenhum tamanho.
  const stop = { x: MAP_CX - 13, y: MAP_CY - 13, w: 26, h: 26 }
  for (const min of [4, 12, 120]) assert.equal(boxesOverlap(stop, etaNumberLayout(min).box), false, String(min))
  // Coordenadas do mapa cabem na validação do relógio (até o canto mais longe).
  const far = Math.max(...[MAP_CLIP.x0, MAP_CLIP.x1, MAP_CLIP.y0, MAP_CLIP.y1].map(Math.abs))
  assert.ok(far <= MAP_COORD_LIMIT)
  const r = parseBusesResult({ buses: [], map: { route: [[MAP_CLIP.x0, MAP_CLIP.y0, MAP_CLIP.x1, MAP_CLIP.y1]], buses: [], stop: { x: 0, y: 0 } } })
  assert.equal(r.map.route.length, 1)
})

// ---- Número grande em imagens ----

test('número: algarismos em imagem só para inteiros de 0 a 999', () => {
  assert.equal(etaDigitsText(4), '4')
  assert.equal(etaDigitsText(0), '0')
  assert.equal(etaDigitsText(' 12 '), '12')
  assert.equal(etaDigitsText(999), '999')
  for (const bad of [1000, -1, 2.5, NaN, null, undefined, '', 'abc', {}]) assert.equal(etaDigitsText(bad), null, String(bad))
  assert.equal(etaNumberLayout(null), null)
})

test('número: 1 dígito maior que 2 e 3, "min" à direita e na base do número', () => {
  const one = etaNumberLayout(4)
  const two = etaNumberLayout(12)
  const three = etaNumberLayout(120)
  assert.equal(one.digits.length, 1)
  assert.equal(two.digits.length, 2)
  assert.equal(three.digits.length, 3)
  assert.ok(one.digits[0].h > two.digits[0].h && two.digits[0].h > three.digits[0].h)
  // ~230 px de fonte para 1 dígito e ~170 para 2 (proporção do layout aprovado).
  assert.ok(Math.abs(two.scale * 230 - 170) < 0.5)
  for (const n of [one, two, three]) {
    const last = n.digits[n.digits.length - 1]
    // Algarismos da esquerda para a direita, sem sobrepor.
    for (let i = 1; i < n.digits.length; i++) assert.ok(n.digits[i].x >= n.digits[i - 1].x + n.digits[i - 1].w)
    assert.ok(n.min.x >= last.x + last.w)
    // Base do "min" = base do número.
    const base = last.y + (ETA_DIGIT_DATA.base / ETA_DIGIT_DATA.k) * n.scale
    const minBase = n.min.y + ETA_DIGIT_DATA.min.base / ETA_DIGIT_DATA.k
    assert.ok(Math.abs(base - minBase) < 0.01)
    // Tudo dentro da tela redonda.
    assert.ok(boxInsideCircle(n.box), JSON.stringify(n.box))
    n.digits.forEach((d) => assert.ok(boxInsideCircle(d)))
    assert.ok(boxInsideCircle(n.min))
  }
  // Ocupa os mesmos lugares no tempo todo: 1 dígito em x ~ 40..300.
  assert.ok(one.box.x >= 30 && one.box.x + one.box.w <= 300)
})

test('número: todo algarismo usado existe em PNG, para cada faixa e tema', () => {
  const sets = digitsByBand()
  assert.deepEqual(sets.chegando, [0, 1, 2])
  assert.deepEqual(sets.jaja, [3, 4, 5])
  assert.deepEqual(sets.longe, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(etaSlug(1), 'chegando')
  assert.equal(etaDigitSrc(4, 4, 'light'), 'eta/light-jaja-4.png')
  assert.equal(etaDigitSrc(1, 12, 'azul'), 'eta/dark-tranquilo-1.png')
  assert.equal(etaMinSrc('light'), 'eta/light-min.png')
  const file = (src) => new URL(`../assets/common.r/${src}`, import.meta.url)
  for (const theme of ['dark', 'light']) {
    assert.ok(fs.existsSync(file(etaMinSrc(theme))), theme)
    for (let n = 0; n <= 999; n++) {
      for (const d of String(n)) assert.ok(fs.existsSync(file(etaDigitSrc(Number(d), n, theme))), `${theme} ${n}`)
    }
  }
  // Nenhum PNG sobrando (só o que as faixas usam) e todos indexados (leves).
  const dir = new URL('../assets/common.r/eta/', import.meta.url)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'))
  const expected = 2 * (Object.values(sets).reduce((a, l) => a + l.length, 0) + 1)
  assert.equal(files.length, expected)
  for (const f of files) {
    const png = fs.readFileSync(new URL(f, dir))
    assert.equal(png[25], 3, `${f} não é PNG indexado`)
  }
  // Dados de tamanho coerentes com as imagens (altura comum).
  const h = fs.readFileSync(new URL('dark-longe-8.png', dir)).readUInt32BE(20)
  assert.equal(h, ETA_DIGIT_DATA.h)
  assert.equal(ETA_SCALES[0], 1)
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
