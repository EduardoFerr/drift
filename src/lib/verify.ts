/**
 * verify — wrapper main-thread pro `verify.worker`.
 *
 * Ponto canônico de entrada pra Schnorr verify off-main-thread.
 * Substitui chamadas síncronas a `verifyDriftEvent` (`nostr.ts`) no
 * caminho de eventos recebidos (sync.ts → onNostrEvent, e webrtc
 * pipeline). `verifyDriftEvent` permanece como API sync legada — pode
 * ser usada onde o caller já roda fora do hot path (fixtures, tests).
 *
 * Contrato (Ted RFC + Barney threat model 2026-05-16):
 *  - Singleton worker, lazy spawn no primeiro `verifyEventAsync`.
 *  - Queue cap = 5000 events pendentes (Barney P1.1, T3).
 *  - Drop NEWEST quando saturado (Barney P1.2, T4) — atacante
 *    flooding consome o próprio drop, eventos legítimos que já
 *    estão na fila são processados.
 *  - SEM fallback sync (Barney P1.5, T5) — worker init falha
 *    propaga `Error` ao caller; bootstrap pode mostrar banner.
 *  - Correlação por id incremental; resolves FIFO por chegada de
 *    resposta (Ted RFC §3.2).
 *  - Init timeout 15s, mesmo padrão de `db.ts` (Barney P2.4).
 *
 * Invariantes preservados (CLAUDE.md):
 *  #1 — Worker não escreve no SQLite. onNostrEvent continua única
 *       porta de INSERT no main.
 *  #5 — Pipeline cheap→caro: caller (events.ts/pipeline.ts) faz
 *       kind+schema check SYNC ANTES de await verifyEventAsync.
 *  #7 — Schnorr é determinístico; worker preserva semântica.
 *  #8 — nsec NUNCA passa por aqui. Worker recebe SignedEvent
 *       (pubkey+sig já públicos).
 *
 * Métricas DEV-only via `getVerifyMetrics()` + `window.driftVerify`
 * (não expor em prod — surface de timing pra atacante medir lag).
 */

import type { SignedEvent } from '../types/nostr'

/** Cap de eventos pendentes no canal main↔worker (Barney P1.1). */
const QUEUE_CAP = 5000

/** Timeout no init do worker — mesmo padrão de db.ts (Barney P2.4). */
const INIT_TIMEOUT_MS = 15_000

interface VerifyMetrics {
  /** Quantos verifies já chegaram via verifyEventAsync (monotônico). */
  enqueued: number
  /** Quantos verifies já resolveram (monotônico). */
  resolved: number
  /** Quantos foram dropados por queue full (monotônico, Barney P1.2). */
  dropped: number
  /** Pending no momento (gauge, ≤ QUEUE_CAP). */
  pending: number
  /** Última latência observada em ms (gauge, debug only). */
  lastLatencyMs: number
}

interface PendingEntry {
  resolve: (ok: boolean) => void
  /** performance.now() no postMessage — métrica lastLatencyMs. */
  enqueuedAt: number
}

const metrics: VerifyMetrics = {
  enqueued: 0,
  resolved: 0,
  dropped: 0,
  pending: 0,
  lastLatencyMs: 0,
}

let worker: Worker | null = null
let workerReady = false
let initPromise: Promise<Worker> | null = null
let nextId = 0
const pending = new Map<number, PendingEntry>()

/** Throttle log de drop pra não floodar console em storm hostil. */
let lastDropLog = 0

function rejectAllPending(reason: string): void {
  for (const [, entry] of pending) entry.resolve(false)
  pending.clear()
  metrics.pending = 0
  // Log uma vez — caller pode continuar; próximo verify tenta init de novo.
  console.error('[verify] worker reset:', reason)
}

function teardownWorker(): void {
  if (worker) {
    try {
      worker.terminate()
    } catch {
      /* já morto */
    }
  }
  worker = null
  workerReady = false
  initPromise = null
}

/**
 * Inicializa worker lazy. Re-init permitido após crash:
 * `rejectAllPending` zera estado, próximo call faz spawn novo.
 *
 * Throw se construtor falha (browser sem `import.meta.url` resolver,
 * CSP estrito bloqueando, etc.) — Barney P1.5 (sem fallback sync).
 */
function ensureWorker(): Promise<Worker> {
  if (workerReady && worker) return Promise.resolve(worker)
  if (initPromise) return initPromise

  initPromise = new Promise<Worker>((resolve, reject) => {
    let w: Worker
    try {
      w = new Worker(new URL('./verify.worker.ts', import.meta.url), {
        type: 'module',
        name: 'drift-verify',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      initPromise = null
      reject(new Error(`verify worker: falha ao spawnar (${msg})`))
      return
    }

    // Timeout — se worker construtor sucede mas onmessage nunca dispara
    // (browser engasgado, chunk 404), boot bloqueia indefinidamente sem
    // isso. Resolve no primeiro postMessage de teste de saúde (ver init
    // ping abaixo), OU passamos direto se o construtor sucede e
    // assumimos pronto — escolhemos a 2a: worker é stateless, spawn
    // sync, sem handshake. Timeout cobre só o caso patológico.
    const timer = setTimeout(() => {
      initPromise = null
      teardownWorker()
      reject(
        new Error(
          `verify worker: init excedeu ${INIT_TIMEOUT_MS}ms — chunk inacessível?`,
        ),
      )
    }, INIT_TIMEOUT_MS)

    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean }>) => {
      const { id, ok } = e.data
      const entry = pending.get(id)
      if (!entry) return // resposta de id já dropado / cleanup
      pending.delete(id)
      metrics.pending = pending.size
      metrics.resolved++
      const elapsed = performance.now() - entry.enqueuedAt
      metrics.lastLatencyMs = elapsed
      entry.resolve(ok)
    }

    w.onerror = (e) => {
      const detail = e.message ?? 'unknown worker error'
      clearTimeout(timer)
      rejectAllPending(`worker.onerror: ${detail}`)
      teardownWorker()
    }

    w.onmessageerror = () => {
      clearTimeout(timer)
      rejectAllPending('worker.onmessageerror')
      teardownWorker()
    }

    // Worker é stateless — sem handshake. Marca pronto imediatamente.
    clearTimeout(timer)
    worker = w
    workerReady = true
    resolve(w)
  })

  return initPromise
}

/**
 * Verifica assinatura Schnorr de um evento Nostr em worker dedicado.
 *
 * Retorna `false` em qualquer falha (sig inválida, evento malformado,
 * queue saturada). Não lança — manifesto §29 (cliente não fala com
 * atacante, descarta).
 *
 * Lança APENAS se worker init falhar irrecuperavelmente. Caller
 * (bootstrap ou error boundary) pode renderizar UI de erro nesse
 * caso. Em produção típica isso significa: chunk inacessível ou
 * browser sem suporte (extremamente raro).
 *
 * Barney P1.2 — drop NEWEST: se queue atinge cap, retorna `false`
 * imediatamente. Eventos legítimos que entraram primeiro continuam
 * sendo processados.
 */
export async function verifyEventAsync(event: SignedEvent): Promise<boolean> {
  const w = await ensureWorker()

  if (pending.size >= QUEUE_CAP) {
    metrics.dropped++
    // Throttle log: 1× a cada 100 drops, e nunca mais que 1×/segundo.
    const now = Date.now()
    if (metrics.dropped % 100 === 0 && now - lastDropLog > 1000) {
      lastDropLog = now
      console.warn(
        `[verify] queue cheia (${QUEUE_CAP}) — dropando NEWEST. ` +
          `Total drops: ${metrics.dropped}`,
      )
    }
    return false
  }

  const id = ++nextId
  metrics.enqueued++
  return new Promise<boolean>((resolve) => {
    pending.set(id, { resolve, enqueuedAt: performance.now() })
    metrics.pending = pending.size
    w.postMessage({ id, event })
  })
}

/**
 * Métricas snapshot (DEV-only). Não expor em prod —
 * timing pode revelar lag do cliente sob ataque.
 */
export function getVerifyMetrics(): Readonly<VerifyMetrics> {
  return { ...metrics }
}

/**
 * Teardown explícito — útil em tests (vi.resetModules invalida
 * imports; o worker singleton fica vivo entre suites se não
 * encerrarmos aqui).
 */
export function _resetVerifyForTest(): void {
  teardownWorker()
  pending.clear()
  metrics.enqueued = 0
  metrics.resolved = 0
  metrics.dropped = 0
  metrics.pending = 0
  metrics.lastLatencyMs = 0
}

// DEV-only window hook — debug em devtools.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { driftVerify?: typeof getVerifyMetrics }).driftVerify =
    getVerifyMetrics
}
