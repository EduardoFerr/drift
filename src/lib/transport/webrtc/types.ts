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
  /** Contador monotônico de eventos de kind fora de DRIFT_KIND_SET —
   *  Fase 6.2-C. Mantido pra telemetria / peerScore / peerRegistry (que
   *  consomem como sinal histórico). NÃO usado mais pra decisão de
   *  kill — substituído por `crossProtoViolations[]` com janela
   *  deslizante (Threat audit T1, 2026-05-08). */
  crossProtoCount?: number
  /** fix: T1 cross-proto window (Threat audit) — timestamps recentes
   *  (ms) de violação cross-proto, capped em CROSS_PROTO_VIOLATION_CAP.
   *  Análogo a `rateViolations[]`: violações fora de
   *  CROSS_PROTO_VIOLATION_WINDOW_MS são pruned, threshold é
   *  CROSS_PROTO_VIOLATION_THRESHOLD em janela. Antes do fix, atacante
   *  paciente acumulava 49 violações ao longo de meses e nunca era
   *  killed; agora violações antigas decaem. */
  crossProtoViolations: number[]
  /** fix: T2 ping/pong 1:1 (Threat audit) — timestamps de pings enviados
   *  esperando pong. Pong só é aceito se `pingTs ∈ pendingPings`; após
   *  aceito, removido. Pings mais antigos que 2× HEALTH_PING_INTERVAL_MS
   *  são pruned em cada `_markPing` pra evitar leak.
   *  Antes do fix: atacante mandava pong com timestamp plausível e fingia
   *  RTT≈0 (peer parecia superhealthy → nunca degraded). */
  pendingPings: number[]
  /** fix: B1 — handle do setTimeout do grace period de 5s pós
   *  `disconnected`. Cancelado em transições out-of-disconnected
   *  (connected, failed, closed) e em `cleanupPeer` pra evitar
   *  empilhar timers em redes flakey (Wi-Fi handover). Ver
   *  Docs/sessions/webrtc-architecture-audit-2026-05-08.md §B1. */
  disconnectGraceTimer?: ReturnType<typeof setTimeout> | null
  /** fix: B3 — handle do setTimeout do ICE connect timeout (30s).
   *  Cancelado em `cleanupPeer` pra liberar a referência ao PeerState
   *  antigo (RTCPeerConnection já fechada + outboundQueue) antes do
   *  GC natural ao fim dos 30s. Ver
   *  Docs/sessions/webrtc-architecture-audit-2026-05-08.md §B3. */
  iceConnectTimer?: ReturnType<typeof setTimeout> | null
}

export interface SubscriptionRecord {
  id: string
  filter: Filter
  handlers: SubscribeHandlers
  /** Dedup local FIFO capped a 1000. */
  seenIds: Set<string>
}
