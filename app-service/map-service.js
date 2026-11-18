// App Service contínuo do relógio (EXPERIMENTAL): recebe os blocos do mapa de BH com
// a tela desligada / o app fechado. Ligado pela tela inicial (page/home) com
// @zos/app-service start, depois de queryPermission/requestPermission de
// device:os.bg_service. Lógica pura em shared/map-service.js.
//
// Doc: https://docs.zepp.com/docs/guides/framework/device/app-service/
// - sem UI e SEM timers (setTimeout/setInterval não existem aqui): o relógio do
//   service é o sensor Time (onPerMinute), como no exemplo oficial;
// - @zos/ble (menos as APIs mst*) funciona: TransferFile vem de @zos/ble/TransferFile
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/
// - @zos/fs: gravar só funciona com a tela desligada ou em AOD. Bloco que não deu
//   para guardar (tela acesa) fica na lista e é tentado de novo a cada minuto;
// - sair: @zos/app-service exit https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/exit/
//
// Não usa a zml (ela depende de getApp(), @zos/ui e timers) nem utils/map-store.js
// (LocalStorage não está na lista de APIs do service): guarda o que recebeu num
// registro próprio (utils/map-files.js), que o app soma ao dele.
import TransferFile from '@zos/ble/TransferFile'
import { inboxOf, onNewFile, outboxOf } from '../shared/transfer'
import { Time } from '@zos/sensor'
import { exit } from '@zos/app-service'
import { MAP_THEMES } from '../shared/map-tiles'
import { parseServiceParam, serviceTick, registryMark, unionTheme, themeDone, syncFileParams, PING_FILE } from '../shared/map-service'
import { moveReceivedTile, tileOfFile, readServiceRegistry, writeServiceRegistry, ensurePingFile, fileExists } from '../utils/map-files'

const errText = (e) => (e && e.message ? String(e.message) : String(e))
const log = (...args) => {
  try {
    console.log('[Cadê o Busão service]', ...args)
  } catch (e) {
    // sem console
  }
}
// Envolve callbacks: um erro não derruba o service (no service não há tela para mostrar).
const safe = (where, fn) =>
  function (...args) {
    try {
      return fn.apply(this, args)
    } catch (e) {
      log(`erro em ${where}:`, errText(e))
      return undefined
    }
  }

// Estado do arquivo no evento 'change' (a doc chama o campo de `date`; os exemplos, de `data`).
const readyStateOf = (ev) => {
  const d = ev && (ev.data || ev.date)
  return d && d.readyState
}

let transfer = null
let timeSensor = null
const st = {
  theme: 'dark',
  total: 0,
  base: '', // bits que o app já tinha quando o service começou (param do start)
  reg: null, // registro do service em memória (gravado quando dá)
  regDirty: false,
  pending: [], // blocos recebidos que ainda não deu para guardar (tela acesa)
  startedAt: 0,
  lastProgressAt: 0,
  lastPingAt: 0,
  exiting: false
}

function current() {
  const extra = st.reg && st.reg.themes[st.theme]
  return unionTheme({ have: st.base, total: st.total }, extra)
}

function have() {
  const out = {}
  const reg = st.reg || { themes: {} }
  MAP_THEMES.forEach((t) => {
    const e = t === st.theme ? current() : reg.themes[t]
    if (e && e.total > 0) out[t] = e.have
  })
  return out
}

function saveRegistry() {
  if (!st.regDirty) return
  if (writeServiceRegistry(st.reg)) st.regDirty = false
}

// Guarda um bloco (ou devolve false para tentar de novo depois).
function store(file) {
  const tile = tileOfFile(file)
  if (!tile) return true // não é bloco do mapa: descarta
  const { ok } = moveReceivedTile(file)
  if (!ok) return false
  st.reg = registryMark(st.reg, tile.theme, tile.i, tile.total)
  st.regDirty = true
  if (tile.theme === st.theme && tile.total > 0 && st.total !== tile.total) {
    // O manifesto mudou desde o start: vale o total que veio com o bloco.
    st.total = tile.total
    st.base = ''
  }
  st.lastProgressAt = Date.now()
  saveRegistry()
  return true
}

function retryPending() {
  if (st.pending.length === 0) return
  const left = []
  st.pending.forEach((f) => {
    let ok = false
    try {
      ok = store(f)
    } catch (e) {
      ok = false
    }
    if (!ok && left.length < 50) left.push(f)
  })
  st.pending = left
}

// "MAP_SYNC" para o celular: um arquivo pequeno pela outbox com o que o relógio tem.
// Isso acorda o side service (a zml trata launchReasons.fileTransfer) e ele retoma a
// fila pausada (app-side/index.js onReceivedFile -> mapOnSync com merge).
function ping() {
  st.lastPingAt = Date.now()
  if (!transfer) return
  if (!fileExists(PING_FILE) && !ensurePingFile()) {
    log('sem arquivo de ping (tela acesa?)')
    return
  }
  try {
    const f = outboxOf(transfer).enqueueFile(PING_FILE, syncFileParams(have()))
    if (f && typeof f.on === 'function') {
      f.on(
        'change',
        safe('ping change', (ev) => {
          const s = readyStateOf(ev)
          if (s === 'error' || s === 'canceled') log('ping:', s)
        })
      )
    }
  } catch (e) {
    log('ping falhou:', errText(e))
  }
}

function finish(reason) {
  if (st.exiting) return
  st.exiting = true
  log('encerrando:', reason)
  saveRegistry()
  try {
    exit()
  } catch (e) {
    log('exit falhou:', errText(e))
  }
}

function tick() {
  if (st.exiting) return
  retryPending()
  saveRegistry()
  const now = Date.now()
  const cur = current()
  const r = serviceTick({ now, startedAt: st.startedAt, lastProgressAt: st.lastProgressAt, lastPingAt: st.lastPingAt, done: themeDone(cur), total: cur.total })
  if (r.action === 'exit') finish(r.reason)
  else if (r.action === 'ping') ping()
}

function onFile(file) {
  if (!file || typeof file.on !== 'function') return
  file.on(
    'change',
    safe('arquivo', (ev) => {
      if (readyStateOf(ev) !== 'transferred') return
      if (!store(file)) st.pending.push(file)
      const cur = current()
      if (cur.total > 0 && themeDone(cur) >= cur.total) finish('done')
    })
  )
}

AppService({
  onInit: safe('onInit', function (param) {
    const p = parseServiceParam(typeof param === 'string' ? param : '')
    st.startedAt = Date.now()
    st.lastProgressAt = st.startedAt
    if (p) {
      st.theme = p.theme
      st.total = p.total
      st.base = p.have
    }
    st.reg = readServiceRegistry()
    log('iniciado', st.theme, `${themeDone(current())}/${st.total}`)
    try {
      transfer = new TransferFile()
      if (!onNewFile(inboxOf(transfer), safe('inbox', (file) => onFile(file)))) log('inbox indisponível no service')
    } catch (e) {
      log('TransferFile indisponível no service:', errText(e))
    }
    try {
      timeSensor = new Time()
      timeSensor.onPerMinute(safe('minuto', tick))
    } catch (e) {
      // Sem relógio não há como encerrar sozinho por tempo: sai já.
      log('sensor Time indisponível:', errText(e))
      finish('no-timer')
      return
    }
    // Avisa o celular logo de cara (a fila pode estar pausada).
    ping()
  }),

  // Chamado se a página chamar start de novo com o service rodando.
  onEvent: safe('onEvent', function (param) {
    const p = parseServiceParam(typeof param === 'string' ? param : '')
    if (p && p.theme !== st.theme) {
      st.theme = p.theme
      st.total = p.total
      st.base = p.have
    }
    st.lastProgressAt = Date.now()
    ping()
  }),

  onDestroy: safe('onDestroy', function () {
    saveRegistry()
    log('service destruído')
  })
})
