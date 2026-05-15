/**
 * Lighthouse-CI config — CWV gating pra PRs e main.
 *
 * Round CWV-1 (Marshall): Lighthouse 2026-05-09 reportou Performance
 * 86/100. Drift target ≥95. Sem CI gate, regressão passa em PRs.
 *
 * Por que `.cjs`?
 * - `@lhci/cli@0.14` é CJS legado. Repositório é `"type": "module"`,
 *   então `lighthouserc.js` seria interpretado como ESM e quebra
 *   (lhci faz `require()` da config). Forçar `.cjs` resolve sem
 *   tocar no package.json.
 *
 * Como rodar local:
 *   npm run build
 *   npm run lhci          # autorun: starts preview, runs 3x, asserts
 *
 * Como rodar em CI: ver `.github/workflows/lighthouse.yml`.
 *
 * HTTPS na preview?
 * - `vite.config.ts` adiciona `basicSsl()` no array de plugins, o que
 *   afeta `vite preview` também — preview vira HTTPS com cert
 *   auto-assinado. Lighthouse v11+ falha hard com
 *   `INSECURE_DOCUMENT_REQUEST` mesmo com `--ignore-certificate-errors`
 *   (a auditoria interna do LH checa cert antes do gather).
 * - Solução: setar `DRIFT_DEV_HTTP=1` no startServerCommand. O toggle
 *   em vite.config.ts remove basicSsl() quando essa env var está
 *   presente, fazendo preview servir HTTP plain — exatamente o que
 *   LHCI precisa.
 *
 * Thresholds (mobile, throttled — match runtime real de celular médio):
 *   - Performance score ≥ 0.85 (atual ~0.93 mediana; margem 5-10% pra variance)
 *   - Accessibility score ≥ 0.95 (atual 1.0; ratchet leve)
 *   - Best Practices score ≥ 0.90 (atual ~0.96)
 *   - SEO score ≥ 0.95 (atual 1.0)
 *   - LCP ≤ 2500ms (Google Core Web Vitals "good")
 *   - FCP ≤ 1800ms
 *   - CLS ≤ 0.1
 *   - TBT ≤ 200ms (proxy local pra INP — Lighthouse não mede INP em lab)
 *
 * Por que folga grande no Performance (0.85 vs target 0.95)?
 * Lighthouse Performance tem variance ~3-5pt mesmo com 3-run median.
 * Threshold é guard-rail anti-regressão, não target aspiracional. Bump
 * pra 0.90 quando entry chunk ≤ 250KB sustentado por 2 sprints.
 *
 * Continue-on-error em PRs (warn, não bloqueia merge inicialmente);
 * hard-fail só em main quando bundle estiver otimizado (ratchet).
 */
module.exports = {
  ci: {
    collect: {
      // DRIFT_DEV_HTTP=1 → vite.config.ts pula basicSsl() → preview HTTP.
      // cross-env garante portabilidade Windows/Linux (CI roda Ubuntu,
      // dev pode rodar Windows).
      startServerCommand: 'cross-env DRIFT_DEV_HTTP=1 npm run preview -- --port 4173',
      url: ['http://localhost:4173/'],
      startServerReadyPattern: 'Local:',
      startServerReadyTimeout: 30000,
      // 3 runs → mediana. 1 run tem variance ~10pts; 3 estabiliza pra
      // ~3pt p95. 5 runs seria melhor mas dobra wall time CI.
      numberOfRuns: 3,
      settings: {
        // Mobile form-factor + 3G-fast throttling: matching default
        // PageSpeed Insights "Mobile" tab (que é o que stakeholders
        // veem). Desktop run pode entrar como `lhci-desktop` futuro.
        preset: 'desktop', // será sobrescrito por throttling/formFactor abaixo
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 640,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttling: {
          // Lighthouse "Slow 4G" preset — 1.6Mbps down, 750Kbps up,
          // 150ms RTT, 4x CPU slowdown. Match PSI Mobile.
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
        },
        // Quatro categorias core. PWA fica fora (Workbox + manifest
        // check no build cobrem; LH PWA audits são redundantes).
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      // Soft mode inicial — warn, não erro (exceto CLS que é hard).
      // Quando bundle otimizado (entry chunk ≤ 250KB sustentado),
      // promover performance pra 'error' + bump minScore pra 0.90.
      assertions: {
        // Categorias (score 0-1)
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.95 }],
        'categories:best-practices': ['warn', { minScore: 0.90 }],
        'categories:seo': ['warn', { minScore: 0.95 }],
        // Core Web Vitals individuais
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 1800 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
        'interactive': ['warn', { maxNumericValue: 3800 }],
        // Audits deprecated/irrelevantes para SPA Drift — silenciar
        'uses-http2': 'off',
        'uses-rel-preconnect': 'off',
        'canonical': 'off',
      },
    },
    upload: {
      // `temporary-public-storage` envia para LHCI public storage
      // (efêmero, sem auth). Útil pra link em PR comments.
      // Trocar pra `filesystem` se preferir não vazar perfis.
      target: 'temporary-public-storage',
    },
  },
}
