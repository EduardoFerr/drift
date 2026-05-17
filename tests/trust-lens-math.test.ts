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
