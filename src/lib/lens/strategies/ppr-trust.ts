/**
 * PprTrustLens — refatoração da `applyLensToPost` legacy pra strategy
 * registrável (POC Sprint N+2 P0.2).
 *
 * **Bit-exact migration**: pra `strength === 0`, retorna posts na MESMA
 * ordem que entraram (no-op). Para `strength > 0`, computa `s_local` por
 * post via `viewMultiplier` (mesmo math do `applyLensToPost` legacy) e
 * reordena por `s_local DESC, createdAt DESC`.
 *
 * Conformance #19 preservado: lensStore.strength=0 → multiplier=1.0 →
 * ordem inalterada (vide test em `tests/lens-plugin-conformance.test.ts`).
 *
 * Manifesto §7 (determinismo): pure function. Lê `strength` do store
 * `useLensStore` no act-time — mesma entrada + mesmo store state → mesma
 * saída. (Store é input externo, válido em pure functions de view layer.)
 *
 * Manifesto §24: `s_local` NUNCA escrito em `posts.score`. Retornamos
 * array de Posts inalterados (input) reordenados — score canônico
 * preserved bit-exact em cada Post.
 */

import type { LensStrategy, LensApplyContext, LensApplyResult } from '../types'
import type { Post } from '../../../types/drift'
import { useLensStore } from '../../trust-lens'
import { viewMultiplier } from '../../trust/ppr'

export const PprTrustLens: LensStrategy = {
  id: 'ppr-trust',
  name: 'Sua Lente (PPR Trust)',
  description:
    'Reordena baseado em quem você acompanha e drifts mútuos (Personalized PageRank).',
  version: 1,

  apply(posts: readonly Post[], ctx: LensApplyContext): LensApplyResult {
    const { strength } = useLensStore.getState()
    if (strength === 0) {
      // Bit-exact off-state (#19): retorna mesma sequência.
      return { posts }
    }
    const getPpr = ctx.getPprScore ?? (() => 0)
    // Map → sort → unwrap. Stable secondary key: createdAt DESC (mesma
    // tiebreaker que `feed.ts` usa em `ORDER BY score DESC, created_at DESC`).
    const scored = posts.map((p) => ({
      post: p,
      sLocal:
        p.score *
        viewMultiplier({
          pprScore: getPpr(p.authorPub),
          mutualSpreadPost: 0, // §6 mutual context defer SHIP (parity legacy applyLensToPost default)
          strength,
        }),
    }))
    scored.sort((a, b) => {
      if (b.sLocal !== a.sLocal) return b.sLocal - a.sLocal
      return b.post.createdAt - a.post.createdAt
    })
    return { posts: scored.map((x) => x.post) }
  },
}
