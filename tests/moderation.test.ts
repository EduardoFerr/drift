import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import { getReportThreshold, getReportWeight } from '../src/lib/moderation'

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
