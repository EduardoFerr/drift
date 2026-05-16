/**
 * DriftChip — primitive de chip / badge / mini-pill. Convergente com
 * Ted RFC §3.3 + §3.4. Resolve 7+ ad-hoc shapes (CW chips, source
 * chips, CTA-as-chip).
 *
 * 7 variants:
 *   - neutral  → border drift-border, text drift-muted
 *   - accent   → drift-accent (chartreuse) — DRIFT highlight
 *   - accent2  → drift-accent2 (mint) — sub-actions
 *   - spread   → drift-spread (positive role)
 *   - bury     → drift-bury (negative role)
 *   - warning  → amber-400 (CW chip default)
 *   - spoiler  → amber-400 dashed (CW spoiler subtype)
 *
 * 3 sizes: xs | sm | md
 *
 * `active`: quando true, fill = variant color @12% opacity bg + full
 * border. Inactive = border only.
 *
 * `onClick` opcional — chip pressable. Sem onClick, render como
 * `<span>`.
 *
 * Acessibilidade:
 *   - aria-pressed quando onClick presente
 *   - focus-visible ring
 *   - high-contrast (warning amber-300 sobre dark bg = 9.8:1)
 */

import type { ReactNode } from 'react'

export type DriftChipVariant =
  | 'neutral'
  | 'accent'
  | 'accent2'
  | 'spread'
  | 'bury'
  | 'warning'
  | 'spoiler'

export type DriftChipSize = 'xs' | 'sm' | 'md'

export interface DriftChipProps {
  variant?: DriftChipVariant
  size?: DriftChipSize
  /** Ativo (filled). Default false (outline-only). */
  active?: boolean
  /** Clickable — render como button + aria-pressed. */
  onClick?: () => void
  ariaLabel?: string
  /** Optional leading icon. */
  icon?: ReactNode
  children: ReactNode
  className?: string
}

// ─── Pure helpers ────────────────────────────────────────────────────

/**
 * Mapeia variant + active pra classes Tailwind. Pure — testável.
 */
export function driftChipVariantClass(
  variant: DriftChipVariant,
  active: boolean,
): string {
  switch (variant) {
    case 'neutral':
      return active
        ? 'border-drift-text bg-drift-text/10 text-drift-text'
        : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
    case 'accent':
      return active
        ? 'border-drift-accent bg-drift-accent/12 text-drift-accent'
        : 'border-drift-border text-drift-muted hover:border-drift-accent hover:text-drift-accent'
    case 'accent2':
      return active
        ? 'border-drift-accent2 bg-drift-accent2/12 text-drift-accent2'
        : 'border-drift-border text-drift-muted hover:border-drift-accent2 hover:text-drift-accent2'
    case 'spread':
      return active
        ? 'border-drift-spread bg-drift-spread/15 text-drift-spread'
        : 'border-drift-spread/40 text-drift-spread hover:bg-drift-spread/10'
    case 'bury':
      return active
        ? 'border-drift-bury bg-drift-bury/15 text-drift-bury'
        : 'border-drift-bury/40 text-drift-bury hover:bg-drift-bury/10'
    case 'warning':
      return active
        ? 'border-amber-400 bg-amber-500/15 text-amber-300'
        : 'border-amber-400/60 bg-amber-500/10 text-amber-300'
    case 'spoiler':
      return active
        ? 'border-amber-400 border-dashed bg-amber-500/15 text-amber-300'
        : 'border-amber-400/60 border-dashed bg-amber-500/10 text-amber-300'
  }
}

/**
 * Size class — padding + text + tracking. Pure.
 */
export function driftChipSizeClass(size: DriftChipSize): string {
  switch (size) {
    case 'xs':
      return 'px-1.5 py-0.5 text-[12px] tracking-meta'
    case 'sm':
      return 'px-2 py-1 text-[12px] tracking-meta'
    case 'md':
      return 'px-3 py-1.5 text-[12px] tracking-meta'
  }
}

/**
 * Base class — sempre aplicada. Inclui rounded, border, transition,
 * focus-visible. Pure.
 */
export const DRIFT_CHIP_BASE_CLASS =
  'inline-flex items-center gap-1 rounded-sm border font-mono uppercase transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-1 focus-visible:ring-offset-drift-bg'

/**
 * Compõe className final. Pure helper pra testes.
 */
export function driftChipClassName(
  variant: DriftChipVariant = 'neutral',
  size: DriftChipSize = 'sm',
  active: boolean = false,
  extra?: string,
): string {
  const parts = [
    DRIFT_CHIP_BASE_CLASS,
    driftChipSizeClass(size),
    driftChipVariantClass(variant, active),
  ]
  if (extra) parts.push(extra)
  return parts.join(' ')
}

// ─── Component ───────────────────────────────────────────────────────

export function DriftChip({
  variant = 'neutral',
  size = 'sm',
  active = false,
  onClick,
  ariaLabel,
  icon,
  children,
  className,
}: DriftChipProps) {
  const cls = driftChipClassName(variant, size, active, className)
  if (typeof onClick === 'function') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={ariaLabel}
        className={cls}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        {children}
      </button>
    )
  }
  return (
    <span aria-label={ariaLabel} className={cls}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  )
}
