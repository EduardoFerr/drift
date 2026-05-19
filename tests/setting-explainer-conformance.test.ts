// SettingExplainer conformance — LOCK_VIA_TEST.
//
// Source: audit `Docs/sessions/settings-friction-audit-2026-05-18.md`.
// User feedback 2026-05-18 — "usuário comum não sabe do que se trata".
//
// Trava:
//   1. Primitive existe + exporta tipos canônicos
//   2. Props obrigatórias presentes (label, description, children)
//   3. Cards refatorados (FiltersCard, LocationCard, NetworkModeCard)
//      usam o primitive
//   4. Padrão anti-friction: cards usando primitive não usam mais
//      `text-drift-muted/30` (hint invisível em Velatura)
//
// Allowlist temporária: cards ainda não refatorados ficam em
// PENDING_REFACTOR_ALLOWLIST. Cada refactor remove 1 entry (ratchet).
//
// Convergente com pattern dos outros LOCK_VIA_TEST do repo
// (design-system-primitives-conformance, drift-alert-api, etc.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PRIMITIVE_FILE = 'src/components/UI/SettingExplainer.tsx'
const PRIMITIVE_SRC = readFileSync(PRIMITIVE_FILE, 'utf8')
const CARDS_SRC = readFileSync('src/components/Settings/SettingsCards.tsx', 'utf8')

// Cards refatorados (devem usar o primitive)
const REFACTORED_CARDS = [
  'FiltersCard',
  'LocationCard',
  'NetworkModeCard',
] as const

// Cards ainda NÃO refatorados — phase 2+ remove cada um do allowlist
// (ratchet). Adicionar a essa lista exige justificativa no PR.
const PENDING_REFACTOR_ALLOWLIST = new Set([
  'MapViewCard',
  'BlobsCard',
  'PeersCard',
  'DiagnosticCard',
  'PermissionsCard',
  'SovereigntyCard',
])

describe('SettingExplainer — primitive API', () => {
  it('exporta componente + tipo SettingLevel', () => {
    expect(PRIMITIVE_SRC).toMatch(/export\s+function\s+SettingExplainer/)
    expect(PRIMITIVE_SRC).toMatch(/export\s+type\s+SettingLevel/)
    expect(PRIMITIVE_SRC).toMatch(/export\s+interface\s+SettingExplainerProps/)
  })

  it('props canônicas declaradas (label/description/impact/defaultExplained/reversible/level/warning/reference/children)', () => {
    const requiredProps = [
      'label:',
      'description:',
      'impact\\?:',
      'defaultExplained\\?:',
      'reversible\\?:',
      'level\\?:',
      'warning\\?:',
      'reference\\?:',
      'children:',
    ]
    for (const prop of requiredProps) {
      expect(PRIMITIVE_SRC, `prop "${prop}" não encontrada`).toMatch(
        new RegExp(prop),
      )
    }
  })

  it('warning destrutivo usa drift-bury (cor semântica)', () => {
    // Quando warning prop é passada, render usa drift-bury color
    expect(PRIMITIVE_SRC).toMatch(/warning &&[\s\S]*drift-bury/)
  })

  it('level=advanced render badge visível', () => {
    expect(PRIMITIVE_SRC).toMatch(/level === 'advanced'/)
    expect(PRIMITIVE_SRC).toMatch(/avançado/)
  })

  it('NÃO usa text-drift-muted/30 em JSX (hint invisível em Velatura)', () => {
    // Strip block comments antes do match — docstring do primitive cita
    // o anti-pattern e isso é legítimo (referência educacional).
    const stripped = PRIMITIVE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).not.toMatch(/text-drift-muted\/30/)
  })
})

describe('Settings cards refatorados — usam o primitive', () => {
  it.each(REFACTORED_CARDS)('%s renderiza <SettingExplainer>', (cardName) => {
    // Localiza export function e verifica que tem SettingExplainer
    // dentro do bloco da função.
    // Sem flag 'm' — queremos end-of-STRING, não end-of-line ($).
    const re = new RegExp(
      `export\\s+function\\s+${cardName}[\\s\\S]*?(?=\\nexport\\s+function|$)`,
    )
    const match = CARDS_SRC.match(re)
    expect(match, `${cardName} não encontrado em SettingsCards.tsx`).not.toBeNull()
    expect(
      match![0],
      `${cardName} não usa <SettingExplainer>`,
    ).toMatch(/<SettingExplainer/)
  })

  it('cards refatorados removeram text-drift-muted/30 (hint invisível)', () => {
    // Anti-pattern: hint micro `text-drift-muted/30` que sumia em
    // Velatura. Cards refatorados pelo primitive não devem usar.
    for (const cardName of REFACTORED_CARDS) {
      const re = new RegExp(
        `export\\s+function\\s+${cardName}[\\s\\S]*?(?=export\\s+function|$)`,
        'm',
      )
      const match = CARDS_SRC.match(re)
      if (!match) continue
      expect(
        match[0],
        `${cardName} ainda usa text-drift-muted/30 (anti-pattern)`,
      ).not.toMatch(/text-drift-muted\/30/)
    }
  })
})

describe('Settings cards — ratchet pendente', () => {
  // Allowlist temporária — cada refactor futuro remove 1 entry. Test
  // documenta progresso e força que cards refatorados saiam do bag.
  it('cards refatorados não estão na PENDING_REFACTOR_ALLOWLIST', () => {
    for (const card of REFACTORED_CARDS) {
      expect(
        PENDING_REFACTOR_ALLOWLIST.has(card),
        `${card} foi refatorado mas ainda está em PENDING_REFACTOR_ALLOWLIST. Remover do allowlist.`,
      ).toBe(false)
    }
  })

  it('PENDING_REFACTOR_ALLOWLIST documenta cards ainda non-refactored', () => {
    // Snapshot pra rastreio de progresso. Quando lista chegar a 0,
    // virar enforce duro (todo Settings card precisa SettingExplainer).
    expect(PENDING_REFACTOR_ALLOWLIST.size).toBeGreaterThan(0)
    expect(PENDING_REFACTOR_ALLOWLIST.size).toBeLessThanOrEqual(6)
  })
})
