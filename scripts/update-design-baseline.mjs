#!/usr/bin/env node
/**
 * scripts/update-design-baseline.mjs
 *
 * Recompute `tests/design-system-baseline.json` from current source
 * tree. Counts non-drift Tailwind color tokens per file (regex grep,
 * same pattern as `tests/design-system-conformance.test.ts`).
 *
 * Usage:
 *   node scripts/update-design-baseline.mjs [--init] [--check]
 *
 *   --init   Write baseline from scratch (used once, Fase 1 setup).
 *   --check  Compare against existing baseline; exit 1 if any file's
 *            count went UP. Use as a CI sanity check between
 *            conformance test and codemod runs.
 *
 * Default (no flag): print diff vs existing baseline + write new file.
 *
 * Why two flags vs one: `--init` accepts arbitrary count (no ratchet
 * floor); default refuses to update if any count went up (ratchet only
 * goes down). Spec: `Docs/rfcs/2026-05-rfc-token-enforcement.md` §3.3.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'tests', 'design-system-baseline.json')

// Same regex used by the conformance test. Keep these synced.
const BLOCKED_COLOR_RE =
  /(?<![\w-])(?:text|bg|border|ring|divide|from|to|via|placeholder|caret|accent|decoration|outline|fill|stroke|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

// Whitelist (paths that don't count). Mirrors eslint.config.js + RFC §2.4.
const WHITELIST_PREFIXES = [
  'src/components/UI/',
  'src/components/Boot/',
  'src/components/Post/SwipeHandler.tsx',
]

function isWhitelisted(rel) {
  for (const p of WHITELIST_PREFIXES) {
    if (rel === p || rel.startsWith(p)) return true
  }
  return false
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full, out)
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function countOffenders(file) {
  const src = readFileSync(file, 'utf8')
  const stripped = stripComments(src)
  // Re-instantiate regex for fresh lastIndex.
  const re = new RegExp(BLOCKED_COLOR_RE.source, 'g')
  const matches = stripped.match(re)
  return matches ? matches.length : 0
}

function scanAll() {
  const files = []
  walk(SRC, files)
  const counts = {}
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/')
    if (isWhitelisted(rel)) continue
    const n = countOffenders(f)
    if (n > 0) counts[rel] = n
  }
  return counts
}

function loadBaseline() {
  try {
    const raw = readFileSync(BASELINE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function format(counts) {
  return {
    _comment:
      'Snapshot de offenses por arquivo (non-drift Tailwind colors). ' +
      'Conformance test (tests/design-system-conformance.test.ts) falha se count subir. ' +
      'Update via scripts/update-design-baseline.mjs após codemod batch. Nunca subir manualmente.',
    _generated: new Date().toISOString().slice(0, 10),
    _total: Object.values(counts).reduce((a, b) => a + b, 0),
    files: Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
}

function main() {
  const argv = process.argv.slice(2)
  const isInit = argv.includes('--init')
  const isCheck = argv.includes('--check')

  const current = scanAll()
  const baseline = loadBaseline()

  if (isInit) {
    writeFileSync(BASELINE, JSON.stringify(format(current), null, 2) + '\n')
    console.log(`[init] wrote ${Object.keys(current).length} files, ` +
      `${Object.values(current).reduce((a, b) => a + b, 0)} offenders total → ${BASELINE}`)
    return
  }

  if (!baseline) {
    console.error('No baseline found. Run with --init first.')
    process.exit(1)
  }

  let regressed = false
  const all = new Set([...Object.keys(baseline.files), ...Object.keys(current)])
  for (const file of [...all].sort()) {
    const before = baseline.files[file] ?? 0
    const after = current[file] ?? 0
    if (after > before) {
      console.log(`✗ ${file}: ${before} → ${after} (+${after - before}, REJECT)`)
      regressed = true
    } else if (after < before) {
      console.log(`✓ ${file}: ${before} → ${after} (-${before - after}, OK)`)
    }
  }

  if (regressed) {
    console.error('\nBaseline ratchet violated — counts went UP for one or more files.')
    console.error('Either fix the regression or run with --init if a deliberate (rare) raise.')
    process.exit(1)
  }

  if (isCheck) {
    console.log('\n[check] no regressions — baseline still valid.')
    return
  }

  writeFileSync(BASELINE, JSON.stringify(format(current), null, 2) + '\n')
  console.log(`\n[update] wrote ${Object.keys(current).length} files, ` +
    `${Object.values(current).reduce((a, b) => a + b, 0)} offenders total → ${BASELINE}`)
}

main()
