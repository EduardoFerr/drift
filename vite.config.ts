import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTP mode opt-in via env var pra rodar com Cloudflare tunnel ou
// similar. localhost via HTTP é secure context per spec; tunnel
// adiciona HTTPS válido por cima (necessário pra PWA install em
// celular real, que rejeita cert auto-assinado mesmo com bypass).
//
//   DRIFT_DEV_HTTP=1 npm run dev    → Vite em HTTP, pareado com tunnel
//   npm run dev                     → Vite em HTTPS via basicSsl (default)
const useHttp = process.env.DRIFT_DEV_HTTP === '1'

export default defineConfig({
  plugins: [
    react(),
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
      registerType: 'autoUpdate',
      // Auto-injeta o script de registro do SW no index.html — requisito
      // pra `beforeinstallprompt` disparar.
      injectRegister: 'auto',
      // SW também roda em dev — sem isso, Chrome não considera o app
      // instalável e o evento de install nunca fira em desenvolvimento.
      devOptions: {
        enabled: true,
        type: 'module',
        // Não navegue agressivamente em dev — HMR pode conflitar.
        navigateFallback: 'index.html',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // SQLite WASM é grande — limite generoso para não pular ele
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
        theme_color: '#0a0a0f',
        background_color: '#08080f',
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
      // OBRIGATÓRIO para SharedArrayBuffer (SQLite WASM com OPFS)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
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
})
