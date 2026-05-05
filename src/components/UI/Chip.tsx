/**
 * Chip — primitive de seletor pequeno (active/inactive).
 *
 * Usado em V3.x reskin e V4 layout system pra:
 * - Layout picker no SubpostEditor (3 chips: portrait/landscape/text)
 * - Content-warning toggles (4 chips: nsfw/violence/spoiler/ad)
 * - Location granularity (5 chips: off/country/city/gps)
 * - Network mode (3 chips: clearnet/tor/onion-only — V3.4 Settings)
 *
 * Visual (alinhado ao mockup v0.7):
 * - Inactive: border 1px drift-border, text drift-muted, bg transparent
 * - Active: border drift-accent, bg drift-accent, text drift-bg
 * - Hover/focus: ring drift-accent2 1px offset 2px (a11y keyboard nav)
 * - Tap: scale 0.95 (whileTap framer-motion)
 *
 * Tamanho compacto: padding 5px 12px, font 10px uppercase tracking.
 */

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export interface ChipProps {
  active: boolean
  onClick: () => void
  children: ReactNode
  /**
   * aria-pressed flag (default = active). Pra cenários onde chip
   * é usado como botão de ação (não toggle), passar undefined.
   */
  ariaPressed?: boolean | 'mixed' | undefined
  /**
   * aria-label pra leitor de tela quando children é só ícone.
   */
  ariaLabel?: string
  /** Disabled state — render greyed out, sem onClick. */
  disabled?: boolean
}

export function Chip({
  active,
  onClick,
  children,
  ariaPressed,
  ariaLabel,
  disabled = false,
}: ChipProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.95 }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={ariaPressed === undefined ? active : ariaPressed}
      aria-label={ariaLabel}
      className={`rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg disabled:opacity-40 ${
        active
          ? 'border-drift-accent bg-drift-accent text-drift-bg'
          : 'border-drift-border text-drift-muted hover:border-drift-accent hover:text-drift-text'
      }`}
    >
      {children}
    </motion.button>
  )
}
