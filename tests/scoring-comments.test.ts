/**
 * Track C.5 — testes de scoring de comments.
 *
 * Cobre função pura `applyCommentReceived` e (em integração leve com db
 * mockado) o pipeline de `recalculateScore` em `events.ts` que filtra
 * self-comments + dedup distinct commenters.
 *
 * Issues cobertos:
 *  - Ted #3 (design-comments.md §15) — weight semantics (current, não
 *    snapshot). Verificado por chamada direta com weight conhecido.
 *  - Barney HIGH #3 — exclude self-comments. Verificado pela query SQL
 *    em recalculateScore: `c.author_pub != p.author_pub` filtra.
 *  - Cap por COMMENTS_SCORE_CAP — weightedTotal acima do cap satura.
 *  - Distinct commenters — N comments do mesmo author contam 1× (já
 *    via SELECT DISTINCT no pipeline; pure function aceita o total já
 *    deduped).
 *
 * Tests rodam em Node, sem React/SQLite WASM.
 */

import { describe, expect, it } from 'vitest'
import { applyCommentReceived } from '../src/lib/scoring'
import { computeRanking } from '../src/lib/ranking'
import { COMMENTS_SCORE_CAP, ENGAGEMENT_POINTS } from '../src/config/constants'

describe('applyCommentReceived (pure)', () => {
  it('input zero não altera score', () => {
    expect(
      applyCommentReceived({
        distinctCommenters: 0,
        weightedTotal: 0,
        currentScore: 5,
      }),
    ).toBe(5)
  })

  it('weightedTotal abaixo do cap aplica linearmente', () => {
    const out = applyCommentReceived({
      distinctCommenters: 3,
      weightedTotal: 10, // < CAP (30)
      currentScore: 100,
    })
    // Δ = 10 * COMMENT_RECEIVED (+1) = 10 → 100 + 10 = 110
    expect(out).toBe(100 + 10 * ENGAGEMENT_POINTS.COMMENT_RECEIVED)
  })

  it('weightedTotal exatamente no cap não satura ainda', () => {
    const out = applyCommentReceived({
      distinctCommenters: 5,
      weightedTotal: COMMENTS_SCORE_CAP, // exato
      currentScore: 0,
    })
    expect(out).toBe(COMMENTS_SCORE_CAP * ENGAGEMENT_POINTS.COMMENT_RECEIVED)
  })

  it('weightedTotal acima do cap é capped (anti-Sybil)', () => {
    const huge = applyCommentReceived({
      distinctCommenters: 1000,
      weightedTotal: 99999, // muito acima do cap
      currentScore: 0,
    })
    const atCap = applyCommentReceived({
      distinctCommenters: 1,
      weightedTotal: COMMENTS_SCORE_CAP,
      currentScore: 0,
    })
    // Cap satura — 1000 sybils com weight inflado contam = 1 user no cap
    expect(huge).toBe(atCap)
    expect(huge).toBe(COMMENTS_SCORE_CAP * ENGAGEMENT_POINTS.COMMENT_RECEIVED)
  })

  it('é determinístico — mesmo input → mesmo output', () => {
    const input = {
      distinctCommenters: 7,
      weightedTotal: 22,
      currentScore: 1.234,
    }
    const a = applyCommentReceived(input)
    const b = applyCommentReceived({ ...input })
    expect(a).toBe(b)
  })

  it('preserva currentScore negativo (post moderado/buried)', () => {
    // Post com score negativo (muito buried). Comments adicionam
    // contribuição mas não "reabilitam" magicamente — ainda pode ficar
    // negativo. Determinístico.
    const out = applyCommentReceived({
      distinctCommenters: 2,
      weightedTotal: 5,
      currentScore: -50,
    })
    expect(out).toBe(-50 + 5 * ENGAGEMENT_POINTS.COMMENT_RECEIVED)
    expect(out).toBeLessThan(0)
  })

  it('cap respeita peso 0 (Sybils sem weight não inflam)', () => {
    // 100 commenters todos peso 0 → weightedTotal 0 → delta 0
    const out = applyCommentReceived({
      distinctCommenters: 100,
      weightedTotal: 0,
      currentScore: 50,
    })
    expect(out).toBe(50)
  })
})

/**
 * Conformance: verificar que a constante COMMENTS_SCORE_CAP está alinhada
 * com o intent do design (espelhar SPREADS_SCORE_CAP do manifesto §22).
 * Mudança requer atualização de Docs/comments.md e Docs/design-comments.md.
 */
describe('COMMENTS_SCORE_CAP constant', () => {
  it('está exportado e é positivo', () => {
    expect(COMMENTS_SCORE_CAP).toBeGreaterThan(0)
  })

  it('é 30 (espelha SPREADS_SCORE_CAP — design §15 + manifesto §22)', () => {
    // Lock-via-test: mudar este valor sem atualizar docs/manifesto é bug
    expect(COMMENTS_SCORE_CAP).toBe(30)
  })
})

/**
 * Comentários no motor de ranking (Barney HIGH #3) — verificado pelo
 * COMPORTAMENTO de `computeRanking`, não pelo texto da SQL. Antes estes
 * testes procuravam strings no source: trocar a implementação quebrava o
 * teste sem quebrar a regra, e quebrar a regra sem mudar a string passava.
 */
describe('Comentários no ranking (Barney HIGH #3)', () => {
  const DAY_S = 86_400
  const YEAR_AGO = 1_790_000_000 - 365 * DAY_S
  const base = (comments: Array<{ author_pub: string; hidden?: boolean }>) =>
    computeRanking({
      nowMs: 1_790_000_000_000,
      posts: [{ id: 'P', author_pub: 'autor', created_at: 1_790_000_000 }],
      spreads: [],
      buries: [],
      comments: comments.map((c) => ({ post_id: 'P', author_pub: c.author_pub, hidden: c.hidden ?? false })),
      reports: [],
      users: [],
      anchors: new Map([
        ['autor', YEAR_AGO],
        ['c1', YEAR_AGO],
        ['c2', YEAR_AGO],
      ]),
    }).posts.get('P')!.scoreBase

  it('auto-comentário do autor não conta', () => {
    expect(base([{ author_pub: 'autor' }])).toBe(0)
  })

  it('100 comentários do mesmo user contam 1× o peso dele', () => {
    const many = Array.from({ length: 100 }, () => ({ author_pub: 'c1' }))
    expect(base(many)).toBe(base([{ author_pub: 'c1' }]))
  })

  it('comentário moderado não conta', () => {
    expect(base([{ author_pub: 'c1', hidden: true }])).toBe(0)
  })

  it('soma de pesos é capada em COMMENTS_SCORE_CAP', () => {
    expect(base([{ author_pub: 'c1' }, { author_pub: 'c2' }])).toBe(
      COMMENTS_SCORE_CAP * ENGAGEMENT_POINTS.COMMENT_RECEIVED,
    )
  })
})
