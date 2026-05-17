/**
 * Preferências locais do usuário — store Zustand respaldada por SQLite.
 *
 * Manifesto §28 (Privacidade pelo Mínimo): preferências NUNCA saem do
 * device. Não há "sync de settings via Nostr" — o que está aqui é
 * exclusivo deste cliente nesta máquina.
 *
 * Padrão de uso:
 *
 *   await loadPrefs()                                      // boot
 *   const showNsfw = usePrefsStore(s => s.show_nsfw_default)  // hook React
 *   await setPref('show_nsfw_default', true)               // mutação
 *
 * Persistência: chave/valor em `user_prefs` do SQLite. Boolean é serializado
 * como '1'/'0', enums (LocationGranularity) como string. Falha de parse
 * (banco velho com valor inválido) cai no default — não quebra UI.
 */

import { create } from 'zustand'
import { db } from './db'
import {
  DEFAULT_USER_PREFS,
  type UserPrefs,
  type LocationGranularity,
  type MapView,
  type NetworkMode,
} from '../types/drift'

// ─── Store reativa ───────────────────────────────────────────────────

export const usePrefsStore = create<UserPrefs>(() => DEFAULT_USER_PREFS)

/** Acesso síncrono fora de React. */
export const getPrefs = usePrefsStore.getState

// ─── Carregamento e mutação ──────────────────────────────────────────

let loaded = false

/**
 * Carrega todas as prefs do SQLite pra store. Idempotente — primeira
 * chamada faz o load, chamadas subsequentes são no-op (a store já
 * reflete o estado).
 *
 * Chamado em `bootstrap.ts` depois do db init.
 */
export async function loadPrefs(): Promise<void> {
  if (loaded) return
  loaded = true

  const rows = await db.exec<{ key: string; value: string }>(
    `SELECT key, value FROM user_prefs`,
  )
  const next: UserPrefs = { ...DEFAULT_USER_PREFS }
  for (const row of rows) {
    applyRow(next, row.key, row.value)
  }
  usePrefsStore.setState(next)
}

function applyRow(target: UserPrefs, key: string, value: string): void {
  switch (key) {
    case 'show_nsfw_default':
      target.show_nsfw_default = value === '1'
      return
    case 'hide_spoilers':
      target.hide_spoilers = value === '1'
      return
    case 'hide_ads':
      target.hide_ads = value === '1'
      return
    case 'location_granularity':
      if (isLocationGranularity(value)) target.location_granularity = value
      return
    case 'onboarding_done':
      target.onboarding_done = value === '1'
      return
    case 'map_view':
      if (isMapView(value)) target.map_view = value
      return
    case 'network_mode':
      if (isNetworkMode(value)) target.network_mode = value
      return
    case 'thread_coach_seen':
      target.thread_coach_seen = value === '1'
      return
    case 'use_ipfs':
      target.use_ipfs = value === '1'
      return
    case 'p2p_auto_follows':
      target.p2p_auto_follows = value === '1'
      return
    case 'thread_view_mode':
      // Round Comments Nav Redesign Phase A — list é default novo,
      // cards preservado opt-in. Valor inválido cai pro default.
      if (value === 'list' || value === 'cards') {
        target.thread_view_mode = value
      }
      return
    case 'theme_id':
      // 3 paletas com identidade editorial (2026-05-17). Valor inválido
      // → mantém default. Aplicação visual ocorre em `lib/theme.ts:applyTheme`
      // disparado pelo subscriber no boot + setPref.
      if (value === 'cinder' || value === 'rosenholz' || value === 'velatura') {
        target.theme_id = value
      }
      return
    default:
      // chave desconhecida — pode ser de fase futura, ignora silenciosamente
      return
  }
}

function isLocationGranularity(v: string): v is LocationGranularity {
  return v === 'off' || v === 'country' || v === 'city' || v === 'precise'
}

function isMapView(v: string): v is MapView {
  return v === 'fit-bounds' || v === 'open'
}

function isNetworkMode(v: string): v is NetworkMode {
  return v === 'clearnet' || v === 'tor' || v === 'onion-only'
}

/**
 * Atualiza uma preferência local. Persiste no SQLite e atualiza a store
 * sincronamente — UI reage imediatamente.
 *
 * @param key - Chave da pref (typed)
 * @param value - Novo valor
 */
export async function setPref<K extends keyof UserPrefs>(
  key: K,
  value: UserPrefs[K],
): Promise<void> {
  const serialized = serialize(value)
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, serialized],
  )
  usePrefsStore.setState({ [key]: value } as Partial<UserPrefs>)
}

function serialize(v: unknown): string {
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return JSON.stringify(v)
}
