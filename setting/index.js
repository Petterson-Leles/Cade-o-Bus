// Tela de configurações (abre no app Zepp do celular): tema do relógio e pontos favoritos.
// A lista de linhas e pontos vem do pacote GTFS embutido (data/gtfs-index.js):
// a tela de configurações é um bundle JS comum (ES6, sem eval), então importa
// o pacote direto, sem depender do side service estar rodando.
//
// Tudo o que a tela guarda fica no settingsStorage (rascunho, mensagem, último
// removido); o side service só avisa o relógio quando mudam "favorites" ou "theme".
import { readFavorites, writeFavorites, newFavoriteId, removeFavorite, readVibrate, writeVibrate } from '../utils/favorites'
import { readMapStates, statusText, formatBytes, makeCommand, STATUS, MAP_COMMAND_KEY, MAP_MANIFEST_KEY } from '../shared/map-download'
import { parseManifest, MAP_ATTRIBUTION } from '../shared/map-tiles'
import { CSS, readThemeName, writeThemeName } from '../utils/colors'
import {
  DRAFT_FIELDS,
  NAME_SHORTCUTS,
  readJson,
  validateDraft,
  applyDraftChange,
  buildFavorite,
  draftChoices,
  filterStops,
  favoriteStreet,
  removalRecord,
  undoRemoval
} from '../shared/settings-form'
import GTFS_INDEX from '../data/gtfs-index'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'
const LAST_REMOVED_KEY = 'lastRemoved'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' }
]

const px = (n) => `${n}px`

const buttonStyle = (bg, color) => ({
  fontSize: '15px',
  fontWeight: 'bold',
  borderRadius: '22px',
  background: bg,
  color,
  padding: '10px 18px',
  marginTop: '8px'
})

const label = (text) => Text({ style: { fontSize: '12px', color: CSS.muted, marginTop: '10px', marginBottom: '4px' } }, text)
const hint = (text) => Text({ paragraph: true, style: { fontSize: '12px', color: CSS.muted, marginTop: '6px' } }, text)
const sectionTitle = (text) => Text({ bold: true, style: { fontSize: '15px', color: CSS.text, marginTop: '16px' } }, text)

// Selo da linha: pílula verde-azulada com o número em branco.
function chip(number, minWidth = 52) {
  return View(
    {
      style: {
        flexShrink: 0,
        minWidth: px(minWidth),
        textAlign: 'center',
        background: CSS.chip,
        borderRadius: '12px',
        padding: '4px 8px',
        marginRight: '10px'
      }
    },
    [Text({ bold: true, align: 'center', style: { color: CSS.white, fontSize: '13px' } }, String(number))]
  )
}

const card = (extra, children, onClick) =>
  View(
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        background: CSS.white,
        border: `1px solid ${CSS.border}`,
        borderRadius: '14px',
        padding: '10px 12px',
        marginTop: '8px',
        ...extra
      },
      onClick
    },
    children
  )

// Escolha de tema em dois botões lado a lado: o escolhido fica preenchido.
function themePicker(storage) {
  const current = readThemeName(storage)
  return View(
    { style: { display: 'flex', flexDirection: 'row', marginTop: '6px' } },
    THEME_OPTIONS.map((opt, i) => {
      const selected = opt.value === current
      return Button({
        label: opt.label,
        style: {
          ...buttonStyle(selected ? CSS.primary : 'transparent', selected ? CSS.primaryText : CSS.primary),
          flex: 1,
          border: `1px solid ${CSS.primary}`,
          marginLeft: i > 0 ? '8px' : '0'
        },
        onClick: () => {
          if (readThemeName(storage) !== opt.value) writeThemeName(storage, opt.value)
        }
      })
    })
  )
}

const THEME_LABEL = { dark: 'escuro', light: 'claro' }

// Seção "Mapa de BH": estado e progresso de cada tema, baixar, baixar o outro
// tema, pausar e apagar. Os botões gravam um comando no settingsStorage
// (mapCommand) e o side service faz o trabalho (app-side/map-sync.js).
function mapSection(storage) {
  const states = readMapStates(storage)
  let manifest = null
  try {
    const cached = JSON.parse(storage.getItem(MAP_MANIFEST_KEY) || 'null')
    manifest = cached && parseManifest(cached.manifest)
  } catch (e) {
    manifest = null
  }
  const current = readThemeName(storage)
  const other = current === 'dark' ? 'light' : 'dark'
  const size = (t) => {
    const b = manifest && manifest.themes[t] ? formatBytes(manifest.themes[t].bytes) : ''
    return b || '~3,5 MB'
  }
  const send = (action, theme) => storage.setItem(MAP_COMMAND_KEY, makeCommand(action, theme))
  const busy = (t) => states[t].status === STATUS.DOWNLOADING
  const has = (t) => states[t].status !== STATUS.NONE || states[t].done > 0
  const line = (t) => {
    const st = states[t]
    const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0
    const items = [
      Text({ style: { fontSize: '13px', color: CSS.text } }, `Tema ${THEME_LABEL[t]}: ${statusText(st)}`)
    ]
    if (st.total > 0 && st.status !== STATUS.READY && st.status !== STATUS.NONE) {
      // Barrinha de progresso.
      items.push(
        View({ style: { height: '6px', borderRadius: '3px', background: CSS.border, marginTop: '4px' } }, [
          View({ style: { width: `${pct}%`, height: '6px', borderRadius: '3px', background: CSS.primary } }, [])
        ])
      )
    }
    return View({ style: { marginTop: '6px' } }, items)
  }
  const out = [
    Text(
      { paragraph: true, style: { fontSize: '12px', color: CSS.muted, marginTop: '4px' } },
      'Ruas e nomes no mini mapa da tela do ponto. O celular baixa uma vez só e manda ao relógio pelo Bluetooth (deixe o app aberto no relógio).'
    ),
    line(current),
    has(other) ? line(other) : null
  ]
  const buttons = []
  if (busy(current) || busy(other)) {
    buttons.push(Button({ label: 'Pausar', style: { ...buttonStyle('transparent', CSS.primary), border: `1px solid ${CSS.primary}` }, onClick: () => send('pause', busy(current) ? current : other) }))
  }
  if (states[current].status !== STATUS.READY && !busy(current)) {
    const label = states[current].done > 0 ? 'Continuar download' : `Baixar mapa (${size(current)})`
    buttons.push(Button({ label, style: buttonStyle(CSS.primary, CSS.primaryText), onClick: () => send('download', current) }))
  }
  if (states[other].status !== STATUS.READY && !busy(other)) {
    buttons.push(
      Button({
        label: `Baixar também o tema ${THEME_LABEL[other]} (${size(other)})`,
        style: { ...buttonStyle('transparent', CSS.primary), border: `1px solid ${CSS.primary}` },
        onClick: () => send('download', other)
      })
    )
  }
  if (has(current) || has(other)) {
    buttons.push(
      Button({
        label: 'Apagar mapa do relógio',
        style: { ...buttonStyle('transparent', CSS.danger), border: `1px solid ${CSS.danger}` },
        onClick: () => send('delete', 'all')
      })
    )
  }
  out.push(View({ style: { display: 'flex', flexDirection: 'column' } }, buttons))
  out.push(Text({ paragraph: true, style: { fontSize: '11px', color: CSS.muted, marginTop: '8px' } }, `${MAP_ATTRIBUTION} (ODbL).`))
  return out.filter(Boolean)
}

function messageBox(message, onUndo) {
  if (!message || !message.text) return null
  const ok = message.type !== 'error'
  return View(
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: '12px',
        padding: '8px 10px',
        borderRadius: '8px',
        background: ok ? CSS.successBg : CSS.dangerBg
      }
    },
    [
      View(
        { style: { flex: 1 } },
        message.text.split('\n').map((line) => Text({ style: { fontSize: '13px', color: ok ? CSS.success : CSS.dangerText } }, line))
      ),
      message.undo
        ? Button({
            label: 'Desfazer',
            style: { fontSize: '13px', fontWeight: 'bold', color: CSS.primary, background: 'transparent', textDecoration: 'underline', padding: '4px 6px' },
            onClick: onUndo
          })
        : null
    ].filter(Boolean)
  )
}

// Linha da lista de pontos com cara de trajeto: trilho vertical, bolinha e "nº".
function stopRow(st, { first, last, selected, onClick }) {
  const seg = (show) => View({ style: { width: '3px', flex: 1, background: show ? CSS.railLine : 'transparent' } }, [])
  const dot = View(
    {
      style: {
        width: selected ? '17px' : '13px',
        height: selected ? '17px' : '13px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        background: selected ? CSS.primary : CSS.white,
        border: selected ? `3px solid ${CSS.white}` : `3px solid ${CSS.primary}`,
        boxShadow: selected ? `0 0 0 2px ${CSS.primary}` : 'none'
      }
    },
    []
  )
  return View(
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: '40px',
        padding: '0 12px 0 8px',
        background: selected ? CSS.chosenBg : 'transparent'
      },
      onClick
    },
    [
      View({ style: { width: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 } }, [seg(!first), dot, seg(!last)]),
      View({ style: { flex: 1, display: 'flex', alignItems: 'center', paddingLeft: '6px' } }, [
        Text({ bold: selected, style: { fontSize: '13px', color: CSS.text } }, st.street)
      ]),
      View({ style: { display: 'flex', alignItems: 'center' } }, [Text({ style: { fontSize: '11px', color: '#9AA0A6' } }, `${st.seq}º`)])
    ]
  )
}

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const favorites = readFavorites(storage)
    const draft = readJson(storage, DRAFT_KEY, {})
    const message = readJson(storage, MESSAGE_KEY, null)

    const setMessage = (type, text, undo) => storage.setItem(MESSAGE_KEY, JSON.stringify({ type, text, undo: !!undo }))

    // Relê o rascunho na hora: as variáveis do build podem estar velhas.
    const change = (key, val) => {
      const current = readJson(storage, DRAFT_KEY, {})
      storage.setItem(DRAFT_KEY, JSON.stringify(applyDraftChange(current, key, val)))
      // Ao editar, some a mensagem antiga.
      if (storage.getItem(MESSAGE_KEY)) storage.removeItem(MESSAGE_KEY)
    }
    // O TextInput do Zepp abre uma caixa de edição: onChange chega ao confirmar.
    const input = (key, title, placeholder) =>
      TextInput({
        label: title,
        placeholder,
        value: draft[key] || '',
        labelStyle: { fontSize: '13px', color: CSS.muted },
        subStyle: { fontSize: '16px', color: CSS.text, background: CSS.white, border: `1px solid ${CSS.border}`, borderRadius: '10px', padding: '8px 10px' },
        onChange: (val) => change(key, val)
      })

    const choices = draftChoices(draft, GTFS_INDEX)
    const pick = []

    // 1. Linha: número digitado; sugestões pelo começo; cartão da linha encontrada.
    pick.push(input('line', 'Número da linha', 'Digite o número, ex.: 9250'))
    if (choices.line) {
      pick.push(
        card({ background: CSS.chosenBg, border: 'none', color: CSS.chosenText }, [
          chip(choices.line.number),
          Text({ bold: true, style: { fontSize: '13px', color: CSS.chosenText, flex: 1 } }, choices.line.name)
        ])
      )
    } else if (choices.suggestions.length > 0) {
      pick.push(hint('Qual dessas?'))
      choices.suggestions.forEach((l) => {
        pick.push(card({ padding: '8px 10px' }, [chip(l.number), Text({ style: { fontSize: '13px', color: CSS.text, flex: 1 } }, l.name)], () => change('line', l.number)))
      })
    } else if (choices.missing) {
      pick.push(
        card({ background: CSS.dangerBg, border: 'none' }, [
          Text({ style: { fontSize: '13px', color: CSS.dangerText } }, 'Uai, não achei essa linha em BH. Confira o número no letreiro do ônibus.')
        ])
      )
    }

    // 2. Sentido: dois cartões "Para <destino>".
    if (choices.line) {
      pick.push(label('Sentido'))
      choices.dirCards.forEach((d) => {
        const selected = d.dir === choices.dir
        pick.push(
          card(
            { border: `1.5px solid ${selected ? CSS.primary : CSS.border}`, background: selected ? CSS.chosenBg : CSS.white },
            [
              View(
                {
                  style: {
                    width: '30px',
                    height: '30px',
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: selected ? CSS.primary : CSS.chipSoft,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: '10px'
                  }
                },
                [Text({ bold: true, style: { color: selected ? CSS.white : CSS.primary, fontSize: '15px' } }, '→')]
              ),
              View({ style: { flex: 1 } }, [
                Text({ bold: true, style: { fontSize: '14px', color: CSS.text } }, d.title),
                Text({ style: { fontSize: '12px', color: CSS.muted } }, d.detail)
              ])
            ],
            () => change('dir', String(d.dir))
          )
        )
      })
    }

    // 3. Seu ponto: busca pela rua e a lista na ordem do trajeto.
    if (choices.dir !== null && !draft.manual) {
      pick.push(label('Seu ponto'))
      pick.push(input('q', 'Buscar rua do ponto', 'Ex.: Afonso Pena'))
      const list = filterStops(choices.stops, draft.q)
      pick.push(
        View(
          {
            style: {
              background: CSS.white,
              border: `1px solid ${CSS.border}`,
              borderRadius: '14px',
              padding: '6px 0',
              marginTop: '8px',
              maxHeight: '300px',
              overflowY: 'auto'
            }
          },
          list.length > 0
            ? list.map((st, i) =>
                stopRow(st, {
                  first: i === 0,
                  last: i === list.length - 1,
                  selected: !!choices.stop && choices.stop.id === st.id,
                  onClick: () => change('stopId', st.id)
                })
              )
            : [Text({ paragraph: true, style: { fontSize: '13px', color: CSS.muted, padding: '10px 12px' } }, 'Nenhum ponto com esse nome nesta linha.')]
        )
      )
    }

    // 4. Nome (opcional), só depois de escolher o ponto (no avançado é obrigatório).
    if (choices.stop || draft.manual) {
      const example = choices.stop ? `Ex.: Casa (${choices.stop.street || choices.stop.name})` : 'Ex.: Casa'
      pick.push(label(draft.manual ? 'Nome do ponto' : 'Como você chama esse ponto? (opcional)'))
      pick.push(input('name', 'Nome', example))
      pick.push(
        View(
          { style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' } },
          NAME_SHORTCUTS.map((s) =>
            Button({
              label: s.label,
              style: {
                fontSize: '13px',
                color: CSS.text,
                background: draft.name === s.value ? CSS.chosenBg : CSS.white,
                border: `1px solid ${draft.name === s.value ? CSS.primary : CSS.border}`,
                borderRadius: '16px',
                padding: '5px 10px',
                marginTop: '6px',
                marginRight: '6px'
              },
              onClick: () => change('name', s.value)
            })
          )
        )
      )
    }

    // Avançado: latitude e longitude digitadas (vale também para linhas fora da lista).
    const manual = [
      Toggle({ label: 'Avançado: digitar latitude e longitude', value: !!draft.manual, onChange: (val) => change('manual', val) })
    ]
    if (draft.manual) {
      DRAFT_FIELDS.filter((f) => f.key === 'lat' || f.key === 'lon').forEach((f) => manual.push(input(f.key, f.label, f.placeholder)))
      manual.push(hint('Dica: no Google Maps, toque e segure no ponto para copiar a latitude e a longitude. No modo avançado o nome é obrigatório e a linha pode ser qualquer código.'))
    }

    const ready = draft.manual || !!choices.stop
    const addButton = Button({
      label: 'Adicionar ponto',
      style: { ...buttonStyle(CSS.primary, CSS.primaryText), width: '100%', marginTop: '14px', opacity: ready ? 1 : 0.45 },
      onClick: () => {
        const current = readJson(storage, DRAFT_KEY, {})
        const errors = validateDraft(current, GTFS_INDEX)
        if (errors.length > 0) {
          setMessage('error', errors.join('\n'))
          return
        }
        const fav = buildFavorite(current, newFavoriteId(), GTFS_INDEX)
        writeFavorites(storage, [...readFavorites(storage), fav])
        // Mantém a linha (como no protótipo) para cadastrar outro ponto dela.
        const keep = !current.manual && current.line ? { line: current.line } : {}
        storage.setItem(DRAFT_KEY, JSON.stringify(keep))
        setMessage('success', `✓ “${fav.name}” salvo. Já aparece no relógio.`)
      }
    })

    const undo = () => {
      const record = readJson(storage, LAST_REMOVED_KEY, null)
      if (record) writeFavorites(storage, undoRemoval(readFavorites(storage), record))
      storage.removeItem(LAST_REMOVED_KEY)
      storage.removeItem(MESSAGE_KEY)
    }

    const list =
      favorites.length === 0
        ? [hint('Nenhum ponto salvo ainda. Cadastre o primeiro aqui em cima.')]
        : favorites.map((fav) =>
            card({ background: CSS.card, borderRadius: '10px', padding: '8px 10px', marginTop: '6px' }, [
              chip(fav.line, 46),
              View({ style: { flex: 1, minWidth: 0 } }, [
                Text({ bold: true, style: { fontSize: '14px', color: CSS.text } }, fav.name),
                Text({ style: { fontSize: '12px', color: CSS.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, favoriteStreet(fav, GTFS_INDEX))
              ]),
              Button({
                label: 'Remover',
                style: { fontSize: '12px', fontWeight: 'bold', background: CSS.danger, color: CSS.white, borderRadius: '14px', padding: '5px 10px' },
                onClick: () => {
                  const current = readFavorites(storage)
                  // Guarda o removido (e onde estava) para o "Desfazer".
                  storage.setItem(LAST_REMOVED_KEY, JSON.stringify(removalRecord(current, fav)))
                  writeFavorites(storage, removeFavorite(current, fav))
                  setMessage('success', `“${fav.name}” removido.`, true)
                }
              })
            ])
          )

    return View({ style: { padding: '16px 18px 24px', background: CSS.bg, minHeight: '100vh' } }, [
      Text({ bold: true, style: { fontSize: '22px', color: CSS.title, marginBottom: '4px' } }, 'Cadê o Busão'),
      // Barrinha com 4 cores do gradiente "Pôr do sol", igual à do relógio.
      View(
        { style: { display: 'flex', flexDirection: 'row', marginBottom: '8px' } },
        [CSS.gradient[1], CSS.gradient[3], CSS.gradient[4], CSS.gradient[5]].map((color) =>
          View({ style: { width: '18px', height: '4px', borderRadius: '2px', marginRight: '2px', background: color } }, [])
        )
      ),
      Text({ paragraph: true, style: { fontSize: '13px', color: CSS.muted } }, 'Uai, é só digitar o número da linha, escolher o sentido e o ponto.'),
      sectionTitle('Tema do relógio'),
      themePicker(storage),
      Toggle({ label: 'Vibrar no relógio', value: readVibrate(storage), onChange: (val) => writeVibrate(storage, !!val) }),
      Text(
        { paragraph: true, style: { fontSize: '12px', color: CSS.muted } },
        'Com a tela do ponto aberta: curta em “já já”, longa em “chegando” e duas curtas quando o ônibus passa.'
      ),
      sectionTitle('Mapa de BH'),
      ...mapSection(storage),
      sectionTitle('Novo ponto'),
      ...pick,
      ...manual,
      addButton,
      messageBox(message, undo),
      sectionTitle(`Pontos salvos (${favorites.length})`),
      ...list,
      Text(
        { paragraph: true, style: { fontSize: '11px', color: CSS.muted, marginTop: '16px' } },
        `Linhas, pontos e trajetos: GTFS oficial de Belo Horizonte (SUMOB/PBH), versão ${GTFS_INDEX.feed}. Posição dos ônibus: dados abertos de tempo real da PBH.`
      )
    ].filter(Boolean))
  }
})
