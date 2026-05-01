/**
 * webrtc/types — interfaces e types compartilhados pelos sub-módulos.
 *
 * `PeerState` é load-bearing: tests acessam `id`, `status`, `lastPingMs`,
 * `lastPingSentAt`, `crossProtoCount`, `rateBudget`, `rateViolations`
 * diretamente. Não dividir em sub-shapes (`PeerHealth`/`PeerRateState`
 * etc.) — quebraria 4 specs Vitest.
 *
 * Re-exportado em `webrtc/index.ts` pra preservar imports do tipo
 * `import type { PeerStatus } from '../webrtc'` em callers externos.
 */

import type { Filter, SubscribeHandlers } from '../index'

export type PeerStatus =
  | 'connecting'
  | 'open'
  | 'degraded'
  | 'closing'
  | 'closed'
  | 'failed'

export interface PeerState {
  id: string
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  status: PeerStatus
  createdAt: number
  /** RTT do último ping/pong em ms. `null` se nunca pingou (Fase 6.3-C). */
  lastPingMs: number | null
  /** Timestamp ms do último ping enviado. Usado pra detectar peer stale. */
  lastPingSentAt: number | null
  /** Timestamp ms do último pong recebido. Usado pra detectar peer stale. */
  lastPongAt: number | null
  /** Buffer pra publishes antes de dc.readyState === 'open'.
   *  Em transição → failed/closed, RESETAR pra evitar leak (Barney #4). */
  outboundQueue: string[]
  /** Token bucket — Barney audit #3 (rate limit anti-DoS).
   *  Refill RATE_REFILL_PER_SEC tokens/seg, cap em RATE_BURST. */
  rateBudget: number
  lastRefillTs: number
  /** Timestamps recentes (ms) de violação de rate limit, capped em
   *  RATE_VIOLATION_CAP. 3 violações em RATE_VIOLATION_WINDOW_MS → kill. */
  rateViolations: number[]
  /** Contador de eventos de kind fora de DRIFT_KIND_SET — Fase 6.2-C
   *  cross-protocol injection threshold. Após CROSS_PROTO_THRESHOLD,
   *  peer é killed e (futuramente) blacklisted via peerRegistry. */
  crossProtoCount?: number
}

export interface SubscriptionRecord {
  id: string
  filter: Filter
  handlers: SubscribeHandlers
  /** Dedup local FIFO capped a 1000. */
  seenIds: Set<string>
}
