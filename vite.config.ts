import { defineConfig, type PluginOption, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
// Bundle analysis opt-in via DRIFT_ANALYZE=1 (npm run build:analyze).
// Round CWV-1: visualizer gera dist/stats.html com sunburst dos chunks
// pra investigar regressão de tamanho.
//
// Lazy import: rollup-plugin-visualizer só é resolvido quando o flag
// está ativo, evitando ~3MB de devDep no resolver normal e tolerando
// ambientes onde a dep ainda não foi instalada (fresh clone sem
// `npm install` completo).
const useAnalyzer = process.env.DRIFT_ANALYZE === '1'

// HTTP mode opt-in via env var pra rodar com Cloudflare tunnel ou
// similar. localhost via HTTP é secure context per spec; tunnel
// adiciona HTTPS válido por cima (necessário pra PWA install em
// celular real, que rejeita cert auto-assinado mesmo com bypass).
//
//   DRIFT_DEV_HTTP=1 npm run dev    → Vite em HTTP, pareado com tunnel
//   npm run dev                     → Vite em HTTPS via basicSsl (default)
const useHttp = process.env.DRIFT_DEV_HTTP === '1'

// Conditional visualizer plugin — async resolution evita require síncrono
// de uma optional devDep. Type usa PluginOption (Vite) pra aceitar tanto
// plugin vazio quanto array.
async function maybeVisualizer(): Promise<PluginOption[]> {
  if (!useAnalyzer) return []
  try {
    const { visualizer } = await import('rollup-plugin-visualizer')
    // `template: 'sunburst'` = melhor pra entender hot path; gzipSize
    // pra estimar transferência real.
    return [
      visualizer({
        filename: 'dist/stats.html',
        template: 'sunburst',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }) as PluginOption,
    ]
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[vite] DRIFT_ANALYZE=1 mas rollup-plugin-visualizer não está instalado. ' +
        'Rode `npm install` ou `npm install -D rollup-plugin-visualizer`.',
      e,
    )
    return []
  }
}
export default defineConfig(async (): Promise<UserConfig> => ({
  plugins: [
    react(),
    ...(await maybeVisualizer()),
    // Cert auto-assinado para o dev server. Necessário porque
    // crossOriginIsolated (e portanto OPFS / SharedArrayBuffer) requer
    // secure context — localhost via HTTP funciona, mas IP de rede
    // local (192.168.x.x do celular) NÃO. Sem HTTPS, app só roda no
    // PC. Em produção (Vercel) o HTTPS já vem pronto.
    //
    // Quando rodando atrás de Cloudflare tunnel (DRIFT_DEV_HTTP=1),
    // Vite serve HTTP local e o tunnel adiciona HTTPS válido — basicSsl
    // não é necessário e na verdade quebra o tunnel.
    ...(useHttp ? [] : [basicSsl()]),
    VitePWA({
      // 'prompt' (não 'autoUpdate'): manifesto §17 (sem chave mestra)
      // implica que update silencioso é "chave mestra disfarçada" — quem
      // controla o deploy poderia pushar JS arbitrário sem o user
      // perceber. Com 'prompt', `useRegisterSW` (em UpdatePrompt.tsx)
      // emite evento `needRefresh` quando há SW novo; UI mostra banner
      // "Nova versão disponível, atualizar?" e user decide. Trade-off
      // aceito: latência maior pra adoção de fix; defesa-em-profundidade
      // contra ator que comprometa Vercel/CI.
      registerType: 'prompt',
      // 'auto' inject + componente React (UpdatePrompt) usa hook
      // `useRegisterSW` de `virtual:pwa-register/react` pra controle
      // explícito do refresh. Hook funciona com inject auto.
      injectRegister: 'auto',
      // SW também roda em dev — sem isso, Chrome não considera o app
      // instalável e o evento de install nunca fira em desenvolvimento.
      devOptions: {
        enabled: true,
        type: 'module',
        // Não navegue agressivamente em dev — HMR pode conflitar.
        navigateFallback: 'index.html',
        // Em dev, `globPatterns` (configurado em `workbox` abaixo) aponta pra
        // arquivos de build (assets/index-*.js, *.wasm, etc.) que só existem
        // após `npm run build`. Workbox emite warning pra cada glob não-matched,
        // poluindo o terminal a cada reload. Suprime — em prod o build casa
        // os globs e os warnings somem.
        suppressWarnings: true,
      },
      workbox: {
        // Precache só os assets críticos pra abrir o app — chunks lazy do
        // maplibre-gl (1.1MB), tesselator do deck.gl (467K) e helia/libp2p
        // (~950KB pra Track B) NÃO entram aqui; são cacheados sob demanda
        // via runtimeCaching abaixo. Isso baixa o precache do install
        // inicial de ~3.8MB pra ~800KB.
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'assets/index-*.{js,css}',
          'assets/db.worker-*.js',
          'assets/sqlite3-*.js',
          '*.{wasm,svg,png,ico}',
        ],
        // Defesa: SQLite WASM ainda é grande (~860KB). Mantém limite generoso.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Lazy chunks do mapa + Track B (helia/libp2p): cacheia ao
            // primeiro uso, mantém indefinidamente.
            urlPattern: /\/assets\/(maplibre-gl|tesselator|rebroadcast|helia-deps)-[^.]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Tiles do CARTO — bom cachear pra mapa funcionar offline depois
            // que o user abriu uma vez.
            urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-tiles',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      includeAssets: [
        'drift-icon.svg',
        'apple-touch-icon.png',
        'pwa-64x64.png',
      ],
      manifest: {
        // `id` é exigido por instalabilidade moderna (Chrome 96+) — distingue
        // este PWA de outros no mesmo origin. Usamos start_url como id por
        // simplicidade e estabilidade.
        id: '/',
        name: 'Drift',
        short_name: 'Drift',
        description:
          'Rede social descentralizada onde o conteúdo se espalha pelo comportamento humano',
        // PT-BR explícito — o conteúdo do app, manifesto e UI são em PT.
        // Sem isso, o plugin emite default 'en' que confunde screen readers.
        lang: 'pt-BR',
        dir: 'ltr',
        theme_color: '#0c0c0b',
        background_color: '#0c0c0b',
        display: 'standalone',
        // Fallback gracioso — alguns browsers desktop preferem
        // window-controls-overlay (WCO) pra integração de barra de título.
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // Foca instância existente em vez de abrir nova aba — comportamento
        // esperado de "app aberto via link". Cobre também o caso do TWA.
        launch_handler: { client_mode: 'focus-existing' },
        // Reforça que queremos o PWA, não redireciona pra app store.
        // Manifesto §17 (sem dependência de loja proprietária).
        prefer_related_applications: false,
        // Atalhos no long-press do ícone (Android) e jump list (Windows).
        shortcuts: [
          {
            name: 'Novo post',
            short_name: 'Novo',
            description: 'Compor um post novo',
            url: '/?action=compose',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Configurações',
            short_name: 'Settings',
            description: 'Identidade, relays, filtros',
            url: '/?action=settings',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
        // Categorias ajudam o app a aparecer corretamente em stores tipo
        // F-Droid e listings PWA. `social` é a categoria oficial.
        categories: ['social'],
        // PNGs raster são exigidos pelo Chrome Android pra instalabilidade
        // — SVG no manifest passa em desktop mas mobile bloqueia. Mantemos
        // SVG como fallback adicional pro caso de browsers que prefiram.
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'drift-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // SQLite WASM não pode ser bundled
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    // Round CWV-2 (2026-05-09): sourcemaps em prod 'hidden' — gera .map
    // ao lado dos .js mas o bundle minified NÃO referencia
    // (`//# sourceMappingURL=` omitido). Lighthouse para de queixar de
    // "Missing source maps", e debug em prod ainda funciona uploadando
    // .map manualmente. Manifesto §17 (sem chave mestra) não regride —
    // bundle não embute segredos (nsec/master key nunca em runtime).
    sourcemap: 'hidden',
    // Round CWV-2 §3.1 (Ted RFC) — Helia preload fix. Vite default emite
    // `<link rel="modulepreload">` pra todos os chunks alcançáveis no
    // graph estático, incluindo dynamic imports descobertos
    // (Image.tsx:116 → blobs → helia-deps). Browser baixa 313KB de
    // Helia/libp2p ANTES do user precisar — bug confirmado em
    // Lighthouse 2026-05-09 (LCP 3.8s, -2.1s estimado pra fix).
    //
    // Solução cirúrgica: filtra chunks lazy do preload graph, preserva
    // preload pros chunks realmente críticos (entry → react-dom →
    // nostr-tools).
    modulePreload: {
      polyfill: true,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      resolveDependencies: (_filename: string, deps: string[]) => {
        // Lazy chunks que NÃO devem ser preloaded:
        //   - helia-deps    Track B (NIP-94 blobs/pin), Settings → Pin
        //   - maplibre-gl   Mapa overlay (1.1 MB)
        //   - tesselator    Deck.gl ArcLayer (467 KB)
        //   - rebroadcast   re-broadcast oportunista (Fase 5)
        const lazyChunks = /^(?:helia-deps|maplibre-gl|tesselator|rebroadcast|vendor-identity|nostr-extras)/
        return deps.filter((d: string) => !lazyChunks.test(d))
      },
    },
    rollupOptions: {
      output: {
        // Round CWV-2 §3.3 — vendor splitting pra cache stability.
        // Re-deploy de feed.ts não invalida React/ReactDOM/nostr-tools
        // no cache do user. Repeat-visit LCP melhora dramaticamente.
        manualChunks(id: string) {
          // React + ReactDOM + scheduler — vendor mais estável.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react'
          }
          // V9.21 — vendor-identity: qrcode + @scure/bip39 + @scure/bip32
          // só carregam quando IdentityPanel/IdentitySwitcher (lazy) montam.
          // Antes ficavam dentro de vendor-nostr (eager) porque match em
          // `@scure`. Ratchet de ~30-40 KB do bundle inicial.
          if (
            /[\\/]node_modules[\\/](qrcode|@scure[\\/]bip39|@scure[\\/]bip32)[\\/]/.test(id)
          ) {
            return 'vendor-identity'
          }
          // V9.34c — pull nip44/nip98 + @noble/ciphers OUT of
          // vendor-nostr (eager). Only used by lazy code (webrtc
          // signaling + upload). With source already importing from
          // submodules (`nostr-tools/nip44`, dynamic `nostr-tools/nip98`),
          // these files don't get pulled by the eager barrel any more,
          // and we can give them a separate chunk safely. Circular
          // observed previously came from including @noble/ciphers in
          // the lazy chunk while nip44 stayed in vendor-nostr — now
          // they go together so no back-edge.
          if (
            /[\\/]node_modules[\\/]nostr-tools[\\/]lib[\\/](?:cjs|esm)[\\/]nip(?:44|98)\.js/.test(id) ||
            /[\\/]node_modules[\\/]@noble[\\/]ciphers[\\/]/.test(id)
          ) {
            return 'nostr-extras'
          }
          // nostr-tools (resto) + crypto primitives. @noble/secp256k1
          // e @noble/hashes ficam aqui (usados eager por signing).
          // @scure/base fica aqui (bech32). bip39/bip32 saíram em
          // V9.21 pra vendor-identity.
          if (
            /[\\/]node_modules[\\/](nostr-tools|@noble[\\/]secp256k1|@noble[\\/]hashes|@scure[\\/]base)[\\/]/.test(id)
          ) {
            return 'vendor-nostr'
          }
          // Framer Motion — UI gestures + variants. Eager (PostCard
          // mount usa) mas estável → cache hit em redeploys.
          if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) {
            return 'vendor-motion'
          }
          // helia, @helia/*, libp2p, @libp2p/*, @chainsafe/* (libp2p
          // family), multiformats, blockstore-*, datastore-* — agrupa
          // tudo num único chunk grande "helia-deps". Vite ainda
          // code-splita o que for usado por outras rotas; este é só o
          // hint de naming. @noble/secp256k1 + @noble/hashes movidos
          // pra vendor-nostr (Round CWV-2).
          if (
            /[\\/]node_modules[\\/](helia|@helia|libp2p|@libp2p|@chainsafe|multiformats|blockstore-|datastore-|interface-blockstore|interface-datastore|interface-store|@multiformats|protons-runtime|uint8arrays|@noble[\\/]ed25519|it-[a-z]+|p-defer|p-queue|p-event|p-fifo|any-signal|race-event|merge-options|abortable-iterator|hashlru|progress-events|murmurhash3|just-safe-stringify)[\\/]/.test(id)
          ) {
            return 'helia-deps'
          }
          return undefined
        },
      },
    },
  },
  server: {
    // Escuta em todas as interfaces — necessário para acesso via
    // celular pela rede local (sem isso, Vite só responde em localhost).
    host: true,
    // Em modo tunnel (DRIFT_DEV_HTTP=1), libera hostnames de tunneling
    // pra Vite não bloquear como "DNS rebinding". `.trycloudflare.com`
    // cobre quick tunnels Cloudflare; `.ngrok.io`/`.ngrok-free.app`
    // cobrem ngrok. Em modo normal, mantém política restritiva default.
    ...(useHttp
      ? {
          allowedHosts: [
            '.trycloudflare.com',
            '.ngrok.io',
            '.ngrok-free.app',
            '.ngrok.app',
            '.lhr.life',
          ],
        }
      : {}),
    headers: {
      // OBRIGATÓRIO para SharedArrayBuffer (SQLite WASM com OPFS).
      // `credentialless` (em vez de `require-corp`) ainda dá
      // crossOriginIsolated mas permite imagens/recursos cross-origin
      // sem CORP header. Necessário pra image.nostr.build (CDN não
      // envia Cross-Origin-Resource-Policy). Chrome 96+, Edge 96+,
      // Firefox 119+. Safari ainda não suporta — mas o app já depende
      // de Chrome/Firefox para outras features (WebRTC + COOP).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
}))
