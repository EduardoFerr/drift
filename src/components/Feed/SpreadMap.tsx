/**
 * SpreadMap — visualização geográfica do espalhamento de um post.
 *
 * Mapbox GL JS como base + Deck.gl ArcLayer pros arcos.
 *
 * Comportamento:
 *   - Se `VITE_MAPBOX_TOKEN` não está configurado → mostra placeholder
 *     com mensagem clara. Não quebra a UI.
 *   - Se nenhum spread tem `location` (manifesto §28 — location é opt-in,
 *     default off) → mostra estado vazio educativo.
 *   - Senão → renderiza globo com arcos animados de origem → cada destino.
 *
 * Manifesto §28 (Privacidade pelo Mínimo): mapa só mostra location que
 * o autor do spread escolheu publicar. Nunca infere via IP, nunca por
 * heurística — só lê a tag `location` do evento Nostr.
 *
 * Ativação na UI: botão 🗺️ no header do PostViewer (Fase 4 quando feature
 * estiver completa). Por enquanto exportado pra wire-up incremental.
 */

import { useEffect, useRef } from 'react'
import { useSpreadMap } from '../../hooks/useSpreadMap'

export interface SpreadMapProps {
  postId: string
  className?: string
}

const MAPBOX_TOKEN = (import.meta.env as { VITE_MAPBOX_TOKEN?: string }).VITE_MAPBOX_TOKEN ?? ''

// ─── Subset mínimo dos tipos das libs externas ─────────────────────
// Importamos lazy (dynamic import) e só usamos os métodos que precisamos.
// Tipar minimamente evita `any` espalhado e mantém o callsite checável.

interface MapboxStatic {
  accessToken: string
  Map: new (opts: {
    container: HTMLElement
    style: string
    center: [number, number]
    zoom: number
    attributionControl: boolean
    dragRotate: boolean
  }) => MapboxMap
}

interface MapboxMap {
  addControl(ctrl: unknown): void
  remove(): void
}

interface ArcLayerProps {
  origin: [number, number]
  destination: [number, number]
}

export function SpreadMap({ postId, className = '' }: SpreadMapProps) {
  const { data, loading, error } = useSpreadMap(postId)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!MAPBOX_TOKEN || !data || data.arcs.length === 0) return
    if (!containerRef.current) return

    let cancelled = false
    let cleanup: (() => void) | null = null

    // Lazy import: Mapbox é grande (~500kb gzip). Sem token configurado,
    // nem importamos. Sem location nos spreads, idem.
    void (async () => {
      try {
        const [mapboxModule, deckgl, layersModule] = await Promise.all([
          import('mapbox-gl'),
          import('@deck.gl/core'),
          import('@deck.gl/layers'),
        ])
        if (cancelled) return

        const mapboxgl = mapboxModule.default as unknown as MapboxStatic
        const { MapboxOverlay } = deckgl as unknown as {
          MapboxOverlay: new (props: { layers: unknown[] }) => unknown
        }
        const { ArcLayer } = layersModule as unknown as {
          ArcLayer: new (props: Record<string, unknown>) => unknown
        }

        mapboxgl.accessToken = MAPBOX_TOKEN

        const firstLoc = data.firstSpread?.location
        const center: [number, number] = firstLoc
          ? [firstLoc.lng, firstLoc.lat]
          : [0, 20]

        const map = new mapboxgl.Map({
          container: containerRef.current!,
          style: 'mapbox://styles/mapbox/dark-v11',
          center,
          zoom: 1.5,
          attributionControl: false,
          dragRotate: false,
        })

        const overlay = new MapboxOverlay({
          layers: [
            new ArcLayer({
              id: 'spread-arcs',
              data: data.arcs,
              getSourcePosition: (a: ArcLayerProps) => a.origin,
              getTargetPosition: (a: ArcLayerProps) => a.destination,
              getSourceColor: [167, 139, 250, 220], // drift-accent
              getTargetColor: [52, 211, 153, 200], // drift-spread
              getWidth: 1.5,
              greatCircle: true,
            }),
          ],
        })

        map.addControl(overlay)

        cleanup = () => {
          try {
            map.remove()
          } catch {
            /* noop — map pode já ter sido destruído */
          }
        }
      } catch (err) {
        console.error('[SpreadMap] falha ao carregar mapbox/deckgl:', err)
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [data])

  // ─── Estados de fallback (renderizam sem importar Mapbox) ──────────

  if (!MAPBOX_TOKEN) {
    return (
      <Placeholder
        className={className}
        title="mapa indisponível"
        body={
          <>
            VITE_MAPBOX_TOKEN não configurado. Mapa é feature opcional —
            cliente funciona normalmente sem ele.
          </>
        }
      />
    )
  }

  if (loading) {
    return (
      <Placeholder className={className} title="carregando mapa…" body="" />
    )
  }

  if (error) {
    return <Placeholder className={className} title="erro no mapa" body={error} />
  }

  if (!data || data.arcs.length === 0) {
    return (
      <Placeholder
        className={className}
        title="sem dados de localização"
        body={
          <>
            Spreads deste post não têm tag <code>location</code> (default
            é off — manifesto §28). Ative em Settings → location se quiser
            que seus próprios spreads apareçam no mapa de outros posts.
          </>
        }
      />
    )
  }

  return (
    <div className={`relative overflow-hidden rounded border border-drift-border ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-drift-bg/80 px-2 py-1 text-[10px] text-slate-400 backdrop-blur-sm">
        {data.totalSpreads} spreads · {data.countries.length}{' '}
        {data.countries.length === 1 ? 'país' : 'países'}
      </div>
    </div>
  )
}

function Placeholder({
  className,
  title,
  body,
}: {
  className: string
  title: string
  body: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded border border-dashed border-drift-border bg-drift-surface/40 p-6 text-center text-[11px] text-slate-500 ${className}`}
    >
      <span className="text-base">🗺️</span>
      <strong className="text-slate-400">{title}</strong>
      <p className="max-w-xs leading-relaxed">{body}</p>
    </div>
  )
}
