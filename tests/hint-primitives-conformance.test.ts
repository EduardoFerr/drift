// Hint primitives conformance — LOCK_VIA_TEST.
//
// Source: RFC DAOP-001 Phase 1 PR3 (Ted HIMYM analysis 2026-05-17).
//
// Trava:
//   1. 3 primitives existem em src/components/UI/ (HintChip, HintToast, HintModal)
//   2. Cada um exporta componente + Props interface canônicas
//   3. Cada um respeita appliesIf + dismissedRuleIds (capability gate)
//   4. HintChip + HintModal usam DriftChip/SlideUpOverlay (design system)
//   5. HintToast usa DriftAlert (não overlay manual)
//   6. Nenhum consome eventos Nostr — manifesto §28 (zero behavioral signal)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const CHIP = readFileSync('src/components/UI/HintChip.tsx', 'utf8')
const TOAST = readFileSync('src/components/UI/HintToast.tsx', 'utf8')
const MODAL = readFileSync('src/components/UI/HintModal.tsx', 'utf8')

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

describe('HintToast — reactive primitive', () => {
  it('exporta HintToast + HintToastProps', () => {
    expect(TOAST).toMatch(/export\s+function\s+HintToast\b/)
    expect(TOAST).toMatch(/export\s+interface\s+HintToastProps/)
  })

  it('usa DriftAlert primitive (não banner ad-hoc)', () => {
    expect(TOAST).toMatch(/from\s+['"]\.\/DriftAlert['"]/)
    expect(TOAST).toMatch(/<DriftAlert\b/)
  })

  it('tem auto-dismiss via setTimeout (durationMs)', () => {
    expect(TOAST).toMatch(/setTimeout/)
    expect(TOAST).toMatch(/durationMs/)
  })

  it('aplica capability gate', () => {
    expect(TOAST).toMatch(/useCapabilitiesStore/)
    expect(TOAST).toMatch(/appliesIf/)
    expect(TOAST).toMatch(/dismissedRuleIds/)
  })

  it('persiste dismiss explícito via dismissRule', () => {
    expect(TOAST).toMatch(/dismissRule\s*\(/)
  })
})

describe('HintModal — interactive primitive', () => {
  it('exporta HintModal + HintModalProps', () => {
    expect(MODAL).toMatch(/export\s+function\s+HintModal\b/)
    expect(MODAL).toMatch(/export\s+interface\s+HintModalProps/)
  })

  it('usa SlideUpOverlay primitive (design-system invariante)', () => {
    expect(MODAL).toMatch(/from\s+['"]\.\/SlideUpOverlay['"]/)
    expect(MODAL).toMatch(/<SlideUpOverlay\b/)
  })

  it('aplica capability gate', () => {
    expect(MODAL).toMatch(/useCapabilitiesStore/)
    expect(MODAL).toMatch(/appliesIf/)
    expect(MODAL).toMatch(/dismissedRuleIds/)
  })

  it('persiste dismiss via dismissRule + suporta snooze', () => {
    expect(MODAL).toMatch(/dismissRule\s*\(/)
    expect(MODAL).toMatch(/allowSnooze/)
  })
})

describe('manifesto §28 — Hint primitives são local-only', () => {
  it('nenhum primitive importa nostr/events/sync (zero behavioral export)', () => {
    for (const src of [CHIP, TOAST, MODAL]) {
      expect(src).not.toMatch(/from\s+['"][^'"]*\/nostr['"]/)
      expect(src).not.toMatch(/from\s+['"][^'"]*\/events['"]/)
      expect(src).not.toMatch(/from\s+['"][^'"]*\/sync['"]/)
      expect(src).not.toMatch(/publishToRelays|signDriftEvent/)
    }
  })

  it('nenhum primitive faz fetch/XHR direto', () => {
    for (const src of [CHIP, TOAST, MODAL]) {
      expect(src).not.toMatch(/\bfetch\s*\(/)
      expect(src).not.toMatch(/XMLHttpRequest/)
    }
  })
})
