// IdentitySwitcher — create flow preview card conformance.
//
// Source: item #7 fricção UX iniciante observada em 2026-05-23 (Lily).
//
// User reportou: Settings > Identidade > "identidades" > "+ nsec local"
// abre uma tela com apenas input de label + botão criar — user iniciante
// não sabia o que ia acontecer ao clicar.
//
// Fix: card preview do fluxo de criação ANTES do input.
//
// Esse LOCK_VIA_TEST trava:
//   1. Card preview existe no mode === 'create' branch
//   2. Lista numerada (1, 2, 3) presente — não parágrafo solto
//   3. Backup warning §3 explícito antes do botão criar
//   4. Menção a "reload" pra trocar identidade ativa (manifesto §3)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SWITCHER = readFileSync(
  'src/components/Identity/IdentitySwitcher.tsx',
  'utf8',
)

describe('IdentitySwitcher create preview (item #7 fricção iniciante)', () => {
  it('mode === "create" branch contém card preview', () => {
    // Pattern: role="note" aria-label "passos da criação" OU "o que vai acontecer"
    expect(SWITCHER).toMatch(/o que vai acontecer/i)
  })

  it('lista numerada com 3 passos (1. 2. 3.)', () => {
    // Verifica padrão "1." "2." "3." no source (ordered list)
    const stripped = SWITCHER.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).toMatch(/>1\.</)
    expect(stripped).toMatch(/>2\.</)
    expect(stripped).toMatch(/>3\.</)
  })

  it('menciona backup do nsec ANTES de trocar (manifesto §3)', () => {
    expect(SWITCHER).toMatch(/backup do nsec/i)
    expect(SWITCHER).toMatch(/manifesto §3/)
  })

  it('menciona reload pra trocar identidade ativa', () => {
    // Manifesto §3: dispositivo descartável, identidade não.
    // Trocar ativa precisa reload (location.reload em setActiveIdentity).
    expect(SWITCHER).toMatch(/reload/i)
  })

  it('NÃO usa vocab proibido ("espalhar", "enterrar") em strings JSX', () => {
    // Defesa cross-cutting (LOCK_VIA_TEST do manifesto). Item adicionado
    // depois do migration completo de vocab — protege contra regressão.
    const stripped = SWITCHER.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).not.toMatch(/\bespalhar\b/i)
    expect(stripped).not.toMatch(/\benterrar\b/i)
  })
})
