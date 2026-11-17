// Tela de configurações (abre no app Zepp do celular): tema do relógio e pontos favoritos.
// A lista de linhas e pontos vem do pacote GTFS embutido (data/gtfs-index.js):
// a tela de configurações é um bundle JS comum (ES6, sem eval), então importa
// o pacote direto, sem depender do side service estar rodando.
import { readFavorites, writeFavorites, newFavoriteId, removeFavorite } from '../utils/favorites'
import { CSS, readThemeName, writeThemeName } from '../utils/colors'
import {
  DRAFT_FIELDS,
  readJson,
  validateDraft,
  applyDraftChange,
  buildFavorite,
  draftChoices
} from '../shared/settings-form'
import { findLine, lineStops } from '../shared/gtfs'
import GTFS_INDEX from '../data/gtfs-index'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' }
]

const buttonStyle = (bg, color) => ({
  fontSize: '15px',
  fontWeight: 'bold',
  borderRadius: '30px',
  background: bg,
  color,
  padding: '10px 18px',
  marginTop: '8px'
})

// Escolha de tema em dois botões lado a lado: o escolhido fica verde-azulado.
function themePicker(storage) {
  const current = readThemeName(storage)
  return View(
    { style: { display: 'flex', flexDirection: 'row', marginTop: '4px' } },
    THEME_OPTIONS.map((opt, i) => {
      const selected = opt.value === current
      return Button({
        label: selected ? `✓ ${opt.label}` : opt.label,
        style: {
          ...buttonStyle(selected ? CSS.primary : CSS.card, selected ? CSS.primaryText : CSS.primary),
          flex: 1,
          border: `2px solid ${CSS.primary}`,
          marginLeft: i > 0 ? '8px' : '0'
        },
        onClick: () => {
          if (readThemeName(storage) !== opt.value) writeThemeName(storage, opt.value)
        }
      })
    })
  )
}

const hint = (text) => Text({ paragraph: true, style: { fontSize: '12px', color: CSS.muted, marginTop: '6px' } }, text)

// "Linha 9250 · sentido Nova Cintra" para a lista de salvos.
function favoriteSubtitle(fav) {
  const line = findLine(GTFS_INDEX, fav.line)
  const dir = line && fav.dir !== undefined ? line.dirs.find((d) => d.dir === fav.dir) : null
  if (dir && fav.stopId) {
    const stop = lineStops(GTFS_INDEX, fav.line, fav.dir).find((st) => st.id === fav.stopId)
    return `Linha ${fav.line} → ${dir.headsign}${stop ? ` · ${stop.name}` : ''}`
  }
  return `Linha ${fav.line}${dir ? ` → ${dir.headsign}` : ''} · ${fav.lat}, ${fav.lon}`
}

function messageBox(message) {
  if (!message || !message.text) return null
  const ok = message.type === 'success'
  return View(
    {
      style: {
        marginTop: '12px',
        padding: '10px 12px',
        borderRadius: '8px',
        background: ok ? CSS.successBg : CSS.dangerBg,
        color: ok ? CSS.success : CSS.dangerText,
        fontSize: '14px'
      }
    },
    message.text.split('\n').map((line) => Text({}, line))
  )
}

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const favorites = readFavorites(storage)
    const draft = readJson(storage, DRAFT_KEY, {})
    const message = readJson(storage, MESSAGE_KEY, null)

    const setMessage = (type, text) => storage.setItem(MESSAGE_KEY, JSON.stringify({ type, text }))

    // Relê o rascunho na hora: as variáveis do build podem estar velhas.
    const change = (key, val) => {
      const current = readJson(storage, DRAFT_KEY, {})
      storage.setItem(DRAFT_KEY, JSON.stringify(applyDraftChange(current, key, val)))
      // Ao editar, some a mensagem antiga.
      if (storage.getItem(MESSAGE_KEY)) storage.removeItem(MESSAGE_KEY)
    }
    const input = (key, label, placeholder) =>
      TextInput({
        label,
        placeholder,
        value: draft[key] || '',
        labelStyle: { fontSize: '14px', color: CSS.text },
        subStyle: { fontSize: '16px', color: CSS.text },
        onChange: (val) => change(key, val)
      })
    const select = (key, label, options, value) =>
      Select({ label, title: label, options, value, onChange: (val) => change(key, val) })

    // Modo lista: linha -> sentido -> ponto.
    const choices = draftChoices(draft, GTFS_INDEX)
    const pick = []
    pick.push(input('line', 'Número da linha', 'Ex.: 9250'))
    if (draft.line && !choices.line) {
      const sug = choices.suggestions.map((l) => l.number).join(', ')
      pick.push(hint(sug ? `Não achei essa linha. Você quis dizer: ${sug}?` : 'Não achei essa linha na lista de BH.'))
    }
    if (choices.line) {
      pick.push(Text({ paragraph: true, style: { fontSize: '14px', color: CSS.text, marginTop: '6px' } }, `${choices.line.number} · ${choices.line.name}`))
      pick.push(select('dir', 'Sentido', choices.dirOptions, choices.dir === null ? '' : String(choices.dir)))
    }
    if (choices.dir !== null && !draft.manual) {
      pick.push(select('stopId', 'Ponto', choices.stopOptions, choices.stop ? choices.stop.id : ''))
      if (choices.stop) pick.push(hint(`Ponto ${choices.stop.id}: ${choices.stop.lat.toFixed(5)}, ${choices.stop.lon.toFixed(5)}`))
    }
    pick.push(input('name', 'Nome do ponto (opcional)', choices.stop ? `Ex.: ${choices.stop.name}` : 'Ex.: Casa'))

    // Avançado: latitude e longitude digitadas (vale também para linhas fora da lista).
    const manual = [
      Toggle({ label: 'Avançado: digitar latitude e longitude', value: !!draft.manual, onChange: (val) => change('manual', val) })
    ]
    if (draft.manual) {
      DRAFT_FIELDS.filter((f) => f.key === 'lat' || f.key === 'lon').forEach((f) => manual.push(input(f.key, f.label, f.placeholder)))
      manual.push(hint('Dica: no Google Maps, toque e segure no ponto para copiar a latitude e a longitude. No modo avançado o nome é obrigatório e a linha pode ser qualquer código.'))
    }

    const addButton = Button({
      label: 'Adicionar ponto',
      style: buttonStyle(CSS.primary, CSS.primaryText),
      onClick: () => {
        const current = readJson(storage, DRAFT_KEY, {})
        const errors = validateDraft(current, GTFS_INDEX)
        if (errors.length > 0) {
          setMessage('error', errors.join('\n'))
          return
        }
        const fav = buildFavorite(current, newFavoriteId(), GTFS_INDEX)
        writeFavorites(storage, [...readFavorites(storage), fav])
        storage.setItem(DRAFT_KEY, '{}')
        setMessage('success', `Ponto "${fav.name}" salvo. Ele já aparece no relógio.`)
      }
    })

    const list =
      favorites.length === 0
        ? [Text({ paragraph: true, style: { color: CSS.muted, fontSize: '14px' } }, 'Nenhum ponto salvo ainda.')]
        : favorites.map((fav, i) =>
            View(
              {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderBottom: i < favorites.length - 1 ? `1px solid ${CSS.border}` : 'none',
                  padding: '8px 0'
                }
              },
              [
                View({ style: { flex: 1 } }, [
                  Text({ bold: true, style: { fontSize: '16px', color: CSS.text } }, fav.name),
                  Text(
                    { style: { fontSize: '13px', color: CSS.muted } },
                    favoriteSubtitle(fav)
                  )
                ]),
                Button({
                  label: 'Remover',
                  style: buttonStyle(CSS.danger, 'white'),
                  onClick: () => {
                    writeFavorites(storage, removeFavorite(readFavorites(storage), fav))
                    setMessage('success', `Ponto "${fav.name}" removido.`)
                  }
                })
              ]
            )
          )

    return View({ style: { padding: '12px 20px', background: CSS.bg, minHeight: '100vh' } }, [
      Text({ bold: true, style: { fontSize: '22px', color: CSS.title, marginBottom: '4px' } }, 'Cadê o Busão'),
      // Barrinha com 4 cores do gradiente "Pôr do sol", igual à do relógio.
      View(
        { style: { display: 'flex', flexDirection: 'row', marginBottom: '8px' } },
        [CSS.gradient[1], CSS.gradient[3], CSS.gradient[4], CSS.gradient[5]].map((color) =>
          View({ style: { width: '14px', height: '4px', background: color } }, [])
        )
      ),
      Text(
        { paragraph: true, style: { fontSize: '14px', color: CSS.muted } },
        'Uai, é só digitar o número da linha, escolher o sentido e o ponto. Eles aparecem na tela inicial do relógio.'
      ),
      Section({ title: 'Tema do relógio', style: { marginTop: '12px' } }, [
        themePicker(storage),
        Text(
          { paragraph: true, style: { fontSize: '12px', color: CSS.muted, marginTop: '6px' } },
          'Escuro (padrão) gasta menos bateria na tela AMOLED. Vale para todas as telas do relógio.'
        )
      ]),
      Section({ title: 'Novo ponto', style: { marginTop: '12px' } }, [
        ...pick,
        ...manual,
        messageBox(message),
        addButton
      ].filter(Boolean)),
      Section(
        {
          title: `Pontos salvos (${favorites.length})`,
          style: {
            marginTop: '16px',
            padding: '4px 12px',
            border: `1px solid ${CSS.border}`,
            borderRadius: '8px',
            background: CSS.card
          }
        },
        list
      ),
      Text(
        { paragraph: true, style: { fontSize: '11px', color: CSS.muted, marginTop: '16px' } },
        `Linhas, pontos e trajetos: GTFS oficial de Belo Horizonte (SUMOB/PBH), versão ${GTFS_INDEX.feed}. Posição dos ônibus: dados abertos de tempo real da PBH.`
      )
    ])
  }
})
