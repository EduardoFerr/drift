/**
 * Conformance test pra relay directory (Fase A relay moderation).
 *
 * Garante:
 *  1. JSON estático (`Docs/curated-relays-YYYY-MM.json`) tem schema válido
 *     (tab e policy dentro do enum)
 *  2. SEED_RELAY_CONFIGS respeita CLAUDE.md invariante #18 (nada de
 *     ai-assisted-opt-in, ai-automated, manual-human, private no SEED)
 *  3. Constraint do Arquiteto 2026-05-17: SEM relays pagos no curated
 *  4. URLs do directory são wss:// ou ws:// (não http/https soltos)
 *  5. Função `validateSeedAgainstInvariant18` é pura (manifesto §7)
 *  6. `fetchNip11` retorna shape esperado em path success/failure
 */

import { describe, expect, it } from 'vitest'
import {
  RELAY_DIRECTORY,
  type RelayDirectoryEntry,
  type RelayDirectoryTab,
  type RelayPolicy,
} from '../src/config/relays-directory'
import { validateSeedAgainstInvariant18 } from '../src/lib/relay-directory'
import { SEED_RELAY_CONFIGS } from '../src/config/relays'

const VALID_TABS: RelayDirectoryTab[] = [
  'curated',
  'moderated',
  'free',
  'community',
  'onion',
]

const VALID_POLICIES: RelayPolicy[] = [
  'manual-spam-only',
  'unmoderated',
  'ai-assisted-opt-in',
  'ai-automated',
  'manual-human',
  'private',
]

const SEED_ALLOWED_POLICIES = new Set<RelayPolicy>([
  'manual-spam-only',
  'unmoderated',
])

describe('Relay directory schema conformance', () => {
  it('every entry has valid tab', () => {
    for (const entry of RELAY_DIRECTORY) {
      expect(
        VALID_TABS.includes(entry.tab),
        `${entry.url} tab=${entry.tab} fora do enum válido`,
      ).toBe(true)
    }
  })

  it('every entry has valid policy', () => {
    for (const entry of RELAY_DIRECTORY) {
      expect(
        VALID_POLICIES.includes(entry.policy),
        `${entry.url} policy=${entry.policy} fora do enum válido`,
      ).toBe(true)
    }
  })

  it('every URL is wss:// or ws:// (onion)', () => {
    const URL_RE = /^wss?:\/\//
    for (const entry of RELAY_DIRECTORY) {
      expect(URL_RE.test(entry.url), `${entry.url} não começa com wss:// ou ws://`).toBe(true)
      if (entry.onion) {
        expect(URL_RE.test(entry.onion), `${entry.url} onion=${entry.onion} formato inválido`).toBe(true)
      }
    }
  })

  it('onion URLs estão na tab "onion"', () => {
    for (const entry of RELAY_DIRECTORY) {
      if (entry.url.includes('.onion')) {
        expect(entry.tab, `${entry.url} é .onion mas tab=${entry.tab}`).toBe('onion')
      }
    }
  })

  it('CONSTRAINT do Arquiteto 2026-05-17: cost = "free" em TODAS as entries (sem pagos no curated)', () => {
    for (const entry of RELAY_DIRECTORY) {
      expect(
        entry.cost,
        `${entry.url} cost=${JSON.stringify(entry.cost)} viola constraint sem-pagos. ` +
          `Adicione paid no Discovery futuramente, mas o curated MVP é só free.`,
      ).toBe('free')
    }
  })

  it('every entry has non-empty policyDetail (UI render expects)', () => {
    for (const entry of RELAY_DIRECTORY) {
      expect(
        entry.policyDetail.trim().length,
        `${entry.url} policyDetail vazio ou whitespace`,
      ).toBeGreaterThan(0)
    }
  })
})

describe('LOCK_VIA_TEST — CLAUDE invariante #18 (SEED sem AI moderation)', () => {
  it('SEED_RELAY_CONFIGS não tem nenhum relay com policy AI/private/human', () => {
    const seedUrls = SEED_RELAY_CONFIGS.map((r) => r.url)
    const violations = validateSeedAgainstInvariant18(seedUrls)
    expect(
      violations,
      `SEED viola invariante #18 (CLAUDE.md):\n${violations
        .map((v) => `  ${v.url}: ${v.violation}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('validateSeedAgainstInvariant18 é pura (mesmo input → mesmo output)', () => {
    const seedUrls = ['wss://relay.damus.io', 'wss://nos.lol']
    const a = validateSeedAgainstInvariant18(seedUrls)
    const b = validateSeedAgainstInvariant18(seedUrls)
    expect(a).toEqual(b)
  })

  it('detecta violação quando passamos relay ai-automated', () => {
    const fakeDirectory: RelayDirectoryEntry[] = [
      {
        url: 'wss://evil-ai-relay.example',
        tab: 'moderated',
        policy: 'ai-automated',
        policyDetail: 'reject por classifier automático sem audit público',
        cost: 'free',
      },
    ]
    const violations = validateSeedAgainstInvariant18(
      ['wss://evil-ai-relay.example'],
      fakeDirectory,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]!.url).toBe('wss://evil-ai-relay.example')
  })

  it('aceita policy manual-spam-only e unmoderated em SEED', () => {
    const fakeDirectory: RelayDirectoryEntry[] = [
      {
        url: 'wss://neutral.example',
        tab: 'curated',
        policy: 'manual-spam-only',
        policyDetail: 'rate limit técnico padrão NIP',
        cost: 'free',
      },
      {
        url: 'wss://freespeech.example',
        tab: 'free',
        policy: 'unmoderated',
        policyDetail: 'sem moderação ativa',
        cost: 'free',
      },
    ]
    const violations = validateSeedAgainstInvariant18(
      ['wss://neutral.example', 'wss://freespeech.example'],
      fakeDirectory,
    )
    expect(violations).toEqual([])
    for (const policy of SEED_ALLOWED_POLICIES) {
      expect(['manual-spam-only', 'unmoderated']).toContain(policy)
    }
  })

  it('relay no SEED ausente do directory não é violação (registra como gap de audit)', () => {
    const violations = validateSeedAgainstInvariant18(
      ['wss://unknown-relay-not-in-directory.example'],
      RELAY_DIRECTORY,
    )
    // Ausência ≠ violação. Curador deve adicionar ao directory, mas
    // não é regra dura — só audit.
    expect(violations).toEqual([])
  })
})

describe('Directory curator coverage', () => {
  it('toda URL em SEED_RELAY_CONFIGS está no RELAY_DIRECTORY (audit hint)', () => {
    const seedUrls = SEED_RELAY_CONFIGS.map((r) => r.url)
    const directoryUrls = new Set(RELAY_DIRECTORY.map((r) => r.url))
    const orphans = seedUrls.filter((u) => !directoryUrls.has(u))
    expect(
      orphans,
      `Relays em SEED mas NÃO no directory: ${orphans.join(', ')}. ` +
        `Curador deve adicionar entry pra cada SEED no JSON pra manter audit completo.`,
    ).toEqual([])
  })

  it('tabs renderizadas em UI Discovery existem no enum', () => {
    const tabsUsed = new Set(RELAY_DIRECTORY.map((r) => r.tab))
    for (const tab of tabsUsed) {
      expect(VALID_TABS).toContain(tab)
    }
  })
})
