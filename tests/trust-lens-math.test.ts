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
  temporalDecay,
  type AdjacencyList,
  type PprEdge,
} from '../src/lib/trust/ppr'
import {
  parsePredicate,
  evaluatePredicate,
  rootAction,
  type PredicateContext,
} from '../src/lib/trust/predicate'
import type { LensEdgeComponentsV1, LensFilterPredicate } from '../src/types/drift'

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

// ─── GAP-1 tests (temporal decay — shipped 2026-05-20) ────────────

describe('Trust Lens — temporal decay (GAP-1)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const HALF_LIFE = 30 * DAY_MS

  it('#22 decay(0, h) = 1.0 (now/future activity preservada)', () => {
    expect(temporalDecay(0, HALF_LIFE)).toBe(1)
    expect(temporalDecay(-1000, HALF_LIFE)).toBe(1) // clock skew → 1
  })

  it('#23 decay(half_life, half_life) ≈ 0.5 bit-exact dentro de 1e-12', () => {
    expect(temporalDecay(HALF_LIFE, HALF_LIFE)).toBeCloseTo(0.5, 12)
  })

  it('#24 decay(2·half_life, h) ≈ 0.25 (1/4 após 2 half-lives)', () => {
    expect(temporalDecay(2 * HALF_LIFE, HALF_LIFE)).toBeCloseTo(0.25, 12)
  })

  it('#25 decay é monotonic decrescente em age', () => {
    const ages = [0, DAY_MS, 7 * DAY_MS, 30 * DAY_MS, 90 * DAY_MS, 365 * DAY_MS]
    let prev = Infinity
    for (const age of ages) {
      const d = temporalDecay(age, HALF_LIFE)
      expect(d).toBeLessThanOrEqual(prev)
      expect(d).toBeGreaterThan(0)
      prev = d
    }
  })

  it('#26 decay tolera halfLife inválido (≤0 → 1, NaN → 1)', () => {
    expect(temporalDecay(1000, 0)).toBe(1)
    expect(temporalDecay(1000, -1)).toBe(1)
    expect(temporalDecay(1000, NaN)).toBe(1)
    expect(temporalDecay(NaN, HALF_LIFE)).toBe(1)
  })

  it('#27 decay(1y, 30d) > 0 (sem underflow — preserva sempre algum sinal)', () => {
    const oneYear = 365 * DAY_MS
    const d = temporalDecay(oneYear, HALF_LIFE)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(0.001) // após 12+ half-lives, < 2^-12
  })
})

// ─── PR-4a tests (predicate DSL) ──────────────────────────────────

describe('Trust Lens — filter predicate DSL (Robin §27 loop)', () => {
  // ─── #5 — parsePredicate rejeita inválidos sem throw ──────────
  it('#5 parsePredicate rejeita v != 1 ou kind unknown sem throw (returns null)', () => {
    const garbageInputs: unknown[] = [
      null,
      undefined,
      {},
      42,
      'string',
      { v: 2, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'hide' }, // wrong version
      { v: 1, kind: 'unknown_kind', action: 'hide' }, // unknown kind
      { v: 1, kind: 'trust_threshold', op: 'invalid_op', value: 0.1, action: 'hide' },
      { v: 1, kind: 'trust_threshold', op: 'lt', value: 1.5, action: 'hide' }, // value > 1
      { v: 1, kind: 'trust_threshold', op: 'lt', value: -0.1, action: 'hide' }, // value < 0
      { v: 1, kind: 'trust_threshold', op: 'lt', value: NaN, action: 'hide' },
      { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'unknown_action' },
      { v: 1, kind: 'tag_present', action: 'hide' }, // missing tag
      { v: 1, kind: 'tag_present', tag: '', action: 'hide' }, // empty tag
      { v: 1, kind: 'and', predicates: [], action: 'hide' }, // empty composição
      { v: 1, kind: 'and', action: 'hide' }, // missing predicates
      { v: 1, kind: 'or', predicates: 'not-array', action: 'hide' },
      { v: 1, kind: 'not', action: 'hide' }, // missing predicate
      { v: 1, kind: 'not', predicate: null, action: 'hide' },
      // Nested invalid
      {
        v: 1, kind: 'and', action: 'hide',
        predicates: [{ v: 2, kind: 'tag_present', tag: 'x', action: 'hide' }],
      },
    ]
    for (const garbage of garbageInputs) {
      expect(() => parsePredicate(garbage)).not.toThrow()
      expect(parsePredicate(garbage)).toBeNull()
    }
  })

  // ─── parsePredicate accept valid shapes ───────────────────────
  it('parsePredicate aceita shapes válidos (5 kinds)', () => {
    expect(
      parsePredicate({
        v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'hide',
      }),
    ).not.toBeNull()
    expect(
      parsePredicate({
        v: 1, kind: 'tag_present', tag: 'content-warning', action: 'blur',
      }),
    ).not.toBeNull()
    expect(
      parsePredicate({
        v: 1, kind: 'tag_present', tag: 'content-warning',
        tag_value: 'nsfw', action: 'blur',
      }),
    ).not.toBeNull()
    expect(
      parsePredicate({
        v: 1, kind: 'and', action: 'hide',
        predicates: [
          { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'hide' },
          { v: 1, kind: 'tag_present', tag: 'spam', action: 'hide' },
        ],
      }),
    ).not.toBeNull()
    expect(
      parsePredicate({
        v: 1, kind: 'or', action: 'dim',
        predicates: [
          { v: 1, kind: 'trust_threshold', op: 'gte', value: 0.5, action: 'dim' },
        ],
      }),
    ).not.toBeNull()
    expect(
      parsePredicate({
        v: 1, kind: 'not', action: 'collapse',
        predicate: { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.5, action: 'collapse' },
      }),
    ).not.toBeNull()
  })

  // ─── parsePredicate depth limit (DoS prevention) ──────────────
  it('parsePredicate rejeita depth > 10 (DoS prevention)', () => {
    let deep: unknown = {
      v: 1, kind: 'trust_threshold', op: 'lt', value: 0.5, action: 'hide',
    }
    for (let i = 0; i < 15; i++) {
      deep = { v: 1, kind: 'not', predicate: deep, action: 'hide' }
    }
    expect(parsePredicate(deep)).toBeNull()
  })

  // ─── evaluatePredicate: trust_threshold ───────────────────────
  it('evaluatePredicate trust_threshold lt/gte funciona', () => {
    const ctx: PredicateContext = { pprScore: 0.05, tags: [] }
    const lt01: LensFilterPredicate = {
      v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'hide',
    }
    expect(evaluatePredicate(lt01, ctx)).toBe(true) // 0.05 < 0.1
    const gte02: LensFilterPredicate = {
      v: 1, kind: 'trust_threshold', op: 'gte', value: 0.2, action: 'hide',
    }
    expect(evaluatePredicate(gte02, ctx)).toBe(false) // 0.05 not >= 0.2
  })

  // ─── evaluatePredicate: tag_present ───────────────────────────
  it('evaluatePredicate tag_present com e sem tag_value', () => {
    const ctxNsfw: PredicateContext = {
      pprScore: 0.5,
      tags: [['content-warning', 'nsfw'], ['t', 'art']],
    }
    // Presence only (tag_value undefined)
    expect(
      evaluatePredicate(
        { v: 1, kind: 'tag_present', tag: 'content-warning', action: 'blur' },
        ctxNsfw,
      ),
    ).toBe(true)
    // Exact match
    expect(
      evaluatePredicate(
        {
          v: 1, kind: 'tag_present', tag: 'content-warning',
          tag_value: 'nsfw', action: 'blur',
        },
        ctxNsfw,
      ),
    ).toBe(true)
    // Mismatch
    expect(
      evaluatePredicate(
        {
          v: 1, kind: 'tag_present', tag: 'content-warning',
          tag_value: 'spoiler', action: 'blur',
        },
        ctxNsfw,
      ),
    ).toBe(false)
    // Tag absent
    expect(
      evaluatePredicate(
        { v: 1, kind: 'tag_present', tag: 'absent', action: 'hide' },
        ctxNsfw,
      ),
    ).toBe(false)
  })

  // ─── §27 loop completo: and(tag_present + trust_threshold) ────
  it('Robin §27 loop: AND(content-warning=nsfw, ppr < 0.1)', () => {
    const rule: LensFilterPredicate = {
      v: 1, kind: 'and', action: 'hide',
      predicates: [
        { v: 1, kind: 'tag_present', tag: 'content-warning', tag_value: 'nsfw', action: 'hide' },
        { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1, action: 'hide' },
      ],
    }
    // Low trust + nsfw = hide
    expect(
      evaluatePredicate(rule, { pprScore: 0.05, tags: [['content-warning', 'nsfw']] }),
    ).toBe(true)
    // High trust + nsfw = NOT hide (passa pelo filter)
    expect(
      evaluatePredicate(rule, { pprScore: 0.5, tags: [['content-warning', 'nsfw']] }),
    ).toBe(false)
    // Low trust without nsfw = NOT hide
    expect(
      evaluatePredicate(rule, { pprScore: 0.05, tags: [] }),
    ).toBe(false)
    expect(rootAction(rule)).toBe('hide')
  })

  // ─── or + not composition ─────────────────────────────────────
  it('evaluatePredicate or/not composição', () => {
    const orRule: LensFilterPredicate = {
      v: 1, kind: 'or', action: 'dim',
      predicates: [
        { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.05, action: 'dim' },
        { v: 1, kind: 'tag_present', tag: 'spam', action: 'dim' },
      ],
    }
    expect(evaluatePredicate(orRule, { pprScore: 0.5, tags: [['spam', '']] })).toBe(true) // spam tag matches
    expect(evaluatePredicate(orRule, { pprScore: 0.01, tags: [] })).toBe(true) // low ppr matches
    expect(evaluatePredicate(orRule, { pprScore: 0.5, tags: [] })).toBe(false) // neither

    const notRule: LensFilterPredicate = {
      v: 1, kind: 'not', action: 'hide',
      predicate: { v: 1, kind: 'trust_threshold', op: 'gte', value: 0.1, action: 'hide' },
    }
    // not(ppr >= 0.1) → ppr < 0.1 → hide
    expect(evaluatePredicate(notRule, { pprScore: 0.05, tags: [] })).toBe(true)
    expect(evaluatePredicate(notRule, { pprScore: 0.5, tags: [] })).toBe(false)
  })
})

// ─── PR-4b smoke tests (orchestrator API) ─────────────────────────
// trust-lens.ts has DB I/O which can't run in Vitest Node env without
// SQLite WASM setup. Smoke test ONLY pure store + applyLensToPost.

describe('Trust Lens orchestrator — pure store ops (PR-4b smoke)', () => {
  it('useLensStore: setLensStrength clamps [0, 1] and updates enabled', async () => {
    const { useLensStore, setLensStrength, __testing } = await import('../src/lib/trust-lens')
    __testing.resetStore()
    expect(useLensStore.getState().strength).toBe(0)
    expect(useLensStore.getState().enabled).toBe(false)

    setLensStrength(0.5)
    expect(useLensStore.getState().strength).toBe(0.5)
    expect(useLensStore.getState().enabled).toBe(true)

    setLensStrength(0) // off
    expect(useLensStore.getState().strength).toBe(0)
    expect(useLensStore.getState().enabled).toBe(false)

    // Clamps
    setLensStrength(1.5)
    expect(useLensStore.getState().strength).toBe(1)
    setLensStrength(-0.5)
    expect(useLensStore.getState().strength).toBe(0)

    __testing.resetStore()
  })

  it('applyLensToPost: strength=0 returns globalScore bit-exact (#19 invariant)', async () => {
    const { applyLensToPost, setLensStrength, __testing } = await import('../src/lib/trust-lens')
    __testing.resetStore()
    setLensStrength(0)
    expect(
      applyLensToPost({
        globalScore: 42,
        authorNpub: 'npub_anyone',
        mutualSpreadPost: 99,
      }),
    ).toBe(42) // bit-exact, off-state
    __testing.resetStore()
  })

  it('getPprForAuthor: cold-start retorna 0 (sem cache, sem throw)', async () => {
    const { getPprForAuthor, __testing } = await import('../src/lib/trust-lens')
    __testing.resetStore()
    expect(getPprForAuthor('npub_unknown')).toBe(0)
    expect(getPprForAuthor('')).toBe(0)
    __testing.resetStore()
  })
})

// ─── GAP-B tests (Sybil edge-refresh defense — shipped 2026-05-20) ───
//
// Source-grep conformance — código deve ter o pattern correto pra
// preservar a defesa. DB-backed tests (real upsert + sleep + re-read)
// estão deferred porque exigem SQLite WASM init no Vitest Node.

describe('Trust Lens — GAP-B Sybil edge-refresh defense', () => {
  const fs = require('node:fs') as typeof import('node:fs')

  it('#28 schema.sql declara created_at em lens_edges (nullable pra backward compat)', () => {
    const schema = fs.readFileSync('src/lib/schema.sql', 'utf8')
    const lensEdgesBlock = schema.match(
      /CREATE TABLE IF NOT EXISTS lens_edges[\s\S]*?\);/,
    )
    expect(lensEdgesBlock).not.toBeNull()
    expect(lensEdgesBlock![0]).toMatch(/created_at\s+INTEGER/)
  })

  it('#29 upsertEdge (ambos writers) NÃO inclui created_at no DO UPDATE SET (imutável)', () => {
    const edgesTs = fs.readFileSync('src/lib/trust/edges.ts', 'utf8')
    const lensTs = fs.readFileSync('src/lib/trust-lens.ts', 'utf8')

    // Extrai bloco INSERT INTO lens_edges de cada writer
    for (const [file, src] of [
      ['trust/edges.ts', edgesTs],
      ['trust-lens.ts', lensTs],
    ] as const) {
      const insertMatch = src.match(
        /INSERT INTO lens_edges[\s\S]*?ON CONFLICT[\s\S]*?DO UPDATE SET[\s\S]*?`/,
      )
      expect(insertMatch, `${file}: bloco INSERT not found`).not.toBeNull()
      const block = insertMatch![0]
      // Deve incluir created_at no INSERT columns
      expect(block, `${file}: created_at deve estar nas columns do INSERT`).toMatch(
        /\(source_npub, target_npub, influence, components, updated_at, created_at\)/,
      )
      // Mas NÃO no DO UPDATE SET
      const updateClause = block.match(/DO UPDATE SET([\s\S]*?)`/)![1]!
      expect(updateClause, `${file}: created_at NÃO pode estar em DO UPDATE SET`).not.toMatch(
        /created_at\s*=/,
      )
    }
  })

  it('#30 recomputeLens usa created_at como age proxy (COALESCE pra defesa em camada)', () => {
    const src = fs.readFileSync('src/lib/trust-lens.ts', 'utf8')
    // SELECT deve incluir created_at
    expect(src).toMatch(
      /SELECT source_npub, target_npub, influence, created_at, updated_at FROM lens_edges/,
    )
    // Decay calc deve usar created_at PRIMEIRO (fallback updated_at)
    expect(src).toMatch(/row\.created_at\s*\?\?\s*row\.updated_at/)
  })

  it('#31 db.worker.ts tem migration entry + backfill UPDATE created_at IS NULL', () => {
    const src = fs.readFileSync('src/lib/db.worker.ts', 'utf8')
    expect(src).toMatch(/add_created_at_to_lens_edges/)
    expect(src).toMatch(
      /UPDATE lens_edges SET created_at = updated_at WHERE created_at IS NULL/,
    )
  })
})
