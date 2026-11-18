import { BaseApp } from '@zeppos/zml/base-app'
import TransferFile from '@zos/ble/TransferFile'
import { createMapStorage, storeReceivedTile } from './utils/map-store'
import { inboxOf, onNewFile, readyStateOf as stateOf } from './shared/transfer'

App(
  BaseApp({
    globalData: {
      // Uma instância só de LocalStorage para o app todo (utils/map-store.js).
      mapStorage: null,
      // param do alarme do sistema (utils/alarms.js), lido pela tela inicial.
      launchParam: null,
      transfer: null
    },
    onCreate(param) {
      console.log('Cadê o Busão: app criado')
      this.globalData.launchParam = typeof param === 'string' ? param : null
      try {
        this.globalData.mapStorage = createMapStorage()
      } catch (e) {
        console.log('Cadê o Busão: LocalStorage indisponível', e && e.message ? e.message : e)
      }
      // Recebe os blocos do mapa pela inbox (jeito da doc, com o da zml de reserva).
      try {
        this.globalData.transfer = new TransferFile()
        const ok = onNewFile(inboxOf(this.globalData.transfer), (file) => this.receiveTile(file))
        if (!ok) console.log('Mapa: inbox indisponível')
      } catch (e) {
        console.log('Mapa: TransferFile indisponível', e && e.message ? e.message : e)
      }
    },

    // Blocos do mapa de BH vindos do celular (inbox do TransferFile). A zml liga
    // isso ao evento 'newfile' do inbox no onCreate do app; fica aqui (e não numa
    // página) porque a zml remove todos os ouvintes do inbox quando uma página com
    // onReceivedFile fecha. As páginas NÃO devem definir onReceivedFile.
    // storeReceivedTile guarda o bloco, marca no registro (LocalStorage) e apaga os
    // usados há mais tempo quando passa do limite do cache (shared/map-demand.js). A
    // tela do ponto relê o registro a cada 1,5 s enquanto faltam blocos da vista.
    receiveTile(file) {
      try {
        if (!file || typeof file.on !== 'function') return
        file.on('change', (ev) => {
          try {
            if (stateOf(ev) !== 'transferred') return
            if (!storeReceivedTile(file)) console.log('Mapa: arquivo ignorado', file.fileName)
          } catch (e) {
            console.log('Mapa: erro ao guardar bloco', e && e.message ? e.message : e)
          }
        })
      } catch (e) {
        console.log('Mapa: erro no arquivo recebido', e && e.message ? e.message : e)
      }
    },

    onDestroy() {
      console.log('Cadê o Busão: app encerrado')
    }
  })
)
