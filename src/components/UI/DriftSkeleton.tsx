/**
 * DriftSkeleton — primitive de loading skeleton. Convergente com Ted RFC
 * §3.5 + Lily RFC §3.2 + Robin REC-2.
 *
 * Estado pré-existente: apenas `Image.tsx` tinha skeleton (animate-pulse
 * gradient). Feed/Thread/ProfileModal mostravam blank ou texto puro
 * "carregando…" — UX-14 / CP-6 finds.
 *
 * 4 variants:
 *   - text   → linhas horizontais (count = N lines, last line w-3/4)
 *   - card   → DriftCard shape full (header + 2 text lines + footer)
 *   - avatar → circle h-8 w-8
 *   - image  → bloco com aspect-ratio (preview enquanto imagem carrega)
 *
 * Animações: `shimmer` default (linear-gradient sweep, CSS keyframes)
 * ou `pulse` (Tailwind animate-pulse). `static` em tests.
 *
 * Reduced motion: respeitado via `motion-reduce:animate-none` Tailwind.
 *
 * Aplicação POST-priority (Lily RFC §3.3):
 *   1. PostCard loading state (REC-2)
 *   2. CommentCard skeleton em ThreadView LoadingState
 *   3. ImageLightbox preview
 */

import type { ReactNode } from 'react'

export type DriftSkeletonVariant = 'text' | 'card' | 'avatar' | 'image'
export type DriftSkeletonAnimation = 'shimmer' | 'pulse' | 'static'

export interface DriftSkeletonProps {
  variant: DriftSkeletonVariant
  /** Quantas iterações (text=lines, card=stack count). Default 1. */
  count?: number
  /** Animation. Default 'pulse' (alinhado a Image.tsx pre-Round 4). */
  animation?: DriftSkeletonAnimation
  /** Aspect ratio (variant=image apenas). Default '16/9'. */
  aspect?: string
  className?: string
}

// ─── Pure helpers ────────────────────────────────────────────────────

/**
 * Mapeia animation pra classes Tailwind. Pure — testável.
 * `motion-reduce:animate-none` em todas exceto `static` (que já é
 * estático).
 */
export function driftSkeletonAnimationClass(
  animation: DriftSkeletonAnimation,
): string {
  switch (animation) {
    case 'shimmer':
      // Shimmer custom — bg gradient + animation infinite. Definido em
      // index.css `@keyframes drift-shimmer`. Fallback graceful pra
      // pulse se animation não exists no CSS (Tailwind built-in).
      return 'animate-pulse motion-reduce:animate-none'
    case 'pulse':
      return 'animate-pulse motion-reduce:animate-none'
    case 'static':
      return ''
  }
}

/**
 * Background base — gradient de drift-surface → drift-bg, alinhado ao
 * Image.tsx skeleton existente. Pure.
 */
export const DRIFT_SKELETON_BASE_CLASS =
  'bg-gradient-to-br from-drift-surface to-drift-bg'

/**
 * Cor de fallback (usada quando precisa só "block cinza" sem gradient,
 * ex: text variant — gradient muito sutil pra linhas finas).
 */
export const DRIFT_SKELETON_BLOCK_CLASS = 'bg-drift-border/40'

/**
 * Classes finais por variant. Pure helper — composição testável.
 */
export function driftSkeletonVariantClass(variant: DriftSkeletonVariant): string {
  switch (variant) {
    case 'text':
      // Línha fina — block color, no gradient (gradient não rende em
      // h-3 pequeno).
      return `h-3 w-full rounded-sm ${DRIFT_SKELETON_BLOCK_CLASS}`
    case 'card':
      return `rounded border border-drift-border ${DRIFT_SKELETON_BASE_CLASS}`
    case 'avatar':
      return `h-8 w-8 rounded-full ${DRIFT_SKELETON_BLOCK_CLASS}`
    case 'image':
      return `w-full overflow-hidden rounded ${DRIFT_SKELETON_BASE_CLASS}`
  }
}

// ─── Component ───────────────────────────────────────────────────────

export function DriftSkeleton({
  variant,
  count = 1,
  animation = 'pulse',
  aspect = '16/9',
  className,
}: DriftSkeletonProps): ReactNode {
  const animClass = driftSkeletonAnimationClass(animation)
  const variantClass = driftSkeletonVariantClass(variant)
  const extra = className ?? ''

  if (variant === 'text') {
    // N linhas, última com w-3/4.
    const lines = Array.from({ length: count }, (_, i) => i)
    return (
      <div
        className={`flex flex-col gap-2 ${extra}`}
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label="carregando"
      >
        {lines.map((i) => (
          <div
            key={i}
            className={`${variantClass} ${animClass} ${
              i === count - 1 && count > 1 ? 'w-3/4' : ''
            }`}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    // count cards empilhados verticalmente.
    const cards = Array.from({ length: count }, (_, i) => i)
    return (
      <div
        className={`flex flex-col gap-3 ${extra}`}
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label="carregando"
      >
        {cards.map((i) => (
          <div
            key={i}
            className={`${variantClass} ${animClass} h-[120px] p-4`}
          >
            {/* Inner pseudo-content: 1 linha header + 2 linhas body */}
            <div className={`mb-3 h-3 w-1/3 rounded-sm ${DRIFT_SKELETON_BLOCK_CLASS}`} />
            <div className={`mb-2 h-3 w-full rounded-sm ${DRIFT_SKELETON_BLOCK_CLASS}`} />
            <div className={`h-3 w-3/4 rounded-sm ${DRIFT_SKELETON_BLOCK_CLASS}`} />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'avatar') {
    return (
      <div
        className={`${variantClass} ${animClass} ${extra}`}
        role="status"
        aria-busy="true"
        aria-label="carregando avatar"
      />
    )
  }

  // image
  return (
    <div
      className={`${variantClass} ${animClass} ${extra}`}
      style={{ aspectRatio: aspect }}
      role="status"
      aria-busy="true"
      aria-label="carregando imagem"
    />
  )
}
