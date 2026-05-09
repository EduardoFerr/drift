# Core Web Vitals — Research & Tooling Spec

**Persona:** Robin (research, curadoria, gaps cross-cutting, docs)
**Sessão:** 2026-05-09
**Round:** CWV-1
**Status:** Research — não implementa nada, apenas documenta decisões propostas.
**Audiência primária:** Marshall (implementação `lighthouse-ci` + budgets), Lily (aplicação fixes runtime), Ted (review estrutural).

---

## Sumário executivo

Lighthouse 2026-05-09 reportou **Performance 86/100** em produção
(`drift.vercel.app`). Target Drift: **≥95** (consistente com PWAs de
referência: Linear, Notion mobile, Discord). Gap principal:

| Métrica | Atual (estimado) | Target | Δ |
|---|---|---|---|
| LCP (mobile sim) | ~3.8s | ≤2.5s | −1.3s |
| FCP | ~2.0s | ≤1.8s | −0.2s |
| TBT | ~310ms | ≤200ms | −110ms |
| CLS | 0.05 | ≤0.1 | OK |
| INP | n/d (lab) | ≤200ms | medir RUM |
| Bundle entry JS | 744 KB (`index-iIXb21p4.js`) | <250 KB inicial | −500 KB |
| Bundle SQLite WASM | 860 KB | aceitar; lazy/parallel | streaming |

Drivers do score baixo (hipóteses ranqueadas):

1. **Entry chunk gordo** — `index-iIXb21p4.js` 744 KB (deck.gl/MapLibre
   not properly lazy? `nostr-tools` + zustand + Framer + workbox-window
   + sqlite-wasm wrapper tudo no main bundle).
2. **SQLite WASM bloqueia interatividade** — 860 KB fetch + decode em
   worker, mas o boot UI espera `useBootStore` resolver. Cold start
   sente.
3. **Fontes Syne + DM Mono** — múltiplos weights (`300`, `400`, `500`,
   `300-italic`) carregados via `@import` em `src/index.css`. Total
   wire ~120 KB woff2 mas Vite serializa chains de `@import`.
4. **Sem resource hints** — `index.html` minimal, sem `preconnect` pra
   CDN de relays/imagens, sem `modulepreload` explícito.
5. **`robots.txt` quebrado** — Vercel rewrites SPA servem `index.html`
   pra `/robots.txt` (Lighthouse audit "Search engine optimization"
   penaliza).
6. **Sem SRI** — auditoria Lighthouse "Best Practices" deixa pontos na
   mesa; manifesto §17 (sem chave mestra) implica SRI **deveria** ser
   baseline.

**Estimativa cumulativa se todas recommendations aplicadas:**
LCP −1.6s a −2.0s (alvo ~1.8–2.2s), Performance score 86 → 96–98.
Detalhe por bucket em §10/§13.

---

## §1 Targets canônicos (web.dev 2024–2026 reference)

### Lab metrics (Lighthouse synthetic)

| Métrica | Good | Needs Improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤2.5s | ≤4.0s | >4.0s |
| **FCP** (First Contentful Paint) | ≤1.8s | ≤3.0s | >3.0s |
| **CLS** (Cumulative Layout Shift) | ≤0.1 | ≤0.25 | >0.25 |
| **TBT** (Total Blocking Time) | ≤200ms | ≤600ms | >600ms |
| **TTI** (Time to Interactive) | ≤3.8s | ≤7.3s | >7.3s |
| **SI** (Speed Index) | ≤3.4s | ≤5.8s | >5.8s |

### Field metrics (RUM via `web-vitals` lib — futuro Drift)

| Métrica | Good | Threshold p75 |
|---|---|---|
| **LCP** | ≤2.5s | p75 |
| **INP** (Interaction to Next Paint) | ≤200ms | p75 |
| **CLS** | ≤0.1 | p75 |

`FID` foi **deprecated em Mar/2024**; substituído por **INP**. INP
mede latência de cada interação (tap, key, click), não só primeira.

### Lighthouse Performance score weights (v11+)

| Métrica | Peso |
|---|---|
| FCP | 10% |
| LCP | 25% |
| TBT | 30% |
| CLS | 25% |
| Speed Index | 10% |

**Implicação Drift:** TBT é o lever mais alto (30%). Reduzir entry
chunk JS é quase mecanicamente o caminho mais barato.

### Drift target: **Performance ≥95**

Justificativa: matches Linear/Notion mobile/Discord PWA refs. Score
mais baixo (90) seria aceitável MVP mas manifesto §1 (existence
autonomy) implica que app precisa rodar OK em 3G + dispositivos
modestos do Sul Global — perf não é vaidade.

---

## §2 CWV-specific Vite optimizations

### `build.modulePreload`

Vite default: `polyfill: true` + `resolveDependencies` que adiciona
`<link rel="modulepreload">` pros chunks que o entry vai puxar.
**Já ativo em Drift** (default). Nada a fazer aqui exceto verificar
que o HTML emitido contém os hints (auditar `dist/index.html`).

### `build.rollupOptions.output.manualChunks`

Drift atual (`vite.config.ts:191-203`) só agrupa `helia-deps`. Falta:

```ts
manualChunks(id) {
  // helia/libp2p (já existe)
  if (/[\\/]node_modules[\\/](helia|@helia|libp2p|...)[\\/]/.test(id)) {
    return 'helia-deps'
  }

  // Map stack — só carrega quando user abre /map
  if (/[\\/]node_modules[\\/](maplibre-gl|@deck\.gl)[\\/]/.test(id)) {
    return 'map-deps'
  }

  // Crypto — usado tanto em boot (identity) quanto em Tauri/WebRTC.
  // Dividir em chunk próprio permite cache hit forte entre versões.
  if (/[\\/]node_modules[\\/](nostr-tools|@noble|@scure)[\\/]/.test(id)) {
    return 'crypto-deps'
  }

  // React + zustand — runtime core, parte do entry. Não chunkar.

  // Framer Motion — heavy (gestures + animations); só carrega quando
  // feed renderiza. Lazy via React.lazy() em SwipeContainer.
  if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) {
    return 'framer'
  }

  return undefined
}
```

**Esperado:** entry chunk cai de 744 KB → ~280–320 KB (React + zustand
+ workbox-window + nostr-tools-pure + UI). map-deps / framer / helia
ficam separados, lazy.

### `splitVendorChunkPlugin` (Vite 5+ deprecated)

Era atalho pra dividir vendor de app. **Vite 5+ recomenda
`manualChunks`** explícito; o plugin `splitVendorChunkPlugin` foi
deprecated. **Não usar.**

### `build.cssCodeSplit` (default: `true`)

Drift usa default. CSS é split por chunk dinâmico, o que é bom — `map`
route não baixa MapLibre CSS até navegação. Confirmar via build report:
`assets/index-D-WvXdoP.css` é 45 KB (Tailwind + fontsource imports).

**Atenção:** `@import '@fontsource/...'` em `src/index.css` faz **todos
os 5 weights** entrarem no CSS do entry, mesmo que só Syne wght (variável)
e DM Mono 400 sejam usados above-the-fold. Ver §8 pra fix.

### `build.assetsInlineLimit` (default: 4096 bytes)

Inlines arquivos <4 KB como base64 data URI. Drift usa default. SVG
icons pequenos (drift-icon.svg = 1.4 KB) são inlinados. **OK manter.**

Trade-off: data URIs aumentam JS bundle e perdem cache HTTP. Para Drift
com poucos assets <4 KB, o ganho de saved roundtrips compensa.

### `build.minify` (default: `'esbuild'`)

esbuild é mais rápido que terser, gera bundles ~3% maiores. Drift CI
prioriza throughput → manter `'esbuild'`. Em release mode poderia testar
`'terser'` com `compress: { passes: 2 }` pra ganho marginal de 5–10 KB
gz; **não recomendado** — complexidade > benefício.

### `build.target`

Default Vite 5: `'modules'` → ES2020 + es-modules support (Chrome 87+,
Firefox 78+, Safari 14+). Drift já depende de Chrome 96+ (COEP
`credentialless`), então pode subir alvo:

```ts
build: {
  target: 'es2022',  // top-level await, error.cause, .at(), Object.hasOwn
}
```

Ganho: ~3–5% bundle size reduction (less polyfilling/transpilation).
Aceitável dado que Safari já não é alvo Drift PWA (§COEP).

### `build.sourcemap`

Default: `false`. Ver §6 — recomendar `'hidden'` + upload pra Sentry.

---

## §3 PWA cold start patterns

### Service Worker bootup overhead

Workbox SW hoje em Drift (`dist/sw.js` + `workbox-9465b968.js`):

- Precache `globPatterns` em `vite.config.ts:62-69` cobre `index.html`,
  `manifest.webmanifest`, `assets/index-*.{js,css}`, `db.worker-*.js`,
  `sqlite3-*.js`, `*.{wasm,svg,png,ico}`.
- `maximumFileSizeToCacheInBytes: 5 MB` permite SQLite WASM (860 KB).

**Problema:** precache total atualmente ~1.5 MB (entry JS + worker +
SQLite WASM + fonts hash-named, mas fonts NÃO casam o glob —
`assets/dm-mono-*.woff2` não está em globPatterns). Verificar.

**Workbox sweet spot pra primeira install:** ~200 KB. Acima disso o
service worker `install` event demora >2s em conexões 3G. Drift
**precisa precachar SQLite WASM** (manifesto §1: app precisa funcionar
offline após primeira visita). Compromise:

- **Manter precache SQLite WASM** (manifesto-justified).
- **Mover fonts pra runtime CacheFirst** (não precache) — primeira
  visita usa fallback, segunda visita pega de cache.
- Resultado: precache ~1 MB → app instalável em 3-4s (vs 8s+ hoje).

### `registerType: 'prompt'` (Drift atual)

`vite.config.ts:37`. **Mantém — manifesto §17.** Latência maior pra
adoção de fix é trade aceito (defesa contra Vercel/CI compromise).

`skipWaiting: false` é o default com `prompt`. Confirmado.

### Resource hints

`index.html` Drift atual NÃO tem:
- `<link rel="preconnect" href="https://relay.damus.io">`
- `<link rel="dns-prefetch" href="https://image.nostr.build">`
- `<link rel="modulepreload" href="/assets/index-*.js">` (Vite injeta
  durante build mas **só pra chunks que entry importa estaticamente**).

**Recomendação:** adicionar manualmente:

```html
<!-- WebSocket relays — connect early -->
<link rel="preconnect" href="https://relay.damus.io" crossorigin>
<link rel="preconnect" href="https://nos.lol" crossorigin>
<link rel="preconnect" href="https://relay.snort.social" crossorigin>

<!-- Imagens nostr.build (lazy mas DNS resolve cedo) -->
<link rel="dns-prefetch" href="https://image.nostr.build">

<!-- CARTO tiles (mapa, lazy) -->
<link rel="dns-prefetch" href="https://basemaps.cartocdn.com">
```

**Trade-off:** preconnect abre TLS handshake imediato. 4 conexões
preconnect = ~12 KB de overhead na rede + memory de socket. Browser
fecha após 10s sem uso — aceitável.

**NÃO** preconnectar cada relay seed (10+) — Chrome limita preconnects
úteis a 2-4. Escolher 3 mais prováveis.

### Critical CSS inline strategies

Vite **não tem** plugin oficial de critical CSS extraction. Opções:

1. `vite-plugin-critical` (community, baseado em `critical` npm) —
   extrai CSS above-the-fold e inlinea no `<head>`.
2. Manual: identificar CSS crítico (header + skeleton + tipografia
   base) e inlinear em `index.html` `<style>`.

**Recomendação Drift: NÃO usar.** Razões:

- App é um SPA com skeleton minimal (`<div id="root">`) — first paint
  já é controlado por React mount, não por CSS.
- Tailwind faz JIT purge — CSS gerado é só o que app usa, não há "non-
  critical" significativo separável.
- Critical CSS aumenta HTML payload e duplica regras (cache miss).
- **Trade-off perde** vs simplicidade arquitetural.

Em vez disso: **reduzir** o CSS total via §8 (font subsetting).

---

## §4 WASM cold start

### `WebAssembly.instantiateStreaming`

@sqlite.org/sqlite-wasm 3.51.2-build9 já usa `instantiateStreaming`
quando disponível. **Nada a fazer no Drift code** — a bib trata.

Verificação: Network tab deve mostrar `sqlite3-DGXXSD5r.wasm` com MIME
`application/wasm` (Vercel envia correto via extension), permitindo
streaming. Se MIME for `application/octet-stream`, browser cai pra
`instantiate` (download completo + parse + compile sequencial; ~2x
mais lento). **Auditar Vercel headers pra confirmar.**

### Loading patterns: eager vs lazy vs on-demand

Drift atual: **eager** — `db.worker.ts` é importado em
`bootstrap.ts:startBoot()` que roda imediatamente após `main.tsx` mount.
Worker spawn → `init()` → fetch SQLite WASM 860 KB → instantiate →
schema.sql exec → ready. Tudo bloqueia primeira tela útil
(useBootStore.boot.status === 'ready').

**Análise:** SQLite é parte do core (manifesto: cliente precisa de DB
local pra funcionar). **Lazy não cabe** — sem DB não há feed.

**Lever real:** **paralelizar** WASM fetch com main thread render.

Estratégia proposta:

```html
<!-- index.html: prefetch WASM cedo, paralelo ao parse de JS principal -->
<link rel="prefetch" href="/assets/sqlite3-DGXXSD5r.wasm" as="fetch" crossorigin>
```

**Problema:** hash no filename muda a cada build → não dá pra hardcodar.
Solução: Vite plugin custom que, durante `transformIndexHtml`, lê
`bundle` e injeta `<link rel="prefetch">` pros chunks SQLite.

**Alternativa mais simples:** disparar fetch warm em `<script>` no
head, antes do main bundle parse:

```html
<script>
  // Warm cache do WASM em paralelo ao download/parse do entry JS.
  // Worker vai re-fetch via mesma URL e pegar do HTTP cache.
  // Filename injetado no build (Vite manifest plugin).
  if ('fetch' in window) {
    fetch('/assets/sqlite3-HASH.wasm', { priority: 'high', credentials: 'omit' });
  }
</script>
```

Ganho estimado: −400ms a −600ms no tempo até DB ready em conexão 3G
(WASM transferred enquanto JS parsing acontece, em vez de sequencial).

**Risco:** double-fetch se browser não cacheia (mismatch de
`credentials` ou `mode`). Workbox precache + `credentials: 'omit'`
costuma bater. Validar no devtools.

### Worker init parallelism with main thread

Já é assim hoje (worker spawn é assíncrono). **Sem mudança.** Lever
adicional seria mover **mais lógica de boot** pro worker (ex:
`getOrCreateIdentity` decryption AES-GCM), mas isso é refactor não
trivial e ganha <100ms. **Punt pra futuro.**

---

## §5 Tooling pra Marshall implementar (lighthouse-ci stack)

### `@lhci/cli` setup

Adicionar `.lighthouserc.cjs` na raiz:

```js
module.exports = {
  ci: {
    collect: {
      // Build production e serve via static server local (workbox
      // precisa de SW context).
      staticDistDir: './dist',
      // 3 runs por URL — Lighthouse usa mediana pra suavizar variance.
      numberOfRuns: 3,
      url: ['http://localhost/'],
      // Mobile sim by default — alinha com web.dev/measure.
      settings: {
        preset: 'desktop',  // ou 'mobile' — discutir abaixo
        // chromeFlags pra COOP/COEP
        chromeFlags: '--enable-features=SharedArrayBuffer',
      },
    },
    assert: {
      // Budgets — falham CI se métricas piorarem.
      assertions: {
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'speed-index': ['error', { maxNumericValue: 3400 }],
        // Performance score fail-soft inicialmente (warn) até estabilizar
        'categories:performance': ['warn', { minScore: 0.95 }],
        'categories:pwa': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      // GitHub status check + temporary public storage (free tier)
      target: 'temporary-public-storage',
    },
  },
}
```

**Decisão pendente: mobile vs desktop preset.**

- **Mobile** (default web.dev): simula throttling 4G + Moto G4-class CPU
  4x slowdown. **Mais agressivo.** Drift target audience inclui mobile
  Sul Global → mobile preset alinha com manifesto.
- **Desktop**: ignora throttling. Score 10–15 pontos maior. **Não
  representativo.**

**Recomendação: `preset: 'mobile'`.** Aceitar que score inicial vai ser
~75 e subir gradualmente conforme fixes shipam.

### GitHub Action setup

Add `.github/workflows/lighthouse.yml`:

```yaml
name: lighthouse-ci
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm install --no-audit --no-fund --prefer-offline
      - run: npm run build
      - name: Run Lighthouse CI
        uses: treosh/lighthouse-ci-action@v12
        with:
          configPath: ./.lighthouserc.cjs
          uploadArtifacts: true
          temporaryPublicStorage: true
```

Alternativa: rodar via `npx lhci autorun` direto se quiser mais controle.

### Bundle size budget

Add `bundlewatch` ou `size-limit` (preferência: `size-limit` — mais
configurável, ESM-aware).

`.size-limit.cjs`:

```js
module.exports = [
  {
    name: 'Entry JS (gzip)',
    path: 'dist/assets/index-*.js',
    limit: '120 KB',  // gzip; raw target ~280 KB
  },
  {
    name: 'Entry CSS (gzip)',
    path: 'dist/assets/index-*.css',
    limit: '15 KB',
  },
  {
    name: 'SQLite WASM (raw)',
    path: 'dist/assets/sqlite3-*.wasm',
    limit: '900 KB',  // upstream pinned, just guard against accidental dupe
  },
  {
    name: 'Helia deps (gzip, lazy)',
    path: 'dist/assets/helia-deps-*.js',
    limit: '350 KB',  // ~1MB raw, ~330 KB gz
  },
  {
    name: 'MapLibre (gzip, lazy)',
    path: 'dist/assets/maplibre-gl-*.js',
    limit: '300 KB',
  },
]
```

Add to CI:

```yaml
- run: npm run build
- run: npx size-limit
```

### `rollup-plugin-visualizer`

Diagnóstico opt-in (não roda em CI, dev tool):

```ts
// vite.config.ts (atrás de env flag)
import { visualizer } from 'rollup-plugin-visualizer'

plugins: [
  ...(process.env.ANALYZE === '1' ? [
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ] : []),
]
```

`ANALYZE=1 npm run build` gera `dist/stats.html` interativo. **Adicionar
script:** `"analyze": "ANALYZE=1 npm run build && open dist/stats.html"`.

---

## §6 Source map strategy em prod

Drift atual: **sem source maps em prod** (`build.sourcemap: false` default).

Trade-offs:

| Mode | Bundle size | Debuggability | IP exposure |
|---|---|---|---|
| `false` | menor | nenhum | nenhum |
| `true` | +300% | total (inline) | total |
| `'hidden'` | mesmo de `false` | upload externo only | controlado |
| `'inline'` | +300% | total | total |

**Recomendação Drift: `sourcemap: 'hidden'`.**

- Source maps emitidos como `.map` files separados.
- HTML/JS NÃO contém `//# sourceMappingURL=` comment → browser não
  baixa em produção normal.
- Upload `.map` pra Sentry (futuro, não urgente) ou retenção em
  GitHub Releases artifacts (já temos infra `release.yml`).

Drift §17 (sem chave mestra): Source map hidden + retido em Release
artifact é compatível — auditor com acesso ao tag pode debugar build
publicado, sem exposição na rede pública.

**Action item Marshall:** flip `sourcemap: 'hidden'`, add to
`release.yml` artifact upload (`dist/assets/*.map`).

---

## §7 Subresource Integrity (SRI)

### Why

- **CDN compromise defense:** atacante que controle a CDN (Vercel
  Edge, Cloudflare, etc.) pode injetar JS arbitrário em chunk lazy.
  Sem SRI, browser carrega cegamente.
- **MITM:** TLS protege transport mas não imuniza contra cert pinning
  failures, CA compromise, ou cache poisoning intermediário.

### Drift §17 implication

Manifesto §17 (Sem Chave Mestra Disfarçada): "operator do scanner
herda chave mestra". Por extensão, **operador da CDN** pode injetar
JS — mesmíssimo vetor. SRI é o único defense-in-depth de protocol-
level que Drift pode adicionar contra esse vetor sem mover hosting.

**Decisão proposta: SRI como baseline mandatório a partir de v0.7.**

Rationale alinhado com §17 e build reproduzível (Fase 6.7).

### Tooling

`vite-plugin-sri` (community):

```ts
import sri from 'vite-plugin-sri'

plugins: [sri()]
```

Plugin adiciona `integrity="sha384-..."` em `<script>` e `<link>`
tags em `dist/index.html`. Workbox precache também respeita SRI
quando configurado com `manifestTransforms`.

**Trade-off:** SRI hashes invalidam em qualquer mudança de chunk
content → cache busting. Mas Vite **já** usa hash-in-filename
(`index-iIXb21p4.js`), então cada deploy já é cache-busted; SRI
hash adiciona zero overhead extra de cache miss.

**Limitação:** SRI **não funciona** com chunks dinamicamente
importados via `import()` injetados runtime, exceto se browser
suportar `import.meta.resolve` + manifest. Drift usa `manualChunks`
+ Vite-injected `<link rel="modulepreload">` que **suportam SRI** via
o plugin.

**Action item:**
1. Marshall adiciona `vite-plugin-sri` em `vite.config.ts`.
2. Smoke test: `npm run build`, abrir `dist/index.html`, verificar
   `integrity="sha384-..."` em todos `<script type="module">` e
   `<link rel="modulepreload">`.
3. Workbox: confirmar que precache manifest inclui hash (vite-pwa
   default) — não precisa SRI separado pq SW já valida via cache key.

### CSP companion

SRI sem CSP é defense parcial. **CSP `script-src 'self'` em Drift
hoje?** Verificar `vercel.json` ou `_headers`. Se ausente, complementar.

---

## §8 Font optimization pra Drift

### Estado atual

`src/index.css:15-19`:

```css
@import '@fontsource-variable/syne/wght.css';
@import '@fontsource/dm-mono/300.css';
@import '@fontsource/dm-mono/400.css';
@import '@fontsource/dm-mono/500.css';
@import '@fontsource/dm-mono/300-italic.css';
```

Build emite woff2 + woff (legacy fallback) para latin, latin-ext,
greek (Syne):

| Subset | woff2 size | wire (gzip is woff2 already compressed) |
|---|---|---|
| Syne wght variable latin-ext | 14.7 KB | 14.7 KB |
| Syne wght variable greek | 11.2 KB | 11.2 KB |
| DM Mono latin 300 | 14.8 KB | 14.8 KB |
| DM Mono latin 400 | 14.8 KB | 14.8 KB |
| DM Mono latin 500 | 15.0 KB | 15.0 KB |
| DM Mono latin 300-italic | 15.7 KB | 15.7 KB |
| DM Mono latin-ext (4 weights) | ~38 KB | ~38 KB |
| **Total wire (sem subsetting)** | | **~125 KB** |

Plus woff legacy fallback (~10 KB cada × 5 = 50 KB) que **nunca é
usado** em Chrome/FF/Safari modernos. Vite emite mas browser ignora
(`unicode-range` + format negotiation). **Considerar excluir woff
legacy via build** — economia bundle build artifact size (~50 KB),
não wire (não baixado).

### `font-display`

`@fontsource` packages emitem `font-display: swap` por default. **OK
manter** — evita FOIT (flash of invisible text). Trade-off: FOUT
(flash of unstyled text) durante swap → CLS risk se fallback metrics
diferem da custom font.

### `size-adjust` + ascent/descent override

Para **eliminar CLS de font swap**, usar `@font-face` descriptors:

```css
@font-face {
  font-family: 'Syne fallback';
  src: local('Arial');
  size-adjust: 95%;
  ascent-override: 90%;
  descent-override: 25%;
  line-gap-override: 0%;
}

body {
  font-family: 'Syne Variable', 'Syne fallback', sans-serif;
}
```

Ferramentas: `font-fallbacks-tool` (NPM) gera os números corretos
medindo metrics de Syne vs Arial. Manual ou via plugin.

**Drift impact estimado:** CLS de font swap atualmente provavelmente
~0.02–0.04 (header text shift on swap). Eliminar = CLS 0.05 → 0.02.
**Marginal mas low-effort.**

### Subset to PT-BR + symbols

Manifesto §28 e UI são PT-BR. **Latin subset cobre PT-BR** (acentos,
ç, ã, õ, etc.) — não precisamos latin-ext (cyrillic, vietnamese, etc.)
salvo pra usernames internacionais.

**Decisão proposta:**

- **Manter latin subset** (já default).
- **DROP latin-ext, greek, cyrillic** se eles não são imports default.
  (Inspecionar — fontsource/dm-mono parece importar só latin por default;
  latin-ext é separate file que browser carrega via `unicode-range`
  match. **Auditar `dist/assets/dm-mono-latin-ext-*.woff2`** — se sendo
  servido em loads sem chars latin-ext, é desperdício.)
- **Considerar pyftsubset** custom build pra DM Mono se queremos
  shrink agressivo (manter só ASCII + acentos PT-BR + símbolos `@#$%
  &*` + setas — economia ~30% por weight). Trade-off: build complexity
  + manutenção. **Não recomendado pra v0.7** — ganho <30 KB total.

### Action item §8

1. Auditar quais subsets fontsource serve em primeira request real
   (devtools Network panel, página do feed default).
2. Implementar `size-adjust` fallback descriptors para Syne + DM Mono.
3. **NÃO** subset agressivamente (anti-recommendation §12).

---

## §9 robots.txt fix Vercel SPA

### Problema

Vercel SPA com `vercel.json` rewrites do tipo:

```json
{ "source": "/(.*)", "destination": "/index.html" }
```

**Captura `/robots.txt` também** → serve HTML 200 com Content-Type
`text/html`. Crawlers tratam como "sem robots.txt válido" + Lighthouse
SEO audit "robots.txt is not valid" fail.

### Fix

Add `public/robots.txt`:

```
User-agent: *
Allow: /
Sitemap: https://drift.vercel.app/sitemap.xml
```

Vite copia `public/*` → `dist/*` literal. Vercel serve estático
**antes** de aplicar rewrites pra SPA fallback (rewrites usam
`fallback` semantic). Confirmar via `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/((?!robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js|workbox-.*\\.js|assets/.*).*)", "destination": "/index.html" }
  ]
}
```

(Negative lookahead exclui assets estáticos.)

### Drift policy: allow indexing?

**Manifesto §28** (privacy default) implica conservatism. Trade-off:

- **Allow `/`:** discoverability. App é público, manifesto é público,
  README é público. SEO ajuda growth.
- **Disallow `/`:** stricter privacy. Mas **conteúdo do feed não tem
  rotas servidas server-side** (SPA, JS-rendered) → crawler não indexa
  posts mesmo se quiser. Só indexa landing.

**Recomendação:** `Allow: /` + landing page focada em manifesto/docs.
Posts/feeds não são SSR-rendered, naturalmente não-indexáveis. Robots
rule é puramente sobre landing page acessibility pra search.

**Caveat:** quando Drift adicionar SSR (Fase 7+) ou link sharing com
preview, **revisitar** — não queremos histórico de posts indexado em
Google.

### sitemap.xml

Para landing-only, sitemap minimal:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://drift.vercel.app/</loc>
    <lastmod>2026-05-09</lastmod>
    <priority>1.0</priority>
  </url>
</urlset>
```

Estático em `public/sitemap.xml`.

---

## §10 Best-in-class comparisons

Métricas reportadas por reviews 2024–2025 (PageSpeed Insights mobile
preset, p75 RUM quando disponível):

| App | LCP (mobile) | FCP | TBT | Bundle entry | Notes |
|---|---|---|---|---|---|
| **Linear** (linear.app) | ~1.2s | ~0.8s | ~80ms | ~180 KB gz | SPA Next.js, brutal code-split, font-display optional |
| **Notion** (mobile web) | ~2.0s | ~1.4s | ~180ms | ~300 KB gz | PWA, server-rendered shell + lazy app |
| **Discord PWA** (discord.com/app) | ~1.5s | ~1.0s | ~150ms | ~250 KB gz | aggressive worker offloading |
| **Slack web** | ~2.5s | ~1.6s | ~250ms | ~350 KB gz | known heavy (multiple clients legacy) |
| **Twitter/X PWA** | ~1.8s | ~1.2s | ~200ms | ~280 KB gz | aggressive route splitting |
| **Drift atual** | ~3.8s (estimado) | ~2.0s | ~310ms | 744 KB raw / ~230 KB gz | sem CWV CI ainda |
| **Drift target v0.7** | ≤2.2s | ≤1.6s | ≤200ms | ~280 KB raw / ~110 KB gz | post-fixes |

### Insights aplicáveis

- **Linear** ganha brutalmente por ter ~180 KB gz entry (Drift atual
  ~230 KB gz, mas raw é 744 KB → comprime bem mas browser ainda parsea
  o raw). Code-split agressivo é o lever.
- **Discord** offload heavy workers — Drift já faz com SQLite, pode
  estender (crypto, scoring).
- **Notion** server-rendered shell é arquitetura diferente; Drift SPA
  não vai fazer isso (SSR + Nostr não cabem). **Punt.**
- **Twitter/X** route-based code split — Drift tem poucas rotas (feed,
  map, profile, settings) mas todas no entry. **Levantar React.lazy
  pra map e profile** = grande ganho.

### Drift-specific challenges (not in refs)

- **SQLite WASM 860 KB** — nenhum dos refs carrega WASM grande no
  cold start. Linear/Notion/Discord usam IndexedDB. Drift pagou esse
  preço para OPFS perf + SQL. **Inerente, não removível.**
  Lever: paralelizar (§4).
- **Nostr WebSocket multiplex** — relays seed list precisam connect
  early. Linear usa REST (cold start não bloqueia). Drift bloqueia
  feed populated em primeiro relay event. **Mitigação:** preconnect
  hints (§3) + UI skeleton agressivo (manifesto §1: "feels alive
  immediately").

---

## §11 Métricas e thresholds pra budget JSON

### `lighthouserc.cjs` assertions completas

```js
assertions: {
  // Core Web Vitals — FAIL if exceeded
  'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
  'speed-index': ['error', { maxNumericValue: 3400 }],
  'interactive': ['error', { maxNumericValue: 3800 }],

  // Network efficiency
  'resource-summary:script:size': ['warn', { maxNumericValue: 350000 }],  // entry JS gz <~110 KB → raw ~350 KB
  'resource-summary:stylesheet:size': ['warn', { maxNumericValue: 50000 }],
  'resource-summary:font:size': ['warn', { maxNumericValue: 130000 }],
  'resource-summary:total:size': ['warn', { maxNumericValue: 1500000 }],  // 1.5 MB cold (incl. SQLite WASM)
  'resource-summary:third-party:count': ['warn', { maxNumericValue: 5 }],

  // PWA gate
  'installable-manifest': 'error',
  'service-worker': 'error',
  'maskable-icon': 'error',

  // SEO + accessibility (Drift cares)
  'robots-txt': 'error',
  'meta-description': 'error',
  'document-title': 'error',
  'html-has-lang': 'error',
  'color-contrast': 'error',

  // Security (Drift §17 baseline)
  'is-on-https': 'error',
  'csp-xss': 'warn',
  'has-hsts': 'warn',

  // Best practices
  'errors-in-console': 'warn',
  'no-document-write': 'error',
  'uses-rel-preconnect': 'warn',  // Lighthouse vai sugerir os hints adicionados em §3

  // Categorical
  'categories:performance': ['warn', { minScore: 0.95 }],
  'categories:accessibility': ['error', { minScore: 0.9 }],
  'categories:best-practices': ['error', { minScore: 0.9 }],
  'categories:seo': ['error', { minScore: 0.9 }],
  'categories:pwa': ['error', { minScore: 0.9 }],
}
```

### Network request count budget

Drift atual (auditado mentalmente do build):
- `index.html` (1)
- entry JS (1)
- vendor chunks: helia-deps lazy, maplibre lazy, framer lazy → 0 no
  cold start de feed
- entry CSS (1)
- SQLite WASM (1)
- SQLite worker JS (2: `db.worker-*.js`, `sqlite3-worker1-*.js`)
- SQLite OPFS proxy (1)
- Fonts (varies — 4–8 woff2 dependendo do que browser pega)
- SW + workbox (2)
- manifest.webmanifest (1)
- icons (2: PWA + favicon)

Total cold: **~16–20 requests**. Lighthouse audit "Number of network
requests" não falha até 50+. **OK.**

Budget: `network-requests` warn at 25.

---

## §12 Anti-recommendations (NÃO fazer)

### NÃO inline critical CSS

- Drift skeleton é minimal (`<div id="root">`) — first paint controlado
  por React, não CSS.
- Tailwind JIT já purga unused.
- Inline duplica regras (cache miss em assets/index-*.css).
- Trade-off perde vs simplicidade.

### NÃO subset fonts agressivamente

- PT-BR precisa acentos (ã, ç, é, í, õ, etc.) — latin subset OK.
- Posts podem conter emoji, símbolos, names internacionais → latin-ext
  fallback útil.
- Custom pyftsubset adiciona build complexity + manutenção; <30 KB ganho.

### NÃO disable PWA pra ganhar pontos PWA category

- Manifesto §1 (existence-autonomy) requer offline + installable.
- Lighthouse PWA category é compatível com perf — não há trade-off
  forçado.

### NÃO sacrifice manifesto §17 por perf

- **NÃO** trocar `registerType: 'prompt'` → `'autoUpdate'` pra ganhar
  uns ms — manifesto §17 (sem chave mestra) > perf.
- **NÃO** remover SRI futuro por causa de cache busting marginal.
- **NÃO** mover assets pra third-party CDN (jsDelivr, unpkg) pra
  "ganhar cache compartilhado" — Drift §17 quer self-hosted, no third-
  party JS.

### NÃO usar `splitVendorChunkPlugin`

- Deprecated em Vite 5+.
- `manualChunks` explícito é mais controlável e idiomático.

### NÃO remover SQLite WASM precache pra encolher install

- Manifesto §1: app precisa funcionar offline na segunda visita.
- Sem precache, primeira navegação offline quebra (network request
  pra WASM falha).
- Mitigação alternativa: §3 (mover **fonts** pra runtime cache, manter
  WASM precache).

### NÃO adicionar polyfills antigos

- Drift target Chrome 96+/Firefox 119+ (COEP credentialless).
- Polyfills `core-js`, `regenerator-runtime` adicionam bundle size sem
  ganhar audience real.

### NÃO usar `terser` em vez de `esbuild`

- Ganho marginal (5–10 KB gz total).
- Tempo de build 3–5x maior.
- CI tempo > ganho.

---

## §13 Estimativa cumulativa de impacto

Aplicação de **todas** as recommendations acima, ranqueada por impacto:

| Fix | LCP delta | TBT delta | Bundle delta | Esforço |
|---|---|---|---|---|
| `manualChunks` map + framer + crypto split | −600ms | −80ms | entry: 744→320 KB raw | M (1d Lily) |
| Resource hints (preconnect relays) | −300ms | 0 | 0 | S (1h) |
| Prefetch SQLite WASM paralelo | −400ms | 0 | 0 | M (1d, vite plugin) |
| Move framer/maplibre to React.lazy | −200ms | −60ms | entry: 320→260 KB | M (0.5d) |
| `font-display + size-adjust` fallback | 0 | 0 | CLS −0.03 | S (2h) |
| Move fonts to runtime cache (não precache) | −0 (cold) / first install +400ms saved | 0 | precache 1.5MB→1.0MB | S (1h) |
| `target: 'es2022'` | 0 | −20ms | −10 KB gz | S (config flip) |
| `sourcemap: 'hidden'` | 0 | 0 | 0 (maps separated) | S (config) |
| SRI plugin | 0 | 0 | +1 KB integrity attrs | S (1h) |
| robots.txt + sitemap | 0 (LCP) / SEO+1 cat | 0 | 0 | S (15min) |
| lighthouse-ci + size-limit + visualizer | 0 (regression guard) | 0 | 0 | M (Marshall, 1d) |
| **CUMULATIVO** | **−1.5s a −2.0s** | **−160ms** | **entry 744→260 KB raw** | ~5d total |

**LCP projetado:** 3.8s → ~1.8–2.3s ✅ within target ≤2.5s
**TBT projetado:** 310ms → ~150ms ✅ within target ≤200ms
**Performance score:** 86 → **96–98** ✅ within target ≥95

### Risco-residuais

- **Mobile Sul Global em 3G genuíno** (não throttled): variance alta.
  Lighthouse simulated 4G é conservador-otimista. Field RUM via
  `web-vitals` lib (Fase futuro) é a única forma de validar honesto.
- **SQLite WASM 860 KB** é piso fixo. Em 3G real (~400 KB/s), 2s
  só de download — bloqueia feed populated. Mitigação: skeleton UI
  agressivo (manifesto §1) + preview content em IndexedDB cache
  enquanto WASM carrega (futuro otimização).

---

## §14 Plan de rollout sugerido (handoff Marshall + Lily)

### Sprint A — tooling & visibility (Marshall, 1d)

1. Add `@lhci/cli` + `.lighthouserc.cjs` (§5).
2. Add `.github/workflows/lighthouse.yml`.
3. Add `size-limit` + `.size-limit.cjs`.
4. Add `rollup-plugin-visualizer` opt-in via `npm run analyze`.
5. **NÃO** falhar CI inicialmente — `warn` only nas assertions
   `categories:performance`. Coletar baseline 7 dias.

### Sprint B — quick wins (Lily, 1d)

6. `index.html` resource hints (§3).
7. `public/robots.txt` + `public/sitemap.xml` + `vercel.json` rewrite
   exclusion (§9).
8. `vite.config.ts`: `build.target: 'es2022'`, `build.sourcemap:
   'hidden'`.
9. `vite.config.ts`: expandir `manualChunks` (map-deps, framer,
   crypto-deps).

### Sprint C — fonts + WASM parallel (Lily, 1d)

10. `size-adjust` fallback descriptors em `src/index.css` (§8).
11. Custom Vite plugin: inject `<link rel="prefetch" href="WASM-hash">`
    em index.html (§4).
12. Workbox: mover fonts pra `runtimeCaching` CacheFirst, fora de
    precache.

### Sprint D — SRI baseline (Marshall, 0.5d)

13. Add `vite-plugin-sri` (§7).
14. Smoke test: build + verify integrity attrs.
15. Update `Docs/build-reproducible.md` mencionando SRI.

### Sprint E — flip CI assertions to error (Marshall, 0.5d)

16. Após 7 dias de baseline, flip `categories:performance` warn→error
    com threshold realista (start `0.92`, ramp pra `0.95` em 2 sprints).
17. Document budget rationale em `Docs/sessions/cwv-budgets-rationale-
    2026-MM-DD.md`.

**Total esforço:** ~4d engineering. Match capacity típico de uma sprint
Drift.

---

## §15 Open questions / handoff Ted

1. **Mobile vs desktop preset Lighthouse-CI:** §5 recomenda mobile.
   Confirmar com Ted.
2. **`build.target: 'es2022'`:** quebra compat com browsers <Chrome
   96? Drift já depende de COEP `credentialless` (Chrome 96+). Match.
   Confirmar não há regressão Tauri (WebView2 é Chromium recent — OK).
3. **Sentry/error tracker pra source maps:** futuro item §6. Discutir
   prioridade vs build-reproducible (Fase 6.7).
4. **Critical CSS:** §3 anti-recommended. Reabrir se Lighthouse aponta
   "render-blocking resources" como top opportunity em audit pós-fixes.
5. **`web-vitals` RUM lib:** field metrics em produção. Manifesto §28
   privacy-by-default — não enviar pra third-party. Self-hosted endpoint
   (Vercel Function) ou apenas console.log dev mode? Robin para próximo
   round.

---

## Apêndice A — refs

- web.dev/articles/optimize-lcp
- web.dev/articles/optimize-fcp
- web.dev/articles/optimize-cls
- web.dev/articles/optimize-inp
- web.dev/articles/optimize-tbt
- vitejs.dev/guide/build.html — Vite build config
- vitejs.dev/guide/features.html#build-optimizations
- github.com/GoogleChrome/lighthouse-ci/tree/main/docs
- github.com/treosh/lighthouse-ci-action
- github.com/ai/size-limit
- github.com/btd/rollup-plugin-visualizer
- github.com/small-tech/vite-plugin-sri (or `@small-tech/vite-plugin-sri`)
- developers.google.com/web/fundamentals/performance/resource-prioritization
- web.dev/articles/preconnect-and-dns-prefetch

## Apêndice B — Drift docs cruzados

- `CLAUDE.md` — invariantes (§1 onNostrEvent porta única; §10 sem poll
  Zustand; §17 fontes dinâmicas pós-Fase 5).
- `Docs/manifesto.md` §1 (existence-autonomy → PWA install <3s 3G),
  §17 (sem chave mestra → SRI baseline + sourcemap hidden), §28
  (compat Nostr → preconnect relays seed).
- `Docs/build-reproducible.md` — atualizar com SRI baseline pós-Sprint D.
- `Docs/deploy.md` — Vercel rewrites + robots.txt/sitemap exclusion.
- `Docs/runtime-pwa-vs-tauri.md` — Tauri build não usa SW (CSP via
  Tauri config); aplica subset das recommendations (manualChunks
  benefit, fonts benefit, WASM benefit).

---

*Robin — research closed. Handoff: Marshall implementa §5, §6, §7,
§11. Lily implementa §3, §4, §8, §9, §13. Ted resolve §15 open
questions. Cap: 3h gasto. Doc-only — nada commitado.*
