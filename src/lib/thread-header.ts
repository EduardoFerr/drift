/**
 * Track C.4.3 — helpers puros pro `<ThreadHeader>`.
 *
 * Funções 100% determinísticas (manifesto §7), sem React/DOM/SQLite.
 * Testáveis em Node. Toda a UI consome via `<ThreadHeader>` — esses
 * helpers são extraídos pra cobertura unitária independente.
 *
 * Spec: `Docs/design-comments.md` §4.2.
 */

import type { ThreadCursor, ThreadIndex } from './thread-cursor'

/**
 * Trunca pubkey de 64 hex chars pra exibição compacta.
 * `npub…<8 últimos>` ou `<author>…<6 últimos>` não cabem aqui — é só
 * shape neutro: `…<6 últimos>`.
 */
export function truncatePub(pub: string): string {
  if (pub.length <= 8) return pub
  return '…' + pub.slice(-6)
}

/**
 * Constrói os labels do breadcrumb (autores ao longo do `path`).
 * Retorna a sequência de strings UI-ready. Truncate inteligente quando
 * `path.length > 4`: mostra primeiro, "…", penúltimo, último (caminho
 * "@alice › … › @charlie › @você").
 *
 * `index.byId` lookup pode falhar se cursor aponta pra nó que sumiu —
 * nesse caso entrada vira "?".
 */
export function buildBreadcrumb(
  cursor: ThreadCursor,
  index: ThreadIndex,
): string[] {
  const labels = cursor.path.map((id) => {
    const node = index.byId.get(id)
    return node ? truncatePub(node.author_pub) : '?'
  })
  if (labels.length <= 4) return labels
  // truncate: [first, '…', second-to-last, last]
  return [labels[0]!, '…', labels[labels.length - 2]!, labels[labels.length - 1]!]
}

/**
 * Posição do cursor entre os irmãos (1-indexed) + tamanho do nível.
 * Útil pro counter "3/47".
 */
export function siblingPosition(
  cursor: ThreadCursor,
  index: ThreadIndex,
): { position: number; total: number } {
  if (cursor.path.length === 0) return { position: 0, total: 0 }
  const currentId = cursor.path[cursor.path.length - 1]!
  let siblings: string[]
  if (cursor.path.length === 1) {
    siblings = index.roots
  } else {
    const parentId = cursor.path[cursor.path.length - 2]!
    siblings = index.childrenOf.get(parentId) ?? []
  }
  const i = siblings.indexOf(currentId)
  if (i < 0) return { position: 0, total: siblings.length }
  return { position: i + 1, total: siblings.length }
}

/**
 * Conta quantos comments do índice têm `created_at >= sinceUnixSec`.
 * Usado pro badge "+N novos" do header — N comments que chegaram
 * desde que o ThreadView abriu.
 *
 * O comment do cursor atual NÃO conta (user já tá ciente dele); útil
 * só pra surpresas que apareceram durante navegação. `currentId` pode
 * ser `null` na primeira render (cursor ainda não fixo).
 */
export function countNewSince(
  index: ThreadIndex,
  sinceUnixSec: number,
  currentId: string | null,
): number {
  let n = 0
  for (const node of index.byId.values()) {
    if (node.id === currentId) continue
    if (node.created_at >= sinceUnixSec) n += 1
  }
  return n
}
