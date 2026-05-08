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
 * Self-comment exclusion (Barney HIGH #3).
 *
 * A query SQL em events.ts:applyCommentsContribution faz:
 *   WHERE c.author_pub != ? AND c.score > -999
 *
 * Validação aqui é estrutural — tests de integração com SQLite real
 * vivem em e2e manual. Garantimos que o filtro está na string SQL —
 * regression guard contra remoção acidental.
 */
describe('Self-comment exclusion (regression guard, Barney HIGH #3)', () => {
  it('events.ts contém filtro author_pub != ? em comments query', async () => {
    // Lê o source. Se alguém remover o filtro, o test falha.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.resolve(__dirname, '../src/lib/events.ts'),
      'utf8',
    )
    // Filtro dentro do SELECT DISTINCT author_pub FROM comments
    expect(source).toMatch(
      /FROM comments[\s\S]*WHERE\s+post_id\s*=\s*\?\s+AND\s+author_pub\s*!=\s*\?/,
    )
    // Filtro de moderação (score > -999) também presente — manifesto §17
    expect(source).toMatch(/score\s*>\s*-999/)
  })

  it('events.ts seleciona DISTINCT author_pub (dedup commenters)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.resolve(__dirname, '../src/lib/events.ts'),
      'utf8',
    )
    // SELECT DISTINCT author_pub — garante 100 comments do mesmo
    // user contam 1× weight (anti-Sybil de comments duplicados)
    expect(source).toMatch(/SELECT\s+DISTINCT\s+author_pub\s+FROM\s+comments/)
  })
})
