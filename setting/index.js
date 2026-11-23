// Tela de configurações (abre no app Zepp do celular), visual "clean e moderno":
// - início: cabeçalho, pontos salvos num cartão só (tocar abre o editor do ponto),
//   botão "+ Adicionar ponto", PREFERÊNCIAS (tema, vibrar, mapa de BH) e rodapé;
// - "Novo ponto": tela própria (esconde o resto) com os passos 1 · LINHA,
//   2 · SENTIDO, 3 · SEU PONTO, nome, "Salvar" e o avançado (lat/lon) no fim.
// A lista de linhas e pontos vem do pacote GTFS embutido (data/gtfs-index.js):
// a tela de configurações é um bundle JS comum (ES6, sem eval), então importa
// o pacote direto, sem depender do side service estar rodando.
//
// Componentes da Settings App API (https://docs.zepp.com/docs/reference/app-settings-api/ui/view/
// e páginas vizinhas): View (style, onClick), Text (style, align, bold, paragraph),
// TextInput (label, placeholder, value, multiline, rows, onChange, labelStyle, subStyle),
// Select (label, title, options, value, onChange), Toggle (label, value, onChange),
// Image (src, width, height). O style aceita propriedades CSS em camelCase. Não há
// estado de toque (:active): ações são View + Text com onClick, com `transition`
// para a troca de estilo do re-render ficar suave e -webkit-tap-highlight-color
// para o realce nativo de toque do WebView (se houver).
//
// Tudo o que a tela guarda fica no settingsStorage (rascunho, mensagem, último
// removido, ponto em edição, tela "Novo ponto", mapa aberto); o side service só
// avisa o relógio quando mudam "favorites", "theme" ou "vibrate".
import { readFavorites, writeFavorites, newFavoriteId, removeFavorite, updateFavorite, readVibrate, writeVibrate, MAX_TEXT_LEN } from '../utils/favorites'
import { readMapStates, writeMapStates, markDeleting, storedText, storedCount, makeCommand, MAP_COMMAND_KEY, MAP_DIAG_KEY, diagLines } from '../shared/map-download'
import { MAP_ATTRIBUTION } from '../shared/map-tiles'
// Sol (Claro) e lua (Escuro) do seletor de tema: SVG animado em data URI (Image).
import { themeIcon, ICON_SIZE } from '../shared/theme-icons'
// Ícones dos pontos (losango = rua, "M" = estação MOVE, hexágono = estação central),
// os mesmos do mapa do relógio.
import { stopIconUri, SETTING_ICON_PX } from '../shared/stop-icons-svg'
import { stopKind } from '../shared/text'
import { cssTheme, readThemeName, writeThemeName } from '../utils/colors'
import { SCREEN_KEY, MAP_OPEN_KEY, countLabel, towardName, savedRow, saveLabel, mapSummary } from '../utils/settings-view'
import {
  DRAFT_FIELDS,
  NAME_SHORTCUTS,
  readJson,
  validateDraft,
  applyDraftChange,
  buildFavorite,
  draftChoices,
  filterStops,
  stopContext,
  removalRecord,
  undoRemoval
} from '../shared/settings-form'
import { DAY_LABELS, normalizeAlert, autoOpenLine, applyAlertChange, timeOptions, formatHHMM } from '../shared/schedule'
import GTFS_INDEX from '../data/gtfs-index'

const DRAFT_KEY = 'draft'
const MESSAGE_KEY = 'formMessage'
const LAST_REMOVED_KEY = 'lastRemoved'
const EDITING_KEY = 'editingFav'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' }
]
const TIME_OPTIONS = timeOptions(15)

// Medidas do visual: cartões sem borda com raio 20, botões 16, campos 14.
const R_CARD = '20px'
const R_BUTTON = '16px'
const R_FIELD = '14px'

// Troca de estilo suave (re-render) e realce de toque do WebView.
const SMOOTH = 'background-color 220ms ease, color 220ms ease, border-color 220ms ease, opacity 220ms ease'
const TAP = 'rgba(61, 169, 252, 0.18)' // azul-céu (#3DA9FC)

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const C = cssTheme(storage)
    const favorites = readFavorites(storage)
    const draft = readJson(storage, DRAFT_KEY, {})
    const message = readJson(storage, MESSAGE_KEY, null)
    const editing = storage.getItem(EDITING_KEY) || ''
    const adding = storage.getItem(SCREEN_KEY) === 'add'
    const vibrateOn = readVibrate(storage)

    // ---- Peças de UI ----

    // Texto em bloco: cada pedaço na sua linha. No celular o Text sai inline (dois
    // Text seguidos ficavam colados: "13º pontoentre ...", "1810Avisa ..."). Um View
    // (div) em volta e paragraph + display block no Text garantem a quebra; a margem
    // vem do style.
    const blockText = (props, text) =>
      View({ style: { display: 'block' } }, [Text({ paragraph: true, ...props, style: { display: 'block', margin: 0, ...(props && props.style) } }, text)])
    // Uma linha só, cortada com "…".
    const oneLineText = (props, text) =>
      blockText({ ...props, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(props && props.style) } }, text)

    // Rótulo de seção/passo: pequeno, maiúsculo e espaçado.
    const sectionLabel = (text, extra) =>
      blockText({ bold: true, style: { fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', color: C.muted, margin: '26px 4px 8px', ...extra } }, text)
    const small = (text, extra) => blockText({ style: { fontSize: '12px', lineHeight: '17px', color: C.muted, ...extra } }, text)
    const fieldLabel = (text, extra) => blockText({ style: { fontSize: '13px', color: C.muted, margin: '14px 0 6px', ...extra } }, text)

    // Cartão sem borda externa.
    const card = (children, extra) =>
      View({ style: { background: C.card, borderRadius: R_CARD, padding: '6px 16px', transition: SMOOTH, ...extra } }, children.filter(Boolean))
    // Separador fino entre linhas de um cartão.
    const divider = (extra) => View({ style: { height: '1px', background: C.chipSoft, ...extra } }, [])

    const row = (children, extra, onClick) =>
      View(
        {
          style: { display: 'flex', flexDirection: 'row', alignItems: 'center', transition: SMOOTH, WebkitTapHighlightColor: TAP, ...(onClick ? { cursor: 'pointer' } : {}), ...extra },
          onClick
        },
        children.filter(Boolean)
      )
    // Coluna que ocupa o resto da linha (textos empilhados, um por linha).
    const grow = (children, extra) => View({ style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', ...extra } }, children.filter(Boolean))
    const chevron = () => Text({ style: { flexShrink: 0, fontSize: '22px', lineHeight: '22px', color: C.muted, paddingLeft: '10px' } }, '›')

    // Link de texto (ações secundárias).
    const link = (label, onClick, color = C.accentText, extra) =>
      View({ style: { padding: '8px 4px', WebkitTapHighlightColor: TAP, cursor: 'pointer', ...extra }, onClick }, [
        Text({ bold: true, style: { fontSize: '14px', color, transition: SMOOTH } }, label)
      ])

    // Botão principal largo (um por tela).
    const primaryButton = (label, onClick, enabled = true, extra) =>
      View(
        {
          style: {
            marginTop: '16px',
            padding: '15px 16px',
            borderRadius: R_BUTTON,
            background: C.primary,
            opacity: enabled ? 1 : 0.45,
            textAlign: 'center',
            transition: SMOOTH,
            WebkitTapHighlightColor: TAP,
            cursor: 'pointer',
            ...extra
          },
          onClick
        },
        [blockText({ bold: true, align: 'center', style: { fontSize: '16px', color: C.primaryText, textAlign: 'center' } }, label)]
      )

    // Selo da linha: cheio (formulário) ou suave (lista dos pontos salvos).
    const chip = (number, soft, extra) =>
      View(
        { style: { flexShrink: 0, textAlign: 'center', background: soft ? C.chipSoft : C.chip, borderRadius: '8px', padding: '2px 8px', ...extra } },
        [Text({ bold: true, align: 'center', style: { color: soft ? C.accentText : C.chipText, fontSize: '13px' } }, String(number))]
      )

    // Ícone do tipo do ponto: no quadradinho suave (lista dos salvos) ou solto.
    const kindIcon = (kind, bg, selected) => {
      const size = SETTING_ICON_PX[kind] || SETTING_ICON_PX.street
      return Image({
        src: stopIconUri(kind, C, { bg, selected }),
        alt: kind === 'central' ? 'Estação central' : kind === 'move' ? 'Estação MOVE' : 'Ponto de rua',
        width: size,
        height: size,
        style: { width: `${size}px`, height: `${size}px`, flexShrink: 0 }
      })
    }
    const iconTile = (kind) =>
      View(
        { style: { width: '38px', height: '38px', flexShrink: 0, borderRadius: '12px', background: C.chipSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '12px' } },
        [kindIcon(kind, C.chipSoft, false)]
      )

    // Campo de texto: cantos 14px, borda fina, sem rótulo próprio.
    // opts.multiline: EXPERIMENTO (campos de nome) - TextInput com multiline/rows
    // (https://docs.zepp.com/docs/reference/app-settings-api/ui/text-input/) para ver se
    // o app Zepp deixa digitar direto na linha em vez de abrir o popup de edição.
    // Se não ajudar no celular real, é só tirar o { multiline: true } das chamadas.
    // Campo multiline pode receber Enter: o nome fica numa linha só (oneLine).
    const oneLine = (val) => String(val === undefined || val === null ? '' : val).replace(/\s*[\r\n]+\s*/g, ' ')
    const field = (value, placeholder, onChange, extra, opts) =>
      TextInput({
        ...(opts && opts.multiline ? { multiline: true, rows: 1 } : {}),
        placeholder,
        value: value || '',
        labelStyle: { display: 'none' },
        subStyle: {
          fontSize: '16px',
          color: value ? C.text : C.muted,
          background: C.fieldBg,
          border: `1px solid ${C.fieldBorder}`,
          borderRadius: R_FIELD,
          padding: '12px 14px',
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
    const setAdding = (on) => {
      clearSnack()
      if (on) storage.setItem(SCREEN_KEY, 'add')
      else storage.removeItem(SCREEN_KEY)
    }
    const patchFav = (id, fn) => {
      clearSnack()
      const list = readFavorites(storage)
      const fav = list.find((f) => f.id === id)
      if (fav) writeFavorites(storage, updateFavorite(list, id, fn(fav)))
    }

    // Faixa tipo snackbar: "“Casa” removido · Desfazer" (ou salvo), ou a caixa de erros.
    const snackbar = (errors) => {
      if (!message || !message.text || (message.type === 'error') !== errors) return null
      if (errors) {
        return View(
          { style: { marginTop: '12px', padding: '10px 14px', borderRadius: R_FIELD, background: C.dangerBg } },
          message.text.split('\n').map((line) => blockText({ style: { fontSize: '13px', lineHeight: '18px', color: C.dangerText } }, line))
        )
      }
      return row(
        [
          grow([blockText({ style: { fontSize: '14px', color: C.snackText } }, message.text)]),
          message.undo
            ? link('Desfazer', () => {
                const record = readJson(storage, LAST_REMOVED_KEY, null)
                if (record) writeFavorites(storage, undoRemoval(readFavorites(storage), record))
                storage.removeItem(LAST_REMOVED_KEY)
                storage.removeItem(MESSAGE_KEY)
              }, C.snackLink, { padding: '2px 0 2px 12px' })
            : null
        ],
        { margin: '0 0 12px', padding: '11px 16px', borderRadius: R_FIELD, background: C.snackBg }
      )
    }

    // ---- Pontos salvos ----

    const dayChips = (fav, alert) =>
      View(
        { style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
        DAY_LABELS.map((label, i) => {
          const on = alert.days.indexOf(i + 1) >= 0
          return View(
            {
              style: {
                minWidth: '38px',
                textAlign: 'center',
                padding: '7px 0',
                borderRadius: '10px',
                background: on ? C.primary : C.chipSoft,
                transition: SMOOTH,
                WebkitTapHighlightColor: TAP,
                cursor: 'pointer'
              },
              onClick: () => patchFav(fav.id, (f) => ({ alert: applyAlertChange(f.alert, 'day', i + 1) }))
            },
            [Text({ bold: on, align: 'center', style: { fontSize: '13px', color: on ? C.primaryText : C.text } }, label)]
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

    const removeFav = (fav) => {
      const current = readFavorites(storage)
      // Guarda o removido (e onde estava) para o "Desfazer".
      storage.setItem(LAST_REMOVED_KEY, JSON.stringify(removalRecord(current, fav)))
      if (editing === fav.id) storage.removeItem(EDITING_KEY)
      writeFavorites(storage, removeFavorite(current, fav))
      setMessage('success', `“${fav.name}” removido`, true)
    }

    // Editor do ponto (abre ao tocar na linha): onde fica, nome e aviso, cada pedaço
    // na sua linha; "Remover" em vermelho e "Pronto".
    const editor = (fav, info) => {
      const alert = normalizeAlert(fav.alert)
      const auto = vibrateOn ? autoOpenLine(alert) : ''
      return View({ style: { padding: '0 0 14px 50px' } }, [
        info.where ? blockText({ style: { fontSize: '13px', lineHeight: '18px', color: C.text } }, info.where) : null,
        info.between ? blockText({ style: { fontSize: '12px', lineHeight: '17px', color: C.muted, marginTop: '2px' } }, info.between) : null,
        fieldLabel('Nome'),
        // Experimento: multiline (ver field).
        field(
          fav.name,
          'Ex.: Casa',
          (val) => {
            const name = oneLine(val).trim().slice(0, MAX_TEXT_LEN).trim()
            if (name) patchFav(fav.id, () => ({ name }))
          },
          null,
          { multiline: true }
        ),
        View({ style: { marginTop: '8px' } }, [
          Toggle({ label: 'Avisar no relógio', value: alert.on, onChange: (val) => patchFav(fav.id, (f) => ({ alert: applyAlertChange(f.alert, 'on', !!val) })) })
        ]),
        alert.on ? dayChips(fav, alert) : null,
        alert.on ? View({ style: { display: 'flex', flexDirection: 'row', gap: '10px', marginTop: '10px' } }, [timeSelect(fav, 'from', 'das', alert.from), timeSelect(fav, 'to', 'às', alert.to)]) : null,
        alert.on && alert.to <= alert.from ? small(`Vai até ${formatHHMM(alert.to)} do dia seguinte.`, { marginTop: '6px' }) : null,
        alert.on && alert.days.length === 0 ? small('Marque pelo menos um dia.', { marginTop: '6px', color: C.dangerText }) : null,
        auto ? small(auto, { marginTop: '8px', color: C.accentText }) : null,
        !alert.on ? small('Desligado: nesse ponto o relógio não vibra, nem com a tela aberta.', { marginTop: '4px' }) : null,
        !vibrateOn && alert.on ? small('“Vibrar no relógio” está desligado em Preferências.', { marginTop: '6px' }) : null,
        row(
          [
            link('Remover', () => removeFav(fav), C.remove, { paddingLeft: 0 }),
            View({ style: { flex: 1 } }, []),
            View(
              { style: { padding: '9px 22px', borderRadius: '12px', background: C.primary, cursor: 'pointer', WebkitTapHighlightColor: TAP }, onClick: () => setEditing('') },
              [Text({ bold: true, style: { fontSize: '14px', color: C.primaryText } }, 'Pronto')]
            )
          ],
          { marginTop: '14px' }
        )
      ])
    }

    // Linha do ponto: ícone | nome + selo | rua · p/ sentido | aviso | ›.
    const savedItem = (fav, i) => {
      const info = savedRow(fav, GTFS_INDEX, vibrateOn)
      const open = editing === fav.id
      return View({ style: { display: 'block' } }, [
        i > 0 ? divider() : null,
        row(
          [
            iconTile(info.kind),
            grow([
              row([
                Text({ bold: true, style: { minWidth: 0, fontSize: '16px', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '8px' } }, info.title),
                chip(fav.line, true)
              ]),
              oneLineText({ style: { fontSize: '13px', lineHeight: '18px', color: C.muted, marginTop: '3px' } }, info.sub),
              open ? null : blockText({ style: { fontSize: '12px', lineHeight: '17px', color: info.alertOn ? C.accentText : C.muted, marginTop: '3px' } }, info.alert)
            ]),
            open ? Text({ bold: true, style: { flexShrink: 0, fontSize: '13px', color: C.accentText, paddingLeft: '10px' } }, 'fechar') : chevron()
          ],
          { padding: '14px 0' },
          () => setEditing(open ? '' : fav.id)
        ),
        open ? editor(fav, info) : null
      ])
    }

    const savedCard =
      favorites.length === 0
        ? card([
            blockText({ bold: true, style: { fontSize: '15px', color: C.text, marginTop: '12px' } }, 'Nenhum ponto salvo ainda'),
            small('Toque em “Adicionar ponto”, escolha a linha, o sentido e o seu ponto.', { margin: '4px 0 14px', fontSize: '13px' })
          ])
        : card(favorites.map(savedItem), { padding: '0 16px' })

    // ---- Preferências: tema, vibração e mapa de BH ----

    // Seletor segmentado Escuro/Claro, com a lua e o sol (a escolhida anima, SMIL no SVG).
    const themePicker = () => {
      const current = readThemeName(storage)
      return View(
        { style: { display: 'flex', flexDirection: 'row', background: C.chipSoft, borderRadius: '12px', padding: '3px' } },
        THEME_OPTIONS.map((opt) => {
          const selected = opt.value === current
          return View(
            {
              style: { flex: 1, padding: '8px 0', borderRadius: '10px', background: selected ? C.primary : 'transparent', transition: SMOOTH, WebkitTapHighlightColor: TAP, cursor: 'pointer' },
              onClick: () => {
                clearSnack()
                if (readThemeName(storage) !== opt.value) writeThemeName(storage, opt.value)
              }
            },
            [
              row(
                [
                  Image({
                    src: themeIcon(opt.value, selected),
                    alt: opt.value === 'light' ? 'Sol' : 'Lua',
                    width: ICON_SIZE * 0.6,
                    height: ICON_SIZE * 0.6,
                    style: { width: `${ICON_SIZE * 0.6}px`, height: `${ICON_SIZE * 0.6}px`, marginRight: '8px', opacity: selected ? 1 : 0.5, transition: SMOOTH }
                  }),
                  Text({ bold: true, style: { fontSize: '14px', color: selected ? C.primaryText : C.text, transition: SMOOTH } }, opt.label)
                ],
                { justifyContent: 'center' }
              )
            ]
          )
        })
      )
    }

    // Mapa sob demanda: o celular guarda os blocos e manda ao relógio só os da vista
    // aberta (app-side/map-sync.js). Fechado: só a contagem; aberto: detalhes,
    // "Limpar mapa do relógio", diagnóstico do envio e atribuição.
    const mapOpen = storage.getItem(MAP_OPEN_KEY) === '1'
    const mapStates = readMapStates(storage)
    const mapDetails = () => {
      const clear = () => {
        clearSnack()
        // Marca na hora (o serviço do celular pode estar parado) e deixa o comando
        // para ele, que avisa o relógio (apaga quando o app abrir no relógio).
        writeMapStates(storage, markDeleting(readMapStates(storage)))
        storage.setItem(MAP_COMMAND_KEY, makeCommand('delete', 'all'))
      }
      const deleting = Object.keys(mapStates).some((t) => mapStates[t].deleting)
      return View({ style: { padding: '0 0 14px' } }, [
        blockText({ style: { fontSize: '13px', lineHeight: '18px', color: C.text } }, storedText(mapStates)),
        small('Abra um ponto no relógio e as ruas em volta chegam do celular em segundos. O relógio guarda os blocos usados mais recentemente.', { marginTop: '6px' }),
        !deleting && storedCount(mapStates) > 0 ? row([link('Limpar mapa do relógio', clear, C.remove, { paddingLeft: 0 })], { marginTop: '4px' }) : null,
        // Diagnóstico do envio (app-side/map-sync.js): para conferir onde o mapa parou.
        View(
          { style: { marginTop: '8px', padding: '8px 12px', borderRadius: '12px', background: C.cardSoft } },
          diagLines(storage.getItem(MAP_DIAG_KEY)).map((line) => small(line, { marginTop: '2px' }))
        ),
        small(`${MAP_ATTRIBUTION} (ODbL).`, { fontSize: '11px', marginTop: '10px' }),
        small(`Linhas, pontos e trajetos: GTFS oficial de BH (SUMOB/PBH), versão ${GTFS_INDEX.feed}.`, { fontSize: '11px', marginTop: '2px' })
      ])
    }

    const prefsCard = card([
      View({ style: { padding: '12px 0 14px' } }, [blockText({ style: { fontSize: '15px', color: C.text, marginBottom: '10px' } }, 'Tema do relógio'), themePicker()]),
      divider(),
      View({ style: { padding: '4px 0 12px' } }, [
        Toggle({ label: 'Vibrar no relógio', value: vibrateOn, onChange: (val) => { clearSnack(); writeVibrate(storage, !!val) } }),
        small(
          vibrateOn
            ? 'Só nos horários de aviso: curta em “já já”, longa em “chegando” e duas curtas quando o ônibus passa.'
            : 'Desligado: o relógio não vibra nem abre sozinho em nenhum ponto.'
        )
      ]),
      divider(),
      row(
        [
          grow([
            blockText({ style: { fontSize: '15px', color: C.text } }, 'Mapa de BH'),
            blockText({ style: { fontSize: '12px', color: C.muted, marginTop: '2px' } }, mapSummary(mapStates))
          ]),
          Text({ style: { flexShrink: 0, fontSize: '22px', lineHeight: '22px', color: C.muted, paddingLeft: '10px', transform: mapOpen ? 'rotate(90deg)' : 'none', transition: 'transform 200ms ease' } }, '›')
        ],
        { padding: '14px 0' },
        () => {
          clearSnack()
          if (storage.getItem(MAP_OPEN_KEY) === '1') storage.removeItem(MAP_OPEN_KEY)
          else storage.setItem(MAP_OPEN_KEY, '1')
        }
      ),
      mapOpen ? mapDetails() : null
    ])

    const footer = small('Dados: GTFS e tempo real da PBH · Mapa © OpenStreetMap', { fontSize: '11px', margin: '22px 4px 0' })
    const page = (children) => View({ style: { padding: '24px 18px 36px', background: C.bg, minHeight: '100vh', transition: SMOOTH } }, children.filter(Boolean))

    // ---- Tela "Novo ponto" ----

    const addScreen = () => {
      const choices = draftChoices(draft, GTFS_INDEX)
      const out = []
      out.push(
        row([Text({ bold: true, style: { fontSize: '15px', color: C.accentText } }, '‹ Voltar')], { padding: '6px 0', alignSelf: 'flex-start' }, () => setAdding(false))
      )
      out.push(blockText({ bold: true, style: { fontSize: '26px', lineHeight: '32px', color: C.title, margin: '8px 0 0' } }, 'Novo ponto'))

      // 1 · LINHA: cartão da linha escolhida com "trocar"; senão o campo e as sugestões.
      out.push(sectionLabel('1 · Linha', { marginTop: '18px' }))
      if (choices.line) {
        out.push(
          card(
            [
              row([
                chip(choices.line.number, false, { marginRight: '10px' }),
                grow([oneLineText({ style: { fontSize: '14px', color: C.text } }, choices.line.name)]),
                link('trocar', () => change('line', ''), C.accentText, { paddingLeft: '10px' })
              ])
            ],
            { padding: '8px 14px', borderRadius: R_BUTTON }
          )
        )
      } else {
        out.push(field(draft.line, 'Número da linha, ex.: 9250', (val) => change('line', val)))
        if (choices.suggestions.length > 0) {
          out.push(
            card(
              [
                small('Qual dessas?', { marginTop: '10px' }),
                ...choices.suggestions.map((l, i) =>
                  View({ style: { display: 'block' } }, [
                    i > 0 ? divider() : null,
                    row([chip(l.number, false, { marginRight: '10px' }), grow([blockText({ style: { fontSize: '14px', color: C.text } }, l.name)])], { padding: '10px 0' }, () => change('line', l.number))
                  ])
                )
              ],
              { marginTop: '10px', padding: '0 14px 4px', borderRadius: R_BUTTON }
            )
          )
        } else if (choices.missing) {
          out.push(small('Uai, não achei essa linha em BH. Confira o número no letreiro do ônibus.', { marginTop: '8px', color: C.dangerText }))
        }
      }

      // 2 · SENTIDO: pílulas lado a lado (destino e, embaixo, quantos pontos).
      if (choices.line) {
        out.push(sectionLabel('2 · Sentido'))
        out.push(
          View(
            { style: { display: 'flex', flexDirection: 'row', gap: '8px' } },
            choices.dirCards.map((d) => {
              const selected = d.dir === choices.dir
              return View(
                {
                  style: { flex: 1, minWidth: 0, padding: '11px 12px', borderRadius: R_FIELD, background: selected ? C.primary : C.card, transition: SMOOTH, WebkitTapHighlightColor: TAP, cursor: 'pointer' },
                  onClick: () => change('dir', String(d.dir))
                },
                [
                  blockText({ bold: true, style: { fontSize: '14px', lineHeight: '19px', color: selected ? C.primaryText : C.text } }, `→ ${towardName(d.title)}`),
                  blockText({ style: { fontSize: '11px', lineHeight: '15px', color: selected ? C.primaryText : C.muted, marginTop: '2px', opacity: selected ? 0.85 : 1 } }, d.detail)
                ]
              )
            })
          )
        )
      }

      // 3 · SEU PONTO: busca e a lista na ordem do trajeto, com o ícone do tipo;
      // no escolhido, "entre X e Y" na linha de baixo.
      if (choices.dir !== null && !draft.manual) {
        out.push(sectionLabel('3 · Seu ponto'))
        const list = filterStops(choices.stops, draft.q)
        const ctx = choices.stop ? stopContext(GTFS_INDEX, choices.line.number, choices.dir, choices.stop.id) : null
        const stopRow = (st) => {
          const selected = !!choices.stop && choices.stop.id === st.id
          const kind = stopKind(st)
          const bg = selected ? C.chosenBg : C.card
          return row(
            [
              View({ style: { width: '28px', display: 'flex', justifyContent: 'center', flexShrink: 0, marginRight: '10px' } }, [kindIcon(kind, bg, selected)]),
              grow([
                st.station
                  ? blockText({ bold: true, style: { fontSize: '14px', lineHeight: '19px', color: selected ? C.chosenText : C.accentText } }, st.station)
                  : blockText({ bold: selected, style: { fontSize: '14px', lineHeight: '19px', color: selected ? C.chosenText : C.text } }, st.street),
                st.station ? blockText({ style: { fontSize: '12px', lineHeight: '16px', color: C.muted } }, st.street) : null,
                selected ? blockText({ style: { fontSize: '12px', lineHeight: '16px', color: C.muted, marginTop: '2px' } }, ctx && ctx.between ? `${st.seq}º ponto · ${ctx.between}` : `${st.seq}º ponto`) : null
              ]),
              selected ? Text({ bold: true, style: { flexShrink: 0, fontSize: '16px', color: C.chosenText, paddingLeft: '8px' } }, '✓') : null
            ],
            { padding: '9px 10px', borderRadius: '12px', background: bg },
            () => change('stopId', st.id)
          )
        }
        out.push(
          card(
            [
              field(draft.q, 'Buscar rua ou estação', (val) => change('q', val), { background: C.chipSoft, border: 'none', color: draft.q ? C.text : C.muted }),
              View(
                { style: { marginTop: '6px', maxHeight: '320px', overflowY: 'auto' } },
                list.length > 0 ? list.map(stopRow) : [small('Nenhum ponto com esse nome nesta linha.', { padding: '10px 6px' })]
              )
            ],
            { padding: '8px', borderRadius: R_BUTTON }
          )
        )
      }

      // Nome (opcional), só depois de escolher o ponto (no avançado é obrigatório).
      if (choices.stop || draft.manual) {
        const auto = choices.stop && choices.stop.station
        const example = auto ? choices.stop.station : choices.stop ? `Ex.: Casa (${choices.stop.street || choices.stop.name})` : 'Ex.: Casa'
        out.push(fieldLabel(draft.manual ? 'Nome do ponto' : 'Como você chama esse ponto? (opcional)', { marginTop: '18px' }))
        // Experimento: multiline (ver field).
        out.push(field(draft.name, example, (val) => change('name', oneLine(val)), null, { multiline: true }))
        out.push(
          View(
            { style: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', marginTop: '8px', gap: '6px' } },
            NAME_SHORTCUTS.map((s) => {
              const on = draft.name === s.value
              return View(
                { style: { padding: '6px 12px', borderRadius: '14px', background: on ? C.primary : C.chipSoft, transition: SMOOTH, WebkitTapHighlightColor: TAP, cursor: 'pointer' }, onClick: () => change('name', s.value) },
                [Text({ style: { fontSize: '13px', color: on ? C.primaryText : C.text } }, s.label)]
              )
            })
          )
        )
      }

      const ready = draft.manual || !!choices.stop
      out.push(
        primaryButton(saveLabel(draft, choices.stop), () => {
          clearSnack()
          const current = readJson(storage, DRAFT_KEY, {})
          const errors = validateDraft(current, GTFS_INDEX)
          if (errors.length > 0) {
            setMessage('error', errors.join('\n'))
            return
          }
          const fav = buildFavorite(current, newFavoriteId(), GTFS_INDEX)
          writeFavorites(storage, [...readFavorites(storage), fav])
          // Mantém a linha para cadastrar outro ponto dela.
          const keep = !current.manual && current.line ? { line: current.line } : {}
          storage.setItem(DRAFT_KEY, JSON.stringify(keep))
          // Volta ao início com o editor do ponto novo aberto (horário de aviso).
          storage.removeItem(SCREEN_KEY)
          storage.setItem(EDITING_KEY, fav.id)
          setMessage('success', `“${fav.name}” salvo · defina quando avisar`)
        }, ready, { marginTop: '22px' })
      )
      out.push(snackbar(true))

      // Avançado: latitude e longitude digitadas (vale também para linhas fora da lista).
      out.push(sectionLabel('Avançado', { marginTop: '30px' }))
      const manual = [Toggle({ label: 'Digitar latitude e longitude', value: !!draft.manual, onChange: (val) => change('manual', val) })]
      if (draft.manual) {
        DRAFT_FIELDS.filter((f) => f.key === 'lat' || f.key === 'lon').forEach((f) => {
          manual.push(fieldLabel(f.label))
          manual.push(field(draft[f.key], f.placeholder, (val) => change(f.key, val)))
        })
        manual.push(small('Dica: no Google Maps, toque e segure no ponto para copiar a latitude e a longitude. No modo avançado o nome é obrigatório e a linha pode ser qualquer código.', { margin: '8px 0 12px' }))
      } else {
        manual.push(small('Para linhas fora da lista ou um ponto que não aparece.', { marginBottom: '12px' }))
      }
      out.push(card(manual, { padding: '4px 16px' }))
      out.push(footer)
      return page(out)
    }

    if (adding) return addScreen()

    // ---- Início ----

    return page([
      blockText({ bold: true, style: { fontSize: '30px', lineHeight: '36px', fontWeight: '800', letterSpacing: '-0.5px', color: C.title } }, 'Cadê o Busão'),
      blockText({ style: { fontSize: '15px', color: C.muted, margin: '4px 0 20px' } }, countLabel(favorites.length)),
      snackbar(false),
      savedCard,
      primaryButton('+  Adicionar ponto', () => setAdding(true), true, { marginTop: '14px' }),
      sectionLabel('Preferências', { marginTop: '30px' }),
      prefsCard,
      footer
    ])
  }
})
