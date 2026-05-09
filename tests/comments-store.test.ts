/**
 * Track C.3 + C.4.1 — testes do store + lifecycle.
 *
 * Cobertura:
 *  - loadThread: SELECT com LIMIT 200 (Barney HIGH #2 §5.2)
 *  - loadThread idempotência: re-chamar atualiza
 *  - addCommentToStore: row novo entra ordenado, dedup por id
 *  - addCommentToStore: ignora se postId não bate
 *  - subscribeComments: refcount per postId (Ted Issue #4 §15)
 *      - 1 consumer → 1 REQ
 *      - N consumers no mesmo postId → 1 REQ
 *      - release decrementa; última zera dispara unsubscribe
 *      - filter inclui '#E': [postId] e kind 1111
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock db ANTES de importar comments.ts
vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))

// Mock orchestrator — capturamos chamadas pra verificar filter +
// retornar uma fn fake de unsubscribe.
const orchSubscribe = vi.fn()
vi.mock('../src/lib/transport/orchestrator', () => ({
  orchestrator: {
    subscribe: (...args: unknown[]) => orchSubscribe(...args),
  },
}))

// Mock onNostrEvent — isolamos o store do pipeline real.
// NIP22_COMMENT_KIND re-exposto pq comments.ts agora importa daqui (CM-T1 dedupe).
vi.mock('../src/lib/events', () => ({
  onNostrEvent: vi.fn(async () => {}),
  NIP22_COMMENT_KIND: 1111,
}))

import {
  COMMENTS_LOAD_CAP,
  _activeSubCount,
  _refcountOf,
  _resetSubsForTest,
  addCommentToStore,
  buildThread,
  buildThreadIndex,
  loadThread,
  subscribeComments,
  useThreadStore,
} from '../src/lib/comments'
import { db } from '../src/lib/db'
import type { CommentRecord } from '../src/types/drift'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

const POST = 'post1'.padEnd(64, 'a')
const POST_OTHER = 'post2'.padEnd(64, 'a')
const PUB = 'pub1'.padEnd(64, 'b')

function rec(opts: {
  id: string
  reply_to?: string
  created_at?: number
  postId?: string
  score?: number
}): CommentRecord {
  return {
    id: opts.id,
    postId: opts.postId ?? POST,
    replyTo: opts.reply_to ?? opts.postId ?? POST,
    authorPub: PUB,
    content: 'c-' + opts.id,
    createdAt: opts.created_at ?? 1000,
    score: opts.score ?? 0,
  }
}

beforeEach(() => {
  dbMock.exec.mockReset()
  dbMock.run.mockReset()
  dbMock.get.mockReset()
  dbMock.exec.mockResolvedValue([])
  dbMock.run.mockResolvedValue(undefined)
  dbMock.get.mockResolvedValue(null)
  orchSubscribe.mockReset()
  // reset store
  useThreadStore.setState({ threads: new Map(), generation: 0 })
  _resetSubsForTest()
})

describe('loadThread', () => {
  it('SELECT usa LIMIT = COMMENTS_LOAD_CAP (Barney HIGH #2)', async () => {
    expect(COMMENTS_LOAD_CAP).toBe(200)
    await loadThread(POST)
    expect(dbMock.exec).toHaveBeenCalledTimes(1)
    const [sql, params] = dbMock.exec.mock.calls[0]!
    expect(String(sql)).toMatch(/SELECT[\s\S]*FROM comments/)
    expect(String(sql)).toMatch(/LIMIT \?/)
    expect(params).toEqual([POST, 200])
  })

  it('popula store com forest + index após carregar rows', async () => {
    dbMock.exec.mockResolvedValue([
      { id: 'r1', post_id: POST, reply_to: POST, author_pub: PUB, content: 'a', created_at: 100, score: 0 },
      { id: 'r2', post_id: POST, reply_to: POST, author_pub: PUB, content: 'b', created_at: 200, score: 0 },
    ])
    await loadThread(POST)
    const entry = useThreadStore.getState().threads.get(POST)!
    expect(entry).toBeDefined()
    expect(entry.loading).toBe(false)
    expect(entry.forest.map((n) => n.id)).toEqual(['r1', 'r2'])
    expect(entry.index.roots).toEqual(['r1', 'r2'])
  })

  it('idempotente: re-chamar atualiza com novos rows', async () => {
    dbMock.exec.mockResolvedValueOnce([
      { id: 'r1', post_id: POST, reply_to: POST, author_pub: PUB, content: 'a', created_at: 100, score: 0 },
    ])
    await loadThread(POST)
    expect(useThreadStore.getState().threads.get(POST)!.forest.length).toBe(1)

    dbMock.exec.mockResolvedValueOnce([
      { id: 'r1', post_id: POST, reply_to: POST, author_pub: PUB, content: 'a', created_at: 100, score: 0 },
      { id: 'r2', post_id: POST, reply_to: POST, author_pub: PUB, content: 'b', created_at: 200, score: 0 },
    ])
    await loadThread(POST)
    expect(useThreadStore.getState().threads.get(POST)!.forest.length).toBe(2)
  })
})

describe('addCommentToStore', () => {
  it('insere row novo, mantém ordem cronológica', async () => {
    dbMock.exec.mockResolvedValue([
      { id: 'r1', post_id: POST, reply_to: POST, author_pub: PUB, content: 'a', created_at: 100, score: 0 },
    ])
    await loadThread(POST)
    addCommentToStore(POST, rec({ id: 'r2', created_at: 200 }))
    const entry = useThreadStore.getState().threads.get(POST)!
    expect(entry.forest.map((n) => n.id)).toEqual(['r1', 'r2'])
  })

  it('dedup por id (segundo add sobrescreve)', async () => {
    dbMock.exec.mockResolvedValue([])
    await loadThread(POST)
    addCommentToStore(POST, rec({ id: 'r1', created_at: 100 }))
    addCommentToStore(POST, rec({ id: 'r1', created_at: 100 }))
    const entry = useThreadStore.getState().threads.get(POST)!
    expect(entry.forest).toHaveLength(1)
  })

  it('ignora se postId do row não bate', async () => {
    dbMock.exec.mockResolvedValue([])
    await loadThread(POST)
    addCommentToStore(POST, rec({ id: 'r1', postId: POST_OTHER, reply_to: POST_OTHER }))
    const entry = useThreadStore.getState().threads.get(POST)!
    expect(entry.forest).toHaveLength(0)
  })

  it('no-op se thread ainda não foi carregada (loadThread separado)', () => {
    // Sem loadThread prévio
    addCommentToStore(POST, rec({ id: 'r1' }))
    expect(useThreadStore.getState().threads.has(POST)).toBe(false)
  })

  it('bumps generation pra trigger re-render', async () => {
    dbMock.exec.mockResolvedValue([])
    await loadThread(POST)
    const before = useThreadStore.getState().generation
    addCommentToStore(POST, rec({ id: 'r1' }))
    expect(useThreadStore.getState().generation).toBeGreaterThan(before)
  })
})

describe('subscribeComments — refcount per postId (Ted Issue #4)', () => {
  it('1 consumer → 1 REQ ao orchestrator', () => {
    orchSubscribe.mockReturnValue(() => {})
    const release = subscribeComments(POST)
    expect(orchSubscribe).toHaveBeenCalledTimes(1)
    expect(_activeSubCount()).toBe(1)
    expect(_refcountOf(POST)).toBe(1)
    release()
  })

  it('filter inclui kind 1111 + #E [postId]', () => {
    orchSubscribe.mockReturnValue(() => {})
    subscribeComments(POST)
    const filter = orchSubscribe.mock.calls[0]![0] as Record<string, unknown>
    expect(filter.kinds).toEqual([1111])
    expect(filter['#E']).toEqual([POST])
  })

  it('N consumers mesmo postId → 1 REQ compartilhada', () => {
    orchSubscribe.mockReturnValue(() => {})
    const r1 = subscribeComments(POST)
    const r2 = subscribeComments(POST)
    const r3 = subscribeComments(POST)
    expect(orchSubscribe).toHaveBeenCalledTimes(1) // só uma REQ
    expect(_refcountOf(POST)).toBe(3)
    r1()
    expect(_refcountOf(POST)).toBe(2)
    r2()
    expect(_refcountOf(POST)).toBe(1)
    r3()
    expect(_activeSubCount()).toBe(0) // último release dispara unsubscribe
  })

  it('release dispara unsubscribe real do orchestrator quando refcount zera', () => {
    const realUnsub = vi.fn()
    orchSubscribe.mockReturnValue(realUnsub)
    const release = subscribeComments(POST)
    expect(realUnsub).not.toHaveBeenCalled()
    release()
    expect(realUnsub).toHaveBeenCalledTimes(1)
  })

  it('release idempotente — chamar 2x não decrementa duplicado', () => {
    orchSubscribe.mockReturnValue(() => {})
    const r1 = subscribeComments(POST)
    const r2 = subscribeComments(POST)
    expect(_refcountOf(POST)).toBe(2)
    r1()
    r1() // segunda vez no mesmo handle não deve mexer
    expect(_refcountOf(POST)).toBe(1)
    r2()
    expect(_activeSubCount()).toBe(0)
  })

  it('postIds distintos têm REQs separadas', () => {
    orchSubscribe.mockReturnValue(() => {})
    const r1 = subscribeComments(POST)
    const r2 = subscribeComments(POST_OTHER)
    expect(orchSubscribe).toHaveBeenCalledTimes(2)
    expect(_activeSubCount()).toBe(2)
    r1()
    r2()
  })
})

describe('buildThread + buildThreadIndex consistência', () => {
  it('forest e index batem em roots', () => {
    const rows = [
      rec({ id: 'r1', created_at: 100 }),
      rec({ id: 'r2', created_at: 200 }),
    ]
    const forest = buildThread(rows)
    const index = buildThreadIndex(forest)
    expect(index.roots).toEqual(forest.map((n) => n.id))
  })

  it('childrenOf consistente com replies', () => {
    const rows = [
      rec({ id: 'r1', created_at: 100 }),
      rec({ id: 'c1', reply_to: 'r1', created_at: 110 }),
      rec({ id: 'c2', reply_to: 'r1', created_at: 120 }),
    ]
    const forest = buildThread(rows)
    const index = buildThreadIndex(forest)
    expect(index.childrenOf.get('r1')).toEqual(['c1', 'c2'])
  })
})
