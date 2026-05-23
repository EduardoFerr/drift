/**
 * FeedTabs — a11y / visual conformance (LOCK_VIA_TEST).
 *
 * Source: Marshall review 2026-05-22, bugs B1/B2/B6 identificados em
 * revisão visual no localhost.
 *
 * - B1: dot vermelho não pode aparecer na tab ATIVA (era visível em
 *   todas as 3 tabs simultaneamente porque bumpUnseenCount incrementa
 *   as 3 + markFeedSeen só zerava a ativa quando user re-clicava).
 * - B2: WCAG 4.1.2 — tabs devem ter role/aria-selected/role=tablist
 *   pra screen readers anunciarem estado selecionado corretamente.
 * - B6: active-state visual único = underline animado (m.span). Tab
 *   button NÃO pode ter border / outline / ring-offset que crie
 *   aparência de "box outline" concorrendo com o underline.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FEED_TABS = readFileSync('src/components/Feed/FeedTabs.tsx', 'utf8')

describe('FeedTabs — a11y/visual conformance', () => {
  // B2 — WAI-ARIA tab pattern
  it('container das tabs tem role="tablist"', () => {
    expect(FEED_TABS).toMatch(/role=["']tablist["']/)
  })

  it('cada tab button tem role="tab"', () => {
    expect(FEED_TABS).toMatch(/role=["']tab["']/)
  })

  it('tab button expõe aria-selected={active}', () => {
    expect(FEED_TABS).toMatch(/aria-selected=\{active\}/)
  })

  // B1 — dot indicator não na tab ativa
  it('dot indicator não aparece na tab ativa (unseen forçado a 0 quando active)', () => {
    // Heurística: o prop `unseen` passado ao FeedTabBtn deve depender
    // do estado active da tab (curto-circuita pra 0 quando ativa).
    expect(FEED_TABS).toMatch(
      /unseen=\{tab\s*===\s*t\.id\s*\?\s*0\s*:\s*unseenByTab\[t\.id\]\}/,
    )
  })

  // B6 — active-state único = underline
  it('não usa border-2 / border-b-2 como indicador de active (só underline animado via m.span)', () => {
    // Active branch do FeedTabBtn não pode introduzir border classes.
    // Buscamos por classes Tailwind de border espessa só no template
    // condicional do active (heurística: `active ? '...border...'`).
    const activeBranch = FEED_TABS.match(/active\s*\?\s*'([^']*)'/)
    expect(activeBranch).not.toBeNull()
    if (activeBranch) {
      expect(activeBranch[1]).not.toMatch(/border-(2|4|b-2|b-4)/)
      expect(activeBranch[1]).not.toMatch(/\boutline\b/)
      expect(activeBranch[1]).not.toMatch(/\bring-2\b/)
    }
  })

  it('focus ring usa ring-inset (sem ring-offset) — evita aparência de box outline', () => {
    expect(FEED_TABS).toMatch(/focus-visible:ring-inset/)
    expect(FEED_TABS).not.toMatch(/focus-visible:ring-offset-1/)
  })

  it('mantém um único indicador animado (m.span com bg-drift-accent2)', () => {
    // Garantia de que o underline indicator permanece como único
    // active-state visual no container.
    expect(FEED_TABS).toMatch(/m\.span[\s\S]*?bg-drift-accent2/)
  })
})
