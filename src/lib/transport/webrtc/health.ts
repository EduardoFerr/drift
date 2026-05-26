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
import { iterPeers, peerCount } from './state'
import type { PeerState } from './types'
import { markPing, validatePong } from '../policy/pingPongTracker'
import { clampPeerTimestamp } from '../policy/clockClamp'

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
  // S2 refactor (Ted/Barney audit 2026-05-08): delega push/prune/cap pra util
  // pura compartilhada `transport/policy/pingPongTracker`.
  markPing(peer.pendingPings, now, {
    capStale: PENDING_PINGS_CAP,
    staleMs: PENDING_PINGS_MAX_AGE_MS,
  })
}

/** Test-only: processa pong recebido, atualiza RTT.
 *  Re-exportado em `webrtc/index.ts` como `_handlePong`. */
export function _handlePong(peer: PeerState, pingTs: number, now: number): void {
  // fix: T3 Date.now() unprotected (Threat audit). pingTs vem do peer
  // (echoed back do nosso ping) — input não-confiável. Clampamos contra
  // janela ±N do relógio local antes de qualquer trabalho. Substitui os
  // checks inline (`pingTs > now`, `now - pingTs > HEALTH_PONG_MAX_AGE_MS`)
  // por util compartilhada `transport/policy/clockClamp`. Defense-in-depth:
  // T2 (validatePong abaixo) já rejeita pings forjados via membership 1:1,
  // mas o clamp protege se tracker for desabilitado/contornado.
  // - maxFutureSkewMs=0: pong com pingTs > now é fisicamente impossível
  //   (não enviamos ping no futuro). Tolerância zero.
  // - maxPastSkewMs=HEALTH_PONG_MAX_AGE_MS: replay window do herdado.
  const clamp = clampPeerTimestamp(pingTs, now, {
    maxFutureSkewMs: 0,
    maxPastSkewMs: HEALTH_PONG_MAX_AGE_MS,
  })
  if (!clamp.ok) return
  // fix: T2 ping/pong 1:1 (Threat audit) — pong só é aceito se
  // corresponde a um ping efetivamente enviado por nós. Antes do fix,
  // qualquer pong com TS plausível era aceito; atacante mandava pong
  // forjado com `pingTs ≈ now` e fingia RTT≈0 (peer parecia
  // superhealthy → nunca degraded → nunca reconectado).
  if (!Array.isArray(peer.pendingPings)) return
  // S2 refactor (Ted/Barney audit 2026-05-08): delega membership+consume
  // pra util pura compartilhada `transport/policy/pingPongTracker`.
  const result = validatePong(peer.pendingPings, pingTs, now)
  if (!result.ok) return
  peer.lastPingMs = result.rttMs
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
    // QW1 (Lily P2P idle audit 2026-05-23, convergência Marshall+Satoshi):
    // skip cedo quando não há peers conectados. Em uso solo (mock signaling
    // sem aba paralela same-origin), `peerCount() === 0` é o estado quase
    // permanente — o timer disparava 4×/min queimando ~240 ticks vazios/h
    // por aba. Manter o setInterval vivo (vs `stopHealthCheckTimer`) é
    // intencional: §16 prefere reativação imediata quando o primeiro peer
    // aparece via `hello` (signaling decide adicionar/remover, não nós).
    // NÃO usar APIs vendor (NetworkInformation, Battery, IdleDetector) —
    // Satoshi NO-GO §17 (chave-mestra disfarçada — vendor decide idle).
    if (peerCount() === 0) return
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
