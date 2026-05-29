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
// Item 1.10 — mini-map close hint via HintChip (mantido):
//   - HINT_RULES contém 'mini-map-close' (id estável)
//   - PostViewer renderiza HintChip via getHintRule (não localStorage)
//   - Sem fragmentação de state — dismiss × persistente em
//     capabilities_dismissed bag (manifesto §28: SQLite local)
//   - Anti-regressão: localStorage 'drift.minimap.openCount' removido

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

describe('Sprint N+4 P1.10 — mini-map close hint via HintChip', () => {
  it('HINT_RULES contém "mini-map-close" com shape canônica', () => {
    const rule = getHintRule('mini-map-close')
    expect(rule).toBeDefined()
    expect(rule?.id).toBe('mini-map-close')
    expect(typeof rule?.title).toBe('string')
    expect(rule?.title.length).toBeGreaterThan(0)
    expect(typeof rule?.body).toBe('function')
  })

  it('rule.title contém símbolo 🗺 (associação visual com botão)', () => {
    const rule = getHintRule('mini-map-close')
    expect(rule?.title).toMatch(/🗺/)
  })

  it('PostViewer importa HintChip + getHintRule', () => {
    expect(POSTVIEWER).toMatch(/from\s+['"]\.\.\/UI\/HintChip['"]/)
    expect(POSTVIEWER).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/guidance['"]/)
    expect(POSTVIEWER).toMatch(/getHintRule\(['"]mini-map-close['"]\)/)
  })

  it('PostViewer renderiza <HintChip ... /> pra mini-map-close', () => {
    expect(POSTVIEWER).toMatch(/<HintChip\b/)
    // Render condicional — só quando showMap=true (chip dentro do
    // showMap AnimatePresence block).
    expect(POSTVIEWER).toMatch(/miniMapCloseRule/)
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
  it('mantém os hints canônicos vivos (backup-after-post + mini-map-close)', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).toContain('backup-after-post')
    expect(ids).toContain('mini-map-close')
  })

  it('hints removidos em bug #2 não estão mais presentes', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).not.toContain('tab-dots-meaning')
    expect(ids).not.toContain('carto-tile-sovereignty')
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
