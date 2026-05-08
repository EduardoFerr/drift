/**
 * Track C.6.1 — count prefetch de comments por post.
 *
 * Mantém um Record reativo `postId -> count` em store Zustand dedicada,
 * pra UI (PostViewer, badges no card) renderizar "💬 N" sem materializar
 * threads inteiras. Trade-off v1 (`Docs/comments.md` §3.2): contagem só
 * reflete comments JÁ persistidos via `onNostrEvent` ou já em SQLite no
 * boot. Posts antigos sem subscribe ativo mostram 0 até abrir ThreadView.
 *
 * Por que arquivo separado de `comments.ts`: `comments.ts` é território
 * da Lily (useThreadStore, buildThread, subscribe lazy). Este módulo
 * é estritamente *contagens agregadas*, sem overlap. Mantém PRs paralelos
 * sem conflito de merge.
 *
 * Idempotência (CLAUDE.md §1 — invariante):
 *  - `bumpCommentCount` é chamado SÓ uma vez por commentId (dedup via
 *    `seenCommentIds` Set, FIFO cap 10k igual `seenPostIds` em events.ts).
 *  - Em `loadCommentCounts` (boot), populamos o Set com todos os ids
 *    já persistidos pra evitar double-count quando comments do mesmo
 *    período chegam de novo via subscribe.
 */

import { create } from 'zustand'
import { db } from './db'

// ─── Store ───────────────────────────────────────────────────────────

interface CommentCountsState {
  /** postId → count de comments visíveis (score > -999). */
  countByPost: Record<string, number>
}

const INITIAL: CommentCountsState = {
  countByPost: {},
}

export const useCommentCountsStore = create<CommentCountsState>(() => INITIAL)

/**
 * Selector helper — retorna count do post (0 se ausente). Mantém UI
 * sempre com tipo `number`, sem `undefined` cascateando.
 */
export function selectCommentCount(postId: string): number {
  return useCommentCountsStore.getState().countByPost[postId] ?? 0
}

// ─── Dedup cross-relay ────────────────────────────────────────────────

/**
 * Cap defensivo igual `seenPostIds` em events.ts. Comments cross-relay
 * podem chegar 2x; sem dedup, count infla. Reset implícito em reload.
 */
const SEEN_COMMENT_IDS_CAP = 10_000
const seenCommentIds = new Set<string>()

function markSeen(commentId: string): boolean {
  if (seenCommentIds.has(commentId)) return false
  if (seenCommentIds.size >= SEEN_COMMENT_IDS_CAP) {
    const oldest = seenCommentIds.values().next().value
    if (oldest) seenCommentIds.delete(oldest)
  }
  seenCommentIds.add(commentId)
  return true
}

// ─── API ──────────────────────────────────────────────────────────────

/**
 * Incrementa contagem de um post se este `commentId` ainda não foi visto.
 * Chamado de `events.ts:persistCommentRow` após INSERT bem-sucedido.
 *
 * Retorna `true` se contou (primeiro avistamento), `false` se dedup.
 * Não exposto pro retorno em runtime (events.ts não usa), mas testável.
 */
export function bumpCommentCount(postId: string, commentId: string): boolean {
  if (!markSeen(commentId)) return false
  useCommentCountsStore.setState((s) => ({
    countByPost: {
      ...s.countByPost,
      [postId]: (s.countByPost[postId] ?? 0) + 1,
    },
  }))
  return true
}

interface CountRow {
  post_id: string
  n: number
}

interface IdRow {
  id: string
}

/**
 * Popula store com counts agregadas do SQLite. Roda 1x no boot pós-EOSE
 * (chamada via `bootstrap.ts` fire-and-forget). Idempotente — chamar 2x
 * sobrescreve com query fresca do banco.
 *
 * Também popula `seenCommentIds` com TODOS os ids persistidos. Isso é
 * crítico: sem isso, comments que estavam no banco e re-chegam via
 * subscribe ativo seriam contados de novo. Custo: ~64 bytes × N
 * comments ≤ 10k = 640KB worst-case (teto pelo cap). Aceitável.
 *
 * Filtra `score > -999` pra alinhar com `buildThread` (manifesto §17:
 * comments moderados não contam pra UI).
 */
export async function loadCommentCounts(): Promise<void> {
  const counts = await db.exec<CountRow>(
    `SELECT post_id, COUNT(*) AS n
       FROM comments
      WHERE score > -999
      GROUP BY post_id`,
  )
  const next: Record<string, number> = {}
  for (const row of counts ?? []) {
    next[row.post_id] = row.n
  }
  useCommentCountsStore.setState({ countByPost: next })

  // Popula seenCommentIds pra evitar double-count quando subscribe traz
  // de volta o mesmo comment. Cap respeitado: se houver mais de 10k
  // comments no banco, populamos os primeiros 10k — restantes vão
  // contar 1 vez extra cada (raro, aceitável v1).
  const ids = await db.exec<IdRow>(
    `SELECT id FROM comments
      WHERE score > -999
      LIMIT ?`,
    [SEEN_COMMENT_IDS_CAP],
  )
  // Reset Set local pra match com store. Idempotência cross-call.
  seenCommentIds.clear()
  for (const row of ids ?? []) {
    seenCommentIds.add(row.id)
  }
}

// ─── Test helpers (não usar em produção) ──────────────────────────────

/** Reseta state pra isolamento entre tests Vitest. */
export function _resetCommentCountsForTest(): void {
  seenCommentIds.clear()
  useCommentCountsStore.setState(INITIAL)
}

/** Inspeciona Set de ids vistos (test-only). */
export function _seenCommentIdsSize(): number {
  return seenCommentIds.size
}
