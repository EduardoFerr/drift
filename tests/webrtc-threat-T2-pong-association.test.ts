/**
 * Threat audit T2 — pong validado contra ping enviado (2026-05-08).
 *
 * Antes do fix, `_handlePong` aceitava qualquer pong com `pingTs`
 * plausível (>= lastPingSentAt - 1s). Atacante mandava pong forjado
 * com `pingTs ≈ now` e fingia RTT≈0 — peer parecia superhealthy →
 * nunca degraded → nunca reconectado.
 *
 * Cobertura desta spec:
 *  1. Pong sem ping correspondente (atacante isolado) — drop.
 *  2. Pong com pingTs forjado igual a now — drop (não está em pendingPings).
 *  3. Pong duplicado (replay do mesmo pingTs) — segundo é dropado.
 *  4. Múltiplos pings em flight — pong correto consome só o seu.
 *  5. Atacante envia pong forjado tentando fingir RTT≈0 — não engana.
 *  6. Pong com timestamp futuro — drop (defense-in-depth, herdado).
 *  7. Pong stale (>5min) — drop (defense-in-depth, herdado).
 *  8. Prune de pings antigos (não acumula leak).
 */

import { describe, expect, it } from 'vitest'
import {
  _createPeerStateForTest,
  _markPing,
  _handlePong,
} from '../src/lib/transport/webrtc'

describe('T2 — pong require 1:1 with sent ping', () => {
  it('atacante isolado: pong sem nenhum ping enviado → drop', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-no-ping', t0)
    // Nunca chamamos _markPing — pendingPings está vazio.
    _handlePong(peer, t0 + 100, t0 + 200)
    expect(peer.lastPingMs).toBeNull()
    expect(peer.lastPongAt).toBeNull()
  })

  it('atacante forjando RTT≈0: pong com pingTs=now → drop (não em pendingPings)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-forged-rtt', t0)
    // Vítima enviou ping em t0+100.
    _markPing(peer, t0 + 100)
    // Atacante envia pong com pingTs = now-ε (não corresponde ao nosso ping).
    const attackerPongTs = t0 + 999
    _handlePong(peer, attackerPongTs, t0 + 1000)
    // Não deve atualizar lastPingMs — pingTs não está em pendingPings.
    expect(peer.lastPingMs).toBeNull()
    expect(peer.lastPongAt).toBeNull()
    // Pong genuíno (com pingTs correto) ainda funciona depois.
    _handlePong(peer, t0 + 100, t0 + 200)
    expect(peer.lastPingMs).toBe(100)
  })

  it('pong duplicado: segundo é dropado (1:1 estrito)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-replay', t0)
    _markPing(peer, t0 + 100)
    _handlePong(peer, t0 + 100, t0 + 150)
    expect(peer.lastPingMs).toBe(50)
    // Reset lastPingMs pra detectar segundo write.
    peer.lastPingMs = 999
    // Atacante replay do MESMO pingTs.
    _handlePong(peer, t0 + 100, t0 + 200)
    // Não atualiza — pingTs já foi consumido do pendingPings.
    expect(peer.lastPingMs).toBe(999)
  })

  it('múltiplos pings em flight: pong correto consome só o seu', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('multi-flight', t0)
    _markPing(peer, t0 + 100)
    _markPing(peer, t0 + 200)
    _markPing(peer, t0 + 300)
    expect(peer.pendingPings.length).toBe(3)
    // Pong do segundo ping chega.
    _handlePong(peer, t0 + 200, t0 + 350)
    expect(peer.lastPingMs).toBe(150)
    expect(peer.pendingPings.length).toBe(2)
    expect(peer.pendingPings).toContain(t0 + 100)
    expect(peer.pendingPings).toContain(t0 + 300)
    expect(peer.pendingPings).not.toContain(t0 + 200)
  })

  it('atacante envia 100 pongs forjados com pingTs aleatório → todos drop', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('victim-spray', t0)
    _markPing(peer, t0 + 100)
    // Atacante "varre" timestamps próximos de now.
    for (let attackTs = t0 + 1; attackTs < t0 + 200; attackTs++) {
      if (attackTs === t0 + 100) continue // pula o legítimo
      _handlePong(peer, attackTs, t0 + 200)
    }
    // Nenhum pong forjado entrou.
    expect(peer.lastPingMs).toBeNull()
    expect(peer.lastPongAt).toBeNull()
    // Pong legítimo ainda passa.
    _handlePong(peer, t0 + 100, t0 + 200)
    expect(peer.lastPingMs).toBe(100)
  })

  it('pong com timestamp futuro → drop (herdado, defense-in-depth)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('future-ts', t0)
    _markPing(peer, t0 + 100)
    // pingTs > now (impossível no fluxo real).
    _handlePong(peer, t0 + 500, t0 + 200)
    expect(peer.lastPingMs).toBeNull()
  })

  it('pong stale (>5min) → drop (herdado, defense-in-depth)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('stale-pong', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 6 * 60 * 1000)
    expect(peer.lastPingMs).toBeNull()
  })

  it('pings antigos são pruned em _markPing (>2× ping interval)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('prune-old', t0)
    // 5 pings ao longo de 60s.
    _markPing(peer, t0)
    _markPing(peer, t0 + 5_000)
    _markPing(peer, t0 + 10_000)
    expect(peer.pendingPings.length).toBe(3)
    // Avança 2× HEALTH_PING_INTERVAL_MS = 30s — ping em t0 expira.
    _markPing(peer, t0 + 35_000)
    // Cutoff = t0 + 35_000 - 30_000 = t0 + 5_000. Ping em t0 < cutoff → pruned.
    // Ping em t0+5_000 NÃO < cutoff (igual), então sobrevive.
    expect(peer.pendingPings).not.toContain(t0)
    expect(peer.pendingPings).toContain(t0 + 5_000)
    expect(peer.pendingPings).toContain(t0 + 10_000)
    expect(peer.pendingPings).toContain(t0 + 35_000)
  })

  it('cap defensivo: pendingPings não cresce ilimitado mesmo com 1000 markPings', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('cap-pings', t0)
    // 1000 pings instantâneos (todos dentro da janela 30s? Não — tempo real só
    // 1000ms, sim, todos dentro). Esperamos cap em 16.
    for (let i = 0; i < 1000; i++) {
      _markPing(peer, t0 + i)
    }
    expect(peer.pendingPings.length).toBeLessThanOrEqual(16)
    // Os mais novos sobrevivem.
    expect(peer.pendingPings).toContain(t0 + 999)
  })
})
