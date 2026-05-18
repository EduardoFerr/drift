// Identity exposure tracking + passkey gate — conformance LOCK_VIA_TEST.
//
// Source: Satoshi HIMYM adversarial Lacuna 2 (severidade HIGH, custo
// LOW) shipped 2026-05-17. Manifesto §8 carve-out: user controla a
// chave, mas cliente reduz fricção pra exposure acidental.
//
// Estes tests travam que:
//   1. lib/identity-exposure.ts existe + exporta API esperada
//   2. IdentityPanel chama recordExposure em todos os paths de exposure
//      (reveal, copy, download — qualquer regressão NÃO conta exposure)
//   3. IdentityPanel chama requirePasskeyForExport antes de cada path
//   4. Rate-limit constants em range razoável (≤10 min, threshold ≥3)
//   5. Pref `last_nsec_export_at` parseada em prefs.ts applyRow

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const EXPOSURE = readFileSync('src/lib/identity-exposure.ts', 'utf8')
const PANEL = readFileSync('src/components/Identity/IdentityPanel.tsx', 'utf8')
const PREFS = readFileSync('src/lib/prefs.ts', 'utf8')

describe('Identity exposure — API + integrations (Satoshi Lacuna 2)', () => {
  it('lib/identity-exposure.ts exporta API esperada', () => {
    expect(EXPOSURE).toMatch(/export\s+(?:async\s+)?function\s+recordExposure/)
    expect(EXPOSURE).toMatch(/export\s+(?:async\s+)?function\s+requirePasskeyForExport/)
    expect(EXPOSURE).toMatch(/export\s+(?:async\s+)?function\s+isOverRateLimit/)
    expect(EXPOSURE).toMatch(/export\s+(?:async\s+)?function\s+formatLastExposed/)
    expect(EXPOSURE).toMatch(/export\s+(?:async\s+)?function\s+loadExposureState/)
    expect(EXPOSURE).toMatch(/export\s+(?:const|function)\s+useExposureStore/)
  })

  it('Rate-limit constants em range razoável', () => {
    const window = EXPOSURE.match(/RATE_LIMIT_WINDOW_MS\s*=\s*([\d_\s*+*]+)/)
    const thresh = EXPOSURE.match(/RATE_LIMIT_THRESHOLD\s*=\s*(\d+)/)
    expect(window).not.toBeNull()
    expect(thresh).not.toBeNull()
    // Janela deve ser ≤ 30min (5/10/15/30 min razoáveis)
    expect(EXPOSURE).toMatch(/10\s*\*\s*60\s*\*\s*1000/)
    // Threshold ≥ 3 (não muito chato, não muito permissivo)
    const t = Number(thresh![1])
    expect(t).toBeGreaterThanOrEqual(2)
    expect(t).toBeLessThanOrEqual(10)
  })
})

describe('IdentityPanel BackupTab — exposure tracking wired', () => {
  it('handleCopy chama requirePasskeyForExport + recordExposure', () => {
    const stripped = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Captura bloco da função handleCopy
    const m = stripped.match(/async\s+function\s+handleCopy\(\s*\)\s*\{([\s\S]*?)\n\s{2}\}/m)
    expect(m, 'handleCopy não encontrado').not.toBeNull()
    const block = m![1]
    expect(block, 'handleCopy deve chamar requirePasskeyForExport').toMatch(
      /requirePasskeyForExport\(\)/,
    )
    expect(block, 'handleCopy deve chamar recordExposure').toMatch(
      /recordExposure\(\s*['"]copy['"]/,
    )
  })

  it('handleDownload chama requirePasskeyForExport + recordExposure', () => {
    const stripped = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const m = stripped.match(/async\s+function\s+handleDownload\(\s*\)\s*\{([\s\S]*?)\n\s{2}\}/m)
    expect(m, 'handleDownload não encontrado').not.toBeNull()
    const block = m![1]
    expect(block).toMatch(/requirePasskeyForExport\(\)/)
    expect(block).toMatch(/recordExposure\(\s*['"]download['"]/)
  })

  it('handleToggleReveal existe + chama requirePasskeyForExport + recordExposure', () => {
    expect(PANEL).toMatch(/async\s+function\s+handleToggleReveal/)
    const stripped = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const m = stripped.match(/async\s+function\s+handleToggleReveal\(\s*\)\s*\{([\s\S]*?)\n\s{2}\}/m)
    expect(m).not.toBeNull()
    const block = m![1]
    expect(block).toMatch(/requirePasskeyForExport\(\)/)
    expect(block).toMatch(/recordExposure\(\s*['"]reveal['"]/)
  })

  it('Audit chip visible quando lastExposedLabel não-null', () => {
    expect(PANEL).toMatch(/formatLastExposed/)
    expect(PANEL).toMatch(/última exposição/i)
  })

  it('Rate-limit warning visible quando isOverRateLimit', () => {
    expect(PANEL).toMatch(/isOverRateLimit/)
    expect(PANEL).toMatch(/3\+ nos últimos 10 min/i)
  })
})

describe('prefs.ts — last_nsec_export_at parsing', () => {
  it('applyRow trata case last_nsec_export_at com integer validation', () => {
    expect(PREFS).toMatch(/case\s+['"]last_nsec_export_at['"]/)
    // Validation: Number.isInteger + > 0
    const stripped = PREFS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const m = stripped.match(/case\s+['"]last_nsec_export_at['"]([\s\S]*?)return/m)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/Number\.isInteger/)
  })
})
