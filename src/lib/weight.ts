/**
 * Sistema de peso de perfil — funções puras, determinísticas.
 *
 * Manifesto §22 (Score Determinístico, Não Reputação Subjetiva):
 *  - Mesma fórmula em todos os clientes Drift
 *  - Inputs são eventos públicos verificáveis (âncora OpenTimestamps,
 *    spreads/comentários recebidos, posts moderados, last_active)
 *  - Não há "afinidade pessoal" — peso é objetivo
 *
 * Arquitetura §9. O cálculo GLOBAL (ponto fixo, quem pondera quem) vive
 * em `ranking.ts`; aqui ficam as fórmulas por identidade.
 *
 * Componentes do peso (0..100):
 *
 *   weight = antiquity (0..40) + engagement (0..60)
 *
 *   antiquity = min(40, semanas desde a âncora OTS)   — `createdAt` = bloco
 *               Bitcoin; sem âncora o caller passa createdAt = now → 0
 *   engagement = soma_pontos clamp(0, 60), onde (ranking.ts passa as
 *   contagens JÁ PONDERADAS por peso/100 de quem deu):
 *     POST_SPREAD       +10   × Σ w(spreader)/100
 *     COMMENT_RECEIVED  +1    × Σ w(commenter)/100
 *     POST_BURIED        0    (bury NÃO penaliza — manifesto §23)
 *     REPORT_CONFIRMED -15    por post próprio moderado
 *     DAILY_INACTIVE    -1    (por dia sem atividade)
 *
 * Determinismo: TODAS as funções aqui recebem `now` por parâmetro. Sem
 * `Date.now()` implícito. Mesma entrada → mesma saída sempre — testável
 * em isolamento, debugável, idêntico entre clientes.
 *
 * `getMaxSubposts(weight)` define quantos subposts cada autor pode
 * publicar. Fase 3 limita pra 1 (sempre); Fase 4 ativa esta tabela.
 */

import { DRIFT_LIMITS, ENGAGEMENT_POINTS, MS_PER_DAY, MS_PER_WEEK } from '../config/constants'
import { db } from './db'

export interface WeightInput {
  /** Âncora de antiguidade (ms): bloco Bitcoin da prova OTS mais antiga. */
  createdAt: number
  /** Spreads recebidos, já ponderados: Σ weight(spreader)/100. */
  spreadsReceived: number
  /** Comentários recebidos, já ponderados: Σ weight(commenter)/100. Default 0. */
  commentsReceived?: number
  /** Reports confirmados (passaram no threshold). Default 0. */
  reportsConfirmed?: number
  /** Última atividade (ms — qualquer evento Drift assinado). null = sem atividade conhecida. */
  lastActive: number | null
  /** Agora — passado por parâmetro pra manter determinismo. */
  now: number
}

/**
 * Antiguidade da identidade em "pontos de peso" (0..40).
 *
 * Cresce 1 ponto por semana até saturar em 40 (≈ 9 meses). Fórmula linear
 * intencional — recompensa estar na rede, não exponencialmente.
 */
export function calculateAntiquity(createdAt: number, now: number): number {
  if (now < createdAt) return 0
  const weeks = (now - createdAt) / MS_PER_WEEK
  return Math.max(0, Math.min(DRIFT_LIMITS.ANTIQUITY_MAX, weeks))
}

/**
 * Engajamento da identidade em "pontos de peso" (0..60, clamp).
 *
 * Soma ponderada de eventos públicos, saturada em 60 — ninguém vira
 * "rei permanente do feed" só por ter espalhamento muito alto. Os
 * negativos (reports confirmados, inatividade) descontam DEPOIS da
 * saturação, então sempre mordem.
 */
export function calculateEngagement(input: WeightInput): number {
  const spreadPoints = input.spreadsReceived * ENGAGEMENT_POINTS.POST_SPREAD
  const commentPoints =
    (input.commentsReceived ?? 0) * ENGAGEMENT_POINTS.COMMENT_RECEIVED
  const reportPenalty =
    (input.reportsConfirmed ?? 0) * ENGAGEMENT_POINTS.REPORT_CONFIRMED // negativo
  const inactivityPenalty = inactivityDays(input.lastActive, input.now) * ENGAGEMENT_POINTS.DAILY_INACTIVE // negativo

  // Penalidades DEPOIS do teto do positivo (auditoria 2026-11-03, F2).
  // Antes era clamp(positivo + penalidades): quem tinha engajamento bruto
  // muito acima de 60 (anel de Sybil, ou veterano muito espalhado) ficava
  // imune a moderação e inatividade — o −15 sumia dentro do excesso.
  const positive = Math.min(DRIFT_LIMITS.ENGAGEMENT_MAX, spreadPoints + commentPoints)
  return Math.max(0, positive + reportPenalty + inactivityPenalty)
}

/**
 * Peso total da identidade (0..100). Soma de antiguidade (0..40) +
 * engajamento (0..60).
 */
export function calculateWeight(input: WeightInput): number {
  const antiquity = calculateAntiquity(input.createdAt, input.now)
  const engagement = calculateEngagement(input)
  return Math.min(DRIFT_LIMITS.WEIGHT_MAX, antiquity + engagement)
}

/**
 * Tier de peso pra exibição UI — sinal social, NÃO filtro.
 *
 * Manifesto §22 (transparência): algoritmo é legível, mas user não
 * deveria competir/gamificar números exatos. Tier é discreto: 4 níveis,
 * baseados nos thresholds já usados em `getMaxSubposts`.
 *
 * Manifesto §11 (sem afinidade): UI **não pode** virar filtro
 * "só posts com weight ≥ X" — isso é afinidade no feed. Badge é
 * exibição passiva no perfil, não propriedade que altera ranking.
 *
 * Tiers:
 *   weight ≥ 60   →  'established'  ('🏆 estabelecido', amber)
 *   weight ≥ 40   →  'active'       ('⭐ ativo', slate)
 *   weight ≥ 20   →  'new'          ('🌱 novo', green)
 *   weight < 20   →  null           (sem badge — identidade fresca,
 *                                    não envergonha)
 *
 * Função pura, determinística, testável.
 */
export type WeightTier = 'established' | 'active' | 'new'

export function getWeightTier(weight: number): WeightTier | null {
  if (weight >= 60) return 'established'
  if (weight >= 40) return 'active'
  if (weight >= 20) return 'new'
  return null
}

/**
 * Quantos subposts cada autor pode publicar em um POST.
 *
 * Defesa anti-spam baseada em peso (manifesto §33 — anti-spam pela
 * mecânica social, não PoW). Identidade nova começa com 1; cresce
 * conforme acumula peso.
 *
 * Tabela:
 *   peso < 20  →  1
 *   peso < 40  →  2
 *   peso < 55  →  4
 *   peso < 70  →  6
 *   peso < 85  →  7
 *   peso ≥ 85  →  8 (DRIFT_LIMITS.MAX_SUBPOSTS_ABS)
 *
 * Cliente oficial respeita; clientes alternativos podem flexibilizar.
 * Eventos com mais subposts que o autorizado seriam reportáveis como
 * spam (manifesto §26).
 *
 * @param weight - Peso da identidade (0..100)
 * @returns Número máximo de subposts permitidos (1..8)
 */
export function getMaxSubposts(weight: number): number {
  if (weight < 20) return 1
  if (weight < 40) return 2
  if (weight < 55) return 4
  if (weight < 70) return 6
  if (weight < 85) return 7
  return DRIFT_LIMITS.MAX_SUBPOSTS_ABS
}

// ─── Helpers ─────────────────────────────────────────────────────────

function inactivityDays(lastActive: number | null, now: number): number {
  if (lastActive === null) return 0
  if (now <= lastActive) return 0
  return Math.floor((now - lastActive) / MS_PER_DAY)
}

// ─── Bridge SQLite ───────────────────────────────────────────────────
//
// O peso NÃO é mais calculado por user isolado. Ele depende do peso de
// quem espalhou (ponto fixo global, `ranking.ts`) e da âncora
// OpenTimestamps, então só existe como resultado da recomputação global
// (`events.ts:recalcAllScores`), materializado em `users.weight`. Esta
// bridge apenas lê esse valor.
//
// Antes, cada caller recomputava a partir de `users.created_at` ("first
// seen by this client", forjável via created_at retroativo) e de um
// COUNT de spreads sem ponderação — as duas raízes de S1/S2/S3 na
// auditoria 2026-11-03.

/**
 * Peso materializado de um npub + derivados pra UI (tier/maxSubposts).
 *
 * @param npub - hex pubkey
 * @param _now - mantido por compat de assinatura; o peso já é do dia corrente
 * @returns user desconhecido → peso 0, maxSubposts 1
 */
export async function calculateUserWeight(
  npub: string,
  _now: number,
): Promise<{ weight: number; engagement: number; antiquity: number; maxSubposts: number }> {
  const row = await db.get<{ weight: number | null; engagement: number | null }>(
    `SELECT weight, engagement FROM users WHERE npub = ?`,
    [npub],
  )
  const weight = row?.weight ?? 0
  const engagement = row?.engagement ?? 0
  // weight = antiguidade + engajamento sem saturar (40 + 60 = 100).
  return { weight, engagement, antiquity: weight - engagement, maxSubposts: getMaxSubposts(weight) }
}
