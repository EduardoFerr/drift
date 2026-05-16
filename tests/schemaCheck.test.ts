import { describe, expect, it, vi } from 'vitest'

// Mocks: events.ts importa muita coisa side-effecty. Stubamos tudo
// que não a função pura `passesSchemaCheck`.
vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))
vi.mock('../src/lib/nostr', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/nostr')>(
    '../src/lib/nostr',
  )
  return {
    ...actual,
    verifyDriftEvent: vi.fn(() => true),
  }
})
// 2026-05-16: verify movido pra worker (Ted RFC). passesSchemaCheck
// (testado neste arquivo) é puro e não depende de verify, mas events.ts
// importa verify.ts no top — sem mock o spawn de Worker em jsdom falha.
vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: vi.fn(async () => true),
}))
vi.mock('../src/lib/scoring', () => ({
  calculateScoreNow: vi.fn(() => 0),
}))
vi.mock('../src/lib/feed', () => ({
  invalidateFeed: vi.fn(),
}))
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))
vi.mock('../src/lib/weight', () => ({
  calculateUserWeight: vi.fn(async () => ({ weight: 0.5 })),
}))

import { passesSchemaCheck } from '../src/lib/events'
import { DRIFT_KIND } from '../src/config/constants'
import type { SignedEvent } from '../src/types/nostr'

const VALID_HEX = 'a'.repeat(64)
const INVALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(kind: number, tags: string[][], content = ''): SignedEvent {
  return {
    id: '0'.repeat(64),
    pubkey: '0'.repeat(64),
    created_at: 1714000000,
    kind,
    tags,
    content,
    sig: '0'.repeat(128),
  }
}

describe('passesSchemaCheck', () => {
  describe('POST (kind 9078)', () => {
    it('aceita POST com drift-version e subposts JSON válido', () => {
      const ev = makeEvent(
        DRIFT_KIND.POST,
        [
          ['drift-version', '1'],
          ['client', 'drift-web'],
        ],
        JSON.stringify({ subposts: [{ id: '1', text: 'hi' }] }),
      )
      expect(passesSchemaCheck(ev)).toBe(true)
    })

    it('rejeita POST sem drift-version', () => {
      const ev = makeEvent(
        DRIFT_KIND.POST,
        [['client', 'drift-web']],
        JSON.stringify({ subposts: [] }),
      )
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita POST com content não-JSON', () => {
      const ev = makeEvent(DRIFT_KIND.POST, [['drift-version', '1']], 'not json')
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita POST com subposts não-array', () => {
      const ev = makeEvent(
        DRIFT_KIND.POST,
        [['drift-version', '1']],
        JSON.stringify({ subposts: 'string' }),
      )
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('NÃO exige tag d (regular event, NIP-01)', () => {
      // Drift v6+: posts.id é event.id, sem `d` tag.
      const ev = makeEvent(
        DRIFT_KIND.POST,
        [['drift-version', '1']],
        JSON.stringify({ subposts: [] }),
      )
      expect(passesSchemaCheck(ev)).toBe(true)
    })
  })

  describe('SPREAD (kind 9079)', () => {
    it('aceita SPREAD com tag e em hex 64', () => {
      const ev = makeEvent(DRIFT_KIND.SPREAD, [['e', VALID_HEX]])
      expect(passesSchemaCheck(ev)).toBe(true)
    })

    it('rejeita SPREAD sem tag e', () => {
      const ev = makeEvent(DRIFT_KIND.SPREAD, [])
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita SPREAD com tag e em formato UUID (NIP-01 violation)', () => {
      const ev = makeEvent(DRIFT_KIND.SPREAD, [['e', INVALID_UUID]])
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita SPREAD com tag e curta demais', () => {
      const ev = makeEvent(DRIFT_KIND.SPREAD, [['e', 'abc123']])
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita SPREAD com tag e contendo caracteres não-hex', () => {
      const ev = makeEvent(DRIFT_KIND.SPREAD, [['e', 'g'.repeat(64)]])
      expect(passesSchemaCheck(ev)).toBe(false)
    })
  })

  describe('BURY (kind 9080)', () => {
    it('aceita BURY com tag e em hex 64', () => {
      const ev = makeEvent(DRIFT_KIND.BURY, [['e', VALID_HEX]])
      expect(passesSchemaCheck(ev)).toBe(true)
    })

    it('rejeita BURY sem tag e', () => {
      const ev = makeEvent(DRIFT_KIND.BURY, [])
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita BURY com tag e em formato UUID', () => {
      const ev = makeEvent(DRIFT_KIND.BURY, [['e', INVALID_UUID]])
      expect(passesSchemaCheck(ev)).toBe(false)
    })
  })

  describe('REPORT (kind 9081)', () => {
    it('aceita REPORT com e hex 64 + reason', () => {
      const ev = makeEvent(DRIFT_KIND.REPORT, [
        ['e', VALID_HEX],
        ['reason', 'spam'],
      ])
      expect(passesSchemaCheck(ev)).toBe(true)
    })

    it('rejeita REPORT sem reason', () => {
      const ev = makeEvent(DRIFT_KIND.REPORT, [['e', VALID_HEX]])
      expect(passesSchemaCheck(ev)).toBe(false)
    })

    it('rejeita REPORT com e em formato UUID', () => {
      const ev = makeEvent(DRIFT_KIND.REPORT, [
        ['e', INVALID_UUID],
        ['reason', 'spam'],
      ])
      expect(passesSchemaCheck(ev)).toBe(false)
    })
  })

  describe('kinds desconhecidos', () => {
    it('rejeita kind fora do range Drift', () => {
      const ev = makeEvent(1, [])
      expect(passesSchemaCheck(ev)).toBe(false)
    })
  })
})
