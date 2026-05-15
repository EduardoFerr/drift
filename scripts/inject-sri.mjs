#!/usr/bin/env node
/**
 * inject-sri — post-build pass that adds Subresource Integrity (SRI)
 * attributes to `<script type="module">`, `<link rel="modulepreload">`,
 * and `<link rel="stylesheet">` tags in `dist/index.html`.
 *
 * Threat model (manifesto §17 — sem chave mestra):
 *   Atacante compromete CDN/Vercel/build pipeline e serve conteúdo
 *   alterado sob o mesmo filename fingerprint (hash do Vite fica preso
 *   ao bytes originais). Sem SRI, browser executa o JS adulterado.
 *   Com `integrity="sha384-..."`, browser verifica o hash dos bytes
 *   carregados; mismatch → recusa execução. Defesa-em-profundidade
 *   contra compromise do canal de distribuição.
 *
 * Por que Option B (script custom) em vez de Option A (vite plugin):
 *   - `vite-plugin-subresource-integrity` last published 2024-04 (v0.0.12,
 *     stale, pre-1.0). Risk de incompatibilidade com Vite 5.4 + vite-plugin-pwa.
 *   - Zero dep nova; ~80 linhas de Node puro; fácil auditar.
 *   - Roda depois de `vite build` + `strip-sourcemaps` no mesmo pipeline.
 *
 * Cobre:
 *   - `<script type="module" ... src="/assets/...">` (entry chunk)
 *   - `<link rel="modulepreload" ... href="/assets/...">` (vendor preloads)
 *   - `<link rel="stylesheet" ... href="/assets/...">` (CSS)
 *
 * NÃO cobre (intencionalmente):
 *   - `sw.js` / `workbox-*.js` carregados via `navigator.serviceWorker.register`
 *     e `importScripts`. SRI HTML attribute não se aplica a esses APIs.
 *     Service Worker integrity é fornecida por Workbox via revision/hash
 *     no precache manifest (cada entrada tem `revision` ou filename hash).
 *   - Dynamic imports (`import('./foo')`) resolvidos via `__vitePreload`.
 *     Vite injeta `<link rel="modulepreload">` runtime sem `integrity`.
 *     Mitigação futura: passar `integrity` via build.modulePreload.resolveDependencies
 *     ou patching de __vitePreload — fora de escopo desta baseline.
 *     Documentado em Docs/sessions/sri-baseline-2026-05-15.md como TODO.
 *
 * Roda automaticamente após `vite build` via npm script `build`:
 *   `tsc -b && vite build && node scripts/strip-sourcemaps.mjs && node scripts/inject-sri.mjs`
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const DIST = 'dist'
const INDEX = join(DIST, 'index.html')

/**
 * Compute sha384 of file at `dist/<relPath>`, return as
 * `sha384-<base64>` per SRI spec (W3C SRI).
 */
async function hashAsset(relPath) {
  const buf = await readFile(join(DIST, relPath))
  const digest = createHash('sha384').update(buf).digest('base64')
  return `sha384-${digest}`
}

/**
 * Resolve href/src like `/assets/foo.js` to dist-relative `assets/foo.js`.
 * Returns null se href é externo (http://, https://, //) ou data:.
 */
function distRelative(url) {
  if (!url) return null
  if (/^(?:https?:)?\/\//i.test(url)) return null
  if (url.startsWith('data:')) return null
  // Vite always emits `/assets/...` (absolute path from web root).
  return url.replace(/^\//, '')
}

async function inject() {
  let html
  try {
    html = await readFile(INDEX, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.log('[inject-sri] dist/index.html ausente — skip')
      return
    }
    throw err
  }

  let injectedCount = 0
  const errors = []

  /**
   * Regex captura tags relevantes e processa cada match async.
   * Tag types:
   *   1. <script type="module" ... src="...">
   *   2. <link rel="modulepreload" ... href="...">
   *   3. <link rel="stylesheet" ... href="...">
   *
   * Para cada match: extrai URL, computa hash, injeta `integrity="..."`
   * + `crossorigin="anonymous"` (necessário pro browser baixar o asset
   * com modo CORS, requisito de SRI quando o asset vem da mesma origem
   * via path absoluto; Vite já emite `crossorigin` então é idempotente).
   */
  const TAG_RE =
    /<(script|link)\b([^>]*?)\s(?:src|href)="([^"]+)"([^>]*)>/gi

  // Coleta matches primeiro (regex sync), processa hashes em paralelo.
  const matches = []
  let m
  while ((m = TAG_RE.exec(html)) !== null) {
    matches.push({
      full: m[0],
      tagName: m[1].toLowerCase(),
      preAttrs: m[2],
      url: m[3],
      postAttrs: m[4],
      index: m.index,
    })
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const allAttrs = `${match.preAttrs} ${match.postAttrs}`
      // Filtra tipo:
      //   - script: precisa type="module"
      //   - link: precisa rel="modulepreload" ou rel="stylesheet"
      if (match.tagName === 'script') {
        if (!/\btype="module"/i.test(allAttrs)) return null
      } else if (match.tagName === 'link') {
        if (!/\brel="(modulepreload|stylesheet)"/i.test(allAttrs)) return null
      } else {
        return null
      }

      // Pula se já tem integrity (idempotência — re-run não duplica).
      if (/\bintegrity="/i.test(allAttrs)) return null

      const rel = distRelative(match.url)
      if (!rel) return null // externo, ignora

      let integrity
      try {
        integrity = await hashAsset(rel)
      } catch (err) {
        errors.push(`hash ${rel}: ${err.message}`)
        return null
      }

      // Reconstrói a tag injetando integrity logo antes do `>`.
      // Mantém atributos originais intactos. `crossorigin="anonymous"`
      // adiciona se não existir (Vite já põe `crossorigin` sem valor →
      // CORS anonymous default; mantemos compat).
      const newTag = match.full.replace(
        /(\s*)>$/,
        ` integrity="${integrity}"$1>`,
      )
      return { from: match.full, to: newTag }
    }),
  )

  // Aplica replacements (string replace global pra cada par).
  for (const r of replacements) {
    if (!r) continue
    // Replace só a primeira ocorrência — preserva tags duplicadas
    // (improvável mas seguro). Vite emite cada tag uma vez.
    html = html.replace(r.from, r.to)
    injectedCount++
  }

  if (errors.length) {
    for (const e of errors) console.error(`[inject-sri] ${e}`)
    if (injectedCount === 0) {
      throw new Error('inject-sri falhou: nenhum integrity injetado')
    }
  }

  await writeFile(INDEX, html, 'utf8')
  console.log(`[inject-sri] integrity= injetado em ${injectedCount} tag(s)`)
}

inject().catch((err) => {
  console.error('[inject-sri] falhou:', err)
  process.exit(1)
})
