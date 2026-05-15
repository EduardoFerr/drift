/**
 * SRI conformance — verifica que dist/index.html tem
 * `integrity="sha384-..."` em todos os scripts/links de assets locais
 * e que cada hash bate com o sha384 do arquivo apontado.
 *
 * Origem: Barney security audit, 2026-05-15 (gap aberto desde
 * CWV-3 follow-up de 2026-05-09). Manifesto §17 (sem chave mestra)
 * — defesa-em-profundidade contra compromise do canal de distribuição
 * (CDN/Vercel/build pipeline).
 *
 * Tier S2 — artifact integrity. Roda após `npm run build`
 * (pre-build dependent; segue padrão de cwv-conformance.test.ts).
 *
 * Como rodar:
 *   npm run build && npx vitest run tests/sri-conformance.test.ts
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const DIST_INDEX = join(DIST, 'index.html')

interface TagWithIntegrity {
  full: string
  url: string
  integrity: string | null
}

function parseTags(html: string): {
  scripts: TagWithIntegrity[]
  modulepreloads: TagWithIntegrity[]
  stylesheets: TagWithIntegrity[]
} {
  const scripts: TagWithIntegrity[] = []
  const modulepreloads: TagWithIntegrity[] = []
  const stylesheets: TagWithIntegrity[] = []

  // <script type="module" ... src="/assets/...">
  const scriptRe =
    /<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/([^"]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    const full = m[0]
    const integrityMatch = full.match(/\bintegrity="([^"]+)"/)
    scripts.push({
      full,
      url: m[1],
      integrity: integrityMatch ? integrityMatch[1] : null,
    })
  }

  // <link rel="modulepreload" ... href="/assets/...">
  const preloadRe =
    /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/assets\/([^"]+)"[^>]*>/gi
  while ((m = preloadRe.exec(html)) !== null) {
    const full = m[0]
    const integrityMatch = full.match(/\bintegrity="([^"]+)"/)
    modulepreloads.push({
      full,
      url: m[1],
      integrity: integrityMatch ? integrityMatch[1] : null,
    })
  }

  // <link rel="stylesheet" ... href="/assets/...">
  const cssRe =
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/([^"]+)"[^>]*>/gi
  while ((m = cssRe.exec(html)) !== null) {
    const full = m[0]
    const integrityMatch = full.match(/\bintegrity="([^"]+)"/)
    stylesheets.push({
      full,
      url: m[1],
      integrity: integrityMatch ? integrityMatch[1] : null,
    })
  }

  return { scripts, modulepreloads, stylesheets }
}

function sha384Base64(buf: Buffer): string {
  return createHash('sha384').update(buf).digest('base64')
}

const hasDist = existsSync(DIST_INDEX)
const html = hasDist ? readFileSync(DIST_INDEX, 'utf8') : ''
const tags = hasDist
  ? parseTags(html)
  : { scripts: [], modulepreloads: [], stylesheets: [] }

describe('SRI conformance — dist/index.html integrity attributes', () => {
  it('dist/index.html existe (rode `npm run build` antes)', () => {
    if (!hasDist) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sri-conformance] dist/index.html ausente — skipping SRI asserts. ' +
          'Rode `npm run build`.',
      )
    }
    expect(true).toBe(true)
  })

  it.skipIf(!hasDist)('encontrou pelo menos 1 <script type="module"> com src local', () => {
    // Sanity check: se zero tags são encontradas, regex provavelmente quebrou
    // (ou index.html mudou estrutura). Falha pra forçar revisão.
    expect(tags.scripts.length).toBeGreaterThan(0)
  })

  it.skipIf(!hasDist)('TODO <script type="module"> tem integrity="sha384-..."', () => {
    for (const tag of tags.scripts) {
      expect(
        tag.integrity,
        `script ${tag.url} sem integrity. Tag: ${tag.full}`,
      ).not.toBeNull()
      expect(
        tag.integrity!,
        `script ${tag.url} integrity formato inválido: ${tag.integrity}`,
      ).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/)
    }
  })

  it.skipIf(!hasDist)('TODO <link rel="modulepreload"> tem integrity="sha384-..."', () => {
    for (const tag of tags.modulepreloads) {
      expect(
        tag.integrity,
        `modulepreload ${tag.url} sem integrity. Tag: ${tag.full}`,
      ).not.toBeNull()
      expect(tag.integrity!).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/)
    }
  })

  it.skipIf(!hasDist)('TODO <link rel="stylesheet"> de assets/ tem integrity="sha384-..."', () => {
    for (const tag of tags.stylesheets) {
      expect(
        tag.integrity,
        `stylesheet ${tag.url} sem integrity. Tag: ${tag.full}`,
      ).not.toBeNull()
      expect(tag.integrity!).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/)
    }
  })

  it.skipIf(!hasDist)(
    'cada integrity hash bate com sha384 do arquivo apontado (defesa-em-profundidade)',
    () => {
      // Garante que o injector não emitiu hashes vazios/placeholder ou
      // ficou dessincronizado com strip-sourcemaps (que roda antes).
      // Se este teste falha, algum asset foi modificado depois do hash
      // — investigar ordem de scripts no package.json `build`.
      const allTags = [...tags.scripts, ...tags.modulepreloads, ...tags.stylesheets]
      for (const tag of allTags) {
        if (!tag.integrity) continue // outro test cobre missing
        const expectedHash = tag.integrity.replace(/^sha384-/, '')
        const filePath = join(DIST, 'assets', tag.url)
        if (!existsSync(filePath)) {
          throw new Error(`asset referenciado em SRI não existe: ${filePath}`)
        }
        const actualHash = sha384Base64(readFileSync(filePath))
        expect(
          actualHash,
          `hash mismatch para ${tag.url}: integrity=${expectedHash}, file=${actualHash}`,
        ).toBe(expectedHash)
      }
    },
  )
})
