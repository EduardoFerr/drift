/**
 * transport/policy/subValidator — validação de filter de subscription (puro).
 *
 * Surgido de Threat audit T4 (Barney audit 2026-05-08): subscribe filter
 * é input semi-confiável (caller local hoje; potencialmente plugin/peer
 * em Fase 7). Filter "match-all" (sem kinds/authors/ids/tags/since/until)
 * causa amplificação de carga: cada evento que chega percorre todas as
 * subs, com matchFilter retornando true sem trabalho. Filter com
 * authors=[1000 npubs] ou kinds=[100 kinds] também é abusivo.
 *
 * Decisão arquitetural: NÃO whitelist de kinds. Real callers usam:
 *   - DRIFT_KIND_SET (sync.ts via orchestrator)
 *   - NIP-22 kind 1111 (comments.ts)
 *   - SIGNALING_KIND 1059 (webrtc-signaling-nostr.ts)
 *   - Possíveis kinds futuros (NIP-65 10002, NIP-02 3, etc.)
 *
 * Em vez de whitelist, validamos "shape sanity":
 *  1. Pelo menos UM constraint discriminador (kinds | authors | ids |
 *     tag filter `#x` | since | until).
 *  2. Caps em arrays: kinds, authors, ids, tag filters individuais.
 *  3. limit, se presente, dentro de bounds; se ausente, caller decide
 *     (não auto-injetamos pra preservar semântica).
 *
 * Função 100% pura. Tested em tests/webrtc-threat-T4-malicious-sub.test.ts.
 */

import type { Filter } from '../index'

export interface SubValidatorConfig {
  /** Cap em `filter.kinds.length`. Real callers usam ≤ 4. */
  maxKinds: number
  /** Cap em `filter.authors.length`. Real callers passam 1 ou poucos. */
  maxAuthors: number
  /** Cap em `filter.ids.length`. */
  maxIds: number
  /** Cap em valores de cada tag filter (`#e`, `#p`, `#E`...). */
  maxTagValues: number
  /** Cap em quantidade de tag filters distintos (`#e`, `#p`, ...). */
  maxTagFilters: number
  /** Cap em `filter.limit`. Acima disso, sub é rejeitada (não auto-clampada
   *  — caller que escolha conscientemente). */
  maxLimit: number
}

/** Defaults sane: real callers (sync.ts, comments.ts, signaling) cabem
 *  folgadamente. Atacante "match-all" / "1000 authors" é rejeitado. */
export const DEFAULT_SUB_VALIDATOR_CFG: SubValidatorConfig = {
  maxKinds: 16,
  maxAuthors: 64,
  maxIds: 256,
  maxTagValues: 256,
  maxTagFilters: 8,
  maxLimit: 5_000,
}

export type SubValidatorReason =
  | 'match-all'
  | 'too-many-kinds'
  | 'too-many-authors'
  | 'too-many-ids'
  | 'too-many-tag-filters'
  | 'too-many-tag-values'
  | 'limit-too-high'
  | 'invalid-shape'

export interface SubValidatorResult {
  /** `true` se filter é aceitável pra subscribe. */
  ok: boolean
  /** Motivo do reject — útil pra log/telemetria. `null` se ok. */
  reason: SubValidatorReason | null
}

function tagFilterKeys(filter: Filter): string[] {
  // Tag filters são chaves que começam com '#' (#e, #p, #E, etc.).
  return Object.keys(filter).filter((k) => k.startsWith('#'))
}

/**
 * Valida `filter` contra `cfg`. Retorna `{ ok, reason }` — caller decide
 * (drop sub, log, fallback). NÃO muta `filter`.
 *
 * Match-all guard: `kinds`, `authors`, `ids`, todos tag filters, `since`,
 * `until` ausentes simultaneamente → reject. Pelo menos um constraint
 * discriminador é exigido.
 */
export function validateSubscriptionFilter(
  filter: Filter,
  cfg: SubValidatorConfig = DEFAULT_SUB_VALIDATOR_CFG,
): SubValidatorResult {
  if (!filter || typeof filter !== 'object') {
    return { ok: false, reason: 'invalid-shape' }
  }

  const tagKeys = tagFilterKeys(filter)
  const hasKinds = Array.isArray(filter.kinds) && filter.kinds.length > 0
  const hasAuthors = Array.isArray(filter.authors) && filter.authors.length > 0
  const hasIds = Array.isArray(filter.ids) && filter.ids.length > 0
  const hasSince = typeof filter.since === 'number'
  const hasUntil = typeof filter.until === 'number'
  const hasTags = tagKeys.length > 0

  if (!hasKinds && !hasAuthors && !hasIds && !hasSince && !hasUntil && !hasTags) {
    return { ok: false, reason: 'match-all' }
  }

  if (hasKinds && filter.kinds!.length > cfg.maxKinds) {
    return { ok: false, reason: 'too-many-kinds' }
  }
  if (hasAuthors && filter.authors!.length > cfg.maxAuthors) {
    return { ok: false, reason: 'too-many-authors' }
  }
  if (hasIds && filter.ids!.length > cfg.maxIds) {
    return { ok: false, reason: 'too-many-ids' }
  }
  if (tagKeys.length > cfg.maxTagFilters) {
    return { ok: false, reason: 'too-many-tag-filters' }
  }
  for (const key of tagKeys) {
    const vals = (filter as unknown as Record<string, unknown>)[key]
    if (!Array.isArray(vals)) {
      return { ok: false, reason: 'invalid-shape' }
    }
    if (vals.length > cfg.maxTagValues) {
      return { ok: false, reason: 'too-many-tag-values' }
    }
  }
  if (typeof filter.limit === 'number' && filter.limit > cfg.maxLimit) {
    return { ok: false, reason: 'limit-too-high' }
  }

  return { ok: true, reason: null }
}
