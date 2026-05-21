# Ted — Card Queue Architecture: Tinder → Drift

**Dispatched:** 2026-05-20 (sessão late-shift, pair-review pós-pool)
**Persona:** Ted (arquitetura, padrões, camadas, abstrações)
**Tipo:** Research / Dispatch
**Trigger:** "Em paralelo, peça para o Ted estudar como o Tinder
gerencia as filas deles"

---

## Contexto

Drift renderiza posts como **card stack tipo Tinder** — user vê 1 post
por vez via `PostViewer embedded` em `App.tsx`, com:
- ↑ DRIFT espalha + avança
- ↓ SINK enterra + avança
- ←/→ navega subposts
- Shadow stack (Tinder-style cards atrás)
- `EndOfFeed` sentinel quando passa do último

Hoje a "queue" do feed local vive em Zustand store + cursor por tab
(Global/Seguindo/Trending) em `useFeedStore`. Refresh via
`invalidateFeed()` (debounced 150ms) disparado por `onNostrEvent`.

---

## Takeaways arquiteturais aplicáveis

### 1. Threshold de refill em N/2, não em 0

Tinder mantém deck de ~N cards no client; quando swipes consomem até
N/2, client dispara fetch atômico do próximo batch
([LinkedIn / Lamonaca](https://www.linkedin.com/pulse/technical-interview-question-implement-tinder-like-nicola-lamonaca)).

**Razão:** hide latency — usuário nunca vê spinner se batch chega
antes do deck zerar.

**Drift aplicação:** `useFeedStore` deveria expor cursor + trigger
`ensureQueueDepth(N/2)` que chama `getGlobalFeed(offset=cursor,
limit=N)` quando `queue.length - cursorIdx < N/2`. Hoje provavelmente
carrega tudo upfront ou recarrega no `EndOfFeed`.

### 2. `validUntil` server-stamped + `timeLastUpdated` client-side controlam cold start

Batch vem com TTL; relaunch dentro de `k` minutos reusa cache, senão
refetch ([Lamonaca](https://www.linkedin.com/pulse/technical-interview-question-implement-tinder-like-nicola-lamonaca),
[Tinder API gist](https://gist.github.com/rtt/10403467) confirma
`recs_size` + `timeout` globals tipo `{'timeout': 1800000}` = 30min).

**Drift aplicação:** scoring é determinístico mas decay temporal muda
— adicionar `feed_snapshot_ts` na store; se `now - ts > 30min`,
invalidar e re-query SQLite (rescoring naturalmente acontece via
`scheduleScoreRecalc`).

### 3. Batch atômico, não streaming de cards individuais

Tinder serializa N suggestions num único JSON response
([Lamonaca](https://www.linkedin.com/pulse/technical-interview-question-implement-tinder-like-nicola-lamonaca)).
Evita out-of-order render: client confia na ordem do payload.

**Drift aplicação:** `invalidateFeed()` já é debounced 150ms — bom.
Mas o **render order** deve ser fixed snapshot do momento em que tab
foi aberta; novos eventos via `onNostrEvent` populam SQLite mas NÃO
reordenam o deck em flight (só refletem no próximo `ensureQueueDepth`).
Isso preserva determinismo de UX (card que vi atrás não pula pra frente).

### 4. Histórico ("Rewind") é estrutura separada, RAM-only por sessão

Rewind do Tinder Plus mantém só último(s) swipe(s)
([systemdesignhandbook](https://www.systemdesignhandbook.com/guides/design-tinder/)).
Não persiste batch consumido.

**Drift aplicação:** se um dia quisermos undo de bury/spread, manter
`recentlySwiped: PostId[]` (cap 10) na store, **não** em SQLite —
manifesto §28 (sem telemetria) + simplicidade. Cuidado: bury/spread
são eventos públicos kind 9080/9079 — rewind seria undo PRE-publish
only (intercepta antes de assinar).

### 5. Cold start usa geo-shard pré-indexado (S2)

[techaheadcorp](https://www.techaheadcorp.com/blog/understanding-system-design-architecture-of-tinder/).
Drift cold start = pull dos últimos 200 events dos relays + render por
score. Já temos isso via `startSync` + `getGlobalFeed`.

**Lição:** cold start não precisa esperar score "definitivo"; render
parcial enquanto preenche.

---

## Anti-patterns a evitar

### A. Server-driven personalization mid-deck

Tinder reorder cards baseado em swipes em flight (sinaliza preferência,
ML re-ranks) ([appscrip](https://appscrip.com/blog/secrets-of-the-latest-tinder-algorithm-2024/)).

Drift NÃO pode — manifesto §24 (sem afinidade) + §28 (zero telemetria).
Já está protegido pela arquitetura client-only, mas vigilância na
revisão de PRs.

### B. Memory unbounded

Tinder não documenta cap explícito; relatos de OOM em low-end Android
([recs timeout issues no GitHub](https://github.com/fbessez/Tinder/issues/76)).

Drift tem SQLite WASM no worker + queue no Zustand — fácil acumular
milhares se eviction não rodar. `evictOldPosts` (cache.ts) já cobre
SQLite; **falta cap na queue Zustand** (sugiro 50 cards forward + 10
recently-swiped).

### C. Timeout opaco no client

Tinder retorna `{'timeout': 1800000}` sem UI explicando por que deck
travou — frustração documentada.

Drift deveria expor `feedSnapshotAge` na UI quando >30min ("Atualizado
há 45min — puxar pra refresh").

---

## Decisão Ted final

### Portar

- **Threshold `N/2` refill com cursor explícito** na `useFeedStore`
  (substituir lógica atual de "carrega tudo, mostra EndOfFeed"). Tamanho
  sugerido: N=30, refill em 15.
- **Snapshot timestamp + invalidação suave em 30min** (alinha com decay
  PPR Trust Lens já implementado).
- **Cap explícito de queue em RAM** (50 forward + 10 rewind buffer) —
  defende mobile low-end, condiz com §28.

### Manter como está

- **Determinismo de ordem** (snapshot at-time-of-tab-open). Trust Lens
  já isola personalização no view-boundary — não invadir o queue order.
- **`invalidateFeed()` debounced 150ms** — debounce de Tinder na
  prática é maior, mas Drift tem dataset menor.
- **SQLite como source of truth** (Tinder usa MongoDB server-side;
  nossa equivalência é `posts` table).

### NÃO copiar

- **Reorder baseado em swipes em flight** (viola §24).
- **Persistir histórico de swipes ("rewind ilimitado" como feature paga)**
  — Drift bury/spread são eventos públicos kind 9080/9079, rewind =
  unpublish que não existe no Nostr. Manter rewind, se vier, como
  undo PRE-publish only.
- **Globals server-pushed tipo `recs_size`** — Drift é client-side;
  constants em `config/constants.ts`.

---

## Próximo passo concreto

Issue no `BACKLOG.md`: **"Refactor `useFeedStore` para cursor +
threshold N/2 refill"** com este doc como ref. Sem urgência —
implementar quando perfil real mostrar fricção ou quando feed
crescer >100 posts típicos.

---

## Sources

- [Tinder System Design Interview (Lamonaca, LinkedIn)](https://www.linkedin.com/pulse/technical-interview-question-implement-tinder-like-nicola-lamonaca)
- [Tinder API Documentation gist (rtt)](https://gist.github.com/rtt/10403467)
- [Tinder Architecture (Neo Kim, systemdesign.one)](https://newsletter.systemdesign.one/p/tinder-architecture)
- [Design Tinder (systemdesignhandbook)](https://www.systemdesignhandbook.com/guides/design-tinder/)
- [Tinder Algorithm 2025 (appscrip)](https://appscrip.com/blog/secrets-of-the-latest-tinder-algorithm-2024/)
- [System Architecture of Tinder (techaheadcorp)](https://www.techaheadcorp.com/blog/understanding-system-design-architecture-of-tinder/)
- [Tinder recs timeout (fbessez/Tinder #76)](https://github.com/fbessez/Tinder/issues/76)

---

*Registrado por Ted persona dispatch 2026-05-20. Resultado feed pro
`BACKLOG.md` (item: "Refactor useFeedStore cursor + N/2 refill"). Não
shipado nesta sessão — defer pra quando fricção real surgir OU sprint
dedicada de performance.*
