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
  // Violation. Push timestamp, cap, prune fora da janela.
  peer.rateViolations.push(now)
  if (peer.rateViolations.length > RATE_VIOLATION_CAP) {
    peer.rateViolations.splice(0, peer.rateViolations.length - RATE_VIOLATION_CAP)
  }
  const cutoff = now - RATE_VIOLATION_WINDOW_MS
  while (peer.rateViolations.length && peer.rateViolations[0]! < cutoff) {
    peer.rateViolations.shift()
  }
  // Throttled warn.
  const last = lastRateWarnAt.get(peer.id) ?? 0
  if (now - last > RATE_WARN_THROTTLE_MS) {
    lastRateWarnAt.set(peer.id, now)
    console.warn(
      '[webrtc] rate-limit drop',
      peer.id.slice(0, 8),
      `violations=${peer.rateViolations.length}`,
    )
  }
  if (peer.rateViolations.length >= RATE_VIOLATION_THRESHOLD) {
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
