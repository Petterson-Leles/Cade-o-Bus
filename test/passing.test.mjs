import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackPassing, latestPassed, easeInOut, fadeFrame, passedKey, FADE_LEVELS, PASS_FADE_MS, PASS_KEEP_MS } from '../shared/passing.js'

const coming = (vehicle, toStopM) => ({ vehicle, lat: -19.9, lon: -43.9, along: 1000, passed: false, wrongWay: false, toStopM })
const gone = (vehicle, extra = {}) => ({ vehicle, lat: -19.91, lon: -43.91, along: 2100, passed: true, wrongWay: false, toStopM: null, ...extra })

test('trackPassing: ônibus que vinha chegando e agora passou do ponto', () => {
  const t0 = 1_000_000
  const a = trackPassing(null, [coming('40210', 300), coming('40300', 2000)], t0)
  assert.deepEqual(a.justPassed, [])
  assert.deepEqual(a.state.near, { 40210: 300, 40300: 2000 })
  const b = trackPassing(a.state, [gone('40210'), coming('40300', 1500)], t0 + 30000)
  assert.equal(b.justPassed.length, 1)
  assert.equal(b.justPassed[0].vehicle, '40210')
  assert.equal(b.justPassed[0].at, t0 + 30000)
  // Na leitura seguinte ele continua "passado", mas não é avisado de novo.
  const c = trackPassing(b.state, [gone('40210'), coming('40300', 1000)], t0 + 60000)
  assert.deepEqual(c.justPassed, [])
  assert.equal(latestPassed(c.state, t0 + 60000).vehicle, '40210')
  // Depois de PASS_KEEP_MS some da memória.
  assert.equal(latestPassed(c.state, t0 + 30000 + PASS_KEEP_MS + 1), null)
})

test('trackPassing ignora contramão, quem estava longe, leitura velha e veículo sem número', () => {
  const t0 = 5_000_000
  const s = trackPassing(null, [coming('A', 300), coming('B', 9000), coming('?', 100), coming('C', 200)], t0).state
  const r = trackPassing(s, [gone('A', { wrongWay: true }), gone('B'), gone('?'), gone('C')], t0 + 30000)
  assert.deepEqual(r.justPassed.map((j) => j.vehicle), ['C'])
  const old = trackPassing(s, [gone('C')], t0 + 5 * 60 * 1000)
  assert.deepEqual(old.justPassed, [])
  assert.deepEqual(trackPassing(undefined, null, t0).justPassed, [])
})

test('latestPassed devolve o mais recente', () => {
  const state = { recent: [{ vehicle: 'A', at: 10 }, { vehicle: 'B', at: 20 }] }
  assert.equal(latestPassed(state, 30).vehicle, 'B')
  assert.equal(latestPassed(null, 30), null)
})

test('easeInOut: suave nas pontas, metade no meio', () => {
  assert.equal(easeInOut(0), 0)
  assert.equal(easeInOut(0.5), 0.5)
  assert.equal(easeInOut(1), 1)
  assert.ok(easeInOut(0.1) < 0.1)
  assert.ok(easeInOut(0.9) > 0.9)
  assert.equal(easeInOut(-1), 0)
  assert.equal(easeInOut(2), 1)
})

test('fadeFrame: ícone pré-gerado * alpha = opacidade; termina em ~4,5 s', () => {
  const f0 = fadeFrame(0)
  assert.deepEqual(f0, { done: false, opacity: 1, level: 100, alpha: 255 })
  for (const ms of [500, 1500, 2250, 3000, 4000]) {
    const f = fadeFrame(ms)
    assert.equal(f.done, false)
    assert.ok(FADE_LEVELS.includes(f.level))
    assert.ok(f.level >= f.opacity * 100 - 1e-6, `${ms}: nível ${f.level} >= ${f.opacity * 100}`)
    assert.ok(Math.abs((f.level * f.alpha) / 255 - f.opacity * 100) <= 0.6, `${ms}`)
  }
  assert.ok(Math.abs(fadeFrame(PASS_FADE_MS / 2).opacity - 0.5) < 1e-9)
  // Opacidade só diminui.
  let last = 2
  for (let ms = 0; ms < PASS_FADE_MS; ms += 100) {
    const o = fadeFrame(ms).opacity
    assert.ok(o <= last)
    last = o
  }
  assert.equal(fadeFrame(PASS_FADE_MS).done, true)
  assert.equal(fadeFrame(PASS_FADE_MS + 1000).alpha, 0)
})

test('passedKey identifica o aviso', () => {
  assert.equal(passedKey({ vehicle: '40210', at: 5 }), '40210@5')
  assert.equal(passedKey(null), '')
})
