import { describe, expect, it, vi } from 'vitest'

// Mocks pra evitar carregar pool/relays que dependem de browser APIs.
vi.mock('../src/lib/transport/wss', () => ({
  pool: { subscribeMany: vi.fn() },
}))
vi.mock('../src/lib/relays', () => ({
  activeReadRelays: () => [],
}))
vi.mock('../src/lib/identity', () => ({
  getOrCreateIdentity: vi.fn(),
  nsecHexToBytes: vi.fn(),
}))
vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))

import { parseRelayList } from '../src/lib/nip65'
import type { SignedEvent } from '../src/types/nostr'

function makeEvent(tags: string[][], kind = 10002): SignedEvent {
  return {
    id: '0'.repeat(64),
    pubkey: '0'.repeat(64),
    created_at: 1714000000,
    kind,
    tags,
    content: '',
    sig: '0'.repeat(128),
  }
}

describe('parseRelayList (NIP-65)', () => {
  it('parseia tags r simples (read+write default)', () => {
    const event = makeEvent([
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://nos.lol'],
    ])
    const result = parseRelayList(event)
    expect(result).toEqual([
      { url: 'wss://relay.damus.io', read: true, write: true },
      { url: 'wss://nos.lol', read: true, write: true },
    ])
  })

  it("marker 'read' isola só leitura", () => {
    const event = makeEvent([['r', 'wss://only-read.com', 'read']])
    expect(parseRelayList(event)).toEqual([
      { url: 'wss://only-read.com', read: true, write: false },
    ])
  })

  it("marker 'write' isola só escrita", () => {
    const event = makeEvent([['r', 'wss://only-write.com', 'write']])
    expect(parseRelayList(event)).toEqual([
      { url: 'wss://only-write.com', read: false, write: true },
    ])
  })

  it('ignora kind != 10002', () => {
    const event = makeEvent([['r', 'wss://relay.damus.io']], 1)
    expect(parseRelayList(event)).toEqual([])
  })

  it('ignora tags não-r', () => {
    const event = makeEvent([
      ['p', '0'.repeat(64)],
      ['e', '1'.repeat(64)],
      ['r', 'wss://relay.damus.io'],
    ])
    expect(parseRelayList(event)).toEqual([
      { url: 'wss://relay.damus.io', read: true, write: true },
    ])
  })

  it('descarta URLs sem prefixo wss://', () => {
    const event = makeEvent([
      ['r', 'http://not-secure.com'],
      ['r', 'relay.com-sem-protocolo'],
      ['r', ''],
      ['r', 'wss://valid.com'],
    ])
    const result = parseRelayList(event)
    expect(result.map((e) => e.url)).toEqual(['wss://valid.com'])
  })

  it('aceita ws:// (não-seguro mas válido pra dev)', () => {
    const event = makeEvent([['r', 'ws://localhost:8080']])
    expect(parseRelayList(event)).toEqual([
      { url: 'ws://localhost:8080', read: true, write: true },
    ])
  })

  it('dedupa URLs repetidas (case-insensitive)', () => {
    const event = makeEvent([
      ['r', 'wss://relay.com'],
      ['r', 'wss://RELAY.com'], // mesma URL com case diferente
      ['r', 'wss://relay.com', 'read'], // duplicada, ignorada
    ])
    expect(parseRelayList(event)).toEqual([
      { url: 'wss://relay.com', read: true, write: true },
    ])
  })

  it('normaliza URL pra lowercase', () => {
    const event = makeEvent([['r', 'WSS://Relay.Damus.IO']])
    expect(parseRelayList(event)[0]?.url).toBe('wss://relay.damus.io')
  })

  it('retorna array vazio pra evento sem tags r', () => {
    const event = makeEvent([['p', '0'.repeat(64)]])
    expect(parseRelayList(event)).toEqual([])
  })

  it('marker desconhecido → trata como read+write (não quebra)', () => {
    const event = makeEvent([['r', 'wss://relay.com', 'unknown-marker']])
    // 'unknown-marker' !== 'read' e !== 'write' → ambos true
    const result = parseRelayList(event)
    expect(result[0]).toEqual({
      url: 'wss://relay.com',
      read: true,
      write: true,
    })
  })

  it('tolera tags malformadas (URL ausente)', () => {
    const event = makeEvent([['r'], ['r', 'wss://relay.com']])
    const result = parseRelayList(event)
    expect(result).toHaveLength(1)
    expect(result[0]?.url).toBe('wss://relay.com')
  })
})
