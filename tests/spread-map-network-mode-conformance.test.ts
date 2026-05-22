// SpreadMap network mode — LOCK_VIA_TEST conformance.
//
// Source: Satoshi+Ted maps audit 2026-05-21. Modo `network` adicionado
// pra fechar gap semântico (user pensava que "global" era "minha rede"
// mas é agregação global). Network filtra spreads por follows do user.
//
// Cobre:
//   1. Type `SpreadMapMode` declarado e usado consistentemente
//   2. SQL `network` faz IN (SELECT following_pub FROM follows WHERE follower_pub = ?)
//   3. SQL `network` NÃO toca em lens_edges, posts.score, reports (scope-limited)
//   4. UI ModeToggle tem 3 botões (post + global + network)
//   5. ModeBtn `network` é disabled quando anônimo
//   6. Empty states distintos (anônimo / sem follows / sem GPS na rede)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HOOK = readFileSync('src/hooks/useSpreadMap.ts', 'utf8')
const MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

describe('SpreadMap network mode — type system', () => {
  it('declares SpreadMapMode type with 3 values', () => {
    expect(HOOK).toMatch(
      /export type SpreadMapMode\s*=\s*'post'\s*\|\s*'global'\s*\|\s*'network'/,
    )
  })

  it('SpreadMap.tsx importa SpreadMapMode (não declara inline)', () => {
    expect(MAP).toMatch(
      /import\s*\{[^}]*SpreadMapMode[^}]*\}\s*from\s*['"][^'"]*useSpreadMap['"]/,
    )
    // Não deve ter type literal 'post' | 'global' inline (single SoT)
    expect(MAP).not.toMatch(/'post'\s*\|\s*'global'\s*\|\s*'network'/)
  })
})

describe('SpreadMap network mode — SQL scope (Satoshi)', () => {
  it('buildNetworkData query usa IN (SELECT following_pub FROM follows)', () => {
    expect(HOOK).toMatch(
      /spreader_pub\s+IN\s*\(\s*SELECT\s+following_pub\s+FROM\s+follows\s+WHERE\s+follower_pub\s*=\s*\?\s*\)/,
    )
  })

  it('buildNetworkData NÃO faz JOIN com lens_edges (scope-limited)', () => {
    const match = HOOK.match(
      /async function buildNetworkData[\s\S]*?^}/m,
    )
    expect(match, 'buildNetworkData function not found').not.toBeNull()
    const body = match![0]
    expect(body, 'NÃO pode tocar em lens_edges').not.toMatch(/lens_edges/)
    expect(body, 'NÃO pode tocar em posts.score').not.toMatch(/p\.score|posts\.score/)
    expect(body, 'NÃO pode tocar em reports').not.toMatch(/\bFROM\s+reports\b/)
  })

  it('buildNetworkData usa LIMIT 2000 (mesmo cap do global)', () => {
    const match = HOOK.match(
      /async function buildNetworkData[\s\S]*?^}/m,
    )
    expect(match![0]).toMatch(/LIMIT\s+2000/)
  })
})

describe('SpreadMap network mode — hook signature', () => {
  it('useSpreadMap aceita 3 modes', () => {
    expect(HOOK).toMatch(/mode:\s*SpreadMapMode\s*=\s*'post'/)
  })

  it('hook re-fetch on followsVersion change (network reflete state atual)', () => {
    expect(HOOK).toMatch(/followsVersion/)
    expect(HOOK).toMatch(/useFollowsStore.*following\.size/)
  })

  it('hook retorna empty pra mode network sem activeNpub (anônimo)', () => {
    expect(HOOK).toMatch(
      /mode\s*===\s*'network'\s*&&\s*!activeNpub/,
    )
  })
})

describe('SpreadMap network mode — UI ModeToggle', () => {
  it('ModeToggle renderiza 3 ModeBtn', () => {
    // Captura ModeToggle até começar próxima `function ` declaration
    const toggleMatch = MAP.match(/function ModeToggle[\s\S]*?(?=\nfunction )/m)
    expect(toggleMatch).not.toBeNull()
    const body = toggleMatch![0]
    expect(body).toMatch(/onModeChange\('post'\)/)
    expect(body).toMatch(/onModeChange\('global'\)/)
    expect(body).toMatch(/onModeChange\('network'\)/)
  })

  it('ModeBtn network é disabled quando !activeNpub', () => {
    const toggleMatch = MAP.match(/function ModeToggle[\s\S]*?(?=\nfunction )/m)
    expect(toggleMatch![0]).toMatch(/networkDisabled\s*=\s*!activeNpub/)
    expect(toggleMatch![0]).toMatch(/disabled=\{networkDisabled\}/)
  })

  it('ModeBtn suporta prop disabled + title (a11y)', () => {
    expect(MAP).toMatch(/disabled\?:\s*boolean/)
    expect(MAP).toMatch(/title\?:\s*string/)
    expect(MAP).toMatch(/aria-pressed=\{active\}/)
  })
})

describe('SpreadMap global como rede social geográfica (Satoshi+Ted plan E)', () => {
  it('SpreadMapData declara field `nodes: GlobalNode[]`', () => {
    const types = readFileSync('src/types/drift.ts', 'utf8')
    expect(types).toMatch(/export interface GlobalNode/)
    expect(types).toMatch(/npub:\s*string/)
    expect(types).toMatch(/spreadCount:\s*number/)
    expect(types).toMatch(/nodes:\s*GlobalNode\[\]/)
  })

  it('buildGlobalNodes dedupa por spreader_pub + sort desc por count', () => {
    expect(HOOK).toMatch(/function buildGlobalNodes/)
    expect(HOOK).toMatch(/seen\.set\(npub/)
    expect(HOOK).toMatch(/existing\.spreadCount\s*\+=\s*1/)
    expect(HOOK).toMatch(/sort\(\(a,\s*b\)\s*=>\s*b\.spreadCount\s*-\s*a\.spreadCount\)/)
  })

  it('SELECT global/network inclui spreader_pub na query', () => {
    // VirtualArcRow precisa expor spreader_pub
    expect(HOOK).toMatch(/spreader_pub:\s*string/)
    expect(HOOK).toMatch(/s\.spreader_pub\s+AS\s+spreader_pub/)
  })

  it('buildPostData retorna nodes: [] (dedup não faz sentido em post único)', () => {
    const postMatch = HOOK.match(/async function buildPostData[\s\S]*?(?=\n\/\/)/m)
    expect(postMatch).not.toBeNull()
    expect(postMatch![0]).toMatch(/nodes:\s*\[\]/)
  })

  it('GlobalModeMap renderiza ScatterplotLayer social-nodes', () => {
    expect(MAP).toMatch(/id:\s*['"]social-nodes['"]/)
    expect(MAP).toMatch(/Math\.sqrt\(d\.count\)/)
    expect(MAP).toMatch(/socialNodes\.length\s*>\s*0/)
  })

  it('stats label mostra "N pessoas" quando há nodes dedupados', () => {
    expect(MAP).toMatch(/data\.nodes\.length === 1 \? 'pessoa' : 'pessoas'/)
  })
})

describe('SpreadMap K=1 doxx defense (Satoshi devsec C 2026-05-21)', () => {
  it('hook exporta isUserSoloSpreader pure helper', () => {
    expect(HOOK).toMatch(/export function isUserSoloSpreader\b/)
  })

  it('helper retorna false quando activeNpub null (anônimo)', () => {
    // Pattern check: precisa de early return pra !activeNpub
    expect(HOOK).toMatch(/if\s*\(\s*!activeNpub\s*\|\|\s*!data\s*\)\s*return false/)
  })

  it('helper checa totalSpreads === 1 + firstSpread.spreaderPub', () => {
    expect(HOOK).toMatch(/data\.totalSpreads\s*!==\s*1/)
    expect(HOOK).toMatch(/data\.firstSpread\?\.spreaderPub\s*===\s*activeNpub/)
  })

  it('SpreadMap renderiza SoloSpreaderWarning quando trigger ativo', () => {
    expect(MAP).toMatch(/import\s*\{[^}]*isUserSoloSpreader[^}]*\}/)
    expect(MAP).toMatch(/function SoloSpreaderWarning/)
    expect(MAP).toMatch(/showK1Warning\s*=\s*isUserSoloSpreader/)
  })

  it('Warning é dismissable via session state (useState, não persisted)', () => {
    expect(MAP).toMatch(/k1WarningDismissed.*useState\(false\)|useState<.*>\(false\)/)
    expect(MAP).toMatch(/setK1WarningDismissed\(true\)/)
  })

  it('Warning aparece APENAS em PostModeMap (não global/network)', () => {
    // GlobalModeMap não chama SoloSpreaderWarning nem usa
    // isUserSoloSpreader — só PostModeMap (modo onde K=1 faz sentido)
    const globalMatch = MAP.match(/function GlobalModeMap[\s\S]*?(?=\nfunction )/m)
    expect(globalMatch).not.toBeNull()
    expect(globalMatch![0]).not.toMatch(/SoloSpreaderWarning|isUserSoloSpreader/)
  })

  it('threat-model-maps.md existe + cobre 5 vetores', () => {
    const doc = readFileSync('Docs/threat-model-maps.md', 'utf8')
    expect(doc).toMatch(/K=1.*doxx|K=1-DOXX/i)
    expect(doc).toMatch(/Location disclosure|LD/i)
    expect(doc).toMatch(/Relay correlation|RC/i)
    expect(doc).toMatch(/Follow-graph leak/i)
    expect(doc).toMatch(/Trust coloration/i)
  })
})

describe('SpreadMap DRY — loadMapDeps shared (B refactor 2026-05-21)', () => {
  const DEPS = readFileSync('src/components/Feed/useMapDeps.ts', 'utf8')

  it('useMapDeps.ts exporta loadMapDeps async', () => {
    expect(DEPS).toMatch(/export async function loadMapDeps\(\)/)
  })

  it('loadMapDeps faz Promise.all dos 3 imports (maplibre + deck + layers)', () => {
    expect(DEPS).toMatch(/import\(['"]maplibre-gl['"]\)/)
    expect(DEPS).toMatch(/import\(['"]@deck\.gl\/mapbox['"]\)/)
    expect(DEPS).toMatch(/import\(['"]\.\/spreadMapLayers['"]\)/)
  })

  it('SpreadMap PostMode + GlobalMode chamam loadMapDeps (sem duplicar imports)', () => {
    const loadDepsCalls = MAP.match(/await loadMapDeps\(\)/g) ?? []
    // PostModeMap + GlobalModeMap = 2 call sites mínimo
    expect(loadDepsCalls.length).toBeGreaterThanOrEqual(2)
    // SpreadMap NÃO pode mais importar maplibre-gl direto (ficou em useMapDeps)
    expect(MAP).not.toMatch(/import\(['"]maplibre-gl['"]\)/)
  })
})

describe('SpreadMap network mode — empty states', () => {
  it('network + anônimo: placeholder "modo rede desativado"', () => {
    expect(MAP).toMatch(/modo rede desativado/)
  })

  it('network + sem follows: placeholder "sua rede está vazia"', () => {
    expect(MAP).toMatch(/sua rede está vazia/)
  })

  it('network + follows mas sem GPS: placeholder específico', () => {
    expect(MAP).toMatch(/sua rede sem GPS por enquanto/)
  })

  it('PostMode + global mode: copy original preservada (zero regression)', () => {
    // Backward compat — defesa contra regressão em modos existentes
    expect(MAP).toMatch(/sem dados de localização globais/)
    expect(MAP).toMatch(/GPS desativado nas suas configurações/)
  })
})
