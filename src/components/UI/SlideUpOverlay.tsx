/**
 * SlideUpOverlay — primitive de modal/overlay com slide-up animation.
 *
 * Padrão único pra todos os overlays do Drift v0.7+ (ProfileModal,
 * IdentityPanel, IdentitySwitcher, ReportModal, MultiTabModal,
 * SubpostEditor, OnboardingOverlay, ReplySheet, etc.).
 *
 * Extraído em V3.0 do redesign visual (HIMYM Round 1 — Lily flag de
 * 6+ modals reimplementando ~30 linhas de framer-motion boilerplate
 * cada). DRY mandatório, não opcional.
 *
 * **Variants** (2026-05-17):
 * - `centered` (default): inset items-center, rounded full border,
 *   slide-up Y:22→0. Pattern dialog clássico.
 * - `bottom-sheet`: inset items-end, rounded-t-2xl border-b-0, slide-up
 *   Y:100%→0. Pattern modal mobile (ReplySheet, action sheets).
 *
 * **dragToDismiss** (bottom-sheet only — 2026-05-17):
 * Quando true, primitive embarca drag-down-to-dismiss físico:
 * - Pointer events nativos com elastic 0.4 (replica framer-drag classic)
 * - RAF spring back se drag < threshold (stiffness 500, damping 38)
 * - Threshold 80px → dispara onClose
 * - reducedMotion desabilita (mesma semantics do framer-motion)
 * - Ignora drag em form elements (textarea/input/button — esses precisam
 *   dos próprios pointer events)
 *
 * **dragHandleVisible** (bottom-sheet only): renderiza handle visual
 * `h-1 w-10 bg-drift-border/60 rounded-full` no topo do sheet — affordance
 * visual pra indicar drag-down disponível.
 *
 * Composição esperada com `<ModalHeader>`:
 *
 *   <SlideUpOverlay onClose={onClose} ariaLabel="perfil">
 *     <ModalHeader title="perfil" onClose={onClose} />
 *     <section>...</section>
 *   </SlideUpOverlay>
 *
 * Bottom-sheet com drag:
 *
 *   <SlideUpOverlay
 *     variant="bottom-sheet"
 *     dragToDismiss
 *     dragHandleVisible
 *     onClose={onClose}
 *     backdropDismissible={!pending}
 *   >
 *     <header>...</header>
 *     <textarea ... />
 *   </SlideUpOverlay>
 *
 * Customizável via props:
 * - `maxWidth`: 'sm' | 'md' | 'lg' (default 'md' = max-w-md)
 * - `padded`: boolean (default true; bottom-sheet ignora, conteúdo controla)
 * - `backdropDismissible`: boolean (default true)
 * - `boost`: z-[60] em vez de z-40 (default false)
 * - `variant`: 'centered' | 'bottom-sheet' (default 'centered')
 * - `dragToDismiss`: drag-down fecha (default false, requer variant='bottom-sheet')
 * - `dragHandleVisible`: visual handle (default false)
 * - `labelledBy`: aria-labelledby (alternativa a ariaLabel — quando header
 *   tem id próprio)
 */

import { useEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, useReducedMotion } from 'framer-motion'

export type SlideUpOverlayVariant = 'centered' | 'bottom-sheet'

export interface SlideUpOverlayProps {
  /** Disparado quando user clica backdrop, drag-dismiss, ou fecha via outro mecanismo. */
  onClose: () => void
  /** Conteúdo interno (geralmente `<ModalHeader />` + section + footer). */
  children: ReactNode
  /** Largura máxima do modal. Default 'md' (28rem). */
  maxWidth?: 'sm' | 'md' | 'lg'
  /**
   * Padding interno do modal. Default true (p-5). Setar false em casos
   * onde o conteúdo controla padding (ex.: SubpostEditor com tabs+footer
   * sem gap visual). Variant bottom-sheet ignora (sempre p-0 — conteúdo
   * controla).
   */
  padded?: boolean
  /**
   * Se backdrop click fecha. Default true. Setar false em modals que
   * exigem ação explícita (ex.: MultiTabModal, ReplySheet quando publish
   * pending).
   */
  backdropDismissible?: boolean
  /**
   * aria-label pro role="dialog". Default null (sem aria-label, mas
   * children deve ter heading semantically discoverable).
   */
  ariaLabel?: string
  /**
   * Alternative a ariaLabel — id do heading interno (ex.: ModalHeader
   * gera um). Setar este permite screen reader vincular dialog ao título.
   */
  labelledBy?: string
  /**
   * Boost z-index pra z-[60] (default z-40). Usado em overlays que
   * precisam dominar UpdatePrompt (z-50) — onboarding, dialogs
   * críticos. Adicionado 2026-05-17 (OnboardingOverlay migration —
   * antes era z-[60] inline ad-hoc).
   */
  boost?: boolean
  /**
   * Variant visual + animação. Default 'centered'.
   *   - centered: items-center, slide-up Y:22→0, rounded full border
   *   - bottom-sheet: items-end, slide-up Y:100%→0, rounded-t-2xl border-b-0
   * Adicionado 2026-05-17 (ReplySheet migration — bottom-sheet pattern).
   */
  variant?: SlideUpOverlayVariant
  /**
   * Drag-down-to-dismiss (bottom-sheet only). Default false. Quando true,
   * user pode arrastar sheet pra baixo > 80px pra disparar onClose. Elastic
   * 0.4 + spring back se < threshold. Ignora drag em form elements.
   * reducedMotion desabilita.
   */
  dragToDismiss?: boolean
  /**
   * Renderiza drag handle visual `h-1 w-10` no topo do sheet (affordance
   * pra drag-down). Default false. Use junto com `dragToDismiss` pra
   * descoberta UX.
   */
  dragHandleVisible?: boolean
}

const MAX_WIDTH_CLASS: Record<NonNullable<SlideUpOverlayProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

// ─── Drag-to-dismiss constants ────────────────────────────────────────
// Tuning casa com ReplySheet pre-migration (consistente perceptualmente
// com swipe handlers do PostViewer V10).
const DRAG_DISMISS_THRESHOLD_PX = 80
const DRAG_ELASTIC_BOTTOM = 0.4
const SPRING_STIFFNESS = 500
const SPRING_DAMPING = 38
const SPRING_REST_VELOCITY = 0.5 // px/s
const SPRING_REST_DELTA = 0.5 // px

/**
 * Selector de elementos que NÃO devem iniciar drag (precisam dos próprios
 * pointer events — focus, click, scroll). Drag só "puxa" pela área
 * neutral do sheet (header gap, padding, drag handle visual).
 */
const DRAG_IGNORE_SELECTOR =
  'textarea, input, button, select, a, [role="button"], [role="radio"], [contenteditable="true"]'

export function SlideUpOverlay({
  onClose,
  children,
  maxWidth = 'md',
  padded = true,
  backdropDismissible = true,
  ariaLabel,
  labelledBy,
  boost = false,
  variant = 'centered',
  dragToDismiss = false,
  dragHandleVisible = false,
}: SlideUpOverlayProps) {
  const reducedMotion = useReducedMotion()
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const dragYRef = useRef(0)
  const activePointerRef = useRef<number | null>(null)
  const startYRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  // Cleanup: cancela RAF em andamento no unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  function applyDragTransform(y: number) {
    const el = sheetRef.current
    if (!el) return
    el.style.transform = `translate3d(0, ${y}px, 0)`
  }

  function clearDragTransform() {
    const el = sheetRef.current
    if (!el) return
    // String vazia devolve controle pro `animate` do framer-motion
    // (que mantém y=0). Sem isso, nosso inline style sobrescreveria
    // o exit animation pra y=100%.
    el.style.transform = ''
  }

  function cancelDragRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  function springBackDrag() {
    cancelDragRaf()
    if (reducedMotion) {
      dragYRef.current = 0
      clearDragTransform()
      return
    }
    let last = performance.now()
    let vy = 0
    const step = (now: number) => {
      const dt = Math.min(0.064, (now - last) / 1000)
      last = now
      const ay = -SPRING_STIFFNESS * dragYRef.current - SPRING_DAMPING * vy
      vy += ay * dt
      dragYRef.current += vy * dt
      applyDragTransform(dragYRef.current)
      const settled =
        Math.abs(dragYRef.current) < SPRING_REST_DELTA &&
        Math.abs(vy) < SPRING_REST_VELOCITY
      if (settled) {
        dragYRef.current = 0
        clearDragTransform()
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function handleSheetPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragToDismiss || reducedMotion) return
    if (e.button !== undefined && e.button !== 0) return
    if (activePointerRef.current !== null) return
    const target = e.target as HTMLElement | null
    if (target && target.closest(DRAG_IGNORE_SELECTOR)) return
    cancelDragRaf()
    activePointerRef.current = e.pointerId
    startYRef.current = e.clientY
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function handleSheetPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    const dy = e.clientY - startYRef.current
    // Elastic: só permite arrasto pra baixo (y > 0). y < 0 = hard wall.
    const yVisual = dy > 0 ? dy * DRAG_ELASTIC_BOTTOM : 0
    dragYRef.current = yVisual
    applyDragTransform(yVisual)
  }

  function handleSheetPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    if (dragYRef.current > DRAG_DISMISS_THRESHOLD_PX) {
      // Dismiss: deixa framer-motion fazer o exit anim. Limpamos transform
      // pra não conflitar com `exit`.
      dragYRef.current = 0
      clearDragTransform()
      onClose()
      return
    }
    springBackDrag()
  }

  function handleSheetPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    springBackDrag()
  }

  const isBottomSheet = variant === 'bottom-sheet'

  // Variant-aware sheet animation
  const sheetInitial = reducedMotion
    ? { opacity: 0 }
    : isBottomSheet
    ? { y: '100%', opacity: 0 }
    : { y: 22, opacity: 0 }
  const sheetAnimate = reducedMotion
    ? { opacity: 1 }
    : { y: 0, opacity: 1 }
  const sheetExit = reducedMotion
    ? { opacity: 0 }
    : isBottomSheet
    ? { y: '100%', opacity: 0 }
    : { y: 22, opacity: 0 }

  // Variant-aware backdrop layout
  const backdropAlignClass = isBottomSheet
    ? 'items-end justify-center'
    : 'items-center justify-center'
  // Bottom-sheet sem padding outer (sheet alinha com bottom)
  const backdropPaddingClass = isBottomSheet ? '' : 'p-4'
  // Bottom-sheet bg um pouco mais transparente (mais visual feedback do
  // que está por baixo durante drag).
  const backdropBgClass = isBottomSheet ? 'bg-drift-bg/60' : 'bg-drift-bg/90'

  // Variant-aware sheet visual
  const sheetShapeClass = isBottomSheet
    ? 'rounded-t-2xl border border-b-0 border-drift-border/40 touch-pan-y'
    : 'rounded border border-drift-border'
  const sheetBgClass = 'bg-drift-surface'
  const sheetPaddingClass = !isBottomSheet && padded ? 'p-5' : ''
  // Bottom-sheet escolheu overflow-hidden no inner (conteúdo controla
  // scroll); centered usa overflow-y-auto pra cap em max-h.
  const sheetOverflowClass = isBottomSheet
    ? 'overflow-hidden'
    : 'overflow-y-auto overscroll-contain'

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`fixed inset-0 flex backdrop-blur-sm ${backdropAlignClass} ${backdropPaddingClass} ${backdropBgClass} ${
        boost ? 'z-[60]' : 'z-40'
      }`}
      onClick={backdropDismissible ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
    >
      {/* Sheet container. max-h-[85dvh] garante anti-overflow.
          touch-pan-y em bottom-sheet pra não bloquear scroll de browser
          (drag horizontal NÃO é gesto nosso). */}
      <m.div
        ref={sheetRef}
        initial={sheetInitial}
        animate={sheetAnimate}
        exit={sheetExit}
        transition={{ duration: isBottomSheet ? 0.22 : 0.25, ease: 'easeOut' }}
        className={`flex max-h-[85dvh] w-full flex-col ${MAX_WIDTH_CLASS[maxWidth]} ${sheetShapeClass} ${sheetBgClass} ${sheetOverflowClass} ${sheetPaddingClass}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={dragToDismiss ? handleSheetPointerDown : undefined}
        onPointerMove={dragToDismiss ? handleSheetPointerMove : undefined}
        onPointerUp={dragToDismiss ? handleSheetPointerUp : undefined}
        onPointerCancel={dragToDismiss ? handleSheetPointerCancel : undefined}
      >
        {dragHandleVisible && (
          <div className="flex shrink-0 justify-center pt-2 pb-1">
            <div
              className="h-1 w-10 rounded-full bg-drift-border/60"
              aria-hidden="true"
            />
          </div>
        )}
        {children}
      </m.div>
    </m.div>
  )
}
