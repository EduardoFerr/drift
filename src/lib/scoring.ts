/**
 * Cálculo de score de post. Função pura — sem side effects, sem
 * leitura de relógio interno (passamos `now` explicitamente).
 *
 * Determinismo: dado o mesmo input, qualquer cliente Drift no mundo
 * chega ao mesmo número. Esta é a base do "algoritmo humano" — não
 * existe ranking secreto, é tudo derivado de eventos públicos.
 *
 * Fórmula:
 *   score = (spreadWeight - buryWeight * 0.3) / (ageHours + 2) ^ 1.5
 *
 * Por quê:
 *  - spreadWeight = SOMA dos pesos dos spreaders (cada spreader
 *    contribui com seu próprio `weight` de identidade Drift, 0..100).
 *    Sybil novo tem weight ~0 → spread vale ~0 (manifesto §22 + §32).
 *  - Buries idem com burier weight, multiplicado por 0.3 — enterro é
 *    julgamento estético, não punição. Reduz menos do que espalhar.
 *  - +2 nos ageHours evita divisão explosiva nos primeiros minutos.
 *  - expoente 1.5 dá decaimento suave; um post fica relevante por
 *    horas, não minutos.
 *
 * **Mudança 2026-04-29** (pré-Fase-6): score deixou de contar EVENTOS
 * (`COUNT(*) FROM spreads`) e passou a somar PESOS dos spreaders/buriers.
 * Justificativa: mitiga Sybil engagement (1000 npubs novos
 * auto-espalhando ≈ peso 0). Manifesto §22 (score determinístico) + §24
 * (sem afinidade — peso é função pura do histórico do pubkey, não do
 * leitor).
 *
 * **Mudança "última ação vale"**: cada (post_id, user_pub) contribui
 * com APENAS sua ação líquida — última cronologicamente entre seus
 * spreads e buries. Implementado em `events.ts:recalculateScore`.
 * Manifesto §23 (mudança de opinião não pune retroativamente).
 */

export interface ScoreInput {
  /** Soma de pesos dos spreaders cuja ação líquida é 'spread'. */
  spreadWeight: number
  /** Soma de pesos dos buriers cuja ação líquida é 'bury'. */
  buryWeight: number
  /** unix seconds (mesmo formato dos eventos Nostr) */
  createdAt: number
  /** unix seconds — passado explicitamente para preservar pureza */
  now: number
}

export function calculateScore(input: ScoreInput): number {
  const { spreadWeight, buryWeight, createdAt, now } = input
  const ageHours = Math.max(0, (now - createdAt) / 3600)
  const netEngagement = spreadWeight - buryWeight * 0.3
  return netEngagement / Math.pow(ageHours + 2, 1.5)
}

/** Conveniência: usa o relógio atual. Use apenas em paths de
 *  materialização (recalculateScore), nunca em testes. */
export function calculateScoreNow(
  spreadWeight: number,
  buryWeight: number,
  createdAt: number,
): number {
  return calculateScore({
    spreadWeight,
    buryWeight,
    createdAt,
    now: Math.floor(Date.now() / 1000),
  })
}

// ─── Comments contribution (Track C.5) ────────────────────────────────
//
// `Docs/comments.md` v0.2 §3.4 + §11 — comments contribuem pro score do
// post recebedor, mas com cap (`COMMENTS_SCORE_CAP`) e ponderação por
// weight do commenter (igual SPREAD; anti-Sybil).
//
// Issue Ted #3 (design-comments.md §15) — **weight semantics**:
//   Optamos por **weight CURRENT** (no momento do recalc), espelhando o
//   pipeline de spreads em `events.ts:recalculateScore` que faz
//   `calculateWeight(...)` no `recalcNow`. Snapshot temporal (weight no
//   `comment.created_at`) seria mais "fiel histórico" mas exigiria
//   armazenar weight historicizado por usuário — complexidade alta sem
//   ganho prático. Trade-off documentado: score se ajusta retroativamente
//   quando commenter ganha weight (efeito chicotada conhecido), mas
//   permanece **determinístico** (mesmo state SQLite → mesmo score em
//   qualquer cliente). Manifesto §7 OK.
//
// Issue Barney HIGH #3 — **exclude self-comments**: autor não pode
// boostar próprio post via auto-comment. Aplicado na query SQL em
// `events.ts:recalculateScore` (`WHERE c.author_pub != p.author_pub`).
// Esta função pura recebe o `weightedTotal` já filtrado.

import { COMMENTS_SCORE_CAP, ENGAGEMENT_POINTS } from '../config/constants'

export interface CommentReceivedInput {
  /**
   * Quantos commenters distinct contribuíram (já dedup por `author_pub`,
   * já excluindo self-comments do autor do post). Mantido no input por
   * legibilidade/debug — não afeta a fórmula diretamente porque a
   * contribuição é função de `weightedTotal` (SUM weight), não de count.
   */
  distinctCommenters: number
  /**
   * SUM dos weights dos commenters distinct (já filtrado contra
   * self-comment). NÃO capped pelo caller — esta função aplica o cap.
   */
  weightedTotal: number
  /** Score base atual do post (resultado de `calculateScore`). */
  currentScore: number
}

/**
 * Adiciona a contribuição de comments ao score base do post.
 *
 * Fórmula:
 *   delta = min(weightedTotal, COMMENTS_SCORE_CAP) * COMMENT_RECEIVED
 *   newScore = currentScore + delta
 *
 * Pura. Sem leitura de relógio, sem db. Manifesto §7.
 */
export function applyCommentReceived(input: CommentReceivedInput): number {
  const capped = Math.min(input.weightedTotal, COMMENTS_SCORE_CAP)
  return input.currentScore + capped * ENGAGEMENT_POINTS.COMMENT_RECEIVED
}
