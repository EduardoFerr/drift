// WCAG contrast conformance — detecta combos de alpha duplo (bg + text)
// sobre `backdrop-blur` que praticamente sempre falham AA 4.5:1.
//
// Source: Marshall HIMYM audit 2026-05-17 — "regra de 2 camadas":
//   - Chrome (NavBar, banner, modal): bg-drift-{bg,surface}/95 mínimo
//   - Overlay sobre conteúdo dinâmico (mapa, foto, post): alpha bg ≥ /90
//     E eliminar alpha no texto (`text-drift-muted` sem /N)
//
// O test escaneia src/components por classNames que combinem:
//   - backdrop-blur no mesmo elemento
//   - bg-drift-X/N com N ≤ 85
//   - text-drift-X/N com N ≤ 70
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

function findViolations(): string[] {
  const violations: string[] = []
  for (const file of walk('src/components')) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      if (!/backdrop-blur/.test(line)) continue
      // Whitelist: comment na linha atual ou linha imediatamente anterior
      if (/\/\/\s*wcag-audit:\s*ok/.test(line)) continue
      const prev = lines[i - 1] ?? ''
      if (/\/\/\s*wcag-audit:\s*ok/.test(prev)) continue

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

describe('WCAG contrast — backdrop-blur double-alpha combos', () => {
  it('não combina bg-drift-*/N≤85 com text-drift-*/N≤70 sob backdrop-blur', () => {
    const v = findViolations()
    expect(v, `\n${v.join('\n')}\nFix: elevar bg alpha pra /95 OU remover alpha do text. Whitelist via // wcag-audit: ok reason=...`).toEqual([])
  })
})
