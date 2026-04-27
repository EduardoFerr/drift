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

export interface Subpost {
  id: string
  type: SubpostType
  text: string | null // máx 280 chars
  imageUrl: string | null // URL nostr.build
  order: number // 0-indexed
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

export interface SpreadArc {
  origin: [number, number] // [lng, lat]
  destination: [number, number]
  createdAt: number
}

export interface SpreadMapData {
  arcs: SpreadArc[]
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
}

export const DEFAULT_USER_PREFS: UserPrefs = {
  show_nsfw_default: false,
  hide_spoilers: true,
  hide_ads: false,
  location_granularity: 'off',
  onboarding_done: false,
}
