/**
 * Lens init — registra built-in strategies no boot (POC Sprint N+2 P0.2).
 *
 * Idempotente: chamadas subsequentes são no-op (registerLens já é
 * resiliente a re-register do mesmo objeto — StrictMode dev OK).
 *
 * Chamado em `bootstrap.ts` depois do DB init (lens-side state pode
 * depender de `loadLens()` que lê PPR cache).
 *
 * **Ordem de registro = ordem em `listLenses()`**, que vira ordem do
 * dropdown UI. Default first (ppr-trust), depois alts.
 */

import { registerLens } from './registry'
import { PprTrustLens } from './strategies/ppr-trust'
import { ChronologicalLens } from './strategies/chronological'

let initialized = false

export function initBuiltinLenses(): void {
  if (initialized) return
  initialized = true
  registerLens(PprTrustLens)
  registerLens(ChronologicalLens)
}

/**
 * Helper applyActiveLens — wrapper conveniente sobre `getActiveLens().apply()`.
 *
 * Use em call-sites de UI/feed que querem reordenar lista de posts pela
 * lente ativa do user. Manter o context build em um único lugar pra
 * consistência cross-callers.
 *
 * **Não substitui `applyLensToPost` (single-post)** — esse helper
 * legacy continua válido pra render path que computa `s_local` por post
 * isoladamente (ex: PostCard chip "lente"). Aqui ordenamos a lista.
 */
import { getActiveLens } from './registry'
import { getPprForAuthor } from '../trust-lens'
import { useBootStore } from '../bootstrap'
import type { Post } from '../../types/drift'

export function applyActiveLens(posts: readonly Post[]): readonly Post[] {
  const lens = getActiveLens()
  const viewer = useBootStore.getState().identity?.npub ?? null
  return lens.apply(posts, {
    viewer,
    now: Date.now(),
    getPprScore: getPprForAuthor,
  }).posts
}
