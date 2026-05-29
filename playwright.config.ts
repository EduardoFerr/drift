import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — Sprint N+5 E2E multi-user validation (Ted, B1).
 *
 * Valida bugs profundos #1 (score) e #3 (propagação) + P2P/Helia
 * end-to-end com ground-truth conhecido (cascata Alice→Bob→Carol→Dave).
 * Ver `Docs/sessions/sprint-n5-e2e-validation-2026-05-29.md`.
 *
 * ── crossOriginIsolated / COOP+COEP ────────────────────────────────
 * Drift exige `crossOriginIsolated === true` pra SharedArrayBuffer +
 * OPFS (SQLite WASM). Isso só vale com os headers COOP `same-origin`
 * + COEP. O dev server normal usa HTTPS via `basicSsl` (cert
 * auto-assinado) — Chromium headless reclama do cert. Rodamos o vite em
 * **modo HTTP** (`DRIFT_DEV_HTTP=1`), onde:
 *   - localhost via HTTP é secure context por spec (SAB/OPFS liberados);
 *   - `vite.config.ts` já emite COEP `require-corp` + COOP `same-origin`
 *     nesse modo (ver server.headers).
 * Sem cert auto-assinado, sem `ignoreHTTPSErrors` frágil. Determinístico.
 *
 * ── Cross-context P2P/IPFS mesh ─────────────────────────────────────
 * Os mocks (`src/lib/dev-seed/mock-webrtc.ts`, `mock-helia.ts`) usam
 * BroadcastChannel, que compartilha estado entre **páginas/abas da mesma
 * origin no mesmo BrowserContext**, NÃO entre BrowserContexts isolados.
 * Por isso a fixture multi-user (Lily, `e2e/fixtures/users.ts`) cria os
 * 8 named users como PÁGINAS dentro de um context compartilhado — assim
 * a malha BroadcastChannel conecta todos. Cada página ainda tem boot +
 * identidade independentes (nsec próprio via `?dev-seed=1`). Quando um
 * teste precisa isolamento total de storage (ex.: multi-identidade §4),
 * cria um `browser.newContext()` próprio — suportado, mas perde a malha
 * cross-page (esperado).
 *
 * Não usamos `storageState` global: cada teste/usuário boota limpo e
 * semeia via `?dev-seed=1`.
 */

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Specs E2E multi-user mexem em estado global (BroadcastChannel mesh,
  // SQLite OPFS). Serial por default evita cross-talk entre suites.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Boot do Drift (SQLite WASM + seed de 58 fixtures) é pesado.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Headless por default; `PWDEBUG=1` ou `--headed` na CLI sobrescreve.
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // COEP `require-corp` (modo dev HTTP) bloqueia recursos cross-origin
        // sem CORP header — esperado em E2E (sem imagens nostr.build reais).
      },
    },
  ],

  // Sobe o vite em modo HTTP (crossOriginIsolated via require-corp) +
  // dev-seed disponível. `reuseExistingServer` em dev acelera o loop;
  // em CI sempre sobe limpo.
  webServer: {
    command: 'npm run dev:tunnel',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
