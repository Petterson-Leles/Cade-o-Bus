// Tela de um ponto: destaca o ônibus que chega primeiro e lista os seguintes. Atualiza 30 s após cada resposta.
import * as hmUI from '@zos/ui'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'
import { formatDistance } from '../../shared/bhtrans'
import { DEVICE_WIDTH, DEVICE_HEIGHT, getTheme } from '../../utils/ui'
import { parseDetailParams, parseSettingsResult } from '../../utils/favorites'

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

      // Cabeçalho: linha em vermelho de Minas, nome do ponto em secundário.
      this.text({ ...box(px(100)), y: px(40), h: px(40), text: `Linha ${fav.line}`, text_size: px(28), color: c.title })
      this.text({ ...box(px(80)), y: px(80), h: px(34), text: fav.name, text_size: px(24), color: c.muted })

      // Ônibus mais próximo: número grande em ouro para ler em 1 segundo.
      w.eta = this.text({ ...box(px(60)), y: px(118), h: px(140), text_size: px(124), color: c.eta })
      w.etaSub = this.text({ ...box(px(60)), y: px(256), h: px(40), text_size: px(30), color: c.text })
      w.etaAge = this.text({ ...box(px(70)), y: px(296), h: px(30), text_size: px(22), color: c.muted })

      // Próximos ônibus, abaixo de um filete cor de terra.
      w.divider = this.widget(hmUI.widget.FILL_RECT, {
        x: px(150),
        y: px(336),
        w: DEVICE_WIDTH - 2 * px(150),
        h: px(2),
        radius: px(1),
        color: c.divider
      })
      w.others = []
      for (let i = 0; i < MAX_OTHERS; i++) {
        w.others.push(
          this.text({ ...box(px(90)), y: px(342) + i * px(30), h: px(30), text_size: px(26), color: c.text })
        )
      }

      // Estados sem dados (carregando, vazio, erro): título + detalhe.
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

      // Rodapé: em y 404-432 a tela redonda tem ~288 px visíveis; a caixa tem 280.
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
      return [w.eta, w.etaSub, w.etaAge, w.divider, ...w.others]
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
      const c = this.colors()
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
      this.state.view = { kind: 'data', buses }
      this.stopDots()
      this.state.hasData = true
      this.setVisible([w.statusTitle, w.statusDetail], false)
      this.setVisible([w.eta, w.etaSub, w.etaAge], true)

      w.eta.setProperty(hmUI.prop.TEXT, String(first.etaMin))
      w.etaSub.setProperty(hmUI.prop.TEXT, `min · ${formatDistance(first.distanceM)}`)
      const stale = first.ageSec !== null && first.ageSec !== undefined && first.ageSec >= STALE_SEC
      w.etaAge.setProperty(hmUI.prop.TEXT, stale ? ageText(first.ageSec) : `Ônibus ${first.vehicle}`)
      w.etaAge.setProperty(hmUI.prop.COLOR, stale ? c.error : c.muted)

      const others = rest.slice(0, MAX_OTHERS)
      w.divider.setProperty(hmUI.prop.VISIBLE, others.length > 0)
      w.others.forEach((t, i) => {
        const b = others[i]
        t.setProperty(hmUI.prop.VISIBLE, !!b)
        if (b) t.setProperty(hmUI.prop.TEXT, `${b.etaMin} min · ${formatDistance(b.distanceM)}`)
      })

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
