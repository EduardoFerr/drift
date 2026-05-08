/**
 * Track C.4.2 — render de um comment individual no `<ThreadView>`.
 *
 * Mantém vocabulário visual do PostViewer/SubpostLayout: header em
 * font-display, body em font-mono, tokens drift-*. Card central ocupa
 * o viewport sob o header sticky.
 *
 * Comments moderados (score = -999) são filtrados em `buildThread`,
 * mas se o caller passar um node oculto (cliente alternativo, override
 * UI-only), renderiza placeholder com botão "ver oculto" — manifesto
 * §17 (cliente NÃO deleta dados moderados; só esconde).
 *
 * ARIA: `role="treeitem"`, `aria-level={depth}`, posinset/setsize.
 *
 * Spec: `Docs/design-comments.md` §4.1, §5.4.
 */

import { useState } from 'react'
import type { CommentNode } from '../../lib/thread-cursor'

export interface CommentCardProps {
  node: CommentNode
  /** Profundidade do nó na thread (1 = top-level). */
  depth: number
  /** Posição entre os irmãos (1-indexed). */
  posInSet: number
  /** Total de irmãos no nível atual. */
  setSize: number
  /** Quantidade de respostas diretas (filhos). */
  childCount: number
  /** ID do post raiz — só pra debug/title. */
  postId: string
}

export function CommentCard({
  node,
  depth,
  posInSet,
  setSize,
  childCount,
  postId,
}: CommentCardProps) {
  const [overrideHidden, setOverrideHidden] = useState(false)
  const isHidden = node.score <= -999 && !overrideHidden

  // Title pra debug acessível por screen reader
  const ariaLabel = `comment de ${truncate(node.author_pub)}, nível ${depth}, ${posInSet} de ${setSize}, ${childCount} respostas`

  return (
    <article
      role="treeitem"
      aria-level={depth}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-label={ariaLabel}
      tabIndex={0}
      data-post-id={postId}
      className="flex h-full w-full flex-col bg-drift-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
    >
      {/* Header: autor + tempo */}
      <header className="flex items-center justify-between border-b border-drift-border px-4 py-3">
        <span className="font-display text-base font-bold uppercase tracking-tag text-drift-text">
          anon{truncate(node.author_pub)}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
          {timeAgo(node.created_at)}
        </span>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isHidden ? (
          <HiddenPlaceholder onReveal={() => setOverrideHidden(true)} />
        ) : (
          <p className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-drift-text">
            {node.content}
          </p>
        )}
      </div>

      {/* Footer meta — childCount = hint pra descend */}
      <footer className="flex items-center justify-between border-t border-drift-border px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
          ↳ {childCount} {childCount === 1 ? 'resposta' : 'respostas'}
        </span>
        {childCount > 0 && (
          <span
            className="font-mono text-[10px] uppercase tracking-meta text-drift-accent2"
            title="swipe ↑ pra descer na thread"
            aria-hidden="true"
          >
            ↑ ver
          </span>
        )}
      </footer>
    </article>
  )
}

function HiddenPlaceholder({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="font-mono text-[11px] uppercase tracking-meta text-yellow-300">
        [comentário oculto]
      </span>
      <span className="font-mono text-[10px] text-drift-muted">
        moderado pela comunidade — manifesto §26
      </span>
      <button
        onClick={onReveal}
        className="rounded border border-drift-accent2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-meta text-drift-accent2 hover:bg-drift-accent2/10"
      >
        ver oculto
      </button>
    </div>
  )
}

function truncate(pub: string): string {
  if (pub.length <= 8) return pub
  return '…' + pub.slice(-6)
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
