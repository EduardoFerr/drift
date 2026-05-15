/**
 * SpreadMap — visualização geográfica do espalhamento.
 *
 * Dois modos:
 *   post   — heatmap estático dos spreads de um único post (comportamento
 *            histórico). Origem amber, destinos heatmap verde.
 *   global — linhas animadas de propagação cross-post. Para cada post com
 *            spreads com location, traça a cadeia cronológica
 *            origin→spread₁→spread₂→... com animação RAF 8s + loop.
 *            Usa LineLayer (2D flat) + ScatterplotLayer, não ArcLayer 3D.
 *
 * MapLibre GL + Deck.gl. Tiles CARTO Dark Matter (OSS, sem API key).
 * Lazy import de ~400kb gzip — só carrega quando há geometria pra mostrar.
 *
 * Manifesto §28: só mostra location publicada pelo autor do spread.
 * Nunca infere via IP.
 */

import { useEffect, useRef } from 'react'
import { useSpreadMap } from '../../hooks/useSpreadMap'
import { usePrefsStore } from '../../lib/prefs'
import type { PropagationArc, SpreadMapData } from '../../types/drift'

export interface SpreadMapProps {
  postId: string | null
  className?: string
  mode?: 'post' | 'global'
  onModeChange?: (mode: 'post' | 'global') => void
  onOpenLocationSettings?: () => void
  /**
   * Em modo `global`, post atualmente em foco no overlay. Arcos/dots
   *  desse post são destacados visualmente (chartreuse), demais ficam
   *  em mint atenuado. Resolve UX "global é sempre o mesmo" — agora dá
   *  pra ver onde meu post se encaixa no agregado.
   */
  currentPostId?: string | null
}

const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>'

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: MAP_ATTRIBUTION,
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
}

// ─── Minimal type stubs (evita importar tipos pesados da lib) ─────────

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace maplibregl {
  interface StyleSpecification {
    version: 8
    sources: Record<string, RasterSource>
    layers: RasterLayer[]
  }
  interface RasterSource { type: 'raster'; tiles: string[]; tileSize: number; attribution?: string }
  interface RasterLayer { id: string; type: 'raster'; source: string }
}

interface MaplibreStatic {
  Map: new (opts: {
    container: HTMLElement
    style: maplibregl.StyleSpecification
    center: [number, number]
    zoom: number
    attributionControl: boolean | object
    dragRotate: boolean
  }) => MaplibreMap
}

interface MaplibreMap {
  addControl(ctrl: unknown): void
  remove(): void
  fitBounds(
    bounds: [[number, number], [number, number]],
    options?: { padding?: number; maxZoom?: number; duration?: number },
  ): void
  once(event: string, callback: () => void): void
}

type LayerCtor = new (props: Record<string, unknown>) => unknown
type OverlayInstance = { setProps: (p: { layers: unknown[] }) => void }

// ─── Public component ─────────────────────────────────────────────────

export function SpreadMap({
  postId,
  className = '',
  mode = 'post',
  onModeChange,
  onOpenLocationSettings,
  currentPostId,
}: SpreadMapProps) {
  const { data, loading, error } = useSpreadMap(postId, mode, currentPostId)
  const granularity = usePrefsStore((s) => s.location_granularity)

  const hasGeometry = !!data && (!!data.origin || data.destinations.length > 0)

  if (loading) {
    return <Placeholder className={className} title="carregando mapa…" body="" />
  }
  if (error) {
    return <Placeholder className={className} title="erro no mapa" body={error} />
  }
  if (!hasGeometry) {
    if (granularity === 'off' && mode === 'post') {
      return (
        <Placeholder
          className={className}
          title="GPS desativado nas suas configurações"
          body="Mapa de spreads precisa de location opt-in (manifesto §28 — default off por privacidade). Ative se quiser que seus spreads apareçam no mapa de outros posts."
          {...(onOpenLocationSettings ? { action: { label: 'ativar GPS', onClick: onOpenLocationSettings } } : {})}
        />
      )
    }
    return (
      <Placeholder
        className={className}
        title={mode === 'global' ? 'sem dados de localização globais' : 'sem dados de localização'}
        body={
          mode === 'global'
            ? 'Nenhum spread com tag location ainda. Quando alguém com GPS ativo driftar, a rede aparece aqui.'
            : 'Drifts deste post ainda não têm tag location. Quando alguém com GPS ativo driftar, aparece aqui.'
        }
      />
    )
  }

  if (mode === 'global') {
    return (
      <GlobalModeMap
        data={data}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
      />
    )
  }

  return (
    <PostModeMap
      data={data}
      className={className}
      mode={mode}
      onModeChange={onModeChange}
    />
  )
}

// ─── PostModeMap — heatmap estático (comportamento histórico) ─────────

interface ModeMapProps {
  data: SpreadMapData
  className: string
  mode: 'post' | 'global'
  onModeChange?: (m: 'post' | 'global') => void
}

interface PointLayerProps { position: [number, number] }
interface HeatmapPointProps { point: { lng: number; lat: number } }
/** Dot animado no GlobalModeMap. `isCurrent` controla cor (chartreuse
 *  vs mint atenuado) e raio (4 vs 3 px). */
interface AnimDotProps {
  pos: [number, number]
  t: number
  isCurrent: boolean
}

function PostModeMap({ data, className, mode, onModeChange }: ModeMapProps) {
  const mapView = usePrefsStore((s) => s.map_view)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      try {
        const [maplibreModule, deckMapbox, layersModule, aggregationModule] = await Promise.all([
          import('maplibre-gl'),
          import('@deck.gl/mapbox'),
          import('@deck.gl/layers'),
          import('@deck.gl/aggregation-layers'),
        ])
        if (cancelled) return

        const maplibregl = maplibreModule.default as unknown as MaplibreStatic
        const { MapboxOverlay } = deckMapbox as unknown as {
          MapboxOverlay: new (props: { layers: unknown[] }) => unknown
        }
        const { ScatterplotLayer } = layersModule as unknown as {
          ScatterplotLayer: LayerCtor
        }
        const { HeatmapLayer } = aggregationModule as unknown as {
          HeatmapLayer: LayerCtor
        }

        const centerPoint = data.origin ?? data.destinations[0]?.point ?? null
        const center: [number, number] = centerPoint
          ? [centerPoint.lng, centerPoint.lat]
          : [0, 20]

        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: MAP_STYLE,
          center,
          zoom: 1.5,
          attributionControl: false,
          dragRotate: false,
        })

        if (mapView === 'fit-bounds') {
          const bounds = computeBounds([
            ...(data.origin ? [[data.origin.lng, data.origin.lat] as [number, number]] : []),
            ...data.destinations.map((d): [number, number] => [d.point.lng, d.point.lat]),
          ])
          if (bounds) {
            map.once('load', () => {
              map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 })
            })
          }
        }

        const originPoints: PointLayerProps[] = data.origin
          ? [{ position: [data.origin.lng, data.origin.lat] }]
          : []
        const destPoints: PointLayerProps[] = data.destinations.map((d) => ({
          position: [d.point.lng, d.point.lat],
        }))

        const overlay = new MapboxOverlay({
          layers: [
            new HeatmapLayer({
              id: 'spread-heat',
              data: data.destinations,
              getPosition: (d: HeatmapPointProps) => [d.point.lng, d.point.lat],
              getWeight: 1,
              radiusPixels: 40,
              intensity: 1,
              threshold: 0.05,
              aggregation: 'SUM',
              colorRange: [
                [33, 102, 172, 0],
                [103, 169, 207, 80],
                [209, 229, 240, 130],
                [253, 219, 199, 180],
                [239, 138, 98, 220],
                [178, 24, 43, 250],
              ],
            }),
            new ScatterplotLayer({
              id: 'spread-origin',
              data: originPoints,
              getPosition: (p: PointLayerProps) => p.position,
              getFillColor: [251, 191, 36, 230],
              getRadius: 8,
              radiusUnits: 'pixels',
              stroked: true,
              getLineColor: [251, 191, 36, 255],
              lineWidthUnits: 'pixels',
              getLineWidth: 1.5,
            }),
            new ScatterplotLayer({
              id: 'spread-destinations',
              data: destPoints,
              getPosition: (p: PointLayerProps) => p.position,
              getFillColor: [52, 211, 153, 140],
              getRadius: 3,
              radiusUnits: 'pixels',
            }),
          ],
        })

        map.addControl(overlay)
        cleanup = () => { try { map.remove() } catch { /* noop */ } }
      } catch (err) {
        console.error('[SpreadMap post] init error:', err)
      }
    })()

    return () => { cancelled = true; cleanup?.() }
  }, [data, mapView])

  return (
    <MapShell
      containerRef={containerRef}
      className={className}
      mode={mode}
      onModeChange={onModeChange}
      stats={`${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'}`}
    />
  )
}

// ─── GlobalModeMap — linhas animadas de propagação ────────────────────

function GlobalModeMap({ data, className, mode, onModeChange }: ModeMapProps) {
  const mapView = usePrefsStore((s) => s.map_view)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let rafId = 0
    let pauseTimer: ReturnType<typeof setTimeout>
    let mapCleanup: (() => void) | null = null
    let overlay: OverlayInstance | null = null

    // Layer constructors — cached after async import
    let LineLayer: LayerCtor
    let ScatterplotLayer: LayerCtor

    // Precompute animation points from destinations.
    // isCurrent propaga o flag do data → render layer (cor condicional).
    const destPoints: AnimDotProps[] = data.destinations.map((d) => ({
      pos: [d.point.lng, d.point.lat] as [number, number],
      t: d.t,
      isCurrent: d.isCurrent === true,
    }))

    void (async () => {
      try {
        const [maplibreModule, deckMapbox, layersModule] = await Promise.all([
          import('maplibre-gl'),
          import('@deck.gl/mapbox'),
          import('@deck.gl/layers'),
        ])
        if (cancelled) return

        const maplibregl = maplibreModule.default as unknown as MaplibreStatic
        const { MapboxOverlay } = deckMapbox as unknown as {
          MapboxOverlay: new (props: { layers: unknown[] }) => OverlayInstance
        }
        const mods = layersModule as unknown as { LineLayer: LayerCtor; ScatterplotLayer: LayerCtor }
        LineLayer = mods.LineLayer
        ScatterplotLayer = mods.ScatterplotLayer

        const centerPt = data.destinations[0]?.point ?? null
        const center: [number, number] = centerPt ? [centerPt.lng, centerPt.lat] : [0, 20]

        const map = new maplibregl.Map({
          container: el,
          style: MAP_STYLE,
          center,
          zoom: 1.5,
          attributionControl: false,
          dragRotate: false,
        })

        mapCleanup = () => { try { map.remove() } catch { /* noop */ } }

        if (mapView === 'fit-bounds' && data.destinations.length > 0) {
          const bounds = computeBounds(
            data.destinations.map((d): [number, number] => [d.point.lng, d.point.lat]),
          )
          if (bounds) {
            map.once('load', () => map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 }))
          }
        }

        const inst = new MapboxOverlay({ layers: [] })
        overlay = inst
        map.addControl(inst)

        // ─── Animation loop ────────────────────────────────────────
        const ANIM_DURATION = 8000   // 8s pra percorrer toda a cadeia
        const FADE_IN = 0.06         // segmento aparece em 6% do ciclo
        const PAUSE_MS = 2000        // pausa entre ciclos

        let startTime: number | null = null
        let pausing = false

        function renderFrame(p: number) {
          if (!overlay) return

          // Só mostra segmentos cujo "disparo" já ocorreu
          const visSegs = data.arcs.filter((s) => s.t <= p)
          const visPts = destPoints.filter((d) => d.t <= p)

          overlay.setProps({
            layers: [
              new LineLayer({
                id: 'prop-lines',
                data: visSegs,
                getSourcePosition: (d: PropagationArc) => d.from,
                getTargetPosition: (d: PropagationArc) => d.to,
                // Arco do post corrente: linha mais grossa (2.5px) +
                // chartreuse drift-accent. Demais: mint atenuado fino.
                getWidth: (d: PropagationArc) => (d.isCurrent ? 2.5 : 1.5),
                // Fade-in suave: alpha sobe de 0→max em FADE_IN do ciclo.
                // isCurrent → chartreuse [232, 255, 90] alpha 220.
                // Outros → mint [52, 211, 153] alpha 90 (atenuado).
                getColor: (d: PropagationArc) => {
                  const age = p - d.t
                  const fade = Math.min(age / FADE_IN, 1)
                  if (d.isCurrent) {
                    return [232, 255, 90, Math.round(fade * 220)]
                  }
                  return [52, 211, 153, Math.round(fade * 90)]
                },
                widthUnits: 'pixels',
                updateTriggers: { getColor: p, getWidth: 1 },
              }),
              new ScatterplotLayer({
                id: 'prop-dots',
                data: visPts,
                getPosition: (d: AnimDotProps) => d.pos,
                // isCurrent → chartreuse (mesma do arco) + raio maior.
                getFillColor: (d: AnimDotProps) => {
                  const age = p - d.t
                  const fade = Math.min(age / FADE_IN, 1)
                  if (d.isCurrent) {
                    return [232, 255, 90, Math.round(fade * 240)]
                  }
                  return [52, 211, 153, Math.round(fade * 130)]
                },
                getRadius: (d: AnimDotProps) => {
                  const age = p - d.t
                  // Pulse: starts big, settles. isCurrent maior baseline.
                  const pulse = age < FADE_IN ? 1 + (1 - age / FADE_IN) * 4 : 1
                  const baseR = d.isCurrent ? 4 : 3
                  return baseR * pulse
                },
                radiusUnits: 'pixels',
                updateTriggers: { getFillColor: p, getRadius: p },
              }),
            ],
          })
        }

        function tick(ts: number) {
          if (pausing || cancelled) return
          if (!startTime) startTime = ts
          const p = Math.min((ts - startTime) / ANIM_DURATION, 1)
          renderFrame(p)
          if (p < 1) {
            rafId = requestAnimationFrame(tick)
          } else {
            pausing = true
            pauseTimer = setTimeout(() => {
              if (!cancelled) {
                startTime = null
                pausing = false
                rafId = requestAnimationFrame(tick)
              }
            }, PAUSE_MS)
          }
        }

        map.once('load', () => {
          if (!cancelled) rafId = requestAnimationFrame(tick)
        })
      } catch (err) {
        console.error('[SpreadMap global] init error:', err)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      clearTimeout(pauseTimer)
      mapCleanup?.()
      overlay = null
    }
  }, [data, mapView])

  return (
    <MapShell
      containerRef={containerRef}
      className={className}
      mode={mode}
      onModeChange={onModeChange}
      stats={`${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'} · todos os posts`}
    />
  )
}

// ─── MapShell — wrapper comum (toggle + stats + attribution) ──────────

function MapShell({
  containerRef,
  className,
  mode,
  onModeChange,
  stats,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  className: string
  mode: 'post' | 'global'
  onModeChange?: (m: 'post' | 'global') => void
  stats: string
}) {
  return (
    <div className={`relative overflow-hidden rounded border border-drift-border ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {onModeChange && (
        <div className="pointer-events-auto absolute left-2 top-2 flex overflow-hidden rounded border border-drift-border bg-drift-bg/90 backdrop-blur-sm">
          <ModeBtn active={mode === 'post'} onClick={() => onModeChange('post')}>post</ModeBtn>
          <ModeBtn active={mode === 'global'} onClick={() => onModeChange('global')}>global</ModeBtn>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-drift-bg/80 px-2 py-1 font-mono text-[10px] text-drift-muted backdrop-blur-sm">
        {stats}
      </div>
      <div
        className="pointer-events-auto absolute bottom-2 right-2 rounded bg-drift-bg/80 px-2 py-1 text-[9px] text-drift-muted backdrop-blur-sm [&_a]:underline [&_a]:hover:text-drift-text"
        dangerouslySetInnerHTML={{ __html: MAP_ATTRIBUTION }}
      />
    </div>
  )
}

// ─── ModeBtn ──────────────────────────────────────────────────────────

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-[10px] py-[5px] font-mono text-[9px] uppercase tracking-meta transition-colors ${
        active ? 'bg-drift-accent/15 text-drift-accent' : 'text-drift-muted hover:text-drift-text'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Placeholder ──────────────────────────────────────────────────────

function Placeholder({
  className,
  title,
  body,
  action,
}: {
  className: string
  title: string
  body: React.ReactNode
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded border border-dashed border-drift-border bg-drift-surface/40 p-6 text-center text-[11px] text-drift-muted ${className}`}>
      <span className="text-base">🗺️</span>
      <strong className="text-drift-text">{title}</strong>
      <p className="max-w-xs leading-relaxed">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 rounded border border-drift-accent px-3 py-1 text-[10px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// ─── computeBounds (pure, exported for tests) ─────────────────────────

export function _computeBounds(
  points: [number, number][],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [[minLng, minLat], [maxLng, maxLat]]
}

const computeBounds = _computeBounds
