// Cores do app num módulo sem APIs do relógio, para o setting/ (celular), o
// app-side e os testes do Node também poderem importar.
//
// Paleta "Pôr do sol": azul do anoitecer, verde-azulado, areia e laranja do
// sol se pondo. O gradiente da marca vai do céu (azul) ao fim de tarde (vinho).

export const THEME_KEY = 'theme'
export const DEFAULT_THEME = 'dark'
export const THEME_NAMES = ['dark', 'light']

// Gradiente da marca (0xRRGGBB), do azul do céu ao vinho do fim de tarde.
// Usado em detalhes (barrinha do título), não em texto.
export const GRADIENT = Object.freeze([
  0x3b4b5c, // azul anoitecer
  0x2e7d78, // verde-azulado (botões)
  0xa8c9a0, // verde claro
  0xe8d3a0, // areia
  0xffb088, // pêssego
  0xf07a60, // coral
  0xb5383a, // vermelho
  0x5e2b24 // vinho
])

// Papéis de cor usados pelas páginas do relógio (0xRRGGBB).
// Contraste (WCAG) sobre o fundo de cada tema está anotado ao lado.
export const THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    bg: 0x141a21, // azul-noite
    title: 0xf3e3c3, // mesmo do texto: 13.8:1
    eta: 0x4fa39c, // cor padrão do número (longe): 5.9:1
    text: 0xf3e3c3, // areia clara: 13.8:1
    muted: 0x9aa5a8, // 6.9:1
    button: 0x2e7d78, // verde-azulado
    buttonPressed: 0x24645f,
    buttonText: 0xffffff, // 4.9:1 sobre o botão
    divider: 0x2a3540, // filetes (decorativo)
    route: 0x56636c, // trajeto no mini mapa (decorativo)
    error: 0xf07a60, // coral: 6.4:1
    card: 0x1d252d, // cartões da tela inicial
    cardEdge: 0x2a343e, // borda sutil dos cartões
    cardPressed: 0x26313b
  }),
  light: Object.freeze({
    name: 'light',
    bg: 0xf7f1e6, // creme
    title: 0x2b3440, // 11.2:1
    eta: 0x2e7d78, // 4.3:1 (só no número grande)
    text: 0x2b3440, // 11.2:1
    // #66707A dava 4.49:1; escurecido um tico para passar de 4.5:1 em texto pequeno.
    muted: 0x646e78, // 4.6:1
    button: 0x2e7d78,
    buttonPressed: 0x24645f,
    buttonText: 0xffffff, // 4.9:1
    divider: 0xe3d9c6, // decorativo
    route: 0xb8ad99, // trajeto no mini mapa (decorativo)
    error: 0xb5383a, // 5.2:1
    card: 0xffffff,
    cardEdge: 0xe3e7ea,
    cardPressed: 0xeef6f4
  })
})

// Qualquer valor desconhecido (null, '', 'azul', número...) vira o tema escuro.
export function normalizeThemeName(value) {
  return typeof value === 'string' && THEME_NAMES.indexOf(value) >= 0 ? value : DEFAULT_THEME
}

export function getTheme(name) {
  return THEMES[normalizeThemeName(name)]
}

// Trecho do trajeto entre o ônibus e o ponto, no mini mapa (os dois temas).
export const ROUTE_HIGHLIGHT = 0x2e7d78
// Selo da linha (pílula) e o seu ponto no mapa.
export const CHIP_BG = 0x2e7d78
export const CHIP_TEXT = 0xffffff
// Rastro pontilhado do caminho já percorrido pelo ônibus.
export const TRAIL_COLOR = 0xf07a60

// Mistura duas cores 0xRRGGBB (k = 0 dá `a`, 1 dá `b`). Serve para simular
// transparência sobre um fundo liso (o TEXT do relógio não tem alpha).
export function mixColor(a, b, k) {
  const t = Math.max(0, Math.min(1, Number(k) || 0))
  const ch = (c, shift) => (c >> shift) & 0xff
  const m = (shift) => Math.round(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t)
  return (m(16) << 16) | (m(8) << 8) | m(0)
}

// Faixas do tempo de chegada: quanto mais perto, mais quente a cor.
// max = até quantos minutos (inclusive) a faixa vale.
export const ETA_BANDS = Object.freeze([
  Object.freeze({ max: 2, dark: 0xf07a60, light: 0xb5383a, label: 'chegando: corre!' }),
  Object.freeze({ max: 5, dark: 0xffb088, light: 0xc25a2e, label: 'já já' }),
  Object.freeze({ max: 10, dark: 0xe8d3a0, light: 0x8a6a1f, label: 'dá tempo' }),
  Object.freeze({ max: 15, dark: 0xa8c9a0, light: 0x3f7a4a, label: 'tranquilo' }),
  Object.freeze({ max: Infinity, dark: 0x4fa39c, light: 0x2e7d78, label: 'longe' })
])

// Minutos inválidos (NaN, null, texto) caem na faixa "longe".
function etaBand(min) {
  const n = typeof min === 'number' ? min : Number(min)
  if (min === null || min === undefined || min === '' || !Number.isFinite(n)) return ETA_BANDS[ETA_BANDS.length - 1]
  for (let i = 0; i < ETA_BANDS.length; i++) {
    if (n <= ETA_BANDS[i].max) return ETA_BANDS[i]
  }
  return ETA_BANDS[ETA_BANDS.length - 1]
}

// Cor do número do tempo de chegada (0xRRGGBB) no tema pedido.
export function etaColor(min, themeName) {
  return etaBand(min)[normalizeThemeName(themeName)]
}

// Ícone "frente do ônibus" do mini mapa, um por faixa de ETA_BANDS (mesma ordem)
// e por tema: PNGs 48x48 em assets/common.r/bus/. O src do IMG é relativo à
// pasta assets do target (common.r).
export const BUS_ICON_SLUGS = Object.freeze(['chegando', 'jaja', 'datempo', 'tranquilo', 'longe'])
export const BUS_ICON_SIZE = 48

export function busIcon(min, themeName) {
  const slug = BUS_ICON_SLUGS[ETA_BANDS.indexOf(etaBand(min))] || BUS_ICON_SLUGS[BUS_ICON_SLUGS.length - 1]
  return `bus/${normalizeThemeName(themeName)}-${slug}.png`
}

// Ônibus que acabou de passar: ícone cinza esmaecido (level 100, 80, 60, 40 ou 20 %).
export function passedBusIcon(level, themeName) {
  const l = [100, 80, 60, 40, 20].indexOf(Number(level)) >= 0 ? Number(level) : 100
  return `bus/${normalizeThemeName(themeName)}-passou-${l}.png`
}

// Rótulo curto que acompanha o número.
export function etaLabel(min) {
  return etaBand(min).label
}

// Lê o tema salvo no settingsStorage (celular). Erros de leitura caem no escuro.
export function readThemeName(storage) {
  try {
    return normalizeThemeName(storage.getItem(THEME_KEY))
  } catch (e) {
    return DEFAULT_THEME
  }
}

export function writeThemeName(storage, name) {
  storage.setItem(THEME_KEY, normalizeThemeName(name))
}

// Cores da tela de configurações do celular (CSS), uma paleta por tema do relógio:
// a tela segue o tema escolhido em "Escuro"/"Claro" (chave theme do settingsStorage).
// Contraste dos textos ≥ 4,5:1 (test/colors.test.mjs).
const CSS_GRADIENT = ['#3B4B5C', '#2E7D78', '#A8C9A0', '#E8D3A0', '#FFB088', '#F07A60', '#B5383A', '#5E2B24']

export const CSS_THEMES = Object.freeze({
  light: Object.freeze({
    name: 'light',
    bg: '#F7F1E6', // creme
    card: '#FFFFFF', // cartões
    cardSoft: '#FFFBF3', // linhas dentro de cartão (sugestões, trilho)
    border: '#E3D9C6', // borda sutil
    title: '#2B3440',
    text: '#2B3440',
    muted: '#646E78',
    primary: '#2E7D78', // fundo do botão principal e do selo
    primaryText: '#FFFFFF',
    accentText: '#2B6F6A', // links e textos em destaque (sobre cartão e fundo)
    chip: '#2E7D78', // selo da linha
    chipText: '#FFFFFF',
    chipSoft: '#E4EFEC', // chips de dia desligados, ícone do sentido
    chosenBg: '#EEF6F4', // escolhido (sentido, ponto, dia)
    chosenText: '#1F5F5B',
    railLine: '#CFE2DE', // trilho da lista de pontos
    remove: '#9B4A47', // "Remover": vermelho apagado
    snackBg: '#2B3440', // faixa "removido · Desfazer"
    snackText: '#F7F1E6',
    snackLink: '#8FD3CB',
    accent: '#F07A60',
    gradient: CSS_GRADIENT,
    white: '#FFFFFF',
    danger: '#B5383A',
    dangerText: '#9B2F31', // erro sobre dangerBg
    dangerBg: '#FBE3DF',
    success: '#356B3F',
    successBg: '#E4F0DC',
    track: '#EFE7D8' // trilho do seletor de tema e da barrinha de progresso
  }),
  dark: Object.freeze({
    name: 'dark',
    bg: '#141A21', // azul-noite
    card: '#1D252D',
    cardSoft: '#222B34',
    border: '#2A3540',
    title: '#F3E3C3',
    text: '#F3E3C3',
    muted: '#9AA5A8',
    primary: '#2E7D78',
    primaryText: '#FFFFFF',
    accentText: '#3E9C95',
    chip: '#2E7D78',
    chipText: '#FFFFFF',
    chipSoft: '#24333A',
    chosenBg: '#1C3533',
    chosenText: '#9FD8D1',
    railLine: '#2E4A48',
    remove: '#E0928A',
    snackBg: '#F3E3C3',
    snackText: '#141A21',
    snackLink: '#1F5F5B',
    accent: '#F07A60',
    gradient: CSS_GRADIENT,
    white: '#FFFFFF',
    danger: '#B5383A',
    dangerText: '#F4B4AA',
    dangerBg: '#3A2424',
    success: '#A8D4A8',
    successBg: '#1E3324',
    track: '#151C23'
  })
})

// Paleta CSS do tema salvo (ou de um nome de tema).
export function cssTheme(nameOrStorage) {
  const name = nameOrStorage && typeof nameOrStorage.getItem === 'function' ? readThemeName(nameOrStorage) : nameOrStorage
  return CSS_THEMES[normalizeThemeName(name)]
}

// Compatibilidade: a paleta clara (antes era a única).
export const CSS = CSS_THEMES.light
