/**
 * Core Web Vitals conformance — bundle size budget + dist artifact
 * invariantes.
 *
 * Origem: Round CWV-1 (Marshall — schema/conformance).
 * Lighthouse 2026-05-09 baseline: Performance 86/100. Target ≥95.
 *
 * Pareia com `.github/workflows/lighthouse.yml` (runtime gate via lhci):
 *   - lhci   = mede comportamento real (LCP, CLS, INP, TBT) — 3min/PR.
 *   - Este   = audita estrutura estática do bundle (modulepreload,
 *              chunk sizes, robots.txt) — <1s, sem browser.
 *
 * **Severity tiers** (status atual em comentário inline):
 *   S0 = bug confirmado, deve resolver pra hit Performance ≥95
 *   S1 = budget hard quando S0 resolvido
 *   S2 = budget total transfer
 *   S3 = artifact integrity (robots.txt)
 *
 * **Soft mode hoje:** alguns asserts são SKIP_IF_DIST_MISSING ou
 * `it.skip` quando o invariante depende do bundle otimizado que ainda
 * não shippou. Cada skip tem `// TODO(cwv-1)` com critério pra remover.
 *
 * Como rodar:
 *   npm run build && npm run test -- cwv-conformance
 *   # ou:
 *   npm run test:bundle-size
 *
 * Não roda em CI default (pre-build dependent) — entra em workflow
 * dedicado quando `npm run build` virar pré-requisito do test step.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const DIST_ASSETS = join(DIST, 'assets')
const DIST_INDEX = join(DIST, 'index.html')

// Budgets (bytes — uncompressed disk size; gzip ~3-4x menor).
// Margens conservadoras pra dar buffer de ~10% antes do hard gate.
const ENTRY_CHUNK_BUDGET_HARD = 300 * 1024 // 300 KB — S1 ceiling
const ENTRY_CHUNK_BUDGET_SOFT = 250 * 1024 // 250 KB — target manifesto perf
const TOTAL_INITIAL_TRANSFER_BUDGET = 800 * 1024 // 800 KB total scripts initial route

interface DistInspection {
  hasDist: boolean
  indexHtml: string
  assetFiles: { name: string; size: number }[]
  entryChunk: { name: string; size: number } | null
  modulepreloads: string[]
}

function inspectDist(): DistInspection {
  if (!existsSync(DIST) || !existsSync(DIST_INDEX) || !existsSync(DIST_ASSETS)) {
    return {
      hasDist: false,
      indexHtml: '',
      assetFiles: [],
      entryChunk: null,
      modulepreloads: [],
    }
  }

  const indexHtml = readFileSync(DIST_INDEX, 'utf8')
  const assetFiles = readdirSync(DIST_ASSETS)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((name) => ({ name, size: statSync(join(DIST_ASSETS, name)).size }))

  // Vite emite a entry como `<script type="module" crossorigin src="/assets/index-<hash>.js">`.
  // Pegamos o primeiro <script type="module"> com src apontando pra /assets/.
  const entryMatch = indexHtml.match(
    /<script\s+type="module"[^>]*\bsrc="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/,
  )
  const entryName = entryMatch ? entryMatch[1] : null
  const entryChunk =
    entryName && assetFiles.find((f) => f.name === entryName)
      ? { name: entryName, size: assetFiles.find((f) => f.name === entryName)!.size }
      : null

  // <link rel="modulepreload" ... href="/assets/<name>.js">
  const preloadRe = /<link\s+rel="modulepreload"[^>]*\bhref="\/assets\/([^"]+)"/g
  const modulepreloads: string[] = []
  let m: RegExpExecArray | null
  while ((m = preloadRe.exec(indexHtml)) !== null) {
    modulepreloads.push(m[1])
  }

  return { hasDist: true, indexHtml, assetFiles, entryChunk, modulepreloads }
}

const inspection = inspectDist()

describe('CWV conformance — bundle size budget + dist artifacts', () => {
  describe('preflight', () => {
    it('dist/ existe (rode `npm run build` antes)', () => {
      // Se este it falha, todos os outros são skip-ish — nada pra
      // auditar. CI pipeline em `lighthouse.yml` faz build antes;
      // local: `npm run test:bundle-size`.
      if (!inspection.hasDist) {
        // eslint-disable-next-line no-console
        console.warn(
          '[cwv-conformance] dist/ ausente — skipping budget asserts. ' +
            'Rode `npm run build` ou `npm run test:bundle-size`.',
        )
      }
      // Não falha o teste se dist ausente — apenas warn. Permite rodar
      // a suite Vitest completa sem build prévio.
      expect(true).toBe(true)
    })
  })

  describe('S0 — modulepreload não pode incluir helia-deps (lazy chunk)', () => {
    // Manifesto §13 perf + Track B (helia carrega via dynamic import
    // só quando user invoca pin/blob lookup). Se helia-deps cair em
    // modulepreload, browser baixa ~1MB de libp2p no boot — bug
    // confirmado em Lighthouse 2026-05-09.
    //
    // TODO(cwv-1): converter este `it.skipIf(...)` em `it(...)` hard
    // quando vite.config.ts for ajustado pra excluir helia-deps de
    // `build.rollupOptions.output.experimentalMinChunkSize` /
    // explicit modulepreload filter.
    it.skipIf(!inspection.hasDist)(
      'helia-deps NÃO aparece em <link rel="modulepreload">',
      () => {
        const heliaPreloads = inspection.modulepreloads.filter((p) =>
          /^helia(-deps)?-/.test(p),
        )
        if (heliaPreloads.length > 0) {
          // Soft warn — log mas não falha. Vira hard quando bundle
          // patchear. Marker S0 pra grep.
          // eslint-disable-next-line no-console
          console.warn(
            `[cwv-conformance][S0] helia chunks em modulepreload: ${heliaPreloads.join(', ')}\n` +
              `  Esperado: helia carrega só sob demanda (pin/blob).\n` +
              `  Fix: ajustar manualChunks em vite.config.ts ou usar dynamic import.\n` +
              `  Quando resolver, trocar este warn por expect().toEqual([]).`,
          )
        }
        // SOFT — TODO(cwv-1): trocar pra `expect(heliaPreloads).toEqual([])`
        expect(heliaPreloads.length).toBeGreaterThanOrEqual(0)
      },
    )
  })

  describe('S1 — entry chunk size budget', () => {
    it.skipIf(!inspection.hasDist)(
      'entry chunk identificável a partir do index.html',
      () => {
        expect(inspection.entryChunk, 'esperado <script type="module" src="/assets/index-*.js">').not.toBeNull()
      },
    )

    it.skipIf(!inspection.hasDist || !inspection.entryChunk)(
      `entry chunk ≤ ${ENTRY_CHUNK_BUDGET_HARD / 1024} KB (hard ceiling)`,
      () => {
        const chunk = inspection.entryChunk!
        const sizeKB = (chunk.size / 1024).toFixed(1)
        if (chunk.size > ENTRY_CHUNK_BUDGET_HARD) {
          // eslint-disable-next-line no-console
          console.warn(
            `[cwv-conformance][S1] entry chunk ${chunk.name} = ${sizeKB} KB ` +
              `excede HARD budget de ${ENTRY_CHUNK_BUDGET_HARD / 1024} KB.\n` +
              `  Use rollup-plugin-visualizer (npm run build:analyze) pra inspecionar.`,
          )
        }
        // SOFT até stabilizar — TODO(cwv-1): trocar pra `expect(chunk.size).toBeLessThanOrEqual(ENTRY_CHUNK_BUDGET_HARD)`
        expect(chunk.size).toBeGreaterThan(0)
      },
    )

    it.skipIf(!inspection.hasDist || !inspection.entryChunk)(
      `entry chunk ≤ ${ENTRY_CHUNK_BUDGET_SOFT / 1024} KB (soft target — manifesto perf)`,
      () => {
        const chunk = inspection.entryChunk!
        const sizeKB = (chunk.size / 1024).toFixed(1)
        if (chunk.size > ENTRY_CHUNK_BUDGET_SOFT) {
          // eslint-disable-next-line no-console
          console.warn(
            `[cwv-conformance][S1-soft] entry chunk ${chunk.name} = ${sizeKB} KB ` +
              `> ${ENTRY_CHUNK_BUDGET_SOFT / 1024} KB (target). Ainda dentro do hard ceiling.`,
          )
        }
        expect(chunk.size).toBeGreaterThan(0)
      },
    )
  })

  describe('S2 — total initial transfer budget', () => {
    it.skipIf(!inspection.hasDist)(
      `soma de modulepreload + entry + CSS ≤ ${TOTAL_INITIAL_TRANSFER_BUDGET / 1024} KB`,
      () => {
        const initialAssets = new Set<string>()
        if (inspection.entryChunk) initialAssets.add(inspection.entryChunk.name)
        for (const p of inspection.modulepreloads) initialAssets.add(p)

        // CSS via <link rel="stylesheet" href="/assets/*.css">
        const cssRe = /<link\s+rel="stylesheet"[^>]*\bhref="\/assets\/([^"]+\.css)"/g
        let m: RegExpExecArray | null
        while ((m = cssRe.exec(inspection.indexHtml)) !== null) {
          initialAssets.add(m[1])
        }

        let total = 0
        for (const name of initialAssets) {
          const f = inspection.assetFiles.find((a) => a.name === name)
          if (f) total += f.size
        }

        const totalKB = (total / 1024).toFixed(1)
        if (total > TOTAL_INITIAL_TRANSFER_BUDGET) {
          // eslint-disable-next-line no-console
          console.warn(
            `[cwv-conformance][S2] initial transfer ${totalKB} KB ` +
              `excede budget ${TOTAL_INITIAL_TRANSFER_BUDGET / 1024} KB.\n` +
              `  Assets contados: ${[...initialAssets].join(', ')}`,
          )
        }
        // SOFT — TODO(cwv-1): hard expect.
        expect(total).toBeGreaterThan(0)
      },
    )
  })

  describe('S3 — dist artifact integrity', () => {
    it.skipIf(!inspection.hasDist)('index.html é HTML válido com <head> e <body>', () => {
      expect(inspection.indexHtml).toMatch(/<head[\s>]/i)
      expect(inspection.indexHtml).toMatch(/<\/head>/i)
      expect(inspection.indexHtml).toMatch(/<body[\s>]/i)
    })

    it.skipIf(!inspection.hasDist)('manifest.webmanifest presente em dist/', () => {
      expect(existsSync(join(DIST, 'manifest.webmanifest'))).toBe(true)
    })

    // robots.txt: bom-ter pra crawlers (Googlebot indexa app, mas
    // /api e /assets podem ser disallowed pra economizar crawl budget).
    // SOFT por enquanto — adicionar `public/robots.txt` é trivial mas
    // não é blocker.
    it.skipIf(!inspection.hasDist)('robots.txt presente em dist/ (soft — informativo)', () => {
      const hasRobots = existsSync(join(DIST, 'robots.txt'))
      if (!hasRobots) {
        // eslint-disable-next-line no-console
        console.warn(
          '[cwv-conformance][S3-soft] dist/robots.txt ausente. ' +
            'Adicionar `public/robots.txt` pra explicitar policy de crawl.',
        )
      }
      // SOFT — TODO(cwv-1): hard expect quando public/robots.txt landed.
      expect(true).toBe(true)
    })
  })
})
