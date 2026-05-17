// Thread list-only conformance — LOCK_VIA_TEST.
//
// Source: cards-mode removido em [e51a4c3] 2026-05-17 a pedido do user.
// Este test trava regressão futura — se alguém re-introduzir
// viewMode/cards no ThreadView, falha imediato.
//
// Marshall HIMYM audit 2026-05-17: "LOCK enquanto fresh" — refactor
// recente sem test deixa janela pra regressão silenciosa.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const THREAD_VIEW = readFileSync('src/components/Post/ThreadView.tsx', 'utf8')
const THREAD_HEADER = readFileSync('src/components/Post/ThreadHeader.tsx', 'utf8')
const PREFS_TYPES = readFileSync('src/types/drift.ts', 'utf8')

describe('ThreadView — list-mode é único modo (cards-mode removido)', () => {
  it('ThreadView.tsx não referencia viewMode/cards-mode', () => {
    // Strip comments — historical comments podem mencionar
    const stripped = THREAD_VIEW
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Identifier `viewMode` em código ativo é violação
    expect(stripped, 'viewMode identifier não deve aparecer em ThreadView ativo').not.toMatch(
      /\bviewMode\b/,
    )
    // String literal 'cards' em código ativo é violação
    expect(stripped, "string 'cards' não deve aparecer em ThreadView ativo").not.toMatch(
      /['"]cards['"]/,
    )
  })

  it('ThreadView.tsx não importa SwipeHandler nem cursor-ops cards-mode', () => {
    // SwipeHandler era usado por cards-mode pra navegação ↑↓←→
    expect(THREAD_VIEW).not.toMatch(/from\s+['"]\.\/SwipeHandler['"]/)
    // ascend/descend/nextSibling/prevSibling de thread-cursor eram só
    // pra cards-mode (list-mode usa scroll nativo)
    expect(THREAD_VIEW).not.toMatch(/\bascend\b|\bdescend\b|\bnextSibling\b|\bprevSibling\b/)
  })

  it('ThreadHeader.tsx não tem viewMode prop nem toggle button', () => {
    expect(THREAD_HEADER).not.toMatch(/\bviewMode\b/)
    expect(THREAD_HEADER).not.toMatch(/\bonToggleViewMode\b/)
    expect(THREAD_HEADER).not.toMatch(/ThreadViewMode/)
  })

  it('types/drift.ts não exporta ThreadViewMode nem usa thread_view_mode em UserPrefs', () => {
    expect(PREFS_TYPES).not.toMatch(/export\s+type\s+ThreadViewMode/)
    expect(PREFS_TYPES).not.toMatch(/thread_view_mode\s*:\s*ThreadViewMode/)
  })
})
