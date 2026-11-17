// Tela inicial do relógio: lista os pontos favoritos.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, COLOR_PRIMARY, COLOR_PRIMARY_PRESSED, COLOR_TEXT, COLOR_MUTED } from '../../utils/ui'

const MARGIN = px(60)
const ROW_H = px(88)

Page(
  BasePage({
    state: { widgets: [] },

    build() {
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: 0,
        y: px(40),
        w: DEVICE_WIDTH,
        h: px(60),
        text: 'Cadê o Busão',
        text_size: px(40),
        color: COLOR_PRIMARY,
        align_h: hmUI.align.CENTER_H
      })
      this.loadFavorites()
    },

    loadFavorites() {
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

    render(favorites) {
      this.clear()
      if (!favorites || favorites.length === 0) {
        const msg = favorites
          ? 'Nenhum ponto salvo.\nCadastre no app Zepp:\nCadê o Busão > Configurações'
          : 'Sem conexão com o celular'
        this.state.widgets.push(
          hmUI.createWidget(hmUI.widget.TEXT, {
            x: MARGIN,
            y: px(140),
            w: DEVICE_WIDTH - 2 * MARGIN,
            h: px(240),
            text: msg,
            text_size: px(30),
            color: COLOR_MUTED,
            align_h: hmUI.align.CENTER_H,
            text_style: hmUI.text_style.WRAP
          })
        )
        return
      }
      favorites.forEach((fav, i) => {
        this.state.widgets.push(
          hmUI.createWidget(hmUI.widget.BUTTON, {
            x: MARGIN,
            y: px(120) + i * (ROW_H + px(14)),
            w: DEVICE_WIDTH - 2 * MARGIN,
            h: ROW_H,
            radius: px(44),
            text: `${fav.name} · ${fav.line}`,
            text_size: px(30),
            color: COLOR_TEXT,
            normal_color: 0x333333,
            press_color: COLOR_PRIMARY_PRESSED,
            click_func: () => push({ url: 'page/detail/index.page', params: JSON.stringify(fav) })
          })
        )
      })
    }
  })
)
