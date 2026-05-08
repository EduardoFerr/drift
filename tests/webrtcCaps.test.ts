/**
 * Caps + cross-proto threshold — Fase 6.2-C.
 *
 * Testa MAX_PEERS hard cap e cross-protocol kind injection threshold.
 * MAX_PEERS_PER_PUBKEY=1 não tem test runtime — em modo Nostr, remoteId
 * é o npub e `peers.get(npub)` (Map dedupe) já garante essa proteção
 * estruturalmente; em modo mock, peerIds são UUIDs aleatórios e a
 * proteção não aplica (cada aba é uma "identidade" mock distinta).
 *
 * Manifesto §15 (DoS resistance) + §20 (anti-eclipse).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  _createPeerStateForTest,
  _getOrCreatePeerForTest,
  _injectPeerForTest,
  _resetPeersForTest,
  _simulateCrossProtoForTest,
  WEBRTC_LIMITS,
} from '../src/lib/transport/webrtc'

afterEach(() => {
  _resetPeersForTest()
})

describe('webrtc caps — MAX_PEERS hard cap', () => {
  it('aceita peers até MAX_PEERS', () => {
    for (let i = 0; i < WEBRTC_LIMITS.MAX_PEERS; i++) {
      const fake = _createPeerStateForTest(`peer-${i}`)
      _injectPeerForTest(fake)
    }
    // Nada explode — todos os 32 estão lá. getOrCreatePeer existente
    // retorna o mesmo PeerState.
    const existing = _getOrCreatePeerForTest('peer-0')
    expect(existing).not.toBeNull()
    expect(existing!.id).toBe('peer-0')
  })

  it('rejeita o (MAX_PEERS+1)-ésimo peer novo', () => {
    for (let i = 0; i < WEBRTC_LIMITS.MAX_PEERS; i++) {
      _injectPeerForTest(_createPeerStateForTest(`peer-${i}`))
    }
    // Tenta criar um novo (id não existente no map) — deve retornar null.
    // NOTA: getOrCreatePeer real abriria RTCPeerConnection; em ambiente Node
    // de test não há `RTCPeerConnection`, mas o cap check roda ANTES da
    // construção, então a função retorna null sem nunca tocar a API.
    const rejected = _getOrCreatePeerForTest('peer-overflow')
    expect(rejected).toBeNull()
  })

  it('peer já existente sempre retorna (não conta como novo slot)', () => {
    for (let i = 0; i < WEBRTC_LIMITS.MAX_PEERS; i++) {
      _injectPeerForTest(_createPeerStateForTest(`peer-${i}`))
    }
    // Even at cap, get-or-create de id existente devolve o existente.
    const existing = _getOrCreatePeerForTest('peer-5')
    expect(existing).not.toBeNull()
    expect(existing!.id).toBe('peer-5')
  })
})

describe('webrtc caps — cross-protocol kind injection threshold', () => {
  // fix: T1 cross-proto window (Threat audit) — threshold mudou de
  // monotônico (50) pra janela deslizante (10 em 24h). Tests refletem
  // o novo contrato; counter monotônico continua sendo incrementado
  // pra telemetria (peerScore/peerRegistry).
  it('CROSS_PROTO_THRESHOLD = 50 (sanity, legacy constant preservada)', () => {
    expect(WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD).toBe(50)
  })

  it('9 violações instantâneas NÃO matam o peer (abaixo do threshold em janela)', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('peer-cross-9', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < 9; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    expect(peer.status).toBe('connecting')
    expect(peer.crossProtoCount).toBe(9)
    expect(peer.crossProtoViolations.length).toBe(9)
  })

  it('10 violações instantâneas MATAM o peer (threshold em janela atingido)', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('peer-cross-10', t0)
    _injectPeerForTest(peer)
    for (let i = 0; i < 10; i++) {
      _simulateCrossProtoForTest(peer, t0 + i)
    }
    // cleanupPeer overwrites status='failed' → 'closed'. Important: not
    // 'connecting'/'open'. Manifesto §15.
    expect(peer.status).toBe('closed')
  })

  it('contador persiste entre invocações do mesmo peer (monotônico, telemetria)', () => {
    const t0 = 1_700_000_000_000
    const peer = _createPeerStateForTest('peer-cross-incr', t0)
    _injectPeerForTest(peer)
    _simulateCrossProtoForTest(peer, t0)
    _simulateCrossProtoForTest(peer, t0 + 1)
    _simulateCrossProtoForTest(peer, t0 + 2)
    expect(peer.crossProtoCount).toBe(3)
    expect(peer.status).toBe('connecting')
  })
})

describe('webrtc caps — WEBRTC_LIMITS export shape', () => {
  it('expõe todas as chaves do plano §5', () => {
    expect(WEBRTC_LIMITS.MAX_PEERS).toBe(32)
    expect(WEBRTC_LIMITS.MAX_PEERS_PER_PUBKEY).toBe(1)
    expect(WEBRTC_LIMITS.RATE_LIMIT_MSG_PER_SEC).toBe(100)
    expect(WEBRTC_LIMITS.RATE_LIMIT_BURST).toBe(200)
    expect(WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD).toBe(50)
    expect(WEBRTC_LIMITS.BLACKLIST_TTL_MS).toBe(60 * 60 * 1000)
  })
})
