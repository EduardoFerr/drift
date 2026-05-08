/**
 * Track C.4.5 — integration smoke do flow de navegação ThreadView.
 *
 * Sem JSDOM/RTL no projeto (vitest roda em Node, manifesto §16 só
 * cobre lógica pura). Este teste simula a sequência exata de chamadas
 * que ThreadView faz por ciclo de vida:
 *
 *   1. buildThread(rows) → árvore materializada
 *   2. buildThreadIndex(roots) → índice secundário
 *   3. cursor inicial = { path: [roots[0].id] }
 *   4. handleNext  → nextSibling(cursor, index, postId)
 *   5. handleDescend → descend(cursor, index)
 *   6. handleAscend  → ascend(cursor) (pode retornar 'exit')
 *
 * Render do React + onClose eu não consigo testar (sem RTL). Mas a
 * lógica de roteamento que ThreadView delega às funções puras está
 * 100% coberta aqui pelo fluxo end-to-end.
 *
 * Fixture: 3 top-level comments, 1 com 2 replies (= 5 nós).
 */

import { describe, expect, it } from 'vitest'
import {
  ascend,
  descend,
  nextSibling,
  prevSibling,
  type ThreadCursor,
} from '../src/lib/thread-cursor'
import { buildThread, buildThreadIndex } from '../src/lib/comments'
import type { CommentRecord } from '../src/types/drift'

const POST = 'p'.repeat(64)
const PUB = 'a'.repeat(64)

function row(opts: {
  id: string
  reply_to?: string
  created_at?: number
}): CommentRecord {
  return {
    id: opts.id.padEnd(64, '0'),
    postId: POST,
    replyTo: (opts.reply_to ?? POST).padEnd(64, '0'),
    authorPub: PUB,
    content: 'c-' + opts.id,
    createdAt: opts.created_at ?? 1000,
    score: 0,
    replyToKind: opts.reply_to ? 1111 : 9078,
    replyToAuthorPub: PUB,
  }
}

const ID = (s: string) => s.padEnd(64, '0')

describe('Track C.4.5 — comments flow integration smoke', () => {
  // 3 roots: r1, r2, r3 (created_at: 1000, 1001, 1002)
  // r1 has children: r1c1, r1c2
  const rows: CommentRecord[] = [
    row({ id: 'r1', created_at: 1000 }),
    row({ id: 'r2', created_at: 1001 }),
    row({ id: 'r3', created_at: 1002 }),
    row({ id: 'r1c1', reply_to: 'r1', created_at: 1010 }),
    row({ id: 'r1c2', reply_to: 'r1', created_at: 1011 }),
  ]

  const tree = buildThread(rows, POST)
  const index = buildThreadIndex(tree)

  it('builds tree + index correctly (3 roots, 2 children of r1)', () => {
    expect(index.roots).toEqual([ID('r1'), ID('r2'), ID('r3')])
    expect(index.childrenOf.get(ID('r1'))).toEqual([ID('r1c1'), ID('r1c2')])
    expect(index.byId.size).toBe(5)
  })

  it('initial cursor → first root (ThreadView mount behavior)', () => {
    const cursor: ThreadCursor = { path: [index.roots[0]!] }
    expect(cursor.path).toEqual([ID('r1')])
  })

  it('handleNext advances cursor across roots; clamps at end', () => {
    let cursor: ThreadCursor = { path: [index.roots[0]!] }

    cursor = nextSibling(cursor, index, POST) ?? cursor
    expect(cursor.path).toEqual([ID('r2')])

    cursor = nextSibling(cursor, index, POST) ?? cursor
    expect(cursor.path).toEqual([ID('r3')])

    // Clamp: at last root, nextSibling returns null
    const next = nextSibling(cursor, index, POST)
    expect(next).toBeNull()
  })

  it('handleDescend extends path to first child', () => {
    let cursor: ThreadCursor = { path: [ID('r1')] }
    const descended = descend(cursor, index)
    expect(descended).not.toBeNull()
    cursor = descended!
    expect(cursor.path).toEqual([ID('r1'), ID('r1c1')])
  })

  it('handleNext at descended depth navigates among children', () => {
    let cursor: ThreadCursor = { path: [ID('r1'), ID('r1c1')] }
    cursor = nextSibling(cursor, index, POST) ?? cursor
    expect(cursor.path).toEqual([ID('r1'), ID('r1c2')])
  })

  it('handlePrev at first sibling stays clamped (no wrap)', () => {
    const cursor: ThreadCursor = { path: [ID('r1')] }
    const prev = prevSibling(cursor, index, POST)
    expect(prev).toBeNull()
  })

  it('handleAscend shrinks path; on root returns "exit" → onClose', () => {
    // Descended → ascend pops back to root
    let cursor: ThreadCursor = { path: [ID('r1'), ID('r1c2')] }
    const ascended = ascend(cursor)
    expect(ascended).not.toBe('exit')
    expect((ascended as ThreadCursor).path).toEqual([ID('r1')])

    // At root, ascend returns 'exit' (ThreadView calls onClose)
    cursor = { path: [ID('r1')] }
    expect(ascend(cursor)).toBe('exit')
  })

  it('descend on leaf returns null (no children to enter)', () => {
    const cursor: ThreadCursor = { path: [ID('r2')] }
    expect(descend(cursor, index)).toBeNull()
  })

  it('full UX flow: r1 → descend → r1c1 → next → r1c2 → ascend → r1 → exit', () => {
    let cursor: ThreadCursor = { path: [index.roots[0]!] }
    expect(cursor.path).toEqual([ID('r1')])

    // ThreadView.handleDescend
    cursor = descend(cursor, index) ?? cursor
    expect(cursor.path).toEqual([ID('r1'), ID('r1c1')])

    // ThreadView.handleNext (sibling at depth 2)
    cursor = nextSibling(cursor, index, POST) ?? cursor
    expect(cursor.path).toEqual([ID('r1'), ID('r1c2')])

    // ThreadView.handleAscend (back to root)
    const back = ascend(cursor)
    expect(back).not.toBe('exit')
    cursor = back as ThreadCursor
    expect(cursor.path).toEqual([ID('r1')])

    // ThreadView.handleAscend at root → 'exit' → calls onClose
    expect(ascend(cursor)).toBe('exit')
  })
})
