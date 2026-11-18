import { BaseApp } from '@zeppos/zml/base-app'
import TransferFile from '@zos/ble/TransferFile'
import { createMapStorage, storeReceivedTile } from './utils/map-store'
import { inboxOf, watchInbox, fileKey, readyStateOf as stateOf } from './shared/transfer'

// Arquivos esperando o 'transferred' (reconferidos a cada aviso FILE do inbox).
const MAX_PENDING = 16
// Arquivos já tratados (o mesmo aviso pode chegar pelo inbox próprio e pelo da zml).
const MAX_SEEN = 32

App(
  BaseApp({
    globalData: {
      // Uma instância só de LocalStorage para o app todo (utils/map-store.js).
      mapStorage: null,
      // param do alarme do sistema (utils/alarms.js), lido pela tela inicial.
      launchParam: null,
      transfer: null,
      // Diagnóstico do mapa (tela do ponto e pedido ao celular): arquivos que chegaram
      // ao inbox (rx), guardados (ok), ignorados/com erro (bad) e o último erro.
      mapDiag: { rx: 0, ok: 0, bad: 0, err: '' }
    },
    onCreate(param) {
      console.log('Cadê o Busão: app criado')
      this.globalData.launchParam = typeof param === 'string' ? param : null
      this.pendingFiles = []
      this.seenFiles = []
      try {
        this.globalData.mapStorage = createMapStorage()
      } catch (e) {
        console.log('Cadê o Busão: LocalStorage indisponível', e && e.message ? e.message : e)
      }
      // Recebe os blocos do mapa pela inbox (jeito da doc). A zml também liga o
      // inbox da instância dela ao onReceivedFile abaixo: os dois caminhos chegam em
      // receiveTile, que ignora o arquivo repetido.
      try {
        this.globalData.transfer = new TransferFile()
        const ok = watchInbox(inboxOf(this.globalData.transfer), {
          onFile: (file) => this.receiveTile(file),
          onFinished: () => this.recheckPending()
        })
        if (!ok) this.mapError('inbox indisponível')
      } catch (e) {
        this.mapError(`TransferFile: ${e && e.message ? e.message : e}`)
      }
    },

    // Caminho da zml (inbox da instância de TransferFile dela, evento 'newfile').
    // Fica no app (e não numa página) porque a zml remove todos os ouvintes do inbox
    // quando uma página com onReceivedFile fecha. As páginas NÃO devem definir isso.
    onReceivedFile(file) {
      this.receiveTile(file)
    },

    mapError(text) {
      const d = this.globalData.mapDiag
      d.err = String(text).slice(0, 40)
      console.log('Mapa:', text)
    },

    // Blocos do mapa de BH vindos do celular. storeReceivedTile guarda o bloco, marca
    // no registro (LocalStorage) e apaga os usados há mais tempo quando passa do limite
    // do cache (shared/map-demand.js). A tela do ponto relê o registro a cada 1,5 s
    // enquanto faltam blocos da vista.
    receiveTile(file) {
      try {
        if (!file || typeof file !== 'object') return
        if (!this.seenFiles) this.seenFiles = []
        if (!this.pendingFiles) this.pendingFiles = []
        const key = fileKey(file)
        if (this.seenFiles.indexOf(key) >= 0 || this.pendingFiles.some((p) => p.key === key)) return
        this.globalData.mapDiag.rx += 1
        // Arquivo pequeno pode já ter chegado inteiro: guarda na hora.
        if (stateOf(file) === 'transferred') {
          this.storeTile(file, key)
          return
        }
        const entry = { file, key }
        this.pendingFiles.push(entry)
        if (this.pendingFiles.length > MAX_PENDING) this.pendingFiles.shift()
        if (typeof file.on === 'function') {
          file.on('change', (ev) => {
            const st = stateOf(ev) || stateOf(file)
            if (st === 'transferred') this.storeTile(file, key)
            else if (st === 'error' || st === 'canceled') this.dropTile(key, `transferência: ${st}`)
          })
        }
      } catch (e) {
        this.mapError(`recebimento: ${e && e.message ? e.message : e}`)
      }
    },

    // Aviso FILE ("terminou de receber"): guarda os que já estão prontos.
    recheckPending() {
      this.pendingFiles.slice().forEach((p) => {
        const st = stateOf(p.file)
        if (st === 'transferred') this.storeTile(p.file, p.key)
        else if (st === 'error' || st === 'canceled') this.dropTile(p.key, `transferência: ${st}`)
      })
    },

    storeTile(file, key) {
      if (this.seenFiles.indexOf(key) >= 0) return
      this.pendingFiles = this.pendingFiles.filter((p) => p.key !== key)
      this.seenFiles.push(key)
      if (this.seenFiles.length > MAX_SEEN) this.seenFiles.shift()
      const d = this.globalData.mapDiag
      try {
        const r = storeReceivedTile(file)
        if (r && r.ok) d.ok += 1
        else {
          d.bad += 1
          this.mapError((r && r.reason) || 'não guardou')
        }
      } catch (e) {
        d.bad += 1
        this.mapError(`guardar: ${e && e.message ? e.message : e}`)
      }
    },

    dropTile(key, reason) {
      if (this.seenFiles.indexOf(key) >= 0) return
      this.pendingFiles = this.pendingFiles.filter((p) => p.key !== key)
      this.seenFiles.push(key)
      if (this.seenFiles.length > MAX_SEEN) this.seenFiles.shift()
      this.globalData.mapDiag.bad += 1
      this.mapError(reason)
    },

    onDestroy() {
      console.log('Cadê o Busão: app encerrado')
    }
  })
)
