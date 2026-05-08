/**
 * Track C.4.1 — testes das cursor ops puras de thread navigation.
 *
 * Cobertura:
 *  - nextSibling / prevSibling: clamp em fim/início (não wrap)
 *  - descend: null se sem filhos
 *  - ascend: 'exit' sentinel quando path.length === 1
 *  - determinismo: sort created_at ASC, id ASC tie-break
 */

import { describe, expect, it } from 'vitest'
import {
  ascend,
  compareComments,
  descend,
  nextSibling,
  prevSibling,
  type CommentNode,
  type ThreadCursor,
  type ThreadIndex,
} from '../src/lib/thread-cursor'
import { buildThread, buildThreadIndex } from '../src/lib/comments'
import type { CommentRecord } from '../src/types/drift'

const POST = 'post1'.padEnd(64, 'a')
const PUB = 'pub1'.padEnd(64, 'b')

function row(opts: {
  id: string
  reply_to?: string
  created_at?: number
  score?: number
}): CommentRecord {
  return {
    id: opts.id,
    postId: POST,
    replyTo: opts.reply_to ?? POST,
    authorPub: PUB,
    content: 'c-' + opts.id,
    createdAt: opts.created_at ?? 1000,
    score: opts.score ?? 0,
  }
}

/**
 * Fixture canônico:
 *
 *   roots: [r1, r2, r3]   (ordem por created_at)
 *   r1.replies: [c1a, c1b]
 *   c1a.replies: [c1a1]
 *   r2.replies: []
 *   r3.replies: [c3a]
 */
function fixture(): { index: ThreadIndex; forest: CommentNode[] } {
  const rows: CommentRecord[] = [
    row({ id: 'r1', created_at: 100 }),
    row({ id: 'r2', created_at: 200 }),
    row({ id: 'r3', created_at: 300 }),
    row({ id: 'c1a', reply_to: 'r1', created_at: 110 }),
    row({ id: 'c1b', reply_to: 'r1', created_at: 120 }),
    row({ id: 'c1a1', reply_to: 'c1a', created_at: 115 }),
    row({ id: 'c3a', reply_to: 'r3', created_at: 310 }),
  ]
  const forest = buildThread(rows)
  const index = buildThreadIndex(forest)
  return { index, forest }
}

describe('compareComments (determinismo)', () => {
  it('ordena por created_at ASC', () => {
    expect(compareComments({ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 })).toBeLessThan(0)
  })
  it('tie-break por id ASC', () => {
    expect(compareComments({ id: 'a', createdAt: 5 }, { id: 'b', createdAt: 5 })).toBeLessThan(0)
    expect(compareComments({ id: 'b', createdAt: 5 }, { id: 'a', createdAt: 5 })).toBeGreaterThan(0)
  })
  it('iguais → 0', () => {
    expect(compareComments({ id: 'a', createdAt: 5 }, { id: 'a', createdAt: 5 })).toBe(0)
  })
})

describe('buildThread / buildThreadIndex (determinístico)', () => {
  it('mesmo input → mesmo forest (manifesto §7)', () => {
    const a = fixture()
    const b = fixture()
    expect(JSON.stringify(a.forest)).toBe(JSON.stringify(b.forest))
  })

  it('roots ordenados por created_at', () => {
    const { index } = fixture()
    expect(index.roots).toEqual(['r1', 'r2', 'r3'])
  })

  it('childrenOf preserva ordem cronológica', () => {
    const { index } = fixture()
    expect(index.childrenOf.get('r1')).toEqual(['c1a', 'c1b'])
  })

  it('filtra score = -999 (manifesto §17)', () => {
    const rows = [
      row({ id: 'r1', created_at: 100 }),
      row({ id: 'r2', created_at: 200, score: -999 }),
    ]
    const forest = buildThread(rows)
    expect(forest.map((n) => n.id)).toEqual(['r1'])
  })

  it('órfão (parent ainda não chegou) vira top-level temporário', () => {
    const rows = [
      row({ id: 'orph', reply_to: 'missing-parent', created_at: 100 }),
    ]
    const forest = buildThread(rows)
    expect(forest).toHaveLength(1)
    expect(forest[0]!.id).toBe('orph')
  })
})

describe('nextSibling', () => {
  it('avança no nível root', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r1'] }
    expect(nextSibling(cursor, index, POST)?.path).toEqual(['r2'])
  })

  it('clamp no último root (não wrap)', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r3'] }
    expect(nextSibling(cursor, index, POST)).toBeNull()
  })

  it('avança entre siblings de nested level', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r1', 'c1a'] }
    expect(nextSibling(cursor, index, POST)?.path).toEqual(['r1', 'c1b'])
  })

  it('clamp se único filho', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r3', 'c3a'] }
    expect(nextSibling(cursor, index, POST)).toBeNull()
  })
})

describe('prevSibling', () => {
  it('volta no nível root', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r2'] }
    expect(prevSibling(cursor, index, POST)?.path).toEqual(['r1'])
  })

  it('clamp no primeiro root', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r1'] }
    expect(prevSibling(cursor, index, POST)).toBeNull()
  })

  it('volta entre siblings nested', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r1', 'c1b'] }
    expect(prevSibling(cursor, index, POST)?.path).toEqual(['r1', 'c1a'])
  })
})

describe('descend', () => {
  it('desce pro primeiro filho', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r1'] }
    expect(descend(cursor, index)?.path).toEqual(['r1', 'c1a'])
  })

  it('null se sem filhos', () => {
    const { index } = fixture()
    const cursor: ThreadCursor = { path: ['r2'] }
    expect(descend(cursor, index)).toBeNull()
  })

  it('desce 2 níveis em sequência', () => {
    const { index } = fixture()
    const c1 = descend({ path: ['r1'] }, index)!
    expect(c1.path).toEqual(['r1', 'c1a'])
    const c2 = descend(c1, index)!
    expect(c2.path).toEqual(['r1', 'c1a', 'c1a1'])
  })
})

describe('ascend', () => {
  it("'exit' quando path.length === 1", () => {
    const cursor: ThreadCursor = { path: ['r1'] }
    expect(ascend(cursor)).toBe('exit')
  })

  it('sobe um nível', () => {
    const cursor: ThreadCursor = { path: ['r1', 'c1a', 'c1a1'] }
    const up = ascend(cursor)
    expect(up).not.toBe('exit')
    expect((up as ThreadCursor).path).toEqual(['r1', 'c1a'])
  })

  it("path vazio → 'exit'", () => {
    expect(ascend({ path: [] })).toBe('exit')
  })
})
