// Sprint N+4 P1.10 — mini-map close hint LOCK_VIA_TEST.
//
// Source: Lily Sprint N+4 P1.10 (Satoshi A6 follow-up audit 2026-05-26).
//
// Histórico: este arquivo cobria também P1.9 (CARTO sovereignty banner
// via HintChip). O chip CARTO foi REMOVIDO em 2026-05-28 (bug #2: excesso
// de hints no boot) — era redundante com o footer attribution, que já
// disclosa "tiles externos" + tooltip apontando Configurações ▸ Mapa.
// Os asserts de P1.9 viraram anti-regressão (garantem que o chip NÃO
// volta). Ver tests `bug2-hint-noise-cleanup` abaixo.
//
// V-1 (Satoshi sweep 2026-05-28): o chip 'mini-map-close' também foi
// REMOVIDO — renderizava top-right do mini-map embedded (PostViewer)
// colidindo ilegível com os 3 action buttons (⋮/💬/🗺 em top-4). O botão
// 🗺 já é toggle auto-explicativo (aria-pressed + aria-label "fechar mapa
// de spread"). Reincidência do bug #2 (hints viram ruído sobreposto).
// Os asserts do item 1.10 invertem-se em anti-regressão: garantem que a
// rule + o HintChip mini-map NÃO voltam ao código.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { HINT_RULES, getHintRule } from '../src/lib/guidance'

const SPREADMAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')
const POSTVIEWER = readFileSync('src/components/Post/PostViewer.tsx', 'utf8')

describe('bug #2 (2026-05-28) — CARTO sovereignty HintChip removido', () => {
  it('HINT_RULES NÃO contém "carto-tile-sovereignty" (chip ruidoso removido)', () => {
    expect(getHintRule('carto-tile-sovereignty')).toBeUndefined()
    expect(HINT_RULES.map((r) => r.id)).not.toContain('carto-tile-sovereignty')
  })

  it('SpreadMap NÃO renderiza HintChip CARTO nem thread onOpenTileSettings', () => {
    const stripped = SPREADMAP
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/carto-tile-sovereignty/)
    expect(stripped).not.toMatch(/onOpenTileSettings/)
    expect(stripped).not.toMatch(/showCartoHint/)
  })

  it('footer attribution preserva disclosure legal + sovereignty nudge', () => {
    // Obrigação OSM/CARTO + awareness sovereignty seguem no rodapé.
    expect(SPREADMAP).toMatch(/OpenStreetMap/)
    expect(SPREADMAP).toMatch(/CARTO/)
    expect(SPREADMAP).toMatch(/CARTO_SOVEREIGNTY_NUDGE/)
  })
})

describe('V-1 (2026-05-28) — mini-map close HintChip removido (colisão)', () => {
  it('HINT_RULES NÃO contém "mini-map-close" (chip colidia com action buttons)', () => {
    expect(getHintRule('mini-map-close')).toBeUndefined()
    expect(HINT_RULES.map((r) => r.id)).not.toContain('mini-map-close')
  })

  it('PostViewer NÃO renderiza HintChip mini-map nem usa getHintRule/miniMapCloseRule', () => {
    const stripped = POSTVIEWER
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/miniMapCloseRule/)
    expect(stripped).not.toMatch(/getHintRule/)
    expect(stripped).not.toMatch(/<HintChip\b/)
  })

  it('botão 🗺 segue sendo toggle auto-explicativo (aria-pressed + aria-label fechar)', () => {
    // Substitui o chip: o estado de toggle é comunicado por a11y no
    // próprio botão, sem chip flutuante colidindo.
    expect(POSTVIEWER).toMatch(/aria-pressed=\{showMap\}/)
    expect(POSTVIEWER).toMatch(/fechar mapa de spread/)
  })

  it('anti-regressão: localStorage drift.minimap.openCount removido', () => {
    // Strip comments — mantém memória histórica documentada sem trigger
    const stripped = POSTVIEWER
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/drift\.minimap\.openCount/)
    expect(stripped).not.toMatch(/setMapHintVisible|mapHintVisible/)
  })
})

describe('Sprint N+4 — HINT_RULES extensibility preservada', () => {
  it('mantém o hint canônico vivo (backup-after-post)', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).toContain('backup-after-post')
  })

  it('hints removidos (bug #2 + V-1) não estão mais presentes', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).not.toContain('tab-dots-meaning')
    expect(ids).not.toContain('carto-tile-sovereignty')
    expect(ids).not.toContain('mini-map-close')
  })

  it('cada hint vivo segue shape canônica (id slug + title non-empty + body factory)', () => {
    const RULE_ID_SLUG = /^[a-z0-9][a-z0-9-]*$/
    for (const rule of HINT_RULES) {
      expect(rule.id).toMatch(RULE_ID_SLUG)
      expect(rule.title.length).toBeGreaterThan(0)
      expect(typeof rule.body).toBe('function')
      expect(() => rule.body({ onOpenIdentity: () => {} })).not.toThrow()
    }
  })
})
