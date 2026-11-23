import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nearestIndex, chipColors } from '../utils/home-list.js'
import { THEMES, mixColor } from '../utils/colors.js'

// Contraste WCAG entre duas cores 0xRRGGBB.
function luminance(c) {
  const f = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255)
}
function contrast(a, b) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('cartão vai para o ônibus mais perto; empate fica com o primeiro', () => {
  assert.equal(nearestIndex([12, 4, 2]), 2)
  assert.equal(nearestIndex([2, 4, 12]), 0)
  assert.equal(nearestIndex([7, 3, 3]), 1)
  assert.equal(nearestIndex([5, 5]), 0)
  assert.equal(nearestIndex([0, 0, 1]), 0)
})

test('sem tempo válido não há cartão; pontos sem tempo são ignorados', () => {
  assert.equal(nearestIndex([]), -1)
  assert.equal(nearestIndex([null, null]), -1)
  assert.equal(nearestIndex(null), -1)
  assert.equal(nearestIndex([null, 9, undefined, NaN, -1, 4]), 5)
  assert.equal(nearestIndex(['3', 8]), 1)
})

test('selo cheio no cartão e suave nos outros', () => {
  for (const t of Object.values(THEMES)) {
    assert.deepEqual(chipColors(t, true), { bg: t.chip, text: t.chipText })
    assert.deepEqual(chipColors(t, false), { bg: t.chipSoft, text: t.chipSoftText })
  }
})

test('selo suave: 18 % do destaque sobre o fundo e texto ≥ 4,5:1', () => {
  for (const t of Object.values(THEMES)) {
    assert.equal(t.chipSoft, mixColor(t.bg, t.chip, 0.18), `${t.name}.chipSoft`)
    const r = contrast(t.chipSoftText, t.chipSoft)
    assert.ok(r >= 4.5, `${t.name} chipSoftText/chipSoft: ${r.toFixed(2)}`)
    // Selo cheio sobre o cartão e textos do item sobre o cartão destacado.
    assert.ok(contrast(t.chipText, t.chip) >= 4.5, `${t.name} chipText/chip`)
    for (const k of ['text', 'muted']) assert.ok(contrast(t[k], t.card) >= 4.5, `${t.name}.${k}/card`)
  }
  // No escuro o texto do selo suave é o próprio destaque.
  assert.equal(THEMES.dark.chipSoftText, THEMES.dark.chip)
})
