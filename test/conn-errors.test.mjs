import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ERR, codedError, feedFailureCode, errorPayload, parseErrorField, requestFailureCode, errorScreen, errorImage, bleConnected } from '../shared/conn-errors.js'

test('feed: sem resposta = celular sem internet; resposta ruim = BHTrans fora do ar', () => {
  assert.equal(feedFailureCode('fetch'), ERR.NO_INTERNET)
  assert.equal(feedFailureCode('response'), ERR.FEED_DOWN)
})

test('errorPayload leva o código ao relógio; parseErrorField aceita o formato antigo', () => {
  assert.deepEqual(errorPayload(codedError(ERR.NO_INTERNET, 'Tempo esgotado')), { code: 'NO_INTERNET', message: 'Tempo esgotado' })
  assert.deepEqual(errorPayload(new Error('x')), { code: 'UNKNOWN', message: 'x' })
  assert.equal(codedError('XYZ').code, ERR.UNKNOWN)
  assert.deepEqual(parseErrorField({ code: 'FEED_DOWN', message: 'HTTP 503' }), { code: 'FEED_DOWN', message: 'HTTP 503' })
  assert.deepEqual(parseErrorField('Sem conexão com a BHTrans'), { code: 'UNKNOWN', message: 'Sem conexão com a BHTrans' })
  assert.equal(parseErrorField({ code: 'nada' }).code, ERR.UNKNOWN)
  for (const v of [null, undefined, '', false]) assert.equal(parseErrorField(v), null)
  assert.equal(requestFailureCode(), ERR.NO_BLE)
})

test('uma tela por caso: imagem, título, texto e como tenta de novo', () => {
  assert.deepEqual(errorScreen(ERR.NO_BLE), { image: 'offline', title: 'Ops… sem conexão', text: 'Bluetooth desligado ou celular longe. Aproxime o relógio do celular.', retry: 'ble' })
  assert.equal(errorScreen(ERR.NO_INTERNET).title, 'Ops… celular sem internet')
  assert.equal(errorScreen(ERR.NO_INTERNET).text, 'Ligue os dados móveis ou o Wi-Fi do celular.')
  assert.equal(errorScreen(ERR.FEED_DOWN).title, 'Ops… BHTrans fora do ar')
  assert.equal(errorScreen(ERR.FEED_DOWN).retry, 'timer')
  assert.equal(errorScreen(ERR.UNKNOWN), null)
  assert.equal(errorImage(ERR.NO_BLE, 'light'), 'offline/light.png')
  assert.equal(errorImage(ERR.FEED_DOWN, 'roxo'), 'internet/dark.png')
  assert.equal(errorImage(ERR.BAD_REQUEST, 'dark'), '')
})

test('bleConnected: só true/1 é conectado; sem API, considera conectado', () => {
  assert.equal(bleConnected(() => true), true)
  assert.equal(bleConnected(() => false), false)
  assert.equal(bleConnected(() => 0), false)
  assert.equal(bleConnected(() => undefined), true)
  assert.equal(bleConnected(() => { throw new Error('x') }), true)
})
