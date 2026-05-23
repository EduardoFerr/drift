// Hint primitives conformance — LOCK_VIA_TEST.
//
// Source: RFC DAOP-001 Phase 1 PR3 (Ted HIMYM analysis 2026-05-17).
// 2026-05-23 — HintToast e HintModal removidos (Ted+Barney audit dead
// code 2026-05-23 §4.2/§4.3 — zero callers em 6 dias após criação;
// shelf-ware confessado). Apenas HintChip permanece (consumido em
// App.tsx via capability gate).
//
// Trava:
//   1. HintChip existe em src/components/UI/ (passive primitive)
//   2. Exporta componente + Props interface canônicas
//   3. Respeita appliesIf + dismissedRuleIds (capability gate)
//   4. Usa DriftChip (design system)
//   5. Não consome eventos Nostr — manifesto §28 (zero behavioral signal)

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const CHIP = readFileSync('src/components/UI/HintChip.tsx', 'utf8')

describe('HintChip — passive primitive', () => {
  it('exporta HintChip + HintChipProps', () => {
    expect(CHIP).toMatch(/export\s+function\s+HintChip\b/)
    expect(CHIP).toMatch(/export\s+interface\s+HintChipProps/)
  })

  it('usa DriftChip primitive (não chip ad-hoc)', () => {
    expect(CHIP).toMatch(/from\s+['"]\.\/DriftChip['"]/)
    expect(CHIP).toMatch(/<DriftChip\b/)
  })

  it('aplica capability gate (appliesIf + dismissedRuleIds)', () => {
    expect(CHIP).toMatch(/useCapabilitiesStore/)
    expect(CHIP).toMatch(/appliesIf/)
    expect(CHIP).toMatch(/dismissedRuleIds/)
  })

  it('persiste dismiss via dismissRule', () => {
    expect(CHIP).toMatch(/dismissRule\s*\(/)
  })
})

describe('manifesto §28 — HintChip é local-only', () => {
  it('não importa nostr/events/sync (zero behavioral export)', () => {
    expect(CHIP).not.toMatch(/from\s+['"][^'"]*\/nostr['"]/)
    expect(CHIP).not.toMatch(/from\s+['"][^'"]*\/events['"]/)
    expect(CHIP).not.toMatch(/from\s+['"][^'"]*\/sync['"]/)
    expect(CHIP).not.toMatch(/publishToRelays|signDriftEvent/)
  })

  it('não faz fetch/XHR direto', () => {
    expect(CHIP).not.toMatch(/\bfetch\s*\(/)
    expect(CHIP).not.toMatch(/XMLHttpRequest/)
  })
})

describe('Dead-code anti-regressão (Ted+Barney audit 2026-05-23)', () => {
  // HintToast e HintModal removidos em 2026-05-23 (zero callers).
  // Este guard impede re-introdução acidental — se DAOP Phase 2 quiser
  // re-criar, faça com pelo menos 1 caller real no PR.
  it('HintToast.tsx não existe (removido — re-introduzir exige caller real)', () => {
    expect(existsSync('src/components/UI/HintToast.tsx')).toBe(false)
  })
  it('HintModal.tsx não existe (removido — re-introduzir exige caller real)', () => {
    expect(existsSync('src/components/UI/HintModal.tsx')).toBe(false)
  })
})
