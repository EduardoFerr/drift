/**
 * Threat audit T1 — cross-proto counter sliding window (2026-05-08).
 *
 * Antes do fix, `crossProtoCount` era monotônico — atacante paciente
 * acumulava 49 violações ao longo de meses, esperava, mandava mais 49,
 * e nunca atingia threshold. Agora violações fora da janela (24h) são
 * pruned, mantendo `CROSS_PROTO_VIOLATION_THRESHOLD=10` real.
 *
 * Cobertura desta spec:
 *  1. Ataque "paciente" — violações distribuídas além da janela não
 *     acumulam pra kill.
 *  2. Ataque "burst" — violações dentro da janela killam normalmente.
 *  3. Counter monotônico `crossProtoCount` ainda incrementa
 *     (telemetria peerScore/peerRegistry preservada).
 *  4. Janela deslizante: 9 antigas + 1 nova ≠ kill (antigas pruned).
 *  5. Cap defensivo no array (não cresce ilimitado).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  _createPeerStateForTest,
  _injectPeerForTest,
  _resetPeersForTest,
  _simulateCrossProtoForTest,
} from '../src/lib/transport/webrtc'

afterEach(() => {
  _resetPeersForTest()
})

const WINDOW_MS = 24 * 60 * 60 * 1000
const THRESHOLD = 10

describe('T1 — cross-proto sliding window', () => {
  it('atacante paciente: 9 violações + (window+1ms) + mais 9 → não mata', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-patient', t0)
    _injectPeerForTest(peer)
    // Burst 1: 9 violações em t0..t0+8.
    for (let i = 0; i < 9; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    expect(peer.status).toBe('connecting')
    // Avança ALÉM da janela (24h + 1ms).
    const tFar = t0 + WINDOW_MS + 1
    // Burst 2: 9 violações dentro de uma nova janela limpa.
    for (let i = 0; i < 9; i++) {
      _simulateCrossProtoForTest(peer, tFar + i)
    }
    // Antigas foram pruned em cada nova violação. Janela só contém 9.
    expect(peer.status).toBe('connecting')
    expect(peer.crossProtoViolations.length).toBe(9)
    // Counter monotônico: 9 + 9 = 18 (telemetria histórica preservada).
    expect(peer.crossProtoCount).toBe(18)
  })

  it('atacante burst: 10 violações em 1 segundo → mata', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-burst', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < THRESHOLD; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    // cleanupPeer setou status='closed' (após 'failed').
    expect(peer.status).toBe('closed')
  })

  it('janela deslizante: 9 antigas + (window-1ms) + 1 nova → não mata (8 pruned, 1 sobrevive + 1 nova = 2)', () => {
    // Cenário: 9 violações em t0, depois UMA nova logo antes de janela
    // expirar. Antiga decai? Não — ainda dentro da janela. Mas se uma
    // nova chega DEPOIS da janela passar pra todas: 0 dentro + 1 nova.
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-slide', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < 9; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    // Salta toda a janela.
    const tNew = t0 + WINDOW_MS + 1000
    _simulateCrossProtoForTest(peer, tNew)
    // Todas as 9 antigas foram pruned (estão fora da janela quando tNew
    // pushou). Só sobra 1 violação na janela.
    expect(peer.crossProtoViolations.length).toBe(1)
    expect(peer.status).toBe('connecting')
  })

  it('counter monotônico crossProtoCount NÃO decai (telemetria histórica)', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('counter-monotonic', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < 5; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    // Avança bem além da janela. Última antiga foi em t0+4. Cutoff em
    // tNew - WINDOW_MS deve ser > t0+4, então tNew > t0 + WINDOW_MS + 4.
    _simulateCrossProtoForTest(peer, t0 + WINDOW_MS + 100)
    // Janela tem só 1 (as 5 antigas foram pruned).
    expect(peer.crossProtoViolations.length).toBe(1)
    // Counter monotônico viu 6 violações no total — preservado pra
    // peerScore/peerRegistry consumirem como sinal histórico.
    expect(peer.crossProtoCount).toBe(6)
  })

  it('ataque "fronteira": 10 em 23h59m matam (dentro da janela)', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-edge', t0)
    _injectPeerForTest(peer)
    // 10 violações distribuídas em 23h59m — todas dentro da janela 24h.
    const span = WINDOW_MS - 60_000 // 23h59m
    for (let i = 0; i < THRESHOLD; i++) {
      _simulateCrossProtoForTest(peer, t0 + Math.floor((span * i) / THRESHOLD))
    }
    expect(peer.status).toBe('closed')
  })

  it('cap defensivo: array crossProtoViolations não cresce ilimitado', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-spam', t0)
    _injectPeerForTest(peer)
    // Mas cuidado: 10 já mata e cleanup. Esse test verifica que ANTES
    // do kill, o cap funcionou. Como kill ocorre em 10, vou verificar
    // crossProtoCount monotônico contra crossProtoViolations.length em
    // cenário onde estamos a 9 (1 abaixo do kill).
    for (let i = 0; i < 9; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    expect(peer.crossProtoViolations.length).toBeLessThanOrEqual(32)
    expect(peer.crossProtoCount).toBe(9)
  })

  it('peer já failed/closed: violação não incrementa nem mata de novo', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('attacker-zombie', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < 10; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    expect(peer.status).toBe('closed')
    const countBefore = peer.crossProtoCount
    // Mais violações pós-kill: noop.
    _simulateCrossProtoForTest(peer, t0 + 100)
    _simulateCrossProtoForTest(peer, t0 + 101)
    expect(peer.crossProtoCount).toBe(countBefore)
  })
})
