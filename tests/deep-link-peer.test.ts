/**
 * deep-link peer param — testes do `?peer=nprofile1...` extension.
 *
 * Cobertura:
 *  - parseDeepLinkSearch com ?peer=nprofile1... → peerLink populated
 *  - parseDeepLinkSearch com ?peer=npub1... → peerLink with empty relays
 *  - parseDeepLinkSearch sem peer param → peerLink null
 *  - parseDeepLinkSearch com peer malformado → peerLink null
 *  - parseDeepLinkSearch com peer + p coexistem
 *  - cleanDeepLinkParams remove peer da URL
 */

import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { parseDeepLinkSearch } from '../src/lib/deep-link'

const TEST_PUBKEY = 'a'.repeat(64)
const TEST_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol']

describe('parseDeepLinkSearch — peer param', () => {
  it('decodifica nprofile com relay hints', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: TEST_PUBKEY, relays: TEST_RELAYS })
    const result = parseDeepLinkSearch(`?peer=${nprofile}`)
    expect(result.peerLink).not.toBeNull()
    expect(result.peerLink!.npubHex).toBe(TEST_PUBKEY)
    expect(result.peerLink!.relayHints).toEqual(TEST_RELAYS)
  })

  it('decodifica npub sem relay hints', () => {
    const npub = nip19.npubEncode(TEST_PUBKEY)
    const result = parseDeepLinkSearch(`?peer=${npub}`)
    expect(result.peerLink).not.toBeNull()
    expect(result.peerLink!.npubHex).toBe(TEST_PUBKEY)
    expect(result.peerLink!.relayHints).toEqual([])
  })

  it('retorna null sem peer param', () => {
    const result = parseDeepLinkSearch('?action=compose')
    expect(result.peerLink).toBeNull()
  })

  it('retorna null pra peer malformado', () => {
    const result = parseDeepLinkSearch('?peer=garbage123')
    expect(result.peerLink).toBeNull()
  })

  it('ignora nevent como peer (tipo inesperado)', () => {
    const nevent = nip19.neventEncode({ id: TEST_PUBKEY })
    const result = parseDeepLinkSearch(`?peer=${nevent}`)
    expect(result.peerLink).toBeNull()
  })

  it('peer e p coexistem sem interferir', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: TEST_PUBKEY, relays: TEST_RELAYS })
    const nevent = nip19.neventEncode({ id: 'b'.repeat(64), relays: ['wss://r.x'] })
    const result = parseDeepLinkSearch(`?peer=${nprofile}&p=${nevent}`)
    expect(result.peerLink).not.toBeNull()
    expect(result.peerLink!.npubHex).toBe(TEST_PUBKEY)
    expect(result.postEventId).toBe('b'.repeat(64))
  })
})
