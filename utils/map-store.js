// Mapa de BH guardado no relógio (cache sob demanda): blocos em data://map/, o
// registro do que já chegou (bits por tema) e a ordem de uso (LRU), no LocalStorage.
// Usa APIs do relógio; a lógica pura fica em shared/ (map-tiles.js, map-demand.js).
// - LocalStorage (@zos/storage), permissão device:os.local_storage:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/
// - arquivos (@zos/fs), raiz /data e prefixo data:// (Zepp OS 3+):
//   https://docs.zepp.com/docs/guides/framework/device/fs/
// - arquivos recebidos do celular (TransferFile, inbox), API 3.0+:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/
import { LocalStorage } from '@zos/storage'
import { MAP_THEMES, parseCompactManifest, compactTotal, watchTilePath, normalizeBits, setBit, hasBit, countBits, designLevels } from '../shared/map-tiles'
import { manifestTag, cleanLru, lruTouch, lruEvict, WATCH_TILE_LIMIT } from '../shared/map-demand'
import { moveReceivedTile, removeTileFile } from './map-files'

const KEY_MANIFEST = 'map.manifest'
const themeKey = (t) => `map.${t}`
const lruKey = (t) => `map.lru.${t}`

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

function readLru(theme, total) {
  return cleanLru(get(lruKey(theme), null), total)
}

function writeLru(theme, list) {
  set(lruKey(theme), JSON.stringify(list))
}

// Bits do tema valendo para o manifesto atual ('' se o total mudou).
export function themeHave(theme) {
  const compact = readManifest()
  const total = compact ? compactTotal(compact, theme) : 0
  const rec = readTheme(theme)
  return total > 0 && rec.total === total ? rec.have : normalizeBits('', total)
}

// Mapa de bits de cada tema, para o MAP_SYNC: { dark: hex, light: hex }.
export function haveBits() {
  const out = {}
  MAP_THEMES.forEach((t) => {
    out[t] = readTheme(t).have
  })
  return out
}

// O que a página precisa para desenhar (com o manifesto no relógio, mesmo sem nenhum
// bloco ainda: eles chegam sob demanda). scale: px físicos por px de design.
export function tileInfo(theme, scale) {
  const compact = readManifest()
  if (!compact || !compact.levels[theme]) return null
  const total = compactTotal(compact, theme)
  if (total === 0) return null
  const rec = readTheme(theme)
  const have = rec.total === total ? rec.have : normalizeBits('', total)
  return { theme, compact, tag: manifestTag(compact), levels: designLevels(compact, theme, scale), have, total, at: Date.now() }
}

// Blocos guardados de um tema.
export function storedCount(theme) {
  const rec = readTheme(theme)
  return countBits(rec.have, rec.total)
}

// Arquivo recebido (FileObject do inbox, readyState 'transferred'): move para
// data://map/<tema>-<k>-<x>_<y>.png, marca o bloco e o põe no fim do LRU; passou do
// limite (WATCH_TILE_LIMIT), apaga os usados há mais tempo. Devolve true se guardou.
export function storeReceivedTile(file) {
  const { tile: p, ok } = moveReceivedTile(file)
  if (!p || !ok) return false
  const rec = readTheme(p.theme)
  const total = p.total
  const same = rec.total === total
  let have = setBit(normalizeBits(same ? rec.have : '', total), p.i)
  let lru = lruTouch(same ? readLru(p.theme, total) : [], [p.i])
  const r = lruEvict({ lru, have, total, limit: WATCH_TILE_LIMIT, keep: [p.i] })
  if (r.evict.length > 0) {
    const compact = readManifest()
    const levels = compact && compact.levels[p.theme]
    r.evict.forEach((i) => {
      const t = levels ? tileAt(levels, i) : null
      if (t) removeTileFile(watchTilePath(p.theme, t.k, t.x, t.y))
    })
    have = r.have
    lru = r.lru
  }
  writeTheme(p.theme, { have, total })
  writeLru(p.theme, lru)
  return true
}

// Índice global -> { k, x, y } (versão curta do manifesto).
function tileAt(levels, i) {
  let n = i
  for (let l = 0; l < levels.length; l++) {
    const c = levels[l].c * levels[l].r
    if (n < c) return { k: levels[l].k, x: n % levels[l].c, y: Math.floor(n / levels[l].c) }
    n -= c
  }
  return null
}

// Blocos que estão na tela: vão para o fim do LRU (não são apagados tão cedo).
export function touchTiles(theme, indices) {
  const rec = readTheme(theme)
  if (!(rec.total > 0) || !Array.isArray(indices) || indices.length === 0) return
  const list = readLru(theme, rec.total)
  const next = lruTouch(list, indices.filter((i) => hasBit(rec.have, i)))
  if (next.join(',') !== list.join(',')) writeLru(theme, next)
}

// Apaga os blocos de um tema ("Limpar mapa do relógio" no celular).
export function deleteTheme(theme) {
  const compact = readManifest()
  const rec = readTheme(theme)
  const levels = compact && compact.levels[theme]
  if (levels) {
    for (let i = 0; i < rec.total; i++) {
      if (!hasBit(rec.have, i)) continue
      const t = tileAt(levels, i)
      if (t) removeTileFile(watchTilePath(theme, t.k, t.x, t.y))
    }
  }
  writeTheme(theme, { have: '', total: 0 })
  writeLru(theme, [])
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
