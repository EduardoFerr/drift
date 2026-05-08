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
}

export function ThreadHeader({
  cursor,
  index,
  openedAt,
  onClose,
  onRefreshNew,
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
            breadcrumb.map((label, i) => (
              <span key={i} className="flex items-center gap-1">
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
            ))
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

      <button
        onClick={onClose}
        className="shrink-0 rounded border border-drift-border px-2 py-1 font-mono text-[12px] text-drift-muted hover:border-drift-accent hover:text-drift-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
        aria-label="fechar thread"
        aria-keyshortcuts="Escape"
        title="fechar thread (Esc)"
      >
        ✕
      </button>
    </header>
  )
}
