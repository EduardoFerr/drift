/**
 * Constantes do protocolo Drift.
 *
 * Os kinds são parte do protocolo público — alterá-los quebra a
 * compatibilidade com clientes alternativos. Não mudar sem versionar.
 *
 * Por que 9078..9081:
 *   - Faixa 1..9999 = regular events: imutáveis, sem dedup por d-tag,
 *     comportamento padrão simples e universalmente suportado pelos
 *     relays. Combina com a filosofia Drift de eventos imutáveis.
 *   - Faixa 9000..9999 está praticamente vazia (apenas 9041, 9734,
 *     9735 reservados por NIPs). Subscribe puxa quase só tráfego
 *     Drift — sem desperdício de banda/CPU em eventos descartáveis.
 *   - Mantém o sufixo 78..81 do design original.
 *
 * NÃO usamos kind 30078 (compartilhado pelo NIP-78
 * "Application-specific data" usado por Coracle, Iris, Snort etc.)
 * nem kinds parameterized replaceable (30000-39999) para SPREAD/BURY/
 * REPORT, porque esses não têm d-tag e seriam incorretamente dedupados
 * por relays como (pubkey, kind) em vez de imutáveis.
 */

export const DRIFT_KIND = {
  POST: 9078, // post com subposts (regular event imutável)
  SPREAD: 9079, // espalhamento (swipe up)
  BURY: 9080, // enterro (swipe down)
  REPORT: 9081, // report de moderação
} as const

/** Conjunto para checagem rápida de kind Drift (early return em events.ts) */
export const DRIFT_KIND_SET: ReadonlySet<number> = new Set(Object.values(DRIFT_KIND))

// 250 chars (user feedback 2026-05-17): cap round + enforced via
// textarea `maxLength`. Antes 256 (power-of-2 byte-economy), revertido
// porque user prefere UX previsível ("250" no contador) sobre
// alinhamento de memória — diff é 6 bytes/post, irrelevante.
// 8 subposts × 250 = 2000 chars body máximo.
export const DRIFT_LIMITS = {
  TEXT_MAX_CHARS: 250,
  MAX_SUBPOSTS_ABS: 8,
  MAX_POSTS_CACHE: 10_000,
  CACHE_CLEANUP_MS: 6 * 60 * 60 * 1000, // 6h
  ENGAGEMENT_MAX: 60,
  ANTIQUITY_MAX: 40,
  WEIGHT_MAX: 100,
} as const

export const ENGAGEMENT_POINTS = {
  POST_SPREAD: +10,
  COMMENT_RECEIVED: +1,
  POST_BURIED: 0, // enterro NÃO penaliza — julgamento estético
  REPORT_CONFIRMED: -15,
  DAILY_INACTIVE: -1,
} as const

/**
 * Cap absoluto da contribuição agregada de comments ao score de um post.
 *
 * Track C.5 (`Docs/comments.md` §3.4 + §11). Sem cap, posts com milhares
 * de commenters viralizariam só por engajamento textual (Sybil de comments
 * + replies cross-talk inflam SUM(weight) sem refletir qualidade real).
 *
 * 30 espelha SPREADS_SCORE_CAP de spreads (manifesto §22 — score
 * determinístico, anti-Sybil). Aplicado em `applyCommentReceived`
 * (scoring.ts) — capa o weighted total ANTES de multiplicar por
 * `ENGAGEMENT_POINTS.COMMENT_RECEIVED`.
 */
export const COMMENTS_SCORE_CAP = 30

export const CLIENT_ID = 'drift-official'
export const DRIFT_VERSION = '1'
/**
 * Versão semântica do cliente Drift. Source: package.json (single source
 * of truth). Vite resolve esse import como JSON em build/dev. User-facing
 * em SettingsRoot ("sobre" group) + DiagnosticPanel (status técnico).
 */
import pkg from '../../package.json'
export const CLIENT_VERSION = pkg.version

/**
 * Janela de safety pra optimistic UI. Após esse tempo sem confirmação
 * via subscribe, a UI descarta o `pending` e volta ao estado real do
 * SQLite.
 *
 * 30s cobre a maioria das rotas: WSS reconnect (~3s) + relay propaga
 * pro nosso subscribe (~1s) + verify Schnorr + persist + invalidateFeed
 * (debounced 150ms). Em 3G ruim, ainda dá margem. Manifesto §10:
 * optimistic não pode mentir indefinidamente.
 */
export const OPTIMISTIC_TIMEOUT_MS = 30_000

/** Janela de debounce para recalcular score quando rajadas de
 *  spreads/buries chegam pelo subscribe. */
export const SCORE_RECALC_DEBOUNCE_MS = 100

/** Constantes de tempo em milissegundos. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MS_PER_DAY_30 = 30 * MS_PER_DAY
export const MS_PER_WEEK = 7 * MS_PER_DAY
