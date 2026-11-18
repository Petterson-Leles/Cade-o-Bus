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
    // Com o App Service do mapa rodando (app-service/map-service.js, download com a
    // tela desligada), ele também ouve o inbox. Não há como escolher quem recebe cada
    // arquivo: quem receber guarda. storeReceivedTile é idempotente (não apaga um
    // bloco já guardado se o original sumiu) e cada um anota no seu registro (o app no
    // LocalStorage, o service no JSON dele); a contagem é a união dos dois.
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
