/**
 * Trust Lens — math invariants conformance tests.
 *
 * 12 tests Marshall Stage 1 + 3 tests Stage 3 HIMYM = 15 totais.
 *
 * PR-2 escope (este arquivo, parcial): #10-13, #17, #20 (rng + edges).
 * PR-3 vai adicionar: #14-16, #18-19, #21 (ppr + view multiplier).
 * Stage 3 vai adicionar: #22-24 (BA graph, cold-start hostile, window
 * boundary Spearman).
 *
 * Source: Docs/sessions/trust-lens-math-stage3-himym-2026-05-17.md §Conformance
 */

import { describe, it, expect } from 'vitest'
import { createPprRng, __internal } from '../src/lib/trust/rng'
import {
  computeInfluence,
  isValidComponents,
  sanitizeComponents,
} from '../src/lib/trust/edges'
import {
  computePpr,
  normalizePpr,
  disjointPaths,
  diversityCoeff,
  applyDiversity,
  viewMultiplier,
  type AdjacencyList,
  type PprEdge,
} from '../src/lib/trust/ppr'
import type { LensEdgeComponentsV1 } from '../src/types/drift'

// ─── Helpers ──────────────────────────────────────────────────────

function makeComponents(overrides: Partial<LensEdgeComponentsV1> = {}): LensEdgeComponentsV1 {
  return {
    v: 1,
    follow: 0,
    mutual_spread: 0,
    my_spread: 0,
    my_bury: 0,
    fof_paths: 0,
    ...overrides,
  }
}

function randomComponents(rng: () => number): LensEdgeComponentsV1 {
  return {
    v: 1,
    follow: rng() < 0.5 ? 0 : 1,
    mutual_spread: Math.floor(rng() * 100),
    my_spread: Math.floor(rng() * 50),
    my_bury: Math.floor(rng() * 50),
    fof_paths: Math.floor(rng() * 10),
  }
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Trust Lens math invariants — PR-2 (rng + edges)', () => {
  // ─── #10 — influence ∈ [0, 1] property test ───────────────────
  it('#10 influence ∈ [0, 1] pra 1000 inputs aleatórios', () => {
    const rng = createPprRng('npub1propertytest000000000000000000000000000000000000', 0)
    for (let i = 0; i < 1000; i++) {
      const c = randomComponents(rng)
      const influence = computeInfluence(c)
      expect(influence).toBeGreaterThanOrEqual(0)
      expect(influence).toBeLessThanOrEqual(1)
      expect(Number.isFinite(influence)).toBe(true)
    }
  })

  // ─── #11 — influence monotônica em follow ─────────────────────
  it('#11 influence cresce monotonicamente em follow (0 → 1)', () => {
    // Mesma componente fora de follow, comparar follow=0 vs follow=1
    const seeds = [
      { mutual_spread: 0, my_spread: 0, my_bury: 0, fof_paths: 0 },
      { mutual_spread: 5, my_spread: 2, my_bury: 0, fof_paths: 3 },
      { mutual_spread: 20, my_spread: 10, my_bury: 0, fof_paths: 5 },
      { mutual_spread: 1, my_spread: 0, my_bury: 5, fof_paths: 0 },
    ]
    for (const seed of seeds) {
      const noFollow = computeInfluence(makeComponents({ ...seed, follow: 0 }))
      const withFollow = computeInfluence(makeComponents({ ...seed, follow: 1 }))
      expect(withFollow).toBeGreaterThan(noFollow)
    }
  })

  // ─── #12 — influence monotônica decrescente em my_bury ────────
  it('#12 influence decresce monotonicamente em my_bury', () => {
    const base = { v: 1 as const, follow: 1 as const, mutual_spread: 3, my_spread: 2, fof_paths: 1 }
    let prev = Infinity
    for (let bury = 0; bury < 20; bury++) {
      const influence = computeInfluence({ ...base, my_bury: bury })
      expect(influence).toBeLessThan(prev)
      prev = influence
    }
  })

  // ─── #13 — PRNG seed determinismo bit-exact ───────────────────
  it('#13 createPprRng com mesma seed gera sequência bit-exact 10 runs', () => {
    const source = 'npub1deterministic00000000000000000000000000000000000'
    const now = 1717200000000 // arbitrário, fixo
    const sequences: number[][] = []
    for (let run = 0; run < 10; run++) {
      const rng = createPprRng(source, now)
      const seq: number[] = []
      for (let i = 0; i < 50; i++) seq.push(rng())
      sequences.push(seq)
    }
    // Todas as 10 runs devem ser bit-exact idênticas
    const reference = sequences[0]!
    for (let run = 1; run < 10; run++) {
      expect(sequences[run]).toEqual(reference)
    }
  })

  // ─── #17 — NaN guard: sanitizeComponents nunca produz NaN ─────
  it('#17 sanitizeComponents rejeita inputs inválidos sem throw nem NaN', () => {
    const garbageInputs: unknown[] = [
      null,
      undefined,
      {},
      { v: 1, follow: 1 }, // missing fields
      { v: 2, follow: 1, mutual_spread: 0, my_spread: 0, my_bury: 0, fof_paths: 0 }, // wrong version
      { v: 1, follow: -1, mutual_spread: 0, my_spread: 0, my_bury: 0, fof_paths: 0 },
      { v: 1, follow: 0, mutual_spread: NaN, my_spread: 0, my_bury: 0, fof_paths: 0 },
      { v: 1, follow: 0, mutual_spread: Infinity, my_spread: 0, my_bury: 0, fof_paths: 0 },
      { v: 1, follow: 0, mutual_spread: -5, my_spread: 0, my_bury: 0, fof_paths: 0 },
      { v: 1, follow: 1, mutual_spread: 2.7, my_spread: 1.5, my_bury: 0, fof_paths: 0 }, // non-integer
      'string-not-object',
      42,
    ]
    for (const garbage of garbageInputs) {
      // sanitizeComponents NUNCA throws e retorna sempre valid
      const sanitized = sanitizeComponents(garbage as never)
      expect(isValidComponents(sanitized)).toBe(true)
      const influence = computeInfluence(sanitized)
      expect(Number.isFinite(influence)).toBe(true)
      expect(influence).toBeGreaterThanOrEqual(0)
      expect(influence).toBeLessThanOrEqual(1)
    }
  })

  // ─── #20 — Seed boundary cross-device same window bit-exact ───
  it('#20 mesmo source + mesma janela 24h → mesma seed (cross-device determinism)', () => {
    const source = 'npub1crossdevicewindow00000000000000000000000000000000'
    const dayStart = Math.floor(1717200000000 / __internal.WINDOW_MS) * __internal.WINDOW_MS
    // 4 horários dentro da MESMA janela 24h
    const t1 = dayStart + 1000 // 00:00:01
    const t2 = dayStart + 8 * 3600_000 // 08:00:00
    const t3 = dayStart + 18 * 3600_000 // 18:00:00
    const t4 = dayStart + __internal.WINDOW_MS - 1 // 23:59:59.999

    const seqs = [t1, t2, t3, t4].map((t) => {
      const rng = createPprRng(source, t)
      const out: number[] = []
      for (let i = 0; i < 20; i++) out.push(rng())
      return out
    })
    // Todas as 4 sequências devem ser bit-exact iguais
    for (let i = 1; i < 4; i++) {
      expect(seqs[i]).toEqual(seqs[0])
    }

    // Boundary check: 1ms ANTES da fronteira vs 1ms DEPOIS → seeds diferentes
    const beforeBoundary = createPprRng(source, dayStart + __internal.WINDOW_MS - 1)
    const afterBoundary = createPprRng(source, dayStart + __internal.WINDOW_MS + 1)
    const seqBefore = [beforeBoundary(), beforeBoundary(), beforeBoundary()]
    const seqAfter = [afterBoundary(), afterBoundary(), afterBoundary()]
    expect(seqBefore).not.toEqual(seqAfter)
  })

  // ─── Bonus — isValidComponents type guard sanity ──────────────
  it('isValidComponents aceita componentes válidos', () => {
    expect(isValidComponents(makeComponents())).toBe(true)
    expect(isValidComponents(makeComponents({ follow: 1, mutual_spread: 5 }))).toBe(true)
  })

  it('isValidComponents rejeita versões desconhecidas', () => {
    expect(isValidComponents({ ...makeComponents(), v: 2 })).toBe(false)
    expect(isValidComponents({ ...makeComponents(), v: 0 })).toBe(false)
  })

  // ─── Bonus — sanity check direct:FoF razão ~7x ────────────────
  it('Stage 3 Robin/Barney call: razão direct (follow+spread) : FoF vazio ≈ 7x', () => {
    const fofEmpty = computeInfluence(makeComponents({ follow: 0 }))
    const directWithSpread = computeInfluence(
      makeComponents({ follow: 1, my_spread: 5 }),
    )
    const ratio = directWithSpread / fofEmpty
    // Stage 3 doc cita 6.55x ≈ 7x; aceitar [5x, 9x] de tolerância
    expect(ratio).toBeGreaterThanOrEqual(5)
    expect(ratio).toBeLessThanOrEqual(9)
  })
})

// ─── PR-3 tests (PPR + view multiplier + diversity) ───────────────

describe('Trust Lens math invariants — PR-3 (ppr + multiplier)', () => {
  /** Builds simple adjacency list helper for tests. */
  function makeGraph(edges: Array<[string, string, number]>): AdjacencyList {
    const graph: AdjacencyList = new Map()
    for (const [src, tgt, infl] of edges) {
      const list = graph.get(src) ?? []
      list.push({ target: tgt, influence: infl })
      graph.set(src, list)
    }
    return graph
  }

  // ─── #14 — ppr_score sum ≤ 1.0 + tolerance ε ──────────────────
  it('#14 ppr_score sum sobre todos targets ≤ 1.0 (Monte Carlo invariant)', () => {
    const source = 'npub_a'
    const graph = makeGraph([
      ['npub_a', 'npub_b', 0.8],
      ['npub_a', 'npub_c', 0.5],
      ['npub_a', 'npub_d', 0.3],
      ['npub_b', 'npub_e', 0.7],
      ['npub_b', 'npub_f', 0.6],
      ['npub_c', 'npub_e', 0.5],
      ['npub_d', 'npub_g', 0.4],
    ])
    const rng = createPprRng(source, 1717200000000)
    const ppr = computePpr({ source, graph, rng })
    let sum = 0
    for (const score of ppr.values()) sum += score
    // PPR Monte Carlo invariant: sum of visits/totalVisits = 1.0 (sem
    // floating error em integer division). Tolerance ε = 1e-9 pra safety.
    expect(sum).toBeGreaterThanOrEqual(1.0 - 1e-9)
    expect(sum).toBeLessThanOrEqual(1.0 + 1e-9)
  })

  // ─── #15 — PPR cold-start: empty Map, no NaN propagation ──────
  it('#15 PPR cold-start: source sem out-edges → empty Map (no NaN)', () => {
    const source = 'npub_lonely'
    const emptyGraph: AdjacencyList = new Map()
    const rng = createPprRng(source, 1717200000000)
    const ppr = computePpr({ source, graph: emptyGraph, rng })
    expect(ppr.size).toBe(0)
    // Verifica que multiplier downstream funciona com PPR vazio
    const mult = viewMultiplier({ pprScore: 0, mutualSpreadPost: 0, strength: 1 })
    expect(Number.isFinite(mult)).toBe(true)
    expect(mult).toBeGreaterThanOrEqual(0.1)
    expect(mult).toBeLessThanOrEqual(3.0)
  })

  // ─── #16 — PPR não overflow K=1000 L=6 alta densidade ─────────
  it('#16 PPR não overflow K=1000 L=6 em adjacency densa', () => {
    // Grafo denso: 20 nodes, cada um conectado a 10 outros
    const nodes = Array.from({ length: 20 }, (_, i) => `npub_${i}`)
    const graph: AdjacencyList = new Map()
    for (const src of nodes) {
      const edges: PprEdge[] = []
      for (const tgt of nodes) {
        if (tgt === src) continue
        edges.push({ target: tgt, influence: 0.5 + Math.random() * 0.5 })
      }
      graph.set(src, edges)
    }
    const source = nodes[0]!
    const rng = createPprRng(source, 1717200000000)
    const ppr = computePpr({ source, graph, rng })
    // Todos valores devem ser finite e ∈ [0, 1]
    for (const score of ppr.values()) {
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    // PPR deve ter visitado vários nodes (não trava em 1 cycle)
    expect(ppr.size).toBeGreaterThanOrEqual(10)
  })

  // ─── #18 — view multiplier nunca produz s_local < S_LOCAL_MIN ─
  it('#18 viewMultiplier output sempre clip ∈ [S_LOCAL_MIN, S_LOCAL_MAX]', () => {
    const cases = [
      { pprScore: 0, mutualSpreadPost: 0, strength: 0 },
      { pprScore: 0, mutualSpreadPost: 0, strength: 1 },
      { pprScore: 1, mutualSpreadPost: 0, strength: 1 },
      { pprScore: 0.05, mutualSpreadPost: 0, strength: 0.5 },
      { pprScore: 0.1, mutualSpreadPost: 100, strength: 1 }, // alto mutual → clip max
      { pprScore: -0.5, mutualSpreadPost: 0, strength: 1 }, // negativo (sanitize via normalizePpr)
      { pprScore: 0, mutualSpreadPost: -10, strength: 1 }, // mutual negativo (sanitize)
      { pprScore: 0.5, mutualSpreadPost: 5, strength: 2 }, // strength > 1 (clamp)
    ]
    for (const c of cases) {
      const mult = viewMultiplier(c)
      expect(Number.isFinite(mult)).toBe(true)
      expect(mult).toBeGreaterThanOrEqual(0.1)
      expect(mult).toBeLessThanOrEqual(3.0)
    }
  })

  // ─── #19 — strength=0 → multiplier === 1.0 bit-exact ──────────
  it('#19 strength=0 → multiplier = 1.0 bit-exact (off-state)', () => {
    const cases = [
      { pprScore: 0, mutualSpreadPost: 0 },
      { pprScore: 0.5, mutualSpreadPost: 10 },
      { pprScore: 1, mutualSpreadPost: 100 },
      { pprScore: 0.001, mutualSpreadPost: 1 },
    ]
    for (const c of cases) {
      const mult = viewMultiplier({ ...c, strength: 0 })
      expect(mult).toBe(1.0) // bit-exact
    }
  })

  // ─── #21 — diversity_coeff ∈ [0.7, 1.0] ────────────────────────
  it('#21 diversityCoeff ∈ [0.7, 1.0] pra qualquer disjoint_paths', () => {
    for (let p = 0; p <= 10; p++) {
      const coeff = diversityCoeff(p)
      expect(coeff).toBeGreaterThanOrEqual(0.7)
      expect(coeff).toBeLessThanOrEqual(1.0)
    }
    // Negativos/inválidos clampam pra 0 paths
    expect(diversityCoeff(-1)).toBe(0.7)
    expect(diversityCoeff(0)).toBe(0.7)
    // 3 ou mais paths saturate em 1.0
    expect(diversityCoeff(3)).toBe(1.0)
    expect(diversityCoeff(100)).toBe(1.0)
    // applyDiversity = ppr × coeff
    expect(applyDiversity(0.5, 0)).toBe(0.5 * 0.7)
    expect(applyDiversity(0.5, 3)).toBe(0.5 * 1.0)
  })

  // ─── Bonus — normalizePpr corner cases ────────────────────────
  it('normalizePpr handles edge cases (NaN, negatives, zero, infinity)', () => {
    expect(normalizePpr(0)).toBe(0)
    expect(normalizePpr(-1)).toBe(0)
    expect(normalizePpr(NaN)).toBe(0)
    expect(normalizePpr(Infinity)).toBe(0)
    // Math sanity: log(1 + 100·ppr) / log(101)
    expect(normalizePpr(0.01)).toBeCloseTo(0.150, 2) // log(2)/log(101)
    expect(normalizePpr(0.10)).toBeCloseTo(0.520, 2) // log(11)/log(101)
    expect(normalizePpr(1.0)).toBeCloseTo(1.0, 6) // log(101)/log(101)
  })

  // ─── Bonus — disjointPaths basic shape ────────────────────────
  it('disjointPaths returns correct count for simple graph', () => {
    // a → b → target | a → c → target | a → d → target
    // 3 disjoint paths through b, c, d
    const graph = makeGraph([
      ['npub_a', 'npub_b', 0.5],
      ['npub_a', 'npub_c', 0.5],
      ['npub_a', 'npub_d', 0.5],
      ['npub_b', 'npub_target', 0.5],
      ['npub_c', 'npub_target', 0.5],
      ['npub_d', 'npub_target', 0.5],
    ])
    const paths = disjointPaths('npub_a', 'npub_target', graph, 3, 3)
    expect(paths).toBe(3)

    // Single path: a → b → target
    const singlePath = makeGraph([
      ['npub_a', 'npub_b', 0.5],
      ['npub_b', 'npub_target', 0.5],
    ])
    expect(disjointPaths('npub_a', 'npub_target', singlePath)).toBe(1)

    // No path
    const noPath = makeGraph([['npub_a', 'npub_b', 0.5]])
    expect(disjointPaths('npub_a', 'npub_target', noPath)).toBe(0)
  })
})
