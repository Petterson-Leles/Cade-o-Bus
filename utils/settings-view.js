// Textos da tela de configurações do celular (setting/index.js), sem APIs do Zepp:
// cabeçalho, linhas dos pontos salvos, rótulo do botão "Salvar" e resumo do mapa.
// Testado em test/settings-view.test.mjs.
import { stopById } from '../shared/gtfs.js'
import { abbreviateStreet, stopKind, foldText } from '../shared/text.js'
import { autoStopName, favoriteContext } from '../shared/settings-form.js'
import { normalizeAlert, alertActive, alertSummary } from '../shared/schedule.js'
import { storedCount } from '../shared/map-download.js'
import { MAX_TEXT_LEN } from './favorites.js'

// Estado da tela guardado no settingsStorage (o build roda de novo a cada mudança):
// SCREEN_KEY = 'add' mostra só o formulário "Novo ponto"; MAP_OPEN_KEY = '1' abre os
// detalhes do "Mapa de BH". O side service ignora essas chaves.
export const SCREEN_KEY = 'settingsScreen'
export const MAP_OPEN_KEY = 'mapOpen'

// Subtítulo do cabeçalho: "3 pontos no relógio".
export function countLabel(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  if (k === 0) return 'Nenhum ponto no relógio'
  return `${k} ${k === 1 ? 'ponto' : 'pontos'} no relógio`
}

// "Para Barreiro" -> "Barreiro" (pílula do sentido e "p/ <sentido>").
export function towardName(title) {
  return String(title || '').replace(/^Para\s+/, '')
}

// Linha de um ponto salvo na lista:
// { kind, title, sub, alert, alertOn, where, between }
// - kind: 'street' | 'move' | 'central' (ícone);
// - sub: "Av. Pres. Antonio Carlos 4061 · p/ Barreiro" (uma linha, cortada na tela);
// - alert: "Avisa seg–sex · 17:45–18:45" (alertOn, cor de destaque) ou "Sem aviso";
// - where / between: detalhes do editor ("... · 13º ponto" e "entre X e Y").
export function savedRow(fav, index, vibrateOn = true) {
  const f = fav || {}
  const stop = f.stopId ? stopById(index, f.stopId) : null
  const ctx = favoriteContext(f, index)
  let place = ''
  if (stop && stop.name) {
    // Estação: o nome já diz qual é (ícone + "Pampulha")? Então a rua/plataforma
    // ("Est. Pampulha - Plataforma G5" -> "Plataforma G5"); senão a estação.
    const street = abbreviateStreet(stop.name)
    const core = stop.station ? foldText(stop.station.replace(/^Estação\s+/, '')) : ''
    if (stop.station && core && foldText(f.name).indexOf(core) < 0 && core.indexOf(foldText(f.name)) < 0) place = stop.station
    else place = street.replace(/^Est\.[^-]*-\s*/, '') || street
  } else if (f.lat !== undefined && f.lon !== undefined) place = `${f.lat}, ${f.lon}`
  const sub = [place, ctx && ctx.toward ? `p/ ${ctx.toward}` : ''].filter(Boolean).join(' · ')
  const alert = normalizeAlert(f.alert)
  const alertOn = alertActive(alert) && !!vibrateOn
  let alertText = 'Sem aviso'
  if (alertOn) alertText = `Avisa ${alertSummary(alert).toLowerCase()}`
  else if (alertActive(alert)) alertText = 'Sem aviso · vibração desligada'
  return {
    kind: stopKind(stop),
    title: String(f.name || ''),
    sub,
    alert: alertText,
    alertOn,
    where: ctx ? ctx.where : place,
    between: ctx && ctx.between ? ctx.between : ''
  }
}

// Nome que o ponto novo vai ter: o digitado ou o automático (estação ou rua).
export function draftName(draft, stop) {
  const typed = String((draft && draft.name) || '').trim()
  const name = typed || (draft && draft.manual ? '' : autoStopName(stop))
  return name.slice(0, MAX_TEXT_LEN).trim()
}

// Rótulo do botão de salvar: Salvar “Estação UFMG” (sem nome ainda: "Salvar ponto").
export function saveLabel(draft, stop) {
  const name = draftName(draft, stop)
  return name ? `Salvar “${name}”` : 'Salvar ponto'
}

// Linha "Mapa de BH": "124 blocos no relógio" (ou limpando).
export function mapSummary(states) {
  const keys = states ? Object.keys(states) : []
  if (keys.some((t) => states[t] && states[t].deleting)) return 'Limpando: abra o app no relógio'
  const n = storedCount(states)
  return `${n} ${n === 1 ? 'bloco' : 'blocos'} no relógio`
}
