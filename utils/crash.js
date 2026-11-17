// Mostra na tela qualquer erro que derrube uma página, em vez de deixar a tela preta.
// Serve para diagnosticar no relógio de verdade, onde não há console à vista.
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'

export function showCrash(where, err) {
  try {
    const { width, height } = getDeviceInfo()
    const msg = err && (err.stack || err.message) ? String(err.message || err) : String(err)
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: width, h: height, color: 0x000000 })
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: Math.round(width * 0.12),
      y: Math.round(height * 0.18),
      w: Math.round(width * 0.76),
      h: Math.round(height * 0.64),
      text: `Erro em ${where}:\n${msg}`.slice(0, 400),
      text_size: 22,
      color: 0xff6b5c,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.WRAP
    })
    console.log(`[Cadê o Busão] erro em ${where}:`, msg)
  } catch (e) {
    // sem mais o que fazer
  }
}

// Envolve um método da página: se ele lançar erro, mostra o erro na tela.
export function guard(where, fn) {
  return function (...args) {
    try {
      return fn.apply(this, args)
    } catch (e) {
      showCrash(where, e)
    }
  }
}
