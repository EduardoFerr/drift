# WebRTC Transport — Architecture Audit (Barney)

**Data:** 2026-05-08
**Escopo:** `src/lib/transport/webrtc/` (12 arquivos, ~58 KB)
**Revisor:** persona Barney (peer review crítico, threat modeling)
**Método:** leitura linha-a-linha + cross-ref com manifesto §15/§16/§20 + CLAUDE.md
**Veredito (TL;DR):** **sane and ship-able, with focused refactor before Fase 7.** Não é rewrite. A separação 12-arquivos é razoável e a maioria dos invariantes do manifesto está honrada — mas há 3 bugs concretos, ~5 smells estruturais e poluição de surface area de tests que vale endereçar antes do código virar legacy intocável.

---

## §1 — Mapa atual

12 arquivos formando uma camada bem-comportada *no formato* (state encapsulado em `state.ts` via API tipada, magic numbers em `config.ts`, lifecycle em `peer.ts`, dataflow em `pipeline.ts`), mas com **ciclos resolvidos por dynamic `await import()`** em três pontos sensíveis (peer→pipeline, reconnect→discovery, discovery→boot) — uma cicatriz arquitetural do split do `webrtc.ts` 1190-LOC original. Boot orquestra via promise singleton (`signalingBootPromise`) e dispara 2 timers globais (`startHealthCheckTimer`, `startRandomWalkTimer`). State machine de peer (`PeerStatus` 6-estado) está espalhada por 5 arquivos sem guards explícitos — qualquer escritor pode setar qualquer status.

```
                       ┌──────────────────┐
                       │   index.ts       │  Transport API + barrel
                       │  (publish/sub/   │  + ~10 _test exports
                       │   health)        │
                       └─────────┬────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
          ┌─────────┐      ┌─────────┐      ┌─────────┐
          │ boot.ts │ ───▶ │ peer.ts │ ◀──▶ │pipeline │  (lazy import)
          │ async   │      │  PC     │      │  inbound│
          │singletn │      │lifecycle│      └────┬────┘
          └────┬────┘      └────┬────┘           │
               │                │                │
       ┌───────┼───────┐        │           ┌────▼─────┐
       ▼       ▼       ▼        │           │rateLimit │── cleanup ──┐
   discovery health  reconn ── lazy ──▶ discovery       │ (peer.ts)  │
       │       │       │                                │            │
       └───────┴───────┴──────────────┐                 └────────────┘
                                      ▼
                              ┌──────────────┐
                              │  state.ts    │  Maps singleton
                              │  (single     │  + signaling singletons
                              │   source)    │
                              └──────────────┘
                                      ▲
                              ┌───────┴──────┐
                              │ config.ts    │  ALL constants
                              │ types.ts     │  PeerState shape
                              └──────────────┘

Acoplamentos circulares quebrados via lazy:
  peer.ts:175  await import('./pipeline')   (DC onmessage handler)
  reconnect:84 await import('./discovery')  (timer callback)
  discovery:45 await import('./boot')       (useNostrSignaling check)
  index.ts:99  void ensureSignalingAsync()  (subscribe fire-and-forget)
```

Outros entry points externos: `bootstrap.ts`, `seeder.ts`, `main.tsx`, 4 specs Vitest.

---

## §2 — Achados

Contagem por categoria: **3 bugs/race (P0)**, **5 smells estruturais (P1)**, **6 cleanup/manutenibilidade (P2)**, **2 itens "bem feito"**.

### 2.1 Bugs / race conditions / state inconsistente (P0)

**B1. `disconnected` reconnect sem cancellation token — leak de timers**
`peer.ts:117-124`
```ts
if (s === 'disconnected' && useNostrSignaling()) {
  setTimeout(() => {
    if (peer.status === 'open') return
    if (!hasPeer(peer.id)) return
    _scheduleReconnect(peer.id)
  }, 5_000)
}
```
O `setTimeout` de 5s não tem handle armazenado. Se peer oscila connected↔disconnected várias vezes em 5s (Wi-Fi flakey, exatamente o cenário que motivou o grace period), cada transição `disconnected` empilha um `setTimeout` independente. Os guards (`status === 'open'`, `hasPeer`) ajudam, mas não cobrem o caso de N timers chamando `_scheduleReconnect` em sequência rápida — o próprio `_scheduleReconnect` cancela timer anterior (`reconnect.ts:71`), mas só *do mesmo peer*. O contador de attempts (`reconnectAttempts.get(peerId)`) avança N vezes em vez de 1, atinge cap=5 prematuramente e o peer é marcado giveup. **Fix:** gravar o handle em `peer.disconnectGraceTimer`, cancelar em `cleanupPeer` e em qualquer transição out-of-disconnected.

**B2. `_scheduleReconnect` chama `connectTo` mesmo quando peer já reconectou**
`reconnect.ts:74-89` + `peer.ts:108`
Após `failed`, `_scheduleReconnect` é disparado. O timer roda em ~1s/2s/4s. Não há check se o peer voltou a estar `open` no meio-tempo (cenário plausível: outro caller chamou `connectTo` para o mesmo npub, ou o random walk já reabriu). `connectTo` → `getOrCreatePeer` *é* idempotente e retorna o existing, mas vai chamar `initiateOffer` num peer já `open` se `shouldInitiateOffer()===true`, criando um datachannel duplicado dentro da mesma `RTCPeerConnection`. **Fix:** no callback do timer, antes do `connectTo`, checar `getPeer(peerId)?.status === 'open'` e abortar.

**B3. ICE timeout de 30s não cobre peer recriado no mesmo ID**
`peer.ts:133-141`
```ts
setTimeout(() => {
  const current = getPeer(remoteId)
  if (!current || current !== peer) return  // OK: peer foi substituído
  if (peer.status === 'connecting') { ... cleanup }
}, ICE_CONNECT_TIMEOUT_MS)
```
O guard `current !== peer` está correto. **Mas** o timer em si não é cancelado em `cleanupPeer` — fica preso por 30s segurando referência ao `PeerState` antigo (incluindo `RTCPeerConnection` já fechada e `outboundQueue`). Em sessão longa com churn de peers (random walk a cada 30min com targets que falham ICE), acumula 8×30s = 240s de timers vivos. Não é leak permanente, mas é GC pressure desnecessária. **Fix:** armazenar `peer.iceConnectTimer` e cancelar em `cleanupPeer`.

### 2.2 Smells arquiteturais (P1)

**S1. `PeerStatus` state machine sem guard — quem-pode-virar-quem é regra implícita**
6 estados (`connecting | open | degraded | closing | closed | failed`), mutações em **5 arquivos** (peer/pipeline/rateLimit/index/health), sem função `transitionPeer(peer, next)` que valide. Exemplos perigosos:
- `index.ts:139` muta `peer.status = 'degraded'` direto dentro de `health()` (Transport API, não deveria mexer state — deveria ser side-effect do health timer ou do pong handler).
- `pipeline.ts:93` seta `failed` antes de `cleanupPeer` que vai setar `closing` → `closed` (`peer.ts:279,291`). Sequência observável é `failed` → `closing` → `closed`, contradiz `peer.status='failed'` literal nas linhas 99/180/184/242.
- `rateLimit.ts:82` mesmo padrão.

Não há transição `closed → open` impossível por construção. Tudo confia em "ninguém vai escrever bobagem". **Fix sugerido:** função única `setPeerStatus(peer, next)` em `state.ts` com matriz de transições válidas + log estruturado.

**S2. `boot.ts` é overloaded — orquestração + dispatch + lifecycle + peerId resolution**
`boot.ts` faz: (a) `useNostrSignaling()` flag check, (b) `myPeerId()` resolution com 3-fallback, (c) `ensureSignalingAsync` boot promise, (d) `handleSignalingMessage` dispatcher (5 cases), (e) `registerPagehideOnce`, (f) `closeAll` cross-facet teardown. Devia ser ≥2 arquivos (`signalingDispatcher.ts` separado de `lifecycle.ts`), e `myPeerId()` provavelmente devia morar em `state.ts` junto do `myPeerIdValue`.

**S3. Lazy dynamic imports como cicatriz de circular**
3 lazy imports (`peer→pipeline`, `reconnect→discovery`, `discovery→boot`) são patches arquiteturais, não escolhas. Cada `await import()` em hot path (`dc.onmessage` em peer.ts:175 dispara em **cada mensagem inbound**) tem custo: o módulo já está em cache após o primeiro hit, mas a microtask + Promise wrapping é gratuita só em release build de browsers modernos. Mais relevante: torna o data flow ilegível pra newcomers. **Fix estrutural:** introduzir um `peerEvents.ts` que emite eventos (`'message'`, `'reconnect-needed'`) via `EventTarget`/mitt, e que peer/pipeline/discovery/reconnect *consomem* sem se importarem diretamente. Quebra ciclos sem dynamic import.

**S4. `pipeline.ts` mistura defesas (rate, ping fast-path, schema, kind, sig, dedup) sem ordering test**
Pipeline cheap→caro está *correto* (boa coisa, ver §2.5), mas as 6 etapas estão concatenadas in-line numa função de 90 linhas. Mover cada etapa pra função separada (`maybeHandlePingPong`, `maybeRateLimit`, `parseAndValidate`, `kindGuard`, `verifySig`, `deliverToSubs`) tornaria fácil de testar **a ordem** (atacante envia ping com prefix correto + payload bypass kind check?). Hoje, a ordem é uma escolha de comentário; a um typo do próximo refactor de quebrar invariante #5.

**S5. Health, rate limit, reconnect têm timers/maps independentes — não há "peer policy" unificada**
- `health.ts` tem `healthTimer` global + escreve `peer.lastPing*` direto em `PeerState`.
- `rateLimit.ts` tem `lastRateWarnAt` Map global + escreve `peer.rate*` direto em `PeerState`.
- `reconnect.ts` tem `reconnectAttempts` + `reconnectTimers` Maps globais.

Três módulos, três conjuntos de state, todos atrelados ao mesmo peer. `cleanupPeer` precisa lembrar de chamar `_resetReconnectCounter` (faz, `peer.ts:278`) mas **não** limpa `lastRateWarnAt.delete(peer.id)` (rateLimit.ts:87 só chama em kill, não em close normal — leak pequeno mas real). Unificar não como mega-classe, mas como `peerLifecycleHooks` que cada submódulo registra (`onCleanup(peer => { ... })`).

### 2.3 Threat surface

**T1. Cross-proto threshold = 50 é generoso e per-peer-counter nunca decai**
`config.ts:30`, `pipeline.ts:85`. Atacante manda 49 kinds não-Drift, espera 1h, manda mais 49 — nunca atinge threshold. Counter é monotônico (`= (n ?? 0) + 1`), sem janela deslizante. **Recomendado:** mesma estrutura `peer.rateViolations[]` que já existe em rateLimit, com janela 24h e cap baixo (e.g. 10 violações em 24h). Atualmente, atacante competente vai sempre ficar abaixo do threshold.

**T2. `_handlePong` valida pingTs ≥ lastPingSentAt-1000 mas não valida pingTs ≤ lastPingSentAt (idade)**
`health.ts:33-44`. O check `now - pingTs > HEALTH_PONG_MAX_AGE_MS` (5min) cobre replay antigo. **Mas** atacante pode mandar pong com `pingTs = now - 1` e fingir RTT≈0 (peer parece superhealthy → nunca degraded → nunca reconectado). Não há associação 1:1 entre ping enviado e pong aceito; qualquer pong com TS plausível é aceito. **Fix:** `health.ts` mantém `pendingPings: Map<peerId, Set<ts>>`; pong só é aceito se `ts ∈ pendingPings.get(peerId)`. Limpar pings >2× interval.

**T3. Rate limit refill usa `Date.now()` direto — relógio do cliente é unprotected input**
`rateLimit.ts:46`. Atacante (no próprio cliente, malware injetando JS) pode `Date.now = () => orig() + 1e9` pra reseatar o budget. Não é um vetor de ataque externo via DataChannel, mas é determinismo violado e a função puramente computável `consumeRateBudget(peer, now)` *recebe* `now` por parâmetro mas em prod o caller (`pipeline.ts:46`) sempre passa `Date.now()`. Limitação de ambiente, não bug, mas vale documentar como out-of-scope explícito do threat model.

**T4. Subscription onevent handler executa em ordem `for (sub of iterSubscriptions())` — sub maliciosa pode bloquear**
`pipeline.ts:111-122`. `Promise.resolve(sub.handlers.onevent(event)).catch(...)` é fire-and-forget, mas se o handler é síncrono e lança/lentidão, ainda bloqueia a iteração. Como subscriptions vêm de **`sync.ts`** (caller confiável), não é um vetor externo — mas se Fase 7 expor subscribe a plugins, vira issue.

### 2.4 Manutenibilidade / cleanup (P2)

**M1. Surface de tests pollui o public API**: `index.ts:178-194` exporta 10 símbolos `_*` test-only do barrel. Funcional, mas dificulta auto-import IDE (poluição). Mover pra `webrtc/test-helpers.ts` (não barrel-exported) e atualizar imports nos 4 specs.

**M2. Comentários referenciam "Sprint 4", "Barney audit #N", "Lily peer review" — perfumaria histórica**: dezenas de menções (peer.ts:8/100/107/213/277, pipeline.ts:34, etc.). Útil até a próxima vez que alguém ler; depois é ruído. Mover pra commit messages / `Docs/archive/webrtc-6.x-changelog.md` e limpar inline.

**M3. `_simulateCrossProtoForTest` (peer.ts:334) duplica lógica de `pipeline.ts:80-100`**: a kill-by-cross-proto está implementada em **dois lugares** com comportamentos quase iguais (peer.ts é só kill+blacklist; pipeline.ts é também `crossProtoCount++`). Spec testa o helper, não a função real. **Fix:** extrair `recordCrossProtoViolation(peer)` em peer.ts, chamar de pipeline.ts e do test helper.

**M4. `getPeers()` (discovery.ts:149) é apenas DEV mas exportado público no barrel** sem aviso. Comentário diz DEV; código não distingue.

**M5. `myPeerId()` 3-fallback (boot.ts:58-78) é defensive paranoia**: comentário admite que callers passam por await. Em teste, pode vir antes do boot — mas então o ID temporário é diferente do canônico e leva a peers de identidade dupla. Mais seguro: throw se called pre-boot em prod, fallback só em tests.

**M6. `closeAll` zera `signalingBootPromise = null` (boot.ts:232) mas não atomicamente em failure path** (boot.ts:131-135 também zera). Dois locais, mesma var module-scoped — funciona porque JS é single-thread, mas é a primeira coisa a quebrar com Worker.

### 2.5 Bem feito (registrar pra não perder)

- **State encapsulation em `state.ts`**: API tipada, nenhum sub-módulo toca o Map cru. Permitirá trocar pra Zustand store sem refactor cross-arquivo.
- **Pipeline cheap→caro respeita invariante #5 do CLAUDE.md** com comentários inline explicitando ordem.
- **Pagehide `closeAll` síncrono**: o comentário em boot.ts:194-200 documenta a regressão evitada (eager import de discovery em vez de dynamic import dentro de async). Decisão correta.
- **Glare collision (`peer.ts:206-244`) implementa perfect negotiation com tie-break lex** — pattern correto, com comentário de referência.
- **Rate limit token bucket é função pura testável** (`consumeRateBudget(peer, now)`). Bom.

---

## §3 — Ações priorizadas

### P0 (security/bug, antes de Fase 7 ou agora)

1. **B1**: armazenar handle do `setTimeout` 5s do disconnected grace e cancelar em transitions. ~10 linhas em `peer.ts` + campo em `PeerState`.
2. **B2**: guard `status === 'open'` no callback de `_scheduleReconnect` antes de `connectTo`. ~3 linhas em `reconnect.ts:84`.
3. **B3**: armazenar handle do ICE timeout em `peer.iceConnectTimer`, cancelar em `cleanupPeer`. ~5 linhas.
4. **T1**: trocar `crossProtoCount` monotônico por janela deslizante igual a `rateViolations[]`. ~15 linhas em `pipeline.ts` + dedup com peer.ts (M3).
5. **T2**: validação 1:1 ping↔pong via `pendingPings` set. ~20 linhas em `health.ts`.

### P1 (refactor estrutural, antes de Fase 7 escalar code)

6. **S1**: introduzir `setPeerStatus(peer, next)` em `state.ts` com matriz de transições + log estruturado. Migrar 8 call sites. ~50 linhas.
7. **S5**: registrar `onCleanup(peer)` hooks em vez de `cleanupPeer` lembrar de cada Map auxiliar. Pequeno EventTarget ou plain Set de callbacks. ~30 linhas + diff em peer/health/rateLimit/reconnect.
8. **S4**: extrair as 6 etapas de `pipeline.ts` em funções nomeadas + adicionar test "pipeline ordering invariant".
9. **M3**: deduplicar cross-proto kill — uma função canônica chamada do pipeline e do test helper.

### P2 (cleanup, oportunista)

10. **M1**: mover `_*` exports pra `test-helpers.ts`.
11. **M2**: limpar comentários históricos "Sprint N / Barney #X / Lily peer review", mover pra changelog.
12. **S2**: split `boot.ts` em `signalingDispatcher.ts` + `lifecycle.ts`.
13. **S3**: avaliar custo/benefício de `peerEvents.ts` event bus pra eliminar 3 lazy imports. **Opcional** — só compensa se for fazer S5 junto.
14. **M4**: marcar `getPeers()` como `__dev_getPeers` ou mover pra dev-only barrel.
15. **M5**: `myPeerId()` throw em prod se pre-boot, manter fallback só em test.
16. **M6**: encapsular `signalingBootPromise` numa lifecycle struct em `state.ts`.

**Total estimado:** P0 (5 itens) ~50 LOC, ½ dia. P1 (4 itens) ~150 LOC + tests, 2 dias. P2 (7 itens) ~3 dias incremental.

---

## §4 — Owner contínuo

**Recomendação: Lily (core code, runtime, manutenibilidade) com co-revisão de Marshall (schema, types, conformance) em mudanças de `PeerState` shape ou `pipeline.ts` ordering.**

Razão:
- **Não é "rewrite recommended"**: a estrutura 12-arquivos foi pensada e tem invariantes documentados (encapsulation, cheap→caro, lazy-import-justified). Reescrever do zero perderia esse aprendizado e os 4 specs Vitest atrelados a `_*` test exports.
- **Não é Ted (arquitetura)**: o trabalho remanescente é majoritariamente runtime/state-machine/threat-surface, não re-arquitetar camadas. Ted volta se S2+S3 forem feitos juntos (boot split + event bus = decisão arquitetural).
- **Não é Barney (segurança contínua)**: depois de fechar T1+T2, o threat model fica num ponto razoável. Próximo passo de segurança é Tor + Sybil dentro do `transport/` mais amplo (manifesto §15), fora do escopo deste módulo.
- **Lily/Marshall é o par certo**: bugs de timer/state machine/cleanup são manutenção contínua; mudanças em `PeerState` (B1, B3, T2) precisam tocar `_createPeerStateForTest` + 4 specs Vitest sem regressão — exatamente o tipo de conformance check que Marshall valida.

Se em 6 meses ninguém tocou e Fase 7 entrar, **reavaliar**: se ninguém entendeu, é candidato a rewrite com benefício de Tor + WebRTC unified (manifesto §15) numa policy layer só.

---

**Conclusão:** sane and ship-able, com refactor focado de ½–2 dias antes de Fase 7. Não rewrite.
