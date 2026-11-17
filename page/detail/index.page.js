// Tela de um ponto (layout "B"): número grande do ônibus que chega primeiro à
// esquerda, mini mapa à direita e os seguintes numa linha embaixo.
// O mini mapa (trajeto ~1,5 km em volta do ponto, pontos da linha, trecho até o
// ônibus destacado) chega pronto do celular, já em pixels; aqui só desenha.
// Atualiza 30 s após cada resposta.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme, etaColor, etaLabel, busIcon, BUS_ICON_SIZE, ROUTE_HIGHLIGHT } from '../../utils/ui'
import { parseDetailParams, parseSettingsResult } from '../../utils/favorites'
import { mapOffset, etaFontSize, infoLine, parseBusesResult } from '../../utils/detail-view'
import { MAP_PX_PER_KM, MAX_MAP_STOPS, MAP_BUS_MAX_R, animationPath, advanceAlong, blend } from '../../shared/route-map'

const REFRESH_MS = 30 * 1000
// Animação do ícone do ônibus ao longo do trajeto: um passo por segundo (bateria).
const ANIM_MS = 1000
// Para sozinha depois disso sem posição nova (consulta atrasada ou sem resposta).
const ANIM_MAX_MS = 45 * 1000
// Diferença até isso (px de design) entre o ícone e a posição nova: correção suave
// em ANIM_FIX_STEPS passos; acima, pula direto.
const ANIM_FIX_MAX_PX = 30
const ANIM_FIX_STEPS = 2
const DOTS_MS = 500
const MAX_OTHERS = 2
// Posição do GPS mais velha que isso ganha aviso.
const STALE_SEC = 120

// Coluna do número (esquerda) e área do mini mapa (direita), em pixels de design.
const NUM_X = 40
const NUM_W = 190
const MAP_CX = 345
const MAP_CY = 240
const MAP_RING_R = 104 // borda do mapa
// Primeiro ônibus: ícone "frente do ônibus" (PNG 48x48 por faixa de tempo e tema).
const BUS_HALF = BUS_ICON_SIZE / 2
const OTHER_R = 6 // marcadores dos seguintes
const STOP_R = 10 // marcador do ponto
const LINE_STOP_R = 4 // outros pontos da linha
const ROUTE_W = 3 // espessura do trajeto
const HI_W = 6 // espessura do trecho ônibus -> ponto
// O centro do marcador fica dentro do anel.
const MAP_MAX_R = MAP_BUS_MAX_R
// Canvas do trajeto: quadrado em volta do anel.
const CANVAS_X = MAP_CX - MAP_RING_R
const CANVAS_Y = MAP_CY - MAP_RING_R
const CANVAS_SIZE = 2 * MAP_RING_R
// Coordenada do mapa (relativa ao centro, pixels de design) -> pixel do canvas.
const cv = (v) => px(MAP_RING_R + v)

// Largura centralizada que cabe na tela redonda a partir de uma margem lateral.
const box = (margin) => ({ x: margin, w: DEVICE_WIDTH - 2 * margin })

function clock() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ageText(sec) {
  if (sec === null || sec === undefined) return ''
  if (sec < 60) return `GPS há ${sec} s`
  return `GPS há ${Math.round(sec / 60)} min`
}

Page(
  BasePage({
    onInit(params) {
      // Estado próprio de cada abertura da página (não reaproveita o objeto do módulo).
      // Mantém o que a zml já colocou em this.state (ex.: messaging).
      // view guarda o que está na tela para poder repintar ao trocar o tema:
      // { kind: 'loading' } | { kind: 'status', title, detail, role } | { kind: 'data', buses }.
      const { fav, theme } = parseDetailParams(params)
      this.state = {
        ...this.state,
        fav,
        theme,
        timer: null,
        dotsTimer: null,
        anim: null, // { timer, path, speed, startedAt, src, fixFrom, fixStep, target }
        busPos: null, // posição atual do ícone (px de design, relativa ao centro)
        hasData: false,
        loading: false,
        destroyed: false,
        view: { kind: 'loading' },
        footerText: '',
        all: [],
        w: {}
      }
    },

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

    build() {
      this.createWidgets()
      if (!this.state.fav) {
        this.showStatus('Ponto inválido', 'Volte e escolha o ponto de novo.', 'error')
        return
      }
      this.showLoading()
      this.refresh()
    },

    createWidgets() {
      const c = this.colors()
      const fav = this.state.fav || { name: '?', line: '?' }
      const w = (this.state.w = {})

      // Fundo do tema: primeiro widget, cobre a tela toda.
      this.widget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: DEVICE_WIDTH, h: DEVICE_HEIGHT, color: c.bg })

      // Cabeçalho pequeno: "Casa · Linha 9250".
      this.text({ ...box(px(110)), y: px(44), h: px(34), text: `${fav.name} · Linha ${fav.line}`, text_size: px(24), color: c.text })

      // Coluna da esquerda: número grande (cor pela proximidade), "min" e rótulo.
      w.eta = this.text({ x: px(NUM_X), y: px(92), w: px(NUM_W), h: px(200), text_size: px(190), color: c.eta })
      w.etaMin = this.text({ x: px(NUM_X), y: px(268), w: px(NUM_W), h: px(40), text_size: px(32), color: c.text, text: 'min' })
      w.etaLabel = this.text({ x: px(30), y: px(310), w: px(210), h: px(34), text_size: px(24), color: c.eta })

      // Metade direita: mini mapa com escala fixa (1 km = 90 px).
      // Anel = disco na cor da divisória com disco do fundo por cima.
      w.mapRing = this.widget(hmUI.widget.CIRCLE, {
        center_x: px(MAP_CX),
        center_y: px(MAP_CY),
        radius: px(MAP_RING_R),
        color: c.divider
      })
      w.mapInner = this.widget(hmUI.widget.CIRCLE, {
        center_x: px(MAP_CX),
        center_y: px(MAP_CY),
        radius: px(MAP_RING_R - 3),
        color: c.bg
      })
      // Cruz fina no centro para orientar (norte para cima).
      w.mapCrossH = this.widget(hmUI.widget.FILL_RECT, {
        x: px(MAP_CX - MAP_RING_R + 8),
        y: px(MAP_CY) - 1,
        w: px(2 * (MAP_RING_R - 8)),
        h: 2,
        color: c.divider
      })
      w.mapCrossV = this.widget(hmUI.widget.FILL_RECT, {
        x: px(MAP_CX) - 1,
        y: px(MAP_CY - MAP_RING_R + 8),
        w: 2,
        h: px(2 * (MAP_RING_R - 8)),
        color: c.divider
      })
      // Trajeto (linhas) num CANVAS; os pontos da linha são CIRCLEs por cima.
      w.mapCanvas = this.widget(hmUI.widget.CANVAS, {
        x: px(CANVAS_X),
        y: px(CANVAS_Y),
        w: px(CANVAS_SIZE),
        h: px(CANVAS_SIZE)
      })
      w.lineStops = []
      for (let i = 0; i < MAX_MAP_STOPS; i++) {
        w.lineStops.push(
          this.widget(hmUI.widget.CIRCLE, {
            center_x: px(MAP_CX),
            center_y: px(MAP_CY),
            radius: px(LINE_STOP_R),
            color: c.muted
          })
        )
      }
      // Ponto: alvo (disco na cor do texto com miolo do fundo).
      w.stopOuter = this.widget(hmUI.widget.CIRCLE, {
        center_x: px(MAP_CX),
        center_y: px(MAP_CY),
        radius: px(STOP_R),
        color: c.text
      })
      w.stopInner = this.widget(hmUI.widget.CIRCLE, {
        center_x: px(MAP_CX),
        center_y: px(MAP_CY),
        radius: px(STOP_R - 4),
        color: c.bg
      })
      // Ônibus seguintes (menores, cinza) e o primeiro por cima, na cor do tempo.
      w.otherDots = []
      for (let i = 0; i < MAX_OTHERS; i++) {
        w.otherDots.push(
          this.widget(hmUI.widget.CIRCLE, {
            center_x: px(MAP_CX),
            center_y: px(MAP_CY),
            radius: px(OTHER_R),
            color: c.muted
          })
        )
      }
      // src é relativo à pasta assets do target (assets/common.r/).
      w.busDot = this.widget(hmUI.widget.IMG, {
        x: px(MAP_CX - BUS_HALF),
        y: px(MAP_CY - BUS_HALF),
        w: px(BUS_ICON_SIZE),
        h: px(BUS_ICON_SIZE),
        auto_scale: true,
        src: busIcon(null, this.state.theme)
      })
      // Aviso de GPS velho, logo abaixo do mapa.
      w.etaAge = this.text({ x: px(250), y: px(344), w: px(190), h: px(26), text_size: px(20), color: c.error })

      // Linha de baixo: distância e os próximos ônibus.
      w.info = this.text({ ...box(px(70)), y: px(372), h: px(30), text_size: px(22), color: c.muted })

      // Estados sem dados (carregando, vazio, erro, sem conexão): título + detalhe.
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

      // Rodapé (horário): em y 404-432 a tela redonda tem ~288 px visíveis; a caixa tem 280.
      w.footer = this.text({ ...box(px(100)), y: px(404), h: px(28), text_size: px(20), color: c.muted })
      w.footer.setProperty(hmUI.prop.TEXT, this.state.footerText)
    },

    setFooter(text) {
      this.state.footerText = text
      this.state.w.footer.setProperty(hmUI.prop.TEXT, text)
    },

    // Tema mudou no celular com a página aberta: apaga e recria os widgets com
    // as cores novas e repõe o que estava na tela. A consulta em andamento e o
    // timer seguem iguais (show() usa sempre state.w atual).
    onCall(data) {
      if (!data || this.state.destroyed) return
      if (data.method !== 'SETTINGS_CHANGED' && data.method !== 'FAVORITES_CHANGED') return
      const { theme } = parseSettingsResult(data.result, this.state.theme)
      if (theme === this.state.theme) return
      this.state.theme = theme
      this.repaint()
    },

    repaint() {
      const view = this.state.view
      const footer = this.state.footerText
      this.stopDots()
      this.stopAnim()
      this.state.busPos = null
      this.state.all.forEach((x) => hmUI.deleteWidget(x))
      this.state.all = []
      this.createWidgets()
      if (view.kind === 'data') this.show(view.result, null)
      else if (view.kind === 'status') this.showStatus(view.title, view.detail, view.role)
      else this.showLoading()
      this.setFooter(footer) // show() reescreve o horário; mantém o da última consulta.
    },

    setVisible(widgets, visible) {
      widgets.forEach((x) => x.setProperty(hmUI.prop.VISIBLE, visible))
    },

    dataWidgets() {
      const w = this.state.w
      return [
        w.eta, w.etaMin, w.etaLabel, w.etaAge, w.info,
        w.mapRing, w.mapInner, w.mapCrossH, w.mapCrossV, w.stopOuter, w.stopInner,
        ...w.lineStops, ...w.otherDots, w.busDot
      ]
    },

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

    clearMap() {
      const canvas = this.state.w.mapCanvas
      if (canvas) canvas.clear({ x: 0, y: 0, w: px(CANVAS_SIZE), h: px(CANVAS_SIZE) })
    },

    // Trajeto, trecho destacado e pontos da linha. map já vem validado
    // (parseBusesResult) e em pixels relativos ao centro; null = só o anel.
    drawMap(map) {
      const w = this.state.w
      const c = this.colors()
      this.clearMap()
      const canvas = w.mapCanvas
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
      }
      const stops = map ? map.stops : []
      w.lineStops.forEach((dot, i) => {
        const has = 2 * i + 1 < stops.length
        dot.setProperty(hmUI.prop.VISIBLE, has)
        if (has) {
          dot.setProperty(hmUI.prop.MORE, {
            center_x: px(MAP_CX + stops[2 * i]),
            center_y: px(MAP_CY + stops[2 * i + 1]),
            radius: px(LINE_STOP_R),
            color: c.muted
          })
        }
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

    // role: 'text' ou 'error' (papel de cor do tema atual).
    showStatus(title, detail, role) {
      const w = this.state.w
      this.state.view = { kind: 'status', title, detail, role }
      this.stopDots()
      this.state.hasData = false
      this.setVisible(this.dataWidgets(), false)
      this.stopAnim()
      this.state.busPos = null
      this.clearMap()
      this.setVisible([w.statusTitle, w.statusDetail], true)
      w.statusTitle.setProperty(hmUI.prop.TEXT, title)
      w.statusTitle.setProperty(hmUI.prop.COLOR, this.colors()[role] || this.colors().text)
      w.statusDetail.setProperty(hmUI.prop.TEXT, detail || '')
    },

    // Uma consulta por vez: a próxima só é agendada quando esta termina.
    refresh() {
      if (this.state.destroyed || this.state.loading) return
      this.state.loading = true
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
      const { line, lat, lon, dir, stopId } = this.state.fav
      // Com dados na tela, só avisa no rodapé em vez de apagar tudo.
      if (this.state.hasData) this.setFooter('Atualizando...')
      const done = () => {
        this.state.loading = false
        if (!this.state.destroyed) this.state.timer = setTimeout(() => this.refresh(), REFRESH_MS)
      }
      this.request({ method: 'GET_BUSES', params: { line, lat, lon, dir, stopId } })
        .then((data) => {
          const { result, error } = data || {}
          this.show(result, error)
        })
        .catch(() => this.show(null, 'offline'))
        .then(done, done)
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
      if (!buses || buses.length === 0) {
        this.showStatus('Nenhum ônibus', 'Uai, essa linha não tem ônibus rodando agora.', 'text')
        this.setFooter(`Atualizado ${clock()}`)
        return
      }

      const [first, ...rest] = buses
      const others = rest.slice(0, MAX_OTHERS)
      const c = this.colors()
      const hot = etaColor(first.etaMin, this.state.theme)
      this.state.view = { kind: 'data', result }
      this.stopDots()
      this.state.hasData = true
      this.setVisible([w.statusTitle, w.statusDetail], false)
      this.setVisible(this.dataWidgets(), true)

      // Número grande: fonte menor com 2 ou 3 dígitos para caber na coluna.
      const n = String(first.etaMin)
      w.eta.setProperty(hmUI.prop.MORE, { text_size: px(etaFontSize(n)) })
      w.eta.setProperty(hmUI.prop.TEXT, n)
      w.eta.setProperty(hmUI.prop.COLOR, hot)
      w.etaLabel.setProperty(hmUI.prop.TEXT, etaLabel(first.etaMin))
      w.etaLabel.setProperty(hmUI.prop.COLOR, hot)

      const stale = first.ageSec !== null && first.ageSec !== undefined && first.ageSec >= STALE_SEC
      w.etaAge.setProperty(hmUI.prop.TEXT, stale ? ageText(first.ageSec) : '')
      w.info.setProperty(hmUI.prop.TEXT, infoLine(first, others))

      this.drawMap(map)

      // Ônibus: posição em pixels vinda do celular; sem ela, calcula em linha reta.
      const stop = this.state.fav
      const offset = (bus, index) => {
        const fromMap = map && map.buses[index]
        return fromMap
          ? { dx: fromMap.x, dy: fromMap.y }
          : mapOffset(stop, bus, { pxPerKm: MAP_PX_PER_KM, maxR: MAP_MAX_R })
      }
      // MORE recebe todas as propriedades do círculo de uma vez.
      const place = (dot, bus, index, r, color) => {
        const o = offset(bus, index)
        dot.setProperty(hmUI.prop.VISIBLE, !!o)
        if (o) {
          dot.setProperty(hmUI.prop.MORE, {
            center_x: px(MAP_CX + o.dx),
            center_y: px(MAP_CY + o.dy),
            radius: px(r),
            color
          })
        }
      }
      w.otherDots.forEach((dot, i) => {
        if (others[i]) place(dot, others[i], i + 1, OTHER_R, c.muted)
        else dot.setProperty(hmUI.prop.VISIBLE, false)
      })
      // Primeiro ônibus: ícone da faixa de tempo, centrado na posição (x-24, y-24).
      // Com trajeto, desliza até o ponto entre as atualizações (startAnim).
      const o = offset(first, 0)
      const src = busIcon(first.etaMin, this.state.theme)
      const prev = this.state.busPos
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

      this.setFooter(`Atualizado ${clock()}`)
    },

    onDestroy() {
      this.state.destroyed = true
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
      this.stopDots()
      this.stopAnim()
    }
  })
)
