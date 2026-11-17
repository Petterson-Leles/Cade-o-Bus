// Tela de configurações (abre no app Zepp do celular): cadastrar pontos favoritos.
import { readFavorites, writeFavorites } from '../utils/favorites'
import { CSS } from '../utils/colors'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'

const DRAFT_FIELDS = [
  { key: 'name', label: 'Nome do ponto', placeholder: 'Ex.: Casa' },
  { key: 'line', label: 'Código da linha BHTrans (campo NL)', placeholder: 'Ex.: 1234' },
  { key: 'lat', label: 'Latitude do ponto', placeholder: 'Ex.: -19.9191' },
  { key: 'lon', label: 'Longitude do ponto', placeholder: 'Ex.: -43.9386' }
]

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

function toCoord(value) {
  const n = Number(String(value || '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// Devolve a lista de problemas do rascunho (vazia = pode salvar).
function validate(draft) {
  const errors = []
  DRAFT_FIELDS.forEach((f) => {
    if (!draft[f.key]) errors.push(`Preencha "${f.label}".`)
  })
  if (draft.lat && !(Math.abs(toCoord(draft.lat)) <= 90)) {
    errors.push('Latitude inválida: use número com ponto, ex.: -19.9191.')
  }
  if (draft.lon && !(Math.abs(toCoord(draft.lon)) <= 180)) {
    errors.push('Longitude inválida: use número com ponto, ex.: -43.9386.')
  }
  return errors
}

const buttonStyle = (bg, color) => ({
  fontSize: '15px',
  fontWeight: 'bold',
  borderRadius: '30px',
  background: bg,
  color,
  padding: '10px 18px',
  marginTop: '8px'
})

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
        color: ok ? CSS.success : CSS.danger,
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

    const inputs = DRAFT_FIELDS.map((f) =>
      TextInput({
        label: f.label,
        placeholder: f.placeholder,
        value: draft[f.key] || '',
        labelStyle: { fontSize: '14px', color: CSS.text },
        subStyle: { fontSize: '16px', color: CSS.text },
        onChange: (val) => {
          storage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, [f.key]: String(val).trim() }))
          // Ao editar, some a mensagem antiga.
          if (message) storage.removeItem(MESSAGE_KEY)
        }
      })
    )

    const addButton = Button({
      label: 'Adicionar ponto',
      style: buttonStyle(CSS.primary, CSS.primaryText),
      onClick: () => {
        const errors = validate(draft)
        if (errors.length > 0) {
          setMessage('error', errors.join('\n'))
          return
        }
        const fav = {
          name: draft.name,
          line: draft.line,
          lat: String(toCoord(draft.lat)),
          lon: String(toCoord(draft.lon))
        }
        writeFavorites(storage, [...favorites, fav])
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
                    `Linha ${fav.line} · ${fav.lat}, ${fav.lon}`
                  )
                ]),
                Button({
                  label: 'Remover',
                  style: buttonStyle(CSS.danger, 'white'),
                  onClick: () => {
                    writeFavorites(storage, favorites.filter((_, j) => j !== i))
                    setMessage('success', `Ponto "${fav.name}" removido.`)
                  }
                })
              ]
            )
          )

    return View({ style: { padding: '12px 20px' } }, [
      Text({ bold: true, style: { fontSize: '22px', color: CSS.text, marginBottom: '4px' } }, 'Cadê o Busão'),
      Text(
        { paragraph: true, style: { fontSize: '14px', color: CSS.muted } },
        'Cadastre os pontos de ônibus que você usa. Eles aparecem na tela inicial do relógio.'
      ),
      Section({ title: 'Novo ponto', style: { marginTop: '12px' } }, [
        ...inputs,
        Text(
          { paragraph: true, style: { fontSize: '12px', color: CSS.muted, marginTop: '6px' } },
          'Dica: no Google Maps, toque e segure no ponto para copiar a latitude e a longitude.'
        ),
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
      )
    ])
  }
})
