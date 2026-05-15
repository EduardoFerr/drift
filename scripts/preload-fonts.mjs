#!/usr/bin/env node
/**
 * preload-fonts — injeta `<link rel="preload" as="font">` no <head> de
 * dist/index.html pros woff2 críticos (Syne latin + DM Mono 400 latin).
 *
 * Why: Lighthouse 2026-05-15 reportou critical request chain 1.5s pelas
 * fontes. CSS @font-face só dispara fetch quando texto renderiza — sem
 * preload, fetch fica depois do parse do CSS inlined. Preload coloca o
 * fetch em paralelo com o parse do HTML, encurtando a cadeia.
 *
 * Critérios pra inclusão:
 *   - Syne latin (variable, weights 400-800 single file) — usado em
 *     todo display copy (logos, títulos)
 *   - DM Mono 400 latin — peso default do body mono
 *
 * Demais (Syne latin-ext/greek, DM Mono 300/500/italic) carregam sob
 * demanda quando o texto exige aquele subset/weight. Não pré-fetch.
 *
 * Manifesto §13 (UX/perf) — entrega pra mobile via 4G slow precisa
 * cada RTT economizado.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')
const INDEX_HTML = join(DIST, 'index.html')

// Padrões dos críticos. Match no filename com hash do Vite.
const CRITICAL_PATTERNS = [
  /^syne-latin-wght-normal-.*\.woff2$/,
  /^dm-mono-latin-400-normal-.*\.woff2$/,
]

async function run() {
  let html
  try {
    html = await readFile(INDEX_HTML, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.log('[preload-fonts] dist/index.html ausente — skip')
      return
    }
    throw err
  }

  let files
  try {
    files = await readdir(ASSETS)
  } catch {
    console.log('[preload-fonts] dist/assets/ ausente — skip')
    return
  }

  const critical = files.filter((f) =>
    CRITICAL_PATTERNS.some((re) => re.test(f)),
  )

  if (critical.length === 0) {
    console.log('[preload-fonts] nenhum woff2 crítico encontrado — skip')
    return
  }

  const links = critical
    .map(
      (f) =>
        `    <link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/${f}">`,
    )
    .join('\n')

  // Injeta após o último <link rel="modulepreload"> (próximo do entry
  // chunk) ou, fallback, antes do </head>. Mantém ordem: modulepreload
  // (JS) primeiro, depois font preload.
  let injected = false
  const lastPreloadRe = /<link\s+rel="modulepreload"[^>]*>(?![\s\S]*<link\s+rel="modulepreload")/
  if (lastPreloadRe.test(html)) {
    html = html.replace(lastPreloadRe, (m) => `${m}\n${links}`)
    injected = true
  } else {
    html = html.replace('</head>', `${links}\n</head>`)
    injected = true
  }

  if (!injected) {
    console.warn('[preload-fonts] sem ponto de injeção (sem </head>?) — skip')
    return
  }

  await writeFile(INDEX_HTML, html, 'utf8')
  console.log(`[preload-fonts] preload de ${critical.length} font(s): ${critical.join(', ')}`)
}

run().catch((err) => {
  console.error('[preload-fonts] falhou:', err)
  process.exit(1)
})
