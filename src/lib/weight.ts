/**
 * Sistema de peso de perfil — funções puras, determinísticas.
 *
 * Manifesto §22 (Score Determinístico, Não Reputação Subjetiva):
 *  - Mesma fórmula em todos os clientes Drift
 *  - Inputs são eventos públicos verificáveis (created_at, spreads,
 *    reports confirmados, last_active)
 *  - Não há "afinidade pessoal" — peso é objetivo
 *
 * Arquitetura §9.
 *
 * Componentes do peso (0..100):
 *
 *   weight = antiquity (0..40) + engagement (0..60)
 *
 *   antiquity = min(40, semanas-desde-criação)
 *   engagement = soma_pontos clamp(0, 60), onde:
 *     POST_SPREAD       +10   (alguém espalhou um post seu)
 *     COMMENT_RECEIVED  +1    (Fase 5 — quando comentários entrarem)
 *     POST_BURIED        0    (bury NÃO penaliza — manifesto §23)
 *     REPORT_CONFIRMED -15    (report passou no threshold)
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
  /** Timestamp de criação da identidade (ms — vem do `identity.createdAt`). */
  createdAt: number
  /** Total de spreads recebidos pelos posts deste autor. */
  spreadsReceived: number
  /** Comentários recebidos (Fase 5+). Default 0. */
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
 * Soma ponderada de eventos públicos. Negativos (reports confirmados,
 * inatividade) descontam. Saturação em 60 — ninguém vira "rei
 * permanente do feed" só por ter espalhamento muito alto.
 */
export function calculateEngagement(input: WeightInput): number {
  const spreadPoints = input.spreadsReceived * ENGAGEMENT_POINTS.POST_SPREAD
  const commentPoints =
    (input.commentsReceived ?? 0) * ENGAGEMENT_POINTS.COMMENT_RECEIVED
  const reportPenalty =
    (input.reportsConfirmed ?? 0) * ENGAGEMENT_POINTS.REPORT_CONFIRMED // negativo
  const inactivityPenalty = inactivityDays(input.lastActive, input.now) * ENGAGEMENT_POINTS.DAILY_INACTIVE // negativo

  const raw = spreadPoints + commentPoints + reportPenalty + inactivityPenalty
  return Math.max(0, Math.min(DRIFT_LIMITS.ENGAGEMENT_MAX, raw))
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

// ─── Bridge SQLite (lê estado do banco, monta WeightInput, aplica
//     funções puras) ────────────────────────────────────────────────

interface UserAggregateRow {
  created_at: number
  last_active: number | null
  spreads_received: number
  reports_confirmed: number
}

/**
 * Lê o estado atual do banco pra um npub e calcula peso/engagement/maxSubposts.
 *
 * Cada chamada faz 1 query consolidada (sub-selects). Idempotente do
 * lado do SQL — sem effects.
 *
 * **Determinismo:** o resultado depende SÓ do estado atual do banco +
 * `now`. Mesma entrada → mesma saída. Os valores no banco vêm de
 * eventos Nostr verificados (manifesto §7 + §22).
 *
 * Convenções de unidade: timestamps em **unix seconds** no SQLite (vêm
 * de `event.created_at`); `now` aqui é em **ms** (consistente com
 * `weight.ts` puro). A função adapta — ver função `inferIdentityCreatedMs`.
 *
 * @param npub - Identidade Drift (hex pubkey, NÃO bech32)
 * @param now - Agora em ms (passado por parâmetro pra teste/determinismo)
 * @returns Pesos calculados + max subposts permitidos. Se o user não
 *   existe no banco (sem atividade conhecida), retorna peso 0 e
 *   maxSubposts = 1 (identidade nova-do-zero).
 */
export async function calculateUserWeight(
  npub: string,
  now: number,
): Promise<{ weight: number; engagement: number; antiquity: number; maxSubposts: number }> {
  const row = await db.get<UserAggregateRow>(
    `SELECT
       u.created_at AS created_at,
       u.last_active AS last_active,
       (SELECT COUNT(*) FROM spreads s
          INNER JOIN posts p ON p.id = s.post_id
          WHERE p.author_pub = ?) AS spreads_received,
       (SELECT COUNT(*) FROM posts WHERE author_pub = ? AND score = -999) AS reports_confirmed
     FROM users u
     WHERE u.npub = ?`,
    [npub, npub, npub],
  )

  if (!row) {
    // Sem registro: identidade nova ou desconhecida pelo cliente.
    return { weight: 0, engagement: 0, antiquity: 0, maxSubposts: 1 }
  }

  const createdAtMs = inferIdentityCreatedMs(row.created_at, row.last_active, now)
  const input: WeightInput = {
    createdAt: createdAtMs,
    spreadsReceived: row.spreads_received,
    reportsConfirmed: row.reports_confirmed,
    lastActive: row.last_active !== null ? row.last_active * 1000 : null,
    now,
  }

  const antiquity = calculateAntiquity(input.createdAt, input.now)
  const engagement = calculateEngagement(input)
  const weight = Math.min(DRIFT_LIMITS.WEIGHT_MAX, antiquity + engagement)
  return { weight, engagement, antiquity, maxSubposts: getMaxSubposts(weight) }
}

/**
 * `users.created_at` no SQLite é "first seen by this client" em unix
 * seconds. Convertemos pra ms. Se for futuro (clock skew), aceita —
 * `calculateAntiquity` clampa em 0.
 *
 * Edge case: row existe mas ninguém atualizou `last_active` (reports
 * de outros sobre este post sem evento próprio do autor) — usa o
 * created_at sozinho.
 */
function inferIdentityCreatedMs(
  createdAtSec: number,
  _lastActiveSec: number | null,
  _now: number,
): number {
  return createdAtSec * 1000
}
