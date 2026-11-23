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
  assert.equal(getTheme('light').bg, 0xeef4fa)
  assert.equal(getTheme('dark').bg, 0x0b1a2b)
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

test('paleta Azul BH e coral nos papéis certos', () => {
  for (const t of Object.values(THEMES)) {
    assert.equal(t.title, t.text)
    assert.equal(t.button, t.chip)
    assert.equal(t.routeHi, t.chip)
    assert.equal(t.eta, ETA_BANDS[ETA_BANDS.length - 1][t.name])
  }
  assert.equal(THEMES.dark.button, 0x3da9fc)
  assert.equal(THEMES.dark.buttonText, 0x06121f)
  assert.equal(THEMES.dark.text, 0xeaf2fb)
  assert.equal(THEMES.dark.muted, 0x9db2c8)
  assert.equal(THEMES.dark.route, 0x56708c)
  assert.equal(THEMES.dark.error, 0xff4d6d)
  assert.equal(THEMES.dark.outline, 0x000814)
  assert.equal(THEMES.dark.trail, 0xff8c42)
  assert.equal(THEMES.light.button, 0x1565c0)
  assert.equal(THEMES.light.buttonText, 0xffffff)
  assert.equal(THEMES.light.text, 0x0b1a2b)
  assert.equal(THEMES.light.muted, 0x4d627a)
  assert.equal(THEMES.light.error, 0xc62440)
  assert.equal(THEMES.light.trail, 0xd9620f)
  assert.deepEqual(GRADIENT, [0x1565c0, 0x3da9fc, 0x7bd389, 0xffd166, 0xff8c42, 0xff4d6d, 0xd62846, 0x0b1a2b])
  assert.deepEqual(CSS.gradient.map(cssHex), GRADIENT)
  assert.equal(CSS.bg, '#EEF4FA')
  assert.equal(CSS.primary, '#1565C0')
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
    [0, 0xff4d6d, 0xd62846, 'chegando: corre!'],
    [1, 0xff4d6d, 0xd62846, 'chegando: corre!'],
    [2, 0xff4d6d, 0xd62846, 'chegando: corre!'],
    [3, 0xff8c42, 0xd9620f, 'já já'],
    [5, 0xff8c42, 0xd9620f, 'já já'],
    [6, 0xffb547, 0xc27000, 'dá tempo'],
    [10, 0xffb547, 0xc27000, 'dá tempo'],
    [11, 0x7bd389, 0x2e7d32, 'tranquilo'],
    [15, 0x7bd389, 0x2e7d32, 'tranquilo'],
    [16, 0x3da9fc, 0x1565c0, 'longe'],
    [90, 0x3da9fc, 0x1565c0, 'longe']
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
  assert.equal(etaColor(1, 'roxo'), 0xff4d6d)
  assert.equal(etaColor(1, undefined), 0xff4d6d)
  for (const v of [NaN, null, undefined, '', 'abc', {}]) {
    assert.equal(etaLabel(v), 'longe', String(v))
    assert.equal(etaColor(v, 'light'), 0x1565c0)
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

test('contraste legível na tela de configurações nos dois temas (CSS_THEMES)', async () => {
  const { CSS_THEMES, cssTheme } = await import('../utils/colors.js')
  const pairs = [
    ['text', 'bg'], ['muted', 'bg'], ['title', 'bg'], ['accentText', 'bg'],
    ['text', 'card'], ['muted', 'card'], ['accentText', 'card'], ['remove', 'card'], ['muted', 'cardSoft'],
    ['primaryText', 'primary'], ['chipText', 'chip'],
    ['chosenText', 'chosenBg'], ['text', 'chosenBg'], ['muted', 'chosenBg'],
    ['text', 'chipSoft'], ['text', 'track'],
    ['snackText', 'snackBg'], ['snackLink', 'snackBg'],
    ['dangerText', 'dangerBg'], ['dangerText', 'card'], ['success', 'successBg']
  ]
  for (const name of ['light', 'dark']) {
    const t = CSS_THEMES[name]
    for (const [fg, bg] of pairs) {
      const r = contrast(cssHex(t[fg]), cssHex(t[bg]))
      assert.ok(r >= 4.5, `${name} ${fg}/${bg}: ${r.toFixed(2)}`)
    }
  }
  assert.equal(CSS_THEMES.dark.bg, '#0B1A2B')
  assert.equal(CSS_THEMES.dark.card, '#15293F')
  assert.equal(CSS_THEMES.dark.accentText, '#6CC0FF')
  assert.equal(cssTheme('light'), CSS_THEMES.light)
  assert.equal(cssTheme('roxo'), CSS_THEMES.dark)
  assert.equal(cssTheme(memoryStorage({ [THEME_KEY]: 'light' })), CSS_THEMES.light)
  assert.equal(cssTheme(memoryStorage()), CSS_THEMES.dark)
})

test('tema escuro: elementos gráficos ≥ 3:1 e textos ≥ 4,5:1 onde ficam (relógio)', () => {
  const t = THEMES.dark
  const graphic = [
    ['route', 'bg'], // trajeto no mapa
    ['ring', 'bg'], // anel do mapa
    ['muted', 'bg'], // pontos/bolinhas do mapa
    ['cardEdge', 'card'], // borda do cartão
    ['cardEdge', 'bg'],
    ['control', 'bg'], // botões +/−
    ['button', 'bg']
  ]
  for (const [fg, bg] of graphic) {
    const r = contrast(t[fg], t[bg])
    assert.ok(r >= 3, `dark ${fg}/${bg}: ${r.toFixed(2)}`)
  }
  for (const [fg, bg] of [['text', 'card'], ['muted', 'card'], ['text', 'cardPressed'], ['muted', 'cardPressed']]) {
    const r = contrast(t[fg], t[bg])
    assert.ok(r >= 4.5, `dark ${fg}/${bg}: ${r.toFixed(2)}`)
  }
  // "+"/"−" grandes (28 px) sobre o botão: texto grande, 3:1.
  assert.ok(contrast(t.text, t.control) >= 3)
  // Pontos e anel do mapa claros o bastante também na avenida mais clara do mapa.
  assert.ok(contrast(t.muted, 0x27445f) >= 3 && contrast(t.ring, 0x27445f) >= 3)
})

test('tema escuro: elementos gráficos ≥ 3:1 e textos ≥ 4,5:1 (celular)', async () => {
  const { CSS_THEMES } = await import('../utils/colors.js')
  const t = CSS_THEMES.dark
  for (const [fg, bg] of [['border', 'card'], ['border', 'cardSoft'], ['border', 'bg'], ['fieldBorder', 'fieldBg'], ['fieldBorder', 'card'], ['railLine', 'card']]) {
    const r = contrast(cssHex(t[fg]), cssHex(t[bg]))
    assert.ok(r >= 3, `dark ${fg}/${bg}: ${r.toFixed(2)}`)
  }
  for (const [fg, bg] of [['text', 'fieldBg'], ['muted', 'fieldBg'], ['muted', 'card'], ['muted', 'cardSoft']]) {
    const r = contrast(cssHex(t[fg]), cssHex(t[bg]))
    assert.ok(r >= 4.5, `dark ${fg}/${bg}: ${r.toFixed(2)}`)
  }
  assert.equal(t.muted, '#9DB2C8')
  assert.equal(t.fieldBg, '#0F2236')
  assert.equal(t.cardSoft, '#1A3049')
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
  assert.deepEqual(settingsPayload(s), { favorites: [fav], theme: 'light', vibrate: true })
  assert.deepEqual(settingsPayload(memoryStorage()), { favorites: [], theme: 'dark', vibrate: true })
  assert.equal(settingsPayload(memoryStorage({ vibrate: '0' })).vibrate, false)
})

test('parseSettingsResult aceita o formato novo e o antigo', () => {
  assert.deepEqual(parseSettingsResult({ favorites: [fav], theme: 'light' }, 'dark'), { favorites: [fav], theme: 'light', vibrate: true })
  // Formato antigo (só a lista): mantém o tema atual.
  assert.deepEqual(parseSettingsResult([fav], 'light'), { favorites: [fav], theme: 'light', vibrate: true })
  assert.deepEqual(parseSettingsResult({ favorites: [fav] }, 'light'), { favorites: [fav], theme: 'light', vibrate: true })
  assert.deepEqual(parseSettingsResult({ favorites: 'x', theme: 'roxo' }, 'light'), { favorites: [], theme: 'dark', vibrate: true })
  assert.deepEqual(parseSettingsResult(undefined, undefined), { favorites: [], theme: 'dark', vibrate: true })
  assert.deepEqual(parseSettingsResult(null, 'light'), { favorites: [], theme: 'light', vibrate: true })
  // Interruptor de vibração: vem na resposta; sem ele, fica o atual.
  assert.equal(parseSettingsResult({ favorites: [], vibrate: false }, 'dark').vibrate, false)
  assert.equal(parseSettingsResult({ favorites: [] }, 'dark', false).vibrate, false)
})

test('parseDetailParams lê { fav, theme } e o favorito puro', () => {
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav, theme: 'light', vibrate: true })), { fav, theme: 'light', vibrate: true, master: true, fromAlarm: false })
  assert.equal(parseDetailParams(JSON.stringify({ fav, alarm: true })).fromAlarm, true)
  const p = parseDetailParams(JSON.stringify({ fav, vibrate: false, master: true }))
  assert.equal(p.vibrate, false)
  assert.equal(p.master, true)
  assert.deepEqual(parseDetailParams(JSON.stringify(fav)), { fav, theme: 'dark', vibrate: true, master: true, fromAlarm: false })
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav, theme: 'x' })), { fav, theme: 'dark', vibrate: true, master: true, fromAlarm: false })
  assert.deepEqual(parseDetailParams('{nao é json'), { fav: null, theme: 'dark', vibrate: true, master: true, fromAlarm: false })
  assert.deepEqual(parseDetailParams(undefined), { fav: null, theme: 'dark', vibrate: true, master: true, fromAlarm: false })
  assert.equal(parseDetailParams(JSON.stringify({ fav, theme: 'dark', vibrate: false })).vibrate, false)
  assert.deepEqual(parseDetailParams(JSON.stringify({ fav: { name: 'X' }, theme: 'light' })), { fav: null, theme: 'light', vibrate: true, master: true, fromAlarm: false })
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
  assert.equal(mixColor(0x9db2c8, 0x0b1a2b, 2), 0x0b1a2b)
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

test('tela do ponto: texto direto sobre o mapa legível nos dois temas', async () => {
  const { MAP_SURFACES, CHIP_BG, CHIP_TEXT } = await import('../utils/colors.js')
  for (const name of ['dark', 'light']) {
    const t = THEMES[name]
    const surfaces = MAP_SURFACES[name]
    // O fundo do tema também aparece onde ainda não há bloco.
    for (const bg of [...surfaces, t.bg]) {
      // Textos pequenos (nome, rodapé, GPS velho, recado): 4,5:1.
      for (const k of ['text', 'mapMuted', 'mapError']) {
        const r = contrast(t[k], bg)
        assert.ok(r >= 4.5, `${name}.${k} sobre ${bg.toString(16)}: ${r.toFixed(2)}`)
      }
    }
    // Algarismos e "min" (PNG): o contorno separa do mapa; cor da faixa contra o
    // contorno ≥ 3:1 (texto grande) e o contorno contrasta com o mapa do tema.
    for (const band of ETA_BANDS) {
      const r = contrast(band[name], t.outline)
      assert.ok(r >= 3, `${band.label} ${name} no contorno: ${r.toFixed(2)}`)
    }
    assert.ok(contrast(t.text, t.outline) >= 4.5)
    const outlineVsMap = Math.min(...surfaces.map((s) => contrast(t.outline, s)))
    assert.ok(name === 'dark' ? luminance(t.outline) <= luminance(surfaces[0]) : luminance(t.outline) >= luminance(surfaces[0]), `${name}: contorno ${outlineVsMap.toFixed(2)}`)
  }
  // Selo da linha (cada tema) e os atalhos antigos (tema escuro).
  for (const name of ['dark', 'light']) {
    const t = THEMES[name]
    assert.ok(contrast(t.chipText, t.chip) >= 4.5, `${name} selo`)
    // Trecho até o ponto, seu ponto e rastro: gráficos ≥ 3:1 no fundo do tema.
    for (const k of ['routeHi', 'chip', 'trail']) assert.ok(contrast(t[k], t.bg) >= 3, `${name}.${k}`)
  }
  assert.equal(CHIP_BG, THEMES.dark.chip)
  assert.equal(CHIP_TEXT, THEMES.dark.chipText)
})
