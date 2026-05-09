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
 * Thresholds (mobile, throttled — match runtime real de celular médio):
 *   - Performance score ≥ 0.95 (target manifesto §13 UX/perf)
 *   - LCP ≤ 2500ms (Google Core Web Vitals "good")
 *   - FCP ≤ 1800ms
 *   - CLS ≤ 0.1
 *   - TBT ≤ 200ms (proxy local pra INP — Lighthouse não mede INP em lab)
 *   - INP ≤ 200ms (apenas se métrica disponível na versão)
 *
 * Continue-on-error em PRs (warn, não bloqueia merge inicialmente);
 * hard-fail só em main quando bundle estiver otimizado (ratchet).
 */
module.exports = {
  ci: {
    collect: {
      // `npm run preview` serve dist/ em http://localhost:4173 por default.
      // lhci sobe, espera, navega, mata.
      startServerCommand: 'npm run preview -- --port 4173',
      url: ['http://localhost:4173/'],
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
        // Skip categorias que não interessam pra gating (PWA é checada
        // pelo manifesto check + Workbox no build; SEO não é prioridade
        // num app anti-censura; a11y é tracked separadamente).
        onlyCategories: ['performance'],
      },
    },
    assert: {
      // Soft mode inicial — warn, não erro. Quando bundle otimizado
      // (entry chunk ≤ 250KB, helia lazy real), virar 'error'.
      preset: 'lighthouse:no-pwa',
      assertions: {
        'categories:performance': ['warn', { minScore: 0.95 }],
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
