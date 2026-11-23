// Tela de um ponto: o mapa ocupa a tela toda e o texto fica direto sobre ele, sem
// cartão nem fundo (shared/detail-layout.js): no topo o nome do ponto e o selo da
// linha; à esquerda o número grande do ônibus que chega primeiro (algarismos em PNG
// com contorno, na cor da faixa de tempo, utils/eta-digits.js) e "min"; embaixo
// "recado · distância" e os seguintes. O ponto fica à direita do centro (MAP_CX).
// O mapa chega pronto do celular, já em pixels e já enquadrado: o zoom é só
// automático (ônibus longe = mapa afastado; chegando, aproxima), com histerese na
// troca de nível (shared/map-frame.js). Atualiza 30 s após cada resposta.
//
// Ruas (mapa sob demanda): o relógio manda junto do pedido o que já tem do mapa
// (bits) e o retângulo do mapa; o celular envia na hora só os blocos que cobrem a
// vista; a tela desenha os que já tem e relê a cada 1,5 s enquanto faltam
// (drawTiles). Sem nenhum bloco na vista, um texto pequeno no canto do mapa diz por
// quê (mapDiagText), para o diagnóstico no relógio real.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
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
  BUS_ICON_SIZE
} from '../../utils/ui'
import { etaNumberLayout, etaDigitSrc, etaMinSrc, ETA_SCALES } from '../../utils/eta-digits'
import { parseDetailParams, parseSettingsResult } from '../../utils/favorites'
import { mapOffset, infoParts, parseBusesResult } from '../../utils/detail-view'
import { animationPath, pathLength } from '../../shared/route-map'
import { startAnimation, animFrame, ANIM_TICK_MS } from '../../shared/bus-anim'
import { MAP_VIEW } from '../../shared/map-frame'
import { LAYOUT, MAP_CX, MAP_CY, MAP_RECT, chipBox, estimateTextWidth, tileView, demandView, stopIconFits } from '../../shared/detail-layout'
// Ícones dos pontos no mapa: losango (rua), "M" (MOVE) e hexágono (estação central).
import { pickStopIcons, stopIconSrc, diamondPoints, STOP_ICON_HALF, STOP_ICON_SIZE, MAX_BIG_ICONS } from '../../shared/stop-icons'
import { fadeFrame, passedKey, PASS_PILL_MS } from '../../shared/passing'
import { guard } from '../../utils/crash'
import { tileInfo, touchTiles, saveManifest, canReceiveFiles, watchDiag } from '../../utils/map-store'
import { tilesForView, centerLatLon, watchTilePath, hasBit } from '../../shared/map-tiles'
import { buildDemandParams, pendingCount, mapDiagText, DEMAND_POLL_MS, DEMAND_POLL_MAX_MS } from '../../shared/map-demand'
// Sem conexão / celular sem internet / BHTrans fora do ar (shared/conn-errors.js).
import { ERR, parseErrorField, requestFailureCode, errorScreen } from '../../shared/conn-errors'
import { drawErrorScreen, startRetry, stopRetry, isBleConnected } from '../../utils/conn-screen'
import { decideVibration } from '../../shared/vibrate'
// Horário de aviso do ponto: só vibra dentro da janela (shared/schedule.js).
import { latestAlert, QUIET_NOTE } from '../../shared/schedule'
import { alertsOnNow } from '../../utils/alarms'
// Vibração do pulso: https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Vibrator/
import { Vibrator, VIBRATOR_SCENE_SHORT_STRONG, VIBRATOR_SCENE_DURATION_LONG, VIBRATOR_SCENE_NOTIFICATION } from '@zos/sensor'

const REFRESH_MS = 30 * 1000
// Animação do ícone do ônibus: quadros curtos (ANIM_TICK_MS) com a posição
// calculada pelo tempo real decorrido (shared/bus-anim.js); posição nova chega
// com uma correção suave (ease-out, ANIM_FIX_MS) e só pula se a diferença for
// maior que ANIM_JUMP_PX. Para sozinha após ANIM_MAX_MS sem dado novo (bateria).
// Sumiço do ônibus que passou: um quadro a cada 100 ms durante ~4,5 s.
const FADE_FRAME_MS = 100
const DOTS_MS = 500
const MAX_OTHERS = 2
// Posição do GPS mais velha que isso ganha aviso.
const STALE_SEC = 120
// Abaixo dessa escala os pontos da linha ficam de fora (viram poluição).
const MIN_K_FOR_STOPS = 60
// Blocos do mapa de ruas: a tela toda (466 px físicos) cabe em até 3 x 3 blocos
// de 256 px.
const MAX_TILES = 9

const BUS_HALF = BUS_ICON_SIZE / 2
const OTHER_R = 7 // marcadores dos seguintes
const TRAIL_R = 2 // bolinhas do rastro
const ROUTE_W = 4 // espessura do trajeto
const HI_W = 7 // espessura do trecho ônibus -> ponto
// Canvas do trajeto: a tela toda (shared/detail-layout.js MAP_RECT).
// Coordenada do mapa (relativa ao centro do mapa, px de design) -> pixel do canvas.
const cvx = (v) => px(MAP_CX - MAP_RECT.x + v)
const cvy = (v) => px(MAP_CY - MAP_RECT.y + v)
// Lado em px físicos dos PNG dos ícones grandes dos pontos (assets/common.r/stop/,
// gerados por scripts/build-stop-icons.py no tamanho exato: sem auto_scale).
const stopIconPx = (kind) => Math.round(px(STOP_ICON_SIZE[kind]))

// Largura centralizada que cabe na tela redonda a partir de uma margem lateral.
const box = (margin) => ({ x: margin, w: DEVICE_WIDTH - 2 * margin })
// Caixa do layout (px de design) -> propriedades do widget (px físicos).
const at = (b) => ({ x: Math.round(px(b.x)), y: Math.round(px(b.y)), w: Math.round(px(b.w)), h: Math.round(px(b.h)) })
// Número de algarismos em imagens (utils/eta-digits.js: até 3).
const MAX_DIGITS = ETA_SCALES.length

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
      // { kind: 'loading' } | { kind: 'status', title, detail, role } | { kind: 'data', result }
      // | { kind: 'error', code } (tela com imagem de shared/conn-errors.js).
      const { fav, theme, master, fromAlarm } = parseDetailParams(params)
      const fresh = {
        fav,
        theme,
        vibrate: master, // interruptor geral "Vibrar no relógio" (a janela é conferida a cada leitura)
        // shared/vibrate.js: o que já foi avisado. Aberta pelo alarme, a primeira
        // leitura já avisa (memória vazia em vez de null).
        vibMemory: fromAlarm ? { vehicle: null, level: 0, passed: [] } : null,
        quiet: false, // fora da janela do ponto: rodapé "avisos desligados agora"
        vibrator: null,
        // Mapa de ruas (utils/map-store.js tileInfo: manifesto e bits do cache) ou null;
        // com ele o zoom (automático) só usa os níveis dos blocos.
        tiles: null,
        tilesPhone: null, // diagnóstico do celular na última resposta { sent, fail, err }
        tileKeys: [], // src já posto em cada IMG de bloco (não recarrega à toa)
        tileTouch: '', // blocos da vista já marcados como usados (LRU)
        tilePoll: null, // { timer, since }: relê o cache enquanto faltam blocos da vista
        errorWidgets: [], // tela de erro de conexão (utils/conn-screen.js)
        retry: null,
        timer: null,
        dotsTimer: null,
        anim: null, // { timer, src, path, speed, startedAt, fixFrom, target } (shared/bus-anim)
        busPos: null, // posição atual do ícone (px de design, relativa ao centro do mapa)
        busRemain: null, // quanto falta do ícone ao ponto, ao longo do trajeto (px)
        map: null, // último mapa recebido (já validado)
        lastFrame: null, // enquadramento do mapa em que busPos foi calculada
        trailColor: null, // cor do rastro pontilhado (faixa de tempo do primeiro ônibus)
        again: false, // pedir de novo assim que a consulta atual terminar
        fade: null, // sumiço do ônibus que passou { timer, startedAt, pos, level }
        pillTimer: null,
        passKey: '', // último "passou" já mostrado (não repete)
        hasData: false,
        loading: false,
        destroyed: false,
        view: { kind: 'loading' },
        footerText: '',
        diagText: '',
        all: [],
        w: {}
      }
      // No relógio, trocar o objeto this.state não funciona: atualiza o que já existe.
      if (!this.state || typeof this.state !== 'object') this.state = {}
      Object.assign(this.state, fresh)
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
      if (!this.state || !Array.isArray(this.state.all)) this.onInit()
      this.loadTiles()
      this.createWidgets()
      this.updateQuiet()
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
      const theme = this.state.theme
      const L = LAYOUT

      // Fundo do tema: primeiro widget, cobre a tela toda.
      this.widget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: DEVICE_WIDTH, h: DEVICE_HEIGHT, color: c.bg })

      // Mapa (a tela toda, sem moldura nem esfumado): blocos de ruas, trajeto no
      // canvas e os marcadores por cima de tudo do mapa.
      // Ruas: até MAX_TILES blocos de 256 px, cada IMG recortado à tela
      // (w/h e pos_x/pos_y, doc do IMG:
      // https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/IMG/).
      // Começam escondidos (src trocado ao desenhar).
      w.tiles = []
      for (let i = 0; i < MAX_TILES; i++) {
        w.tiles.push(this.widget(hmUI.widget.IMG, { ...at({ x: 0, y: 0, w: BUS_ICON_SIZE, h: BUS_ICON_SIZE }), src: busIcon(null, theme) }))
      }
      this.setVisible(w.tiles, false)
      this.state.tileKeys = []
      w.mapCanvas = this.widget(hmUI.widget.CANVAS, at(MAP_RECT))
      // Estações no mapa ("M" e hexágono, PNG por tema): por cima do trajeto e embaixo
      // do seu ponto e dos ônibus. Começam escondidas (drawMap posiciona).
      w.stopIcons = []
      for (let i = 0; i < MAX_BIG_ICONS; i++) {
        const size = stopIconPx('move')
        w.stopIcons.push(this.widget(hmUI.widget.IMG, { x: 0, y: 0, w: size, h: size, src: stopIconSrc('move', theme) }))
      }
      this.setVisible(w.stopIcons, false)
      // Seu ponto: halo e miolo na cor de destaque do tema, anel branco.
      w.stopHalo = this.circle(13, mixColor(c.bg, c.chip, 0.3))
      w.stopWhite = this.circle(10, 0xffffff)
      w.stopDot = this.circle(7, c.chip)
      // Ônibus que acabou de passar (cinza, some devagar) e o rótulo "passou".
      w.passedIcon = this.widget(hmUI.widget.IMG, {
        x: px(MAP_CX - BUS_HALF),
        y: px(MAP_CY - BUS_HALF),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        auto_scale: true,
        src: passedBusIcon(100, theme)
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
        src: busIcon(null, theme)
      })
      // Estado do mapa quando a vista não tem nenhum bloco (diagnóstico discreto).
      w.mapDiag = this.text({
        ...at(L.mapDiag),
        text_size: px(L.mapDiag.size),
        color: c.mapMuted,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP,
        text: this.state.diagText
      })

      // Topo, centralizado: nome do ponto e, logo abaixo, o selo da linha (largura
      // pela medida do texto). Texto direto sobre o mapa (cores de test/colors.test.mjs).
      this.text({ ...at(L.title), text: fav.name, text_size: px(L.title.size), color: c.text })
      const lineText = String(fav.line)
      const chip = at(chipBox(this.textWidth(lineText, L.chip.size)))
      this.widget(hmUI.widget.FILL_RECT, { ...chip, radius: Math.round(chip.h / 2), color: c.chip })
      this.text({ ...chip, text: lineText, text_size: px(L.chip.size), color: c.chipText })

      // Número grande à esquerda: até 3 IMG de algarismo (cor da faixa) e o "min"
      // alinhado à base (setNumber). Começam escondidos.
      w.digits = []
      for (let i = 0; i < MAX_DIGITS; i++) {
        w.digits.push(this.widget(hmUI.widget.IMG, { ...at({ x: 0, y: 0, w: 10, h: 10 }), auto_scale: true, src: etaMinSrc(theme) }))
      }
      w.minImg = this.widget(hmUI.widget.IMG, { ...at({ x: 0, y: 0, w: 10, h: 10 }), auto_scale: true, src: etaMinSrc(theme) })
      // Número em texto comum (minuto fora de 0..999) e o "Uai," de sem ônibus.
      w.eta = this.text({ ...at(L.eta), text_size: px(L.eta.size), color: c.eta })
      w.empty1 = this.text({ ...at(L.emptyLine1), text_size: px(L.emptyLine1.size), color: c.text, text: 'nenhum ônibus' })
      w.empty2 = this.text({ ...at(L.emptyLine2), text_size: px(L.emptyLine2.size), color: c.text, text: 'rodando agora' })
      this.setVisible(this.numberWidgets(), false)
      w.etaAge = this.text({ ...at(L.etaAge), text_size: px(L.etaAge.size), color: c.mapError })
      // Rodapé, centralizado: "já já · 1,0 km" e "depois 7 e 15 min".
      w.info = this.text({ ...at(L.info), text_size: px(L.info.size), color: c.text })
      w.next = this.text({ ...at(L.next), text_size: px(L.next.size), color: c.mapMuted })
      // Recado das telas sem dados ("Nova tentativa em 30 s").
      w.footer = this.text({ ...at(L.footer), text_size: px(L.footer.size), color: c.muted })
      w.footer.setProperty(hmUI.prop.TEXT, this.state.footerText)
      // Fora da janela de aviso do ponto: recado discreto embaixo.
      w.quiet = this.text({ ...at(L.quiet), text_size: px(L.quiet.size), color: c.mapMuted, text: this.state.quiet ? QUIET_NOTE : '' })

      // Pílula "Esse passou · vem o próximo" (por cima do rodapé, some sozinha).
      w.pill = this.widget(hmUI.widget.FILL_RECT, { ...at(L.pill), radius: px(L.pill.h / 2), color: c.chip })
      w.pillText = this.text({ ...at({ ...L.pill, x: L.pill.x + 5, w: L.pill.w - 10 }), text: 'Esse passou · vem o próximo', text_size: px(18), color: c.chipText })
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

    // Largura de um texto em px de design (getTextLayout mede em px físicos; sem ele,
    // uma estimativa).
    textWidth(text, size) {
      try {
        if (typeof hmUI.getTextLayout === 'function') {
          const m = hmUI.getTextLayout(text, { text_size: px(size), text_width: px(400), wrapped: 0 })
          if (m && m.width > 0) return (m.width * 1000) / px(1000)
        }
      } catch (e) {
        // estimativa abaixo
      }
      return estimateTextWidth(text, size)
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
      if (data.method === 'MAP_CHANGED') {
        // Mapa terminou de chegar ou foi apagado: troca o modo do zoom na próxima consulta.
        if (this.loadTiles()) this.refreshNow()
        return
      }
      if (data.method !== 'SETTINGS_CHANGED' && data.method !== 'FAVORITES_CHANGED') return
      const { theme, vibrate, favorites } = parseSettingsResult(data.result, this.state.theme, this.state.vibrate)
      this.state.vibrate = vibrate
      // Horário novo do ponto (Editar nas configurações).
      if (this.state.fav) this.state.fav = { ...this.state.fav, alert: latestAlert(this.state.fav, favorites) }
      this.updateQuiet()
      if (theme === this.state.theme) return
      this.state.theme = theme
      this.loadTiles()
      this.repaint()
    }),

    // Lê se o mapa do tema atual está no relógio (manifesto e bits do cache).
    // Devolve true se o mapa de ruas ligou/desligou ou trocou de tema.
    loadTiles() {
      const s = this.state
      let info = null
      try {
        info = tileInfo(s.theme, px(1000) / 1000)
      } catch (e) {
        info = null
      }
      if (info && info.levels.length === 0) info = null
      const before = s.tiles ? s.tiles.theme : ''
      s.tiles = info
      return (info ? info.theme : '') !== before
    },

    repaint() {
      const view = this.state.view
      const footer = this.state.footerText
      this.stopDots()
      this.stopAnim()
      this.stopPassed()
      this.state.busPos = null
      this.state.busRemain = null
      this.state.all.forEach((x) => hmUI.deleteWidget(x))
      this.state.all = []
      this.state.errorWidgets = []
      this.createWidgets()
      if (view.kind === 'data') this.show(view.result, null)
      else if (view.kind === 'error') this.showError(view.code)
      else if (view.kind === 'status') this.showStatus(view.title, view.detail, view.role)
      else this.showLoading()
      this.setFooter(footer)
    },

    setVisible(widgets, visible) {
      widgets.forEach((x) => x.setProperty(hmUI.prop.VISIBLE, visible))
    },

    dataWidgets() {
      const w = this.state.w
      return [w.etaAge, w.info, w.next, w.stopHalo, w.stopWhite, w.stopDot, ...w.otherDots, w.busDot, w.mapDiag]
    },

    // Número grande (imagens ou texto) e o recado de sem ônibus: setNumber/showEmpty.
    numberWidgets() {
      const w = this.state.w
      return [...w.digits, w.minImg, w.eta, w.empty1, w.empty2]
    },

    // Minutos em algarismos PNG na cor da faixa (utils/eta-digits.js) e o "min"
    // alinhado à base; fora de 0..999, texto comum. color: cor da faixa (texto).
    setNumber(min, color) {
      const w = this.state.w
      const theme = this.state.theme
      const lay = etaNumberLayout(min)
      this.setVisible([w.empty1, w.empty2], false)
      if (!lay) {
        this.setVisible([...w.digits, w.minImg], false)
        w.eta.setProperty(hmUI.prop.MORE, { ...at(LAYOUT.eta), text: `${min} min`, text_size: px(64), color })
        w.eta.setProperty(hmUI.prop.VISIBLE, true)
        return
      }
      w.eta.setProperty(hmUI.prop.VISIBLE, false)
      w.digits.forEach((img, i) => {
        const d = lay.digits[i]
        if (!d) {
          img.setProperty(hmUI.prop.VISIBLE, false)
          return
        }
        img.setProperty(hmUI.prop.MORE, { ...at(d), src: etaDigitSrc(d.d, min, theme) })
        img.setProperty(hmUI.prop.VISIBLE, true)
      })
      w.minImg.setProperty(hmUI.prop.MORE, { ...at(lay.min), src: etaMinSrc(theme) })
      w.minImg.setProperty(hmUI.prop.VISIBLE, true)
    },

    // Sem ônibus agora (com o mapa): "Uai," grande e duas linhas onde fica o número.
    showEmpty() {
      const w = this.state.w
      const c = this.colors()
      const L = LAYOUT
      this.setVisible([...w.digits, w.minImg], false)
      w.eta.setProperty(hmUI.prop.MORE, { ...at(L.emptyTitle), text: 'Uai,', text_size: px(L.emptyTitle.size), color: c.text })
      this.setVisible([w.eta, w.empty1, w.empty2], true)
    },

    refreshNow() {
      if (this.state.destroyed) return
      if (this.state.loading) this.state.again = true
      else this.refresh()
    },

    // ---- Ônibus em movimento ----

    // Ícone do ônibus na posição { x, y } (px de design, relativa ao centro do mapa).
    // remain: quanto falta (px ao longo do trajeto) até o ponto, ou null.
    moveBus(pos, src, remain = null) {
      this.state.busPos = { x: pos.x, y: pos.y }
      this.state.busRemain = typeof remain === 'number' ? remain : null
      this.state.w.busDot.setProperty(hmUI.prop.MORE, {
        x: px(Math.round(MAP_CX + pos.x - BUS_HALF)),
        y: px(Math.round(MAP_CY + pos.y - BUS_HALF)),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        src
      })
    },

    // Desliza o ícone AO LONGO da polyline (do ônibus ao ponto) a speed px/s; a
    // correção suave desfaz a diferença de distância até o ponto (prevRemain:
    // quanto faltava no ícone antigo), também pelo trajeto (shared/bus-anim.js).
    startAnim(path, speed, src, prevRemain) {
      this.stopAnim()
      if (this.state.destroyed) return
      const anim = startAnimation({ path, speed, prevRemain, now: Date.now() })
      if (!anim) return
      anim.src = src
      anim.timer = null
      this.state.anim = anim
      anim.timer = setInterval(
        guard('animação do ônibus', () => this.animStep(anim)),
        ANIM_TICK_MS
      )
    },

    animStep(anim) {
      if (this.state.destroyed || this.state.anim !== anim) return
      const pos = animFrame(anim, Date.now())
      if (!pos) {
        this.stopAnim()
        return
      }
      this.moveBus(pos, anim.src, pos.remain)
      // Chegou ao ponto do usuário (ou passou do tempo): para até a próxima posição.
      if (pos.done) this.stopAnim()
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
      const w = this.state.w
      const canvas = w.mapCanvas
      if (canvas) canvas.clear({ x: 0, y: 0, w: px(MAP_RECT.w), h: px(MAP_RECT.h) })
      if (w.tiles) this.setVisible(w.tiles, false)
      if (w.stopIcons) this.setVisible(w.stopIcons, false)
      this.setMapDiag('')
    },

    // Texto pequeno no canto do mapa (diagnóstico do mapa de ruas).
    setMapDiag(text) {
      const s = this.state
      if (text === s.diagText) return
      s.diagText = text
      if (s.w.mapDiag) s.w.mapDiag.setProperty(hmUI.prop.TEXT, text)
    },

    // Blocos do mapa de ruas atrás do trajeto (com o manifesto no relógio e um nível
    // no enquadramento). Posição pela projeção do manifesto (shared/map-tiles.js
    // tilesForView), em px físicos da tela, cobrindo o retângulo do mapa.
    drawTiles(map) {
      const s = this.state
      const w = s.w
      if (!w.tiles) return
      const t = s.tiles
      const diag = (extra) =>
        mapDiagText({ files: canReceiveFiles(), manifest: !!t, watch: watchDiag(), phone: s.tilesPhone, ...extra })
      if (!t || !map || map.level === null || !t.compact.levels[t.theme][map.level]) {
        this.setVisible(w.tiles, false)
        this.stopTilePoll()
        this.setMapDiag(map ? diag({ level: map.level }) : '')
        return
      }
      const center = centerLatLon(s.fav, map.center, t.compact.m)
      const list = tilesForView({ compact: t.compact, theme: t.theme, level: map.level, center, ...tileView(px) })
      const L = t.compact.levels[t.theme][map.level]
      // Os que o relógio já tem primeiro (só há MAX_TILES widgets).
      const ready = list.filter((tile) => hasBit(t.have, tile.i))
      w.tiles.forEach((img, i) => {
        const tile = ready[i]
        if (!tile) {
          img.setProperty(hmUI.prop.VISIBLE, false)
          s.tileKeys[i] = ''
          return
        }
        const src = watchTilePath(t.theme, L.k, tile.tx, tile.ty)
        const key = `${src}|${tile.x}|${tile.y}|${tile.w}|${tile.h}|${tile.pos_x}|${tile.pos_y}`
        if (s.tileKeys[i] !== key) {
          img.setProperty(hmUI.prop.MORE, { x: tile.x, y: tile.y, w: tile.w, h: tile.h, pos_x: tile.pos_x, pos_y: tile.pos_y, src })
          s.tileKeys[i] = key
        }
        img.setProperty(hmUI.prop.VISIBLE, true)
      })
      const pending = pendingCount(list, t.have)
      this.setMapDiag(diag({ level: map.level, shown: ready.length, pending }))
      // Blocos na tela vão para o fim do LRU (o cache apaga os usados há mais tempo).
      const shown = ready.map((tile) => tile.i)
      const touchKey = `${t.theme}|${shown.join(',')}`
      if (shown.length > 0 && touchKey !== s.tileTouch) {
        s.tileTouch = touchKey
        try {
          touchTiles(t.theme, shown)
        } catch (e) {
          // sem LRU: segue
        }
      }
      // Faltam blocos da vista: o celular está mandando; relê o cache até chegarem.
      if (pending > 0) this.startTilePoll()
      else this.stopTilePoll()
    },

    startTilePoll() {
      const s = this.state
      if (s.destroyed) return
      if (s.tilePoll) return
      const poll = { timer: null, since: Date.now() }
      s.tilePoll = poll
      poll.timer = setInterval(
        guard('blocos do mapa', () => {
          if (s.destroyed || s.tilePoll !== poll) return
          if (Date.now() - poll.since > DEMAND_POLL_MAX_MS) {
            this.stopTilePoll()
            return
          }
          this.loadTiles()
          if (s.view.kind === 'data' && s.map) this.drawTiles(s.map)
        }),
        DEMAND_POLL_MS
      )
    },

    stopTilePoll() {
      const s = this.state
      if (s.tilePoll && s.tilePoll.timer) clearInterval(s.tilePoll.timer)
      s.tilePoll = null
    },

    // Trajeto, trecho destacado, rastro e pontos da linha no canvas; o seu ponto
    // em widgets por cima. map já vem validado (parseBusesResult), em pixels
    // relativos ao centro do mapa; null = só o anel e o ponto no centro.
    drawMap(map) {
      const w = this.state.w
      const c = this.colors()
      this.clearMap()
      const canvas = w.mapCanvas
      // Ruas: blocos de imagem em widgets IMG embaixo do canvas (drawTiles).
      this.drawTiles(map)
      const lines = (pieces, color, width) => {
        if (!pieces.length) return
        canvas.setPaint({ color, line_width: px(width) })
        pieces.forEach((flat) => {
          for (let i = 0; i + 3 < flat.length; i += 2) {
            canvas.drawLine({ x1: cvx(flat[i]), y1: cvy(flat[i + 1]), x2: cvx(flat[i + 2]), y2: cvy(flat[i + 3]), color })
          }
        })
      }
      if (map) {
        lines(map.route, c.route, ROUTE_W)
        lines(map.hi, c.routeHi, HI_W)
        // Pontilhado sobre o caminho que o ônibus já fez (fica parado no mapa), na
        // cor da faixa de tempo do ônibus (sem ônibus: coral do tema).
        const trail = this.state.trailColor || c.trail
        for (let i = 0; i + 1 < map.trail.length; i += 2) {
          canvas.drawCircle({ center_x: cvx(map.trail[i]), center_y: cvy(map.trail[i + 1]), radius: px(TRAIL_R), color: trail })
        }
        this.drawStopIcons(map)
      }
      const stop = map ? map.stop : { x: 0, y: 0 }
      const pos = { center_x: px(MAP_CX + stop.x), center_y: px(MAP_CY + stop.y) }
      w.stopHalo.setProperty(hmUI.prop.MORE, { ...pos, radius: px(13), color: mixColor(c.bg, c.chip, 0.3) })
      w.stopWhite.setProperty(hmUI.prop.MORE, { ...pos, radius: px(10), color: 0xffffff })
      w.stopDot.setProperty(hmUI.prop.MORE, { ...pos, radius: px(7), color: c.chip })
    },

    // Outros pontos da linha (shared/stop-icons.js pickStopIcons): losangos no canvas
    // (só com zoom suficiente) e estações em IMG, sem sobreposição forte (fica o mais
    // importante: central > MOVE > rua) e sem ícone grande atrás dos textos.
    drawStopIcons(map) {
      const w = this.state.w
      const c = this.colors()
      const theme = this.state.theme
      const canvas = w.mapCanvas
      const icons = pickStopIcons(map.stops, map.kinds, {
        user: map.stop,
        showStreets: !map.k || map.k >= MIN_K_FOR_STOPS,
        fitsBig: stopIconFits,
        maxBig: w.stopIcons.length
      })
      let big = 0
      const h = px(STOP_ICON_HALF.street)
      canvas.setPaint({ color: c.mapMuted, line_width: px(2) })
      icons.forEach((it) => {
        if (it.kind === 'street') {
          const pts = diamondPoints(cvx(it.x), cvy(it.y), h)
          canvas.drawPoly({ data_array: pts, color: c.bg })
          canvas.strokePoly({ data_array: pts, color: c.mapMuted })
          return
        }
        const img = w.stopIcons[big++]
        if (!img) return
        const size = stopIconPx(it.kind)
        img.setProperty(hmUI.prop.MORE, {
          x: Math.round(px(MAP_CX + it.x) - size / 2),
          y: Math.round(px(MAP_CY + it.y) - size / 2),
          w: size,
          h: size,
          src: stopIconSrc(it.kind, theme)
        })
        img.setProperty(hmUI.prop.VISIBLE, true)
      })
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

    // Tela de erro com imagem (sem conexão / celular sem internet / BHTrans fora do
    // ar). Sem conexão: confere o Bluetooth a cada 3 s e pede de novo na volta; os
    // outros dois tentam de novo na próxima consulta (30 s). "Tentar de novo": já.
    showError(code) {
      const s = this.state
      if (s.destroyed) return
      const c = errorScreen(code) ? code : ERR.NO_BLE
      if (s.view.kind === 'error' && s.view.code === c && s.errorWidgets.length > 0) return
      this.showStatus('', '', 'text')
      this.setVisible([s.w.statusTitle, s.w.statusDetail], false)
      this.stopTilePoll()
      this.setFooter('')
      s.view = { kind: 'error', code: c }
      s.errorWidgets = drawErrorScreen((type, opts) => this.widget(type, opts), {
        code: c,
        theme: s.theme,
        colors: this.colors(),
        onRetry: () => this.refreshNow()
      })
      stopRetry(s.retry)
      s.retry = null
      if (errorScreen(c).retry === 'ble') {
        s.retry = startRetry(c, () => {
          s.retry = null
          this.refreshNow()
        })
      }
    },

    hideError() {
      const s = this.state
      stopRetry(s.retry)
      s.retry = null
      if (s.errorWidgets.length === 0) return
      s.errorWidgets.forEach((x) => {
        hmUI.deleteWidget(x)
        const i = s.all.indexOf(x)
        if (i >= 0) s.all.splice(i, 1)
      })
      s.errorWidgets = []
    },

    // zml: o Bluetooth mudou (BasePage liga a messaging.onBleChanged).
    onBleChanged: guard('tela do ponto bluetooth', function () {
      const s = this.state
      if (!s || s.destroyed) return
      const on = isBleConnected()
      if (on && s.view.kind === 'error' && s.view.code === ERR.NO_BLE) this.refreshNow()
      else if (!on) this.showError(ERR.NO_BLE)
    }),

    // role: 'text' ou 'error' (papel de cor do tema atual).
    showStatus(title, detail, role) {
      const w = this.state.w
      this.hideError()
      this.state.view = { kind: 'status', title, detail, role }
      this.stopDots()
      this.state.hasData = false
      this.setVisible(this.dataWidgets(), false)
      this.setVisible(this.numberWidgets(), false)
      this.stopAnim()
      this.stopPassed()
      this.state.busPos = null
      this.state.busRemain = null
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
      // O mapa pode ter terminado de chegar com a tela aberta.
      this.loadTiles()
      // Com o mapa de ruas, só os níveis fixos dos blocos (px de design por km); o
      // celular escolhe o nível (zoom automático, com histerese).
      if (s.tiles) params.levels = s.tiles.levels
      // Mapa sob demanda: o que o relógio tem do tema (bits), o retângulo do mapa em px
      // físicos e a escala, para o celular mandar só os blocos que faltam na vista; e
      // os contadores do inbox (diagnóstico nas configurações do celular).
      if (canReceiveFiles()) {
        params.tile = buildDemandParams({
          theme: s.theme,
          have: s.tiles ? s.tiles.have : '',
          r: px(Math.min(MAP_VIEW.hx, MAP_VIEW.hy) + BUS_HALF),
          view: demandView(px),
          scale: px(1000) / 1000,
          mv: s.tiles ? s.tiles.tag : '',
          diag: watchDiag()
        })
      }
      const done = () => {
        s.loading = false
        if (s.destroyed) return
        const again = s.again
        s.again = false
        s.timer = setTimeout(() => this.refresh(), again ? 0 : REFRESH_MS)
      }
      // Sem Bluetooth: tela de "sem conexão" já (volta sozinha quando reconectar).
      if (!isBleConnected()) {
        this.showError(ERR.NO_BLE)
        done()
        return
      }
      this.request({ method: 'GET_BUSES', params })
        .then(
          guard('tela do ponto dados', (data) => {
            const { result, error } = data || {}
            // Relógio ainda sem o manifesto do mapa: veio junto (mapa sob demanda).
            const tiles = result && result.tiles
            if (tiles && tiles.manifest && saveManifest(tiles.manifest)) this.loadTiles()
            s.tilesPhone = tiles && tiles.diag && typeof tiles.diag === 'object' ? tiles.diag : null
            this.show(result, error)
          })
        )
        .catch(guard('tela do ponto sem conexão', () => this.showError(requestFailureCode())))
        .then(done, done)
    },

    // Mostra o mapa e os textos (dados) e esconde o estado.
    showDataFrame(map) {
      const w = this.state.w
      this.hideError()
      this.stopDots()
      this.state.hasData = true
      this.state.map = map
      this.setVisible([w.statusTitle, w.statusDetail], false)
      this.setVisible(this.dataWidgets(), true)
      this.drawMap(map)
      this.setFooter('')
      if (map && map.passed) this.showPassed(map.passed)
    },

    // result: { buses, map } (ou a lista pura do formato antigo).
    show(result, error) {
      if (this.state.destroyed) return
      const w = this.state.w
      const { buses, map } = parseBusesResult(result)
      const err = parseErrorField(error)
      if (err && errorScreen(err.code)) {
        // Celular sem internet / BHTrans fora do ar: tela própria (a próxima consulta,
        // em 30 s, tenta de novo).
        this.showError(err.code)
        return
      }
      if (err) {
        this.showStatus('Erro', err.message || 'Algo deu errado', 'error')
        this.setFooter('Nova tentativa em 30 s')
        return
      }
      const c = this.colors()
      this.vibrateFor(buses && buses[0], map)
      if (!buses || buses.length === 0) {
        if (!map) {
          this.showStatus('Uai,', 'nenhum ônibus rodando agora nessa linha.', 'text')
          this.setFooter('')
          return
        }
        // Sem ônibus, mas com o mapa (trajeto e ponto): recado onde fica o número.
        this.state.view = { kind: 'data', result }
        this.state.trailColor = null
        this.showDataFrame(map)
        this.stopAnim()
        this.state.busPos = null
        this.state.busRemain = null
        this.setVisible([w.busDot, ...w.otherDots], false)
        this.showEmpty()
        w.etaAge.setProperty(hmUI.prop.TEXT, '')
        w.info.setProperty(hmUI.prop.TEXT, '')
        w.next.setProperty(hmUI.prop.TEXT, '')
        return
      }

      const [first, ...rest] = buses
      const others = rest.slice(0, MAX_OTHERS)
      const hot = etaColor(first.etaMin, this.state.theme)
      this.state.view = { kind: 'data', result }
      this.state.trailColor = hot
      this.showDataFrame(map)

      // Número grande (menor com 2 ou 3 dígitos) na cor da faixa e "min".
      this.setNumber(first.etaMin, hot)

      const stale = first.ageSec !== null && first.ageSec !== undefined && first.ageSec >= STALE_SEC
      w.etaAge.setProperty(hmUI.prop.TEXT, stale ? ageText(first.ageSec) : '')
      // Rodapé: "já já · 1,0 km" e "depois 7 e 15 min".
      const info = infoParts(first, others)
      w.info.setProperty(hmUI.prop.TEXT, [etaLabel(first.etaMin), info.dist].filter(Boolean).join(' · '))
      w.next.setProperty(hmUI.prop.TEXT, info.next)

      // Ônibus: posição em pixels vinda do celular; sem mapa, em linha reta do ponto
      // (que fica no centro).
      const stop = this.state.fav
      const offset = (bus, index) => {
        const fromMap = map && map.buses[index]
        if (fromMap) return { dx: fromMap.x, dy: fromMap.y }
        if (map) return null
        return mapOffset(stop, bus, { pxPerKm: 90, maxR: Math.min(MAP_VIEW.hx, MAP_VIEW.hy) })
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
      // O mesmo veículo também: a correção só faz sentido para o mesmo ônibus.
      const frame = map ? `${map.k}|${map.stop.x}|${map.stop.y}|${first.vehicle}` : ''
      const prevRemain = this.state.lastFrame === frame ? this.state.busRemain : null
      this.state.lastFrame = frame
      this.stopAnim()
      w.busDot.setProperty(hmUI.prop.VISIBLE, !!o)
      if (o) {
        const target = { x: o.dx, y: o.dy }
        const path = animationPath(map)
        this.startAnim(path, map ? map.speed : 0, src, prevRemain)
        // Sem animação (parado ou pulo grande): vai direto; com ela, começa de onde está.
        if (!this.state.anim) this.moveBus(target, src, path.length >= 4 ? pathLength(path) : null)
        else this.animStep(this.state.anim)
      } else {
        this.state.busPos = null
        this.state.busRemain = null
      }
    },

    // ---- Vibração ----

    // Decide (shared/vibrate.js) e vibra: curta em "já já", longa em "chegando",
    // duas curtas quando o ônibus passa. Só com a página aberta.
    // Dentro da janela do ponto? Atualiza o recado do rodapé e devolve se pode vibrar.
    updateQuiet() {
      const s = this.state
      const allowed = alertsOnNow(s.fav, s.vibrate)
      s.quiet = !allowed
      if (s.w && s.w.quiet) s.w.quiet.setProperty(hmUI.prop.TEXT, s.quiet ? QUIET_NOTE : '')
      return allowed
    },

    vibrateFor(first, map) {
      const s = this.state
      const reading = {
        vehicle: first ? first.vehicle : null,
        etaMin: first ? first.etaMin : null,
        passedKey: map && map.passed ? passedKey(map.passed) : ''
      }
      const { memory, alert } = decideVibration(s.vibMemory, reading)
      s.vibMemory = memory
      // Fora da janela do ponto (ou interruptor geral desligado): nada vibra.
      if (!this.updateQuiet() || !alert) return
      const mode = alert === 'now' ? VIBRATOR_SCENE_DURATION_LONG : alert === 'passed' ? VIBRATOR_SCENE_NOTIFICATION : VIBRATOR_SCENE_SHORT_STRONG
      try {
        if (!s.vibrator) s.vibrator = new Vibrator()
        s.vibrator.start({ mode })
      } catch (e) {
        try {
          // Forma do exemplo da doc: setMode e depois start().
          s.vibrator.setMode(mode)
          s.vibrator.start()
        } catch (e2) {
          console.log('Vibração indisponível', e2 && e2.message ? e2.message : e2)
        }
      }
    },

    onDestroy() {
      const s = this.state
      s.destroyed = true
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      this.stopDots()
      this.stopAnim()
      this.stopPassed()
      this.stopTilePoll()
      stopRetry(s.retry)
      s.retry = null
      try {
        if (s.vibrator) s.vibrator.stop()
      } catch (e) {
        // nada
      }
    }
  })
)
