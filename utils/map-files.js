// Arquivos do mapa de BH no relógio, só com @zos/fs (sem LocalStorage, sem UI):
// usado por utils/map-store.js.
// - mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync:
//   https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/readFileSync/ (e páginas vizinhas)
import { mkdirSync, renameSync, statSync, rmSync, readFileSync, writeFileSync } from '@zos/fs'
import { WATCH_MAP_DIR, watchTilePath } from '../shared/map-tiles'
import { parseTileParams } from '../shared/map-download'
import { receivedPathCandidates } from '../shared/transfer'

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
// mesmo aviso chegar duas vezes, a segunda acha o original já movido e só confirma o
// destino (nunca apaga um bloco bom sem ter o novo em mãos). O filePath do inbox
// pode vir com ou sem data:// (receivedPathCandidates tenta os jeitos possíveis).
// Devolve { tile, ok, reason } (ok: o bloco está no destino; reason: por que não).
export function moveReceivedTile(file) {
  const tile = tileOfFile(file)
  if (!tile) return { tile: null, ok: false, reason: 'params inválidos' }
  const target = watchTilePath(tile.theme, tile.k, tile.x, tile.y)
  ensureMapDir()
  const src = receivedPathCandidates(file).filter((p) => p !== target).find(fileExists) || null
  let reason = ''
  if (src) {
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
    if (!ok || !fileExists(target)) {
      // Sem rename (outra pasta/partição): copia e apaga o original.
      try {
        const buf = readFileSync({ path: src })
        if (buf) writeFileSync({ path: target, data: buf })
        if (fileExists(target)) rmSync({ path: src })
        else reason = 'não copiou'
      } catch (e) {
        reason = `cópia: ${e && e.message ? e.message : e}`
        console.log('Mapa: não deu para guardar', src, reason)
      }
    }
  }
  const ok = fileExists(target)
  if (!ok && !reason) reason = src ? 'não moveu' : `arquivo sumiu (${String(file.filePath || file.fileName || '?').slice(-24)})`
  return { tile, ok, reason: ok ? '' : reason }
}

// Apaga um bloco guardado (cache LRU ou "Limpar mapa do relógio").
export function removeTileFile(path) {
  try {
    rmSync({ path })
    return true
  } catch (e) {
    return false
  }
}
