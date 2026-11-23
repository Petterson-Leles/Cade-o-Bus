// Cores do app num módulo sem APIs do relógio, para o setting/ (celular), o
// app-side e os testes do Node também poderem importar.
//
// Paleta "Azul BH e coral": cara de transporte público, com azul-marinho no
// fundo, azul-céu nos destaques e coral quando o ônibus chega.

export const THEME_KEY = 'theme'
export const DEFAULT_THEME = 'dark'
export const THEME_NAMES = ['dark', 'light']

// Gradiente da marca (0xRRGGBB), do azul de BH ao vermelho do "corre!".
// Usado em detalhes (barrinha do título), não em texto.
export const GRADIENT = Object.freeze([
  0x1565c0, // azul BH
  0x3da9fc, // azul-céu (destaques)
  0x7bd389, // verde
  0xffd166, // amarelo
  0xff8c42, // coral
  0xff4d6d, // rosa-coral
  0xd62846, // vermelho
  0x0b1a2b // azul-marinho
])

// Papéis de cor usados pelas páginas do relógio (0xRRGGBB).
// Contraste (WCAG) sobre o fundo de cada tema está anotado ao lado.
export const THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    bg: 0x0b1a2b, // azul-marinho
    title: 0xeaf2fb, // mesmo do texto: 15.5:1
    eta: 0x3da9fc, // cor padrão do número (longe): 6.9:1
    text: 0xeaf2fb, // 15.5:1
    // Tema escuro com mais contraste: elementos gráficos ≥ 3:1 e textos ≥ 4,5:1
    // contra o fundo onde ficam (test/colors.test.mjs).
    muted: 0x9db2c8, // 8.1:1 (texto secundário, pontos e bolinhas do mapa)
    button: 0x3da9fc, // azul-céu: 6.9:1 sobre o fundo
    buttonPressed: 0x2b8fdc,
    buttonText: 0x06121f, // 7.4:1 sobre o botão (5.4:1 apertado)
    divider: 0x27445f, // filetes (decorativo)
    route: 0x56708c, // trajeto no mapa: 3.4:1
    error: 0xff4d6d, // rosa-coral: 5.5:1
    card: 0x15293f, // cartões da tela inicial
    cardEdge: 0x5c7a99, // borda dos cartões: 3.3:1 sobre o cartão
    cardPressed: 0x1c3450,
    ring: 0x9db2c8, // anel do mini mapa: 8.1:1
    control: 0x51708f, // fundo dos botões +/− do mapa: 3.4:1
    // Tela do ponto: textos direto sobre o mapa (sem fundo). ≥ 4,5:1 contra todas
    // as superfícies dos blocos (MAP_SURFACES, test/colors.test.mjs).
    mapMuted: 0x9db2c8, // 4.6:1 na avenida mais clara (#27445F)
    mapError: 0xffa3b3, // GPS velho: 5.4:1
    outline: 0x000814, // contorno dos algarismos e do "min" (PNG)
    // Selo da linha (pílula) e o seu ponto no mapa; trecho do ônibus até o ponto.
    chip: 0x3da9fc,
    chipText: 0x06121f, // 7.4:1
    // Selo suave (tela inicial, pontos fora do cartão): 18 % do chip sobre o fundo
    // (= mixColor(bg, chip, 0.18); FILL_RECT/TEXT não têm alpha) e texto no destaque.
    chipSoft: 0x143451,
    chipSoftText: 0x3da9fc, // 5.1:1 sobre chipSoft
    routeHi: 0x3da9fc, // 4.0:1 na avenida
    // Rastro pontilhado quando não há faixa de tempo (coral).
    trail: 0xff8c42
  }),
  light: Object.freeze({
    name: 'light',
    bg: 0xeef4fa, // azul bem claro
    title: 0x0b1a2b, // 15.8:1
    eta: 0x1565c0, // 5.2:1
    text: 0x0b1a2b, // 15.8:1
    muted: 0x4d627a, // 5.7:1
    button: 0x1565c0, // azul BH
    buttonPressed: 0x0f4f9a,
    buttonText: 0xffffff, // 5.8:1
    divider: 0xdce6f1, // decorativo
    route: 0xa3b5c8, // trajeto no mapa (decorativo)
    // #D62846 dava 4.46:1 no fundo; um tico mais escuro para texto pequeno.
    error: 0xc62440, // 5.1:1
    card: 0xffffff,
    cardEdge: 0xdce6f1,
    cardPressed: 0xe3eefa,
    ring: 0xc7d5e5, // anel do mini mapa
    control: 0xdce6f1, // fundo dos botões +/− do mapa
    // #4D627A dava 4.2:1 na avenida (#C7D5E5): mais escuro só sobre o mapa.
    mapMuted: 0x44586f, // 4.9:1 na avenida
    mapError: 0xa61c36, // 5.0:1 na avenida
    outline: 0xffffff, // contorno claro dos algarismos e do "min"
    chip: 0x1565c0,
    chipText: 0xffffff, // 5.8:1
    chipSoft: 0xc7daf0, // mixColor(bg, chip, 0.18)
    // O azul do chip (#1565C0) dava 4.0:1 sobre chipSoft: um tom mais escuro.
    chipSoftText: 0x0f4f9a, // 5.7:1 sobre chipSoft
    routeHi: 0x1565c0,
    trail: 0xd9620f
  })
})

// Qualquer valor desconhecido (null, '', 'azul', número...) vira o tema escuro.
export function normalizeThemeName(value) {
  return typeof value === 'string' && THEME_NAMES.indexOf(value) >= 0 ? value : DEFAULT_THEME
}

export function getTheme(name) {
  return THEMES[normalizeThemeName(name)]
}

// Cores das áreas dos blocos do mapa de ruas (fundo, ruas pequenas, médias e
// avenidas, parques e água; os trilhos são só traços finos), por tema. A tela do
// ponto põe os textos direto sobre o mapa: o contraste é conferido contra todas.
export const MAP_SURFACES = Object.freeze({
  dark: Object.freeze([0x0b1a2b, 0x132639, 0x1c3450, 0x27445f, 0x12291f, 0x0f2a44]),
  light: Object.freeze([0xeef4fa, 0xffffff, 0xdce6f1, 0xc7d5e5, 0xd7ebd9, 0xc3ddf5])
})

// Trecho do trajeto entre o ônibus e o ponto, selo da linha e rastro pontilhado
// agora dependem do tema: THEMES.<tema>.routeHi, chip/chipText e trail (o rastro
// usa a cor da faixa de tempo do ônibus; trail é a reserva). Os nomes antigos
// ficam como atalhos do tema escuro (padrão).
export const ROUTE_HIGHLIGHT = THEMES.dark.routeHi
export const CHIP_BG = THEMES.dark.chip
export const CHIP_TEXT = THEMES.dark.chipText
export const TRAIL_COLOR = THEMES.dark.trail

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
  Object.freeze({ max: 2, dark: 0xff4d6d, light: 0xd62846, label: 'chegando: corre!' }),
  Object.freeze({ max: 5, dark: 0xff8c42, light: 0xd9620f, label: 'já já' }),
  Object.freeze({ max: 10, dark: 0xffd166, light: 0x9a6a00, label: 'dá tempo' }),
  Object.freeze({ max: 15, dark: 0x7bd389, light: 0x2e7d32, label: 'tranquilo' }),
  Object.freeze({ max: Infinity, dark: 0x3da9fc, light: 0x1565c0, label: 'longe' })
])

// Minutos inválidos (NaN, null, texto) caem na faixa "longe".
export function etaBand(min) {
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
const CSS_GRADIENT = ['#1565C0', '#3DA9FC', '#7BD389', '#FFD166', '#FF8C42', '#FF4D6D', '#D62846', '#0B1A2B']

export const CSS_THEMES = Object.freeze({
  light: Object.freeze({
    name: 'light',
    bg: '#EEF4FA', // azul bem claro
    card: '#FFFFFF', // cartões
    cardSoft: '#F5F9FD', // linhas dentro de cartão (sugestões, trilho)
    border: '#DCE6F1', // borda sutil
    fieldBg: '#FFFFFF', // campos de texto
    fieldBorder: '#C7D5E5',
    title: '#0B1A2B',
    text: '#0B1A2B',
    muted: '#4D627A',
    primary: '#1565C0', // fundo do botão principal e do selo
    primaryText: '#FFFFFF',
    accentText: '#1565C0', // links e textos em destaque (sobre cartão e fundo)
    chip: '#1565C0', // selo da linha
    chipText: '#FFFFFF',
    chipSoft: '#DCE9F7', // chips de dia desligados, ícone do sentido
    chosenBg: '#E3EEFA', // escolhido (sentido, ponto, dia)
    chosenText: '#0D4A8F',
    railLine: '#B5CBE3', // trilho da lista de pontos
    remove: '#B0283F', // "Remover"
    snackBg: '#0B1A2B', // faixa "removido · Desfazer"
    snackText: '#EEF4FA',
    snackLink: '#7CC4FF',
    accent: '#FF8C42', // coral
    gradient: CSS_GRADIENT,
    white: '#FFFFFF',
    danger: '#C62440',
    dangerText: '#A61C36', // erro sobre dangerBg
    dangerBg: '#FCE4E8',
    success: '#286F2C',
    successBg: '#E3F1E4',
    track: '#E1EAF4' // trilho do seletor de tema e da barrinha de progresso
  }),
  dark: Object.freeze({
    name: 'dark',
    bg: '#0B1A2B', // azul-marinho
    // Mais contraste: bordas/divisórias ≥ 3:1, textos ≥ 4,5:1 (test/colors.test.mjs).
    card: '#15293F',
    cardSoft: '#1A3049',
    border: '#6584A3', // ≥ 3:1 sobre cartão, linha do cartão e fundo
    fieldBg: '#0F2236', // campos de texto
    fieldBorder: '#6584A3',
    title: '#EAF2FB',
    text: '#EAF2FB',
    muted: '#9DB2C8', // também o placeholder
    primary: '#3DA9FC', // azul-céu
    primaryText: '#06121F',
    accentText: '#6CC0FF',
    chip: '#3DA9FC',
    chipText: '#06121F',
    chipSoft: '#1C3450',
    chosenBg: '#123A5E',
    chosenText: '#B5DEFF',
    railLine: '#4F86B8', // trilho da lista de pontos
    remove: '#FF8FA3',
    snackBg: '#EAF2FB',
    snackText: '#0B1A2B',
    snackLink: '#1565C0',
    accent: '#FF8C42', // coral
    gradient: CSS_GRADIENT,
    white: '#FFFFFF',
    danger: '#D62846',
    dangerText: '#FFA3B3',
    dangerBg: '#3A1A26',
    success: '#7BD389',
    successBg: '#143024',
    track: '#081422'
  })
})

// Paleta CSS do tema salvo (ou de um nome de tema).
export function cssTheme(nameOrStorage) {
  const name = nameOrStorage && typeof nameOrStorage.getItem === 'function' ? readThemeName(nameOrStorage) : nameOrStorage
  return CSS_THEMES[normalizeThemeName(name)]
}

// Compatibilidade: a paleta clara (antes era a única).
export const CSS = CSS_THEMES.light
