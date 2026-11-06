/**
 * PprTrustLens — "sua lente": posts de quem você segue entre os primeiros
 * das abas Global e Em alta (Docs/algoritmos.md §6; manifesto §24).
 *
 * O id `ppr-trust` é histórico (o primeiro desenho multiplicava o score
 * pelo PPR). Na produção o app só guarda a lista de quem VOCÊ segue — não a
 * dos seus contatos —, e o PPR nesse grafo de um salto vale o mesmo para
 * todo mundo que você segue: a única informação é "segue ou não". A lente
 * usa isso direto (o feed passa os posts dessas pessoas em `ctx.network`).
 * Amigos de amigos só entram quando houver a lista deles E defesa contra
 * contas falsas seguidas por um contato (Docs/known-limitations.md).
 *
 * A regra (mixNetwork, src/lib/lens/order.ts): com força k%, k de cada 100
 * lugares da aba vão para posts de quem você segue, na ordem de sempre;
 * no máximo 2 posts por pessoa, de até 7 dias; nunca rebaixa um post
 * escolhido; post afundado pela comunidade não ganha prioridade; a aba
 * mantém o tamanho.
 *
 * Força 0 → devolve o MESMO array (a ordem de sempre, bit a bit).
 * Manifesto §7: função pura das entradas (força, aba, posts da rede).
 * Manifesto §24: nada é gravado em `posts` nem publicado; `lensLift` vive
 * só no objeto em memória.
 */

import type { LensStrategy, LensApplyContext, LensApplyResult } from '../types'
import type { Post } from '../../../types/drift'
import { useLensStore } from '../../trust-lens'
import { mixNetwork } from '../order'

/** Força do store (0..1) em pontos inteiros (0..100). */
export function lensStrengthPct(): number {
  const s = useLensStore.getState().strength
  return Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s * 100))) : 0
}

export const PprTrustLens: LensStrategy = {
  id: 'ppr-trust',
  name: 'quem você segue primeiro',
  description:
    'Põe posts de quem você segue entre os primeiros das abas global e em alta. A força diz quantos: 50% = um card sim, um não.',
  version: 2,

  needsNetwork(): boolean {
    return lensStrengthPct() > 0
  },

  apply(posts: readonly Post[], ctx: LensApplyContext): LensApplyResult {
    const strengthPct = lensStrengthPct()
    if (strengthPct === 0) return { posts }
    const { posts: mixed, lifted } = mixNetwork({ tab: posts, network: ctx.network ?? [], strengthPct })
    return {
      posts: mixed.map((p) => {
        const lift = lifted.get(p.id)
        return lift ? { ...p, lensLift: lift } : p
      }),
    }
  },
}
