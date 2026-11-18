// Arquivos do mapa de BH no relógio, só com @zos/fs (sem LocalStorage, sem UI):
// usado pelo app (utils/map-store.js) e pelo App Service (app-service/map-service.js),
// que tem menos APIs disponíveis. https://docs.zepp.com/docs/guides/framework/device/app-service/
// - mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/readFileSync/ (e páginas vizinhas)
import { mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync } from '@zos/fs'
import { WATCH_MAP_DIR, watchTilePath } from '../shared/map-tiles'
import { parseTileParams } from '../shared/map-download'
import { SERVICE_REGISTRY_FILE, PING_FILE, cleanRegistry } from '../shared/map-service'

export function ensureMapDir() {
  try {
    if (!statSync({ path: `data://${WATCH_MAP_DIR}` })) mkdirSync({ path: `data://${WATCH_MAP_DIR}` })
  } catch (e) {
    try {
      mkdirSync({ path: `data://${WATCH_MAP_DIR}` })
    } catch (e2) {
      // já existe ou não deu: o rename diz
    }
  }
}

export const fileExists = (path) => {
  try {
    const st = statSync({ path })
    return !!st && st.size > 0
  } catch (e) {
    return false
  }
}

// params do FileObject (objeto ou texto) -> { theme, i, k, x, y, total } ou null.
export function tileOfFile(file) {
  let params = file && file.params
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params)
    } catch (e) {
      params = null
    }
  }
  return parseTileParams(params)
}

// Move o arquivo recebido para data://map/<tema>-<k>-<x>_<y>.png. Idempotente: se o
// mesmo bloco chegar a dois donos (app e service), o segundo acha o original já
// movido e só confirma o destino (nunca apaga um bloco bom sem ter o novo em mãos).
// Devolve { tile, ok } (ok: o bloco está no destino).
export function moveReceivedTile(file) {
  const tile = tileOfFile(file)
  if (!tile) return { tile: null, ok: false }
  const src = file.filePath
  const target = watchTilePath(tile.theme, tile.k, tile.x, tile.y)
  ensureMapDir()
  if (src && src !== target && fileExists(src)) {
    try {
      if (fileExists(target)) rmSync({ path: target })
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
        if (fileExists(target)) rmSync({ path: src })
      } catch (e) {
        console.log('Mapa: não deu para guardar', src, e && e.message ? e.message : e)
      }
    }
  }
  return { tile, ok: fileExists(target) }
}

// ---- Registro do App Service (JSON próprio, para não disputar o LocalStorage do app) ----

export function readServiceRegistry() {
  try {
    const txt = readFileSync({ path: SERVICE_REGISTRY_FILE, options: { encoding: 'utf8' } })
    return cleanRegistry(typeof txt === 'string' ? txt : null)
  } catch (e) {
    return cleanRegistry(null)
  }
}

// Devolve true se gravou (no service só funciona com a tela desligada / AOD).
export function writeServiceRegistry(reg) {
  try {
    ensureMapDir()
    writeFileSync({ path: SERVICE_REGISTRY_FILE, data: JSON.stringify(cleanRegistry(reg)), options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    return false
  }
}

export function removeServiceRegistry() {
  try {
    if (statSync({ path: SERVICE_REGISTRY_FILE })) rmSync({ path: SERVICE_REGISTRY_FILE })
  } catch (e) {
    // nada
  }
}

// Arquivo pequeno que o service manda ao celular como "MAP_SYNC" (a página cria,
// porque o service só grava com a tela desligada).
export function ensurePingFile() {
  if (fileExists(PING_FILE)) return true
  try {
    ensureMapDir()
    writeFileSync({ path: PING_FILE, data: 'cob-sync', options: { encoding: 'utf8' } })
  } catch (e) {
    // sem arquivo, o service tenta de novo
  }
  return fileExists(PING_FILE)
}
