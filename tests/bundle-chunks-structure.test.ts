/**
 * Bundle chunks structure — snapshot da composição de chunks.
 *
 * Complementa `tests/bundle-chunks-conformance.test.ts` (ratchet por
 * tamanho) e `tests/cwv-conformance.test.ts` (entry size + total).
 * Este guard defende a ESTRUTURA do bundle, não o tamanho: se alguém
 * quebrar `manualChunks` em `vite.config.ts` (remover regex de
 * vendor-nostr, deixar helia eager, mergear vendor-identity de volta
 * em vendor-nostr, etc.), o split desfeito é silenciosamente refletido
 * só num aumento de tamanho — que os ratchets capturam tarde demais
 * (depois que vendor-X gordo já invalidou o cache do user).
 *
 * Filosofia:
 *   - Cada `it` defende uma propriedade arquitetural do split:
 *       * lazy chunks NÃO devem aparecer em `<link rel="modulepreload">`
 *         (senão o browser baixa eager e o ganho é zero)
 *       * eager chunks DEVEM aparecer em modulepreload (vendor split
 *         só justifica cache stability se preload está lá)
 *       * chunks-chave (vendor-identity, helia-deps, maplibre-gl,
 *         spreadMapLayers, nostr-extras) DEVEM existir — se sumiram,
 *         alguém mergeou de volta sem atualizar este teste
 *       * Não devem surgir vendor-* novos não-listados (catches accidental
 *         split por novo regex em manualChunks)
 *
 *   - Match por prefixo + hash, conservador: chunks rotacionam hash a
 *     cada build (vendor-motion-DOsOIYRC.js → vendor-motion-XXXXXX.js).
 *
 *   - Skip behavior: se `dist/` ausente, skip com warning (consistente
 *     com cwv-conformance + bundle-chunks-conformance).
 *
 * Como rodar:
 *   npm run build && npm run test -- bundle-chunks-structure
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const DIST_ASSETS = join(DIST, 'assets')
const DIST_INDEX = join(DIST, 'index.html')

/**
 * Chunks que DEVEM ser eager (modulepreload presente em index.html).
 * Critical path do TTI — sem preload, browser descobre tarde via parser
 * do entry chunk e o waterfall fica em serie.
 */
const EAGER_PRELOAD_EXPECTED: ReadonlyArray<string> = [
  'vendor-react',
  'vendor-nostr',
  'vendor-motion',
  'nostr-extras',
]

/**
 * Chunks que NÃO podem ser eager (preload os promove a critical path,
 * derrotando o split). Estes são os chunks que `vite.config.ts`
 * `modulePreload.resolveDependencies` filtra explicitamente.
 *
 * spreadMapLayers + SpreadMap + ThreadView são lazy via dynamic import
 * em src/ (não filtrados em config porque Vite não os pulla pro preload
 * graph), mas defendemos mesmo assim — se alguém fizer eager import
 * acidental, o preload aparece.
 */
const LAZY_NOT_PRELOADED: ReadonlyArray<string> = [
  'vendor-identity',
  'helia-deps',
  'maplibre-gl',
  'rebroadcast',
  'spreadMapLayers',
  'SpreadMap',
  'ThreadView',
  'IdentityPanel',
  'IdentitySwitcher',
  'tesselator',
]

/**
 * Chunks que DEVEM existir em dist/assets/. Lista positiva: se algum
 * sumiu, ou manualChunks foi quebrado, ou refactor moveu o conteúdo
 * sem atualizar este teste. Em qualquer caso, force a consciência.
 *
 * vendor-react + vendor-nostr + vendor-motion já cobertos via
 * EAGER_PRELOAD_EXPECTED. Aqui ficam os lazy críticos.
 */
const REQUIRED_CHUNKS: ReadonlyArray<{ prefix: string; reason: string }> = [
  { prefix: 'vendor-react', reason: 'React core eager (cache stability)' },
  { prefix: 'vendor-nostr', reason: 'Nostr core eager (signing)' },
  { prefix: 'vendor-motion', reason: 'Framer Motion eager (PostCard mount)' },
  { prefix: 'vendor-identity', reason: 'V9.21 split — qrcode + bip39/bip32 lazy' },
  { prefix: 'nostr-extras', reason: 'V9.34c split — nip44/nip98 + ciphers lazy' },
  { prefix: 'helia-deps', reason: 'Track B (NIP-94 pin) super-lazy' },
  { prefix: 'maplibre-gl', reason: 'Mapa overlay super-lazy' },
  { prefix: 'spreadMapLayers', reason: 'Deck.gl ArcLayer (Ted v3 cut from entry)' },
]

/**
 * Lista FECHADA de prefixos vendor-*. Se um vendor-XXXX novo aparecer
 * sem entry aqui, é provavelmente split acidental por regex novo em
 * manualChunks — quebrando a estabilidade de cache.
 */
const KNOWN_VENDOR_PREFIXES: ReadonlySet<string> = new Set([
  'vendor-react',
  'vendor-nostr',
  'vendor-motion',
  'vendor-identity',
])

interface Inspection {
  hasDist: boolean
  indexHtml: string
  assetFiles: string[]
  preloadedAssets: Set<string>
}

function inspect(): Inspection {
  if (!existsSync(DIST) || !existsSync(DIST_INDEX) || !existsSync(DIST_ASSETS)) {
    return { hasDist: false, indexHtml: '', assetFiles: [], preloadedAssets: new Set() }
  }
  const indexHtml = readFileSync(DIST_INDEX, 'utf8')
  const assetFiles = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'))

  // Extrai todos os modulepreload de /assets/*.js
  const preloadedAssets = new Set<string>()
  const re = /<link\s+rel="modulepreload"[^>]*\bhref="\/assets\/([^"]+\.js)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(indexHtml)) !== null) {
    preloadedAssets.add(m[1])
  }

  return { hasDist: true, indexHtml, assetFiles, preloadedAssets }
}

const inspection = inspect()

/**
 * Casa `<prefix>-<hash>.js` em uma lista de nomes. Retorna o nome
 * completo ou `null` se nenhum match.
 *
 * Hash Vite: alfanumérico + `_-`. Não casa `.` (evita `workbox-window.prod.es5-XXXX.js`
 * fora do prefixo desejado — quem quer aquele chunk especifica
 * `workbox-window.prod.es5` como prefix).
 */
function findChunk(files: ReadonlyArray<string>, prefix: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}-[A-Za-z0-9_-]+\\.js$`)
  return files.find((f) => re.test(f)) ?? null
}

/**
 * Retorna `true` se algum arquivo em `preloaded` casar o prefixo.
 */
function isPrefixPreloaded(preloaded: ReadonlySet<string>, prefix: string): boolean {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}-[A-Za-z0-9_-]+\\.js$`)
  for (const f of preloaded) if (re.test(f)) return true
  return false
}

describe('Bundle chunks structure — composition guard', () => {
  describe('preflight', () => {
    it('dist/ existe (rode `npm run build` antes)', () => {
      if (!inspection.hasDist) {
        // eslint-disable-next-line no-console
        console.warn(
          '[bundle-chunks-structure] dist/ ausente — skipping structure checks. ' +
            'Rode `npm run build` antes.',
        )
      }
      expect(true).toBe(true)
    })
  })

  describe('eager preload (modulepreload em index.html)', () => {
    /**
     * Defende: entry chunk traz consigo via <link rel="modulepreload">
     * os vendors críticos (react, nostr, motion). Sem isso, vendor
     * split degrada TTI em vez de melhorar cache stability — descoberta
     * vira serie em vez de parallel.
     */
    it.skipIf(!inspection.hasDist)(
      'entry chunk has expected eager preload partners (vendor-react, vendor-nostr, vendor-motion, nostr-extras)',
      () => {
        for (const prefix of EAGER_PRELOAD_EXPECTED) {
          const preloaded = isPrefixPreloaded(inspection.preloadedAssets, prefix)
          expect(
            preloaded,
            `Esperava <link rel="modulepreload" href="/assets/${prefix}-*.js"> em dist/index.html. ` +
              `Se removido intencionalmente do split eager, atualize EAGER_PRELOAD_EXPECTED + ` +
              `REQUIRED_CHUNKS em tests/bundle-chunks-structure.test.ts.`,
          ).toBe(true)
        }
      },
    )
  })

  describe('lazy chunks (NÃO podem estar em modulepreload)', () => {
    /**
     * Defende: chunks lazy do `modulePreload.resolveDependencies`
     * filter em vite.config.ts continuam fora do preload graph. Bug
     * documentado em CWV-2 §3.1: Vite default emite preload pra todo
     * chunk alcançável no graph estático, inclusive descoberto via
     * dynamic import — derruba LCP em 2s+ (Helia/libp2p 313 KB eager).
     *
     * spreadMapLayers + SpreadMap + ThreadView são lazy via React.lazy
     * em src/; estão aqui pra defender que ninguém fez import direto
     * acidental que os promova ao preload graph.
     */
    it.skipIf(!inspection.hasDist)(
      'lazy chunks are NOT in modulepreload (vendor-identity, helia-deps, maplibre-gl, spreadMapLayers, rebroadcast, ThreadView, IdentityPanel, SpreadMap, tesselator)',
      () => {
        for (const prefix of LAZY_NOT_PRELOADED) {
          const preloaded = isPrefixPreloaded(inspection.preloadedAssets, prefix)
          expect(
            preloaded,
            `Chunk lazy "${prefix}-*.js" apareceu em <link rel="modulepreload"> de dist/index.html — ` +
              `quebra do filtro em vite.config.ts modulePreload.resolveDependencies, OU ` +
              `algum import eager novo o puxou pro preload graph. Investigar antes de mergear.`,
          ).toBe(false)
        }
      },
    )
  })

  describe('required chunks exist', () => {
    /**
     * Defende: todos os chunks da arquitetura conhecida ainda são
     * emitidos. Se algum sumiu, ou o regex de manualChunks foi
     * removido/quebrado, ou refactor moveu o conteúdo pra outro split
     * sem atualizar a lista — em qualquer caso, force consciência.
     */
    it.skipIf(!inspection.hasDist)(
      'core lazy + eager chunks exist (vendor-identity, helia-deps, maplibre-gl, spreadMapLayers, nostr-extras, vendor-*)',
      () => {
        const missing: string[] = []
        for (const { prefix, reason } of REQUIRED_CHUNKS) {
          const match = findChunk(inspection.assetFiles, prefix)
          if (!match) missing.push(`${prefix}-*.js (${reason})`)
        }
        expect(
          missing,
          `Chunks esperados ausentes em dist/assets/:\n  - ${missing.join('\n  - ')}\n` +
            `Verificar vite.config.ts manualChunks ou atualizar REQUIRED_CHUNKS em ` +
            `tests/bundle-chunks-structure.test.ts.`,
        ).toEqual([])
      },
    )

    /**
     * spreadMapLayers especificamente: cortado do entry pelo Ted v3
     * (deck.gl ArcLayer só carrega quando SpreadMap monta). Se voltar
     * pro entry, é regressão direta de ~30 KB no critical path.
     */
    it.skipIf(!inspection.hasDist)(
      'spreadMapLayers chunk exists and is lazy (deck.gl cut from entry — Ted v3)',
      () => {
        const match = findChunk(inspection.assetFiles, 'spreadMapLayers')
        expect(match, 'spreadMapLayers-*.js deve existir em dist/assets/').not.toBeNull()
        const preloaded = isPrefixPreloaded(inspection.preloadedAssets, 'spreadMapLayers')
        expect(
          preloaded,
          'spreadMapLayers NÃO pode estar em modulepreload — deck.gl ArcLayer é lazy por design ' +
            '(Ted v3 cut from entry). Se preload reapareceu, algum import eager o puxou.',
        ).toBe(false)
      },
    )
  })

  describe('no unexpected vendor-* chunks (catches accidental split)', () => {
    /**
     * Defende: ninguém adicionou `if (...) return 'vendor-foo'` novo em
     * manualChunks sem atualizar este teste. Vendor split novo divide
     * cache: cada vendor-* a mais é uma entrada extra no HTTP cache do
     * user, e o ganho de stability só vale a pena pra deps grandes +
     * estáveis (react, nostr-tools). Vendor-* especulativo regride
     * mais do que ajuda.
     */
    it.skipIf(!inspection.hasDist)(
      'no unexpected vendor-* chunks beyond KNOWN_VENDOR_PREFIXES',
      () => {
        const vendorFiles = inspection.assetFiles.filter((f) => f.startsWith('vendor-'))
        const unexpected: string[] = []
        for (const file of vendorFiles) {
          // Extrai prefixo: vendor-react-u7NqBe2v.js → vendor-react
          const m = file.match(/^(vendor-[A-Za-z0-9]+)-[A-Za-z0-9_-]+\.js$/)
          if (!m) continue // nome fora do padrão — ignora (sub-chunks raros)
          const prefix = m[1]
          if (!KNOWN_VENDOR_PREFIXES.has(prefix)) {
            unexpected.push(file)
          }
        }
        expect(
          unexpected,
          `Vendor-* chunks inesperados em dist/assets/:\n  - ${unexpected.join('\n  - ')}\n` +
            `Algum manualChunks novo em vite.config.ts? Se intencional, adicione o prefixo a ` +
            `KNOWN_VENDOR_PREFIXES em tests/bundle-chunks-structure.test.ts com justificativa ` +
            `(why é estável + grande o suficiente pra justificar cache slot dedicado).`,
        ).toEqual([])
      },
    )
  })
})
