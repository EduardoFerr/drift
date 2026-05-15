#!/usr/bin/env node
/**
 * inline-css — inline critical CSS no `<head>` pra remover render-block.
 *
 * Why: Lighthouse a11y/perf audit 2026-05-15 flagou
 * `assets/index-*.css` como render-blocking resource (9.2 KB gzip, no
 * critical path do FCP/LCP). Inline o conteúdo no `<head>` elimina o
 * round-trip — primeiro paint começa assim que o HTML for parseado,
 * sem aguardar fetch separado.
 *
 * Trade-off: HTML cresce ~9 KB gzip (incompressível em runtime — já
 * vai gzip via Vercel edge), mas elimina 1 RTT de bloqueio. Net win
 * em LCP em conexões móveis.
 *
 * Pipeline em build:
 *   1. tsc -b
 *   2. vite build              → emit dist/
 *   3. strip-sourcemaps.mjs    → remove .map files
 *   4. inject-sri.mjs          → add integrity attr aos assets
 *   5. inline-css.mjs (este)   → inline CSS, remove o `<link>`
 *
 * Order matters: inject-sri ANTES de inline-css, senão tentaria
 * computar hash de um asset não-mais-referenciado.
 *
 * Manifesto §13 (UX/perf) — entrega pra mobile via 4G slow precisa
 * cada RTT economizado.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'dist'
const INDEX_HTML = join(DIST, 'index.html')

async function run() {
  let html
  try {
    html = await readFile(INDEX_HTML, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.log('[inline-css] dist/index.html ausente — skip')
      return
    }
    throw err
  }

  // Match <link rel="stylesheet" href="/assets/X.css" ...>
  const linkRe = /<link\s+rel="stylesheet"[^>]*\bhref="(\/assets\/[^"]+\.css)"[^>]*>/g
  const matches = [...html.matchAll(linkRe)]

  if (matches.length === 0) {
    console.log('[inline-css] nenhum <link rel="stylesheet"> em assets/ — skip')
    return
  }

  let modified = html
  let totalInlined = 0
  for (const match of matches) {
    const linkTag = match[0]
    const hrefPath = match[1]
    const cssPath = join(DIST, hrefPath.replace(/^\//, ''))
    let cssContent
    try {
      cssContent = await readFile(cssPath, 'utf8')
    } catch (err) {
      console.warn(`[inline-css] falha lendo ${cssPath}, mantendo link:`, err.message)
      continue
    }
    // Escape `</style>` no conteúdo CSS (improvável mas defensive)
    const safe = cssContent.replace(/<\/style/gi, '<\\/style')
    const styleTag = `<style>${safe}</style>`
    modified = modified.replace(linkTag, styleTag)
    totalInlined += cssContent.length
  }

  await writeFile(INDEX_HTML, modified, 'utf8')
  const kb = (totalInlined / 1024).toFixed(1)
  console.log(
    `[inline-css] inlinou ${matches.length} stylesheet(s) — ${kb} KB raw embedded`,
  )
}

run().catch((err) => {
  console.error('[inline-css] falhou:', err)
  process.exit(1)
})
