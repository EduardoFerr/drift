import { describe, expect, it } from 'vitest'
import { matchFilter } from '../src/lib/transport/matchFilter'
import type { SignedEvent } from '../src/types/nostr'

const HEX64 = (c: string) => c.repeat(64)
const HEX128 = (c: string) => c.repeat(128)

function ev(overrides: Partial<SignedEvent> = {}): SignedEvent {
  return {
    id: HEX64('a'),
    pubkey: HEX64('b'),
    kind: 9078,
    created_at: 1_700_000_000,
    tags: [],
    content: '',
    sig: HEX128('c'),
    ...overrides,
  }
}

describe('matchFilter — semântica NIP-01', () => {
  describe('filter vazio', () => {
    it('casa todo evento (NIP-01: ausência = sem restrição)', () => {
      expect(matchFilter(ev(), {})).toBe(true)
      expect(matchFilter(ev({ kind: 1 }), {})).toBe(true)
      expect(matchFilter(ev({ kind: 9081 }), {})).toBe(true)
    })
  })

  describe('arrays vazios — NÃO casa nada', () => {
    it('kinds: [] não casa', () => {
      expect(matchFilter(ev({ kind: 9078 }), { kinds: [] })).toBe(false)
    })

    it('ids: [] não casa', () => {
      expect(matchFilter(ev(), { ids: [] })).toBe(false)
    })

    it('authors: [] não casa', () => {
      expect(matchFilter(ev(), { authors: [] })).toBe(false)
    })

    it('#e: [] não casa', () => {
      const e = ev({ tags: [['e', HEX64('1')]] })
      expect(matchFilter(e, { '#e': [] })).toBe(false)
    })
  })

  describe('kinds', () => {
    it('matches kind exato', () => {
      expect(matchFilter(ev({ kind: 9078 }), { kinds: [9078] })).toBe(true)
      expect(matchFilter(ev({ kind: 9079 }), { kinds: [9078, 9079, 9080] })).toBe(true)
    })

    it('rejeita kind fora do array', () => {
      expect(matchFilter(ev({ kind: 1 }), { kinds: [9078] })).toBe(false)
      expect(matchFilter(ev({ kind: 9081 }), { kinds: [9078, 9079] })).toBe(false)
    })
  })

  describe('authors', () => {
    it('matches pubkey exato', () => {
      const author = HEX64('a')
      expect(matchFilter(ev({ pubkey: author }), { authors: [author] })).toBe(true)
    })

    it('matches OR em multiple authors', () => {
      const a = HEX64('a')
      const b = HEX64('b')
      expect(matchFilter(ev({ pubkey: b }), { authors: [a, b] })).toBe(true)
    })

    it('rejeita pubkey fora do array', () => {
      const a = HEX64('a')
      const c = HEX64('c')
      expect(matchFilter(ev({ pubkey: c }), { authors: [a] })).toBe(false)
    })
  })

  describe('ids', () => {
    it('matches event.id exato', () => {
      const id = HEX64('1')
      expect(matchFilter(ev({ id }), { ids: [id] })).toBe(true)
    })

    it('rejeita id fora do array', () => {
      expect(matchFilter(ev({ id: HEX64('1') }), { ids: [HEX64('2')] })).toBe(false)
    })
  })

  describe('since/until — INCLUSIVOS (peer review Barney #6)', () => {
    it('since inclui boundary exato', () => {
      expect(matchFilter(ev({ created_at: 1000 }), { since: 1000 })).toBe(true)
    })

    it('since rejeita anterior', () => {
      expect(matchFilter(ev({ created_at: 999 }), { since: 1000 })).toBe(false)
    })

    it('until inclui boundary exato', () => {
      expect(matchFilter(ev({ created_at: 1000 }), { until: 1000 })).toBe(true)
    })

    it('until rejeita posterior', () => {
      expect(matchFilter(ev({ created_at: 1001 }), { until: 1000 })).toBe(false)
    })

    it('since === until === created_at casa', () => {
      expect(matchFilter(ev({ created_at: 1000 }), { since: 1000, until: 1000 })).toBe(true)
    })

    it('range [since, until] casa interior', () => {
      expect(matchFilter(ev({ created_at: 1500 }), { since: 1000, until: 2000 })).toBe(true)
    })
  })

  describe('tag filters #e / #p', () => {
    it('#e casa quando event tem tag e correspondente', () => {
      const e = ev({ tags: [['e', HEX64('1')]] })
      expect(matchFilter(e, { '#e': [HEX64('1')] })).toBe(true)
    })

    it('#e rejeita quando event não tem tag e', () => {
      expect(matchFilter(ev({ tags: [] }), { '#e': [HEX64('1')] })).toBe(false)
    })

    it('#e rejeita quando tag e tem outro valor', () => {
      const e = ev({ tags: [['e', HEX64('2')]] })
      expect(matchFilter(e, { '#e': [HEX64('1')] })).toBe(false)
    })

    it('#p casa OR em múltiplos valores', () => {
      const e = ev({ tags: [['p', HEX64('b')]] })
      expect(matchFilter(e, { '#p': [HEX64('a'), HEX64('b')] })).toBe(true)
    })

    it('event com tags extras é OK desde que a wanted apareça', () => {
      const e = ev({
        tags: [
          ['client', 'drift'],
          ['e', HEX64('1')],
          ['drift-version', '1'],
        ],
      })
      expect(matchFilter(e, { '#e': [HEX64('1')] })).toBe(true)
    })
  })

  describe('combinação AND', () => {
    it('todos critérios devem casar', () => {
      const e = ev({
        kind: 9079,
        pubkey: HEX64('a'),
        created_at: 1500,
        tags: [['e', HEX64('1')]],
      })
      expect(
        matchFilter(e, {
          kinds: [9079],
          authors: [HEX64('a')],
          since: 1000,
          until: 2000,
          '#e': [HEX64('1')],
        }),
      ).toBe(true)
    })

    it('falha em qualquer critério → rejeita inteiro', () => {
      const e = ev({ kind: 9079, pubkey: HEX64('a') })
      // kind casa, mas author não
      expect(
        matchFilter(e, { kinds: [9079], authors: [HEX64('z')] }),
      ).toBe(false)
    })
  })

  describe('invariante #14 — tag multi-char é silenciosamente ignorada', () => {
    it('filter com `#drift-version` (multi-char) é tratado como NÃO sendo tag filter', () => {
      // NIP-01 só define tags single-letter. Drift não inventa multi-char.
      // Filtro com chave multi-char NÃO restringe — outros campos do filter
      // continuam valendo. Comportamento defensivo: melhor casar do que rejeitar
      // silenciosamente um filter mal-formado (NIP-01 omite o caso).
      const e = ev({ kind: 9078, tags: [['drift-version', '1']] })
      expect(
        matchFilter(e, {
          kinds: [9078],
          // chave 7 chars — NÃO é tag filter NIP-01
          ['#drift-version' as unknown as '#a']: ['1'],
        } as Filter),
      ).toBe(true)
    })
  })
})

// import duplicado pra typing — evita erro com cast acima
import type { Filter } from '../src/lib/transport'
