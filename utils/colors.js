// Cores do app num módulo sem APIs do relógio, para o setting/ (celular), o
// app-side e os testes do Node também poderem importar.
//
// Paleta "Minas":
//   vermelho da bandeira de Minas  #D52B1E  destaque / títulos
//   ouro (Ouro Preto)              #E8B23A  número grande do tempo de chegada
//   azul colonial                  #1F4E8C  botões (portas e janelas de Ouro Preto)
//   terra de minério               #A0522D  divisórias e detalhes secundários
//   branco caiado                  #F5EFE3  fundo do tema claro

export const THEME_KEY = 'theme'
export const DEFAULT_THEME = 'dark'
export const THEME_NAMES = ['dark', 'light']

// Papéis de cor usados pelas páginas do relógio (0xRRGGBB).
// Contraste (WCAG) sobre o fundo de cada tema está anotado ao lado.
export const THEMES = Object.freeze({
  dark: Object.freeze({
    name: 'dark',
    bg: 0x000000, // preto AMOLED
    title: 0xd52b1e, // vermelho de Minas: 4.2:1 (só em texto grande, >= 24 px)
    eta: 0xe8b23a, // ouro: 10.9:1
    text: 0xf5efe3, // branco caiado: 18.3:1
    muted: 0xb8afa3, // 9.7:1
    button: 0x1f4e8c, // azul colonial
    buttonPressed: 0x173b69,
    buttonText: 0xffffff, // 8.3:1 sobre o azul
    divider: 0xa0522d, // terra de minério
    error: 0xff6b5c // vermelho mais claro: 7.5:1
  }),
  light: Object.freeze({
    name: 'light',
    bg: 0xf5efe3, // branco caiado
    title: 0xd52b1e, // 4.4:1 (só em texto grande)
    eta: 0x8f620b, // ouro velho: 4.7:1 (o #E8B23A some no creme)
    text: 0x2b1d14, // marrom café: 14.2:1
    muted: 0x6b5b4e, // 5.7:1
    button: 0x1f4e8c,
    buttonPressed: 0x173b69,
    buttonText: 0xffffff, // 8.3:1
    divider: 0xa0522d, // 4.9:1
    error: 0xb8231a // vermelho de Minas escurecido: 5.6:1 (avisos de 22 px)
  })
})

// Qualquer valor desconhecido (null, '', 'azul', número...) vira o tema escuro.
export function normalizeThemeName(value) {
  return typeof value === 'string' && THEME_NAMES.indexOf(value) >= 0 ? value : DEFAULT_THEME
}

export function getTheme(name) {
  return THEMES[normalizeThemeName(name)]
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

// Cores da tela de configurações do celular (CSS), seguindo o tema claro.
export const CSS = {
  bg: '#F5EFE3', // branco caiado
  title: '#D52B1E', // vermelho de Minas
  primary: '#1F4E8C', // azul colonial (botões)
  primaryText: '#FFFFFF',
  text: '#2B1D14', // marrom café
  muted: '#6B5B4E',
  accent: '#A0522D', // terra de minério
  border: '#D8C8B0',
  card: '#FBF7EF',
  danger: '#D52B1E', // botão "Remover" (texto branco: 5.0:1)
  dangerText: '#A61F15', // texto de erro sobre dangerBg
  dangerBg: '#FBE3DF',
  success: '#2E6B30',
  successBg: '#E4F0DC'
}
