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
  CSS,
  GRADIENT,
  ETA_BANDS,
  etaColor,
  etaLabel
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
  assert.equal(getTheme('light').bg, 0xf7f1e6)
  assert.equal(getTheme('dark').bg, 0x141a21)
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

test('paleta Pôr do sol nos papéis certos', () => {
  for (const t of Object.values(THEMES)) {
    assert.equal(t.button, 0x2e7d78)
    assert.equal(t.buttonText, 0xffffff)
    assert.equal(t.title, t.text)
  }
  assert.equal(THEMES.dark.text, 0xf3e3c3)
  assert.equal(THEMES.dark.muted, 0x9aa5a8)
  assert.equal(THEMES.dark.divider, 0x2a3540)
  assert.equal(THEMES.dark.error, 0xf07a60)
  assert.equal(THEMES.light.text, 0x2b3440)
  assert.equal(THEMES.light.divider, 0xe3d9c6)
  assert.equal(THEMES.light.error, 0xb5383a)
  assert.deepEqual(GRADIENT, [0x3b4b5c, 0x2e7d78, 0xa8c9a0, 0xe8d3a0, 0xffb088, 0xf07a60, 0xb5383a, 0x5e2b24])
  assert.deepEqual(CSS.gradient.map(cssHex), GRADIENT)
  assert.equal(CSS.bg, '#F7F1E6')
  assert.equal(CSS.primary, '#2E7D78')
})

test('contraste legível em cada tema', () => {
  for (const t of Object.values(THEMES)) {
    // Texto pequeno: 4.5:1.
    for (const k of ['text', 'title', 'muted', 'error']) {
      assert.ok(contrast(t[k], t.bg) >= 4.5, `${t.name}.${k}: ${contrast(t[k], t.bg).toFixed(2)}`)
    }
    // Número grande: basta 3:1.
    assert.ok(contrast(t.eta, t.bg) >= 3, `${t.name}.eta`)
    assert.ok(contrast(t.buttonText, t.button) >= 4.5, `${t.name}.buttonText`)
    assert.ok(contrast(t.buttonText, t.buttonPressed) >= 4.5, `${t.name}.buttonPressed`)
  }
})

test('cores do tempo de chegada: >= 3:1 (número e rótulo grandes) no fundo do tema', () => {
  for (const band of ETA_BANDS) {
    for (const name of ['dark', 'light']) {
      const r = contrast(band[name], THEMES[name].bg)
      assert.ok(r >= 3, `${band.label} ${name}: ${r.toFixed(2)}`)
    }
  }
})

test('etaColor esquenta quando o ônibus está perto', () => {
  const cases = [
    [0, 0xf07a60, 0xb5383a, 'chegando: corre!'],
    [1, 0xf07a60, 0xb5383a, 'chegando: corre!'],
    [2, 0xf07a60, 0xb5383a, 'chegando: corre!'],
    [3, 0xffb088, 0xc25a2e, 'já já'],
    [5, 0xffb088, 0xc25a2e, 'já já'],
    [6, 0xe8d3a0, 0x8a6a1f, 'dá tempo'],
    [10, 0xe8d3a0, 0x8a6a1f, 'dá tempo'],
    [11, 0xa8c9a0, 0x3f7a4a, 'tranquilo'],
    [15, 0xa8c9a0, 0x3f7a4a, 'tranquilo'],
    [16, 0x4fa39c, 0x2e7d78, 'longe'],
    [90, 0x4fa39c, 0x2e7d78, 'longe']
  ]
  for (const [min, dark, light, label] of cases) {
    assert.equal(etaColor(min, 'dark'), dark, `dark ${min}`)
    assert.equal(etaColor(min, 'light'), light, `light ${min}`)
    assert.equal(etaLabel(min), label, `label ${min}`)
  }
  // Limites fracionários e texto numérico.
  assert.equal(etaLabel(2.5), 'já já')
  assert.equal(etaLabel('4'), 'já já')
})

test('etaColor: tema desconhecido cai no escuro e minuto inválido em "longe"', () => {
  assert.equal(etaColor(1, 'roxo'), 0xf07a60)
  assert.equal(etaColor(1, undefined), 0xf07a60)
  for (const v of [NaN, null, undefined, '', 'abc', {}]) {
    assert.equal(etaLabel(v), 'longe', String(v))
    assert.equal(etaColor(v, 'light'), 0x2e7d78)
  }
})

test('contraste legível na tela de configurações', () => {
  const pairs = [
    ['text', 'bg'], ['muted', 'bg'], ['text', 'card'], ['muted', 'card'], ['title', 'bg'],
    ['primaryText', 'primary'], ['primary', 'card'], ['dangerText', 'dangerBg'], ['success', 'successBg']
  ]
  for (const [fg, bg] of pairs) {
    const r = contrast(cssHex(CSS[fg]), cssHex(CSS[bg]))
    assert.ok(r >= 4.5, `${fg}/${bg}: ${r.toFixed(2)}`)
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

test('busIcon: um PNG por faixa de ETA_BANDS e por tema', async () => {
  const { busIcon, BUS_ICON_SLUGS } = await import('../utils/colors.js')
  const fs = await import('node:fs')
  assert.equal(BUS_ICON_SLUGS.length, ETA_BANDS.length)
  assert.equal(busIcon(1, 'dark'), 'bus/dark-chegando.png')
  assert.equal(busIcon(2, 'dark'), 'bus/dark-chegando.png')
  assert.equal(busIcon(3, 'light'), 'bus/light-jaja.png')
  assert.equal(busIcon(10, 'dark'), 'bus/dark-datempo.png')
  assert.equal(busIcon(15, 'light'), 'bus/light-tranquilo.png')
  assert.equal(busIcon(40, 'dark'), 'bus/dark-longe.png')
  assert.equal(busIcon(null, 'azul'), 'bus/dark-longe.png')
  // Todo nome devolvido existe em assets/common.r (src do IMG é relativo a essa pasta).
  for (const theme of ['dark', 'light']) {
    for (const min of [1, 4, 8, 12, 99]) {
      const file = new URL(`../assets/common.r/${busIcon(min, theme)}`, import.meta.url)
      assert.ok(fs.existsSync(file), busIcon(min, theme))
    }
  }
})

test('mixColor mistura canal a canal', async () => {
  const { mixColor } = await import('../utils/colors.js')
  assert.equal(mixColor(0x000000, 0xffffff, 0), 0x000000)
  assert.equal(mixColor(0x000000, 0xffffff, 1), 0xffffff)
  assert.equal(mixColor(0x000000, 0xffffff, 0.5), 0x808080)
  assert.equal(mixColor(0x9aa5a8, 0x141a21, 2), 0x141a21)
})

test('passedBusIcon: ícones cinza esmaecidos existem para os dois temas', async () => {
  const { passedBusIcon } = await import('../utils/colors.js')
  const { FADE_LEVELS } = await import('../shared/passing.js')
  const fs = await import('node:fs')
  assert.equal(passedBusIcon(60, 'light'), 'bus/light-passou-60.png')
  assert.equal(passedBusIcon(33, 'x'), 'bus/dark-passou-100.png')
  for (const theme of ['dark', 'light']) {
    for (const level of FADE_LEVELS) {
      assert.ok(fs.existsSync(new URL(`../assets/common.r/${passedBusIcon(level, theme)}`, import.meta.url)), `${theme} ${level}`)
    }
  }
})
