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
import { computeRanking } from '../src/lib/ranking'
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
  it('D7: a ordenação do feed tem tie-break determinístico por id', () => {
    const feed = read('src/lib/feed.ts')
    // Desde a correção de D1 as 3 queries compartilham uma constante
    // (`FEED_ORDER`) em vez de repetir o ORDER BY literalmente — por
    // isso a asserção mudou de forma. O tie-break continua obrigatório:
    // manifesto §8 exige `score DESC, created_at DESC, id ASC`. Sem o
    // terceiro critério, empates (numerador 0 é comum) resolvem pelo
    // plano de query do SQLite e dois clientes divergem, violando §7.
    const ordenacao = feed.match(/const FEED_ORDER = `([^`]+)`/)
    expect(ordenacao, 'feed.ts deve definir FEED_ORDER').toBeTruthy()
    expect(ordenacao![1], 'ORDER BY sem tie-break por id').toMatch(/p\.created_at DESC, p\.id ASC/)

    // E todas as queries precisam usá-la — nenhuma pode ter ordenação
    // própria (a aba Contágio, §24 emendado, muda só o conjunto; os
    // candidatos da lente vêm na mesma ordem e a lente decide a ordem final
    // em memória, só em Global e Em alta).
    expect((feed.match(/ORDER BY/g) ?? []).length, 'ORDER BY fora de FEED_ORDER').toBe(1)
    const usos = feed.match(/\$\{FEED_ORDER\}/g) ?? []
    expect(usos.length, 'as 4 abas e os candidatos da lente devem usar FEED_ORDER').toBe(5)
  })

  // D2/D3 eram verificados procurando strings na SQL de events.ts. O
  // peso agora vive no motor puro `ranking.ts`; as mesmas regras são
  // verificadas pelo COMPORTAMENTO (e ponta a ponta em
  // tests/algorithm-invariants.test.ts).
  const YEAR_AGO = 1_790_000_000 - 365 * 86_400
  const rank = (extra: Partial<Parameters<typeof computeRanking>[0]>) =>
    computeRanking({
      nowMs: 1_790_000_000_000,
      posts: [],
      spreads: [],
      buries: [],
      comments: [],
      reports: [],
      users: [],
      anchors: new Map(),
      ...extra,
    })

  it('D3: auto-spread não dá engajamento ao autor', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, author_pub: 'a', created_at: 1_790_000_000 }))
    const spreads = posts.map((p) => ({ post_id: p.id, user_pub: 'a', created_at: 1_790_000_000, event_id: `s${p.id}` }))
    const out = rank({ posts, spreads, anchors: new Map([['a', YEAR_AGO]]) })
    expect(out.weights.get('a')).toBe(40) // só antiguidade
  })

  it('D2: post moderado custa REPORT_CONFIRMED (−15) no peso que afeta o ranking', () => {
    const reporters = Array.from({ length: 7 }, (_, i) => `r${i}`)
    const anchors = new Map<string, number>([
      ['a', YEAR_AGO],
      ...reporters.map((r) => [r, YEAR_AGO] as [string, number]),
      ...Array.from({ length: 6 }, (_, i) => [`fan${i}`, YEAR_AGO] as [string, number]),
    ])
    const posts = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `liked${i}`, author_pub: 'a', created_at: 1_790_000_000 })),
      { id: 'bad', author_pub: 'a', created_at: 1_790_000_000 },
    ]
    // 6 fãs × 1 post × 10 × 40/100 = 24 (longe da saturação em 60).
    const spreads = posts
      .filter((p) => p.id === 'liked0')
      .flatMap((p) => Array.from({ length: 6 }, (_, i) => ({ post_id: p.id, user_pub: `fan${i}`, created_at: 1_790_000_000, event_id: `${p.id}${i}` })))
    const reports = reporters.map((r) => ({ post_id: 'bad', reporter_pub: r, reason: 'spam' as const, created_at: 1_790_000_000 }))
    const sem = rank({ posts, spreads, anchors })
    const com = rank({ posts, spreads, anchors, reports })
    expect(com.posts.get('bad')!.moderated).toBe(true)
    expect(sem.weights.get('a')).toBeCloseTo(40 + 24, 9)
    expect(com.weights.get('a')).toBeCloseTo(40 + 24 - 15, 9)
  })

  it('-999 é constante nomeada, não literal solto no pipeline de score', () => {
    expect(MODERATED_SCORE).toBe(-999)
  })
})
