// Mapa sob demanda no side service (celular): o celular guarda os blocos e manda ao
// relógio só os que cobrem a vista aberta (e, com baixa prioridade, os vizinhos).
// Métodos espalhados no BaseSideService (como os módulos dos exemplos da zml).
//
// Cada bloco:
// 1. já convertido no cache do celular (data://download/cob-c-<nome>)? usa; senão
//    baixa o PNG: network.downloader.downloadFile (this.download da zml)
//    https://docs.zepp.com/docs/reference/side-service-api/download-file/
//    e converte para o formato do relógio: image.convert (this.convert da zml)
//    https://docs.zepp.com/docs/reference/side-service-api/image-convert/
// 2. manda pela outbox do TransferFile (getOutbox().enqueueFile, com this.sendFile da
//    zml de reserva) e espera readyState 'transferred':
//    https://docs.zepp.com/docs/reference/side-service-api/transfer-file/
// O side service não tem API de arquivos: o que já está no cache do celular fica
// anotado em bits no settingsStorage (mapPhoneCache). Se um arquivo do cache sumiu,
// o envio falha e o bloco é baixado de novo.
// Lógica pura em shared/map-demand.js e shared/map-download.js.
import { settingsLib } from '@zeppos/zml/base-side'
import { outboxOf, readyStateOf as stateOf } from '../shared/transfer'
import { withTimeout } from '../shared/bhtrans'
import { MAP_MANIFEST_URL, MAP_THEMES, parseManifest, compactManifest, tileList, normalizeBits, hasBit, setBit, designLevels, centerLatLon } from '../shared/map-tiles'
import { MAP_MANIFEST_KEY, MAP_COMMAND_KEY, MAP_PHONE_CACHE_KEY, MAP_DIAG_KEY, readMapStates, writeMapStates, applyWatchBits, cleanThemeState, parseCommand, tileParams, cleanDiag, diagCount, diagError, diagManifest, diagWatch } from '../shared/map-download'
import { manifestTag, demandPlan, enqueueDemand, takeNext, dropTheme, cleanPhoneCache, phoneTilePath, tilesNearPoints, confirmTiles, PRIO } from '../shared/map-demand'
import { parseLevels } from '../shared/map-frame'
import { readFavorites } from '../utils/favorites'
import { readThemeName } from '../utils/colors'

const MANIFEST_TIMEOUT_MS = 15 * 1000
const MANIFEST_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const DOWNLOAD_TIMEOUT_MS = 20 * 1000
const CONVERT_TIMEOUT_MS = 20 * 1000
// Um bloco (~8–10 KB) leva poucos segundos pelo Bluetooth; mais que isso, desiste.
const TRANSFER_TIMEOUT_MS = 45 * 1000
// Grava estado e cache no settingsStorage no máximo a cada tanto (cada gravação
// redesenha a tela de configurações).
const SAVE_EVERY_MS = 3000
// Falhas seguidas de envio: a fila para até o próximo pedido do relógio.
const MAX_FAILS = 3
// Pré-cache no celular (só internet, nada vai ao relógio): raio em volta dos pontos.
const WARM_KM = 0.8
const WARM_MAX = 40
const COMMAND_DONE_KEY = 'mapCommandDone'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const errText = (e) => (e && e.message ? String(e.message) : String(e))

export const mapSync = {
  // Chamado no onInit do side service (ou antes, se um arquivo do relógio o acordou).
  mapInit() {
    this.mapReady = true
    this.mapQueue = [] // fila com prioridade (shared/map-demand.js)
    this.mapSeq = 0
    this.mapBusy = false
    this.mapFails = 0
    this.mapSentAt = { dark: {}, light: {} } // { i: quando foi entregue }
    this.mapPrepared = new Map() // 'tema:i' -> Promise<{ out }>
    this.mapMem = null // manifesto validado em memória
    this.mapLists = {} // tileList por tema
    this.mapCache = null
    this.mapStatesCache = null
    this.mapLastSave = 0
    this.mapDirty = false
    this.mapWarming = false
    // Diagnóstico (configurações): pedidos/enviados/confirmados e o último erro.
    let diagRaw = null
    try {
      diagRaw = settingsLib.getItem(MAP_DIAG_KEY)
    } catch (e) {
      diagRaw = null
    }
    this.mapDiag = cleanDiag(diagRaw)
    this.mapAwait = { dark: [], light: [] } // enviados, esperando o relógio confirmar
    this.mapManifest(false)
      .then(() => this.mapWarm())
      .catch(() => {})
    // Comando que chegou com o side service fechado.
    this.mapHandleCommand(settingsLib.getItem(MAP_COMMAND_KEY))
  },

  // ---- Manifesto ----

  // Manifesto validado (cache de 7 dias no settingsStorage; force = baixa de novo).
  async mapManifest(force) {
    if (this.mapMem && !force) return this.mapMem
    let cached = null
    try {
      cached = JSON.parse(settingsLib.getItem(MAP_MANIFEST_KEY) || 'null')
    } catch (e) {
      cached = null
    }
    const fresh = cached && cached.manifest && Date.now() - (Number(cached.at) || 0) < MANIFEST_MAX_AGE_MS
    if (fresh && !force) {
      const m = parseManifest(cached.manifest)
      if (m) return this.mapSetManifest(m)
    }
    try {
      const res = await withTimeout(this.fetch({ url: MAP_MANIFEST_URL, method: 'GET', timeout: MANIFEST_TIMEOUT_MS }), MANIFEST_TIMEOUT_MS)
      const status = Number(res && res.status)
      if (!(status >= 200 && status < 300)) throw new Error(`HTTP ${res && res.status}`)
      const m = parseManifest(res.body)
      if (!m) throw new Error('Manifesto do mapa inválido')
      settingsLib.setItem(MAP_MANIFEST_KEY, JSON.stringify({ at: Date.now(), manifest: m }))
      this.mapDiagSet(diagManifest(this.mapDiag, `ok v${m.version} ${m.generated}`))
      return this.mapSetManifest(m)
    } catch (e) {
      // Sem internet: usa o cache velho se houver.
      const m = cached && parseManifest(cached.manifest)
      this.mapDiagSet(diagManifest(this.mapDiag, `${m ? 'cache velho; ' : ''}erro ${errText(e)}`))
      if (m) return this.mapSetManifest(m)
      throw e
    }
  },

  mapSetManifest(m) {
    this.mapMem = m
    this.mapCompact = compactManifest(m)
    this.mapTag = manifestTag(this.mapCompact)
    this.mapLists = {}
    const totals = {}
    MAP_THEMES.forEach((t) => {
      this.mapLists[t] = tileList(m, t)
      totals[t] = this.mapLists[t].length
    })
    let raw = null
    try {
      raw = settingsLib.getItem(MAP_PHONE_CACHE_KEY)
    } catch (e) {
      raw = null
    }
    this.mapCache = cleanPhoneCache(raw, this.mapTag, totals)
    return m
  },

  // Manifesto já carregado, sem esperar (null: ainda carregando; tenta de novo).
  mapManifestNow() {
    if (this.mapMem) return this.mapMem
    if (!this.mapLoading) {
      this.mapLoading = true
      this.mapManifest(false)
        .catch((e) => console.log('Mapa: manifesto', errText(e)))
        .then(() => {
          this.mapLoading = false
        })
    }
    return null
  },

  // ---- Estado (o que o relógio tem) e cache do celular, no settingsStorage ----

  mapStates() {
    if (!this.mapStatesCache) this.mapStatesCache = readMapStates(settingsLib)
    return this.mapStatesCache
  },

  // Diagnóstico novo (gravado junto do estado, no máximo a cada SAVE_EVERY_MS).
  mapDiagSet(d) {
    this.mapDiag = d
    this.mapDirty = true
  },

  mapSave(force) {
    const now = Date.now()
    if (!force && (!this.mapDirty || now - this.mapLastSave < SAVE_EVERY_MS)) {
      if (this.mapDirty && !this.mapSaveTimer) {
        this.mapSaveTimer = setTimeout(() => {
          this.mapSaveTimer = null
          this.mapSave(false)
        }, SAVE_EVERY_MS)
      }
      return
    }
    this.mapLastSave = now
    this.mapDirty = false
    // "Limpar" da tela de configurações (marcado lá direto): não desfaz.
    const stored = readMapStates(settingsLib)
    const mine = this.mapStates()
    MAP_THEMES.forEach((t) => {
      if (stored[t].deleting && !mine[t].deleting) mine[t] = { ...mine[t], deleting: true }
    })
    this.mapStatesCache = writeMapStates(settingsLib, mine)
    if (this.mapCache) settingsLib.setItem(MAP_PHONE_CACHE_KEY, JSON.stringify(this.mapCache))
    if (this.mapDiag) settingsLib.setItem(MAP_DIAG_KEY, JSON.stringify(this.mapDiag))
  },

  mapCacheHas(theme, i) {
    return !!(this.mapCache && this.mapCache.themes[theme] && hasBit(this.mapCache.themes[theme], i))
  },

  mapCacheMark(theme, i, on) {
    if (!this.mapCache || !this.mapCache.themes[theme]) return
    this.mapCache.themes[theme] = setBit(this.mapCache.themes[theme], i, on)
    this.mapDirty = true
  },

  // ---- Pedido do relógio (junto do GET_BUSES) ----

  // Níveis do mapa (px de design por km) para o enquadramento, quando o relógio ainda
  // não tem o manifesto: o celular calcula com a escala da tela do relógio.
  mapLevelsFor(demand) {
    const m = this.mapManifestNow()
    if (!m || !demand) return null
    return parseLevels(designLevels(this.mapCompact, demand.theme, demand.scale))
  },

  // A tela do ponto pediu o mapa: d = parseDemandParams (tema, bits, raio, escala,
  // etiqueta do manifesto); level/centerM: enquadramento escolhido; stop: { lat, lon }.
  // Põe na frente da fila os blocos da vista que faltam no relógio e, atrás, os
  // vizinhos. Devolve o que vai na resposta: { tag, manifest? (se o relógio não tem
  // este), queued }.
  mapOnDemand(d, level, centerM, stop) {
    if (!d) return null
    if (d.diag) this.mapDiagSet(diagWatch(this.mapDiag, d.diag))
    const m = this.mapManifestNow()
    // Manifesto ainda carregando (ou sem internet): o relógio mostra o motivo.
    if (!m) {
      this.mapSave(false)
      return { tag: '', diag: { sent: this.mapDiag.sent, fail: this.mapDiag.fail, err: 'celular sem manifesto' } }
    }
    const out = { tag: this.mapTag }
    if (d.mv !== this.mapTag) out.manifest = this.mapCompact
    const list = this.mapLists[d.theme]
    if (!list || list.length === 0) return out
    const total = list.length
    const have = normalizeBits(d.mv === this.mapTag ? d.have : '', total)
    // O relógio é quem manda no que tem (cache LRU): atualiza o "X blocos guardados".
    const states = this.mapStates()
    if (!states[d.theme].deleting && d.mv === this.mapTag && states[d.theme].have !== have) {
      states[d.theme] = applyWatchBits(states[d.theme], have, total)
      this.mapDirty = true
      this.mapSave(false)
    }
    // Enviados que o relógio agora diz ter: confirmados.
    if (d.mv === this.mapTag) {
      const c = confirmTiles(this.mapAwait[d.theme], have)
      this.mapAwait[d.theme] = c.rest
      if (c.confirmed > 0) this.mapDiagSet(diagCount(this.mapDiag, 'conf', c.confirmed))
    }
    out.diag = { sent: this.mapDiag.sent, fail: this.mapDiag.fail, err: this.mapDiag.err ? this.mapDiag.err.slice(0, 40) : '' }
    if (states[d.theme].deleting) out.diag.err = 'limpando o mapa'
    if (states[d.theme].deleting || !Number.isInteger(level) || !(d.r > 0 || d.view)) {
      this.mapSave(false)
      return out
    }
    const center = centerLatLon(stop, centerM, this.mapCompact.m)
    const plan = demandPlan({ compact: this.mapCompact, theme: d.theme, level, center, r: d.r, view: d.view || null, have, sentAt: this.mapSentAt[d.theme], now: Date.now() })
    this.mapSeq += 1
    this.mapQueue = enqueueDemand(this.mapQueue, plan, { theme: d.theme, seq: this.mapSeq })
    this.mapFails = 0
    out.queued = plan.filter((p) => p.prio === PRIO.VIEW).length
    if (out.queued > 0) this.mapDiagSet(diagCount(this.mapDiag, 'req', out.queued))
    this.mapSave(false)
    this.mapPump()
    return out
  },

  // Um bloco por vez no Bluetooth; enquanto um vai, o próximo já é preparado.
  mapPump() {
    if (this.mapBusy) return
    const { item, rest } = takeNext(this.mapQueue)
    if (!item) return
    this.mapQueue = rest
    const tile = this.mapLists[item.theme] && this.mapLists[item.theme][item.i]
    if (!tile) {
      this.mapPump()
      return
    }
    this.mapBusy = true
    const total = this.mapLists[item.theme].length
    const next = this.mapQueue[0]
    this.mapSendTile(item.theme, tile, total, next)
      .then(
        () => {
          this.mapFails = 0
          this.mapSentAt[item.theme][item.i] = Date.now()
          const wait = this.mapAwait[item.theme]
          if (wait.indexOf(item.i) < 0) wait.push(item.i)
          if (wait.length > 200) wait.splice(0, wait.length - 200)
          this.mapDiagSet(diagCount(this.mapDiag, 'sent'))
        },
        (e) => {
          this.mapFails += 1
          console.log(`Mapa: bloco ${tile.name} falhou:`, errText(e))
          this.mapDiagSet(diagError(diagCount(this.mapDiag, 'fail'), `${tile.name.replace(/\.png$/, '')}: ${errText(e)}`))
          // Um bloco da vista tenta de novo uma vez (no fim da fila de mesma prioridade).
          if (item.prio === PRIO.VIEW && !item.retried) this.mapQueue = enqueueDemand(this.mapQueue, [{ ...item, retried: true, prio: PRIO.NEAR }], { theme: item.theme, seq: 0 })
        }
      )
      .then(() => {
        this.mapBusy = false
        this.mapSave(false)
        if (this.mapFails >= MAX_FAILS) {
          // Relógio longe ou celular sem internet: espera o próximo pedido.
          this.mapQueue = []
          this.mapFails = 0
          return
        }
        this.mapPump()
      })
  },

  // Prepara (cache ou internet) e envia. Se o arquivo do cache falhar, baixa de novo.
  async mapSendTile(theme, tile, total, next) {
    let ready = await this.mapPrepare(theme, tile)
    if (next && this.mapLists[next.theme] && this.mapLists[next.theme][next.i]) this.mapPrepare(next.theme, this.mapLists[next.theme][next.i]).catch(() => {})
    const send = (path) => this.mapSendFile(path, tileParams(theme, tile, total)).catch((e) => {
      throw new Error(`envio: ${errText(e)}`)
    })
    try {
      await send(ready.out)
    } catch (e) {
      if (!ready.cached) throw e
      this.mapCacheMark(theme, tile.i, false)
      ready = await this.mapPrepare(theme, tile)
      await send(ready.out)
    }
  },

  // Bloco pronto para enviar: { out, cached }. Uma preparação por bloco de cada vez.
  mapPrepare(theme, tile) {
    const key = `${theme}:${tile.i}`
    if (this.mapCacheHas(theme, tile.i)) return Promise.resolve({ out: phoneTilePath(theme, tile.k, tile.x, tile.y), cached: true })
    if (this.mapPrepared.has(key)) return this.mapPrepared.get(key)
    const p = this.mapDownloadConvert(theme, tile).then(
      (out) => {
        this.mapPrepared.delete(key)
        return { out, cached: false }
      },
      (e) => {
        this.mapPrepared.delete(key)
        throw e
      }
    )
    this.mapPrepared.set(key, p)
    return p
  },

  async mapDownloadConvert(theme, tile) {
    const png = `data://download/cob-${tile.name}`
    const converted = phoneTilePath(theme, tile.k, tile.x, tile.y)
    // Erro com a etapa na frente (diagnóstico nas configurações).
    const stage = (name) => (e) => {
      throw new Error(`${name}: ${errText(e)}`)
    }
    // Usa o caminho que o download devolve (o Zepp pode gravar em outro lugar que não
    // o pedido). Se o arquivo não estiver lá, baixa de novo no caminho padrão do Zepp.
    let src = await this.mapDownloadFile(tile.url, png).catch(stage('download'))
    let conv
    try {
      conv = await withTimeout(this.mapConvert({ filePath: src, targetFilePath: converted }), CONVERT_TIMEOUT_MS)
    } catch (e) {
      if (!/not found|no such|não encontr/i.test(errText(e))) stage('convert')(e)
      src = await this.mapDownloadFile(tile.url, null).catch(stage('download2'))
      conv = await withTimeout(this.mapConvert({ filePath: src }), CONVERT_TIMEOUT_MS).catch(stage(`convert(${String(src).slice(-28)})`))
    }
    const out = (conv && conv.targetFilePath) || converted
    if (out === converted) this.mapCacheMark(theme, tile.i, true)
    return out
  },

  // Pré-cache no celular em volta dos pontos salvos (só internet, rápido; nada vai ao
  // relógio). Anda só com a fila do relógio vazia.
  async mapWarm() {
    if (this.mapWarming || !this.mapMem) return
    this.mapWarming = true
    try {
      let favs = []
      try {
        favs = readFavorites(settingsLib)
      } catch (e) {
        favs = []
      }
      const theme = readThemeName(settingsLib)
      const list = tilesNearPoints(this.mapLists[theme], this.mapMem, favs, WARM_KM, WARM_MAX).filter((t) => !this.mapCacheHas(theme, t.i))
      for (const tile of list) {
        while (this.mapBusy || this.mapQueue.length > 0) await sleep(1000)
        try {
          await this.mapPrepare(theme, tile)
        } catch (e) {
          console.log('Mapa: pré-cache parou:', errText(e))
          break
        }
        this.mapSave(false)
        await sleep(200)
      }
    } finally {
      this.mapWarming = false
    }
  },

  mapConvert(opts) {
    // this.convert vem da zml (convertLib -> image.convert); sem ela, o global `image`.
    if (typeof this.convert === 'function') return this.convert(opts)
    return image.convert(opts) // eslint-disable-line no-undef
  },

  mapDownloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      let task = null
      let finished = false
      const end = (fn, v) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        fn(v)
      }
      const timer = setTimeout(() => {
        try {
          if (task) task.cancel()
        } catch (e) {
          // nada
        }
        end(reject, new Error('Download demorou demais'))
      }, DOWNLOAD_TIMEOUT_MS + 5000)
      try {
        const opts = filePath ? { timeout: DOWNLOAD_TIMEOUT_MS, filePath } : { timeout: DOWNLOAD_TIMEOUT_MS }
        task = typeof this.download === 'function' ? this.download(url, opts) : network.downloader.downloadFile({ url, ...opts }) // eslint-disable-line no-undef
      } catch (e) {
        end(reject, e)
        return
      }
      task.onSuccess = (ev) => {
        const code = Number(ev && ev.statusCode)
        if (code && (code < 200 || code >= 300)) end(reject, new Error(`HTTP ${code}`))
        else {
          const got = (ev && (ev.filePath || ev.tempFilePath)) || filePath
          if (!got) end(reject, new Error('Download sem caminho do arquivo'))
          else end(resolve, got)
        }
      }
      task.onFail = (ev) => end(reject, new Error(`Download falhou${ev && ev.code !== undefined ? ` (${ev.code})` : ''}`))
    })
  },

  mapSendFile(path, params) {
    return new Promise((resolve, reject) => {
      let finished = false
      const end = (fn, v) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        fn(v)
      }
      let file = null
      const timer = setTimeout(() => {
        try {
          if (file) file.cancel()
        } catch (e) {
          // nada
        }
        end(reject, new Error('Relógio não respondeu'))
      }, TRANSFER_TIMEOUT_MS)
      try {
        // Jeito da doc (transferFile.getOutbox()), com o da zml (this.sendFile) de reserva.
        const ob = typeof transferFile !== 'undefined' ? outboxOf(transferFile) : null // eslint-disable-line no-undef
        file = ob && typeof ob.enqueueFile === 'function' ? ob.enqueueFile(path, params) : this.sendFile(path, params)
      } catch (e) {
        end(reject, e)
        return
      }
      if (!file || typeof file.on !== 'function') {
        end(reject, new Error('Envio de arquivos indisponível'))
        return
      }
      file.on('change', (ev) => {
        const st = stateOf(ev)
        if (st === 'transferred') end(resolve, true)
        else if (st === 'error' || st === 'canceled') end(reject, new Error(`Envio: ${st}`))
      })
    })
  },

  // Avisa o app do relógio, se estiver aberto, que o mapa mudou (ele sincroniza).
  mapNotify(result) {
    try {
      this.call({ method: 'MAP_CHANGED', result })
    } catch (e) {
      // relógio desconectado: ele sincroniza quando abrir
    }
  },

  // Comando da tela de configurações (chave mapCommand do settingsStorage).
  mapHandleCommand(raw) {
    const cmd = parseCommand(raw)
    if (!cmd || cmd.action !== 'delete') return
    // A tela de configurações já marcou "limpando": relê do settingsStorage.
    this.mapStatesCache = null
    const doneAt = Number(settingsLib.getItem(COMMAND_DONE_KEY)) || 0
    if (cmd.at && cmd.at <= doneAt) return
    settingsLib.setItem(COMMAND_DONE_KEY, String(cmd.at || Date.now()))
    const themes = cmd.theme === 'all' ? MAP_THEMES : [cmd.theme]
    themes.forEach((t) => {
      this.mapQueue = dropTheme(this.mapQueue, t)
      this.mapSentAt[t] = {}
    })
    // Se o app do relógio estiver aberto, ele sincroniza e apaga na hora.
    this.mapNotify({ delete: themes })
  },

  // Favoritos mudaram: pré-cache em volta dos pontos novos.
  mapOnFavorites() {
    this.mapWarm().catch(() => {})
  },

  // MAP_SYNC do relógio (tela inicial): params.have = { dark: hex, light: hex }.
  // Devolve o manifesto curto, quantos blocos cada tema tem e o que apagar.
  async mapOnSync(params) {
    let manifest = null
    try {
      manifest = await this.mapManifest(false)
    } catch (e) {
      manifest = null
    }
    const have = (params && params.have) || {}
    const states = this.mapStates()
    const del = []
    const out = {}
    MAP_THEMES.forEach((t) => {
      const total = manifest ? this.mapLists[t].length : states[t].total
      const watchHex = normalizeBits(have[t], total)
      const s = cleanThemeState(states[t])
      if (s.deleting) {
        if (/[1-9a-f]/.test(watchHex)) del.push(t)
        else states[t] = { ...applyWatchBits(s, '', total), deleting: false }
      } else {
        states[t] = applyWatchBits(s, watchHex, total)
      }
      out[t] = { done: states[t].done, total }
    })
    this.mapDirty = true
    this.mapSave(true)
    return { manifest: compactManifest(manifest), themes: out, delete: del }
  }
}
