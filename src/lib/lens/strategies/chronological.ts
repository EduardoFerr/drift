/**
 * ChronologicalLens — alt lens "feed cronológico puro" (POC Sprint N+2 P0.2).
 *
 * Reordena posts SÓ por `createdAt DESC`. Zero dependência em trust/PPR/
 * store externo — pure function da entrada `posts`.
 *
 * Motivação (design doc Decisões abertas linha 342): user que prefere
 * "ordem do tempo, sem qualquer boost" hoje não tem opção — só o slider
 * 0→100% da MESMA lente PPR. Esta lens oferece switch real.
 *
 * Manifesto §7: pure, determinístico. Mesmo input → mesmo output sempre.
 * Manifesto §22: zero referência a reputação (não consulta PPR, follows,
 * mutuals). Apenas timestamp do evento.
 * Manifesto §24: não toca `posts.score` (mantém score canônico inalterado;
 * só reordena).
 */

import type { LensStrategy, LensApplyContext, LensApplyResult } from '../types'
import type { Post } from '../../../types/drift'

export const ChronologicalLens: LensStrategy = {
  id: 'chronological',
  name: 'Cronológico',
  description:
    'Apenas ordem do tempo — post mais recente primeiro. Sem boost de rede, sem ranking.',
  version: 1,

  apply(posts: readonly Post[], _ctx: LensApplyContext): LensApplyResult {
    // Shallow copy + sort estável. NÃO muta input.
    // Secondary key: `id` lexico — determinismo cross-device pra posts
    // com mesmo createdAt (raro, mas possível em alta-frequência).
    const sorted = [...posts].sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    return { posts: sorted }
  },
}
