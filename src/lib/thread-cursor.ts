/**
 * Track C.4.1 — cursor ops puras pra navegação swipe em threads de
 * comments. Spec: `Docs/design-comments.md` §3.1.
 *
 * Funções 100% determinísticas (manifesto §7). Mesmo `ThreadIndex`
 * + mesmo `ThreadCursor` ⇒ mesma transição. Testáveis em Node sem
 * DOM/SQLite/relays.
 *
 * Nomenclatura UI vs spec: este módulo é `protocol/spec` — usa
 * "comment", "reply", "sibling". UI layer (Track C.4.2+) traduz pra
 * vocabulário user-facing se necessário.
 */

/**
 * Caminho do root até o nó atualmente visível. Length ≥ 1.
 * - `path[0]` = id do top-level comment (`reply_to === post_id`)
 * - `path[length-1]` = comment atualmente em foco
 *
 * Imutável — toda operação retorna novo cursor (ou null/'exit').
 */
export interface ThreadCursor {
  path: string[]
}

/**
 * Nó da árvore de comments materializada. `replies` ordenados por
 * `created_at ASC, id ASC` (tie-break determinístico, manifesto §7).
 */
export interface CommentNode {
  id: string
  post_id: string
  reply_to: string
  author_pub: string
  content: string
  created_at: number
  score: number
  replies: CommentNode[]
}

/**
 * Índice secundário pré-computado pra cursor ops O(1) lookup.
 * Construído por `buildThreadIndex` em comments.ts.
 */
export interface ThreadIndex {
  /** id → node */
  byId: Map<string, CommentNode>
  /** parent_id → ordered child ids */
  childrenOf: Map<string, string[]>
  /** top-level comment ids ordenados (reply_to === post_id) */
  roots: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Comparator determinístico: createdAt ASC, tie-break id ASC.
 *  Aceita camelCase (CommentRecord) ou objetos compatíveis. */
export function compareComments(
  a: { id: string; createdAt: number },
  b: { id: string; createdAt: number },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Lista de irmãos do nó atual no contexto do `postId`. */
function siblingsOf(
  cursor: ThreadCursor,
  index: ThreadIndex,
  postId: string,
): string[] {
  if (cursor.path.length === 1) {
    // top-level: siblings = roots
    return index.roots
  }
  const parentId = cursor.path[cursor.path.length - 2]!
  return index.childrenOf.get(parentId) ?? []
  // postId não usado aqui — preservado na assinatura pra futura expansão
  // (ex.: validação cross-post). Silencia lint:
  void postId
}

// ─── Operations ──────────────────────────────────────────────────────

/**
 * Próximo irmão do nó atual. Retorna `null` se já é o último —
 * **clamp**, não wrap (§3.1 design-comments).
 */
export function nextSibling(
  cursor: ThreadCursor,
  index: ThreadIndex,
  postId: string,
): ThreadCursor | null {
  if (cursor.path.length === 0) return null
  const siblings = siblingsOf(cursor, index, postId)
  const currentId = cursor.path[cursor.path.length - 1]!
  const i = siblings.indexOf(currentId)
  if (i < 0 || i >= siblings.length - 1) return null
  const next = siblings[i + 1]!
  return { path: [...cursor.path.slice(0, -1), next] }
}

/**
 * Irmão anterior do nó atual. Retorna `null` se já é o primeiro —
 * clamp (não wrap).
 */
export function prevSibling(
  cursor: ThreadCursor,
  index: ThreadIndex,
  postId: string,
): ThreadCursor | null {
  if (cursor.path.length === 0) return null
  const siblings = siblingsOf(cursor, index, postId)
  const currentId = cursor.path[cursor.path.length - 1]!
  const i = siblings.indexOf(currentId)
  if (i <= 0) return null
  const prev = siblings[i - 1]!
  return { path: [...cursor.path.slice(0, -1), prev] }
}

/**
 * Desce pro primeiro filho do nó atual. `null` se sem filhos —
 * usuário fica onde está (clamp).
 */
export function descend(
  cursor: ThreadCursor,
  index: ThreadIndex,
): ThreadCursor | null {
  if (cursor.path.length === 0) return null
  const currentId = cursor.path[cursor.path.length - 1]!
  const children = index.childrenOf.get(currentId)
  if (!children || children.length === 0) return null
  return { path: [...cursor.path, children[0]!] }
}

/**
 * Sobe pro parent. Sentinel `'exit'` quando `path.length === 1` —
 * indica que o ThreadView deve fechar (volta pra PostViewer).
 */
export function ascend(cursor: ThreadCursor): ThreadCursor | 'exit' {
  if (cursor.path.length <= 1) return 'exit'
  return { path: cursor.path.slice(0, -1) }
}
