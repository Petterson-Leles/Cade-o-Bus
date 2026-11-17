// Tela de diagnóstico (temporária): não importa nada do app, só a interface do relógio.
// Se ela aparecer, o relógio roda o app; o botão abre a tela inicial normal.
import * as hmUI from '@zos/ui'
import { push } from '@zos/router'

Page({
  build() {
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: 0x141a21 })
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60, y: 110, w: 360, h: 120,
      text: 'Diagnóstico\nCadê o Busão', text_size: 32, color: 0xf3e3c3,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.WRAP
    })
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 90, y: 260, w: 300, h: 80, radius: 40, text: 'Abrir o app', text_size: 28,
      color: 0xffffff, normal_color: 0x2e7d78, press_color: 0x24645f,
      click_func: () => push({ url: 'page/home/index.page' })
    })
  }
})
