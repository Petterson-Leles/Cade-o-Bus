// Erros de conexão: o que falhou (relógio sem o celular, celular sem internet, BHTrans
// fora do ar) e a tela que o relógio mostra em cada caso. Lógica pura (sem APIs do
// Zepp OS), testada em test/conn-errors.test.mjs.
//
// Celular -> relógio: { error: { code, message } } (antes era só o texto; o relógio
// ainda aceita o texto). Relógio: o pedido pela zml rejeita com code 2 ("ble
// disconnect") ou 3 ("side service is not running") quando não alcança o celular.

export const ERR = Object.freeze({
  NO_BLE: 'NO_BLE', // relógio não alcança o celular (Bluetooth / app Zepp)
  NO_INTERNET: 'NO_INTERNET', // celular sem internet: o fetch nem respondeu
  FEED_DOWN: 'FEED_DOWN', // a BHTrans respondeu, mas com erro ou formato inválido
  BAD_REQUEST: 'BAD_REQUEST', // pedido inválido (ex.: ponto sem coordenadas)
  UNKNOWN: 'UNKNOWN'
})

const CODES = Object.keys(ERR).map((k) => ERR[k])

// Erro do celular já com código (para lançar e repassar ao relógio).
export function codedError(code, message) {
  const e = new Error(message || code)
  e.code = CODES.indexOf(code) >= 0 ? code : ERR.UNKNOWN
  return e
}

// Falha no download do feed (celular). stage 'fetch': o pedido HTTP falhou/esgotou o
// tempo (sem resposta) -> sem internet; stage 'response': chegou resposta, mas com
// status de erro, vazia ou fora do formato -> BHTrans fora do ar.
export function feedFailureCode(stage) {
  return stage === 'fetch' ? ERR.NO_INTERNET : ERR.FEED_DOWN
}

// O que o side service manda ao relógio para um erro qualquer.
export function errorPayload(err, fallback = ERR.UNKNOWN) {
  const code = err && CODES.indexOf(err.code) >= 0 ? err.code : fallback
  const message = err && err.message ? String(err.message).slice(0, 120) : code
  return { code, message }
}

// No relógio: campo error da resposta (objeto novo ou texto antigo) -> { code, message } ou null.
export function parseErrorField(error) {
  if (error === null || error === undefined || error === '' || error === false) return null
  if (typeof error === 'string') return { code: ERR.UNKNOWN, message: error.slice(0, 120) }
  if (typeof error === 'object') {
    const code = CODES.indexOf(error.code) >= 0 ? error.code : ERR.UNKNOWN
    return { code, message: typeof error.message === 'string' ? error.message.slice(0, 120) : '' }
  }
  return { code: ERR.UNKNOWN, message: String(error) }
}

// No relógio: o pedido ao celular rejeitou (zml). Sempre "sem o celular": a zml só
// rejeita quando a mensagem não vai ou não volta (Bluetooth, app Zepp fechado, tempo).
export function requestFailureCode() {
  return ERR.NO_BLE
}

// Tela de cada caso: { image, title, text, retry: 'ble' | 'timer' }.
// image: pasta em assets/common.r (+ '/<tema>.png').
const SCREENS = {
  [ERR.NO_BLE]: { image: 'offline', title: 'Ops… sem conexão', text: 'Bluetooth desligado ou celular longe. Aproxime o relógio do celular.', retry: 'ble' },
  [ERR.NO_INTERNET]: { image: 'internet', title: 'Ops… celular sem internet', text: 'Ligue os dados móveis ou o Wi-Fi do celular.', retry: 'timer' },
  [ERR.FEED_DOWN]: { image: 'internet', title: 'Ops… BHTrans fora do ar', text: 'Tentamos de novo em 30 s.', retry: 'timer' }
}

// Código -> tela (null para erros sem tela própria, que seguem como texto).
export function errorScreen(code) {
  return SCREENS[code] || null
}

export function errorImage(code, theme) {
  const s = errorScreen(code)
  return s ? `${s.image}/${theme === 'light' ? 'light' : 'dark'}.png` : ''
}

// connectStatus() do @zos/ble: true/1 conectado. Qualquer outra coisa = desconectado;
// sem a API (ou erro), considera conectado (o pedido diz se falhar).
export function bleConnected(read) {
  try {
    const v = typeof read === 'function' ? read() : read
    if (v === undefined || v === null) return true
    return v === true || v === 1
  } catch (e) {
    return true
  }
}
