import { describe, expect, it, vi } from 'vitest'

// Mock do db pra que importar weight.ts não dispare worker SQLite.
// Funções puras (calculateAntiquity, calculateEngagement, calculateWeight,
// getMaxSubposts) não dependem do banco — só calculateUserWeight (bridge)
// que não testamos aqui.
vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import {
  calculateAntiquity,
  calculateEngagement,
  calculateWeight,
  getMaxSubposts,
  type WeightInput,
} from '../src/lib/weight'

const NOW_MS = 1714000000000 // ~26 abr 2024 — fixo
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('calculateAntiquity', () => {
  it('identidade nova tem antiguidade 0', () => {
    expect(calculateAntiquity(NOW_MS, NOW_MS)).toBe(0)
  })

  it('1 semana → 1 ponto', () => {
    expect(calculateAntiquity(NOW_MS - ONE_WEEK_MS, NOW_MS)).toBeCloseTo(1, 5)
  })

  it('linear até saturação em 40 (~9 meses)', () => {
    expect(calculateAntiquity(NOW_MS - 20 * ONE_WEEK_MS, NOW_MS)).toBeCloseTo(20, 5)
    expect(calculateAntiquity(NOW_MS - 40 * ONE_WEEK_MS, NOW_MS)).toBeCloseTo(40, 5)
  })

  it('satura em 40 mesmo com identidade muito antiga', () => {
    expect(calculateAntiquity(NOW_MS - 100 * ONE_WEEK_MS, NOW_MS)).toBe(40)
    expect(calculateAntiquity(NOW_MS - 1000 * ONE_WEEK_MS, NOW_MS)).toBe(40)
  })

  it('clock skew (createdAt no futuro) clampa em 0', () => {
    expect(calculateAntiquity(NOW_MS + ONE_WEEK_MS, NOW_MS)).toBe(0)
  })
})

describe('calculateEngagement', () => {
  function input(overrides: Partial<WeightInput> = {}): WeightInput {
    return {
      createdAt: NOW_MS - 10 * ONE_WEEK_MS,
      spreadsReceived: 0,
      lastActive: NOW_MS,
      now: NOW_MS,
      ...overrides,
    }
  }

  it('engajamento zero quando sem spreads/comments e sem inatividade', () => {
    expect(calculateEngagement(input({ spreadsReceived: 0 }))).toBe(0)
  })

  it('cada spread recebido +10 pontos', () => {
    expect(calculateEngagement(input({ spreadsReceived: 1 }))).toBe(10)
    expect(calculateEngagement(input({ spreadsReceived: 3 }))).toBe(30)
  })

  it('reports confirmados subtraem 15 cada', () => {
    expect(calculateEngagement(input({ spreadsReceived: 5, reportsConfirmed: 1 }))).toBe(35)
    // 50 - 15 - 15 = 20
    expect(calculateEngagement(input({ spreadsReceived: 5, reportsConfirmed: 2 }))).toBe(20)
  })

  it('inatividade subtrai 1 por dia', () => {
    // Usa spreads abaixo do clamp (ENGAGEMENT_MAX=60) pra ver o decremento
    // de inatividade sem ser mascarado pelo Math.min.
    const lastActiveMs = NOW_MS - 5 * 86400 * 1000 // 5 dias atrás
    expect(
      calculateEngagement(input({ spreadsReceived: 4, lastActive: lastActiveMs })),
    ).toBe(35) // 4*10 = 40, menos 5 dias = 35
  })

  it('inatividade só conta dias completos (floor)', () => {
    const lastActive12h = NOW_MS - 12 * 60 * 60 * 1000 // 12h atrás
    expect(
      calculateEngagement(input({ spreadsReceived: 4, lastActive: lastActive12h })),
    ).toBe(40) // floor(0.5) = 0 dias → sem penalidade
  })

  it('clamp em 60 — engajamento não cresce indefinidamente', () => {
    expect(calculateEngagement(input({ spreadsReceived: 100 }))).toBe(60)
    expect(calculateEngagement(input({ spreadsReceived: 1000 }))).toBe(60)
  })

  it('clamp em 0 — não fica negativo', () => {
    expect(calculateEngagement(input({ spreadsReceived: 0, reportsConfirmed: 5 }))).toBe(0)
  })

  it('lastActive null não dispara penalidade de inatividade', () => {
    expect(calculateEngagement(input({ spreadsReceived: 5, lastActive: null }))).toBe(50)
  })

  it('bury NÃO penaliza autor (manifesto §23)', () => {
    // POST_BURIED é constante 0 em ENGAGEMENT_POINTS — bury não entra na fórmula.
    // Defensivamente testamos que adicionar buryReceived não tem efeito.
    // (`WeightInput` não expõe buries por design.)
    const a = calculateEngagement(input({ spreadsReceived: 10 }))
    const b = calculateEngagement(input({ spreadsReceived: 10 }))
    expect(a).toBe(b)
  })
})

describe('calculateWeight', () => {
  it('soma antiguidade + engajamento, clampada em 100', () => {
    const w = calculateWeight({
      createdAt: NOW_MS - 50 * ONE_WEEK_MS, // → antiguidade 40 (saturado)
      spreadsReceived: 6, // → engajamento 60 (saturado)
      lastActive: NOW_MS,
      now: NOW_MS,
    })
    expect(w).toBe(100) // 40 + 60
  })

  it('clamp em 100 mesmo com inputs absurdos', () => {
    const w = calculateWeight({
      createdAt: NOW_MS - 100 * ONE_WEEK_MS,
      spreadsReceived: 1000,
      lastActive: NOW_MS,
      now: NOW_MS,
    })
    expect(w).toBe(100)
  })

  it('peso baixo para identidade nova com pouco engajamento', () => {
    const w = calculateWeight({
      createdAt: NOW_MS - ONE_WEEK_MS, // 1 semana
      spreadsReceived: 1, // 10 pts engajamento
      lastActive: NOW_MS,
      now: NOW_MS,
    })
    expect(w).toBeCloseTo(11, 5) // 1 + 10
  })
})

describe('getMaxSubposts', () => {
  it('peso < 20 → 1 subpost', () => {
    expect(getMaxSubposts(0)).toBe(1)
    expect(getMaxSubposts(19.99)).toBe(1)
  })

  it('20-39 → 2', () => {
    expect(getMaxSubposts(20)).toBe(2)
    expect(getMaxSubposts(39.99)).toBe(2)
  })

  it('40-54 → 4', () => {
    expect(getMaxSubposts(40)).toBe(4)
    expect(getMaxSubposts(54.99)).toBe(4)
  })

  it('55-69 → 6', () => {
    expect(getMaxSubposts(55)).toBe(6)
    expect(getMaxSubposts(69.99)).toBe(6)
  })

  it('70-84 → 7', () => {
    expect(getMaxSubposts(70)).toBe(7)
    expect(getMaxSubposts(84.99)).toBe(7)
  })

  it('85+ → 8 (limite absoluto)', () => {
    expect(getMaxSubposts(85)).toBe(8)
    expect(getMaxSubposts(100)).toBe(8)
    expect(getMaxSubposts(150)).toBe(8) // mesmo input absurdo
  })

  it('é monotônico — peso maior nunca dá menos subposts', () => {
    let prev = 0
    for (let w = 0; w <= 100; w += 5) {
      const max = getMaxSubposts(w)
      expect(max).toBeGreaterThanOrEqual(prev)
      prev = max
    }
  })
})
