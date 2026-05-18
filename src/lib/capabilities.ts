/**
 * Capabilities — capacidades derivadas do estado local (queries puras
 * SQLite + prefs locais). Source: RFC DAOP-001 Phase 1 PR2 (Ted HIMYM
 * analysis 2026-05-17).
 *
 * Filosofia (RFC §7 capability system): onboarding NÃO modela "telas/passos"
 * — modela CAPACIDADES adquiridas pelo user. Cada hint contextual (PR3)
 * é endereçado a capability gaps específicos, não a progresso linear.
 *
 * **Princípios:**
 *
 * 1. **Pure functions** (CLAUDE.md invariante #16): cada `hasXxx()`
 *    query é função pura sobre estado SQLite/prefs — testável sem
 *    mock React.
 * 2. **Re-derivable cross-device** (manifesto §3): capability state
 *    NÃO sincroniza via Nostr (vazaria comportamento §28). Re-deriva
 *    do replay de eventos quando user troca de device — `rebuildIdentityHistory`
 *    já cobre isso pra posts/spreads/follows.
 * 3. **Local only** (manifesto §28): zero kind Nostr, zero export.
 *    `capabilities_dismissed` bag em `user_prefs` é local-only por
 *    contrato.
 *
 * **API:**
 *   - `loadCapabilities(npub)` — computa snapshot atual (async)
 *   - `useCapabilitiesStore` — store Zustand reativa
 *   - `dismissRule(id)` — adiciona ao bag de regras dispensadas
 *   - `isRuleDismissed(id)` — query síncrona pro store
 *
 * **Phase 2 deferred:**
 *   - Behavioral signals (hesitação, abandono) — Satoshi flagou risk
 *     de §22/§28; só shipping local-only se ROI claro
 *   - Live invalidation on write (events.ts:onNostrEvent → invalida
 *     cache) — hoje é snapshot load + reload sob demanda
 */

import { create } from 'zustand'
import { db } from './db'

/** Capacidades atualmente conhecidas do user. */
export interface Capabilities {
  /** User já publicou ≥ 1 post (kind 9078). */
  hasFirstPost: boolean
  /** User já deu drift em ≥ 1 post (kind 9079). */
  hasFirstSpread: boolean
  /** User já segue ≥ 1 pessoa (kind 3 / NIP-02). */
  hasFollow: boolean
  /** User já fez backup do nsec (reveal/copy/download em IdentityPanel). */
  hasBackup: boolean
  /** IDs de regras de guidance que o user dispensou. */
  dismissedRuleIds: Set<string>
}

const INITIAL: CapabilitiesState = {
  caps: null,
  loaded: false,
}

interface CapabilitiesState {
  /** Snapshot atual ou null antes do primeiro load. */
  caps: Capabilities | null
  /** True depois do primeiro loadCapabilities concluir. */
  loaded: boolean
}

export const useCapabilitiesStore = create<CapabilitiesState>(() => INITIAL)

const DISMISSED_PREF_KEY = 'capabilities_dismissed'

/**
 * Parse do bag dismissed do SQLite. CSV de IDs separados por vírgula
 * (formato compacto, evita JSON overhead pra ~10 entries esperadas).
 * Whitespace tolerado.
 */
function parseDismissedBag(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
}

function serializeDismissedBag(ids: Set<string>): string {
  return [...ids].join(',')
}

/**
 * Computa capabilities snapshot. Chamado em bootstrap + após writes
 * (events.ts pode chamar pra invalidar cache, mas hoje só load-once
 * é suficiente — capabilities mudam devagar).
 *
 * Funções de query: pure sobre `db.exec`. Não usam Date.now() nem
 * dependem de estado React.
 *
 * `npub` é o pubkey hex do active identity. null = não passa as
 * queries de autoria (retorna false pra hasFirstPost/Spread/Follow).
 */
export async function loadCapabilities(npub: string | null): Promise<Capabilities> {
  const dismissedRow = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = ?`,
    [DISMISSED_PREF_KEY],
  )
  const dismissedRuleIds = parseDismissedBag(dismissedRow?.value)

  // Sem npub ativo: retorna capabilities mínimas (só dismissed bag).
  if (!npub) {
    const caps: Capabilities = {
      hasFirstPost: false,
      hasFirstSpread: false,
      hasFollow: false,
      hasBackup: false,
      dismissedRuleIds,
    }
    useCapabilitiesStore.setState({ caps, loaded: true })
    return caps
  }

  // hasBackup: derivado do `last_nsec_export_at` (shipped em [b76245b]).
  // Se já houve qualquer exposure (reveal/copy/download), considera
  // que user tem ciência do nsec — proxy razoável pra "backup feito".
  // User power que faz "reveal e olhou" sem persist tecnicamente NÃO
  // tem backup, mas:
  //  (a) impossível distinguir do log local
  //  (b) hint "faça backup" continua útil mesmo após reveal (caller
  //      pode usar appliesIf separado pra mostrar)
  // Tradeoff: aceitar falso positivo pequeno > nag eterno.
  const backupRow = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = 'last_nsec_export_at'`,
  )
  const hasBackup = !!backupRow?.value && Number(backupRow.value) > 0

  // Counts paralelos pra latência. Cada query é < 1ms com índices.
  const [postsRow, spreadsRow, followsRow] = await Promise.all([
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM posts WHERE author_pub = ?`,
      [npub],
    ),
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM spreads WHERE spreader_pub = ?`,
      [npub],
    ),
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM follows WHERE follower_pub = ?`,
      [npub],
    ),
  ])

  const caps: Capabilities = {
    hasFirstPost: (postsRow?.n ?? 0) > 0,
    hasFirstSpread: (spreadsRow?.n ?? 0) > 0,
    hasFollow: (followsRow?.n ?? 0) > 0,
    hasBackup,
    dismissedRuleIds,
  }

  useCapabilitiesStore.setState({ caps, loaded: true })
  return caps
}

/**
 * Marca uma regra como dispensada pelo user. Persiste em user_prefs +
 * atualiza store. Idempotente — re-dismiss da mesma rule é no-op.
 */
export async function dismissRule(ruleId: string): Promise<void> {
  const current = useCapabilitiesStore.getState().caps
  if (!current) return // não loaded ainda — silencioso
  if (current.dismissedRuleIds.has(ruleId)) return
  const nextDismissed = new Set(current.dismissedRuleIds)
  nextDismissed.add(ruleId)
  const nextCaps: Capabilities = { ...current, dismissedRuleIds: nextDismissed }
  useCapabilitiesStore.setState({ caps: nextCaps })
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DISMISSED_PREF_KEY, serializeDismissedBag(nextDismissed)],
  )
}

/**
 * Marca múltiplas regras dispensadas (uso: "pular todo onboarding").
 * Batch otimizado — 1 db.run em vez de N.
 */
export async function dismissRules(ruleIds: string[]): Promise<void> {
  const current = useCapabilitiesStore.getState().caps
  if (!current) return
  const nextDismissed = new Set(current.dismissedRuleIds)
  for (const id of ruleIds) nextDismissed.add(id)
  const nextCaps: Capabilities = { ...current, dismissedRuleIds: nextDismissed }
  useCapabilitiesStore.setState({ caps: nextCaps })
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DISMISSED_PREF_KEY, serializeDismissedBag(nextDismissed)],
  )
}

/**
 * Query síncrona — UI pode chamar diretamente sem useEffect/await.
 * Returns false se store não loaded (default seguro).
 */
export function isRuleDismissed(ruleId: string): boolean {
  const caps = useCapabilitiesStore.getState().caps
  if (!caps) return false
  return caps.dismissedRuleIds.has(ruleId)
}
