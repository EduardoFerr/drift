/**
 * useLongPress — primitive hook genérico pra detectar long-press com
 * ripple feedback (3 ondas concêntricas, 3s — mesma UX do PostViewer).
 *
 * V_2026-05-22 (user pedido): "se a gente pressionar por 3 segundos
 * o botão de ação para exibir o mapa, abre uma tela explicando para
 * que serve aquele mapa". Pra evitar duplicar a lógica de timer/slop/
 * pressOrigin que vive no PostViewer (LONG_PRESS_MS = 3000), extraímos
 * pra hook reusável. PostViewer pode migrar pra esta hook no futuro;
 * por ora coexistem (PostViewer tem semantics próprias — slim toggle —
 * que diferem do novo caso "explainer").
 *
 * Padrão:
 *
 *   const { handlers, pressing, pressOrigin } = useLongPress({
 *     ms: 3000,
 *     onLongPress: () => setShowExplainer(true),
 *   })
 *
 *   <button {...handlers}>...</button>
 *   {pressing && pressOrigin && (
 *     <RippleOverlay origin={pressOrigin} durationMs={3000} />
 *   )}
 *
 * Manifesto §1 (feedback design): zero JS overhead após mount —
 * timers cleanup automático em unmount + cancel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface UseLongPressOptions {
  /** Duração do hold pra trigger. Default 3000ms (alinhado ao PostViewer). */
  ms?: number
  /** Pixels de tolerância antes de cancelar (drag detection). Default 20. */
  slopPx?: number
  /** Callback quando long-press completa. */
  onLongPress: () => void
  /** Quando true, hook vira no-op (handlers vazios). Default false. */
  disabled?: boolean
}

export interface UseLongPressResult {
  /** Handlers pra spread no elemento target. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onPointerLeave: () => void
  }
  /** True enquanto o press está ativo (pra renderizar ripple overlay). */
  pressing: boolean
  /** Coord do toque relativo ao elemento (pra posicionar ripple). */
  pressOrigin: { x: number; y: number } | null
}

const NOOP_HANDLERS = {
  onPointerDown: () => undefined,
  onPointerMove: () => undefined,
  onPointerUp: () => undefined,
  onPointerCancel: () => undefined,
  onPointerLeave: () => undefined,
}

export function useLongPress(opts: UseLongPressOptions): UseLongPressResult {
  const { ms = 3000, slopPx = 20, onLongPress, disabled = false } = opts
  const [pressing, setPressing] = useState(false)
  const [pressOrigin, setPressOrigin] = useState<{ x: number; y: number } | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  // Captura callback mais recente sem re-criar handlers a cada render.
  const cbRef = useRef(onLongPress)
  useEffect(() => {
    cbRef.current = onLongPress
  }, [onLongPress])

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startRef.current = null
    setPressing(false)
    setPressOrigin(null)
  }, [])

  useEffect(() => () => cancel(), [cancel])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      startRef.current = { x: e.clientX, y: e.clientY }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPressOrigin({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      setPressing(true)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setPressing(false)
        setPressOrigin(null)
        startRef.current = null
        navigator.vibrate?.(50)
        cbRef.current()
      }, ms)
    },
    [ms],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      const dy = e.clientY - startRef.current.y
      if (Math.hypot(dx, dy) > slopPx) cancel()
    },
    [cancel, slopPx],
  )

  if (disabled) {
    return { handlers: NOOP_HANDLERS, pressing: false, pressOrigin: null }
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
    pressing,
    pressOrigin,
  }
}

/**
 * LONG_PRESS_MS canônico (alinhado ao PostViewer V_2026-05-21).
 * Exported pra que consumidores passem o mesmo valor pro ripple
 * overlay (`animationDuration: LONG_PRESS_MS ms`).
 */
export const LONG_PRESS_MS = 3000
