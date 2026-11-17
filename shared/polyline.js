// Polyline codificada (algoritmo do Google, precisão 1e5) e simplificação de
// Douglas-Peucker. Lógica pura: usada pelo script de build (Node) e pelo side service.

// [[lat, lon], ...] -> texto. As coordenadas são arredondadas a 5 casas.
export function encodePolyline(points) {
  let out = ''
  let pLat = 0
  let pLon = 0
  for (let i = 0; i < points.length; i++) {
    const lat = Math.round(points[i][0] * 1e5)
    const lon = Math.round(points[i][1] * 1e5)
    out += encodeSigned(lat - pLat) + encodeSigned(lon - pLon)
    pLat = lat
    pLon = lon
  }
  return out
}

function encodeSigned(value) {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

// Texto -> [[lat, lon], ...]. Texto inválido ou truncado devolve só o que deu para ler.
export function decodePolyline(text) {
  const str = typeof text === 'string' ? text : ''
  const points = []
  let index = 0
  let lat = 0
  let lon = 0
  const next = () => {
    let result = 0
    let shift = 0
    let b
    do {
      if (index >= str.length) return null
      b = str.charCodeAt(index++) - 63
      if (b < 0 || b > 63) return null
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20 && shift < 35)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < str.length) {
    const dLat = next()
    const dLon = next()
    if (dLat === null || dLon === null) break
    lat += dLat
    lon += dLon
    points.push([lat / 1e5, lon / 1e5])
  }
  return points
}

// Douglas-Peucker em coordenadas planas [[x, y], ...] (mesma unidade da tolerância).
// Iterativo (sem recursão) para não estourar a pilha com shapes longos.
export function simplifyXY(points, tolerance) {
  const n = points.length
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const tol2 = tolerance * tolerance
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(points[i], points[a], points[b])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > tol2) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

function segDist2(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const ex = a[0] + t * dx - p[0]
  const ey = a[1] + t * dy - p[1]
  return ex * ex + ey * ey
}

// Douglas-Peucker em [[lat, lon], ...] com tolerância em metros
// (projeção equiretangular local, boa para a escala de uma cidade).
export function simplifyLatLon(points, toleranceM) {
  if (points.length <= 2) return points.slice()
  const lat0 = points[0][0]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 111320
  const xy = points.map((p, i) => [p[1] * kx, p[0] * ky, i])
  return simplifyXY(xy, toleranceM).map((q) => points[q[2]])
}
