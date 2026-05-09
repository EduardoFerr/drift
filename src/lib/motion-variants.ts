/**
 * Motion variants — presets reutilizáveis pra Framer Motion. Convergente
 * com Lily RFC §2.2 + §5.2. Reduz duplication de ~50 LoC across
 * PostViewer, CommentCard, ComposeOverlay, ImageLightbox, FullPageCard,
 * SlideUpOverlay, DialogHost.
 *
 * Cada preset é uma `function (reduced: boolean)` — reflexo do trade-off
 * em RFC §5.2 ("presets-as-fns mais honest sobre reduced-motion"). User
 * com `prefers-reduced-motion: reduce` vê transições instantâneas
 * (duration: 0) em vez de scale/translate ricas.
 *
 * Uso típico (em componente React):
 *
 *   const reduced = useReducedMotion()
 *   <motion.div {...cardRevealVariants(reduced ?? false)}>...</motion.div>
 *
 * Ou pela hook utility:
 *
 *   const m = useMotionPreset()
 *   <motion.div initial={...} transition={m.emphasis}>
 */

import { useReducedMotion } from 'framer-motion'
import { MOTION } from './motion'

/** Transition objects, com fallback `{ duration: 0 }` quando reduced. */
export function useMotionPreset(): {
  micro: { duration: number; ease?: readonly number[] }
  fast: { duration: number; ease?: readonly number[] }
  base: { duration: number; ease?: readonly number[] }
  emphasis: { duration: number; ease?: readonly number[] }
  card: { duration: number; ease?: readonly number[] }
} {
  const reduced = useReducedMotion()
  if (reduced) {
    return {
      micro: { duration: 0 },
      fast: { duration: 0 },
      base: { duration: 0 },
      emphasis: { duration: 0 },
      card: { duration: 0 },
    }
  }
  return {
    micro: MOTION.micro,
    fast: MOTION.fast,
    base: MOTION.base,
    emphasis: MOTION.emphasis,
    card: MOTION.card,
  }
}

// ─── Variant factories (pure helpers — reduced flag → motion config) ─

/**
 * Card reveal — PostViewer enter/exit. Mantém o "Tinder-style" rise +
 * scale do shape original (`opacity 0→1, scale 0.96→1, y 20→0`),
 * tokenizado no easing emphasis.
 */
export function cardRevealVariants(reduced: boolean) {
  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    } as const
  }
  return {
    initial: { opacity: 0, scale: 0.96, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.94, y: -20 },
    transition: MOTION.emphasis,
  } as const
}

/**
 * Overlay slide-up (ComposeOverlay POST P0 + ReplySheet drag-snap).
 * Sheet vem de baixo, sai por baixo. Drag-down dismiss usa este shape.
 */
export function composeSheetVariants(reduced: boolean) {
  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    } as const
  }
  return {
    initial: { opacity: 0, y: '100%' },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
    transition: MOTION.base,
  } as const
}

/**
 * Lightbox backdrop — fade simples. ImageLightbox antes era "boom"
 * (sem transição); agora fade-in do backdrop em motion-fast.
 */
export function lightboxBackdropVariants(reduced: boolean) {
  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    } as const
  }
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: MOTION.fast,
  } as const
}

/** Lightbox imagem — fade + scale sutil pro fotograma central. */
export function lightboxImageVariants(reduced: boolean) {
  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    } as const
  }
  return {
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
    transition: MOTION.base,
  } as const
}

/**
 * Comment reveal — fade soft (substitui hard-coded `0.18` / `0.22`
 * em CommentCard). Mantém shape minimal (só opacity) — comments são
 * texto curto, sem necessidade de scale/translate.
 */
export function commentRevealVariants(reduced: boolean) {
  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    } as const
  }
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: MOTION.fast,
  } as const
}

/** Re-export pra conveniência em call sites que não querem hook. */
export { useReducedMotion }
