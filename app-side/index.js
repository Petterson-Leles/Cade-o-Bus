// Side service: roda no app Zepp do celular, que é quem tem internet.
// O relógio pede os dados por mensagem e recebe só o resultado já filtrado.
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { BHTRANS_REALTIME_URL, parseCsv, nearestBuses } from '../shared/bhtrans'
import { readFavorites } from '../utils/favorites'

async function getBuses({ line, lat, lon }) {
  const response = await fetch({ url: BHTRANS_REALTIME_URL, method: 'GET' })
  const text = typeof response.body === 'string' ? response.body : String(response.body)
  return nearestBuses(parseCsv(text), { line, lat, lon })
}

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      if (req.method === 'GET_FAVORITES') {
        res(null, { result: readFavorites(settingsLib) })
      } else if (req.method === 'GET_BUSES') {
        getBuses(req.params || {})
          .then((buses) => res(null, { result: buses }))
          .catch((e) => {
            console.log('Erro ao consultar a BHTrans:', e)
            res(null, { error: 'Sem conexão com a BHTrans' })
          })
      }
    },

    onSettingsChange() {
      this.call({ result: readFavorites(settingsLib) })
    },

    onRun() {},
    onDestroy() {}
  })
)
