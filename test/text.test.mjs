import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abbreviateStreet, foldText, directionTitle, greeting, scaleLabel } from '../shared/text.js'

test('abbreviateStreet abrevia o tipo do logradouro e títulos comuns', () => {
  assert.equal(abbreviateStreet('Avenida Afonso Pena, 1500'), 'Av. Afonso Pena, 1500')
  assert.equal(abbreviateStreet('Rua da Bahia'), 'R. da Bahia')
  assert.equal(abbreviateStreet('Avenida Presidente Antônio Carlos'), 'Av. Pres. Antônio Carlos')
  assert.equal(abbreviateStreet('Praça Sete'), 'Pç. Sete')
  assert.equal(abbreviateStreet('Estação Barreiro'), 'Est. Barreiro')
  assert.equal(abbreviateStreet('Rodovia MG-020'), 'Rod. MG-020')
  assert.equal(abbreviateStreet('Alameda das Palmeiras'), 'Al. das Palmeiras')
  assert.equal(abbreviateStreet('Viaduto Santa Tereza'), 'Vd. Santa Tereza')
  // Só no começo: "Rua" no meio fica.
  assert.equal(abbreviateStreet('Terminal Rua Nova'), 'Terminal Rua Nova')
  assert.equal(abbreviateStreet('  Rua   Espírito  Santo '), 'R. Espírito Santo')
  assert.equal(abbreviateStreet(null), '')
})

test('foldText ignora acentos, maiúsculas e espaços', () => {
  assert.equal(foldText('  São  José '), 'SAO JOSE')
  assert.equal(foldText('Praça Sete'), foldText('praca sete'))
  assert.equal(foldText(undefined), '')
})

test('directionTitle tira o "(Principal)"', () => {
  assert.equal(directionTitle('Estação Barreiro (Principal)'), 'Para Estação Barreiro')
  assert.equal(directionTitle('Nova Cintra'), 'Para Nova Cintra')
  assert.equal(directionTitle(''), 'Sentido único')
})

test('greeting pelo horário', () => {
  assert.equal(greeting(0), 'Bom dia!')
  assert.equal(greeting(11), 'Bom dia!')
  assert.equal(greeting(12), 'Boa tarde!')
  assert.equal(greeting(17), 'Boa tarde!')
  assert.equal(greeting(18), 'Boa noite!')
  assert.equal(greeting(23), 'Boa noite!')
})

test('scaleLabel: metros a partir de 100 px/km, km abaixo', () => {
  assert.equal(scaleLabel(143, true), 'zoom automático · 699 m por 100 px')
  assert.equal(scaleLabel(100, false), 'zoom manual · 1000 m por 100 px')
  assert.equal(scaleLabel(30, true), 'zoom automático · 3,3 km por 100 px')
  assert.equal(scaleLabel(0, true), 'zoom automático')
})
