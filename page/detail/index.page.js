// Tela de um ponto: destaca o ônibus que chega primeiro e lista os seguintes. Atualiza 30 s após cada resposta.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import { formatDistance } from '../../shared/bhtrans'
import {
  DEVICE_WIDTH,
  COLOR_PRIMARY,
  COLOR_TEXT,
  COLOR_MUTED,
  COLOR_DIVIDER,
  COLOR_ERROR
} from '../../utils/ui'

const REFRESH_MS = 30 * 1000
const DOTS_MS = 500
const MAX_OTHERS = 2
// Posição do GPS mais velha que isso ganha aviso.
const STALE_SEC = 120

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
      this.state = {
        ...this.state,
        fav: null,
        timer: null,
        dotsTimer: null,
        hasData: false,
        loading: false,
        destroyed: false,
        w: {}
      }
      try {
        this.state.fav = JSON.parse(params)
      } catch (e) {
        this.state.fav = null
      }
    },

    text(opts) {
      return hmUI.createWidget(hmUI.widget.TEXT, {
        align_h: hmUI.align.CENTER_H,
        align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.ELLIPSIS,
        text: '',
        ...opts
      })
    },

    build() {
      const fav = this.state.fav || { name: '?', line: '?' }
      const w = this.state.w

      // Cabeçalho: linha em destaque, nome do ponto em cinza.
      this.text({ ...box(px(100)), y: px(40), h: px(40), text: `Linha ${fav.line}`, text_size: px(28), color: COLOR_PRIMARY })
      this.text({ ...box(px(80)), y: px(80), h: px(34), text: fav.name, text_size: px(24), color: COLOR_MUTED })

      // Ônibus mais próximo: número grande para ler em 1 segundo.
      w.eta = this.text({ ...box(px(60)), y: px(118), h: px(140), text_size: px(124), color: COLOR_PRIMARY })
      w.etaSub = this.text({ ...box(px(60)), y: px(256), h: px(40), text_size: px(30), color: COLOR_TEXT })
      w.etaAge = this.text({ ...box(px(70)), y: px(296), h: px(30), text_size: px(22), color: COLOR_MUTED })

      // Próximos ônibus.
      w.divider = hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: px(150),
        y: px(336),
        w: DEVICE_WIDTH - 2 * px(150),
        h: px(2),
        radius: px(1),
        color: COLOR_DIVIDER
      })
      w.others = []
      for (let i = 0; i < MAX_OTHERS; i++) {
        w.others.push(
          this.text({ ...box(px(90)), y: px(342) + i * px(30), h: px(30), text_size: px(26), color: COLOR_TEXT })
        )
      }

      // Estados sem dados (carregando, vazio, erro): título + detalhe.
      w.statusTitle = this.text({ ...box(px(60)), y: px(160), h: px(56), text_size: px(36), color: COLOR_TEXT })
      w.statusDetail = this.text({
        ...box(px(70)),
        y: px(220),
        h: px(110),
        text_size: px(26),
        color: COLOR_MUTED,
        align_v: hmUI.align.TOP,
        text_style: hmUI.text_style.WRAP
      })

      // Rodapé: em y 404-432 a tela redonda tem ~288 px visíveis; a caixa tem 280.
      w.footer = this.text({ ...box(px(100)), y: px(404), h: px(28), text_size: px(20), color: COLOR_MUTED })

      if (!this.state.fav) {
        this.showStatus('Ponto inválido', 'Volte e escolha o ponto de novo.', COLOR_ERROR)
        return
      }
      this.showLoading()
      this.refresh()
    },

    setVisible(widgets, visible) {
      widgets.forEach((x) => x.setProperty(hmUI.prop.VISIBLE, visible))
    },

    dataWidgets() {
      const w = this.state.w
      return [w.eta, w.etaSub, w.etaAge, w.divider, ...w.others]
    },

    stopDots() {
      if (this.state.dotsTimer) clearInterval(this.state.dotsTimer)
      this.state.dotsTimer = null
    },

    // Carregando: pontinhos animados para mostrar que o app está trabalhando.
    showLoading() {
      this.showStatus('Procurando ônibus', 'Consultando a BHTrans pelo celular', COLOR_TEXT)
      let n = 0
      this.state.dotsTimer = setInterval(() => {
        n = (n + 1) % 4
        this.state.w.statusTitle.setProperty(hmUI.prop.TEXT, 'Procurando ônibus' + '.'.repeat(n))
      }, DOTS_MS)
    },

    showStatus(title, detail, color) {
      const w = this.state.w
      this.stopDots()
      this.state.hasData = false
      this.setVisible(this.dataWidgets(), false)
      this.setVisible([w.statusTitle, w.statusDetail], true)
      w.statusTitle.setProperty(hmUI.prop.TEXT, title)
      w.statusTitle.setProperty(hmUI.prop.COLOR, color)
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
      if (this.state.hasData) this.state.w.footer.setProperty(hmUI.prop.TEXT, 'Atualizando...')
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
        this.showStatus('Sem conexão', 'Abra o app Zepp no celular e deixe o Bluetooth ligado.', COLOR_ERROR)
        w.footer.setProperty(hmUI.prop.TEXT, 'Nova tentativa em 30 s')
        return
      }
      if (error) {
        this.showStatus('Erro', error, COLOR_ERROR)
        w.footer.setProperty(hmUI.prop.TEXT, 'Nova tentativa em 30 s')
        return
      }
      if (!buses || buses.length === 0) {
        this.showStatus('Nenhum ônibus', 'Essa linha não tem ônibus circulando agora.', COLOR_TEXT)
        w.footer.setProperty(hmUI.prop.TEXT, `Atualizado ${clock()}`)
        return
      }

      const [first, ...rest] = buses
      this.stopDots()
      this.state.hasData = true
      this.setVisible([w.statusTitle, w.statusDetail], false)
      this.setVisible([w.eta, w.etaSub, w.etaAge], true)

      w.eta.setProperty(hmUI.prop.TEXT, String(first.etaMin))
      w.etaSub.setProperty(hmUI.prop.TEXT, `min · ${formatDistance(first.distanceM)}`)
      const stale = first.ageSec !== null && first.ageSec !== undefined && first.ageSec >= STALE_SEC
      w.etaAge.setProperty(hmUI.prop.TEXT, stale ? ageText(first.ageSec) : `Ônibus ${first.vehicle}`)
      w.etaAge.setProperty(hmUI.prop.COLOR, stale ? COLOR_ERROR : COLOR_MUTED)

      const others = rest.slice(0, MAX_OTHERS)
      w.divider.setProperty(hmUI.prop.VISIBLE, others.length > 0)
      w.others.forEach((t, i) => {
        const b = others[i]
        t.setProperty(hmUI.prop.VISIBLE, !!b)
        if (b) t.setProperty(hmUI.prop.TEXT, `${b.etaMin} min · ${formatDistance(b.distanceM)}`)
      })

      w.footer.setProperty(hmUI.prop.TEXT, `Atualizado ${clock()}`)
    },

    onDestroy() {
      this.state.destroyed = true
      if (this.state.timer) clearTimeout(this.state.timer)
      this.state.timer = null
      this.stopDots()
    }
  })
)
