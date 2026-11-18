// Horário de aviso por ponto (lógica pura, testada em test/schedule.test.mjs).
//
// Cada favorito pode ter alert = { on, days, from, to }:
// - on: avisos ligados para esse ponto (padrão: desligado até a pessoa definir);
// - days: dias da semana em que a janela COMEÇA, 1 = segunda ... 7 = domingo;
// - from / to: minutos desde 00:00 (0–1439). Se to <= from, a janela cruza a
//   meia-noite (ex.: 22:00–01:00 de segunda vai até 01:00 de terça). from == to
//   vale o dia inteiro (24 h a partir de from).
//
// O relógio só vibra dentro da janela (isInWindow) e agenda um alarme do sistema
// para o próximo início de janela de cada ponto (alarmPlan).
//
// Horas locais: o relógio conhece a hora local pelo sensor Time (@zos/sensor);
// aqui tudo recebe o instante em UTC (ms) e o deslocamento do fuso local em
// minutos (local = UTC + offsetMin; BH = -180), calculado por offsetFromParts.

export const DAY_LABELS = Object.freeze(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'])
export const DEFAULT_ALERT = Object.freeze({ on: false, days: Object.freeze([1, 2, 3, 4, 5]), from: 6 * 60, to: 9 * 60 })
export const TIME_STEP_MIN = 15
const DAY_MIN = 24 * 60
const MIN_MS = 60 * 1000
// Margem para "o próximo início": um alarme que acabou de tocar não se reagenda
// para o mesmo minuto.
const NEXT_MARGIN_MS = 60 * 1000
// Quantos alarmes o app agenda no máximo (a doc não diz o limite do sistema).
export const MAX_ALARMS = 8

const pad2 = (n) => (n < 10 ? `0${n}` : String(n))

// 'HH:MM' (ou 'H:MM', 'HHMM', 'H') -> minutos (0–1439) ou null.
export function parseHHMM(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value < DAY_MIN ? value : null
  const t = String(value === undefined || value === null ? '' : value).trim().replace(/h$/i, '').replace(/[hH.]/, ':')
  let m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) m = /^(\d{1,2})(\d{2})$/.exec(t)
  if (!m && /^\d{1,2}$/.test(t)) m = [t, t, '0']
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// minutos -> 'HH:MM'.
export function formatHHMM(minutes) {
  const n = ((Math.round(Number(minutes) || 0) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`
}

function cleanDays(days) {
  if (!Array.isArray(days)) return []
  const out = []
  days.forEach((d) => {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 1 && n <= 7 && out.indexOf(n) < 0) out.push(n)
  })
  return out.sort((a, b) => a - b)
}

// Qualquer coisa -> { on, days, from, to } válido (sem alert: o padrão, desligado).
export function normalizeAlert(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ALERT, days: DEFAULT_ALERT.days.slice() }
  const from = parseHHMM(raw.from)
  const to = parseHHMM(raw.to)
  return {
    on: raw.on === true,
    days: Array.isArray(raw.days) ? cleanDays(raw.days) : DEFAULT_ALERT.days.slice(),
    from: from === null ? DEFAULT_ALERT.from : from,
    to: to === null ? DEFAULT_ALERT.to : to
  }
}

// Avisos realmente ativos: ligado e com pelo menos um dia.
export function alertActive(alert) {
  const a = normalizeAlert(alert)
  return a.on && a.days.length > 0
}

const windowLen = (a) => {
  const len = a.to - a.from
  return len > 0 ? len : len + DAY_MIN
}

// Deslocamento do fuso (minutos) a partir da hora local "de parede" e do UTC:
// parts = { year, month (1–12), date, hours, minutes, seconds }. Arredonda a 15 min.
export function offsetFromParts(parts, utcMs) {
  const p = parts || {}
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.date), Number(p.hours) || 0, Number(p.minutes) || 0, Number(p.seconds) || 0)
  const diff = (wall - Number(utcMs)) / MIN_MS
  if (!Number.isFinite(diff)) return 0
  return Math.round(diff / 15) * 15
}

// Hora local -> { day (1 = seg ... 7 = dom), minutes (0–1439), dayStartMs (UTC ms da 00:00 local) }.
export function localParts(utcMs, offsetMin) {
  const off = Number(offsetMin) || 0
  const local = Number(utcMs) + off * MIN_MS
  const d = new Date(local)
  const wd = d.getUTCDay() // 0 = domingo
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const dayStartLocal = local - (minutes * MIN_MS + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds())
  return { day: wd === 0 ? 7 : wd, minutes, dayStartMs: dayStartLocal - off * MIN_MS }
}

const prevDay = (day) => (day === 1 ? 7 : day - 1)

// Está dentro da janela agora? (desligado = nunca)
export function isInWindow(alert, utcMs, offsetMin) {
  if (!alertActive(alert)) return false
  const a = normalizeAlert(alert)
  const { day, minutes } = localParts(utcMs, offsetMin)
  const len = windowLen(a)
  // Janela que começou hoje.
  if (a.days.indexOf(day) >= 0 && minutes >= a.from && minutes < a.from + len) return true
  // Janela que começou ontem e cruza a meia-noite.
  if (a.from + len > DAY_MIN && a.days.indexOf(prevDay(day)) >= 0 && minutes < a.from + len - DAY_MIN) return true
  return false
}

// Próximo início de janela (UTC ms) estritamente depois de agora (+1 min), ou null.
export function nextWindowStart(alert, utcMs, offsetMin) {
  if (!alertActive(alert)) return null
  const a = normalizeAlert(alert)
  const now = Number(utcMs)
  const { day, dayStartMs } = localParts(now, offsetMin)
  for (let i = 0; i <= 7; i++) {
    const wd = ((day - 1 + i) % 7) + 1
    if (a.days.indexOf(wd) < 0) continue
    // Dias de 24 h exatos: o fuso do relógio não muda no meio (BH não tem horário de verão).
    const start = dayStartMs + i * DAY_MIN * MIN_MS + a.from * MIN_MS
    if (start > now + NEXT_MARGIN_MS - 1) return start
  }
  return null
}

// Alarmes a agendar: [{ id, time (UTC s), fav }] por ordem de horário, no máximo MAX_ALARMS.
// enabled = interruptor geral "Vibrar no relógio" (desligado: nenhum alarme).
export function alarmPlan(favorites, utcMs, offsetMin, enabled = true) {
  if (!enabled || !Array.isArray(favorites)) return []
  const out = []
  favorites.forEach((fav) => {
    if (!fav || !fav.alert) return
    const t = nextWindowStart(fav.alert, utcMs, offsetMin)
    if (t !== null) out.push({ id: fav.id || '', time: Math.floor(t / 1000), fav })
  })
  out.sort((x, y) => x.time - y.time)
  return out.slice(0, MAX_ALARMS)
}

// Opções do Select de horário: 00:00, 00:15, ..., 23:45.
export function timeOptions(step = TIME_STEP_MIN) {
  const s = Math.max(1, Math.round(step))
  const out = []
  for (let m = 0; m < DAY_MIN; m += s) out.push({ name: formatHHMM(m), value: formatHHMM(m) })
  return out
}

// "Seg–Sex", "Seg, Qua, Sex", "Todos os dias", "Sáb e Dom".
export function daysLabel(days) {
  const d = cleanDays(days)
  if (d.length === 0) return 'nenhum dia'
  if (d.length === 7) return 'todos os dias'
  // Sequência contínua com 3 ou mais dias vira intervalo.
  const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1)
  if (contiguous && d.length >= 3) return `${DAY_LABELS[d[0] - 1]}–${DAY_LABELS[d[d.length - 1] - 1]}`
  const names = d.map((x) => DAY_LABELS[x - 1])
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  return names.join(', ')
}

// Resumo do cartão: "Avisos desligados" ou "Seg–Sex · 06:00–09:00".
export function alertSummary(alert) {
  const a = normalizeAlert(alert)
  if (!alertActive(a)) return 'Avisos desligados'
  return `${daysLabel(a.days)} · ${formatHHMM(a.from)}–${formatHHMM(a.to)}`
}

// Linha das configurações: "O relógio abre sozinho às 07:00 nos dias marcados".
export function autoOpenLine(alert) {
  const a = normalizeAlert(alert)
  if (!alertActive(a)) return ''
  return `O relógio abre sozinho às ${formatHHMM(a.from)} nos dias marcados`
}

// Liga/desliga um dia (para os chips Seg ... Dom).
export function toggleDay(alert, day) {
  const a = normalizeAlert(alert)
  const n = Number(day)
  const days = a.days.indexOf(n) >= 0 ? a.days.filter((x) => x !== n) : cleanDays([...a.days, n])
  return { ...a, days }
}

// Aplica uma mudança do formulário ("Editar"): key = on | from | to | day.
// from/to inválidos ficam como estavam. Devolve o alert novo.
export function applyAlertChange(alert, key, value) {
  const a = normalizeAlert(alert)
  if (key === 'on') return { ...a, on: value === true }
  if (key === 'day') return toggleDay(a, value)
  if (key === 'from' || key === 'to') {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value.value : value
    const m = parseHHMM(v)
    return m === null ? a : { ...a, [key]: m }
  }
  return a
}

// Rodapé da tela do ponto fora da janela.
export const QUIET_NOTE = 'avisos desligados agora'

// Pode vibrar agora? Interruptor geral ligado E dentro da janela do ponto.
export function vibrationAllowed(master, alert, utcMs, offsetMin) {
  return master !== false && isInWindow(alert, utcMs, offsetMin)
}

// Horário mais novo do mesmo ponto numa lista de favoritos (SETTINGS_CHANGED).
export function latestAlert(fav, favorites) {
  if (!fav || !Array.isArray(favorites)) return fav ? fav.alert : undefined
  const same = fav.id ? favorites.find((f) => f && f.id === fav.id) : null
  return same ? same.alert : fav.alert
}
