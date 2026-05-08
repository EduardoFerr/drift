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
import { AnimatePresence, motion } from 'framer-motion'
import type { CommentNode } from '../../lib/thread-cursor'
import { applyContentFiltersComment } from '../../lib/feed'
import { usePrefsStore } from '../../lib/prefs'
import { Image } from '../UI/Image'

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
  // fix: CC-B2 moderation override (Track C debt) — states separados pra
  // moderação (score<=-999) e CW. Compartilhar um mesmo override fazia o
  // "ver mesmo assim" do CW desbloquear acidentalmente comment moderado.
  const [overrideMod, setOverrideMod] = useState(false)
  const [overrideCw, setOverrideCw] = useState(false)
  const [overrideBlur, setOverrideBlur] = useState(false)
  const isHidden = node.score <= -999 && !overrideMod

  // C.6.2 — applyContentFiltersComment: same logic as posts (block/mute
  // > content-warning > prefs). Determinístico (manifesto §7).
  // fix: CC-B1 render thrash (Track C debt) — selectors granulares pra evitar
  // re-render quando prefs irrelevantes (relays, theme) mudam. Os 4 campos
  // abaixo são os únicos que applyContentFiltersComment lê.
  const showNsfwDefault = usePrefsStore((s) => s.show_nsfw_default)
  const hideSpoilers = usePrefsStore((s) => s.hide_spoilers)
  const hideAds = usePrefsStore((s) => s.hide_ads)
  const cwHint = applyContentFiltersComment(
    { authorPub: node.author_pub, contentWarning: node.content_warning ?? null },
    {
      show_nsfw_default: showNsfwDefault,
      hide_spoilers: hideSpoilers,
      hide_ads: hideAds,
    } as Parameters<typeof applyContentFiltersComment>[1],
  )
  const cwHide = cwHint.hide && !overrideCw
  const cwBlur = cwHint.blur && !overrideBlur

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
      {/* Header: autor + tempo + content-warning chip (C.6.2) */}
      <header className="flex items-center justify-between gap-2 border-b border-drift-border px-4 py-3">
        <span className="font-display text-base font-bold uppercase tracking-tag text-drift-text">
          anon{truncate(node.author_pub)}
        </span>
        <div className="flex items-center gap-2">
          {node.content_warning && (
            <span
              className="rounded border border-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-meta text-amber-300"
              title={`autor marcou: ${node.content_warning}`}
              aria-label={`aviso de conteúdo: ${node.content_warning}`}
            >
              ⚠ {node.content_warning}
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            {timeAgo(node.created_at)}
          </span>
        </div>
      </header>

      {/* Body */}
      {/* polish: CC-P1 transition reveal (Track C P1) — fade suave quando
          troca placeholder ↔ conteúdo revelado, em vez de pop abrupto.
          motion-reduce respeitado via Framer (useReducedMotion global). */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <AnimatePresence mode="wait" initial={false}>
        {isHidden ? (
          <motion.div
            key="hidden-mod"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            <HiddenPlaceholder onReveal={() => setOverrideMod(true)} />
          </motion.div>
        ) : cwHide ? (
          <motion.div
            key="hidden-cw"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            <CwHiddenPlaceholder
              warning={cwHint.reason ?? cwHint.modReason ?? 'oculto'}
              onReveal={() => setOverrideCw(true)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="flex flex-col gap-3"
          >
            {/* C.6.3 — imagem anexada (Track B integration). Renderiza
                via Image c/ hash verify quando meta presente. Blur por
                CW aplica via filtro CSS. */}
            {node.meta && (
              <div
                className={cwBlur ? 'relative cursor-pointer' : 'relative'}
                onClick={cwBlur ? () => setOverrideBlur(true) : undefined}
              >
                <Image
                  src={node.meta.url ?? ''}
                  meta={node.meta}
                  alt={node.meta.alt ?? ''}
                  className={`max-h-[40vh] w-full rounded border border-drift-border object-contain transition ${
                    cwBlur ? 'blur-xl' : ''
                  }`}
                  aspect="auto"
                  fit="contain"
                />
                {cwBlur && (
                  <span
                    className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-meta text-amber-200"
                    aria-hidden="true"
                  >
                    toque pra revelar
                  </span>
                )}
              </div>
            )}
            <p
              className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-drift-text ${
                cwBlur ? 'blur-sm' : ''
              }`}
              onClick={cwBlur ? () => setOverrideBlur(true) : undefined}
            >
              {node.content}
            </p>
          </motion.div>
        )}
        </AnimatePresence>
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

function CwHiddenPlaceholder({
  warning,
  onReveal,
}: {
  warning: string
  onReveal: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="font-mono text-[11px] uppercase tracking-meta text-amber-300">
        ⚠ {warning}
      </span>
      <span className="font-mono text-[10px] text-drift-muted">
        autor marcou — manifesto §27
      </span>
      <button
        onClick={onReveal}
        className="rounded border border-drift-accent2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-meta text-drift-accent2 hover:bg-drift-accent2/10"
      >
        ver mesmo assim
      </button>
    </div>
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
