/**
 * Sourcemap strip conformance — verifica que .map files NÃO existem em
 * dist/ após o build chain (`vite build` → `strip-sourcemaps.mjs`).
 *
 * Origem: Ted CWV-3 sourcemap hardening (2026-05-15).
 *
 * Política (Docs/security/sourcemaps-policy-2026-05-15.md):
 *   - vite.config.ts: build.sourcemap = 'hidden' → gera .map mas NÃO
 *     referencia (`//# sourceMappingURL=` omitido nos .js).
 *   - scripts/strip-sourcemaps.mjs: deleta TODOS .map de dist/ e
 *     dist/assets/ pós-build. Sem upload pra Sentry (manifesto §4
 *     anti-telemetria), .map público só vaza código sem benefício.
 *   - Lighthouse "Best Practices" não penaliza .map ausentes.
 *
 * Skip se dist/ não existe — `npm test` em fresh clone roda sem build.
 * Hard fail se build rodou mas algum .map sobreviveu.
 *
 * Pareia com `tests/cwv-conformance.test.ts` (mesma estratégia
 * SKIP_IF_DIST_MISSING).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const DIST_ASSETS = join(DIST, 'assets')

const SKIP_REASON = 'dist/ ausente — rode `npm run build` antes.'

function listMapFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.map'))
}

function listJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.js'))
}

describe('sourcemap strip conformance', () => {
  const distExists = existsSync(DIST_ASSETS)

  it.skipIf(!distExists)(
    'dist/assets/ contém zero arquivos .map (strip-sourcemaps rodou)',
    () => {
      const orphans = listMapFiles(DIST_ASSETS)
      expect(
        orphans,
        `strip-sourcemaps falhou: ${orphans.length} .map files em dist/assets/. ` +
          `Verifique build chain em package.json e scripts/strip-sourcemaps.mjs.`,
      ).toEqual([])
    },
  )

  it.skipIf(!distExists)(
    'dist/ raiz contém zero arquivos .map (sw.js.map, workbox-*.map)',
    () => {
      const orphans = listMapFiles(DIST)
      expect(
        orphans,
        `strip-sourcemaps deve limpar dist/ root também (sw.js.map, ` +
          `workbox-*.js.map). Encontrados: ${orphans.join(', ')}`,
      ).toEqual([])
    },
  )

  it.skipIf(!distExists)(
    'nenhum bundle .js em dist/assets/ referencia sourceMappingURL',
    () => {
      // build.sourcemap = 'hidden' já omite a referência, mas defesa em
      // profundidade: se alguém trocar pra true por engano, este test
      // pega antes do deploy.
      const violators: string[] = []
      for (const name of listJsFiles(DIST_ASSETS)) {
        const path = join(DIST_ASSETS, name)
        const content = readFileSync(path, 'utf-8')
        // Match `//# sourceMappingURL=` (também `//@` legacy form).
        if (/\/\/[#@]\s*sourceMappingURL=/.test(content)) {
          violators.push(name)
        }
      }
      expect(
        violators,
        `Bundles referenciam sourceMappingURL — troque ` +
          `build.sourcemap pra 'hidden' ou false em vite.config.ts. ` +
          `Violadores: ${violators.join(', ')}`,
      ).toEqual([])
    },
  )

  it('build chain inclui strip-sourcemaps.mjs', () => {
    // Defesa contra regressão do package.json — alguém poderia remover
    // o `node scripts/strip-sourcemaps.mjs` da chain de build e .map
    // voltariam pro deploy sem ninguém notar.
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> }
    const buildScript = pkg.scripts?.build ?? ''
    expect(
      buildScript,
      'package.json scripts.build deve invocar strip-sourcemaps.mjs ' +
        'após vite build pra remover .map antes do deploy.',
    ).toMatch(/strip-sourcemaps\.mjs/)
  })

  if (!distExists) {
    it.skip(`(skipped) ${SKIP_REASON}`, () => {})
  }
})
