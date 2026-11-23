// Tela inicial do relógio: saudação, título "Seus pontos" e um item por ponto
// salvo com o tempo do próximo ônibus; só o ponto com o ônibus mais perto fica
// num cartão (os outros ficam soltos, sem fundo) (resumo de todos os pontos num pedido só ao celular,
// atualizado a cada 30 s).
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme, DEFAULT_THEME, etaColor, busIcon } from '../../utils/ui'
import { nearestIndex, chipColors } from '../../utils/home-list'
import { parseSettingsResult } from '../../utils/favorites'
import { etaFromSummary } from '../../shared/summary'
import { greeting } from '../../shared/text'
import { guard } from '../../utils/crash'
import { scheduleAlarms, parseAlarmParam, alertsOnNow } from '../../utils/alarms'
import { saveManifest, haveBits, deleteTheme, canReceiveFiles } from '../../utils/map-store'
// Sem conexão / celular sem internet / BHTrans fora do ar (shared/conn-errors.js).
import { ERR, parseErrorField, requestFailureCode, errorScreen } from '../../shared/conn-errors'
import { drawErrorScreen, startRetry, stopRetry, isBleConnected } from '../../utils/conn-screen'
// Cópia dos pontos salvos no relógio: a lista aparece na hora, sem esperar o celular.
// https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/
import { LocalStorage } from '@zos/storage'

const SETTINGS_CACHE_KEY = 'cob.settingsCache'
// Sem resposta do celular nesse tempo: mostra a tela de conexão em vez de esperar 60 s.
const FAVORITES_TIMEOUT_MS = 20 * 1000
let cacheStore = null
function settingsCache(value) {
  try {
    if (!cacheStore) cacheStore = new LocalStorage()
    if (value === undefined) {
      const raw = cacheStore.getItem(SETTINGS_CACHE_KEY, '')
      return raw ? JSON.parse(raw) : null
    }
    cacheStore.setItem(SETTINGS_CACHE_KEY, JSON.stringify(value))
  } catch (e) {
    // sem cache: segue esperando o celular
  }
  return null
}

const REFRESH_MS = 30 * 1000
// Tela redonda: margens maiores no topo e nas laterais.
const MARGIN = px(60)
const CONTENT_W = DEVICE_WIDTH - 2 * MARGIN
// Itens (pixels de design): o do meio é mais largo, onde a tela redonda é mais
// larga; os cantos dos itens de cima e de baixo ficam dentro do círculo.
const LIST_TOP = 128
const CARD_H = 82
const CARD_STEP = 90
const CARD_R = 26
const cardX = (i) => (i === 1 ? 54 : 66)
const ITEM_PAD = 20 // margem interna à esquerda e à direita
const ETA_W = 70 // coluna dos minutos, à direita
const CHIP_H = 32
const CHIP_R = 12
const chipW = (line) => (String(line).length > 4 ? 76 : 64)
// Espaço no fim para o último cartão poder rolar até o meio da tela redonda.
const LIST_BOTTOM_PAD = 120
// Toque que arrastou mais que isso foi rolagem, não toque.
const TAP_SLOP = 24

Page(
  BasePage({
    onInit: guard('tela inicial onInit', function (params) {
      // Estado próprio de cada abertura da página (não reaproveita o objeto do módulo).
      // Mantém o que a zml já colocou em this.state (ex.: messaging).
      // view: 'loading' | 'error' | 'list' (favorites só vale em 'list').
      const fresh = {
        widgets: [],
        cards: [], // { fav, eta, etaMin, bg, chip, chipLabel, ... } por favorito
        highlight: -1, // índice do item no cartão (ônibus mais perto) ou -1
        theme: DEFAULT_THEME,
        view: 'loading',
        favorites: [],
        summary: null, // última resposta de GET_SUMMARY
        timer: null,
        loading: false,
        dirty: false, // favoritos mudaram durante uma consulta: consulta de novo ao terminar
        openedAt: 0,
        vibrate: true,
        // Aberta pelo alarme do início da janela de um ponto: { favId } (abre esse ponto).
        alarm: null,
        mapSyncing: false,
        // Tela de erro: código (shared/conn-errors.js) e a nova tentativa automática.
        errorCode: null,
        retry: null,
        destroyed: false
      }
      // No relógio, trocar o objeto this.state não funciona: atualiza o que já existe.
      if (!this.state || typeof this.state !== 'object') this.state = {}
      Object.assign(this.state, fresh)
      // O param do alarme chega ao onInit da página (exemplo oficial) e ao onCreate do
      // app.js (doc do set): aceita os dois e consome o do app para não repetir.
      let alarm = parseAlarmParam(params)
      try {
        const g = getApp()._options.globalData
        if (!alarm) alarm = parseAlarmParam(g.launchParam)
        g.launchParam = null
      } catch (e) {
        // sem globalData
      }
      this.state.alarm = alarm
    }),

    build: guard('tela inicial build', function () {
      if (!this.state || !Array.isArray(this.state.widgets)) this.onInit()
      this.loadFavorites()
    }),

    colors() {
      return getTheme(this.state.theme)
    },

    loadFavorites() {
      const s = this.state
      if (s.destroyed) return
      stopRetry(s.retry)
      s.retry = null
      // Sem Bluetooth: nem tenta (a zml esperaria o tempo do pedido).
      if (!isBleConnected()) {
        this.showError(ERR.NO_BLE)
        return
      }
      // Mostra na hora os pontos guardados no relógio; o celular atualiza depois.
      const cached = !s.fromPhone ? settingsCache() : null
      if (cached && s.view !== 'list') this.applySettings(cached, true)
      else if (s.view !== 'list') this.setView('loading')
      this.request({ method: 'GET_FAVORITES' }, { timeout: FAVORITES_TIMEOUT_MS })
        .then(
          guard('tela inicial favoritos', ({ result } = {}) => {
            s.fromPhone = true
            settingsCache(result)
            this.applySettings(result)
          })
        )
        .catch(() => {
          // Com a lista guardada na tela, só deixa de atualizar os tempos (o resumo
          // mostra o erro); sem nada na tela, mostra a tela de conexão.
          if (s.view !== 'list') this.showError(requestFailureCode())
        })
    },

    // Tela de erro com imagem (3 casos) e nova tentativa sozinha: na volta do
    // Bluetooth (sem conexão) ou em 30 s (celular sem internet / BHTrans fora do ar).
    showError(code) {
      const s = this.state
      if (s.destroyed) return
      const c = errorScreen(code) ? code : ERR.NO_BLE
      s.errorCode = c
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      stopRetry(s.retry)
      s.retry = startRetry(c, () => {
        s.retry = null
        if (!s.destroyed && s.view === 'error') this.loadFavorites()
      })
      this.setView('error', s.favorites)
    },

    // zml: o Bluetooth mudou (BasePage liga a messaging.onBleChanged).
    onBleChanged: guard('tela inicial bluetooth', function () {
      const s = this.state
      if (!s || s.destroyed) return
      if (s.view === 'error' && s.errorCode === ERR.NO_BLE && isBleConnected()) this.loadFavorites()
      else if (s.view === 'list' && !isBleConnected()) this.showError(ERR.NO_BLE)
    }),

    // Chamado quando você muda os favoritos ou o tema no celular.
    onCall: guard('tela inicial onCall', function (data) {
      if (!data) return
      if (data.method === 'SETTINGS_CHANGED' || data.method === 'FAVORITES_CHANGED') {
        this.applySettings(data.result)
      } else if (data.method === 'MAP_CHANGED') {
        // O celular terminou/apagou o mapa: sincroniza (e apaga, se for o caso).
        this.syncMap()
      }
    }),

    applySettings(result, fromCache) {
      const { favorites, theme, vibrate } = parseSettingsResult(result, this.state.theme, this.state.vibrate)
      this.state.theme = theme
      this.state.vibrate = vibrate
      // Alarmes do sistema: próximo início de janela de cada ponto (shared/schedule.js).
      if (!fromCache) scheduleAlarms(favorites, vibrate)
      this.setView('list', favorites)
      const alarm = this.state.alarm
      if (alarm) {
        this.state.alarm = null
        const fav = favorites.find((f) => f.id === alarm.favId)
        if (fav) this.open(fav, true)
      }
      if (fromCache) return // o resumo e o mapa esperam a resposta do celular
      this.refreshSummary(true)
      this.syncMap()
    },

    // ---- Mapa de BH (sob demanda) ----

    // Conta ao celular o que o relógio tem no cache (MAP_SYNC); recebe o manifesto
    // (a tela do ponto precisa dele para posicionar os blocos) e o que apagar
    // ("Limpar mapa do relógio" no celular). Os blocos chegam na tela do ponto.
    syncMap(again) {
      const s = this.state
      if (s.destroyed || s.mapSyncing || !canReceiveFiles()) return
      s.mapSyncing = true
      this.request({ method: 'MAP_SYNC', params: { have: haveBits() } })
        .then(
          guard('tela inicial mapa', (data) => {
            s.mapSyncing = false
            const { result } = data || {}
            if (s.destroyed || !result) return
            if (result.manifest) saveManifest(result.manifest)
            const del = Array.isArray(result.delete) ? result.delete : []
            if (del.length > 0) {
              del.forEach((t) => deleteTheme(t))
              if (!again) this.syncMap(true)
            }
          })
        )
        .catch(() => {
          s.mapSyncing = false
        })
    },

    setView(view, favorites) {
      if (this.state.destroyed) return
      this.state.view = view
      this.state.favorites = favorites || []
      this.draw()
    },

    // ---- Resumo (próximo ônibus de cada ponto) ----

    // Uma consulta por vez; a próxima é agendada 30 s depois que esta termina.
    refreshSummary(now) {
      const s = this.state
      if (s.destroyed) return
      if (s.loading) {
        if (now) s.dirty = true
        return
      }
      if (s.view === 'error') return
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      if (s.view !== 'list' || s.favorites.length === 0) return
      s.loading = true
      const done = () => {
        s.loading = false
        if (s.destroyed || s.view !== 'list') return
        const again = s.dirty
        s.dirty = false
        s.timer = setTimeout(() => this.refreshSummary(false), again ? 0 : REFRESH_MS)
      }
      this.request({ method: 'GET_SUMMARY' })
        .then(
          guard('tela inicial resumo', (data) => {
            const { result, error } = data || {}
            const err = parseErrorField(error)
            // Celular sem internet ou BHTrans fora do ar: tela própria (tenta em 30 s).
            if (err && errorScreen(err.code)) {
              this.showError(err.code)
              return
            }
            this.applySummary(err ? null : result)
          })
        )
        .catch(() => this.showError(requestFailureCode()))
        .then(done, done)
    },

    applySummary(result) {
      if (this.state.destroyed) return
      this.state.summary = result
      const etas = this.state.cards.map((card, i) => etaFromSummary(result, card.fav, i))
      this.state.cards.forEach((card, i) => this.paintEta(card, etas[i]))
      // O cartão vai para o ponto com o ônibus mais perto (pode trocar de item).
      this.paintHighlight(nearestIndex(etas))
    },

    // Tempo à direita do item: minutos grandes na cor da faixa (ou "—") e "min" pequeno.
    paintEta(card, min) {
      const c = this.colors()
      if (min === null) {
        card.eta.setProperty(hmUI.prop.MORE, { text: '—', color: c.muted, text_size: px(36) })
        card.etaMin.setProperty(hmUI.prop.TEXT, '')
        return
      }
      const color = etaColor(min, this.state.theme)
      card.eta.setProperty(hmUI.prop.MORE, { text: String(min), color, text_size: px(min >= 100 ? 28 : 36) })
      card.etaMin.setProperty(hmUI.prop.MORE, { text: 'min', color: c.muted })
    },

    // Liga o cartão (fundo + selo cheio) no item `index` e desliga nos outros,
    // mexendo só nos widgets que mudam (setProperty, sem redesenhar a lista).
    paintHighlight(index) {
      const s = this.state
      const c = this.colors()
      s.cards.forEach((card, i) => {
        const hi = i === index
        if (hi === card.hi) return
        card.hi = hi
        card.bg.setProperty(hmUI.prop.MORE, { ...card.bgRect, color: c.card })
        card.bg.setProperty(hmUI.prop.VISIBLE, hi)
        const chip = chipColors(c, hi)
        card.chip.setProperty(hmUI.prop.MORE, { ...card.chipRect, color: chip.bg })
        card.chipLabel.setProperty(hmUI.prop.MORE, { color: chip.text })
      })
      s.highlight = index
    },

    // ---- Desenho ----

    clear() {
      this.state.widgets.forEach((w) => hmUI.deleteWidget(w))
      this.state.widgets = []
      this.state.cards = []
      this.state.highlight = -1
    },

    add(type, opts) {
      const w = hmUI.createWidget(type, opts)
      this.state.widgets.push(w)
      return w
    },

    text(opts) {
      return this.add(hmUI.widget.TEXT, {
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS,
        ...opts
      })
    },

    // Refaz a tela inteira: fundo, cabeçalho e conteúdo. Assim uma troca de tema
    // com a página aberta repinta tudo sem sobrar widget com a cor antiga.
    draw() {
      const c = this.colors()
      const { view, favorites } = this.state
      this.clear()

      // Fundo do tema: primeiro widget, cobre a tela e a área rolável da lista.
      const listBottom = px(LIST_TOP + favorites.length * CARD_STEP + LIST_BOTTOM_PAD)
      this.add(hmUI.widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: DEVICE_WIDTH,
        h: view === 'list' ? Math.max(DEVICE_HEIGHT, listBottom) : DEVICE_HEIGHT,
        color: c.bg
      })

      // Tela de erro (sem conexão / sem internet / BHTrans fora do ar): só ela.
      if (view === 'error') {
        drawErrorScreen((type, opts) => this.add(type, opts), {
          code: this.state.errorCode,
          theme: this.state.theme,
          colors: c,
          onRetry: () => this.loadFavorites()
        })
        return
      }

      // Saudação.
      // Saudação pequena e título (sem a barrinha colorida).
      this.text({ x: px(110), y: px(44), w: DEVICE_WIDTH - 2 * px(110), h: px(28), text: greeting(new Date().getHours()), text_size: px(21), color: c.muted })
      this.text({ x: px(80), y: px(72), w: DEVICE_WIDTH - 2 * px(80), h: px(44), text: 'Seus pontos', text_size: px(32), color: c.title })

      if (view === 'loading') {
        this.drawMessage('Carregando pontos...', null, c.muted)
      } else if (favorites.length === 0) {
        this.drawEmpty()
      } else {
        this.drawList(favorites)
      }
    },

    // Estado sem lista: carregando ou sem conexão.
    drawMessage(title, detail, titleColor) {
      const c = this.colors()
      this.text({ x: MARGIN, y: px(150), w: CONTENT_W, h: px(56), text: title, text_size: px(34), color: titleColor })
      if (detail) {
        this.text({
          x: MARGIN,
          y: px(212),
          w: CONTENT_W,
          h: px(110),
          text: detail,
          text_size: px(26),
          color: c.muted,
          align_v: hmUI.align.TOP,
          text_style: hmUI.text_style.WRAP
        })
      }
    },

    drawEmpty() {
      const c = this.colors()
      this.add(hmUI.widget.IMG, { x: px(216), y: px(176), w: px(48), h: px(48), auto_scale: true, src: busIcon(4, this.state.theme) })
      this.text({ x: MARGIN, y: px(246), w: CONTENT_W, h: px(40), text: 'Bão? Cadastre seu', text_size: px(30), color: c.text })
      this.text({ x: MARGIN, y: px(288), w: CONTENT_W, h: px(34), text: 'primeiro ponto no celular.', text_size: px(24), color: c.muted })
    },

    open(fav, fromAlarm) {
      // Evita abrir duas vezes (botão e texto por cima podem responder ao mesmo toque).
      const now = Date.now()
      if (now - this.state.openedAt < 800) return
      this.state.openedAt = now
      // vibrate já vai filtrado pela janela do ponto (a tela do ponto também confere).
      const master = this.state.vibrate
      const params = { fav, theme: this.state.theme, vibrate: master && alertsOnNow(fav, master), master }
      if (fromAlarm) params.alarm = true
      push({ url: 'page/detail/index.page', params: JSON.stringify(params) })
    },

    // O cartão e os textos ficam por cima do botão do item; se eles segurarem o
    // toque, abrem o ponto também (ignorando arrastos, que são rolagem da lista).
    // `card` (opcional): escurece o cartão destacado enquanto o dedo está nele.
    tappable(widget, fav, card) {
      let down = null
      const press = (on) => {
        if (card && card.hi) card.bg.setProperty(hmUI.prop.MORE, { ...card.bgRect, color: on ? this.colors().cardPressed : this.colors().card })
      }
      widget.addEventListener(hmUI.event.CLICK_DOWN, (info) => {
        down = info ? { x: info.x, y: info.y } : null
        press(true)
      })
      widget.addEventListener(hmUI.event.CLICK_UP, (info) => {
        const moved = down && info ? Math.hypot(info.x - down.x, info.y - down.y) : 0
        down = null
        press(false)
        if (moved <= px(TAP_SLOP)) this.open(fav)
      })
    },

    drawList(favorites) {
      const c = this.colors()
      const etas = favorites.map((fav, i) => etaFromSummary(this.state.summary, fav, i))
      const highlight = nearestIndex(etas)
      favorites.forEach((fav, i) => {
        const x = cardX(i)
        const y = LIST_TOP + i * CARD_STEP
        const w = 480 - 2 * x
        const hi = i === highlight
        // Botão do item na cor do fundo (sem borda): some no fundo e acende ao tocar.
        this.add(hmUI.widget.BUTTON, {
          x: px(x),
          y: px(y),
          w: px(w),
          h: px(CARD_H),
          radius: px(CARD_R),
          text: '',
          normal_color: c.bg,
          press_color: c.cardPressed,
          click_func: () => this.open(fav)
        })
        // Cartão (só no ônibus mais perto): FILL_RECT de cantos bem redondos, sem
        // contorno. Existe em todos os itens e liga/desliga com VISIBLE.
        const bgRect = { x: px(x), y: px(y), w: px(w), h: px(CARD_H), radius: px(CARD_R) }
        const bg = this.add(hmUI.widget.FILL_RECT, { ...bgRect, color: c.card })
        if (!hi) bg.setProperty(hmUI.prop.VISIBLE, false)
        // Selo da linha + nome na mesma linha; rua menor embaixo.
        const cw = chipW(fav.line)
        const chipRect = { x: px(x + ITEM_PAD), y: px(y + 10), w: px(cw), h: px(CHIP_H), radius: px(CHIP_R) }
        const chipCol = chipColors(c, hi)
        const chip = this.add(hmUI.widget.FILL_RECT, { ...chipRect, color: chipCol.bg })
        const chipLabel = this.text({
          x: px(x + ITEM_PAD + 2),
          y: px(y + 10),
          w: px(cw - 4),
          h: px(CHIP_H),
          text: fav.line,
          text_size: px(fav.line.length > 4 ? 17 : 20),
          color: chipCol.text
        })
        // Nome (sem negrito: o TEXT do Zepp OS não tem peso de fonte).
        const nameX = x + ITEM_PAD + cw + 10
        const name = this.text({ x: px(nameX), y: px(y + 8), w: px(x + w - ITEM_PAD - ETA_W - 8 - nameX), h: px(36), text: fav.name, text_size: px(26), color: c.text, align_h: hmUI.align.LEFT })
        const street = this.text({
          x: px(x + ITEM_PAD),
          y: px(y + 46),
          w: px(w - 2 * ITEM_PAD - ETA_W - 8),
          h: px(26),
          text: fav.street || (fav.stopId ? '' : 'ponto por coordenadas'),
          text_size: px(19),
          color: c.muted,
          align_h: hmUI.align.LEFT
        })
        // Minutos grandes à direita, "min" pequeno embaixo.
        const etaX = x + w - ITEM_PAD - ETA_W
        const eta = this.text({ x: px(etaX), y: px(y + 4), w: px(ETA_W), h: px(46), text: '—', text_size: px(36), color: c.muted, align_h: hmUI.align.RIGHT })
        const etaMin = this.text({ x: px(etaX), y: px(y + 50), w: px(ETA_W), h: px(22), text: '', text_size: px(17), color: c.muted, align_h: hmUI.align.RIGHT })
        const card = { fav, eta, etaMin, bg, bgRect, chip, chipRect, chipLabel, hi }
        ;[bg, chip, chipLabel, name, street, eta, etaMin].forEach((wd) => this.tappable(wd, fav, card))
        this.state.cards.push(card)
        this.paintEta(card, etas[i])
      })
      this.state.highlight = highlight
      // A página rola sozinha quando os itens passam da altura da tela
      // (SCROLL_MODE_FREE é o padrão do Zepp OS); o fundo já vai até o fim da lista.
    },

    onDestroy() {
      this.state.destroyed = true
      stopRetry(this.state.retry)
      this.state.retry = null
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
    }
  })
)
