import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easeOut, startAnimation, animFrame, ANIM_FIX_MS, ANIM_MAX_MS, ANIM_JUMP_PX } from '../shared/bus-anim.js'

// Caminho em L (curva de 90°): (0,0) -> (100,0) -> (100,100); o ponto fica no fim.
const L = [0, 0, 100, 0, 100, 100]

test('easeOut: 0 -> 0, 1 -> 1, rápido no começo', () => {
  assert.equal(easeOut(0), 0)
  assert.equal(easeOut(1), 1)
  assert.ok(easeOut(0.5) > 0.5)
  assert.equal(easeOut(2), 1)
})

test('anda pelo tempo real decorrido e contorna a curva', () => {
  const a = startAnimation({ path: L, speed: 10, now: 0 })
  assert.equal(a.delta, 0)
  // 15 s a 10 px/s = 150 px: já virou a esquina (100 + 50).
  const p = animFrame(a, 15000)
  assert.deepEqual([p.x, p.y], [100, 50])
  assert.equal(p.remain, 50)
  // Quadro atrasado: a posição só depende do tempo, não do número de quadros.
  assert.deepEqual(animFrame(a, 3000), animFrame(a, 3000))
  assert.equal(animFrame(a, 20000).done, true)
})

test('correção suave pelo trajeto (along), não em linha reta', () => {
  // O ícone estava a 150 px do ponto (já depois da esquina? não: 50 px antes dela,
  // na mesma rota estendida); o caminho novo tem 200 px. delta = -50.
  const a = startAnimation({ path: L, speed: 0, prevRemain: 150, now: 0 })
  assert.equal(a.delta, -50)
  // No começo o ícone está onde estava: 50 px ao longo do caminho novo.
  const p0 = animFrame(a, 0)
  assert.deepEqual([p0.x, p0.y], [50, 0])
  // No meio da correção ainda está no trajeto (y = 0 no primeiro trecho).
  const mid = animFrame(a, ANIM_FIX_MS / 4)
  assert.equal(mid.y, 0)
  assert.ok(mid.x < 50 && mid.x > 0)
  // Depois da correção: no começo do caminho novo, parado (speed 0).
  const end = animFrame(a, ANIM_FIX_MS)
  assert.deepEqual([end.x, end.y, end.done], [0, 0, true])
})

test('correção que atravessa a curva segue a curva', () => {
  // Ícone a 40 px do ponto (no 2º trecho, x = 100); caminho novo de 200 px, sem
  // velocidade: a correção leva o ícone de volta pela esquina, sempre no trajeto.
  const a = startAnimation({ path: L, speed: 0, prevRemain: 40 + 0, now: 0, jumpPx: 500 })
  for (let t = 0; t <= ANIM_FIX_MS; t += 50) {
    const p = animFrame(a, t)
    assert.ok(p.y === 0 || p.x === 100, `fora do trajeto em t=${t}: ${p.x},${p.y}`)
  }
})

test('pula direto quando a diferença é enorme, sem caminho não anima, para depois de ANIM_MAX_MS', () => {
  const a = startAnimation({ path: L, speed: 10, prevRemain: 200 + ANIM_JUMP_PX + 1, now: 0 })
  assert.equal(a.delta, 0)
  assert.equal(startAnimation({ path: [0, 0], speed: 10 }), null)
  assert.equal(startAnimation({ path: L, speed: 0, prevRemain: null }), null)
  const slow = startAnimation({ path: [0, 0, 100000, 0], speed: 1, now: 0 })
  assert.equal(animFrame(slow, ANIM_MAX_MS - 1).done, false)
  assert.equal(animFrame(slow, ANIM_MAX_MS).done, true)
  assert.equal(animFrame(null, 0), null)
})
