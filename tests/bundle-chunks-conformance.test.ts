/**
 * Bundle chunks conformance — ratchet POR CHUNK individual.
 *
 * Complementa `tests/cwv-conformance.test.ts` (que cobre entry size
 * + total transfer global). Este audita os chunks principais um a um
 * pra defender ganhos de otimização: sem ratchet por chunk, futuras
 * regressões "pequenas" (vendor-react +10 KB, vendor-motion +15 KB,
 * etc.) passam batido se o total ainda cabe no budget global.
 *
 * Filosofia:
 *   - Cada ratchet é ~5-10% acima do tamanho atual medido. Margem pra
 *     oscilação de minificação (terser não é determinístico em ordem
 *     de manglers, source order de imports muda).
 *   - Se você CORTOU bytes, BAIXE o ratchet aqui pra travar o ganho.
 *     Próxima regressão dispara CI fail em vez de derreter silencioso.
 *   - Se você PRECISA aumentar (nova dep, feature necessária), suba o
 *     ratchet aqui no MESMO PR, com justificativa no commit message ou
 *     PR description. Ratchet subir é debate, não rubber stamp.
 *
 * Chunks cobertos:
 *   - index-*.js (entry, identificado via index.html)
 *   - vendor-react, vendor-nostr, vendor-motion (eager, modulepreload)
 *   - vendor-identity, nostr-extras (lazy, mas críticos pra primeira
 *     interação — IdentityPanel + nip44/nip98 quando upload roda)
 *   - helia-deps, maplibre-gl (super-lazy, mas regressão custa MB ao
 *     user que aciona Pin/Mapa — proteger mesmo assim)
 *   - workbox-window (PWA register)
 *
 * Chunks NÃO cobertos aqui (intencionalmente):
 *   - db.worker, sqlite3-* — SQLite WASM, pinned em package.json
 *   - blobs, helia-* (não helia-deps), pipeline, rateLimit, tor,
 *     torWebSocket, core, event, boot, *-Panel, *-Modal, *-Settings —
 *     pequenos demais (<60 KB) e voláteis (mudam a cada feat). Cobertos
 *     indiretamente pelo budget total em cwv-conformance.
 *   - solid-polygon-layer, webgl-* — sub-chunks do maplibre/deck.gl,
 *     mudam quando upstream atualiza, sem controle nosso.
 *
 * Como rodar:
 *   npm run build && npm run test -- bundle-chunks-conformance
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const DIST_ASSETS = join(DIST, 'assets')
const DIST_INDEX = join(DIST, 'index.html')

/**
 * Ratchets por chunk — bytes (raw uncompressed disk size, gzip ~3-4x menor).
 *
 * Baseline 2026-05-15 (medido após corte agressivo: lazy ThreadView,
 * nostr-extras split, vendor-identity, modulePreload filter).
 *
 * Cada entry: [prefixo, limit em bytes, tamanho atual em bytes].
 * Prefixo é casado via startsWith em `name.replace(/-[A-Za-z0-9_-]+\.js$/, '')`.
 * O 3o campo é só pra log/PR-review — não usado em assert.
 *
 * Convenção: limit ≈ atual * 1.07 arredondado pra KB par. Folga de
 * ~7% absorve oscilação de minificação sem mascarar regressão real.
 */
const CHUNK_RATCHETS: ReadonlyArray<{
  prefix: string
  limit: number
  currentBaseline: number
  eager: boolean
  note: string
}> = [
  // Entry — tratado separado abaixo (id via index.html), só pra log.
  // vendor-react: React + ReactDOM + scheduler. Estável.
  { prefix: 'vendor-react', limit: 152 * 1024, currentBaseline: 141963, eager: true, note: 'React core, cache stability' },
  // vendor-nostr: nostr-tools (resto) + @noble/secp256k1 + hashes + @scure/base + html5-qrcode
  { prefix: 'vendor-nostr', limit: 138 * 1024, currentBaseline: 124892, eager: true, note: 'Nostr core eager (signing) — html5-qrcode added 2026-05' },
  // vendor-motion: framer-motion (gestures, variants)
  { prefix: 'vendor-motion', limit: 154 * 1024, currentBaseline: 143285, eager: true, note: 'Framer Motion — PostCard mount' },
  // vendor-identity: qrcode + @scure/bip39 + @scure/bip32 (lazy)
  { prefix: 'vendor-identity', limit: 78 * 1024, currentBaseline: 72715, eager: false, note: 'Lazy IdentityPanel/Switcher (V9.21)' },
  // nostr-extras: nip44 + nip98 + @noble/ciphers (now eager — pulled into modulepreload graph)
  { prefix: 'nostr-extras', limit: 20 * 1024, currentBaseline: 18159, eager: true, note: 'Eager since 2026-05 (webrtc signaling + upload, promoted to preload graph)' },
  // helia-deps: helia + libp2p + @chainsafe + multiformats family (super lazy)
  { prefix: 'helia-deps', limit: 1000 * 1024, currentBaseline: 968708, eager: false, note: 'Track B (NIP-94 pin) — Settings > Pin' },
  // maplibre-gl: super lazy, só carrega quando mapa abre
  { prefix: 'maplibre-gl', limit: 1080 * 1024, currentBaseline: 1054212, eager: false, note: 'Mapa overlay (rota Map)' },
  // workbox-window: PWA register helper
  // workbox-window: nome real é `workbox-window.prod.es5-<hash>.js` (vite-plugin-pwa
  // emite com sub-extensão preservada). Usar prefixo mais específico.
  { prefix: 'workbox-window.prod.es5', limit: 7 * 1024, currentBaseline: 5719, eager: true, note: 'PWA register (useRegisterSW)' },
]

interface Inspection {
  hasDist: boolean
  indexHtml: string
  assetFiles: { name: string; size: number }[]
  entryName: string | null
  entrySize: number | null
}

function inspect(): Inspection {
  if (!existsSync(DIST) || !existsSync(DIST_INDEX) || !existsSync(DIST_ASSETS)) {
    return { hasDist: false, indexHtml: '', assetFiles: [], entryName: null, entrySize: null }
  }
  const indexHtml = readFileSync(DIST_INDEX, 'utf8')
  const assetFiles = readdirSync(DIST_ASSETS)
    .filter((f) => f.endsWith('.js'))
    .map((name) => ({ name, size: statSync(join(DIST_ASSETS, name)).size }))

  // Entry: <script type="module" src="/assets/index-<hash>.js">. Pode
  // haver vários index-*.js (dynamic imports nomeados pelo Rollup como
  // "index" de subpastas) — só o referenciado em index.html é o entry.
  const entryMatch = indexHtml.match(
    /<script\s+type="module"[^>]*\bsrc="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/,
  )
  const entryName = entryMatch ? entryMatch[1] : null
  const entryFile = entryName ? assetFiles.find((f) => f.name === entryName) : undefined
  const entrySize = entryFile ? entryFile.size : null

  return { hasDist: true, indexHtml, assetFiles, entryName, entrySize }
}

const inspection = inspect()

/**
 * Acha o arquivo cujo nome começa com `<prefix>-` e termina com `.js`,
 * onde o segmento entre `-` e `.js` é o hash Vite (alfanumérico + `_-`).
 * Retorna `null` se não houver match ou se houver match ambíguo.
 *
 * Ambiguidade é erro de configuração (Rollup nunca emite dois chunks
 * com mesmo prefixo após manualChunks); reportar pra investigar.
 */
function findChunk(
  files: { name: string; size: number }[],
  prefix: string,
): { name: string; size: number } | null | 'ambiguous' {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}-[A-Za-z0-9_-]+\\.js$`)
  const matches = files.filter((f) => re.test(f.name))
  if (matches.length === 0) return null
  if (matches.length > 1) return 'ambiguous'
  return matches[0]
}

describe('Bundle chunks conformance — ratchet por chunk', () => {
  describe('preflight', () => {
    it('dist/ existe (rode `npm run build` antes)', () => {
      if (!inspection.hasDist) {
        // eslint-disable-next-line no-console
        console.warn(
          '[bundle-chunks] dist/ ausente — skipping per-chunk ratchets. ' +
            'Rode `npm run build` antes.',
        )
      }
      expect(true).toBe(true)
    })
  })

  describe('entry chunk (identificado via index.html)', () => {
    /**
     * Entry chunk ratchet — 210 KB.
     *
     * Baseline 2026-05-15: 194,695 bytes (~190 KB) após lazy ThreadView
     * (23f8e6c) + nostr-extras split (213f90d). Soft target global em
     * cwv-conformance.ts é 250 KB; aqui apertamos pra 210 KB pra
     * defender o ganho específico do entry.
     */
    const ENTRY_RATCHET = 210 * 1024

    it.skipIf(!inspection.hasDist)('entry chunk identificável', () => {
      expect(inspection.entryName, 'esperado <script type="module" src="/assets/index-*.js"> em dist/index.html').not.toBeNull()
    })

    it.skipIf(!inspection.hasDist || !inspection.entryName)(
      `entry chunk ≤ ${ENTRY_RATCHET / 1024} KB (ratchet apertado)`,
      () => {
        const size = inspection.entrySize!
        const sizeKB = (size / 1024).toFixed(1)
        expect(
          size,
          `Chunk ${inspection.entryName} é ${sizeKB} KB, limit ${ENTRY_RATCHET / 1024} KB. ` +
            `Cortar (mais lazy? mover dep pra vendor split?) ou justificar o aumento ` +
            `subindo o ratchet em tests/bundle-chunks-conformance.test.ts.`,
        ).toBeLessThanOrEqual(ENTRY_RATCHET)
      },
    )
  })

  describe('vendor + lazy chunks', () => {
    for (const ratchet of CHUNK_RATCHETS) {
      const limitKB = (ratchet.limit / 1024).toFixed(1)
      const baselineKB = (ratchet.currentBaseline / 1024).toFixed(1)
      const eagerLabel = ratchet.eager ? 'eager' : 'lazy'

      it.skipIf(!inspection.hasDist)(
        `${ratchet.prefix}-*.js ≤ ${limitKB} KB (${eagerLabel}, baseline ~${baselineKB} KB)`,
        () => {
          const match = findChunk(inspection.assetFiles, ratchet.prefix)
          if (match === 'ambiguous') {
            throw new Error(
              `[bundle-chunks] múltiplos chunks com prefixo "${ratchet.prefix}-" — ` +
                `manualChunks em vite.config.ts emitiu mais de um? Investigar.`,
            )
          }
          if (match === null) {
            // Chunk sumiu — pode ser legítimo (refactor moveu pra outro
            // bundle, dep removida) ou pode ser bug de config. Fail
            // pra forçar consciência: ou re-route do conteúdo pra outro
            // ratchet, ou remove a entry daqui.
            throw new Error(
              `[bundle-chunks] chunk "${ratchet.prefix}-*.js" não encontrado em dist/assets/. ` +
                `Se removido intencionalmente, apague a entry de CHUNK_RATCHETS em ` +
                `tests/bundle-chunks-conformance.test.ts. Senão, investigar manualChunks ` +
                `em vite.config.ts.`,
            )
          }
          const sizeKB = (match.size / 1024).toFixed(1)
          expect(
            match.size,
            `Chunk ${match.name} é ${sizeKB} KB, limit ${limitKB} KB. ` +
              `Cortar ou justificar o aumento subindo o ratchet em ` +
              `tests/bundle-chunks-conformance.test.ts (${ratchet.note}).`,
          ).toBeLessThanOrEqual(ratchet.limit)
        },
      )
    }
  })
})
