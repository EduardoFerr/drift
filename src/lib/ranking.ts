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

/** Tolerância RELATIVA ao maior peso (a contração converge em ~35 iterações). */
const WEIGHT_EPSILON = 1e-9
const MAX_WEIGHT_ITERATIONS = 200
/**
 * Fração do próprio peso que uma identidade pode distribuir como
 * engajamento. < 1 torna o cálculo uma contração (ver `solveWeights`).
 */
export const ENDORSE_BUDGET = 0.5
const SPREAD_EDGE = 1
const COMMENT_EDGE = 0.1
/** Peso a partir do qual um usuário ativo conta como 1 inteiro na base ativa. */
const ACTIVE_FULL_WEIGHT = 20
/**
 * Peso mínimo pra um DRIFT/SINK/comentário contar no score (revisão
 * pré-merge, A7). Antiguidade custa TEMPO, não custo por chave: 10k chaves
 * de 1 semana somavam spreadWeight 10k contra ~150 de 3 veteranos. Abaixo
 * do mínimo o voto vale 0 — converte "muitas chaves × pouco tempo" em
 * "cada chave × semanas reais". 4 ≈ 1 mês de âncora, ou endosso de quem
 * já tem peso. (Reports têm mínimo próprio, maior: `moderation.ts`.)
 */
export const VOTE_MIN_WEIGHT = 4
/**
 * Antiguidade mínima (semanas de âncora) pra votar/endossar e pra
 * denunciar (revisão pré-merge, A18). Os pisos de PESO sozinhos eram
 * contornáveis por concentração: chaves abaixo do piso ainda endossavam,
 * e 4700 chaves de 1 dia saturavam um "concentrador" em peso 60 —
 * concentradores com tempo real 1 dia moderavam posts. Exigir também
 * antiguidade própria faz cada identidade que age pagar semanas reais.
 */
export const VOTE_MIN_ANTIQUITY_WEEKS = 2
export const REPORT_MIN_ANTIQUITY_WEEKS = 8

function canVote(w: number, antiquityWeeks: number): boolean {
  return w >= VOTE_MIN_WEIGHT && antiquityWeeks >= VOTE_MIN_ANTIQUITY_WEEKS
}
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

  // 4. Arestas de ENDOSSO distintas: s → autor, com peso de aresta
  //    1 se s espalhou (ação líquida) algum post do autor, senão 0.1 se só
  //    comentou. Uma aresta por PAR, não por post: antes, espalhar k posts
  //    do mesmo autor contava k vezes e um único spreader saturava quem
  //    quisesse (auditoria 2026-11-03, revisão F1).
  const edgeKind = new Map<string, Map<string, number>>() // s → (autor → peso da aresta)
  const addEdge = (from: string, to: string, e: number) => {
    let m = edgeKind.get(from)
    if (!m) edgeKind.set(from, (m = new Map()))
    m.set(to, Math.max(m.get(to) ?? 0, e))
  }
  for (const p of input.posts) {
    for (const sp of netByPost.get(p.id)?.spreaders ?? []) addEdge(sp, p.author_pub, SPREAD_EDGE)
    for (const c of commentersByPost.get(p.id) ?? []) addEdge(c, p.author_pub, COMMENT_EDGE)
  }
  const outEdges = new Map<string, { to: string; e: number; share: number }[]>()
  for (const from of [...edgeKind.keys()].sort(byKey)) {
    const m = edgeKind.get(from)!
    const tos = [...m.keys()].sort(byKey)
    let total = 0
    for (const t of tos) total += m.get(t)!
    outEdges.set(
      from,
      tos.map((t) => ({ to: t, e: m.get(t)!, share: m.get(t)! / total })),
    )
  }

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
  const activeNpubs = npubs.filter((n) => {
    const la = lastActive.get(n)
    return la !== null && la !== undefined && la > cutoffSec
  })
  // Base ativa PONDERADA: Σ min(1, peso/20) dos ativos. Antes era COUNT —
  // 10k chaves de peso 0 com 1 evento cada dobravam o threshold e
  // protegiam spam do atacante (revisão F5). Peso total é limitado pelo
  // orçamento conservado, então inflar a base também custa tempo real.
  const weightedActive = (w: ReadonlyMap<string, number>) => {
    let n = 0
    for (const npub of activeNpubs) n += Math.min(1, (w.get(npub) ?? 0) / ACTIVE_FULL_WEIGHT)
    return n
  }

  // 6. Moderação CONSERVADORA, sem ordem (revisões pré-merge A8/A19/A20).
  //    Pesos e moderação dependem um do outro (−15 por post moderado) e a
  //    relação é antítona — não há ponto fixo garantido. Histórico:
  //      - M ← decidir(pesos(M)): oscilava, podia não moderar nada (F4);
  //      - M ← M ∪ decidir(pesos(M)): decidia tudo SEM penalidade — spammer
  //        punido seguia derrubando post honesto com peso cheio (A8);
  //      - ordem histórica por timestamp: o atacante escolhia a ordem
  //        retrodatando reports (A19), e custava 1 re-solução por post (A20).
  //    Agora: C = candidatos (acima do threshold sem penalidade nenhuma);
  //    um candidato só é moderado se continuar acima do threshold com os
  //    pesos que TODAS as penalidades dos candidatos produziriam. Cada
  //    reporter é avaliado no pior caso pra ele. Sem ordem → sem timestamp
  //    pra manipular; 3 soluções de peso no total. Em ataque simétrico
  //    (dois lados se denunciando) o resultado é "ninguém moderado" — erra
  //    pra menos moderação, nunca pra moderar o honesto (§17/§26).
  const base = solveWeights(npubs, input.anchors, lastActive, outEdges, postsByAuthor, new Set(), epochMs)
  const pointsWith = (w: ReadonlyMap<string, number>, ant: ReadonlyMap<string, number>) => (npub: string) =>
    (ant.get(npub) ?? 0) >= REPORT_MIN_ANTIQUITY_WEEKS ? getReportWeight(w.get(npub) ?? 0) : 0
  // Threshold sempre com a base ativa SEM penalidade (a maior possível):
  // pesos finais ≥ pesos de pior caso, então a base final poderia subir o
  // threshold em 1 e deixar um moderado abaixo dele (revisão rodada 4).
  const baseActive = weightedActive(base.weights)
  const candidates = new Set<string>()
  {
    const pts = pointsWith(base.weights, base.antiquity)
    const active = baseActive
    for (const [postId, reports] of reportsByPost) {
      if (isAboveThreshold(reports, pts, active, input.moderation)) candidates.add(postId)
    }
  }
  let weights = base.weights
  let antiquity = base.antiquity
  const moderated = new Set<string>()
  if (candidates.size > 0) {
    const worst = solveWeights(npubs, input.anchors, lastActive, outEdges, postsByAuthor, candidates, epochMs, base.weights)
    const pts = pointsWith(worst.weights, worst.antiquity)
    const active = baseActive
    for (const postId of candidates) {
      if (isAboveThreshold(reportsByPost.get(postId)!, pts, active, input.moderation)) moderated.add(postId)
    }
    ;({ weights, antiquity } =
      moderated.size === candidates.size
        ? worst
        : solveWeights(npubs, input.anchors, lastActive, outEdges, postsByAuthor, moderated, epochMs, worst.weights))
  }
  const activeUsers = weightedActive(weights)

  // 7. Scores.
  const nowSec = Math.floor(input.nowMs / 1000)
  const posts = new Map<string, RankedPost>()
  for (const p of input.posts) {
    const net = netByPost.get(p.id)
    let spreadWeight = 0
    let buryWeight = 0
    const vote = (u: string) => {
      const w = weights.get(u) ?? 0
      return canVote(w, antiquity.get(u) ?? 0) ? w : 0
    }
    for (const u of net?.spreaders ?? []) spreadWeight += vote(u)
    for (const u of net?.buriers ?? []) buryWeight += vote(u)
    let commentWeight = 0
    for (const u of commentersByPost.get(p.id) ?? []) commentWeight += vote(u)
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
  outEdges: ReadonlyMap<string, readonly { to: string; e: number; share: number }[]>,
  postsByAuthor: ReadonlyMap<string, readonly string[]>,
  moderated: ReadonlySet<string>,
  epochMs: number,
  warmStart?: ReadonlyMap<string, number>,
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

  // ORÇAMENTO CONSERVADO (revisão F1). Cada identidade s distribui no
  // máximo ENDORSE_BUDGET × w(s) pontos de engajamento, dividido entre os
  // autores distintos que ela endossa (proporcional ao peso da aresta), e
  // cada aresta tem teto = o valor antigo de 1 spread (10 × w(s)/100) ou
  // de 1 comentário (1 × w(s)/100).
  //
  // Consequência: Σ engajamento dado ≤ ENDORSE_BUDGET × Σ w. Com
  // ENDORSE_BUDGET = 0.5 o operador é uma contração — o peso total de
  // QUALQUER grupo fica ≤ antiguidade_total / (1 − 0.5) = 2 × o tempo real
  // ancorado que ele tem. Antes o ganho não tinha limite: uma âncora de
  // 1 dia num anel saturava o anel inteiro em 60.
  const antiquity = new Map<string, number>()
  for (const npub of npubs) antiquity.set(npub, calculateAntiquity(fixed.get(npub)!.createdAt, epochMs))

  const inflowOf = (w: ReadonlyMap<string, number>): Map<string, number> => {
    const inflow = new Map<string, number>()
    for (const [from, edges] of outEdges) {
      const wf = w.get(from) ?? 0
      // Só endossa quem pode votar (peso E antiguidade mínimos) — A18.
      if (!canVote(wf, antiquity.get(from) ?? 0)) continue
      for (const { to, e, share } of edges) {
        const cap = (e === SPREAD_EDGE ? ENGAGEMENT_POINTS.POST_SPREAD : ENGAGEMENT_POINTS.COMMENT_RECEIVED) * (wf / 100)
        const pts = Math.min(cap, ENDORSE_BUDGET * wf * share)
        inflow.set(to, (inflow.get(to) ?? 0) + pts)
      }
    }
    return inflow
  }

  const evaluate = (npub: string, inflow: ReadonlyMap<string, number>): number => {
    const f = fixed.get(npub)!
    return calculateWeight({
      createdAt: f.createdAt,
      // `inflow` já está em PONTOS (ponderado, com teto e orçamento);
      // calculateWeight multiplica por POST_SPREAD, então dividimos aqui.
      spreadsReceived: (inflow.get(npub) ?? 0) / ENGAGEMENT_POINTS.POST_SPREAD,
      reportsConfirmed: f.reports,
      lastActive: f.lastActive,
      now: epochMs,
    })
  }

  // w₀ = antiguidade pura (ou warm start). A contração (razão ≤ 0.5)
  // garante ponto fixo único e convergência geométrica de qualquer início.
  // Warm start: o ponto fixo é ÚNICO (contração), então partir dos pesos
  // da rodada anterior converge pro mesmo valor, só que mais rápido.
  let w = new Map<string, number>(warmStart ?? antiquity)
  for (let i = 0; i < MAX_WEIGHT_ITERATIONS; i++) {
    const inflow = inflowOf(w)
    const next = new Map<string, number>()
    let delta = 0
    let maxW = 1
    for (const npub of npubs) {
      const v = evaluate(npub, inflow)
      next.set(npub, v)
      delta = Math.max(delta, Math.abs(v - (w.get(npub) ?? 0)))
      if (v > maxW) maxW = v
    }
    w = next
    if (delta < WEIGHT_EPSILON * maxW) break
  }
  return { weights: w, antiquity }
}

function isAboveThreshold(
  reports: readonly RankingReport[],
  points: (npub: string) => number,
  activeUsers: number,
  opts: RankingInput['moderation'],
): boolean {
  const byReason: Record<ReportReason, number> = { illegal: 0, spam: 0, harassment: 0 }
  let total = 0
  // Decay (opt-in) medido contra o report ELEGÍVEL mais recente do post,
  // não contra "agora": denúncias espalhadas no tempo pesam menos, mas a
  // moderação não se desfaz sozinha na virada do dia (revisão Ted #2) — e
  // um report de peso 0 chegando agora não "envelhece" os antigos (A9).
  let latest = 0
  for (const r of reports) if (points(r.reporter_pub) > 0 && r.created_at > latest) latest = r.created_at
  for (const r of reports) {
    if (!(r.reason in byReason)) continue
    let pts = points(r.reporter_pub)
    if (pts <= 0) continue
    if (opts?.reportDecayHalfLifeMs) {
      pts = calculateEffectiveReportWeight(pts, (latest - r.created_at) * 1000, opts.reportDecayHalfLifeMs)
    }
    byReason[r.reason] += pts
    total += pts
  }
  const reasons: ReportReason[] = ['illegal', 'spam', 'harassment']
  return (
    reasons.some((reason) => byReason[reason] >= getReportThreshold(activeUsers, reason, opts?.thresholdOverride)) ||
    total >= getReportThreshold(activeUsers, 'spam', opts?.thresholdOverride)
  )
}
