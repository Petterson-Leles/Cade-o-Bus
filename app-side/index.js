// Side service: roda no app Zepp do celular, que é quem tem internet.
// O relógio pede os dados por mensagem e recebe só o resultado já filtrado.
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import {
  BHTRANS_REALTIME_URL,
  parseCsv,
  nearestBuses,
  readFeedResponse,
  parseBusParams,
  withTimeout
} from '../shared/bhtrans'
import { readFavorites, FAVORITES_KEY } from '../utils/favorites'

// Tempo máximo para a BHTrans responder. O fetch do side service não garante
// a opção timeout (a doc só lista url/method/headers/body), então há também
// um limite próprio com Promise.race.
const FETCH_TIMEOUT_MS = 15 * 1000

AppSideService(
  BaseSideService({
    onInit() {},

    async getBuses(params) {
      // this.fetch da zml repassa ao fetch nativo com timeout padrão de 10 s.
      const response = await withTimeout(
        this.fetch({ url: BHTRANS_REALTIME_URL, method: 'GET', timeout: FETCH_TIMEOUT_MS }),
        FETCH_TIMEOUT_MS
      )
      const text = readFeedResponse(response)
      return nearestBuses(parseCsv(text), params)
    },

    onRequest(req, res) {
      const method = req && req.method
      if (method === 'GET_FAVORITES') {
        res(null, { result: readFavorites(settingsLib) })
      } else if (method === 'GET_BUSES') {
        const params = parseBusParams(req.params)
        if (!params) {
          res(null, { error: 'Ponto inválido' })
          return
        }
        this.getBuses(params)
          .then((buses) => res(null, { result: buses }))
          .catch((e) => {
            console.log('Erro ao consultar a BHTrans:', e && e.message ? e.message : e)
            res(null, { error: 'Sem conexão com a BHTrans' })
          })
      } else {
        res(null, { error: 'Pedido desconhecido' })
      }
    },

    // Só avisa o relógio quando os favoritos mudam (não no rascunho do formulário).
    onSettingsChange(change) {
      if (!change || change.key !== FAVORITES_KEY) return
      this.call({ method: 'FAVORITES_CHANGED', result: readFavorites(settingsLib) })
    },

    onRun() {},
    onDestroy() {}
  })
)
