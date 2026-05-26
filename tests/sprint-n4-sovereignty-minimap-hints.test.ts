// Sprint N+4 P1.9 + P1.10 — CARTO sovereignty banner + mini-map close hint
// LOCK_VIA_TEST.
//
// Source: Lily Sprint N+4 P1.9/P1.10 (Satoshi A4 + A6 follow-up audit
// 2026-05-26). Em 1 commit consolidado.
//
// Item 1.9 — CARTO sovereignty banner proeminente:
//   - HINT_RULES contém 'carto-tile-sovereignty' (id estável)
//   - SpreadMap MapShell renderiza HintChip via getHintRule
//   - SpreadMap aceita prop `onOpenTileSettings` (callback CTA)
//   - App.tsx passa onOpenTileSettings → push SovereigntyCard
//   - Gate: hide quando user já tem `map_tile_url_template` custom
//     (sinaliza escolha consciente, não nag de novo)
//
// Item 1.10 — mini-map close hint via HintChip:
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
const APP = readFileSync('src/App.tsx', 'utf8')

describe('Sprint N+4 P1.9 — CARTO sovereignty banner via HintChip', () => {
  it('HINT_RULES contém "carto-tile-sovereignty" com shape canônica', () => {
    const rule = getHintRule('carto-tile-sovereignty')
    expect(rule).toBeDefined()
    expect(rule?.id).toBe('carto-tile-sovereignty')
    expect(typeof rule?.title).toBe('string')
    expect(rule?.title.length).toBeGreaterThan(0)
    expect(typeof rule?.body).toBe('function')
  })

  it('rule.body menciona Soberania (caminho user pra Settings)', () => {
    const rule = getHintRule('carto-tile-sovereignty')
    expect(rule).toBeDefined()
    if (!rule) return
    const node = rule.body({ onOpenIdentity: () => {} })
    // Smoke: renderiza sem throw, retorna ReactNode (object/string)
    expect(['object', 'string']).toContain(typeof node)
    // body source inclui referência ao caminho Settings
    const bodySrc = rule.body.toString()
    expect(bodySrc).toMatch(/Soberania/i)
    expect(bodySrc).toMatch(/§17|§28/) // manifesto refs
  })

  it('SpreadMap aceita prop onOpenTileSettings (interface)', () => {
    expect(SPREADMAP).toMatch(/onOpenTileSettings\s*\?:\s*\(\)\s*=>\s*void/)
  })

  it('SpreadMap MapShell importa HintChip + getHintRule', () => {
    expect(SPREADMAP).toMatch(/from\s+['"]\.\.\/UI\/HintChip['"]/)
    expect(SPREADMAP).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/guidance['"]/)
    expect(SPREADMAP).toMatch(/getHintRule\(['"]carto-tile-sovereignty['"]\)/)
  })

  it('SpreadMap MapShell renderiza <HintChip ... /> condicionalmente', () => {
    // Render condicional — não sempre. Caller (App.tsx MapOverlay) gates
    // adicionais via prop + usingCustomTiles.
    expect(SPREADMAP).toMatch(/<HintChip\b/)
    // Gate: showCartoHint depende de onOpenTileSettings + !usingCustomTiles
    expect(SPREADMAP).toMatch(/showCartoHint/)
    expect(SPREADMAP).toMatch(/usingCustomTiles/)
  })

  it('App.tsx MapOverlay passa onOpenTileSettings → push sovereignty', () => {
    expect(APP).toMatch(/onOpenTileSettings\s*=\s*\{/)
    // Callback fecha map + abre Soberania (mesma pattern do
    // onOpenLocationSettings)
    expect(APP).toMatch(/pushLayer\(\{\s*id:\s*['"]sovereignty['"]/)
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
  // Garantia que HINT_RULES expandiu corretamente (era 2, agora 4).
  // Quebra explícita se alguém remover hint canônico previously shipped.
  it('mantém os 2 hints canônicos pre-existentes', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).toContain('tab-dots-meaning')
    expect(ids).toContain('backup-after-post')
  })

  it('adiciona os 2 hints novos do Sprint N+4', () => {
    const ids = HINT_RULES.map((r) => r.id)
    expect(ids).toContain('carto-tile-sovereignty')
    expect(ids).toContain('mini-map-close')
  })

  it('cada novo hint segue shape canônica (id slug + title non-empty + body factory)', () => {
    const RULE_ID_SLUG = /^[a-z0-9][a-z0-9-]*$/
    for (const id of ['carto-tile-sovereignty', 'mini-map-close']) {
      const rule = getHintRule(id)
      expect(rule).toBeDefined()
      if (!rule) continue
      expect(rule.id).toMatch(RULE_ID_SLUG)
      expect(rule.title.length).toBeGreaterThan(0)
      expect(typeof rule.body).toBe('function')
      // body invokes sem throw
      expect(() => rule.body({ onOpenIdentity: () => {} })).not.toThrow()
    }
  })
})
