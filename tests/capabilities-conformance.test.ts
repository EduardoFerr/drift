// Capabilities conformance — LOCK_VIA_TEST.
//
// Source: RFC DAOP-001 Phase 1 PR2 (Ted HIMYM analysis 2026-05-17).
//
// Trava:
//   1. lib/capabilities.ts exporta API canônica (loadCapabilities,
//      dismissRule, dismissRules, isRuleDismissed, useCapabilitiesStore)
//   2. Capabilities shape tem 5 fields esperados
//   3. filterApplicableRules é função pura (sem caps → retorna lista inteira)
//   4. appliesIf da regra 'identity' depende de hasBackup
//   5. bootstrap.ts wire chama loadCapabilities

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ONBOARDING_RULES,
  filterApplicableRules,
  getOnboardingRule,
} from '../src/lib/guidance'
import type { Capabilities } from '../src/lib/capabilities'

const CAPS_SRC = readFileSync('src/lib/capabilities.ts', 'utf8')
const BOOTSTRAP_SRC = readFileSync('src/lib/bootstrap.ts', 'utf8')

describe('lib/capabilities — API canônica', () => {
  it('exporta loadCapabilities + dismissRule + dismissRules + isRuleDismissed', () => {
    expect(CAPS_SRC).toMatch(/export\s+async\s+function\s+loadCapabilities/)
    expect(CAPS_SRC).toMatch(/export\s+async\s+function\s+dismissRule\b/)
    expect(CAPS_SRC).toMatch(/export\s+async\s+function\s+dismissRules\b/)
    expect(CAPS_SRC).toMatch(/export\s+function\s+isRuleDismissed/)
    expect(CAPS_SRC).toMatch(/export\s+const\s+useCapabilitiesStore/)
  })

  it('Capabilities interface tem 5 fields esperados', () => {
    // Type-level check via mock object — TS valida em build.
    const mock: Capabilities = {
      hasFirstPost: false,
      hasFirstSpread: false,
      hasFollow: false,
      hasBackup: false,
      dismissedRuleIds: new Set<string>(),
    }
    expect(Object.keys(mock).sort()).toEqual([
      'dismissedRuleIds',
      'hasBackup',
      'hasFirstPost',
      'hasFirstSpread',
      'hasFollow',
    ])
  })

  it('hasBackup deriva de last_nsec_export_at (não inventa pref nova)', () => {
    // Manifesto §3: identidade portável + backup é capability não
    // sincronizada. Reusa o pref já shipped no Satoshi guard [b76245b].
    expect(CAPS_SRC).toMatch(/last_nsec_export_at/)
  })

  it('dismissed bag persiste em user_prefs (key = capabilities_dismissed)', () => {
    expect(CAPS_SRC).toMatch(/capabilities_dismissed/)
    expect(CAPS_SRC).toMatch(/user_prefs/)
  })
})

describe('filterApplicableRules — função pura', () => {
  it('caps=null → retorna lista inteira (fallback paridade PR1)', () => {
    const out = filterApplicableRules(ONBOARDING_RULES, null)
    expect(out.length).toBe(ONBOARDING_RULES.length)
  })

  it('regra sem appliesIf sempre aplica', () => {
    const welcome = getOnboardingRule('welcome')
    expect(welcome?.appliesIf).toBeUndefined()
  })

  it('regra identity tem appliesIf que depende de hasBackup', () => {
    const identity = getOnboardingRule('identity')
    expect(typeof identity?.appliesIf).toBe('function')
    const capsNoBackup: Capabilities = {
      hasFirstPost: false,
      hasFirstSpread: false,
      hasFollow: false,
      hasBackup: false,
      dismissedRuleIds: new Set(),
    }
    const capsWithBackup: Capabilities = { ...capsNoBackup, hasBackup: true }
    expect(identity?.appliesIf?.(capsNoBackup)).toBe(true)
    expect(identity?.appliesIf?.(capsWithBackup)).toBe(false)
  })

  it('user com backup feito pula step identity', () => {
    const capsWithBackup: Capabilities = {
      hasFirstPost: false,
      hasFirstSpread: false,
      hasFollow: false,
      hasBackup: true,
      dismissedRuleIds: new Set(),
    }
    const out = filterApplicableRules(ONBOARDING_RULES, capsWithBackup)
    expect(out.find((r) => r.id === 'identity')).toBeUndefined()
    expect(out.length).toBe(ONBOARDING_RULES.length - 1)
  })

  it('é pura — não muta input', () => {
    const before = ONBOARDING_RULES.map((r) => r.id)
    filterApplicableRules(ONBOARDING_RULES, null)
    const after = ONBOARDING_RULES.map((r) => r.id)
    expect(after).toEqual(before)
  })
})

describe('bootstrap.ts — wire loadCapabilities', () => {
  it('chama loadCapabilities(npub) no boot path', () => {
    expect(BOOTSTRAP_SRC).toMatch(/loadCapabilities\s*\(/)
  })
})

describe('Satoshi audit fixes (2026-05-19)', () => {
  it('#2 — RULE_ID_PATTERN valida shape do bag (defesa contra CSV envenenado)', () => {
    expect(CAPS_SRC).toMatch(/RULE_ID_PATTERN\s*=\s*\/\^/)
    // Aceita a-z + 0-9 + hífen (slug format)
    expect(CAPS_SRC).toMatch(/\[a-z0-9\]\[a-z0-9-\]\*/)
  })

  it('#2 — parseDismissedBag filtra entries malformadas', () => {
    expect(CAPS_SRC).toMatch(/RULE_ID_PATTERN\.test\(s\)/)
  })

  it('#2 — serializeDismissedBag também filtra (defense in depth)', () => {
    expect(CAPS_SRC).toMatch(/RULE_ID_PATTERN\.test\(id\)/)
  })

  it('#3 — persistDismissedIds lê SQLite source-of-truth (não caps store)', () => {
    // Persistência defensiva — funciona mesmo quando store=null durante
    // race no boot. Lê bag direto do SQLite antes de merge+write.
    expect(CAPS_SRC).toMatch(/async function persistDismissedIds/)
    // Lê via db.get
    expect(CAPS_SRC).toMatch(/db\.get[\s\S]*?DISMISSED_PREF_KEY/)
  })

  it('#3 — dismissRule/dismissRules delegam à pipeline de persistência', () => {
    const stripped = CAPS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    // Funções públicas viraram thin wrappers. D16 (Sprint N+3) introduziu
    // debounce: dismissRule → scheduleDismissFlush → flushPendingDismisses
    // → persistDismissedIds. Match aceita qualquer um dos dois lados da
    // chain (persistDismissedIds direto OU scheduleDismissFlush wrapper).
    expect(stripped).toMatch(/dismissRule[\s\S]*?(?:persistDismissedIds|scheduleDismissFlush)/)
    expect(stripped).toMatch(/dismissRules[\s\S]*?(?:persistDismissedIds|scheduleDismissFlush)/)
    // persistDismissedIds continua existindo (downstream do flush).
    expect(stripped).toMatch(/async function persistDismissedIds/)
    // Race-fix: NÃO mais 'if (!current) return' silencioso
    expect(stripped).not.toMatch(
      /export async function dismissRule[\s\S]*?if \(!current\) return/,
    )
  })
})
