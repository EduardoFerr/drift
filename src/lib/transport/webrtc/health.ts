/**
 * webrtc/health — ping/pong + RTT + degraded detection.
 *
 * Funções puras (`_markPing`, `_handlePong`, `_isPeerDegraded`) testáveis
 * isoladamente. Timer module-scoped (`healthTimer`) pra interval; ciclo
 * de vida coordenado com `webrtc/boot.ts:closeAll` via `stopHealthCheckTimer`.
 *
 * Pong com timestamp futuro ou stale (>5min) é descartado. Pong sem
 * ping correspondente é descartado (Barney R1: atacante manda pong fake
 * pra fingir saudável e atrasar transição pra degraded).
 */

import {
  HEALTH_LATENCY_DEGRADED_MS,
  HEALTH_PING_INTERVAL_MS,
  HEALTH_PONG_MAX_AGE_MS,
  HEALTH_STALE_MS,
  PING_PREFIX,
} from './config'
import { iterPeers } from './state'
import type { PeerState } from './types'

let healthTimer: ReturnType<typeof setInterval> | null = null

/** Test-only: registra que enviamos ping.
 *  Re-exportado em `webrtc/index.ts` como `_markPing`. */
export function _markPing(peer: PeerState, now: number): void {
  peer.lastPingSentAt = now
}

/** Test-only: processa pong recebido, atualiza RTT.
 *  Re-exportado em `webrtc/index.ts` como `_handlePong`. */
export function _handlePong(peer: PeerState, pingTs: number, now: number): void {
  // Drop pong stale (>5min) — defesa contra replay
  if (now - pingTs > HEALTH_PONG_MAX_AGE_MS) return
  if (pingTs > now) return // pong com timestamp futuro — drop
  // Barney R1: drop pong sem ping correspondente (atacante manda pong
  // fake pra fingir saudável e atrasar transição pra degraded). Tolera
  // 1s de skew pra lidar com pings em flight quando lastPingSentAt
  // acabou de ser atualizado.
  if (peer.lastPingSentAt === null || pingTs < peer.lastPingSentAt - 1000) return
  peer.lastPingMs = now - pingTs
  peer.lastPongAt = now
}

/** Test-only: peer está degraded? (sem ping recente OU latência alta)
 *  Re-exportado em `webrtc/index.ts` como `_isPeerDegraded`. */
export function _isPeerDegraded(peer: PeerState, now: number): boolean {
  // Latência alta
  if (peer.lastPingMs !== null && peer.lastPingMs > HEALTH_LATENCY_DEGRADED_MS) {
    return true
  }
  // Sem ping enviado há 30s+ (timer parou ou peer não responde)
  if (peer.lastPingSentAt !== null && now - peer.lastPingSentAt > HEALTH_STALE_MS) {
    return true
  }
  return false
}

export function startHealthCheckTimer(): void {
  if (healthTimer) return
  healthTimer = setInterval(() => {
    const now = Date.now()
    for (const peer of iterPeers()) {
      if (peer.status !== 'open' || !peer.dc || peer.dc.readyState !== 'open') continue
      try {
        peer.dc.send(`${PING_PREFIX}${now}`)
        _markPing(peer, now)
      } catch {
        /* dc pode ter fechado — ignora */
      }
    }
  }, HEALTH_PING_INTERVAL_MS)
}

export function stopHealthCheckTimer(): void {
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}
