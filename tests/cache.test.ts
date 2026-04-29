import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getMock, runMock, execMock, invalidateFeedMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  execMock: vi.fn(),
  invalidateFeedMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { get: getMock, run: runMock, exec: execMock },
}))

vi.mock('../src/lib/feed', () => ({
  invalidateFeed: invalidateFeedMock,
}))

import { evictOldPosts, pinPost, unpinPost, listPinned } from '../src/lib/cache'
import { DRIFT_LIMITS } from '../src/config/constants'

const ME = 'a'.repeat(64)
const SOFT_LIMIT = DRIFT_LIMITS.MAX_POSTS_CACHE // 10_000

beforeEach(() => {
  getMock.mockReset()
  runMock.mockReset().mockResolvedValue(undefined)
  execMock.mockReset().mockResolvedValue([])
  invalidateFeedMock.mockReset()
})

describe('pinPost / unpinPost', () => {
  it('pinPost faz INSERT OR IGNORE com timestamp atual', async () => {
    const before = Date.now()
    await pinPost('post-1')
    const after = Date.now()

    expect(runMock).toHaveBeenCalledTimes(1)
    const sql = runMock.mock.calls[0]![0] as string
    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(sql).toContain('INSERT OR IGNORE INTO pinned')
    expect(params[0]).toBe('post-1')
    expect(params[1] as number).toBeGreaterThanOrEqual(before)
    expect(params[1] as number).toBeLessThanOrEqual(after)
  })

  it('unpinPost remove do pinned (eviction passa a poder atuar)', async () => {
    await unpinPost('post-1')
    expect(runMock).toHaveBeenCalledTimes(1)
    const sql = runMock.mock.calls[0]![0] as string
    expect(sql).toContain('DELETE FROM pinned')
    expect(runMock.mock.calls[0]![1]).toEqual(['post-1'])
  })

  it('listPinned mapeia rows para shape camelCase', async () => {
    execMock.mockResolvedValue([
      { post_id: 'p1', pinned_at: 1000, cid: 'Qm123' },
      { post_id: 'p2', pinned_at: 500, cid: null },
    ])
    const list = await listPinned()
    expect(list).toEqual([
      { postId: 'p1', pinnedAt: 1000, cid: 'Qm123' },
      { postId: 'p2', pinnedAt: 500, cid: null },
    ])
  })
})

describe('evictOldPosts', () => {
  it('é no-op (retorna 0) quando total <= SOFT_LIMIT', async () => {
    getMock.mockResolvedValue({ n: SOFT_LIMIT })
    const removed = await evictOldPosts(ME)
    expect(removed).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('é no-op (retorna 0) com banco vazio', async () => {
    getMock.mockResolvedValue({ n: 0 })
    expect(await evictOldPosts(ME)).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('é no-op quando row é undefined (banco recém-criado)', async () => {
    getMock.mockResolvedValue(undefined)
    expect(await evictOldPosts(ME)).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('quando passa do limite, DELETE preserva próprios + espalhados + pinados (manifesto §16)', async () => {
    getMock.mockResolvedValue({ n: SOFT_LIMIT + 100 })
    execMock.mockResolvedValue([{ id: 'x' }, { id: 'y' }])

    await evictOldPosts(ME)

    expect(execMock).toHaveBeenCalledTimes(1)
    const sql = execMock.mock.calls[0]![0] as string
    const params = execMock.mock.calls[0]![1] as unknown[]

    // Filtros invariantes
    expect(sql).toContain('LEFT JOIN spreads')
    expect(sql).toContain('spreader_pub = ?') // espalhados pelo user
    expect(sql).toContain('LEFT JOIN pinned')
    expect(sql).toContain('author_pub != ?') // próprios excluídos
    expect(sql).toContain('s.post_id IS NULL')
    expect(sql).toContain('pn.post_id IS NULL')
    // Ordering: mais frios primeiro (score ASC, depois antigos)
    expect(sql).toContain('ORDER BY p.score ASC, p.created_at ASC')

    // npub aparece 2x (spread filter + author filter)
    expect(params[0]).toBe(ME)
    expect(params[1]).toBe(ME)
    // limit = overflow (100) + EVICTION_BATCH (500) = 600
    expect(params[2]).toBe(600)
  })

  it('chama invalidateFeed só quando algo foi removido', async () => {
    getMock.mockResolvedValue({ n: SOFT_LIMIT + 50 })
    execMock.mockResolvedValueOnce([]) // DELETE não removeu nada (tudo era próprio/espalhado/pinado)

    const removed = await evictOldPosts(ME)
    expect(removed).toBe(0)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
    // cleanup órfãos também não deve rodar
    expect(runMock).not.toHaveBeenCalled()
  })

  it('quando remove > 0, faz cleanup de buries órfãos e invalida feed', async () => {
    getMock.mockResolvedValue({ n: SOFT_LIMIT + 10 })
    execMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    const removed = await evictOldPosts(ME)
    expect(removed).toBe(3)
    expect(invalidateFeedMock).toHaveBeenCalledTimes(1)
    // Cleanup de buries órfãos
    const cleanupSql = runMock.mock.calls[0]![0] as string
    expect(cleanupSql).toContain('DELETE FROM buries')
    expect(cleanupSql).toContain('NOT IN (SELECT id FROM posts)')
  })

  it('cleanup NÃO toca em spreads/reports do user (continua querendo seedear)', async () => {
    getMock.mockResolvedValue({ n: SOFT_LIMIT + 10 })
    execMock.mockResolvedValueOnce([{ id: 'a' }])
    await evictOldPosts(ME)
    // Apenas 1 cleanup, e é em buries
    const allSqls = runMock.mock.calls.map((c) => c[0] as string)
    expect(allSqls).toHaveLength(1)
    expect(allSqls[0]).toContain('DELETE FROM buries')
    // Nenhum DELETE em spreads ou reports
    expect(allSqls.every((s) => !s.includes('DELETE FROM spreads'))).toBe(true)
    expect(allSqls.every((s) => !s.includes('DELETE FROM reports'))).toBe(true)
  })
})
