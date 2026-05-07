/**
 * NavBar — primitive de bottom-nav com plus central (V3.3).
 *
 * Layout horizontal: 3 slots — left action(s), botão central + (compose),
 * right action(s). Botão central é disco 48×48 com glow accent e
 * `whileTap` scale 0.95 (framer-motion).
 *
 * Visual (alinhado ao mockup v0.7):
 * - Container fixed bottom-0, bg drift-bg/95 backdrop-blur-sm,
 *   border-top drift-border, padding 12px
 * - Plus central: 48×48 rounded-full bg drift-accent text drift-bg,
 *   shadow [0_0_22px_rgba(232,255,90,0.22)] (glow accent)
 * - Side buttons: SVG icon 20×20 + label DM Mono text-[10px]
 *   uppercase tracking-widest text-drift-muted
 * - Hover: text-drift-text + scale 1.02
 *
 * Composição esperada:
 *
 *   <NavBar
 *     left={[{ icon: <MapIcon />, label: 'mapa', onClick: openMap }]}
 *     right={[{ icon: <SettingsIcon />, label: 'settings', onClick: openSettings }]}
 *     onCompose={openComposer}
 *   />
 *
 * Status: ZERO CONSUMER em V3.3 — Drift atual usa header inline +
 * SubpostEditor always-mounted, o que torna bottom-nav structural
 * change (fora do escopo "visual only" de V3.x). Track futuro
 * (V7+ ou structural rework) consome este primitive. Pattern
 * idêntico aos primitives V3.0 (SlideUpOverlay/Chip/...).
 */

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export interface NavAction {
  /** Ícone (SVG component ou emoji em ReactNode). */
  icon: ReactNode
  /** Label DM Mono curto (recomendado ≤ 8 chars). */
  label: string
  /** Click handler. */
  onClick: () => void
  /** Variante visual ativa (ex.: aba selecionada). Default false. */
  active?: boolean
  /** aria-label se label não for descritivo o suficiente. */
  ariaLabel?: string
}

export interface NavBarProps {
  /** Ações do lado esquerdo do plus. Recomendado 1-2 itens. */
  left: NavAction[]
  /** Ações do lado direito do plus. Recomendado 1-2 itens. */
  right: NavAction[]
  /** Handler do botão central + (compose). */
  onCompose: () => void
  /** aria-label do plus button. Default 'criar post'. */
  composeAriaLabel?: string
}

export function NavBar({
  left,
  right,
  onCompose,
  composeAriaLabel = 'criar post',
}: NavBarProps) {
  return (
    <nav
      role="navigation"
      aria-label="navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-drift-border bg-drift-bg/95 px-3 py-3 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-2">
        <div className="flex flex-1 items-center justify-around gap-2">
          {left.map((a, i) => (
            <NavBtn key={`l-${i}`} action={a} />
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.04 }}
          onClick={onCompose}
          aria-label={composeAriaLabel}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-drift-accent text-drift-bg shadow-[0_0_22px_rgba(232,255,90,0.22)] focus:outline-none focus:ring-2 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
        >
          <span className="font-display text-xl font-extrabold leading-none">+</span>
        </motion.button>

        <div className="flex flex-1 items-center justify-around gap-2">
          {right.map((a, i) => (
            <NavBtn key={`r-${i}`} action={a} />
          ))}
        </div>
      </div>
    </nav>
  )
}

function NavBtn({ action }: { action: NavAction }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={action.onClick}
      aria-label={action.ariaLabel ?? action.label}
      aria-pressed={action.active}
      className={`flex flex-col items-center gap-1 rounded px-2 py-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
        action.active
          ? 'text-drift-accent'
          : 'text-drift-muted hover:text-drift-text'
      }`}
    >
      <span className="text-[18px] leading-none">{action.icon}</span>
      <span className="font-mono text-[10px] uppercase tracking-widest">
        {action.label}
      </span>
    </motion.button>
  )
}
