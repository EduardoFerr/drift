#!/usr/bin/env node
/**
 * scripts/codemod-slate-to-drift.mjs
 *
 * Regex-based migration of non-drift Tailwind color tokens to drift-*
 * tokens. Per `Docs/rfcs/2026-05-rfc-token-enforcement.md` §6.
 *
 * Usage:
 *   node scripts/codemod-slate-to-drift.mjs --dry --files=path1 [path2 ...]
 *   node scripts/codemod-slate-to-drift.mjs --apply --files=path1 [path2 ...]
 *   node scripts/codemod-slate-to-drift.mjs --dry --batch=identity
 *
 * Batches:
 *   --batch=post-hot-path   POST + Feed/PostCard + Compose (sanity)
 *   --batch=identity        IdentityPanel + IdentitySwitcher
 *   --batch=onboarding      OnboardingOverlay
 *
 * Output:
 *   - per file: total mapped + ambiguous count
 *   - dry run prints unified diff style line changes
 *   - apply writes to disk only when --apply is set
 *   - exit 0 always (informational); humano revisa diff
 *
 * Cobertura limitada por design — RFC §6.4 documenta o que NÃO faz:
 *   - Não migra yellow/amber (sem token drift-warning ainda — Ted v0.8)
 *   - Não migra red-* genericamente (red é dúbio: pode ser bury role
 *     ou danger role — ambos vão pra drift-bury hoje, mas drift-danger
 *     pode existir em v0.8). Codemod pula red-* — humano decide.
 *   - Não migra opacity variants (slate-400/60) — muda visual.
 *   - Não migra hex literais.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

/**
 * Mapping unambiguous slate/gray/emerald → drift tokens.
 * Drift surface tokens: bg=#0c0c0b, surface=#15151a, border=#2a2a2e.
 * Drift type tokens: text=#f0f0ea, muted=#6b6b66.
 * Drift role tokens: spread=#34d399 (semantically green), bury=#f87171 (red).
 *
 * Numeric Tailwind shade → drift mapping based on perceptual closeness:
 *   bg-slate-900/950 → bg-drift-bg          (~near-black)
 *   bg-slate-800     → bg-drift-surface     (slightly lifted)
 *   bg-slate-700     → bg-drift-border      (border-tier surface)
 *   border-slate-*   → border-drift-border  (always)
 *   text-slate-100/200/300 → text-drift-text   (high-contrast type)
 *   text-slate-400/500/600/700 → text-drift-muted (low-contrast type)
 *   text-emerald-* / bg-emerald-* / border-emerald-* → drift-spread (role)
 *
 * Conservative: red-* / yellow-* / amber-* / orange-* deliberately
 * NOT mapped here — those carry semantic warning/danger meaning that
 * needs Ted v0.8 RFC tokens (drift-warning, drift-danger). Until
 * those land, treated as AMBIGUOUS (logged, left unchanged).
 */
const MAPPING = {
  // Surface — slate/gray/zinc/neutral/stone all collapse to drift surface tier
  'bg-slate-950': 'bg-drift-bg',
  'bg-slate-900': 'bg-drift-bg',
  'bg-slate-800': 'bg-drift-surface',
  'bg-slate-700': 'bg-drift-border',
  'bg-gray-950': 'bg-drift-bg',
  'bg-gray-900': 'bg-drift-bg',
  'bg-gray-800': 'bg-drift-surface',
  'bg-gray-700': 'bg-drift-border',
  'bg-zinc-900': 'bg-drift-bg',
  'bg-zinc-800': 'bg-drift-surface',
  'bg-neutral-900': 'bg-drift-bg',
  'bg-neutral-800': 'bg-drift-surface',
  'bg-stone-900': 'bg-drift-bg',
  'bg-stone-800': 'bg-drift-surface',

  // Borders — always drift-border
  'border-slate-900': 'border-drift-border',
  'border-slate-800': 'border-drift-border',
  'border-slate-700': 'border-drift-border',
  'border-slate-600': 'border-drift-border',
  'border-slate-500': 'border-drift-border',
  'border-gray-800': 'border-drift-border',
  'border-gray-700': 'border-drift-border',
  'border-gray-600': 'border-drift-border',
  'border-zinc-800': 'border-drift-border',
  'border-zinc-700': 'border-drift-border',
  'border-neutral-800': 'border-drift-border',

  // Type — high contrast (drift-text)
  'text-slate-50': 'text-drift-text',
  'text-slate-100': 'text-drift-text',
  'text-slate-200': 'text-drift-text',
  'text-slate-300': 'text-drift-text',
  'text-gray-100': 'text-drift-text',
  'text-gray-200': 'text-drift-text',
  'text-gray-300': 'text-drift-text',
  'text-zinc-100': 'text-drift-text',
  'text-zinc-200': 'text-drift-text',

  // Type — low contrast (drift-muted)
  'text-slate-400': 'text-drift-muted',
  'text-slate-500': 'text-drift-muted',
  'text-slate-600': 'text-drift-muted',
  'text-slate-700': 'text-drift-muted',
  'text-gray-400': 'text-drift-muted',
  'text-gray-500': 'text-drift-muted',
  'text-gray-600': 'text-drift-muted',
  'text-zinc-400': 'text-drift-muted',
  'text-zinc-500': 'text-drift-muted',

  // Role — spread (semantic green, kind 9079)
  'text-emerald-300': 'text-drift-spread',
  'text-emerald-400': 'text-drift-spread',
  'text-emerald-500': 'text-drift-spread',
  'text-emerald-600': 'text-drift-spread',
  'bg-emerald-400': 'bg-drift-spread',
  'bg-emerald-500': 'bg-drift-spread',
  'bg-emerald-600': 'bg-drift-spread',
  'border-emerald-400': 'border-drift-spread',
  'border-emerald-500': 'border-drift-spread',
  'border-emerald-700': 'border-drift-spread',

  // green-* shares emerald semantics in Drift (no separate token).
  'text-green-400': 'text-drift-spread',
  'text-green-500': 'text-drift-spread',
  'bg-green-500': 'bg-drift-spread',
  'border-green-500': 'border-drift-spread',
}

/**
 * Patterns to flag as AMBIGUOUS (no auto-rewrite). Logged for human
 * review. RFC §6.2 + §6.4.
 */
const AMBIGUOUS_PATTERNS = [
  // yellow/amber — sem token drift-warning ainda (Ted v0.8 RFC)
  /\b(?:text|bg|border|ring)-(?:yellow|amber)-\d{2,3}\b/g,
  // red-* — pode ser bury role OU danger UI; humano decide
  /\b(?:text|bg|border|ring)-red-\d{2,3}\b/g,
  // orange-* — sem token; provavelmente warning
  /\b(?:text|bg|border|ring)-orange-\d{2,3}\b/g,
  // opacity variants em qualquer slate/gray (text-slate-400/60)
  /\b(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone)-\d{2,3}\/\d+\b/g,
  // emerald-* com opacity (bg-emerald-500/20)
  /\b(?:text|bg|border)-emerald-\d{2,3}\/\d+\b/g,
]

/**
 * Files batch presets. Aliases for common groupings.
 */
const BATCHES = {
  'post-hot-path': [
    'src/components/Post/PostViewer.tsx',
    'src/components/Post/CommentCard.tsx',
    'src/components/Post/ThreadView.tsx',
    'src/components/Post/ThreadHeader.tsx',
    'src/components/Post/ReplySheet.tsx',
    'src/components/Post/SubpostLayout.tsx',
    'src/components/Post/SubpostCarousel.tsx',
    'src/components/Post/ReportModal.tsx',
    'src/components/Feed/PostCard.tsx',
    'src/components/Create/ComposeOverlay.tsx',
  ],
  identity: [
    'src/components/Identity/IdentityPanel.tsx',
    'src/components/Identity/IdentitySwitcher.tsx',
  ],
  onboarding: ['src/components/Onboarding/OnboardingOverlay.tsx'],
}

function applyMappings(src) {
  // Find every classname-ish token, look up in MAPPING.
  // We replace only standalone occurrences — token boundaries on both
  // sides. Avoids partial matches inside arbitrary values like
  // `[bg-slate-700]`.
  let mapped = 0
  const out = src.replace(/\b([a-z]+-(?:slate|gray|zinc|neutral|stone|emerald|green)-\d{2,3})(?!\/)\b/g, (m) => {
    const target = MAPPING[m]
    if (target) {
      mapped++
      return target
    }
    return m
  })
  return { out, mapped }
}

function findAmbiguous(src) {
  const hits = []
  for (const pat of AMBIGUOUS_PATTERNS) {
    const re = new RegExp(pat.source, pat.flags)
    let m
    while ((m = re.exec(src)) !== null) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1
      const lineEnd = src.indexOf('\n', m.index)
      const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)
      const lineNum = src.slice(0, m.index).split('\n').length
      hits.push({ token: m[0], line: lineNum, context: line.trim().slice(0, 100) })
    }
  }
  return hits
}

function diffLines(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const out = []
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      out.push(`  L${i + 1}:`)
      out.push(`    - ${a[i].trim()}`)
      out.push(`    + ${b[i].trim()}`)
    }
  }
  return out.join('\n')
}

function processFile(file, { apply, dry }) {
  const path = join(ROOT, file)
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch (e) {
    console.log(`[skip] ${file}: ${e.message}`)
    return { mapped: 0, ambiguous: 0 }
  }
  const { out, mapped } = applyMappings(src)
  const ambiguous = findAmbiguous(out)

  console.log(`\n[${apply ? 'APPLY' : 'DRY'}] ${file}`)
  console.log(`  ${mapped} substitutions, ${ambiguous.length} ambiguous (no-rewrite)`)

  if (dry && mapped > 0) {
    console.log(diffLines(src, out))
  }

  if (ambiguous.length > 0) {
    console.log('  Ambiguous (manual review needed):')
    for (const h of ambiguous.slice(0, 8)) {
      console.log(`    L${h.line}: ${h.token}  // ${h.context}`)
    }
    if (ambiguous.length > 8) console.log(`    ... +${ambiguous.length - 8} more`)
  }

  if (apply && mapped > 0) {
    writeFileSync(path, out)
    console.log(`  → written.`)
  }

  return { mapped, ambiguous: ambiguous.length }
}

function main() {
  const argv = process.argv.slice(2)
  const dry = argv.includes('--dry') || !argv.includes('--apply')
  const apply = argv.includes('--apply')

  let files = []
  const batchArg = argv.find((a) => a.startsWith('--batch='))
  if (batchArg) {
    const name = batchArg.split('=')[1]
    if (!BATCHES[name]) {
      console.error(`Unknown batch: ${name}. Known: ${Object.keys(BATCHES).join(', ')}`)
      process.exit(1)
    }
    files = BATCHES[name]
  }
  const filesArg = argv.find((a) => a.startsWith('--files='))
  if (filesArg) {
    files = files.concat(filesArg.split('=')[1].split(','))
  }

  if (files.length === 0) {
    console.error('No files specified. Use --batch=<name> or --files=path1,path2.')
    console.error(`Batches: ${Object.keys(BATCHES).join(', ')}`)
    process.exit(1)
  }

  console.log(`Mode: ${apply ? 'APPLY (writing files)' : 'DRY (no changes)'}`)
  console.log(`Files: ${files.length}\n`)

  let totalMapped = 0
  let totalAmbiguous = 0
  for (const f of files) {
    const { mapped, ambiguous } = processFile(f, { apply, dry })
    totalMapped += mapped
    totalAmbiguous += ambiguous
  }

  console.log(`\n=== Summary ===`)
  console.log(`Total substitutions: ${totalMapped}`)
  console.log(`Total ambiguous (no-rewrite): ${totalAmbiguous}`)
  if (apply && totalMapped > 0) {
    console.log(`\nNext steps:`)
    console.log(`  1. npm run lint    (tsc check)`)
    console.log(`  2. npm run test    (vitest)`)
    console.log(`  3. npm run lint:check  (eslint warnings)`)
    console.log(`  4. npm run design:baseline:update  (ratchet down)`)
  }
}

main()
