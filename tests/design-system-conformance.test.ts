/**
 * Design system conformance — non-drift Tailwind color tokens are
 * fenced by a baseline ratchet. New code cannot introduce new offenders;
 * existing files cannot increase their count.
 *
 * Origem: peer review HIMYM round 3 — Marshall (schema/conformance).
 * Spec: `Docs/rfcs/2026-05-rfc-token-enforcement.md` §3.
 *
 * Pareia com a regra ESLint custom `drift/no-tailwind-non-drift-tokens`
 * (`eslint-rules/no-tailwind-non-drift-tokens.cjs`):
 *   - ESLint = preventivo (catch on write em IDE/CI lint).
 *   - Conformance test = auditoria (catch on test run em CI vitest +
 *     baseline-driven ratchet that only goes down).
 *
 * Mantém invariantes:
 *   1. Files novos NUNCA podem ter offenders (baseline implícito = 0).
 *   2. Files no baseline NUNCA podem aumentar count (ratchet down-only).
 *   3. Hot path (POST + Feed/PostCard + Compose) mantém piso atual e
 *      idealmente termina em 0 (Fase 2 codemod + Lily migration).
 *
 * Baseline regen: `npm run design:baseline:update` após codemod batches.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(__dirname, 'design-system-baseline.json')

/**
 * Path prefixes whose files are out of scope for this conformance —
 * design system primitives, boot pre-CSS-loaded, and SwipeHandler hex
 * dívida (design-system §2.5). Mirrors `eslint.config.js` whitelist
 * + `scripts/update-design-baseline.mjs` whitelist. Keep all three in
 * sync — drift = silent gap.
 */
const WHITELIST_PREFIXES = [
  'src/components/UI/',
  'src/components/Boot/',
  'src/components/Post/SwipeHandler.tsx',
]

/**
 * Same regex used by `scripts/update-design-baseline.mjs` and the
 * ESLint rule (in spirit). Matches `<prop>-<color>-<shade>` Tailwind
 * tokens for any non-drift core color scale.
 */
const BLOCKED_COLOR_RE =
  /(?<![\w-])(?:text|bg|border|ring|divide|from|to|via|placeholder|caret|accent|decoration|outline|fill|stroke|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function isWhitelisted(rel: string): boolean {
  for (const p of WHITELIST_PREFIXES) {
    if (rel === p || rel.startsWith(p)) return true
  }
  return false
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full, out)
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
}

function countOffenders(file: string): number {
  const stripped = stripComments(readFileSync(file, 'utf8'))
  const re = new RegExp(BLOCKED_COLOR_RE.source, 'g')
  const m = stripped.match(re)
  return m ? m.length : 0
}

function scanAll(): Record<string, number> {
  const files: string[] = []
  walk(SRC, files)
  const counts: Record<string, number> = {}
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/')
    if (isWhitelisted(rel)) continue
    const n = countOffenders(f)
    if (n > 0) counts[rel] = n
  }
  return counts
}

interface Baseline {
  _comment: string
  _generated: string
  _total: number
  files: Record<string, number>
}

describe('Design system conformance — non-drift Tailwind color tokens', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
  const current = scanAll()

  it('arquivos NOVOS (não no baseline) têm zero offenders', () => {
    const offenders: { file: string; count: number }[] = []
    for (const [file, count] of Object.entries(current)) {
      if (!(file in baseline.files)) {
        offenders.push({ file, count })
      }
    }
    expect(
      offenders,
      `Arquivos novos com tokens non-drift detectados. Use tokens drift-* (tailwind.config.js theme.extend.colors.drift). Hits:\n${offenders
        .map((o) => `  ${o.file}: ${o.count} offenders`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('arquivos no baseline não podem AUMENTAR count (ratchet down-only)', () => {
    const regressions: { file: string; before: number; after: number }[] = []
    for (const [file, baselineCount] of Object.entries(baseline.files)) {
      const actual = current[file] ?? 0
      if (actual > baselineCount) {
        regressions.push({ file, before: baselineCount, after: actual })
      }
    }
    expect(
      regressions,
      `Baseline ratchet violado. Counts subiram em arquivos pré-existentes. ` +
        `Use tokens drift-* OU rode \`npm run design:baseline:update\` se foi redução em outro arquivo.\n${regressions
          .map((r) => `  ${r.file}: ${r.before} → ${r.after} (+${r.after - r.before})`)
          .join('\n')}`,
    ).toEqual([])
  })

  it('baseline JSON está em sync com source tree (sem entradas zeradas órfãs)', () => {
    // Se uma migração reduziu count a zero, a entry deve sair do baseline
    // (não ficar como "0"). Detecta drift entre baseline e estado real.
    const stale: string[] = []
    for (const [file, count] of Object.entries(baseline.files)) {
      if (count === 0 && !(file in current)) {
        stale.push(file)
      }
    }
    expect(
      stale,
      `Baseline tem entries zeradas órfãs — rode \`npm run design:baseline:update\` para limpar:\n${stale
        .map((f) => `  ${f}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
