/**
 * Trust Lens — filter predicate DSL evaluator.
 *
 * Robin Stage 2 §27 loop fix: predicate DSL permite combinar tags
 * de content-warning (auto-classificação §27) com PPR thresholds
 * (Trust Lens) em regras locais persistidas em `lens_filter_rules`.
 *
 * Pure functions — sem side effects, sem DB access. Caller passa
 * `context` com PPR score + tags do post; evaluator retorna boolean.
 *
 * Shape (versionado v=1):
 *
 *   { v:1, kind:'trust_threshold', op:'lt'|'gte', value:number, action }
 *   { v:1, kind:'tag_present', tag:string, tag_value?:string, action }
 *   { v:1, kind:'and', predicates:[...], action }
 *   { v:1, kind:'or', predicates:[...], action }
 *   { v:1, kind:'not', predicate:..., action }
 *
 * Action semântica: SOMENTE o `action` do root predicate importa.
 * Sub-predicates em composição (`and`/`or`/`not`) têm `action` por
 * conformance ao schema, mas evaluator ignora.
 *
 * Versionamento: reader rejeita `v != 1` gracefully retornando `null`
 * (não throw). Forward-compat pra Phase 2 schema evolution.
 *
 * Exemplo §27 loop completo (autor classifica → leitor filtra):
 *
 *   {
 *     v: 1, kind: 'and', action: 'hide',
 *     predicates: [
 *       { v: 1, kind: 'tag_present', tag: 'content-warning',
 *         tag_value: 'nsfw', action: 'hide' },
 *       { v: 1, kind: 'trust_threshold', op: 'lt', value: 0.1,
 *         action: 'hide' },
 *     ]
 *   }
 *
 * "Esconder post se TEM content-warning=nsfw E autor PPR < 0.1".
 *
 * Conformance test #5: parsePredicate rejeita v != 1 ou kind unknown
 * sem throw.
 */

import type {
  LensFilterPredicate,
  FilterAction,
} from '../../types/drift'

// ─── Constants ────────────────────────────────────────────────────

const VALID_KINDS = new Set(['trust_threshold', 'tag_present', 'and', 'or', 'not'])
const VALID_ACTIONS: ReadonlySet<FilterAction> = new Set<FilterAction>([
  'hide',
  'dim',
  'collapse',
  'blur',
])
const VALID_TRUST_OPS = new Set(['lt', 'gte'])

// ─── Pure: parsePredicate (safe reader) ───────────────────────────

/**
 * Parse uma estrutura arbitrária pra `LensFilterPredicate`. Retorna
 * `null` se inválida (sem throw) — forward-compat com v=2 desconhecido.
 *
 * Validation rules:
 *   - Object, não null
 *   - `v === 1`
 *   - `kind` em VALID_KINDS
 *   - `action` em VALID_ACTIONS
 *   - Per-kind validation (e.g., trust_threshold tem `op` e `value`)
 *   - Composição (`and`/`or`) tem `predicates: Array` não-vazio
 *   - `not` tem `predicate` válido (recursivo)
 *
 * Depth-limited a 10 níveis pra prevenir DoS via JSON profundo.
 */
export function parsePredicate(
  raw: unknown,
  _depth = 0,
): LensFilterPredicate | null {
  if (_depth > 10) return null
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return null
  if (typeof r.kind !== 'string' || !VALID_KINDS.has(r.kind)) return null
  if (typeof r.action !== 'string' || !VALID_ACTIONS.has(r.action as FilterAction)) {
    return null
  }
  const action = r.action as FilterAction

  switch (r.kind) {
    case 'trust_threshold': {
      if (typeof r.op !== 'string' || !VALID_TRUST_OPS.has(r.op)) return null
      if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null
      if (r.value < 0 || r.value > 1) return null
      return {
        v: 1,
        kind: 'trust_threshold',
        op: r.op as 'lt' | 'gte',
        value: r.value,
        action,
      }
    }
    case 'tag_present': {
      if (typeof r.tag !== 'string' || r.tag.length === 0) return null
      const result: LensFilterPredicate = {
        v: 1,
        kind: 'tag_present',
        tag: r.tag,
        action,
      }
      if (typeof r.tag_value === 'string') {
        result.tag_value = r.tag_value
      }
      return result
    }
    case 'and':
    case 'or': {
      if (!Array.isArray(r.predicates) || r.predicates.length === 0) return null
      const parsed: LensFilterPredicate[] = []
      for (const sub of r.predicates) {
        const p = parsePredicate(sub, _depth + 1)
        if (p === null) return null
        parsed.push(p)
      }
      return {
        v: 1,
        kind: r.kind as 'and' | 'or',
        predicates: parsed,
        action,
      }
    }
    case 'not': {
      const inner = parsePredicate(r.predicate, _depth + 1)
      if (inner === null) return null
      return { v: 1, kind: 'not', predicate: inner, action }
    }
    default:
      return null
  }
}

// ─── Pure: evaluatePredicate ──────────────────────────────────────

/**
 * Context passed pro evaluator. Vem do render path (feed.ts):
 *   - `pprScore` do autor do post (ou 0 se cold-start)
 *   - `tags` extraídos do post Nostr ([name, value] pairs)
 *   - `authorNpub` opcional pra rule futura ('author_block')
 */
export interface PredicateContext {
  /** PPR score do autor do post [0, 1]. 0 se cold-start. */
  pprScore: number
  /** Tags do post como `[name, value, ...]` arrays (NIP-01 format). */
  tags: ReadonlyArray<ReadonlyArray<string>>
  /** Author npub (não usado em v=1, reservado pra v=2). */
  authorNpub?: string
}

/**
 * Evaluate se predicate matches no contexto. Retorna boolean.
 *
 * Caller decide o que fazer com o resultado:
 *   - true + root.action='hide' → não renderizar
 *   - true + root.action='dim' → renderizar opacity-50
 *   - false → render normal
 *
 * Pure — mesmo input bit-exact mesmo output.
 */
export function evaluatePredicate(
  predicate: LensFilterPredicate,
  context: PredicateContext,
): boolean {
  switch (predicate.kind) {
    case 'trust_threshold': {
      if (predicate.op === 'lt') return context.pprScore < predicate.value
      // 'gte'
      return context.pprScore >= predicate.value
    }
    case 'tag_present': {
      for (const tag of context.tags) {
        if (tag.length === 0) continue
        if (tag[0] !== predicate.tag) continue
        // Sem tag_value especificado: presence é suficiente
        if (predicate.tag_value === undefined) return true
        // Com tag_value: precisa match exato em tag[1]
        if (tag.length >= 2 && tag[1] === predicate.tag_value) return true
      }
      return false
    }
    case 'and': {
      for (const sub of predicate.predicates) {
        if (!evaluatePredicate(sub, context)) return false
      }
      return true
    }
    case 'or': {
      for (const sub of predicate.predicates) {
        if (evaluatePredicate(sub, context)) return true
      }
      return false
    }
    case 'not': {
      return !evaluatePredicate(predicate.predicate, context)
    }
  }
}

/**
 * Helper: extrai a `action` do root predicate. Sempre presente
 * porque schema valida.
 */
export function rootAction(predicate: LensFilterPredicate): FilterAction {
  return predicate.action
}
