/**
 * DotsIndicator — paginação visual de subposts (ou genérica).
 *
 * Visual (alinhado ao mockup v0.7):
 * - Dots inativos: 5px círculo, bg drift-border
 * - Dot ativo: width 14px (não círculo, retângulo arredondado),
 *   border-radius 3px, bg drift-accent
 * - Transition 200ms ease (width + bg + border-radius simultâneos)
 *
 * Uso esperado:
 *
 *   <DotsIndicator total={subposts.length} active={subpostIdx} />
 *
 * Sem onClick por design — dots são purely informativos
 * (navegação acontece via swipe horizontal ou tap-to-advance no
 * componente parent). Se um caso futuro precisar de click-to-jump,
 * aceitar `onSelect?: (idx: number) => void` opcional.
 *
 * V3.0 cria; V5 polish formaliza tokens; V4 SubpostLayout consome.
 */

export interface DotsIndicatorProps {
  /** Quantos dots renderizar. Se ≤ 1, retorna null (sem dots quando 1 só). */
  total: number
  /** Index do dot ativo (0-based). Clamped a [0, total-1]. */
  active: number
  /** Variante visual: 'subtle' (default) ou 'prominent' (V3.5 swipe ind). */
  tone?: 'subtle' | 'prominent'
  /** Aria label do componente (default 'paginação'). */
  ariaLabel?: string
}

export function DotsIndicator({
  total,
  active,
  tone = 'subtle',
  ariaLabel = 'paginação',
}: DotsIndicatorProps) {
  if (total <= 1) return null

  const clampedActive = Math.max(0, Math.min(total - 1, active))
  const activeBg = tone === 'prominent' ? 'bg-drift-accent2' : 'bg-drift-accent'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-center justify-center gap-1.5 py-2"
    >
      {Array.from({ length: total }, (_, i) => {
        const isActive = i === clampedActive
        return (
          <span
            key={i}
            role="tab"
            aria-selected={isActive}
            aria-label={`subpost ${i + 1}`}
            className={`block h-[5px] rounded-full transition-[width,background-color,border-radius] duration-200 ease-out ${
              isActive
                ? `w-[14px] rounded-[3px] ${activeBg}`
                : 'w-[5px] bg-drift-border'
            }`}
          />
        )
      })}
    </div>
  )
}
