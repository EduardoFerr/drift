/**
 * Threat audit T4 — sub maliciosa / load amplification (2026-05-08).
 *
 * Antes do fix, `subscribe(filter, handlers)` aceitava qualquer filter,
 * incluindo:
 *  - match-all (sem kinds/authors/ids/tags/since/until) — cada evento
 *    inbound percorre N subs sem trabalho útil.
 *  - kinds=[100 kinds] / authors=[1000 npubs] — pesa matchFilter.
 *  - limit=1e9 — caller tenta histórico abusivo.
 *  - subs simultâneas crescendo sem cap.
 *
 * Cobertura desta spec:
 *  1. validateSubscriptionFilter aceita filtros real-callers (sync, comments, signaling).
 *  2. Match-all (objeto vazio) → reject 'match-all'.
 *  3. kinds=[] e authors=[] e tudo vazio → reject 'match-all'.
 *  4. Apenas `since` → ok (constraint discriminador).
 *  5. Apenas tag filter (#e) → ok.
 *  6. kinds.length > maxKinds → reject 'too-many-kinds'.
 *  7. authors.length > maxAuthors → reject 'too-many-authors'.
 *  8. ids.length > maxIds → reject 'too-many-ids'.
 *  9. tag filter values > maxTagValues → reject.
 * 10. Mais que maxTagFilters chaves '#x' → reject.
 * 11. limit > maxLimit → reject 'limit-too-high'.
 * 12. filter null/undefined → reject 'invalid-shape'.
 * 13. webrtcTransport.subscribe drop sub maliciosa (não aparece em iterSubscriptions).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SUB_VALIDATOR_CFG,
  validateSubscriptionFilter,
} from '../src/lib/transport/policy/subValidator'
import type { Filter } from '../src/lib/transport/index'
import { webrtcTransport } from '../src/lib/transport/webrtc'

afterEach(() => {
  // Cleanup hipotético — mas subs maliciosas não chegam a registrar.
})

describe('T4 — validateSubscriptionFilter pure', () => {
  it('aceita filter de sync.ts (kinds + since + limit)', () => {
    const f: Filter = { kinds: [9078, 9079, 9080, 9081], since: 1700000000, limit: 500 }
    const r = validateSubscriptionFilter(f)
    expect(r.ok).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('aceita filter de comments.ts (kinds + #E)', () => {
    const f = { kinds: [1111], '#E': ['abc123'] } as unknown as Filter
    const r = validateSubscriptionFilter(f)
    expect(r.ok).toBe(true)
  })

  it('aceita filter de signaling-nostr (kinds + #p + since)', () => {
    const f = {
      kinds: [1059],
      '#p': ['npub1deadbeef'],
      since: 1700000000,
    } as unknown as Filter
    const r = validateSubscriptionFilter(f)
    expect(r.ok).toBe(true)
  })

  it('match-all: objeto vazio → reject', () => {
    const r = validateSubscriptionFilter({} as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('match-all')
  })

  it('match-all: kinds=[] e authors=[] (presentes mas vazios) → reject', () => {
    const r = validateSubscriptionFilter({ kinds: [], authors: [] } as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('match-all')
  })

  it('apenas since → ok (constraint discriminador)', () => {
    const r = validateSubscriptionFilter({ since: 1700000000 } as Filter)
    expect(r.ok).toBe(true)
  })

  it('apenas tag filter #e → ok', () => {
    const r = validateSubscriptionFilter({ '#e': ['abc'] } as unknown as Filter)
    expect(r.ok).toBe(true)
  })

  it('kinds.length > maxKinds → reject', () => {
    const big = Array.from({ length: DEFAULT_SUB_VALIDATOR_CFG.maxKinds + 1 }, (_, i) => i)
    const r = validateSubscriptionFilter({ kinds: big } as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-many-kinds')
  })

  it('authors.length > maxAuthors → reject', () => {
    const big = Array.from({ length: DEFAULT_SUB_VALIDATOR_CFG.maxAuthors + 1 }, () => 'a')
    const r = validateSubscriptionFilter({ authors: big } as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-many-authors')
  })

  it('ids.length > maxIds → reject', () => {
    const big = Array.from({ length: DEFAULT_SUB_VALIDATOR_CFG.maxIds + 1 }, () => 'id')
    const r = validateSubscriptionFilter({ ids: big } as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-many-ids')
  })

  it('tag filter values > maxTagValues → reject', () => {
    const big = Array.from({ length: DEFAULT_SUB_VALIDATOR_CFG.maxTagValues + 1 }, () => 'v')
    const r = validateSubscriptionFilter({ '#e': big } as unknown as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-many-tag-values')
  })

  it('mais que maxTagFilters chaves "#x" → reject', () => {
    const f: Record<string, unknown> = {}
    for (let i = 0; i < DEFAULT_SUB_VALIDATOR_CFG.maxTagFilters + 1; i++) {
      f[`#${String.fromCharCode(97 + i)}`] = ['v']
    }
    const r = validateSubscriptionFilter(f as unknown as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-many-tag-filters')
  })

  it('limit > maxLimit → reject', () => {
    const r = validateSubscriptionFilter({
      kinds: [9078],
      limit: DEFAULT_SUB_VALIDATOR_CFG.maxLimit + 1,
    } as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('limit-too-high')
  })

  it('filter null → reject "invalid-shape"', () => {
    const r = validateSubscriptionFilter(null as unknown as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-shape')
  })

  it('filter undefined → reject "invalid-shape"', () => {
    const r = validateSubscriptionFilter(undefined as unknown as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-shape')
  })

  it('tag filter com valor não-array → reject "invalid-shape"', () => {
    const r = validateSubscriptionFilter({ '#e': 'not-array' } as unknown as Filter)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-shape')
  })
})

describe('T4 — webrtcTransport.subscribe integration', () => {
  it('match-all subscribe retorna noop unsubscribe + dispara EOSE', async () => {
    let eosFired = false
    const unsub = webrtcTransport.subscribe(
      {} as Filter,
      {
        onevent: () => {
          /* não deve disparar */
        },
        oneose: () => {
          eosFired = true
        },
      },
    )
    // queueMicrotask flush
    await Promise.resolve()
    await Promise.resolve()
    expect(eosFired).toBe(true)
    expect(typeof unsub).toBe('function')
    unsub() // noop não deve explodir
  })

  it('filter com kinds [100 kinds] é dropado (too-many-kinds)', async () => {
    const big = Array.from({ length: 100 }, (_, i) => i)
    let eosFired = false
    const unsub = webrtcTransport.subscribe(
      { kinds: big } as Filter,
      {
        onevent: () => {
          /* não deve disparar */
        },
        oneose: () => {
          eosFired = true
        },
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(eosFired).toBe(true)
    unsub()
  })
})
