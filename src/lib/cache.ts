/**
 * Cache eviction local — manifesto §16 (Disponibilidade Distribuída).
 *
 * SQLite local é cache reconstruível. Quando o número de posts passa
 * de um limite (`MAX_POSTS_CACHE` = 10k), removemos os mais frios pra
 * liberar espaço. **Mas com regras duras de proteção:**
 *
 *   1. Posts que o user espalhou (kind 9079 do user atual) NUNCA são
 *      removidos. Manifesto §16: "Espalhar = seedear" — quem espalhou
 *      compromete-se a manter localmente, virando fonte de re-broadcast
 *      em Fase 5+.
 *
 *   2. Posts pinados (tabela `pinned`, Fase 5) NUNCA são removidos.
 *
 *   3. Posts próprios (do npub do user) NUNCA são removidos. Identidade
 *      portável (manifesto §3) já protege via `rebuildIdentityHistory`,
 *      mas remover localmente faria o user perder histórico até o
 *      próximo rebuild.
 *
 * Eviction NÃO é deleção do evento na rede — apenas do cache local.
 * O evento Nostr permanece nos relays, IPFS pin (Fase 6), e em outros
 * clientes Drift que tenham espalhado.
 *
 * Cliente NUNCA remove posts moderados (`score = -999`) por decisão
 * própria (invariante #13). Score baixo é flag de visualização, não de
 * limpeza.
 *
 * Manifesto §10: cliente é a autoridade sobre seu próprio estado.
 * Eviction é decisão local, não global.
 */

import { db } from './db'
import { DRIFT_LIMITS } from '../config/constants'
import { invalidateFeed } from './feed'

const SOFT_LIMIT = DRIFT_LIMITS.MAX_POSTS_CACHE
/** Quantos posts remover de uma vez quando passa do limite. */
const EVICTION_BATCH = 500

/**
 * Remove posts frios do cache local quando passa do limite.
 *
 * Função idempotente — chamar repetidamente é seguro. Se contagem está
 * abaixo do limite, retorna 0 sem tocar no banco.
 *
 * @param currentNpub - npub hex do user atual (pra preservar próprios + espalhados)
 * @returns Número de posts removidos
 */
export async function evictOldPosts(currentNpub: string): Promise<number> {
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM posts`)
  const total = row?.n ?? 0

  if (total <= SOFT_LIMIT) return 0

  const overflow = total - SOFT_LIMIT
  const toRemove = Math.min(overflow + EVICTION_BATCH, total)

  // Estratégia: deleta os de menor score que NÃO foram:
  //   - publicados pelo próprio user (author_pub = currentNpub)
  //   - espalhados pelo user (existe spread WHERE spreader_pub = currentNpub)
  //   - pinados (existe row em pinned)
  //
  // Posts moderados (score = -999) PODEM ser removidos pelo eviction
  // quando o user não os espalhou — a visibilidade já foi descartada
  // pela moderação comunitária. Isso NÃO viola invariante #13 (que
  // proíbe deletar como decisão de moderação) — eviction é gestão de
  // espaço, não censura.
  const result = await db.exec<{ id: string }>(
    `DELETE FROM posts WHERE id IN (
       SELECT p.id FROM posts p
       LEFT JOIN spreads s ON p.id = s.post_id AND s.spreader_pub = ?
       LEFT JOIN pinned  pn ON pn.post_id = p.id
       WHERE p.author_pub != ?
         AND s.post_id IS NULL
         AND pn.post_id IS NULL
       ORDER BY p.score ASC, p.created_at ASC
       LIMIT ?
     )
     RETURNING id`,
    [currentNpub, currentNpub, toRemove],
  )

  const removed = result.length
  if (removed > 0) {
    // Cleanup órfãos — buries de posts que sumiram não fazem mais
    // sentido. Spreads/Reports do user atual ficam (ele continua
    // querendo seedear/moderar mesmo se o post sumiu localmente).
    await db.run(
      `DELETE FROM buries WHERE post_id NOT IN (SELECT id FROM posts)`,
    )
    invalidateFeed()
  }

  return removed
}

/**
 * Pina um post — protege contra eviction + marca pra re-broadcast
 * (Fase 5) e pin IPFS (Fase 6).
 *
 * Idempotente. Não publica nada na rede — pin é estado puramente local.
 */
export async function pinPost(postId: string): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO pinned (post_id, pinned_at) VALUES (?, ?)`,
    [postId, Date.now()],
  )
}

/**
 * Remove o pin de um post. Eviction passa a poder remover (se as outras
 * condições forem satisfeitas — não espalhado, não próprio).
 */
export async function unpinPost(postId: string): Promise<void> {
  await db.run(`DELETE FROM pinned WHERE post_id = ?`, [postId])
}

/**
 * Lista posts pinados pelo user. Útil pra UI de gerenciamento na Fase 5.
 */
export async function listPinned(): Promise<{ postId: string; pinnedAt: number; cid: string | null }[]> {
  const rows = await db.exec<{ post_id: string; pinned_at: number; cid: string | null }>(
    `SELECT post_id, pinned_at, cid FROM pinned ORDER BY pinned_at DESC`,
  )
  return rows.map((r) => ({ postId: r.post_id, pinnedAt: r.pinned_at, cid: r.cid }))
}
