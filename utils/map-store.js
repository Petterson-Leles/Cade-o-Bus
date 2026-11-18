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
import { rmSync } from '@zos/fs'
import {
  MAP_THEMES,
  parseCompactManifest,
  compactTotal,
  watchTilePath,
  normalizeBits,
  setBit,
  hasBit,
  countBits,
  designLevels
} from '../shared/map-tiles'
import { unionTheme } from '../shared/map-service'
import { moveReceivedTile, readServiceRegistry, writeServiceRegistry, removeServiceRegistry } from './map-files'

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

// { have, total } de um tema só no LocalStorage do app.
function readMainTheme(theme) {
  const r = obj(get(themeKey(theme), null)) || {}
  const total = Number.isInteger(r.total) ? r.total : 0
  return { have: normalizeBits(r.have, total), total }
}

// { have, total } de um tema: o do app somado ao que o App Service guardou
// (registro próprio dele, utils/map-files.js). Os dois só somam bits: o mesmo bloco
// guardado pelos dois não conta duas vezes.
function readTheme(theme) {
  return unionTheme(readMainTheme(theme), readServiceRegistry().themes[theme])
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
  // Mapa parcial também serve: o celular manda primeiro a cidade no zoom afastado e
  // os arredores dos seus pontos; blocos que ainda não chegaram ficam de fora.
  if (total === 0 || rec.total !== total || countBits(rec.have, total) === 0) return null
  return { theme, compact, levels: designLevels(compact, theme, scale), have: rec.have, complete: countBits(rec.have, total) >= total, at: Date.now() }
}

// Progresso no relógio: { done, total }.
export function themeProgress(theme) {
  const compact = readManifest()
  const rec = readTheme(theme)
  const total = compact ? compactTotal(compact, theme) : rec.total
  return { done: countBits(rec.have, total || rec.total), total: total || rec.total }
}

// Arquivo recebido (FileObject do inbox, readyState 'transferred'): move para
// data://map/<tema>-<k>-<x>_<y>.png e marca o bloco. Devolve true se guardou.
// Idempotente (o App Service pode receber o mesmo bloco): ver moveReceivedTile.
export function storeReceivedTile(file) {
  const { tile: p, ok } = moveReceivedTile(file)
  if (!p || !ok) return false
  const rec = readMainTheme(p.theme)
  const total = p.total
  const have = setBit(normalizeBits(rec.total === total ? rec.have : '', total), p.i)
  writeTheme(p.theme, { have, total })
  return true
}

// O que o App Service guardou vira registro do app. Com o service parado, apaga o
// registro dele (com ele rodando, só copia: ele continua gravando no arquivo dele).
export function absorbServiceTiles(serviceRunning) {
  const reg = readServiceRegistry()
  MAP_THEMES.forEach((t) => {
    const extra = reg.themes[t]
    if (!extra) return
    const main = readMainTheme(t)
    const u = unionTheme(main, extra)
    if (u.total !== main.total || u.have !== main.have) writeTheme(t, u)
  })
  if (!serviceRunning) removeServiceRegistry()
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
  // Também o que o App Service guardou deste tema.
  const reg = readServiceRegistry()
  if (reg.themes[theme]) {
    delete reg.themes[theme]
    writeServiceRegistry(reg)
  }
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
