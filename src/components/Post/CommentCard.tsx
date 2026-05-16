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
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import type { CommentNode } from '../../lib/thread-cursor'
import {
  LIST_INDENT_PER_LEVEL_PX,
  LIST_INDENT_MAX_DEPTH,
} from '../../lib/thread-list'
import { applyContentFiltersComment } from '../../lib/feed'
import { usePrefsStore } from '../../lib/prefs'
import { timeAgo } from '../../lib/format'
import { Image } from '../UI/Image'
import { DriftChip } from '../UI/DriftChip'
import { commentRevealVariants } from '../../lib/motion-variants'

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
   * UX-11 (Robin audit 2026-05-08) — callback opcional pro footer
   * "↳ N respostas" virar tap-to-descend. Mantém swipe ↑ como input
   * primário; este só adiciona alternativa pra users que não conhecem
   * o gesto. Quando `undefined`, footer renderiza como texto estático
   * (compat com qualquer caller que não esteja em ThreadView).
   */
  onDescend?: () => void
  /**
   * Round Comments Nav Redesign — Phase A (RFC `2026-05-rfc-comments-
   * navigation-redesign`).
   *
   *  - `'card'` (default, legacy): layout fullscreen ocupa o viewport
   *    do ThreadView (cards-mode swipe-driven). Border own, padding
   *    generoso, font fluid-display.
   *  - `'list'` (novo, default user-facing): compact threaded row sem
   *    fullscreen. Indent visual via `paddingLeft = depth*12px` (cap
   *    em depth 5 visual, manifesto §RFC §3 plateau). Border-left thread
   *    line só pra `depth > 0`. Font fluid-base.
   *
   * Phase B (próximo sprint): collapse/expand persistido + virtualized
   * list (`@tanstack/react-virtual`). Phase C: jump-to-parent pill.
   */
  variant?: 'card' | 'list'
  /**
   * Phase A (list variant) — `true` se o user clicou neste card e ele
   * é o foco atual (ARIA `aria-selected`, border accent). `false` em
   * list comum. Ignorado em variant='card' (cards-mode usa cursor).
   */
  isFocused?: boolean
  /**
   * Phase A (list variant) — `false` colapsa subtree (esconde respostas
   * filhas no render do caller, footer mostra `[+ N respostas]` em vez
   * de `[- N respostas]`). Default `true`. Ignorado em variant='card'.
   */
  isExpanded?: boolean
  /**
   * Phase A (list variant) — toggle collapse/expand do subtree. Caller
   * mantém Set<commentId> de IDs colapsados. Ignorado em variant='card'.
   */
  onToggleExpand?: () => void
  /**
   * Phase A (list variant) — tap no body abre ReplySheet com ESTE
   * comment como target. Ignorado em variant='card' (lá o tap é no FAB).
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
  onDescend,
  variant = 'card',
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

  // Round 4 Fase B2: motion variants tokenizados (substitui durations
  // hardcoded 0.18 / 0.22). Reduced motion respeitado via factory.
  const reduced = useReducedMotion() ?? false
  const reveal = commentRevealVariants(reduced)

  // Phase A (list variant) — render compacto, threaded, indent visual.
  // Branch antes do return tradicional pra não inflar o card existing.
  if (variant === 'list') {
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
      />
    )
  }

  return (
    <article
      role="treeitem"
      aria-level={depth}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-label={ariaLabel}
      tabIndex={0}
      {...debugProps}
      // UX-5 (Robin audit) — border-left mint quando isNew sinaliza
      // "chegou desde abertura/refresh". Aplicado via classe condicional
      // pra evitar shift do conteúdo (border-l-2 sempre presente: cor
      // alterna entre transparente e drift-accent2).
      // Round 4 Fase A: convergente com DriftCard primitive (Ted §3.1) —
      // usa mesmo bg-drift-surface + focus-visible do primitive, mas
      // mantém este article com layout custom flex-col h-full + border-l
      // dinâmica (CommentCard tem layout próprio que DriftCard genérico
      // não replica). DriftCard helpers exported pra futuro lift.
      className={`flex h-full w-full flex-col bg-drift-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 border-l-2 ${
        isNew ? 'border-l-drift-accent2' : 'border-l-transparent'
      }`}
    >
      {/* Header: autor + tempo + content-warning chip (C.6.2) */}
      <header className="flex items-center justify-between gap-2 border-b border-drift-border px-4 py-3">
        <span className="font-display text-fluid-display font-bold uppercase tracking-tag text-drift-text">
          anon{truncate(node.author_pub)}
        </span>
        <div className="flex items-center gap-2">
          {node.content_warning && (
            <DriftChip
              variant="warning"
              size="xs"
              icon="⚠"
              ariaLabel={`aviso de conteúdo: ${node.content_warning}`}
            >
              {node.content_warning}
            </DriftChip>
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
          <m.div key="hidden-mod" {...reveal} className="h-full">
            <HiddenPlaceholder onReveal={() => setOverrideMod(true)} />
          </m.div>
        ) : cwHide ? (
          <m.div key="hidden-cw" {...reveal} className="h-full">
            <CwHiddenPlaceholder
              warning={cwHint.reason ?? cwHint.modReason ?? 'oculto'}
              onReveal={() => setOverrideCw(true)}
            />
          </m.div>
        ) : (
          <m.div
            key="content"
            {...reveal}
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
                    className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-meta text-drift-warning"
                    aria-hidden="true"
                  >
                    toque pra revelar
                  </span>
                )}
              </div>
            )}
            <p
              className={`whitespace-pre-wrap break-words font-mono text-fluid-lg leading-relaxed text-drift-text ${
                cwBlur ? 'blur-sm' : ''
              }`}
              onClick={cwBlur ? () => setOverrideBlur(true) : undefined}
            >
              {node.content}
            </p>
          </m.div>
        )}
        </AnimatePresence>
      </div>

      {/* Footer meta — childCount = hint pra descend.
          UX-11 (Robin audit) — vira <button> tappable quando há filhos
          E o caller passou onDescend. Mantém swipe ↑ (gesto primário);
          tap é input alternativo pra users que não conhecem o gesto. */}
      <footer className="flex items-center justify-between border-t border-drift-border px-4 py-2.5">
        {childCount > 0 && onDescend ? (
          <button
            type="button"
            onClick={onDescend}
            className="flex items-center gap-2 rounded font-mono text-[10px] uppercase tracking-meta text-drift-accent2 hover:text-drift-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            aria-label={`ver ${childCount} ${childCount === 1 ? 'resposta' : 'respostas'} (ou swipe para cima)`}
            aria-keyshortcuts="ArrowUp"
            title="ver respostas (toque ou swipe ↑)"
          >
            <span>
              ↳ {childCount} {childCount === 1 ? 'resposta' : 'respostas'}
            </span>
            <span aria-hidden="true" className="text-drift-accent2/80">
              ↑ ver
            </span>
          </button>
        ) : (
          <>
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
          </>
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
      <DriftChip variant="warning" size="sm" active icon="⚠" ariaLabel={`aviso de conteúdo: ${warning}`}>
        {warning}
      </DriftChip>
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
      <span className="font-mono text-[12px] uppercase tracking-meta text-drift-warning">
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
}: ListVariantProps) {
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
      {/* Header: autor · tempo · CW chip · collapse toggle */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-fluid-base font-bold uppercase tracking-tag text-drift-text">
            anon{truncate(node.author_pub)}
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            {timeAgo(node.created_at)}
          </span>
          {node.content_warning && (
            <span
              className="shrink-0 rounded border border-drift-warning/60 bg-drift-warning/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-meta text-drift-warning"
              title={`autor marcou: ${node.content_warning}`}
              aria-label={`aviso de conteúdo: ${node.content_warning}`}
            >
              ⚠ {node.content_warning}
            </span>
          )}
          {isNew && (
            <span
              className="shrink-0 rounded border border-drift-accent2/60 bg-drift-accent2/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-meta text-drift-accent2"
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
            className="shrink-0 rounded border border-drift-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted hover:border-drift-accent2 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
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
                  className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-meta text-drift-warning"
                  aria-hidden="true"
                >
                  toque pra revelar
                </span>
              )}
            </div>
          )}
          <p
            className={`line-clamp-6 whitespace-pre-wrap break-words font-mono text-fluid-base leading-relaxed text-drift-text ${
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
        </div>
      )}

      {/* Footer meta */}
      <footer className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
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
