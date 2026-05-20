// Menu Detalhado wiring conformance — LOCK_VIA_TEST.
//
// Source: Phase 6 settings friction (2026-05-19/20). User pivotou
// `show_advanced_settings` binário pra 5 flags granulares. Cada flag
// tem que estar WIRED em algum lugar — senão é dead pref, regressão.
//
// Cobre:
//   1. SettingExplainer consome 2 flags (show_details + show_manifesto)
//      ✅ já coberto em tests/setting-explainer-conformance.test.ts
//   2. SuaLenteCard consome 3 flags (how_it_works + algorithm + manifesto)
//   3. PostViewer consome 1 flag (action_labels)
//   4. HomeEmpty/skeleton wiring (feedLoaded gate)
//   5. MenuDetailCard expõe 5 toggles (1 por flag)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SUA_LENTE = readFileSync(
  'src/components/Settings/SuaLenteCard.tsx',
  'utf8',
)
const POST_VIEWER = readFileSync(
  'src/components/Post/PostViewer.tsx',
  'utf8',
)
const APP = readFileSync('src/App.tsx', 'utf8')
const CARDS = readFileSync(
  'src/components/Settings/SettingsCards.tsx',
  'utf8',
)

describe('SuaLenteCard — consome 3 flags do Menu Detalhado', () => {
  it('menu_detail_show_how_it_works controla expansão default de ComoFuncionaCollapse', () => {
    expect(SUA_LENTE).toMatch(/menu_detail_show_how_it_works/)
    // Hook usado pra inicializar defaultOpen do collapse
    expect(SUA_LENTE).toMatch(
      /usePrefsStore[\s\S]*?menu_detail_show_how_it_works/,
    )
  })

  it('menu_detail_show_algorithm gateia parágrafo "Cálculo (PageRank)"', () => {
    expect(SUA_LENTE).toMatch(/menu_detail_show_algorithm/)
    // Render condicional do parágrafo PageRank
    const stripped = SUA_LENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/showAlgorithm &&[\s\S]*?PageRank/)
  })

  it('menu_detail_show_manifesto gateia parágrafo Manifesto §24', () => {
    expect(SUA_LENTE).toMatch(/menu_detail_show_manifesto/)
    const stripped = SUA_LENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/showManifesto &&[\s\S]*?Manifesto/)
  })
})

describe('PostViewer ActionsFan — consome menu_detail_show_action_labels', () => {
  it('flag controla render dos spans de label nos items', () => {
    expect(POST_VIEWER).toMatch(/menu_detail_show_action_labels/)
    // Variável showLabels usada em conditional render
    expect(POST_VIEWER).toMatch(/const showLabels[\s\S]*?usePrefsStore/)
    // 2 conditional renders (neutralItems + destructiveItems)
    const stripped = POST_VIEWER.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    const showLabelsRenders = stripped.match(/\{showLabels &&/g) ?? []
    expect(showLabelsRenders.length).toBeGreaterThanOrEqual(2)
  })

  it('aria-label do button continua sempre presente (a11y intacta sem labels)', () => {
    // Mesmo com labels off, screen reader precisa do aria-label
    expect(POST_VIEWER).toMatch(/aria-label={item\.label}/)
  })
})

describe('HomeEmpty skeleton — feedLoaded gate (Barney+Robin Hyp #2)', () => {
  it('App.tsx tem condicional !feedLoaded → DriftSkeleton', () => {
    expect(APP).toMatch(/!feedLoaded/)
    // Skeleton renderizado quando posts vazios MAS ainda carregando
    const stripped = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/!feedLoaded[\s\S]*?DriftSkeleton/)
  })

  it('feedLoaded=true cai em HomeEmpty (estado real vazio, não loading)', () => {
    const stripped = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    // Pattern: !feedLoaded ? skeleton : <HomeEmpty>
    expect(stripped).toMatch(/!feedLoaded\s*\?[\s\S]*?<HomeEmpty/)
  })
})

describe('MenuDetailCard — expõe 5 toggles (1 por flag)', () => {
  // Cada SettingExplainer wraps um Toggle pro pref correspondente
  const FLAGS = [
    'menu_detail_show_details',
    'menu_detail_show_manifesto',
    'menu_detail_show_how_it_works',
    'menu_detail_show_algorithm',
    'menu_detail_show_action_labels',
  ] as const

  it.each(FLAGS)('toggle %s presente em MenuDetailCard', (flag) => {
    const cardMatch = CARDS.match(
      /export\s+function\s+MenuDetailCard[\s\S]*?(?=\nexport\s+function|$)/,
    )
    expect(cardMatch).not.toBeNull()
    expect(cardMatch![0]).toMatch(new RegExp(flag))
  })

  it('MenuDetailCard usa AccordionGroup defaultOpen="first"', () => {
    const cardMatch = CARDS.match(
      /export\s+function\s+MenuDetailCard[\s\S]*?(?=\nexport\s+function|$)/,
    )
    expect(cardMatch).not.toBeNull()
    expect(cardMatch![0]).toMatch(/<AccordionGroup\b[\s\S]*?defaultOpen="first"/)
  })
})

describe('Anti-regression — flags devem ser PERSISTIDAS em prefs.ts', () => {
  it('lib/prefs.ts tem deserialize case para todas as 5 flags', () => {
    const PREFS = readFileSync('src/lib/prefs.ts', 'utf8')
    const flags = [
      'menu_detail_show_details',
      'menu_detail_show_manifesto',
      'menu_detail_show_how_it_works',
      'menu_detail_show_algorithm',
      'menu_detail_show_action_labels',
    ]
    for (const flag of flags) {
      expect(PREFS, `case '${flag}' faltando em prefs.ts`).toMatch(
        new RegExp(`case '${flag}'`),
      )
    }
  })

  it('UserPrefs schema tem defaults declarados pra todas', () => {
    const DRIFT_TYPES = readFileSync('src/types/drift.ts', 'utf8')
    const defaults = [
      'menu_detail_show_details: true', // ON (essencial)
      'menu_detail_show_manifesto: false',
      'menu_detail_show_how_it_works: false',
      'menu_detail_show_algorithm: false',
      'menu_detail_show_action_labels: true', // ON (discoverability)
    ]
    for (const d of defaults) {
      expect(DRIFT_TYPES).toMatch(d)
    }
  })
})
