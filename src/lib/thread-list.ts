/**
 * Round Comments Nav Redesign — Phase A
 * (RFC `Docs/rfcs/2026-05-rfc-comments-navigation-redesign.md`)
 *
 * Funções puras pra render do `<ThreadView>` em list-mode. Determinístico
 * (manifesto §7) — mesma forest + mesmo collapsedSet ⇒ mesma flat list.
 *
 * Manifesto §22 score determinístico — sem sort selector. Ordem é
 * herdada de `buildThread` em `comments.ts` (created_at ASC, id ASC).
 *
 * Phase B: substituir por iterator + virtualization quando 200+ comments
 * causarem jank em low-end. Hoje: render full list é simples e cabe na
 * cap COMMENTS_LOAD_CAP=200 do `comments.ts`.
 */

import type { CommentNode } from './thread-cursor'

/**
 * Phase A — cap visual do indent em pixels (per nesting level). Plateau
 * após `LIST_INDENT_MAX_DEPTH` evita texto espremido em viewport
 * max-w-md (RFC §9.3 risco mitigado).
 */
export const LIST_INDENT_PER_LEVEL_PX = 12
export const LIST_INDENT_MAX_DEPTH = 5

/** Entrada flatten — node + metadados de posicionamento ARIA + indent. */
export interface FlatNode {
  node: CommentNode
  /** Profundidade na árvore (0 = top-level). */
  depth: number
  /** Posição entre os irmãos (1-indexed). ARIA aria-posinset. */
  posInSet: number
  /** Total de irmãos no nível atual. ARIA aria-setsize. */
  setSize: number
  /** Filhos diretos (≠ subtree depth). */
  childCount: number
}

/**
 * Flatten determinístico de forest pra render em list-mode.
 *
 * DFS preorder respeitando ordem do `buildThread`. Skipa subtree quando
 * parent está em `collapsedSet` (subtree inteiro escondido sem deleção
 * do estado — Phase A simples; Phase B persiste via user_prefs).
 *
 * @param forest - Top-level CommentNodes (ordem from buildThread)
 * @param collapsedSet - IDs cujos subtrees devem ser escondidos
 * @returns lista flat em ordem de render, com depth + ARIA pos/set
 */
export function flattenForList(
  forest: CommentNode[],
  collapsedSet: Set<string>,
): FlatNode[] {
  const out: FlatNode[] = []

  function walk(siblings: CommentNode[], depth: number): void {
    for (let i = 0; i < siblings.length; i++) {
      const node = siblings[i]!
      out.push({
        node,
        depth,
        posInSet: i + 1,
        setSize: siblings.length,
        childCount: node.replies.length,
      })
      if (node.replies.length > 0 && !collapsedSet.has(node.id)) {
        walk(node.replies, depth + 1)
      }
    }
  }

  walk(forest, 0)
  return out
}

/**
 * Calcula `paddingLeft` em px pra um depth dado, respeitando o plateau.
 * Pure helper — testable sem DOM.
 */
export function indentPxForDepth(depth: number): number {
  return Math.min(Math.max(depth, 0), LIST_INDENT_MAX_DEPTH) * LIST_INDENT_PER_LEVEL_PX
}
