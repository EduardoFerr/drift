/**
 * Moderação Comunitária Reativa — manifesto §26.
 *
 * Cliente oficial NÃO escaneia conteúdo automaticamente (manifesto §25).
 * Conteúdo problemático é moderado pela comunidade via reports
 * (kind 9081). Quando o peso acumulado dos reports supera um threshold
 * dinâmico, o post recebe `score = -999` localmente e some do feed
 * default — MAS continua nos relays e no SQLite local (manifesto §10
 * + invariante #13 do CLAUDE.md). Cliente alternativo pode exibir.
 *
 * Tudo aqui é função pura/determinística — manifesto §7.
 *
 *
 * ─── Threshold dinâmico ──────────────────────────────────────────────
 *
 * Quanto maior a base ativa, mais reports são necessários. Evita brigada
 * de poucos usuários derrubando posts em comunidade pequena.
 *
 *   threshold = max(5, floor(0.1% da base ativa))
 *
 *   base ativa = users com `last_active` dentro dos últimos 30 dias
 *
 *
 * ─── Peso do reporter ────────────────────────────────────────────────
 *
 * Um report de identidade nova vale menos que de identidade estabelecida.
 * Defesa anti-sybil sem confiar em prova de identidade.
 *
 *   peso < 20  → 0.5  (identidade nova/sem engajamento)
 *   peso < 50  → 1.0  (identidade ativa estabelecida)
 *   peso < 75  → 1.5  (identidade ativa de longa data)
 *   peso ≥ 75  → 2.0  (identidade veterana muito engajada)
 *
 *
 * ─── Categoria 'illegal' acelera ─────────────────────────────────────
 *
 * Reports com `reason='illegal'` aplicam multiplicador 2x no threshold
 * efetivo — a comunidade defende a si mesma rapidamente de conteúdo
 * crime. Manifesto §26.
 *
 * Não é poder do fundador (não há override unilateral). É a comunidade
 * priorizando uma categoria que ela própria classificou.
 */

import { db } from './db'
import { invalidateFeed } from './feed'
import type { ReportReason } from '../types/drift'
import { MS_PER_DAY_30 } from '../config/constants'

// ─── Tipos ───────────────────────────────────────────────────────────

export interface ReportRecord {
  postId: string
  reporterPub: string
  reason: ReportReason
  reporterWeight: number
  createdAt: number
}

// ─── Funções puras ───────────────────────────────────────────────────

/**
 * Peso aplicado a um report baseado no peso do reporter (anti-sybil).
 *
 * @param reporterWeight - Peso da identidade (0..100), de `weight.ts`
 * @returns Multiplicador a ser somado ao total de reports do post
 */
export function getReportWeight(reporterWeight: number): number {
  if (reporterWeight < 20) return 0.5
  if (reporterWeight < 50) return 1.0
  if (reporterWeight < 75) return 1.5
  return 2.0
}

/**
 * Threshold de reports a partir do qual um post é considerado moderado.
 *
 * Função pura: depende só do tamanho da base ativa e da categoria.
 *
 * @param activeUsers - Número de identidades ativas (≤30 dias)
 * @param reason - Categoria do report; 'illegal' tem threshold 2x menor
 * @returns Soma mínima de pesos de reports pra moderação automática
 */
export function getReportThreshold(activeUsers: number, reason: ReportReason): number {
  const base = Math.max(5, Math.floor(activeUsers * 0.001))
  if (reason === 'illegal') return Math.max(3, Math.floor(base / 2))
  return base
}

// ─── Integração com SQLite (impuro — usa db.ts) ──────────────────────

/**
 * Conta usuários ativos nos últimos 30 dias. Base do threshold dinâmico.
 *
 * Impuro porque consulta SQLite. A função pura é `getReportThreshold`;
 * esta é só o "leitor" do estado atual.
 */
export async function countActiveUsers(now: number): Promise<number> {
  const cutoff = Math.floor((now - MS_PER_DAY_30) / 1000)
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WHERE last_active IS NOT NULL AND last_active > ?`,
    [cutoff],
  )
  return row?.n ?? 0
}

/**
 * Soma o peso de todos os reports de um post, agrupado por reason.
 *
 * Reports são agregados localmente — cada cliente computa seu próprio
 * total a partir dos events kind 9081 que recebeu. Determinismo: dada
 * a mesma rede de eventos, todos os clientes chegam ao mesmo total.
 */
export async function aggregateReports(
  postId: string,
): Promise<{ totalWeight: number; byReason: Record<ReportReason, number> }> {
  const rows = await db.exec<{
    reason: ReportReason
    weight: number
  }>(
    `SELECT reason, weight FROM reports WHERE post_id = ?`,
    [postId],
  )
  const byReason: Record<ReportReason, number> = {
    illegal: 0,
    spam: 0,
    harassment: 0,
  }
  let totalWeight = 0
  for (const row of rows) {
    if (row.reason in byReason) {
      byReason[row.reason] += row.weight
      totalWeight += row.weight
    }
  }
  return { totalWeight, byReason }
}

/**
 * Aplica moderação se o threshold foi atingido.
 *
 * Chamado por `events.ts:persistReport` depois de inserir um novo
 * report. Idempotente — chamadas repetidas no mesmo post com mesmos
 * dados não duplicam efeito.
 *
 * Quando moderado:
 *   - `posts.score` vira -999 (esconde do feed default — query usa
 *     `WHERE score > -999`)
 *   - O evento POST permanece no banco e nos relays (manifesto §16,
 *     invariante #13)
 *   - Cliente alternativo pode exibir mesmo assim — feature, não bug
 *
 * @param postId - event.id hex 64 do post (NIP-01)
 * @param now - Agora (ms) — passado pra teste/determinismo
 */
export async function maybeModerate(postId: string, now: number): Promise<void> {
  const { totalWeight, byReason } = await aggregateReports(postId)

  const activeUsers = await countActiveUsers(now)

  // Verifica cada categoria contra seu threshold próprio. Se qualquer
  // uma passar, modera. 'illegal' tem threshold mais agressivo.
  const reasons: ReportReason[] = ['illegal', 'spam', 'harassment']
  for (const reason of reasons) {
    const t = getReportThreshold(activeUsers, reason)
    if (byReason[reason] >= t) {
      await db.run(`UPDATE posts SET score = -999 WHERE id = ?`, [postId])
      // Invariante #1 (CLAUDE.md): UPDATE em domínio fora de
      // `events.ts:onNostrEvent` é exceção autorizada (eviction +
      // moderação), MAS exige `invalidateFeed()` pra que UI reflita.
      // Sem isso, post fica `score: -999` no banco mas o store
      // `useFeedStore` só atualiza quando próximo evento chegar.
      invalidateFeed()
      return
    }
  }

  // Threshold combinado (qualquer mistura de razões) — mais conservador.
  const combinedThreshold = getReportThreshold(activeUsers, 'spam')
  if (totalWeight >= combinedThreshold) {
    await db.run(`UPDATE posts SET score = -999 WHERE id = ?`, [postId])
    invalidateFeed()
  }
}
