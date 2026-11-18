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
import { lineVariants } from '../shared/gtfs'
import { variantsThroughStop, busOnVariants, buildMapPayload, pointAt, makeProjection, speedPxPerSec } from '../shared/route-map'
import { chooseFrame, stableFrame, MAP_VIEW_R, MAP_BUS_MAX_R } from '../shared/map-frame'
import { trackPassing, latestPassed } from '../shared/passing'
import { summarizeEtas, withStreets, createFeedCache } from '../shared/summary'
import { mapSync } from './map-sync'
import { MAP_COMMAND_KEY } from '../shared/map-download'
import { parseDemandParams } from '../shared/map-demand'
import { parseLevelIndex } from '../shared/map-frame'
import { VIBRATE_KEY } from '../utils/favorites'
import { codedError, feedFailureCode, errorPayload, ERR } from '../shared/conn-errors'
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
// Último enquadramento automático por ponto (o mapa não muda a cada atualização).
const frameMemory = new Map()

const routeKey = (params) => [params.line, params.dir, params.stopId || '', params.lat, params.lon].join('|')

// { variants: [{ ctx, stops, main }] } do favorito (linha + sentido + ponto): todos
// os trajetos do sentido que passam pelo ponto (o principal e as variantes do GTFS),
// ou null se a linha não estiver no pacote.
function routeFor(params) {
  if (params.dir === undefined) return null
  const key = routeKey(params)
  if (routeCache.has(key)) return routeCache.get(key)
  const all = lineVariants(GTFS_SHAPES, GTFS_INDEX, params.line, params.dir)
  const variants = variantsThroughStop(all, { lat: params.lat, lon: params.lon }, params.stopId).filter((v) => v.ctx || v.stops.length > 0)
  const value = variants.length > 0 ? { variants } : null
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value)
  routeCache.set(key, value)
  return value
}

// Ônibus do ponto a partir das linhas do feed já lidas. Também atualiza a
// memória de passagem do ponto. Cada ônibus é encaixado na variante do trajeto em
// que está (busOnVariants); fora de todas, sai da lista.
// Devolve { buses, route, passed, onRoute: Map(veículo -> saída de busOnVariants) }.
function analyze(params, rows, { limit = 3, now = Date.now() } = {}) {
  const route = routeFor(params)
  const variants = route ? route.variants.filter((v) => v.ctx) : []
  const ctx = variants.length > 0
  const onRoute = new Map()
  const obs = []
  const buses = nearestBuses(rows, {
    ...params,
    now,
    limit,
    codes: lineCodesFor(params.line),
    routeDistance: ctx
      ? (lat, lon, extra) => {
          const r = busOnVariants(variants, { lat, lon, ...extra })
          if (r && extra && extra.vehicle) {
            onRoute.set(extra.vehicle, r)
            obs.push({ vehicle: extra.vehicle, lat, lon, along: r.along, variant: r.variant, passed: r.passed, wrongWay: !!r.wrongWay, toStopM: r.toStopM })
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
  // all: inclusive as sem trajeto (só pontos), para o mapa ainda mostrar os pontos.
  return { buses, route: route ? { variants, all: route.variants } : null, passed, onRoute }
}

// Posição (metros, projeção do ponto) de um ônibus na sua variante.
function posOnVariant(variants, r) {
  const v = r && variants[r.variant]
  return v && v.ctx && Number.isFinite(r.along) ? pointAt(v.ctx.pts, v.ctx.cum, r.along) : null
}

AppSideService(
  BaseSideService({
    // Mapa sob demanda (app-side/map-sync.js).
    ...mapSync,

    onInit() {
      this.feed = createFeedCache(() => this.downloadFeed(), FEED_TTL_MS)
      try {
        if (!this.mapReady) this.mapInit()
      } catch (e) {
        console.log('Mapa: erro ao iniciar', e && e.message ? e.message : e)
      }
    },

    // Erros com código (shared/conn-errors.js): sem resposta = celular sem internet;
    // resposta com erro/formato inválido = BHTrans fora do ar.
    async downloadFeed() {
      let response
      try {
        // this.fetch da zml repassa ao fetch nativo com timeout padrão de 10 s.
        response = await withTimeout(this.fetch({ url: BHTRANS_REALTIME_URL, method: 'GET', timeout: FETCH_TIMEOUT_MS }), FETCH_TIMEOUT_MS)
      } catch (e) {
        throw codedError(feedFailureCode('fetch'), e && e.message ? e.message : 'Sem resposta')
      }
      try {
        return parseCsv(readFeedResponse(response))
      } catch (e) {
        throw codedError(feedFailureCode('response'), e && e.message ? e.message : 'Resposta inválida')
      }
    },

    feedRows() {
      if (!this.feed) this.feed = createFeedCache(() => this.downloadFeed(), FEED_TTL_MS)
      return this.feed.get()
    },

    // demand: parseDemandParams (mapa sob demanda; shared/map-demand.js) ou null.
    async getBuses(params, demand = null) {
      const rows = await this.feedRows()
      const { buses, route, passed: passedRaw, onRoute } = analyze(params, rows)
      const variants = route ? route.variants : []
      // Variante desenhada: a do ônibus em destaque (senão a principal).
      const firstRoute = buses[0] ? onRoute.get(buses[0].vehicle) : null
      const drawn = (firstRoute && variants[firstRoute.variant]) || variants[0] || (route && route.all[0]) || null
      const ctx = drawn && drawn.ctx
      // Ônibus da variante desenhada vão pelo trajeto dela; os de outra variante,
      // no ponto do trajeto deles (mesma projeção, centrada no ponto).
      const withRoute = buses.map((b) => {
        const r = onRoute.get(b.vehicle) || null
        if (!r || variants[r.variant] === drawn) return { ...b, route: r }
        return { ...b, route: null, posM: posOnVariant(variants, r) }
      })
      let passed = passedRaw
      if (passed && Number.isInteger(passed.variant) && variants[passed.variant] !== drawn) {
        passed = { ...passed, along: NaN, posM: posOnVariant(variants, passed) }
      }
      // Enquadramento: automático (ônibus e ponto juntos), zoom manual do relógio
      // ou, com o mapa de ruas no relógio, só os níveis fixos dos blocos.
      const first = withRoute[0]
      let busXY = null
      if (first) {
        busXY = ctx && first.route && !first.route.passed ? pointAt(ctx.pts, ctx.cum, first.route.along) : null
        if (!busXY) busXY = first.posM || (ctx ? ctx.project : makeProjection(params))(first.lat, first.lon)
      }
      const key = routeKey(params)
      const ideal = chooseFrame({ busXY, zoom: params.zoom, levels: params.levels, level: params.level })
      const frame = stableFrame(frameMemory.get(key), ideal, busXY)
      if (frameMemory.size >= ROUTE_CACHE_MAX && !frameMemory.has(key)) frameMemory.delete(frameMemory.keys().next().value)
      frameMemory.set(key, frame)
      const pxPerM = frame.k / 1000
      // Mini mapa já em pixels: o relógio só desenha.
      const map = buildMapPayload({
        ctx,
        stop: { id: params.stopId, lat: params.lat, lon: params.lon },
        buses: withRoute,
        lineStops: drawn ? drawn.stops : [],
        radiusM: MAP_VIEW_R / pxPerM,
        pxPerKm: frame.k,
        center: frame.center,
        busMaxR: MAP_BUS_MAX_R,
        passed
      })
      map.auto = frame.auto
      // Mapa de ruas: nível usado e centro (metros) para o relógio posicionar os blocos.
      if (Number.isInteger(frame.level)) map.level = frame.level
      map.center = [Math.round(frame.center[0] * 10) / 10, Math.round(frame.center[1] * 10) / 10]
      // Para o relógio animar o ícone entre as atualizações (pixels de design por segundo).
      map.speed = buses[0] ? Math.round(speedPxPerSec(buses[0].speedKmh, frame.k) * 100) / 100 : 0
      // Mapa sob demanda: manda já os blocos da vista que faltam no relógio (na frente
      // da fila) e, se o relógio não tem, o manifesto curto.
      let tiles = null
      try {
        tiles = this.mapOnDemand(demand, map.level, map.center, { lat: params.lat, lon: params.lon })
      } catch (e) {
        console.log('Mapa: sob demanda', e && e.message ? e.message : e)
      }
      return tiles ? { buses, map, tiles } : { buses, map }
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
            res(null, { error: errorPayload(e) })
          })
      } else if (method === 'GET_BUSES') {
        const params = parseBusParams(req.params)
        if (!params) {
          res(null, { error: { code: ERR.BAD_REQUEST, message: 'Ponto inválido' } })
          return
        }
        const demand = parseDemandParams(req.params && req.params.tile)
        if (!this.mapReady) this.mapInit()
        // Relógio ainda sem o manifesto do mapa: o celular calcula os níveis dos blocos.
        if (demand && !params.levels) {
          const levels = this.mapLevelsFor(demand)
          if (levels) {
            params.levels = levels
            const level = parseLevelIndex(req.params.level, levels.length)
            if (level !== null) params.level = level
          }
        }
        this.getBuses(params, demand)
          .then((result) => res(null, { result }))
          .catch((e) => {
            console.log('Erro ao consultar a BHTrans:', e && e.message ? e.message : e)
            res(null, { error: errorPayload(e) })
          })
      } else if (method === 'MAP_SYNC') {
        // Mapa de BH: o relógio manda o que tem no cache; recebe o manifesto e o que apagar.
        if (!this.mapReady) this.mapInit()
        this.mapOnSync(req.params)
          .then((result) => res(null, { result }))
          .catch((e) => {
            console.log('Mapa:', e && e.message ? e.message : e)
            res(null, { error: 'Não deu para falar com o mapa agora' })
          })
      } else {
        res(null, { error: 'Pedido desconhecido' })
      }
    },

    // Só avisa o relógio quando os favoritos ou o tema mudam (não no rascunho do
    // formulário, na mensagem nem no "desfazer", que também ficam no settingsStorage).
    onSettingsChange(change) {
      if (!change) return
      // Botões do mapa na tela de configurações.
      if (change.key === MAP_COMMAND_KEY) {
        if (!this.mapReady) this.mapInit()
        this.mapHandleCommand(change.newValue)
        return
      }
      if (change.key !== FAVORITES_KEY && change.key !== THEME_KEY && change.key !== VIBRATE_KEY) return
      if (change.key === FAVORITES_KEY && this.mapReady) this.mapOnFavorites()
      this.call({ method: 'SETTINGS_CHANGED', result: this.settingsForWatch() })
    },

    onRun() {},
    onDestroy() {}
  })
)
