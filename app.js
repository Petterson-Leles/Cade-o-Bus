import { BaseApp } from '@zeppos/zml/base-app'
import { createMapStorage, storeReceivedTile } from './utils/map-store'

// Estado do arquivo no evento 'change' (a doc chama o campo de `date`; os exemplos, de `data`).
// https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/
const readyStateOf = (ev) => {
  const d = ev && (ev.data || ev.date)
  return d && d.readyState
}

App(
  BaseApp({
    globalData: {
      // Uma instância só de LocalStorage para o app todo (utils/map-store.js).
      mapStorage: null,
      // param do alarme do sistema (utils/alarms.js), lido pela tela inicial.
      launchParam: null
    },
    onCreate(param) {
      console.log('Cadê o Busão: app criado')
      this.globalData.launchParam = typeof param === 'string' ? param : null
      try {
        this.globalData.mapStorage = createMapStorage()
      } catch (e) {
        console.log('Cadê o Busão: LocalStorage indisponível', e && e.message ? e.message : e)
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
    onReceivedFile(file) {
      try {
        if (!file || typeof file.on !== 'function') return
        file.on('change', (ev) => {
          try {
            if (readyStateOf(ev) !== 'transferred') return
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
