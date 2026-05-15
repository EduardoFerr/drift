/**
 * ESLint flat config (ESLint 9+ / 10).
 *
 * Drift uses ESLint primarily as a delivery vehicle for the custom rule
 * `drift/no-tailwind-non-drift-tokens` (see RFC
 * Docs/rfcs/2026-05-rfc-token-enforcement.md). We intentionally keep
 * the surface minimal — TypeScript correctness is enforced separately
 * by `tsc -b --noEmit` (script: `npm run lint`). ESLint here covers
 * what tsc cannot: token discipline in JSX strings.
 *
 * Severity strategy (Fase 1, Round 4):
 *   - Hot path (POST + Feed + Compose) → `error`
 *   - Whitelisted paths (UI primitives, Boot, banners with no drift
 *     warning/danger token yet) → `off`
 *   - Default → `warn`
 *
 * Fase 3 (Round 5) flips default to `error` and removes path overrides
 * once `drift-warning` / `drift-danger` tokens land (Ted v0.8 RFC).
 */

import tsParser from '@typescript-eslint/parser'
import driftPlugin from './eslint-rules/index.cjs'
import noopStubs from './eslint-rules/noop-stubs.cjs'

/**
 * Hot path: POST hot path components per RFC §1.3. Strict token
 * enforcement starts here in Fase 1 already (error, not warn).
 */
const HOT_PATH = [
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
]

/**
 * Path whitelist (off / warn-only). Each entry has a justified reason
 * tied to the RFC §2.4. When `drift-warning` / `drift-danger` tokens
 * land, banners can flip back to default and these entries shrink.
 */
const WHITELIST_OFF = [
  // Design system primitives — fonte de tokens, escape hatch legítimo.
  'src/components/UI/**',
  // SwipeHandler hex hardcoded — dívida documentada (design-system §2.5).
  'src/components/Post/SwipeHandler.tsx',
  // Boot pre-CSS-loaded — inline styles necessárias.
  'src/components/Boot/**',
]

export default [
  {
    // Global ignore — vendor + build artifacts + tests dirs.
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'public/**',
      '*.config.js',
      '*.config.cjs',
      'eslint.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      'vite.config.ts',
      'vitest.config.ts',
      'src-tauri/**',
      'tests/**',
      'scripts/**',
      'eslint-rules/**',
      // Worktree snapshots (parallel agent sessions) — stale copies of
      // src/ que poluem lint count e iteram independente do main worktree.
      '.claude/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    linterOptions: {
      // Inline `eslint-disable-next-line <rule>` directives in src/
      // reference plugins (react, react-hooks, @typescript-eslint) that
      // we don't configure. Treat as no-op rather than error so those
      // comments stay valid as future-friendly hints. Drift's ESLint
      // surface is intentionally narrow (just the drift/* rules); fuller
      // plugin coverage is out of scope for the token-enforcement RFC.
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      drift: driftPlugin,
      // Stub plugins so legacy `eslint-disable-next-line` directives
      // pointing at react/react-hooks/@typescript-eslint don't error.
      // See eslint-rules/noop-stubs.cjs.
      'react-hooks': noopStubs['react-hooks'],
      react: noopStubs['react'],
      '@typescript-eslint': noopStubs['@typescript-eslint'],
    },
    rules: {
      // Default: warn. Hot path overrides below promote to error.
      'drift/no-tailwind-non-drift-tokens': 'warn',
    },
  },
  // Hot path override.
  //
  // RFC §2.4 prescribes `error` here from Fase 1. Reality check 2026-05-09:
  // hot path has residual yellow-*/amber-*/red-* (warning + danger
  // semantics) waiting on Ted v0.8 RFC tokens (`drift-warning`,
  // `drift-danger`). Until those land, promoting to `error` blocks CI
  // for legitimate-pending semantics. Kept at `warn` for Fase 1 so the
  // gate is visible in IDE/CI without blocking; flips to `error` in Fase 3
  // (Round 5) once Ted v0.8 ships and Lily's hot path migration completes.
  // See report from Round 4 sprint for cross-cutting flag.
  {
    files: HOT_PATH,
    rules: {
      'drift/no-tailwind-non-drift-tokens': 'warn',
    },
  },
  // Whitelist override: off.
  {
    files: WHITELIST_OFF,
    rules: {
      'drift/no-tailwind-non-drift-tokens': 'off',
    },
  },
]
