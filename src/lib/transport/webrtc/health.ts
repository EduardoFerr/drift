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

/** Janela máxima de pings pendentes (2× interval). Pings mais antigos
 *  são pruned em cada `_markPing`. Threat audit T2. */
const PENDING_PINGS_MAX_AGE_MS = HEALTH_PING_INTERVAL_MS * 2
/** Cap defensivo no array — evita atacante enviar pings forjados pra
 *  inflar memória (não temos write side externo, mas defesa em
 *  profundidade). */
const PENDING_PINGS_CAP = 16

/** Test-only: registra que enviamos ping.
 *  fix: T2 ping/pong 1:1 (Threat audit) — adiciona timestamp em
 *  `pendingPings[]` pra futura validação no pong. Prune pings >2×
 *  interval pra evitar leak.
 *  Re-exportado em `webrtc/index.ts` como `_markPing`. */
export function _markPing(peer: PeerState, now: number): void {
  peer.lastPingSentAt = now
  // Garante array existe (PeerStates legacy podem não ter).
  if (!Array.isArray(peer.pendingPings)) peer.pendingPings = []
  peer.pendingPings.push(now)
  // Prune pings antigos.
  const cutoff = now - PENDING_PINGS_MAX_AGE_MS
  while (peer.pendingPings.length && peer.pendingPings[0]! < cutoff) {
    peer.pendingPings.shift()
  }
  // Cap defensivo (mais novos sobrevivem).
  if (peer.pendingPings.length > PENDING_PINGS_CAP) {
    peer.pendingPings.splice(0, peer.pendingPings.length - PENDING_PINGS_CAP)
  }
}

/** Test-only: processa pong recebido, atualiza RTT.
 *  Re-exportado em `webrtc/index.ts` como `_handlePong`. */
export function _handlePong(peer: PeerState, pingTs: number, now: number): void {
  // Drop pong stale (>5min) — defesa contra replay
  if (now - pingTs > HEALTH_PONG_MAX_AGE_MS) return
  if (pingTs > now) return // pong com timestamp futuro — drop
  // fix: T2 ping/pong 1:1 (Threat audit) — pong só é aceito se
  // corresponde a um ping efetivamente enviado por nós. Antes do fix,
  // qualquer pong com TS plausível era aceito; atacante mandava pong
  // forjado com `pingTs ≈ now` e fingia RTT≈0 (peer parecia
  // superhealthy → nunca degraded → nunca reconectado).
  if (!Array.isArray(peer.pendingPings) || peer.pendingPings.length === 0) {
    return
  }
  const idx = peer.pendingPings.indexOf(pingTs)
  if (idx === -1) return
  // Consome o ping (1:1) — pongs duplicados subsequentes serão dropados.
  peer.pendingPings.splice(idx, 1)
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
