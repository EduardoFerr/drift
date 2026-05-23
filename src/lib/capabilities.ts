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
 *
 * Satoshi #2 (2026-05-19): validação de shape — IDs devem ser apenas
 * a-z + dígitos + hífen (slug format). Items malformados são
 * silenciosamente ignorados (não quebra parsing). Defesa contra:
 *  - Adversário escrevendo CSV envenenado direto no SQLite
 *  - Bug futuro que insira whitespace/chars especiais no bag
 *  - Rule IDs com vírgula no future (atualmente nenhuma tem)
 */
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i

function parseDismissedBag(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && RULE_ID_PATTERN.test(s)),
  )
}

function serializeDismissedBag(ids: Set<string>): string {
  // Defensivo: filtra na escrita também — se algum caller passar ID
  // malformado, não escreve no SQLite (evita corromper o bag).
  return [...ids].filter((id) => RULE_ID_PATTERN.test(id)).join(',')
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
 * Persistência defensiva do dismissed bag — funciona mesmo quando caps
 * ainda não loaded (race no boot). Satoshi #3 (2026-05-19):
 * dismissRules/dismissRule retornavam silentemente quando caps=null,
 * causando perda do dismiss em race conditions (ex.: user clica "Pular"
 * no onboarding antes de loadCapabilities resolver).
 *
 * Fix: lê o bag atual diretamente do SQLite quando store não loaded,
 * faz merge + escrita. Store é atualizado depois SE estiver loaded.
 * Próximo loadCapabilities pega o bag atualizado mesmo se store stale.
 */
async function persistDismissedIds(newIds: string[]): Promise<void> {
  // Filtra IDs inválidos antecipadamente — Satoshi #2 defesa.
  const validIds = newIds.filter((id) => RULE_ID_PATTERN.test(id))
  if (validIds.length === 0) return

  // Read current bag from SOURCE OF TRUTH (SQLite), não confia no store.
  // Em race, store pode estar null OR estar atrás do SQLite.
  const row = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = ?`,
    [DISMISSED_PREF_KEY],
  )
  const existing = parseDismissedBag(row?.value)
  for (const id of validIds) existing.add(id)

  // Escreve merged bag.
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DISMISSED_PREF_KEY, serializeDismissedBag(existing)],
  )

  // Atualiza store SE loaded (best-effort — race tolerado).
  const current = useCapabilitiesStore.getState().caps
  if (current) {
    useCapabilitiesStore.setState({
      caps: { ...current, dismissedRuleIds: existing },
    })
  }
}

// ─── D16 dismissRule rate-limit debounce (Sprint N+3 Batch A) ─────────
//
// Source: D16 hardening 2026-05-21 — `dismissRule` (e `dismissRules`)
// faziam db.get + db.run a cada invocação. Em caso de flood (XSS
// payload chamando dismissRule em loop, ou bug de UI re-disparando o
// handler), cada call hit o SQLite. Idempotência protegia o dataset,
// mas o I/O era desperdiçado e podia degradar.
//
// Fix: debounce trailing-edge 250ms. Múltiplas calls coalescem em 1
// flush — buffer acumula ruleIds, primeira call agenda timer, calls
// subsequentes só fazem buffer.add. Timer expira → flush único.
//
// Idempotência preservada (Set dedup), API pública inalterada
// (Promise<void>), comportamento single-call indistinguível (apenas
// +250ms de latência).
const DISMISS_DEBOUNCE_MS = 250

interface PendingFlush {
  /** Buffer dedup-ed de ruleIds aguardando flush. */
  ids: Set<string>
  /** Timer handle pra cancelar/agendar. */
  timer: ReturnType<typeof setTimeout> | null
  /** Promise resolvida quando o flush terminar (compartilhada por callers). */
  promise: Promise<void> | null
  /** Resolver da promise compartilhada. */
  resolve: (() => void) | null
  /** Rejector da promise compartilhada (propaga erro de persist). */
  reject: ((err: unknown) => void) | null
}

const pending: PendingFlush = {
  ids: new Set(),
  timer: null,
  promise: null,
  resolve: null,
  reject: null,
}

function scheduleDismissFlush(ruleIds: readonly string[]): Promise<void> {
  for (const id of ruleIds) pending.ids.add(id)

  if (!pending.promise) {
    pending.promise = new Promise<void>((resolve, reject) => {
      pending.resolve = resolve
      pending.reject = reject
    })
  }

  if (pending.timer) clearTimeout(pending.timer)
  pending.timer = setTimeout(() => {
    void flushPendingDismisses()
  }, DISMISS_DEBOUNCE_MS)

  return pending.promise
}

async function flushPendingDismisses(): Promise<void> {
  const ids = Array.from(pending.ids)
  const resolve = pending.resolve
  const reject = pending.reject
  // Limpa estado ANTES de await — calls que chegam durante o flush
  // iniciam um novo ciclo (não merge com o ciclo que está saindo).
  pending.ids = new Set()
  pending.timer = null
  pending.promise = null
  pending.resolve = null
  pending.reject = null

  try {
    await persistDismissedIds(ids)
    resolve?.()
  } catch (err) {
    reject?.(err)
  }
}

/**
 * @internal — flush imediato pra testes. Limpa timer pendente e
 * dispara persistência sincronamente (no que diz respeito ao timer).
 * Não exportar pra produção.
 */
export async function __flushDismissForTests(): Promise<void> {
  if (pending.timer) {
    clearTimeout(pending.timer)
    pending.timer = null
  }
  if (pending.ids.size > 0 || pending.promise) {
    await flushPendingDismisses()
  }
}

/**
 * Marca uma regra como dispensada pelo user. Persiste em user_prefs +
 * atualiza store. Idempotente — re-dismiss da mesma rule é no-op.
 *
 * Resiliente a race (Satoshi #3): funciona mesmo se caps ainda não
 * loaded — lê bag direto do SQLite, faz merge, escreve.
 *
 * D16 (Sprint N+3): debounced 250ms trailing-edge. Floods de chamadas
 * coalescem em 1 db.get+db.run. Promise resolve após o flush
 * efetivamente persistir.
 */
export async function dismissRule(ruleId: string): Promise<void> {
  return scheduleDismissFlush([ruleId])
}

/**
 * Marca múltiplas regras dispensadas (uso: "pular todo onboarding").
 * Batch otimizado — 1 db.run em vez de N.
 *
 * Resiliente a race (Satoshi #3): funciona mesmo se caps ainda não
 * loaded — lê bag direto do SQLite, faz merge, escreve.
 *
 * D16 (Sprint N+3): debounced 250ms trailing-edge — mesmo buffer de
 * `dismissRule`. Chamadas misturadas (dismissRule + dismissRules)
 * coalescem em 1 flush.
 */
export async function dismissRules(ruleIds: string[]): Promise<void> {
  return scheduleDismissFlush(ruleIds)
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
