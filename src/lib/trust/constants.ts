/**
 * Trust Lens — constantes hard-coded da Phase 1.
 *
 * Decisão Ted v2 (`Docs/sessions/trust-lens-L-parameter-ted-2026-05-17.md`):
 * estes parâmetros NÃO podem ser `user_prefs` porque PPR precisa ser
 * determinístico cross-device pra mesma identidade (manifesto §7).
 * User-tunável quebra convergência. Phase 2 telemetria pode override
 * via build flag, não runtime setting.
 *
 * Math (Personalized PageRank Monte Carlo, corrigida Stage 3 HIMYM
 * 2026-05-17 — `trust-lens-math-stage3-himym-2026-05-17.md`):
 *
 *   - L=6: cap em edges traversed. Algoritmo: damping check ANTES do hop,
 *          K ∈ {0,...,L} = edges traversed. P(K=k) = α·(1−α)^k geometric
 *          0-indexed. Massa retida = Σ_{k=0..L} α(1−α)^k = 1 − (1−α)^(L+1)
 *          = 1 − 0.85^7 = 0.6794 (≈32% da cauda truncada).
 *          E[K_realized] ≈ 5.79 (não 6.67 — convenção geometric 0-indexed).
 *          L=6 cobre E[K]+1 com 1 hop de headroom.
 *          Compute ~75ms mid-range phone.
 *
 *   - K=1000: variance Monte Carlo bounds (corrigido):
 *     · Hoeffding marginal (per-target, 95% conf): ε ≤ √(ln(40)/2K) = 0.043
 *     · Bahmani uniform (simultâneo, K=O(log n/ε²)): ε ≤ √(log n/K)
 *       Pra n teórico 50k → log=10.8 → ε ≤ 0.104.
 *       Pra n efetivo Nostr realista (~50, log≈6) → ε ≤ 0.077.
 *     Banda aceitável pra ordering local; revisar K em Phase 2 se
 *     ε_uniform impacta UX (telemetria mede top-N variance).
 *
 *   - α=0.15: damping clássico PageRank (Brin/Page 1998); decay natural
 *            por distância. P(reach hop 3) = 0.85^3 = 0.61.
 *            Não precisa cutoff agressivo de L — defense real anti-Sybil
 *            é path diversity scoring, não L baixo (Ted survey L=2 era
 *            slept defense, retraído).
 *
 * Defesa Sybil real (Alvisi/Viswanath, Stage 3 confirmação):
 *   - Path diversity scoring (cap M=0.3 por intermediary, central)
 *   - Cluster detection (baixo mixing-time + alta densidade interna)
 *   - Mandatory random walk não-greedy
 *   - W_BIAS=-2.0 garante razão direct:FoF ≥ 7x (Robin/Barney call)
 *
 * Plano completo: Docs/plans/trust-lens-phase1-plan.md
 * Workflow 3-stage HIMYM math review:
 *   - Stage 1 Marshall: 7 bugs + 7 issues
 *   - Stage 2 Robin: relatoria empirical
 *   - Stage 3 5/5: 11/14 consensus + 2 dissents resolved
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
 *     W_BIAS                                      // anti-Sybil base
 *   + W_FOLLOW · follow_edge
 *   + W_MUTUAL · log(1 + min(mutual, MUTUAL_CAP))
 *   + W_MY_SPREAD · log(1 + my_spreads)
 *   − W_MY_BURY · log(1 + my_buries)
 *   )
 *
 * Mutual cap (Barney P0.4): mutual_spread restrito a vizinhança-de-1
 * (intersection com follows do source) + cap 20 antes do log evita
 * sock-puppet flooding distorcer edges.
 *
 * W_BIAS=-2.0 (Stage 3 HIMYM, Marshall BUG-4 + Robin/Barney call):
 * sem bias, FoF vazio teria σ(0)=0.5 — competiria 1.6x com follow
 * legítimo σ(1.5)=0.818, propagando massa PPR em estranger. Com
 * W_BIAS=-2.0: FoF vazio σ(-2)=0.119, follow σ(-0.5)=0.378 puro,
 * follow+spread σ(-0.5+1.79)=0.78. Razão direct:FoF ≈ 7x — lado
 * conservador anti-Sybil é erro recuperável; liberal era unrecoverable
 * Sybil promotion.
 */
export const EDGE_WEIGHT = {
  W_BIAS: -2.0,
  W_FOLLOW: 1.5,
  W_MUTUAL: 1.0,
  W_MY_SPREAD: 1.2,
  W_MY_BURY: 1.5,
  MUTUAL_CAP: 20,
} as const

/**
 * View-layer multipliers — slider Lily 0-100% maps pra (β, γ) linearmente.
 *
 *   ppr_normalized = log(1 + 100·ppr_score) / log(101)   // [0, 1] log-transform
 *   s_local = s_global × clip(
 *     ALPHA_VIEW + BETA_MAX · strength · ppr_normalized
 *                + GAMMA_MAX · strength · mutual_spread_post,
 *     S_LOCAL_MIN, S_LOCAL_MAX
 *   )
 *
 * Mudanças Stage 3 HIMYM (Marshall BUG-5 + BUG-6):
 *
 * - **Log-transform PPR** (BUG-5 fix): PPR scores em prática são power-law
 *   (top-1 ≈ 0.05-0.15, median ≈ 0.001). Sem normalização, BETA · ppr_raw
 *   contribui 1-8% no multiplier — placebo. Log-transform achata escala:
 *   top author ppr=0.10 → normalized=0.49; median ppr=0.01 → 0.13.
 *   Com BETA_MAX=1.5: top author boost = 0.74 (visível). Quantile-rank
 *   (O(N log N)) defer Phase 2 se telemetria mostrar regime skew > 3x.
 *
 * - **Linear strength** (BUG-6 fix): slider linear matchea perceptual
 *   (Norman heurística). strength² fazia Moderado (50%) = 25% do Forte,
 *   conflitando com expectativa visual. Cap em BETA_MAX·1 já protege
 *   explosão sem precisar curva.
 *
 * - **BETA_MAX 0.8 → 1.5**: top author com log-transform ppr_normalized
 *   = 0.49 dá boost 0.74 (visível); sem log seria placebo mesmo com
 *   BETA=1.5.
 */
export const VIEW_MULTIPLIER = {
  ALPHA_VIEW: 1.0,
  BETA_MAX: 1.5,
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
