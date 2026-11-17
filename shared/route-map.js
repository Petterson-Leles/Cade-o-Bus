// Geometria do trajeto (lógica pura, testada em test/route-map.test.mjs):
// projeção local, posição do ônibus ao longo do trajeto e recorte do mini mapa.
// O side service usa isso e manda ao relógio só pontos já em pixels.
import { simplifyXY } from './polyline.js'
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
// No máximo tantos pontos de ônibus no mapa (cada um vira um CIRCLE no relógio).
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
//     stops: [x, y, ...], buses: [{ x, y, clamped }], passed?: { x, y, clamped, vehicle, at } }
// - center: centro do mapa em metros na projeção do ponto (padrão: o próprio ponto);
//   pxPerKm: escala (ver chooseFrame em map-frame.js); radiusM: raio do recorte.
// - route: trajeto recortado ao círculo; hi: trecho do 1º ônibus até o ponto,
//   saindo exatamente de onde o ícone do ônibus é desenhado;
// - trail: bolinhas sobre o trajeto já percorrido pelo 1º ônibus (até trailM atrás dele);
// - stops: outros pontos da linha dentro do círculo; buses: na mesma ordem de `buses`
//   (no trajeto quando o ônibus está nele, senão a posição do GPS);
// - passed: ônibus que acabou de passar do ponto ({ lat, lon, along?, vehicle, at }).
// ctx vem de routeContext (pode ser null: só os ônibus em linha reta).
// buses: [{ lat, lon, route?: saída de busOnRoute }]; lineStops: [{ lat, lon, id }].
export function buildMapPayload({
  ctx,
  stop,
  buses = [],
  lineStops = [],
  radiusM = MAP_RADIUS_M,
  pxPerKm = MAP_PX_PER_KM,
  center = null,
  busMaxR,
  maxStops = MAX_MAP_STOPS,
  trailM = TRAIL_M,
  passed = null
}) {
  const pxPerM = pxPerKm / 1000
  const r = Math.round(radiusM * pxPerM)
  const project = ctx ? ctx.project : stop ? makeProjection(stop) : null
  const cx = center && Number.isFinite(center[0]) ? center[0] : 0
  const cy = center && Number.isFinite(center[1]) ? center[1] : 0
  const payload = { r, k: Math.round(pxPerKm), stop: { x: Math.round(-cx * pxPerM) || 0, y: Math.round(-cy * pxPerM) || 0 }, route: [], hi: [], trail: [], stops: [], buses: [] }
  if (!project) return payload
  // Metros (projeção do ponto) -> metros relativos ao centro do mapa.
  const shift = (pts) => pts.map((p) => [p[0] - cx, p[1] - cy])
  const clip = (pts) => toPixelPieces(clipToCircle(shift(pts), radiusM), pxPerM)
  const onRoute = (b) => ctx && ctx.pts.length >= 2 && b && b.route && !b.route.passed && Number.isFinite(b.route.along)
  if (ctx && ctx.pts.length >= 2) {
    payload.route = clip(ctx.pts)
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
        payload.hi.push(...clip(part))
      })
      // Rastro: trajeto já percorrido, parado no mapa (não segue o ícone).
      const back = subPolyline(ctx.pts, ctx.cum, Math.max(0, first.along - trailM), first.along)
      const pieces = clipToCircle(shift(back), radiusM).map((piece) => piece.map((p) => [p[0] * pxPerM, p[1] * pxPerM]))
      payload.trail = dotsAlong(
        pieces.map((piece) => piece.reduce((flat, p) => flat.concat(p), [])),
        TRAIL_SPACING_PX,
        MAX_TRAIL_DOTS
      )
    }
  }
  const stopId = stop && stop.id !== undefined ? String(stop.id) : null
  for (let i = 0; i < lineStops.length && payload.stops.length < maxStops * 2; i++) {
    const s = lineStops[i]
    if (stopId !== null && String(s.id) === stopId) continue
    const [mx, my] = project(s.lat, s.lon)
    if (!(Math.hypot(mx - cx, my - cy) <= radiusM)) continue
    if (Math.hypot(mx, my) * pxPerM < 1) continue // em cima do ponto do usuário
    payload.stops.push(Math.round((mx - cx) * pxPerM) || 0, Math.round((my - cy) * pxPerM) || 0)
  }
  const maxR = busMaxR === undefined ? r : busMaxR
  // Posição em pixels (presa ao raio maxR) de um ponto em metros.
  const place = (m) => {
    if (!m || !Number.isFinite(m[0]) || !Number.isFinite(m[1])) return null
    let x = (m[0] - cx) * pxPerM
    let y = (m[1] - cy) * pxPerM
    const d = Math.hypot(x, y)
    const clamped = d > maxR
    if (clamped) {
      x = (x / d) * maxR
      y = (y / d) * maxR
    }
    return { x: Math.round(x) || 0, y: Math.round(y) || 0, clamped }
  }
  const metersOf = (b, along) => {
    if (ctx && ctx.pts.length >= 2 && Number.isFinite(along)) return pointAt(ctx.pts, ctx.cum, along)
    const lat = toNum(b.lat)
    const lon = toNum(b.lon)
    return Number.isFinite(lat) && Number.isFinite(lon) ? project(lat, lon) : null
  }
  payload.buses = buses.map((b) => (b ? place(metersOf(b, onRoute(b) ? b.route.along : NaN)) : null))
  if (passed) {
    const pos = place(metersOf(passed, toNum(passed.along)))
    if (pos) payload.passed = { ...pos, vehicle: String(passed.vehicle || '').slice(0, 12), at: Number(passed.at) || 0 }
  }
  return payload
}

// Valida o mapa recebido no relógio: devolve um mapa seguro (números inteiros
// dentro de ±limit) ou null.
export function sanitizeMapPayload(map, limit = 200) {
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
    buses: Array.isArray(map.buses) ? map.buses.map(point) : [],
    passed: null,
    // Mapa de ruas: nível fixo usado (índice) e centro do enquadramento em metros
    // relativos ao ponto (x leste, y sul), para o relógio posicionar os blocos.
    level: Number.isInteger(map.level) && map.level >= 0 && map.level <= 5 ? map.level : null,
    center: [0, 0]
  }
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

// Caminho da animação: do ônibus até o ponto, em pixels (último pedaço do destaque,
// que termina no ponto). Só vale se o ônibus estiver dentro do mapa (não preso à
// borda) e o pedaço começar perto dele; senão [].
export function animationPath(map, maxStartGapPx = 6) {
  if (!map || !map.hi || map.hi.length === 0 || !map.buses || !map.buses[0]) return []
  const bus = map.buses[0]
  if (bus.clamped) return []
  const piece = map.hi[map.hi.length - 1]
  if (!piece || piece.length < 4 || Math.hypot(piece[0] - bus.x, piece[1] - bus.y) > maxStartGapPx) return []
  return piece
}
