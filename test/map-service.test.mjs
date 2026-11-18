import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SERVICE_FILE,
  SERVICE_MAX_MS,
  SERVICE_IDLE_MS,
  SERVICE_PING_IDLE_MS,
  buildServiceParam,
  parseServiceParam,
  serviceTick,
  cleanRegistry,
  registryMark,
  unionTheme,
  themeDone,
  syncFileParams,
  parseSyncFileParams,
  permissionFromQuery,
  permissionFromRequest,
  isServiceRunning,
  shouldAutoStart
} from '../shared/map-service.js'
import { mergeWatchBits, STATUS } from '../shared/map-download.js'
import { emptyBits, setBit, countBits } from '../shared/map-tiles.js'

test('param do start vai e volta (e aceita pares a mais)', () => {
  const have = setBit(emptyBits(10), 3)
  const raw = buildServiceParam({ theme: 'light', total: 10, have, at: 1234 })
  assert.equal(raw, `theme=light&n=10&have=${have}&at=1234`)
  assert.deepEqual(parseServiceParam(raw), { theme: 'light', total: 10, have, at: 1234 })
  assert.deepEqual(parseServiceParam(`_u=x&${raw}&_a=start`), { theme: 'light', total: 10, have, at: 1234 })
  assert.equal(parseServiceParam('theme=roxo&n=10'), null)
  assert.equal(parseServiceParam(''), null)
  assert.equal(parseServiceParam(undefined), null)
  // Lixo nos números vira 0 / bits vazios.
  assert.deepEqual(parseServiceParam('theme=dark&n=abc&have=zz'), { theme: 'dark', total: 0, have: '', at: 0 })
  // Tema inválido no build cai no primeiro.
  assert.match(buildServiceParam({ theme: 'x', total: 0, have: '', at: 0 }), /^theme=dark&n=0&have=&at=0$/)
})

test('serviceTick: termina, para por tempo, por falta de progresso e pinga', () => {
  const t0 = 1_000_000
  const base = { startedAt: t0, lastProgressAt: t0, lastPingAt: t0, done: 5, total: 10 }
  assert.deepEqual(serviceTick({ ...base, now: t0 + 60_000 }), { action: 'wait' })
  assert.deepEqual(serviceTick({ ...base, done: 10, now: t0 + 1 }), { action: 'exit', reason: 'done' })
  assert.deepEqual(serviceTick({ ...base, lastProgressAt: t0 + SERVICE_MAX_MS, now: t0 + SERVICE_MAX_MS }), { action: 'exit', reason: 'timeout' })
  assert.deepEqual(serviceTick({ ...base, now: t0 + SERVICE_IDLE_MS }), { action: 'exit', reason: 'idle' })
  // Progresso recente adia o "sem progresso".
  assert.deepEqual(serviceTick({ ...base, lastProgressAt: t0 + SERVICE_IDLE_MS - 1000, lastPingAt: t0 + SERVICE_IDLE_MS, now: t0 + SERVICE_IDLE_MS + 1000 }), { action: 'wait' })
  // Fila parada há SERVICE_PING_IDLE_MS: pinga; logo depois de pingar, espera.
  assert.deepEqual(serviceTick({ ...base, now: t0 + SERVICE_PING_IDLE_MS }), { action: 'ping' })
  assert.deepEqual(serviceTick({ ...base, lastPingAt: t0 + SERVICE_PING_IDLE_MS, now: t0 + SERVICE_PING_IDLE_MS + 60_000 }), { action: 'wait' })
  // Total desconhecido (0) nunca é "pronto".
  assert.deepEqual(serviceTick({ ...base, done: 0, total: 0, now: t0 + 1 }), { action: 'wait' })
})

test('registro do service: limpa, marca e soma com o do app sem contar duas vezes', () => {
  assert.deepEqual(cleanRegistry(null), { themes: {} })
  assert.deepEqual(cleanRegistry('{lixo'), { themes: {} })
  assert.deepEqual(cleanRegistry({ themes: { dark: { have: 'f', total: 0 }, roxo: { have: 'f', total: 4 } } }), { themes: {} })
  let reg = registryMark(null, 'dark', 2, 8)
  reg = registryMark(reg, 'dark', 2, 8) // mesmo bloco de novo: igual
  reg = registryMark(reg, 'dark', 5, 8)
  assert.equal(countBits(reg.themes.dark.have, 8), 2)
  assert.deepEqual(cleanRegistry(JSON.stringify(reg)), reg)
  // Manifesto mudou (total outro): recomeça.
  const reg2 = registryMark(reg, 'dark', 0, 12)
  assert.equal(reg2.themes.dark.total, 12)
  assert.equal(countBits(reg2.themes.dark.have, 12), 1)
  assert.deepEqual(registryMark(reg, 'roxo', 1, 8), reg)

  const main = { have: setBit(setBit(emptyBits(8), 2), 7), total: 8 }
  const u = unionTheme(main, reg.themes.dark)
  assert.equal(themeDone(u), 3) // 2, 5, 7 (o 2 está nos dois)
  assert.deepEqual(unionTheme(main, null), main)
  assert.deepEqual(unionTheme({ have: '', total: 0 }, reg.themes.dark), reg.themes.dark)
  assert.deepEqual(unionTheme(main, { have: 'fff', total: 12 }), main) // totais diferentes: vale o do app
  assert.equal(themeDone(null), 0)
})

test('arquivo de MAP_SYNC do service: params vão e voltam', () => {
  const p = syncFileParams({ dark: 'a0', light: 'ff', roxo: '1' }, 99)
  assert.deepEqual(p, { kind: 'cob-sync', have: JSON.stringify({ dark: 'a0', light: 'ff' }), at: '99' })
  assert.deepEqual(parseSyncFileParams(p), { have: { dark: 'a0', light: 'ff' } })
  assert.deepEqual(parseSyncFileParams(JSON.stringify(p)), { have: { dark: 'a0', light: 'ff' } })
  assert.deepEqual(parseSyncFileParams({ kind: 'cob-sync', have: { dark: 'zz', light: 'AB' } }), { have: { light: 'ab' } })
  assert.equal(parseSyncFileParams({ kind: 'cob-tile' }), null)
  assert.equal(parseSyncFileParams('{'), null)
  assert.equal(parseSyncFileParams(null), null)
})

test('permissão e service rodando', () => {
  assert.equal(permissionFromQuery(2), 'granted')
  assert.equal(permissionFromQuery(0), 'ask')
  assert.equal(permissionFromQuery(1), 'error')
  assert.equal(permissionFromQuery(undefined), 'error')
  assert.equal(permissionFromRequest(2), 'granted')
  assert.equal(permissionFromRequest(0), 'denied')
  assert.equal(permissionFromRequest(1), 'denied')
  assert.equal(isServiceRunning([SERVICE_FILE]), true)
  assert.equal(isServiceRunning([`${SERVICE_FILE}.js`]), true)
  assert.equal(isServiceRunning([`/data/app/20001/${SERVICE_FILE}`]), true)
  assert.equal(isServiceRunning(['app-service/outro']), false)
  assert.equal(isServiceRunning(['xapp-service/map-service']), false)
  assert.equal(isServiceRunning(null), false)
})

test('liga sozinho só com o interruptor, baixando, sem permissão negada e uma vez', () => {
  const base = { bgMap: true, downloading: true, ready: false, running: false, denied: false, tried: false }
  assert.equal(shouldAutoStart(base), true)
  assert.equal(shouldAutoStart({ ...base, bgMap: false }), false)
  assert.equal(shouldAutoStart({ ...base, downloading: false }), false)
  assert.equal(shouldAutoStart({ ...base, ready: true }), false)
  assert.equal(shouldAutoStart({ ...base, running: true }), false)
  assert.equal(shouldAutoStart({ ...base, denied: true }), false)
  assert.equal(shouldAutoStart({ ...base, tried: true }), false)
})

test('mergeWatchBits (celular) só soma o que o service conta', () => {
  const st = { status: STATUS.PAUSED, total: 8, have: setBit(emptyBits(8), 0) }
  const m = mergeWatchBits(st, setBit(emptyBits(8), 3), 8)
  assert.equal(m.done, 2)
  assert.equal(m.status, STATUS.PAUSED)
  // Relógio com menos blocos não tira nada.
  assert.equal(mergeWatchBits(st, '', 8).done, 1)
  // Tudo: pronto.
  assert.equal(mergeWatchBits(st, 'ff', 8).status, STATUS.READY)
  // Apagando: continua apagando.
  assert.equal(mergeWatchBits({ ...st, status: STATUS.DELETING }, 'ff', 8).status, STATUS.DELETING)
  // Total novo (manifesto mudou): recomeça com o que o relógio tem.
  assert.equal(mergeWatchBits(st, '8', 4).done, 1)
})
