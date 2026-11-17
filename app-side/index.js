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
import { settingsPayload, FAVORITES_KEY } from '../utils/favorites'
import { THEME_KEY } from '../utils/colors'
import { lineCodesFor } from '../shared/line-codes'
import { lineShape, lineStops } from '../shared/gtfs'
import { routeContext, busOnRoute, buildMapPayload, MAP_RADIUS_PX } from '../shared/route-map'
// Pacote gerado por scripts/build-gtfs.mjs (GTFS oficial de BH, SUMOB/PBH).
import GTFS_INDEX from '../data/gtfs-index'
import GTFS_SHAPES from '../data/gtfs-shapes'

// Tempo máximo para a BHTrans responder. O fetch do side service não garante
// a opção timeout (a doc só lista url/method/headers/body), então há também
// um limite próprio com Promise.race.
const FETCH_TIMEOUT_MS = 15 * 1000
// Margem entre o raio do trajeto e o centro do marcador do ônibus no mapa.
const BUS_MARGIN_PX = 4

// Trajeto e pontos em volta de cada favorito, calculados uma vez por ponto.
const routeCache = new Map()
const ROUTE_CACHE_MAX = 20

// { ctx, stops } do favorito (linha + sentido + ponto) ou null se não estiver no pacote.
function routeFor(params) {
  if (params.dir === undefined) return null
  const key = [params.line, params.dir, params.stopId || '', params.lat, params.lon].join('|')
  if (routeCache.has(key)) return routeCache.get(key)
  const shape = lineShape(GTFS_SHAPES, params.line, params.dir)
  const stops = lineStops(GTFS_INDEX, params.line, params.dir)
  const ctx = shape.length >= 2 ? routeContext(shape, { lat: params.lat, lon: params.lon }) : null
  const value = ctx || stops.length > 0 ? { ctx, stops } : null
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value)
  routeCache.set(key, value)
  return value
}

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
      const route = routeFor(params)
      const ctx = route && route.ctx
      const buses = nearestBuses(parseCsv(text), {
        ...params,
        codes: lineCodesFor(params.line),
        routeDistance: ctx ? (lat, lon, extra) => busOnRoute(ctx, { lat, lon, ...extra }) : null
      })
      // Mini mapa já em pixels: o relógio só desenha.
      const map = buildMapPayload({
        ctx,
        stop: { id: params.stopId, lat: params.lat, lon: params.lon },
        buses: buses.map((b) => ({ lat: b.lat, lon: b.lon, route: ctx ? busOnRoute(ctx, b) : null })),
        lineStops: route ? route.stops : [],
        busMaxR: MAP_RADIUS_PX - BUS_MARGIN_PX
      })
      return { buses, map }
    },

    onRequest(req, res) {
      const method = req && req.method
      if (method === 'GET_FAVORITES') {
        // { favorites, theme }: o relógio usa o tema para pintar as telas.
        res(null, { result: settingsPayload(settingsLib) })
      } else if (method === 'GET_BUSES') {
        const params = parseBusParams(req.params)
        if (!params) {
          res(null, { error: 'Ponto inválido' })
          return
        }
        this.getBuses(params)
          .then((result) => res(null, { result }))
          .catch((e) => {
            console.log('Erro ao consultar a BHTrans:', e && e.message ? e.message : e)
            res(null, { error: 'Sem conexão com a BHTrans' })
          })
      } else {
        res(null, { error: 'Pedido desconhecido' })
      }
    },

    // Só avisa o relógio quando os favoritos ou o tema mudam (não no rascunho do formulário).
    onSettingsChange(change) {
      if (!change || (change.key !== FAVORITES_KEY && change.key !== THEME_KEY)) return
      this.call({ method: 'SETTINGS_CHANGED', result: settingsPayload(settingsLib) })
    },

    onRun() {},
    onDestroy() {}
  })
)
