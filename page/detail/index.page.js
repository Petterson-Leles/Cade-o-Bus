// Tela de um ponto: número grande do ônibus que chega primeiro à esquerda, mini
// mapa à direita e os seguintes numa linha embaixo.
// O mini mapa chega pronto do celular, já em pixels e já enquadrado: no zoom
// automático o celular escolhe a escala para caber o ônibus e o ponto; girar a
// coroa (ou tocar em +/−) pede o mapa noutra escala e tocar no mapa volta ao
// automático. Atualiza 30 s após cada resposta.
//
// Nomes de ruas: ainda não há ruas no relógio. Elas vão entrar como imagens
// (blocos do mapa baixados pelo celular) desenhadas no mapCanvas antes do
// trajeto, em drawMap(); ver README, seção "Mapa da tela do ponto".
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { onDigitalCrown, offDigitalCrown } from '@zos/interaction'
import { BasePage } from '@zeppos/zml/base-page'
import {
  DEVICE_WIDTH,
  DEVICE_HEIGHT,
  getTheme,
  etaColor,
  etaLabel,
  busIcon,
  passedBusIcon,
  mixColor,
  BUS_ICON_SIZE,
  ROUTE_HIGHLIGHT,
  TRAIL_COLOR,
  CHIP_BG,
  CHIP_TEXT
} from '../../utils/ui'
import { parseDetailParams, parseSettingsResult } from '../../utils/favorites'
import { mapOffset, etaFontSize, infoLine, parseBusesResult } from '../../utils/detail-view'
import { animationPath, advanceAlong, blend } from '../../shared/route-map'
import { MAP_BUS_MAX_R, DEFAULT_PX_PER_KM, zoomByCrown, zoomStep } from '../../shared/map-frame'
import { fadeFrame, passedKey, PASS_PILL_MS } from '../../shared/passing'
import { scaleLabel } from '../../shared/text'
import { guard } from '../../utils/crash'

const REFRESH_MS = 30 * 1000
// Animação do ícone do ônibus ao longo do trajeto: um passo por segundo (bateria).
const ANIM_MS = 1000
// Para sozinha depois disso sem posição nova (consulta atrasada ou sem resposta).
const ANIM_MAX_MS = 45 * 1000
// Diferença até isso (px de design) entre o ícone e a posição nova: correção suave
// em ANIM_FIX_STEPS passos; acima, pula direto.
const ANIM_FIX_MAX_PX = 30
const ANIM_FIX_STEPS = 2
// Sumiço do ônibus que passou: um quadro a cada 100 ms durante ~4,5 s.
const FADE_FRAME_MS = 100
const DOTS_MS = 500
const MAX_OTHERS = 2
// Posição do GPS mais velha que isso ganha aviso.
const STALE_SEC = 120
// Espera a coroa parar de girar antes de pedir o mapa na escala nova.
const ZOOM_DEBOUNCE_MS = 450
// Abaixo dessa escala os pontos da linha ficam de fora (viram poluição).
const MIN_K_FOR_STOPS = 60

// Coluna do número (esquerda) e área do mini mapa (direita), em pixels de design.
const NUM_X = 40
const NUM_W = 190
const MAP_CX = 340
const MAP_CY = 236
const MAP_RING_R = 120 // borda do mapa (o conteúdo vai até MAP_VIEW_R = 114)
const BUS_HALF = BUS_ICON_SIZE / 2
const OTHER_R = 7 // marcadores dos seguintes
const LINE_STOP_R = 4 // outros pontos da linha
const TRAIL_R = 2 // bolinhas do rastro
const ROUTE_W = 4 // espessura do trajeto
const HI_W = 7 // espessura do trecho ônibus -> ponto
const ZOOM_BTN = 40
// Canvas do trajeto: quadrado em volta do anel.
const CANVAS_X = MAP_CX - MAP_RING_R
const CANVAS_Y = MAP_CY - MAP_RING_R
const CANVAS_SIZE = 2 * MAP_RING_R
// Coordenada do mapa (relativa ao centro, pixels de design) -> pixel do canvas.
const cv = (v) => px(MAP_RING_R + v)

// Largura centralizada que cabe na tela redonda a partir de uma margem lateral.
const box = (margin) => ({ x: margin, w: DEVICE_WIDTH - 2 * margin })

function ageText(sec) {
  if (sec === null || sec === undefined) return ''
  if (sec < 60) return `GPS há ${sec} s`
  return `GPS há ${Math.round(sec / 60)} min`
}

Page(
  BasePage({
    onInit: guard('tela do ponto onInit', function (params) {
      // Estado próprio de cada abertura da página (não reaproveita o objeto do módulo).
      // Mantém o que a zml já colocou em this.state (ex.: messaging).
      // view guarda o que está na tela para poder repintar ao trocar o tema:
      // { kind: 'loading' } | { kind: 'status', title, detail, role } | { kind: 'data', result }.
      const { fav, theme } = parseDetailParams(params)
      this.state = {
        ...this.state,
        fav,
        theme,
        timer: null,
        dotsTimer: null,
        anim: null, // { timer, path, speed, startedAt, src, fixFrom, fixStep, target }
        busPos: null, // posição atual do ícone (px de design, relativa ao centro do mapa)
        map: null, // último mapa recebido (já validado)
        lastFrame: null, // enquadramento do mapa em que busPos foi calculada
        zoom: null, // null = automático; número = px por km pedido pela coroa/botões
        zoomTimer: null,
        again: false, // pedir de novo assim que a consulta atual terminar
        fade: null, // sumiço do ônibus que passou { timer, startedAt, pos, level }
        pillTimer: null,
        passKey: '', // último "passou" já mostrado (não repete)
        hasData: false,
        loading: false,
        destroyed: false,
        view: { kind: 'loading' },
        footerText: '',
        all: [],
        w: {}
      }
    }),

    colors() {
      return getTheme(this.state.theme)
    },

    // Todo widget criado entra em state.all para poder ser apagado ao repintar.
    widget(type, opts) {
      const x = hmUI.createWidget(type, opts)
      this.state.all.push(x)
      return x
    },

    text(opts) {
      return this.widget(hmUI.widget.TEXT, {
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS,
        text: '',
        ...opts
      })
    },

    circle(r, color) {
      return this.widget(hmUI.widget.CIRCLE, { center_x: px(MAP_CX), center_y: px(MAP_CY), radius: px(r), color })
    },

    build: guard('tela do ponto build', function () {
      this.createWidgets()
      // Coroa digital: zoom manual do mapa (só um ouvinte por página; sai no onDestroy).
      onDigitalCrown({ callback: (key, degree) => this.onCrown(degree) })
      if (!this.state.fav) {
        this.showStatus('Ponto inválido', 'Volte e escolha o ponto de novo.', 'error')
        return
      }
      this.showLoading()
      this.refresh()
    }),

    createWidgets() {
      const c = this.colors()
      const fav = this.state.fav || { name: '?', line: '?' }
      const w = (this.state.w = {})

      // Fundo do tema: primeiro widget, cobre a tela toda.
      this.widget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: DEVICE_WIDTH, h: DEVICE_HEIGHT, color: c.bg })

      // Mapa (direita): anel fino, trajeto no canvas, marcadores por cima.
      // Fica embaixo dos textos da coluna da esquerda, que podem encostar na borda.
      w.mapRing = this.circle(MAP_RING_R, c.divider)
      w.mapInner = this.circle(MAP_RING_R - 2, c.bg)
      w.mapCanvas = this.widget(hmUI.widget.CANVAS, { x: px(CANVAS_X), y: px(CANVAS_Y), w: px(CANVAS_SIZE), h: px(CANVAS_SIZE) })
      // Tocar no mapa volta ao zoom automático.
      w.mapCanvas.addEventListener(hmUI.event.CLICK_UP, () => this.backToAuto())
      // Seu ponto: halo verde-azulado, anel branco e miolo verde-azulado.
      w.stopHalo = this.circle(13, mixColor(c.bg, CHIP_BG, 0.3))
      w.stopWhite = this.circle(10, 0xffffff)
      w.stopDot = this.circle(7, CHIP_BG)
      // Ônibus que acabou de passar (cinza, some devagar) e o rótulo "passou".
      w.passedIcon = this.widget(hmUI.widget.IMG, {
        x: px(MAP_CX - BUS_HALF),
        y: px(MAP_CY - BUS_HALF),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        auto_scale: true,
        src: passedBusIcon(100, this.state.theme)
      })
      w.passedLabel = this.text({ x: px(MAP_CX - 50), y: px(MAP_CY + 22), w: px(100), h: px(24), text: 'passou', text_size: px(18), color: c.muted })
      this.setVisible([w.passedIcon, w.passedLabel], false)
      // Ônibus seguintes (menores, cinza) e o primeiro por cima, na cor do tempo.
      w.otherDots = []
      for (let i = 0; i < MAX_OTHERS; i++) w.otherDots.push(this.circle(OTHER_R, c.muted))
      // src é relativo à pasta assets do target (assets/common.r/).
      w.busDot = this.widget(hmUI.widget.IMG, {
        x: px(MAP_CX - BUS_HALF),
        y: px(MAP_CY - BUS_HALF),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        auto_scale: true,
        src: busIcon(null, this.state.theme)
      })
      // Zoom sem coroa: botões pequenos na borda direita do mapa.
      const zoomBtn = (y, text, dir) =>
        this.widget(hmUI.widget.BUTTON, {
          x: px(MAP_CX + MAP_RING_R - ZOOM_BTN + 4),
          y: px(y),
          w: px(ZOOM_BTN),
          h: px(ZOOM_BTN),
          radius: px(ZOOM_BTN / 2),
          text,
          text_size: px(28),
          color: c.text,
          normal_color: c.divider,
          press_color: c.route,
          click_func: () => this.zoomBy(dir)
        })
      w.zoomIn = zoomBtn(MAP_CY - 70, '+', 1)
      w.zoomOut = zoomBtn(MAP_CY + 30, '−', -1)

      // Cabeçalho pequeno: "Casa · Linha 9250".
      this.text({ ...box(px(110)), y: px(44), h: px(34), text: `${fav.name} · Linha ${fav.line}`, text_size: px(24), color: c.muted })

      // Coluna da esquerda: número grande (cor pela proximidade), "min" e rótulo.
      w.eta = this.text({ x: px(NUM_X), y: px(92), w: px(NUM_W), h: px(200), text_size: px(190), color: c.eta })
      w.etaMin = this.text({ x: px(NUM_X), y: px(268), w: px(NUM_W), h: px(40), text_size: px(32), color: c.text, text: 'min' })
      w.etaLabel = this.text({ x: px(30), y: px(306), w: px(210), h: px(32), text_size: px(24), color: c.eta })
      // Aviso de GPS velho, embaixo do rótulo.
      w.etaAge = this.text({ x: px(40), y: px(338), w: px(200), h: px(24), text_size: px(18), color: c.error })

      // Linha de baixo: distância e os próximos ônibus; rodapé com a escala do mapa.
      w.info = this.text({ ...box(px(70)), y: px(360), h: px(30), text_size: px(22), color: c.muted })
      w.footer = this.text({ ...box(px(66)), y: px(392), h: px(26), text_size: px(17), color: c.muted })
      w.footer.setProperty(hmUI.prop.TEXT, this.state.footerText)

      // Pílula "Esse passou · vem o próximo" (por cima de tudo, some sozinha).
      w.pill = this.widget(hmUI.widget.FILL_RECT, { x: px(105), y: px(84), w: px(270), h: px(36), radius: px(18), color: CHIP_BG })
      w.pillText = this.text({ x: px(110), y: px(84), w: px(260), h: px(36), text: 'Esse passou · vem o próximo', text_size: px(18), color: CHIP_TEXT })
      this.setVisible([w.pill, w.pillText], false)

      // Estados sem dados (carregando, erro, sem conexão): título + detalhe.
      w.statusTitle = this.text({ ...box(px(60)), y: px(160), h: px(56), text_size: px(36), color: c.text })
      w.statusDetail = this.text({
        ...box(px(70)),
        y: px(220),
        h: px(110),
        text_size: px(26),
        color: c.muted,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP
      })
    },

    setFooter(text) {
      this.state.footerText = text
      this.state.w.footer.setProperty(hmUI.prop.TEXT, text)
    },

    // Tema mudou no celular com a página aberta: apaga e recria os widgets com
    // as cores novas e repõe o que estava na tela. A consulta em andamento e o
    // timer seguem iguais (show() usa sempre state.w atual).
    onCall: guard('tela do ponto onCall', function (data) {
      if (!data || this.state.destroyed) return
      if (data.method !== 'SETTINGS_CHANGED' && data.method !== 'FAVORITES_CHANGED') return
      const { theme } = parseSettingsResult(data.result, this.state.theme)
      if (theme === this.state.theme) return
      this.state.theme = theme
      this.repaint()
    }),

    repaint() {
      const view = this.state.view
      const footer = this.state.footerText
      this.stopDots()
      this.stopAnim()
      this.stopPassed()
      this.state.busPos = null
      this.state.all.forEach((x) => hmUI.deleteWidget(x))
      this.state.all = []
      this.createWidgets()
      if (view.kind === 'data') this.show(view.result, null)
      else if (view.kind === 'status') this.showStatus(view.title, view.detail, view.role)
      else this.showLoading()
      this.setFooter(footer)
    },

    setVisible(widgets, visible) {
      widgets.forEach((x) => x.setProperty(hmUI.prop.VISIBLE, visible))
    },

    dataWidgets() {
      const w = this.state.w
      return [
        w.eta, w.etaMin, w.etaLabel, w.etaAge, w.info,
        w.mapRing, w.mapInner, w.stopHalo, w.stopWhite, w.stopDot,
        ...w.otherDots, w.busDot, w.zoomIn, w.zoomOut
      ]
    },

    // ---- Zoom ----

    currentK() {
      const s = this.state
      if (s.zoom !== null) return s.zoom
      return s.map && s.map.k ? s.map.k : DEFAULT_PX_PER_KM
    },

    onCrown(degree) {
      if (this.state.destroyed || !this.state.hasData || !this.state.map) return
      this.setZoom(zoomByCrown(this.currentK(), degree))
    },

    zoomBy(dir) {
      if (this.state.destroyed || !this.state.hasData || !this.state.map) return
      this.setZoom(zoomStep(this.currentK(), dir))
    },

    // Zoom manual: mostra a escala nova na hora e pede o mapa quando a coroa parar.
    setZoom(k) {
      const s = this.state
      if (k === s.zoom) return
      s.zoom = k
      this.setFooter(scaleLabel(k, false))
      if (s.zoomTimer) clearTimeout(s.zoomTimer)
      s.zoomTimer = setTimeout(() => {
        s.zoomTimer = null
        this.refreshNow()
      }, ZOOM_DEBOUNCE_MS)
    },

    backToAuto() {
      const s = this.state
      if (s.destroyed || s.zoom === null) return
      s.zoom = null
      if (s.zoomTimer) clearTimeout(s.zoomTimer)
      s.zoomTimer = null
      this.setFooter('zoom automático')
      this.refreshNow()
    },

    refreshNow() {
      if (this.state.destroyed) return
      if (this.state.loading) this.state.again = true
      else this.refresh()
    },

    // ---- Ônibus em movimento ----

    // Ícone do ônibus na posição { x, y } (px de design, relativa ao centro do mapa).
    moveBus(pos, src) {
      this.state.busPos = { x: pos.x, y: pos.y }
      this.state.w.busDot.setProperty(hmUI.prop.MORE, {
        x: px(Math.round(MAP_CX + pos.x - BUS_HALF)),
        y: px(Math.round(MAP_CY + pos.y - BUS_HALF)),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        src
      })
    },

    // Desliza o ícone pela polyline (do ônibus ao ponto) a speed px/s.
    // fixFrom: posição antiga do ícone, para uma correção curta até o caminho novo;
    // target: posição real nova (usada quando não há caminho para andar).
    startAnim(path, speed, src, fixFrom, target) {
      this.stopAnim()
      if (this.state.destroyed) return
      const moving = path.length >= 4 && speed > 0
      if (!moving && !fixFrom) return
      const anim = { timer: null, path, speed: moving ? speed : 0, startedAt: Date.now(), src, fixFrom, fixStep: 0, target }
      this.state.anim = anim
      anim.timer = setInterval(() => this.animStep(anim), ANIM_MS)
    },

    animStep(anim) {
      if (this.state.destroyed || this.state.anim !== anim) return
      const elapsed = Date.now() - anim.startedAt
      if (elapsed > ANIM_MAX_MS) {
        this.stopAnim()
        return
      }
      let pos = advanceAlong(anim.path, (anim.speed * elapsed) / 1000)
      const done = !pos || pos.done
      if (!pos) pos = anim.target
      if (anim.fixFrom && anim.fixStep < ANIM_FIX_STEPS) {
        anim.fixStep++
        pos = blend(anim.fixFrom, pos, anim.fixStep / ANIM_FIX_STEPS)
      }
      this.moveBus(pos, anim.src)
      // Chegou ao ponto do usuário e a correção acabou: para até a próxima posição.
      if (done && !(anim.fixFrom && anim.fixStep < ANIM_FIX_STEPS)) this.stopAnim()
    },

    stopAnim() {
      const anim = this.state.anim
      if (anim && anim.timer) clearInterval(anim.timer)
      this.state.anim = null
    },

    // ---- "Esse passou · vem o próximo" ----

    // passed: { x, y, vehicle, at } (px relativos ao centro do mapa). Mostra o ônibus
    // em cinza com "passou", some com ease-in-out em ~4,5 s e mostra a pílula por ~3,5 s.
    showPassed(passed) {
      const s = this.state
      const key = passedKey(passed)
      if (!key || key === s.passKey) return
      s.passKey = key
      this.stopPassed()
      const w = s.w
      const fade = { timer: null, startedAt: Date.now(), pos: { x: passed.x, y: passed.y } }
      s.fade = fade
      this.setVisible([w.passedIcon, w.passedLabel, w.pill, w.pillText], true)
      this.fadeStep(fade)
      fade.timer = setInterval(() => this.fadeStep(fade), FADE_FRAME_MS)
      s.pillTimer = setTimeout(() => {
        s.pillTimer = null
        if (!s.destroyed) this.setVisible([s.w.pill, s.w.pillText], false)
      }, PASS_PILL_MS)
    },

    // Cada quadro troca o ícone esmaecido (80/60/40/20 %) e ajusta o alpha do IMG:
    // com alpha o sumiço é contínuo; sem ele, fica em degraus pelos ícones.
    fadeStep(fade) {
      const s = this.state
      if (s.destroyed || s.fade !== fade) return
      const w = s.w
      const f = fadeFrame(Date.now() - fade.startedAt)
      if (f.done) {
        this.stopPassed(true)
        return
      }
      const x = Math.round(MAP_CX + fade.pos.x)
      const y = Math.round(MAP_CY + fade.pos.y)
      w.passedIcon.setProperty(hmUI.prop.MORE, {
        x: px(x - BUS_HALF),
        y: px(y - BUS_HALF),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        src: passedBusIcon(f.level, s.theme),
        alpha: f.alpha
      })
      // TEXT não tem alpha: a cor vai do cinza ao fundo.
      const c = this.colors()
      w.passedLabel.setProperty(hmUI.prop.MORE, {
        x: px(x - 50),
        y: px(y + BUS_HALF - 2),
        w: px(100),
        h: px(24),
        color: mixColor(c.muted, c.bg, 1 - f.opacity)
      })
    },

    // keepPill: o sumiço acabou, mas a pílula segue até o seu próprio tempo.
    stopPassed(keepPill) {
      const s = this.state
      if (s.fade && s.fade.timer) clearInterval(s.fade.timer)
      s.fade = null
      const w = s.w
      if (w.passedIcon) this.setVisible([w.passedIcon, w.passedLabel], false)
      if (keepPill) return
      if (s.pillTimer) clearTimeout(s.pillTimer)
      s.pillTimer = null
      if (w.pill) this.setVisible([w.pill, w.pillText], false)
    },

    // ---- Mapa ----

    clearMap() {
      const canvas = this.state.w.mapCanvas
      if (canvas) canvas.clear({ x: 0, y: 0, w: px(CANVAS_SIZE), h: px(CANVAS_SIZE) })
    },

    // Trajeto, trecho destacado, rastro e pontos da linha no canvas; o seu ponto
    // em widgets por cima. map já vem validado (parseBusesResult), em pixels
    // relativos ao centro do mapa; null = só o anel e o ponto no centro.
    drawMap(map) {
      const w = this.state.w
      const c = this.colors()
      this.clearMap()
      const canvas = w.mapCanvas
      // (Futuro) Ruas: blocos de imagem do mapa entram aqui, antes do trajeto,
      // com canvas.drawImage; o celular manda quais blocos e onde (README).
      const lines = (pieces, color, width) => {
        if (!pieces.length) return
        canvas.setPaint({ color, line_width: px(width) })
        pieces.forEach((flat) => {
          for (let i = 0; i + 3 < flat.length; i += 2) {
            canvas.drawLine({ x1: cv(flat[i]), y1: cv(flat[i + 1]), x2: cv(flat[i + 2]), y2: cv(flat[i + 3]), color })
          }
        })
      }
      if (map) {
        lines(map.route, c.route, ROUTE_W)
        lines(map.hi, ROUTE_HIGHLIGHT, HI_W)
        // Pontilhado coral sobre o caminho que o ônibus já fez (fica parado no mapa).
        for (let i = 0; i + 1 < map.trail.length; i += 2) {
          canvas.drawCircle({ center_x: cv(map.trail[i]), center_y: cv(map.trail[i + 1]), radius: px(TRAIL_R), color: TRAIL_COLOR })
        }
        // Outros pontos da linha: bolinha vazada (só com zoom suficiente).
        if (!map.k || map.k >= MIN_K_FOR_STOPS) {
          canvas.setPaint({ color: c.muted, line_width: px(2) })
          for (let i = 0; i + 1 < map.stops.length; i += 2) {
            const cx = cv(map.stops[i])
            const cy = cv(map.stops[i + 1])
            canvas.drawCircle({ center_x: cx, center_y: cy, radius: px(LINE_STOP_R), color: c.bg })
            canvas.strokeCircle({ center_x: cx, center_y: cy, radius: px(LINE_STOP_R), color: c.muted })
          }
        }
      }
      const stop = map ? map.stop : { x: 0, y: 0 }
      const at = { center_x: px(MAP_CX + stop.x), center_y: px(MAP_CY + stop.y) }
      w.stopHalo.setProperty(hmUI.prop.MORE, { ...at, radius: px(13), color: mixColor(c.bg, CHIP_BG, 0.3) })
      w.stopWhite.setProperty(hmUI.prop.MORE, { ...at, radius: px(10), color: 0xffffff })
      w.stopDot.setProperty(hmUI.prop.MORE, { ...at, radius: px(7), color: CHIP_BG })
    },

    stopDots() {
      if (this.state.dotsTimer) clearInterval(this.state.dotsTimer)
      this.state.dotsTimer = null
    },

    // Carregando: pontinhos animados para mostrar que o app está trabalhando.
    showLoading() {
      this.showStatus('Procurando ônibus', 'Peraí, consultando a BHTrans pelo celular', 'text')
      this.state.view = { kind: 'loading' }
      let n = 0
      this.state.dotsTimer = setInterval(() => {
        if (this.state.destroyed) return
        n = (n + 1) % 4
        this.state.w.statusTitle.setProperty(hmUI.prop.TEXT, 'Procurando ônibus' + '.'.repeat(n))
      }, DOTS_MS)
    },

    // role: 'text' ou 'error' (papel de cor do tema atual).
    showStatus(title, detail, role) {
      const w = this.state.w
      this.state.view = { kind: 'status', title, detail, role }
      this.stopDots()
      this.state.hasData = false
      this.setVisible(this.dataWidgets(), false)
      this.stopAnim()
      this.stopPassed()
      this.state.busPos = null
      this.clearMap()
      this.setVisible([w.statusTitle, w.statusDetail], true)
      w.statusTitle.setProperty(hmUI.prop.TEXT, title)
      w.statusTitle.setProperty(hmUI.prop.COLOR, this.colors()[role] || this.colors().text)
      w.statusDetail.setProperty(hmUI.prop.TEXT, detail || '')
    },

    // Uma consulta por vez: a próxima só é agendada quando esta termina.
    refresh() {
      const s = this.state
      if (s.destroyed || s.loading) return
      s.loading = true
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      const { line, lat, lon, dir, stopId } = s.fav
      const params = { line, lat, lon, dir, stopId }
      if (s.zoom !== null) params.zoom = s.zoom
      const done = () => {
        s.loading = false
        if (s.destroyed) return
        const again = s.again
        s.again = false
        s.timer = setTimeout(() => this.refresh(), again ? 0 : REFRESH_MS)
      }
      this.request({ method: 'GET_BUSES', params })
        .then((data) => {
          const { result, error } = data || {}
          this.show(result, error)
        })
        .catch(() => this.show(null, 'offline'))
        .then(done, done)
    },

    // Mostra mapa e coluna da esquerda (dados) e esconde o estado.
    showDataFrame(map) {
      const w = this.state.w
      this.stopDots()
      this.state.hasData = true
      this.state.map = map
      this.setVisible([w.statusTitle, w.statusDetail], false)
      this.setVisible(this.dataWidgets(), true)
      this.drawMap(map)
      this.setFooter(map && map.k ? scaleLabel(map.k, map.auto) : '')
      if (map && map.passed) this.showPassed(map.passed)
    },

    // result: { buses, map } (ou a lista pura do formato antigo).
    show(result, error) {
      if (this.state.destroyed) return
      const w = this.state.w
      const { buses, map } = parseBusesResult(result)
      if (error === 'offline') {
        this.showStatus('Sem conexão', 'Abra o app Zepp no celular e deixe o Bluetooth ligado.', 'error')
        this.setFooter('Nova tentativa em 30 s')
        return
      }
      if (error) {
        this.showStatus('Erro', error, 'error')
        this.setFooter('Nova tentativa em 30 s')
        return
      }
      const c = this.colors()
      if (!buses || buses.length === 0) {
        if (!map) {
          this.showStatus('Uai,', 'nenhum ônibus rodando agora nessa linha.', 'text')
          this.setFooter('')
          return
        }
        // Sem ônibus, mas com o mapa (trajeto e ponto): recado na coluna da esquerda.
        this.state.view = { kind: 'data', result }
        this.showDataFrame(map)
        this.stopAnim()
        this.state.busPos = null
        this.setVisible([w.busDot, ...w.otherDots], false)
        w.eta.setProperty(hmUI.prop.MORE, { x: px(NUM_X), y: px(168), w: px(NUM_W), h: px(60), text: 'Uai,', text_size: px(48), color: c.text })
        w.etaMin.setProperty(hmUI.prop.MORE, { x: px(NUM_X), y: px(228), w: px(NUM_W), h: px(34), text: 'nenhum ônibus', text_size: px(24), color: c.muted })
        w.etaLabel.setProperty(hmUI.prop.MORE, { x: px(30), y: px(260), w: px(210), h: px(34), text: 'rodando agora', text_size: px(24), color: c.muted })
        w.etaAge.setProperty(hmUI.prop.TEXT, '')
        w.info.setProperty(hmUI.prop.TEXT, '')
        return
      }

      const [first, ...rest] = buses
      const others = rest.slice(0, MAX_OTHERS)
      const hot = etaColor(first.etaMin, this.state.theme)
      this.state.view = { kind: 'data', result }
      this.showDataFrame(map)

      // Número grande: fonte menor com 2 ou 3 dígitos para caber na coluna.
      const n = String(first.etaMin)
      w.eta.setProperty(hmUI.prop.MORE, { x: px(NUM_X), y: px(92), w: px(NUM_W), h: px(200), text: n, text_size: px(etaFontSize(n)), color: hot })
      w.etaMin.setProperty(hmUI.prop.MORE, { x: px(NUM_X), y: px(268), w: px(NUM_W), h: px(40), text: 'min', text_size: px(32), color: c.text })
      w.etaLabel.setProperty(hmUI.prop.MORE, { x: px(30), y: px(306), w: px(210), h: px(32), text: etaLabel(first.etaMin), text_size: px(24), color: hot })

      const stale = first.ageSec !== null && first.ageSec !== undefined && first.ageSec >= STALE_SEC
      w.etaAge.setProperty(hmUI.prop.TEXT, stale ? ageText(first.ageSec) : '')
      w.info.setProperty(hmUI.prop.TEXT, infoLine(first, others))

      // Ônibus: posição em pixels vinda do celular; sem mapa, em linha reta do ponto
      // (que fica no centro).
      const stop = this.state.fav
      const offset = (bus, index) => {
        const fromMap = map && map.buses[index]
        if (fromMap) return { dx: fromMap.x, dy: fromMap.y }
        if (map) return null
        return mapOffset(stop, bus, { pxPerKm: 90, maxR: MAP_BUS_MAX_R })
      }
      // MORE recebe todas as propriedades do círculo de uma vez.
      w.otherDots.forEach((dot, i) => {
        const o = others[i] ? offset(others[i], i + 1) : null
        dot.setProperty(hmUI.prop.VISIBLE, !!o)
        if (o) dot.setProperty(hmUI.prop.MORE, { center_x: px(MAP_CX + o.dx), center_y: px(MAP_CY + o.dy), radius: px(OTHER_R), color: c.muted })
      })
      // Primeiro ônibus: ícone da faixa de tempo, centrado na posição.
      // Com trajeto, desliza até o ponto entre as atualizações (startAnim).
      const o = offset(first, 0)
      const src = busIcon(first.etaMin, this.state.theme)
      // Posição antiga só serve para a correção suave se o enquadramento
      // (escala e centro, que mudam no zoom automático) for o mesmo.
      const frame = map ? `${map.k}|${map.stop.x}|${map.stop.y}` : ''
      const prev = this.state.lastFrame === frame ? this.state.busPos : null
      this.state.lastFrame = frame
      this.stopAnim()
      w.busDot.setProperty(hmUI.prop.VISIBLE, !!o)
      if (o) {
        const target = { x: o.dx, y: o.dy }
        const close = prev && Math.hypot(prev.x - target.x, prev.y - target.y) <= ANIM_FIX_MAX_PX
        this.moveBus(close ? prev : target, src)
        this.startAnim(animationPath(map), map ? map.speed : 0, src, close ? prev : null, target)
      } else {
        this.state.busPos = null
      }
    },

    onDestroy() {
      const s = this.state
      s.destroyed = true
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      if (s.zoomTimer) clearTimeout(s.zoomTimer)
      s.zoomTimer = null
      this.stopDots()
      this.stopAnim()
      this.stopPassed()
      offDigitalCrown()
    }
  })
)
