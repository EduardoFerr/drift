# Lily — P2P/WebRTC idle cost audit (2026-05-23)

> **Persona:** Lily (core code / runtime / manutenibilidade)
> **Origem:** user observou em 2026-05-23 que "o P2P está aberto sem
> ser usado — pode-se otimizar? discovery". Backlog em `cf37148`.
> **Escopo desta sessão (Lily):** runtime dos 15 arquivos
> `src/lib/transport/webrtc/**` + `src/lib/probe.ts` +
> `src/lib/rebroadcast.ts` + chamadas em `bootstrap.ts` / `relays.ts`.
> **Doc-only.** Sem mexer em código.
>
> Marshall (schema/conformance) e Satoshi (privacy/game theory) cobrem
> em paralelo os ângulos respectivos. Onde aparece overlap, está
> sinalizado.

---

## TL;DR

**4 leaks/wastes REAIS encontrados, 5 quick wins fáceis, 1 refactor
estrutural.**

| # | Achado | Severidade | Fix (categoria) |
|:-:|---|:-:|---|
| L1 | `healthTimer` (15 s) roda mesmo quando NÃO há peers conectados — `dc.send` no for-loop fica vazio mas o setInterval é honesto | **MÉDIO** | Quick win: gate por `peerCount()>0` |
| L2 | Em modo **mock** (default dev, e default produção até flag `VITE_USE_NOSTR_SIGNALING=1` ser flipped), o **boot eager do signaling** ocorre na **primeira** `subscribe()` do orchestrator — `BroadcastChannel` é aberto, `pagehide` listener instalado, `randomWalkTimer` e `healthTimer` ligados — **e ficam até pagehide**, mesmo com `peerCount===0` o tempo todo (mock UUID per-tab descobre só outras abas same-origin, raríssimo) | **MÉDIO-ALTO** | Idle-state proposal (§4) |
| L3 | `lastRateWarnAt` Map em `rateLimit.ts:25` é **module-scoped** e cresce 1 entry por peer; `cleanupPeer` em `peer.ts` NÃO faz `delete(peer.id)` desse Map (só o caso de rate-trip o faz, linha 86) — pequeno leak monotônico se peer cycle alto sem trip | **BAIXO** | Quick win: `cleanupPeer` chama `lastRateWarnAt.delete` |
| L4 | `seenIds: Set<string>` por subscription (cap=1000) **nunca shrinka** quando subscription é descartada — mas `deleteSubscription` em `state.ts:68` chama `subscriptions.delete(id)` que libera o record inteiro pro GC, então o Set vai junto. **Não-leak**, mas vale documentar. | — | False-positive |

**5 quick wins** com efeito agregado significativo: §5.
**1 idle-state proposal** sem quebrar §15/§16: §4.
**1 refactor maior** ("transport activation hooks"): §6.

**False-positives importantes** (verificados, NÃO são leaks):

- (FP1) `RTCPeerConnection` leak após negotiation fail — `B3 iceConnectTimer` (peer.ts:159) cobre. ICE travado em firewall vira `failed` em 30s → `cleanupPeer` → `pc.close()`. Audit anterior já fechou esse buraco. **Refutado.**
- (FP2) DataChannel keepalive sem traffic alegadamente custoso — health ping é 1 string `__drift-ping__:<ts>` a cada 15s. Custo de banda ~80 B/s/peer; CPU desprezível. **Existe mas não é o "P2P aberto sem uso" do user.**
- (FP3) `followsDiscovery` sem teardown — gate em `getPrefs().p2p_auto_follows` (default `false`) em `discoverFollowsPeers` E `startFollowsDiscovery`. Se user nunca ativou, **nenhum timer cria, nada roda**. Bootstrap chama `startFollowsDiscovery()` mas a função retorna early. **Refutado** (mas ver L2 — o lazy import da árvore webrtc inteira ainda acontece).
- (FP4) Random walk loop 24/7 — em modo mock, `performRandomWalk` faz `if (!useNostrSignaling()) return` (discovery.ts:46). Timer roda a cada 30 min mas callback é no-op. Custo: 1 chamada `useNostrSignaling()` (lê env, retorna bool) a cada 30 min. **Inconclusivo** — não é leak; pode ser otimizado (não criar timer se modo mock).

---

## 1. Inventário lifecycle (por arquivo)

### `webrtc/boot.ts` (261 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `signalingBootPromise` (singleton) | `ensureSignalingAsync` | resetada em `closeAll` (L260) |
| `SignalingChannel` (BroadcastChannel ou Nostr DM sub) | `ensureSignalingAsync:124/111` | `closeAll` chama `ch.close()` (L254) |
| `signalingUnsub` | `setSignalingUnsub(ch.onMessage(handler))` (L117/126) | `closeAll` chama unsub (L246) |
| `pagehide` window listener | `registerPagehideOnce` (L149) | **NUNCA removido** — flag `pagehideRegistered` impede dupla adição. OK pra singleton per-tab. |
| Trigger `startRandomWalkTimer()` + `startHealthCheckTimer()` | L119-120 (nostr) / L128-129 (mock) | Stops disparados por `closeAll` (L232-235) |

**Custo idle:** apenas o canal aberto. BroadcastChannel é cheap (struct nativa, sem socket). Nostr signaling sub é um `wssTransport.subscribe` real consumindo banda enquanto vivo.

### `webrtc/discovery.ts` (159 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `randomWalkTimer` (`setInterval`, 30 min) | `startRandomWalkTimer` (L100-107) | `stopRandomWalkTimer` (L109-114) — chamado por `closeAll` |

**Gate dentro do callback:** `if (!useNostrSignaling()) return` no início de `performRandomWalk`. Em mock, timer existe mas não faz nada.

**Custo idle:** ~30 nanossegundos a cada 30 min (read de env var + early return). Negligenciável.

### `webrtc/peer.ts` (424 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `RTCPeerConnection` | `getOrCreatePeer:69` | `cleanupPeer:324` chama `pc.close()` |
| `RTCDataChannel` | `attachDataChannel` (recebido OU criado em `initiateOffer:219`) | `cleanupPeer:319` chama `dc.close()` |
| `iceConnectTimer` (30 s) | L159 | Cancelado em `cleanupPeer:314` ou auto-dispara fail+cleanup |
| `disconnectGraceTimer` (5 s) | L137 | Cancelado em qualquer transição out-of-disconnected ou `cleanupPeer:310` |
| Event handlers em `pc` e `dc` | inline lambdas | Liberados quando `pc`/`dc` são `.close()`d (referência morre) |

**Custo idle:** cada peer aberto custa o RTCPeerConnection (ICE keepalive ~5-10 KB/min) + datachannel + ping 15 s. Sem peers, custo zero.

### `webrtc/health.ts` (119 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `healthTimer` (`setInterval`, 15 s) | `startHealthCheckTimer` (L98-112) | `stopHealthCheckTimer` (L114-119) — chamado por `closeAll` |
| `peer.pendingPings[]` (cap 16) | `_markPing` em cada ping | Pruned em cada call por `markPing` util |

**Custo idle:** timer roda 4×/min mesmo com peerCount=0. Cada tick faz `iterPeers()` (vazio) → no-op send. **L1**: o for-loop nem chega no `dc.send`, mas o setInterval + função call + iter overhead existe. Comparativo a outros timers (helia idle, eviction 6 h), 15 s é caro.

### `webrtc/reconnect.ts` (109 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `reconnectAttempts: Map` | module-scoped | `_resetReconnectCounter` em sucesso/cleanup |
| `reconnectTimers: Map<peerId, Timer>` | `_scheduleReconnect:107` | Cancelado em `_resetReconnectCounter` ou no callback (L75) |

OK. Cleanup paths cobertos por `cleanupPeer` (peer.ts:306).

### `webrtc/followsDiscovery.ts` (96 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `followsTimer` (`setInterval`, 1 h) | `startFollowsDiscovery:74` | `stopFollowsDiscovery:79` |

**Gate duplo:** `getPrefs().p2p_auto_follows` em `startFollowsDiscovery:71` E em `discoverFollowsPeers:36`. Default `false`. Se user nunca ativou: **timer nunca é criado**. Confirmado em código.

**No entanto** — bootstrap.ts:400 chama `startFollowsDiscovery()`. Função entra, lê pref, retorna early. **Lazy import do barrel `./transport/webrtc` já aconteceu** (bootstrap.ts:397). Custo: árvore webrtc inteira no bundle JS (~17 KB raw / 5 KB gz, conforme bootstrap.ts:50). Ver L2.

### `webrtc/rateLimit.ts` (89 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `lastRateWarnAt: Map<peerId, number>` | module-scoped (L25) | `lastRateWarnAt.delete(peer.id)` SÓ no caso `tripped` (L86) |

**L3:** quando peer é limpo via outro caminho (ICE timeout, cross-proto kill, pagehide), o Map mantém entry pelo peer ID. Em sessão longa com churn de 1000 peers (random walk a cada 30 min), Map cresce sem bound. Cada entry é ~30 bytes. Em 1 ano de session contínua: ~17000 peers × 30 = 500 KB. Pequeno mas monotônico.

### `webrtc/state.ts` (131 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `peers: Map` | module-scoped | `deletePeer` em `cleanupPeer`; `_resetPeersForTest` em tests |
| `subscriptions: Map` | module-scoped | `deleteSubscription` em unsub callback; `clearSubscriptions` em `closeAll` |
| Singletons (signalingChannel, etc) | module-scoped lets | resetados em setters chamados por `closeAll` |

OK.

### `webrtc/pipeline.ts` (140 LOC)

Funções puras + handler async. Nenhum timer/listener próprio. Lazy import a partir de `peer.ts:202`. OK.

### `webrtc/ice.ts`, `webrtc/peerLink.ts`, `webrtc/bundle.ts`

Funções puras. Sem state runtime. **Nenhum risco de leak.**

### `webrtc/index.ts` (251 LOC)

Barrel + Transport API. `publish` e `subscribe` chamam `ensureSignalingAsync` (lazy, fire-and-forget). **L2:** `subscribe` é chamado pelo orchestrator no `startSync()`, então o WebRTC signaling boota **junto com o sync**, antes mesmo de qualquer interação P2P real.

### `probe.ts` (190 LOC)

| Recurso | Criado em | Cleanup |
|---|---|---|
| `probeTimer` (`setInterval`, 30 min) | `startProbe:63` | `stopProbe:70` (não chamado em pagehide hoje) |
| `lastResults: Map<relay, ProbeResult>` | module-scoped | Nunca limpa, mas cap natural = #relays ativos (~10) |
| Sub temporária em `probeRelay` | `pool.subscribeMany:161` | `sub.close()` em `finish` (L146) + setTimeout safety (L182) |

**Custo idle:** a cada 30 min, abre N subs (uma por relay) por 4 s, fecha. Pequeno. Probe primeira corrida é em +30 min após boot, **não imediato** — bom.

**Falta:** `pagehide` não dispara `stopProbe` (probe roda na main thread só, então quando aba fecha o timer morre. OK no browser; problema potencial em Tauri quando aba fica oculta mas o JS continua vivo).

### `rebroadcast.ts` (129 LOC)

Não tem timer. Fire-and-forget por `relays.ts:220` quando user adiciona relay novo. Guard `isNew` (relays.ts:219) garante idempotência: re-adicionar mesmo relay NÃO redispara. Custo limitado por `MAX_EVENTS_PER_RUN=200` e `REBROADCAST_TIMEOUT_MS=8000`. OK.

---

## 2. Mapa cross-cutting — timers ativos durante "uso normal"

Considere usuário em uma aba aberta no Drift, **sem** interagir, com `p2p_auto_follows=false` (default), em modo mock (default sem flag), Tauri OFF:

| Timer | Owner | Intervalo | Custo | Necessário se peerCount=0? |
|---|---|:-:|---|:-:|
| `evictionTimer` | bootstrap.ts:495 | 6 h | DB query | Sim (manutenção cache) |
| `probeTimer` | probe.ts:63 | 30 min | N×4s subs WSS | Sim (anti-eclipse) |
| `randomWalkTimer` | discovery.ts:104 | 30 min | no-op em mock | **NÃO** (early return) |
| `healthTimer` | health.ts:100 | 15 s | iter vazio + no-op | **NÃO** ← **L1** |
| `flushTimer` (sync.ts) | sync.ts:235 | (não auditado, fora do escopo) | — | — |
| `connectionCapTimer` (helia) | helia.ts:183 | 10 s | só se helia ativa | OK (helia tem idleWatcher) |
| `idleWatcher` (helia) | helia.ts:91 | 60 s | só se helia ativa | OK |

**Para 1 hora de uso idle:** healthTimer dispara 240 vezes (4×/min × 60). Cada tick é cheap (microssegundos), mas é **trabalho zero útil**. Em PWA mobile em background promovido, isso queima CPU/bateria.

---

## 3. Hipóteses do user — validação

### (a) Discovery loop 24/7

**Parcial / refutado em modo default.** `randomWalkTimer` existe, mas em modo mock (default) callback é no-op. Em modo Nostr (flag flip), é 30 min — não é "24/7", é meditativo. **Não é o problema percebido.**

Mas: **L2** — o boot eager do signaling channel em modo mock cria `randomWalkTimer` E `healthTimer` mesmo quando peer count nunca vai passar de 0 (mock só descobre outras abas same-origin, comportamento extremamente raro fora de dev).

### (b) RTCPeerConnection leak após negotiation fail

**Refutado.** `iceConnectTimer` 30 s mata peer zombie. `pc.close()` em todos os caminhos de cleanup. Auditoria 2026-05-08 (`Docs/sessions/webrtc-architecture-audit-2026-05-08.md` §B1/§B3) já endereçou. Código atual está limpo.

### (c) Follows discovery sub sem teardown

**Refutado** com nota. Default `p2p_auto_follows=false`, gate impede timer de ser criado. Mas o **lazy import da árvore inteira ainda acontece** (bootstrap.ts:397), trazendo ~17 KB de JS pro bundle execution mesmo que ninguém vá usar P2P. Não é leak de runtime, mas é **trabalho de parse/eval** desnecessário no boot. (Trade-off explícito do CWV-3 — assume que a maioria vai eventualmente ter modo clearnet ativo.)

### (d) DataChannel keepalive sem traffic

**Confirmado parcial.** Ping rola a cada 15 s — mas SÓ se `peer.status === 'open' && peer.dc.readyState === 'open'`. Se peerCount=0, o for-loop em healthTimer (L102) é vazio. **Não há trafego desperdiçado por peer, mas o setInterval continua disparando** (= L1).

---

## 4. Idle-state proposal

### Princípio

Introduzir **conceito explícito de "ativação"** no transport WebRTC:

- **Cold** (default): nenhum timer, signaling não bootado, lazy modules baixados mas não inicializados.
- **Warm** (peerCount=0, signaling bootado): sinaliza disponibilidade, mas timers de heartbeat pausados.
- **Hot** (peerCount>0): heartbeat ativo, random walk roda, todos os mecanismos engatados.

### Sem quebrar §15 (anti-censura por país)

§15 exige **capacidade técnica** de WebRTC P2P como bypass de bloqueio. Capacidade ≠ "sempre on". Idle-state mantém o módulo carregado e pronto pra ativar em < 100 ms. Critério: ativação automática quando:

1. User publica evento (writes → toda escrita garante caminho alternativo).
2. `wssTransport.health()` reporta degradação em ≥50% dos relays (sinal de bloqueio).
3. User abre o mapa (signal de interesse no PoI seeder).
4. User explicitamente ativa P2P em Settings.

Ou seja: **disponibilidade é preservada** porque ativação é reativa, não proativa.

### Sem quebrar §16 (disponibilidade distribuída)

§16 é sobre **outros** clientes poderem buscar conteúdo nosso. Isso é hoje provido por:

1. `rebroadcastToRelay` quando user adiciona relay (one-shot, mantém).
2. Posts próprios escritos nos relays user-config (preservado).
3. WebRTC P2P seeding (Fase 6 / 7).

WebRTC seeding **só vale algo se há peer conectado**. Manter heartbeat sem peer não contribui pra §16. Idle-state aqui é zero-impact em §16.

### Esboço de API (NÃO implementar nesta sessão — Lily doc-only)

```ts
// webrtc/state.ts — campo novo
type TransportMode = 'cold' | 'warm' | 'hot'
let currentMode: TransportMode = 'cold'
let lastActivityAt = 0
const IDLE_WARM_TIMEOUT_MS = 5 * 60_000   // após 5min sem peer → warm
const IDLE_COLD_TIMEOUT_MS = 30 * 60_000  // após 30min em warm → cold (close signaling)

// webrtc/boot.ts — ensureSignalingAsync vira ensureSignalingForMode
//   mode='hot' boota + starts timers (atual default).
//   mode='warm' boota signaling mas NÃO inicia healthTimer/randomWalkTimer.
//   mode='cold' é o estado fresh; primeira chamada de ensureSignaling(mode)
//   transitions cold→warm.

// webrtc/peer.ts — getOrCreatePeer escala pro modo hot quando peerCount>=1.
// webrtc/peer.ts — cleanupPeer dispara checagem: peerCount===0 → schedule warm em 5min.

// webrtc/health.ts — healthTimer só roda em mode==='hot'.

// integração com helia.ts — mesmo padrão. Lily nota interna: usar o mesmo
// idleWatcher pattern (60s tick checando lastActivity) ao invés de N timers.
```

### Risco

`B1` audit já cobriu o caso "transição rápida em redes flakey". A introdução de modo idle adiciona uma nova dimensão de estado. Testes Vitest precisam cobrir:

1. `cold → warm` ao primeiro `subscribe()`.
2. `warm → hot` ao primeiro peer real.
3. `hot → warm` 5 min após o último peer drop.
4. `warm → cold` 30 min após.
5. `cold → hot` direto (publish urgente, pula warm).

Sem isso, o estado fica leak-prone (timer pausado mas peer aparece, ninguém pinga, peer marcado degraded falsamente).

---

## 5. Top 5 quick wins (≤1 h cada, sem cascading)

### QW1 — Gate `healthTimer` por `peerCount() > 0`

**Onde:** `health.ts:98-112`.

**Mudança proposta:**
```ts
export function startHealthCheckTimer(): void {
  if (healthTimer) return
  healthTimer = setInterval(() => {
    if (peerCount() === 0) return  // ← early skip — não chama Date.now() nem itera
    const now = Date.now()
    for (const peer of iterPeers()) { ... }
  }, HEALTH_PING_INTERVAL_MS)
}
```

**Custo:** 1 linha. Sem mudança de schema/test. Reduz 4 ticks/min → 0 quando idle.

**Refinamento opcional:** parar o setInterval de vez quando peerCount cai pra 0 e re-startar quando getOrCreatePeer cria o primeiro. Mas exige hook → mais cirurgia. Versão simples acima já elimina 99% do custo.

### QW2 — Não criar `randomWalkTimer` em modo mock

**Onde:** `discovery.ts:100`.

**Mudança proposta:**
```ts
export function startRandomWalkTimer(): void {
  if (randomWalkTimer) return
  // discovery só faz sentido em modo Nostr — em mock, performRandomWalk
  // sempre retorna early; criar o timer é cargo cult.
  if (!useNostrSignaling()) return
  void performRandomWalk()
  randomWalkTimer = setInterval(() => { void performRandomWalk() }, RANDOM_WALK_INTERVAL_MS)
}
```

**Custo:** ~3 linhas. Boot de signaling em mock fica mais leve (1 timer a menos). Trade: se runtime trocar flag em hot reload (improvável), o timer não inicia — aceitável.

### QW3 — `cleanupPeer` deleta `lastRateWarnAt`

**Onde:** `peer.ts:298-331`.

**Mudança proposta:**
```ts
export function cleanupPeer(remoteId: string): void {
  const peer = getPeer(remoteId)
  if (!peer) return
  _resetReconnectCounter(remoteId)
  // ... timers cancel ...
  // Lily P1 audit 2026-05-23: rateLimit module-scoped Map mantinha entry
  // por peer que foi limpo via ICE timeout / cross-proto / pagehide
  // (não-trip). Pequeno mas monotônico em sessão longa com churn alto.
  import('./rateLimit').then(({ _cleanupRateState }) => _cleanupRateState(remoteId))
  // (ou expor função sync e call direto)
}
```

E em `rateLimit.ts` expor:
```ts
export function _cleanupRateState(peerId: string): void {
  lastRateWarnAt.delete(peerId)
}
```

**Custo:** ~5 linhas + 1 test trivial. Fecha L3.

### QW4 — `stopProbe` no `pagehide` listener

**Onde:** boot.ts:153 (registerPagehideOnce) ou bootstrap.ts.

**Mudança proposta:** adicionar `stopProbe()` no handler de pagehide pra Tauri (futuro). Hoje em PWA o setInterval morre com a aba — mas em Tauri webview escondido o timer continua. Custo: 1 import + 1 call. Defensivo.

### QW5 — Documentar que mock signaling boota em `subscribe()`

**Onde:** boot.ts top-comment + `Docs/known-limitations.md`.

**Mudança:** adicionar nota explícita que `webrtcTransport.subscribe()` chamado pelo orchestrator boota signaling **mesmo em modo mock** com peerCount=0 esperado pra sempre. Conscientização pré-implementação do idle-state (§4). Custo: comment. Não muda comportamento.

---

## 6. Top 3 refactors (sprint dedicada)

### R1 — Transport activation hooks (idle-state §4)

Implementação completa do esquema cold/warm/hot. Estimativa: 1-1.5 dia. Toca `boot.ts`, `state.ts`, `peer.ts`, `health.ts`, `discovery.ts`. ~150 LOC + tests Vitest cobrindo as 5 transições. **Pré-condição:** plano arquitetural (Ted) revisar + Barney threat model (modo cold vaza menos metadata em signaling, **bom** pra privacy).

### R2 — Unificar idle pattern com `helia.ts`

`helia.ts` tem `idleWatcher` (60s tick) + `lastAccessAt` timestamp. Padrão maduro, testado, OK. WebRTC pode adotar o **mesmo helper** ao invés de inventar próprio. Extrair `lib/idle-supervisor.ts` puro reutilizável. Estimativa: 0.5 dia (helper) + 0.5 dia (migração webrtc) + 0.5 dia (migração helia). Total ~1.5 dia. **Ganha:** consistência, testabilidade isolada, single source de truth pra idle policy.

### R3 — `stopBoot` cross-facet completo

`bootstrap.ts` tem `stopEviction` mas **não há `stopBoot` global** que pare TUDO (sync flush, probe, webrtc closeAll, helia dispose). Em hot-reload dev e testes, leaks surgem porque cada facet tem seu próprio stop. Refactor: criar `stopBoot()` que chama todos os stops em ordem segura. Estimativa: 0.5 dia + tests. **Não é leak production** (pagehide cobre), mas é debt de manutenibilidade.

---

## 7. Convergência esperada com Satoshi/Marshall

Pontos prováveis de overlap (esta sessão Lily, sem coordenação ativa):

### Com Satoshi (privacy/game-theory)

- **L2** (signaling bootado em mock sem necessidade) — Satoshi provavelmente reforça o ângulo: signaling Nostr mesmo quando ninguém vai conectar **gera metadata** (relay vê DM kind 1059 trocada, mesmo cifrada). Idle-state §4 ajuda **privacidade**, não só perf. Argumento dupla-valência.
- **Random walk** em modo Nostr — Satoshi pode questionar se 30 min é frequente demais (cada walk re-anuncia presença a `RANDOM_WALK_TARGET=8` peers, alimenta correlation). Lily nota: configurável via Settings provavelmente vem na onda.

### Com Marshall (schema/conformance)

- **Transition state `cold/warm/hot`** (§4) — Marshall vai querer schema explícito (`PeerStatus` em `types.ts` ganha contexto modal? Ou novo `TransportMode` type?). Documentar como conformance test target.
- **`pendingPings[]` cap 16** — pode coordenar com Marshall pra padronizar cap arrays per-peer (rate, cross-proto, ping todos têm caps diferentes — política única seria mais auditável).
- **QW3** (cleanup `lastRateWarnAt`) — Marshall provavelmente já bate na bola: "estado runtime que sobrevive `cleanupPeer` é bug semântico — invariante implícita do `cleanupPeer` é 'libera TUDO sobre esse peer'". Concordância esperada.

---

## Apêndice — pipeline de boot do WebRTC observado

Sequência cronológica que o user vê em uso normal (modo clearnet default):

```
1. bootstrap.ts:397   void import('./transport/webrtc')   ← lazy ~17 KB
2.                    .then(({ webrtcTransport, startFollowsDiscovery }))
3.                    registerTransport(webrtcTransport, { weight: 5 })
4.                    startFollowsDiscovery()             ← retorna early (pref OFF)
5. bootstrap.ts:411   void startSync()
6. sync.ts             chama orchestrator.subscribe(...)
7. orchestrator        chama webrtcTransport.subscribe(filter, handlers)
8. webrtc/index.ts:138 void ensureSignalingAsync()        ← AQUI: boot signaling
9. boot.ts:124         createMockSignalingChannel(myPeerId())  ← BroadcastChannel
10. boot.ts:128        startRandomWalkTimer()             ← timer criado, no-op em mock
11. boot.ts:129        startHealthCheckTimer()            ← ← ← L1 (15s, vazio)
12.                    pagehide listener instalado
13. boot.ts:131        ch.send({type:'hello',...})        ← anúncio inicial
```

Em modo mock + uso solo:
- Steps 8-13 acontecem **sempre**.
- Peers nunca conectam (UUID per-tab, ninguém pra descobrir).
- Health timer roda pra sempre. Random walk roda pra sempre.
- Custo: ~4 ticks/min de healthTimer (vazio), ~1 tick / 30 min de randomWalk (vazio), 1 BroadcastChannel aberto, 1 pagehide listener instalado. **Tudo zero útil até alguma aba paralela aparecer same-origin.**

**Esse é provavelmente o "P2P aberto sem ser usado" que o user notou.** Não é leak no sentido clássico (cleanup paths estão corretos), mas é **inicialização eager** de infraestrutura cujo runtime cost > 0 enquanto sua utilidade nesse modo padrão = ε.

---

## Status doc

- **Persona:** Lily.
- **Tipo:** AUDIT (doc-only).
- **Não toca código.**
- **Não fecha o backlog item** — depende de Marshall + Satoshi concluírem em paralelo + decisão do user sobre QW1-5 (low-cost) vs R1-3 (sprint dedicada).
- **Próximo passo sugerido:** user lê os 3 audits (Lily/Marshall/Satoshi), decide se quer QW pack ou idle-state full refactor. Lily voto: **QW1+QW2+QW3 em 1 PR pequeno (≤2 h) hoje, agendar R1 (idle-state) pra Sprint N+4** — quick wins têm alto retorno por hora, R1 é arquitetural e merece RFC de 1 pager.
