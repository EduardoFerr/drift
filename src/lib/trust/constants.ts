/**
 * Trust Lens — constantes hard-coded da Phase 1.
 *
 * Decisão Ted v2 (`Docs/sessions/trust-lens-L-parameter-ted-2026-05-17.md`):
 * estes parâmetros NÃO podem ser `user_prefs` porque PPR precisa ser
 * determinístico cross-device pra mesma identidade (manifesto §7).
 * User-tunável quebra convergência. Phase 2 telemetria pode override
 * via build flag, não runtime setting.
 *
 * Math (Personalized PageRank Monte Carlo):
 *   - L=6: ⌊1/α⌋ par. Captura ~62% da massa natural com α=0.15.
 *          Expected walk length E[len] = 1/α = 6.67. Compute ~75ms
 *          mid-range phone (extrapolando RFC L=4 = 50ms).
 *   - K=1000: variance Monte Carlo ε≈0.07 com 95% conf (Bahmani 2010).
 *   - α=0.15: damping clássico PageRank (Brin/Page 1998); decay natural
 *            por distância — não precisa cutoff manual (Ted retraído
 *            L=2 do zero-trust survey: "era security theater").
 *
 * Defesa Sybil real (não vem do L baixo — slept defense):
 *   - Path diversity scoring (Alvisi/Viswanath central)
 *   - Cluster detection (baixo mixing-time + alta densidade)
 *   - Mandatory random walk não-greedy
 *
 * Plano completo: Docs/plans/trust-lens-phase1-plan.md
 */

export const PPR_PARAMS = {
  /** Max walk length (depth do random walk). */
  L: 6,
  /** Walks per recompute (variance trade-off). */
  K: 1000,
  /** Damping / restart probability. Expected walk length = 1/ALPHA. */
  ALPHA: 0.15,
} as const

/**
 * Edge weight formula coefficients (sigmoid input).
 *
 *   influence = sigmoid(
 *     W_FOLLOW · follow_edge
 *   + W_MUTUAL · log(1 + min(mutual, MUTUAL_CAP))
 *   + W_MY_SPREAD · log(1 + my_spreads)
 *   − W_MY_BURY · log(1 + my_buries)
 *   )
 *
 * Mutual cap (Barney P0.4): mutual_spread restrito a vizinhança-de-1
 * (intersection com follows do source) + cap 20 antes do log evita
 * sock-puppet flooding distorcer edges.
 */
export const EDGE_WEIGHT = {
  W_FOLLOW: 1.5,
  W_MUTUAL: 1.0,
  W_MY_SPREAD: 1.2,
  W_MY_BURY: 1.5,
  MUTUAL_CAP: 20,
} as const

/**
 * View-layer multipliers — slider Lily 0-100% maps pra (β, γ).
 *
 *   s_local = s_global × clip(
 *     ALPHA_VIEW + BETA_MAX · strength · ppr_score(author)
 *                + GAMMA_MAX · strength² · mutual_spread_post,
 *     S_LOCAL_MIN, S_LOCAL_MAX
 *   )
 *
 * γ não-linear (strength²) pra "Forte" não explodir o multiplicador
 * (Lily decision).
 */
export const VIEW_MULTIPLIER = {
  ALPHA_VIEW: 1.0,
  BETA_MAX: 0.8,
  GAMMA_MAX: 0.4,
  S_LOCAL_MIN: 0.1,
  S_LOCAL_MAX: 3.0,
} as const

/**
 * Storage caps (Barney P0.1 — sem isso vira DOS lento via flood).
 *
 *   edges = follows ∪ FoF-d1 ∪ {autores que SPREADei}
 *   TTL 90d em edges não-follow
 *   LRU eviction quando cap atingido
 */
export const STORAGE_CAPS = {
  /** Max rows em lens_edges per source_npub. */
  MAX_EDGES_PER_SOURCE: 50_000,
  /** Max rows em lens_walks_cache per source_npub. */
  MAX_WALKS_PER_SOURCE: 5_000,
  /** TTL pra edges não-follow (ms). */
  NON_FOLLOW_EDGE_TTL_MS: 90 * 24 * 60 * 60 * 1000,
} as const

/**
 * Recompute trigger thresholds. PPR é debounced — recompute caro
 * (~75ms em mid-range phone), evita rodar a cada SPREAD.
 */
export const RECOMPUTE_TRIGGERS = {
  /** Forces recompute on follow list change (count delta). */
  FOLLOW_CHANGE_THRESHOLD: 1,
  /** Forces recompute after N SPREAD/BURY events. */
  EVENTS_THRESHOLD: 50,
  /** Forces recompute after N ms regardless. */
  MAX_AGE_MS: 24 * 60 * 60 * 1000,
  /** Debounce window pra coalescer triggers. */
  DEBOUNCE_MS: 200,
} as const
