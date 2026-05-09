#!/usr/bin/env node
/**
 * strip-sourcemaps — remove .map files from dist/ post-build.
 *
 * Why: Vite `build.sourcemap = 'hidden'` gera .map mas não referencia
 * em bundle. Eles continuam no dist/ e Vercel serve publicamente
 * (Barney CWV-3 sourcemap public exposure threat S2 2026-05-09).
 *
 * Sourcemaps + sourcesContent inlined expõem build fingerprint + paths
 * + comments originais. Sem servir publicamente: deleta pós-build.
 *
 * Trade-off: perde debug surface area pra error tracking público (e.g.,
 * Sentry symbolication exigiria upload separado dos .map antes do
 * delete). Aceitável até pipeline Sentry ser estabelecido.
 *
 * Roda automaticamente após `vite build` via npm script.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')

async function strip() {
  let removed = 0
  let bytesFreed = 0
  try {
    const entries = await readdir(ASSETS, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.map')) {
        const path = join(ASSETS, entry.name)
        try {
          const { size } = await import('node:fs').then((fs) =>
            fs.promises.stat(path),
          )
          await unlink(path)
          removed++
          bytesFreed += size
        } catch {
          /* ignore individual failures */
        }
      }
    }
  } catch (err) {
    if ((err)?.code === 'ENOENT') {
      console.log('[strip-sourcemaps] dist/assets/ ausente — skip')
      return
    }
    throw err
  }
  // Também checar root dist/ (sw.js.map, workbox-*.js.map)
  try {
    const rootEntries = await readdir(DIST, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (entry.isFile() && entry.name.endsWith('.map')) {
        const path = join(DIST, entry.name)
        try {
          const { size } = await import('node:fs').then((fs) =>
            fs.promises.stat(path),
          )
          await unlink(path)
          removed++
          bytesFreed += size
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  const kb = (bytesFreed / 1024).toFixed(1)
  console.log(`[strip-sourcemaps] removidos ${removed} arquivos .map (${kb} KB)`)
}

strip().catch((err) => {
  console.error('[strip-sourcemaps] falhou:', err)
  process.exit(1)
})
