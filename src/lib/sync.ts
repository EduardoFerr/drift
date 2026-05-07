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
import { orchestrator } from './transport/orchestrator'
import type { Unsubscribe } from './transport'
import type { SignedEvent } from '../types/nostr'

const NAMESPACE = 'global'
/**
 * Janela inicial de sync pra primeiro boot (sync_log vazio).
 *
 * Antes era 24h, mas Barney peer review 29-04 identificou bug: ao criar
 * conta nova ou recriar app, sync_log volta vazio → since = now-24h →
 * posts mais antigos invisíveis. Bumpado pra 7 dias cobre 99% dos casos
 * de "novo device sem regredir banda em sessions subsequentes
 * (incremental sync continua via cursor real depois do primeiro boot).
 *
 * Trade-off: 7d ainda é limite artificial. Pra histórico maior, user
 * pode usar `rebuildIdentityHistory(npub)` (sem limite, mas só pega do
 * próprio author) ou Settings → "sync inicial: 30d/sem limite" (futuro).
 */
const INITIAL_WINDOW_SECONDS = 7 * 24 * 60 * 60 // 7d (Barney peer review 29-04)
const FLUSH_INTERVAL_MS = 30_000

/**
 * Limit aplicado na filter de subscribe (NIP-01) — relay retorna no
 * MÁXIMO esses N eventos stored mais recentes que match o filter.
 * Real-time pós-EOSE flui sem cap.
 *
 * 500 × 4 relays = teto teórico ~2000 events no boot inicial (deduped
 * cross-transport pelo orchestrator). Sem isso (estado anterior),
 * relays podem despejar tudo do range `since`-onwards num burst — em
 * rede ativa, milhares de events martelam o pipeline `verifyEvent +
 * INSERT + scheduleScoreRecalc` causando lag perceptível no boot.
 *
 * **Trade-off conhecido (Ted review 2026-05-07):** se densidade de
 * eventos numa janela `since`-now exceder 500, relay descarta os mais
 * antigos da janela — buraco no histórico local. Mitigado por:
 *  - `rebuildIdentityHistory(npub)` em `lib/sync.ts` cobre eventos do
 *    próprio user sem limit (full backfill)
 *  - SPREAD/BURY órfãos sobre posts não-vistos têm impacto local-only
 *    (manifesto §7 — score determinístico DADO o mesmo input set;
 *    score parcial sob input parcial é esperado, não quebra invariante)
 *
 * **TODO** (Fase futura): paginação real via filtros sucessivos com
 * `until` (NIP-01) pra resgatar histórico mais antigo sem martelar
 * o boot inicial. Reabrir quando densidade de eventos justificar.
 */
const SUBSCRIBE_LIMIT = 500

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

/**
 * Unsubscribe handle do `orchestrator.subscribe` (Fase 6.2-E).
 * Antes era `{ close: () => void }` do `pool.subscribeMany` direto;
 * agora é função simples retornada pelo orchestrator.
 */
let subscription: Unsubscribe | null = null
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

  // Fase 6.2-E: subscribe via orchestrator em vez de pool.subscribeMany
  // direto. Eventos podem chegar via WSS (atual) OU via WebRTC (peers
  // conectados). Dedup cross-transport via LRU dentro do orchestrator;
  // dedup adicional natural no SQLite via INSERT OR IGNORE em onNostrEvent.
  // Manifesto §12 (múltiplos transportes), invariante #1 (onNostrEvent
  // continua única porta de escrita pra tabelas de domínio).
  subscription = orchestrator.subscribe(
    {
      kinds: [
        DRIFT_KIND.POST,
        DRIFT_KIND.SPREAD,
        DRIFT_KIND.BURY,
        DRIFT_KIND.REPORT,
      ],
      since,
      // Cap de stored events por relay — ver doc-comment de
      // SUBSCRIBE_LIMIT acima. Boot inicial não martela pipeline.
      limit: SUBSCRIBE_LIMIT,
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
    // Subscription é função `Unsubscribe` do orchestrator — invoca direto.
    subscription()
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
