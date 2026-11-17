// Tela inicial do relógio: lista os pontos favoritos.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import {
  DEVICE_WIDTH,
  COLOR_PRIMARY,
  COLOR_PRIMARY_PRESSED,
  COLOR_TEXT,
  COLOR_MUTED,
  COLOR_SURFACE,
  COLOR_SURFACE_PRESSED,
  COLOR_ERROR,
  COLOR_BG
} from '../../utils/ui'

// Tela redonda: margens maiores no topo e nas laterais.
const MARGIN = px(60)
const CONTENT_W = DEVICE_WIDTH - 2 * MARGIN
const LIST_TOP = px(150)
const ROW_H = px(96) // toque grande (>= 80 px)
const ROW_GAP = px(16)

Page(
  BasePage({
    state: { widgets: [] },

    build() {
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: px(80),
        y: px(44),
        w: DEVICE_WIDTH - 2 * px(80),
        h: px(56),
        text: 'Cadê o Busão',
        text_size: px(40),
        color: COLOR_PRIMARY,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V
      })
      this.loadFavorites()
    },

    loadFavorites() {
      this.renderMessage('Carregando pontos...', null, COLOR_MUTED)
      this.request({ method: 'GET_FAVORITES' })
        .then(({ result = [] }) => this.render(result))
        .catch(() => this.render(null))
    },

    // Chamado quando você muda os favoritos no celular.
    onCall({ result }) {
      this.render(result || [])
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

    // Estado sem lista: carregando, vazio ou sem conexão.
    renderMessage(title, detail, titleColor) {
      this.clear()
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
          color: COLOR_MUTED,
          align_h: hmUI.align.CENTER_H,
          text_style: hmUI.text_style.WRAP
        })
      }
    },

    render(favorites) {
      if (!favorites) {
        this.renderMessage('Sem conexão', 'Abra o app Zepp no celular e deixe o Bluetooth ligado.', COLOR_ERROR)
        this.add(hmUI.widget.BUTTON, {
          x: px(110),
          y: px(336),
          w: DEVICE_WIDTH - 2 * px(110),
          h: px(88),
          radius: px(44),
          text: 'Tentar de novo',
          text_size: px(28),
          color: COLOR_BG,
          normal_color: COLOR_PRIMARY,
          press_color: COLOR_PRIMARY_PRESSED,
          click_func: () => this.loadFavorites()
        })
        return
      }
      if (favorites.length === 0) {
        this.renderMessage(
          'Nenhum ponto salvo',
          'No celular: app Zepp > Cadê o Busão > Configurações.',
          COLOR_TEXT
        )
        return
      }

      this.clear()
      this.add(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(104),
        w: CONTENT_W,
        h: px(36),
        text: 'Escolha o ponto',
        text_size: px(24),
        color: COLOR_MUTED,
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V
      })
      favorites.forEach((fav, i) => {
        this.add(hmUI.widget.BUTTON, {
          x: MARGIN,
          y: LIST_TOP + i * (ROW_H + ROW_GAP),
          w: CONTENT_W,
          h: ROW_H,
          radius: ROW_H / 2,
          text: `${fav.name} · ${fav.line}`,
          text_size: px(30),
          color: COLOR_TEXT,
          normal_color: COLOR_SURFACE,
          press_color: COLOR_SURFACE_PRESSED,
          click_func: () => push({ url: 'page/detail/index.page', params: JSON.stringify(fav) })
        })
      })
      // Espaço no fim para o último botão poder rolar até o meio da tela redonda.
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: LIST_TOP + favorites.length * (ROW_H + ROW_GAP),
        w: DEVICE_WIDTH,
        h: px(120),
        color: COLOR_BG
      })
    }
  })
)
