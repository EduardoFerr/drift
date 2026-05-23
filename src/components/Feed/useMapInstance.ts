/**
 * useMapInstance — hook compartilhado pra inicializar uma instância
 * MapLibre + Deck.gl overlay dentro de um container ref.
 *
 * Ted refactor B 2026-05-22 (refactor #1 do audit `ted-maps-review-2026-05-21`):
 * o padrão "loadMapDeps → new maplibregl.Map → addControl(overlay) →
 * cleanup map.remove()" aparece em PostModeMap E GlobalModeMap. N=2
 * (design-system §5 threshold). TimelineScrubber polish (Fase 3 do plano)
 * vai precisar mexer no GlobalModeMap; concentrar setup numa abstração
 * reduz risco de divergência cross-mode.
 *
 * Escopo MINIMAL (não overshoot):
 *   - Setup do mapa + overlay vazio + cleanup.
 *   - `onReady` callback recebe `{ map, overlay, deps }` quando init
 *     terminar — caller decide o que faz (RAF, layers, fitBounds, etc).
 *   - Hook NÃO gerencia animation loop, layers, ou state de RAF —
 *     responsabilidade do caller (cada mode tem semântica diferente).
 *
 * Manifesto §7 (determinismo): hook não introduz estado escondido —
 * mesma entrada (deps, opts) ⇒ mesma init.
 *
 * Decisão arquitetural: hook **não** retorna a instância do map.
 * Retornaria-la induz callers a guardarem em refs que escapam do
 * lifecycle do effect — pegadinha de cleanup. Em vez disso, callback
 * `onReady` roda dentro do useEffect, mantendo escopo controlado.
 */

import { useEffect } from 'react'
import { loadMapDeps, type MapDeps, type OverlayInstance } from './useMapDeps'

/**
 * Instância "viva" entregue ao caller via onReady. Map + overlay já
 * vinculados; `deps` exposto pra caller construir layers/animation.
 */
export interface MapInstanceHandle {
  /** maplibregl.Map instance (tipo opaco — caller usa methods do MapLibre). */
  map: unknown
  /** Deck.gl MapboxOverlay já addControl-ed no map. setProps disponível. */
  overlay: OverlayInstance
  /** Deps async-loaded (layers + ctors) pra caller usar. */
  deps: MapDeps
}

export interface UseMapInstanceOptions {
  /** Container ref que vai hospedar o canvas do mapa. */
  containerRef: React.RefObject<HTMLDivElement>
  /** Style spec MapLibre (já com tile template aplicado). */
  style: unknown
  /** Centro inicial [lng, lat]. */
  center: [number, number]
  /** Zoom inicial. */
  zoom: number
  /**
   * Callback executado APÓS map+overlay estarem prontos. Roda dentro
   * do useEffect — refs locais ao caller podem ser fechadas com segurança.
   * Retorna cleanup opcional (pra cancelar RAF, timers, etc).
   */
  onReady: (handle: MapInstanceHandle) => (() => void) | void
  /**
   * Lista de deps que disparam re-init do mapa. Caller decide
   * (tipicamente: `[data, mapView, tileTemplate]`).
   */
  deps: ReadonlyArray<unknown>
}

/**
 * Hook que monta MapLibre + Deck.gl overlay no container. Cleanup
 * automático em unmount/deps-change: cancela init async pendente,
 * remove map, chama cleanup do caller.
 *
 * Não retorna nada — toda interação acontece via `onReady` callback,
 * que vive no escopo do useEffect (cleanup correto garantido).
 */
export function useMapInstance(opts: UseMapInstanceOptions): void {
  const { containerRef, style, center, zoom, onReady, deps } = opts

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let mapCleanup: (() => void) | null = null
    let callerCleanup: (() => void) | void = undefined

    void (async () => {
      try {
        const mapDeps = await loadMapDeps()
        if (cancelled) return

        const { maplibregl, MapboxOverlay } = mapDeps

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = new (maplibregl as any).Map({
          container: el,
          style,
          center,
          zoom,
          attributionControl: false,
          dragRotate: false,
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mapCleanup = () => { try { (map as any).remove() } catch { /* noop */ } }

        const overlay = new MapboxOverlay({ layers: [] })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map as any).addControl(overlay)

        callerCleanup = onReady({ map, overlay, deps: mapDeps })
      } catch (err) {
        console.error('[useMapInstance] init error:', err)
      }
    })()

    return () => {
      cancelled = true
      if (typeof callerCleanup === 'function') {
        try { callerCleanup() } catch (err) {
          console.warn('[useMapInstance] caller cleanup error:', err)
        }
      }
      mapCleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
