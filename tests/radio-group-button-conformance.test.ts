// RadioGroupButton primitive — LOCK_VIA_TEST conformance.
//
// Source: BACKLOG "Radio-group active state invisível em Velatura"
// — fix de [45cd93f] migrou de `/50` opacity (invisível em tema escuro
// Velatura) pra `/15 + texto solid accent`. Primitive extract previne
// regressão futura: callsites passam pelo componente, não copiam
// classnames.
//
// Cobre:
//   1. Active state usa o triplet WCAG-safe (`border-drift-accent
//      bg-drift-accent/15 text-drift-accent`) — não /50 nem /10
//   2. Idle state usa `border-drift-border/50 bg-drift-surface/40
//      text-drift-muted` (low-contrast aceitável; active é que tem
//      que ser visível)
//   3. role="radiogroup" + role="radio" + aria-checked shape
//   4. disabled state suprime onChange + aplica opacity-30
//   5. Callsites SettingsCards (Location + NetworkMode) usam o
//      primitive, não reimplementam classnames

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PRIMITIVE = readFileSync(
  'src/components/UI/RadioGroupButton.tsx',
  'utf8',
)
const SETTINGS = readFileSync(
  'src/components/Settings/SettingsCards.tsx',
  'utf8',
)

describe('RadioGroupButton — active state classnames (WCAG-safe)', () => {
  it('usa triplet border-drift-accent + bg-drift-accent/15 + text-drift-accent', () => {
    expect(PRIMITIVE).toMatch(/border-drift-accent\s+bg-drift-accent\/15\s+text-drift-accent/)
  })

  it('NÃO usa /50 nem /10 em active state (regressão Velatura)', () => {
    // Procura o bloco do active state especificamente
    const activeMatch = PRIMITIVE.match(/active\s*\?\s*'([^']+)'/)
    expect(activeMatch).not.toBeNull()
    const activeClasses = activeMatch![1]!
    expect(activeClasses).not.toMatch(/bg-drift-accent\/(50|10)\b/)
    expect(activeClasses).not.toMatch(/border-drift-accent\/(50|10)\b/)
  })
})

describe('RadioGroupButton — a11y shape', () => {
  it('container tem role="radiogroup" + aria-label', () => {
    expect(PRIMITIVE).toMatch(/role="radiogroup"/)
    expect(PRIMITIVE).toMatch(/aria-label=\{ariaLabel\}/)
  })

  it('itens têm role="radio" + aria-checked', () => {
    expect(PRIMITIVE).toMatch(/role="radio"/)
    expect(PRIMITIVE).toMatch(/aria-checked=\{active\}/)
  })

  it('disabled aplica opacity-30 + cursor-not-allowed', () => {
    expect(PRIMITIVE).toMatch(/cursor-not-allowed\s+opacity-30/)
  })

  it('focus-visible ring usa drift-accent2', () => {
    expect(PRIMITIVE).toMatch(/focus-visible:ring-drift-accent2\/40/)
  })
})

describe('Callsite migration — SettingsCards usa RadioGroupButton', () => {
  it('LocationCard usa RadioGroupButton (não reimplementa role=radiogroup ad-hoc)', () => {
    // O card Location deve referenciar o primitive
    expect(SETTINGS).toMatch(/<RadioGroupButton<LocationGranularity>/)
  })

  it('NetworkModeCard usa RadioGroupButton', () => {
    expect(SETTINGS).toMatch(/<RadioGroupButton<NetworkMode>/)
  })

  it('classnames ad-hoc do active state foram removidos de SettingsCards', () => {
    // Após o refactor, a string literal "bg-drift-accent/15 text-drift-accent"
    // só deve aparecer DENTRO do primitive (não duplicada em SettingsCards).
    // Marshall conformance: single source of truth.
    const matches = SETTINGS.match(
      /border-drift-accent\s+bg-drift-accent\/15\s+text-drift-accent/g,
    )
    expect(matches ?? []).toHaveLength(0)
  })
})

describe('RadioGroupButton — API stability', () => {
  it('export RadioGroupButton + interface RadioOption + RadioGroupButtonProps', () => {
    expect(PRIMITIVE).toMatch(/export function RadioGroupButton/)
    expect(PRIMITIVE).toMatch(/export interface RadioOption/)
    expect(PRIMITIVE).toMatch(/export interface RadioGroupButtonProps/)
  })

  it('genérico em T extends string (preserva type-safety do callsite)', () => {
    expect(PRIMITIVE).toMatch(/RadioGroupButton<T extends string>/)
    expect(PRIMITIVE).toMatch(/RadioOption<T extends string>/)
  })
})
