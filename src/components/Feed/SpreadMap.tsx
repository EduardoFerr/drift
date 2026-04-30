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
import { usePrefsStore } from '../../lib/prefs'

export interface SpreadMapProps {
  postId: string
  className?: string
  /**
   * Callback opcional pra abrir Settings na seção `location` (manifesto §28
   * — location é opt-in). Se passada, o estado vazio do mapa renderiza um
   * CTA acionável quando `location_granularity === 'off'`. Sem callback,
   * o placeholder mostra só texto (sem botão) — útil pra contextos onde
   * o user não tem como navegar pra settings (e.g. preview).
   */
  onOpenLocationSettings?: () => void
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

interface PointLayerProps {
  position: [number, number]
}

export function SpreadMap({
  postId,
  className = '',
  onOpenLocationSettings,
}: SpreadMapProps) {
  const { data, loading, error } = useSpreadMap(postId)
  const granularity = usePrefsStore((s) => s.location_granularity)
  const containerRef = useRef<HTMLDivElement>(null)

  // "Tem algo pra mostrar" = origem do post OU pelo menos 1 destino com
  // location. Antes o gate era `arcs.length === 0`, mas mapa com 1 ponto
  // só (origem sem espalhamento, ou 1 spread sem origem) também é visual
  // útil — bug histórico que escondia esses casos.
  const hasGeometry =
    !!data && (!!data.origin || data.destinations.length > 0)

  useEffect(() => {
    if (!hasGeometry || !data) return
    if (!containerRef.current) return

    let cancelled = false
    let cleanup: (() => void) | null = null

    // Lazy import: maplibre-gl + deck.gl somam ~400kb gzip. Sem location,
    // nem importamos.
    void (async () => {
      try {
        const [maplibreModule, deckMapbox, layersModule] = await Promise.all([
          import('maplibre-gl'),
          // `MapboxOverlay` mora em `@deck.gl/mapbox`, NÃO em `@deck.gl/core`.
          // Antes importávamos de `core` e o cast `as unknown` silenciava o
          // erro de tipos — runtime explodia com "MapboxOverlay is not a
          // constructor" assim que o useEffect disparava (sintoma só visível
          // quando havia dados pra renderizar).
          import('@deck.gl/mapbox'),
          import('@deck.gl/layers'),
        ])
        if (cancelled) return

        const maplibregl = maplibreModule.default as unknown as MaplibreStatic
        const { MapboxOverlay } = deckMapbox as unknown as {
          // MapboxOverlay funciona com qualquer mapa compatível com a API
          // do mapbox-gl — incluindo MapLibre, que é fork API-compatível.
          // O nome continua "Mapbox" por razões históricas do deck.gl.
          MapboxOverlay: new (props: { layers: unknown[] }) => unknown
        }
        const { ArcLayer, ScatterplotLayer } = layersModule as unknown as {
          ArcLayer: new (props: Record<string, unknown>) => unknown
          ScatterplotLayer: new (props: Record<string, unknown>) => unknown
        }

        // Centro: prefere a origem (autor do post). Se não há origem mas
        // há destinos, usa o primeiro destino. Fallback é centro do globo.
        const centerPoint =
          data.origin ?? data.destinations[0]?.point ?? null
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

        // Pontos da origem e dos destinos. Origem é amber + raio maior
        // (manifesto §28 — "ground zero" do post merece destaque visual).
        const originPoints: PointLayerProps[] = data.origin
          ? [{ position: [data.origin.lng, data.origin.lat] }]
          : []
        const destPoints: PointLayerProps[] = data.destinations.map((d) => ({
          position: [d.point.lng, d.point.lat],
        }))

        const overlay = new MapboxOverlay({
          layers: [
            // Ponto da origem (autor do post). Amber, raio grande.
            new ScatterplotLayer({
              id: 'spread-origin',
              data: originPoints,
              getPosition: (p: PointLayerProps) => p.position,
              getFillColor: [251, 191, 36, 230], // drift amber
              getRadius: 8,
              radiusUnits: 'pixels',
              stroked: true,
              getLineColor: [251, 191, 36, 255],
              lineWidthUnits: 'pixels',
              getLineWidth: 1.5,
            }),
            // Pontos dos destinos (espalhadores). Verde drift-spread, menor.
            new ScatterplotLayer({
              id: 'spread-destinations',
              data: destPoints,
              getPosition: (p: PointLayerProps) => p.position,
              getFillColor: [52, 211, 153, 200], // drift-spread
              getRadius: 5,
              radiusUnits: 'pixels',
            }),
            // Arcos origem → destinos. Pode estar vazio (origem sem destino,
            // ou caso degenerado sem origem nem destinos suficientes).
            new ArcLayer({
              id: 'spread-arcs',
              data: data.arcs,
              getSourcePosition: (a: ArcLayerProps) => a.origin,
              getTargetPosition: (a: ArcLayerProps) => a.destination,
              getSourceColor: [251, 191, 36, 220], // amber (origem)
              getTargetColor: [52, 211, 153, 200], // verde (destino)
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
  }, [data, hasGeometry])

  // ─── Estados de fallback (renderizam sem importar MapLibre) ────────

  if (loading) {
    return (
      <Placeholder className={className} title="carregando mapa…" body="" />
    )
  }

  if (error) {
    return <Placeholder className={className} title="erro no mapa" body={error} />
  }

  if (!hasGeometry) {
    // Duas razões possíveis pro mapa estar vazio:
    //   1. User desligou GPS (granularity === 'off') — pode acionar CTA
    //      pra abrir Settings na seção location.
    //   2. User está com GPS ligado mas nenhum spread deste post tem
    //      location ainda — só esperar; CTA seria ruído.
    if (granularity === 'off') {
      return (
        <Placeholder
          className={className}
          title="GPS desativado nas suas configurações"
          body={
            <>
              Mapa de spreads precisa de location opt-in (manifesto §28 —
              default off por privacidade). Ative se quiser que seus spreads
              apareçam no mapa de outros posts.
            </>
          }
          {...(onOpenLocationSettings
            ? {
                action: {
                  label: 'ativar GPS',
                  onClick: onOpenLocationSettings,
                },
              }
            : {})}
        />
      )
    }
    return (
      <Placeholder
        className={className}
        title="sem dados de localização"
        body={
          <>
            Spreads deste post ainda não têm tag <code>location</code>.
            Quando alguém com GPS ativo espalhar, os arcos aparecem aqui.
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
  action,
}: {
  className: string
  title: string
  body: React.ReactNode
  /**
   * CTA opcional. Quando presente, renderiza um botão abaixo do body —
   * usado no estado "GPS off" pra dar caminho direto pras settings em vez
   * de só mandar o user procurar.
   */
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded border border-dashed border-drift-border bg-drift-surface/40 p-6 text-center text-[11px] text-slate-500 ${className}`}
    >
      <span className="text-base">🗺️</span>
      <strong className="text-slate-400">{title}</strong>
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
