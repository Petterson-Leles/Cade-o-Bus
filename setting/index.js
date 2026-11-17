// Tela de configurações (abre no app Zepp do celular): cadastrar pontos favoritos.
import { readFavorites, writeFavorites, newFavoriteId, removeFavorite } from '../utils/favorites'
import { CSS } from '../utils/colors'
import { DRAFT_FIELDS, readJson, validate, applyDraftChange, buildFavorite } from '../shared/settings-form'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'

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
          // Relê o rascunho na hora: as variáveis do build podem estar velhas.
          const current = readJson(storage, DRAFT_KEY, {})
          storage.setItem(DRAFT_KEY, JSON.stringify(applyDraftChange(current, f.key, val)))
          // Ao editar, some a mensagem antiga.
          if (storage.getItem(MESSAGE_KEY)) storage.removeItem(MESSAGE_KEY)
        }
      })
    )

    const addButton = Button({
      label: 'Adicionar ponto',
      style: buttonStyle(CSS.primary, CSS.primaryText),
      onClick: () => {
        const current = readJson(storage, DRAFT_KEY, {})
        const errors = validate(current)
        if (errors.length > 0) {
          setMessage('error', errors.join('\n'))
          return
        }
        const fav = buildFavorite(current, newFavoriteId())
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
                    `Linha ${fav.line} · ${fav.lat}, ${fav.lon}`
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
