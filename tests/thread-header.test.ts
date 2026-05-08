/**
 * Track C.4.3 — testes dos helpers puros do `<ThreadHeader>`.
 *
 * Cobertura:
 *  - truncatePub: shape `…<6 últimos>`
 *  - buildBreadcrumb: trunca path > 4 níveis pra [first, …, second-last, last]
 *  - siblingPosition: 1-indexed + total
 *  - countNewSince: filtra por timestamp + exclui currentId
 */

import { describe, expect, it } from 'vitest'
import {
  buildBreadcrumb,
  countNewSince,
  siblingPosition,
  truncatePub,
} from '../src/lib/thread-header'
import type {
  CommentNode,
  ThreadCursor,
  ThreadIndex,
} from '../src/lib/thread-cursor'

function node(id: string, pub: string, createdAt: number): CommentNode {
  return {
    id,
    post_id: 'post',
    reply_to: 'post',
    author_pub: pub,
    content: 'c',
    created_at: createdAt,
    score: 1,
    replies: [],
  }
}

function makeIndex(nodes: CommentNode[]): ThreadIndex {
  const byId = new Map<string, CommentNode>()
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const n of nodes) {
    byId.set(n.id, n)
    roots.push(n.id)
  }
  return { byId, childrenOf, roots }
}

describe('truncatePub', () => {
  it('mantém pubkey curta sem mexer', () => {
    expect(truncatePub('abc')).toBe('abc')
    expect(truncatePub('abcdefgh')).toBe('abcdefgh')
  })
  it('trunca pubkey longa pra …<6 últimos>', () => {
    expect(truncatePub('a'.repeat(60) + 'XYZ123')).toBe('…XYZ123')
  })
})

describe('buildBreadcrumb', () => {
  const a = node('a', 'pubA12345678', 100)
  const b = node('b', 'pubB12345678', 100)
  const c = node('c', 'pubC12345678', 100)
  const d = node('d', 'pubD12345678', 100)
  const e = node('e', 'pubE12345678', 100)

  it('retorna labels de cada nível pro path curto', () => {
    const idx = makeIndex([a, b])
    const cursor: ThreadCursor = { path: ['a', 'b'] }
    const labels = buildBreadcrumb(cursor, idx)
    expect(labels).toEqual(['…345678', '…345678'])
  })

  it('trunca pra [first, …, second-last, last] quando > 4 níveis', () => {
    const idx = makeIndex([a, b, c, d, e])
    const cursor: ThreadCursor = { path: ['a', 'b', 'c', 'd', 'e'] }
    const labels = buildBreadcrumb(cursor, idx)
    expect(labels).toHaveLength(4)
    expect(labels[1]).toBe('…')
  })

  it('retorna "?" quando node sumiu do index (race §5.5)', () => {
    const idx = makeIndex([a])
    const cursor: ThreadCursor = { path: ['a', 'ghost'] }
    const labels = buildBreadcrumb(cursor, idx)
    expect(labels[1]).toBe('?')
  })
})

describe('siblingPosition', () => {
  it('top-level: position vs roots', () => {
    const a = node('a', 'p', 100)
    const b = node('b', 'p', 200)
    const c = node('c', 'p', 300)
    const idx: ThreadIndex = {
      byId: new Map([
        ['a', a],
        ['b', b],
        ['c', c],
      ]),
      childrenOf: new Map(),
      roots: ['a', 'b', 'c'],
    }
    expect(siblingPosition({ path: ['b'] }, idx)).toEqual({
      position: 2,
      total: 3,
    })
  })

  it('nested: position vs childrenOf parent', () => {
    const a = node('a', 'p', 100)
    const x = node('x', 'p', 200)
    const y = node('y', 'p', 300)
    const idx: ThreadIndex = {
      byId: new Map([
        ['a', a],
        ['x', x],
        ['y', y],
      ]),
      childrenOf: new Map([['a', ['x', 'y']]]),
      roots: ['a'],
    }
    expect(siblingPosition({ path: ['a', 'y'] }, idx)).toEqual({
      position: 2,
      total: 2,
    })
  })

  it('cursor inválido retorna 0/total', () => {
    const idx: ThreadIndex = {
      byId: new Map(),
      childrenOf: new Map(),
      roots: ['a'],
    }
    expect(siblingPosition({ path: ['z'] }, idx)).toEqual({
      position: 0,
      total: 1,
    })
  })
})

describe('countNewSince', () => {
  it('conta nodes com created_at >= since, excluindo currentId', () => {
    const a = node('a', 'p', 100)
    const b = node('b', 'p', 200)
    const c = node('c', 'p', 300)
    const d = node('d', 'p', 400)
    const idx: ThreadIndex = {
      byId: new Map([
        ['a', a],
        ['b', b],
        ['c', c],
        ['d', d],
      ]),
      childrenOf: new Map(),
      roots: ['a'],
    }
    // since=250 → c (300), d (400) qualificam; current=c → exclui
    expect(countNewSince(idx, 250, 'c')).toBe(1)
    // sem current
    expect(countNewSince(idx, 250, null)).toBe(2)
    // since high → 0
    expect(countNewSince(idx, 9999, null)).toBe(0)
  })
})
