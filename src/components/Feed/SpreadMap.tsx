/**
 * SpreadMap — visualização geográfica do espalhamento de um post.
 *
 * MapLibre GL (fork OSS de mapbox-gl) + Deck.gl ArcLayer pros arcos.
 * Tiles raster do CARTO Dark Matter (OSS, OSM-derived, sem API key).
 *
 * Por que NÃO Mapbox:
 *  - Token obrigatório centraliza o serviço (manifesto §17 — sem
 *    chave mestra, sem dependência crítica de fornecedor)
 *  - Free tier termina em 50k loads/mês com risco de cobrança
 *  - MapLibre tem API quase idêntica → migração trivial
 *
 * Comportamento:
 *   - Se nenhum spread tem `location` (manifesto §28 — location é opt-in,
 *     default off) → mostra estado vazio educativo.
 *   - Senão → renderiza globo com arcos animados de origem → cada destino.
 *
 * Manifesto §28 (Privacidade pelo Mínimo): mapa só mostra location que
 * o autor do spread escolheu publicar. Nunca infere via IP, nunca por
 * heurística — só lê a tag `location` do evento Nostr.
 *
 * Trocar de tile provider: editar `MAP_STYLE` abaixo. Qualquer estilo
 * MapLibre style spec (https://maplibre.org/maplibre-style-spec/) serve.
 */

import { useEffect, useRef } from 'react'
import { useSpreadMap } from '../../hooks/useSpreadMap'

export interface SpreadMapProps {
  postId: string
  className?: string
}

// CARTO Dark Matter — raster tiles OSS, sem chave de API. Subdomínios
// {a,b,c,d} aliviam carga. Style inline em vez de URL pra não depender
// de hospedagem externa.
//
// Atribuição CARTO+OSM é obrigatória pelos TOS — exibida em overlay
// no canto inferior direito do mapa.
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
  layers: [
    {
      id: 'carto',
      type: 'raster',
      source: 'carto',
    },
  ],
}

// ─── Subset mínimo dos tipos das libs externas ─────────────────────
// Importamos lazy (dynamic import). Tipar minimamente evita `any` sem
// pesar o bundle inicial — as libs só carregam quando user abre o mapa.

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace maplibregl {
  // Subset mínimo do schema do StyleSpec — nosso style inline acima
  // só usa o que está aqui, então não precisamos importar o tipo da lib.
  interface StyleSpecification {
    version: 8
    sources: Record<string, RasterSource>
    layers: RasterLayer[]
  }
  interface RasterSource {
    type: 'raster'
    tiles: string[]
    tileSize: number
    attribution?: string
  }
  interface RasterLayer {
    id: string
    type: 'raster'
    source: string
  }
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
}

interface ArcLayerProps {
  origin: [number, number]
  destination: [number, number]
}

export function SpreadMap({ postId, className = '' }: SpreadMapProps) {
  const { data, loading, error } = useSpreadMap(postId)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data || data.arcs.length === 0) return
    if (!containerRef.current) return

    let cancelled = false
    let cleanup: (() => void) | null = null

    // Lazy import: maplibre-gl + deck.gl somam ~400kb gzip. Sem location
    // nos spreads, nem importamos.
    void (async () => {
      try {
        const [maplibreModule, deckgl, layersModule] = await Promise.all([
          import('maplibre-gl'),
          import('@deck.gl/core'),
          import('@deck.gl/layers'),
        ])
        if (cancelled) return

        const maplibregl = maplibreModule.default as unknown as MaplibreStatic
        const { MapboxOverlay } = deckgl as unknown as {
          // MapboxOverlay funciona com qualquer mapa compatível com a API
          // do mapbox-gl — incluindo MapLibre, que é fork API-compatível.
          // O nome continua "Mapbox" por razões históricas do deck.gl.
          MapboxOverlay: new (props: { layers: unknown[] }) => unknown
        }
        const { ArcLayer } = layersModule as unknown as {
          ArcLayer: new (props: Record<string, unknown>) => unknown
        }

        const firstLoc = data.firstSpread?.location
        const center: [number, number] = firstLoc
          ? [firstLoc.lng, firstLoc.lat]
          : [0, 20]

        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: MAP_STYLE,
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
        console.error('[SpreadMap] falha ao carregar maplibre/deckgl:', err)
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [data])

  // ─── Estados de fallback (renderizam sem importar MapLibre) ────────

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
      <div
        className="pointer-events-auto absolute bottom-2 right-2 rounded bg-drift-bg/80 px-2 py-1 text-[9px] text-slate-500 backdrop-blur-sm [&_a]:underline [&_a]:hover:text-slate-300"
        // Atribuição embutida (CARTO + OSM TOS exigem). HTML é constante
        // estática — sem risco de XSS.
        dangerouslySetInnerHTML={{ __html: MAP_ATTRIBUTION }}
      />
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
