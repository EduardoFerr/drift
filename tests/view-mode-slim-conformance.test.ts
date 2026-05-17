// View mode slim — conformance LOCK_VIA_TEST.
//
// Source: refactor 2026-05-17 a pedido do user. Long-press 5s no
// PostViewer mudou semantics:
//   - Antes: abria ModerationModal direto
//   - Agora: alterna modo padrão ⇄ modo slim (chrome hidden, card
//     ocupa toda viewport)
// Moderação foi movida pro ActionsFan como item `moderar`.
//
// Este test trava regressão futura — se alguém re-introduzir
// `setModerationOpen(true)` no setTimeout do long-press, falha.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const POST_VIEWER = readFileSync('src/components/Post/PostViewer.tsx', 'utf8')
const ACTIONS_FAN = readFileSync('src/lib/actions-fan.ts', 'utf8')

describe('Long-press 5s no PostViewer — semantics nova (slim toggle)', () => {
  it('handler do setTimeout LONG_PRESS_MS chama toggleSlim, NÃO setModerationOpen', () => {
    // Strip comments
    const stripped = POST_VIEWER
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Capture o bloco setTimeout LONG_PRESS_MS — heurística: bloco
    // entre `pressTimerRef.current = window.setTimeout` e o `, LONG_PRESS_MS)`.
    const m = stripped.match(
      /pressTimerRef\.current\s*=\s*window\.setTimeout\(([^]*?),\s*LONG_PRESS_MS\)/,
    )
    expect(m, 'bloco setTimeout LONG_PRESS_MS não encontrado').not.toBeNull()
    const block = m![1]
    // Deve chamar toggleSlim
    expect(block, 'long-press 5s deve chamar toggleSlim()').toMatch(/toggleSlim\(\)/)
    // NÃO deve chamar setModerationOpen (regressão da semantics antiga)
    expect(block, 'long-press 5s NÃO deve abrir moderação (use ActionsFan item moderar)').not.toMatch(
      /setModerationOpen\s*\(\s*true\s*\)/,
    )
  })

  it('useViewModeStore importado em PostViewer', () => {
    expect(POST_VIEWER).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/view-mode['"]/)
    expect(POST_VIEWER).toMatch(/toggleSlim/)
  })
})

describe('ActionsFan — item moderar shipped', () => {
  it('buildFanItems inclui key="moderar" pra posts de terceiros', () => {
    // Pattern do build: items.push({ key: 'moderar', ... })
    expect(ACTIONS_FAN).toMatch(/key:\s*['"]moderar['"]/)
  })

  it('FanHandlers tem onOpenModeration', () => {
    expect(ACTIONS_FAN).toMatch(/onOpenModeration\s*:\s*\(\)\s*=>\s*void/)
  })
})

describe('useViewModeStore — exports esperados', () => {
  it('view-mode.ts exporta toggleSlim + exitSlim + useViewModeStore', () => {
    const src = readFileSync('src/lib/view-mode.ts', 'utf8')
    expect(src).toMatch(/export\s+(?:const|function)\s+useViewModeStore/)
    expect(src).toMatch(/export\s+function\s+toggleSlim/)
    expect(src).toMatch(/export\s+function\s+exitSlim/)
  })
})
