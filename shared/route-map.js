// Geometria do trajeto (lógica pura, testada em test/route-map.test.mjs):
// projeção local, posição do ônibus ao longo do trajeto e recorte do mini mapa.
// O side service usa isso e manda ao relógio só pontos já em pixels.
import { simplifyXY } from './polyline.js'
import { stopKindCode, parseStopKinds } from './stop-icons.js'
import { MAP_BUS_MAX_R, TRAIL_M, TRAIL_SPACING_PX, MAX_TRAIL_DOTS, dotsAlong } from './map-frame.js'

export { MAP_BUS_MAX_R }

// Metros por grau (aproximação esférica, boa para alguns km).
export const M_PER_DEG = 111320
// Raio do trecho mostrado no mini mapa (metros) e escala (pixels de design por km).
export const MAP_RADIUS_M = 750
export const MAP_PX_PER_KM = 128
// Raio útil do mapa em pixels de design (750 m * 128 px/km = 96 px).
export const MAP_RADIUS_PX = Math.round((MAP_RADIUS_M / 1000) * MAP_PX_PER_KM)
// Ônibus a mais que isso do trajeto é tratado como fora da rota (linha reta).
export const MAX_OFF_ROUTE_M = 150
// Tolerância para considerar que o ônibus "já passou" do ponto (GPS impreciso).
export const PASSED_TOLERANCE_M = 40
// Com velocidade a partir disso o rumo do GPS (DG) é confiável para saber o sentido.
export const MIN_HEADING_SPEED_KMH = 5
// Diferença máxima entre o rumo do ônibus e o do trajeto para contar como mesmo sentido.
export const MAX_HEADING_DIFF_DEG = 90
// Trajeto cujo início e fim ficam a menos disso é circular.
export const LOOP_GAP_M = 300
// No máximo tantos pontos de ônibus no mapa (losango no canvas ou ícone IMG no relógio).
export const MAX_MAP_STOPS = 16

const toNum = (v) => (typeof v === 'number' ? v : Number(String(v === undefined || v === null ? '' : v).trim().replace(',', '.')))

// Projeção equiretangular centrada em `center` ({ lat, lon }): (lat, lon) -> [x, y]
// em metros, x para leste e y para o SUL (como a tela: y cresce para baixo).
export function makeProjection(center) {
  const lat0 = toNum(center.lat)
  const lon0 = toNum(center.lon)
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  return (lat, lon) => [(toNum(lon) - lon0) * kx, -(toNum(lat) - lat0) * M_PER_DEG]
}

// Distância acumulada de cada vértice desde o início.
export function cumulative(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return cum
}

function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a[0] + t * dx
  const y = a[1] + t * dy
  return { t, x, y, dist: Math.hypot(p[0] - x, p[1] - y) }
}

// Rumo (graus, 0 = norte, sentido horário) do segmento i, em coordenadas da tela.
export function segmentBearing(pts, i) {
  const dx = pts[i + 1][0] - pts[i][0]
  const dy = pts[i + 1][1] - pts[i][1]
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
}

export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

// Projeção de p em cada segmento: [{ seg, along, dist, x, y }], do mais perto ao mais longe.
export function projections(pts, cum, p) {
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = projectOnSegment(p, pts[i], pts[i + 1])
    out.push({ seg: i, along: cum[i] + q.t * (cum[i + 1] - cum[i]), dist: q.dist, x: q.x, y: q.y })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

// Ponto mais próximo do trajeto: { seg, along, dist, x, y } ou null.
export function projectPoint(pts, cum, p) {
  if (!pts || pts.length < 2) return null
  return projections(pts, cum, p)[0]
}

// Ponto do trajeto a `along` metros do início.
export function pointAt(pts, cum, along) {
  if (along <= 0) return pts[0].slice()
  const last = pts.length - 1
  if (along >= cum[last]) return pts[last].slice()
  let i = 0
  while (i < last - 1 && cum[i + 1] < along) i++
  const len = cum[i + 1] - cum[i]
  const t = len > 0 ? (along - cum[i]) / len : 0
  return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]
}

// Trecho do trajeto entre `from` e `to` metros (from < to), com as pontas interpoladas.
export function subPolyline(pts, cum, from, to) {
  if (!pts || pts.length < 2 || !(to > from)) return []
  const out = [pointAt(pts, cum, from)]
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > from && cum[i] < to) out.push(pts[i].slice())
  }
  out.push(pointAt(pts, cum, to))
  return out
}

// Contexto do trajeto em volta de um ponto: trajeto em metros (centrado no
// ponto), comprimentos acumulados e a posição do ponto ao longo dele.
// shape: [[lat, lon], ...]; stop: { lat, lon }.
export function routeContext(shape, stop) {
  if (!stop || !Number.isFinite(toNum(stop.lat)) || !Number.isFinite(toNum(stop.lon))) return null
  const project = makeProjection(stop)
  const pts = (shape || []).map((p) => project(p[0], p[1])).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 2) return { project, pts: [], cum: [], total: 0, stopAlong: null, loop: false }
  const cum = cumulative(pts)
  const total = cum[cum.length - 1]
  const s = projectPoint(pts, cum, [0, 0])
  const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
  return { project, pts, cum, total, stopAlong: s.along, stopOffM: s.dist, loop: gap <= LOOP_GAP_M }
}

// Onde o ônibus está no trajeto e quanto falta até o ponto pela rua.
// Devolve { along, offM, toStopM, passed } ou null se o ônibus estiver fora
// da rota (mais de maxOffM do trajeto) ou não houver trajeto.
// Quando a rota passa duas vezes pela mesma rua, entre as projeções próximas
// fica a que ainda chega ao ponto pelo menor caminho.
// Se bus.heading (graus) vier e bus.speed >= MIN_HEADING_SPEED_KMH, só valem os
// trechos no mesmo rumo; nenhum no mesmo rumo = ônibus no sentido contrário
// (devolve wrongWay e passed = true, para sair da lista).
export function busOnRoute(ctx, bus, { maxOffM = MAX_OFF_ROUTE_M, tolM = PASSED_TOLERANCE_M } = {}) {
  if (!ctx || !ctx.pts || ctx.pts.length < 2 || ctx.stopAlong === null || !bus) return null
  const lat = toNum(bus.lat)
  const lon = toNum(bus.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const p = ctx.project(lat, lon)
  const all = projections(ctx.pts, ctx.cum, p)
  const best = all[0]
  if (!best || best.dist > maxOffM) return null
  let near = all.filter((q) => q.dist <= Math.min(maxOffM, best.dist + 25))
  const heading = toNum(bus.heading)
  const speed = toNum(bus.speed)
  if (Number.isFinite(heading) && Number.isFinite(speed) && speed >= MIN_HEADING_SPEED_KMH) {
    near = near.filter((q) => angleDiff(segmentBearing(ctx.pts, q.seg), heading) <= MAX_HEADING_DIFF_DEG)
    if (near.length === 0) return { along: best.along, offM: best.dist, toStopM: null, passed: true, wrongWay: true }
  }
  const ahead = (q) => {
    const d = ctx.stopAlong - q.along
    if (d >= -tolM) return Math.max(0, d)
    return ctx.loop ? ctx.total - q.along + ctx.stopAlong : null
  }
  let chosen = null
  let chosenTo = null
  near.forEach((q) => {
    const d = ahead(q)
    if (d !== null && (chosenTo === null || d < chosenTo)) {
      chosen = q
      chosenTo = d
    }
  })
  if (!chosen) return { along: best.along, offM: best.dist, toStopM: null, passed: true }
  return { along: chosen.along, offM: chosen.dist, toStopM: chosenTo, passed: false }
}

function inside(p, r) {
  return p[0] * p[0] + p[1] * p[1] <= r * r
}

// Valores t em (0, 1) onde o segmento a->b cruza o círculo de raio r (centro 0,0).
function circleHits(a, b, r) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const A = dx * dx + dy * dy
  if (A === 0) return []
  const B = 2 * (a[0] * dx + a[1] * dy)
  const C = a[0] * a[0] + a[1] * a[1] - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return []
  const sq = Math.sqrt(disc)
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t > 0 && t < 1)
}

// Recorta uma polyline ao círculo de raio r centrado na origem.
// Devolve uma lista de pedaços (a rota pode sair e voltar ao círculo).
export function clipToCircle(pts, r) {
  const pieces = []
  let cur = null
  const lerp = (a, b, t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (i === 0) {
      if (inside(p, r)) cur = [p.slice()]
      continue
    }
    const a = pts[i - 1]
    const hits = circleHits(a, p, r)
    if (cur) {
      // Estava dentro.
      if (inside(p, r)) cur.push(p.slice())
      else {
        cur.push(lerp(a, p, hits.length ? hits[hits.length - 1] : 1))
        pieces.push(cur)
        cur = null
      }
    } else if (inside(p, r)) {
      cur = [lerp(a, p, hits.length ? hits[0] : 0), p.slice()]
    } else if (hits.length === 2) {
      // Atravessa o círculo sem vértice dentro.
      pieces.push([lerp(a, p, hits[0]), lerp(a, p, hits[1])])
    }
  }
  if (cur) pieces.push(cur)
  return pieces.filter((piece) => piece.length >= 2)
}

// Recorta uma polyline ao retângulo { x0, x1, y0, y1 } (Liang–Barsky por segmento).
// Devolve uma lista de pedaços (a rota pode sair e voltar ao retângulo).
export function clipToRect(pts, rect) {
  const pieces = []
  let cur = null
  const inR = (p) => p[0] >= rect.x0 && p[0] <= rect.x1 && p[1] >= rect.y0 && p[1] <= rect.y1
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    let t0 = 0
    let t1 = 1
    let ok = true
    ;[
      [-dx, a[0] - rect.x0],
      [dx, rect.x1 - a[0]],
      [-dy, a[1] - rect.y0],
      [dy, rect.y1 - a[1]]
    ].forEach(([pp, q]) => {
      if (!ok) return
      if (pp === 0) {
        if (q < 0) ok = false
        return
      }
      const t = q / pp
      if (pp < 0) {
        if (t > t1) ok = false
        else if (t > t0) t0 = t
      } else if (t < t0) ok = false
      else if (t < t1) t1 = t
    })
    if (!ok) {
      if (cur) pieces.push(cur)
      cur = null
      continue
    }
    const p0 = [a[0] + t0 * dx, a[1] + t0 * dy]
    const p1 = [a[0] + t1 * dx, a[1] + t1 * dy]
    if (!cur) cur = [p0]
    cur.push(p1)
    // Saiu do retângulo no meio do segmento: fecha o pedaço.
    if (t1 < 1 || !inR(b)) {
      pieces.push(cur)
      cur = null
    }
  }
  if (cur) pieces.push(cur)
  return pieces.filter((piece) => piece.length >= 2)
}

// Pedaços em metros -> arrays planos de inteiros em pixels [x0, y0, x1, y1, ...],
// simplificados (1 px) e sem pontos repetidos.
export function toPixelPieces(pieces, pxPerM) {
  const out = []
  pieces.forEach((piece) => {
    const scaled = simplifyXY(piece.map((p) => [p[0] * pxPerM, p[1] * pxPerM]), 1)
    const flat = []
    scaled.forEach((p) => {
      const x = Math.round(p[0]) || 0
      const y = Math.round(p[1]) || 0
      const n = flat.length
      if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) return
      flat.push(x, y)
    })
    if (flat.length >= 4) out.push(flat)
  })
  return out
}

// Posição de um ponto (lat, lon) no mapa em pixels, presa ao raio maxR.
export function pixelPosition(project, lat, lon, pxPerM, maxR) {
  const [mx, my] = project(lat, lon)
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null
  let x = mx * pxPerM
  let y = my * pxPerM
  const r = Math.hypot(x, y)
  const clamped = r > maxR
  if (clamped) {
    x = (x / r) * maxR
    y = (y / r) * maxR
  }
  return { x: Math.round(x) || 0, y: Math.round(y) || 0, clamped }
}

// Tudo o que o relógio desenha no mini mapa, em pixels de design relativos ao
// centro do mapa:
//   { r, k, stop: { x, y }, route: [[x, y, ...]], hi: [[x, y, ...]], trail: [x, y, ...],
//     stops: [x, y, ...], kinds: 'smc...', buses: [{ x, y, clamped }], passed?: { x, y, clamped, vehicle, at } }
// - center: centro do mapa em metros na projeção do ponto (padrão: o próprio ponto);
//   pxPerKm: escala (ver chooseFrame em map-frame.js); radiusM: raio do recorte.
// - route: trajeto recortado ao círculo; hi: trecho do 1º ônibus até o ponto,
//   saindo exatamente de onde o ícone do ônibus é desenhado;
// - trail: bolinhas sobre o trajeto já percorrido pelo 1º ônibus (até trailM atrás dele);
// - stops: outros pontos da linha dentro do círculo; kinds: o tipo de cada um
//   ('s' rua, 'm' MOVE, 'c' estação central); buses: na mesma ordem de `buses`
//   (no trajeto quando o ônibus está nele, senão a posição do GPS);
// - passed: ônibus que acabou de passar do ponto ({ lat, lon, along?, vehicle, at }).
// ctx vem de routeContext (pode ser null: só os ônibus em linha reta).
// buses: [{ lat, lon, route?: saída de busOnRoute }]; lineStops: [{ lat, lon, id, station? }].
export function buildMapPayload({
  ctx,
  stop,
  buses = [],
  lineStops = [],
  radiusM = MAP_RADIUS_M,
  pxPerKm = MAP_PX_PER_KM,
  center = null,
  busMaxR,
  clip = null,
  busBox = null,
  maxStops = MAX_MAP_STOPS,
  trailM = TRAIL_M,
  passed = null
}) {
  const pxPerM = pxPerKm / 1000
  const r = Math.round(radiusM * pxPerM)
  const project = ctx ? ctx.project : stop ? makeProjection(stop) : null
  const cx = center && Number.isFinite(center[0]) ? center[0] : 0
  const cy = center && Number.isFinite(center[1]) ? center[1] : 0
  const payload = { r, k: Math.round(pxPerKm), stop: { x: Math.round(-cx * pxPerM) || 0, y: Math.round(-cy * pxPerM) || 0 }, route: [], hi: [], trail: [], stops: [], kinds: '', buses: [] }
  if (!project) return payload
  // Metros (projeção do ponto) -> metros relativos ao centro do mapa.
  const shift = (pts) => pts.map((p) => [p[0] - cx, p[1] - cy])
  // clip (px, relativo ao centro do mapa): retângulo desenhado; sem ele, o círculo radiusM.
  const rectM = clip ? { x0: clip.x0 / pxPerM, x1: clip.x1 / pxPerM, y0: clip.y0 / pxPerM, y1: clip.y1 / pxPerM } : null
  const cut = (pts) => (rectM ? clipToRect(pts, rectM) : clipToCircle(pts, radiusM))
  const inView = (x, y) => (rectM ? x >= rectM.x0 && x <= rectM.x1 && y >= rectM.y0 && y <= rectM.y1 : Math.hypot(x, y) <= radiusM)
  const clipPx = (pts) => toPixelPieces(cut(shift(pts)), pxPerM)
  const onRoute = (b) => ctx && ctx.pts.length >= 2 && b && b.route && !b.route.passed && Number.isFinite(b.route.along)
  if (ctx && ctx.pts.length >= 2) {
    payload.route = clipPx(ctx.pts)
    const first = buses[0] && buses[0].route
    if (onRoute(buses[0]) && ctx.stopAlong !== null) {
      let parts
      if (first.along <= ctx.stopAlong + PASSED_TOLERANCE_M) {
        parts = [subPolyline(ctx.pts, ctx.cum, first.along, ctx.stopAlong)]
      } else {
        // Rota circular: do ônibus até o fim e do começo até o ponto.
        parts = [subPolyline(ctx.pts, ctx.cum, first.along, ctx.total), subPolyline(ctx.pts, ctx.cum, 0, ctx.stopAlong)]
      }
      parts.forEach((part) => {
        payload.hi.push(...clipPx(part))
      })
      // Rastro: trajeto já percorrido, parado no mapa (não segue o ícone).
      const back = subPolyline(ctx.pts, ctx.cum, Math.max(0, first.along - trailM), first.along)
      const pieces = cut(shift(back)).map((piece) => piece.map((p) => [p[0] * pxPerM, p[1] * pxPerM]))
      payload.trail = dotsAlong(
        pieces.map((piece) => piece.reduce((flat, p) => flat.concat(p), [])),
        TRAIL_SPACING_PX,
        MAX_TRAIL_DOTS
      )
    }
  }
  // Outros pontos da linha na vista, com o tipo (kinds: uma letra por ponto, 's' rua,
  // 'm' estação MOVE, 'c' estação central; shared/stop-icons.js). Passando de
  // maxStops, as estações ficam primeiro (central, depois MOVE) e o resto na ordem.
  const stopId = stop && stop.id !== undefined ? String(stop.id) : null
  const seen = []
  for (let i = 0; i < lineStops.length; i++) {
    const s = lineStops[i]
    if (stopId !== null && String(s.id) === stopId) continue
    const [mx, my] = project(s.lat, s.lon)
    if (!inView(mx - cx, my - cy)) continue
    if (Math.hypot(mx, my) * pxPerM < 1) continue // em cima do ponto do usuário
    seen.push({ i, x: Math.round((mx - cx) * pxPerM) || 0, y: Math.round((my - cy) * pxPerM) || 0, code: stopKindCode(s) })
  }
  const rank = { c: 0, m: 1, s: 2 }
  const kept = seen.length <= maxStops ? seen : seen.slice().sort((a, b) => rank[a.code] - rank[b.code] || a.i - b.i).slice(0, maxStops).sort((a, b) => a.i - b.i)
  kept.forEach((p) => payload.stops.push(p.x, p.y))
  payload.kinds = kept.map((p) => p.code).join('')
  const maxR = busMaxR === undefined ? r : busMaxR
  // Dentro da área dos ícones? busBox { hx, hy } (retângulo, px) ou o raio maxR.
  const inBox = (x, y) => (busBox ? Math.abs(x) <= busBox.hx && Math.abs(y) <= busBox.hy : Math.hypot(x, y) <= maxR)
  // Posição em pixels (presa à área dos ícones) de um ponto em metros.
  const place = (m) => {
    if (!m || !Number.isFinite(m[0]) || !Number.isFinite(m[1])) return null
    let x = (m[0] - cx) * pxPerM
    let y = (m[1] - cy) * pxPerM
    const clamped = !inBox(x, y)
    if (clamped) {
      // Puxa em linha reta (na direção do centro) até a borda da área.
      const f = busBox ? Math.min(Math.abs(x) > 0 ? busBox.hx / Math.abs(x) : Infinity, Math.abs(y) > 0 ? busBox.hy / Math.abs(y) : Infinity) : maxR / Math.hypot(x, y)
      x *= f
      y *= f
    }
    return { x: Math.round(x) || 0, y: Math.round(y) || 0, clamped }
  }
  // posM: posição já calculada (metros, projeção do ponto), ex. ônibus noutra variante.
  const metersOf = (b, along) => {
    if (b && Array.isArray(b.posM) && Number.isFinite(b.posM[0]) && Number.isFinite(b.posM[1])) return b.posM
    if (ctx && ctx.pts.length >= 2 && Number.isFinite(along)) return pointAt(ctx.pts, ctx.cum, along)
    const lat = toNum(b.lat)
    const lon = toNum(b.lon)
    return Number.isFinite(lat) && Number.isFinite(lon) ? project(lat, lon) : null
  }
  // Ônibus no trajeto e fora do círculo: em vez de puxar em linha reta para a borda
  // (sairia da rua), anda pelo trajeto em direção ao ponto até entrar no raio maxR.
  const placeOnRoute = (b) => {
    const along = b.route.along
    const pos = place(pointAt(ctx.pts, ctx.cum, along))
    if (!pos || !pos.clamped || ctx.stopAlong === null) return pos
    const end = along <= ctx.stopAlong + PASSED_TOLERANCE_M ? ctx.stopAlong : ctx.total + ctx.stopAlong
    const step = Math.max(1, 2 / pxPerM)
    const at = (a) => {
      const m = pointAt(ctx.pts, ctx.cum, a > ctx.total ? a - ctx.total : a)
      return [(m[0] - cx) * pxPerM, (m[1] - cy) * pxPerM]
    }
    const inR = (a) => {
      const p = at(a)
      return inBox(p[0], p[1])
    }
    for (let a = along, n = 0; a <= end && n < 4000; a += step, n++) {
      if (!inR(a)) continue
      // Refina entre o passo anterior (fora) e este (dentro): fica bem na borda.
      let lo = Math.max(along, a - step)
      let hi = a
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2
        if (inR(mid)) hi = mid
        else lo = mid
      }
      const p = at(hi)
      return { x: Math.round(p[0]) || 0, y: Math.round(p[1]) || 0, clamped: true }
    }
    return pos
  }
  payload.buses = buses.map((b) => (b ? (onRoute(b) ? placeOnRoute(b) : place(metersOf(b, NaN))) : null))
  if (passed) {
    const pos = place(metersOf(passed, toNum(passed.along)))
    if (pos) payload.passed = { ...pos, vehicle: String(passed.vehicle || '').slice(0, 12), at: Number(passed.at) || 0 }
  }
  return payload
}

// Valida o mapa recebido no relógio: devolve um mapa seguro (números inteiros
// dentro de ±limit) ou null.
export function sanitizeMapPayload(map, limit = 300) {
  if (!map || typeof map !== 'object') return null
  const okNum = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit
  const flat = (a) => (Array.isArray(a) && a.length % 2 === 0 && a.every(okNum) ? a.map(Math.round) : null)
  const pieces = (list) => (Array.isArray(list) ? list.map(flat).filter((a) => a && a.length >= 4) : [])
  const point = (b) => (b && okNum(b.x) && okNum(b.y) ? { x: Math.round(b.x), y: Math.round(b.y), clamped: !!b.clamped } : null)
  const out = {
    r: okNum(map.r) ? Math.round(map.r) : null,
    k: typeof map.k === 'number' && map.k >= 1 && map.k <= 1000 ? Math.round(map.k) : null,
    auto: map.auto !== false,
    speed: typeof map.speed === 'number' && map.speed > 0 && map.speed < 20 ? map.speed : 0,
    stop: point(map.stop) || { x: 0, y: 0, clamped: false },
    route: pieces(map.route),
    hi: pieces(map.hi),
    trail: (flat(map.trail) || []).slice(0, 400),
    stops: flat(map.stops) || [],
    kinds: '',
    buses: Array.isArray(map.buses) ? map.buses.map(point) : [],
    passed: null,
    // Mapa de ruas: nível fixo usado (índice) e centro do enquadramento em metros
    // relativos ao ponto (x leste, y sul), para o relógio posicionar os blocos.
    level: Number.isInteger(map.level) && map.level >= 0 && map.level <= 5 ? map.level : null,
    center: [0, 0]
  }
  // Tipo de cada ponto (uma letra por ponto); inválido ou ausente: tudo ponto de rua.
  out.kinds = parseStopKinds(map.kinds, out.stops.length / 2)
  const c = map.center
  if (Array.isArray(c) && c.length === 2 && c.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) {
    out.center = [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10]
  }
  const p = point(map.passed)
  if (p && typeof map.passed.vehicle === 'string' && typeof map.passed.at === 'number' && Number.isFinite(map.passed.at)) {
    out.passed = { ...p, vehicle: map.passed.vehicle.slice(0, 12), at: map.passed.at }
  }
  return out
}

// ---- Animação do ônibus no relógio (entre as atualizações de 30 s) ----

// Comprimento de uma polyline plana [x0, y0, x1, y1, ...].
export function pathLength(flat) {
  let len = 0
  for (let i = 0; i + 3 < flat.length; i += 2) len += Math.hypot(flat[i + 2] - flat[i], flat[i + 3] - flat[i + 1])
  return len
}

// Ponto a distancePx do início da polyline plana, sem passar do fim.
// Devolve { x, y, along, done } (done = chegou ao fim, isto é, ao ponto do usuário)
// ou null se a polyline estiver vazia.
export function advanceAlong(flat, distancePx) {
  if (!Array.isArray(flat) || flat.length < 2) return null
  let left = Math.max(0, Number(distancePx) || 0)
  let along = 0
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x0 = flat[i]
    const y0 = flat[i + 1]
    const seg = Math.hypot(flat[i + 2] - x0, flat[i + 3] - y0)
    if (left <= seg && seg > 0) {
      const t = left / seg
      return { x: x0 + t * (flat[i + 2] - x0), y: y0 + t * (flat[i + 3] - y0), along: along + left, done: false }
    }
    left -= seg
    along += seg
  }
  return { x: flat[flat.length - 2], y: flat[flat.length - 1], along, done: true }
}

// Mistura linear entre duas posições { x, y } (k de 0 a 1), para a correção curta.
export function blend(from, to, k) {
  const t = Math.max(0, Math.min(1, k))
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

// Velocidade no mapa (pixels de design por segundo) a partir de km/h (15–60).
export function speedPxPerSec(kmh, pxPerKm = MAP_PX_PER_KM) {
  const v = Math.min(60, Math.max(15, Number(kmh) || 15))
  return ((v / 3.6) * pxPerKm) / 1000
}

// Caminho da animação: do ícone do ônibus até o ponto, em pixels, seguindo o
// trajeto (último pedaço do destaque, que termina no ponto). Começa na projeção
// do ícone nesse pedaço (o ícone preso à borda do mapa também fica no trajeto);
// se o ícone estiver a mais de maxStartGapPx do pedaço, [].
export function animationPath(map, maxStartGapPx = 6) {
  if (!map || !map.hi || map.hi.length === 0 || !map.buses || !map.buses[0]) return []
  const bus = map.buses[0]
  const piece = map.hi[map.hi.length - 1]
  if (!piece || piece.length < 4) return []
  let best = null
  for (let i = 0; i + 3 < piece.length; i += 2) {
    const ax = piece[i]
    const ay = piece[i + 1]
    const dx = piece[i + 2] - ax
    const dy = piece[i + 3] - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((bus.x - ax) * dx + (bus.y - ay) * dy) / len2)) : 0
    const x = ax + t * dx
    const y = ay + t * dy
    const d = Math.hypot(bus.x - x, bus.y - y)
    if (!best || d < best.d - 1e-9) best = { d, i, x, y, t }
  }
  if (!best || best.d > maxStartGapPx) return []
  if (best.i === 0 && best.t === 0) return piece
  const out = [best.x, best.y]
  for (let j = best.i + 2; j < piece.length; j += 2) out.push(piece[j], piece[j + 1])
  return out.length >= 4 ? out : []
}

// ---- Variantes da linha (vários shapes no mesmo sentido) ----

// Ponto a até isso de um trajeto conta como "o trajeto passa pelo ponto".
export const STOP_ON_ROUTE_M = 60

// variants: [{ shape, stops, main }] (lineVariants de gtfs.js) -> só os que passam
// pelo ponto, já com o contexto: [{ ctx, stops, main }]. stopId (opcional): o ponto
// precisa estar na sequência da variante. Se nenhum passar, fica o principal.
export function variantsThroughStop(variants, stop, stopId, maxM = STOP_ON_ROUTE_M) {
  const out = []
  let main = null
  ;(variants || []).forEach((v) => {
    const ctx = v.shape && v.shape.length >= 2 ? routeContext(v.shape, stop) : null
    const item = { ctx, stops: v.stops || [], main: !!v.main }
    if (v.main) main = item
    if (!ctx || ctx.stopAlong === null || !(ctx.stopOffM <= maxM)) return
    if (stopId && item.stops.length > 0 && !item.stops.some((s) => String(s.id) === String(stopId))) return
    out.push(item)
  })
  if (out.length === 0 && main) out.push(main)
  return out
}

// Em qual variante o ônibus está: a mais perto (até maxOffM) que ainda chega ao
// ponto; se em todas ele já passou, a mais perto (para o "passou"). Devolve a saída
// de busOnRoute com `variant` (índice em variants) ou null (fora de todas: sai da lista).
export function busOnVariants(variants, bus, opts) {
  let best = null
  ;(variants || []).forEach((v, i) => {
    const r = v && v.ctx ? busOnRoute(v.ctx, bus, opts) : null
    if (!r) return
    const cand = { ...r, variant: i }
    if (!best) {
      best = cand
      return
    }
    const ok = (x) => !x.passed && !x.wrongWay
    if (ok(cand) !== ok(best)) {
      if (ok(cand)) best = cand
      return
    }
    // Mesma situação: o mais encaixado no trajeto; empate (~10 m): o que chega antes.
    if (cand.offM < best.offM - 10 || (Math.abs(cand.offM - best.offM) <= 10 && ok(cand) && cand.toStopM < best.toStopM)) best = cand
  })
  return best
}
