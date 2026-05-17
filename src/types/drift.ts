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

// ─── User metadata kind 0 (NIP-01 — opt-in identity) ────────────────

/**
 * Cache local de eventos kind 0 (NIP-01 profile metadata). Mirror da
 * tabela `users_metadata`. Replaceable event — LWW por `eventCreatedAt`
 * na ingestão.
 *
 * **Manifesto §5.3 / §28**: campos opt-in, default vazio = modo Anônimo.
 * **NUNCA** participa de score/weight/feed ranking — LOCK_VIA_TEST.
 *
 * Whitelist NIP-01 puro. Drift NÃO inventa campos próprios em kind 0
 * (manifesto §30 compat Nostr).
 */
export interface UserMetadata {
  npub: string
  name: string | null
  displayName: string | null
  about: string | null
  picture: string | null
  banner: string | null
  website: string | null
  nip05: string | null
  lud16: string | null
  eventCreatedAt: number // unix sec — tiebreaker LWW
}

/**
 * Payload pra publish de kind 0. Whitelist estrito — keys fora desta
 * lista são rejeitadas em build time pela conformance test.
 *
 * Campos undefined são omitidos do JSON serializado (NIP-01 prefer
 * omissão sobre null pra campos vazios).
 */
export interface UserMetadataPayload {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  website?: string
  nip05?: string
  lud16?: string
}

/**
 * Keys permitidas em kind 0 content (LOCK_VIA_TEST source-of-truth).
 * Adicionar campo aqui requer (1) coluna em users_metadata schema,
 * (2) atualização de UserMetadataPayload, (3) teste de conformance.
 */
export const KIND_0_ALLOWED_KEYS: readonly (keyof UserMetadataPayload)[] = [
  'name',
  'display_name',
  'about',
  'picture',
  'banner',
  'website',
  'nip05',
  'lud16',
] as const

// ─── Spread / Bury / Report ──────────────────────────────────────────

export interface SpreadRecord {
  postId: string
  spreaderPub: string
  createdAt: number // unix seconds
  location: GeoPoint | null
  eventId: string
}

export type ReportReason = 'illegal' | 'spam' | 'harassment'

// ─── Comments (Track C — kind 1111 NIP-22) ──────────────────────────

/**
 * Linha materializada da tabela `comments`. Mirror direto das colunas
 * SQLite (snake_case → camelCase na borda).
 *
 * `replyTo === postId` ⇒ comment top-level (resposta direta ao post).
 * `replyTo !== postId` ⇒ resposta a outro comment (cuja id é `replyTo`).
 *
 * Score = -999 esconde do thread (mesmo mecanismo de posts, manifesto §17).
 */
export interface CommentRecord {
  id: string
  postId: string
  replyTo: string
  authorPub: string
  content: string
  createdAt: number
  score: number
  /**
   * C.6.2 — Aviso de conteúdo declarado pelo autor do comment (manifesto
   * §27, NIP-36 reuse). `null` = sem aviso. UI aplica blur/hide via
   * `applyContentFilters` com mesmo mecanismo de Post.
   */
  contentWarning?: ContentWarning | string | null
  /**
   * C.6.3 — Metadado NIP-94 da imagem anexada (no máx. 1 por comment, vs
   * N em Post). Populado em `loadThread`/`addCommentToStore` parsing as
   * tags `imeta` do `raw_event`. Quando ausente, comment é só-texto.
   */
  meta?: import('../lib/nip94').BlobMeta
}

// ─── Feed ────────────────────────────────────────────────────────────

export type FeedTab = 'global' | 'following' | 'trending'

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
  /**
   * Track C.4.2 — coach-mark do ThreadView visto. Default: false.
   * Primeira vez que user abre ThreadView mostra overlay com os 4
   * swipes (~3s); depois desliga até reset.
   */
  thread_coach_seen: boolean
  /**
   * Distribuir blobs via IPFS/Helia (libp2p). Default: false.
   *
   * Quando OFF (default), uploads vão só pro HTTP host e fetch ignora
   * o path Helia — sem libp2p WS chatter, sem autodial, sem custo de
   * banda contínuo. Manifesto §17 (sem chave mestra: opt-in vence).
   *
   * Quando ON, blobs locais participam da malha IPFS — mais resiliência
   * (manifesto §16 "disponibilidade distribuída") em troca de banda
   * extra contínua. User decide o tradeoff explicitamente em settings.
   *
   * Compat retro: users pré-2026-05 tinham Helia auto-init. Migração
   * para `false` é silenciosa — nas próximas chamadas o path Helia
   * será pulado; runs antigas que ainda estejam vivas são recolhidas
   * pelo idle watcher de `helia.ts` (5min default).
   */
  use_ipfs: boolean
  /**
   * NIP-02 auto-discovery: conectar automaticamente via P2P com follows
   * online. Default false — manifesto §28 (privacidade pelo mínimo).
   *
   * Riscos (Barney deliberação 2026-05-16):
   *   1. Follow graph vaza via timing correlation no signaling
   *   2. IP vaza pra cada follow via ICE candidates
   *   3. Follows comprometidos facilitam eclipse
   */
  p2p_auto_follows: boolean
  /**
   * Tema visual da UI. Default 'cinder' (substitui chartreuse legacy
   * em 2026-05-17). Curadoria editorial — 3 paletas com identidade
   * distinta: cinder (monástico), rosenholz (literário), velatura
   * (artesanal light).
   *
   * Manifesto §7 (determinismo): tema é LOCAL, não vai pra rede, não
   * afeta score/feed/weight. LOCK_VIA_TEST garante isolamento de
   * scoring/weight/ranking.
   */
  theme_id: ThemeIdPref
  /**
   * Banner one-time "descobrir relays" — dismissido permanente pelo
   * user. Fase A relay moderation (E6 da deliberação 2026-05-17).
   *
   * Aparece na home quando identidade tem >7 dias E não foi dismissido.
   * Manifesto §17 adendo: user comum sabe que pode escolher relays
   * diferentes do default — sem ser empurrado durante onboarding.
   */
  discover_nudge_dismissed: boolean
  /**
   * Banner one-time "Sua Lente" — dismissido permanente. Trust Lens
   * Phase 1 (plan §1.5). Aparece quando user tem ≥10 follows E identidade
   * ≥7 dias E lens strength = 0 E não foi dismissido.
   *
   * Manifesto §17 (sem chave mestra): UX honesta — user só recebe nudge
   * depois que tem grafo suficiente pra lens fazer sentido.
   */
  lens_nudge_dismissed: boolean
  /**
   * Sovereignty schema bump 2026-05-17 (Marshall conformance NEEDS-FIX A).
   * Endpoint HTTP de upload de blobs (Blossom server). Quando undefined,
   * usa default constante (nostr.build). User power pode trocar pra
   * self-hosted blossom server. Manifesto §17 (sem chave mestra: user
   * NÃO depende de nostr.build se quiser sair).
   *
   * Validation: URL https:// obrigatório (settings UI futuro deve gatekeep).
   * Empty string = unset (cai no default).
   */
  upload_endpoint?: string
  /**
   * Sovereignty schema bump 2026-05-17 (Marshall conformance NEEDS-FIX B).
   * Template URL pra tiles de mapa (XYZ format `{x}/{y}/{z}` ou similar).
   * Quando undefined, usa CARTO Voyager default. CARTO loga IP do user —
   * privacy concern §28. User power pode trocar pra OSM, self-hosted,
   * ou mirror anônimo.
   *
   * Validation: URL https:// + tokens {x}{y}{z} obrigatórios.
   * Empty string = unset.
   */
  map_tile_url_template?: string
  /**
   * Sovereignty schema bump 2026-05-17 (Marshall conformance NEEDS-FIX C).
   * Override do threshold dinâmico de reports (manifesto §26). Quando
   * undefined, usa cálculo dinâmico baseado em peso/idade do post.
   * Power user pode forçar threshold custom (debug, comunidades fechadas).
   *
   * Validation: integer ≥ 1. undefined ou 0 = usar dinâmico.
   */
  report_threshold_override?: number
}

/**
 * `ThemeId` re-exportado como string pra evitar import cycle
 * `types/drift` → `lib/theme` → `types/drift`. THEME_IDS canônico
 * em `lib/theme.ts`; este type é só pra schema do UserPrefs.
 */
export type ThemeIdPref = 'cinder' | 'rosenholz' | 'velatura'

/** Modo de renderização do `<ThreadView>` — list (default) ou cards (opt-in). */

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
  thread_coach_seen: false,
  use_ipfs: false,
  p2p_auto_follows: false,
  theme_id: 'cinder',
  discover_nudge_dismissed: false,
  lens_nudge_dismissed: false,
}

// ─── Trust Lens (Phase 1 — manifesto §24 view-layer carve-out) ────
//
// Naming Lily 2026-05-17: `Lens*` (não `Trust*`) pra evitar colisão
// com "Peso de Perfil" em ProfileModal. Vocabulário Drift mantém
// "Sua Lente" (PT-BR user-facing), "lens" (código/spec).
//
// Plano completo: Docs/plans/trust-lens-phase1-plan.md
// HIMYM deliberation: Docs/sessions/trust-lens-*-2026-05-17.md

/**
 * Components do edge weight — schema versionado pra forward-compat.
 * v=1 fixo em Phase 1. Phase 2/3 adiciona labeler components em v=2.
 * Reader em `lib/trust/predicate.ts` faz schema check; v desconhecido
 * → trata como edge vazio (degradação graciosa).
 */
export interface LensEdgeComponentsV1 {
  v: 1
  /** 1 se source segue target (NIP-02), 0 caso contrário. */
  follow: 0 | 1
  /** Contagem de mutuais entre source e target em vizinhança-de-1
   *  (intersection com follows do source; Barney P0.4). */
  mutual_spread: number
  /** Quantos posts do target foram SPREADed por source. */
  my_spread: number
  /** Quantos posts do target foram BURYed/muted por source. */
  my_bury: number
  /** Contagem de paths disjuntos source→target (depth ≤3). */
  fof_paths: number
}

export type LensEdgeComponents = LensEdgeComponentsV1
// Phase 2: | LensEdgeComponentsV2 quando labeler influence entra

/** Edge no grafo de confiança local. Source = active identity. */
export interface LensEdge {
  source_npub: string
  target_npub: string
  /** [0, 1]. Output do sigmoid de `EDGE_WEIGHT` coefficients. */
  influence: number
  components: LensEdgeComponents
  /** ms epoch (consistent com Date.now()). */
  updated_at: number
}

/** PPR Monte Carlo cache entry — pre-computed per recompute window. */
export interface LensWalkCacheEntry {
  source_npub: string
  target_npub: string
  /** [0, 1]. Stationary distribution mass attributed a target. */
  ppr_score: number
  /** ms epoch. TTL + LRU eviction key. */
  computed_at: number
}

/** Ação aplicada quando um predicate matches. */
export type FilterAction = 'hide' | 'dim' | 'collapse' | 'blur'

/**
 * Predicate DSL pra filter rules — Robin §27 loop fix.
 * Combina trust score local + tags content-warning + composição
 * via `and`/`or`/`not`. Discriminated union por `kind`; reader
 * rejeita `v !== 1` gracefully (return null, não throw).
 */
export type LensFilterPredicate =
  | {
      v: 1
      kind: 'trust_threshold'
      op: 'lt' | 'gte'
      /** [0, 1]. Compara contra `ppr_score(author)`. */
      value: number
      action: FilterAction
    }
  | {
      v: 1
      kind: 'tag_present'
      /** Tag Nostr name (e.g. 'content-warning'). */
      tag: string
      /** Opcional — match exato em tag value. Ausente = tag presente. */
      tag_value?: string
      action: FilterAction
    }
  | {
      v: 1
      kind: 'and'
      predicates: LensFilterPredicate[]
      action: FilterAction
    }
  | {
      v: 1
      kind: 'or'
      predicates: LensFilterPredicate[]
      action: FilterAction
    }
  | {
      v: 1
      kind: 'not'
      predicate: LensFilterPredicate
      action: FilterAction
    }

/** Filter rule persistida em `lens_filter_rules`. User-state. */
export interface LensFilterRule {
  /** UUIDv4 gerado em `lib/trust-lens.ts:createRule`. */
  rule_id: string
  predicate: LensFilterPredicate
  active: boolean
  created_at: number
}
