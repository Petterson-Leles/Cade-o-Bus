// Tela inicial do relógio: lista os pontos favoritos.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme, DEFAULT_THEME } from '../../utils/ui'
import { parseSettingsResult } from '../../utils/favorites'

// Tela redonda: margens maiores no topo e nas laterais.
const MARGIN = px(60)
const CONTENT_W = DEVICE_WIDTH - 2 * MARGIN
const LIST_TOP = px(150)
const ROW_H = px(96) // toque grande (>= 80 px)
const ROW_GAP = px(16)
// Espaço no fim para o último botão poder rolar até o meio da tela redonda.
const LIST_BOTTOM_PAD = px(120)

Page(
  BasePage({
    onInit() {
      // Estado próprio de cada abertura da página (não reaproveita o objeto do módulo).
      // Mantém o que a zml já colocou em this.state (ex.: messaging).
      // view: 'loading' | 'offline' | 'list' (favorites só vale em 'list').
      this.state = {
        ...this.state,
        widgets: [],
        theme: DEFAULT_THEME,
        view: 'loading',
        favorites: [],
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
    },

    setView(view, favorites) {
      if (this.state.destroyed) return
      this.state.view = view
      this.state.favorites = favorites || []
      this.draw()
    },

    clear() {
      this.state.widgets.forEach((w) => hmUI.deleteWidget(w))
      this.state.widgets = []
    },

    add(type, opts) {
      const w = hmUI.createWidget(type, opts)
      this.state.widgets.push(w)
      return w
    },

    // Refaz a tela inteira: fundo, cabeçalho e conteúdo. Assim uma troca de tema
    // com a página aberta repinta tudo sem sobrar widget com a cor antiga.
    draw() {
      const c = this.colors()
      const { view, favorites } = this.state
      this.clear()

      // Fundo do tema: primeiro widget, cobre a tela e a área rolável da lista.
      const listBottom = LIST_TOP + favorites.length * (ROW_H + ROW_GAP) + LIST_BOTTOM_PAD
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: DEVICE_WIDTH,
        h: view === 'list' ? Math.max(DEVICE_HEIGHT, listBottom) : DEVICE_HEIGHT,
        color: c.bg
      })

      this.add(hmUI.widget.TEXT, {
        x: px(80),
        y: px(44),
        w: DEVICE_WIDTH - 2 * px(80),
        h: px(56),
        text: 'Cadê o Busão',
        text_size: px(40),
        color: c.title,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V
      })
      // Filete cor de terra sob o título.
      this.add(hmUI.widget.FILL_RECT, {
        x: (DEVICE_WIDTH - px(64)) / 2,
        y: px(102),
        w: px(64),
        h: px(3),
        radius: px(1),
        color: c.divider
      })

      if (view === 'loading') {
        this.drawMessage('Carregando pontos...', null, c.muted)
      } else if (view === 'offline') {
        this.drawOffline()
      } else if (favorites.length === 0) {
        this.drawMessage(
          'Nenhum ponto salvo',
          'Uai, cadastre no celular: app Zepp > Cadê o Busão > Configurações.',
          c.text
        )
      } else {
        this.drawList(favorites)
      }
    },

    // Estado sem lista: carregando, vazio ou sem conexão.
    drawMessage(title, detail, titleColor) {
      const c = this.colors()
      this.add(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(150),
        w: CONTENT_W,
        h: px(56),
        text: title,
        text_size: px(34),
        color: titleColor,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS
      })
      if (detail) {
        this.add(hmUI.widget.TEXT, {
          x: MARGIN,
          y: px(212),
          w: CONTENT_W,
          h: px(110),
          text: detail,
          text_size: px(26),
          color: c.muted,
          align_h: hmUI.align.CENTER_H,
          text_style: hmUI.text_style.WRAP
        })
      }
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

    drawList(favorites) {
      const c = this.colors()
      this.add(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(108),
        w: CONTENT_W,
        h: px(34),
        text: 'Bão? Escolha o ponto',
        text_size: px(24),
        color: c.muted,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V
      })
      const theme = this.state.theme
      favorites.forEach((fav, i) => {
        this.add(hmUI.widget.BUTTON, {
          x: MARGIN,
          y: LIST_TOP + i * (ROW_H + ROW_GAP),
          w: CONTENT_W,
          h: ROW_H,
          radius: ROW_H / 2,
          text: `${fav.name} · ${fav.line}`,
          text_size: px(30),
          color: c.buttonText,
          normal_color: c.button,
          press_color: c.buttonPressed,
          // O detalhe recebe o ponto e o tema atual.
          click_func: () => push({ url: 'page/detail/index.page', params: JSON.stringify({ fav, theme }) })
        })
      })
      // A página rola sozinha quando os botões passam da altura da tela
      // (SCROLL_MODE_FREE é o padrão do Zepp OS); o fundo já vai até o fim da lista.
    },

    onDestroy() {
      this.state.destroyed = true
    }
  })
)
