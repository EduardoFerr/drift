/**
 * Motion variants — presets reutilizáveis pra Framer Motion. Convergente
 * com Lily RFC §2.2 + §5.2.
 *
 * Cada preset é uma `function (reduced: boolean)` — reflexo do trade-off
 * em RFC §5.2 ("presets-as-fns mais honest sobre reduced-motion"). User
 * com `prefers-reduced-motion: reduce` vê transições instantâneas
 * (duration: 0) em vez de scale/translate ricas.
 *
 * Uso típico (em componente React):
 *
 *   const reduced = useReducedMotion()
 *   <motion.div {...lightboxBackdropVariants(reduced ?? false)}>...</motion.div>
 */

import { useReducedMotion } from 'framer-motion'
import { MOTION } from './motion'

// ─── Variant factories (pure helpers — reduced flag → motion config) ─

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
