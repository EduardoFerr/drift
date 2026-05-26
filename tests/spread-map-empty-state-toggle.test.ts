// SpreadMap empty states — ModeToggle coexiste (LOCK_VIA_TEST).
//
// User feedback 2026-05-26: ao clicar em NETWORK no MapOverlay sem
// follows, user via empty state "SUA REDE ESTÁ VAZIA" e o toggle
// POST/GLOBAL/NETWORK desaparecia — única saída era FECHAR no header.
// Refactor wrapper renderEmpty() agora envolve Placeholder + ModeToggle
// quando caller passa onModeChange (MapOverlay sim, mini-map embedded
// no PostViewer não).
//
// Defesas:
//   1. Existência do helper renderEmpty (anti-regressao do pattern)
//   2. Gate onModeChange aplicado dentro do wrapper (mini-map fixed
//      mode=post sem toggle preservado)
//   3. Todos os 6 caminhos de early return passam por renderEmpty
//   4. Estrutura visual: relative wrapper + Placeholder h-full + toggle

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

describe('SpreadMap empty state — renderEmpty helper (user feedback 2026-05-26)', () => {
  it('declara helper renderEmpty dentro de SpreadMap', () => {
    expect(MAP).toMatch(
      /const renderEmpty = \(\s*placeholder:\s*React\.ReactNode/,
    )
  })

  it('renderEmpty envolve placeholder em <div className="relative …">', () => {
    expect(MAP).toMatch(
      /<div className=\{`relative \$\{className\}`\}>[\s\S]*?\{placeholder\}/,
    )
  })

  it('renderEmpty inclui ModeToggle condicional ao onModeChange', () => {
    // Pattern: {onModeChange && (<ModeToggle mode={mode} onModeChange={onModeChange} />)}
    const match = MAP.match(
      /const renderEmpty[\s\S]*?(?=\n  if \(loading\))/m,
    )
    expect(match, 'renderEmpty body not found').not.toBeNull()
    const body = match![0]
    expect(body).toMatch(/\{onModeChange &&/)
    expect(body).toMatch(/<ModeToggle\s+mode=\{mode\}\s+onModeChange=\{onModeChange\}/)
  })
})

describe('SpreadMap empty state — todos os early returns passam por renderEmpty', () => {
  // Anti-regressão: cada caminho de empty state deve usar o wrapper
  // que inclui o ModeToggle. Se algum return <Placeholder ... /> direto
  // for re-introduzido em SpreadMap (não em PostModeMap/GlobalModeMap),
  // este teste falha.

  it('early return loading usa renderEmpty', () => {
    expect(MAP).toMatch(/if \(loading\)\s*\{[\s\S]*?return renderEmpty\(/)
  })

  it('early return error usa renderEmpty', () => {
    expect(MAP).toMatch(/if \(error\)\s*\{[\s\S]*?return renderEmpty\(/)
  })

  it('early return network anônimo usa renderEmpty', () => {
    const block = MAP.match(/if \(!activeNpub\)\s*\{[\s\S]*?\}/m)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/return renderEmpty\(/)
  })

  it('early return network sem follows usa renderEmpty', () => {
    const block = MAP.match(/if \(followsCount === 0\)\s*\{[\s\S]*?\}/m)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/return renderEmpty\(/)
  })

  it('early return GPS off + mode=post usa renderEmpty', () => {
    const block = MAP.match(
      /if \(granularity === 'off' && mode === 'post'\)\s*\{[\s\S]*?\n {4}\}/m,
    )
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/return renderEmpty\(/)
  })

  it('early return final (hasGeometry false fallback) usa renderEmpty', () => {
    // Captura o último return antes do split global/post (linha que segue
    // o "DRIFTs deste post ainda não têm tag location" body).
    expect(MAP).toMatch(
      /DRIFTs deste post ainda não têm tag location[\s\S]{0,300}?return renderEmpty\(/,
    )
  })

  it('SpreadMap (top-level) NÃO contém return <Placeholder direto (sempre via renderEmpty)', () => {
    // Captura o corpo de SpreadMap até a primeira function helper interna.
    const fn = MAP.match(/export function SpreadMap\([\s\S]*?(?=\n\/\/ ─{3,} PostModeMap)/m)
    expect(fn, 'SpreadMap function not found').not.toBeNull()
    const body = fn![0]
    // Em SpreadMap top-level, todo Placeholder vem dentro de renderEmpty(...)
    // — pattern `return <Placeholder` direto sinalizaria regressão.
    expect(body).not.toMatch(/return\s+<Placeholder/)
  })
})

describe('SpreadMap empty state — gate onModeChange (mini-map preservado)', () => {
  // Caller MapOverlay (NavBar entry) passa onModeChange={setMapMode}.
  // Caller mini-map embedded no PostViewer NÃO passa onModeChange
  // (mode='post' fixed). ModeToggle só renderiza quando onModeChange
  // não-undefined — gate preservado mesmo dentro de empty states.

  it('PostViewer mini-map NÃO passa onModeChange pra SpreadMap', () => {
    // PostViewer renderiza SpreadMap inline pra mini-map (botão 🗺 no
    // post). Não deve passar onModeChange — mode é sempre 'post'.
    const PV = readFileSync('src/components/Post/PostViewer.tsx', 'utf8')
    // Pattern: encontra <SpreadMap ... /> no PostViewer e verifica que
    // onModeChange não está entre os props.
    const matches = PV.match(/<SpreadMap[\s\S]*?\/>/g) ?? []
    expect(matches.length, 'PostViewer deve renderizar SpreadMap').toBeGreaterThan(0)
    for (const m of matches) {
      expect(m, 'mini-map embedded não pode passar onModeChange').not.toMatch(/onModeChange/)
    }
  })

  it('App.tsx MapOverlay PASSA onModeChange={setMapMode} pra SpreadMap', () => {
    const APP = readFileSync('src/App.tsx', 'utf8')
    // Pattern explícito no MapOverlay
    expect(APP).toMatch(/onModeChange=\{setMapMode\}/)
  })
})
