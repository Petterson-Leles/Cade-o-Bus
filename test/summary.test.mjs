import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeEtas, etaFromSummary, favoriteKey, withStreets, createFeedCache } from '../shared/summary.js'

const INDEX = {
  feed: 'x',
  lines: [['9250', 'Linha teste', [[0, 'Centro', [0, 1]]]]],
  stops: { id: ['100', '200'], name: ['Avenida Afonso Pena, 100', 'Rua da Bahia'], lat: [-1991910, -1992000], lon: [-4393860, -4394000] }
}

test('summarizeEtas: um item por favorito, erro vira null só nele', () => {
  const favs = [{ id: 'a', line: '1' }, { line: '2' }, { id: 'c', line: '3' }]
  const items = summarizeEtas(favs, (f) => {
    if (f.line === '2') return 7.4
    if (f.line === '3') throw new Error('x')
    return null
  })
  assert.deepEqual(items, [{ key: 'a', eta: null }, { key: '#1', eta: 7 }, { key: 'c', eta: null }])
  assert.deepEqual(summarizeEtas(null, () => 1), [])
})

test('etaFromSummary acha pelo id ou pela posição', () => {
  const result = { items: [{ key: 'a', eta: 3 }, { key: '#1', eta: 12 }, { key: 'z', eta: 'x' }] }
  assert.equal(etaFromSummary(result, { id: 'a' }, 5), 3)
  assert.equal(etaFromSummary(result, {}, 1), 12)
  assert.equal(etaFromSummary(result, { id: 'z' }, 2), null)
  assert.equal(etaFromSummary(null, { id: 'a' }, 0), null)
  assert.equal(favoriteKey({ id: '' }, 4), '#4')
})

test('withStreets acrescenta a rua abreviada do ponto', () => {
  const out = withStreets([{ name: 'Casa', stopId: '100' }, { name: 'Outro', stopId: '999' }, { name: 'Manual' }], INDEX)
  assert.equal(out[0].street, 'Av. Afonso Pena, 100')
  assert.equal(out[1].street, undefined)
  assert.equal(out[2].street, undefined)
})

test('createFeedCache: um download para pedidos juntos e dentro do TTL; erro não fica guardado', async () => {
  let now = 0
  let calls = 0
  let fail = false
  const cache = createFeedCache(
    () => {
      calls++
      if (fail) return Promise.reject(new Error('rede'))
      return Promise.resolve(`feed${calls}`)
    },
    15000,
    () => now
  )
  const [a, b] = await Promise.all([cache.get(), cache.get()])
  assert.equal(a, 'feed1')
  assert.equal(b, 'feed1')
  now = 10000
  assert.equal(await cache.get(), 'feed1')
  assert.equal(calls, 1)
  now = 20000
  fail = true
  await assert.rejects(cache.get())
  fail = false
  assert.equal(await cache.get(), 'feed3')
})
