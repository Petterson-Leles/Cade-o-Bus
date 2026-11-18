import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideVibration, etaLevel } from '../shared/vibrate.js'

const run = (readings) => {
  let mem = null
  return readings.map((r) => {
    const out = decideVibration(mem, r)
    mem = out.memory
    return out.alert
  })
}

test('etaLevel: faixas "já já" e "chegando"', () => {
  assert.equal(etaLevel(9), 0)
  assert.equal(etaLevel(5), 1)
  assert.equal(etaLevel(2), 2)
  assert.equal(etaLevel(null), 0)
})

test('avisa ao entrar em cada faixa, uma vez só por veículo', () => {
  const bus = (etaMin) => ({ vehicle: '40210', etaMin })
  assert.deepEqual(run([bus(9), bus(7), bus(5), bus(4), bus(2), bus(1), bus(1)]), [null, null, 'soon', null, 'now', null, null])
})

test('primeira leitura ao abrir a tela não vibra', () => {
  assert.deepEqual(run([{ vehicle: 'A', etaMin: 2 }, { vehicle: 'A', etaMin: 1 }]), [null, null])
})

test('ETA voltou a subir bastante: pode avisar de novo', () => {
  const b = (etaMin) => ({ vehicle: 'A', etaMin })
  assert.deepEqual(run([b(9), b(4), b(5), b(4), b(9), b(5)]), [null, 'soon', null, null, null, 'soon'])
  assert.deepEqual(run([b(9), b(2), b(5), b(2)]), [null, 'now', null, 'now'])
})

test('"Esse passou": duas curtas uma vez por chave; o próximo já perto também avisa', () => {
  const out = run([
    { vehicle: 'A', etaMin: 3 },
    { vehicle: 'A', etaMin: 1 },
    { vehicle: 'B', etaMin: 4, passedKey: 'A|100' },
    { vehicle: 'B', etaMin: 4, passedKey: 'A|100' },
    { vehicle: 'B', etaMin: 2 }
  ])
  assert.deepEqual(out, [null, 'now', 'passed', null, 'now'])
  // Outro veículo em destaque já na faixa: avisa.
  assert.deepEqual(run([{ vehicle: 'A', etaMin: 9 }, { vehicle: 'B', etaMin: 4 }]), [null, 'soon'])
  // Sem ônibus: nada.
  assert.deepEqual(run([{ vehicle: null }, { vehicle: null }]), [null, null])
})
