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
