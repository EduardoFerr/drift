/**
 * Rate limit por peer — Barney audit #3 (DoS via msg-flood).
 *
 * Testa o token bucket sem precisar de RTCPeerConnection real:
 * `_createPeerStateForTest` constrói um PeerState mínimo, e
 * `_consumeRateBudget(peer, now)` é chamada manualmente com `now`
 * controlado pra simular bursts/refill.
 */

import { describe, expect, it } from 'vitest'
import {
  _consumeRateBudget,
  _createPeerStateForTest,
  _RATE_LIMIT_CONSTANTS,
} from '../src/lib/transport/webrtc'

const { RATE_BURST, RATE_REFILL_PER_SEC, RATE_VIOLATION_THRESHOLD } =
  _RATE_LIMIT_CONSTANTS

describe('webrtc rate limit — token bucket', () => {
  it('aceita burst inicial até RATE_BURST mensagens', () => {
    const now = 1_000_000
    const peer = _createPeerStateForTest('peer-burst', now)
    let accepted = 0
    for (let i = 0; i < RATE_BURST; i++) {
      if (_consumeRateBudget(peer, now)) accepted++
    }
    expect(accepted).toBe(RATE_BURST)
  })

  it('rejeita a (RATE_BURST+1)-ésima msg no mesmo instante', () => {
    const now = 2_000_000
    const peer = _createPeerStateForTest('peer-overflow', now)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, now)
    expect(_consumeRateBudget(peer, now)).toBe(false)
  })

  it('refill linear repõe tokens após tempo passar', () => {
    const t0 = 3_000_000
    const peer = _createPeerStateForTest('peer-refill', t0)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, t0)
    expect(_consumeRateBudget(peer, t0)).toBe(false)
    const t1 = t0 + 1000
    let accepted = 0
    for (let i = 0; i < RATE_REFILL_PER_SEC; i++) {
      if (_consumeRateBudget(peer, t1)) accepted++
    }
    expect(accepted).toBe(RATE_REFILL_PER_SEC)
    expect(_consumeRateBudget(peer, t1)).toBe(false)
  })

  it('refill nunca passa de RATE_BURST (cap)', () => {
    const t0 = 4_000_000
    const peer = _createPeerStateForTest('peer-cap', t0)
    const tFar = t0 + 3600 * 1000
    let accepted = 0
    for (let i = 0; i < RATE_BURST + 50; i++) {
      if (_consumeRateBudget(peer, tFar)) accepted++
    }
    expect(accepted).toBe(RATE_BURST)
  })

  it('marca peer como failed após THRESHOLD violações na janela', () => {
    const now = 5_000_000
    const peer = _createPeerStateForTest('peer-killer', now)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, now)
    for (let i = 0; i < RATE_VIOLATION_THRESHOLD; i++) {
      _consumeRateBudget(peer, now)
    }
    expect(peer.status).toBe('failed')
  })

  it('1 violação isolada NÃO mata o peer', () => {
    const now = 6_000_000
    const peer = _createPeerStateForTest('peer-one-strike', now)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, now)
    _consumeRateBudget(peer, now)
    expect(peer.status).toBe('connecting')
  })

  it('violações fora da janela (60s) não acumulam', () => {
    const t0 = 7_000_000
    const peer = _createPeerStateForTest('peer-window', t0)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, t0)
    _consumeRateBudget(peer, t0)
    _consumeRateBudget(peer, t0)
    expect(peer.status).toBe('connecting')
    const t1 = t0 + 120_000
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(peer, t1)
    _consumeRateBudget(peer, t1)
    expect(peer.status).toBe('connecting')
  })

  it('cada peer tem orçamento independente', () => {
    const now = 8_000_000
    const a = _createPeerStateForTest('peer-a', now)
    const b = _createPeerStateForTest('peer-b', now)
    for (let i = 0; i < RATE_BURST; i++) _consumeRateBudget(a, now)
    expect(_consumeRateBudget(a, now)).toBe(false)
    expect(_consumeRateBudget(b, now)).toBe(true)
  })
})
