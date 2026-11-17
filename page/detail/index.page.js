// Tela de um ponto: mostra os ônibus da linha mais próximos e atualiza a cada 30 s.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import { formatDistance } from '../../shared/bhtrans'
import { DEVICE_WIDTH, COLOR_PRIMARY, COLOR_TEXT, COLOR_MUTED } from '../../utils/ui'

const REFRESH_MS = 30 * 1000
const MARGIN = px(50)

Page(
  BasePage({
    state: { fav: null, timer: null, title: null, body: null, footer: null },

    onInit(params) {
      try {
        this.state.fav = JSON.parse(params)
      } catch (e) {
        this.state.fav = null
      }
    },

    build() {
      const fav = this.state.fav || { name: '?', line: '?' }
      this.state.title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(50),
        w: DEVICE_WIDTH - 2 * MARGIN,
        h: px(90),
        text: `Linha ${fav.line}\n${fav.name}`,
        text_size: px(30),
        color: COLOR_PRIMARY,
        align_h: hmUI.align.CENTER_H,
        text_style: hmUI.text_style.WRAP
      })
      this.state.body = hmUI.createWidget(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(150),
        w: DEVICE_WIDTH - 2 * MARGIN,
        h: px(220),
        text: 'Procurando ônibus...',
        text_size: px(32),
        color: COLOR_TEXT,
        align_h: hmUI.align.CENTER_H,
        text_style: hmUI.text_style.WRAP
      })
      this.state.footer = hmUI.createWidget(hmUI.widget.TEXT, {
        x: MARGIN,
        y: px(380),
        w: DEVICE_WIDTH - 2 * MARGIN,
        h: px(50),
        text: '',
        text_size: px(22),
        color: COLOR_MUTED,
        align_h: hmUI.align.CENTER_H
      })
      if (this.state.fav) {
        this.refresh()
        this.state.timer = setInterval(() => this.refresh(), REFRESH_MS)
      }
    },

    refresh() {
      const { line, lat, lon } = this.state.fav
      this.request({ method: 'GET_BUSES', params: { line, lat, lon } })
        .then(({ result, error }) => this.show(result, error))
        .catch(() => this.show(null, 'Sem conexão com o celular'))
    },

    show(buses, error) {
      let text
      if (error) text = error
      else if (!buses || buses.length === 0) text = 'Nenhum ônibus dessa linha em circulação agora'
      else
        text = buses
          .map((b) => `${b.etaMin} min · ${formatDistance(b.distanceM)}`)
          .join('\n')
      this.state.body.setProperty(hmUI.prop.TEXT, text)
      const d = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      this.state.footer.setProperty(hmUI.prop.TEXT, `Atualizado ${hh}:${mm} · estimativa`)
    },

    onDestroy() {
      if (this.state.timer) clearInterval(this.state.timer)
    }
  })
)
