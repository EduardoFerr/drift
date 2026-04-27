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

export type DriftKind = (typeof DRIFT_KIND)[keyof typeof DRIFT_KIND]

/** Conjunto para checagem rápida de kind Drift (early return em events.ts) */
export const DRIFT_KIND_SET: ReadonlySet<number> = new Set(Object.values(DRIFT_KIND))

export const DRIFT_LIMITS = {
  TEXT_MAX_CHARS: 280,
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

export const CLIENT_ID = 'drift-official'
export const DRIFT_VERSION = '1'

/** Janela de debounce para recalcular score quando rajadas de
 *  spreads/buries chegam pelo subscribe. */
export const SCORE_RECALC_DEBOUNCE_MS = 100

/** Constantes de tempo em milissegundos. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MS_PER_DAY_30 = 30 * MS_PER_DAY
export const MS_PER_WEEK = 7 * MS_PER_DAY
