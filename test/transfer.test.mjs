import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inboxOf, outboxOf, onNewFile, readyStateOf } from '../shared/transfer.js'

test('inboxOf/outboxOf: jeito da doc primeiro, zml como reserva', () => {
  const ib = { a: 1 }
  const ob = { b: 1 }
  assert.equal(inboxOf({ getInbox: () => ib, inbox: {} }), ib)
  assert.equal(inboxOf({ inbox: ib }), ib)
  assert.equal(outboxOf({ getOutbox: () => ob }), ob)
  assert.equal(outboxOf({ getOutBox: () => ob }), ob)
  assert.equal(outboxOf({ outbox: ob }), ob)
  assert.equal(outboxOf(null), null)
})

test('onNewFile ouve NEWFILE e newfile sem processar o mesmo arquivo duas vezes', () => {
  const handlers = {}
  const queue = ['f1']
  const inbox = { on: (ev, h) => (handlers[ev] = h), getNextFile: () => queue.shift() || null }
  const got = []
  assert.equal(onNewFile(inbox, (f) => got.push(f)), true)
  handlers.NEWFILE()
  handlers.newfile() // aviso duplicado do mesmo arquivo: fila vazia
  assert.deepEqual(got, ['f1'])
})

test('readyStateOf aceita data, date e o próprio evento', () => {
  assert.equal(readyStateOf({ data: { readyState: 'transferred' } }), 'transferred')
  assert.equal(readyStateOf({ date: { readyState: 'error' } }), 'error')
  assert.equal(readyStateOf({ readyState: 'canceled' }), 'canceled')
  assert.equal(readyStateOf(null), '')
})
