/**
 * DriftCard — primitive de card consolidando padrões repetidos em
 * PostCard, PostViewer card, CommentCard, FeedTabs internal cards.
 * Convergente com Ted RFC `2026-05-rfc-design-system-v08.md` §3.1.
 *
 * 39 finds (33% das auditorias Round 1+2) resolvíveis por DriftCard.
 * POST-priority #1 — single primitive com maior ROI.
 *
 * Variants:
 *   - default      → `bg-drift-surface border-1 border-drift-border rounded`
 *                    (PostCard, CommentCard padrão)
 *   - elevated     → + shadow (PostViewer card top, embedded mode)
 *   - inset        → `bg-drift-bg border-1 border-drift-border` (sub-cards
 *                    aninhados em FullPageCard)
 *   - shadow-stack → render principal + 2 shadow cards atrás (Tinder-style
 *                    PostViewer queue)
 *
 * Sizes:
 *   - sm → padding compacto (CommentCard)
 *   - md → padding default (PostCard)
 *   - lg → padding overlay (full-bleed em FullPageCard contexts)
 *
 * Slots:
 *   - header     → bloco superior (tag row, autor, badges)
 *   - children   → body (texto, imagem, etc.)
 *   - footer     → ações sticky (DRIFT/SINK buttons, meta)
 *   - decoration → letra Syne 800 absolute decorativa (text-only PostCard)
 *
 * Comportamento:
 *   - Quando `onClick` está presente: vira clickable, role="button",
 *     focus-visible ring, cursor pointer
 *   - Sem `onClick`: <article> semântico (default), sem affordance
 *   - `decoration` é renderizada com `pointer-events-none` + absolute
 *     positioning (caller controla via className extra se quiser
 *     custom; default é bottom-right)
 *
 * Adoção: incremental (modelo DriftButton). Call sites legacy ficam
 * com classes inline até migration coordenada (Round 5+).
 */

import type { ReactNode } from 'react'

export type DriftCardVariant = 'default' | 'elevated' | 'inset' | 'shadow-stack'
export type DriftCardSize = 'sm' | 'md' | 'lg'

export interface DriftCardProps {
  /** Estilo visual / semântica. Default 'default'. */
  variant?: DriftCardVariant
  /** Tamanho (padding scale). Default 'md'. */
  size?: DriftCardSize
  /** Slot opcional letra Syne 800 absolute decorativa (text layout). */
  decoration?: ReactNode
  /** Slot opcional do header (tag row + meta). */
  header?: ReactNode
  /** Body slot — children livre. */
  children?: ReactNode
  /** Slot opcional do footer (sticky action row). */
  footer?: ReactNode
  /** Pass-through className extra. */
  className?: string
  /** onClick — torna o card clickable (role="button", focus-visible). */
  onClick?: () => void
  /** aria-label (recomendado quando onClick presente). */
  ariaLabel?: string
}

// ─── Pure helpers (testáveis) ────────────────────────────────────────

/**
 * Mapeia variant pra classes Tailwind do container externo. Pure —
 * testável sem renderizar. shadow-stack é shape extra (background +
 * stack rendering), aqui retornamos somente o **card principal**;
 * shadow stack vem de driftCardShadowStackClass.
 */
export function driftCardVariantClass(variant: DriftCardVariant): string {
  switch (variant) {
    case 'default':
      return 'bg-drift-surface border border-drift-border rounded'
    case 'elevated':
      return 'bg-drift-surface border border-drift-border rounded shadow-[0_4px_18px_rgba(0,0,0,0.4)]'
    case 'inset':
      return 'bg-drift-bg border border-drift-border rounded'
    case 'shadow-stack':
      // Card principal igual default — shadow cards são renderizados
      // como siblings absolutos (ver driftCardShadowStackClass).
      return 'bg-drift-surface border border-drift-border rounded'
  }
}

/**
 * Padding interno por size. Scale alinhada ao Ted RFC §2.1 (p-card,
 * p-overlay) sem requerer plugin Tailwind utility — os literais
 * Tailwind built-in cobrem.
 */
export function driftCardSizeClass(size: DriftCardSize): string {
  switch (size) {
    case 'sm':
      return 'px-3 py-2'
    case 'md':
      return 'px-4 py-3'
    case 'lg':
      return 'px-5 py-4'
  }
}

/**
 * Classes base do container — sempre aplicadas. Inclui relative
 * (decoration absolute reference), overflow-hidden (decoration não
 * vaza), transition pra hover sutil.
 */
export const DRIFT_CARD_BASE_CLASS =
  'relative overflow-hidden transition-colors'

/**
 * Quando `onClick` presente: cursor + focus-visible ring + hover sutil.
 * Pura — pode ser testada isoladamente.
 */
export const DRIFT_CARD_CLICKABLE_CLASS =
  'cursor-pointer hover:border-drift-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg'

/**
 * Classes pros 2 shadow cards atrás (variant = 'shadow-stack'). Ordem:
 *   - back: scale 0.92, translateY 14, opacity 0.18 (-z-20)
 *   - mid:  scale 0.96, translateY 7,  opacity 0.4  (-z-10)
 * Caller é responsável por wrapping num parent relative.
 */
export const DRIFT_CARD_SHADOW_BACK_CLASS =
  'pointer-events-none absolute inset-0 -z-20 rounded border border-drift-border bg-drift-surface'
export const DRIFT_CARD_SHADOW_MID_CLASS =
  'pointer-events-none absolute inset-0 -z-10 rounded border border-drift-border bg-drift-surface'

/**
 * Compõe className final do card principal — pure helper pra testes.
 */
export function driftCardClassName(
  variant: DriftCardVariant = 'default',
  size: DriftCardSize = 'md',
  clickable: boolean = false,
  extra?: string,
): string {
  const parts = [
    DRIFT_CARD_BASE_CLASS,
    driftCardVariantClass(variant),
    driftCardSizeClass(size),
  ]
  if (clickable) parts.push(DRIFT_CARD_CLICKABLE_CLASS)
  if (extra) parts.push(extra)
  return parts.join(' ')
}

// ─── Component ───────────────────────────────────────────────────────

export function DriftCard({
  variant = 'default',
  size = 'md',
  decoration,
  header,
  children,
  footer,
  className,
  onClick,
  ariaLabel,
}: DriftCardProps) {
  const clickable = typeof onClick === 'function'
  const cardClass = driftCardClassName(variant, size, clickable, className)

  // shadow-stack adiciona 2 shadow cards atrás. Pra que eles renderizem
  // ATRÁS (z-negative), o parent precisa ser relative — DRIFT_CARD_BASE
  // já tem `relative`. Os shadows ficam dentro do mesmo wrapper, mas
  // como pseudo-decorations absolute -z-* eles ficam por trás
  // visualmente. Caller pode customizar via decoration slot.
  const showStack = variant === 'shadow-stack'

  const content = (
    <>
      {showStack && (
        <>
          <div
            aria-hidden="true"
            className={DRIFT_CARD_SHADOW_BACK_CLASS}
            style={{ transform: 'translateY(14px) scale(0.92)', opacity: 0.18 }}
          />
          <div
            aria-hidden="true"
            className={DRIFT_CARD_SHADOW_MID_CLASS}
            style={{ transform: 'translateY(7px) scale(0.96)', opacity: 0.4 }}
          />
        </>
      )}
      {header && <div className="drift-card-header">{header}</div>}
      {children !== undefined && <div className="drift-card-body">{children}</div>}
      {footer && <div className="drift-card-footer">{footer}</div>}
      {decoration && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
          {decoration}
        </div>
      )}
    </>
  )

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cardClass + ' text-left w-full'}
      >
        {content}
      </button>
    )
  }
  return (
    <article aria-label={ariaLabel} className={cardClass}>
      {content}
    </article>
  )
}
