/**
 * FullPageOverlay — primitive de overlay fullscreen (não modal centrado).
 *
 * Contraste com `<SlideUpOverlay>` (V3.0): SlideUp é modal pequeno
 * centralizado com max-width fixo (sm/md/lg). FullPage é overlay que
 * ocupa toda a tela — usado em V8 (MapOverlay, SettingsRoot) e V9
 * (ComposeOverlay). Mockup v0.7 .overlay class.
 *
 * Comportamento:
 * - Fixed inset-0, bg drift-bg (opaco — não vê o card abaixo)
 * - Slide-up enter (translateY 22px → 0, opacity 0 → 1, 250ms easeOut)
 * - role="dialog" aria-modal="true" — bloqueia tab pra background
 * - Header opcional (title + ação à direita) já renderizado pelo
 *   primitive — caller só passa props
 * - Body com overflow-y-auto (anti-overflow garantido)
 * - Footer opcional (sticky bottom, border-top)
 *
 * V8 inline impl em App.tsx (MapOverlay, SettingsRoot) duplicava ~30
 * linhas de boilerplate motion.div + header. V9 extrai pra primitive
 * pra DRY + consistência (header pattern uniforme + scroll behavior +
 * ESC closes — UX previsível em todas as overlays fullscreen).
 *
 * NÃO usa @ts-expect-error pra animar height — entry/exit é só Y+opacity
 * (não mexe em height pra evitar CLS no body).
 */

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { motion } from 'framer-motion'

export interface FullPageOverlayProps {
  /** Disparado pelo botão close + ESC. */
  onClose: () => void
  /** Texto do header (renderizado em h2 Syne 800). */
  title: string
  /**
   * Render opcional à direita do header (default = botão "FECHAR").
   * Pra ações alternativas tipo "CANCELAR" no compose.
   * Setar `null` pra esconder o close inteiramente.
   */
  headerRight?: ReactNode | null
  /** Conteúdo do body (scrollable). */
  children: ReactNode
  /** Footer sticky bottom — opcional, com border-top drift-border. */
  footer?: ReactNode
  /** aria-label custom (default = title). */
  ariaLabel?: string
  /** ESC fecha (default true). False em caso de ação destrutiva em vôo. */
  escDismissible?: boolean
}

export function FullPageOverlay({
  onClose,
  title,
  headerRight,
  children,
  footer,
  ariaLabel,
  escDismissible = true,
}: FullPageOverlayProps) {
  // ESC global handler. Cleanup quando overlay desmonta.
  useEffect(() => {
    if (!escDismissible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escDismissible, onClose])

  // Default header right = "FECHAR" button (mockup .btn-x).
  const right =
    headerRight === undefined ? (
      <button
        onClick={onClose}
        className="rounded border border-drift-border px-3 py-[5px] font-mono text-[10px] uppercase tracking-[2px] text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
        aria-label={`fechar ${ariaLabel ?? title}`}
      >
        fechar
      </button>
    ) : (
      headerRight
    )

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 22 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-40 flex flex-col bg-drift-bg"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-drift-border px-5 py-[15px]">
        <h2 className="font-display text-[19px] font-extrabold leading-none text-drift-text">
          {title}
        </h2>
        {right}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer && (
        <div className="shrink-0 border-t border-drift-border">{footer}</div>
      )}
    </motion.div>
  )
}
