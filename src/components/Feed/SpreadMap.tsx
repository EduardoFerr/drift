/**
 * SpreadMap — visualização geográfica do espalhamento.
 *
 * Três modos:
 *   post    — cascata viral HONESTA de UM post: arcos da árvore inferida
 *             (origin→spreader literal mint; spreader→spreader estimado
 *             slate, §28) + origem amber + dots. Gated pelo relógio único.
 *   global  — arcos curvos animados de propagação cross-post agregada.
 *             Usa ArcLayer (curva GPU + gradiente + taper + glow aditivo).
 *   network — global filtrado por follows (NIP-02) + lente PPR + pontes K=1.
 *
 * Arcos compartilham buildVisSegs/makeArcLayers (helpers module-level).
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
import { useTimelineClock, type TimelineClock } from '../../hooks/useTimelineClock'
import { MapExplainerCard } from './MapExplainerCard'
import { TimelineScrubber } from './TimelineScrubber'
import { AnimatePresence, useReducedMotion } from 'framer-motion'
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

// ─── Paleta dos arcos (pura, determinística — manifesto §7) ───────────
//
// Embelezamento 2026-05-29 (Ted+Lily). Cores RGBA literais (WebGL não lê
// CSS vars). Família mantida do design histórico: arco do post corrente =
// chartreuse [232,255,90]; demais = mint [52,211,153] (mesma do dot +
// PIN_COLOR_DEFAULT). O refino é em ALPHA/gradiente/recência, não em hue:
//   - drawing (draw<1): cabeça viva (alpha alto) → leitura de "frente".
//   - source mais opaco que target: gradiente direcional A→B.
//   - recency multiplica o alpha: arcos velhos recuam, recentes brilham.
type ArcShade = { isCurrent?: boolean; inferred?: boolean; draw: number; recency: number }
type RGBA = [number, number, number, number]

const ARC_HUE_CURRENT: [number, number, number] = [232, 255, 90] // chartreuse
const ARC_HUE_OTHER: [number, number, number] = [52, 211, 153] // mint
// Aresta ESTIMADA (spreader→spreader inferido, post mode). Cinza-azulado frio
// + alpha reduzido → lê como "incerto/tracejado" vs o mint sólido das arestas
// literais. Honestidade §28: o olho distingue rota registrada de rota estimada.
const ARC_HUE_INFERRED: [number, number, number] = [120, 150, 180] // slate frio
const INFERRED_ALPHA = 0.45 // estimado vive ~45% do alpha de uma literal

/** Cor do corpo do arco num endpoint ('source' = origem, 'target' = tip).
 *  Source mais opaco que target → gradiente direcional. */
function arcColor(d: ArcShade, end: 'source' | 'target'): RGBA {
  const [r, g, b] = d.inferred
    ? ARC_HUE_INFERRED
    : d.isCurrent
    ? ARC_HUE_CURRENT
    : ARC_HUE_OTHER
  const drawing = d.draw < 1
  // Alpha base por estado: corrente vive mais alto que os demais.
  const headBase = d.isCurrent ? 255 : 165
  const bodyBase = d.isCurrent ? 205 : 95
  const base = drawing ? headBase : bodyBase
  // Target levemente mais translúcido que source (sensação de fluxo).
  const endFactor = end === 'source' ? 1 : 0.62
  const inferFactor = d.inferred ? INFERRED_ALPHA : 1
  const a = Math.round(base * endFactor * d.recency * inferFactor)
  return [r, g, b, a]
}

/** Cor do glow underlay — mesma hue, alpha baixo modulado por recência.
 *  Aditivo: cruzamentos somam luz. Arestas estimadas quase não brilham. */
function glowColor(d: ArcShade): RGBA {
  const [r, g, b] = d.inferred
    ? ARC_HUE_INFERRED
    : d.isCurrent
    ? ARC_HUE_CURRENT
    : ARC_HUE_OTHER
  const drawing = d.draw < 1
  const base = d.isCurrent ? (drawing ? 90 : 60) : drawing ? 55 : 32
  const inferFactor = d.inferred ? INFERRED_ALPHA : 1
  return [r, g, b, Math.round(base * d.recency * inferFactor)]
}

// ─── Draw-on gating compartilhado (global + post mode) ────────────────
//
// Extraído ao módulo (2026-05-30) pra GlobalModeMap E PostModeMap usarem o
// MESMO contrato de gating clock-driven, sem duplicar a lógica de
// recency/lerp/draw. Antes só GlobalModeMap desenhava arcos; PostModeMap
// (cascata viral honesta §28) tinha `data.arcs` computado por
// inferCascadeTree mas NUNCA instanciava ArcLayer → P0 bug (mapa sem arcos).
//
// Contrato (idêntico ao histórico de GlobalModeMap, commit 879d868):
//   - DRAW_FRAC: fração do ciclo (0→1) pra um arco terminar de desenhar.
//   - draw = (currentTime - arc.t) / DRAW_FRAC, clamp (0,1]; reduced → 1.
//   - tip: endpoint interpolado from→to por `draw` (rastro cresce A→B).
//   - recency: arcos que já assentaram desbotam (não somem — §16).
const DRAW_FRAC = 0.14 // fração do ciclo pra desenhar 1 arco (~4.2s @30s)
const FADE_WINDOW = 0.5 // após terminar, leva ~50% do ciclo p/ assentar

// ─── Density taming do glow aditivo (2026-05-30, fix hairball global) ──
//
// PROBLEMA (evidência MCP `?dev-seed=1`, ~1178 arcos): o glow underlay usa
// blend ADITIVO (src-alpha × ONE) — bonito com poucos arcos (cruzamentos
// brilham), mas em escala FULL N arcos somam luz e ESTOURAM num blob
// verde-branco saturado sobre regiões densas (EU/US) → ilegível.
// FIX: atenuar a intensidade (alpha + largura) do GLOW conforme o número de
// segmentos visíveis cresce, mantendo a soma aditiva limitada. O CORPO
// (blend normal, é o sinal real do fluxo) NÃO é tocado.
//
// Pura/determinística (§7): mesma contagem → mesmo fator. Sem regressão em
// lite/post/network: contagem ≤ GLOW_DENSITY_FULL → fator 1.0 (idêntico ao
// histórico). Só global-em-escala atenua.
const GLOW_DENSITY_FULL = 200 // ≤ isto → glow cheio (lite ~148 / post / network)
const GLOW_DENSITY_MIN = 0.12 // piso do fator a densidade muito alta

/** Fator [GLOW_DENSITY_MIN, 1] que escala o glow aditivo pela contagem de
 *  arcos visíveis. count ≤ FULL → 1 (sem mudança). Acima, decai ~FULL/count
 *  com piso MIN. Pura. */
export function glowDensityFactor(visibleCount: number): number {
  if (!Number.isFinite(visibleCount) || visibleCount <= GLOW_DENSITY_FULL) return 1
  return Math.max(GLOW_DENSITY_MIN, GLOW_DENSITY_FULL / visibleCount)
}

/** Arco enriquecido com estado de desenho (draw/tip/recency) pro frame atual. */
type DrawArc = PropagationArc & {
  draw: number
  tip: [number, number]
  recency: number
}

/**
 * Interpolação linear de [lng,lat] com easeOutCubic (flat map → linear é
 * exato o suficiente; pura/determinística, manifesto §7). A curva visível
 * vem do getHeight da ArcLayer, não daqui — este tip é só o ENDPOINT até
 * onde o arco já desenhou.
 */
function lerpPos(
  from: [number, number],
  to: [number, number],
  k: number,
): [number, number] {
  const e = 1 - Math.pow(1 - k, 3) // easeOutCubic
  return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]
}

/**
 * Constrói os segmentos visíveis pro cursor `p` (currentTime 0→1). Pura
 * (determinística por (arcs, p, reducedMotion)). Arco ainda não disparado
 * (draw<=0) é omitido. reduced-motion → todos full (draw=1, recency=1).
 *
 * Reusado por GlobalModeMap e PostModeMap — gating clock-único idêntico.
 */
function buildVisSegs(
  arcs: readonly PropagationArc[],
  p: number,
  reducedMotion: boolean,
): DrawArc[] {
  const visSegs: DrawArc[] = []
  for (const s of arcs) {
    const draw = reducedMotion ? 1 : (p - s.t) / DRAW_FRAC
    if (draw <= 0) continue
    const clamped = Math.min(draw, 1)
    const age = p - s.t - DRAW_FRAC
    const recency = reducedMotion
      ? 1
      : age <= 0
      ? 1
      : Math.max(0.35, 1 - age / FADE_WINDOW)
    visSegs.push({
      ...s,
      draw: clamped,
      tip: clamped >= 1 ? s.to : lerpPos(s.from, s.to, clamped),
      recency,
    })
  }
  return visSegs
}

/**
 * Fabrica as duas ArcLayers (glow underlay aditivo + corpo gradiente/taper)
 * pros segmentos visíveis. `ArcLayer` é o ctor async-carregado via loadMapDeps.
 * `idPrefix` evita colisão de id entre modos (global usa 'prop-arcs',
 * post usa 'post-arcs'). `p` entra nos updateTriggers pra forçar re-eval
 * dos accessors a cada tick do relógio.
 *
 * Reusa arcColor/glowColor (módulo) → arestas inferred (spreader→spreader)
 * renderizam slate/weak; literais (origin→spreader) mint/sólido. §28.
 */
function makeArcLayers(
  ArcLayer: LayerCtor,
  visSegs: DrawArc[],
  p: number,
  idPrefix: string,
): unknown[] {
  // Density taming: quanto mais arcos visíveis, mais fraco/fino o glow
  // aditivo (evita blob saturado em escala full). 1.0 em lite/post/network.
  const glowF = glowDensityFactor(visSegs.length)
  const glowColorDimmed = (d: DrawArc): RGBA => {
    const c = glowColor(d)
    return [c[0], c[1], c[2], Math.round(c[3] * glowF)]
  }
  return [
    // GLOW UNDERLAY: arco largo, translúcido, blend ADITIVO — cruzamentos
    // somam luz em vez de empilhar opacidade suja. Alpha+largura atenuados
    // por densidade (glowF) pra não estourar em escala full.
    new ArcLayer({
      id: `${idPrefix}-glow`,
      data: visSegs,
      getSourcePosition: (d: DrawArc) => d.from,
      getTargetPosition: (d: DrawArc) => d.tip,
      getHeight: (d: DrawArc) => 0.35 * d.draw,
      greatCircle: false,
      // largura do halo encolhe com densidade (0.55..1× do base) → menos overlap.
      getWidth: (d: DrawArc) => (d.isCurrent ? 9 : 6) * (0.55 + 0.45 * glowF),
      widthUnits: 'pixels',
      getSourceColor: (d: DrawArc) => glowColorDimmed(d),
      getTargetColor: (d: DrawArc) => glowColorDimmed(d),
      parameters: {
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'src-alpha',
        blendAlphaDstFactor: 'one',
        depthTest: false,
      },
      updateTriggers: {
        getSourceColor: [p, glowF],
        getTargetColor: [p, glowF],
        getWidth: glowF,
        getHeight: p,
        getTargetPosition: p,
      },
    }),
    // CORPO: arco fino e nítido, gradiente source→target + taper.
    new ArcLayer({
      id: idPrefix,
      data: visSegs,
      getSourcePosition: (d: DrawArc) => d.from,
      getTargetPosition: (d: DrawArc) => d.tip,
      getHeight: (d: DrawArc) => 0.35 * d.draw,
      greatCircle: false,
      getWidth: (d: DrawArc) => (d.isCurrent ? 3 : 1.75),
      widthUnits: 'pixels',
      getSourceColor: (d: DrawArc) => arcColor(d, 'source'),
      getTargetColor: (d: DrawArc) => arcColor(d, 'target'),
      updateTriggers: {
        getSourceColor: p,
        getTargetColor: p,
        getWidth: 1,
        getHeight: p,
        getTargetPosition: p,
      },
    }),
  ]
}

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

  // Mode badge "modo: …" removido 2026-05-29 (user: toast ruído). A aba
  // POST/GLOBAL/NETWORK (ModeToggle) já mostra qual modo está ativo via
  // estado visual selecionado — o toast era redundante.
  return <div className="relative h-full w-full">{content}</div>
}

// ─── PostModeMap — heatmap estático (comportamento histórico) ─────────

interface ModeMapProps {
  data: SpreadMapData
  className: string
  mode: SpreadMapMode
  onModeChange?: (m: SpreadMapMode) => void
}

interface PointLayerProps { position: [number, number] }
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

  // ─── Relógio compartilhado único (cascata viral honesta, 2026-05-30) ──
  //
  // P0 fix: post mode = "cascata viral honesta" (§28). `data.arcs` (calculado
  // por inferCascadeTree) tinha as arestas origin→spreader (literais) e
  // spreader→spreader (inferidas) PRONTAS, mas PostModeMap nunca instanciava
  // ArcLayer → mapa sem propagação. Agora post mode usa o MESMO relógio único
  // (useTimelineClock, 30s) que global/network: os arcos desenham A→B gated
  // pelo `currentTime`; o scrubber lê o mesmo cursor. reduced-motion →
  // estático (arcos full). Idêntico ao GlobalModeMap (helpers compartilhados).
  const reducedMotion = useReducedMotion() ?? false
  const { currentTime, paused, togglePaused } = useTimelineClock({ reducedMotion })

  // renderFrame é construído no onReady (precisa do overlay + ArcLayer ctor
  // async). Guardamos num ref pra o effect do relógio chamá-lo sem reconstruir
  // o mapa. Não há RAF aqui — o cursor vem do relógio único.
  const renderFrameRef = useRef<((p: number) => void) | null>(null)
  const latestTimeRef = useRef(currentTime)

  const centerPoint = data.origin ?? data.destinations[0]?.point ?? null
  const center: [number, number] = centerPoint
    ? [centerPoint.lng, centerPoint.lat]
    : [0, 20]

  // Ted refactor B 2026-05-22: useMapInstance encapsula loadMapDeps +
  // new Map + addControl + cleanup.
  useMapInstance({
    containerRef,
    style: buildMapStyle(tileTemplate),
    center,
    zoom: 1.5,
    deps: [data, mapView, tileTemplate, reducedMotion],
    onReady: ({ map, overlay, deps: mapDeps }) => {
      const { ScatterplotLayer, ArcLayer } = mapDeps.layers

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
      // Destinos com `t` pra aparecerem só quando o arco correspondente
      // termina de desenhar (mesma semântica de GlobalModeMap).
      const destPoints = data.destinations.map((d) => ({
        position: [d.point.lng, d.point.lat] as [number, number],
        t: d.t,
      }))

      // Render gated por currentTime (relógio único). Arcos desenham A→B;
      // dots aparecem quando o rastro chega. Heatmap REMOVIDO (2026-05-30):
      // o blob do HeatmapLayer cobria os arcos finos (mesma área geográfica)
      // e empurrava a leitura pra "densidade", não "propagação". A cascata
      // honesta é sobre ROTAS (quem→quem), não calor — os dots já dão a
      // noção de concentração sem ofuscar as arestas.
      function renderFrame(p: number) {
        const visSegs = buildVisSegs(data.arcs, p, reducedMotion)
        const visPts = destPoints.filter(
          (d) => reducedMotion || p - d.t >= DRAW_FRAC,
        )

        overlay.setProps({
          layers: [
            // Arcos da cascata: literais (origin→spreader) mint/sólido,
            // inferidos (spreader→spreader) slate/weak — distinção §28 via
            // arcColor/glowColor (d.inferred). Helper compartilhado c/ global.
            ...makeArcLayers(ArcLayer, visSegs, p, 'post-arcs'),
            // Origem (amber) — pin do post original. Sempre visível.
            new ScatterplotLayer({
              id: 'spread-origin',
              data: originPoints,
              getPosition: (pt: PointLayerProps) => pt.position,
              getFillColor: [251, 191, 36, 230],
              getRadius: 8,
              radiusUnits: 'pixels',
              stroked: true,
              getLineColor: [251, 191, 36, 255],
              lineWidthUnits: 'pixels',
              getLineWidth: 1.5,
            }),
            // Destinos (mint) — aparecem quando o rastro chega.
            new ScatterplotLayer({
              id: 'spread-destinations',
              data: visPts,
              getPosition: (pt: { position: [number, number] }) => pt.position,
              getFillColor: [52, 211, 153, 140],
              getRadius: 3,
              radiusUnits: 'pixels',
              updateTriggers: { getPosition: 1 },
            }),
          ],
        })
      }

      renderFrameRef.current = renderFrame
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(map as any).once('load', () => {
        renderFrameRef.current?.(latestTimeRef.current)
      })

      return () => {
        renderFrameRef.current = null
      }
    },
  })

  // ─── Draw on clock tick ─────────────────────────────────────────────
  // Único ponto que dirige o desenho: cada avanço de `currentTime` (RAF do
  // relógio único) re-renderiza o frame gated. Sem RAF próprio aqui.
  useEffect(() => {
    latestTimeRef.current = currentTime
    renderFrameRef.current?.(currentTime)
  }, [currentTime])

  return (
    <div className="relative h-full w-full">
      <MapShell
        containerRef={containerRef}
        className={className}
        mode={mode}
        onModeChange={onModeChange}
        stats={`${data.totalSpreads} drifts · ${data.countries.length} ${data.countries.length === 1 ? 'país' : 'países'}`}
        timelineEvents={data.destinations.map((d) => ({ created_at: d.createdAt }))}
        clock={{ currentTime, paused, togglePaused }}
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
  const lensShowInMapPref = usePrefsStore((s) => s.lens_show_in_map)
  const pprScores = useLensStore((s) => s.pprScores)
  // Pontes K=1 (Fase 2b): nós que são única via até alguém na MINHA rede.
  // Ring mecânico só no network + lente ON (mesmo gate da cor PPR). Sinal
  // estrutural local, nunca moral (§22/§25).
  const bridges = useLensStore((s) => s.bridges)
  // §24 (deliberação 2026-05-30, ver [[reference_map_model]]): a LENTE só
  // pode tingir o modo NETWORK (minha WoT local). global/post são canônicos
  // e compartilhados — NUNCA personalizados pela minha lente. Antes
  // `lens_show_in_map` pintava os social-nodes em QUALQUER modo (inclusive
  // global) → furo §24. Gate por modo fecha isso.
  const lensShowInMap = lensShowInMapPref && mode === 'network'
  // WCAG 2.3.3 (user pedido 2026-05-28 "linha desenha de A→B"): com
  // reduced-motion, arcos aparecem full estáticos (sem draw-on que
  // cresce). Sem reduced, cada arco DESENHA progressivamente do ponto
  // de origem ao destino quando o cursor temporal cruza seu `t`.
  const reducedMotion = useReducedMotion() ?? false
  const containerRef = useRef<HTMLDivElement>(null)

  // ─── Relógio compartilhado único (Ted+Lily 2026-05-29) ──────────────
  //
  // Bug fix: antes este componente tinha um RAF próprio (ANIM_DURATION 8s)
  // e o TimelineScrubber tinha SUA própria animação CSS. Dois clocks
  // independentes → play/pause da barra não pausava arcos; arcos
  // desenhavam pelo tempo interno deles (não gated pela barra). Agora
  // `useTimelineClock` é a FONTE ÚNICA: 1 RAF avança `currentTime` (0→1)
  // sobre 30s. Os arcos LEEM currentTime (gating); o scrubber LÊ
  // currentTime (fill). pausar congela AMBOS. reduced-motion → estático.
  const { currentTime, paused, togglePaused } = useTimelineClock({ reducedMotion })

  // renderFrame é construído dentro do effect de init do mapa (precisa do
  // overlay deck.gl + layer ctors carregados async). Guardamos a função
  // num ref pra que o effect de "draw on currentTime change" possa
  // chamá-la sem reconstruir o mapa. NÃO há RAF aqui — o cursor vem do
  // relógio único acima.
  const renderFrameRef = useRef<((p: number) => void) | null>(null)
  // Último cursor conhecido — lido pelo `map.once('load')` (que dispara
  // async, depois do primeiro tick do relógio) sem precisar do currentTime
  // nas deps do effect pesado de init. Mantido em sync pelo draw effect.
  const latestTimeRef = useRef(currentTime)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let mapCleanup: (() => void) | null = null
    let overlay: OverlayInstance | null = null

    // Layer constructors — cached after async import (DRY via loadMapDeps)
    let ArcLayer: LayerCtor
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

    // Pontes K=1 (Fase 2b): subset dos socialNodes cujo npub é única via
    // até ≥1 pessoa na minha rede. Só no network + lente ON. Render como
    // ring (anel vazado) acima do nó — sinal mecânico, não juízo de valor.
    const bridgeNodes =
      lensShowInMap
        ? socialNodes
            .filter((n) => bridges.has(n.npub))
            .map((n) => ({ ...n, blast: bridges.get(n.npub) ?? 0 }))
        : []

    void (async () => {
      try {
        // DRY 2026-05-21 (Satoshi tech lead B): imports shared via loadMapDeps.
        const { maplibregl, MapboxOverlay, layers } = await loadMapDeps()
        if (cancelled) return

        ArcLayer = layers.ArcLayer
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

        // ─── Render gated por currentTime (relógio único) ──────────
        //
        // Draw-on A→B (user 2026-05-28): "se a linha representa ponto A
        // a ponto B, deveria ser desenhada de A até B". Cada arco DESENHA
        // progressivamente: o ponto de destino do segmento é interpolado
        // de `from`→`to` conforme `drawProgress`, então a linha cresce do
        // A até o B como um rastro.
        //
        // Sync com scrubber (Ted+Lily 2026-05-29): `renderFrame(p)` recebe
        // `p = currentTime` do relógio ÚNICO (`useTimelineClock`, 0→1 sobre
        // 30s) — o MESMO cursor que dirige o fill do TimelineScrubber. Não
        // há mais RAF aqui. Arco só é visível quando `currentTime` cruza
        // seu `t` normalizado; `drawProgress` arranca daí. Arcos com `t`
        // menor (eventos mais antigos) desenham primeiro → INFLATE: poucos
        // arcos cedo (currentTime baixo), muitos tarde → cascata temporal
        // real espelhando a ordem cronológica dos spreads.
        //
        // ApproachDecision v2 (Ted+Lily 2026-05-29 — embelezar ondas): trocado
        // LineLayer (reta 2D, hard-edge, "teia de aranha crua" — user) por
        // ArcLayer. Razões: (a) ArcLayer mora no MESMO @deck.gl/layers já
        // importado — só adiciona shaders do arc ao chunk lazy spreadMapLayers,
        // fora do entry e do ratchet maplibre-gl; NÃO é TripsLayer (que puxaria
        // @deck.gl/geo-layers, chunk novo); (b) curva great-circle GPU nativa
        // (getHeight) elimina o visual reto cru; (c) gradiente source→target
        // (getSourceColor/getTargetColor) + taper de largura (getWidth) são
        // nativos — fluxo direcional bonito de graça; (d) AA GPU = sem jaggies.
        //
        // Draw-on PRESERVADO (contrato unified-clock 879d868 intacto): o gating
        // continua `draw = (currentTime - arc.t) / DRAW_FRAC`, reduced-motion →
        // draw=1. A diferença: o target do arco é o `tip` interpolado de
        // from→to por `draw`, então o arco CRESCE curvando-se em direção ao
        // destino (efeito "reaching out"). O bow (getHeight) também escala com
        // draw pra a curva nascer rasa e abrir conforme estende — leitura
        // orgânica de rastro, não de linha pop-in.
        //
        // Gating clock-único (DRAW_FRAC/lerpPos/buildVisSegs/makeArcLayers)
        // foi extraído ao módulo (2026-05-30) — global E post mode usam o
        // MESMO contrato. Ver helpers no topo do arquivo.

        function renderFrame(p: number) {
          if (!overlay) return

          // Segmentos visíveis pro cursor atual (gating compartilhado).
          const visSegs = buildVisSegs(data.arcs, p, reducedMotion)

          // Dots: destino aparece só quando o arco correspondente terminou
          // de desenhar (drawProgress = 1 ⇔ p - t >= DRAW_FRAC). reduced →
          // todos visíveis. Pulse no instante em que o rastro "chega".
          const visPts = destPoints.filter(
            (d) => reducedMotion || p - d.t >= DRAW_FRAC,
          )

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
              // ─── Pontes K=1 (Fase 2b) — ring mecânico ────────────────────
              //
              // Anel vazado (stroked, fill transparente) ao redor de nós que
              // são única via até alguém na MINHA rede. Raio > o do nó pra
              // formar halo. Cor accent2 (não verde/vermelho — evita semântica
              // moral "bom/ruim"). Só network + lente ON. Render acima dos
              // social-nodes pra o anel cercar o pin. Manifesto §22/§25.
              ...(bridgeNodes.length > 0
                ? [
                    new ScatterplotLayer({
                      id: 'bridge-rings',
                      data: bridgeNodes,
                      getPosition: (d: { pos: [number, number] }) => d.pos,
                      getRadius: (d: { count: number }) =>
                        Math.max(4, Math.sqrt(d.count) * 4) + 5,
                      getFillColor: [0, 0, 0, 0] as [number, number, number, number],
                      stroked: true,
                      filled: false,
                      getLineColor: [244, 130, 14, 230] as [number, number, number, number],
                      getLineWidth: 2,
                      lineWidthUnits: 'pixels',
                      radiusUnits: 'pixels',
                      pickable: false,
                    }),
                  ]
                : []),
              // ─── Rastro curvo (ArcLayer) — duas camadas pra glow ────────
              // Glow underlay aditivo + corpo gradiente/taper. Geometria,
              // cor (arcColor/glowColor) e gating idênticos ao post mode —
              // fabricados pelo helper compartilhado makeArcLayers.
              ...makeArcLayers(ArcLayer, visSegs, p, 'prop-arcs'),
              new ScatterplotLayer({
                id: 'prop-dots',
                data: visPts,
                getPosition: (d: AnimDotProps) => d.pos,
                // isCurrent → chartreuse (mesma do arco) + raio maior.
                getFillColor: (d: AnimDotProps) => {
                  if (d.isCurrent) return [232, 255, 90, 240]
                  return [52, 211, 153, 130]
                },
                getRadius: (d: AnimDotProps) => {
                  // Pulse no momento em que o rastro CHEGA (draw acabou de
                  // completar): grande → assenta. age medido pós-chegada.
                  const arrived = p - d.t - DRAW_FRAC
                  const pulse =
                    !reducedMotion && arrived >= 0 && arrived < DRAW_FRAC
                      ? 1 + (1 - arrived / DRAW_FRAC) * 4
                      : 1
                  const baseR = d.isCurrent ? 4 : 3
                  return baseR * pulse
                },
                radiusUnits: 'pixels',
                updateTriggers: { getFillColor: 1, getRadius: p },
              }),
            ],
          })
        }

        // Publica renderFrame pro effect do relógio (NÃO arranca RAF aqui).
        // O cursor (`currentTime`) é avançado pelo useTimelineClock; um
        // effect separado chama renderFrameRef.current(currentTime) a cada
        // mudança. Renderiza o frame atual já no load pra evitar mapa vazio
        // até o primeiro tick do relógio.
        renderFrameRef.current = renderFrame
        map.once('load', () => {
          if (cancelled) return
          renderFrameRef.current?.(latestTimeRef.current)
        })
      } catch (err) {
        console.error('[SpreadMap global] init error:', err)
      }
    })()

    return () => {
      cancelled = true
      renderFrameRef.current = null
      mapCleanup?.()
      overlay = null
    }
  }, [data, mapView, reducedMotion])

  // ─── Draw on clock tick (Ted+Lily 2026-05-29) ──────────────────────
  // Único ponto que dirige o desenho dos arcos: sempre que `currentTime`
  // avança (pelo RAF do relógio único), re-renderiza o frame gated por
  // esse cursor. Sem RAF próprio aqui — 1 RAF total no sistema (o do
  // useTimelineClock). reduced-motion → currentTime=1 estático, então
  // este effect roda uma vez com p=1 (arcos full) e não mais.
  useEffect(() => {
    latestTimeRef.current = currentTime
    renderFrameRef.current?.(currentTime)
  }, [currentTime])

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
        clock={{ currentTime, paused, togglePaused }}
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
  clock,
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
  /**
   * Relógio compartilhado único (Ted+Lily 2026-05-29). Quando presente, o
   * scrubber LÊ `currentTime` (fill + caret) e controla `paused` via
   * `togglePaused` — a MESMA fonte que dirige os arcos no mapa. Ausente
   * (PostModeMap sem clock) → scrubber cai no fallback CSS autoplay
   * histórico.
   */
  clock?: TimelineClock
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
          <TimelineScrubber
            events={timelineEvents}
            mode={mode}
            {...(clock
              ? {
                  currentTime: clock.currentTime,
                  paused: clock.paused,
                  onTogglePaused: clock.togglePaused,
                }
              : {})}
          />
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
