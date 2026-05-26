/**
 * webrtc/rateLimit — token bucket por peer.
 *
 * Sustained ~100 msgs/seg, burst 200. 3 violações em 60s → peer killed.
 * Manifesto §15 (DoS resistance). Barney audit #3.
 *
 * `consumeRateBudget` é chamada cheap-first em `pipeline.ts` ANTES do
 * `JSON.parse` — invariante #5 do `CLAUDE.md` (cheap → caro). Em
 * violação acumulada acima do threshold, marca peer como `failed` e
 * dispara `cleanupPeer` lazy (evita circular import com `peer.ts`).
 */

import {
  RATE_BURST,
  RATE_REFILL_PER_SEC,
  RATE_VIOLATION_CAP,
  RATE_VIOLATION_THRESHOLD,
  RATE_VIOLATION_WINDOW_MS,
  RATE_WARN_THROTTLE_MS,
} from './config'
import { cleanupPeer } from './peer'
import type { PeerState } from './types'
import { recordViolation } from '../policy/violationWindow'

const lastRateWarnAt = new Map<string, number>()

/** Re-exportado em `webrtc/index.ts` como `_RATE_LIMIT_CONSTANTS`.
 *  `webrtc-ratelimit.test.ts` lê pra checar refill/threshold. */
export const _RATE_LIMIT_CONSTANTS = {
  RATE_BURST,
  RATE_REFILL_PER_SEC,
  RATE_VIOLATION_THRESHOLD,
  RATE_VIOLATION_WINDOW_MS,
} as const

/**
 * Retorna `true` se a mensagem cabe no orçamento; `false` se rate-limited.
 *
 * Side effects: atualiza `peer.rateBudget`/`peer.lastRefillTs` e, em
 * violação, empurra timestamp em `peer.rateViolations` (capped). Após
 * threshold em janela, marca peer como `failed` e dispara cleanup
 * (lazy import — evita circular).
 *
 * Re-exportado em `webrtc/index.ts` como `_consumeRateBudget` para o
 * spec `webrtc-ratelimit.test.ts`.
 */
export function consumeRateBudget(peer: PeerState, now: number): boolean {
  if (peer.status === 'failed' || peer.status === 'closed') return false
  // Refill linear desde lastRefillTs.
  const elapsedSec = (now - peer.lastRefillTs) / 1000
  if (elapsedSec > 0) {
    peer.rateBudget = Math.min(
      RATE_BURST,
      peer.rateBudget + elapsedSec * RATE_REFILL_PER_SEC,
    )
    peer.lastRefillTs = now
  }
  if (peer.rateBudget >= 1) {
    peer.rateBudget -= 1
    return true
  }
  // Violation. S2 refactor (Ted/Barney audit 2026-05-08): delega
  // push/cap/prune/threshold pra util pura `transport/policy/violationWindow`.
  const { count, tripped } = recordViolation(peer.rateViolations, now, {
    windowMs: RATE_VIOLATION_WINDOW_MS,
    cap: RATE_VIOLATION_CAP,
    threshold: RATE_VIOLATION_THRESHOLD,
  })
  // Throttled warn.
  const last = lastRateWarnAt.get(peer.id) ?? 0
  if (now - last > RATE_WARN_THROTTLE_MS) {
    lastRateWarnAt.set(peer.id, now)
    console.warn(
      '[webrtc] rate-limit drop',
      peer.id.slice(0, 8),
      `violations=${count}`,
    )
  }
  if (tripped) {
    console.warn('[webrtc] peer killed (rate abuse)', peer.id.slice(0, 8))
    peer.status = 'failed'
    // Sprint 4 + Lily/Barney: import eager (não circular real —
    // peer.ts NÃO importa rateLimit.ts). O lazy anterior era cargo
    // cult; trocado por import direto.
    cleanupPeer(peer.id)
    lastRateWarnAt.delete(peer.id)
  }
  return false
}

/**
 * QW3 (Lily P2P idle audit 2026-05-23): libera entry no `lastRateWarnAt`
 * Map quando peer é descartado por caminhos NÃO-tripped (ICE timeout,
 * cross-proto kill, pagehide → closeAll → cleanupPeer, peer.bye via
 * signaling). Antes, só o caso `tripped` chamava `.delete()`. Em sessão
 * longa com churn de peers (random walk a cada 30 min), Map crescia
 * monotônico (~30 B/entry).
 *
 * Idempotente — `.delete()` de chave inexistente é no-op. Sem invariante
 * de "peer existia": chamável de qualquer cleanup path.
 *
 * Re-exportado em `webrtc/index.ts` como `_cleanupRateState` (test-only).
 */
export function _cleanupRateState(peerId: string): void {
  lastRateWarnAt.delete(peerId)
}
