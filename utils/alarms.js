// Horário de aviso no relógio: hora local e alarmes do sistema (@zos/alarm).
// A lógica (janela, próximo início, quais alarmes) fica em shared/schedule.js.
// - Alarme (API 3.0+, permissão device:os.alarm):
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/set/
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/cancel/
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/getAllAlarms/
//   set({ url, time (UTC s), param, store, repeat_type }) devolve o id (0 = falhou);
//   o param chega ao onCreate do app.js (e, no exemplo oficial, ao onInit da página).
// - Hora local: sensor Time (@zos/sensor), getDay() 1 = segunda.
import { Time } from '@zos/sensor'
import { set, cancel, getAllAlarms, REPEAT_ONCE } from '@zos/alarm'
import { offsetFromParts, alarmPlan, vibrationAllowed } from '../shared/schedule'

// Página que o alarme abre: a tela inicial, que repassa para a tela do ponto
// (assim a pilha fica Início -> Ponto e o "voltar" funciona).
export const ALARM_URL = 'page/home/index.page'
export const ALARM_PARAM_TAG = 'cadeAlarm'

let timeSensor = null

// { utcMs, offsetMin } pelo relógio (fuso configurado no relógio).
export function watchNow() {
  try {
    if (!timeSensor) timeSensor = new Time()
    const utcMs = timeSensor.getTime()
    const parts = {
      year: timeSensor.getFullYear(),
      month: timeSensor.getMonth(),
      date: timeSensor.getDate(),
      hours: timeSensor.getHours(),
      minutes: timeSensor.getMinutes(),
      seconds: timeSensor.getSeconds()
    }
    return { utcMs, offsetMin: offsetFromParts(parts, utcMs) }
  } catch (e) {
    const now = Date.now()
    return { utcMs: now, offsetMin: -new Date(now).getTimezoneOffset() }
  }
}

// Texto do param do alarme -> { favId } ou null.
export function parseAlarmParam(param) {
  try {
    const data = typeof param === 'string' ? JSON.parse(param) : param
    if (data && typeof data === 'object' && data[ALARM_PARAM_TAG] && typeof data.favId === 'string') return { favId: data.favId }
  } catch (e) {
    // não é do alarme
  }
  return null
}

// Cancela os alarmes do app e agenda o próximo início de janela de cada ponto.
// Devolve quantos ficaram agendados (ou -1 se a API não estiver disponível).
export function scheduleAlarms(favorites, vibrateOn) {
  try {
    const old = getAllAlarms() || []
    old.forEach((id) => {
      try {
        cancel(id)
      } catch (e) {
        // segue
      }
    })
    const { utcMs, offsetMin } = watchNow()
    let count = 0
    alarmPlan(favorites, utcMs, offsetMin, vibrateOn !== false).forEach((item) => {
      if (!item.id) return
      const id = set({
        url: ALARM_URL,
        time: item.time,
        param: JSON.stringify({ [ALARM_PARAM_TAG]: 1, favId: item.id }),
        store: true,
        repeat_type: REPEAT_ONCE
      })
      if (id) count++
    })
    return count
  } catch (e) {
    console.log('Alarme indisponível', e && e.message ? e.message : e)
    return -1
  }
}

// Vibração liberada agora para o ponto (interruptor geral + janela do ponto).
export function alertsOnNow(fav, vibrateOn) {
  const { utcMs, offsetMin } = watchNow()
  return vibrationAllowed(vibrateOn, fav && fav.alert, utcMs, offsetMin)
}
