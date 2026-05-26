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

// Cards refatorados — TODOS os 9 cards Settings agora usam o primitive
// (Phase 2 completou em 2026-05-18). PENDING_REFACTOR_ALLOWLIST agora
// vazia — qualquer card NOVO ou regressão é falha imediata (enforce
// duro). Adicionar à allowlist exige justificativa no PR review.
const REFACTORED_CARDS = [
  'FiltersCard',
  'LocationCard',
  'NetworkModeCard',
  'MapViewCard',
  'BlobsCard',
  'PeersCard',
  'DiagnosticCard',
  'PermissionsCard',
  'SovereigntyCard',
] as const

const PENDING_REFACTOR_ALLOWLIST = new Set<string>([])

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

describe('SettingExplainer — Phase 6 menu detalhado (4 flags granulares)', () => {
  it('consome 2 flags via usePrefsStore: show_details + show_manifesto', () => {
    expect(PRIMITIVE_SRC).toMatch(/menu_detail_show_details/)
    expect(PRIMITIVE_SRC).toMatch(/menu_detail_show_manifesto/)
  })

  it('NÃO tem mais level=advanced gating (Phase 6 pivot removeu)', () => {
    const stripped = PRIMITIVE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    // Guard 'if (level === advanced && !showAdvanced) return null' removido
    expect(stripped).not.toMatch(/level === 'advanced'.*return null/s)
    // level prop ainda existe como visual badge (não gating)
    expect(stripped).toMatch(/level === 'advanced'/) // pra badge
  })

  it('UserPrefs schema tem 5 flags menu_detail_show_*', () => {
    const driftTypes = readFileSync('src/types/drift.ts', 'utf8')
    expect(driftTypes).toMatch(/menu_detail_show_details:\s*boolean/)
    expect(driftTypes).toMatch(/menu_detail_show_manifesto:\s*boolean/)
    expect(driftTypes).toMatch(/menu_detail_show_how_it_works:\s*boolean/)
    expect(driftTypes).toMatch(/menu_detail_show_algorithm:\s*boolean/)
    expect(driftTypes).toMatch(/menu_detail_show_action_labels:\s*boolean/)
    // Defaults: details + action_labels ON (discoverability),
    // outros OFF (jargão técnico opt-in)
    expect(driftTypes).toMatch(/menu_detail_show_details:\s*true/)
    expect(driftTypes).toMatch(/menu_detail_show_manifesto:\s*false/)
    expect(driftTypes).toMatch(/menu_detail_show_how_it_works:\s*false/)
    expect(driftTypes).toMatch(/menu_detail_show_algorithm:\s*false/)
    expect(driftTypes).toMatch(/menu_detail_show_action_labels:\s*true/)
  })

  it('prefs.ts deserializa todos 5 menu_detail flags', () => {
    const prefsSrc = readFileSync('src/lib/prefs.ts', 'utf8')
    expect(prefsSrc).toMatch(/case 'menu_detail_show_details'/)
    expect(prefsSrc).toMatch(/case 'menu_detail_show_manifesto'/)
    expect(prefsSrc).toMatch(/case 'menu_detail_show_how_it_works'/)
    expect(prefsSrc).toMatch(/case 'menu_detail_show_algorithm'/)
    expect(prefsSrc).toMatch(/case 'menu_detail_show_action_labels'/)
  })

  it('SettingsCards.tsx tem MenuDetailCard exportado com 5 explainers', () => {
    expect(CARDS_SRC).toMatch(/export\s+function\s+MenuDetailCard/)
    const cardMatch = CARDS_SRC.match(
      /export\s+function\s+MenuDetailCard[\s\S]*?(?=\nexport\s+function|$)/,
    )
    expect(cardMatch).not.toBeNull()
    const explainers = (cardMatch![0].match(/<SettingExplainer/g) ?? []).length
    expect(explainers).toBe(5)
  })

  it('ActionsFan.tsx consome menu_detail_show_action_labels', () => {
    // Extraído de PostViewer.tsx em Sprint N+2 P1.5 — primitive dedicado.
    const actionsFanSrc = readFileSync(
      'src/components/Post/ActionsFan.tsx',
      'utf8',
    )
    expect(actionsFanSrc).toMatch(/menu_detail_show_action_labels/)
  })

  it("App.tsx NÃO tem mais AdvancedToggle (Phase 6 substitui por menu-detalhado entry)", () => {
    const appSrc = readFileSync('src/App.tsx', 'utf8')
    expect(appSrc).not.toMatch(/function AdvancedToggle/)
    expect(appSrc).not.toMatch(/<AdvancedToggle\s*\/>/)
    // Em vez disso tem entry 'menu-detalhado' no SettingsTarget
    expect(appSrc).toMatch(/'menu-detalhado'/)
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

  it('PENDING_REFACTOR_ALLOWLIST vazia — enforce duro (Phase 2 completa)', () => {
    // Phase 2 completou em 2026-05-18 — todos os 9 cards refatorados.
    // Lista agora vazia = enforce duro: card NOVO sem SettingExplainer
    // falha CI imediatamente. Adicionar à allowlist exige justificativa
    // no PR review.
    expect(PENDING_REFACTOR_ALLOWLIST.size).toBe(0)
  })
})

describe('NetworkModeCard — warning gate (item #5 fricção iniciante)', () => {
  // LOCK_VIA_TEST 2026-05-25 — warning "REINICIA app" só pode aparecer
  // APÓS user interagir (clicar num radio diferente). Antes: warning
  // renderizava sempre, gerando ansiedade ao abrir a tela. Dialog de
  // confirmação já alerta sobre o reload no momento da ação destrutiva
  // — warning estático no SettingExplainer era ruído duplicado pré-
  // interação.
  //
  // Esse test é structural (source grep), não behavioral. Razão:
  // SettingsCards.tsx tem 10+ cards inter-relacionados; setup de render
  // isolado custaria muito. Pattern usado: tests/setting-explainer-
  // conformance já checa source structure.

  it('NetworkModeCard usa state hasInteracted', () => {
    expect(CARDS_SRC).toMatch(/hasInteracted/)
    expect(CARDS_SRC).toMatch(/setHasInteracted\(true\)/)
  })

  it('warning prop é gated por hasInteracted', () => {
    // Pattern: `{...(hasInteracted ? { warning: '…' } : {})}` ou
    // `warning={hasInteracted ? '…' : undefined}`. Aceita ambos.
    const gatedSpread = /hasInteracted\s*\?\s*\{\s*warning\s*:/
    const gatedTernary = /warning=\{hasInteracted\s*\?/
    expect(
      gatedSpread.test(CARDS_SRC) || gatedTernary.test(CARDS_SRC),
      'NetworkModeCard deve gatear warning prop com hasInteracted state',
    ).toBe(true)
  })

  it('warning string contém "REINICIA" (vocab esperado)', () => {
    // Não muda copy sem atualizar este test — protege regressão de
    // ofuscação acidental ("ATENÇÃO" genérico em vez de termo claro).
    expect(CARDS_SRC).toMatch(/REINICIA o app/)
  })
})
