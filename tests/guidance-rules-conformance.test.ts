// Guidance rules conformance — LOCK_VIA_TEST.
//
// Source: RFC DAOP-001 Phase 1 PR1 (Ted HIMYM analysis 2026-05-17).
// OnboardingOverlay refactor — steps são DATA em `lib/guidance.tsx`,
// não JSX hardcoded no componente.
//
// Estes tests travam:
//   1. ONBOARDING_RULES tem 5 entries com IDs canônicos estáveis
//   2. Ordem dos IDs preservada (welcome → ... → manifest-rules)
//   3. Cada rule tem shape {id, title, body} esperado
//   4. body é função (não JSX direto) — forward-compat com context injection
//   5. OnboardingOverlay NÃO redeclara `steps` array inline (regressão de
//      hardcode)
//   6. OnboardingOverlay importa ONBOARDING_RULES

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ONBOARDING_RULES,
  HINT_RULES,
  getOnboardingRule,
  getHintRule,
} from '../src/lib/guidance'

const PANEL = readFileSync(
  'src/components/Onboarding/OnboardingOverlay.tsx',
  'utf8',
)

const EXPECTED_IDS = [
  'welcome',
  'swipes',
  'identity',
  'location',
  'manifest-rules',
] as const

describe('ONBOARDING_RULES — shape canônica', () => {
  it('tem exatamente 5 entries (5 telas pre-Phase 2)', () => {
    expect(ONBOARDING_RULES.length).toBe(EXPECTED_IDS.length)
  })

  it('IDs estáveis na ordem canônica (welcome → ... → manifest-rules)', () => {
    const ids = ONBOARDING_RULES.map((r) => r.id)
    expect(ids).toEqual(EXPECTED_IDS)
  })

  it('cada rule tem id (string non-empty) + title (string) + body (function)', () => {
    for (const rule of ONBOARDING_RULES) {
      expect(typeof rule.id, `rule.id = "${rule.id}"`).toBe('string')
      expect(rule.id.length).toBeGreaterThan(0)
      expect(typeof rule.title).toBe('string')
      expect(rule.title.length).toBeGreaterThan(0)
      // body é factory function (não JSX direto) — permite context injection
      expect(typeof rule.body, `rule[${rule.id}].body deve ser function`).toBe(
        'function',
      )
    }
  })

  it('getOnboardingRule retorna rule por id, undefined pra ids desconhecidos', () => {
    expect(getOnboardingRule('welcome')?.id).toBe('welcome')
    expect(getOnboardingRule('manifest-rules')?.id).toBe('manifest-rules')
    expect(getOnboardingRule('nonexistent-id-xyz')).toBeUndefined()
  })

  it('rule.body aceita context com onOpenIdentity e retorna ReactNode', () => {
    // Smoke: invoke body com ctx mock e verifica que retorna sem throw
    const ctx = { onOpenIdentity: () => {} }
    for (const rule of ONBOARDING_RULES) {
      expect(() => rule.body(ctx)).not.toThrow()
      const node = rule.body(ctx)
      // ReactNode válido = string, number, null, boolean, object, ou array
      expect(['string', 'number', 'object']).toContain(typeof node)
    }
  })
})

describe('OnboardingOverlay.tsx — consumer puro de ONBOARDING_RULES', () => {
  it('importa ONBOARDING_RULES de lib/guidance', () => {
    expect(PANEL).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/guidance['"]/)
    expect(PANEL).toMatch(/ONBOARDING_RULES/)
  })

  it('NÃO redeclara steps array inline (regressão de hardcode)', () => {
    // Strip comments
    const stripped = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    // `const steps: Step[] = [` era o pattern legacy.
    expect(stripped).not.toMatch(/const\s+steps\s*:\s*Step\s*\[\]\s*=/)
    expect(stripped).not.toMatch(/interface\s+Step\s*\{/)
  })

  it('renderiza currentRule.body(ruleContext) — não duplicar inline JSX', () => {
    expect(PANEL).toMatch(/currentRule\?\.body\s*\(\s*ruleContext\s*\)/)
  })

  it('itera applicableRules.map pra progress bar (PR2: filtered por capabilities)', () => {
    // PR1 era ONBOARDING_RULES.map; PR2 (DAOP-001 2026-05-17) trocou pra
    // applicableRules = filterApplicableRules(ONBOARDING_RULES, caps).
    expect(PANEL).toMatch(/applicableRules\.map/)
  })
})

describe('HINT_RULES — shape canônica (item #3 fricção iniciante 2026-05-25)', () => {
  // LOCK_VIA_TEST — HINT_RULES ids estáveis. Adicionar novos requer
  // ID único + body factory function. Mudar id quebra continuity
  // (capabilities_dismissed CSV persiste IDs antigos).

  // backup-after-post é o hint canônico vivo. 'tab-dots-meaning' foi
  // removido em 2026-05-28 (bug #2: chip permanente no topo do feed era
  // ruído — dots já têm aria-label nas abas).
  const EXPECTED_HINT_IDS = ['backup-after-post'] as const

  it('contém os hints canônicos vivos', () => {
    const ids = HINT_RULES.map((r) => r.id)
    for (const expected of EXPECTED_HINT_IDS) {
      expect(ids).toContain(expected)
    }
  })

  it('cada hint tem id + title + body factory', () => {
    for (const rule of HINT_RULES) {
      expect(typeof rule.id).toBe('string')
      expect(rule.id.length).toBeGreaterThan(0)
      expect(typeof rule.title).toBe('string')
      expect(typeof rule.body).toBe('function')
    }
  })

  it('getHintRule retorna backup-after-post; lookup inexistente = undefined', () => {
    expect(getHintRule('backup-after-post')?.id).toBe('backup-after-post')
    expect(getHintRule('nonexistent-hint-xyz')).toBeUndefined()
  })

  it('anti-regressão: tab-dots-meaning removido (não renderiza chip fixo)', () => {
    expect(getHintRule('tab-dots-meaning')).toBeUndefined()
    const APP = readFileSync('src/App.tsx', 'utf8')
    const stripped = APP
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/getHintRule\(['"]tab-dots-meaning['"]\)/)
  })
})

describe('OnboardingOverlay.tsx — PR2 capabilities integration', () => {
  it('importa filterApplicableRules + useCapabilitiesStore + dismissRules', () => {
    expect(PANEL).toMatch(/filterApplicableRules/)
    expect(PANEL).toMatch(/useCapabilitiesStore/)
    expect(PANEL).toMatch(/dismissRules/)
  })

  it('finish() chama dismissRules pra registrar regras dispensadas', () => {
    const stripped = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/dismissRules\s*\(/)
  })
})
