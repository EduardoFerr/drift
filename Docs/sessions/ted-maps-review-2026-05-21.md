# Ted Mosby — Review arquitetural completo dos maps do Drift

**Data:** 2026-05-21
**Persona:** Ted Mosby (arquitetura, padrões, abstrações, débito técnico)
**Trigger:** user pediu re-audit (Satoshi + Ted paralelo) de todos os
maps após Sprint N+2 close. Satoshi cobre adversarial/privacy/game theory
em `satoshi-maps-audit-2026-05-21.md` (paralelo). Eu cubro arquitetura,
separation of concerns, performance, primitives, UX flows, débito
técnico.

**Escopo:** não escrevo código nesta sessão. Só audit doc + recomendações.

---

## 0. Sumário executivo (3 parágrafos pra TL;DR)

O sistema de mapas do Drift hoje é **um único componente
SpreadMap** (794 LoC) que opera em três modos (`post` / `global` /
`network`) mais um quarto contexto de embed (mini-map dentro do
PostViewer). A arquitetura usa lazy loading agressivo (~1.1 MB de
MapLibre + Deck.gl atrás de `loadMapDeps()` async, DRY refactor já
shipado em 2026-05-21) e mantém **um único entry point lógico**
(`useSpreadMap(postId, mode, currentPostId)` → `SpreadMap` →
`PostModeMap` OU `GlobalModeMap`). Isso é arquiteturalmente saudável
— evita duplicação e mantém uma só "porta" pra evolução.

O **principal débito** não é falta de testes (5 test files cobrindo
SpreadMap + hook + region key + network mode) nem performance hot path
(animation loop tem cleanup correto; lazy import economiza FCP). É
**concentração**: 794 LoC num só arquivo, com 3 efeitos diferentes
(post estático, global animado, network animado reusando global),
overlays (K=1 warning, mode toggle, attribution, stats, placeholder),
e branching inline `mode === 'global' || mode === 'network'`. O
arquivo está no limiar de **fadiga estrutural** — próxima feature
(TimelineScrubber) ou variação (heatmap em global, animação em post)
vai forçar refactor reativo.

**Decisão sobre primitive extract:** **não extrair `<MapView>`
genérico AGORA.** Adoption ainda é N=1 (só SpreadMap). Regra do
design-system §5 ("primitive quando ≥2 callsites com ≥10 LoC
duplicadas") não está atendida — `MapShell` interno (linhas 634-665)
JÁ é o primitive interno e cobre os 3 modes. Extrair pra
`src/components/UI/MapView.tsx` seria criar abstração N=1 — antipattern.
A extração correta acontece quando aparecer Map em Profile (Fase 6,
spread density per-user) OU Trending tab (Fase 6+, "onde está
acontecendo agora"). Recomendação: **manter MapShell privado**;
documentar em design-system.md como "internal primitive of SpreadMap";
LOCK_VIA_TEST opcional se quisermos travar estrutura.

Top 3 refactor opportunities, ranking por valor:

1. **Split `SpreadMap.tsx` em 3 arquivos** (`SpreadMap.tsx` shell + dispatcher,
   `PostModeMap.tsx`, `GlobalModeMap.tsx`) — não muda comportamento, melhora
   navegabilidade, reduz risco de bugs cross-mode quando TimelineScrubber
   for adicionado. ~2h work, zero risk.
2. **Extrair `useMapInstance(containerRef, options)` hook** — encapsula
   o pattern "import async + map = new maplibregl.Map(...) + cleanup =
   map.remove()" que aparece DUAS vezes (PostModeMap 246-336 + GlobalModeMap
   449-613). DRY real, N≥2. ~3h work, baixo risk se com test.
3. **Camera state persistence** (zoom/center entre opens) via
   `user_prefs.map_camera` — feature gap conhecida; quando user fecha
   e reabre, perde contexto espacial. ~4h work, traz UX win
   significativo.

Convergência com Satoshi: ambos provavelmente flagamos K=1 (já mitigado
parcialmente 2026-05-21 via SoloSpreaderWarning), CARTO tile IP leak
(já mitigado via `map_tile_url_template` opt-in), e provavelmente
divergimos em **autoplay da animação** — Satoshi vai questionar gasto
de bateria/CPU sem opt-out; eu argumento que é parte da identidade
editorial (Lily 2026-05-18 deliberation `map-animation-himym`).

---

## 1. Inventário confirmado

### 1.1 Arquivos de componente

| Arquivo | LoC | Papel |
|---|---|---|
| `src/components/Feed/SpreadMap.tsx` | 794 | Componente principal; 3 modes; 2 implementações `PostModeMap` + `GlobalModeMap`; primitive interno `MapShell` |
| `src/components/Feed/MapExplainerCard.tsx` | 261 | Overlay fullscreen "o que é cada mapa", copy + legend por context. Wired via long-press 3s. |
| `src/components/Feed/spreadMapLayers.ts` | 20 | Wrapper estático tree-shake-friendly pra layers Deck.gl |
| `src/components/Feed/useMapDeps.ts` | 68 | Async loader DRY (`loadMapDeps()`) — shared entre PostModeMap e GlobalModeMap |
| `src/hooks/useSpreadMap.ts` | 453 | Hook de data fetch + agregação SQL → `SpreadMapData`. Modes `post`/`global`/`network`. Inclui `regionKey`, `isUserSoloSpreader`, `buildGlobalNodes` (pure helpers exportados). |
| `src/lib/trust/map-color.ts` | 60 | Pure helper `pinColor(pprScore)` — 4-tier discreto. Opt-in via `lens_show_in_map`. |
| **Total** | **1656** | |

### 1.2 Callsites (onde maps são consumidos)

| Origem | Como abre | Mode default | Embedded? | Linha |
|---|---|---|---|---|
| `App.tsx:MapOverlay` (V8) | Bottom-nav "MAPA" → fullscreen `FullPageCard` | `post` (do `currentPost`) | não | 1927-1981 |
| `PostViewer.tsx` botão 🗺 | Tap no header do post → mini-map sanfona (clipPath inset) inline | `post` (do `post` corrente) | sim | 484-533 |
| `PostViewer.tsx` long-press 3s no 🗺 | Long-press → `MapExplainerCard context='embedded'` | n/a (só explainer) | overlay | 792-801 |
| `App.tsx:MapOverlay` mode toggle | Botão `[post | global | network]` no top-left do mapa | troca via `setMapMode` | não | 1935 |

**Confirmado:** Profile, Trending, ThreadView **NÃO** abrem map. ThreadView
só importa porque a hierarquia compõe (overlay layer comment).
SettingsCards e SuaLenteCard só **referenciam pref keys** (`map_view`,
`map_tile_url_template`, `lens_show_in_map`) — não renderizam map.

Inventário grep-verificado:

```text
src/App.tsx                          ← MapOverlay (V8)
src/components/Feed/MapExplainerCard.tsx
src/components/Feed/SpreadMap.tsx    ← componente principal
src/components/Feed/spreadMapLayers.ts
src/components/Feed/useMapDeps.ts
src/components/Post/PostViewer.tsx   ← embedded mini-map
src/components/Post/ThreadView.tsx   ← apenas comment hierarchy reference
src/components/Settings/SettingsCards.tsx     ← pref keys only
src/components/Settings/SuaLenteCard.tsx      ← lens_show_in_map toggle
src/hooks/useSpreadMap.ts            ← data hook
src/lib/db.worker.ts                 ← worker (não map-específico)
src/lib/prefs.ts                     ← pref schema
src/lib/seeder.ts                    ← seedFromSpreaders
src/lib/trust/map-color.ts           ← pure pinColor
src/types/drift.ts                   ← types
```

### 1.3 Tests existentes

| Test | LoC | Cobertura |
|---|---|---|
| `tests/spread-map.test.ts` | 71 | `_computeBounds` (pura) + smoke renderless |
| `tests/spread-map-network-mode-conformance.test.ts` | 283 | LOCK_VIA_TEST network query shape, scope (não toca lens_edges/score/reports), empty states |
| `tests/useSpreadMap-regionKey.test.ts` | 78 | `regionKey()` pura |

Gaps: nenhum test cobre `isUserSoloSpreader`, `pinColor`, `buildGlobalNodes`,
animation loop cleanup, ou interaction (tap, gesture). Lily check passa
porque pure helpers cobertos via inferência indireta, mas formalmente
3 funções puras críticas (§7) sem test direto.

---

## 2. Diagrama mental — fluxo data → render → user

```
┌─ User intent ─────────────────────────────────────────────────────┐
│  (a) Bottom-nav MAPA  → MapOverlay (App.tsx)                      │
│  (b) Tap 🗺 no post   → showMap=true (PostViewer)                 │
│  (c) Long-press 3s 🗺 → showMapExplainer=true                     │
│  (d) Tap [post|global|network] toggle → setMapMode                │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌─ React subtree ────────────────────────────────────────────────────┐
│  <SpreadMap postId mode onModeChange currentPostId/>               │
│     │                                                              │
│     ├── useSpreadMap(postId, mode, currentPostId)  ←── stores      │
│     │      ↓                                       (boot, follows) │
│     │   buildPostData    | buildGlobalData | buildNetworkData      │
│     │      ↓ db.exec(SQL)                                          │
│     │   SpreadMapData { origin, destinations, arcs, nodes,         │
│     │                   totalSpreads, countries, firstSpread,      │
│     │                   latestSpread }                             │
│     │                                                              │
│     ├── Empty/error/loading guards (linhas 125-183)                │
│     │                                                              │
│     └── Dispatch:                                                  │
│         mode === 'post'  → <PostModeMap data .../>                 │
│                            heatmap + scatter (static)              │
│         mode === 'global'│'network' → <GlobalModeMap data .../>    │
│                                       lines + dots (RAF animated)  │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌─ Render layer ─────────────────────────────────────────────────────┐
│  useEffect:                                                        │
│    await loadMapDeps()   ←── lazy import MapLibre + Deck.gl        │
│    new maplibregl.Map(container, style, center, zoom)              │
│    new MapboxOverlay({ layers: [...] })                            │
│    map.addControl(overlay)                                         │
│    [GlobalModeMap apenas] tick(ts) RAF loop:                       │
│       overlay.setProps({ layers: visSegs+visPts })                 │
│  cleanup: map.remove() + cancelAnimationFrame                      │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌─ Visual hierarchy (overlay z-index from back to front) ────────────┐
│  z-0   : map tile raster (CARTO Dark Matter ou custom template)    │
│  z-1   : Deck.gl overlay layers (heatmap/lines/scatters)           │
│  z-15  : ripple wave (PostViewer pressing feedback)                │
│  z-20  : SoloSpreaderWarning (K=1 doxx alert)                      │
│  z-20  : embedded mini-map clipPath container (PostViewer)         │
│  z-30  : ModeToggle [post|global|network] + ⋮+💬+🗺 header        │
│  z-(FullPageCard) : MapExplainerCard (long-press 3s)               │
└────────────────────────────────────────────────────────────────────┘
```

Característica importante: **`overlay.setProps()` em RAF mantém a
mesma map instance** — animation loop **não** re-mounta map a cada
frame. Layer constructors `LineLayer` / `ScatterplotLayer` instanciados
a cada `renderFrame`, o que **é** wasteful mas mitigado por `overlay`
fazer reconciliation interno na Deck.gl. Verificar com profiler em
audit futuro se virar bottleneck.

---

## 3. Audit por dimensão

### 3.1 Separation of concerns

**Score: 7/10** — bom, melhorável.

✅ **Data fetch separado em hook puro** (`useSpreadMap.ts`).
  Aggregation lives there, components consume `SpreadMapData`. Helpers
  puros (`regionKey`, `isUserSoloSpreader`, `buildGlobalNodes`) são
  exported pra teste.

✅ **Deps loading isolado** (`useMapDeps.ts`). DRY refactor B 2026-05-21
  centralizou imports MapLibre + Deck.gl + layers. Reduce branch surface.

✅ **Tile style isolado em pure builder** (`buildMapStyle(customTemplate)`).
  Sovereignty pref `map_tile_url_template` injeta sem mexer em map init.

⚠️ **`SpreadMap.tsx` é gordo (794 LoC) misturando 4 preocupações**:
  - Top-level dispatcher (linhas 110-207)
  - `PostModeMap` componente (228-355) — useEffect monstro
  - `SoloSpreaderWarning` overlay (371-398) — não trivial
  - `GlobalModeMap` componente (402-630) — useEffect monstro+RAF
  - `MapShell`, `ModeToggle`, `ModeBtn`, `Placeholder`, `_computeBounds`
    (633-794)

  Cada um faz sentido isolado, mas o arquivo cruza a barreira de
  "scrollable na cabeça". **Recomendação 1** (top 3): split em 3
  arquivos físicos. Zero comportamental.

⚠️ **`useEffect` interno de PostModeMap (90+ LoC) e GlobalModeMap (165+
  LoC) misturam init + animation + cleanup + layer config.** Pattern
  candidato pra `useMapInstance(containerRef, { center, zoom, style,
  onLoad, layers, onTick })` — **Recomendação 2** (top 3). N=2 já bate
  threshold; quando TimelineScrubber entrar (anima per-time-window)
  vira N=3 e o débito custa caro.

### 3.2 Performance

**Score: 8/10** — sólido, mas tem 2 oportunidades latentes.

✅ **Lazy import correto.** `App.tsx:182` + `PostViewer.tsx:71` carregam
  SpreadMap sob `lazy()`. `loadMapDeps()` async dentro do useEffect.
  Bundle entry chunk não engole MapLibre — apenas quando user pede.

✅ **Animation cleanup correto.** GlobalModeMap useEffect retorna
  cleanup que faz `cancelAnimationFrame(rafId)` + `clearTimeout(pauseTimer)`
  + `map.remove()` + nullifies overlay. Sem leak observável em audit
  Lily memory-leak 2026-05-15.

✅ **`updateTriggers`** em LineLayer/ScatterplotLayer força re-eval só
  quando `p` muda (animation frame). Deck.gl reconciliation OK.

⚠️ **Layer constructors recriados a cada frame** (linhas 500-575). Deck.gl
  abstrai isso via `setProps({ layers: [...] })` mas constructor calls
  ainda são overhead. Em 60fps com socialNodes>100, pode adicionar
  ~0.5ms/frame de garbage. Aceitável agora; medir se feed crescer.

⚠️ **Mini-map embedded NÃO é instância separada por post**: PostViewer
  só renderiza SpreadMap quando `showMap === true`, e fecha quando
  `false`. **Cada toggle re-monta** (clipPath AnimatePresence).
  Aceita o trade-off de re-mount (~300ms init + re-fetch SQLite) vs
  manter instância em background (custo idle de WebGL context). Decisão
  Lily 2026-05-18: aceitar re-mount é correto pra mobile (WebGL idle
  drena bateria; iOS Safari limita contexts simultâneos a ~16).

⚠️ **Tile cache CARTO**: browser HTTP cache cuida. **NÃO** existe pre-cache.
  Primeira abertura de map em cold start carrega 4-16 tiles (~200KB
  comprimidos) na visible area. Workbox runtime cache hoje cobre
  `/api/*` mas não `basemaps.cartocdn.com`. Oportunidade: adicionar tile
  domain ao service worker runtimeCaching com `CacheFirst + MaxAgeMs(7d)`.
  Win: 2nd-open de map é instantâneo. Não bloqueante.

### 3.3 Primitives

**Score: 6/10** — funciona, mas registry desalinhado com realidade.

✅ **`MapShell` interno já é primitive** (linhas 634-665). Cobre wrapper
  pattern: containerRef + ModeToggle + stats + attribution. Os 3 modes
  consomem.

✅ **`Placeholder`** (linhas 746-776) primitive interno pra empty/error
  states.

⚠️ **NÃO registrado no design-system.md §5.** `MapShell` e `Placeholder`
  são primitives "privados" de SpreadMap. Pra um agente novo (Robin/Lily
  futuro) descobrir, precisa grep manual. **Recomendação**: adicionar
  ao §5 com nota "internal, escopo SpreadMap" — discoverable sem
  promover pra `UI/`.

⚠️ **`MapExplainerCard` usa `FullPageCard`** (primitive já registrado) —
  ✅ correto. Re-uso bom.

⚠️ **`ModeToggle` é tabs custom** (linhas 676-707). Tem `role=tablist`,
  `aria-pressed`, mas **não é primitive RadioGroupButton** (que existe
  em §5 desde 2026-05-20). RadioGroupButton foi extraído pra
  Velatura-safe + Tinder-action — daria pra reusar aqui. Verifying:
  ModeToggle tem botão `disabled` (network sem npub) — RadioGroupButton
  precisa suportar disabled option, **confirmar antes de migrar**.

⚠️ **Empty state com action button** (linhas 766-776) — pattern visto
  também em PeersCard, IdentityPanel. Candidato a `EmptyState` primitive,
  mas N=3-4 LoC duplicadas só (não atende threshold §5).

### 3.4 State management

**Score: 9/10** — minimal e correto.

✅ **`mapMode` em local state** (`App.tsx:1935 useState`). Ephemeral —
  fecha overlay e perde mode. **Aceitável** porque o user-mental-model
  é "abri mapa pra ver". Persistir mode entre opens em `user_prefs`
  seria over-engineering; modelo atual está OK.

✅ **`map_view` (`free`|`fit-bounds`) em `user_prefs.map_view`** — persiste
  bem. Configurável em Settings.

✅ **`map_tile_url_template` em `user_prefs.map_tile_url_template`** —
  sovereignty pref persistida.

✅ **`lens_show_in_map` em `user_prefs.lens_show_in_map`** — opt-in
  persistente, default OFF (Satoshi audit).

✅ **K=1 dismissal**: session-only (`useState` em PostModeMap). Não
  persiste — design intencional, pra educar em cada novo post K=1.
  Documentado em `Docs/threat-model-maps.md` §K=1-DOXX.

⚠️ **`currentPostId` prop-drilled** App → MapOverlay → SpreadMap →
  GlobalModeMap. Cadeia funcionando, mas se Map em Profile vier no Fase
  6, precisa cuidado pra não duplicar isso. Recomendação leve: deixar
  como prop (explicit > implicit context) até N=2.

❌ **Camera state (zoom/center) NÃO persiste entre opens.** User
  navega → fecha → reabre → volta ao zoom 1.5 fixo. **Gap UX
  significativo.** Recomendação 3 (top 3): persistir em
  `user_prefs.map_camera = { lng, lat, zoom, mode }`. ~4h work.

### 3.5 UX flows

**Score: 7/10** — limpo, mas com edges.

✅ **Bottom-nav MAPA**: 1 tap → fullscreen overlay → FECHAR top-right.
  Discoverable.

✅ **🗺 no PostViewer**: 1 tap → mini-map embedded inline. 2nd tap →
  fecha. Sanfona animation (clipPath inset) é proprietária e marca
  identidade. ✅ Lily 2026-05-18 deliberation aprovou.

✅ **Long-press 3s 🗺 → MapExplainerCard**: pattern v_2026-05-22 (user
  pedido). `useLongPress` hook + ripple feedback CSS. Coexiste com
  short-tap (alterna mini-map). Conflito potencial: user que segura
  por hesitação acidental abre explainer. **Mitigação**: 3s é longo
  (Material guideline é 500ms pra long-press); usuário hesitante
  geralmente solta antes. ✅ aceito.

⚠️ **Mode switcher [post|global|network]** está no top-LEFT do map
  (`absolute left-3 top-3`). FECHAR está no top-RIGHT do FullPageCard
  (header). **Não colidem visualmente**, mas:
  - Em mini-map embedded (PostViewer), `onModeChange` é UNDEFINED
    (linhas 524-528 NÃO passam `mode`/`onModeChange`). Resultado:
    `ModeToggle` não renderiza em embedded (correto). User só vê 3 modes
    no overlay fullscreen. **Verificado, OK.**
  - Botão `network` disabled quando `!activeNpub`. Title attr aparece
    em hover desktop; mobile só vê opacity baixa. UX aceitável (Robin
    `B3 fix 2026-05-22` mostra que user reporta confusion em radio
    states — não vi report similar pra network disabled, presumindo OK).

⚠️ **Tap no pin/dot/arc NÃO faz nada** atualmente. `pickable: true`
  está em socialNodes (linha 525) mas não tem `onClick` handler.
  Oportunidade: tap em pin → tooltip com npub + spread count + (futuro)
  link pro perfil. **Não bloqueante hoje**; marcar como gap.

⚠️ **GPS off empty state action label**: "abrir GPS settings" (B3 fix
  Robin 2026-05-22) substitui "ativar GPS" anterior. ✅ correção
  semântica — não promete one-click ativação.

⚠️ **Network mode empty state com 0 follows**: "Você ainda não segue
  ninguém. Explore o feed global..." — ✅ honesta. Mas **NÃO oferece
  ação pra abrir feed**. Pequeno gap UX: button "ir pro feed global"
  fecharia o map e voltaria pra tab Global. ~1h work, polish.

### 3.6 Diferenciação dos 4 contextos

**Score: 8/10** — boa, com 1 risco.

| Contexto | Mode | Onde aparece | Sinal visual |
|---|---|---|---|
| (a) Bottom-nav MAPA | toggle 3 modes | FullPageCard | header "propagação" + events counter + close |
| (b) Mini-map post | `post` only (fixed) | PostViewer card | sanfona clipPath inset, fundo `drift-bg` |
| (c) Mode `global` | `global` | overlay | linhas animadas mint, social-nodes circulares |
| (d) Mode `network` | `network` | overlay | mesma visual do global, dados filtrados por follows |

**Risco:** modes `global` e `network` **renderizam quase idêntico**
visualmente (mesma cor mint, mesmo layer, mesma animação). Diferença é
APENAS o dataset (filtrado vs não). User pode confundir "olhei o mapa
network, achei vazio, network está quebrada" quando na verdade
follows < 10 → poucos arcos. **Mitigação atual:**
- ModeToggle estado `aria-pressed` mostra qual ativo
- Stats footer mostra "N pessoas · M drifts" (diferente no count)
- MapExplainerCard tem copy específica por mode

**Mitigação adicional sugerida (não bloqueante):** colorir levemente
diferente em network — ex: tint amber sobre mint pra sinalizar "lente
local-only" coerente com `pinColor` warm-yellow tier. Não obrigatório
agora — só registrar.

### 3.7 Compose com features em vôo

#### MapExplainerCard (long-press 3s) — ✅ aprovo

Implementação já merged em `bf:2026-05-22`. Pattern:
- `useLongPress` hook reaproveitado (já em PostViewer pra slim mode)
- `MapExplainerContext` discriminated union (`'embedded' | 'overlay-default' |
  SpreadMapMode`)
- Copy por context é pure function `getMapExplainerCopy(context)` —
  testável

**Crítica construtiva**:
- Copy mode `network` (linhas 116-140) menciona "PPR ≥ 0.7" tiers —
  mas a legend só faz sentido quando `lens_show_in_map=ON`. Quando OFF
  (default), os 3 dots da legend não mapeiam ao que user vê (tudo
  default chartreuse). **Recomendação**: a legend network deve **ler
  `lens_show_in_map`** e exibir 1 dot ("DRIFT remoto, default chartreuse")
  quando OFF; OS 3 tiers quando ON. ~30min fix, polish significativo.

#### TimelineScrubber (lapso temporal pros animados) — ⚠️ ajustar

**Contexto** (assumindo propostas em sessão paralela ou inferindo do nome):
slider de tempo pra "rebobinar" a animação RAF do GlobalModeMap.

**Posição arquitetural Ted:**

1. **Integration point natural**: substituir o RAF self-running por
   um RAF controlado por scrubber position. O `tick(ts)` hoje (linhas
   579-595) computa `p = (ts - startTime) / ANIM_DURATION`. Com scrubber,
   `p` vem do componente parent (`<TimelineScrubber value={p}/>`).

2. **Problema**: hoje `tick` é fully encapsulado no useEffect. Externalizar
   `p` quebra encapsulamento — useEffect precisaria depender de
   `scrubberValue`, re-running animation toda vez que slider arrasta
   (péssimo). **Solução correta**: extrair `useMapInstance` (Recomendação
   2 top 3) com API `setAnimationProgress(p: number)`. Scrubber chama
   esse setter. Map instance live.

3. **Performance**: scrub a 60fps emitiria 60 sets/s — `setProps` Deck.gl
   é ok pra isso. Mas computações `data.arcs.filter(s => s.t <= p)` em
   linha 497 são O(N). Em N=2000 (LIMIT da query), são 120k ops/s. OK
   hoje; degrada se LIMIT subir.

4. **UX**: scrubber em mode `post` faz sentido (cadeia cronológica
   visível). Em `global`/`network` (árvore viral cross-post),
   "rebobinar" é semanticamente confuso — t é normalizado per-session,
   não tempo absoluto. **Recomendação Ted**: TimelineScrubber só em
   modes onde t mapeia a "tempo do post" (`post`); em global/network,
   esconder ou substituir por "filtro por janela de tempo" (slider
   passa a filtrar `created_at >= X`).

5. **Veredito Ted**: **ajustar antes de shipar**. Quero ver:
   - Spec da semântica de scrubber por mode (não é unificada)
   - API do `useMapInstance` extrato pré-scrubber (Recomendação 2 vira
     bloqueio do TimelineScrubber)
   - Empty state quando scrub vai antes do primeiro arco

#### WoT colors opt-in (D21) — ✅ aprovado, bem integrado

`pinColor(pprScore)` pure function, RGBA tuple, 4-tier discreto, opt-in
`lens_show_in_map` default OFF. `updateTriggers: { getFillColor:
lensShowInMap }` força recompute quando pref muda. Manifesto §22, §24,
§28 respeitados.

**Pequeno gap**: quando `lens_show_in_map=ON` mas user **ainda não
rodou recomputeLens** (cache vazio), pprScores é Map vazio →
`pprScores.get(npub) === undefined` → tudo fica `PIN_COLOR_DEFAULT`.
User não vê diferença, pode pensar que toggle não funciona. Mitigação
sugerida: hint chip "calculando lente…" quando ON+vazio. ~1h work.

#### Network mode nodes+clusters (E) — ✅ aprovado, perf OK

`buildGlobalNodes()` pure dedup por npub, tamanho `√spreadCount`. Em
mode network, query SQL filtra por `follows` antes de chegar ao
dedup. LIMIT 2000 em ambos. Test conformance
(`spread-map-network-mode-conformance.test.ts`, 283 LoC) trava query
shape + scope (não toca lens_edges/score/reports). ✅ defesa robusta.

**Microcrítica**: `socialNodes` recalculado a cada `data` change
(linha 443 `data.nodes.map(...)`). Mas data muda quando follows mudam
ou postId muda — aceitável. Não vejo problema.

### 3.8 Débito técnico

#### Comments TODO/FIXME

`grep TODO|FIXME|HACK|XXX` em SpreadMap.tsx retorna **0 matches**. ✅
Código limpo em termos de notas pendentes.

#### `Docs/known-limitations.md` map-related

§7 "K-anonymity ausente em SpreadMap (K=1 doxx residual)" — **HIGH risk**,
mitigação parcial shipada 2026-05-21 (SoloSpreaderWarning),
**Phase 2 (K-anonymity engine) pendente**. Reopener: DAU > 1000 OR
user report concreto. ✅ documentado adequadamente.

#### Gaps não documentados (sugerir adicionar a `known-limitations.md`)

1. **Camera state não persiste** entre opens (zoom/center reset). UX
   gap.
2. **Pin tap não tem handler** (`pickable: true` configurado mas sem
   `onClick`). Feature gap; tooltip futuro.
3. **MapExplainerCard network legend não respeita `lens_show_in_map`**
   estado atual. Copy gap.
4. **WoT pinColor sem feedback quando cache vazio** (post `recomputeLens=ON`,
   pré-compute). UX gap.
5. **CARTO tile cache não no service worker runtimeCaching**.
   Performance gap (2nd-open lento).

### 3.9 Tests

**Coverage atual:**
- ✅ `_computeBounds` pure (spread-map.test.ts)
- ✅ `regionKey` pure (useSpreadMap-regionKey.test.ts)
- ✅ Network mode query shape + scope LOCK_VIA_TEST
  (spread-map-network-mode-conformance.test.ts)

**Gaps de teste (sugestões):**
- ❌ `isUserSoloSpreader` — pure helper exportado em `useSpreadMap.ts:318`,
  **sem test direto**. Lógica simples mas é parte do K=1 mitigation —
  LOCK_VIA_TEST trava regression de threat model.
- ❌ `pinColor(pprScore)` — pure, 4-tier discreto, 5 branches. **Sem
  test direto**. Críticos: `undefined`, `NaN`, `Infinity`, `0`, edge
  values `0.3`, `0.7`, `1.0`.
- ❌ `buildGlobalNodes(rows)` — dedup logic, sort logic. **Sem test
  direto**. Trivial mas LOCK_VIA_TEST trava "anchor location =
  primeiro spread observado" invariant.
- ❌ `getMapExplainerCopy(context)` — pure, 4 contexts, copy correctness.
  **Sem test direto**.
- ❌ MapExplainerCard render por context (RTL test) — opcional;
  visual regression catch.
- ❌ Animation cleanup smoke test — em jsdom não dá pra rodar MapLibre,
  mas dá pra testar que `useSpreadMap` chama `db.exec` correto + state
  flows OK.

**Recomendação**: 1 PR adicionando ~80 LoC de test pra
`isUserSoloSpreader` + `pinColor` + `buildGlobalNodes` +
`getMapExplainerCopy`. Total ~30min, manifesto §7 lock dose.

---

## 4. Scoring sumário por map

| Map | Separation | Perf | Primitive-ready | a11y | UX | Total |
|---|---|---|---|---|---|---|
| MapOverlay (bottom-nav) | 7 | 8 | 7 | 8 | 8 | 7.6 |
| Mini-map embedded (PostViewer) | 7 | 9 | 8 | 8 | 8 | 8.0 |
| Mode `post` | 7 | 9 | 7 | 8 | 8 | 7.8 |
| Mode `global` | 6 | 7 | 6 | 7 | 7 | 6.6 |
| Mode `network` | 6 | 7 | 6 | 7 | 7 | 6.6 |
| MapExplainerCard | 9 | 10 | 9 | 9 | 8 | 9.0 |

Modes global+network puxam pra baixo por causa do tamanho de
`GlobalModeMap` (~210 LoC de useEffect) e da divergência semântica do
TimelineScrubber proposto. MapExplainerCard é o ponto mais alto —
pure copy + FullPageCard primitive reuso.

---

## 5. Top 3 refactor opportunities

Ranking por (valor / risco / effort).

### #1 — Split `SpreadMap.tsx` em 3 arquivos físicos

**O quê:** mover `PostModeMap` (linhas 228-355) → `SpreadMap/PostModeMap.tsx`;
mover `GlobalModeMap` (402-630) → `SpreadMap/GlobalModeMap.tsx`. Manter
`SpreadMap.tsx` como shell + dispatcher + `MapShell` + `ModeToggle` +
`Placeholder`.

**Por quê:** 794 LoC num arquivo cruza barreira cognitiva. TimelineScrubber
vai adicionar ~150 LoC. Sem split, futuro Lily/Ted vai abrir o arquivo
e perder 5min orientando.

**Risco:** zero (movimentação física, sem mudança comportamental).

**Effort:** ~2h.

**Tradeoff:** N=3 arquivos novos vs 1 gordo. Worth it.

### #2 — Extrair `useMapInstance(containerRef, opts)` hook

**O quê:** novo hook em `src/hooks/useMapInstance.ts` que encapsula:

```typescript
// Pseudo-API (NÃO implementar aqui, só registrar)
function useMapInstance(
  containerRef: RefObject<HTMLDivElement>,
  opts: {
    center: [number, number]
    zoom: number
    style: StyleSpecification
    layers: () => Layer[]   // factory pra layers
    fitBounds?: [[number, number], [number, number]]
    onTick?: (progress: number) => Layer[]  // pra modes animados
  }
): { ready: boolean, setProgress: (p: number) => void }
```

**Por quê:** PostModeMap + GlobalModeMap duplicam pattern "useEffect →
loadMapDeps → new Map → addControl(overlay) → cleanup". TimelineScrubber
vai precisar acesso externalizado a `setProgress`. Sem hook, vira
prop drilling de RAF refs ou refactor reativo.

**Risco:** médio. Precisa test sólido pra cleanup (RAF, timer, map.remove).
Risco de regressão silenciosa em memory leak.

**Effort:** ~3h (incluindo test).

**Tradeoff:** abstração precoce vs DRY real. **N=2 batido**; **N=3
iminente** (TimelineScrubber). **Vale a pena AGORA**, antes do
scrubber land.

### #3 — Camera state persistence em `user_prefs.map_camera`

**O quê:** novo pref `map_camera: { lng: number, lat: number, zoom: number,
mode: SpreadMapMode }`. Persistir via `map.on('moveend')` (debounced
500ms). Restaurar em init.

**Por quê:** UX gap claro — user navega, fecha, reabre, perde contexto.
Reportável por qualquer usuário com >10s de uso de map.

**Risco:** baixo. Pref schema migration (1 nova key). Restaurar com
guard (válido lat/lng/zoom).

**Effort:** ~4h (schema migration + restore + debounce + test).

**Tradeoff:** state extra a manter (mais 1 pref) vs UX win. Win > cost.

---

## 6. Recomendação sobre features em vôo

### MapExplainerCard (long-press 3s) — ✅ APROVAR (com 1 polish)

Já merged. Pattern sólido. Polish sugerido: legend de `network` mode
deve respeitar `lens_show_in_map` (1 dot quando OFF, 3 tiers quando ON).
~30min fix. Não bloqueia merge.

### TimelineScrubber — ⚠️ AJUSTAR (bloquear merge até)

Bloqueio Ted antes de shipar:

1. Spec da semântica do scrubber **por mode**. `post` é natural; `global`
   e `network` requerem decisão (esconder? converter pra time window
   filter?).
2. Extrair `useMapInstance` (Recomendação #2 top 3) ANTES. TimelineScrubber
   sobre o código atual é hack — vai duplicar RAF state externalizado
   em ambos modes.
3. Empty state quando `scrubValue` antes do primeiro arc (`p < min(t)`):
   mostrar "Aguardando primeira propagação…" em vez de map vazio
   confuso.

Se 1+2+3 forem endereçados, ✅ aprovo.

### WoT colors opt-in (D21) — ✅ APROVADO (com 1 polish)

Funciona bem. Polish: hint chip "calculando lente…" quando
`lens_show_in_map=ON` mas `pprScores.size === 0`. Educa user, evita
confusão "toggle não fez nada".

### Network mode nodes+clusters (E) — ✅ APROVADO

Bem integrado, test conformance robusto, perf OK em N=2000.

---

## 7. Decisão arquitetural — vale extrair `<MapView>` primitive AGORA?

**NÃO.**

**Critério §5 design-system**: "≥2 callsites com ≥10 LoC duplicadas".

**Realidade**:
- Callsites de map fora de SpreadMap: **0**.
- Callsites de MapShell dentro de SpreadMap: 3 (PostModeMap +
  GlobalModeMap × 2 modes). Mas todos passam por `MapShell` interno
  que **já cumpre o papel de primitive**.

**Extrair `<MapView>` pra `src/components/UI/MapView.tsx`** seria
criar primitive N=1. Antipattern documentado no design-system: "padrão
emerge de N>2 usos".

**Quando reconsiderar:**
- Fase 6 traz Map em Profile (spread density per-user) — vira N=2
- Fase 6+ traz Map em Trending tab — vira N=3
- Esse é o gatilho. Não antes.

**Recomendação intermediária**: registrar `MapShell` (internal primitive)
no design-system.md §5 como linha de tabela com nota "scope:
SpreadMap-only". Discoverable, mas honesto sobre scope.

```
| `MapShell` | `Feed/SpreadMap.tsx` | — | 2026-05-21 | Internal — wrapper map + toggle + stats (scope: SpreadMap) |
```

---

## 8. Convergência / divergência com Satoshi

Sem ler o relatório paralelo do Satoshi (em vôo), faço previsão baseada
em audits anteriores e no escopo dele:

### Convergência esperada (overlap mas ângulos diferentes)

1. **K=1 doxx** (Satoshi devsec C 2026-05-21):
   - Satoshi: privacy/game theory — adversário usa community knowledge
     pra deanonimizar.
   - Ted (eu): UX/arquitetura — overlay implementado, but `isUserSoloSpreader`
     sem test direto (manifesto §7 risk).
   - **Sintetizar**: K=1 phase 2 (K-anonymity engine) é trabalho conjunto;
     priorize `tests/k1-detection.test.ts` antes de phase 2 work.

2. **CARTO tile IP leak** (Marshall NEEDS-FIX B 2026-05-17):
   - Satoshi: privacy — CARTO loga IP per tile fetch.
   - Ted: sovereignty pref `map_tile_url_template` já shipada; OPS doc
     em §28 OK.
   - **Convergente**: aceitar status quo (opt-out via custom template);
     monitorar adoption.

3. **TimelineScrubber semantics**:
   - Satoshi: provavelmente vai questionar se scrubber expõe metadados
     temporais não-óbvios (ex: revelar quando user esteve online).
   - Ted: questionei semantics por mode.
   - **Sintetizar**: scrubber só em `post` mode (já é minha proposta);
     Satoshi reforça que `global`/`network` scrubber poderia inferir
     timezone do user via padrão de quando ele scruba.

### Divergência esperada

1. **Autoplay da animação RAF**:
   - Satoshi provável: opt-out por bateria/CPU; default OFF.
   - Ted: identidade editorial do Drift (Lily 2026-05-18 HIMYM) requer
     animação como signal de "rede viva".
   - **Resolução proposta**: respeitar `prefers-reduced-motion` (já é
     parcialmente; verificar GlobalModeMap), default ON, opt-out
     explícito em settings "energia". Manifesto §28 não exige opt-out
     de animação — é UX call.

2. **`pickable: true` em social-nodes**:
   - Satoshi pode questionar se hover/tap em nó vaza npub via DOM
     inspection.
   - Ted: já é público em kind 9079 (não vaza dado novo). Tooltip
     futuro seria visual surface do que já é observável on-chain.
   - **Decisão**: mantém pickable, sem mudança.

---

## 9. Encerramento

O sistema de maps do Drift está em **estado saudável arquiteturalmente
mas no limiar de fadiga estrutural**. 794 LoC num arquivo, 3 modes
não-uniformes, e 1 feature em vôo (TimelineScrubber) que vai forçar a
mão. Recomendo 3 ações em ordem:

1. **Split em 3 arquivos** (2h, zero risk) — pré-requisito visual.
2. **Extrair `useMapInstance`** (3h, médio risk) — pré-requisito
   TimelineScrubber.
3. **Camera state persistence** (4h, baixo risk) — UX win independente.

Total: ~9h de trabalho técnico fragmentável. Não precisa ser hoje —
mas precisa antes do TimelineScrubber merge.

Sobre primitive `MapView`: **não AGORA**. Quando N≥2 callsites fora
de SpreadMap aparecerem (Fase 6).

Sobre features em vôo:
- MapExplainerCard: ✅
- TimelineScrubber: ⚠️ ajustar (3 bloqueios)
- WoT colors: ✅
- Network nodes: ✅

Convergência com Satoshi esperada em K=1 phase 2, CARTO IP leak (já
mitigado), e TimelineScrubber semantics. Divergência em autoplay
(mantém) e pickable nodes (mantém).

Manifesto §7, §22, §24, §28 intocados em tudo proposto.

---

*— Ted Mosby, 2026-05-21*

*Padrão emerge de N>2 usos. Primitive precoce é dívida disfarçada
de elegância. Mas split de arquivo é só higiene — faça mesmo a 1.*
