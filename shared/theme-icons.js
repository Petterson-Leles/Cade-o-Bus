// Desenhos de SOL (tema claro) e LUA (tema escuro) do seletor de tema da tela de
// configurações, em SVG com animação SMIL (<animate>/<animateTransform>), como data
// URI base64 para o componente Image da Settings App API (src: "Image URL or base64
// string": https://docs.zepp.com/docs/reference/app-settings-api/ui/image/).
// Lógica pura (sem APIs do Zepp OS), testada em test/theme-icons.test.mjs.
//
// Os dois ficam num disco #27445F (azul da paleta "Azul BH e coral", contraste bom
// nos dois temas da tela): sol #FFD166 com raios coral #FF8C42; lua #EAF2FB com
// estrelinhas. Animado (opção escolhida):
// o sol "nasce" e os raios giram devagar com um leve pulsar; a lua aparece e as
// estrelas piscam. Estático (a outra opção): sem animação (a tela esmaece).

export const ICON_SIZE = 40
const DISC = '#27445F'
const SUN = '#FFD166'
const RAYS = '#FF8C42'
const MOON = '#EAF2FB'

function rays() {
  const out = []
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    const p = (r) => [Math.round((20 + r * Math.cos(a)) * 10) / 10, Math.round((20 + r * Math.sin(a)) * 10) / 10]
    const [x1, y1] = p(10.5)
    const [x2, y2] = p(15)
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
  }
  return out.join('')
}

export function sunSvg(animated) {
  const spin = animated ? '<animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="14s" repeatCount="indefinite"/>' : ''
  const glow = animated ? '<animate attributeName="opacity" values="0.75;1;0.75" dur="2.4s" repeatCount="indefinite"/>' : ''
  const pulse = animated ? '<animate attributeName="r" values="7;7.8;7" dur="2.4s" repeatCount="indefinite"/>' : ''
  const rise = animated ? '<animateTransform attributeName="transform" type="translate" from="0 7" to="0 0" dur="0.9s" fill="freeze"/>' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 40 40">` +
    `<circle cx="20" cy="20" r="20" fill="${DISC}"/>` +
    `<g>${rise}` +
    `<g stroke="${RAYS}" stroke-width="2.2" stroke-linecap="round">${glow}${spin}${rays()}</g>` +
    `<circle cx="20" cy="20" r="7" fill="${SUN}">${pulse}</circle>` +
    '</g></svg>'
  )
}

function star(x, y, r, begin, animated) {
  const blink = animated ? `<animate attributeName="opacity" values="1;0.2;1" dur="1.8s" begin="${begin}" repeatCount="indefinite"/>` : ''
  // Estrela de 4 pontas.
  const d = `M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z`
  return `<path d="${d}" fill="${MOON}">${blink}</path>`
}

export function moonSvg(animated) {
  const appear = animated ? '<animate attributeName="opacity" from="0" to="1" dur="0.9s" fill="freeze"/>' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 40 40">` +
    `<circle cx="20" cy="20" r="20" fill="${DISC}"/>` +
    `<g>${appear}` +
    // Crescente: círculo de raio 10 menos outro deslocado para a direita e para cima.
    `<path d="M22 9.6A10.5 10.5 0 1 0 30.4 26 A8.5 8.5 0 1 1 22 9.6Z" fill="${MOON}"/>` +
    star(28.5, 11.5, 2.6, '0s', animated) +
    star(32, 19, 1.7, '0.6s', animated) +
    star(25.5, 17, 1.3, '1.2s', animated) +
    '</g></svg>'
  )
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// base64 de um texto (UTF-8), sem depender de btoa (nem sempre há no app Zepp).
export function base64(text) {
  const bytes = []
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${base64(svg)}`
}

// Ícone do tema ('light' = sol, 'dark' = lua), animado só na opção escolhida.
export function themeIcon(theme, animated) {
  return svgDataUri(theme === 'light' ? sunSvg(animated) : moonSvg(animated))
}
