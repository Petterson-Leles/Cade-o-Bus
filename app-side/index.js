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
import { settingsPayload, readFavorites, FAVORITES_KEY } from '../utils/favorites'
import { THEME_KEY } from '../utils/colors'
import { lineCodesFor } from '../shared/line-codes'
import { lineShape, lineStops } from '../shared/gtfs'
import { routeContext, busOnRoute, buildMapPayload, pointAt, speedPxPerSec } from '../shared/route-map'
import { chooseFrame, MAP_VIEW_R, MAP_BUS_MAX_R } from '../shared/map-frame'
import { trackPassing, latestPassed } from '../shared/passing'
import { summarizeEtas, withStreets, createFeedCache } from '../shared/summary'
// Pacote gerado por scripts/build-gtfs.mjs (GTFS oficial de BH, SUMOB/PBH).
import GTFS_INDEX from '../data/gtfs-index'
import GTFS_SHAPES from '../data/gtfs-shapes'

// Tempo máximo para a BHTrans responder. O fetch do side service não garante
// a opção timeout (a doc só lista url/method/headers/body), então há também
// um limite próprio com Promise.race.
const FETCH_TIMEOUT_MS = 15 * 1000
// Um download do feed vale para todos os pedidos feitos nesse intervalo
// (tela inicial com vários pontos + tela do ponto aberta).
const FEED_TTL_MS = 15 * 1000

// Trajeto e pontos em volta de cada favorito, calculados uma vez por ponto.
const routeCache = new Map()
const ROUTE_CACHE_MAX = 20
// Memória de "quem estava chegando" por ponto, para saber quem acabou de passar.
const passingMemory = new Map()

const routeKey = (params) => [params.line, params.dir, params.stopId || '', params.lat, params.lon].join('|')

// { ctx, stops } do favorito (linha + sentido + ponto) ou null se não estiver no pacote.
function routeFor(params) {
  if (params.dir === undefined) return null
  const key = routeKey(params)
  if (routeCache.has(key)) return routeCache.get(key)
  const shape = lineShape(GTFS_SHAPES, params.line, params.dir)
  const stops = lineStops(GTFS_INDEX, params.line, params.dir)
  const ctx = shape.length >= 2 ? routeContext(shape, { lat: params.lat, lon: params.lon }) : null
  const value = ctx || stops.length > 0 ? { ctx, stops } : null
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value)
  routeCache.set(key, value)
  return value
}

// Ônibus do ponto a partir das linhas do feed já lidas. Também atualiza a
// memória de passagem do ponto. Devolve { buses, route, passed }.
function analyze(params, rows, { limit = 3, now = Date.now() } = {}) {
  const route = routeFor(params)
  const ctx = route && route.ctx
  const obs = []
  const buses = nearestBuses(rows, {
    ...params,
    now,
    limit,
    codes: lineCodesFor(params.line),
    routeDistance: ctx
      ? (lat, lon, extra) => {
          const r = busOnRoute(ctx, { lat, lon, ...extra })
          if (r && extra && extra.vehicle) {
            obs.push({ vehicle: extra.vehicle, lat, lon, along: r.along, passed: r.passed, wrongWay: !!r.wrongWay, toStopM: r.toStopM })
          }
          return r
        }
      : null
  })
  let passed = null
  if (ctx) {
    const key = routeKey(params)
    const { state } = trackPassing(passingMemory.get(key) || null, obs, now)
    if (passingMemory.size >= ROUTE_CACHE_MAX && !passingMemory.has(key)) passingMemory.delete(passingMemory.keys().next().value)
    passingMemory.set(key, state)
    passed = latestPassed(state, now)
  }
  return { buses, route, passed }
}

AppSideService(
  BaseSideService({
    onInit() {
      this.feed = createFeedCache(() => this.downloadFeed(), FEED_TTL_MS)
    },

    async downloadFeed() {
      // this.fetch da zml repassa ao fetch nativo com timeout padrão de 10 s.
      const response = await withTimeout(
        this.fetch({ url: BHTRANS_REALTIME_URL, method: 'GET', timeout: FETCH_TIMEOUT_MS }),
        FETCH_TIMEOUT_MS
      )
      return parseCsv(readFeedResponse(response))
    },

    feedRows() {
      if (!this.feed) this.feed = createFeedCache(() => this.downloadFeed(), FEED_TTL_MS)
      return this.feed.get()
    },

    async getBuses(params) {
      const rows = await this.feedRows()
      const { buses, route, passed } = analyze(params, rows)
      const ctx = route && route.ctx
      const withRoute = buses.map((b) => ({ ...b, route: ctx ? busOnRoute(ctx, b) : null }))
      // Enquadramento: automático (ônibus e ponto juntos) ou o zoom manual do relógio.
      const first = withRoute[0]
      let busXY = null
      if (first) {
        busXY = ctx && first.route && !first.route.passed ? pointAt(ctx.pts, ctx.cum, first.route.along) : null
        if (!busXY && ctx) busXY = ctx.project(first.lat, first.lon)
      }
      const frame = chooseFrame({ busXY, zoom: params.zoom })
      const pxPerM = frame.k / 1000
      // Mini mapa já em pixels: o relógio só desenha.
      const map = buildMapPayload({
        ctx,
        stop: { id: params.stopId, lat: params.lat, lon: params.lon },
        buses: withRoute,
        lineStops: route ? route.stops : [],
        radiusM: MAP_VIEW_R / pxPerM,
        pxPerKm: frame.k,
        center: frame.center,
        busMaxR: MAP_BUS_MAX_R,
        passed
      })
      map.auto = frame.auto
      // Para o relógio animar o ícone entre as atualizações (pixels de design por segundo).
      map.speed = buses[0] ? Math.round(speedPxPerSec(buses[0].speedKmh, frame.k) * 100) / 100 : 0
      return { buses, map }
    },

    // Próximo ônibus de todos os pontos salvos com um único download do feed.
    async getSummary() {
      const favorites = readFavorites(settingsLib)
      if (favorites.length === 0) return { items: [] }
      const rows = await this.feedRows()
      const now = Date.now()
      const items = summarizeEtas(favorites, (fav) => {
        const params = parseBusParams(fav)
        if (!params) return null
        const { buses } = analyze(params, rows, { limit: 1, now })
        return buses[0] ? buses[0].etaMin : null
      })
      return { items }
    },

    // Favoritos com o nome da rua do ponto (abreviado) e o tema.
    settingsForWatch() {
      const payload = settingsPayload(settingsLib)
      return { ...payload, favorites: withStreets(payload.favorites, GTFS_INDEX) }
    },

    onRequest(req, res) {
      const method = req && req.method
      if (method === 'GET_FAVORITES') {
        // { favorites, theme }: o relógio usa o tema para pintar as telas.
        res(null, { result: this.settingsForWatch() })
      } else if (method === 'GET_SUMMARY') {
        this.getSummary()
          .then((result) => res(null, { result }))
          .catch((e) => {
            console.log('Erro no resumo da BHTrans:', e && e.message ? e.message : e)
            res(null, { error: 'Sem conexão com a BHTrans' })
          })
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

    // Só avisa o relógio quando os favoritos ou o tema mudam (não no rascunho do
    // formulário, na mensagem nem no "desfazer", que também ficam no settingsStorage).
    onSettingsChange(change) {
      if (!change || (change.key !== FAVORITES_KEY && change.key !== THEME_KEY)) return
      this.call({ method: 'SETTINGS_CHANGED', result: this.settingsForWatch() })
    },

    onRun() {},
    onDestroy() {}
  })
)
