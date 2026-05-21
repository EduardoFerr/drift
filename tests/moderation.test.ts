import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import {
  getReportThreshold,
  getReportWeight,
  calculateEffectiveReportWeight,
} from '../src/lib/moderation'

describe('getReportWeight', () => {
  it('peso < 20 (identidade nova) → 0.5', () => {
    expect(getReportWeight(0)).toBe(0.5)
    expect(getReportWeight(19.99)).toBe(0.5)
  })

  it('20-49 (estabelecida) → 1.0', () => {
    expect(getReportWeight(20)).toBe(1.0)
    expect(getReportWeight(49.99)).toBe(1.0)
  })

  it('50-74 (longa data) → 1.5', () => {
    expect(getReportWeight(50)).toBe(1.5)
    expect(getReportWeight(74.99)).toBe(1.5)
  })

  it('75+ (veterana muito engajada) → 2.0', () => {
    expect(getReportWeight(75)).toBe(2.0)
    expect(getReportWeight(100)).toBe(2.0)
  })

  it('é monotônico — peso maior do reporter dá peso de report >= ', () => {
    let prev = 0
    for (let w = 0; w <= 100; w += 5) {
      const r = getReportWeight(w)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })
})

describe('getReportThreshold', () => {
  it('comunidade pequena tem threshold mínimo de 5', () => {
    expect(getReportThreshold(0, 'spam')).toBe(5)
    expect(getReportThreshold(100, 'spam')).toBe(5)
    expect(getReportThreshold(4999, 'spam')).toBe(5)
  })

  it('threshold cresce com 0.1% da base ativa', () => {
    expect(getReportThreshold(5000, 'spam')).toBe(5)
    expect(getReportThreshold(10000, 'spam')).toBe(10)
    expect(getReportThreshold(50000, 'spam')).toBe(50)
    expect(getReportThreshold(1_000_000, 'spam')).toBe(1000)
  })

  it("'illegal' tem threshold 2x menor (mas piso 3)", () => {
    // base 5 → illegal floor(5/2) = 2, mas Math.max(3, ...) = 3
    expect(getReportThreshold(0, 'illegal')).toBe(3)
    // base 100 → 5/2 = 2 → max(3, 2) = 3
    expect(getReportThreshold(100, 'illegal')).toBe(3)
    // base 10000 → spam=10, illegal=floor(10/2)=5, max(3,5)=5
    expect(getReportThreshold(10000, 'illegal')).toBe(5)
    // base 50000 → spam=50, illegal=25
    expect(getReportThreshold(50000, 'illegal')).toBe(25)
  })

  it("'illegal' threshold sempre <= 'spam' threshold (sempre mais agressivo)", () => {
    for (const base of [0, 100, 1000, 10000, 100000, 1000000]) {
      expect(getReportThreshold(base, 'illegal')).toBeLessThanOrEqual(
        getReportThreshold(base, 'spam'),
      )
    }
  })

  it("'harassment' tem mesmo threshold de 'spam' (menos agressivo que illegal)", () => {
    for (const base of [0, 100, 1000, 10000]) {
      expect(getReportThreshold(base, 'harassment')).toBe(getReportThreshold(base, 'spam'))
    }
  })

  it('é determinístico — sempre o mesmo número pra mesma entrada', () => {
    const r1 = getReportThreshold(50000, 'illegal')
    const r2 = getReportThreshold(50000, 'illegal')
    expect(r1).toBe(r2)
  })
})

// ─── Gap A: Time-window decay nos reports (Barney devsec 2026-05-21) ─

describe('calculateEffectiveReportWeight (Gap A)', () => {
  const H = 48 * 60 * 60 * 1000 // 48h half-life

  it('age=0 → decay 1.0 (peso full)', () => {
    expect(calculateEffectiveReportWeight(2.0, 0, H)).toBe(2.0)
  })

  it('age negativo (clock skew futuro) → decay 1.0 (não crash)', () => {
    expect(calculateEffectiveReportWeight(2.0, -5000, H)).toBe(2.0)
  })

  it('age = halfLife → peso × 0.5 bit-exact', () => {
    expect(calculateEffectiveReportWeight(2.0, H, H)).toBeCloseTo(1.0, 12)
  })

  it('age = 2× halfLife → peso × 0.25', () => {
    expect(calculateEffectiveReportWeight(2.0, 2 * H, H)).toBeCloseTo(0.5, 12)
  })

  it('halfLife <= 0 (semantics OFF / defensive) → retorna peso bruto', () => {
    expect(calculateEffectiveReportWeight(2.0, 9999999, 0)).toBe(2.0)
    expect(calculateEffectiveReportWeight(2.0, 9999999, -1)).toBe(2.0)
    expect(calculateEffectiveReportWeight(2.0, 9999999, NaN)).toBe(2.0)
  })

  it('brigada slow-burn 24h (5 reports, espaçados 6h cada) — defesa ~15%', () => {
    // Ages: 0h, 6h, 12h, 18h, 24h. Weight bruto 2.0 cada (veterano).
    const ages = [0, 6, 12, 18, 24].map((h) => h * 60 * 60 * 1000)
    const total = ages
      .map((a) => calculateEffectiveReportWeight(2.0, a, H))
      .reduce((s, w) => s + w, 0)
    // Raw seria 10.0; com decay 48h half-life ≈ 8.47
    expect(total).toBeCloseTo(8.47, 1)
    expect(total).toBeLessThan(10) // perda real
  })

  it('brigada flash 1h (5 reports em 1h) — defesa quase ZERO (limitação documentada)', () => {
    // Ages 0, 15min, 30min, 45min, 60min. Esperado: time-decay NÃO defende.
    const ages = [0, 15, 30, 45, 60].map((m) => m * 60 * 1000)
    const total = ages
      .map((a) => calculateEffectiveReportWeight(2.0, a, H))
      .reduce((s, w) => s + w, 0)
    // Raw 10.0; com 48h half-life total ≈ 9.93 (≈0.7% perda)
    expect(total).toBeGreaterThan(9.9)
    // ⚠ Documenta limitação: brigada flash <1h passa quase intacta.
    // Defesa real exige GAP-CLUSTER (cluster detection). known-limitations §5c.
  })

  it('consenso lento 5 reports/120h — peso efetivo cai bastante (trade-off aceito)', () => {
    const ages = [0, 24, 48, 72, 120].map((h) => h * 60 * 60 * 1000)
    const total = ages
      .map((a) => calculateEffectiveReportWeight(2.0, a, H))
      .reduce((s, w) => s + w, 0)
    // Esperado: ~5.47 (perda ~45% vs raw 10.0)
    expect(total).toBeCloseTo(5.47, 1)
    expect(total).toBeLessThan(10)
    // ⚠ Trade-off: consenso muito lento exige MAIS reports pra moderar.
    // Aceito até GAP-CLUSTER pra diferenciar de brigada
  })

  it('feature OFF (halfLife=0) preserva backward compat bit-exact', () => {
    const ages = [0, 24, 48, 120].map((h) => h * 60 * 60 * 1000)
    const rawSum = ages.length * 2.0 // 8.0 (4 reports × 2.0)
    const sumOff = ages
      .map((a) => calculateEffectiveReportWeight(2.0, a, 0))
      .reduce((s, w) => s + w, 0)
    expect(sumOff).toBe(rawSum)
  })
})
