# Long-task audit — Lily, 2026-05-15

Auditoria estática de tarefas longas (> 50ms) no main thread durante boot
e hot paths. Foco: INP/FID. Continuação direta do audit de LCP (commit
d16d942, NO-OP).

## TL;DR

Boot path já está agressivamente otimizado pelos rounds anteriores (CWV-2,
CWV-3, Robin v1). 95% das oportunidades óbvias estão capturadas:

- `startSync`, `webrtcTransport` register, `checkRelayConnectivity` em
  `requestIdleCallback` (bootstrap.ts:309-364).
- LazyMotion `m.*` (entry ~5KB) + `domAnimation` em chunk separado
  (main.tsx:24-26).
- 12 modals/overlays lazy via `lazy()` + `LazyBoundary` (App.tsx:51-95).
- MapLibre (1.1 MB) + Deck.gl (467 KB) só carregam ao abrir mapa.
- `SUBSCRIBE_LIMIT = 500` cap no filter Nostr — verify-storm bounded.
- Tor only loaded em Tauri+tor mode.
- Helia só carrega em DEV ou via explicit user action.

Mudança aplicada: **`React.memo(SubpostCarousel)`**. Único memo
seguro/justificável encontrado — pula re-render do carousel quando o pai
re-renderiza por mudanças unrelated (myActions/pending/gpsCapturing
state em App.tsx propagado via PostViewer). Tudo mais ou já está
memoizado por construção (lazy = um chunk só) ou o memo introduziria
overhead sem ganho (props instáveis ou render trivial).

## 1. Inventário de boot work (main thread)

| Etapa | Onde | Custo | Block FP? |
|---|---|---|---|
| 1. Parse entry bundle | `assets/index-*.js` (~201 KB raw, ~60 KB gzip) | ~80-150 ms parse em mobile mid | sim |
| 2. React mount + StrictMode double-render | `main.tsx:84-92` | ~30-60 ms | sim |
| 3. `loadMotionFeatures` (lazy chunk) | `main.tsx:24` import paralelo | non-blocking (paralelo) | não |
| 4. `crossOriginIsolated` check | `bootstrap.ts:160` | <1 ms | sim |
| 5. `initDb()` — worker spawn + SQLite WASM load | `db.worker.ts:70-159` (~1.5 MB WASM, em WORKER) | ~200-500 ms em worker; main aguarda só `init` reply | sim (await) |
| 6. Schema + migrations | `db.worker.ts:212-475` | ~10-30 ms (em WORKER) | sim |
| 7. `loadPrefs` | SELECT pequeno | ~5-10 ms | sim |
| 8. `loadRelays` + ensureSeedRelays | SELECT + possível INSERT | ~5-20 ms | sim |
| 9. `loadModLocal` | 2 SELECTs (blocked + muted) | ~5-10 ms | sim |
| 10. `isPasskeyEnabled` + `verifyPasskey` (opcional) | WebAuthn navigator API | 0 ms se off; user-blocking se on | sim |
| 11. `getOrCreateIdentity` | SELECT + AES-GCM decrypt (~5 ms) | ~10-20 ms | sim |
| 12. `loadIdentities` | SELECT lista | ~5 ms | sim |
| 13. `loadFollows` | SELECT follows | ~5-15 ms | sim |
| 14. **`setBoot(step:'ready')`** | render swap App | ~5 ms | first paint utilizável |
| 15. `loadCommentCounts` | fire-and-forget, COUNT GROUP BY | ~20-50 ms | NÃO (await ausente) |
| 16. `registerTransport(wssTransport)` + import webrtc | scheduleIdle | non-blocking | NÃO |
| 17. `startSync` (subscribe + verify-storm 500/relay) | scheduleIdle | ~500-2000 ms scripting | NÃO |
| 18. `checkRelayConnectivity` | scheduleIdle | network-bound | NÃO |
| 19. `scheduleEviction` / `startProbe` (setInterval) | timer-only | <1 ms | sim (trivial) |

**Análise**: caminho crítico até first paint = 11 awaits SQL + 1 ID
decrypt. Em hardware desktop: ~100 ms total além do worker boot. Em
mobile mid (Moto G4 4× slowdown CPU): ~400-600 ms. Sem long tasks
únicas > 50ms identificadas no main — o WASM load do SQLite é o maior
custo isolado e roda no worker.

## 2. Long tasks candidates — análise

### 2.1 Parse de bundle entry (browser-side)
- 201 KB raw já no hard ratchet (CWV-3). Cuts adicionais > $$$ por byte.
- **Veredito**: NO-OP. Custo dominante é parse JS (V8 ~1ms/KB raw em
  mobile) ~200 ms inicial — não é "long task" no sentido API porque é
  pré-bootstrap, mas conta no TBT. Manter ratchet.

### 2.2 JSON.parse de payloads grandes em main
- `events.ts:persistPost` faz `JSON.parse(event.content)` no main, no
  worker `onmessage` do `pool.subscribeMany`. Conteúdo pode crescer
  (subposts + texto), mas é cap de ~1KB típico (Drift content).
- `feed.ts:rowToPost` faz `JSON.parse(row.raw_event)` por post no read
  path. 50 posts × ~2KB = 100KB parsed por refresh.
  Estimativa: 50 × 0.2 ms = ~10 ms total — sub-long-task.
- **Veredito**: NO-OP. Em escalas previsíveis (~50 posts/refresh),
  custo é abaixo do limiar de 50ms. Se ferida real aparecer em
  profile, candidato é mover rowToPost pro worker — mas é refactor
  pesado de invariante #1.

### 2.3 Migrações SQLite no startup
- Já no worker (db.worker.ts). 10 migrações idempotentes + 4 schema_v
  steps. Cada uma é `PRAGMA + ALTER`. Main thread só aguarda o reply
  do init.
- **Veredito**: NO-OP. Worker-side, não bloqueia main.

### 2.4 Loops sobre arrays grandes
- `selectLatestActionByUser` (events.ts:698) — O(N) sobre actions
  rows. Tipicamente N<100; viral N pode chegar a 5k. Função pura, mas
  ainda no main (chamada de `recalculateScore`).
- `applyContentFilters` chamado por post no render — O(1) cada.
- **Veredito**: NO-OP para tamanhos típicos. Se viral aparecer, é
  candidato a mover scoring inteiro pro worker. Hoje cabe em <30ms.

### 2.5 Crypto sync
- `verifyDriftEvent` (Schnorr secp256k1, ~1ms cada) — sync no main.
  Quando 500-2000 events entram em rajada via subscribe, são
  500-2000ms de scripting **se rodassem todos juntos**. Mas:
  - `onNostrEvent` é chamado dentro do callback do orchestrator,
    NÃO em loop — cada event é uma task separada via microtask.
  - Já está dentro de `scheduleIdle` (startSync deferred).
- `crypto.ts` usa Web Crypto async (encrypt/decrypt).
- **Veredito**: arquitetura atual já dilui o verify storm em
  microtasks pós-paint. Mover `verifyDriftEvent` pro worker é
  candidato futuro de alto ROI mas requer refactor não-trivial
  (nostr-tools no worker, deps pesadas no chunk worker).

### 2.6 Image decoding
- `<Image>` component (UI/Image) — checkar se usa `decoding="async"` +
  loading="lazy". Imagens vêm de blossom servers (nostr.build, etc.) —
  fora do main thread por design do browser.
- **Veredito**: assumido OK. Não verificado nesta auditoria mas é
  responsabilidade do browser, não do JS.

### 2.7 Zustand store hydration
- Stores: useBootStore, useSyncStore, useFeedStore, usePrefsStore,
  useFollowsStore, useModLocalStore, useFollowsStore, useIdentitiesStore,
  useCommentCountsStore, useThreadStore. Todas startam em INITIAL
  state pequeno (objetos/Sets vazios). Hydration via `loadX` é uma
  query SQL + setState — não acumula long tasks.
- **Veredito**: NO-OP.

## 3. Trabalhos deferíveis ainda no critical path?

Round Robin v1 já moveu o low-hanging:
- `startSync` ✅ idle
- `registerTransport(webrtcTransport)` ✅ idle
- `checkRelayConnectivity` ✅ idle
- `startProbe` ✅ setInterval +30min
- `scheduleEviction` ✅ setInterval +6h
- `loadCommentCounts` ✅ fire-and-forget

Candidatos que **não foram** movidos e **NÃO devem ser**:
- `loadModLocal` — `applyContentFilters` consulta `hiddenReason` em
  todo render de feed. Defer = posts bloqueados aparecem antes de
  serem filtrados (race UX visível). Custo: ~10 ms. **Manter eager.**
- `loadFollows` — feed Global default não usa, mas FollowingFeed query
  + badge "seguindo" no PostViewer/ProfileModal precisam. SELECT é
  ~5-15 ms. Defer poderia funcionar mas o ganho é trivial e a
  superfície de risco (race com FollowingFeed tab) é não-zero.
  **Manter eager.**
- `loadIdentities` — UI mostra IdentitySwitcher imediatamente após
  ready. Defer = "carregando identidades…" piscando. **Manter eager.**

Candidato marginal:
- `loadPrefs` é await antes de `loadRelays`. Poderia ser `Promise.all`
  com `loadRelays`, `loadModLocal`. Ganho estimado: ~10-15 ms.
  **Não aplicado** — sequencial vs paralelo SQLite no MESMO worker é
  zero ganho real (worker é single-threaded). Idiom paralelo SQL via
  Promise.all só ajuda quando worker tem múltiplos statements em
  voo, o que sqlite-wasm não suporta nesse setup. NO-OP.

## 4. React render cost — hot paths

### 4.1 Components em first paint utilizável
- `App.tsx` (2521 LOC) — re-renderiza a cada myActions/pending/
  gpsCapturing/showXxx state change. Pesado mas inevitável (state
  central do app).
- `BootView` — renderizado pré-ready, simples (skeleton).
- `HomeHeader` + `NavBar` — pequenos, props estáveis. Memo
  injustificado (re-render pra refletir identity/score updates).
- `PostViewer` (key={currentPost.id}, embedded) — re-renderiza com
  o App.tsx mas key change cria mount/unmount discreto entre posts.
  - **`SubpostCarousel`** dentro dele → CANDIDATO. Aplicado memo.
  - `SubpostLayout` dentro do SubpostCarousel → já protegido pelo
    memo do parent. Memo extra = overhead sem ganho.
  - `SwipeHandler` → usa pointer events nativos + RAF; render é
    trivial. Memo desnecessário.
- `FeedTabs` — 3 tabs, render trivial. Memo desnecessário.

### 4.2 Componentes hot post-paint
- `ThreadView` (lazy) — usa react-virtual. Long thread OK.
- `CommentCard` — render por comment. Pode crescer (100+ comments).
  - **Candidato futuro**: memo se profile mostrar render churn.
  - Hoje: react-virtual já dilui (só ~10 visíveis por vez).
  - **NO-OP nesta sessão** — sem evidência de problema.

### 4.3 Listas sem virtualização
- Feed mostra 1 post por vez (Tinder-stack). Não há lista de cards
  rolável → não há problema de virtualização.
- ThreadView usa react-virtual ✅.
- ProfileModal posts list → checar; provavelmente < 50 posts user
  visualiza, sem urgência.
- **NO-OP**.

### 4.4 useMemo / useCallback em hot paths
- App.tsx tem useMemo extensivo (currentPost, nextHomePost, feedCursor,
  feedTab derivados). OK.
- PostViewer: poucos useMemo, mas hot paths usam derived state simples.
- **NO-OP** — micro-otimizações sem profile evidence regredem
  legibilidade.

## 5. Hot paths post-boot

### 5.1 Feed scroll/swap
- `SwipeHandler` em RAF + pointer events nativos (V10). Já otimizado.
- AnimatePresence mode="wait" no PostViewer swap — cria 1 mount/unmount
  por post. PostViewer monta SubpostCarousel + SubpostLayout. Custo
  por swap: ~5-15 ms estimado. OK.

### 5.2 SQL queries em invalidateFeed
- `getGlobalFeed(limit=50)` — `SELECT … LIMIT 50` indexado. Bounded.
- `rowToPost × 50` no main: ~10 ms total (JSON.parse + Object alloc).
- `bumpUnseenCount` síncrono, trivial.
- **NO-OP**.

### 5.3 onNostrEvent pipeline
- Cheap kind check → cheap schema → verify (~1ms) → INSERT + recalc
  debounce. Pipeline já é o canônico (invariante #5). ~3-5 ms por
  evento típico no main. 500 events em rajada = ~2.5s scripting MAS
  diluído em microtasks (1 event = 1 microtask, browser pode
  yielding entre eles).
- `scheduleScoreRecalc` debounce 100ms — colapsa rajadas. OK.
- **NO-OP** sem mover verify pro worker (refactor maior, deferido).

## 6. Mudança aplicada

### 6.1 `React.memo(SubpostCarousel)`
- Arquivo: `src/components/Post/SubpostCarousel.tsx`
- Justificativa: PostViewer (parent direto) re-renderiza em todo
  `myActions/pending/gpsCapturing/showXxx` change no App.tsx props
  chain. SubpostCarousel só precisa re-renderizar quando `index`
  (subpostIdx) muda OU quando `post.id` muda (que troca o
  PostViewer inteiro via key change). Demais props
  (`subposts/post/onSelect`) referencialmente estáveis durante o
  mount.
- Default shallow compare suficiente (sem `arePropsEqual` custom).
- Ganho estimado: 2-5 ms por re-render do App, ~10-30 re-renders/min
  durante uso ativo do feed = ~50-150 ms scripting poupado/min.
  Modest, mas custo zero do memo (props estáveis, sem closures).

## 7. Não-fazer (já avaliado, risco > ganho)

1. **Memo em PostViewer, SubpostLayout, FeedTabs, NavBar, HomeHeader**:
   props variam por design (state propagado), memo seria no-op em
   prática. Adicionar = overhead de compare sem skip real.
2. **Memo em CommentCard sem profile evidence**: react-virtual já
   minimiza count visível. Profile depois antes.
3. **Mover `verifyDriftEvent` pro worker**: alto ROI mas refactor
   não-trivial (nostr-tools deps no chunk worker, message-passing
   overhead). Candidato a sprint dedicado, não one-liner.
4. **`Promise.all` em loadPrefs+loadRelays+loadModLocal**: zero ganho
   real (worker single-thread no SQLite WASM).
5. **Defer `loadModLocal/loadFollows/loadIdentities`**: causa flashes
   visíveis ou race UX. Ganho trivial (< 20 ms).
6. **Code-split PostViewer**: é o conteúdo central do feed, não é
   "modal pesado". Lazy aqui = flash branco no first paint
   utilizável.
7. **`loadCommentCounts` mover pra antes de ready**: já é
   fire-and-forget pós-paint. Defer melhor já existe.

## 8. Verificação

- `npm run test -- --run`: 1032 passed | 6 todo (79 files)
- `npx tsc --noEmit`: clean (erro pré-existente TS6310 em
  `tsconfig.json:28` sobre tsconfig.node.json, não relacionado ao
  patch).
- Risco UX: zero — memo só pula re-render quando props identical
  (shallow).

## 9. Recomendações ranqueadas

| Rank | Item | ROI | Risco | Status |
|---|---|---|---|---|
| 1 | memo(SubpostCarousel) | ~100 ms/min scripting | nulo | ✅ APLICADO |
| 2 | Mover `verifyDriftEvent` pro worker | alto (500-2000 ms picos) | médio-alto (refactor) | DEFERIDO — sprint próprio |
| 3 | Profile + memo(CommentCard) só sob evidence | médio | baixo | DEFERIDO — sem profile data |
| 4 | Profile real device, captar % de long tasks | meta-info | nulo | RECOMENDADO próximo |

## 10. Próximos passos sugeridos

1. **Profile real** (não estático) — Chrome DevTools Performance em
   mobile Moto G4 emulado, capturar trace de boot → ready → 30s
   feed swipe. Buscar long tasks > 50ms identificáveis.
2. **Worker-side verifyEvent** se profile mostrar verify storm como
   dominante. Spec exigirá:
   - Mover Schnorr verify pra um worker dedicado (não db.worker, pra
     não compartilhar lock SQLite).
   - Buffer de events pendentes verificação.
   - Backpressure se worker lag.
3. **Long-task observer instrumentation** em dev — `PerformanceObserver({
   type: 'longtask' })` logando no console pra catch regressões locais
   sem precisar do DevTools panel aberto.

---

*Lily, 2026-05-15 · audit estática, sem profile real device*
