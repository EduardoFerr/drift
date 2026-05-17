// WCAG contrast conformance — detecta combos de alpha duplo (bg + text)
// que praticamente sempre falham AA 4.5:1, em 3 vetores:
//
// 1. `backdrop-blur` elements (chrome, banner, modal)
// 2. `placeholder:` em <input> / <textarea> (form fields)
// 3. (futuro) `disabled:` states
//
// Source: Marshall HIMYM audit 2026-05-17 — "regra de 2 camadas":
//   - Chrome (NavBar, banner, modal): bg-drift-{bg,surface}/95 mínimo
//   - Overlay sobre conteúdo dinâmico (mapa, foto, post): alpha bg ≥ /90
//     E eliminar alpha no texto (`text-drift-muted` sem /N)
//   - Form fields (textarea/input): mesma regra aplica a `placeholder:`
//     (composição double-alpha bg/N + placeholder:text/M ≤70 falha AA
//     em velatura/light theme — ratio típico < 2:1)
//
// O test escaneia src/components por classNames que combinem:
//   - VETOR 1: backdrop-blur + bg-drift-X/N≤85 + text-drift-X/N≤70
//   - VETOR 2: placeholder:text-drift-X/N≤60 + bg-drift-X/N≤85 (input/textarea)
//
// Whitelist explícita: comentário `// wcag-audit: ok reason=...` na MESMA
// linha ou linha imediatamente acima.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

function hasWhitelist(lines: string[], i: number): boolean {
  const line = lines[i] ?? ''
  if (/\/\/\s*wcag-audit:\s*ok/.test(line)) return true
  const prev = lines[i - 1] ?? ''
  if (/\/\/\s*wcag-audit:\s*ok/.test(prev)) return true
  const prev2 = lines[i - 2] ?? ''
  if (/\/\/\s*wcag-audit:\s*ok/.test(prev2)) return true
  return false
}

function findBackdropBlurViolations(): string[] {
  const violations: string[] = []
  for (const file of walk('src/components')) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      if (!/backdrop-blur/.test(line)) continue
      if (hasWhitelist(lines, i)) continue

      const bgMatch = line.match(/bg-drift-\w+\/(\d{1,3})\b/)
      const textMatch = line.match(/text-drift-\w+\/(\d{1,3})\b/)
      if (!bgMatch || !textMatch) continue
      const bgAlpha = Number(bgMatch[1])
      const textAlpha = Number(textMatch[1])
      if (bgAlpha <= 85 && textAlpha <= 70) {
        violations.push(
          `${file}:${i + 1} — bg=/${bgAlpha} text=/${textAlpha} (combo duplo sob blur)`,
        )
      }
    }
  }
  return violations
}

function findPlaceholderViolations(): string[] {
  const violations: string[] = []
  for (const file of walk('src/components')) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      // Padrão Tailwind: `placeholder:text-drift-X/N`
      const phMatch = line.match(/placeholder:text-drift-\w+\/(\d{1,3})\b/)
      if (!phMatch) continue
      if (hasWhitelist(lines, i)) continue

      const phAlpha = Number(phMatch[1])
      // Placeholder com alpha ≤ 60 falha AA quase sempre, mesmo sem bg alpha
      // (text-muted base já é ~3:1 a 5:1; multiplica por 0.6 e cai pra ~2:1).
      // Threshold mais agressivo que vetor 1 porque placeholder não é texto
      // primary — mas precisa ser legível (WCAG 1.4.11 non-text contrast).
      if (phAlpha <= 60) {
        // Cross-check: tem bg/N≤85 também (double-alpha catastrófico)?
        const bgMatch = line.match(/bg-drift-\w+\/(\d{1,3})\b/)
        const bgInfo = bgMatch ? ` + bg=/${bgMatch[1]}` : ''
        violations.push(
          `${file}:${i + 1} — placeholder=/${phAlpha}${bgInfo} (placeholder ilegível em velatura)`,
        )
      }
    }
  }
  return violations
}

describe('WCAG contrast — backdrop-blur double-alpha combos', () => {
  it('não combina bg-drift-*/N≤85 com text-drift-*/N≤70 sob backdrop-blur', () => {
    const v = findBackdropBlurViolations()
    expect(
      v,
      `\n${v.join('\n')}\nFix: elevar bg alpha pra /95 OU remover alpha do text. Whitelist via // wcag-audit: ok reason=...`,
    ).toEqual([])
  })
})

describe('WCAG contrast — placeholder text alpha (form fields)', () => {
  it('não usa placeholder:text-drift-*/N≤60 (falha AA em velatura light theme)', () => {
    const v = findPlaceholderViolations()
    expect(
      v,
      `\n${v.join('\n')}\nFix: placeholder:text-drift-muted/70 mínimo (ou /85 pra velatura). Whitelist via // wcag-audit: ok reason=...`,
    ).toEqual([])
  })
})
