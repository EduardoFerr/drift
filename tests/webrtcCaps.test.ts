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
  it('CROSS_PROTO_THRESHOLD = 50 (sanity)', () => {
    expect(WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD).toBe(50)
  })

  it('incrementar 49× NÃO mata o peer', () => {
    const peer = _createPeerStateForTest('peer-cross-49')
    _injectPeerForTest(peer)
    for (let i = 0; i < WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD - 1; i++) {
      _simulateCrossProtoForTest(peer)
    }
    expect(peer.status).toBe('connecting')
    expect(peer.crossProtoCount).toBe(WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD - 1)
  })

  it('incrementar 50× marca peer.status=failed e cleanup', () => {
    const peer = _createPeerStateForTest('peer-cross-50')
    _injectPeerForTest(peer)
    for (let i = 0; i < WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD; i++) {
      _simulateCrossProtoForTest(peer)
    }
    // cleanupPeer marca status='closed' no fim (overwrite do 'failed'
    // que foi setado antes do cleanup). O importante é que NÃO é mais
    // 'connecting' ou 'open' — peer está morto. Manifesto §15.
    expect(peer.status).toBe('closed')
  })

  it('counter persiste entre invocações do mesmo peer', () => {
    const peer = _createPeerStateForTest('peer-cross-incr')
    _injectPeerForTest(peer)
    _simulateCrossProtoForTest(peer)
    _simulateCrossProtoForTest(peer)
    _simulateCrossProtoForTest(peer)
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
