/**
 * Tipos do domínio Drift.
 *
 * Convenção: tipos que correspondem a linhas no SQLite usam snake_case
 * (mirror direto das colunas). Tipos do domínio em uso na UI usam
 * camelCase. Adapte na borda — db.ts faz a conversão.
 */

// ─── Identidade ──────────────────────────────────────────────────────

export interface DriftIdentity {
  /** chave privada em hex — NUNCA é transmitida nem persistida em claro */
  nsec: string
  /** chave pública em hex */
  npub: string
  /** nsec1... — formato bech32 para backup */
  nsecBech32: string
  /** npub1... — formato bech32 público */
  npubBech32: string
  createdAt: number // timestamp ms
}

// ─── Subposts e Posts ────────────────────────────────────────────────

export type SubpostType = 'text' | 'image' | 'text+image'

/**
 * V4 — three-layout system (manifesto §27 cosmético; mockup v0.7).
 *
 * Hint visual de renderização do subpost. Single source of truth pra
 * 7 camadas: types/drift.ts (esta const), lib/events.ts (parse+
 * normalização), lib/protocol.ts (serialize), lib/feed.ts (consume
 * via JSON.parse), SubpostEditor (3 chips), SubpostLayout (switch
 * exhaustive), Docs/protocol-spec.md §3.5.x (referencia este array
 * via test layout.spec-code-sync).
 *
 * Adicionar layout novo: append a `LAYOUT_VALUES` → TS exhaustiveness
 * quebra `<SubpostLayout>` switch (assertNever) → quebra a build →
 * single source of truth garantido.
 *
 * Drift entre relays: outros clientes Nostr (Damus/Snort/Coracle) que
 * vejam kind 9078 com `subposts[].layout` ignoram silenciosamente
 * (NIP-01 não regula o payload de aplicação dentro de content). Posts
 * Drift continuam exibindo conteúdo nesses clientes — só perdem o
 * cosmetic. Manifesto §29 compat.
 *
 * Decisão schema: campo no content JSON, NÃO tag NIP-01. HIMYM Round 1
 * 4/5 GO_WITH_MOD + 1 BLOCK pra reverter tag→content; Round 2 ratificou.
 */
export const LAYOUT_VALUES = ['portrait', 'landscape', 'text'] as const
export type LayoutKind = (typeof LAYOUT_VALUES)[number]
export const DEFAULT_LAYOUT: LayoutKind = 'portrait'

/** Type guard determinístico (manifesto §7). Use em events.ts e protocol.ts. */
export function isLayoutKind(v: unknown): v is LayoutKind {
  return typeof v === 'string' && (LAYOUT_VALUES as readonly string[]).includes(v)
}

/**
 * Normaliza layout pra valor canônico. Determinístico (§7):
 * - LayoutKind válido → o próprio valor
 * - undefined/null/inválido → DEFAULT_LAYOUT
 *
 * Usado em events.ts (parse de eventos da rede) e em renderer
 * (defesa em camada — nunca renderiza valor desconhecido).
 */
export function normalizeLayout(v: unknown): LayoutKind {
  return isLayoutKind(v) ? v : DEFAULT_LAYOUT
}

export interface Subpost {
  id: string
  type: SubpostType
  text: string | null // máx 280 chars
  imageUrl: string | null // URL nostr.build
  order: number // 0-indexed
  /**
   * Metadado NIP-94 do blob (Track B.2). Populado em feed.ts a partir
   * das tags `imeta` do evento, na ordem dos subposts com `imageUrl`.
   * Quando presente, o reader (Image component) prefere fetch via
   * `blobs.fetchBlobUrl(meta)` — Helia local + verify SHA-256 + gateway
   * fallback. Quando ausente (post legacy pré-RFC ou cliente sem suporte
   * a imeta), reader cai pro `imageUrl` direto sem hash verify.
   *
   * NÃO serializa no `content` JSON — vem das tags do evento.
   */
  meta?: import('../lib/nip94').BlobMeta
  /**
   * V4 — hint visual. Ausente em posts antigos (compat retro: parse em
   * events.ts normaliza pra DEFAULT_LAYOUT='portrait'). Sempre presente
   * em posts gerados pelo cliente Drift v0.7+ via createPost.
   */
  layout?: LayoutKind
}

export interface GeoPoint {
  lat: number
  lng: number
  city: string
  country: string
}

/**
 * Aviso de conteúdo declarado pelo autor (tag opcional `content-warning`
 * no kind 9078). Manifesto §27 — auto-classificação voluntária. Cliente
 * oficial reconhece os 4 abaixo; outros valores ficam como string livre
 * mas só renderizam como "marcado" sem tratamento específico.
 */
export type ContentWarning = 'nsfw' | 'violence' | 'spoiler' | 'ad'

export const CONTENT_WARNING_VALUES: readonly ContentWarning[] = [
  'nsfw',
  'violence',
  'spoiler',
  'ad',
] as const

/**
 * Granularidade de location declarada pelo user em settings. Manifesto §28.
 * Default `off` — protege contra deanonymization por geolocalização (cidade
 * pequena + post político = identificável).
 */
export type LocationGranularity = 'off' | 'country' | 'city' | 'precise'

/**
 * Hint de renderização derivado de `applyContentFilters(post, prefs)`.
 * Usado pela UI pra decidir blur/hide ANTES de mostrar conteúdo. Não
 * altera o score nem a query do feed (mantém §24 — determinismo).
 */
export interface RenderHint {
  blur: boolean
  hide: boolean
  /** Por que está blurred/hidden — usado em tooltip/overlay. */
  reason: ContentWarning | null
  /**
   * Bloqueio/silenciamento local do autor (manifesto §24). Quando
   * presente, `hide: true` e `reason: null` — é filtro pessoal do
   * leitor, não declaração do autor.
   */
  modReason?: 'blocked' | 'muted'
}

export interface Post {
  id: string
  authorPub: string
  content: string // JSON raw do evento
  subposts: Subpost[] // parsed de content
  createdAt: number // unix seconds (do evento Nostr)
  category: string | null
  location: GeoPoint | null
  client: string | null // 'drift-official' ou outro
  /** Aviso declarado pelo autor (manifesto §27). `null` = sem aviso. */
  contentWarning: ContentWarning | string | null
  score: number // calculado localmente
  spreads: number
  buries: number
  // joins
  authorAlias?: string
  authorAvatar?: string
  authorWeight?: number
}

// ─── Spread / Bury / Report ──────────────────────────────────────────

export interface SpreadRecord {
  postId: string
  spreaderPub: string
  createdAt: number // unix seconds
  location: GeoPoint | null
  eventId: string
}

export interface BuryRecord {
  postId: string
  burierPub: string
  createdAt: number
  eventId: string
}

export type ReportReason = 'illegal' | 'spam' | 'harassment'

export interface ReportRecord {
  postId: string
  reporterPub: string
  weight: number
  createdAt: number
}

// ─── Usuário (perfil agregado) ───────────────────────────────────────

export interface DriftUser {
  npub: string
  alias: string | null
  avatar: string | null
  createdAt: number
  engagement: number // 0..60
  weight: number // 0..100 calculado
  lastActive: number | null
}

// ─── Feed ────────────────────────────────────────────────────────────

export type FeedTab = 'global' | 'following' | 'trending'

export interface FeedOptions {
  tab: FeedTab
  category?: string
  limit?: number
  offset?: number
}

// ─── Mapa ────────────────────────────────────────────────────────────

export interface PropagationArc {
  from: [number, number]
  to: [number, number]
  /** Normalized time 0..1 when this arc fires in the animation. */
  t: number
  /**
   * True quando o arco pertence ao `currentPostId` passado em
   * `useSpreadMap` (modo global). UI usa pra destacar visualmente os
   * arcos do post atualmente focado dentro do agregado global. Default
   * false (post mode não aplica esse hint — todos os arcos pertencem
   * ao post sendo visualizado por construção).
   */
  isCurrent?: boolean
}

export interface SpreadMapData {
  origin: GeoPoint | null
  /** Spread destinations with normalized animation time. */
  destinations: {
    point: GeoPoint
    createdAt: number
    t: number
    /** Mesmo significado de `PropagationArc.isCurrent`. */
    isCurrent?: boolean
  }[]
  /** Propagation chain arcs: consecutive pairs ordered by t. */
  arcs: PropagationArc[]
  totalSpreads: number
  countries: string[]
  firstSpread: SpreadRecord | null
  latestSpread: SpreadRecord | null
}

// ─── Preferências locais ─────────────────────────────────────────────

/**
 * Preferências locais do leitor. Persistidas em `user_prefs` (key/value),
 * nunca saem do device (manifesto §28). Default abaixo é o que `getPrefs()`
 * devolve quando a chave não existe no SQLite.
 */
export interface UserPrefs {
  /** Mostrar posts marcados `nsfw` sem blur. Default: false (blur ativo). */
  show_nsfw_default: boolean
  /** Esconder posts marcados `spoiler` até clique. Default: true. */
  hide_spoilers: boolean
  /** Esconder posts marcados `ad`. Default: false. */
  hide_ads: boolean
  /** Granularidade de location nas publicações próprias. Default: 'off'. */
  location_granularity: LocationGranularity
  /** Onboarding visto. Default: false. */
  onboarding_done: boolean
  /**
   * Modo de visualização do mapa de spread.
   *  - `fit-bounds` (default): foca o viewport nos pontos do post (origem +
   *    destinos), mostrando só a região onde houve espalhamento.
   *  - `open`: globo inteiro com zoom baixo, vê o espalhamento "no mundo".
   * Default `fit-bounds` porque o caso comum é "quero entender este post";
   * `open` é útil pra posts virais com espalhamento intercontinental.
   */
  map_view: MapView
  /** Modo de rede pro tráfego (Fase 6.4). Default 'clearnet'. */
  network_mode: NetworkMode
}

/** Modo de visualização do mapa de spread. */
export type MapView = 'fit-bounds' | 'open'

/** Modo de rede pro tráfego pros relays (Fase 6.4).
 *  - `clearnet`: WSS direto pros relays públicos (default).
 *  - `tor`: WSS via SOCKS5 proxy local (arti embedded no Tauri shell).
 *    IP do user não vaza pro relay. Manifesto §28.
 *  - `onion-only`: só conecta a relays `.onion`; clearnet bloqueado.
 *    Modo paranoia máximo. Manifesto §4 (anonimato por design).
 *
 *  Em PWA browser: setting fica disabled (Tor exige cliente nativo Tauri).
 */
export type NetworkMode = 'clearnet' | 'tor' | 'onion-only'

export const DEFAULT_USER_PREFS: UserPrefs = {
  show_nsfw_default: false,
  hide_spoilers: true,
  hide_ads: false,
  location_granularity: 'off',
  onboarding_done: false,
  map_view: 'fit-bounds',
  network_mode: 'clearnet',
}
