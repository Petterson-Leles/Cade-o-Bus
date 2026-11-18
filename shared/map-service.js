// Download do mapa com a tela desligada (EXPERIMENTAL): lógica pura do App Service
// contínuo do relógio (app-service/map-service.js) e de quem o liga (tela inicial).
// Sem APIs do Zepp OS; testada em test/map-service.test.mjs.
//
// Doc do App Service: https://docs.zepp.com/docs/guides/framework/device/app-service/
// - no service não há setTimeout/setInterval: o relógio do service é o sensor Time
//   (onPerMinute), então tudo aqui é decidido de minuto em minuto;
// - gravar arquivos (@zos/fs) no service só vale com a tela desligada ou em AOD.
import { MAP_THEMES, normalizeBits, mergeBits, countBits, setBit } from './map-tiles.js'

// Arquivo do service (o mesmo de app.json > module > app-service > services).
export const SERVICE_FILE = 'app-service/map-service'
// Permissão do service contínuo (@zos/app-service start/stop/exit).
export const BG_PERMISSION = 'device:os.bg_service'
// Encerra sozinho: tempo máximo e tempo sem nenhum bloco novo.
export const SERVICE_MAX_MS = 30 * 60 * 1000
export const SERVICE_IDLE_MS = 5 * 60 * 1000
// Sem bloco novo há esse tempo: manda ao celular o "MAP_SYNC" (arquivo pequeno pela
// outbox), que acorda o side service e retoma a fila pausada.
export const SERVICE_PING_IDLE_MS = 90 * 1000
// Arquivo que o service manda ao celular como MAP_SYNC (criado pela página: o service
// só pode gravar com a tela desligada).
export const PING_FILE = 'data://map/cob-ping.txt'
// Registro do que o service guardou (separado do LocalStorage do app; ver utils/map-files.js).
export const SERVICE_REGISTRY_FILE = 'data://map/service-have.json'

const isTheme = (t) => MAP_THEMES.indexOf(t) >= 0

// ---- param do start (string no formato de query, como o exemplo oficial) ----

// { theme, total, have, at } -> 'theme=dark&n=812&have=ff00…&at=1700000000000'
export function buildServiceParam({ theme, total, have, at }) {
  const n = Number.isInteger(total) && total > 0 ? total : 0
  const parts = [`theme=${encodeURIComponent(isTheme(theme) ? theme : MAP_THEMES[0])}`, `n=${n}`, `have=${normalizeBits(have, n)}`, `at=${Math.round(Number(at) || 0)}`]
  return parts.join('&')
}

// Aceita a string do onInit (pode vir com outros pares, ex. os que o sistema põe).
export function parseServiceParam(raw) {
  if (typeof raw !== 'string' || !raw) return null
  const out = {}
  raw.split('&').forEach((pair) => {
    const i = pair.indexOf('=')
    if (i <= 0) return
    try {
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
    } catch (e) {
      // par malformado: ignora
    }
  })
  if (!isTheme(out.theme)) return null
  const n = Number(out.n)
  const total = Number.isInteger(n) && n > 0 && n <= 10000 ? n : 0
  const at = Number(out.at)
  return { theme: out.theme, total, have: normalizeBits(out.have, total), at: Number.isFinite(at) && at > 0 ? at : 0 }
}

// ---- Decisão de cada minuto ----

// state: { now, startedAt, lastProgressAt, lastPingAt, done, total }
// -> { action: 'exit', reason: 'done' | 'timeout' | 'idle' } | { action: 'ping' } | { action: 'wait' }
export function serviceTick({ now, startedAt, lastProgressAt, lastPingAt, done, total, maxMs = SERVICE_MAX_MS, idleMs = SERVICE_IDLE_MS, pingIdleMs = SERVICE_PING_IDLE_MS }) {
  if (total > 0 && done >= total) return { action: 'exit', reason: 'done' }
  if (now - startedAt >= maxMs) return { action: 'exit', reason: 'timeout' }
  const last = Math.max(startedAt || 0, lastProgressAt || 0)
  if (now - last >= idleMs) return { action: 'exit', reason: 'idle' }
  // Ping quando a fila parece parada (nenhum bloco há pingIdleMs) e não pingou nesse tempo.
  if (now - last >= pingIdleMs && now - (lastPingAt || 0) >= pingIdleMs) return { action: 'ping' }
  return { action: 'wait' }
}

// ---- Registro do service (JSON em SERVICE_REGISTRY_FILE) ----

// { themes: { dark: { have, total } } } limpo.
export function cleanRegistry(raw) {
  let r = raw
  if (typeof raw === 'string') {
    try {
      r = JSON.parse(raw)
    } catch (e) {
      r = null
    }
  }
  const out = { themes: {} }
  const src = r && typeof r === 'object' && r.themes && typeof r.themes === 'object' ? r.themes : {}
  MAP_THEMES.forEach((t) => {
    const e = src[t]
    const total = e && Number.isInteger(e.total) && e.total > 0 && e.total <= 10000 ? e.total : 0
    if (total > 0) out.themes[t] = { have: normalizeBits(e.have, total), total }
  })
  return out
}

// Marca o bloco i (de total) no registro (devolve um registro novo).
export function registryMark(reg, theme, i, total) {
  const r = cleanRegistry(reg)
  if (!isTheme(theme) || !(total > 0)) return r
  const cur = r.themes[theme]
  const have = cur && cur.total === total ? cur.have : ''
  r.themes[theme] = { have: setBit(normalizeBits(have, total), i), total }
  return r
}

// União dos bits de um tema: { have, total } do app ∪ do service (só se o total bate).
export function unionTheme(main, extra) {
  const m = main && Number.isInteger(main.total) ? main : { have: '', total: 0 }
  if (!extra || !(extra.total > 0)) return { have: normalizeBits(m.have, m.total), total: m.total }
  if (!(m.total > 0)) return { have: normalizeBits(extra.have, extra.total), total: extra.total }
  if (m.total !== extra.total) return { have: normalizeBits(m.have, m.total), total: m.total }
  return { have: mergeBits(m.have, extra.have, m.total), total: m.total }
}

export function themeDone(entry) {
  return entry && entry.total > 0 ? countBits(entry.have, entry.total) : 0
}

// ---- Arquivo "MAP_SYNC" do service para o celular (params da outbox) ----

export function syncFileParams(have, now = Date.now()) {
  const h = {}
  MAP_THEMES.forEach((t) => {
    if (have && typeof have[t] === 'string') h[t] = have[t]
  })
  return { kind: 'cob-sync', have: JSON.stringify(h), at: String(Math.round(now)) }
}

// No celular: params recebidos -> { have: { dark, light } } ou null.
export function parseSyncFileParams(p) {
  let params = p
  if (typeof p === 'string') {
    try {
      params = JSON.parse(p)
    } catch (e) {
      return null
    }
  }
  if (!params || typeof params !== 'object' || params.kind !== 'cob-sync') return null
  let have = params.have
  if (typeof have === 'string') {
    try {
      have = JSON.parse(have)
    } catch (e) {
      have = null
    }
  }
  const out = {}
  MAP_THEMES.forEach((t) => {
    if (have && typeof have[t] === 'string' && /^[0-9a-f]*$/i.test(have[t])) out[t] = have[t].toLowerCase()
  })
  return { have: out }
}

// ---- Permissão e serviço rodando (tela inicial) ----

// queryPermission: 0 não autorizado, 1 desconhecida, 2 autorizado.
export function permissionFromQuery(code) {
  if (code === 2) return 'granted'
  if (code === 0) return 'ask'
  return 'error'
}

// requestPermission (callback): 2 = concedida; 0 = cancelada; outro = erro.
export function permissionFromRequest(code) {
  return code === 2 ? 'granted' : 'denied'
}

// getAllAppServices() devolve a lista dos services rodando; aceita com ou sem ".js"
// e com caminho absoluto.
export function isServiceRunning(list, file = SERVICE_FILE) {
  if (!Array.isArray(list)) return false
  return list.some((s) => {
    if (typeof s !== 'string') return false
    const name = s.replace(/\.js$/, '')
    return name === file || name.endsWith('/' + file)
  })
}

// Tela inicial: liga o service sozinha (interruptor das configurações)?
export function shouldAutoStart({ bgMap, downloading, ready, running, denied, tried }) {
  return !!bgMap && !!downloading && !ready && !running && !denied && !tried
}
