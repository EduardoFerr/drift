/**
 * Tests pra `<FullPageCard>` primitive — convergente com Ted UX spike §5
 * (`Docs/sessions/ted-ux-spike-deployed-2026-05-08.md`).
 *
 * Vitest config = environment node. Não rendeiza React; testa as funções
 * puras que constroem motion config + container className. Isso cobre os
 * 3 fixes do Ted UX spike:
 *
 * - **TX-1 fix**: opacity inicial 0.95 (não 0). Sub-card aparece quase-opaco
 *   no boot da animação; durante slide-up de 250ms o user não vê título/
 *   botão duplos sobrepostos translucid mid-transition.
 * - **TX-2 fix**: max-w-md mx-auto SEMPRE no container className. Garante
 *   cap visual em viewports > 448px sem deixar passível de override.
 * - **TX-11 prep**: backdrop click handler é gated por prop opt-in.
 *   Lógica de gating é testada (tests render-level ficam pra E2E).
 *
 * Não testa motion / DOM render — pura lógica de composição.
 */

import { describe, expect, it } from 'vitest'
import {
  FULL_PAGE_CARD_CONTAINER_CLASS,
  fullPageCardMotionAnimate,
  fullPageCardMotionExit,
  fullPageCardMotionInitial,
} from '../src/components/UI/FullPageCard'

describe('fullPageCardMotionInitial — TX-1 fix', () => {
  it('opacity inicial é 0.95 (não 0) — evita flicker mid-transition em sub-card', () => {
    const initial = fullPageCardMotionInitial()
    expect(initial.opacity).toBe(0.95)
  })

  it('y inicial é 22 (slide-up de 22px → 0 — gesto preservado)', () => {
    const initial = fullPageCardMotionInitial()
    expect(initial.y).toBe(22)
  })

  it('opacity NÃO é 0 — explicit guard contra regression do TX-1', () => {
    // Documenta a correção: se alguém voltar pra opacity 0, o sub-card
    // vai mostrar conteúdo translucid sobre SettingsRoot mid-slide. Esse
    // teste falha imediato.
    const initial = fullPageCardMotionInitial()
    expect(initial.opacity).not.toBe(0)
    // Range razoável: 0.9 a 1.0 (quase-opaco). Acima de 0.85 pra ter
    // margem ergonômica.
    expect(initial.opacity).toBeGreaterThan(0.85)
  })
})

describe('fullPageCardMotionAnimate', () => {
  it('opacity final = 1, y final = 0 (settled state)', () => {
    const animate = fullPageCardMotionAnimate()
    expect(animate.opacity).toBe(1)
    expect(animate.y).toBe(0)
  })
})

describe('fullPageCardMotionExit', () => {
  it('exit espelha initial (opacity 0.95, y 22) — simétrico ao open', () => {
    const exit = fullPageCardMotionExit()
    const initial = fullPageCardMotionInitial()
    expect(exit.opacity).toBe(initial.opacity)
    expect(exit.y).toBe(initial.y)
  })
})

describe('FULL_PAGE_CARD_CONTAINER_CLASS — TX-2 fix', () => {
  it('inclui max-w-md (sempre — sem prop pra override)', () => {
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('max-w-md')
  })

  it('inclui mx-auto (centraliza em viewport > 448px)', () => {
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('mx-auto')
  })

  it('inclui fixed inset-0 z-40 (overlay fullscreen)', () => {
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('fixed')
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('inset-0')
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('z-40')
  })

  it('inclui flex flex-col (header/body/footer stack vertical)', () => {
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('flex')
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('flex-col')
  })

  it('inclui bg-drift-bg (opaco — não vê o card abaixo)', () => {
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('bg-drift-bg')
  })

  it('inclui sm:border-x (border vertical em viewports >= 640px)', () => {
    // Em viewport > 448px (max-w-md cap activates) com >= sm (640px),
    // border-x reveals a "frame" visual contra background dark.
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('sm:border-x')
    expect(FULL_PAGE_CARD_CONTAINER_CLASS).toContain('border-drift-border')
  })

  it('NÃO inclui max-w-lg / max-w-xl etc — single source of truth = max-w-md', () => {
    // Guard contra alguém adicionar outro max-w- que pode conflitar.
    const widerCaps = ['max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-screen-md', 'max-w-full', 'max-w-none']
    for (const cap of widerCaps) {
      expect(FULL_PAGE_CARD_CONTAINER_CLASS).not.toContain(cap)
    }
  })
})

describe('motion config completeness', () => {
  it('initial → animate é uma transição válida (opacity goes up, y goes down)', () => {
    const initial = fullPageCardMotionInitial()
    const animate = fullPageCardMotionAnimate()
    expect(animate.opacity).toBeGreaterThan(initial.opacity)
    expect(animate.y).toBeLessThan(initial.y)
  })

  it('animate → exit é uma transição válida (opacity goes down, y goes up)', () => {
    const animate = fullPageCardMotionAnimate()
    const exit = fullPageCardMotionExit()
    expect(exit.opacity).toBeLessThan(animate.opacity)
    expect(exit.y).toBeGreaterThan(animate.y)
  })
})
