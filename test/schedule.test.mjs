import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHHMM,
  formatHHMM,
  normalizeAlert,
  alertActive,
  localParts,
  offsetFromParts,
  isInWindow,
  nextWindowStart,
  alarmPlan,
  timeOptions,
  daysLabel,
  alertSummary,
  autoOpenLine,
  applyAlertChange,
  vibrationAllowed,
  latestAlert,
  MAX_ALARMS,
  DEFAULT_ALERT
} from '../shared/schedule.js'

const BH = -180 // UTC-3
// Instante UTC para uma hora local de BH: 2026-11-16 é segunda-feira.
const bh = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - BH * 60000
const MON = (h, mi = 0) => bh(2026, 11, 16, h, mi)
const weekday = { on: true, days: [1, 2, 3, 4, 5], from: 6 * 60, to: 9 * 60 }

test('parseHHMM e formatHHMM', () => {
  assert.equal(parseHHMM('06:00'), 360)
  assert.equal(parseHHMM('7:30'), 450)
  assert.equal(parseHHMM('0730'), 450)
  assert.equal(parseHHMM('7h30'), 450)
  assert.equal(parseHHMM('7h'), 420)
  assert.equal(parseHHMM('23:59'), 1439)
  assert.equal(parseHHMM(90), 90)
  for (const bad of ['24:00', '12:60', 'abc', '', null, undefined, 1440, -1, 1.5]) assert.equal(parseHHMM(bad), null, String(bad))
  assert.equal(formatHHMM(0), '00:00')
  assert.equal(formatHHMM(545), '09:05')
  assert.equal(formatHHMM(1440 + 60), '01:00')
})

test('normalizeAlert: padrão desligado (Seg–Sex 06:00–09:00) e limpeza', () => {
  assert.deepEqual(normalizeAlert(undefined), { on: false, days: [1, 2, 3, 4, 5], from: 360, to: 540 })
  assert.deepEqual(normalizeAlert({ on: 'sim', days: [7, 7, 0, 3], from: '22:00', to: '01:00' }), { on: false, days: [3, 7], from: 1320, to: 60 })
  assert.equal(alertActive(undefined), false)
  assert.equal(alertActive({ ...weekday, days: [] }), false)
  assert.equal(alertActive(weekday), true)
  assert.equal(DEFAULT_ALERT.on, false)
})

test('localParts e offsetFromParts usam o fuso do relógio', () => {
  const t = MON(7, 15)
  assert.deepEqual(localParts(t, BH), { day: 1, minutes: 435, dayStartMs: MON(0, 0) })
  // A mesma hora UTC em outro fuso cai noutro dia: 01:00 UTC de terça = 22:00 de segunda em BH.
  const tueUtc = Date.UTC(2026, 10, 17, 1, 0)
  assert.equal(localParts(tueUtc, 0).day, 2)
  assert.equal(localParts(tueUtc, BH).day, 1)
  assert.equal(localParts(tueUtc, BH).minutes, 22 * 60)
  // Relógio mostra 07:15 de 16/11 com UTC 10:15:20 -> -180.
  assert.equal(offsetFromParts({ year: 2026, month: 11, date: 16, hours: 7, minutes: 15, seconds: 0 }, Date.UTC(2026, 10, 16, 10, 15, 20)), -180)
  assert.equal(offsetFromParts({ year: 2026, month: 11, date: 16, hours: 15, minutes: 45, seconds: 0 }, Date.UTC(2026, 10, 16, 10, 15, 0)), 330)
})

test('isInWindow: dias, limites e desligado', () => {
  assert.equal(isInWindow(weekday, MON(5, 59), BH), false)
  assert.equal(isInWindow(weekday, MON(6, 0), BH), true)
  assert.equal(isInWindow(weekday, MON(8, 59), BH), true)
  assert.equal(isInWindow(weekday, MON(9, 0), BH), false)
  // sábado 21/11
  assert.equal(isInWindow(weekday, bh(2026, 11, 21, 7, 0), BH), false)
  assert.equal(isInWindow({ ...weekday, on: false }, MON(7, 0), BH), false)
  assert.equal(isInWindow(undefined, MON(7, 0), BH), false)
  // Mesmo instante, fuso UTC: 07:00 BH = 10:00 UTC (fora).
  assert.equal(isInWindow(weekday, MON(7, 0), 0), false)
})

test('isInWindow: janela que cruza a meia-noite pertence ao dia em que começa', () => {
  const night = { on: true, days: [5], from: 22 * 60, to: 60 } // sexta 22:00 -> sábado 01:00
  const fri = (h, mi = 0) => bh(2026, 11, 20, h, mi)
  const sat = (h, mi = 0) => bh(2026, 11, 21, h, mi)
  assert.equal(isInWindow(night, fri(21, 59), BH), false)
  assert.equal(isInWindow(night, fri(23, 30), BH), true)
  assert.equal(isInWindow(night, sat(0, 30), BH), true)
  assert.equal(isInWindow(night, sat(1, 0), BH), false)
  // Sábado 23:00 não (sábado não está marcado), e quinta->sexta 00:30 também não.
  assert.equal(isInWindow(night, sat(23, 0), BH), false)
  assert.equal(isInWindow(night, fri(0, 30), BH), false)
  // Domingo 22:00 -> segunda 01:00.
  const sun = { on: true, days: [7], from: 22 * 60, to: 60 }
  assert.equal(isInWindow(sun, MON(0, 30), BH), true)
  // from == to: dia inteiro a partir de from.
  const allDay = { on: true, days: [1], from: 0, to: 0 }
  assert.equal(isInWindow(allDay, MON(23, 59), BH), true)
  assert.equal(isInWindow(allDay, bh(2026, 11, 17, 0, 0), BH), false)
})

test('nextWindowStart: próximo início depois de agora', () => {
  assert.equal(nextWindowStart(weekday, MON(5, 0), BH), MON(6, 0))
  // Já começou: o próximo é terça.
  assert.equal(nextWindowStart(weekday, MON(6, 0), BH), bh(2026, 11, 17, 6, 0))
  assert.equal(nextWindowStart(weekday, MON(7, 0), BH), bh(2026, 11, 17, 6, 0))
  // Sexta à tarde -> segunda seguinte.
  assert.equal(nextWindowStart(weekday, bh(2026, 11, 20, 18, 0), BH), bh(2026, 11, 23, 6, 0))
  // Só segunda, já passou: a próxima segunda (7 dias).
  assert.equal(nextWindowStart({ ...weekday, days: [1] }, MON(10, 0), BH), bh(2026, 11, 23, 6, 0))
  assert.equal(nextWindowStart({ ...weekday, on: false }, MON(5, 0), BH), null)
  assert.equal(nextWindowStart({ ...weekday, days: [] }, MON(5, 0), BH), null)
})

test('alarmPlan: um alarme por ponto ativo, por horário, respeita o interruptor geral', () => {
  const favs = [
    { id: 'a', alert: weekday },
    { id: 'b', alert: { on: true, days: [1], from: 5 * 60, to: 6 * 60 } },
    { id: 'c' },
    { id: 'd', alert: { ...weekday, on: false } }
  ]
  const plan = alarmPlan(favs, MON(4, 0), BH)
  assert.deepEqual(plan.map((p) => p.id), ['b', 'a'])
  assert.equal(plan[1].time, MON(6, 0) / 1000)
  assert.deepEqual(alarmPlan(favs, MON(4, 0), BH, false), [])
  assert.deepEqual(alarmPlan(null, MON(4, 0), BH), [])
  const many = Array.from({ length: MAX_ALARMS + 3 }, (_, i) => ({ id: `f${i}`, alert: weekday }))
  assert.equal(alarmPlan(many, MON(4, 0), BH).length, MAX_ALARMS)
})

test('textos: opções de horário, dias, resumo e linha do "abre sozinho"', () => {
  const opts = timeOptions(15)
  assert.equal(opts.length, 96)
  assert.deepEqual(opts[0], { name: '00:00', value: '00:00' })
  assert.equal(opts[95].value, '23:45')
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Seg–Sex')
  assert.equal(daysLabel([6, 7]), 'Sáb e Dom')
  assert.equal(daysLabel([1, 3, 5]), 'Seg, Qua, Sex')
  assert.equal(daysLabel([1, 2, 3, 4, 5, 6, 7]), 'todos os dias')
  assert.equal(daysLabel([]), 'nenhum dia')
  assert.equal(alertSummary(weekday), 'Seg–Sex · 06:00–09:00')
  assert.equal(alertSummary(undefined), 'Avisos desligados')
  assert.equal(autoOpenLine({ ...weekday, from: 420 }), 'O relógio abre sozinho às 07:00 nos dias marcados')
  assert.equal(autoOpenLine({ ...weekday, on: false }), '')
})

test('applyAlertChange: liga, dias e horários (inválido não muda)', () => {
  let a = applyAlertChange(undefined, 'on', true)
  assert.equal(a.on, true)
  a = applyAlertChange(a, 'day', 5)
  assert.deepEqual(a.days, [1, 2, 3, 4])
  a = applyAlertChange(a, 'day', 7)
  assert.deepEqual(a.days, [1, 2, 3, 4, 7])
  a = applyAlertChange(a, 'from', { value: '07:15' })
  assert.equal(a.from, 435)
  a = applyAlertChange(a, 'to', 'lixo')
  assert.equal(a.to, 540)
  assert.deepEqual(applyAlertChange(a, 'x', 1), a)
})

test('vibrationAllowed e latestAlert', () => {
  assert.equal(vibrationAllowed(true, weekday, MON(7, 0), BH), true)
  assert.equal(vibrationAllowed(false, weekday, MON(7, 0), BH), false)
  assert.equal(vibrationAllowed(true, weekday, MON(10, 0), BH), false)
  assert.equal(vibrationAllowed(true, undefined, MON(7, 0), BH), false)
  const fav = { id: 'a', alert: weekday }
  const newer = { on: false, days: [], from: 0, to: 60 }
  assert.equal(latestAlert(fav, [{ id: 'a', alert: newer }]), newer)
  assert.equal(latestAlert(fav, [{ id: 'z' }]), weekday)
  assert.equal(latestAlert(fav, null), weekday)
})
