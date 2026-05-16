/**
 * Track C.4.3 — sticky header do `<ThreadView>`.
 *
 * Mostra contexto persistente (Barney HIGH #3 design-comments §4.2):
 *   - Breadcrumb de autores ao longo do `path` (truncado se > 4 níveis)
 *   - Counter "3/47 · nível 4"
 *   - Badge "+N novos" quando comments chegam durante navegação
 *   - Botão close (✕) — fallback sem depender do gesture knowledge
 *
 * Helpers de breadcrumb/counter/new-count vivem em `lib/thread-header.ts`
 * (puros, testados).
 */

import type { Post, ThreadViewMode } from '../../types/drift'
import type { ThreadCursor, ThreadIndex } from '../../lib/thread-cursor'
import {
  buildBreadcrumb,
  countNewSince,
  siblingPosition,
} from '../../lib/thread-header'
import { splitTitleBody, synthesizeTag } from './SubpostLayout'

export interface ThreadHeaderProps {
  cursor: ThreadCursor | null
  index: ThreadIndex
  /** Timestamp (unix s) em que ThreadView montou — pra contar "novos". */
  openedAt: number
  /** Callback do botão close. */
  onClose: () => void
  /** Callback opcional do badge "+N novos" — recarrega snapshot. */
  onRefreshNew?: () => void
  /**
   * UX-9 (Robin audit 2026-05-08) — abre ReplySheet em modo "top-level"
   * (parent = post root). Sem este callback, EmptyState é o único
   * caminho user-discoverable pra criar top-level novo, e ele só
   * aparece em thread vazia. Sempre visível quando passado.
   */
  onNewTopLevelComment?: () => void
  /**
   * TX-5 (Ted UX spike 2026-05-08) — post root da thread. Usado pra
   * exibir título legível ("III. Da identidade") em vez do hex críptico
   * "_D7DE3A". Quando ausente (callers legados), header cai pro modo
   * antigo "comentários · …xxxxxx". Determinístico (§7) — title vem do
   * `splitTitleBody(post.subposts[0]?.text)` ou `synthesizeTag(post)`.
   */
  post?: Post
  /**
   * Round Comments Nav Redesign — Phase A. Modo atual de render do
   * ThreadView. Toggle no header alterna entre 'list' (default novo,
   * scrollable threaded) e 'cards' (legacy swipe-stack opt-in).
   * Persistido via `setPref('thread_view_mode', …)` pelo caller.
   */
  viewMode?: ThreadViewMode
  /** Phase A — callback do toggle list⇄cards. */
  onToggleViewMode?: () => void
}

/**
 * TX-5 helper — decide o título legível pra mostrar no header.
 *
 * Estratégia (puro, determinístico §7):
 *   1. splitTitleBody do primeiro subpost — se houver title, usa ele
 *   2. fallback: synthesizeTag (category, location, ou contentWarning)
 *
 * Truncado em maxLen chars (default 40); abrevia com elipse (single char
 * U+2026). Caller decide se mostra "/" e o ID chip.
 */
export function deriveHeaderTitle(post: Post, maxLen = 40): string {
  const firstText = post.subposts[0]?.text ?? null
  const { title } = splitTitleBody(firstText)
  const candidate = title || synthesizeTag(post)
  if (candidate.length <= maxLen) return candidate
  return `${candidate.slice(0, maxLen - 1).trimEnd()}…`
}

export function ThreadHeader({
  cursor,
  index,
  openedAt,
  onClose,
  onRefreshNew,
  onNewTopLevelComment,
  post,
  viewMode,
  onToggleViewMode,
}: ThreadHeaderProps) {
  const breadcrumb = cursor ? buildBreadcrumb(cursor, index) : []
  const { position, total } = cursor
    ? siblingPosition(cursor, index)
    : { position: 0, total: 0 }
  const depth = cursor?.path.length ?? 0
  const newCount = countNewSince(
    index,
    openedAt,
    cursor?.path[cursor.path.length - 1] ?? null,
  )

  // TX-5 — título legível do post root (em vez do hex críptico
  // "_xxxxxx"). Chip ID com últimos 6 chars segue disponível pra debug
  // (font-mono small). Ambos só renderizam quando `post` foi passado;
  // sem `post`, header mostra apenas a breadcrumb (modo legado).
  const postTitle = post ? deriveHeaderTitle(post) : null
  const postIdShort = post ? post.id.slice(-6).toUpperCase() : null

  return (
    <header
      className="flex shrink-0 items-center justify-between gap-3 border-b border-drift-border bg-drift-surface/95 px-4 py-3 backdrop-blur-sm"
      role="banner"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* TX-5 — título do post root, legível, com chip ID opcional. */}
        {postTitle && (
          <div className="flex min-w-0 items-baseline gap-2">
            <h2
              className="truncate font-display text-fluid-display font-extrabold text-drift-text"
              title={postTitle}
            >
              {postTitle}
            </h2>
            {postIdShort && (
              <span
                className="shrink-0 font-mono text-[12px] uppercase tracking-meta text-drift-muted"
                title={`post id …${post!.id.slice(-12)}`}
                aria-hidden="true"
              >
                …{postIdShort}
              </span>
            )}
          </div>
        )}
        {/* Breadcrumb */}
        <div
          className="flex items-center gap-1 truncate font-mono text-fluid-xs uppercase tracking-meta text-drift-muted"
          aria-label="caminho da thread"
        >
          {breadcrumb.length === 0 ? (
            <span className="text-drift-muted">comentários</span>
          ) : (
            breadcrumb.map((label, i) => {
              // TH-T1 cleanup: chave por id estável quando possível.
              // Caso truncado (path > 4 → [first, …, second-last, last]):
              // separator '…' não tem path correspondente → fallback id.
              const path = cursor?.path ?? []
              const truncated = path.length > 4
              const stableId = truncated
                ? i === 0
                  ? path[0]
                  : i === 1
                    ? '__sep__'
                    : i === 2
                      ? path[path.length - 2]
                      : path[path.length - 1]
                : path[i]
              const key = `${stableId ?? i}:${i}`
              return (
                <span key={key} className="flex items-center gap-1">
                  {i > 0 && <span className="text-drift-muted/60">›</span>}
                  <span
                    className={
                      i === breadcrumb.length - 1
                        ? 'text-drift-text'
                        : 'text-drift-muted'
                    }
                  >
                    {label}
                  </span>
                </span>
              )
            })
          )}
        </div>

        {/* Counter + badge */}
        <div className="flex items-center gap-2 font-mono text-[12px] tracking-meta text-drift-muted">
          {total > 0 && (
            <span>
              <span className="text-drift-text">{position}</span>/{total}
              <span className="ml-2 uppercase">nível {depth}</span>
            </span>
          )}
          {/* polish: TH-P2 aria-live "+N novos" (Track C P1) — screen reader
              anuncia chegada de comments novos durante navegação. polite pra
              não interromper leitura corrente. */}
          <div aria-live="polite" aria-atomic="true">
            {newCount > 0 && (
              <button
                onClick={onRefreshNew}
                disabled={!onRefreshNew}
                className="rounded border border-drift-accent2 px-2 py-0.5 uppercase tracking-meta text-drift-accent2 hover:bg-drift-accent2/10 disabled:opacity-50"
                title="comments novos chegaram durante a navegação"
                aria-label={`${newCount} comentários novos chegaram`}
              >
                ↑ {newCount} novo{newCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Round Comments Nav Redesign Phase A — toggle list⇄cards.
            Default 'list' (RFC §10 Q3 cohort C). User pode voltar pro
            card-stack swipe-driven se preferir muscle memory. Persistido
            em user_prefs.thread_view_mode (manifesto §28). */}
        {onToggleViewMode && viewMode && (
          <button
            onClick={onToggleViewMode}
            className="shrink-0 rounded border border-drift-border px-2 py-1 font-mono text-[12px] text-drift-muted hover:border-drift-accent hover:text-drift-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            aria-label={
              viewMode === 'list'
                ? 'mudar pra modo cards (swipe imersivo)'
                : 'mudar pra modo lista (scrollable)'
            }
            aria-pressed={viewMode === 'cards'}
            title={
              viewMode === 'list'
                ? 'modo: lista · clique pra cards'
                : 'modo: cards · clique pra lista'
            }
          >
            {viewMode === 'list' ? '☰' : '⊞'}
          </button>
        )}
        {/* UX-9 (Robin audit) — CTA top-level sempre visível, em vez de
            depender só do EmptyState (que só aparece com thread vazia)
            ou do FAB "↵ responder" (que sempre vira sibling do current).
            Click → ReplySheet modo top-level (parent = post root). */}
        {onNewTopLevelComment && (
          <button
            onClick={onNewTopLevelComment}
            className="shrink-0 rounded border border-drift-accent px-2 py-1 font-mono text-[12px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            aria-label="comentar no post (top-level)"
            title="comentar no post (top-level)"
          >
            + no post
          </button>
        )}
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-drift-border px-2 py-1 font-mono text-[12px] text-drift-muted hover:border-drift-accent hover:text-drift-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
          aria-label="fechar thread"
          aria-keyshortcuts="Escape"
          title="fechar thread (Esc)"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
