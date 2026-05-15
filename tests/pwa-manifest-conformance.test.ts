/**
 * PWA manifest conformance — valida cobertura completa de icons e meta
 * tags pra install confiável em Chrome Android / iOS Safari / desktop.
 *
 * Origem: Marshall PWA audit, 2026-05-15. Gap fechado:
 *  - manifest 192 + 512 + maskable presentes
 *  - apple-touch-icon 180x180 PNG (iOS rejeita SVG)
 *  - theme-color meta consistente entre index.html e manifest
 *  - shortcuts referenciam icons que existem em disco
 *
 * Tier S2 — pre-build dependent. Lê de `dist/` (gerado por VitePWA).
 * Se `dist/` não existir, skip com mensagem clara — mesmo padrão de
 * sri-conformance e cwv-conformance.
 *
 * Como rodar:
 *   npm run build && npx vitest run tests/pwa-manifest-conformance.test.ts
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const PUBLIC_DIR = join(ROOT, 'public')
const DIST_MANIFEST = join(DIST, 'manifest.webmanifest')
const DIST_INDEX = join(DIST, 'index.html')

interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  lang?: string
  id?: string
  icons: ManifestIcon[]
  shortcuts?: Array<{
    name: string
    url: string
    icons?: Array<{ src: string; sizes: string }>
  }>
}

/**
 * Resolve src de manifest pra path no FS. Tenta `dist/<src>` primeiro
 * (output do build), cai pra `public/<src>` (source). Manifest emite
 * paths relativos (sem leading slash) por configuração default do
 * VitePWA.
 */
function resolveIconPath(src: string): string | null {
  const normalized = src.replace(/^\/+/, '')
  const distPath = join(DIST, normalized)
  if (existsSync(distPath)) return distPath
  const publicPath = join(PUBLIC_DIR, normalized)
  if (existsSync(publicPath)) return publicPath
  return null
}

describe('PWA manifest conformance (S2 — pre-build)', () => {
  const buildExists = existsSync(DIST_MANIFEST) && existsSync(DIST_INDEX)

  it.skipIf(!buildExists)('manifest.webmanifest exists and is valid JSON', () => {
    const raw = readFileSync(DIST_MANIFEST, 'utf-8')
    expect(() => JSON.parse(raw) as Manifest).not.toThrow()
  })

  it.skipIf(!buildExists)('manifest has all required fields for installability', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.description).toBeTruthy()
    expect(m.start_url).toBeTruthy()
    expect(m.scope).toBeTruthy()
    expect(m.display).toBe('standalone')
    expect(m.theme_color).toMatch(/^#[0-9a-f]{3,8}$/i)
    expect(m.background_color).toMatch(/^#[0-9a-f]{3,8}$/i)
    expect(Array.isArray(m.icons)).toBe(true)
    expect(m.icons.length).toBeGreaterThan(0)
  })

  it.skipIf(!buildExists)('manifest declares 192x192 PNG icon (Chrome install min)', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const icon = m.icons.find(
      (i) =>
        i.sizes === '192x192' &&
        i.type === 'image/png' &&
        (i.purpose ?? 'any').split(/\s+/).includes('any'),
    )
    expect(icon, '192x192 PNG with purpose=any is required for Chrome PWA install').toBeDefined()
  })

  it.skipIf(!buildExists)('manifest declares 512x512 PNG icon (splash/store)', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const icon = m.icons.find(
      (i) =>
        i.sizes === '512x512' &&
        i.type === 'image/png' &&
        (i.purpose ?? 'any').split(/\s+/).includes('any'),
    )
    expect(icon, '512x512 PNG with purpose=any is required for splash screen').toBeDefined()
  })

  it.skipIf(!buildExists)('manifest declares maskable icon (Android adaptive)', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const icon = m.icons.find((i) =>
      (i.purpose ?? '').split(/\s+/).includes('maskable'),
    )
    expect(icon, 'maskable PNG icon required for Android adaptive icons').toBeDefined()
    expect(icon?.type).toBe('image/png')
  })

  it.skipIf(!buildExists)('every manifest icon src exists in dist/ or public/', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const missing: string[] = []
    for (const icon of m.icons) {
      if (!resolveIconPath(icon.src)) missing.push(icon.src)
    }
    expect(missing, `Missing icon files: ${missing.join(', ')}`).toEqual([])
  })

  it.skipIf(!buildExists)('icon files are non-empty (>200 bytes — basic sanity)', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    for (const icon of m.icons) {
      const p = resolveIconPath(icon.src)
      if (!p) continue
      const size = statSync(p).size
      expect(size, `${icon.src} is suspiciously small (${size}B)`).toBeGreaterThan(200)
    }
  })

  it.skipIf(!buildExists)('shortcut icons reference existing files', () => {
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const missing: string[] = []
    for (const sc of m.shortcuts ?? []) {
      for (const icon of sc.icons ?? []) {
        if (!resolveIconPath(icon.src)) missing.push(`${sc.name} → ${icon.src}`)
      }
    }
    expect(missing).toEqual([])
  })

  it.skipIf(!buildExists)('index.html has apple-touch-icon link (iOS PNG; SVG ignored)', () => {
    const html = readFileSync(DIST_INDEX, 'utf-8')
    const match = html.match(
      /<link\b[^>]*\brel=["']apple-touch-icon["'][^>]*\bhref=["']([^"']+)["']/i,
    )
    expect(match, 'apple-touch-icon link missing from index.html').not.toBeNull()
    const href = match![1]
    expect(href).toMatch(/\.png(\?|$)/i)
    const p = resolveIconPath(href)
    expect(p, `apple-touch-icon href "${href}" not found on disk`).not.toBeNull()
  })

  it.skipIf(!buildExists)('index.html has theme-color meta matching manifest', () => {
    const html = readFileSync(DIST_INDEX, 'utf-8')
    const m = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8')) as Manifest
    const match = html.match(
      /<meta\b[^>]*\bname=["']theme-color["'][^>]*\bcontent=["']([^"']+)["']/i,
    )
    expect(match, 'theme-color meta missing from index.html').not.toBeNull()
    expect(match![1].toLowerCase()).toBe(m.theme_color.toLowerCase())
  })

  it.skipIf(!buildExists)('index.html has apple-mobile-web-app-capable meta', () => {
    const html = readFileSync(DIST_INDEX, 'utf-8')
    expect(html).toMatch(
      /<meta\b[^>]*\bname=["']apple-mobile-web-app-capable["'][^>]*\bcontent=["']yes["']/i,
    )
  })

  it.skipIf(!buildExists)('index.html has apple-mobile-web-app-status-bar-style meta', () => {
    const html = readFileSync(DIST_INDEX, 'utf-8')
    expect(html).toMatch(
      /<meta\b[^>]*\bname=["']apple-mobile-web-app-status-bar-style["']/i,
    )
  })

  it.skipIf(!buildExists)('index.html links to the manifest', () => {
    const html = readFileSync(DIST_INDEX, 'utf-8')
    expect(html).toMatch(/<link\b[^>]*\brel=["']manifest["']/i)
  })
})
