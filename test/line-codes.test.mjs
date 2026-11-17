import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LINE_CODES, lineCodesFor, matchesLine } from '../shared/line-codes.js'

test('LINE_CODES é um objeto (pode estar vazio)', () => {
  assert.equal(typeof LINE_CODES, 'object')
})

test('lineCodesFor: sem mapeamento usa o próprio número', () => {
  assert.deepEqual(lineCodesFor('9250', {}), ['9250'])
  assert.deepEqual(lineCodesFor(' sc03a ', {}), ['SC03A'])
  assert.deepEqual(lineCodesFor('', {}), [])
  assert.deepEqual(lineCodesFor(null, {}), [])
})

test('lineCodesFor: com mapeamento usa a tabela (lista ou valor)', () => {
  const table = { 9250: ['1234', ' 0567 '], 5102: '42', 1: [] }
  assert.deepEqual(lineCodesFor('9250', table), ['1234', '567'])
  assert.deepEqual(lineCodesFor('5102', table), ['42'])
  assert.deepEqual(lineCodesFor('1', table), ['1']) // lista vazia: volta ao número
})

test('matchesLine ignora espaços, caixa e zeros à esquerda', () => {
  assert.equal(matchesLine(' 09250 ', ['9250']), true)
  assert.equal(matchesLine('sc03a', ['SC03A']), true)
  assert.equal(matchesLine('925', ['9250']), false)
  assert.equal(matchesLine('', ['9250']), false)
  assert.equal(matchesLine('9250', null), false)
})
