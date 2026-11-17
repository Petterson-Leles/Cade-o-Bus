// Tela inicial do relógio: saudação, título e um cartão por ponto salvo com o
// tempo do próximo ônibus (resumo de todos os pontos num pedido só ao celular,
// atualizado a cada 30 s).
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme, DEFAULT_THEME, GRADIENT, CHIP_BG, CHIP_TEXT, etaColor, busIcon } from '../../utils/ui'
import { parseSettingsResult } from '../../utils/favorites'
import { etaFromSummary } from '../../shared/summary'
import { greeting } from '../../shared/text'

const REFRESH_MS = 30 * 1000
// Tela redonda: margens maiores no topo e nas laterais.
const MARGIN = px(60)
const CONTENT_W = DEVICE_WIDTH - 2 * MARGIN
// Cartões (pixels de design): o do meio é mais largo, onde a tela redonda é mais larga.
const LIST_TOP = 142
const CARD_H = 82
const CARD_STEP = 94
const CARD_R = 22
const cardX = (i) => (i === 1 ? 54 : 72)
// Barrinha sob o título: segmentos com cores do gradiente "Pôr do sol".
const BAR_COLORS = [GRADIENT[1], GRADIENT[3], GRADIENT[4], GRADIENT[5]]
const BAR_SEG_W = 16
const BAR_GAP = 2
// Espaço no fim para o último cartão poder rolar até o meio da tela redonda.
const LIST_BOTTOM_PAD = 120
// Toque que arrastou mais que isso foi rolagem, não toque.
const TAP_SLOP = 24

Page(
  BasePage({
    onInit() {
      // Estado próprio de cada abertura da página (não reaproveita o objeto do módulo).
      // Mantém o que a zml já colocou em this.state (ex.: messaging).
      // view: 'loading' | 'offline' | 'list' (favorites só vale em 'list').
      this.state = {
        ...this.state,
        widgets: [],
        cards: [], // { fav, eta, etaMin } por favorito (widgets do tempo)
        theme: DEFAULT_THEME,
        view: 'loading',
        favorites: [],
        summary: null, // última resposta de GET_SUMMARY
        timer: null,
        loading: false,
        dirty: false, // favoritos mudaram durante uma consulta: consulta de novo ao terminar
        openedAt: 0,
        destroyed: false
      }
    },

    build() {
      this.loadFavorites()
    },

    colors() {
      return getTheme(this.state.theme)
    },

    loadFavorites() {
      if (this.state.destroyed) return
      this.setView('loading')
      this.request({ method: 'GET_FAVORITES' })
        .then(({ result } = {}) => this.applySettings(result))
        .catch(() => this.setView('offline'))
    },

    // Chamado quando você muda os favoritos ou o tema no celular.
    onCall(data) {
      if (!data) return
      if (data.method === 'SETTINGS_CHANGED' || data.method === 'FAVORITES_CHANGED') {
        this.applySettings(data.result)
      }
    },

    applySettings(result) {
      const { favorites, theme } = parseSettingsResult(result, this.state.theme)
      this.state.theme = theme
      this.setView('list', favorites)
      this.refreshSummary(true)
    },

    setView(view, favorites) {
      if (this.state.destroyed) return
      this.state.view = view
      this.state.favorites = favorites || []
      this.draw()
    },

    // ---- Resumo (próximo ônibus de cada ponto) ----

    // Uma consulta por vez; a próxima é agendada 30 s depois que esta termina.
    refreshSummary(now) {
      const s = this.state
      if (s.destroyed) return
      if (s.loading) {
        if (now) s.dirty = true
        return
      }
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      if (s.view !== 'list' || s.favorites.length === 0) return
      s.loading = true
      const done = () => {
        s.loading = false
        if (s.destroyed) return
        const again = s.dirty
        s.dirty = false
        s.timer = setTimeout(() => this.refreshSummary(false), again ? 0 : REFRESH_MS)
      }
      this.request({ method: 'GET_SUMMARY' })
        .then((data) => {
          const { result, error } = data || {}
          this.applySummary(error ? null : result)
        })
        .catch(() => this.applySummary(null))
        .then(done, done)
    },

    applySummary(result) {
      if (this.state.destroyed) return
      this.state.summary = result
      this.state.cards.forEach((card, i) => this.paintEta(card, etaFromSummary(result, card.fav, i)))
    },

    // Tempo à direita do cartão: minutos na cor da faixa ou "—".
    paintEta(card, min) {
      const c = this.colors()
      if (min === null) {
        card.eta.setProperty(hmUI.prop.MORE, { text: '—', color: c.muted })
        card.etaMin.setProperty(hmUI.prop.TEXT, '')
        return
      }
      const color = etaColor(min, this.state.theme)
      card.eta.setProperty(hmUI.prop.MORE, { text: String(min), color, text_size: px(min >= 100 ? 26 : 34) })
      card.etaMin.setProperty(hmUI.prop.MORE, { text: 'min', color })
    },

    // ---- Desenho ----

    clear() {
      this.state.widgets.forEach((w) => hmUI.deleteWidget(w))
      this.state.widgets = []
      this.state.cards = []
    },

    add(type, opts) {
      const w = hmUI.createWidget(type, opts)
      this.state.widgets.push(w)
      return w
    },

    text(opts) {
      return this.add(hmUI.widget.TEXT, {
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS,
        ...opts
      })
    },

    // Refaz a tela inteira: fundo, cabeçalho e conteúdo. Assim uma troca de tema
    // com a página aberta repinta tudo sem sobrar widget com a cor antiga.
    draw() {
      const c = this.colors()
      const { view, favorites } = this.state
      this.clear()

      // Fundo do tema: primeiro widget, cobre a tela e a área rolável da lista.
      const listBottom = px(LIST_TOP + favorites.length * CARD_STEP + LIST_BOTTOM_PAD)
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: DEVICE_WIDTH,
        h: view === 'list' ? Math.max(DEVICE_HEIGHT, listBottom) : DEVICE_HEIGHT,
        color: c.bg
      })

      this.text({ x: px(100), y: px(46), w: DEVICE_WIDTH - 2 * px(100), h: px(30), text: greeting(new Date().getHours()), text_size: px(22), color: c.muted })
      this.text({ x: px(70), y: px(74), w: DEVICE_WIDTH - 2 * px(70), h: px(44), text: 'Cadê o Busão', text_size: px(34), color: c.title })
      // Barrinha em segmentos do gradiente (verde-azulado até o coral) sob o título.
      const barW = BAR_COLORS.length * BAR_SEG_W + (BAR_COLORS.length - 1) * BAR_GAP
      const barX = (480 - barW) / 2
      BAR_COLORS.forEach((color, i) => {
        this.add(hmUI.widget.FILL_RECT, { x: px(barX + i * (BAR_SEG_W + BAR_GAP)), y: px(120), w: px(BAR_SEG_W), h: px(4), radius: px(2), color })
      })

      if (view === 'loading') {
        this.drawMessage('Carregando pontos...', null, c.muted)
      } else if (view === 'offline') {
        this.drawOffline()
      } else if (favorites.length === 0) {
        this.drawEmpty()
      } else {
        this.drawList(favorites)
      }
    },

    // Estado sem lista: carregando ou sem conexão.
    drawMessage(title, detail, titleColor) {
      const c = this.colors()
      this.text({ x: MARGIN, y: px(150), w: CONTENT_W, h: px(56), text: title, text_size: px(34), color: titleColor })
      if (detail) {
        this.text({
          x: MARGIN,
          y: px(212),
          w: CONTENT_W,
          h: px(110),
          text: detail,
          text_size: px(26),
          color: c.muted,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP
        })
      }
    },

    drawEmpty() {
      const c = this.colors()
      this.add(hmUI.widget.IMG, { x: px(216), y: px(176), w: px(48), h: px(48), auto_scale: true, src: busIcon(4, this.state.theme) })
      this.text({ x: MARGIN, y: px(246), w: CONTENT_W, h: px(40), text: 'Bão? Cadastre seu', text_size: px(30), color: c.text })
      this.text({ x: MARGIN, y: px(288), w: CONTENT_W, h: px(34), text: 'primeiro ponto no celular.', text_size: px(24), color: c.muted })
    },

    drawOffline() {
      const c = this.colors()
      this.drawMessage('Sem conexão', 'Abra o app Zepp no celular e deixe o Bluetooth ligado.', c.error)
      this.add(hmUI.widget.BUTTON, {
        x: px(110),
        y: px(336),
        w: DEVICE_WIDTH - 2 * px(110),
        h: px(88),
        radius: px(44),
        text: 'Tentar de novo',
        text_size: px(28),
        color: c.buttonText,
        normal_color: c.button,
        press_color: c.buttonPressed,
        click_func: () => this.loadFavorites()
      })
    },

    open(fav) {
      // Evita abrir duas vezes (botão e texto por cima podem responder ao mesmo toque).
      const now = Date.now()
      if (now - this.state.openedAt < 800) return
      this.state.openedAt = now
      push({ url: 'page/detail/index.page', params: JSON.stringify({ fav, theme: this.state.theme }) })
    },

    // Os textos ficam por cima do botão do cartão; se eles segurarem o toque,
    // abrem o ponto também (ignorando arrastos, que são rolagem da lista).
    tappable(widget, fav) {
      let down = null
      widget.addEventListener(hmUI.event.CLICK_DOWN, (info) => {
        down = info ? { x: info.x, y: info.y } : null
      })
      widget.addEventListener(hmUI.event.CLICK_UP, (info) => {
        const moved = down && info ? Math.hypot(info.x - down.x, info.y - down.y) : 0
        down = null
        if (moved <= px(TAP_SLOP)) this.open(fav)
      })
    },

    drawList(favorites) {
      const c = this.colors()
      favorites.forEach((fav, i) => {
        const x = cardX(i)
        const y = LIST_TOP + i * CARD_STEP
        const w = 480 - 2 * x
        // Fundo do cartão: botão arredondado (muda de cor ao tocar).
        this.add(hmUI.widget.BUTTON, {
          x: px(x),
          y: px(y),
          w: px(w),
          h: px(CARD_H),
          radius: px(CARD_R),
          text: '',
          normal_color: c.card,
          press_color: c.cardPressed,
          click_func: () => this.open(fav)
        })
        const overlay = []
        overlay.push(this.add(hmUI.widget.STROKE_RECT, { x: px(x), y: px(y), w: px(w), h: px(CARD_H), radius: px(CARD_R), line_width: px(2), color: c.cardEdge }))
        // Selo da linha (pílula verde-azulada, texto branco).
        overlay.push(this.add(hmUI.widget.FILL_RECT, { x: px(x + 14), y: px(y + 21), w: px(68), h: px(40), radius: px(20), color: CHIP_BG }))
        overlay.push(this.text({ x: px(x + 16), y: px(y + 21), w: px(64), h: px(40), text: fav.line, text_size: px(fav.line.length > 4 ? 18 : 22), color: CHIP_TEXT }))
        // Nome (sem negrito: o TEXT do Zepp OS não tem peso de fonte) e rua do ponto.
        const textW = w - 96 - 78
        overlay.push(this.text({ x: px(x + 94), y: px(y + 10), w: px(textW), h: px(36), text: fav.name, text_size: px(27), color: c.text, align_h: hmUI.align.LEFT }))
        overlay.push(
          this.text({
            x: px(x + 94),
            y: px(y + 46),
            w: px(textW),
            h: px(26),
            text: fav.street || (fav.stopId ? '' : 'ponto por coordenadas'),
            text_size: px(19),
            color: c.muted,
            align_h: hmUI.align.LEFT
          })
        )
        // Tempo do próximo ônibus, à direita.
        const eta = this.text({ x: px(x + w - 80), y: px(y + 8), w: px(70), h: px(42), text: '—', text_size: px(34), color: c.muted })
        const etaMin = this.text({ x: px(x + w - 80), y: px(y + 48), w: px(70), h: px(22), text: '', text_size: px(17), color: c.muted })
        overlay.push(eta, etaMin)
        overlay.forEach((wd) => this.tappable(wd, fav))
        const card = { fav, eta, etaMin }
        this.state.cards.push(card)
        this.paintEta(card, etaFromSummary(this.state.summary, fav, i))
      })
      // A página rola sozinha quando os cartões passam da altura da tela
      // (SCROLL_MODE_FREE é o padrão do Zepp OS); o fundo já vai até o fim da lista.
    },

    onDestroy() {
      this.state.destroyed = true
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
    }
  })
)
