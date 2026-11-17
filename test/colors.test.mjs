import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  THEMES,
  THEME_KEY,
  DEFAULT_THEME,
  getTheme,
  normalizeThemeName,
  readThemeName,
  writeThemeName,
  CSS
} from '../utils/colors.js'
import { settingsPayload, parseSettingsResult, parseDetailParams, FAVORITES_KEY } from '../utils/favorites.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
    data
  }
}

// Contraste WCAG entre duas cores 0xRRGGBB.
function luminance(hex) {
  const c = [16, 8, 0].map((s) => ((hex >> s) & 0xff) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const cssHex = (s) => parseInt(s.slice(1), 16)

test('getTheme devolve o tema pedido', () => {
  assert.equal(getTheme('dark'), THEMES.dark)
  assert.equal(getTheme('light'), THEMES.light)
  assert.equal(getTheme('light').bg, 0xf5efe3)
  assert.equal(getTheme('dark').bg, 0x000000)
})

test('valores desconhecidos caem no tema escuro', () => {
  assert.equal(DEFAULT_THEME, 'dark')
  for (const v of [undefined, null, '', 'Light', 'azul', 1, {}, [], 'constructor', '__proto__', 'toString']) {
    assert.equal(getTheme(v), THEMES.dark, String(v))
    assert.equal(normalizeThemeName(v), 'dark')
  }
})

test('os dois temas têm os mesmos papéis de cor', () => {
  assert.deepEqual(Object.keys(THEMES.light).sort(), Object.keys(THEMES.dark).sort())
  for (const t of Object.values(THEMES)) {
    for (const [k, v] of Object.entries(t)) {
      if (k !== 'name') assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffff, `${t.name}.${k}`)
    }
  }
})

test('paleta Minas nos papéis certos', () => {
  for (const t of Object.values(THEMES)) {
    assert.equal(t.title, 0xd52b1e)
    assert.equal(t.button, 0x1f4e8c)
    assert.equal(t.divider, 0xa0522d)
  }
  assert.equal(THEMES.dark.eta, 0xe8b23a)
  assert.equal(THEMES.dark.text, 0xf5efe3)
  assert.equal(THEMES.light.text, 0x2b1d14)
})

test('contraste legível em cada tema', () => {
  for (const t of Object.values(THEMES)) {
    for (const k of ['text', 'muted', 'eta']) {
      assert.ok(contrast(t[k], t.bg) >= 4.5, `${t.name}.${k}: ${contrast(t[k], t.bg).toFixed(2)}`)
    }
    // Erro no claro é o vermelho de Minas pedido (#D52B1E, 4.37:1): aceita ~4.5.
    assert.ok(contrast(t.error, t.bg) >= 4.5, `${t.name}.error`)
    // Título só aparece em texto grande (>= 24 px): basta 3:1.
    assert.ok(contrast(t.title, t.bg) >= 3, `${t.name}.title`)
    assert.ok(contrast(t.buttonText, t.button) >= 4.5, `${t.name}.buttonText`)
    assert.ok(contrast(t.buttonText, t.buttonPressed) >= 4.5, `${t.name}.buttonPressed`)
  }
})

test('contraste legível na tela de configurações', () => {
  const pairs = [
    ['text', 'bg'], ['muted', 'bg'], ['text', 'card'], ['muted', 'card'], ['title', 'bg'],
    ['primaryText', 'primary'], ['primary', 'card'], ['dangerText', 'dangerBg'], ['success', 'successBg']
  ]
  for (const [fg, bg] of pairs) {
    const r = contrast(cssHex(CSS[fg]), cssHex(CSS[bg]))
    assert.ok(r >= 4.3, `${fg}/${bg}: ${r.toFixed(2)}`)
  }
  assert.ok(contrast(0xffffff, cssHex(CSS.danger)) >= 4.5)
})

test('readThemeName lê e valida o settingsStorage', () => {
  assert.equal(readThemeName(memoryStorage()), 'dark')
  assert.equal(readThemeName(memoryStorage({ [THEME_KEY]: 'light' })), 'light')
  assert.equal(readThemeName(memoryStorage({ [THEME_KEY]: 'dark' })), 'dark')
  assert.equal(readThemeName(memoryStorage({ [THEME_KEY]: 'roxo' })), 'dark')
  assert.equal(readThemeName({ getItem: () => { throw new Error('x') } }), 'dark')
})

test('writeThemeName só grava valores válidos', () => {
  const s = memoryStorage()
  writeThemeName(s, 'light')
  assert.equal(s.data.theme, 'light')
  writeThemeName(s, 'qualquer')
  assert.equal(s.data.theme, 'dark')
})

const fav = { id: 'a1', name: 'Casa', line: '1234', lat: '-19.9', lon: '-43.9' }

test('settingsPayload manda favoritos e tema', () => {
  const s = memoryStorage({ [FAVORITES_KEY]: JSON.stringify([fav]), [THEME_KEY]: 'light' })
  assert.deepEqual(settingsPayload(s), { favorites: [fav], theme: 'light' })
  assert.deepEqual(settingsPayload(memoryStorage()), { favorites: [], theme: 'dark' })
})

test('parseSettingsResult aceita o formato novo e o antigo', () => {
  assert.deepEqual(parseSettingsResult({ favorites: [fav], theme: 'light' }, 'dark'), { favorites: [fav], theme: 'light' })
  // Formato antigo (só a lista): mantém o tema atual.
  assert.deepEqual(parseSettingsResult([fav], 'light'), { favorites: [fav], theme: 'light' })
  assert.deepEqual(parseSettingsResult({ favorites: [fav] }, 'light'), { favorites: [fav], theme: 'light' })
  assert.deepEqual(parseSettingsResult({ favorites: 'x', theme: 'roxo' }, 'light'), { favorites: [], theme: 'dark' })
  assert.deepEqual(parseSettingsResult(undefined, undefined), { favorites: [], theme: 'dark' })
  assert.deepEqual(parseSettingsResult(null, 'light'), { favorites: [], theme: 'light' })
})

test('parseDetailParams lê { fav, theme } e o favorito puro', () => {
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav, theme: 'light' })), { fav, theme: 'light' })
  assert.deepEqual(parseDetailParams(JSON.stringify(fav)), { fav, theme: 'dark' })
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav, theme: 'x' })), { fav, theme: 'dark' })
  assert.deepEqual(parseDetailParams('{nao é json'), { fav: null, theme: 'dark' })
  assert.deepEqual(parseDetailParams(undefined), { fav: null, theme: 'dark' })
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav: { name: 'X' }, theme: 'light' })), { fav: null, theme: 'light' })
})
