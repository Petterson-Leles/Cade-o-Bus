// Tela de configurações (abre no app Zepp do celular): cadastrar pontos favoritos.
import { readFavorites, writeFavorites } from '../utils/favorites'

const DRAFT_FIELDS = [
  { key: 'name', label: 'Nome do ponto (ex.: Casa)' },
  { key: 'line', label: 'Código da linha BHTrans (campo NL)' },
  { key: 'lat', label: 'Latitude do ponto (ex.: -19.9191)' },
  { key: 'lon', label: 'Longitude do ponto (ex.: -43.9386)' }
]

const buttonStyle = (bg) => ({
  fontSize: '14px',
  borderRadius: '30px',
  background: bg,
  color: 'white',
  marginTop: '8px'
})

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const favorites = readFavorites(storage)
    const draft = JSON.parse(storage.getItem('draft') || '{}')

    const inputs = DRAFT_FIELDS.map((f) =>
      TextInput({
        label: f.label,
        value: draft[f.key] || '',
        onChange: (val) => {
          storage.setItem('draft', JSON.stringify({ ...draft, [f.key]: String(val).trim() }))
        }
      })
    )

    const addButton = Button({
      label: 'Adicionar ponto',
      style: buttonStyle('#E0A800'),
      onClick: () => {
        const complete = DRAFT_FIELDS.every((f) => draft[f.key])
        const coordsOk = !isNaN(Number(draft.lat)) && !isNaN(Number(draft.lon))
        if (!complete || !coordsOk) {
          console.log('Preencha todos os campos com coordenadas válidas')
          return
        }
        writeFavorites(storage, [...favorites, draft])
        storage.setItem('draft', '{}')
      }
    })

    const list = favorites.map((fav, i) =>
      View(
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            borderBottom: '1px solid #eaeaea',
            padding: '6px 0'
          }
        },
        [
          Text({ style: { flex: 1 } }, `${fav.name} · linha ${fav.line}`),
          Button({
            label: 'Remover',
            style: buttonStyle('#D85E33'),
            onClick: () => writeFavorites(storage, favorites.filter((_, j) => j !== i))
          })
        ]
      )
    )

    return View({ style: { padding: '12px 20px' } }, [
      Text({ bold: true, style: { fontSize: '18px' } }, 'Cadê o Busão'),
      ...inputs,
      addButton,
      View({ style: { marginTop: '16px' } }, list)
    ])
  }
})
