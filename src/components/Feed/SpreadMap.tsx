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
import { useLongPress, LONG_PRESS_MS } from '../../hooks/useLongPress'
import { MapExplainerCard } from './MapExplainerCard'
import { TimelineScrubber } from './TimelineScrubber'
import { AnimatePresence, m } from 'framer-motion'
import { useBootStore } from '../../lib/bootstrap'
import { useFollowsStore } from '../../lib/follows'
import { useLensStore } from '../../lib/trust-lens'
import { pinColor, PIN_COLOR_DEFAULT } from '../../lib/trust/map-color'
import { loadMapDeps } from './useMapDeps'
import { useMapInstance } from './useMapInstance'
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

/**
 * Satoshi A4 2026-05-22 (audit Gap CARTO sovereignty): tiles default
 * vêm de carto.com (CDN externo que loga IP). Disclaimer discreto no
 * footer permite override em Settings (`map_tile_url_template`).
 * Quando user tem template custom, omitimos o nudge (já fez a escolha
 * de sovereignty). Manifesto §17 awareness.
 */
const CARTO_SOVEREIGNTY_NUDGE =
  ' · <span title="tiles cortesia carto.com — substitua em Configurações ▸ Mapa pra usar seu próprio servidor">tiles externos</span>'

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

  // Satoshi A2 mode badge — toast 2s ao alternar modo. Bug fix 2026-05-26:
  // estado vivia em ModeToggle (linha 746-816 pré-fix), mas ModeToggle é
  // remountado quando o SpreadMap passa de empty state → mapa (ou vice).
  // Ex.: global (mapa) → network (empty "sua rede está vazia") desmonta
  // ModeToggle dentro do MapShell e monta NOVO dentro de renderEmpty;
  // novo componente inicia com ref de mode = 'network', badge nunca
  // dispara. Hoist pro top-level resolve ambas causas:
  //   (a) prevModeRef rastreia mode anterior (não apenas inicial), então
  //       voltar pro mode inicial (global → network → global) também
  //       dispara badge na 2ª transição;
  //   (b) badge renderiza como sibling estável do conteúdo, indep de
  //       empty state vs MapShell.
  const [badgeMode, setBadgeMode] = useState<SpreadMapMode | null>(null)
  const prevModeRef = useRef<SpreadMapMode | null>(null)
  useEffect(() => {
    if (prevModeRef.current === null) {
      // Primeira render — registra mode atual sem disparar badge.
      prevModeRef.current = mode
      return
    }
    if (mode === prevModeRef.current) return
    prevModeRef.current = mode
    setBadgeMode(mode)
    const t = setTimeout(() => setBadgeMode(null), 2000)
    return () => clearTimeout(t)
  }, [mode])

  // User feedback 2026-05-26: empty states escondiam o ModeToggle —
  // user clicava em network/global e ficava preso (única saída era
  // FECHAR no header do overlay). Agora cada Placeholder coexiste com
  // o toggle quando o caller passa onModeChange (MapOverlay sim,
  // mini-map embedded no PostViewer não). Approach: wrapper renderiza
  // Placeholder ocupando o container + ModeToggle absolute por cima
  // (mesma posição que o ModeToggle dentro de MapShell, mantém parity
  // visual entre estado vazio e estado com mapa).
  const renderEmpty = (
    placeholder: React.ReactNode,
  ): React.ReactElement => (
    <div className={`relative ${className}`}>
      {placeholder}
      {onModeChange && (
        <ModeToggle mode={mode} onModeChange={onModeChange} />
      )}
    </div>
  )

  let content: React.ReactElement
  if (loading) {
    content = renderEmpty(
      <Placeholder className="h-full w-full" title="carregando mapa…" body="" />,
    )
  } else if (error) {
    content = renderEmpty(
      <Placeholder className="h-full w-full" title="erro no mapa" body={error} />,
    )
  } else if (mode === 'network' && !activeNpub) {
    // Network mode empty states (Satoshi+Ted 2026-05-21)
    content = renderEmpty(
      <Placeholder
        className="h-full w-full"
        title="modo rede desativado"
        body="Você precisa estar identificado pra ver sua rede no mapa. Sua identidade é local e privada (manifesto §3)."
      />,
    )
  } else if (mode === 'network' && followsCount === 0) {
    content = renderEmpty(
      <Placeholder
        className="h-full w-full"
        title="sua rede está vazia"
        body="Você ainda não segue ninguém. Explore o feed global, abra posts que te interessam e siga autores — depois eles aparecem aqui."
      />,
    )
  } else if (!hasGeometry && granularity === 'off' && mode === 'post') {
    content = renderEmpty(
      <Placeholder
        className="h-full w-full"
        title="GPS desativado nas suas configurações"
        body="Mapa de spreads precisa de location opt-in (manifesto §28 — default off por privacidade). Ative se quiser que seus spreads apareçam no mapa de outros posts."
        // B3 fix 2026-05-22 (Robin): label antes era 'ativar GPS' — soava
        // como toggle one-click. Botão na verdade só ABRE a tela de
        // settings de location (user escolhe granularidade lá). User
        // reportou: 'sem ativar GPS, só visualizou empty state, ícone
        // passa a colorido' — provável misclick num radio dentro do
        // LocationCard. Label novo explicita o destino → user vê tela
        // e fecha sem mudar nada se quiser.
        {...(onOpenLocationSettings ? { action: { label: 'abrir Configurações de GPS', onClick: onOpenLocationSettings } } : {})}
      />,
    )
  } else if (!hasGeometry) {
    const title =
      mode === 'global'
        ? 'sem dados de localização globais'
        : mode === 'network'
        ? 'sua rede sem GPS por enquanto'
        : 'sem dados de localização'
    const body =
      mode === 'global'
        ? 'Nenhum DRIFT com tag location ainda. Quando alguém com GPS ativo driftar, a rede aparece aqui.'
        : mode === 'network'
        ? 'Ninguém que você segue driftou com GPS ativo ainda. Quando isso acontecer, aparece aqui.'
        : 'DRIFTs deste post ainda não têm tag location. Quando alguém com GPS ativo driftar, aparece aqui.'
    content = renderEmpty(
      <Placeholder className="h-full w-full" title={title} body={body} />,
    )
  } else if (mode === 'global' || mode === 'network') {
    // Network mode reusa GlobalModeMap (mesma estrutura de arcos/dots
    // animados — só a query upstream difere). Toggle no MapShell mostra
    // qual mode tá ativo.
    content = (
      <GlobalModeMap
        data={data}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
      />
    )
  } else {
    content = (
      <PostModeMap
        data={data}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
      />
    )
  }

  // Satoshi A2 mode badge — toast 2s ao alternar modo. Renderizado como
  // sibling do conteúdo (não dentro do ModeToggle nem do MapShell) pra
  // sobreviver à transição empty state ↔ mapa. Posicionamento absolute
  // top-3 centrado precisa do wrapper relative — a div .relative dentro
  // de PostModeMap/GlobalModeMap/renderEmpty serve como ancestor. Aqui,
  // como o badge vive fora do content, usamos um wrapper <div.relative>
  // que envelopa ambos.
  return (
    <div className="relative h-full w-full">
      {content}
      <AnimatePresence>
        {badgeMode && (
          <m.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-drift-border/40 bg-drift-bg/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted backdrop-blur-sm"
          >
            modo:{' '}
            <span className="text-drift-text">
              {badgeMode === 'post' && 'este post'}
              {badgeMode === 'global' && 'rede inteira'}
              {badgeMode === 'network' && 'sua rede (lente local §24)'}
            </span>
          </m.div>
        )}
      </AnimatePresence>
    </div>
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

  // Ted refactor B 2026-05-22: useMapInstance encapsula loadMapDeps +
  // new Map + addControl + cleanup. Mantém comportamento bit-equivalente
  // ao pré-refactor — layers + fitBounds aplicados via onReady.
  const centerPoint = data.origin ?? data.destinations[0]?.point ?? null
  const center: [number, number] = centerPoint
    ? [centerPoint.lng, centerPoint.lat]
    : [0, 20]

  useMapInstance({
    containerRef,
    style: buildMapStyle(tileTemplate),
    center,
    zoom: 1.5,
    deps: [data, mapView, tileTemplate],
    onReady: ({ map, overlay, deps: mapDeps }) => {
      const { ScatterplotLayer, HeatmapLayer } = mapDeps.layers

      if (mapView === 'fit-bounds') {
        const bounds = computeBounds([
          ...(data.origin ? [[data.origin.lng, data.origin.lat] as [number, number]] : []),
          ...data.destinations.map((d): [number, number] => [d.point.lng, d.point.lat]),
        ])
        if (bounds) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map as any).once('load', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(map as any).fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 })
          })
        }
      }

      const originPoints: PointLayerProps[] = data.origin
        ? [{ position: [data.origin.lng, data.origin.lat] }]
        : []
      const destPoints: PointLayerProps[] = data.destinations.map((d) => ({
        position: [d.point.lng, d.point.lat],
      }))

      overlay.setProps({
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
    },
  })

  return (
    <div className="relative h-full w-full">
      <MapShell
        containerRef={containerRef}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
        stats={`${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'}`}
        timelineEvents={data.destinations.map((d) => ({ created_at: d.createdAt }))}
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
  // Trust Lens D 2026-05-21 — opt-in WoT colors. Default OFF (Satoshi
  // audit). Quando ON, social-nodes layer usa pinColor(pprScore) em
  // vez de cor uniforme. pprScores vem do useLensStore (já em memória
  // pós-recomputeLens; zero query extra).
  const lensShowInMap = usePrefsStore((s) => s.lens_show_in_map)
  const pprScores = useLensStore((s) => s.pprScores)
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

    // Satoshi+Ted plan E 2026-05-21 — Opção δ híbrido. Nós dedupados
    // por npub viram "rede social geográfica": tamanho ∝ √spreadCount.
    // Renderizados como camada FIXA (não animada) abaixo dos arcos.
    // Vazio em mode='post' (data.nodes = []).
    //
    // npub preservado pra item D (WoT colors opt-in): quando
    // lens_show_in_map=true, pinColor lê pprScores[npub] e devolve
    // RGBA por tier discreto.
    const socialNodes = data.nodes.map((n) => ({
      pos: [n.point.lng, n.point.lat] as [number, number],
      count: n.spreadCount,
      npub: n.npub,
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
              // Rede social geográfica — nós dedupados por npub.
              // Render antes dos arcos pra arcos passarem por cima.
              // Fixed layer (não animada); pickable pra futuro tooltip.
              //
              // D 2026-05-21: quando lens_show_in_map=ON, getFillColor
              // chama pinColor(pprScore) — RGBA por tier discreto.
              // OFF (default): cor uniforme, bit-exact pré-D.
              ...(socialNodes.length > 0
                ? [
                    new ScatterplotLayer({
                      id: 'social-nodes',
                      data: socialNodes,
                      getPosition: (d: { pos: [number, number] }) => d.pos,
                      getRadius: (d: { count: number }) =>
                        Math.max(4, Math.sqrt(d.count) * 4),
                      getFillColor: lensShowInMap
                        ? (d: { npub: string }) => pinColor(pprScores.get(d.npub))
                        : (PIN_COLOR_DEFAULT as [number, number, number, number]),
                      radiusUnits: 'pixels',
                      stroked: true,
                      getLineColor: [232, 255, 90, 180] as [number, number, number, number],
                      getLineWidth: 1,
                      lineWidthUnits: 'pixels',
                      pickable: true,
                      updateTriggers: { getFillColor: lensShowInMap },
                    }),
                  ]
                : []),
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

  // Ted polish #9 2026-05-22: hint discreto quando user habilitou WoT
  // colors mas cache PPR ainda vazio (primeira vez vendo lente). Evita
  // sensação de "toggle ON mas mapa sem mudar — quebrado?".
  const showLensComputingHint = lensShowInMap && pprScores.size === 0
  const [lensHintVisible, setLensHintVisible] = useState(false)
  useEffect(() => {
    if (!showLensComputingHint) {
      setLensHintVisible(false)
      return
    }
    setLensHintVisible(true)
    const t = setTimeout(() => setLensHintVisible(false), 3000)
    return () => clearTimeout(t)
  }, [showLensComputingHint])

  return (
    <div className="relative h-full w-full">
      <MapShell
        containerRef={containerRef}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
        stats={
          // Satoshi+Ted plan E 2026-05-21 — stats refletem "rede social
          // geográfica": pessoas (npubs dedupados) + drifts + países.
          data.nodes.length > 0
            ? `${data.nodes.length} ${data.nodes.length === 1 ? 'pessoa' : 'pessoas'} · ${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'}`
            : `${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'} · todos os posts`
        }
        timelineEvents={data.destinations.map((d) => ({ created_at: d.createdAt }))}
      />
      {lensHintVisible && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-3 top-14 z-30 rounded-lg border border-drift-border/40 bg-drift-bg/95 px-2.5 py-1 font-mono text-[10px] text-drift-muted backdrop-blur-sm"
        >
          calculando lente social…
        </div>
      )}
    </div>
  )
}

// ─── MapShell — wrapper comum (toggle + stats + attribution) ──────────

function MapShell({
  containerRef,
  className,
  mode,
  onModeChange,
  stats,
  timelineEvents,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  className: string
  mode: SpreadMapMode
  onModeChange?: (m: SpreadMapMode) => void
  stats: string
  /**
   * V_2026-05-22 (user pedido): mapas animados ganham TimelineScrubber
   * mostrando lapso temporal dos eventos. Array de eventos com
   * created_at (segundos unix). Quando ausente ou vazio, scrubber não
   * renderiza (zero footprint).
   */
  timelineEvents?: Array<{ created_at: number }>
}) {
  // Satoshi A4: omite o nudge "tiles externos" quando user já configurou
  // template custom (sovereignty pref) — sinaliza que respeitamos a
  // escolha consciente. Read direto da store; impacto perf nulo.
  const tileTemplate = usePrefsStore((s) => s.map_tile_url_template)
  const usingCustomTiles = !!tileTemplate
  const attributionHTML = usingCustomTiles
    ? MAP_ATTRIBUTION
    : MAP_ATTRIBUTION + CARTO_SOVEREIGNTY_NUDGE

  // Removido 2026-05-28 (bug #2 excesso de hints no boot): o HintChip
  // CARTO sovereignty era ruído redundante. O footer attribution já
  // discloseva "tiles externos" com tooltip apontando Configurações ▸
  // Mapa (CARTO_SOVEREIGNTY_NUDGE), cumprindo a obrigação legal +
  // awareness §17/§28 sem chip ambient extra ocupando o topo do mapa.
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-drift-border/40 ${className}`}>
      <div ref={containerRef} className="h-full w-full" />

      {onModeChange && <ModeToggle mode={mode} onModeChange={onModeChange} />}

      {/* V_2026-05-22 TimelineScrubber — barra acima de stats/attribution.
          Full-width (inset 3) pra noção do tempo decorrido entre os
          eventos animados. Pointer-events-none = não bloqueia gesto no
          mapa (pan/zoom). */}
      {timelineEvents && timelineEvents.length > 0 && (
        <div className="pointer-events-none absolute bottom-[44px] left-3 right-3 z-10">
          <TimelineScrubber events={timelineEvents} mode={mode} />
        </div>
      )}

      {/* Satoshi A3 deemphasis (audit 2026-05-22 Gap #1 "termômetro
          social"): stats com font-size text-[10px] (era [11px]) + alpha
          /60 no text-muted pra reduzir visual primacy. Número agregado
          continua presente (informação útil), mas perde proeminência
          de "métrica de validação social". Manifesto §22 alignment. */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-drift-bg/95 px-2.5 py-1 font-mono text-[10px] text-drift-muted/60 backdrop-blur-sm">
        {stats}
      </div>
      <div
        className="pointer-events-auto absolute bottom-3 right-3 rounded-lg bg-drift-bg/95 px-2.5 py-1 text-[10px] text-drift-muted backdrop-blur-sm [&_a]:underline [&_a]:hover:text-drift-text"
        dangerouslySetInnerHTML={{ __html: attributionHTML }}
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
  // V_2026-05-22 (user pedido): long-press 3s em cada modo abre
  // MapExplainerCard com copy do modo. Tap continua trocando o modo.
  const [explainer, setExplainer] = useState<SpreadMapMode | null>(null)

  // Nota 2026-05-26: badge "modo: …" foi hoisted pro SpreadMap top-level
  // (estado vivia aqui mas componente é remountado entre empty state ↔
  // mapa, perdendo state). Ver comentário em SpreadMap acima.

  return (
    <>
      <div
        role="tablist"
        aria-label="modo do mapa"
        className="pointer-events-auto absolute left-3 top-3 flex overflow-hidden rounded-xl border border-drift-border/40 bg-drift-bg/90 backdrop-blur-sm"
      >
        <ModeBtn
          active={mode === 'post'}
          onClick={() => onModeChange('post')}
          onLongPress={() => setExplainer('post')}
        >
          post
        </ModeBtn>
        <ModeBtn
          active={mode === 'global'}
          onClick={() => onModeChange('global')}
          onLongPress={() => setExplainer('global')}
        >
          global
        </ModeBtn>
        <ModeBtn
          active={mode === 'network'}
          onClick={() => onModeChange('network')}
          onLongPress={() => setExplainer('network')}
          disabled={networkDisabled}
          title={networkDisabled ? 'identifique-se pra ver sua rede' : 'spreads de quem você segue · segure 3s pra explicação'}
        >
          network
        </ModeBtn>
      </div>
      <AnimatePresence>
        {explainer && (
          <MapExplainerCard
            context={explainer}
            onClose={() => setExplainer(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── ModeBtn ──────────────────────────────────────────────────────────

function ModeBtn({
  active,
  onClick,
  onLongPress,
  children,
  disabled = false,
  title,
}: {
  active: boolean
  onClick: () => void
  onLongPress?: () => void
  children: React.ReactNode
  disabled?: boolean
  title?: string
}) {
  const lp = useLongPress({
    onLongPress: onLongPress ?? (() => undefined),
    disabled: disabled || !onLongPress,
  })
  return (
    <button
      onClick={onClick}
      {...lp.handlers}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      role="tab"
      className={`relative overflow-hidden px-3.5 py-2 font-mono text-[11px] uppercase tracking-meta transition-colors ${
        disabled
          ? 'cursor-not-allowed text-drift-muted/30'
          : active
          ? 'bg-drift-accent2 text-drift-bg'
          : 'text-drift-muted/70 hover:text-drift-text'
      }`}
    >
      {children}
      {lp.pressing && lp.pressOrigin && (
        <span
          className="ripple-wave"
          aria-hidden="true"
          style={{
            left: lp.pressOrigin.x,
            top: lp.pressOrigin.y,
            animationDuration: `${LONG_PRESS_MS}ms`,
          }}
        />
      )}
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
