// Tela de configurações (abre no app Zepp do celular): tema do relógio, mapa de BH,
// novo ponto e pontos salvos (com o horário de aviso de cada um).
// A lista de linhas e pontos vem do pacote GTFS embutido (data/gtfs-index.js):
// a tela de configurações é um bundle JS comum (ES6, sem eval), então importa
// o pacote direto, sem depender do side service estar rodando.
//
// Componentes da Settings App API (https://docs.zepp.com/docs/reference/app-settings-api/ui/view/
// e páginas vizinhas): View (style, onClick), Text (style, align, bold, paragraph),
// TextInput (label, placeholder, value, onChange, labelStyle, subStyle), Select
// (label, title, options, value, onChange), Toggle (label, value, onChange). O style
// aceita propriedades CSS em camelCase. Não há estado de toque (:active) nem eventos
// de pressionar: ações são View + Text com onClick (estilo próprio, sem o visual do
// Button), com `transition` para a troca de estilo do re-render ficar suave e
// -webkit-tap-highlight-color para o realce nativo de toque do WebView (se houver).
//
// Tudo o que a tela guarda fica no settingsStorage (rascunho, mensagem, último
// removido, ponto em edição); o side service só avisa o relógio quando mudam
// "favorites", "theme" ou "vibrate".
import { readFavorites, writeFavorites, newFavoriteId, removeFavorite, updateFavorite, readVibrate, writeVibrate, MAX_TEXT_LEN } from '../utils/favorites'
import { readMapStates, writeMapStates, markDeleting, storedText, storedCount, makeCommand, MAP_COMMAND_KEY } from '../shared/map-download'
import { MAP_ATTRIBUTION } from '../shared/map-tiles'
// Sol (Claro) e lua (Escuro) do seletor de tema: SVG animado em data URI (Image).
import { themeIcon, ICON_SIZE } from '../shared/theme-icons'
import { cssTheme, readThemeName, writeThemeName } from '../utils/colors'
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
  favoriteContext,
  stopContext,
  removalRecord,
  undoRemoval
} from '../shared/settings-form'
import { DAY_LABELS, normalizeAlert, alertActive, alertSummary, autoOpenLine, applyAlertChange, timeOptions, formatHHMM } from '../shared/schedule'
import GTFS_INDEX from '../data/gtfs-index'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'
const LAST_REMOVED_KEY = 'lastRemoved'
const EDITING_KEY = 'editingFav'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' }
]
const THEME_LABEL = { dark: 'escuro', light: 'claro' }
const TIME_OPTIONS = timeOptions(15)

// Troca de estilo suave (re-render) e realce de toque do WebView.
const SMOOTH = 'background-color 220ms ease, color 220ms ease, border-color 220ms ease, opacity 220ms ease'
const TAP = 'rgba(46, 125, 120, 0.18)'

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const C = cssTheme(storage)
    const favorites = readFavorites(storage)
    const draft = readJson(storage, DRAFT_KEY, {})
    const message = readJson(storage, MESSAGE_KEY, null)
    const editing = storage.getItem(EDITING_KEY) || ''

    // ---- Peças de UI ----

    // Rótulo de seção: pequeno, maiúsculo e espaçado.
    const sectionLabel = (text) =>
      Text({ style: { fontSize: '11px', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: '600', color: C.muted, margin: '28px 4px 8px' } }, text)
    const small = (text, extra) => Text({ paragraph: true, style: { fontSize: '12px', lineHeight: '17px', color: C.muted, ...extra } }, text)
    const fieldLabel = (text) => Text({ style: { fontSize: '12px', color: C.muted, margin: '14px 0 6px' } }, text)

    const card = (children, extra) =>
      View({ style: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '14px 16px', ...extra } }, children.filter(Boolean))

    const row = (children, extra, onClick) =>
      View(
        {
          style: { display: 'flex', flexDirection: 'row', alignItems: 'center', transition: SMOOTH, WebkitTapHighlightColor: TAP, ...extra },
          onClick
        },
        children.filter(Boolean)
      )

    // Link de texto pequeno (ações secundárias).
    const link = (label, onClick, color = C.accentText, extra) =>
      View({ style: { padding: '6px 4px', WebkitTapHighlightColor: TAP, cursor: 'pointer', ...extra }, onClick }, [
        Text({ style: { fontSize: '13px', fontWeight: '600', color, transition: SMOOTH } }, label)
      ])

    // Botão principal (um só por bloco): pílula cheia.
    const primaryButton = (label, onClick, enabled = true) =>
      View(
        {
          style: {
            marginTop: '16px',
            padding: '13px 16px',
            borderRadius: '14px',
            background: C.primary,
            opacity: enabled ? 1 : 0.45,
            textAlign: 'center',
            transition: SMOOTH,
            WebkitTapHighlightColor: TAP,
            cursor: 'pointer'
          },
          onClick
        },
        [Text({ bold: true, align: 'center', style: { fontSize: '15px', color: C.primaryText } }, label)]
      )

    // Botão secundário discreto: contorno fino.
    const quietButton = (label, onClick, color = C.accentText) =>
      View(
        {
          style: {
            marginTop: '10px',
            padding: '10px 14px',
            borderRadius: '12px',
            border: `1px solid ${C.border}`,
            textAlign: 'center',
            transition: SMOOTH,
            WebkitTapHighlightColor: TAP,
            cursor: 'pointer'
          },
          onClick
        },
        [Text({ align: 'center', style: { fontSize: '14px', fontWeight: '600', color } }, label)]
      )

    // Selo da linha: pílula pequena verde-azulada.
    const chip = (number) =>
      View(
        { style: { flexShrink: 0, minWidth: '44px', textAlign: 'center', background: C.chip, borderRadius: '10px', padding: '3px 8px', marginRight: '10px' } },
        [Text({ bold: true, align: 'center', style: { color: C.chipText, fontSize: '12px' } }, String(number))]
      )

    // Campo limpo: fundo do cartão, borda fina, cantos 12px, sem rótulo próprio.
    const field = (value, placeholder, onChange, extra) =>
      TextInput({
        placeholder,
        value: value || '',
        labelStyle: { display: 'none' },
        subStyle: {
          fontSize: '16px',
          color: value ? C.text : C.muted,
          background: C.fieldBg,
          border: `1px solid ${C.fieldBorder}`,
          borderRadius: '12px',
          padding: '11px 14px',
          minHeight: '20px',
          ...extra
        },
        onChange
      })

    // ---- Estado: mensagem (faixa), rascunho e ações ----

    // A faixa some na próxima ação (qualquer toque que mude algo).
    const clearSnack = () => {
      if (storage.getItem(MESSAGE_KEY)) storage.removeItem(MESSAGE_KEY)
      if (storage.getItem(LAST_REMOVED_KEY)) storage.removeItem(LAST_REMOVED_KEY)
    }
    const setMessage = (type, text, undo) => storage.setItem(MESSAGE_KEY, JSON.stringify({ type, text, undo: !!undo }))

    // Relê o rascunho na hora: as variáveis do build podem estar velhas.
    const change = (key, val) => {
      clearSnack()
      const current = readJson(storage, DRAFT_KEY, {})
      storage.setItem(DRAFT_KEY, JSON.stringify(applyDraftChange(current, key, val)))
    }
    const setEditing = (id) => {
      clearSnack()
      if (id) storage.setItem(EDITING_KEY, id)
      else storage.removeItem(EDITING_KEY)
    }
    const patchFav = (id, fn) => {
      clearSnack()
      const list = readFavorites(storage)
      const fav = list.find((f) => f.id === id)
      if (fav) writeFavorites(storage, updateFavorite(list, id, fn(fav)))
    }

    // Faixa fina tipo snackbar: "“Casa” removido · Desfazer" (ou salvo / erro).
    const snackbar = (errors) => {
      if (!message || !message.text || (message.type === 'error') !== errors) return null
      if (errors) {
        return View({ style: { marginTop: '12px', padding: '10px 12px', borderRadius: '12px', background: C.dangerBg } },
          message.text.split('\n').map((line) => Text({ paragraph: true, style: { fontSize: '13px', color: C.dangerText } }, line)))
      }
      return row(
        [
          Text({ style: { flex: 1, fontSize: '13px', color: C.snackText } }, message.text),
          message.undo
            ? link('Desfazer', () => {
                const record = readJson(storage, LAST_REMOVED_KEY, null)
                if (record) writeFavorites(storage, undoRemoval(readFavorites(storage), record))
                storage.removeItem(LAST_REMOVED_KEY)
                storage.removeItem(MESSAGE_KEY)
              }, C.snackLink, { padding: '2px 0 2px 12px' })
            : null
        ],
        { marginTop: '10px', padding: '9px 14px', borderRadius: '10px', background: C.snackBg }
      )
    }

    // ---- Relógio: tema e vibração ----

    // Seletor segmentado: trilho e a opção escolhida em destaque (transição suave),
    // com o sol (Claro) e a lua (Escuro): a escolhida anima (SMIL no SVG), a outra
    // fica parada e esmaecida.
    const themePicker = () => {
      const current = readThemeName(storage)
      return View(
        { style: { display: 'flex', flexDirection: 'row', background: C.track, borderRadius: '12px', padding: '3px' } },
        THEME_OPTIONS.map((opt) => {
          const selected = opt.value === current
          return View(
            {
              style: {
                flex: 1,
                textAlign: 'center',
                padding: '9px 0',
                borderRadius: '10px',
                background: selected ? C.primary : 'transparent',
                transition: SMOOTH,
                WebkitTapHighlightColor: TAP,
                cursor: 'pointer'
              },
              onClick: () => {
                clearSnack()
                if (readThemeName(storage) !== opt.value) writeThemeName(storage, opt.value)
              }
            },
            [
              View({ style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } }, [
                Image({
                  src: themeIcon(opt.value, selected),
                  alt: opt.value === 'light' ? 'Sol' : 'Lua',
                  width: ICON_SIZE * 0.7,
                  height: ICON_SIZE * 0.7,
                  style: { width: `${ICON_SIZE * 0.7}px`, height: `${ICON_SIZE * 0.7}px`, marginRight: '8px', opacity: selected ? 1 : 0.5, transition: SMOOTH }
                }),
                Text({ bold: selected, align: 'center', style: { fontSize: '14px', color: selected ? C.primaryText : C.text, transition: SMOOTH } }, opt.label)
              ])
            ]
          )
        })
      )
    }

    const vibrateOn = readVibrate(storage)
    const watchCard = card([
      Text({ style: { fontSize: '13px', color: C.muted, marginBottom: '8px' } }, 'Tema'),
      themePicker(),
      View({ style: { height: '1px', background: C.border, margin: '14px 0 4px' } }, []),
      Toggle({ label: 'Vibrar no relógio', value: vibrateOn, onChange: (val) => { clearSnack(); writeVibrate(storage, !!val) } }),
      small(
        vibrateOn
          ? 'Só no horário de aviso de cada ponto: curta em “já já”, longa em “chegando” e duas curtas quando o ônibus passa.'
          : 'Desligado: o relógio não vibra nem abre sozinho em nenhum ponto.'
      )
    ])

    // ---- Mapa de BH ----

    // Mapa sob demanda: o celular guarda os blocos e manda ao relógio só os da vista
    // aberta (app-side/map-sync.js). Aqui só a contagem e "Limpar mapa do relógio".
    const mapCard = () => {
      const states = readMapStates(storage)
      const clear = () => {
        clearSnack()
        // Marca na hora (o serviço do celular pode estar parado) e deixa o comando
        // para ele, que avisa o relógio (apaga quando o app abrir no relógio).
        writeMapStates(storage, markDeleting(readMapStates(storage)))
        storage.setItem(MAP_COMMAND_KEY, makeCommand('delete', 'all'))
      }
      const deleting = Object.keys(states).some((t) => states[t].deleting)
      return card([
        Text({ style: { fontSize: '14px', color: C.text } }, `Mapa: ${storedText(states).replace(/^Ruas/, 'ruas')}`),
        small('Abra um ponto no relógio e as ruas em volta chegam do celular em segundos. O relógio guarda os blocos usados mais recentemente.', { marginTop: '6px' }),
        !deleting && storedCount(states) > 0 ? View({ style: { display: 'flex', flexDirection: 'row', marginTop: '8px' } }, [link('Limpar mapa do relógio', clear, C.remove)]) : null,
        small(`${MAP_ATTRIBUTION} (ODbL).`, { fontSize: '11px', marginTop: '10px' })
      ])
    }

    // ---- Novo ponto ----

    const choices = draftChoices(draft, GTFS_INDEX)
    const pick = []

    // 1. Linha: campo limpo; sugestões como linhas leves; linha encontrada vira cabeçalho.
    if (choices.line) {
      pick.push(
        row([
          chip(choices.line.number),
          Text({ bold: true, style: { flex: 1, fontSize: '14px', color: C.text } }, choices.line.name),
          link('trocar', () => change('line', ''), C.accentText, { paddingLeft: '10px' })
        ])
      )
    } else {
      pick.push(Text({ style: { fontSize: '13px', color: C.muted, marginBottom: '6px' } }, 'Número da linha'))
      pick.push(field(draft.line, 'Ex.: 9250', (val) => change('line', val)))
      if (choices.suggestions.length > 0) {
        pick.push(small('Qual dessas?', { marginTop: '10px' }))
        choices.suggestions.forEach((l, i) => {
          pick.push(
            row([chip(l.number), Text({ style: { flex: 1, fontSize: '13px', color: C.text } }, l.name)], {
              padding: '9px 2px',
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none'
            }, () => change('line', l.number))
          )
        })
      } else if (choices.missing) {
        pick.push(small('Uai, não achei essa linha em BH. Confira o número no letreiro do ônibus.', { marginTop: '10px', color: C.dangerText }))
      }
    }

    // 2. Sentido: duas linhas "Para <destino>".
    if (choices.line) {
      pick.push(fieldLabel('Sentido'))
      choices.dirCards.forEach((d) => {
        const selected = d.dir === choices.dir
        pick.push(
          row(
            [
              View({ style: { width: '26px', height: '26px', flexShrink: 0, borderRadius: '50%', background: selected ? C.primary : C.chipSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '10px', transition: SMOOTH } }, [
                Text({ bold: true, style: { color: selected ? C.primaryText : C.accentText, fontSize: '13px' } }, '→')
              ]),
              View({ style: { flex: 1 } }, [
                Text({ bold: selected, style: { fontSize: '14px', color: C.text } }, d.title),
                Text({ style: { fontSize: '12px', color: C.muted } }, d.detail)
              ])
            ],
            { padding: '9px 10px', marginTop: '6px', borderRadius: '12px', border: `1px solid ${selected ? C.primary : C.border}`, background: selected ? C.chosenBg : 'transparent' },
            () => change('dir', String(d.dir))
          )
        )
      })
    }

    // 3. Seu ponto: busca pela rua e a lista na ordem do trajeto; no escolhido, "entre X e Y".
    if (choices.dir !== null && !draft.manual) {
      pick.push(fieldLabel('Seu ponto'))
      pick.push(field(draft.q, 'Buscar rua, ex.: Afonso Pena', (val) => change('q', val)))
      const list = filterStops(choices.stops, draft.q)
      const ctx = choices.stop ? stopContext(GTFS_INDEX, choices.line.number, choices.dir, choices.stop.id) : null
      const stopRow = (st, i) => {
        const selected = !!choices.stop && choices.stop.id === st.id
        const first = i === 0
        const last = i === list.length - 1
        const seg = (show) => View({ style: { width: '2px', flex: 1, background: show ? C.railLine : 'transparent' } }, [])
        const dot = View({
          style: {
            width: selected ? '14px' : '10px',
            height: selected ? '14px' : '10px',
            boxSizing: 'border-box',
            borderRadius: '50%',
            background: selected ? C.primary : C.card,
            border: `2px solid ${C.primary}`,
            transition: SMOOTH
          }
        }, [])
        return View(
          { style: { display: 'flex', flexDirection: 'row', alignItems: 'stretch', minHeight: '38px', padding: '0 10px 0 4px', borderRadius: '10px', background: selected ? C.chosenBg : 'transparent', transition: SMOOTH, WebkitTapHighlightColor: TAP }, onClick: () => change('stopId', st.id) },
          [
            View({ style: { width: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 } }, [seg(!first), dot, seg(!last)]),
            View({ style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: '6px', paddingTop: '6px', paddingBottom: '6px' } }, [
              Text({ bold: selected, style: { fontSize: '13px', color: selected ? C.chosenText : C.text } }, st.street),
              selected && ctx && ctx.between ? Text({ style: { fontSize: '12px', color: C.muted, marginTop: '2px' } }, ctx.between) : null
            ].filter(Boolean)),
            View({ style: { display: 'flex', alignItems: 'center' } }, [Text({ style: { fontSize: '11px', color: C.muted } }, `${st.seq}º`)])
          ]
        )
      }
      pick.push(
        View(
          { style: { marginTop: '8px', maxHeight: '300px', overflowY: 'auto' } },
          list.length > 0 ? list.map(stopRow) : [small('Nenhum ponto com esse nome nesta linha.', { padding: '8px 4px' })]
        )
      )
    }

    // 4. Nome (opcional), só depois de escolher o ponto (no avançado é obrigatório).
    if (choices.stop || draft.manual) {
      const example = choices.stop ? `Ex.: Casa (${choices.stop.street || choices.stop.name})` : 'Ex.: Casa'
      pick.push(fieldLabel(draft.manual ? 'Nome do ponto' : 'Como você chama esse ponto? (opcional)'))
      pick.push(field(draft.name, example, (val) => change('name', val)))
      pick.push(
        View(
          { style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', marginTop: '8px', gap: '6px' } },
          NAME_SHORTCUTS.map((s) => {
            const on = draft.name === s.value
            return View(
              { style: { padding: '5px 11px', borderRadius: '14px', border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.chosenBg : 'transparent', transition: SMOOTH, WebkitTapHighlightColor: TAP }, onClick: () => change('name', s.value) },
              [Text({ style: { fontSize: '13px', color: on ? C.chosenText : C.text } }, s.label)]
            )
          })
        )
      )
    }

    // Avançado: latitude e longitude digitadas (vale também para linhas fora da lista).
    const manual = [
      View({ style: { height: '1px', background: C.border, margin: '16px 0 4px' } }, []),
      Toggle({ label: 'Avançado: digitar latitude e longitude', value: !!draft.manual, onChange: (val) => change('manual', val) })
    ]
    if (draft.manual) {
      DRAFT_FIELDS.filter((f) => f.key === 'lat' || f.key === 'lon').forEach((f) => {
        manual.push(fieldLabel(f.label))
        manual.push(field(draft[f.key], f.placeholder, (val) => change(f.key, val)))
      })
      manual.push(small('Dica: no Google Maps, toque e segure no ponto para copiar a latitude e a longitude. No modo avançado o nome é obrigatório e a linha pode ser qualquer código.', { marginTop: '8px' }))
    }

    const ready = draft.manual || !!choices.stop
    const addButton = primaryButton('Adicionar ponto', () => {
      clearSnack()
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
      // Abre o "Editar" do ponto novo, para definir o horário de aviso.
      storage.setItem(EDITING_KEY, fav.id)
      setMessage('success', `“${fav.name}” salvo · defina quando avisar`)
    }, ready)

    // ---- Pontos salvos ----

    const dayChips = (fav, alert) =>
      View(
        { style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
        DAY_LABELS.map((label, i) => {
          const on = alert.days.indexOf(i + 1) >= 0
          return View(
            {
              style: {
                minWidth: '38px',
                textAlign: 'center',
                padding: '6px 0',
                borderRadius: '10px',
                border: `1px solid ${on ? C.primary : C.border}`,
                background: on ? C.chosenBg : 'transparent',
                transition: SMOOTH,
                WebkitTapHighlightColor: TAP,
                cursor: 'pointer'
              },
              onClick: () => patchFav(fav.id, (f) => ({ alert: applyAlertChange(f.alert, 'day', i + 1) }))
            },
            [Text({ bold: on, align: 'center', style: { fontSize: '12px', color: on ? C.chosenText : C.muted } }, label)]
          )
        })
      )

    const timeSelect = (fav, key, label, value) =>
      View({ style: { flex: 1 } }, [
        Select({
          label,
          title: label === 'das' ? 'Começa às' : 'Termina às',
          options: TIME_OPTIONS,
          value: formatHHMM(value),
          onChange: (val) => patchFav(fav.id, (f) => ({ alert: applyAlertChange(f.alert, key, val) }))
        })
      ])

    // "Editar": nome e horário de aviso, sem recadastrar.
    const editor = (fav) => {
      const alert = normalizeAlert(fav.alert)
      const auto = vibrateOn ? autoOpenLine(alert) : ''
      return View({ style: { marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${C.border}` } }, [
        Text({ style: { fontSize: '12px', color: C.muted, marginBottom: '6px' } }, 'Nome'),
        field(fav.name, 'Ex.: Casa', (val) => {
          const name = String(val || '').trim().slice(0, MAX_TEXT_LEN).trim()
          if (name) patchFav(fav.id, () => ({ name }))
        }),
        Toggle({ label: 'Avisar no relógio', value: alert.on, onChange: (val) => patchFav(fav.id, (f) => ({ alert: applyAlertChange(f.alert, 'on', !!val) })) }),
        alert.on ? dayChips(fav, alert) : null,
        alert.on ? View({ style: { display: 'flex', flexDirection: 'row', gap: '10px', marginTop: '6px' } }, [timeSelect(fav, 'from', 'das', alert.from), timeSelect(fav, 'to', 'às', alert.to)]) : null,
        alert.on && alert.to <= alert.from ? small(`Vai até ${formatHHMM(alert.to)} do dia seguinte.`, { marginTop: '4px' }) : null,
        alert.on && alert.days.length === 0 ? small('Marque pelo menos um dia.', { marginTop: '4px', color: C.dangerText }) : null,
        auto ? small(auto, { marginTop: '8px', color: C.accentText }) : null,
        !alert.on ? small('Desligado: nesse ponto o relógio não vibra, nem com a tela aberta.', { marginTop: '2px' }) : null,
        row([View({ style: { flex: 1 } }, []), link('Pronto', () => setEditing(''))], { marginTop: '6px' })
      ])
    }

    const savedCard = (fav) => {
      const ctx = favoriteContext(fav, GTFS_INDEX)
      const open = editing === fav.id
      const alert = normalizeAlert(fav.alert)
      const status = alertActive(alert) && vibrateOn ? `Avisa ${alertSummary(alert)}` : 'Avisos desligados'
      return card(
        [
          row([
            chip(fav.line),
            Text({ bold: true, style: { flex: 1, minWidth: 0, fontSize: '15px', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, fav.name),
            open ? null : link('Editar', () => setEditing(fav.id), C.accentText, { paddingLeft: '10px' }),
            link('Remover', () => {
              const current = readFavorites(storage)
              // Guarda o removido (e onde estava) para o "Desfazer".
              storage.setItem(LAST_REMOVED_KEY, JSON.stringify(removalRecord(current, fav)))
              if (editing === fav.id) storage.removeItem(EDITING_KEY)
              writeFavorites(storage, removeFavorite(current, fav))
              setMessage('success', `“${fav.name}” removido`, true)
            }, C.remove, { paddingLeft: '12px' })
          ]),
          Text({ style: { fontSize: '13px', color: C.text, marginTop: '6px' } }, ctx ? ctx.where : favoriteStreet(fav, GTFS_INDEX)),
          ctx && ctx.between ? Text({ style: { fontSize: '12px', color: C.muted, marginTop: '2px' } }, ctx.between) : null,
          open ? null : Text({ style: { fontSize: '12px', color: alertActive(alert) && vibrateOn ? C.accentText : C.muted, marginTop: '6px' } }, status),
          open ? editor(fav) : null
        ],
        { marginTop: '10px', padding: '12px 14px' }
      )
    }

    const saved =
      favorites.length === 0
        ? [card([small('Nenhum ponto salvo ainda. Cadastre o primeiro aqui em cima.')])]
        : favorites.map(savedCard)

    return View({ style: { padding: '20px 18px 32px', background: C.bg, minHeight: '100vh', transition: SMOOTH } }, [
      Text({ bold: true, style: { fontSize: '24px', color: C.title } }, 'Cadê o Busão'),
      // Barrinha com 4 cores do gradiente "Pôr do sol", igual à do relógio.
      View(
        { style: { display: 'flex', flexDirection: 'row', margin: '6px 0 10px' } },
        [C.gradient[1], C.gradient[3], C.gradient[4], C.gradient[5]].map((color) =>
          View({ style: { width: '16px', height: '3px', borderRadius: '2px', marginRight: '2px', background: color } }, [])
        )
      ),
      small('Uai, é só digitar o número da linha, escolher o sentido e o ponto.', { fontSize: '13px' }),
      sectionLabel('Relógio'),
      watchCard,
      sectionLabel('Mapa de BH'),
      mapCard(),
      sectionLabel('Novo ponto'),
      card([...pick, ...manual, addButton, snackbar(true)]),
      sectionLabel(`Pontos salvos · ${favorites.length}`),
      snackbar(false),
      ...saved,
      small(
        `Linhas, pontos e trajetos: GTFS oficial de Belo Horizonte (SUMOB/PBH), versão ${GTFS_INDEX.feed}. Posição dos ônibus: dados abertos de tempo real da PBH.`,
        { fontSize: '11px', marginTop: '28px' }
      )
    ].filter(Boolean))
  }
})
