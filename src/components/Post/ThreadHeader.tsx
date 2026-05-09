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

import type { ThreadCursor, ThreadIndex } from '../../lib/thread-cursor'
import {
  buildBreadcrumb,
  countNewSince,
  siblingPosition,
} from '../../lib/thread-header'

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
}

export function ThreadHeader({
  cursor,
  index,
  openedAt,
  onClose,
  onRefreshNew,
  onNewTopLevelComment,
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

  return (
    <header
      className="flex shrink-0 items-center justify-between gap-3 border-b border-drift-border bg-drift-surface/95 px-4 py-3 backdrop-blur-sm"
      role="banner"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Breadcrumb */}
        <div
          className="flex items-center gap-1 truncate font-mono text-[10px] uppercase tracking-meta text-drift-muted"
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
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-meta text-drift-muted">
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
        {/* UX-9 (Robin audit) — CTA top-level sempre visível, em vez de
            depender só do EmptyState (que só aparece com thread vazia)
            ou do FAB "↵ responder" (que sempre vira sibling do current).
            Click → ReplySheet modo top-level (parent = post root). */}
        {onNewTopLevelComment && (
          <button
            onClick={onNewTopLevelComment}
            className="shrink-0 rounded border border-drift-accent px-2 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
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
