/**
 * FullPageCard — primitive de overlay fullscreen (substituto de
 * `<FullPageOverlay>`). Convergente com Ted UX spike §5 + Robin QA #1 §7
 * (`Docs/sessions/ted-ux-spike-deployed-2026-05-08.md`,
 *  `Docs/sessions/design-qa-baseline-2026-05-08.md`).
 *
 * Diferenças vs FullPageOverlay:
 *
 * 1. **TX-1 fix (sub-card flicker mid-transition)**: opacity inicial é
 *    0.95 (não 0). Sub-card aparece quase-opaco no boot da animação;
 *    durante slide-up de 250ms o user não vê título/botão duplos
 *    sobrepostos translucid mid-transition. Mantém `y: 22 → 0` pra
 *    indicar movimento de card.
 *
 * 2. **TX-2 hard-cap em max-w-md**: SEMPRE aplica `max-w-md mx-auto`,
 *    independente de prop. FullPageOverlay já tinha mas era passível de
 *    override. ThreadView (que NÃO usa FullPageOverlay) precisa do
 *    mesmo cap aplicado externamente — esse arquivo só garante o cap em
 *    instâncias FullPageCard.
 *
 * 3. **TX-11 clickOutToClose opt-in**: por default false (consistente
 *    com comportamento atual de FullPageOverlay). Caller pode habilitar
 *    pra dar UX de modal ("clica fora pra fechar"). Em viewport > sm
 *    onde existe área `border-x` revealing dark area, click nessa área
 *    chama onClose. Em mobile (<= sm) não tem efeito visual (overlay
 *    ocupa 100% width).
 *
 * 4. **DriftButton no FECHAR**: o default headerRight passa de `<button>`
 *    inline pra `<DriftButton variant="ghost">` — primitivo dogfooding
 *    de outro primitivo (eat-your-own-dogfood pattern).
 *
 * Mantém FullPageOverlay API quase idêntica pra migração trivial; única
 * adição é `clickOutToClose` (default false → comportamento atual).
 *
 * Comportamento preservado:
 * - Fixed inset-0, bg drift-bg (opaco)
 * - Slide-up enter / exit (250ms easeOut)
 * - role="dialog" aria-modal
 * - Header opcional (title chartreuse + FECHAR border-accent text-accent2)
 * - Body com overflow-y-auto
 * - Footer opcional (sticky bottom, border-top)
 * - ESC handler (configurável via escDismissible)
 */

import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, useReducedMotion } from 'framer-motion'
import { DriftButton } from './DriftButton'
import { MOTION } from '../../lib/motion'

export interface FullPageCardProps {
  /** Disparado pelo botão close, ESC, e (se habilitado) backdrop click. */
  onClose: () => void
  /** Texto do header (renderizado em h2 Syne 800 chartreuse). */
  title: string
  /**
   * Render opcional à direita do header (default = botão "FECHAR" via
   * `<DriftButton variant="ghost">`).
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
  /**
   * Backdrop click fecha (default false). Quando true, click na área
   * border-x (sm+ viewports) chama onClose. TX-11 fix do Ted UX spike.
   */
  clickOutToClose?: boolean
}

/**
 * Pure helper — retorna o motion.initial config pra FullPageCard. TX-1 fix:
 * opacity: 0.95 (não 0) evita translucid mid-state em sub-card abrindo
 * sobre SettingsRoot. Exported pra testes.
 */
export function fullPageCardMotionInitial() {
  // opacity 0.95 é "quase opaco" — durante slide de 250ms, sub-card já
  // bg-drift-bg quase-cheio, não revela conteúdo do card abaixo
  // translucid. Combina com y:22 pra preservar gesto de slide-up.
  return { opacity: 0.95, y: 22 } as const
}

export function fullPageCardMotionAnimate() {
  return { opacity: 1, y: 0 } as const
}

export function fullPageCardMotionExit() {
  // Exit espelha initial (simétrico) — fade pra 0.95 não 0 também
  // mantém consistency.
  return { opacity: 0.95, y: 22 } as const
}

/**
 * Pure helper — retorna a className do container do card. TX-2 fix:
 * max-w-md mx-auto SEMPRE aplicado, sem prop pra override. Exported
 * pra testes.
 */
export const FULL_PAGE_CARD_CONTAINER_CLASS =
  'fixed inset-0 z-40 mx-auto flex max-w-md flex-col border-drift-border bg-drift-bg sm:border-x'

export function FullPageCard({
  onClose,
  title,
  headerRight,
  children,
  footer,
  ariaLabel,
  escDismissible = true,
  clickOutToClose = false,
}: FullPageCardProps) {
  // ESC global handler. Cleanup quando overlay desmonta.
  useEffect(() => {
    if (!escDismissible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escDismissible, onClose])

  // Default header right = "FECHAR" via DriftButton ghost variant.
  // Caller pode passar null pra esconder, ou ReactNode próprio (ex:
  // ComposeOverlay passa "CANCELAR" custom).
  const right =
    headerRight === undefined ? (
      <DriftButton
        variant="ghost"
        size="md"
        onClick={onClose}
        aria-label={`fechar ${ariaLabel ?? title}`}
      >
        fechar
      </DriftButton>
    ) : (
      headerRight
    )

  // Backdrop click handler — só dispara se clickOutToClose=true E o
  // event.target for o próprio container (não bubble de child).
  function handleBackdropClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!clickOutToClose) return
    if (e.target === e.currentTarget) onClose()
  }

  // Round 4 Fase B: tokenizado via MOTION.base (240ms) + reduced-motion
  // safe (substitui hardcoded `duration: 0.25, ease: easeOut`).
  const reduced = useReducedMotion()
  const transition = reduced ? { duration: 0 } : MOTION.base

  return (
    <m.div
      initial={reduced ? { opacity: 0.95 } : fullPageCardMotionInitial()}
      animate={fullPageCardMotionAnimate()}
      exit={reduced ? { opacity: 0 } : fullPageCardMotionExit()}
      transition={transition}
      className={FULL_PAGE_CARD_CONTAINER_CLASS}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      onClick={handleBackdropClick}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-drift-border px-5 py-[15px]">
        <h2 className="font-display text-[19px] font-extrabold leading-none text-drift-accent">
          {title}
        </h2>
        {right}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer && (
        <div className="shrink-0 border-t border-drift-border">{footer}</div>
      )}
    </m.div>
  )
}
