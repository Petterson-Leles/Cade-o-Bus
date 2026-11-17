// Tela de um ponto (layout "B"): número grande do ônibus que chega primeiro à
// esquerda, mini mapa à direita e os seguintes numa linha embaixo.
// Atualiza 30 s após cada resposta.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme, etaColor, etaLabel } from '../../utils/ui'
import { parseDetailParams, parseSettingsResult } from '../../utils/favorites'
import { mapOffset, etaFontSize, infoLine, MAP_PX_PER_KM } from '../../utils/detail-view'

const REFRESH_MS = 30 * 1000
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
const BUS_R = 12 // marcador do primeiro ônibus
const OTHER_R = 6 // marcadores dos seguintes
const STOP_R = 10 // marcador do ponto
// O centro do marcador fica dentro do anel.
const MAP_MAX_R = MAP_RING_R - BUS_R

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
      w.busDot = this.widget(hmUI.widget.CIRCLE, {
        center_x: px(MAP_CX),
        center_y: px(MAP_CY),
        radius: px(BUS_R),
        color: c.eta
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
      this.state.all.forEach((x) => hmUI.deleteWidget(x))
      this.state.all = []
      this.createWidgets()
      if (view.kind === 'data') this.show(view.buses, null)
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
        ...w.otherDots, w.busDot
      ]
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
      const { line, lat, lon } = this.state.fav
      // Com dados na tela, só avisa no rodapé em vez de apagar tudo.
      if (this.state.hasData) this.setFooter('Atualizando...')
      const done = () => {
        this.state.loading = false
        if (!this.state.destroyed) this.state.timer = setTimeout(() => this.refresh(), REFRESH_MS)
      }
      this.request({ method: 'GET_BUSES', params: { line, lat, lon } })
        .then((data) => {
          const { result, error } = data || {}
          this.show(result, error)
        })
        .catch(() => this.show(null, 'offline'))
        .then(done, done)
    },

    show(buses, error) {
      if (this.state.destroyed) return
      const w = this.state.w
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
      this.state.view = { kind: 'data', buses }
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

      // Mini mapa: ônibus na posição relativa ao ponto (sem lat/lon, some).
      const stop = this.state.fav
      // MORE recebe todas as propriedades do círculo de uma vez.
      const place = (dot, bus, r, color) => {
        const o = mapOffset(stop, bus, { pxPerKm: MAP_PX_PER_KM, maxR: MAP_MAX_R })
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
        if (others[i]) place(dot, others[i], OTHER_R, c.muted)
        else dot.setProperty(hmUI.prop.VISIBLE, false)
      })
      place(w.busDot, first, BUS_R, hot)

      this.setFooter(`Atualizado ${clock()}`)
    },

    onDestroy() {
      this.state.destroyed = true
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
      this.stopDots()
    }
  })
)
