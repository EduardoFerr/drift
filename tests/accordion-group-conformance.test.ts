/**
 * AccordionGroup conformance — LOCK_VIA_TEST.
 *
 * Source: Phase 4 settings friction (Ted HIMYM 2026-05-18). Primitive
 * extraído pra coordenar 1-aberto-por-vez entre SettingExplainers.
 *
 * Marshall lock: primitive shipped sem conformance é regressão esperando
 * acontecer. Cobre:
 *  1. Exports canônicos (AccordionGroup, useAccordionGroup, useAccordionMember)
 *  2. API contract preservada (defaultOpen 'first'|'none'|<id>, accordionId
 *     via slugify fallback)
 *  3. Settings cards multi-explainer envolvem em AccordionGroup
 *  4. Standalone usage (sem AccordionGroup parent) continua funcionando
 *     (back-compat 30+ uses fora de Settings)
 *  5. Acessibilidade WAI-ARIA Accordion pattern preservado
 *
 * Adicionar items advanced fica pra phase posterior se necessário
 * (smoke tests de comportamento requereriam jsdom mount, custoso).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PRIMITIVE_FILE = 'src/components/UI/AccordionGroup.tsx'
const PRIMITIVE_SRC = readFileSync(PRIMITIVE_FILE, 'utf8')
const EXPLAINER_SRC = readFileSync(
  'src/components/UI/SettingExplainer.tsx',
  'utf8',
)
const CARDS_SRC = readFileSync(
  'src/components/Settings/SettingsCards.tsx',
  'utf8',
)

describe('AccordionGroup — primitive exports + types', () => {
  it('exporta AccordionGroup component', () => {
    expect(PRIMITIVE_SRC).toMatch(/export\s+function\s+AccordionGroup\b/)
  })

  it('exporta useAccordionGroup hook (acesso ao contexto)', () => {
    expect(PRIMITIVE_SRC).toMatch(/export\s+function\s+useAccordionGroup\b/)
  })

  it('exporta useAccordionMember hook (auto-register + isOpen + toggle)', () => {
    expect(PRIMITIVE_SRC).toMatch(/export\s+function\s+useAccordionMember\b/)
  })

  it('exporta AccordionContext + AccordionGroupProps interface', () => {
    expect(PRIMITIVE_SRC).toMatch(/export\s+const\s+AccordionContext/)
    expect(PRIMITIVE_SRC).toMatch(/export\s+interface\s+AccordionGroupProps/)
  })
})

describe('AccordionGroup — API contract', () => {
  it("defaultOpen aceita 'first' | 'none' | <id>", () => {
    expect(PRIMITIVE_SRC).toMatch(
      /defaultOpen\?:\s*'first'\s*\|\s*'none'\s*\|\s*string/,
    )
  })

  it("defaultOpen default value é 'first'", () => {
    expect(PRIMITIVE_SRC).toMatch(/defaultOpen\s*=\s*'first'/)
  })

  it('useAccordionMember retorna { inGroup: true, isOpen, toggle } OR { inGroup: false }', () => {
    expect(PRIMITIVE_SRC).toMatch(/inGroup:\s*true/)
    expect(PRIMITIVE_SRC).toMatch(/inGroup:\s*false/)
    expect(PRIMITIVE_SRC).toMatch(/isOpen:\s*boolean/)
    expect(PRIMITIVE_SRC).toMatch(/toggle:\s*\(\)\s*=>\s*void/)
  })

  it('register é idempotente (firstSeen guard)', () => {
    // O register só seta openId se ainda não houve first seen E
    // defaultOpen='first'. Subsequentes são no-op.
    const stripped = PRIMITIVE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/defaultOpen !== 'first'/)
    expect(stripped).toMatch(/firstSeen !== null/)
  })
})

describe('AccordionGroup — Reusa primitives existentes', () => {
  it('NÃO importa framer-motion (usa Collapse CSS grid, sem JS animation)', () => {
    expect(PRIMITIVE_SRC).not.toMatch(/from\s+['"]framer-motion['"]/)
  })

  it('SettingExplainer importa Collapse + AccordionGroup', () => {
    expect(EXPLAINER_SRC).toMatch(
      /from\s+['"]\.\/AccordionGroup['"]/,
    )
    expect(EXPLAINER_SRC).toMatch(/from\s+['"]\.\/Collapse['"]/)
  })
})

describe('SettingExplainer — integração com AccordionGroup', () => {
  it('aceita prop accordionId opcional', () => {
    expect(EXPLAINER_SRC).toMatch(/accordionId\?:\s*string/)
  })

  it('fallback ao slugify(label) quando accordionId ausente', () => {
    expect(EXPLAINER_SRC).toMatch(/accordionId\s*\?\?\s*slugify\(label\)/)
  })

  it('useAccordionMember(id) chamado pra branch in-group vs standalone', () => {
    expect(EXPLAINER_SRC).toMatch(/useAccordionMember\(id\)/)
  })

  it('branch standalone preserved (back-compat com 30+ uses)', () => {
    // Quando !member.inGroup, render sempre-expanded
    const stripped = EXPLAINER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/!member\.inGroup/)
  })

  it('WAI-ARIA accordion pattern: h3>button aria-expanded aria-controls', () => {
    // Quando in-group, renderiza header como button dentro de h3 com
    // aria-expanded + aria-controls (acessibilidade)
    expect(EXPLAINER_SRC).toMatch(/aria-expanded={isOpen}/)
    expect(EXPLAINER_SRC).toMatch(/aria-controls={panelId}/)
    expect(EXPLAINER_SRC).toMatch(/role="region"/)
  })
})

describe('Settings cards — usam AccordionGroup nos cards multi-explainer', () => {
  const MULTI_EXPLAINER_CARDS = [
    'FiltersCard',
    'DiagnosticCard',
    'SovereigntyCard',
    'PeersCard',
    'MenuDetailCard',
  ] as const

  it.each(MULTI_EXPLAINER_CARDS)(
    '%s usa AccordionGroup com defaultOpen="first"',
    (cardName) => {
      const re = new RegExp(
        `export\\s+function\\s+${cardName}[\\s\\S]*?(?=\\nexport\\s+function|$)`,
      )
      const match = CARDS_SRC.match(re)
      expect(match, `${cardName} não encontrado`).not.toBeNull()
      expect(match![0]).toMatch(/<AccordionGroup\b/)
      expect(match![0]).toMatch(/defaultOpen="first"/)
    },
  )

  it('cards multi-explainer têm accordionId em CADA SettingExplainer dentro', () => {
    // Cada SettingExplainer dentro de AccordionGroup precisa de
    // accordionId pra coordenação (slug fallback funciona mas
    // explícito é mais auditável)
    for (const cardName of [
      'FiltersCard',
      'DiagnosticCard',
      'SovereigntyCard',
      'PeersCard',
      'MenuDetailCard',
    ]) {
      const re = new RegExp(
        `export\\s+function\\s+${cardName}[\\s\\S]*?(?=\\nexport\\s+function|$)`,
      )
      const match = CARDS_SRC.match(re)
      if (!match) continue
      const explainers = match[0].match(/<SettingExplainer\b/g) ?? []
      const accordionIds = match[0].match(/accordionId="/g) ?? []
      expect(
        accordionIds.length,
        `${cardName}: ${explainers.length} explainers mas ${accordionIds.length} accordionIds`,
      ).toBe(explainers.length)
    }
  })

  it('cards single-explainer NÃO usam AccordionGroup (standalone)', () => {
    // LocationCard, MapViewCard, NetworkModeCard, PermissionsCard,
    // BlobsCard têm só 1 SettingExplainer cada — standalone é mais
    // limpo (nada pra colapsar entre)
    const SINGLE_EXPLAINER_CARDS = [
      'LocationCard',
      'MapViewCard',
      'NetworkModeCard',
      'PermissionsCard',
      'BlobsCard',
    ] as const
    for (const cardName of SINGLE_EXPLAINER_CARDS) {
      const re = new RegExp(
        `export\\s+function\\s+${cardName}[\\s\\S]*?(?=\\nexport\\s+function|$)`,
      )
      const match = CARDS_SRC.match(re)
      if (!match) continue
      const accordionGroupCount = (
        match[0].match(/<AccordionGroup\b/g) ?? []
      ).length
      const explainerCount = (match[0].match(/<SettingExplainer\b/g) ?? []).length
      // Se tem 1 explainer e nenhum AccordionGroup, ok. Senão, sinal
      // de inconsistência.
      if (explainerCount === 1) {
        expect(
          accordionGroupCount,
          `${cardName} tem 1 explainer mas usa AccordionGroup desnecessário`,
        ).toBe(0)
      }
    }
  })
})
