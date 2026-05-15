# Ted — Bundle audit (modo degradado, análise estática)

**Data:** 2026-05-15
**Contexto:** Marshall ainda iterando em `FeedTabs.tsx`; build atual
falha, então KB raw/gzip frescos não disponíveis. Este doc entrega a
análise **qualitativa**; números pendentes ficam marcados
`<PENDENTE-MEDIÇÃO>` e serão preenchidos quando build limpar
(próximo run do `npm run build:analyze` em main verde).

Baseline numérico mais recente disponível pra referência:
`Docs/sessions/cwv-final-report-2026-05-09.md` §Bundle composition
(2026-05-09) + commit `23f8e6c` (entry chunk 308 → 200 KB, lazy
ThreadView).

---

## 1. Análise por chunk

Cada subseção segue o template:

- **Eager/Lazy** — quem puxa, em que momento do boot.
- **Conteúdo** — imports principais que residem aqui.
- **Suspeita de unused / duplicado** — código provavelmente carregado
  mas raramente exercitado.
- **Proposta de corte** — ranqueada por payoff/esforço.

### 1.1 `vendor-react` (eager, modulepreloaded)

- **Eager.** Entry chunk depende — `react`, `react-dom/client`,
  `scheduler`. Sem cortes aqui sem mudar framework.
- **Conteúdo:** `react`, `react-dom`, `scheduler`.
- **Unused:** nenhum identificado. `react/jsx-runtime` é exercitado
  por todos JSX.
- **Proposta:** **não mexer.** Stable vendor — cache hit em redeploys
  é o principal valor.

Baseline 2026-05-09: **142.0 KB raw / ~46 KB gzip**.
Pós Round 9 (lazy ThreadView): inalterado.

### 1.2 `vendor-nostr` (eager, modulepreloaded)

- **Eager.** `events.ts` + `identity.ts` + `sync.ts` + `protocol.ts`
  todos importam `nostr-tools/pure` no boot.
- **Conteúdo:** `nostr-tools` (pure, pool, nip19), `@noble/secp256k1`,
  `@noble/hashes`, `@scure/base` (bech32).
- **Unused:** `nip04` (legacy DM, Drift usa NIP-44), `nip26`
  (delegation, não usado), `nip57` (zaps), `nip05` (DNS verification,
  Drift faz sem). **Mas** todos esses ficam fora porque consumidores
  importam de `nostr-tools/<submódulo>`, então tree-shaking elimina.
  Confirmado por `grep` em `src/`: só imports submodulares de
  `nostr-tools/{pure,pool,nip19,nip44,nip98}`.
- **Proposta:** investigar se `SimplePool` (em `nostr-tools/pool`)
  pode ser substituído por implementação mais enxuta — `nostr-tools`
  pool tem retry/relay-set tracking que pode ter código não usado em
  Drift (não fazemos NIP-65 list metadata via pool, fazemos via
  `lib/nip65.ts` próprio). **Payoff incerto** — provavelmente
  marginal (~5-10 KB raw).

Baseline 2026-05-09: **184.0 KB raw / ~58 KB gzip**.
Pós V9.21 (vendor-identity split) + V9.34c (nostr-extras split):
estimado **~155-165 KB raw** mas pendente confirmação. <PENDENTE-MEDIÇÃO>

### 1.3 `vendor-motion` (eager, modulepreloaded)

- **Eager.** `main.tsx:3` importa `LazyMotion` (shell) + factory
  async `loadMotionFeatures` que carrega `domMax` em chunk separado.
  Quem importa `m`, `AnimatePresence`, `useReducedMotion` direto
  faz parte do shell (tree-shakable).
- **Conteúdo do entry-eager:** `m` primitive, `AnimatePresence`,
  `useReducedMotion`, `LazyMotion` core, hook scaffolding. Sem
  features de animação/drag/layout — essas vão para chunk separado
  emitido pelo dynamic import.
- **Unused suspect:** `useScroll`, `useTransform`, `useSpring`,
  `motion.svg.*`, projection nodes — só vêm se algum import os puxa.
  Não encontrei imports no `src/` — provavelmente já tree-shaken.
- **Proposta** (ver §1.3.1 abaixo).

Baseline 2026-05-09: **115.4 KB raw / ~36 KB gzip** (single chunk,
era ANTES da migração LazyMotion).
Atual (pós LazyMotion em `main.tsx`): entry-eager **~12 KB raw**
+ chunk de features `<PENDENTE-MEDIÇÃO>`. Lighthouse 2026-05-15
(comment em `main.tsx:11`) confirma drop pra `~12 KB raw` entry-only.

#### 1.3.1 `domMax` vs `domAnimation` — análise específica

Leitura direta dos arquivos confirma:

```
features-min.mjs       = renderer + animations
features-animation.mjs = renderer + animations + gestureAnimations
features-max.mjs       = features-animation + drag + layout
```

E `drag` (`motion/features/drag.mjs`) já importa `MeasureLayout` +
`HTMLProjectionNode` — os MESMOS módulos que `layout` puxa. Ou seja,
o "custo" adicional de `layout` em `domMax` (sobre `domAnimation +
drag`) é só o **bind de feature `layout`** (`{layout: {...}}` map),
não o código de projection (que vem com `drag` de qualquer jeito).

**Estado atual no Drift:**
- `drag` é usado por `SwipeHandler.tsx` (post swipes) e
  `ReplySheet.tsx` (drag-down dismiss). **Obrigatório.**
- `layout` / `layoutId` foi removido em V3.2 do `FeedTabs.tsx`
  (substituído por `animate={{ x: '...' }}`). Grep em `src/`:
  zero ocorrências de `layoutId`, `layout=` prop, ou `layout`
  prop em motion components. **Não usado.**

**Conclusão:** o spread `...layout` em `domMax` (linha 11 de
`features-max.mjs`) é dead code pro Drift. Trocar `domMax` →
`{...domAnimation, ...drag}` (custom feature set) elimina:

- `motion/features/layout.mjs` exports (HTMLProjectionNode bind
  redundante).
- O conjunto de hooks de `layout` (`useLayoutEffect` tap, projection
  pre-commit, animate-layout shared).

**KB poupado (estimativa qualitativa):** o "layout" feature em
isolamento aciona `projection/animate/*`, `projection/utils/*` que
em medições históricas do framer-motion (release notes v10) ficam
em **~5-12 KB raw / ~2-4 KB gzip**. **Não é o grande corte** —
mas é grátis se o switch for limpo.

**Risco:** baixo, mas requer mexer em `main.tsx` (proibido neste
ciclo). Próximo sprint: trocar `loadMotionFeatures` pra:

```ts
const loadMotionFeatures = () =>
  Promise.all([
    import('framer-motion').then((m) => m.domAnimation),
    import('framer-motion').then((m) => m.drag),
  ]).then(([anim, drag]) => ({ ...anim, ...drag }))
```

(API verificada: `drag` exportado em
`render/dom/features-max.mjs` indireto, mas `framer-motion` barrel
não re-exporta `drag` puro — precisará usar `motion/features/drag`
ou definir um custom feature object dentro do projeto.) **<TODO Ted
sprint próximo>: confirmar API pública.**

### 1.4 `vendor-identity` (lazy)

- **Lazy.** Carregado quando `IdentityPanel` (lazy via `App.tsx:85`)
  monta. `IdentitySwitcher` também é lazy (`App.tsx:88`).
- **Conteúdo:** `qrcode`, `@scure/bip39`, `@scure/bip32`.
- **Unused:** `qrcode` tem renderers múltiplos (canvas, svg, terminal,
  png). `IdentityPanel.tsx:2` faz `import QRCode from 'qrcode'` —
  barrel default, mas Vite tree-shake limpa renderers não usados (só
  `toDataURL` é chamado). `@scure/bip39` traz wordlists pra TODAS as
  línguas embutidas — Drift usa só inglês (NIP-06 padrão).
- **Proposta:**
  1. **Médio payoff (~30-50 KB raw):** trocar `import QRCode from
     'qrcode'` por `import QRCode from 'qrcode/lib/browser'`
     (renderer canvas-only, sem PNG/SVG node-side). Confirmar com
     `npm run build:analyze`.
  2. **Médio payoff (~50-80 KB raw):** importar wordlist específica
     em vez do barrel: `import { wordlist } from
     '@scure/bip39/wordlists/english'` + `mnemonicToSeed(mnemonic,
     wordlist)`. Outras wordlists (japanese, italian, etc.) somam
     ~250 KB se barrel as puxar. Verificar se atual import já evita.

Baseline 2026-05-09: `qrcode` listado como **40 KB raw** num chunk
próprio antes da consolidação V9.21. Atual (2026-05-15 main verde):
**vendor-identity total 72.70 KB raw / 29.64 KB gzip** (qrcode +
bip39 + bip32 + secp256k1 deps internas).

**Medição aplicada 2026-05-15:** o swap `qrcode → qrcode/lib/browser`
foi tentado e revertido — `qrcode/package.json` declara campo `browser`
que redireciona `./lib/index.js → ./lib/browser.js` automaticamente
em bundlers com target browser (Vite default). Logo `import 'qrcode'`
JÁ resolve pra `browser.js`; o swap explícito é cosmético, zero KB
poupados. Conferi: `grep "renderTerminal\|renderPNG" dist/assets/
vendor-identity-*.js` retorna 0 matches — renderers Node já estavam
fora.

**Medição bip39 (item §2.3):** `src/lib/bip39.ts:26` já importa
`@scure/bip39/wordlists/english.js` explícito (não barrel
`@scure/bip39/wordlists`). Cortado em commit anterior; mantém-se
aplicado, zero KB adicionais.

### 1.5 `nostr-extras` (lazy)

- **Lazy.** Split em V9.34c. Importado por:
  - `lib/nostr-dm.ts` → só `webrtc-signaling-nostr.ts` (lazy WebRTC).
  - `lib/upload.ts:63` → `await import('nostr-tools/nip98')` (lazy
    no compose).
- **Conteúdo:** `nostr-tools/nip44`, `nostr-tools/nip98`,
  `@noble/ciphers`.
- **Unused:** `@noble/ciphers` exporta vários AEAD modes
  (ChaCha20-Poly1305, AES-GCM, XSalsa20). nip44 só usa
  ChaCha20-Poly1305. Tree-shaking deve cuidar — mas vale conferir
  no `dist/stats.html`.
- **Proposta:** baixa prioridade. Já está lazy, fora do critical
  path. Se chunk > 60 KB raw, considerar import explícito de
  `@noble/ciphers/chacha` em vez do barrel.

Baseline: chunk separado a partir de V9.34c. <PENDENTE-MEDIÇÃO>.

### 1.6 `helia-deps` (lazy)

- **Lazy.** Acesso via `import('../../lib/helia')` em 4 sítios:
  `Settings/SettingsCards.tsx` (pin actions), `main.tsx` (DEV
  smoke), `lib/blobs.ts` (3 chamadas em fetch/upload IPFS paths).
- **Conteúdo:** `helia`, `@helia/unixfs`, `libp2p`, `@libp2p/*`,
  `@chainsafe/*`, `multiformats`, etc.
- **Unused:** Helia traz transports default (`tcp`, `webrtc`,
  `webtransport`, `circuit-relay`). Drift roda em browser — `tcp`
  deveria sair via tree-shake (Node-only). Vale conferir.
- **Proposta:**
  1. **Alto payoff em pior cenário, médio típico:** verificar se
     bundle final inclui `@libp2p/tcp` ou `@libp2p/mdns` (Node-only).
     Se sim, configurar `helia()` factory pra explicitar lista de
     transports — `npm run build:analyze` mostra.
  2. **Baixo payoff:** alguns `interface-*` packages podem ter
     versão dupla. Verificar `npm ls multiformats` etc.
- Track B (manifesto §16): mesmo otimizado, helia-deps é fundamental
  pra disponibilidade. Não considerar tirar.

Baseline 2026-05-09: **968.6 KB raw / ~313 KB gzip**.

### 1.7 `maplibre-gl` (lazy)

- **Lazy.** Carregado por `SpreadMap.tsx:194` quando user abre overlay
  do mapa.
- **Conteúdo:** `maplibre-gl` (full).
- **Unused:** muito provável — Drift desenha basemap CARTO + ArcLayer
  do Deck.gl. Sources como `vector`/`raster-dem`/`hillshade`/3d
  terrain ficam carregados mas não usados. Trade-off: tirar exige
  fork ou compile flags customizados — maplibre-gl não expõe
  tree-shake oficial fácil.
- **Proposta:**
  - **Baixo payoff/alto esforço:** custom build de maplibre-gl
    (fork). Não vale.
  - **Médio payoff:** preload hint no service worker já está em
    `vite.config.ts` (CacheFirst). Garantir que UX em `SpreadMap.tsx`
    não dispara import antes do user clicar "mostrar mapa".
  - **Atual:** já corretamente lazy e fora do modulepreload (V9.34c
    `resolveDependencies` filter). Suficiente.

Baseline 2026-05-09: **1054.2 KB raw / ~280 KB gzip**.

### 1.8 `tesselator` (lazy)

- **Lazy.** Sub-chunk emitido por `SpreadMap.tsx` via
  `@deck.gl/layers` + `@deck.gl/aggregation-layers`.
- **Conteúdo:** Deck.gl `SolidPolygonLayer` tesselator (earcut.js +
  WebGL helpers).
- **Unused:** Drift usa `ArcLayer`, não `SolidPolygonLayer`. Se
  tesselator vem por dep transitivo de `@deck.gl/layers` barrel,
  trocar para import direto de `@deck.gl/layers/arc-layer` corta
  ~200 KB.
- **Proposta:** **alto payoff** (~200 KB raw / ~55 KB gzip).
  Refatorar `SpreadMap.tsx:194-197` pra usar submódulos:
  ```ts
  import('@deck.gl/layers/dist/arc-layer/arc-layer')
  ```
  Verificar API exposta. **Ação concreta para próximo sprint.**

Baseline 2026-05-09: **201 KB raw / ~55 KB gzip**.

### 1.9 `workbox-window` (eager-mas-minúsculo)

- **Eager.** `UpdatePrompt.tsx:29` importa `virtual:pwa-register/react`
  que internamente puxa `workbox-window`.
- **Conteúdo:** `workbox-window` (prod build).
- **Unused:** baixo — workbox-window já é minimal (só Worker
  registration + messaging).
- **Proposta:** **não mexer.** 5.7 KB raw / ~2 KB gzip — abaixo do
  threshold de relevância.

Baseline 2026-05-09: **5.7 KB raw**.

### 1.10 `qrcode` (lazy via vendor-identity)

Coberto em §1.4. Após V9.21, `qrcode` virou parte de
`vendor-identity` (consolidado com `@scure/bip39` por proximidade
de uso). Mantenho referência aqui para grep.

### 1.11 `rebroadcast` (lazy)

- **Lazy.** `lib/relays.ts:214` faz `import('./rebroadcast')` quando
  user adiciona relay novo (oportunista, Fase 5).
- **Conteúdo:** módulo próprio, deps minimalistas.
- **Unused:** nada identificado.
- **Proposta:** **não mexer.** 1.3 KB raw — irrelevante.

Baseline 2026-05-09: **1.3 KB raw**.

---

## 2. Próximos sprints — propostas ranqueadas

Ordenadas por **KB poupado / esforço** (maior é melhor):

| # | Ação | KB raw estimado | Esforço | Risco |
|---|------|-----------------|---------|-------|
| 1 | `@deck.gl/layers` → submódulo `arc-layer` (corta tesselator) | ~200 | baixo (1 import) | baixo |
| 2 | `qrcode` → `qrcode/lib/browser` em IdentityPanel | ~30-50 | baixo (1 import) | baixo |
| 3 | `@scure/bip39/wordlists/english` explícito | ~50-80 | baixo (2 imports) | baixo (NIP-06 só EN) |
| 4 | Auditar `helia()` transports (tirar `tcp`/`mdns`) | ~50-100 (se presentes) | médio | médio |
| 5 | `domMax` → `domAnimation + drag` custom feature | ~5-12 | médio (API check) | baixo |
| 6 | Auditar `@noble/ciphers/chacha` direto | ~5-10 | baixo | baixo |
| 7 | Verificar `nostr-tools/pool` `SimplePool` vs custom | ~5-10 (incerto) | alto | alto |

**Próximo bater: item #1 (tesselator submódulo).** Mais simples e
maior payoff. Item #2 e #3 são limpezas seguindo o padrão V9.21
(consumo explícito de submódulos pra parar barrel pulls).

---

## 3. Pendente medição

Quando build limpar (Marshall mergear FeedTabs), rodar:

```bash
DRIFT_ANALYZE=1 npm run build
# inspecionar dist/stats.html
ls -la dist/assets/ | sort -k5 -n -r | head -30
```

E preencher os seguintes campos neste doc:

- §1.2 `vendor-nostr` raw/gzip atual (pós V9.21 + V9.34c).
- §1.3 `vendor-motion` entry-eager raw/gzip + chunk de features
  separado.
- §1.4 `vendor-identity` raw/gzip + breakdown qrcode vs bip39.
- §1.5 `nostr-extras` raw/gzip.
- §1.6 `helia-deps` confirmar se `@libp2p/tcp`/`mdns` estão presentes
  (cmd: `grep -l 'tcp' dist/assets/helia-deps-*.js | head -3`).
- §1.8 `tesselator` confirmar se `@deck.gl/layers` barrel está
  trazendo `solid-polygon-layer` (visível em `stats.html`).
- Entry chunk total atual (commit `23f8e6c` reportou 200 KB; com
  FeedTabs refactor pode ter mudado).

CI já enforça entry chunk ≤ 250 KB hard (commit `f3b48eb`); pós
implementação dos cortes do §2, recalibrar ratchet pra ~180 KB.

---

## 4. Cortes triviais aplicados nesta sessão

Restrição: não tocar em `main.tsx`, `SwipeHandler.tsx`, `FeedTabs.tsx`,
`vite.config.ts`, `bootstrap.ts`.

Após análise:

- **`src/lib/nostr.ts`** — já usa submódulos `nostr-tools/pure`,
  imports tipo-only de `nostr-tools` para `Event`/`EventTemplate`.
  Sem mudança necessária.
- **`src/lib/identity.ts`, `identities.ts`** — já usam submódulos
  (`pure`, `nip19`). Sem mudança.
- **`src/lib/upload.ts`** — já lazy nip98. Sem mudança.
- **`src/components/Identity/IdentityPanel.tsx`** — candidato para
  `qrcode/lib/browser` (item #2 do §2), mas trocar barrel pra
  submódulo de `qrcode` mexe na assinatura do default export e exige
  validação local do componente. **Defer ao próximo sprint** com
  build limpo pra medir antes/depois.
- **`src/components/Feed/SpreadMap.tsx`** — candidato para
  `@deck.gl/layers/arc-layer` direto (item #1 do §2). API de
  Deck.gl 8.x exige verificação do submódulo correto + import shape.
  **Defer ao próximo sprint** com build limpo.

Decisão: **nenhuma edição aplicada neste ciclo.** As edições
seguras com payoff alto (qrcode browser, deck.gl submódulo,
bip39 wordlist) requerem medição antes-depois para validar que
o submodule existe e tree-shake funciona — não dá pra fazer
cegamente em modo degradado. Tudo prepared no §2 com diff
sugerido pro próximo sprint.

---

## 5. Resumo executivo

- **Critical path está limpo.** Vendor eager (`react`, `nostr`,
  `motion`) ~340 KB raw, todos modulepreloaded. Sem dead weight
  óbvio.
- **Lazy chunks correctly filtered** do modulepreload via
  `vite.config.ts:resolveDependencies` (Round CWV-2 §3.1).
- **Maiores oportunidades** estão em submodule imports que cortam
  barrel pulls — tesselator (deck.gl, ~200 KB) é o maior alvo
  isolado. Após ele, ganhos ficam <100 KB cada.
- **domMax→domAnimation+drag** é trabalho fino com payoff
  pequeno (~10 KB) — vale a pena depois que itens grandes saírem.
  Confirmou que `layoutId`/`layout` prop não tem mais uso no `src/`.
- **Não há nada estruturalmente errado** com o bundle atual em
  Round 9. Próximas melhorias são cortes cirúrgicos sobre uma base
  já bem organizada.
