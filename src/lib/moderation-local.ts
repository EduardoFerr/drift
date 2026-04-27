/**
 * Bloqueio e silenciamento LOCAL — manifesto §24 (sem afinidade no
 * feed) + §10 (cliente NÃO deleta dados moderados).
 *
 * Ambos são camada de **visualização**, não de ranking. Score continua
 * determinístico — se você bloqueia alguém, ele NÃO some pra outros
 * users; só pra você.
 *
 *   Bloquear (block) — esconde POSTS desse npub do seu feed E ignora
 *                      spreads/buries dele no cálculo visual local.
 *   Silenciar (mute) — só esconde POSTS. Spreads/buries dele continuam
 *                      contando pro score que você vê (você ainda vê
 *                      o engajamento, só não vê os posts dele).
 *
 * Manifesto §24: "Bloquear / silenciar / seguir são camada de
 * filtragem local na visualização, não de ranking. A ordenação dentro
 * da categoria continua determinística."
 *
 * Stores reativas pra UI consumir e pra `feed.ts:applyContentFilters`
 * checar rapidamente. Persiste em SQLite (`blocked` + `muted`).
 */

import { create } from 'zustand'
import { db } from './db'

// ─── Tipos + Stores ──────────────────────────────────────────────────

interface ModLocalState {
  blocked: Set<string>
  muted: Set<string>
  loaded: boolean
}

export const useModLocalStore = create<ModLocalState>(() => ({
  blocked: new Set<string>(),
  muted: new Set<string>(),
  loaded: false,
}))

// ─── Carregamento ────────────────────────────────────────────────────

let initialized = false

export async function loadModLocal(): Promise<void> {
  if (initialized) return
  initialized = true
  await refresh()
}

async function refresh(): Promise<void> {
  const blockedRows = await db.exec<{ npub: string }>(
    `SELECT npub FROM blocked`,
  )
  const mutedRows = await db.exec<{ npub: string }>(
    `SELECT npub FROM muted`,
  )
  useModLocalStore.setState({
    blocked: new Set(blockedRows.map((r) => r.npub)),
    muted: new Set(mutedRows.map((r) => r.npub)),
    loaded: true,
  })
}

// ─── API ─────────────────────────────────────────────────────────────

export async function block(npub: string, reason?: string): Promise<void> {
  await db.run(
    `INSERT INTO blocked (npub, blocked_at, reason) VALUES (?, ?, ?)
     ON CONFLICT(npub) DO UPDATE SET blocked_at = excluded.blocked_at`,
    [npub, Date.now(), reason ?? null],
  )
  await refresh()
}

export async function unblock(npub: string): Promise<void> {
  await db.run(`DELETE FROM blocked WHERE npub = ?`, [npub])
  await refresh()
}

export async function mute(npub: string): Promise<void> {
  await db.run(
    `INSERT INTO muted (npub, muted_at) VALUES (?, ?)
     ON CONFLICT(npub) DO UPDATE SET muted_at = excluded.muted_at`,
    [npub, Date.now()],
  )
  await refresh()
}

export async function unmute(npub: string): Promise<void> {
  await db.run(`DELETE FROM muted WHERE npub = ?`, [npub])
  await refresh()
}

/**
 * Check síncrono usado em hot path (rendering loop). Lê da store
 * Zustand — sem touch ao SQLite por iteração.
 */
export function isHidden(authorNpub: string): boolean {
  const s = useModLocalStore.getState()
  return s.blocked.has(authorNpub) || s.muted.has(authorNpub)
}

/** Versão detalhada — usada em UI de info ("por que esse post sumiu?"). */
export function hiddenReason(authorNpub: string): 'blocked' | 'muted' | null {
  const s = useModLocalStore.getState()
  if (s.blocked.has(authorNpub)) return 'blocked'
  if (s.muted.has(authorNpub)) return 'muted'
  return null
}

// ─── Listas pra UI de gerenciamento ─────────────────────────────────

export interface ModLocalEntry {
  npub: string
  at: number
  reason: string | null
}

export async function listBlocked(): Promise<ModLocalEntry[]> {
  const rows = await db.exec<{ npub: string; blocked_at: number; reason: string | null }>(
    `SELECT npub, blocked_at, reason FROM blocked ORDER BY blocked_at DESC`,
  )
  return rows.map((r) => ({ npub: r.npub, at: r.blocked_at, reason: r.reason }))
}

export async function listMuted(): Promise<ModLocalEntry[]> {
  const rows = await db.exec<{ npub: string; muted_at: number }>(
    `SELECT npub, muted_at FROM muted ORDER BY muted_at DESC`,
  )
  return rows.map((r) => ({ npub: r.npub, at: r.muted_at, reason: null }))
}
