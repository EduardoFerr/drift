import { describe, expect, it, vi } from 'vitest'

// pushRecent é puro mas vive em sync.ts que importa pool/db/relays/events.
// Mockamos os colaterais pra que o import não dispare worker SQLite ou
// connect WebSocket.
vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))
vi.mock('../src/lib/nostr', () => ({
  pool: { subscribeMany: vi.fn() },
  // mantém implementação real de getTag pra preservar comportamento
  getTag: (event: { tags: string[][] }, name: string): string | null => {
    for (const t of event.tags) if (t[0] === name) return t[1] ?? null
    return null
  },
}))
vi.mock('../src/lib/events', () => ({ onNostrEvent: vi.fn() }))
vi.mock('../src/lib/relays', () => ({ activeReadRelays: () => [] }))

import { pushRecent, RECENT_EVENTS_CAP, type RecentEvent } from '../src/lib/sync'
import type { SignedEvent } from '../src/types/nostr'

function ev(overrides: Partial<SignedEvent> & { kind: number; id: string }): SignedEvent {
  return {
    id: overrides.id,
    pubkey: 'p'.repeat(64),
    kind: overrides.kind,
    created_at: 1714000000,
    tags: overrides.tags ?? [],
    content: '',
    sig: 's'.repeat(128),
    ...overrides,
  } as SignedEvent
}

describe('pushRecent', () => {
  it('vazio + 1 → array com o evento', () => {
    const out = pushRecent([], ev({ kind: 9078, id: 'aaa' }))
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('aaa')
    expect(out[0]!.kind).toBe(9078)
  })

  it('mais novo entra no topo (FIFO LIFO ordering — head)', () => {
    const first: RecentEvent = { kind: 9078, id: 'old', receivedAt: 1, ref: 'old' }
    const out = pushRecent([first], ev({ kind: 9079, id: 'new', tags: [['e', 'old']] }))
    expect(out[0]!.id).toBe('new')
    expect(out[1]!.id).toBe('old')
  })

  it('cap em RECENT_EVENTS_CAP — 21 entradas viram 20, descarta a mais antiga', () => {
    let buf: RecentEvent[] = []
    for (let i = 0; i < 21; i++) {
      buf = pushRecent(buf, ev({ kind: 9078, id: `id${i}` }))
    }
    expect(buf).toHaveLength(RECENT_EVENTS_CAP) // 20
    // O último inserido (id20) está no topo; o primeiro (id0) foi descartado
    expect(buf[0]!.id).toBe('id20')
    expect(buf.find((e) => e.id === 'id0')).toBeUndefined()
    expect(buf[buf.length - 1]!.id).toBe('id1')
  })

  it('kind POST (9078) → ref = event.id (próprio post)', () => {
    const out = pushRecent([], ev({ kind: 9078, id: 'post-xyz', tags: [['e', 'other']] }))
    expect(out[0]!.ref).toBe('post-xyz')
  })

  it('kind SPREAD (9079) → ref = tag e (postId referenciado, não event.id)', () => {
    const out = pushRecent([], ev({ kind: 9079, id: 'spread-evt', tags: [['e', 'target-post'], ['p', 'author']] }))
    expect(out[0]!.ref).toBe('target-post')
    expect(out[0]!.id).toBe('spread-evt')
  })

  it('kind BURY (9080) sem tag e → ref null (evento malformado, não crasha)', () => {
    const out = pushRecent([], ev({ kind: 9080, id: 'bury-1', tags: [] }))
    expect(out[0]!.ref).toBeNull()
  })

  it('não muta o array de entrada (imutabilidade — store-friendly)', () => {
    const original: RecentEvent[] = [
      { kind: 9078, id: 'a', receivedAt: 1, ref: 'a' },
    ]
    const snapshot = [...original]
    pushRecent(original, ev({ kind: 9078, id: 'b' }))
    expect(original).toEqual(snapshot)
  })
})
