import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sunSvg, moonSvg, base64, svgDataUri, themeIcon } from '../shared/theme-icons.js'

test('base64 igual ao do Node (inclusive UTF-8)', () => {
  for (const s of ['', 'a', 'ab', 'abc', '<svg/>', 'Cadê o Busão ☀']) assert.equal(base64(s), Buffer.from(s, 'utf8').toString('base64'))
})

test('sol e lua: animados só quando escolhidos; cores pedidas', () => {
  const sun = sunSvg(true)
  assert.match(sun, /animateTransform[^>]*type="rotate"/)
  assert.match(sun, /#FFD166/)
  assert.match(sun, /#FF8C42/)
  assert.doesNotMatch(sunSvg(false), /<animate/)
  const moon = moonSvg(true)
  assert.equal((moon.match(/<animate attributeName="opacity" values/g) || []).length, 3) // 3 estrelas piscando
  assert.match(moon, /#EAF2FB/)
  assert.match(moon, /#27445F/)
  assert.doesNotMatch(moonSvg(false), /<animate/)
})

test('data URI base64 para o Image das configurações', () => {
  const uri = themeIcon('light', true)
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'))
  assert.equal(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'), sunSvg(true))
  assert.equal(themeIcon('dark', false), svgDataUri(moonSvg(false)))
})
