# Core Web Vitals tooling — Drift

> Round CWV-1 (Marshall — schema/conformance), 2026-05-09.
> Lighthouse baseline: Performance 86/100. Target: ≥95.

Este documento descreve o ferramental de Core Web Vitals usado pra
prevenir regressão de performance no Drift.

## Camadas de defesa

| Camada | O quê | Onde | Quando |
|---|---|---|---|
| Lab measurement | Lighthouse 3-run median, mobile, 4G throttled | `.lighthouserc.cjs` + `.github/workflows/lighthouse.yml` | Cada PR + push pra main |
| Bundle structure | Estrutura estática do dist (modulepreload, sizes, robots.txt) | `tests/cwv-conformance.test.ts` | `npm run test:bundle-size` (manual hoje; CI futuro) |
| Bundle inspection | Treemap dos chunks pra debug | `rollup-plugin-visualizer` (DRIFT_ANALYZE=1) | Local, on-demand |

## Como rodar Lighthouse local

```bash
npm install                # instala @lhci/cli
npm run build              # gera dist/
npm run lhci               # autorun: starts preview, runs 3x, asserts
```

`npm run lhci` invoca `lhci autorun`, que:
1. Sobe `npm run preview -- --port 4173` em background.
2. Aguarda servidor responder.
3. Roda 3 lighthouse runs contra `http://localhost:4173/`.
4. Calcula mediana das métricas.
5. Aplica asserts de `.lighthouserc.cjs`.
6. Mata o preview server.

Saída:
- Console: warns/errors por assertion.
- `.lighthouseci/`: relatórios HTML (1 por run).
- Upload: link efêmero para LHCI public storage.

## Como inspecionar bundle

```bash
npm run build:analyze
# abre dist/stats.html no browser
#
# Windows (PowerShell):    Invoke-Item dist/stats.html
# Windows (cmd):            start dist\stats.html
# macOS:                    open dist/stats.html
# Linux:                    xdg-open dist/stats.html
```

Por baixo dos panos `build:analyze` é só `cross-env DRIFT_ANALYZE=1
npm run build` — `cross-env` deixa o flag passar igual em
PowerShell/cmd/bash. O plugin é optional-resolved via
`await import(...)` em `vite.config.ts:maybeVisualizer()`, então
build normal (sem o flag) não carrega a dep nem emite o HTML.

Saída:
- `dist/stats.html`: treemap clicável dos chunks com tamanhos
  uncompressed / gzip / brotli (áreas proporcionais ao tamanho —
  o que é gordo aparece grande imediatamente).
- Arquivo é local (`.gitignore` cobre via `dist/`), não é commitado.

Como ler:
- **Cor por chunk parent** (ex: `vendor-react`, `helia-deps`,
  `entry`). Quadrado grande = chunk grande.
- **Click pra zoom** num subdiretório (ex: `node_modules/helia/` →
  ver quais submódulos pesam mais).
- **Hover** mostra raw / gzip / brotli em bytes.

Hot questions:
- "Por que helia-deps tá tão grande?" → drill em
  `helia-deps-*.js` → procurar libp2p subpackages duplicados.
- "Por que entry chunk explodiu?" → comparar treemap antes/depois;
  módulo novo aparece como bloco que não estava lá.
- "Tenho dep duplicada?" → mesma lib aparece em 2+ chunks com
  tamanho similar = duplicação. Resolver via `manualChunks` ou
  `dedupe` em vite config.
- "Esse import é dynamic mesmo?" → se aparece dentro de
  `vendor-react` ou `entry`, NÃO é lazy de fato; mover pra chunk
  separado via `React.lazy` ou `import()`.

O que procurar especificamente em Drift:
- Entry chunk ≤ 250 KB (S1 hard ratchet — `tests/cwv-conformance.test.ts`).
- helia-deps, maplibre-gl, tesselator, rebroadcast, vendor-identity,
  nostr-extras devem ser lazy (sem `<link modulepreload>` em
  `dist/index.html` — `modulePreload.resolveDependencies` em
  `vite.config.ts` filtra).
- `@noble/secp256k1` e `@noble/hashes` em `vendor-nostr` (eager,
  signing); `@scure/bip39` + `bip32` + `qrcode` em `vendor-identity`
  (lazy).

## Como interpretar budget failures

Tests em `tests/cwv-conformance.test.ts` agrupam por severity:

- **S0** — bug confirmado bloqueando target ≥95. Hoje: helia-deps em
  modulepreload (carrega ~1MB no boot mesmo sendo lazy logicamente).
- **S1** — entry chunk size budget. Hard ceiling 300 KB; soft target
  250 KB.
- **S2** — total transfer initial route ≤ 800 KB.
- **S3** — artifact integrity (manifest, robots.txt).

**Soft mode hoje**: tests warn em vez de falhar enquanto bundle ainda
não foi otimizado. Quando S0/S1 resolverem, trocar `console.warn` +
`expect(true)` por `expect(...).toEqual(...)` hard. Cada soft tem
`// TODO(cwv-1)` inline marcando o critério pra promoção.

## CI gate semantics

| Workflow | Hard fail? |
|---|---|
| `lighthouse.yml` em PR | Não (`continue-on-error: true`) — warn-only inicial |
| `lighthouse.yml` em push main | Sim — regressão merged é responsabilidade do team |
| Conformance tests (CLS error) | Sim sempre — CLS regressão visual é inaceitável |
| Conformance tests (Performance warn) | Não — soft inicial |

Quando entry chunk ≤ 250 KB e helia-deps lazy de fato:
1. Trocar `'warn'` por `'error'` em `.lighthouserc.cjs` para
   `categories:performance`, `largest-contentful-paint`,
   `total-blocking-time`.
2. Trocar `continue-on-error: ${{ github.event_name == 'pull_request' }}`
   por `continue-on-error: false` em `.github/workflows/lighthouse.yml`.
3. Trocar warns soft por hard expects em `tests/cwv-conformance.test.ts`
   (procurar `// TODO(cwv-1)`).

## Tooling notas — incompatibilidades conhecidas

### `@lhci/cli` é CJS

`@lhci/cli@0.14` é CommonJS legado. Repositório Drift é
`"type": "module"`, então um `lighthouserc.js` seria interpretado
como ESM e quebra (lhci `require()` da config). Solução: usar
extensão `.cjs` explícita (`lighthouserc.cjs`). Não há plano
upstream pra migrar lhci pra ESM.

### Vite config + top-level await

Adicionamos visualizer condicional via `defineConfig(async () => ...)`.
Vite suporta config function async desde 2.x; Node 22 do CI também
suporta top-level await nativamente. Se algum dia voltar a config
sync, mover `useAnalyzer` pra um array de plugins lazy via
`require('rollup-plugin-visualizer')` em CJS-style — mas hoje
async é mais limpo.

### `rollup-plugin-visualizer` é optional

Se a dep não estiver instalada (fresh clone parcial), o helper
`maybeVisualizer()` em `vite.config.ts` cai gracefully com warn.
DRIFT_ANALYZE=1 sem a dep só emite aviso, não quebra build.

## Próximos rounds (CWV-2+)

- Code-split entry: split rotas com `React.lazy` (Feed/Map/Profile).
- helia-deps genuinamente lazy: dynamic import só quando user chama
  `pinPost()` / `fetchBlob()`.
- Preconnect a relays via `<link rel="preconnect">` pra primeiro WSS
  handshake.
- Font subset: `font-display: swap` já presente; investigar woff2
  subsetting para pt-BR.
- Service Worker pre-cache aggressive para repeat visits (LCP < 1s).
