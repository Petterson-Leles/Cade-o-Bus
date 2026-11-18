// Mapa de BH guardado no relógio: blocos em data://map/ e o registro do que já
// chegou (LocalStorage). Usa APIs do relógio; a lógica pura fica em shared/.
// - LocalStorage (@zos/storage), permissão device:os.local_storage:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/
// - arquivos (@zos/fs), raiz /data e prefixo data:// (Zepp OS 3+):
//   https://docs.zepp.com/docs/guides/framework/device/fs/
//   mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/mkdirSync/ (e páginas vizinhas)
// - arquivos recebidos do celular (TransferFile, inbox), API 3.0+:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/
import { LocalStorage } from '@zos/storage'
import { mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync } from '@zos/fs'
import {
  MAP_THEMES,
  WATCH_MAP_DIR,
  parseCompactManifest,
  compactTotal,
  watchTilePath,
  normalizeBits,
  setBit,
  hasBit,
  countBits,
  designLevels
} from '../shared/map-tiles'
import { parseTileParams } from '../shared/map-download'

const KEY_MANIFEST = 'map.manifest'
const KEY_PROMPT = 'map.prompt'
const themeKey = (t) => `map.${t}`

let fallback = null

// Uma instância só para o app inteiro: a doc diz que cada instância guarda os
// dados em memória, então duas instâncias (app.js e página) poderiam se
// sobrescrever. O app.js cria a sua em globalData.mapStorage.
function storage() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const g = app && app._options && app._options.globalData
    if (g && g.mapStorage) return g.mapStorage
  } catch (e) {
    // sem app (ex.: teste)
  }
  if (!fallback) fallback = new LocalStorage()
  return fallback
}

export function createMapStorage() {
  return new LocalStorage()
}

function get(key, def) {
  try {
    const v = storage().getItem(key, def)
    return v === undefined ? def : v
  } catch (e) {
    return def
  }
}

function set(key, value) {
  try {
    storage().setItem(key, value)
  } catch (e) {
    console.log('Mapa: erro ao gravar', key, e && e.message ? e.message : e)
  }
}

// LocalStorage pode devolver o objeto ou o texto: aceita os dois.
function obj(v) {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch (e) {
      return null
    }
  }
  return v && typeof v === 'object' ? v : null
}

export function readManifest() {
  return parseCompactManifest(obj(get(KEY_MANIFEST, null)))
}

export function saveManifest(compact) {
  const m = parseCompactManifest(compact)
  if (m) set(KEY_MANIFEST, JSON.stringify(m))
  return m
}

// { have, total } de um tema.
function readTheme(theme) {
  const r = obj(get(themeKey(theme), null)) || {}
  const total = Number.isInteger(r.total) ? r.total : 0
  return { have: normalizeBits(r.have, total), total }
}

function writeTheme(theme, rec) {
  set(themeKey(theme), JSON.stringify({ have: rec.have, total: rec.total }))
}

// Mapa de bits de cada tema, para o MAP_SYNC: { dark: hex, light: hex }.
export function haveBits() {
  const out = {}
  MAP_THEMES.forEach((t) => {
    out[t] = readTheme(t).have
  })
  return out
}

// Mapa do tema pronto (todos os blocos chegaram) e o que a página precisa para desenhar.
// scale: px físicos por px de design (px(1000) / 1000). Devolve null se não estiver pronto.
export function tileInfo(theme, scale) {
  const compact = readManifest()
  if (!compact || !compact.levels[theme]) return null
  const total = compactTotal(compact, theme)
  const rec = readTheme(theme)
  if (total === 0 || rec.total !== total || countBits(rec.have, total) < total) return null
  return { theme, compact, levels: designLevels(compact, theme, scale) }
}

// Progresso no relógio: { done, total }.
export function themeProgress(theme) {
  const compact = readManifest()
  const rec = readTheme(theme)
  const total = compact ? compactTotal(compact, theme) : rec.total
  return { done: countBits(rec.have, total || rec.total), total: total || rec.total }
}

function ensureDir() {
  try {
    if (!statSync({ path: `data://${WATCH_MAP_DIR}` })) mkdirSync({ path: `data://${WATCH_MAP_DIR}` })
  } catch (e) {
    try {
      mkdirSync({ path: `data://${WATCH_MAP_DIR}` })
    } catch (e2) {
      // já existe ou não deu: o rename abaixo diz
    }
  }
}

const exists = (path) => {
  try {
    const st = statSync({ path })
    return !!st && st.size > 0
  } catch (e) {
    return false
  }
}

// Arquivo recebido (FileObject do inbox, readyState 'transferred'): move para
// data://map/<tema>-<k>-<x>_<y>.png e marca o bloco. Devolve true se guardou.
export function storeReceivedTile(file) {
  let params = file && file.params
  if (typeof params === 'string') params = obj(params)
  const p = parseTileParams(params)
  if (!p) return false
  const src = file.filePath
  const target = watchTilePath(p.theme, p.k, p.x, p.y)
  ensureDir()
  if (src && src !== target) {
    try {
      if (exists(target)) rmSync({ path: target })
    } catch (e) {
      // nada
    }
    let ok = false
    try {
      ok = renameSync({ oldPath: src, newPath: target }) === 0
    } catch (e) {
      ok = false
    }
    if (!ok) {
      // Sem rename (outra pasta/partição): copia e apaga o original.
      try {
        const buf = readFileSync({ path: src })
        if (buf) writeFileSync({ path: target, data: buf })
        rmSync({ path: src })
      } catch (e) {
        console.log('Mapa: não deu para guardar', src, e && e.message ? e.message : e)
      }
    }
  }
  if (!exists(target)) return false
  const rec = readTheme(p.theme)
  const total = p.total
  const have = setBit(normalizeBits(rec.total === total ? rec.have : '', total), p.i)
  writeTheme(p.theme, { have, total })
  return true
}

// Apaga os blocos de um tema (o celular pediu "Apagar mapa").
export function deleteTheme(theme) {
  const compact = readManifest()
  const rec = readTheme(theme)
  const levels = compact && compact.levels[theme]
  if (levels) {
    let i = 0
    levels.forEach((l) => {
      for (let y = 0; y < l.r; y++) {
        for (let x = 0; x < l.c; x++, i++) {
          if (!hasBit(rec.have, i)) continue
          try {
            rmSync({ path: watchTilePath(theme, l.k, x, y) })
          } catch (e) {
            // segue
          }
        }
      }
    })
  }
  writeTheme(theme, { have: '', total: 0 })
}

// Escolha do aviso "Baixar o mapa de BH?": { choice: 'yes' | 'later', at }.
export function readPrompt() {
  return obj(get(KEY_PROMPT, null))
}

export function savePrompt(choice, now = Date.now()) {
  set(KEY_PROMPT, JSON.stringify({ choice, at: now }))
}

// O relógio recebe arquivos? (TransferFile existe a partir da API 3.0.)
export function canReceiveFiles() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const lib = app && app._options && app._options.globalData && app._options.globalData.fileTransferLib
    return !!(lib && lib.canUseFileTransfer())
  } catch (e) {
    return false
  }
}
