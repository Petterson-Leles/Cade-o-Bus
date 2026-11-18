// TransferFile do jeito da documentação oficial, com o jeito da zml como reserva.
// Doc (relógio): new TransferFile(); transferFile.getInbox(); inbox.on('NEWFILE', ...)
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/
// Doc (celular): transferFile.getOutbox().enqueueFile(path, params)
//   https://docs.zepp.com/docs/reference/side-service-api/transfer-file/
// A zml usa transferFile.inbox / .outbox e o evento 'newfile'; se o aparelho só
// aceitar um dos jeitos, o outro falhava em silêncio.

export function inboxOf(tf) {
  if (!tf) return null
  try {
    if (typeof tf.getInbox === 'function') {
      const ib = tf.getInbox()
      if (ib) return ib
    }
  } catch (e) {
    // tenta o outro jeito
  }
  return tf.inbox || null
}

export function outboxOf(tf) {
  if (!tf) return null
  for (const name of ['getOutbox', 'getOutBox']) {
    try {
      if (typeof tf[name] === 'function') {
        const ob = tf[name]()
        if (ob) return ob
      }
    } catch (e) {
      // tenta o próximo
    }
  }
  return tf.outbox || null
}

// Liga o aviso de arquivo novo nos dois nomes de evento. Cada aviso pega o próximo
// arquivo da fila; um aviso duplicado não acha arquivo e é ignorado.
export function onNewFile(inbox, cb) {
  if (!inbox || typeof inbox.on !== 'function') return false
  const handler = () => {
    let file = null
    try {
      file = inbox.getNextFile()
    } catch (e) {
      file = null
    }
    if (file) cb(file)
  }
  let ok = false
  for (const ev of ['NEWFILE', 'newfile']) {
    try {
      inbox.on(ev, handler)
      ok = true
    } catch (e) {
      // nome de evento não aceito
    }
  }
  return ok
}

// Estado do arquivo no evento 'change' (a doc usa event.data; uma tabela diz date).
export function readyStateOf(ev) {
  const d = ev && (ev.data || ev.date)
  return (d && d.readyState) || (ev && ev.readyState) || ''
}
