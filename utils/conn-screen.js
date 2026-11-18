// Tela de erro de conexão do relógio (tela inicial e tela do ponto): imagem 160×160
// (assets/common.r/offline|internet/<tema>.png), título, texto e "Tentar de novo".
// Os textos e a imagem de cada caso vêm de shared/conn-errors.js (errorScreen).
// Bluetooth: connectStatus de @zos/ble (true = conectado), API 2.0+:
// https://docs.zepp.com/docs/reference/device-app-api/newAPI/ble/connectStatus/
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { connectStatus } from '@zos/ble'
import { DEVICE_WIDTH } from './ui'
import { errorScreen, errorImage, bleConnected } from '../shared/conn-errors'
import { guard } from './crash'

// Enquanto em "sem conexão": confere o Bluetooth a cada tanto.
export const BLE_POLL_MS = 3000
// Celular sem internet / BHTrans fora do ar: tenta de novo depois disso.
export const ERROR_RETRY_MS = 30 * 1000

export function isBleConnected() {
  return bleConnected(() => connectStatus())
}

// Cria os widgets com create(type, opts) (que também os registra na página) e devolve
// a lista. onRetry: botão "Tentar de novo".
export function drawErrorScreen(create, { code, theme, colors, onRetry }) {
  const screen = errorScreen(code)
  if (!screen) return []
  const c = colors
  const out = []
  out.push(create(hmUI.widget.IMG, { x: px(160), y: px(84), w: px(160), h: px(160), auto_scale: true, src: errorImage(code, theme) }))
  out.push(
    create(hmUI.widget.TEXT, {
      x: px(50),
      y: px(250),
      w: DEVICE_WIDTH - 2 * px(50),
      h: px(44),
      text: screen.title,
      text_size: px(30),
      color: c.text,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.ELLIPSIS
    })
  )
  out.push(
    create(hmUI.widget.TEXT, {
      x: px(72),
      y: px(294),
      w: DEVICE_WIDTH - 2 * px(72),
      h: px(62),
      text: screen.text,
      text_size: px(20),
      color: c.muted,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.TOP,
      text_style: hmUI.text_style.WRAP
    })
  )
  out.push(
    create(hmUI.widget.BUTTON, {
      x: px(140),
      y: px(362),
      w: px(200),
      h: px(60),
      radius: px(30),
      text: 'Tentar de novo',
      text_size: px(24),
      color: c.buttonText,
      normal_color: c.button,
      press_color: c.buttonPressed,
      click_func: guard('tentar de novo', () => onRetry && onRetry())
    })
  )
  return out
}

// Espera a volta do celular: um timer que confere o Bluetooth (ou, para erros do
// celular, só espera ERROR_RETRY_MS) e chama onBack uma vez. Devolve o timer (para
// clearInterval/clearTimeout via stopRetry).
export function startRetry(code, onBack) {
  const screen = errorScreen(code)
  if (screen && screen.retry === 'ble') {
    const t = setInterval(
      guard('conexão', () => {
        if (isBleConnected()) {
          clearInterval(t)
          onBack()
        }
      }),
      BLE_POLL_MS
    )
    return { kind: 'interval', t }
  }
  return { kind: 'timeout', t: setTimeout(guard('nova tentativa', () => onBack()), ERROR_RETRY_MS) }
}

export function stopRetry(r) {
  if (!r) return
  if (r.kind === 'interval') clearInterval(r.t)
  else clearTimeout(r.t)
}
