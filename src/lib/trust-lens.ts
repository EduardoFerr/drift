/**
 * Trust Lens — orchestrator API + Zustand store.
 *
 * Camada de integração entre pure functions (`lib/trust/*`) e o resto
 * do app. NÃO toca render path em PR-4b — apenas providencia primitives
 * pra UI (PR-5) e workers futuros (PR-4c).
 *
 * Manifesto §24 carve-out: `s_local` calculado aqui, aplicado no
 * view-boundary do feed (PR-5 vai consumir). NUNCA persistido em
 * `posts.score`. Conformance test #2.
 *
 * **Determinismo**: PPR Monte Carlo usa seed determinística por janela
 * de 24h (`createPprRng`). 2 devices da mesma identidade convergem
 * dentro da janela. §7.
 *
 * **Phase 1 scope (PR-4b)**:
 *   - Store reativa Zustand (strength, enabled, ready)
 *   - Filter rules CRUD (read/add/remove)
 *   - PPR score lookup (read-only do cache; recompute em PR-4c via worker)
 *   - applyLensToPost — pure helper que UI usa por post
 *
 * **NÃO em Phase 1 (deferred)**:
 *   - Recompute trigger automático (PR-4c worker thread)
 *   - Path diversity per-target cache (Phase 1.5)
 *   - Cluster coefficient telemetria (Phase 1.5 Ted nodes/clusters)
 *
 * Plano: Docs/plans/trust-lens-phase1-plan.md §1.4
 */

import { create } from 'zustand'
import { db } from './db'
import {
  computePpr,
  viewMultiplier,
  temporalDecay,
  type AdjacencyList,
} from './trust/ppr'
import { createPprRng } from './trust/rng'
import { computeInfluence, sanitizeComponents } from './trust/edges'
import { parsePredicate, evaluatePredicate } from './trust/predicate'
import { PPR_PARAMS, PPR_DECAY } from './trust/constants'
import { usePrefsStore } from './prefs'
import type {
  LensEdgeComponentsV1,
  LensFilterRule,
  FilterAction,
} from '../types/drift'

// ─── Store ────────────────────────────────────────────────────────

interface LensState {
  /** Slider strength 0..1. 0 = lens off, feed inalterado. */
  strength: number
  /** Computed: strength > 0. Atalho pra UI. */
  enabled: boolean
  /** PPR scores em memória (Map<targetNpub, ppr>). Read-only view. */
  pprScores: Map<string, number>
  /** Timestamp ms da última recompute (pra TTL trigger). */
  lastRecomputedAt: number | null
  /** Filter rules ativas (loaded from `lens_filter_rules`). */
  filterRules: LensFilterRule[]
  /** True após primeiro load do SQLite. */
  loaded: boolean
}

const INITIAL: LensState = {
  strength: 0,
  enabled: false,
  pprScores: new Map(),
  lastRecomputedAt: null,
  filterRules: [],
  loaded: false,
}

export const useLensStore = create<LensState>(() => INITIAL)

// ─── Setters semânticos ───────────────────────────────────────────

/** Atualiza strength (chamado pelo slider UI em PR-5). */
export function setLensStrength(strength: number): void {
  const clamped = Math.max(0, Math.min(1, strength))
  useLensStore.setState({ strength: clamped, enabled: clamped > 0 })
}

// ─── Init/load ────────────────────────────────────────────────────

let loadedOnce = false

/**
 * Carrega filter rules + PPR cache do SQLite pra store. Idempotente
 * — chamadas subsequentes são no-op.
 *
 * Chamado em `bootstrap.ts` depois do db init.
 */
export async function loadLens(): Promise<void> {
  if (loadedOnce) return
  loadedOnce = true

  // Filter rules (user-state, sempre presente)
  const ruleRows = await db.exec<{
    rule_id: string
    predicate: string
    active: number
    created_at: number
  }>(`SELECT rule_id, predicate, active, created_at FROM lens_filter_rules WHERE active = 1`)
  const rules: LensFilterRule[] = []
  for (const row of ruleRows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.predicate)
    } catch {
      continue // JSON inválido — skip silenciosamente
    }
    const predicate = parsePredicate(parsed)
    if (predicate === null) continue // Schema validation
    rules.push({
      rule_id: row.rule_id,
      predicate,
      active: row.active === 1,
      created_at: row.created_at,
    })
  }

  // PPR cache (DOMAIN — pode estar vazio em primeira boot)
  const pprRows = await db.exec<{ target_npub: string; ppr_score: number }>(
    `SELECT target_npub, ppr_score FROM lens_walks_cache
     WHERE source_npub = (SELECT value FROM user_prefs WHERE key = 'active_identity')`,
  )
  const pprScores = new Map<string, number>()
  for (const row of pprRows) pprScores.set(row.target_npub, row.ppr_score)

  // Strength persistido em user_prefs.lens_strength (REAL 0..1). Default 0
  // — feed canônico bit-exact até o user mover o slider. Manifesto §24.
  const strengthRow = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = 'lens_strength'`,
  )
  const strengthRaw = strengthRow ? Number(strengthRow.value) : 0
  const strength = Number.isFinite(strengthRaw)
    ? Math.max(0, Math.min(1, strengthRaw))
    : 0

  useLensStore.setState({
    filterRules: rules,
    pprScores,
    strength,
    enabled: strength > 0,
    loaded: true,
  })
}

// ─── PPR lookups ──────────────────────────────────────────────────

/**
 * PPR score do autor [0, 1]. Retorna `0` se cold-start (cache vazio)
 * ou author desconhecido. NUNCA throws.
 *
 * Use em render path do feed pra alimentar `viewMultiplier`.
 */
export function getPprForAuthor(authorNpub: string): number {
  const score = useLensStore.getState().pprScores.get(authorNpub)
  return score ?? 0
}

/**
 * Aplica Trust Lens em um post — pure helper que UI consome no render.
 *
 * Retorna `s_local` = `s_global × multiplier`. NUNCA persist.
 *
 * Se strength = 0, retorna `globalScore` bit-exact (off-state preserva
 * canônico — conformance test #19).
 */
export function applyLensToPost(params: {
  globalScore: number
  authorNpub: string
  mutualSpreadPost?: number
}): number {
  const state = useLensStore.getState()
  if (state.strength === 0) return params.globalScore
  const pprScore = getPprForAuthor(params.authorNpub)
  const mult = viewMultiplier({
    pprScore,
    mutualSpreadPost: params.mutualSpreadPost ?? 0,
    strength: state.strength,
  })
  return params.globalScore * mult
}

// ─── Filter rules CRUD ────────────────────────────────────────────

/**
 * Cria nova filter rule. Predicate validado via `parsePredicate`;
 * rejeita inválido sem throw retornando `null`.
 *
 * @returns rule_id da rule criada, ou `null` se inválido
 */
export async function addFilterRule(
  predicate: unknown,
  active = true,
): Promise<string | null> {
  const parsed = parsePredicate(predicate)
  if (parsed === null) return null
  const ruleId = crypto.randomUUID()
  const now = Date.now()
  await db.run(
    `INSERT INTO lens_filter_rules (rule_id, predicate, active, created_at)
     VALUES (?, ?, ?, ?)`,
    [ruleId, JSON.stringify(parsed), active ? 1 : 0, now],
  )
  // Atualiza store reativamente
  const current = useLensStore.getState().filterRules
  useLensStore.setState({
    filterRules: [
      ...current,
      { rule_id: ruleId, predicate: parsed, active, created_at: now },
    ],
  })
  return ruleId
}

/** Remove filter rule por id. Returns `true` se removeu. */
export async function removeFilterRule(ruleId: string): Promise<boolean> {
  await db.run(`DELETE FROM lens_filter_rules WHERE rule_id = ?`, [ruleId])
  const current = useLensStore.getState().filterRules
  const filtered = current.filter((r) => r.rule_id !== ruleId)
  useLensStore.setState({ filterRules: filtered })
  return current.length !== filtered.length
}

/**
 * Avalia post contra todas active filter rules. Retorna o action da
 * primeira rule que matches, ou `null` se nenhuma.
 *
 * Conflict resolution Barney (Stage 3 §2.9): exclude vence default —
 * se múltiplas rules matcham, preferência por 'hide' > 'collapse' >
 * 'blur' > 'dim'.
 *
 * Use em render path do feed pra blur/hide/dim posts.
 */
export function evaluateFilterRules(params: {
  pprScore: number
  tags: ReadonlyArray<ReadonlyArray<string>>
  authorNpub?: string
}): FilterAction | null {
  const rules = useLensStore.getState().filterRules
  if (rules.length === 0) return null
  const priority: FilterAction[] = ['hide', 'collapse', 'blur', 'dim']
  let bestAction: FilterAction | null = null
  let bestIdx = priority.length
  for (const rule of rules) {
    if (!rule.active) continue
    if (!evaluatePredicate(rule.predicate, params)) continue
    const idx = priority.indexOf(rule.predicate.action)
    if (idx >= 0 && idx < bestIdx) {
      bestAction = rule.predicate.action
      bestIdx = idx
    }
  }
  return bestAction
}

// ─── Edge management ──────────────────────────────────────────────

/**
 * Upsert edge no `lens_edges`. Caller deve garantir que `source` é a
 * active identity. Manifesto §15 multi-identity: source SEMPRE = active.
 *
 * NaN-safe via `sanitizeComponents` (BUG-7 Marshall).
 */
export async function upsertLensEdge(
  source: string,
  target: string,
  rawComponents: Partial<LensEdgeComponentsV1> | null | undefined,
): Promise<void> {
  const components = sanitizeComponents(rawComponents)
  const influence = computeInfluence(components)
  const now = Date.now()
  await db.run(
    `INSERT INTO lens_edges (source_npub, target_npub, influence, components, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_npub, target_npub) DO UPDATE SET
       influence = excluded.influence,
       components = excluded.components,
       updated_at = excluded.updated_at`,
    [source, target, influence, JSON.stringify(components), now],
  )
}

// ─── PPR recompute (main-thread Phase 1; worker Phase 1.5 PR-4c) ──

/**
 * Recompute PPR scores pra um source npub. Lê adjacency de
 * `lens_edges`, roda Monte Carlo, escreve `lens_walks_cache`,
 * atualiza store.
 *
 * **Performance**: ~75ms mid-range phone com K=1000 L=6 (Ted v2).
 * Em Phase 1.5 (PR-4c) será movido pra worker thread pra não bloquear
 * UI durante render. Por ora, debounced + run apenas em triggers
 * específicos (follow change, 50 events, 24h TTL).
 *
 * **Cold-start safe**: source sem edges → empty Map persistido.
 * `getPprForAuthor` retorna 0 → feed inalterado (multiplier 1.0).
 *
 * Returns número de targets com PPR score > 0.
 */
export async function recomputeLens(source: string): Promise<number> {
  if (!source) return 0
  // Build adjacency list from lens_edges.
  // GAP-1 (2026-05-20): quando `lens_ppr_decay_enabled` true, aplica
  // decay temporal exponencial em `influence` baseado em
  // `updated_at` do edge. Walker recebe influência decaída; SQLite
  // (lens_edges.influence) permanece bit-exact — só o walk vê o ajuste.
  //
  // KNOWN LIMITATION (Satoshi audit pair review 2026-05-20):
  // `updated_at` é refresh-on-write (upsertEdge atualiza a cada
  // follow/spread/bury). Sybil ring que faz "edge refresh" (re-segue
  // ou re-drifta posts antigos) reseta updated_at → decay = 1.0 → vetor
  // de bypass. Defesa correta requer coluna `created_at` (immutable)
  // em lens_edges + decay baseado em max(age_since_created,
  // age_since_updated). Schema bump deferred pra Phase 2 quando
  // telemetria mostrar attack real. Backlog item registrado.
  const rows = await db.exec<{
    source_npub: string
    target_npub: string
    influence: number
    updated_at: number
  }>(
    `SELECT source_npub, target_npub, influence, updated_at FROM lens_edges
     WHERE source_npub = ? OR target_npub IN (
       SELECT target_npub FROM lens_edges WHERE source_npub = ?
     )`,
    [source, source],
  )
  const decayEnabled = usePrefsStore.getState().lens_ppr_decay_enabled
  const recomputeNow = Date.now()
  const graph: AdjacencyList = new Map()
  for (const row of rows) {
    const list = graph.get(row.source_npub) ?? []
    let influence = row.influence
    if (decayEnabled && row.updated_at > 0) {
      const ageMs = recomputeNow - row.updated_at
      influence *= temporalDecay(ageMs, PPR_DECAY.HALF_LIFE_MS)
    }
    list.push({ target: row.target_npub, influence })
    graph.set(row.source_npub, list)
  }

  const rng = createPprRng(source, Date.now())
  const ppr = computePpr({ source, graph, rng, ...PPR_PARAMS })

  // Persist em walks_cache (REPLACE pra source — LRU eviction Phase 1.5)
  await db.run(`DELETE FROM lens_walks_cache WHERE source_npub = ?`, [source])
  const now = Date.now()
  for (const [target, score] of ppr) {
    await db.run(
      `INSERT INTO lens_walks_cache (source_npub, target_npub, ppr_score, computed_at)
       VALUES (?, ?, ?, ?)`,
      [source, target, score, now],
    )
  }

  useLensStore.setState({ pprScores: new Map(ppr), lastRecomputedAt: now })
  return ppr.size
}

// ─── Debug helpers (exposed for tests) ────────────────────────────

export const __testing = {
  resetStore: () => {
    loadedOnce = false
    useLensStore.setState({ ...INITIAL, pprScores: new Map() })
  },
}
