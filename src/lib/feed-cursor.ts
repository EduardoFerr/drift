/**
 * V11 (bug 2026-05-08 "swipe pula 2 posts") — cursor ops puras pra
 * navegação swipe no home feed.
 *
 * Causa raiz do bug: App rastreava posição via índice numérico. Quando
 * o user dava swipe ↑/↓ (spread/bury) e `invalidateFeed()` re-ordenava
 * o array no mesmo tick (score recalc), o slot `idx + 1` apontava pra
 * post diferente do que o user via como "próximo" antes do swipe —
 * sensação de "pulou 2".
 *
 * Fix: rastrear pelo ID do post. Estas funções decidem o próximo ID
 * baseado num SNAPSHOT do array no momento do swipe — invalidação
 * concorrente do feed não interfere mais.
 *
 * Funções 100% determinísticas (manifesto §7). Testáveis em Node sem
 * React/DOM/SQLite — `tests/feed-navigation-stable.test.ts`.
 */

/**
 * Estado do cursor por tab. Imutável — toda operação retorna novo
 * estado.
 *
 * - `postId === null`: estado inicial, antes do user tocar em qualquer
 *   coisa. UI renderiza `posts[0]` (head do feed). Inicialização lazy
 *   converte `null` → `posts[0].id` quando feed carrega.
 * - `atEnd === true`: user passou pelo último post. UI renderiza
 *   `EndOfFeed` em vez de PostViewer. `postId` continua apontando pro
 *   último post (preserva snap-back via `onBack`).
 */
export interface FeedCursor {
  postId: string | null
  atEnd: boolean
}

/** Item mínimo necessário pra navegar — só precisamos do ID. */
export interface CursorPost {
  id: string
}

/**
 * Resolve o índice atual baseado em `cursor.postId` no array `posts`.
 *
 * Casos:
 *  - `posts.length === 0` → 0 (irrelevante; UI renderiza HomeEmpty)
 *  - `cursor.atEnd === true` → `posts.length` (sentinel pós-último)
 *  - `cursor.postId === null` → 0 (estado inicial / topo)
 *  - `findIndex` acha o ID → retorna o índice encontrado
 *  - `findIndex === -1` (post sumiu por moderação/eviction) → snap pro
 *    `lastKnownIdx` clampado contra `posts.length - 1`
 *
 * Determinismo: mesmo input → mesmo output. Sem `Date.now()`, sem
 * lookup externo. Pure de propósito.
 */
export function resolveCursorIdx(
  cursor: FeedCursor,
  posts: readonly CursorPost[],
  lastKnownIdx: number,
): number {
  if (posts.length === 0) return 0
  if (cursor.atEnd) return posts.length
  if (cursor.postId === null) return 0
  const found = posts.findIndex((p) => p.id === cursor.postId)
  if (found >= 0) return found
  // Post sumiu — snap pro último idx conhecido, clampado.
  return Math.min(Math.max(0, lastKnownIdx), posts.length - 1)
}

/**
 * Avança o cursor pro próximo post no array. Snapshot do array é
 * passado explicitamente — caller é responsável por usar o array que
 * o user EFETIVAMENTE viu (não o que veio de re-sort concorrente).
 *
 * Retorno:
 *  - próximo cursor com `postId = posts[currentIdx + 1].id` se houver
 *    post seguinte
 *  - cursor `atEnd: true` mantendo `postId` no último (snap-back via
 *    `onBack` precisa do ID preservado) se o user já estava no último
 *  - cursor inalterado se array vazio (não deveria acontecer; defensivo)
 */
export function advanceCursor(
  cursor: FeedCursor,
  posts: readonly CursorPost[],
  currentIdx: number,
): FeedCursor {
  if (posts.length === 0) return cursor
  const nextIdx = currentIdx + 1
  if (nextIdx >= posts.length) {
    // Último post → atEnd. Mantém o postId atual pra que `onBack` (do
    // EndOfFeed) volte exatamente pra ele.
    const lastIdx = Math.min(currentIdx, posts.length - 1)
    return { postId: posts[lastIdx]!.id, atEnd: true }
  }
  return { postId: posts[nextIdx]!.id, atEnd: false }
}

/**
 * Navega pro post de índice `targetIdx`. Usado por jump-to-top, back
 * (de EndOfFeed), tap-on-active-tab e EndOfFeed.onJumpToTop.
 *
 * Clampa contra `posts.length - 1`. Se `targetIdx >= posts.length`,
 * vira `atEnd` (apontando pro último). Se array vazio, retorna cursor
 * inalterado.
 */
export function setCursorByIndex(
  cursor: FeedCursor,
  posts: readonly CursorPost[],
  targetIdx: number,
): FeedCursor {
  if (posts.length === 0) return cursor
  if (targetIdx >= posts.length) {
    return { postId: posts[posts.length - 1]!.id, atEnd: true }
  }
  const clamped = Math.max(0, targetIdx)
  return { postId: posts[clamped]!.id, atEnd: false }
}

/**
 * Sai do estado `atEnd` mantendo o `postId` (volta pro último visto).
 * Usado por EndOfFeed.onBack.
 */
export function exitAtEnd(cursor: FeedCursor): FeedCursor {
  if (!cursor.atEnd) return cursor
  return { postId: cursor.postId, atEnd: false }
}

/**
 * Inicialização lazy. Quando o feed carrega pela primeira vez E o
 * cursor da tab ainda é virgem (`postId === null` E `atEnd === false`),
 * ancora em `posts[0].id`.
 *
 * Caller já fez os guards (`feedLoaded`, `posts.length > 0`). Esta
 * função só decide se DEVE ancorar e o que retornar.
 *
 * Retorna `null` se não precisa mudar nada — caller pode pular
 * `setState` e evitar re-render desnecessário.
 */
export function initialAnchor(
  cursor: FeedCursor,
  posts: readonly CursorPost[],
): FeedCursor | null {
  if (cursor.postId !== null) return null
  if (cursor.atEnd) return null
  if (posts.length === 0) return null
  return { postId: posts[0]!.id, atEnd: false }
}
