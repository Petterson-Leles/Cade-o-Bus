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

// ---- Recebimento robusto no relógio ----
// A doc tem dois avisos no inbox: NEWFILE ("acabou de chegar um arquivo") e FILE
// ("terminou de receber"); a zml usa 'newfile' e 'file'. Não está claro em qual dos
// dois o arquivo entra na fila do getNextFile, nem se o 'change' com 'transferred'
// ainda dispara para um arquivo pequeno que já chegou inteiro. Então:
// - ouve os quatro nomes; cada aviso esvazia a fila (getNextFile até null);
// - quem trata o arquivo confere o readyState na hora (já 'transferred' = guarda) e,
//   senão, espera o 'change'; os avisos FILE/file também chamam onFinished, para
//   reconferir os que ficaram esperando.
export const INBOX_NEW_EVENTS = ['NEWFILE', 'newfile']
export const INBOX_DONE_EVENTS = ['FILE', 'file']

export function watchInbox(inbox, { onFile, onFinished } = {}) {
  if (!inbox || typeof inbox.on !== 'function') return false
  const drain = () => {
    let prev = null
    for (let n = 0; n < 8; n++) {
      let file = null
      try {
        file = inbox.getNextFile()
      } catch (e) {
        file = null
      }
      if (!file || file === prev) break
      prev = file
      if (onFile) onFile(file)
    }
  }
  let ok = false
  INBOX_NEW_EVENTS.concat(INBOX_DONE_EVENTS).forEach((ev) => {
    const done = INBOX_DONE_EVENTS.indexOf(ev) >= 0
    try {
      inbox.on(ev, () => {
        drain()
        if (done && onFinished) onFinished()
      })
      ok = true
    } catch (e) {
      // nome de evento não aceito
    }
  })
  return ok
}

// Identidade de um arquivo recebido (o mesmo aviso pode chegar por dois caminhos).
export function fileKey(file) {
  if (!file || typeof file !== 'object') return ''
  const p = file.params
  const name = typeof p === 'object' && p && p.name ? p.name : ''
  return `${file.sessionId !== undefined ? file.sessionId : ''}|${file.fileName || ''}|${file.filePath || ''}|${name}`
}

// Onde o arquivo recebido pode estar: filePath (com ou sem data://), e as pastas
// padrão com o fileName. Sem repetir.
export function receivedPathCandidates(file) {
  const out = []
  const add = (p) => {
    if (typeof p === 'string' && p && out.indexOf(p) < 0) out.push(p)
  }
  if (!file || typeof file !== 'object') return out
  const fp = typeof file.filePath === 'string' ? file.filePath : ''
  const name = typeof file.fileName === 'string' ? file.fileName.replace(/^.*\//, '') : ''
  if (fp) {
    add(fp)
    if (fp.indexOf('://') < 0) {
      if (fp.charAt(0) === '/') {
        add('data://' + fp.replace(/^\/data\//, '').replace(/^\//, ''))
      } else add('data://' + fp)
    }
  }
  if (name) {
    add('data://download/' + name)
    add('data://' + name)
  }
  return out
}
