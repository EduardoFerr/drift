/**
 * Track C.6.1 — tests pra count prefetch de comments.
 *
 * Cobertura:
 *  - bumpCommentCount: incrementa, idempotência via seenCommentIds
 *  - bumpCommentCount: posts diferentes têm contagens independentes
 *  - loadCommentCounts: query mock retorna rows → store populado
 *  - loadCommentCounts: idempotente (chamar 2x sobrescreve)
 *  - loadCommentCounts popula seenCommentIds (dedup pós-boot)
 *  - selectCommentCount: 0 default pra postId desconhecido
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))

import {
  bumpCommentCount,
  loadCommentCounts,
  selectCommentCount,
  useCommentCountsStore,
  _resetCommentCountsForTest,
  _seenCommentIdsSize,
} from '../src/lib/comment-counts'
import { db } from '../src/lib/db'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

const POST_A = 'a'.repeat(64)
const POST_B = 'b'.repeat(64)
const COMMENT_1 = '1'.repeat(64)
const COMMENT_2 = '2'.repeat(64)
const COMMENT_3 = '3'.repeat(64)

beforeEach(() => {
  _resetCommentCountsForTest()
  dbMock.exec.mockReset()
  dbMock.run.mockReset()
  dbMock.get.mockReset()
})

describe('bumpCommentCount', () => {
  it('incrementa no primeiro avistamento e retorna true', () => {
    expect(bumpCommentCount(POST_A, COMMENT_1)).toBe(true)
    expect(selectCommentCount(POST_A)).toBe(1)
  })

  it('é idempotente cross-relay — mesmo commentId não conta 2x', () => {
    expect(bumpCommentCount(POST_A, COMMENT_1)).toBe(true)
    expect(bumpCommentCount(POST_A, COMMENT_1)).toBe(false)
    expect(bumpCommentCount(POST_A, COMMENT_1)).toBe(false)
    expect(selectCommentCount(POST_A)).toBe(1)
  })

  it('contagens são independentes entre posts', () => {
    bumpCommentCount(POST_A, COMMENT_1)
    bumpCommentCount(POST_A, COMMENT_2)
    bumpCommentCount(POST_B, COMMENT_3)
    expect(selectCommentCount(POST_A)).toBe(2)
    expect(selectCommentCount(POST_B)).toBe(1)
  })

  it('atualiza o store reativamente (consumível por Zustand subscribers)', () => {
    const seen: number[] = []
    const unsub = useCommentCountsStore.subscribe((s) =>
      seen.push(s.countByPost[POST_A] ?? 0),
    )
    bumpCommentCount(POST_A, COMMENT_1)
    bumpCommentCount(POST_A, COMMENT_2)
    unsub()
    expect(seen).toEqual([1, 2])
  })
})

describe('selectCommentCount', () => {
  it('retorna 0 pra postId desconhecido (sem undefined cascateando)', () => {
    expect(selectCommentCount('zz'.repeat(32))).toBe(0)
  })
})

describe('loadCommentCounts', () => {
  it('popula store com COUNT(*) GROUP BY post_id do banco', async () => {
    dbMock.exec
      .mockResolvedValueOnce([
        { post_id: POST_A, n: 5 },
        { post_id: POST_B, n: 2 },
      ])
      .mockResolvedValueOnce([])

    await loadCommentCounts()

    expect(selectCommentCount(POST_A)).toBe(5)
    expect(selectCommentCount(POST_B)).toBe(2)
  })

  it('é idempotente — chamar 2x sobrescreve com query fresca', async () => {
    dbMock.exec
      .mockResolvedValueOnce([{ post_id: POST_A, n: 3 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ post_id: POST_A, n: 7 }])
      .mockResolvedValueOnce([])

    await loadCommentCounts()
    expect(selectCommentCount(POST_A)).toBe(3)

    await loadCommentCounts()
    expect(selectCommentCount(POST_A)).toBe(7)
  })

  it('popula seenCommentIds — dedup pós-boot quando subscribe re-entrega', async () => {
    dbMock.exec
      .mockResolvedValueOnce([{ post_id: POST_A, n: 1 }])
      .mockResolvedValueOnce([{ id: COMMENT_1 }])

    await loadCommentCounts()

    expect(_seenCommentIdsSize()).toBe(1)
    // Re-entrega via subscribe ativo NÃO deve double-count
    const counted = bumpCommentCount(POST_A, COMMENT_1)
    expect(counted).toBe(false)
    expect(selectCommentCount(POST_A)).toBe(1)
  })

  it('lida com banco vazio sem quebrar', async () => {
    dbMock.exec.mockResolvedValue([])
    await loadCommentCounts()
    expect(selectCommentCount(POST_A)).toBe(0)
    expect(_seenCommentIdsSize()).toBe(0)
  })
})
