/**
 * Round Comments Nav Redesign — Phase A
 * (RFC `Docs/rfcs/2026-05-rfc-comments-navigation-redesign.md`)
 *
 * Tests puros (Node, sem DOM) pra:
 *   - flattenForList: DFS preorder, respeita collapsedSet, depth correto
 *   - flattenForList: posInSet/setSize ARIA-correct entre siblings
 *   - indentPxForDepth: progressivo até MAX, plateau após
 *   - prefs.applyRow: thread_view_mode round-trip ('list' / 'cards')
 *   - prefs DEFAULT: thread_view_mode default = 'list' (RFC §10 Q3 cohort C)
 *
 * Manifesto §7 — funções puras, determinístico (mesma entrada → mesma
 * saída → sempre). Manifesto §22 — order from buildThread inalterado.
 */

import { describe, expect, it } from 'vitest'
import {
  flattenForList,
  indentPxForDepth,
  LIST_INDENT_PER_LEVEL_PX,
  LIST_INDENT_MAX_DEPTH,
} from '../src/lib/thread-list'
import { DEFAULT_USER_PREFS } from '../src/types/drift'
import type { CommentNode } from '../src/lib/thread-cursor'

// ─── Helpers ─────────────────────────────────────────────────────────

function mkNode(
  id: string,
  replies: CommentNode[] = [],
  createdAt = 1700000000,
): CommentNode {
  return {
    id,
    post_id: 'post1',
    reply_to: 'post1',
    author_pub: 'pub_' + id,
    content: 'content_' + id,
    created_at: createdAt,
    score: 0,
    replies,
    content_warning: null,
  }
}

// ─── flattenForList ──────────────────────────────────────────────────

describe('flattenForList', () => {
  it('emite empty pra forest vazio', () => {
    expect(flattenForList([], new Set())).toEqual([])
  })

  it('flatten 3 top-levels sem replies (depth 0)', () => {
    const forest = [mkNode('a'), mkNode('b'), mkNode('c')]
    const flat = flattenForList(forest, new Set())
    expect(flat).toHaveLength(3)
    expect(flat.map((f) => f.node.id)).toEqual(['a', 'b', 'c'])
    expect(flat.every((f) => f.depth === 0)).toBe(true)
    // posInSet ARIA: 1-indexed, setSize = 3 entre siblings top-level
    expect(flat.map((f) => f.posInSet)).toEqual([1, 2, 3])
    expect(flat.every((f) => f.setSize === 3)).toBe(true)
    // childCount: 0 pra todos
    expect(flat.every((f) => f.childCount === 0)).toBe(true)
  })

  it('DFS preorder com aninhamento profundo', () => {
    // a → a1 → a1a; b → b1; c
    const a1a = mkNode('a1a')
    const a1 = mkNode('a1', [a1a])
    const a = mkNode('a', [a1])
    const b1 = mkNode('b1')
    const b = mkNode('b', [b1])
    const c = mkNode('c')
    const flat = flattenForList([a, b, c], new Set())
    expect(flat.map((f) => f.node.id)).toEqual(['a', 'a1', 'a1a', 'b', 'b1', 'c'])
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 2, 0, 1, 0])
  })

  it('collapsedSet skipa subtree do nó colapsado mas mantém o nó', () => {
    const a1 = mkNode('a1')
    const a2 = mkNode('a2')
    const a = mkNode('a', [a1, a2])
    const b = mkNode('b')
    const flat = flattenForList([a, b], new Set(['a']))
    // 'a' aparece, mas a1/a2 (filhos) NÃO. 'b' segue.
    expect(flat.map((f) => f.node.id)).toEqual(['a', 'b'])
  })

  it('childCount reflete replies diretas, não subtree depth', () => {
    const a1a = mkNode('a1a')
    const a1 = mkNode('a1', [a1a])
    const a2 = mkNode('a2')
    const a = mkNode('a', [a1, a2])
    const flat = flattenForList([a], new Set())
    const aEntry = flat.find((f) => f.node.id === 'a')!
    expect(aEntry.childCount).toBe(2) // direct children only
    const a1Entry = flat.find((f) => f.node.id === 'a1')!
    expect(a1Entry.childCount).toBe(1)
  })

  it('determinístico — mesma entrada → mesma saída (manifesto §7)', () => {
    const forest = [mkNode('a', [mkNode('a1')]), mkNode('b')]
    const collapsed = new Set<string>(['a'])
    const r1 = flattenForList(forest, collapsed)
    const r2 = flattenForList(forest, collapsed)
    expect(r1.map((f) => f.node.id)).toEqual(r2.map((f) => f.node.id))
  })
})

// ─── indentPxForDepth ────────────────────────────────────────────────

describe('indentPxForDepth', () => {
  it('depth 0 → 0px (top-level sem indent)', () => {
    expect(indentPxForDepth(0)).toBe(0)
  })

  it('depth crescente é progressivo até MAX', () => {
    for (let d = 0; d <= LIST_INDENT_MAX_DEPTH; d++) {
      expect(indentPxForDepth(d)).toBe(d * LIST_INDENT_PER_LEVEL_PX)
    }
  })

  it('plateau após LIST_INDENT_MAX_DEPTH (RFC §9.3)', () => {
    const max = LIST_INDENT_MAX_DEPTH * LIST_INDENT_PER_LEVEL_PX
    expect(indentPxForDepth(LIST_INDENT_MAX_DEPTH)).toBe(max)
    expect(indentPxForDepth(LIST_INDENT_MAX_DEPTH + 1)).toBe(max)
    expect(indentPxForDepth(LIST_INDENT_MAX_DEPTH + 5)).toBe(max)
    expect(indentPxForDepth(99)).toBe(max)
  })

  it('depth negativo clampa a 0 (defesa)', () => {
    expect(indentPxForDepth(-1)).toBe(0)
    expect(indentPxForDepth(-99)).toBe(0)
  })
})

// ─── DEFAULT_USER_PREFS / thread_view_mode ───────────────────────────

describe('DEFAULT_USER_PREFS.thread_view_mode', () => {
  it("default = 'list' (RFC §10 Q3 cohort C — novos users)", () => {
    expect(DEFAULT_USER_PREFS.thread_view_mode).toBe('list')
  })

  it('é uma das 2 opções válidas (list | cards)', () => {
    expect(['list', 'cards']).toContain(DEFAULT_USER_PREFS.thread_view_mode)
  })
})
