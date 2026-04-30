import { describe, expect, it } from 'vitest'
import { calculateScore } from '../src/lib/scoring'

const NOW = 1714000000 // unix seconds — base fixa pra todos os testes

/**
 * Atualizado 2026-04-29: scoring agora soma PESOS dos spreaders/buriers
 * em vez de contar eventos. Inputs renomeados de `spreads`/`buries` pra
 * `spreadWeight`/`buryWeight` — semântica é "soma do weight da identidade
 * de cada user que tem ação líquida 'spread' ou 'bury'".
 *
 * Marshall: ataca Sybil (npub novo → weight 0 → spread vale 0).
 * Manifesto §22 (determinístico) + §11 (sem afinidade) preservados.
 */

describe('calculateScore', () => {
  it('post recém-criado sem interação tem score zero', () => {
    expect(
      calculateScore({ spreadWeight: 0, buryWeight: 0, createdAt: NOW, now: NOW }),
    ).toBe(0)
  })

  it('spreadWeight aumenta score', () => {
    const a = calculateScore({ spreadWeight: 0, buryWeight: 0, createdAt: NOW, now: NOW })
    const b = calculateScore({ spreadWeight: 50, buryWeight: 0, createdAt: NOW, now: NOW })
    expect(b).toBeGreaterThan(a)
  })

  it('buryWeight reduz score (mas com peso 0.3, não 1.0)', () => {
    const buryOnly = calculateScore({
      spreadWeight: 0,
      buryWeight: 100,
      createdAt: NOW,
      now: NOW,
    })
    const spreadOnly = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW,
      now: NOW,
    })
    // |bury impact| === 0.3 × |spread impact|
    expect(Math.abs(buryOnly)).toBeCloseTo(0.3 * spreadOnly, 5)
  })

  it('post mais velho com mesmas interações tem score menor (decay temporal)', () => {
    const recent = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW,
      now: NOW,
    })
    const oneHourOld = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW - 3600,
      now: NOW,
    })
    const oneDayOld = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW - 86400,
      now: NOW,
    })
    expect(recent).toBeGreaterThan(oneHourOld)
    expect(oneHourOld).toBeGreaterThan(oneDayOld)
  })

  it('idade negativa (clock skew) é clamped em 0 — sem score infinito', () => {
    const future = calculateScore({
      spreadWeight: 50,
      buryWeight: 0,
      createdAt: NOW + 1000,
      now: NOW,
    })
    const exactlyNow = calculateScore({
      spreadWeight: 50,
      buryWeight: 0,
      createdAt: NOW,
      now: NOW,
    })
    // ageHours clampado em 0 → mesmo divisor que `now == createdAt`
    expect(future).toBe(exactlyNow)
  })

  it('é determinístico — mesma entrada sempre dá mesma saída', () => {
    const input = { spreadWeight: 70, buryWeight: 30, createdAt: NOW - 5000, now: NOW }
    const r1 = calculateScore(input)
    const r2 = calculateScore(input)
    const r3 = calculateScore({ ...input })
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
  })

  it('score é simétrico para o mesmo netEngagement em ages distintos', () => {
    // Dois posts com mesmo (spreadWeight - 0.3*buryWeight) e mesma idade
    // têm score idêntico independente da combinação que produziu aquele net.
    const a = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW - 3600,
      now: NOW,
    })
    const b = calculateScore({
      spreadWeight: 130,
      buryWeight: 100,
      createdAt: NOW - 3600,
      now: NOW,
    })
    // Net A: 100. Net B: 130 - 30 = 100. Iguais.
    expect(a).toBeCloseTo(b, 10)
  })

  it('decai suavemente — meia-vida em horas, não minutos', () => {
    const t0 = calculateScore({ spreadWeight: 100, buryWeight: 0, createdAt: NOW, now: NOW })
    const t1h = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW - 3600,
      now: NOW,
    })
    const t12h = calculateScore({
      spreadWeight: 100,
      buryWeight: 0,
      createdAt: NOW - 12 * 3600,
      now: NOW,
    })
    // Após 1h, score retém >50% do original. Curva suave.
    expect(t1h / t0).toBeGreaterThan(0.5)
    // Após 12h, score caiu mas ainda é positivo e relevante.
    expect(t12h).toBeGreaterThan(0)
    expect(t12h / t0).toBeLessThan(0.2)
  })

  // ─── Novos cases — semântica weighted (Marshall, 2026-04-29) ───

  it('weighted: 1 user weight 60 supera 100 Sybils weight 0', () => {
    // Atacante: 100 npubs novos auto-espalham → cada um weight ~0.
    // User real: 1 npub estabelecido com weight 60 espalha 1 vez.
    // User real deve dominar — Sybil engagement é mitigado.
    const sybilAttack = calculateScore({
      spreadWeight: 100 * 0, // 100 spreaders, todos peso 0
      buryWeight: 0,
      createdAt: NOW,
      now: NOW,
    })
    const realUser = calculateScore({
      spreadWeight: 60, // 1 spreader, peso 60
      buryWeight: 0,
      createdAt: NOW,
      now: NOW,
    })
    expect(realUser).toBeGreaterThan(sybilAttack)
    expect(sybilAttack).toBe(0) // nada de peso → zero
  })

  it('weighted: peso 0 não altera score (Sybil-resistente)', () => {
    // Enxame de Sybils com weight 0 não consegue inflar nem derrubar
    const baseline = calculateScore({
      spreadWeight: 50,
      buryWeight: 50,
      createdAt: NOW,
      now: NOW,
    })
    const withSybilSpreaders = calculateScore({
      spreadWeight: 50 + 0 * 1000, // 1000 Sybil-spreads de peso 0
      buryWeight: 50,
      createdAt: NOW,
      now: NOW,
    })
    expect(withSybilSpreaders).toBe(baseline)
  })

  it('weighted: clamp negativo — buryWeight pode dominar', () => {
    // Post com poucos spreads e muitos buries pesados → score negativo
    const flagged = calculateScore({
      spreadWeight: 10,
      buryWeight: 100,
      createdAt: NOW,
      now: NOW,
    })
    expect(flagged).toBeLessThan(0)
  })
})
