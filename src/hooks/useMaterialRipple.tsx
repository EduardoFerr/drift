/**
 * useMaterialRipple — hook genérico de touch feedback estilo Material
 * Design 3 (state layer expand).
 *
 * V_2026-05-21 (user pedido): "sensação de movimento ao toque, estilo
 * material design". Primitive isolada pra ser plugada em DriftButton,
 * DriftChip, ActionsFan items, ModeBtn, etc. Lily relatório (background
 * paralelo) decide DEPOIS quais componentes adotam.
 *
 * Como usar:
 *
 *   const { rippleHandlers, RippleLayer } = useMaterialRipple()
 *   return (
 *     <button {...rippleHandlers} className="material-ripple-host ...">
 *       conteúdo
 *       <RippleLayer />
 *     </button>
 *   )
 *
 * Comportamento:
 * - PointerDown → calcula coord relativa + max radius → cria nova wave
 * - Cleanup automático via `animationend` listener
 * - Múltiplos taps concorrentes OK (cada um é wave independente)
 * - Sem dependência de React render; pure DOM manipulation pós-mount
 *
 * Anti-padrões evitados:
 * - NÃO mantém state React por wave (re-render unnecessary)
 * - NÃO precisa containerRef do caller (usa currentTarget do event)
 * - NÃO conflita com `data-no-longpress` ou outras gestures (event
 *   handlers compostos via spread)
 *
 * Manifesto §1 (beleza + WCAG): respect prefers-reduced-motion via
 * CSS @media query no `material-ripple` class. Hook não conhece;
 * delegado pro CSS.
 *
 * Performance: ~0.1ms por wave (createElement + appendChild + remove).
 * Em listas grandes, host elements podem opt-out passando `disabled=true`.
 */

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

export interface UseMaterialRippleOptions {
  /**
   * Quando `true`, hook vira no-op (handlers vazios + RippleLayer null).
   * Útil pra desabilitar em scope (ex: button disabled, low-end mobile
   * via UserPrefs futuro, prefers-reduced-motion forçado).
   */
  disabled?: boolean
  /**
   * Override da cor — default usa `currentColor` do host (CSS herda).
   * Use só quando o foreground color do button NÃO é o que você quer
   * pro ripple (raro).
   */
  colorOverride?: string
}

export interface UseMaterialRippleResult {
  /** Spread no host element (button, div role=button, etc.). */
  rippleHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  }
  /**
   * Render no fim dos children do host (a wave nasce dentro do host
   * via DOM imperative; este componente é o "anchor div" onde waves
   * são injectadas).
   */
  RippleLayer: () => JSX.Element | null
}

export function useMaterialRipple(
  opts: UseMaterialRippleOptions = {},
): UseMaterialRippleResult {
  const layerRef = useRef<HTMLSpanElement | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (opts.disabled) return
      const host = e.currentTarget
      const rect = host.getBoundingClientRect()
      // Coord relativa ao host (não viewport)
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Material Design 3 spec: diâmetro = 2× distância ao canto mais
      // longe. Cobre 100% do host independente de onde foi tocado.
      const maxR = Math.hypot(
        Math.max(x, rect.width - x),
        Math.max(y, rect.height - y),
      )
      const diameter = maxR * 2

      const wave = document.createElement('span')
      wave.className = 'material-ripple'
      wave.style.left = `${x}px`
      wave.style.top = `${y}px`
      wave.style.width = `${diameter}px`
      wave.style.height = `${diameter}px`
      if (opts.colorOverride) wave.style.background = opts.colorOverride

      // Cleanup automático — wave self-removes após animation
      wave.addEventListener('animationend', () => wave.remove(), { once: true })

      // Inject no layer anchor (se mountado) OU direto no host
      const layer = layerRef.current ?? host
      layer.appendChild(wave)
    },
    [opts.disabled, opts.colorOverride],
  )

  const RippleLayer = useCallback(
    () =>
      opts.disabled ? null : (
        <span
          ref={layerRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0"
        />
      ),
    [opts.disabled],
  )

  return {
    rippleHandlers: { onPointerDown },
    RippleLayer,
  }
}
