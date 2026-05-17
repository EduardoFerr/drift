/**
 * Trust Lens — Personalized PageRank Monte Carlo + view multiplier.
 *
 * Pure functions. Toda computação determinística dado mesma seed +
 * mesmo grafo de entrada — manifesto §7 cross-device convergence.
 *
 * Stage 3 HIMYM consensus (`Docs/sessions/trust-lens-math-stage3-himym-2026-05-17.md`):
 *
 * Algorithm (PPR Monte Carlo):
 *   for k in 1..K:
 *     walk = [source]
 *     for step in 1..L:
 *       if rng() < α: break          // teleport-back termination
 *       next = sampleNeighborByInfluence(current, rng)
 *       if !next: break               // dead-end, terminate walk
 *       walk.append(next)
 *     for node in walk[1:]:           // exclui source
 *       visits[node] += 1
 *   if (totalVisits === 0) return empty   // cold-start guard ISSUE-6
 *   ppr_score(target) = visits[target] / totalVisits
 *
 * View multiplier (pós-PPR):
 *   ppr_normalized = log(1 + 100·ppr) / log(101)   // [0,1] log-transform
 *   s_local = s_global × clip(
 *     ALPHA_VIEW + BETA_MAX·strength·ppr_normalized
 *                + GAMMA_MAX·strength·mutual_spread_post,
 *     S_LOCAL_MIN, S_LOCAL_MAX
 *   )
 *
 * Path diversity bonus (Alvisi/Viswanath central, não polish):
 *   diversity_bonus_coeff = 0.7 + 0.3·min(disjoint_paths, 3)/3 ∈ [0.7, 1.0]
 *   final_score = ppr_score × diversity_bonus_coeff
 *
 * Conformance tests:
 *   - tests/trust-lens-math.test.ts #14 (ppr_score sum ≤ 1)
 *   - tests/trust-lens-math.test.ts #15 (cold-start empty Map)
 *   - tests/trust-lens-math.test.ts #16 (no overflow K=1000 L=6)
 *   - tests/trust-lens-math.test.ts #18 (multiplier ≥ S_LOCAL_MIN)
 *   - tests/trust-lens-math.test.ts #19 (strength=0 → 1.0 bit-exact)
 *   - tests/trust-lens-math.test.ts #21 (diversity_coeff ∈ [0.7, 1.0])
 */

import { PPR_PARAMS, VIEW_MULTIPLIER } from './constants'

// ─── Types ────────────────────────────────────────────────────────

/** Edge no grafo de PPR walk. `influence` ∈ [0, 1] vem de `edges.ts:computeInfluence`. */
export interface PprEdge {
  target: string
  influence: number
}

/** Adjacency list: source → [edges out]. Source node é o KEY do Map. */
export type AdjacencyList = Map<string, PprEdge[]>

// ─── Pure: sample_neighbor ────────────────────────────────────────

/**
 * Sample 1 neighbor weighted by influence. Returns `null` se:
 *   - node não tem out-edges (dead-end)
 *   - total influence = 0 (ISSUE-3 guard — atacante poisoning não trava walk)
 *
 * Caller decide se restart pra source ou termina walk. Stage 3 §1.2 +
 * Marshall ISSUE-3: walks NÃO devem travar; restart pra source quando
 * total = 0.
 */
export function sampleNeighborByInfluence(
  edges: PprEdge[],
  rng: () => number,
): PprEdge | null {
  if (edges.length === 0) return null
  let total = 0
  for (const e of edges) total += e.influence
  if (total <= 0) return null
  const pick = rng() * total
  let cumulative = 0
  for (const e of edges) {
    cumulative += e.influence
    if (cumulative >= pick) return e
  }
  // Fallback: floating point edge — retorna último
  return edges[edges.length - 1]!
}

// ─── Pure: PPR Monte Carlo ────────────────────────────────────────

/**
 * Computa Personalized PageRank scores pros nodes visitados a partir
 * de `source`. Returns Map<target, ppr_score> ∈ (0, 1].
 *
 * Cold-start (ISSUE-6): se grafo está vazio ou source não tem
 * out-edges, retorna `new Map()` — feed cai pro global naturalmente
 * sem NaN propagation.
 */
export function computePpr(params: {
  source: string
  graph: AdjacencyList
  rng: () => number
  K?: number
  L?: number
  alpha?: number
}): Map<string, number> {
  const K = params.K ?? PPR_PARAMS.K
  const L = params.L ?? PPR_PARAMS.L
  const alpha = params.alpha ?? PPR_PARAMS.ALPHA
  const visits = new Map<string, number>()
  let totalVisits = 0

  for (let k = 0; k < K; k++) {
    let current = params.source
    for (let step = 0; step < L; step++) {
      if (params.rng() < alpha) break // teleport-back via damping
      const edges = params.graph.get(current) ?? []
      const next = sampleNeighborByInfluence(edges, params.rng)
      if (next === null) {
        // ISSUE-3: weights=0 ou dead-end → restart pra source.
        // Walk ainda conta os hops já dados — não desperdiça compute.
        current = params.source
        continue
      }
      current = next.target
      // Visit count: source nunca aparece em visits (definição PPR)
      if (current !== params.source) {
        visits.set(current, (visits.get(current) ?? 0) + 1)
        totalVisits++
      }
    }
  }

  // Cold-start guard ISSUE-6: source sem out-edges, ou todos walks
  // terminaram via damping em step 0 → visits vazio → 0/0 NaN. Return
  // empty map; caller usa s_global puro (feed inalterado).
  if (totalVisits === 0) return new Map()

  const ppr = new Map<string, number>()
  for (const [target, count] of visits) {
    ppr.set(target, count / totalVisits)
  }
  return ppr
}

// ─── Pure: log-transform normalization ────────────────────────────

/**
 * Normaliza PPR score [0, 1] via log-transform. Solve BUG-5 Marshall
 * (BETA placebo): PPR scores em prática são power-law (top-1 ≈ 0.05-
 * 0.15), log-transform achata pra escala perceptual.
 *
 *   normalized = log(1 + 100·ppr) / log(101)
 *
 * Examples (calculated from log(1+100·ppr)/log(101)):
 *   ppr=0.001 → 0.022
 *   ppr=0.01  → 0.150
 *   ppr=0.05  → 0.378
 *   ppr=0.10  → 0.520
 *   ppr=0.50  → 0.846
 *   ppr=1.00  → 1.000
 */
export function normalizePpr(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) return 0
  return Math.log(1 + 100 * rawScore) / Math.log(101)
}

// ─── Pure: path diversity bonus ───────────────────────────────────

/**
 * Conta disjoint paths source→target com depth ≤ `maxDepth` (default 3).
 * "Disjoint" = sem compartilhar intermediate nodes.
 *
 * Defesa central Alvisi/Viswanath: targets alcançados via 1 único
 * intermediário (1 path) ficam dim; ≥2 paths recebem bonus full.
 *
 * Algo: BFS-based path enumeration. Cap 3 paths (mais é noise).
 *
 * **Custo**: O(d^maxDepth) per target. Em grafo Nostr esparso (~7
 * follows median), custo amortizado é baixo. Cache entre recomputes
 * planejado pra Phase 1.5 (plan §1.8 atualização 125ms).
 */
export function disjointPaths(
  source: string,
  target: string,
  graph: AdjacencyList,
  maxDepth = 3,
  cap = 3,
): number {
  if (source === target) return 0
  // BFS variante: enumera caminhos, marca intermediários por path
  // Pra cada path encontrado, "queima" intermediates pro próximo.
  const usedIntermediates = new Set<string>()
  let pathsFound = 0

  for (let attempt = 0; attempt < cap; attempt++) {
    // DFS limitado depth pra um caminho que evita usedIntermediates
    const path = findPathAvoiding(source, target, graph, maxDepth, usedIntermediates)
    if (path === null) break
    pathsFound++
    // Adiciona TODOS intermediates desse path pro set (não source nem target)
    for (let i = 1; i < path.length - 1; i++) {
      usedIntermediates.add(path[i]!)
    }
  }

  return pathsFound
}

function findPathAvoiding(
  source: string,
  target: string,
  graph: AdjacencyList,
  maxDepth: number,
  forbidden: Set<string>,
): string[] | null {
  // DFS iterativo: stack de [node, depth, pathSoFar]
  const stack: Array<{ node: string; depth: number; path: string[] }> = [
    { node: source, depth: 0, path: [source] },
  ]
  while (stack.length > 0) {
    const { node, depth, path } = stack.pop()!
    if (node === target && depth > 0) return path
    if (depth >= maxDepth) continue
    const edges = graph.get(node) ?? []
    for (const e of edges) {
      // Skip se já passamos por esse node OU se está forbidden
      if (path.includes(e.target)) continue
      if (e.target !== target && forbidden.has(e.target)) continue
      stack.push({
        node: e.target,
        depth: depth + 1,
        path: [...path, e.target],
      })
    }
  }
  return null
}

/**
 * Diversity bonus coefficient ∈ [0.7, 1.0].
 *
 *   bonus = min(disjoint_paths, 3) / 3   ∈ [0, 1]
 *   coeff = 0.7 + 0.3 × bonus            ∈ [0.7, 1.0]
 *
 * 0 paths → 0.7 (minimum, target trusted só transitivamente sem
 * diversidade). 3+ paths → 1.0 (bonus full, multiple disjoint vouches).
 */
export function diversityCoeff(paths: number): number {
  const bonus = Math.min(Math.max(0, paths), 3) / 3
  return 0.7 + 0.3 * bonus
}

// ─── Pure: view multiplier (s_local computation) ──────────────────

/**
 * Aplica Trust Lens no view-boundary. Pure function — calcula
 * multiplier que multiplica `s_global` pra obter `s_local`.
 *
 * **NUNCA persisted**: s_local existe só no render path do feed.
 * Conformance test #2 verifica que s_local não vaza pra DB.
 *
 * Math (Stage 3 lock):
 *   ppr_normalized = log(1 + 100·ppr) / log(101)
 *   multiplier = clip(
 *     ALPHA_VIEW + BETA_MAX·strength·ppr_normalized
 *                + GAMMA_MAX·strength·mutual_spread_post,
 *     S_LOCAL_MIN, S_LOCAL_MAX
 *   )
 *   s_local = s_global × multiplier
 *
 * **strength=0 sempre retorna 1.0 bit-exact** (S_LOCAL_MIN ≤ 1.0 ≤
 * S_LOCAL_MAX → clip(1.0) === 1.0). Off-state preserva s_global.
 * Conformance test #19.
 */
export function viewMultiplier(params: {
  pprScore: number
  mutualSpreadPost: number
  strength: number
}): number {
  const { ALPHA_VIEW, BETA_MAX, GAMMA_MAX, S_LOCAL_MIN, S_LOCAL_MAX } = VIEW_MULTIPLIER
  const pprNorm = normalizePpr(params.pprScore)
  const mutual = Math.max(0, params.mutualSpreadPost)
  const strength = Math.max(0, Math.min(1, params.strength))
  const raw =
    ALPHA_VIEW +
    BETA_MAX * strength * pprNorm +
    GAMMA_MAX * strength * mutual
  // clip [S_LOCAL_MIN, S_LOCAL_MAX]
  return Math.max(S_LOCAL_MIN, Math.min(S_LOCAL_MAX, raw))
}

/**
 * Final score com path diversity. Pure helper que compõe PPR +
 * diversity. Use em conjunto com `viewMultiplier`:
 *
 *   const adjusted = applyDiversity(pprScore, paths)
 *   const mult = viewMultiplier({ pprScore: adjusted, ... })
 *   const s_local = s_global × mult
 */
export function applyDiversity(pprScore: number, paths: number): number {
  return pprScore * diversityCoeff(paths)
}
