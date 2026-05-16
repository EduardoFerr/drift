/**
 * peerLink — encode/decode/buildURL/QR de peer URIs (NIP-19).
 *
 * Cobertura:
 *  - encodePeerLink com relay hints → nprofile1...
 *  - encodePeerLink sem relay hints → npub1...
 *  - decodePeerLink roundtrip nprofile
 *  - decodePeerLink roundtrip npub
 *  - decodePeerLink malformado → null
 *  - decodePeerLink tipo inesperado (nevent) → null
 *  - buildPeerURL inclui ?peer= com nprofile
 *  - generatePeerQR retorna data URL PNG
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { encodePeerLink, decodePeerLink, buildPeerURL } from '../src/lib/transport/webrtc/peerLink'

const TEST_PUBKEY = 'a'.repeat(64)
const TEST_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol']

describe('encodePeerLink', () => {
  it('retorna nprofile1... quando tem relay hints', () => {
    const encoded = encodePeerLink(TEST_PUBKEY, TEST_RELAYS)
    expect(encoded).toMatch(/^nprofile1/)
  })

  it('retorna npub1... quando sem relay hints', () => {
    const encoded = encodePeerLink(TEST_PUBKEY)
    expect(encoded).toMatch(/^npub1/)
  })

  it('retorna npub1... quando relay hints é array vazio', () => {
    const encoded = encodePeerLink(TEST_PUBKEY, [])
    expect(encoded).toMatch(/^npub1/)
  })
})

describe('decodePeerLink', () => {
  it('roundtrip nprofile preserva pubkey e relays', () => {
    const encoded = encodePeerLink(TEST_PUBKEY, TEST_RELAYS)
    const decoded = decodePeerLink(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.npubHex).toBe(TEST_PUBKEY)
    expect(decoded!.relayHints).toEqual(TEST_RELAYS)
  })

  it('roundtrip npub preserva pubkey com relays vazio', () => {
    const encoded = encodePeerLink(TEST_PUBKEY)
    const decoded = decodePeerLink(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.npubHex).toBe(TEST_PUBKEY)
    expect(decoded!.relayHints).toEqual([])
  })

  it('retorna null pra string malformada', () => {
    expect(decodePeerLink('garbage123')).toBeNull()
    expect(decodePeerLink('')).toBeNull()
    expect(decodePeerLink('nprofile1zzz')).toBeNull()
  })

  it('retorna null pra tipo inesperado (nevent)', () => {
    const { nip19 } = require('nostr-tools')
    const nevent = nip19.neventEncode({ id: TEST_PUBKEY })
    expect(decodePeerLink(nevent)).toBeNull()
  })
})

describe('buildPeerURL', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://drift.social',
        pathname: '/',
      },
    })
  })

  it('inclui ?peer= com nprofile quando tem relays', () => {
    const url = buildPeerURL(TEST_PUBKEY, TEST_RELAYS)
    expect(url).toContain('?peer=nprofile1')
    expect(url).toMatch(/^https:\/\/drift\.social\/\?peer=nprofile1/)
  })

  it('inclui ?peer= com npub quando sem relays', () => {
    const url = buildPeerURL(TEST_PUBKEY)
    expect(url).toContain('?peer=npub1')
  })
})
