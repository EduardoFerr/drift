/**
 * Threat audit T3 — Date.now() unprotected (2026-05-08).
 *
 * Antes do fix, timestamps peer-supplied (signaling msg.ts, pong pingTs)
 * eram aceitos sem validação contra o relógio local. Atacante mandava
 * ts=now+1e9 (clock skew falso pra fingir frescor) ou ts antigo (replay
 * de hello/offer). Agora `policy/clockClamp` rejeita ambos extremos.
 *
 * Cobertura desta spec:
 *  1. clampPeerTimestamp puro: dentro da janela → ok.
 *  2. clampPeerTimestamp puro: futuro além de maxFutureSkewMs → reject.
 *  3. clampPeerTimestamp puro: passado além de maxPastSkewMs → reject.
 *  4. clampPeerTimestamp puro: NaN/Infinity/negativo → reject 'invalid'.
 *  5. clampPeerTimestamp puro: skewMs reportado corretamente.
 *  6. _handlePong: pingTs no futuro → drop (clamp + T2 defense-in-depth).
 *  7. _handlePong: pingTs muito antigo (>5min) → drop (HEALTH_PONG_MAX_AGE_MS).
 *  8. _handlePong: pingTs NaN → drop (clamp invalid).
 *  9. _handlePong: pingTs no passado dentro da janela + em pendingPings → ok.
 */

import { describe, expect, it } from 'vitest'
import {
  _createPeerStateForTest,
  _markPing,
  _handlePong,
} from '../src/lib/transport/webrtc'
import { clampPeerTimestamp } from '../src/lib/transport/policy/clockClamp'

describe('T3 — clockClamp pure util', () => {
  const cfg = { maxFutureSkewMs: 1000, maxPastSkewMs: 5000 }

  it('peerTs == localNow → ok', () => {
    const r = clampPeerTimestamp(1_000_000, 1_000_000, cfg)
    expect(r.ok).toBe(true)
    expect(r.reason).toBeNull()
    expect(r.skewMs).toBe(0)
  })

  it('peerTs ligeiramente no futuro (dentro do skew) → ok', () => {
    const r = clampPeerTimestamp(1_000_500, 1_000_000, cfg)
    expect(r.ok).toBe(true)
    expect(r.skewMs).toBe(500)
  })

  it('peerTs muito no futuro → reject "future"', () => {
    const r = clampPeerTimestamp(1_000_000 + 2000, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('future')
    expect(r.skewMs).toBe(2000)
  })

  it('peerTs muito no passado → reject "past"', () => {
    const r = clampPeerTimestamp(1_000_000 - 6000, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('past')
    expect(r.skewMs).toBe(-6000)
  })

  it('peerTs = NaN → reject "invalid"', () => {
    const r = clampPeerTimestamp(NaN, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  it('peerTs = Infinity → reject "invalid"', () => {
    const r = clampPeerTimestamp(Infinity, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  it('peerTs negativo → reject "invalid"', () => {
    const r = clampPeerTimestamp(-1, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  it('exato no boundary future (= maxFutureSkewMs) → ok', () => {
    const r = clampPeerTimestamp(1_000_000 + 1000, 1_000_000, cfg)
    expect(r.ok).toBe(true)
  })

  it('exato no boundary past (= -maxPastSkewMs) → ok', () => {
    const r = clampPeerTimestamp(1_000_000 - 5000, 1_000_000, cfg)
    expect(r.ok).toBe(true)
  })

  it('atacante forjando ts=now+1e9 → reject "future"', () => {
    const r = clampPeerTimestamp(1_000_000 + 1_000_000_000, 1_000_000, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('future')
  })
})

describe('T3 — _handlePong clock protection (defense-in-depth)', () => {
  it('pingTs no futuro → drop (clamp future skew=0)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-future', t0)
    _markPing(peer, t0 + 100)
    // Atacante manda pong com pingTs > now (impossível no fluxo real).
    _handlePong(peer, t0 + 500, t0 + 200)
    expect(peer.lastPingMs).toBeNull()
    expect(peer.lastPongAt).toBeNull()
  })

  it('pingTs muito antigo (>5min) → drop (clamp past)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-stale', t0)
    _markPing(peer, t0)
    // Pong chega 6min depois — fora de HEALTH_PONG_MAX_AGE_MS.
    _handlePong(peer, t0, t0 + 6 * 60 * 1000)
    expect(peer.lastPingMs).toBeNull()
  })

  it('pingTs = NaN → drop (clamp invalid)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-nan', t0)
    _markPing(peer, t0 + 100)
    _handlePong(peer, NaN, t0 + 200)
    expect(peer.lastPingMs).toBeNull()
  })

  it('pingTs no passado dentro da janela + em pendingPings → ok', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-ok', t0)
    _markPing(peer, t0 + 100)
    _handlePong(peer, t0 + 100, t0 + 200)
    expect(peer.lastPingMs).toBe(100)
    expect(peer.lastPongAt).toBe(t0 + 200)
  })
})
