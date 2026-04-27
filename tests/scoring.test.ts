import { describe, expect, it } from 'vitest'
import { calculateScore } from '../src/lib/scoring'

const NOW = 1714000000 // unix seconds — base fixa pra todos os testes

describe('calculateScore', () => {
  it('post recém-criado sem interação tem score zero', () => {
    expect(calculateScore({ spreads: 0, buries: 0, createdAt: NOW, now: NOW })).toBe(0)
  })

  it('spreads aumentam score', () => {
    const a = calculateScore({ spreads: 0, buries: 0, createdAt: NOW, now: NOW })
    const b = calculateScore({ spreads: 5, buries: 0, createdAt: NOW, now: NOW })
    expect(b).toBeGreaterThan(a)
  })

  it('buries reduzem score (mas com peso 0.3, não 1.0)', () => {
    const buryOnly = calculateScore({ spreads: 0, buries: 10, createdAt: NOW, now: NOW })
    const spreadOnly = calculateScore({ spreads: 10, buries: 0, createdAt: NOW, now: NOW })
    // |bury impact| === 0.3 × |spread impact|
    expect(Math.abs(buryOnly)).toBeCloseTo(0.3 * spreadOnly, 5)
  })

  it('post mais velho com mesmas interações tem score menor (decay temporal)', () => {
    const recent = calculateScore({ spreads: 10, buries: 0, createdAt: NOW, now: NOW })
    const oneHourOld = calculateScore({
      spreads: 10,
      buries: 0,
      createdAt: NOW - 3600,
      now: NOW,
    })
    const oneDayOld = calculateScore({
      spreads: 10,
      buries: 0,
      createdAt: NOW - 86400,
      now: NOW,
    })
    expect(recent).toBeGreaterThan(oneHourOld)
    expect(oneHourOld).toBeGreaterThan(oneDayOld)
  })

  it('idade negativa (clock skew) é clamped em 0 — sem score infinito', () => {
    const future = calculateScore({
      spreads: 5,
      buries: 0,
      createdAt: NOW + 1000,
      now: NOW,
    })
    const exactlyNow = calculateScore({ spreads: 5, buries: 0, createdAt: NOW, now: NOW })
    // ageHours clampado em 0 → mesmo divisor que `now == createdAt`
    expect(future).toBe(exactlyNow)
  })

  it('é determinístico — mesma entrada sempre dá mesma saída', () => {
    const input = { spreads: 7, buries: 3, createdAt: NOW - 5000, now: NOW }
    const r1 = calculateScore(input)
    const r2 = calculateScore(input)
    const r3 = calculateScore({ ...input })
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
  })

  it('score é simétrico para o mesmo netEngagement em ages distintos', () => {
    // A premissa central do feed: dois posts com mesmo (spreads - 0.3*buries)
    // e mesma idade têm score idêntico independente da combinação específica
    // que produziu aquele net.
    const a = calculateScore({ spreads: 10, buries: 0, createdAt: NOW - 3600, now: NOW })
    const b = calculateScore({ spreads: 13, buries: 10, createdAt: NOW - 3600, now: NOW })
    // Net A: 10. Net B: 13 - 3 = 10. Iguais.
    expect(a).toBeCloseTo(b, 10)
  })

  it('decai suavemente — meia-vida em horas, não minutos', () => {
    const t0 = calculateScore({ spreads: 10, buries: 0, createdAt: NOW, now: NOW })
    const t1h = calculateScore({ spreads: 10, buries: 0, createdAt: NOW - 3600, now: NOW })
    const t12h = calculateScore({
      spreads: 10,
      buries: 0,
      createdAt: NOW - 12 * 3600,
      now: NOW,
    })
    // Após 1h, score retém >50% do original. Curva suave.
    expect(t1h / t0).toBeGreaterThan(0.5)
    // Após 12h, score caiu mas ainda é positivo e relevante.
    expect(t12h).toBeGreaterThan(0)
    expect(t12h / t0).toBeLessThan(0.2)
  })
})
