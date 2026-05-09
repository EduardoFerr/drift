# RFC — Core Web Vitals: Bundle Strategy (Round CWV-1)

**Status:** Draft (Round CWV-1 — planning only, no implementation)
**Owner:** Ted (HIMYM persona — arquitetura, padrões, abstrações, build pipeline)
**Sibling RFCs:** Lily Round CWV-2 (implementation), Barney Round CWV-3 (security review SRI/sourcemaps)
**Sources consumed:**
- Lighthouse run 2026-05-09 (Performance 86/100, LCP 3.8s, FCP 2.3s)
- ScriptTreemap data: `helia-deps-DT6i114t.js` (313 KB / 80% unused), `index-CyfiTlCI.js` (250 KB / 77% unused)
- `vite.config.ts` (current `rollupOptions.output.manualChunks` + Workbox config)
- `src/components/UI/Image.tsx:116` (lazy import de `../../lib/blobs`)
- `src/components/Settings/SettingsCards.tsx:466,479,505` (lazy import de `../../lib/helia`)
- `src/App.tsx:32-76` (eager imports de Settings/Profile/Identity/Onboarding/Compose/Map)
- `src/index.css:15-19` (font imports via `@fontsource/*`)

> **Escopo:** doc-only. Round CWV-2 executa. Tom: ADR pragmático.
> **Mandate:** Lighthouse 86/100; mover pra ≥95 sem comprometer manifesto §17 (sem chave mestra), §10 (cliente leve), §28 (compat Nostr).

---

## TL;DR (60s)

O bundle de produção tem **404 KB de JS unused** no caminho crítico —
Lighthouse aponta isso como a maior oportunidade single-shot do app
(-2.1s LCP estimado). Causa raiz: `helia-deps` (313 KB) é importado
**dinamicamente** em `Image.tsx`, mas Vite ainda emite
`<link rel="modulepreload">` por default pra todos os chunks
descobertos no graph estático — então o browser baixa avidamente
algo que 80% das sessões nunca executa.

Fix S0 é uma única alteração de `vite.config.ts`
(`build.modulePreload.resolveDependencies` filtrando `helia-deps`)
que sozinha deve mover LCP de 3.8s → ~2.7s. Combinado com
route-based code-splitting de Settings/Profile/Identity/Onboarding/
Compose/Report (~3h de trabalho), entry inicial cai de 250 KB →
~150 KB e Performance score deve cruzar 95.

Decisões pendentes do Arquiteto: §3.1 Option B (recommended),
sourcemaps em prod (`'hidden'`), SRI em CWV-2 ou follow-up.

---

## §1 Problem

### 1.1 Lighthouse data (run 2026-05-09)

```
Performance:        86 / 100
LCP:                3.8s   (target <2.5s — score 0.54)
FCP:                2.3s   (target <1.8s — score 0.73)
TBT:                ~210ms (within budget)
CLS:                0.02   (within budget)
```

**Maior oportunidade reportada:**

```
Reduce unused JavaScript ......................... est. -2,160ms
  /assets/helia-deps-DT6i114t.js ........ 313 KB / 80% unused (236 KB)
  /assets/index-CyfiTlCI.js ............. 250 KB / 77% unused (177 KB)
                                          ──────────────────────────
                                                        404 KB unused
```

### 1.2 Drift impact

- **Onboarding fricção:** primeiro paint do feed é o ato de adoção.
  Cada 100ms a mais de LCP = -1% conversão observado em redes sociais
  competidoras (Lily Q1 2026 review). 1.3s a recuperar = budget enorme.
- **Mobile 4G real-world:** 313 KB transferred + parse + execute em
  CPU mid-tier Android é ~900ms de blocking time. Lighthouse roda em
  Moto G Power simulado e captura isso; users reais sentem mais.
- **Manifesto §16 (disponibilidade distribuída):** PWA pesado é
  hostile pra sneakernet / IPFS pin distribution — quanto menor o
  initial chunk, mais viável o offline-first commitment.
- **Cache hit rate:** sem vendor splitting, qualquer rebuild invalida
  o `index-*.js` inteiro mesmo se só uma linha mudou em
  `feed.ts`. Vendor estável (React, nostr-tools) deveria viver em
  chunks com hash diferente.

### 1.3 Não-objetivo

Esta RFC **não** trata:
- Otimização de SQLite WASM (409 KB) — é runtime-critical, eager fetch
  no worker é correto e o tamanho é determinado upstream.
- CARTO map tiles — já lazy via SpreadMap dynamic import e cached
  via Workbox runtimeCaching.
- Comprehensive WebRTC perf (Fase 6) — escopo separado.

---

## §2 Inventory dos chunks atuais

Levantamento estático a partir de `vite.config.ts` + `src/App.tsx` +
ScriptTreemap. Round CWV-2 deve confirmar com `vite build --mode=production`
+ `rollup-plugin-visualizer` real.

### 2.1 `index-*.js` — entry chunk (~250 KB)

Eager imports observados em `src/App.tsx:32-76`:

| Bloco | Estimativa | Loaded eagerly hoje |
|---|---|---|
| React + ReactDOM (vendored) | ~140 KB | sim, necessário pro paint |
| Framer Motion (gestos + variants) | ~50 KB | sim, usado já no PostCard mount |
| nostr-tools (pure + pool + nip19) | ~30 KB | sim, sync.ts boot precisa |
| Zustand stores (boot/sync/feed/relays) | ~8 KB | sim, necessário |
| `Settings/SettingsCards.tsx` (+ 8 sub-cards) | ~25 KB | **sim — desnecessário em first paint** |
| `Profile/ProfileModal.tsx` | ~12 KB | **sim — desnecessário** |
| `Identity/IdentityPanel.tsx` + `IdentitySwitcher.tsx` | ~18 KB | **sim — desnecessário** |
| `Onboarding/OnboardingOverlay.tsx` | ~10 KB | **sim — desnecessário (1ª visita só)** |
| `Create/ComposeOverlay.tsx` | ~15 KB | **sim — desnecessário até user gesture** |
| `Post/ReportModal.tsx` | ~6 KB | **sim — desnecessário até user gesture** |
| `Feed/SpreadMap.tsx` | já lazy? | a confirmar (revisar `src/App.tsx:76`) |
| Drift core libs (events, feed, scoring, weight, etc.) | ~30 KB | sim, necessário |
| Tailwind base CSS classes utilizadas | ~15 KB | (CSS chunk, separado) |

**Soma do eager-mas-evitável:** ~86 KB no caminho crítico que pode ser
diferido sem custo perceptual (overlays/modals com user gesture).

### 2.2 `helia-deps-*.js` — vendor chunk (313 KB)

Manual chunk configurado em `vite.config.ts:191-201` agrupa Helia +
libp2p + multiformats + chainsafe families. Importado **dinamicamente**
de exatamente 4 call sites:

| Arquivo | Linha | Contexto |
|---|---|---|
| `src/components/UI/Image.tsx` | 116 | `await import('../../lib/blobs')` — só dispara quando `meta` está presente (posts NIP-94 com hash) |
| `src/components/Settings/SettingsCards.tsx` | 466, 479, 505 | `await import('../../lib/helia')` — UI de pin/unpin manual |
| `src/lib/events.ts` | 408 | `await import('./blobs')` — pin oportunista de blobs em SPREAD |

**Verdict:** uso é **estritamente opcional** (Track B). User mediano
no feed Global em mobile 4G nunca toca esse chunk na primeira sessão.
Ainda assim, modulepreload o trata como crítico — Vite emite
`<link rel="modulepreload" href="/assets/helia-deps-*.js">` no
`index.html`, browser baixa em paralelo com entry, **chega a competir
por bandwidth com `index-*.js` e SQLite WASM**.

### 2.3 `db.worker-*.js` (~73 KB)

Carregado via `new Worker(url, {type: 'module'})` em `src/lib/db.ts`.
**Não** entra em modulepreload (worker module graph é separado). Eager
fetch é correto (worker boot acontece em paralelo com paint).
**Sem ação.**

### 2.4 `sqlite3.wasm` (~409 KB)

Fetched pelo db worker durante boot. Compressed (~150 KB on wire). Eager
é necessário — feed depende. Pode ser pre-cached pelo SW (já está em
`workbox.globPatterns`).
**Sem ação.**

### 2.5 Fonts

```css
@import '@fontsource-variable/syne/wght.css';   /* ~30 KB woff2 */
@import '@fontsource/dm-mono/300.css';
@import '@fontsource/dm-mono/400.css';
@import '@fontsource/dm-mono/500.css';
@import '@fontsource/dm-mono/300-italic.css';   /* ~15 KB total */
```

Auto-bundled via `@fontsource/*`. Já self-hosted em `/assets/`. CSS
discovery → fetch das woff2 só após `index.css` parse → blocks first
contentful text. Sem `font-display: swap` explícito (default `block`
em alguns @fontsource versions = FOIT até 3s).

---

## §3 Strategies analisadas

### §3.1 Helia preload fix (S0 — biggest single win)

**Problema concreto:** Vite default `build.modulePreload: true` emite
`<link rel="modulepreload">` pra **todos os chunks alcançáveis pelo
graph** — incluindo dynamic imports descobertos estaticamente
(`Image.tsx:116`). Browser baixa `helia-deps` antes mesmo do user
ver um post. Pra 80% das sessões: 313 KB de waste puro.

#### Option A — Disable modulepreload globalmente

```ts
// vite.config.ts
build: {
  modulePreload: false,
  // ...
}
```

**Pros:** trivial, 1 linha.
**Cons:** desliga modulepreload pra **todos** os chunks incluindo os
realmente críticos (entry → react-dom). Paint inicial pode regredir
50-100ms em cold load porque browser descobre dependências
serialmente em vez de em paralelo. **Trade-off pior que o problema
original em sessões fast (5G/wifi).**
**Verdict:** rejeitado.

#### Option B — `resolveDependencies` callback (RECOMENDADO)

```ts
// vite.config.ts
build: {
  modulePreload: {
    resolveDependencies: (filename, deps, { hostId, hostType }) => {
      // Filtra chunks lazy/opcionais do preload graph. helia-deps é
      // Track B (NIP-94 blobs + pin) — só ativa quando user abre
      // post com meta NIP-94 ou Settings → Pin. Round CWV-1, manifesto
      // §10 (cliente leve no caminho crítico).
      return deps.filter(dep => !/helia-deps-[^.]+\.js$/.test(dep))
    },
  },
  // ...
}
```

**Pros:**
- Cirúrgico: outros chunks preservam preload behavior.
- Extensível: regex pode crescer pra incluir `maplibre-gl-*`,
  `tesselator-*` (já lazy mas idem-preload por default), etc.
- Zero change no application code.
**Cons:** API `resolveDependencies` é Vite ≥4.0; checar pinned version
no `package.json`. Lily valida em CWV-2.
**Verdict:** **RECOMENDADO**. Single biggest win, lowest blast radius.

#### Option C — Re-architect import path

Mover `await import('../../lib/blobs')` pra trás de um trigger
explícito mais distante (ex.: só dentro de `IntersectionObserver`
callback quando imagem entra em viewport, ou em `onClick` do
lightbox). Reduz superfície estática que Rollup vê.

**Pros:** elimina o problema na origem.
**Cons:**
- Image.tsx já faz lazy fetch via `useEffect` quando `meta` está
  presente; mover pra trás de IntersectionObserver complica
  hash-verify path (manifesto §29 imutabilidade do meta NIP-94).
- Vite ainda emitiria modulepreload se `import()` for descoberto
  estaticamente em qualquer code path — Option B mata o sintoma
  mais cedo.
- Não escala pros 3 outros call sites em Settings.
**Verdict:** rejeitado como solução primária; pode complementar B se
métrica pós-fix ainda mostrar competition por bandwidth.

#### Decisão recomendada

**Option B.** Snippet exato (CWV-2 cola e ajusta):

```ts
// vite.config.ts — adicionar dentro de `build:` existente
build: {
  modulePreload: {
    resolveDependencies: (_filename, deps) =>
      deps.filter(dep => !/(?:helia-deps|maplibre-gl|tesselator)-[^.]+\.js$/.test(dep)),
  },
  rollupOptions: { /* ...mantém manualChunks existente... */ },
},
```

Inclui `maplibre-gl` e `tesselator` no filter por simetria — ambos são
lazy do mapa, mesmo problema potencial de preload waste.

---

### §3.2 Route-based code splitting (~3h, ~40% redução do entry)

Drift não tem router (single-page com overlays controlados por estado),
então "route" aqui = **modal overlay com user-gesture trigger**. Cada
um vira `React.lazy()` + `<Suspense>` boundary local.

| Component | Trigger | Estimate | Notas |
|---|---|---|---|
| `SettingsCards.tsx` (+ 8 sub-cards) | NavBar → Settings tap | 25 KB | Mais óbvio. Usuário só abre 1x por sessão (típico). |
| `ProfileModal.tsx` | Tap em author of post | 12 KB | Frequente, mas não first-paint. |
| `IdentityPanel.tsx` + `IdentitySwitcher.tsx` | Settings → Identity (raríssimo) | 18 KB | Pode aninhar como child lazy de SettingsCards. |
| `OnboardingOverlay.tsx` | First-visit only (gate em `user_prefs.onboarded`) | 10 KB | Mover pra fora do bundle initial é correto: 99% das navegações já viram. |
| `ComposeOverlay.tsx` | FAB tap ou keyboard 'n' | 15 KB | User gesture explícito. |
| `ReportModal.tsx` | Card menu → Reportar | 6 KB | Raríssimo. |
| `SpreadMap.tsx` (+ maplibre + deck.gl) | Tab "Mapa" | já lazy? | Confirmar em build/visualizer. Se eager: priority 1. |

**Padrão recomendado** (ADR pra CWV-2):

```tsx
// src/App.tsx
import { lazy, Suspense } from 'react'
const SettingsCards = lazy(() =>
  import('./components/Settings/SettingsCards').then(m => ({ default: m.SettingsCards }))
)

// uso
{settingsOpen && (
  <Suspense fallback={<DriftSkeleton variant="modal" />}>
    <SettingsCards onClose={...} />
  </Suspense>
)}
```

`DriftSkeleton variant="modal"` deve existir após Round Motion CWV-2.
Se não, fallback `null` é aceitável (overlay já tem framer-motion
fade-in que mascara o gap de 50-200ms).

**Estimate de redução:** 86 KB removidos do entry → entry de 250 KB cai
pra ~150-165 KB. Combinado com gzip (~3-4×), wire transfer cai
~30 KB → ~3-4× menos parse-evaluate time em CPU mid-tier.

**Risco:** se Suspense fallback pisca em conexão fast (<200ms), UX fica
flicker. Mitigação: prefetch on hover do botão (`<button onMouseEnter={...}>`)
pra warm o chunk antes do click. Prática conhecida de React DnD /
shadcn. Round CWV-2 polish.

---

### §3.3 Vendor splitting (cache stability)

Vendor stable libs em chunks dedicados isola hash. Re-deploy de
`feed.ts` não invalida React + ReactDOM no cache do user.

```ts
// vite.config.ts — extender manualChunks existente
manualChunks(id) {
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
    return 'vendor-react'
  }
  if (/[\\/]node_modules[\\/](nostr-tools|@noble[\\/]secp256k1|@noble[\\/]hashes|@scure)[\\/]/.test(id)) {
    return 'vendor-nostr'
  }
  if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) {
    return 'vendor-motion'
  }
  // ...mantém helia-deps existente...
  if (/[\\/]node_modules[\\/](helia|@helia|libp2p|@libp2p|...)[\\/]/.test(id)) {
    return 'helia-deps'
  }
}
```

**Pros:** cache hit rate em deploys subsequentes vai de ~0% pro entry
pra ~80% (vendor não muda). Repeat-visit LCP melhora dramaticamente.
**Cons:** mais arquivos = mais HTTP requests. HTTP/2 multiplex mitiga.
Vercel CDN faz HTTP/2 por default.
**Verdict:** **APLICAR** em CWV-2. Risco baixo, ganho médio-alto em
repeat sessions (que são 70%+ do tráfego de social app maduro).

**Atenção Barney (security review):** vendor split aumenta superfície
de SRI (subresource integrity) — cada chunk precisa de hash separado.
Ver §6 risco SRI.

---

### §3.4 Font optimization

#### 3.4.1 `font-display: swap`

`@fontsource/*` packages variam em default. Verificar CSS resultante
no build; se default for `block` ou `auto`, override:

```css
/* src/index.css — após @import statements */
@font-face {
  font-family: 'Syne Variable';
  font-display: swap;
}
@font-face {
  font-family: 'DM Mono';
  font-display: swap;
}
```

Trade-off: `swap` causa FOUT (fallback flash). Drift tem typography
muito distintiva (Syne variable display, Lily §3.1 fluid type) — FOUT
pode ser visualmente jarring.

**Alternativa:** `font-display: optional` — browser dá ~100ms pro
font carregar; se não chegou, usa fallback **e não troca depois**.
Sem flash, mas font customizada não aparece em first visit lenta.
Aceitável pra DM Mono (body); discutível pra Syne (display).

**Recomendação ADR:**
- DM Mono: `swap` (body texto, FOUT é tolerável, leitura prioritária).
- Syne: `optional` em first-paint slots (top-level navigation, post
  titles); `swap` em modals (user já comprometeu).
- Round CWV-2 valida visually com user (Arquiteto).

#### 3.4.2 Subset PT-BR

`@fontsource/dm-mono` distribui latin + latin-ext (suporta PT, ES, FR,
DE, etc.). Drift é PT-BR-only no UI (CLAUDE.md vocabulary mapping).
Subset pra characters PT-BR + ASCII pode reduzir woff2 ~30%
(15 KB → ~10 KB DM Mono; 30 KB → ~21 KB Syne).

**Tooling:** `@fontsource/utils subset` ou `glyphhanger --subset`. Hash
manual woff2, copia pra `public/fonts/`, ejeta `@fontsource` import.

**Verdict:** **DEFER**. ROI de ~15 KB total é marginal vs. complexidade
de manutenção custom font pipeline. Reavaliar se user growth criar
bandwidth pressure ou se Lighthouse depois do S0+S1+S2 ainda apontar
font como blocker.

#### 3.4.3 `size-adjust` descriptors

Pra eliminar CLS de FOUT, definir fallback metrics-aligned:

```css
@font-face {
  font-family: 'Syne fallback';
  src: local('Inter'), local('Helvetica Neue'), local(Helvetica), local(Arial);
  size-adjust: 102%;
  ascent-override: 88%;
  descent-override: 22%;
  line-gap-override: 0%;
}
```

Tool: <https://meowni.ca/font-style-matcher/>. Round CWV-2 validate.

---

### §3.5 Source maps em prod

Lighthouse atualmente penaliza levemente "Missing source maps for
large first-party JavaScript". Tradeoff de segurança vs. debug:

| Mode | Bundle exposed? | Sourcemap exposed? | Prod debug |
|---|---|---|---|
| `false` (default Vite) | bundle minified, code recoverable c/ effort | não | ruim |
| `'inline'` | sim | sim, embutido (+30% bundle size) | ótimo |
| `true` | sim | sim, `.map` arquivo + `//# sourceMappingURL=` | ótimo |
| `'hidden'` | sim | sim, `.map` arquivo, **sem URL hint** | bom (manualmente uploaded pra Sentry-equivalent) |

**Manifesto §17 (sem chave mestra) tangent:** sourcemaps em prod **não
expõem segredos** se o código não os contém (e Drift nunca embute
nsec/master key em bundle — manifesto §8). Mas sourcemap revela
function names / structure facilitando reverse-engineering pra
attacker mapeando exploits.

**Recomendação ADR:** `build.sourcemap: 'hidden'`.

```ts
build: {
  sourcemap: 'hidden',
  // ...
}
```

Arquivos `.map` são gerados ao lado dos `.js` mas o bundle não
referencia. Lighthouse stops complaining (ele aceita hidden).
Quando precisar debug em prod, copia `.map` localmente, reconstrói
stack trace via `source-map` lib, sem servir publicamente.

**Trade-off aceito:** `.map` ainda existe no `dist/` upload pra Vercel
— se não quiser nem isso, post-build remove via `rm dist/**/*.map`
antes do `vercel deploy`. Round CWV-2 decide; recomendação: keep
hidden, document, post-mortem-friendly.

**Decisão pendente do Arquiteto:** ver §7.

---

## §4 Implementation roadmap pra Lily Round CWV-2

Estimates assumem familiaridade com Vite + React Suspense; Lily já tem
ambas. Total: ~5h.

### Step 1 — Helia preload fix (~15 min, **biggest impact**)

- [ ] Edit `vite.config.ts` adicionando `build.modulePreload.resolveDependencies`
      conforme §3.1 Option B snippet.
- [ ] `npm run build` + grep `index.html` por `<link rel="modulepreload"`;
      confirmar `helia-deps-*.js` ausente.
- [ ] Lighthouse re-run; LCP delta esperado: **-1.0 a -1.3s**.
- [ ] Commit: `perf(build): exclude helia-deps from modulepreload (Lighthouse -1.1s LCP)`

### Step 2 — Lazy wrap modals/overlays (~3h)

- [ ] Validar `SpreadMap.tsx` já é lazy (grep eager import em App.tsx);
      se eager, lazy primeiro (priority alta).
- [ ] Wrap em `React.lazy()` + `<Suspense fallback={...}>`:
      Settings, Profile, Identity (Panel + Switcher), Onboarding,
      Compose, Report. Padrão em §3.2.
- [ ] Adicionar `<DriftSkeleton variant="modal" />` fallback (depende
      de Motion CWV-2 RFC; se inexistente, `null` ok).
- [ ] Prefetch on hover/focus dos triggers principais (NavBar,
      FAB) usando `import()` em event handler — mantém UX snappy.
- [ ] `npm run build` + visualizer; confirmar entry chunk em
      ~150-165 KB.
- [ ] Lighthouse re-run; FCP delta esperado: **-300 a -500ms**.

### Step 3 — Vendor manual chunks (~30 min)

- [ ] Extender `manualChunks` em `vite.config.ts` conforme §3.3.
- [ ] Confirmar build emite `vendor-react-*.js`, `vendor-nostr-*.js`,
      `vendor-motion-*.js` separados.
- [ ] Adicionar regex novos no `workbox.globPatterns` ou
      `runtimeCaching` se aplicável.
- [ ] **Verify:** modify `feed.ts`, rebuild — vendor chunks devem
      manter mesmo hash (cache hit em prod simulado).

### Step 4 — Font display + size-adjust (~30 min)

- [ ] Adicionar `font-display` em `src/index.css` (DM Mono swap, Syne
      optional → revisar visualmente após).
- [ ] Adicionar fallback `@font-face` com `size-adjust` /
      `ascent-override` / `descent-override` (Syne ↔ Inter, DM Mono ↔
      Menlo).
- [ ] CLS check: Lighthouse CLS deve ficar ≤ 0.02 (sem regressão).
- [ ] Visual QA com user (Arquiteto): Syne `optional` em first-paint
      aceitável?

### Step 5 — Source maps `'hidden'` (~10 min)

- [ ] `build.sourcemap: 'hidden'` em `vite.config.ts`.
- [ ] Verify Lighthouse warning some.
- [ ] Document em README/Docs como restaurar `.map` pra debug.

### Step 6 — `robots.txt` fix (~5 min)

- [ ] Criar `public/robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://drift.gallery/sitemap.xml
  ```
- [ ] Verify Vercel serve como text/plain (não SPA fallback HTML).
      Lighthouse SEO score sobe.
- [ ] Sitemap.xml: TBD em separate task (não bloqueia CWV).

### Total estimado: ~5h

Ordem sugerida: 1 → 5 → 6 → 4 → 2 → 3. Step 1 isolado primeiro pra
quantificar ganho real antes de batch maior. Steps 5/6 são triviais e
limpam ruído Lighthouse.

---

## §5 Métricas expectativa pós-implementation

Baseline: Lighthouse 2026-05-09 desktop simulated.

| Métrica | Atual | Pós Step 1 | Pós Steps 1-3 | Target |
|---|---|---|---|---|
| **LCP** | 3.8s | ~2.7s | **<2.5s** | <2.5s ✅ |
| **FCP** | 2.3s | ~2.0s | **<1.8s** | <1.8s ✅ |
| **TBT** | ~210ms | ~180ms | **~140ms** | <200ms ✅ |
| **CLS** | 0.02 | 0.02 | 0.02 | <0.1 ✅ |
| **Initial JS transfer** | 640 KB | 327 KB | **~150-200 KB** | — |
| **Performance score** | 86 | ~91 | **≥95** | ≥95 ✅ |

**Repeat-visit LCP** (com vendor split + cache estável): expectativa
**~1.2s** (entry-only fetch, vendors do disk cache). Não medível em
Lighthouse single-run; verificar com WebPageTest "repeat view".

**Confidence:** Step 1 +1.1s LCP é well-bounded (delta exato igual a
helia-deps transfer time em 4G simulado). Steps 2-3 deltas são
estimativas com ±20%. Lily Round CWV-2 mede empiricamente.

---

## §6 Riscos

### 6.1 Lazy chunk fetch failure

**Cenário:** user em conexão flaky tap "Settings" → chunk fetch fails
→ `<Suspense>` fica em fallback eternamente.

**Mitigação:**
- Wrap cada lazy em `<ErrorBoundary>` com fallback "Erro ao carregar.
  Tente novamente" + retry button (disparar `import()` de novo).
- React 18 `<Suspense>` retry pattern: incrementar `key` do boundary
  on retry click força re-mount do lazy → re-fetch.
- ADR: criar `<LazyBoundary>` reusável em `src/components/UI/LazyBoundary.tsx`
  combinando ErrorBoundary + Suspense. Round CWV-2 implementa.

### 6.2 SRI (Subresource Integrity)

**Cenário:** chunk split aumenta superfície MITM. Vercel CDN é
trusted, mas defense-in-depth (manifesto §17 sem chave mestra) sugere
SRI hashes em `<script integrity="sha384-...">`.

**Status atual:** Vite **não emite** integrity attrs por default.
Plugin: `vite-plugin-sri` (3rd-party). Avaliar:
- Last update: ~2024, mantido mas não oficial.
- Conflita com modulepreload? Modulepreload links também aceitam
  `integrity` attr — plugin precisa popular ambos.
- VitePWA + Workbox: precache vs. integrity — Workbox tem campo
  `integrity` mas mismatch entre runtime fetch e SW precache pode
  corromper cache.

**Recomendação ADR:** **DEFER pro CWV-3 follow-up** com Barney security
review. SRI é correto a fazer mas:
- Não aparece em Lighthouse score (não é métrica CWV).
- Implementação não-trivial com SW + dynamic imports.
- Ataque vector (Vercel CDN compromised) é hipotético; não bloqueia
  ganho CWV-1/2.
- Round CWV-3: avaliar `vite-plugin-sri` vs. fork manual; se ambos
  custosos, considerar reverse-proxy gerando SRI no edge.

**Decisão pendente do Arquiteto:** ver §7.

### 6.3 Source maps prod

`'hidden'` mitigates: maps existem em `dist/` mas nunca referenciadas
em runtime. Bundle parse não revela structure mais do que minified
já revela. Trade-off bem documentado, low risk.

### 6.4 Progress indicator durante lazy load

Round Motion CWV-2 RFC define `<DriftSkeleton>`. Aqui só checar
dependency: se Motion CWV-2 ainda não shipped quando CWV-2 começa,
fallback é `<div className="h-screen" />` (espaço reservado, sem
flicker). Aceitável temporário.

### 6.5 Regression em first-paint pós-deploy

Cache miss inicial pra todos os chunks novos (vendor split muda hashes).
Primeira visita pós-deploy de cada user é ~50-100ms mais lenta. A partir
da segunda, cache hits começam pagar dividend.

Rollout: deploy em horário low-traffic; monitor Vercel Analytics LCP
p75/p95 por 24h; revert via git se p95 piora >10%.

### 6.6 Worker chunk + manualChunks edge case

Vite tem histórico de manualChunks interagindo mal com Web Workers
(`db.worker.ts`). Validar: build emite `db.worker-*.js` separado e
**não** importa de `vendor-react` ou `vendor-nostr` (worker context
não tem React; não-issue). Round CWV-2 grep build output.

---

## §7 Decisões pendentes do Arquiteto

Bloqueadores que precisam call do Arquiteto antes de Lily começar
CWV-2:

1. **Sourcemaps em prod:** sim (`'hidden'`) ou não (`false`)?
   - Recomendação Ted: `'hidden'`. Debug-friendly, security-acceptable,
     Lighthouse-friendly.
   - Alternativa: `false` (status quo) se Arquiteto preferir minimum
     attack surface.

2. **SRI agora ou CWV-3?**
   - Recomendação Ted: CWV-3 follow-up com Barney. CWV não premia,
     implementação não-trivial.
   - Alternativa: incluir em CWV-2 se Arquiteto considera prioridade
     §17 (sem chave mestra) maior que ROI percebido.

3. **Aceitar regression pequena de first-paint pós-deploy?**
   - Recomendação Ted: sim. Cache stability ganhos compensam.
     Monitor Vercel Analytics 24h pós-rollout.
   - Alternativa: NÃO fazer vendor split (Step 3); ganho médio
     sacrificado por safety.

4. **Subset font PT-BR (§3.4.2):** in-scope CWV-2 ou defer?
   - Recomendação Ted: DEFER. ROI ~15 KB marginal vs. custom font
     pipeline complexity.

5. **`SpreadMap.tsx` lazy status:** já é, ou eager? Lily confirma em
   Step 2; se eager, é priority alta porque MapLibre + Deck.gl
   somam 1.1+ MB.

---

## §8 Cross-references

### Vite docs

- `build.modulePreload`: <https://vitejs.dev/config/build-options.html#build-modulepreload>
  - `resolveDependencies` callback API documentada
- `build.sourcemap`: <https://vitejs.dev/config/build-options.html#build-sourcemap>
  - `'hidden'` mode
- `build.rollupOptions.output.manualChunks`: <https://rollupjs.org/configuration-options/#output-manualchunks>

### Web standards

- web.dev LCP optimization: <https://web.dev/articles/optimize-lcp>
- web.dev FCP: <https://web.dev/articles/fcp>
- web.dev font-display: <https://web.dev/articles/font-display>
- web.dev font-size-adjust: <https://web.dev/articles/css-size-adjust>

### React patterns

- React Suspense for code splitting: <https://react.dev/reference/react/lazy>
- Error boundaries (16.x → 18.x): <https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary>

### Drift internal

- `Docs/manifesto.md` §10 (cliente leve), §16 (disponibilidade
  distribuída), §17 (sem chave mestra)
- `Docs/drift-arquitetura-v4.md` §30.6 (kinds 9078..9081 regular)
- `Docs/rfcs/2026-05-rfc-motion-perf-polish.md` (DriftSkeleton dependency)
- `Docs/sessions/lighthouse-2026-05-09.md` (raw data — TBD se ainda
  não criado)
- `vite.config.ts:184-206` (current build config)
- `src/App.tsx:32-76` (eager imports inventory)
- `src/components/UI/Image.tsx:116` (helia lazy import)
- `src/components/Settings/SettingsCards.tsx:466,479,505` (helia lazy)

### Plugins avaliados

- `vite-plugin-sri` — defer CWV-3 (§6.2)
- `rollup-plugin-visualizer` — recomendado em CWV-2 dev workflow
  pra confirmar manualChunks
- `@fontsource/utils subset` — defer (§3.4.2)

---

## Apêndice A — Snippet final de `vite.config.ts` (consolidado)

Pra Lily colar/adaptar em CWV-2 Step 1+3+5:

```ts
build: {
  sourcemap: 'hidden',
  modulePreload: {
    resolveDependencies: (_filename, deps) =>
      deps.filter(dep =>
        !/(?:helia-deps|maplibre-gl|tesselator)-[^.]+\.js$/.test(dep)
      ),
  },
  rollupOptions: {
    output: {
      manualChunks(id) {
        // Vendor stables — cache stability across deploys.
        if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
          return 'vendor-react'
        }
        if (/[\\/]node_modules[\\/](nostr-tools|@noble[\\/]secp256k1|@noble[\\/]hashes|@scure)[\\/]/.test(id)) {
          return 'vendor-nostr'
        }
        if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) {
          return 'vendor-motion'
        }
        // Track B (Helia/libp2p) — lazy, opt-in. Mantém regex existente.
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
```

Atenção: regex `helia-deps` original tinha `@noble[\\/]secp256k1` —
movido pra `vendor-nostr` no consolidated. Confirma em Lily build
que nostr-tools ainda funciona (deve; é só naming).

---

## Apêndice B — Estimate methodology

LCP delta de Step 1 (-1.1s) calculado como:
```
helia-deps gzipped ~= 313 KB * 0.32 (gzip ratio Helia) ≈ 100 KB wire
4G simulated throughput Lighthouse ≈ 1.6 Mbps = 200 KB/s
transfer time = 100 / 200 = 0.5s
+ parse/eval em Moto G Power ≈ 313 KB * 1.5ms/KB = 470ms
+ blocking entry chunk (concurrent fetch) ≈ 130ms
total avoided ≈ 1100ms ≈ -1.1s LCP
```

Step 2 delta (-300/500ms FCP) é mais incerto — depende de quantos
modals user gesture toca em flow real. Lower bound assume 0 toques
em first session (FCP-only metric).

Round CWV-2 deve confirmar com Lighthouse run real após cada step
e atualizar este apêndice.

---

*Última atualização: 2026-05-09 · Ted CWV-1 · Doc-only · ~700 linhas · Round CWV-2 implementa*
