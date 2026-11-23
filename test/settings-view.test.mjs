import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { countLabel, towardName, savedRow, draftName, saveLabel, mapSummary, SCREEN_KEY, MAP_OPEN_KEY } from '../utils/settings-view.js'
import { lineStops } from '../shared/gtfs.js'
import { CSS_THEMES } from '../utils/colors.js'
import GTFS from '../data/gtfs-index.js'

const S = lineStops(GTFS, '5250', 0)
const PAMPULHA = S[0] // Estação Pampulha (central)
const UFMG = S[3] // Estação UFMG (MOVE)
const RUA = S.find((s) => !s.station)

test('countLabel: "N pontos no relógio"', () => {
  assert.equal(countLabel(0), 'Nenhum ponto no relógio')
  assert.equal(countLabel(1), '1 ponto no relógio')
  assert.equal(countLabel(3), '3 pontos no relógio')
  assert.equal(countLabel('x'), 'Nenhum ponto no relógio')
})

test('towardName tira o "Para "', () => {
  assert.equal(towardName('Para Barreiro'), 'Barreiro')
  assert.equal(towardName('Sentido único'), 'Sentido único')
  assert.equal(towardName(undefined), '')
})

test('savedRow: tipo, rua · p/ sentido e a linha do aviso', () => {
  const alert = { on: true, days: [1, 2, 3, 4, 5], from: 17 * 60 + 45, to: 18 * 60 + 45 }
  const fav = { id: 'a', name: 'Pampulha', line: '5250', dir: 0, stopId: PAMPULHA.id, lat: '0', lon: '0', alert }
  const r = savedRow(fav, GTFS, true)
  assert.equal(r.kind, 'central')
  assert.equal(r.title, 'Pampulha')
  assert.match(r.sub, /^Plataforma \S+ · p\/ \S/)
  // Nome que não diz a estação: mostra a estação.
  assert.match(savedRow({ ...fav, name: 'Casa' }, GTFS).sub, /^Estação Pampulha · p\//)
  assert.equal(r.alert, 'Avisa seg–sex · 17:45–18:45')
  assert.equal(r.alertOn, true)
  // Detalhes do editor: cada pedaço separado (não colados).
  assert.match(r.where, /1º ponto$/)
  assert.ok(r.between.length > 0)
  // Vibração desligada: sem aviso, explicando.
  const off = savedRow(fav, GTFS, false)
  assert.equal(off.alertOn, false)
  assert.equal(off.alert, 'Sem aviso · vibração desligada')
  // Sem aviso configurado.
  assert.equal(savedRow({ ...fav, alert: undefined }, GTFS, true).alert, 'Sem aviso')
  // Estação MOVE com o mesmo nome do ponto: mostra a rua.
  const m = savedRow({ ...fav, name: UFMG.station, stopId: UFMG.id }, GTFS, true)
  assert.equal(m.kind, 'move')
  assert.match(m.sub, /^Av\. Pres\. Antonio Carlos/)
  // Ponto de rua e modo avançado (lat/lon, sem sentido).
  assert.equal(savedRow({ ...fav, stopId: RUA.id }, GTFS).kind, 'street')
  const manual = savedRow({ id: 'b', name: 'Casa', line: '999', lat: '-19.9', lon: '-43.9' }, GTFS)
  assert.equal(manual.kind, 'street')
  assert.equal(manual.sub, '-19.9, -43.9')
  assert.equal(manual.between, '')
})

test('draftName/saveLabel: nome digitado ou estação/rua; avançado sem nome', () => {
  assert.equal(saveLabel({ name: '  Casa ' }, UFMG), 'Salvar “Casa”')
  assert.equal(saveLabel({}, UFMG), 'Salvar “Estação UFMG”')
  assert.equal(saveLabel({}, RUA), `Salvar “${RUA.name.slice(0, 30).trim()}”`)
  assert.equal(saveLabel({}, null), 'Salvar ponto')
  assert.equal(saveLabel({ manual: true }, UFMG), 'Salvar ponto')
  assert.equal(draftName({ name: 'x'.repeat(50) }, null).length, 30)
})

test('mapSummary: blocos no relógio ou limpando', () => {
  assert.equal(mapSummary({ dark: { done: 3, total: 9 } }).endsWith('no relógio'), true)
  assert.equal(mapSummary({}), '0 blocos no relógio')
  assert.match(mapSummary({ dark: { deleting: 123 } }), /^Limpando/)
})

test('selo suave e textos sobre o fundo suave legíveis (CSS_THEMES)', () => {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  for (const t of Object.values(CSS_THEMES)) {
    for (const [fg, bg] of [['accentText', 'chipSoft'], ['text', 'chipSoft'], ['muted', 'chipSoft'], ['chosenText', 'chosenBg'], ['accentText', 'card']]) {
      const r = contrast(t[fg], t[bg])
      assert.ok(r >= 4.5, `${t.name} ${fg}/${bg}: ${r.toFixed(2)}`)
    }
  }
})

// ---- Tela real (setting/index.js) com componentes falsos: árvore de nós ----

// O código da tela importa sem extensão (como no bundle do Zeus): completa ".js".
registerHooks({
  resolve(spec, ctx, next) {
    if (/^\.\.?\//.test(spec) && !/\.[cm]?js$/.test(spec) && ctx.parentURL && ctx.parentURL.includes('/Cade-o-Bus/')) {
      try {
        return next(spec + '.js', ctx)
      } catch (e) {
        // segue para o resolve normal
      }
    }
    return next(spec, ctx)
  }
})

let PAGE = null
const node = (type) => (props, children) => ({ type, props: props || {}, children: [].concat(children === undefined ? [] : children).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
Object.assign(globalThis, {
  View: node('View'),
  Text: node('Text'),
  Image: node('Image'),
  TextInput: node('TextInput'),
  Toggle: node('Toggle'),
  Select: node('Select'),
  AppSettingsPage: (p) => {
    PAGE = p
  }
})
await import('../setting/index.js')

const memory = (init) => {
  const m = { ...init }
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: (k) => { delete m[k] }, m }
}
const walk = (n, fn, parent = null) => {
  if (!n || typeof n !== 'object') return
  fn(n, parent)
  ;(n.children || []).forEach((c) => walk(c, fn, n))
}
const texts = (tree) => {
  const out = []
  walk(tree, (n) => n.type === 'Text' && out.push(String(n.children.join(''))))
  return out
}
const findClick = (tree, label) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || !n.props.onClick) return
    if (texts(n).some((t) => t === label || t.startsWith(label))) hit = n
  })
  return hit
}

const ALERT = { on: true, days: [1, 2, 3, 4, 5], from: 17 * 60 + 45, to: 18 * 60 + 45 }
const favs = [
  { id: 'a', name: 'Colégio', line: '5250', dir: 0, stopId: S[12].id, lat: String(S[12].lat), lon: String(S[12].lon), alert: ALERT },
  { id: 'b', name: 'Pampulha', line: '5250', dir: 0, stopId: PAMPULHA.id, lat: String(PAMPULHA.lat), lon: String(PAMPULHA.lon) }
]

test('configurações: início com cabeçalho, lista, preferências e rodapé', () => {
  const st = memory({ favorites: JSON.stringify(favs), theme: 'light', vibrate: '1' })
  const tree = PAGE.build({ settingsStorage: st })
  const t = texts(tree)
  assert.ok(t.includes('Cadê o Busão'))
  assert.ok(t.includes('2 pontos no relógio'))
  assert.ok(t.includes('Avisa seg–sex · 17:45–18:45'))
  assert.ok(t.includes('Sem aviso'))
  assert.ok(t.includes('Tema do relógio') && t.includes('Mapa de BH') && t.includes('0 blocos no relógio'))
  assert.ok(t.includes('Dados: GTFS e tempo real da PBH · Mapa © OpenStreetMap'))
  assert.ok(t.some((x) => x.includes('Adicionar ponto')))
  // Nada do formulário na tela inicial.
  assert.ok(!t.includes('Novo ponto'))
  // Textos empilhados nunca ficam colados: todo Text com paragraph está num View próprio.
  walk(tree, (n, parent) => {
    if (n.type === 'Text' && n.props.paragraph) assert.equal(parent.children.length, 1, n.children.join(''))
  })
})

test('configurações: tocar no ponto abre o editor; Remover tem Desfazer', () => {
  const st = memory({ favorites: JSON.stringify(favs), theme: 'dark', vibrate: '1' })
  findClick(PAGE.build({ settingsStorage: st }), 'Colégio').props.onClick()
  assert.equal(st.m.editingFav, 'a')
  const tree = PAGE.build({ settingsStorage: st })
  const t = texts(tree)
  // "onde · nº" e "entre X e Y" em Text separados.
  assert.ok(t.some((x) => /13º ponto$/.test(x)))
  assert.ok(t.some((x) => x.startsWith('entre ')))
  let nameInput = null
  walk(tree, (n) => {
    if (n.type === 'TextInput' && n.props.value === 'Colégio') nameInput = n
  })
  // Experimento: nome com multiline e uma linha só.
  assert.equal(nameInput.props.multiline, true)
  nameInput.props.onChange('Casa\nnova')
  assert.equal(JSON.parse(st.m.favorites)[0].name, 'Casa nova')
  findClick(tree, 'Remover').props.onClick()
  assert.equal(JSON.parse(st.m.favorites).length, 1)
  const after = PAGE.build({ settingsStorage: st })
  assert.ok(texts(after).includes('“Colégio” removido'))
  findClick(after, 'Desfazer').props.onClick()
  assert.equal(JSON.parse(st.m.favorites).length, 2)
})

test('configurações: "Adicionar ponto" abre a tela Novo ponto e salva com o nome padrão', () => {
  const st = memory({ favorites: '[]', theme: 'dark' })
  const home = PAGE.build({ settingsStorage: st })
  assert.ok(texts(home).includes('Nenhum ponto salvo ainda'))
  findClick(home, '+  Adicionar ponto').props.onClick()
  assert.equal(st.m[SCREEN_KEY], 'add')
  let tree = PAGE.build({ settingsStorage: st })
  let t = texts(tree)
  assert.ok(t.includes('‹ Voltar') && t.includes('Novo ponto') && t.includes('1 · Linha') && t.includes('Avançado'))
  assert.ok(!t.includes('Preferências'))
  st.setItem('draft', JSON.stringify({ line: '5250', dir: '0', stopId: UFMG.id }))
  tree = PAGE.build({ settingsStorage: st })
  t = texts(tree)
  assert.ok(t.includes('2 · Sentido') && t.includes('3 · Seu ponto'))
  assert.ok(t.some((x) => x.startsWith('→ ')))
  assert.ok(t.includes('Salvar “Estação UFMG”'))
  findClick(tree, 'Salvar “Estação UFMG”').props.onClick()
  const saved = JSON.parse(st.m.favorites)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].name, 'Estação UFMG')
  // Volta ao início com o editor do novo aberto.
  assert.equal(st.m[SCREEN_KEY], undefined)
  assert.equal(st.m.editingFav, saved[0].id)
})

test('configurações: erro de validação visível e Voltar; mapa expande', () => {
  const st = memory({ favorites: '[]', [SCREEN_KEY]: 'add', draft: JSON.stringify({ manual: true, line: '1' }) })
  let tree = PAGE.build({ settingsStorage: st })
  findClick(tree, 'Salvar ponto').props.onClick()
  tree = PAGE.build({ settingsStorage: st })
  assert.ok(texts(tree).some((x) => /Nome do ponto/.test(x)))
  findClick(tree, '‹ Voltar').props.onClick()
  assert.equal(st.m[SCREEN_KEY], undefined)
  tree = PAGE.build({ settingsStorage: st })
  assert.ok(!texts(tree).some((x) => x.startsWith('Abra um ponto no relógio')))
  findClick(tree, 'Mapa de BH').props.onClick()
  assert.equal(st.m[MAP_OPEN_KEY], '1')
  assert.ok(texts(PAGE.build({ settingsStorage: st })).some((x) => x.startsWith('Abra um ponto no relógio')))
})
