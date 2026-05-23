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

import { useState, useRef, useEffect, useCallback } from 'react'
import type { CommentNode } from '../../lib/thread-cursor'
import {
  LIST_INDENT_PER_LEVEL_PX,
  LIST_INDENT_MAX_DEPTH,
} from '../../lib/thread-list'
import { applyContentFiltersComment } from '../../lib/feed'
import { usePrefsStore } from '../../lib/prefs'
import { useUserMetadata } from '../../lib/profiles'
import { timeAgo } from '../../lib/format'
import { Image } from '../UI/Image'
import { AuthorChip } from '../UI/AuthorChip'
import { DriftChip } from '../UI/DriftChip'

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
  /**
   * UX-5 (Robin audit 2026-05-08) — `true` se este comment chegou desde
   * que ThreadView abriu (ou desde último refresh do "+N novos"). Quando
   * `true`, render border-left mint. Some naturalmente quando `openedAt`
   * avança no próximo refresh/reabertura.
   */
  isNew?: boolean
  /**
   * Round Comments Nav Redesign — Phase A (RFC `2026-05-rfc-comments-
   * navigation-redesign`). Variant `'card'` (legacy fullscreen swipe-
   * driven) removida em 2026-05-23 (Ted dead-code audit §1.1, ZERO
   * call-sites — ThreadView é o único caller e sempre passou 'list').
   *
   * Layout atual: compact threaded row. Indent visual via
   * `paddingLeft = depth*12px` (cap em depth 5 visual, manifesto §RFC
   * §3 plateau). Border-left thread line só pra `depth > 0`. Font
   * fluid-base.
   *
   * Phase B (próximo sprint): collapse/expand persistido + virtualized
   * list (`@tanstack/react-virtual`). Phase C: jump-to-parent pill.
   *
   * `true` se o user clicou neste card e ele é o foco atual (ARIA
   * `aria-selected`, border accent).
   */
  isFocused?: boolean
  /**
   * `false` colapsa subtree (esconde respostas filhas no render do
   * caller, footer mostra `[+ N respostas]` em vez de `[- N respostas]`).
   * Default `true`.
   */
  isExpanded?: boolean
  /**
   * Toggle collapse/expand do subtree. Caller mantém Set<commentId> de
   * IDs colapsados.
   */
  onToggleExpand?: () => void
  /**
   * Tap no body abre ReplySheet com ESTE comment como target.
   */
  onTap?: () => void
}


export function CommentCard({
  node,
  depth,
  posInSet,
  setSize,
  childCount,
  postId,
  isNew = false,
  isFocused = false,
  isExpanded = true,
  onToggleExpand,
  onTap,
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

  // CC-T2 cleanup: data-post-id é só pra debug; só anexa em DEV.
  const debugProps = import.meta.env.DEV ? { 'data-post-id': postId } : {}

  // Lily Sprint N+2 P2.11 — busca metadata do autor reativamente. Comments
  // (`CommentNode`) NÃO recebem JOIN no read path (buildThread opera fora
  // do feed.ts query). Reativo via `useUserMetadata` re-query quando
  // `bumpProfileVersion(npub)` dispara — picture aparece assim que kind 0
  // chega via subscribe. Manifesto §5.3 opt-in (null = modo Anônimo).
  const authorMeta = useUserMetadata(node.author_pub)
  const authorAlias = authorMeta?.displayName ?? authorMeta?.name ?? undefined
  const authorPicture = authorMeta?.picture ?? undefined

  return (
    <ListVariant
      node={node}
      depth={depth}
      posInSet={posInSet}
      setSize={setSize}
      childCount={childCount}
      ariaLabel={ariaLabel}
      debugProps={debugProps}
      isNew={isNew}
      isHidden={isHidden}
      cwHide={cwHide}
      cwBlur={cwBlur}
      cwHint={cwHint}
      overrideMod={overrideMod}
      setOverrideMod={setOverrideMod}
      overrideCw={overrideCw}
      setOverrideCw={setOverrideCw}
      setOverrideBlur={setOverrideBlur}
      isFocused={isFocused}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      onTap={onTap}
      authorAlias={authorAlias}
      authorPicture={authorPicture}
    />
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
      <DriftChip variant="warning" size="sm" active icon="⚠" ariaLabel={`aviso de conteúdo: ${warning}`}>
        {warning}
      </DriftChip>
      <span className="font-mono text-[12px] text-drift-muted">
        autor marcou — manifesto §27
      </span>
      <button
        onClick={onReveal}
        className="rounded-xl bg-drift-accent2 px-5 py-3.5 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
      >
        ver mesmo assim
      </button>
    </div>
  )
}

function HiddenPlaceholder({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="font-mono text-[12px] uppercase tracking-meta text-drift-warning">
        [comentário oculto]
      </span>
      <span className="font-mono text-[12px] text-drift-muted">
        moderado pela comunidade — manifesto §26
      </span>
      <button
        onClick={onReveal}
        className="rounded-xl bg-drift-accent2 px-5 py-3.5 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
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

// ─── Phase A — list variant (Round Comments Nav Redesign) ───────────

interface ListVariantProps {
  node: CommentNode
  depth: number
  posInSet: number
  setSize: number
  childCount: number
  ariaLabel: string
  debugProps: Record<string, string | undefined>
  isNew: boolean
  isHidden: boolean
  cwHide: boolean
  cwBlur: boolean
  cwHint: ReturnType<typeof applyContentFiltersComment>
  overrideMod: boolean
  setOverrideMod: (v: boolean) => void
  overrideCw: boolean
  setOverrideCw: (v: boolean) => void
  setOverrideBlur: (v: boolean) => void
  isFocused: boolean
  isExpanded: boolean
  onToggleExpand?: () => void
  onTap?: () => void
  /** Lily Sprint N+2 P2.11 — opt-in NIP-01 metadata do autor. */
  authorAlias?: string
  authorPicture?: string
}

/**
 * Phase A (Round Comments Nav Redesign) — render compacto threaded.
 *
 * Layout (RFC §5 mockup):
 *
 *   [↳ thread line] @user · 2h · ▲N ▼N        [-]
 *                   "comment text wraps here..."
 *                   [↳ N respostas] [↵ responder]
 *
 * Indent: `paddingLeft = clamp(depth, 0, MAX) * PER_LEVEL_PX`. Border-left
 * 1px só quando `depth > 0` (visual nesting hint, RFC §2 Twitter thread
 * line + Reddit indent). Manifesto §22 score determinístico preservado
 * (sem sort selector, ordem from buildThread).
 */
function ListVariant({
  node,
  depth,
  posInSet,
  setSize,
  childCount,
  ariaLabel,
  debugProps,
  isNew,
  isHidden,
  cwHide,
  cwBlur,
  cwHint,
  setOverrideMod,
  setOverrideCw,
  setOverrideBlur,
  isFocused,
  isExpanded,
  onToggleExpand,
  onTap,
  authorAlias,
  authorPicture,
}: ListVariantProps) {
  // "ver mais" / "ver menos" — expand/collapse for truncated text.
  // Detection: ref on <p> compares scrollHeight > clientHeight after
  // render+layout. Falls back to content length heuristic (>150 chars)
  // for the initial render before layout measurement fires.
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  const checkTruncation = useCallback(() => {
    const el = textRef.current
    if (!el) return
    // scrollHeight > clientHeight means CSS line-clamp is hiding text.
    setIsTruncated(el.scrollHeight > el.clientHeight + 1)
  }, [])

  useEffect(() => {
    // Skip detection when already expanded (no clamp to measure against).
    if (expanded) return
    // Measure after layout paint.
    checkTruncation()
    // Re-check on resize (font size / container width may change).
    const ro = new ResizeObserver(checkTruncation)
    if (textRef.current) ro.observe(textRef.current)
    return () => ro.disconnect()
  }, [expanded, checkTruncation, node.content])

  const indentLevel = Math.min(depth, LIST_INDENT_MAX_DEPTH)
  const paddingLeft = indentLevel * LIST_INDENT_PER_LEVEL_PX
  const hasIndentLine = depth > 0

  return (
    <article
      role="treeitem"
      aria-level={depth}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-label={ariaLabel}
      aria-expanded={childCount > 0 ? isExpanded : undefined}
      aria-selected={isFocused || undefined}
      tabIndex={0}
      {...debugProps}
      style={{ paddingLeft }}
      // Border-left thread line conectiva (Twitter §2.2). border-l-2
      // alterna entre transparent / drift-accent2 (isNew, UX-5) /
      // drift-border (depth>0). Focused vira drift-accent.
      className={`relative flex w-full flex-col gap-1.5 border-l-2 px-3 py-3 transition-colors hover:bg-drift-surface/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 ${
        isFocused
          ? 'border-l-drift-accent bg-drift-surface/60'
          : isNew
            ? 'border-l-drift-accent2'
            : hasIndentLine
              ? 'border-l-drift-border'
              : 'border-l-transparent'
      }`}
    >
      {/* Header: autor · tempo · CW chip · collapse toggle
          Lily Sprint N+2 P2.11 — AuthorChip primitive substitui label
          legacy "anon{trunc}". Avatar pequeno (xs) + alias opt-in. */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AuthorChip
            authorPub={node.author_pub}
            alias={authorAlias}
            picture={authorPicture}
            size="xs"
            className="min-w-0 truncate"
          />
          <span className="shrink-0 font-mono text-[12px] uppercase tracking-meta text-drift-muted">
            {timeAgo(node.created_at)}
          </span>
          {node.content_warning && (
            <span
              className="shrink-0 rounded-lg border border-drift-warning/20 bg-drift-warning/5 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-meta text-drift-warning"
              title={`autor marcou: ${node.content_warning}`}
              aria-label={`aviso de conteúdo: ${node.content_warning}`}
            >
              ⚠ {node.content_warning}
            </span>
          )}
          {isNew && (
            <span
              className="shrink-0 rounded-lg border border-drift-accent2/20 bg-drift-accent2/5 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-meta text-drift-accent2"
              aria-label="comentário novo"
            >
              NOVO
            </span>
          )}
        </div>
        {childCount > 0 && onToggleExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="shrink-0 rounded-lg border border-drift-border/30 bg-drift-surface/30 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-meta text-drift-muted hover:border-drift-accent2/25 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            aria-label={
              isExpanded
                ? `colapsar ${childCount} ${childCount === 1 ? 'resposta' : 'respostas'}`
                : `expandir ${childCount} ${childCount === 1 ? 'resposta' : 'respostas'}`
            }
            title={isExpanded ? 'colapsar' : 'expandir'}
          >
            {isExpanded ? '[−]' : '[+]'}
          </button>
        )}
      </header>

      {/* Body */}
      {isHidden ? (
        <HiddenPlaceholder onReveal={() => setOverrideMod(true)} />
      ) : cwHide ? (
        <CwHiddenPlaceholder
          warning={cwHint.reason ?? cwHint.modReason ?? 'oculto'}
          onReveal={() => setOverrideCw(true)}
        />
      ) : (
        <div
          className={onTap ? 'cursor-pointer' : undefined}
          onClick={onTap}
        >
          {node.meta && (
            <div
              className={cwBlur ? 'relative cursor-pointer' : 'relative'}
              onClick={
                cwBlur
                  ? (e) => {
                      e.stopPropagation()
                      setOverrideBlur(true)
                    }
                  : undefined
              }
            >
              <Image
                src={node.meta.url ?? ''}
                meta={node.meta}
                alt={node.meta.alt ?? ''}
                className={`mb-2 max-h-[30vh] w-full rounded border border-drift-border object-contain transition ${
                  cwBlur ? 'blur-xl' : ''
                }`}
                aspect="auto"
                fit="contain"
              />
              {cwBlur && (
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[12px] uppercase tracking-meta text-drift-warning"
                  aria-hidden="true"
                >
                  toque pra revelar
                </span>
              )}
            </div>
          )}
          <p
            ref={textRef}
            className={`${expanded ? '' : 'line-clamp-6'} whitespace-pre-wrap break-words font-mono text-fluid-base leading-relaxed text-drift-text ${
              cwBlur ? 'blur-sm' : ''
            }`}
            onClick={
              cwBlur
                ? (e) => {
                    e.stopPropagation()
                    setOverrideBlur(true)
                  }
                : undefined
            }
          >
            {node.content}
          </p>
          {/* "ver mais" / "ver menos" toggle — only when text is actually
              truncated by line-clamp-6 (measured via scrollHeight) or when
              already expanded (so user can collapse back). */}
          {(isTruncated || expanded) && !cwBlur && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((v) => !v)
              }}
              className="mt-1 font-mono text-[12px] text-drift-accent hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
              aria-label={expanded ? 'ver menos do comentário' : 'ver mais do comentário'}
            >
              {expanded ? 'ver menos' : 'ver mais'}
            </button>
          )}
        </div>
      )}

      {/* Footer meta */}
      <footer className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted">
        {childCount > 0 && (
          <span className="text-drift-accent2">
            ↳ {childCount} {childCount === 1 ? 'resposta' : 'respostas'}
          </span>
        )}
        {onTap && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onTap()
            }}
            className="rounded text-drift-accent hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            aria-label="responder este comentário"
            title="responder"
          >
            ↵ responder
          </button>
        )}
      </footer>
    </article>
  )
}
