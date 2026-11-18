// Download do mapa de BH no side service (celular) e envio ao relógio.
// Métodos espalhados no BaseSideService (como os módulos dos exemplos da zml).
//
// Fluxo de cada bloco, um de cada vez (fila sequencial, sem saturar o Bluetooth):
// 1. baixa o PNG da internet: network.downloader.downloadFile (this.download da zml)
//    https://docs.zepp.com/docs/reference/side-service-api/download-file/
// 2. converte para o formato de imagem do relógio: image.convert (this.convert da zml)
//    https://docs.zepp.com/docs/reference/side-service-api/image-convert/
// 3. manda ao relógio pela outbox do TransferFile (this.sendFile da zml) e espera
//    readyState 'transferred': https://docs.zepp.com/docs/reference/side-service-api/transfer-file/
// O progresso fica no settingsStorage (chave mapDownload, um estado por tema) e o
// relógio manda o mapa de bits do que já tem (MAP_SYNC), então parar no meio só
// faz continuar de onde parou. settingsStorage:
// https://docs.zepp.com/docs/reference/side-service-api/settings-storage/
import { settingsLib } from '@zeppos/zml/base-side'
import { outboxOf, readyStateOf as stateOf } from '../shared/transfer'
import { withTimeout } from '../shared/bhtrans'
import { MAP_MANIFEST_URL, MAP_THEMES, parseManifest, compactManifest, tileList, prioritizeTiles, normalizeBits, mergeBits, countBits } from '../shared/map-tiles'
import { readFavorites } from '../utils/favorites'
import {
  STATUS,
  MAP_MANIFEST_KEY,
  MAP_COMMAND_KEY,
  readMapStates,
  writeMapStates,
  applyWatchBits,
  mergeWatchBits,
  markDone,
  missingTiles,
  runQueue,
  stoppedByUser,
  parseCommand,
  tileParams
} from '../shared/map-download'

const MANIFEST_TIMEOUT_MS = 15 * 1000
const MANIFEST_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const DOWNLOAD_TIMEOUT_MS = 30 * 1000
const CONVERT_TIMEOUT_MS = 20 * 1000
const TRANSFER_TIMEOUT_MS = 90 * 1000
// Salva o progresso no settingsStorage no máximo a cada tanto (cada gravação
// redesenha a tela de configurações).
const SAVE_EVERY_MS = 1500
const COMMAND_DONE_KEY = 'mapCommandDone'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const errText = (e) => (e && e.message ? String(e.message) : String(e))

// Estado do arquivo no evento 'change' (a doc chama o campo de `date`; os exemplos, de `data`).
const readyStateOf = (ev) => {
  const d = ev && (ev.data || ev.date)
  return d && d.readyState
}

export const mapSync = {
  // Chamado no onInit do side service.
  // Pode vir antes do onInit (arquivo do relógio que acordou o side service).
  mapInit() {
    this.mapReady = true
    this.mapJob = null // { theme, stop } do tema baixando agora
    this.mapWaiting = [] // temas na fila
    this.mapStatesCache = null
    this.mapLastSave = 0
    // Manifesto em cache para a tela de configurações mostrar o tamanho.
    this.mapManifest(false).catch(() => {})
    // Comando que chegou com o side service fechado.
    this.mapHandleCommand(settingsLib.getItem(MAP_COMMAND_KEY))
    // Um download que estava em andamento continua (se o relógio não estiver por
    // perto, a fila pausa e volta quando o app do relógio abrir).
    const states = this.mapStates()
    MAP_THEMES.forEach((t) => {
      if (states[t].status === STATUS.DOWNLOADING) this.mapStart(t)
    })
  },

  mapStates() {
    if (!this.mapStatesCache) this.mapStatesCache = readMapStates(settingsLib)
    return this.mapStatesCache
  },

  // force: grava já (mudança de status); senão no máximo a cada SAVE_EVERY_MS.
  mapSave(force) {
    const now = Date.now()
    if (!force && now - this.mapLastSave < SAVE_EVERY_MS) return
    this.mapLastSave = now
    const mine = this.mapStatesCache || this.mapStates()
    // A tela de configurações muda o estado direto (pausar/apagar): não sobrescrever.
    const stored = readMapStates(settingsLib)
    MAP_THEMES.forEach((t) => {
      if (stoppedByUser(stored[t]) && mine[t].status === STATUS.DOWNLOADING) {
        mine[t] = { ...mine[t], status: stored[t].status, byUser: stored[t].byUser, step: '' }
        this.mapStopTheme(t)
      }
    })
    this.mapStatesCache = writeMapStates(settingsLib, mine)
  },

  mapSet(theme, patch, force = true) {
    const states = this.mapStates()
    states[theme] = { ...states[theme], ...patch, updatedAt: Date.now() }
    this.mapSave(force)
  },

  // Manifesto validado (cache de 7 dias no settingsStorage; force = baixa de novo).
  async mapManifest(force) {
    let cached = null
    try {
      cached = JSON.parse(settingsLib.getItem(MAP_MANIFEST_KEY) || 'null')
    } catch (e) {
      cached = null
    }
    const fresh = cached && cached.manifest && Date.now() - (Number(cached.at) || 0) < MANIFEST_MAX_AGE_MS
    if (fresh && !force) {
      const m = parseManifest(cached.manifest)
      if (m) return m
    }
    try {
      const res = await withTimeout(this.fetch({ url: MAP_MANIFEST_URL, method: 'GET', timeout: MANIFEST_TIMEOUT_MS }), MANIFEST_TIMEOUT_MS)
      const status = Number(res && res.status)
      if (!(status >= 200 && status < 300)) throw new Error(`HTTP ${res && res.status}`)
      const m = parseManifest(res.body)
      if (!m) throw new Error('Manifesto do mapa inválido')
      settingsLib.setItem(MAP_MANIFEST_KEY, JSON.stringify({ at: Date.now(), manifest: m }))
      return m
    } catch (e) {
      // Sem internet: usa o cache velho se houver.
      const m = cached && parseManifest(cached.manifest)
      if (m) return m
      throw e
    }
  },

  // Etapa do bloco atual, para a tela de configurações mostrar onde está.
  mapStep(theme, text) {
    const states = this.mapStates()
    states[theme] = { ...states[theme], step: text, stepAt: Date.now() }
    this.mapSave(false)
  },

  // Põe o tema na fila (não roda dois downloads ao mesmo tempo).
  mapStart(theme) {
    if (MAP_THEMES.indexOf(theme) < 0) return
    const st = this.mapStates()[theme]
    if (st.status !== STATUS.READY) this.mapSet(theme, { status: STATUS.DOWNLOADING, error: '', byUser: false })
    if (this.mapJob && this.mapJob.theme === theme && !this.mapJob.stop) return
    if (this.mapWaiting.indexOf(theme) < 0) this.mapWaiting.push(theme)
    // Um job parado ainda pode estar terminando o bloco atual: o próximo só
    // começa quando ele acabar (mapPump no fim do job).
    if (!this.mapJob) this.mapPump()
  },

  mapPump() {
    const theme = this.mapWaiting.shift()
    if (!theme) return
    const job = { theme, stop: false }
    this.mapJob = job
    this.mapRunTheme(job)
      .catch((e) => {
        console.log('Mapa: erro', errText(e))
        if (!job.stop) this.mapSet(theme, { status: STATUS.ERROR, error: errText(e).slice(0, 100) })
      })
      .then(() => {
        if (this.mapJob === job) this.mapJob = null
        if (!this.mapJob) this.mapPump()
      })
  },

  async mapRunTheme(job) {
    const { theme } = job
    const manifest = await this.mapManifest(false)
    const list = tileList(manifest, theme)
    if (list.length === 0) throw new Error('Tema sem mapa')
    const states = this.mapStates()
    const st = states[theme]
    const total = list.length
    if (st.total !== total) states[theme] = { ...st, total, have: normalizeBits(st.total === total ? st.have : '', total) }
    // Primeiro a cidade no zoom afastado, depois os arredores dos seus pontos.
    let favs = []
    try {
      favs = readFavorites(settingsLib)
    } catch (e) {
      favs = []
    }
    const missing = prioritizeTiles(missingTiles(list, states[theme].have), manifest, favs)
    // Enquanto um bloco vai pelo Bluetooth, o próximo já é baixado e convertido.
    const prepared = new Map()
    const prepare = (tile) => {
      if (!prepared.has(tile.i)) prepared.set(tile.i, this.mapPrepareTile(theme, tile))
      return prepared.get(tile.i)
    }
    const pos = new Map(missing.map((t, k) => [t.i, k]))
    if (missing.length === 0) {
      this.mapSet(theme, { status: STATUS.READY, error: '' })
      this.mapNotify({ theme })
      return
    }
    this.mapSet(theme, { status: STATUS.DOWNLOADING, error: '' })
    const result = await runQueue({
      tiles: missing,
      gapMs: 0,
      process: async (tile) => {
        let ready
        try {
          ready = await prepare(tile)
        } catch (e) {
          prepared.delete(tile.i) // tenta de novo do zero
          throw e
        }
        const next = missing[pos.get(tile.i) + 1]
        if (next && !job.stop) prepare(next).catch(() => {})
        this.mapStep(theme, `bloco ${tile.i + 1}: enviando ao relógio`)
        try {
          await this.mapSendFile(ready.out, tileParams(theme, tile, total))
        } finally {
          prepared.delete(tile.i)
        }
      },
      onDone: (tile) => {
        if (job.stop) return
        const s = this.mapStates()
        s[theme] = markDone(s[theme], tile.i)
        this.mapSave(s[theme].status === STATUS.READY)
      },
      onFail: (tile, err, tries) => {
        console.log(`Mapa: bloco ${tile.name} falhou (${tries}):`, errText(err))
        this.mapStep(theme, `bloco ${tile.i + 1}: falhou (tentativa ${tries}): ${errText(err).slice(0, 60)}`)
      },
      // Para também se a pessoa pausou/apagou na tela de configurações.
      shouldStop: () => job.stop || stoppedByUser(readMapStates(settingsLib)[theme]),
      wait: sleep
    })
    if (job.stop) return
    if (result.status === 'failed') {
      this.mapSet(theme, { status: STATUS.PAUSED, error: `Parou: ${String(result.error || 'erro desconhecido').slice(0, 70)}. Continua quando abrir o app no relógio.`, byUser: false })
      return
    }
    const s = this.mapStates()[theme]
    this.mapSet(theme, { status: s.done >= s.total ? STATUS.READY : STATUS.PAUSED })
    if (s.done >= s.total) this.mapNotify({ theme })
  },

  // Baixa e converte um bloco (sem enviar). Resolve com { out } (arquivo pronto).
  async mapPrepareTile(theme, tile) {
    const png = `data://download/cob-${tile.name}`
    const converted = `data://download/cob-c-${tile.name}`
    const n = tile.i + 1
    this.mapStep(theme, `bloco ${n}: baixando da internet`)
    await this.mapDownloadFile(tile.url, png)
    this.mapStep(theme, `bloco ${n}: convertendo`)
    const conv = await withTimeout(this.mapConvert({ filePath: png, targetFilePath: converted }), CONVERT_TIMEOUT_MS)
    const out = (conv && conv.targetFilePath) || converted
    const size = conv && conv.options && Number(conv.options.size)
    if (size > 0) {
      const s = this.mapStates()
      s[theme] = { ...s[theme], stored: (s[theme].stored || 0) + size }
    }
    return { out }
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
        const opts = { timeout: DOWNLOAD_TIMEOUT_MS, filePath }
        task = typeof this.download === 'function' ? this.download(url, opts) : network.downloader.downloadFile({ url, ...opts }) // eslint-disable-line no-undef
      } catch (e) {
        end(reject, e)
        return
      }
      task.onSuccess = (ev) => {
        const code = Number(ev && ev.statusCode)
        if (code && (code < 200 || code >= 300)) end(reject, new Error(`HTTP ${code}`))
        else end(resolve, (ev && (ev.filePath || ev.tempFilePath)) || filePath)
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

  // Para o tema (pausar/apagar).
  mapStopTheme(theme) {
    this.mapWaiting = this.mapWaiting.filter((t) => t !== theme)
    // O job segue em this.mapJob até o bloco atual terminar; aí o próximo começa.
    if (this.mapJob && this.mapJob.theme === theme) this.mapJob.stop = true
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
    if (!cmd) return
    // A tela de configurações já mudou o estado: relê do settingsStorage.
    this.mapStatesCache = null
    const doneAt = Number(settingsLib.getItem(COMMAND_DONE_KEY)) || 0
    if (cmd.at && cmd.at <= doneAt) return
    settingsLib.setItem(COMMAND_DONE_KEY, String(cmd.at || Date.now()))
    const themes = cmd.theme === 'all' ? MAP_THEMES : [cmd.theme]
    if (cmd.action === 'download') {
      themes.forEach((t) => this.mapStart(t))
    } else if (cmd.action === 'pause') {
      themes.forEach((t) => {
        this.mapStopTheme(t)
        if (this.mapStates()[t].status === STATUS.DOWNLOADING) this.mapSet(t, { status: STATUS.PAUSED, error: '', byUser: true })
      })
    } else if (cmd.action === 'delete') {
      themes.forEach((t) => {
        this.mapStopTheme(t)
        const s = this.mapStates()[t]
        if (s.status !== STATUS.NONE || s.done > 0) this.mapSet(t, { status: STATUS.DELETING, error: '' })
      })
      // Se o app do relógio estiver aberto, ele sincroniza e apaga na hora.
      this.mapNotify({ delete: themes })
    }
  },

  // MAP_SYNC do relógio: params.have = { dark: hex, light: hex } do que ele tem.
  // Devolve o manifesto curto, o estado de cada tema e o que apagar.
  // params.merge: veio do App Service do relógio (que pode não enxergar tudo o que o
  // app guardou): só soma bits, não tira nem apaga.
  async mapOnSync(params) {
    const merge = !!(params && params.merge)
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
      const total = manifest ? tileList(manifest, t).length : states[t].total
      const running = !!this.mapJob && this.mapJob.theme === t && !this.mapJob.stop
      const watchHex = normalizeBits(have[t], total)
      if (merge && states[t].status !== STATUS.DELETING) {
        states[t] = mergeWatchBits(states[t], watchHex, total)
      } else if (merge) {
        // apagando: espera o app do relógio abrir
      } else if (states[t].status === STATUS.DELETING) {
        if (countBits(watchHex, total) > 0) del.push(t)
        else states[t] = { ...states[t], status: STATUS.NONE, have: '', done: 0, stored: 0, error: '' }
      } else if (running) {
        // Rodando: só soma (o relógio pode ainda não ter registrado o último bloco).
        states[t] = { ...states[t], total, have: mergeBits(states[t].have, watchHex, total) }
      } else {
        states[t] = applyWatchBits(states[t], watchHex, total)
      }
      // Parou no meio sozinho (relógio longe, side service reiniciado): continua
      // agora. Pausado pela pessoa nas configurações fica pausado.
      const st = states[t].status
      const resume = !running && (st === STATUS.DOWNLOADING || (st === STATUS.PAUSED && !states[t].byUser)) && states[t].done < states[t].total
      out[t] = { status: states[t].status, done: states[t].done, total, bytes: manifest && manifest.themes[t] ? manifest.themes[t].bytes : 0 }
      if (resume && this.mapWaiting.indexOf(t) < 0) this.mapWaiting.push(t)
    })
    this.mapSave(true)
    if (!this.mapJob) this.mapPump()
    return { manifest: compactManifest(manifest), themes: out, delete: del }
  },

  // MAP_DOWNLOAD do relógio ("Baixar" no aviso): { theme, have }.
  async mapOnDownload(params) {
    const theme = params && params.theme
    if (MAP_THEMES.indexOf(theme) < 0) throw new Error('Tema inválido')
    const sync = await this.mapOnSync({ have: params.have })
    this.mapStart(theme)
    return sync
  }
}
