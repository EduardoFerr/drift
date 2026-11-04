/**
 * Motor de ranking canônico — pesos, scores e moderação a partir do
 * CONJUNTO de eventos. Função pura: sem db, sem `Date.now()`.
 *
 * Origem: auditoria 2026-11-03 (`Docs/auditoria-algoritmo-2026-11.md`).
 * O pipeline anterior recalculava um post por vez, com pesos lidos no
 * instante do recálculo, e gravava moderação como estado mutável. Isso
 * produzia quatro classes de defeito que nenhum teste de função pura
 * alcançava:
 *
 *  1. Ordem-dependência — o mesmo conjunto de eventos dava scores
 *     diferentes conforme a ordem de chegada (§7 quebrado).
 *  2. Peso congelado — o peso de um spreader usado no score era o do
 *     último recálculo daquele post, não o atual.
 *  3. Lavagem Sybil — `spreads_received` contava EVENTOS, sem ponderar
 *     quem espalhou: 6 chaves recém-criadas davam peso 60 a qualquer um.
 *  4. Moderação sobrescrita — o `-999` gravado por report era apagado
 *     pelo próximo recálculo de score (spread novo ou debounce atrasado).
 *
 * Aqui tudo é DERIVADO de uma vez, de forma que mesma entrada → mesma
 * saída, independentemente de ordem, histórico de recálculos ou de quem
 * chegou primeiro:
 *
 *   epoch     = início do dia UTC de `nowMs` (pesos mudam 1×/dia, todos os
 *               clientes no mesmo dia concordam)
 *   antiq(x)  = semanas desde a âncora OpenTimestamps de x (0 sem âncora)
 *   w(x)      = min(100, antiq(x) + clamp(0, 60,
 *                 10 · Σ_spreads w(spreader)/100
 *               +  1 · Σ_comments w(commenter)/100
 *               − 15 · posts moderados de x
 *               −  1 · dias inativo))
 *
 * `w` aparece dos dois lados: é o MENOR ponto fixo ≥ antiq, obtido por
 * iteração de Jacobi a partir de `w₀ = antiq`. A sequência é monótona
 * (engajamento só cresce com pesos maiores) e limitada por 100, então
 * converge. Consequência anti-Sybil: um anel de chaves sem âncora parte
 * de 0, e 0 espalhando 0 continua 0 — só tempo real ancorado no Bitcoin
 * (ou o spread de quem já tem peso) cria peso.
 *
 * Moderação depende dos pesos (pontos de report = w/50) e os pesos
 * dependem da moderação (−15 por post moderado). Laço externo: parte de
 * "nada moderado", alterna pesos ↔ moderação até estabilizar (cap 8).
 * Determinístico porque sempre parte do mesmo estado inicial.
 */

import {
  COMMENTS_SCORE_CAP,
  ENGAGEMENT_POINTS,
  MODERATED_SCORE,
  MS_PER_DAY,
  MS_PER_DAY_30,
} from '../config/constants'
import type { ReportReason } from '../types/drift'
import { calculateScore, scoreNumerator } from './scoring'
import { calculateAntiquity, calculateWeight } from './weight'
import {
  calculateEffectiveReportWeight,
  getReportThreshold,
  getReportWeight,
} from './moderation'

// ─── Tipos ───────────────────────────────────────────────────────────

export interface RankingPost {
  id: string
  author_pub: string
  /** unix seconds */
  created_at: number
}

export interface RankingAction {
  post_id: string
  user_pub: string
  /** unix seconds */
  created_at: number
  /** Tie-break determinístico quando dois eventos têm o mesmo created_at. */
  event_id: string
}

export interface RankingComment {
  post_id: string
  author_pub: string
  /** Comentário moderado (`comments.score = -999`) não conta. */
  hidden: boolean
}

export interface RankingReport {
  post_id: string
  reporter_pub: string
  reason: ReportReason
  /** unix seconds */
  created_at: number
}

export interface RankingUser {
  npub: string
  /** unix seconds; null = sem atividade conhecida */
  last_active: number | null
}

export interface RankingInput {
  /** Agora (ms). Pesos usam o início do dia UTC; o score materializado usa o instante. */
  nowMs: number
  posts: readonly RankingPost[]
  spreads: readonly RankingAction[]
  buries: readonly RankingAction[]
  comments: readonly RankingComment[]
  reports: readonly RankingReport[]
  users: readonly RankingUser[]
  /** npub → unix seconds do bloco Bitcoin mais antigo que ancora um evento dele. */
  anchors: ReadonlyMap<string, number>
  moderation?: {
    /** `UserPrefs.report_threshold_override` (soberania local). */
    thresholdOverride?: number
    /** Meia-vida do decay de reports quando `report_decay_enabled`. */
    reportDecayHalfLifeMs?: number
  }
}

export interface RankedPost {
  /** Numerador do score, sem decay. É o que o feed ordena (decay na leitura). */
  scoreBase: number
  /** Score com decay no instante `nowMs`, ou `MODERATED_SCORE` se moderado. */
  score: number
  /** Pessoas cuja ação líquida é spread (UI). */
  spreads: number
  /** Pessoas cuja ação líquida é bury (UI). */
  buries: number
  moderated: boolean
}

export interface RankingOutput {
  /** Início do dia UTC usado pros pesos. */
  epochMs: number
  weights: Map<string, number>
  /** Componente de antiguidade (0..40) de cada peso; engajamento = peso − antiguidade. */
  antiquity: Map<string, number>
  posts: Map<string, RankedPost>
  activeUsers: number
}

/** Ações por (post, user) em que só a mais recente conta (§23). */
export interface ActionRow {
  kind: 'spread' | 'bury'
  user_pub: string
  created_at: number
  /** Opcional por compat; quando presente desempata created_at iguais. */
  event_id?: string
}

const WEIGHT_EPSILON = 1e-9
const MAX_WEIGHT_ITERATIONS = 500
const MAX_MODERATION_ROUNDS = 8
/**
 * Score materializado de post NÃO moderado nunca chega ao sentinela.
 * Sem este piso, uma brigada de bury pesada (numerador ≲ −2828) cruzava
 * `-999` e o post sumia como se tivesse sido moderado, sem nenhum report.
 */
const UNMODERATED_SCORE_FLOOR = MODERATED_SCORE + 1

// ─── Peças puras ─────────────────────────────────────────────────────

/** Início do dia UTC. Pesos só mudam na virada do dia → convergência intradiária. */
export function weightEpoch(nowMs: number): number {
  return Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY
}

/**
 * Ação líquida (mais recente) de cada user. Empate de `created_at`:
 * `'bury'` vence (lex ASC); persistindo o empate, menor `event_id`.
 * Independente da ordem do array — ver testes de permutação.
 */
export function selectLatestActionByUser(
  actions: readonly ActionRow[],
): Map<string, 'spread' | 'bury'> {
  const best = new Map<string, ActionRow>()
  for (const row of actions) {
    const prev = best.get(row.user_pub)
    if (!prev || isNewer(row, prev)) best.set(row.user_pub, row)
  }
  const out = new Map<string, 'spread' | 'bury'>()
  for (const [user, row] of best) out.set(user, row.kind)
  return out
}

function isNewer(a: ActionRow, b: ActionRow): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at
  if (a.kind !== b.kind) return a.kind < b.kind
  return (a.event_id ?? '') < (b.event_id ?? '')
}

function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ─── Motor ───────────────────────────────────────────────────────────

export function computeRanking(input: RankingInput): RankingOutput {
  const epochMs = weightEpoch(input.nowMs)

  // 1. Universo de identidades (ordenado → somas em ordem fixa).
  const lastActive = new Map<string, number | null>()
  for (const u of input.users) lastActive.set(u.npub, u.last_active)
  const universe = new Set<string>(lastActive.keys())
  for (const p of input.posts) universe.add(p.author_pub)
  for (const a of input.spreads) universe.add(a.user_pub)
  for (const a of input.buries) universe.add(a.user_pub)
  for (const c of input.comments) universe.add(c.author_pub)
  for (const r of input.reports) universe.add(r.reporter_pub)
  for (const npub of input.anchors.keys()) universe.add(npub)
  const npubs = [...universe].sort(byKey)

  const postAuthor = new Map<string, string>()
  for (const p of input.posts) postAuthor.set(p.id, p.author_pub)

  // 2. Ação líquida por post (exclui o próprio autor — auto-promoção).
  const actionsByPost = new Map<string, ActionRow[]>()
  const push = (postId: string, row: ActionRow) => {
    const author = postAuthor.get(postId)
    if (author === undefined || author === row.user_pub) return
    let arr = actionsByPost.get(postId)
    if (!arr) actionsByPost.set(postId, (arr = []))
    arr.push(row)
  }
  for (const s of input.spreads)
    push(s.post_id, { kind: 'spread', user_pub: s.user_pub, created_at: s.created_at, event_id: s.event_id })
  for (const b of input.buries)
    push(b.post_id, { kind: 'bury', user_pub: b.user_pub, created_at: b.created_at, event_id: b.event_id })

  const netByPost = new Map<string, { spreaders: string[]; buriers: string[] }>()
  for (const [postId, rows] of actionsByPost) {
    const spreaders: string[] = []
    const buriers: string[] = []
    for (const [user, kind] of selectLatestActionByUser(rows)) {
      ;(kind === 'spread' ? spreaders : buriers).push(user)
    }
    spreaders.sort(byKey)
    buriers.sort(byKey)
    netByPost.set(postId, { spreaders, buriers })
  }

  // 3. Commenters distintos por post (sem o autor, sem moderados).
  const commentersByPost = new Map<string, string[]>()
  {
    const sets = new Map<string, Set<string>>()
    for (const c of input.comments) {
      const author = postAuthor.get(c.post_id)
      if (author === undefined || c.hidden || c.author_pub === author) continue
      let set = sets.get(c.post_id)
      if (!set) sets.set(c.post_id, (set = new Set()))
      set.add(c.author_pub)
    }
    for (const [postId, set] of sets) commentersByPost.set(postId, [...set].sort(byKey))
  }

  // 4. Arestas de engajamento recebido, por autor (multiplicidade: 1
  //    por post espalhado/comentado — mesma unidade do antigo COUNT).
  const spreadEdges = new Map<string, string[]>()
  const commentEdges = new Map<string, string[]>()
  for (const p of input.posts) {
    const net = netByPost.get(p.id)
    if (net && net.spreaders.length > 0) {
      let arr = spreadEdges.get(p.author_pub)
      if (!arr) spreadEdges.set(p.author_pub, (arr = []))
      arr.push(...net.spreaders)
    }
    const cs = commentersByPost.get(p.id)
    if (cs && cs.length > 0) {
      let arr = commentEdges.get(p.author_pub)
      if (!arr) commentEdges.set(p.author_pub, (arr = []))
      arr.push(...cs)
    }
  }
  for (const arr of spreadEdges.values()) arr.sort(byKey)
  for (const arr of commentEdges.values()) arr.sort(byKey)

  const postsByAuthor = new Map<string, string[]>()
  for (const p of input.posts) {
    let arr = postsByAuthor.get(p.author_pub)
    if (!arr) postsByAuthor.set(p.author_pub, (arr = []))
    arr.push(p.id)
  }

  // 5. Reports por post (sem auto-report).
  const reportsByPost = new Map<string, RankingReport[]>()
  for (const r of input.reports) {
    const author = postAuthor.get(r.post_id)
    if (author === undefined || author === r.reporter_pub) continue
    let arr = reportsByPost.get(r.post_id)
    if (!arr) reportsByPost.set(r.post_id, (arr = []))
    arr.push(r)
  }
  for (const arr of reportsByPost.values()) arr.sort((a, b) => byKey(a.reporter_pub, b.reporter_pub))

  const cutoffSec = Math.floor((epochMs - MS_PER_DAY_30) / 1000)
  let activeUsers = 0
  for (const la of lastActive.values()) if (la !== null && la > cutoffSec) activeUsers++

  // 6. Laço externo moderação ↔ pesos.
  let moderated = new Set<string>()
  let { weights, antiquity } = solveWeights(npubs, input.anchors, lastActive, spreadEdges, commentEdges, postsByAuthor, moderated, epochMs)
  for (let round = 0; round < MAX_MODERATION_ROUNDS; round++) {
    const next = decideModeration(reportsByPost, weights, activeUsers, epochMs, input.moderation)
    if (sameSet(next, moderated)) break
    moderated = next
    ;({ weights, antiquity } = solveWeights(npubs, input.anchors, lastActive, spreadEdges, commentEdges, postsByAuthor, moderated, epochMs))
  }

  // 7. Scores.
  const nowSec = Math.floor(input.nowMs / 1000)
  const posts = new Map<string, RankedPost>()
  for (const p of input.posts) {
    const net = netByPost.get(p.id)
    let spreadWeight = 0
    let buryWeight = 0
    for (const u of net?.spreaders ?? []) spreadWeight += weights.get(u) ?? 0
    for (const u of net?.buriers ?? []) buryWeight += weights.get(u) ?? 0
    let commentWeight = 0
    for (const u of commentersByPost.get(p.id) ?? []) commentWeight += weights.get(u) ?? 0
    const scoreBase =
      scoreNumerator(spreadWeight, buryWeight) +
      Math.min(commentWeight, COMMENTS_SCORE_CAP) * ENGAGEMENT_POINTS.COMMENT_RECEIVED
    const isModerated = moderated.has(p.id)
    const decayed = scoreBase / scoreDivisorAt(p.created_at, nowSec)
    posts.set(p.id, {
      scoreBase,
      score: isModerated ? MODERATED_SCORE : Math.max(UNMODERATED_SCORE_FLOOR, decayed),
      spreads: net?.spreaders.length ?? 0,
      buries: net?.buriers.length ?? 0,
      moderated: isModerated,
    })
  }

  return { epochMs, weights, antiquity, posts, activeUsers }
}

/** Divisor de decay via `calculateScore` (fonte única do +2 / 1.5 / clamp). */
function scoreDivisorAt(createdAt: number, nowSec: number): number {
  return 1 / calculateScore({ spreadWeight: 1, buryWeight: 0, createdAt, now: nowSec })
}

function solveWeights(
  npubs: readonly string[],
  anchors: ReadonlyMap<string, number>,
  lastActive: ReadonlyMap<string, number | null>,
  spreadEdges: ReadonlyMap<string, readonly string[]>,
  commentEdges: ReadonlyMap<string, readonly string[]>,
  postsByAuthor: ReadonlyMap<string, readonly string[]>,
  moderated: ReadonlySet<string>,
  epochMs: number,
): { weights: Map<string, number>; antiquity: Map<string, number> } {
  const fixed = new Map<string, { createdAt: number; lastActive: number | null; reports: number }>()
  for (const npub of npubs) {
    const anchorSec = anchors.get(npub)
    const la = lastActive.get(npub) ?? null
    let reports = 0
    for (const id of postsByAuthor.get(npub) ?? []) if (moderated.has(id)) reports++
    fixed.set(npub, {
      // Sem âncora → createdAt = epoch → antiguidade 0.
      createdAt: anchorSec !== undefined && Number.isFinite(anchorSec) ? anchorSec * 1000 : epochMs,
      lastActive: la !== null ? la * 1000 : null,
      reports,
    })
  }

  const evaluate = (npub: string, w: ReadonlyMap<string, number>): number => {
    const f = fixed.get(npub)!
    let spreads = 0
    for (const s of spreadEdges.get(npub) ?? []) spreads += (w.get(s) ?? 0) / 100
    let comments = 0
    for (const c of commentEdges.get(npub) ?? []) comments += (w.get(c) ?? 0) / 100
    return calculateWeight({
      createdAt: f.createdAt,
      spreadsReceived: spreads,
      commentsReceived: comments,
      reportsConfirmed: f.reports,
      lastActive: f.lastActive,
      now: epochMs,
    })
  }

  // w₀ = antiguidade pura. Como o engajamento é clampado em ≥ 0,
  // evaluate(w₀) ≥ w₀ e a sequência é monótona não-decrescente.
  const antiquity = new Map<string, number>()
  for (const npub of npubs) antiquity.set(npub, calculateAntiquity(fixed.get(npub)!.createdAt, epochMs))
  let w = new Map<string, number>(antiquity)
  for (let i = 0; i < MAX_WEIGHT_ITERATIONS; i++) {
    const next = new Map<string, number>()
    let delta = 0
    for (const npub of npubs) {
      const v = evaluate(npub, w)
      next.set(npub, v)
      delta = Math.max(delta, Math.abs(v - (w.get(npub) ?? 0)))
    }
    w = next
    if (delta < WEIGHT_EPSILON) break
  }
  return { weights: w, antiquity }
}

function decideModeration(
  reportsByPost: ReadonlyMap<string, readonly RankingReport[]>,
  weights: ReadonlyMap<string, number>,
  activeUsers: number,
  epochMs: number,
  opts: RankingInput['moderation'],
): Set<string> {
  const out = new Set<string>()
  const reasons: ReportReason[] = ['illegal', 'spam', 'harassment']
  for (const [postId, reports] of reportsByPost) {
    const byReason: Record<ReportReason, number> = { illegal: 0, spam: 0, harassment: 0 }
    let total = 0
    for (const r of reports) {
      if (!(r.reason in byReason)) continue
      let pts = getReportWeight(weights.get(r.reporter_pub) ?? 0)
      if (opts?.reportDecayHalfLifeMs) {
        pts = calculateEffectiveReportWeight(pts, epochMs - r.created_at * 1000, opts.reportDecayHalfLifeMs)
      }
      byReason[r.reason] += pts
      total += pts
    }
    const hit =
      reasons.some((reason) => byReason[reason] >= getReportThreshold(activeUsers, reason, opts?.thresholdOverride)) ||
      total >= getReportThreshold(activeUsers, 'spam', opts?.thresholdOverride)
    if (hit) out.add(postId)
  }
  return out
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}
