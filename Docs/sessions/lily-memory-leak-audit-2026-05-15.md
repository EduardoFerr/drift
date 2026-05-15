# Lily — auditoria estática de memory leaks (2026-05-15)

Escopo: `src/components/**`, `src/hooks/**`, `src/lib/**` (excluindo
`relay-*`, `transport/wss.ts`, `vite.config.ts`, `package.json`, docs
de decisões e tests/a11y — territórios alheios).

Método: grep + leitura case-by-case dos call sites de `useEffect`,
`addEventListener`, `setInterval`/`setTimeout`, `subscribe`,
`new Worker`, `new (Intersection|Mutation|Resize)Observer`, e
estruturas `Map`/`Set` em escopo de módulo.

Objetivo (PWA mobile): sessões longas não devem acumular handles
de timers, listeners, RTC peers, ou caches sem bound.

---

## 1. Findings

### 🚨 1.1 `UpdatePrompt` — `setInterval` sem `clearInterval`

**Arquivo**: `src/components/UI/UpdatePrompt.tsx:43`

**Antes**:
```ts
onRegisteredSW(swUrl, registration) {
  if (registration && swUrl) {
    setInterval(() => { void registration.update() }, 60 * 60 * 1000)
  }
}
```

**Problema**: o callback `onRegisteredSW` agendava um `setInterval` de
1h sem guardar o handle nem registrar cleanup. Em **StrictMode dev**
(React 18, `useRegisterSW` chama internamente o callback no mount,
StrictMode duplica mount), em **HMR de dev**, ou em qualquer ciclo
onde o componente desmonta/remonta, novos timers se acumulam.

Em produção `UpdatePrompt` é singleton montado pelo root da App e
nunca desmontado, então o leak é majoritariamente teórico. Mas:

1. Sessão de **dev/test** com HMR ativo pode acumular dezenas de
   timers em uma hora; eventualmente `registration.update()` rodaria
   N×/h.
2. Defesa-em-profundidade: futuras refatorações que tornem
   `UpdatePrompt` desmontável (route swap, lazy load) ficarão livres
   do leak.

**Fix**: timer agora vive num guard de módulo + `useRef`; cleanup
explícito no unmount via `useEffect`. Idempotência adicional: re-runs
do callback (StrictMode) checam o guard antes de criar novo timer.

**Status**: ✅ corrigido neste audit (commit acompanhante).

---

### 🟡 1.2 `useThreadStore.threads` (Map) cresce sem evicção por entry

**Arquivo**: `src/lib/comments.ts:183-209`

**Comportamento**: a cada `loadThread(postId)` ou `subscribeComments`,
um entry `Map<postId, ThreadEntry>` é populado. Entries **nunca são
removidos** — mesmo após o user fechar o ThreadView e a REQ
correspondente ser unsubscribed (refcount = 0).

**Bound**: cada entry tem `rows.length ≤ COMMENTS_LOAD_CAP`. Numero
total de entries cresce com posts visitados na sessão. Sessão "leitor
ativo" por 8h pode acumular várias centenas → memória residual em
ordens de poucos MB, mas detectável em mobile de baixa RAM.

**Recomendação (next sprint)**: LRU policy. Quando o número de
entries cruzar um cap (ex: 50 threads), remover o entry menos
recentemente acessado. Ponto natural pra hook: o `release()` de
`makeReleaseFn` já sabe quando o refcount zera — agendar uma
**purga após N segundos** (ex: 5min) de inatividade.

**Não fixado** porque: (a) bound em ordem MB, não OOM-risk imediato,
(b) muda lifecycle observável (`getThread` retornar undefined depois
de purga afeta UI), exige test coverage cuidadoso, (c) classificado
🟡 por instruction.

---

### 🟡 1.3 Recents ring buffer em `useSyncStore.recent`

**Arquivo**: `src/lib/sync.ts` (`pushRecent`, cap = RECENT_EVENTS_CAP)

Já é cap-bounded (`.slice(0, CAP)`). Sem leak. Documentado pra
referência.

---

### 🟡 1.4 `pendingRecalcs` Map em `events.ts:647`

**Arquivo**: `src/lib/events.ts`

```ts
const pendingRecalcs = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleScoreRecalc(postId: string): void {
  ...
  pendingRecalcs.set(postId, setTimeout(() => {
    pendingRecalcs.delete(postId)  // entries são removidas após fire
    ...
  }, SCORE_RECALC_DEBOUNCE_MS))
}
```

Cleanup intrínseco: cada entry se auto-remove ao disparar. Bound:
posts com spreads em flight (ordem de dezenas no pior caso). Sem leak.

---

### 🟡 1.5 `lastResults` Map em `probe.ts:44`

Bounded por número de relays ativos (~5-10). Sem leak.

---

### 🟡 1.6 `activeSubs` Map em `comments.ts:287`

Refcounted (`makeReleaseFn` decrementa, deleta ao chegar 0).
Cleanup correto.

---

## 2. Listeners verificados (todos OK)

Padrão consistente:
- `useEffect` → `addEventListener` → `return () => removeEventListener`.

Locais auditados:
- `src/App.tsx:1951` — keydown ESC handler de InstallPromptModal.
- `src/components/UI/Image.tsx:155` — keydown ESC do lightbox.
- `src/components/UI/FullPageCard.tsx:125` — keydown ESC.
- `src/components/UI/DialogHost.tsx:72` — keydown ESC/Enter.
- `src/components/Post/PostViewer.tsx:404` — keydown ESC.
- `src/components/Post/ThreadView.tsx:286` — keydown ESC/Enter.
- `src/components/Post/ReplySheet.tsx:399` — keydown ESC/⌘+Enter.
- `src/components/Post/SwipeHandler.tsx:493` — keydown setas.
- `src/hooks/useInstallPrompt.ts:90` — beforeinstallprompt + appinstalled.

Listeners de escopo global (sem cleanup explícito, mas intencionais):
- `src/lib/sync.ts:144,168` — pagehide/pageshow guard de bfcache.
  Setup uma vez por aba via `bfcacheGuardInstalled`. **Intencional**:
  vivem o ciclo de vida da aba. Sem leak (escopo correto).
- `src/lib/transport/webrtc/boot.ts:156` — pagehide de WebRTC.
  Idem.
- `src/lib/db.worker.ts:543` — unhandledrejection no Worker.
  Idem (escopo Worker).

---

## 3. Timers verificados (todos OK)

Componentes (cleanup correto em todos):
- `App.tsx:228` (banner GPS tick) — clearInterval no cleanup.
- `App.tsx:615,689` (safetyTimeout spread/bury) — clearTimeout em
  catch path. Path de sucesso deixa o timeout completar (intencional,
  guarda contra optimistic state perpétuo).
- `App.tsx:1546,1547` (refresh/status) — fire-and-forget curto
  (400ms/3.5s), sem cleanup. Aceitável: handles dormem brevemente.
- `Post/SwipeHandler.tsx:167` (hint) — clearTimeout via ref no cleanup.
- `Post/SwipeHandler.tsx:506` (RAF + hint cleanup) — ambos limpos.
- `Post/ThreadView.tsx:200` (coach mark dismiss) — clearTimeout no cleanup.
- `Post/PostViewer.tsx:187,1039` (longpress/hold) — handle via ref,
  cancelado em `cancelLongPress`/`cancelHold`.
- `Settings/SettingsCards.tsx:522` (helia stats refresh) — clearInterval.
- `Feed/SpreadMap.tsx:454` (animation pause) — clearTimeout no cleanup.
- `Feed/FeedTabs.tsx:50` — fire-and-forget curto, sem leak.

Timers globais (singletons intencionais por aba):
- `bootstrap.ts:431` evictionTimer — idempotente, escopo aba.
- `probe.ts:63` probeTimer — idempotente, com `stopProbe()` disponível.
- `sync.ts:235` flushTimer — cleared em `stopSync()` e bfcache pagehide.
- `helia.ts:91` idleWatcher — auto-stop em `stopIdleWatcher`.
- `transport/webrtc/health.ts:100` healthTimer — start/stop pairs.
- `transport/webrtc/discovery.ts:104` randomWalkTimer — start/stop pairs.
- `transport/webrtc/peer.ts:137,159` disconnectGrace/iceConnect —
  rastreados em `PeerState` e cancelados em `closePeer`.
- `transport/webrtc/reconnect.ts:74` — guardados em `reconnectTimers`
  Map por peerId, cleared em `cancelReconnect`.

---

## 4. Subscriptions / observers (todos OK)

- `pool.subscribeMany` direto: `sync.ts:349` (rebuild) — `sub.close()`
  no `finish()`. `probe.ts:161` — `sub.close()` em `finish()`.
  `follows.ts:110`, `nip65.ts:124` — auto-close ao receber EOSE +
  `setTimeout` fallback.
- `orchestrator.subscribe`: comments.ts:313 (refcounted), sync.ts:201
  (close em stopSync/bfcache).
- `webrtc-signaling-nostr.ts:115` — retorna `unsub`.
- Nenhum `IntersectionObserver`/`MutationObserver`/`ResizeObserver`
  encontrado.

---

## 5. Web Workers

- `src/lib/db.ts:63` — `new Worker(...)`. Singleton boot-time, vive a
  aba. Sem `terminate()`. **Intencional** — DB worker é stateful
  (OPFS handle) e descartá-lo perde a conexão pra todas as queries
  em flight. Sem leak.

---

## 6. AbortControllers

- `src/components/UI/Image.tsx:144` — `ctrl.abort()` no cleanup do
  useEffect. OK.
- `src/lib/blobs.ts:345`, `src/lib/upload.ts:310` — listener
  `'abort'` com `{ once: true }`, auto-remove. OK.

---

## 7. Resumo

| Severidade | Achados | Fix |
|---|---|---|
| 🚨 | 1 (UpdatePrompt setInterval) | ✅ corrigido |
| 🔴 | 0 | — |
| 🟡 | 1 (useThreadStore.threads sem LRU) + 4 observações sem leak | deixado pra next sprint |

PWA está em forma boa pra sessões longas. O único leak claro era o
do `UpdatePrompt`, baixo impacto em prod (singleton boot mount) mas
ruim em dev/HMR — agora idempotente + cleanup.

Próximo trabalho recomendado: LRU policy para `useThreadStore.threads`
quando user navegar por muitos posts numa sessão única.
