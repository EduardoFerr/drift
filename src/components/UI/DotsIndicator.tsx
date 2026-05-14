/**
 * DotsIndicator — paginação visual de subposts (ou genérica).
 *
 * Duas variantes:
 * - `dots` (default, legacy): bolinhas centralizadas; ativa é uma
 *   pílula horizontal (mockup v0.7). Usada quando dots ficam embedded
 *   num bloco de texto (TextLayout original).
 * - `segmented` (v9.2): barra horizontal estilo Instagram — segmentos
 *   equidistantes preenchendo toda a largura, posicionada no topo do
 *   card. Tappable: tap em segmento N pula pra subpost N. User pedido
 *   2026-05-09: "mais parecido com o do instagram, ficando no alto do
 *   card, borda".
 *
 * Uso esperado:
 *
 *   <DotsIndicator total={subposts.length} active={subpostIdx} />
 *   <DotsIndicator
 *     variant="segmented"
 *     total={subposts.length}
 *     active={subpostIdx}
 *     onSelect={setSubpostIdx}
 *   />
 *
 * `onSelect` é opcional em ambas as variantes; se ausente, dots/segments
 * ficam puramente informativos (sem `<button>`s, sem hit-test).
 */

export type DotsIndicatorVariant = 'dots' | 'segmented'

export interface DotsIndicatorProps {
  /** Quantos dots renderizar. Se ≤ 1, retorna null (sem dots quando 1 só). */
  total: number
  /** Index do dot ativo (0-based). Clamped a [0, total-1]. */
  active: number
  /** Variante visual: 'dots' (default — bolinhas) ou 'segmented' (barra Instagram). */
  variant?: DotsIndicatorVariant
  /** Tone (só relevante em 'dots'): 'subtle' (default) ou 'prominent' (V3.5 swipe ind). */
  tone?: 'subtle' | 'prominent'
  /** Callback de jump — quando presente, dots/segments viram <button>s. */
  onSelect?: (idx: number) => void
  /** Aria label do componente (default 'paginação'). */
  ariaLabel?: string
}

export function DotsIndicator({
  total,
  active,
  variant = 'dots',
  tone = 'subtle',
  onSelect,
  ariaLabel = 'paginação',
}: DotsIndicatorProps) {
  if (total <= 1) return null

  const clampedActive = Math.max(0, Math.min(total - 1, active))

  if (variant === 'segmented') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex w-full items-center gap-1 px-3 py-2"
      >
        {Array.from({ length: total }, (_, i) => {
          const isActive = i === clampedActive
          const segmentBar = (
            <span
              className={`block h-[3px] w-full rounded-full transition-colors duration-200 ${
                isActive ? 'bg-drift-accent' : 'bg-drift-text/25'
              }`}
            />
          )
          // Sem onSelect: render passivo (informativo só).
          if (!onSelect) {
            return (
              <span
                key={i}
                role="tab"
                aria-selected={isActive}
                aria-label={`subpost ${i + 1}`}
                className="flex flex-1 items-center"
              >
                {segmentBar}
              </span>
            )
          }
          // Com onSelect: button tappable. touch-action:none delega
          // gestos pro SwipeHandler pai (Framer drag continua vendo
          // pans iniciados aqui). Hit area expandida via py-1.5 sem
          // mudar visual do bar.
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`ir pra subpost ${i + 1}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSelect(i)
              }}
              className="group/seg flex flex-1 items-center py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 rounded"
              style={{ touchAction: 'none' }}
            >
              {segmentBar}
            </button>
          )
        })}
      </div>
    )
  }

  // variant === 'dots' (default)
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
