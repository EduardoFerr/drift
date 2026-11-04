/**
 * Moderação Comunitária Reativa — manifesto §26.
 *
 * Cliente oficial NÃO escaneia conteúdo automaticamente (manifesto §25).
 * Conteúdo problemático é moderado pela comunidade via reports
 * (kind 9081). Quando o peso acumulado dos reports supera um threshold
 * dinâmico, o post recebe `score = -999` localmente e some do feed
 * default — MAS continua nos relays e no SQLite local (manifesto §10
 * + invariante #13). Cliente alternativo pode exibir.
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
 * Pontos de um report = peso do reporter / 50, em [0, 2].
 *
 *   peso   0  → 0.0  (chave sem âncora/engajamento — não modera)
 *   peso  25  → 0.5
 *   peso  50  → 1.0
 *   peso 100  → 2.0
 *
 * Antes havia piso de 0.5 pra peso < 20. Como chave Nostr custa zero,
 * qualquer piso > 0 vira brigada gratuita: 10 chaves recém-criadas
 * derrubavam qualquer post (6 com reason=illegal). Auditoria 2026-11-03,
 * M3. Peso agora exige tempo ancorado no Bitcoin ou spread de quem já
 * tem peso (`ranking.ts`), então report de peso 0 contar 0 é a única
 * escolha consistente com §32.
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

import type { ReportReason } from '../types/drift'

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
  if (!Number.isFinite(reporterWeight)) return 0
  return Math.max(0, Math.min(2, reporterWeight / 50))
}

/**
 * Aplica time-window decay sobre o peso bruto de um report (Gap A
 * insider brigada partial mitigation — Barney devsec 2026-05-21).
 *
 * Fórmula: `reportWeight × 2^(-max(0, ageMs) / halfLifeMs)`
 *
 * Pure function — testável sem db, sem clock implícito. Range output:
 * `(0, reportWeight]` (decay nunca aumenta o peso).
 *
 * Edge cases:
 * - `ageMs < 0` (clock skew futuro) → trata como 0 → decay = 1.0 (full)
 * - `halfLifeMs <= 0` (semantics OFF / defensive) → retorna reportWeight
 * - `ageMs` muito grande (1+ ano) → resultado ~0; report continua
 *   contabilizado mas insignificante. OK pra MVP.
 *
 * **NÃO aplicado por default** em `aggregateReports` — caller passa
 * `opts.decayHalfLifeMs` quando `UserPrefs.report_decay_enabled = true`.
 * Backward compat: sem opts = comportamento bit-exact pré-Gap-A.
 *
 * Trade-off documentado em `known-limitations.md` §5c: defende brigada
 * slow-burn 24-72h mas NÃO ataque flash <1h.
 */
export function calculateEffectiveReportWeight(
  reportWeight: number,
  ageMs: number,
  halfLifeMs: number,
): number {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return reportWeight
  const safeAge = Math.max(0, ageMs)
  if (!Number.isFinite(safeAge)) return reportWeight
  return reportWeight * Math.pow(2, -safeAge / halfLifeMs)
}

/**
 * Threshold de reports a partir do qual um post é considerado moderado.
 *
 * Função pura: depende só do tamanho da base ativa e da categoria.
 *
 * @param activeUsers - Número de identidades ativas (≤30 dias)
 * @param reason - Categoria do report; 'illegal' tem threshold 2x menor
 * @param override - Sovereignty (Marshall NEEDS-FIX C 2026-05-17):
 *   quando passado e ≥ 1, override do cálculo dinâmico. Power user
 *   pode customizar via `UserPrefs.report_threshold_override`.
 *   Mantida pure — leitura da pref fica no caller.
 * @returns Soma mínima de pesos de reports pra moderação automática
 */
export function getReportThreshold(
  activeUsers: number,
  reason: ReportReason,
  override?: number,
): number {
  if (typeof override === 'number' && Number.isInteger(override) && override >= 1) {
    // Override aplica o multiplicador 'illegal' também (semantics
    // consistente — illegal sempre mais agressivo que o configurado).
    if (reason === 'illegal') return Math.max(3, Math.floor(override / 2))
    return override
  }
  const base = Math.max(5, Math.floor(activeUsers * 0.001))
  if (reason === 'illegal') return Math.max(3, Math.floor(base / 2))
  return base
}

// ─── Aplicação ───────────────────────────────────────────────────────
//
// A decisão "este post está moderado?" vive em `ranking.ts:computeRanking`,
// que a deriva do conjunto de reports + pesos a cada recomputação. Antes
// ela era um `UPDATE posts SET score = -999` disparado por report, que o
// recálculo de score seguinte apagava (auditoria 2026-11-03, M1/M2).
