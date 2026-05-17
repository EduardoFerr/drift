// Section header usage conformance — LOCK_VIA_TEST DRY.
//
// Source: SectionHeader extract em [680a7c6] 2026-05-17 (Marshall HIMYM
// audit Tier 1 #1). 6 cópias inline foram migradas pro primitive em
// UI/SectionHeader.tsx. Este test trava regressão futura — se alguém
// re-introduzir o pattern inline em Card/Settings/Profile, falha.
//
// Heurística: assinatura class do header antigo (`rounded-2xl border
// border-drift-border/40 bg-drift-surface/50 px-5 py-3.5`) é específica
// o suficiente pra distinguir de outros patterns. Whitelist:
// UI/SectionHeader.tsx (primitive itself).

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const WHITELIST = new Set([
  'src/components/UI/SectionHeader.tsx',
])

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full.replace(/\\/g, '/'))
  }
  return acc
}

describe('SectionHeader DRY — não duplicar pattern do primitive', () => {
  it('pattern de section header (rounded-2xl border-drift-border/40 bg-drift-surface/50 + px-5 py-{3.5,4,5}) só em UI/SectionHeader', () => {
    const violations: string[] = []
    // Pattern ASSINATURA de section header: 3 classes base + padding
    // específico px-5 py-{3.5,4,5}. Tab containers usam mesmas 3 base
    // mas terminam em `p-1`/`p-1.5` (excluídos).
    // FP-resistant: regex captura linha inteira pra confirmar shape.
    const re =
      /rounded-2xl\s+border\s+border-drift-border\/40\s+bg-drift-surface\/50[^"]*\bpx-5\s+py-(?:3\.5|4|5)\b/
    for (const file of walk('src/components')) {
      if (WHITELIST.has(file)) continue
      const content = readFileSync(file, 'utf8')
      // Strip comments
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      // Whitelist por comentário inline (JS // ou JSX block /*)
      if (/(?:\/\/|\/\*)\s*section-header-audit:\s*ok/.test(content)) continue
      if (re.test(stripped)) {
        violations.push(`${file} — section header pattern duplicado, use <SectionHeader title=...>`)
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: import { SectionHeader } from '../UI/SectionHeader' e substituir o <div> ad-hoc.`,
    ).toEqual([])
  })
})
