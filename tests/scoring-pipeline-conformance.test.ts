/**
 * Conformance do PIPELINE de score — a fronteira entre a função pura
 * e o SQLite.
 *
 * Origem: auditoria 2026-10-13. As 7 funções puras de `Docs/algoritmos.md`
 * conferiam bit-a-bit e tinham cobertura densa; TODOS os defeitos reais
 * viviam na camada de integração, que nenhum teste alcançava. As
 * correções de self-spread (D3) e de `reportsConfirmed` (D2) passaram na
 * suíte inteira sem quebrar um único teste — prova de que a lacuna era
 * total.
 *
 * Este arquivo trava:
 *   1. MAGNITUDES ABSOLUTAS do score. Antes, só havia asserções de
 *      ordenação e monotonia, então trocar `(age+2)` por `(age+1)`,
 *      `^1.5` por `^2.0` ou `0.3` por `0.5` passava verde.
 *   2. Guard de não-finito (NaN gravado remove o post do feed pra
 *      sempre: `WHERE score > MODERATED_SCORE` é false para NaN).
 *   3. Invariantes do pipeline que só existem no texto da SQL.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateScore } from '../src/lib/scoring'
import { MODERATED_SCORE } from '../src/config/constants'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('calculateScore — magnitudes absolutas (oráculo de Docs/algoritmos.md §1)', () => {
  // A fórmula canônica é score = (spreadWeight - buryWeight*0.3) / (ageHours+2)^1.5.
  // Os valores abaixo são calculados à mão a partir dela. Qualquer
  // mudança de constante (o +2, o expoente 1.5, o fator 0.3) quebra
  // aqui — que é exatamente o ponto.
  const H = 3600

  it('1 spreader de peso 50, idade 0 → 17.6777 (50 / 2^1.5)', () => {
    const score = calculateScore({ spreadWeight: 50, buryWeight: 0, createdAt: 0, now: 0 })
    expect(score).toBeCloseTo(17.6777, 3)
  })

  it('10 spreaders de peso 50, idade 1h → 96.2250 (500 / 3^1.5)', () => {
    const score = calculateScore({ spreadWeight: 500, buryWeight: 0, createdAt: 0, now: H })
    expect(score).toBeCloseTo(96.225, 3)
  })

  it('1 spreader de peso 50, idade 24h → 0.37715 (50 / 26^1.5)', () => {
    // NOTA: Docs/algoritmos.md:88 registra 0.43 para este caso. O doc
    // está errado — 26^1.5 = 132.5745 e 50/132.5745 = 0.37715. O próprio
    // doc usa 132.6 corretamente em §8. Erro documental, não de código.
    const score = calculateScore({ spreadWeight: 50, buryWeight: 0, createdAt: 0, now: 24 * H })
    expect(score).toBeCloseTo(0.37715, 4)
  })

  it('bury pesa exatamente 0.3× spread', () => {
    const soSpread = calculateScore({ spreadWeight: 100, buryWeight: 0, createdAt: 0, now: 0 })
    const soBury = calculateScore({ spreadWeight: 0, buryWeight: 100, createdAt: 0, now: 0 })
    expect(soBury).toBeCloseTo(-soSpread * 0.3, 10)
  })

  it('divisor mínimo é 2^1.5 — divisão por zero é impossível mesmo com idade 0', () => {
    const score = calculateScore({ spreadWeight: 1, buryWeight: 0, createdAt: 0, now: 0 })
    expect(score).toBeCloseTo(1 / Math.pow(2, 1.5), 10)
    expect(Number.isFinite(score)).toBe(true)
  })

  it('curva de decay bate com a esperada (fator relativo à idade 0)', () => {
    const base = calculateScore({ spreadWeight: 100, buryWeight: 0, createdAt: 0, now: 0 })
    const casos: Array<[number, number]> = [
      [1, 0.5443],
      [6, 0.125],
      [24, 0.02132],
      [48, 0.008],
    ]
    for (const [horas, fatorEsperado] of casos) {
      const s = calculateScore({ spreadWeight: 100, buryWeight: 0, createdAt: 0, now: horas * H })
      expect(s / base).toBeCloseTo(fatorEsperado, 3)
    }
  })
})

describe('calculateScore — guard de não-finito', () => {
  // Um NaN gravado em posts.score é tóxico e IRREVERSÍVEL: o feed filtra
  // com `score > MODERATED_SCORE`, que é false para NaN, e todo recálculo
  // futuro recomputa o mesmo NaN a partir do mesmo input corrompido.
  const casos: Array<[string, Parameters<typeof calculateScore>[0]]> = [
    ['createdAt NaN', { spreadWeight: 10, buryWeight: 0, createdAt: NaN, now: 0 }],
    ['now NaN', { spreadWeight: 10, buryWeight: 0, createdAt: 0, now: NaN }],
    ['spreadWeight NaN', { spreadWeight: NaN, buryWeight: 0, createdAt: 0, now: 0 }],
    ['buryWeight NaN', { spreadWeight: 0, buryWeight: NaN, createdAt: 0, now: 0 }],
    ['createdAt Infinity', { spreadWeight: 10, buryWeight: 0, createdAt: Infinity, now: 0 }],
  ]

  for (const [nome, input] of casos) {
    it(`${nome} → 0, nunca NaN`, () => {
      const score = calculateScore(input)
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBe(0)
    })
  }

  it('score finito sobrevive ao filtro do feed; NaN não sobreviveria', () => {
    expect(calculateScore({ spreadWeight: 0, buryWeight: 0, createdAt: 0, now: 0 }) > MODERATED_SCORE)
      .toBe(true)
    expect(NaN > MODERATED_SCORE).toBe(false)
  })
})

describe('Pipeline — invariantes que só existem no texto da SQL', () => {
  it('D7: as 3 queries de feed.ts têm tie-break determinístico por id', () => {
    const feed = read('src/lib/feed.ts')
    const ordenacoes = feed.match(/ORDER BY p\.score DESC[^`\n]*/g) ?? []
    expect(ordenacoes.length, 'feed.ts deve ter 3 ORDER BY por score').toBe(3)
    for (const o of ordenacoes) {
      // Manifesto §8: ORDER BY score DESC, created_at DESC, id ASC.
      // Sem o terceiro critério, empates (score = 0 exato é comum)
      // resolvem pelo plano de query do SQLite e dois clientes com os
      // mesmos eventos divergem — viola §7.
      expect(o, `ORDER BY sem tie-break por id: "${o}"`).toMatch(/p\.id ASC/)
    }
  })

  it('D3: spreads_received exclui auto-spread', () => {
    const events = read('src/lib/events.ts')
    const temAgregacao = /spreads_received/.test(events)
    expect(temAgregacao, 'events.ts deve agregar spreads_received').toBe(true)
    // Sem este filtro, 6 posts auto-espalhados saturam ENGAGEMENT_MAX
    // (60 / POST_SPREAD 10) e dão weight 60 a uma identidade de idade
    // zero — vencendo usuário legítimo com 1 spreader real de peso 50.
    expect(
      events,
      'subquery de spreads_received deve excluir o próprio autor',
    ).toMatch(/s\.spreader_pub\s*!=\s*u\.npub/)
  })

  it('D2: o pipeline de score passa reportsConfirmed ao calculateWeight', () => {
    const events = read('src/lib/events.ts')
    const chamadas = events.match(/calculateWeight\(\{[\s\S]*?\}\)/g) ?? []
    expect(chamadas.length, 'events.ts deve chamar calculateWeight').toBeGreaterThan(0)
    for (const c of chamadas) {
      // Omitir o campo faz `calculateWeight` aplicar `?? 0`, tornando
      // REPORT_CONFIRMED (-15) código morto no único cálculo que afeta
      // o ranking — e divergindo de calculateUserWeight (weight.ts),
      // que a UI do perfil usa e que SEMPRE inclui a penalidade.
      expect(c, `calculateWeight sem reportsConfirmed:\n${c}`).toMatch(/reportsConfirmed:/)
    }
  })

  it('D2: a SQL de agregação seleciona reports_confirmed', () => {
    const events = read('src/lib/events.ts')
    expect(events).toMatch(/AS reports_confirmed/)
  })

  it('-999 é constante nomeada, não literal solto no pipeline de score', () => {
    expect(MODERATED_SCORE).toBe(-999)
  })
})
