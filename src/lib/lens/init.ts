/**
 * Lens init — registra as lentes do app no boot e aplica a lente ativa no
 * feed (Docs/algoritmos.md §6; manifesto §24).
 *
 * Idempotente: chamadas subsequentes são no-op (registerLens já é
 * resiliente a re-register do mesmo objeto — StrictMode dev OK).
 *
 * **Ordem de registro = ordem em `listLenses()`**, que vira ordem do
 * dropdown UI. Default first (ppr-trust), depois alts.
 */

import { getActiveLens, registerLens, setActiveLens, listLenses } from './registry'
import { PprTrustLens } from './strategies/ppr-trust'
import { ChronologicalLens } from './strategies/chronological'
import { getPprForAuthor } from '../trust-lens'
import { db } from '../db'
import type { Post } from '../../types/drift'

let initialized = false

export function initBuiltinLenses(): void {
  if (initialized) return
  initialized = true
  registerLens(PprTrustLens)
  registerLens(ChronologicalLens)
}

/**
 * Aplica a lente ativa à aba. O feed chama só nas abas Global e Em alta,
 * já com a aba na ordem canônica e, se a lente pedir (`needsNetwork`), com
 * os posts de quem o leitor segue. Sem lente registrada (antes do boot),
 * devolve a aba como veio.
 */
export function applyActiveLens(
  posts: readonly Post[],
  ctx: { viewer: string | null; now: number; network?: readonly Post[] },
): readonly Post[] {
  if (listLenses().length === 0) return posts
  return getActiveLens().apply(posts, { ...ctx, getPprScore: getPprForAuthor }).posts
}

/** A lente ativa quer os posts de quem o leitor segue agora? */
export function activeLensNeedsNetwork(): boolean {
  if (listLenses().length === 0) return false
  return getActiveLens().needsNetwork?.() ?? false
}

// ─── Lente escolhida persiste entre aberturas (user_prefs.active_lens) ──

const ACTIVE_LENS_KEY = 'active_lens'

/** Troca a lente e guarda a escolha neste aparelho (nunca publicada). */
export async function chooseLens(id: string): Promise<void> {
  setActiveLens(id)
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [ACTIVE_LENS_KEY, id],
  )
}

/** No boot, depois de `initBuiltinLenses`: volta à lente escolhida antes.
 *  Valor desconhecido (lente que saiu do app) fica no padrão. */
export async function restoreChosenLens(): Promise<void> {
  const row = await db.get<{ value: string }>(`SELECT value FROM user_prefs WHERE key = ?`, [ACTIVE_LENS_KEY])
  if (!row?.value) return
  if (listLenses().some((l) => l.id === row.value)) setActiveLens(row.value)
}
