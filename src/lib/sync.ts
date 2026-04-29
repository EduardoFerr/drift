/**
 * Sincronização Nostr → SQLite.
 *
 * Mantém uma única subscription para os 4 kinds Drift em todos os
 * relays. Cada evento (incluindo os próprios eventos publicados pelo
 * cliente, devolvidos pelos relays) passa por onNostrEvent().
 *
 * Persiste cursor (`last_since`) periodicamente em `sync_log` para que
 * a próxima sessão sincronize incrementalmente.
 *
 * Para MVP usamos uma janela inicial de 24h para evitar puxar todo o
 * histórico de relays na primeira execução. Em produção, ajustar.
 *
 * Status reativo: SyncStatus vive numa store Zustand (`useSyncStore`).
 * Componentes consomem via hook e re-renderizam a cada mudança —
 * incrementos em `eventsReceived` aparecem na UI sem poll.
 */

import { create } from 'zustand'
import { pool, getTag } from './nostr'
import { onNostrEvent } from './events'
import { db } from './db'
import { DRIFT_KIND } from '../config/constants'
import { activeReadRelays } from './relays'
import type { SignedEvent } from '../types/nostr'

const NAMESPACE = 'global'
const INITIAL_WINDOW_SECONDS = 24 * 60 * 60 // 24h
const FLUSH_INTERVAL_MS = 30_000

/** Item do ring buffer de últimos eventos recebidos — usado pra
 *  diagnóstico (ver no DiagnosticPanel se um evento específico chegou
 *  ao cliente, debugar sync entre devices). Capacidade pequena pra
 *  não inflar memória. */
export interface RecentEvent {
  /** kind do evento Drift (9078..9081) ou 0 se não-Drift que passou pelo subscribe */
  kind: number
  /** timestamp local em ms quando recebido (não created_at do evento) */
  receivedAt: number
  /** event id (hex) — primeiros 8 chars exibidos */
  id: string
  /** referência ao postId — para POST é event.id; para SPREAD/BURY/REPORT é a tag `e`. */
  ref: string | null
}

export const RECENT_EVENTS_CAP = 20

export interface SyncStatus {
  active: boolean
  /** Cursor mais recente conhecido (unix seconds) */
  cursor: number
  eventsReceived: number
  /** Rebuilds de identidade em andamento (autores) */
  rebuildsInProgress: string[]
  /** Últimos N eventos recebidos pelo subscribe — diagnóstico. */
  recent: RecentEvent[]
}

const INITIAL_STATUS: SyncStatus = {
  active: false,
  cursor: 0,
  eventsReceived: 0,
  rebuildsInProgress: [],
  recent: [],
}

// ─── Store Zustand ────────────────────────────────────────────────────

/**
 * Hook React. Use `const sync = useSyncStore()` para todo o estado, ou
 * `const events = useSyncStore(s => s.eventsReceived)` para selector.
 */
export const useSyncStore = create<SyncStatus>(() => INITIAL_STATUS)

// API legada — getSyncStatus continua existindo para chamadas síncronas
// fora de React (debug, logs).
export const getSyncStatus = useSyncStore.getState

function setStatus(updater: (s: SyncStatus) => SyncStatus): void {
  useSyncStore.setState(updater)
}

// ─── Subscription global ──────────────────────────────────────────────

let subscription: { close: () => void } | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null

export async function startSync(): Promise<SyncStatus> {
  if (subscription) {
    return getSyncStatus()
  }

  const row = await db.get<{ since: number | null }>(
    `SELECT MAX(last_since) AS since FROM sync_log WHERE namespace = ?`,
    [NAMESPACE],
  )
  const savedCursor = row?.since ?? 0
  const fallback = Math.floor(Date.now() / 1000) - INITIAL_WINDOW_SECONDS
  const since = Math.max(savedCursor, fallback)

  setStatus((s) => ({ ...s, active: true, cursor: since }))

  subscription = pool.subscribeMany(
    activeReadRelays(),
    {
      kinds: [
        DRIFT_KIND.POST,
        DRIFT_KIND.SPREAD,
        DRIFT_KIND.BURY,
        DRIFT_KIND.REPORT,
      ],
      since,
    },
    {
      onevent: async (event: SignedEvent) => {
        setStatus((s) => ({
          ...s,
          eventsReceived: s.eventsReceived + 1,
          cursor: Math.max(s.cursor, event.created_at),
          recent: pushRecent(s.recent, event),
        }))
        try {
          await onNostrEvent(event)
        } catch (err) {
          console.error('[sync] onNostrEvent failed:', err)
        }
      },
      oneose: () => {
        // EOSE = end of stored events. Daqui em diante é tempo real.
      },
    },
  )

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushCursor().catch((err) => console.error('[sync] flush failed:', err))
    }, FLUSH_INTERVAL_MS)
  }

  return getSyncStatus()
}

export async function stopSync(): Promise<void> {
  if (subscription) {
    subscription.close()
    subscription = null
  }
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  setStatus((s) => ({ ...s, active: false }))
  await flushCursor()
}

/**
 * Para e recomeça o subscribe. Útil quando o user suspeita que o
 * subscription morreu sem reconectar (raro mas acontece em conexões
 * móveis instáveis). Manifesto §11 (rede como meio): subscribe é
 * recurso descartável, recriar não tem custo lógico.
 *
 * Limpa também `recent` pra zerar o painel de diagnóstico — útil
 * quando user quer ver "do zero" se eventos novos estão chegando.
 */
export async function restartSync(): Promise<void> {
  await stopSync()
  setStatus((s) => ({ ...s, recent: [] }))
  await startSync()
}

/** Adiciona evento ao ring buffer de recentes. Mais novo no topo, capacidade fixa.
 *
 *  POST: ref = event.id (próprio post). SPREAD/BURY/REPORT: ref = tag `e`
 *  (postId referenciado). Sem `d` tag — kind 9078 é regular event (NIP-01). */
export function pushRecent(prev: RecentEvent[], event: SignedEvent): RecentEvent[] {
  const ref =
    event.kind === DRIFT_KIND.POST ? event.id : getTag(event, 'e')
  const entry: RecentEvent = {
    kind: event.kind,
    receivedAt: Date.now(),
    id: event.id,
    ref,
  }
  return [entry, ...prev].slice(0, RECENT_EVENTS_CAP)
}

async function flushCursor(): Promise<void> {
  const cursor = getSyncStatus().cursor
  if (cursor <= 0) return
  await db.run(
    `INSERT INTO sync_log (relay, namespace, last_since) VALUES (?, ?, ?)
     ON CONFLICT(relay, namespace) DO UPDATE SET last_since = MAX(last_since, excluded.last_since)`,
    ['*', NAMESPACE, cursor],
  )
}

// ─── Rebuild de identidade ───────────────────────────────────────────

/**
 * Puxa TODO o histórico Drift publicado pelo author especificado,
 * sem janela de tempo. Usado depois de importar uma identidade —
 * rehidrata o estado local a partir da rede.
 *
 * Idempotente: chamadas repetidas para o mesmo npub fazem nada se já
 * houver rebuild em andamento.
 *
 * Fire-and-forget: chamador não precisa await. Status disponível em
 * `useSyncStore(s => s.rebuildsInProgress)` (reativo).
 */
export async function rebuildIdentityHistory(npub: string): Promise<void> {
  const current = getSyncStatus().rebuildsInProgress
  if (current.includes(npub)) return

  setStatus((s) => ({
    ...s,
    rebuildsInProgress: [...s.rebuildsInProgress, npub],
  }))

  console.log('[sync] iniciando rebuild de histórico para', npub.slice(0, 16) + '…')
  const startedAt = performance.now()
  let received = 0
  let eoseCount = 0

  return new Promise<void>((resolve) => {
    let sub: { close: () => void } | null = null

    const finish = () => {
      if (sub) {
        try {
          sub.close()
        } catch {
          /* noop */
        }
        sub = null
      }
      setStatus((s) => ({
        ...s,
        rebuildsInProgress: s.rebuildsInProgress.filter((n) => n !== npub),
      }))
      const elapsed = Math.round(performance.now() - startedAt)
      console.log(
        `[sync] rebuild concluído para ${npub.slice(0, 16)}… · ${received} eventos · ${elapsed}ms`,
      )
      resolve()
    }

    const relays = activeReadRelays()
    sub = pool.subscribeMany(
      relays,
      {
        kinds: [
          DRIFT_KIND.POST,
          DRIFT_KIND.SPREAD,
          DRIFT_KIND.BURY,
          DRIFT_KIND.REPORT,
        ],
        authors: [npub],
      },
      {
        onevent: async (event: SignedEvent) => {
          received++
          setStatus((s) => ({
            ...s,
            eventsReceived: s.eventsReceived + 1,
            cursor: Math.max(s.cursor, event.created_at),
            recent: pushRecent(s.recent, event),
          }))
          try {
            await onNostrEvent(event)
          } catch (err) {
            console.error('[sync] onNostrEvent (rebuild) failed:', err)
          }
        },
        oneose: () => {
          eoseCount++
          if (eoseCount >= relays.length) finish()
        },
      },
    )

    setTimeout(() => {
      if (getSyncStatus().rebuildsInProgress.includes(npub)) {
        console.warn('[sync] rebuild timeout — fechando após 30s')
        finish()
      }
    }, 30_000)
  })
}
