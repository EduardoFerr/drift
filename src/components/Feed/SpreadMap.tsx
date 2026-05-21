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

import { useEffect, useRef, useState } from 'react'
import { useSpreadMap, isUserSoloSpreader, type SpreadMapMode } from '../../hooks/useSpreadMap'
import { useBootStore } from '../../lib/bootstrap'
import { useFollowsStore } from '../../lib/follows'
import { loadMapDeps } from './useMapDeps'
import { usePrefsStore } from '../../lib/prefs'
import type { PropagationArc, SpreadMapData } from '../../types/drift'

export interface SpreadMapProps {
  postId: string | null
  className?: string
  mode?: SpreadMapMode
  onModeChange?: (mode: SpreadMapMode) => void
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

const CARTO_TILE_URLS_DEFAULT = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
]

/**
 * Constrói style spec a partir de URL template (XYZ format).
 *
 * Sovereignty (Marshall NEEDS-FIX B 2026-05-17): aceita override via
 * `UserPrefs.map_tile_url_template`. Default = CARTO Voyager dark
 * (4 mirrors a/b/c/d). Override = 1 URL única (user usa seu próprio
 * tile server / OSM / mirror anônimo pra evitar CARTO logar IP).
 *
 * Manifesto §28 — CARTO loga IP do user a cada tile fetch. Pref custom
 * = user controla quem vê esse tráfego.
 */
function buildMapStyle(customTemplate?: string): maplibregl.StyleSpecification {
  const tiles =
    customTemplate &&
    customTemplate.startsWith('https://') &&
    customTemplate.includes('{x}') &&
    customTemplate.includes('{y}') &&
    customTemplate.includes('{z}')
      ? [customTemplate]
      : CARTO_TILE_URLS_DEFAULT
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  }
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

// MaplibreStatic + MaplibreMap removidos (DRY refactor B 2026-05-21) —
// loadMapDeps centraliza esses tipos. Tipos restantes (LayerCtor,
// OverlayInstance) ainda usados localmente pra cache de constructors.

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
  const activeNpub = useBootStore((s) => s.identity?.npub ?? null)
  const followsCount = useFollowsStore((s) => s.following.size)

  const hasGeometry = !!data && (!!data.origin || data.destinations.length > 0)

  if (loading) {
    return <Placeholder className={className} title="carregando mapa…" body="" />
  }
  if (error) {
    return <Placeholder className={className} title="erro no mapa" body={error} />
  }
  // Network mode empty states (Satoshi+Ted 2026-05-21)
  if (mode === 'network') {
    if (!activeNpub) {
      return (
        <Placeholder
          className={className}
          title="modo rede desativado"
          body="Você precisa estar identificado pra ver sua rede no mapa. Sua identidade é local e privada (manifesto §3)."
        />
      )
    }
    if (followsCount === 0) {
      return (
        <Placeholder
          className={className}
          title="sua rede está vazia"
          body="Você ainda não segue ninguém. Explore o feed global, abra posts que te interessam e siga autores — depois eles aparecem aqui."
        />
      )
    }
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
    const title =
      mode === 'global'
        ? 'sem dados de localização globais'
        : mode === 'network'
        ? 'sua rede sem GPS por enquanto'
        : 'sem dados de localização'
    const body =
      mode === 'global'
        ? 'Nenhum spread com tag location ainda. Quando alguém com GPS ativo driftar, a rede aparece aqui.'
        : mode === 'network'
        ? 'Ninguém que você segue driftou com GPS ativo ainda. Quando isso acontecer, aparece aqui.'
        : 'Drifts deste post ainda não têm tag location. Quando alguém com GPS ativo driftar, aparece aqui.'
    return <Placeholder className={className} title={title} body={body} />
  }

  if (mode === 'global' || mode === 'network') {
    // Network mode reusa GlobalModeMap (mesma estrutura de arcos/dots
    // animados — só a query upstream difere). Toggle no MapShell mostra
    // qual mode tá ativo.
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
  mode: SpreadMapMode
  onModeChange?: (m: SpreadMapMode) => void
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
  // Sovereignty: tile template override pra usar self-hosted/OSM/mirror
  // anônimo em vez do default CARTO (que loga IP). Marshall NEEDS-FIX B.
  const tileTemplate = usePrefsStore((s) => s.map_tile_url_template)
  const containerRef = useRef<HTMLDivElement>(null)
  // Satoshi devsec C 2026-05-21: K=1 doxx warning. Quando user é o
  // ÚNICO com GPS no mapa deste post, location é identificável via
  // community knowledge. Dismissal session-only (per-mapa-instance).
  const activeNpub = useBootStore((s) => s.identity?.npub ?? null)
  const [k1WarningDismissed, setK1WarningDismissed] = useState(false)
  const showK1Warning = isUserSoloSpreader(data, activeNpub) && !k1WarningDismissed

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      try {
        // DRY 2026-05-21 (Satoshi tech lead B): imports shared via
        // loadMapDeps. Ted bundle audit §1.8 preserve (tree-shake estático).
        const { maplibregl, MapboxOverlay, layers } = await loadMapDeps()
        if (cancelled) return

        const { ScatterplotLayer, HeatmapLayer } = layers

        const centerPoint = data.origin ?? data.destinations[0]?.point ?? null
        const center: [number, number] = centerPoint
          ? [centerPoint.lng, centerPoint.lat]
          : [0, 20]

        const map = new maplibregl.Map({
          container: containerRef.current!,
          style: buildMapStyle(tileTemplate),
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
    <div className="relative h-full w-full">
      <MapShell
        containerRef={containerRef}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
        stats={`${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'}`}
      />
      {showK1Warning && (
        <SoloSpreaderWarning onDismiss={() => setK1WarningDismissed(true)} />
      )}
    </div>
  )
}

/**
 * SoloSpreaderWarning — overlay warning quando user é o único spreader
 * com GPS visível no mapa (K=1 doxx risk).
 *
 * Satoshi devsec C 2026-05-21. Documentado em
 * `Docs/threat-model-maps.md` §K=1-DOXX.
 *
 * Posicionamento: top-3 right-3 (ModeToggle ocupa top-3 left-3, sem
 * overlap). Dismissable via × button. Session-only (rebornece em outro
 * post K=1; pattern educa naturalmente).
 *
 * Manifesto §28: warning não vaza dado novo (mapa já é observável);
 * apenas informa o user sobre o que JÁ está exposto.
 */
function SoloSpreaderWarning({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="pointer-events-auto absolute right-3 top-3 z-20 flex max-w-xs items-start gap-2 rounded-xl border border-drift-warning/40 bg-drift-bg/95 p-3 backdrop-blur-sm"
    >
      <span aria-hidden="true" className="text-sm leading-none">📍</span>
      <div className="flex-1 font-mono text-[11px] leading-relaxed text-drift-text">
        <p className="font-semibold text-drift-warning">
          você é o único com GPS aqui
        </p>
        <p className="mt-1 text-drift-muted">
          sua localização é identificável neste mapa. considere desligar
          GPS pra próximos drifts em <em>ajustes → localização</em>.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="fechar aviso de K=1"
        className="shrink-0 px-1 font-mono text-[12px] text-drift-muted hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
      >
        ×
      </button>
    </div>
  )
}

// ─── GlobalModeMap — linhas animadas de propagação ────────────────────

function GlobalModeMap({ data, className, mode, onModeChange }: ModeMapProps) {
  const mapView = usePrefsStore((s) => s.map_view)
  const tileTemplate = usePrefsStore((s) => s.map_tile_url_template)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let rafId = 0
    let pauseTimer: ReturnType<typeof setTimeout>
    let mapCleanup: (() => void) | null = null
    let overlay: OverlayInstance | null = null

    // Layer constructors — cached after async import (DRY via loadMapDeps)
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
        // DRY 2026-05-21 (Satoshi tech lead B): imports shared via loadMapDeps.
        const { maplibregl, MapboxOverlay, layers } = await loadMapDeps()
        if (cancelled) return

        LineLayer = layers.LineLayer
        ScatterplotLayer = layers.ScatterplotLayer

        const centerPt = data.destinations[0]?.point ?? null
        const center: [number, number] = centerPt ? [centerPt.lng, centerPt.lat] : [0, 20]

        const map = new maplibregl.Map({
          container: el,
          style: buildMapStyle(tileTemplate),
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
  mode: SpreadMapMode
  onModeChange?: (m: SpreadMapMode) => void
  stats: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-drift-border/40 ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {onModeChange && <ModeToggle mode={mode} onModeChange={onModeChange} />}

      {/* WCAG: bg sobre tile dinâmico (mapa). Marshall regra de 2 camadas
          — alpha mínimo /95 + text sem alpha. Tile pode ser claro ou
          escuro; com /95 + text-muted sólido garantimos ≥ 4.5:1 nos 3 temas. */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-drift-bg/95 px-2.5 py-1 font-mono text-[11px] text-drift-muted backdrop-blur-sm">
        {stats}
      </div>
      <div
        className="pointer-events-auto absolute bottom-3 right-3 rounded-lg bg-drift-bg/95 px-2.5 py-1 text-[10px] text-drift-muted backdrop-blur-sm [&_a]:underline [&_a]:hover:text-drift-text"
        dangerouslySetInnerHTML={{ __html: MAP_ATTRIBUTION }}
      />
    </div>
  )
}

// ─── ModeToggle (Satoshi+Ted 2026-05-21) ──────────────────────────────
//
// 3 botões: [post | global | network]. Network requer identidade ativa
// + follows (UI inicialmente o renderiza; clicar e cair em empty state
// é UX intencional — user descobre por que está disabled, não por
// botão sumindo).
//
// A11y: role=tablist implícito via flex row; cada botão tem aria-pressed
// (já no ModeBtn).
function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: SpreadMapMode
  onModeChange: (m: SpreadMapMode) => void
}) {
  const activeNpub = useBootStore((s) => s.identity?.npub ?? null)
  const networkDisabled = !activeNpub
  return (
    <div
      role="tablist"
      aria-label="modo do mapa"
      className="pointer-events-auto absolute left-3 top-3 flex overflow-hidden rounded-xl border border-drift-border/40 bg-drift-bg/90 backdrop-blur-sm"
    >
      <ModeBtn active={mode === 'post'} onClick={() => onModeChange('post')}>
        post
      </ModeBtn>
      <ModeBtn active={mode === 'global'} onClick={() => onModeChange('global')}>
        global
      </ModeBtn>
      <ModeBtn
        active={mode === 'network'}
        onClick={() => onModeChange('network')}
        disabled={networkDisabled}
        title={networkDisabled ? 'identifique-se pra ver sua rede' : 'spreads de quem você segue'}
      >
        network
      </ModeBtn>
    </div>
  )
}

// ─── ModeBtn ──────────────────────────────────────────────────────────

function ModeBtn({
  active,
  onClick,
  children,
  disabled = false,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      role="tab"
      className={`px-3.5 py-2 font-mono text-[11px] uppercase tracking-meta transition-colors ${
        disabled
          ? 'cursor-not-allowed text-drift-muted/30'
          : active
          ? 'bg-drift-accent2 text-drift-bg'
          : 'text-drift-muted/70 hover:text-drift-text'
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
    <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-drift-border/40 bg-drift-surface/40 p-8 text-center ${className}`}>
      <span aria-hidden="true" className="font-display text-[28px] text-drift-accent/70">◎</span>
      <strong className="font-display text-[15px] font-extrabold uppercase tracking-tag text-drift-accent">
        {title}
      </strong>
      <p className="max-w-xs font-mono text-[11px] leading-relaxed text-drift-muted/60">
        {body}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 rounded-xl bg-drift-accent2 px-5 py-2.5 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
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
