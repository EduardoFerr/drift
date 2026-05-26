# Marshall — P2P / WebRTC transport schema + conformance audit

**Data:** 2026-05-23
**Persona:** Marshall Eriksen (schema / types / conformance / regras formais)
**Origem:** User observou "P2P aberto sem usar — pode-se otimizar? discovery"
(2026-05-23). Sessão paralela: Lily (runtime), Satoshi (privacy + game
theory). Este doc cobre dimensão formal: invariantes de schema, type
safety, lifecycle e conformance via test.
**Refs:**
- `src/lib/transport/webrtc/**` (15 arquivos)
- `src/lib/transport/{signaling,index,orchestrator}.ts`
- `tests/webrtc*.test.ts` (10 specs)
- Manifesto v2.2 §12 / §15 / §16 / §20 / §28
- `Docs/sessions/webrtc-architecture-audit-2026-05-08.md` (Barney threat
  audit — referência histórica T1/T2/T3/T4 + B1/B2/B3)

---

## 1. TL;DR

À luz dos invariantes de schema:

- **4 invariantes formalmente expressos** (idempotência por id, glare
  tie-break determinístico, cap MAX_PEERS, ping/pong 1:1) — todos com
  LOCK_VIA_TEST anexado.
- **6 invariantes implícitos não expressos em tipo** (gaps de schema)
  — funcionam por convenção runtime, mas nada no sistema de tipos
  obriga callsites a respeitar.
- **0 ocorrências de `any`** em `webrtc/` (auditado por grep). 1
  type assertion (`{} as RTCPeerConnection`) — test-only, justificada
  e isolada em `_createPeerStateForTest`.
- **Lacuna central pro pedido do user:** o type `PeerStatus` não
  distingue *peer ativo com tráfego recente* de *peer warm-idle sem
  uso há horas*. Hoje, ambos são `'open'`. Sem essa distinção, o
  orchestrator não pode roteá-lo nem o discovery pode evitá-lo. O
  estado `open` é overloaded.

**Veredito formal:** schema atual é **suficiente pra correção**
(threat audit T1–T4 + B1–B3 fechados em LOCK_VIA_TEST), mas
**insuficiente pra otimização de utilização**. Pra responder a
"P2P aberto sem usar", precisa um campo de schema que represente
*intent de uso* — não basta runtime metric, precisa virar contrato
que callsites consomem (orchestrator, publish, getPeers UI).

Recomendação: introduzir `peer.lastTrafficAt: number | null` + função
pura `_isPeerWarm(peer, now): boolean`, e estender `PeerStatus` com
subtype derivado `ActivityMode = 'active' | 'idle' | 'unknown'`
(*derivado*, não persistido — pra evitar dupla-fonte). Detalhes §4.

---

## 2. Inventário da state machine atual

### 2.1 PeerStatus (5 estados + 1 inicial)

Em `webrtc/types.ts:15-22`:

```ts
export type PeerStatus =
  | 'connecting'  // peer criado, ICE/SDP em curso
  | 'open'        // dc.onopen disparou
  | 'degraded'    // RTT alto OU stale (sem pong recente)
  | 'closing'    // cleanupPeer em curso (transient)
  | 'closed'      // dc fechou normalmente OU connectionState='closed'
  | 'failed'      // ICE failed, crossProto kill, rate-limit kill, manual
```

**Transições efetivamente observáveis (válidas):**

```
                ┌──────────────┐
                │  connecting  │ ←─ getOrCreatePeer
                └──────┬───────┘
                       │ dc.onopen
                       ▼
                ┌──────────────┐                   ┌──────────┐
       ┌─────── │     open     │ ─────────────────▶│ degraded │
       │        └──────┬───────┘  _isPeerDegraded   └────┬─────┘
       │               │ failure                          │
       │               ▼                                  │
       │        ┌──────────────┐                          │
       └──────▶ │    failed    │ ◄────────────────────────┘
                └──────┬───────┘                          │
                       │ cleanupPeer                      │
                       ▼                                  │
                ┌──────────────┐                          │
                │   closing    │ ◄────────────────────────┘
                └──────┬───────┘
                       │ pc.close completes
                       ▼
                ┌──────────────┐
                │    closed    │ (terminal)
                └──────────────┘
```

**Transições potencialmente ambíguas (gaps):**

1. **`open → degraded → open` reversão** não tem callsite (`health.ts`
   só marca `→ degraded`; não há `degraded → open`). À luz do invariante
   "status é monotônico exceto pra `open ↔ degraded`", isto é gap:
   peer fica preso em `degraded` mesmo após RTT melhorar. Test
   `webrtc-health.test.ts` não cobre o caminho reverso.
2. **`failed/closed` é terminal mas pong fast-path checava `peer.status`
   antes do `consumeRateBudget`** — `pipeline.ts:52` adiciona guard
   ("Barney 🔴 #1") porque o tipo não exclui receber callback após
   transição. Schema poderia tipar `dc.onmessage` como
   "guaranteed-not-after-terminal" mas runtime do RTC não respeita —
   é defesa em profundidade, não defeito.
3. **`connecting → closed` direto** (sem passar por `failed`) ocorre
   em `pc.onconnectionstatechange === 'closed'` (peer.ts:125–127).
   Mas `connecting → failed` também ocorre via ICE timeout (peer.ts:166).
   *Quais são as transições válidas* não está documentado em tipo.

### 2.2 Singletons module-scope (state.ts)

```
peers          : Map<string, PeerState>
subscriptions  : Map<string, SubscriptionRecord>
signalingChannel : SignalingChannel | null
signalingUnsub   : SignalingUnsubscribe | null
myPeerIdValue    : string | null
pagehideRegistered : boolean
```

**Invariante formal:** "todo INSERT em `peers` Map passa por
`setPeer()`" — encapsulado, sem Map exposto. ✅ verificado em
state.ts:38, peer.ts:86 (único callsite produção).

**Gap:** invariante "se `signalingChannel !== null` então
`signalingUnsub !== null`" não é tipado. Em runtime ambos são
gerenciados em conjunto em `boot.ts:115-117/249-257`, mas tipo
permite estado intermediário (channel sem unsub) que indicaria
boot/teardown a meio caminho. Type união discriminada resolveria.

---

## 3. Gaps de types e type assertions

### 3.1 Inventário grep `: any` e `as X`

```
$ grep -rn ': any\b' src/lib/transport/webrtc/
(zero results)

$ grep -rn 'as [A-Z]' src/lib/transport/webrtc/
peer.ts:388:    pc: {} as RTCPeerConnection,
```

**Veredito:** 0 `any`, 1 type assertion justificada (test helper, fora
do path runtime). À luz do princípio "tudo tipado pra falhar em
compile", o transport está limpo.

### 3.2 Campos `unknown` / shape narrowing

`pipeline.ts:77-85` faz:

```ts
let parsed: unknown
try { parsed = JSON.parse(raw) } catch { ... }
if (!isPlausibleSignedEvent(parsed)) return
const event = parsed as SignedEvent
```

`isPlausibleSignedEvent` é type guard com 8 checks de shape. Aceitável
pra entrada peer-supplied (não conhecemos os bytes). À luz do invariante
"validar antes de assert", está correto. Schnorr verify subsequente
fecha o loop semântico.

**Gap formal:** `isPlausibleSignedEvent` é local a `pipeline.ts:125`.
`bundle.ts:135` reimplementa `isPlausibleEvent` com 6 checks (sig/pubkey
length opcionais). À luz do princípio DRY conformance:

- DROP duplicação: extrair `isPlausibleSignedEvent` pra
  `src/types/nostr.ts` ou `src/lib/verify.ts`.
- Pipeline pede `id.length===64 && sig.length===128 && pubkey.length===64`;
  bundle não. **Inconsistência semântica:** bundle aceita events com
  shape laxo que pipeline rejeita. Se um bundle imports event com
  `id.length=32` (truncado), Schnorr verify falha downstream, mas
  loga warning em vez de drop silencioso — diff de UX, não defeito
  de segurança.

### 3.3 Capabilities string array (signaling.ts:35)

```ts
drift: {
  capabilities: string[]   // v0 = ['datachannel-v1']
}
```

Untyped string array. Hoje só `'datachannel-v1'` é checado (não é —
nenhum callsite valida o conteúdo). À luz do invariante #14
("compatibilidade Nostr — não inventar discovery próprio"), o
campo existe mas é decorativo. Quando Fase 6.x precisar negociar
"posso receber idle ping?", essa string vai virar contrato.

**Recomendação:** tipar como `DriftCapability =
'datachannel-v1' | 'idle-ping-v1' | 'bundle-relay-v1'` (literal union)
e validar membership no `handleSignalingMessage` antes de `connectTo`.

---

## 4. Schema proposal pra idle distinction (núcleo da pergunta)

Pergunta do user: *"P2P aberto sem usar — pode-se otimizar? discovery."*

À luz dos invariantes existentes, o problema **é de schema antes de
ser de runtime**:

- `health()` retorna `TransportHealth { url, ok, latencyMs }` sem
  campo de atividade. Caller (UI / orchestrator) não pode distinguir
  peer útil de peer inerte.
- `getPeers()` (discovery.ts:149) retorna `{ id, status, latencyMs }`
  — mesma lacuna.
- `iterPeers()` consumidores (publish/health/random walk) tratam
  todo `'open'` igual.

### 4.1 Field novo em PeerState (mínimo viável)

```ts
// webrtc/types.ts — adicionar:
export interface PeerState {
  // ... fields existentes ...

  /** Timestamp ms da última mensagem útil enviada ou recebida via dc.
   *  "Útil" = SignedEvent (não ping/pong). `null` se nunca houve tráfego.
   *  Atualizado por: pipeline.ts (inbound após verify OK), publish (outbound
   *  após dc.send OK). NÃO atualizado por ping/pong (health.ts mantém
   *  `lastPongAt` separado pra esse fim).
   *  Marshall conformance #M1: pong NUNCA conta como tráfego — invariante
   *  protege contra atacante mascarando idle peer como ativo via spam de ping. */
  lastTrafficAt: number | null
}
```

**Por que separar de `lastPongAt`:**

- `lastPongAt` é "saúde liveness" (peer respondendo); `lastTrafficAt`
  é "utilidade aplicacional" (peer entregou conteúdo).
- Peer pode estar healthy (pong OK) e idle (zero eventos relevantes
  há horas) — caso central do pedido user.
- Atacante poderia inflar `lastTrafficAt` mandando frames junk — mas
  só conta tráfego *pós-verify Schnorr OK*, então atacante teria que
  Schnorr-assinar — game-over equivalente; defesa OK.

### 4.2 Função pura derivada (não-persisted)

```ts
// webrtc/health.ts ou util novo webrtc/activity.ts — derivada pura
export type ActivityMode = 'active' | 'idle' | 'unknown'

export const ACTIVITY_IDLE_THRESHOLD_MS = 10 * 60_000  // 10min

export function peerActivityMode(
  peer: PeerState,
  now: number,
): ActivityMode {
  if (peer.lastTrafficAt === null) return 'unknown'
  if (now - peer.lastTrafficAt < ACTIVITY_IDLE_THRESHOLD_MS) return 'active'
  return 'idle'
}
```

**Princípio Marshall:** **derivado, não persistido**. Igual ao Trust
Lens `s_local` (invariante #11 adendo) — uma única source-of-truth
(`lastTrafficAt`) e queries puras em cima. Sem dupla-fonte. Sem race
entre "field cached" e "realidade observada".

### 4.3 Surface no Transport API (mínimo necessário)

```ts
// transport/index.ts — estender TransportHealth opt-in
export interface TransportHealth {
  url: string
  ok: boolean
  latencyMs: number | null
  /** Atividade aplicacional (Fase 6.x). Opcional pra back-compat com
   *  wss/tor/bundle que não rastreiam atividade per-endpoint da mesma
   *  forma. Quando ausente, caller trata como 'unknown'. */
  activity?: ActivityMode
}
```

**Compat:** opcional → callsites existentes (wss.ts, tor.ts, bundle.ts)
não mudam. Só `webrtc/index.ts:health()` preenche. À luz do invariante
#14 (compat NIP padrão), TransportHealth é interno — sem risco
ecosystem.

### 4.4 Impacto em callsites

| Callsite | Antes | Depois |
|---|---|---|
| `publish` (webrtc/index.ts:72) | itera todos peers `open` | preferir `'active'`, depois `'idle'` no fallback (load balancing) |
| `random walk` (discovery.ts:41) | ignora peers conectados (`connectedIds`) | considerar eject de `'idle'` se candidate score alto (TODO 6.2-F já citado) |
| `getPeers` (discovery.ts:149) | retorna `{id,status,latencyMs}` | adicionar `activity` pra UI debug |
| `closeAll` (boot.ts:229) | fecha todos | inalterado (terminal cleanup, irrelevante) |

Nenhum invariante existente quebra. Field é additive-only.

### 4.5 Por que NÃO virar status novo (`'open-idle'`)

Considerei estender `PeerStatus` com `'open-idle'`. **Rejeito** sob 3
argumentos formais:

1. **Mistura concerns.** `PeerStatus` representa *connection liveness*
   (RTC underlying state). `ActivityMode` representa *use pattern*
   (semântica aplicacional). Acoplar geraria explosão combinatória:
   `'open-active' | 'open-idle' | 'degraded-active' | 'degraded-idle' | ...`
2. **Quebra LOCK_VIA_TEST existentes.** `webrtc-health.test.ts` e
   outros 4 specs leem `peer.status` direto. Renomear `'open'`
   quebraria 4 spec files (cf. comentário em `types.ts:6` — campo é
   "load-bearing").
3. **Schema "derivado" é o padrão Drift.** §11 Trust Lens, §22
   reputação local (block/mute) — todos seguem "store o sinal cru,
   derive views". `ActivityMode` segue a convenção.

---

## 5. LOCK_VIA_TEST sugeridos pra fechar gaps de conformance

Pra cada gap formal identificado, proponho assertion concreta. Marshall
princípio: *"se não tem teste, não é invariante — é coincidência."*

### 5.1 Schema-level (proteger contra regressões silenciosas)

**#M1 (novo) — `lastTrafficAt` nunca atualizado por ping/pong:**

```ts
// tests/webrtc-activity-conformance.test.ts
it('M1: ping/pong não conta como tráfego aplicacional', () => {
  const peer = _createPeerStateForTest('peer-A', 1000)
  peer.lastTrafficAt = null
  _markPing(peer, 1500)
  _handlePong(peer, 1500, 1600)
  expect(peer.lastTrafficAt).toBeNull()
})
```

**#M2 — `'closed'`/`'failed'` são terminais:**

```ts
it('M2: status terminal não regride a open', () => {
  const peer = _createPeerStateForTest('peer-B')
  peer.status = 'closed'
  // simular pong tardio chegando pós-cleanup
  _handlePong(peer, Date.now() - 100, Date.now())
  expect(peer.status).toBe('closed')
})
```

(Hoje pipeline.ts:52 guard cobre, mas teste explícito blinda.)

**#M3 — `signalingChannel === null` ↔ `signalingUnsub === null`:**

Não há LOCK ainda. Adicionar.

```ts
it('M3: signaling lifecycle — channel e unsub sempre paired', async () => {
  await ensureSignalingAsync()
  expect(getSignalingChannel()).not.toBeNull()
  expect(getSignalingUnsub()).not.toBeNull()
  await closeAll()
  expect(getSignalingChannel()).toBeNull()
  expect(getSignalingUnsub()).toBeNull()
})
```

### 5.2 Idempotência (já existe parcialmente)

**#M4 (verificar/adicionar) — `getOrCreatePeer` é idempotente:**

```ts
it('M4: getOrCreatePeer idempotente — N chamadas, 1 peer', () => {
  const p1 = _getOrCreatePeerForTest('peer-C')
  const p2 = _getOrCreatePeerForTest('peer-C')
  const p3 = _getOrCreatePeerForTest('peer-C')
  expect(p1).toBe(p2)  // mesma referência
  expect(p2).toBe(p3)
})
```

`webrtcCaps.test.ts` cobre o caso de cap; não vi cobertura explícita
de mesma-id-reuse. Verificar.

**#M5 — `registerTransport` é idempotente:**

`orchestrator.ts:65-72` já é idempotente (re-register substitui).
Não vi LOCK_VIA_TEST. Adicionar.

### 5.3 Dispatch-cycle (anti-recursão)

**#M6 — `discoverFollowsPeers` não retriggers via own `connectTo`:**

`followsDiscovery.ts:62` chama `connectTo`. `connectTo` cria peer.
Peer adicionado dispara `dc.onopen`. `dc.onopen` NÃO chama
discovery — verificado em peer.ts:175-196. ✅ sem cycle observado.

**LOCK sugerido:**

```ts
it('M6: connectTo não trigger discovery recursivo', async () => {
  let discoveryCalls = 0
  const spy = vi.spyOn(...)
  await connectTo('peer-D')
  // simular dc.onopen
  expect(discoveryCalls).toBeLessThan(2)
})
```

Mais defensivo que diagnóstico — defende regressão futura.

### 5.4 Conformance multi-transport (orchestrator)

**#M7 — dedup LRU não vaza memória:**

`orchestrator.ts:142-145` capa em `DEDUP_CAP=1000`. Já é guard, sem
LOCK explícito.

```ts
it('M7: dedup LRU cap em DEDUP_CAP=1000', async () => {
  for (let i = 0; i < 1500; i++) {
    await wrappedHandlers.onevent(mockEvent(i))
  }
  expect(seen.size).toBeLessThanOrEqual(1000)
})
```

---

## 6. Inventário tests existentes

```
tests/webrtcSignalingMock.test.ts        — BroadcastChannel mock contract
tests/webrtc-ratelimit.test.ts            — token bucket (T1 partial)
tests/webrtc-health.test.ts               — ping/pong + degraded
tests/webrtc-reconnect.test.ts            — backoff + cap
tests/webrtc-threat-T1-cross-proto-window.test.ts  — janela deslizante
tests/webrtc-threat-T2-pong-association.test.ts    — ping/pong 1:1
tests/webrtc-threat-T3-clock-protection.test.ts    — clock skew clamp
tests/webrtc-threat-T4-malicious-sub.test.ts       — filter validation + cap
tests/webrtcCaps.test.ts                  — MAX_PEERS hard cap
tests/webrtc-tor-mode-isolation.test.ts   — modo isolation
```

**Coverage qualitative:**

| Invariante | Coverage |
|---|---|
| Cap MAX_PEERS | ✅ webrtcCaps |
| Rate limit threshold | ✅ webrtc-ratelimit |
| Ping/pong 1:1 | ✅ webrtc-threat-T2 |
| Cross-proto window | ✅ webrtc-threat-T1 |
| Clock skew | ✅ webrtc-threat-T3 |
| Sub filter validation | ✅ webrtc-threat-T4 |
| Glare tie-break | 🟡 covered em signaling test (parcial) |
| `lastTrafficAt` | ⛔ não existe (proposal §4) |
| Activity mode derived | ⛔ não existe (proposal §4) |
| Orchestrator dedup | 🟡 implícito em wssTransport tests |
| Signaling lifecycle pair | ⛔ sem LOCK |
| PeerStatus terminais | 🟡 implícito (Barney #1 guard testado runtime, sem LOCK direto) |

**Conclusão coverage:** threat surface ESTÁ coberto (audit 2026-05-08
fechado). Schema gaps relacionados a *utilização* (não defesa) estão
abertos — exatamente o que o user perguntou.

---

## 7. Convergência esperada com Lily / Satoshi

### 7.1 Com Lily (runtime)

Marshall + Lily devem convergir em:

- **Field `lastTrafficAt` adicionado a PeerState** — Marshall valida
  schema, Lily implementa update points (pipeline.ts inbound,
  webrtc/index.ts:publish outbound).
- **Não atualizar `lastTrafficAt` em hot path crítico** — só após
  verify OK no inbound (já é late no pipeline; barato), e após
  `dc.send` OK no outbound (barato). Lily provavelmente confirma
  ZERO overhead perceptível.

Lily pode divergir em:
- *Onde* mora `peerActivityMode` (health.ts vs activity.ts dedicado).
  Marshall prefere arquivo novo `webrtc/activity.ts` pra não inflar
  health.ts; Lily talvez prefira reuso.

### 7.2 Com Satoshi (privacy + game theory)

Satoshi vai querer validar:

- **`lastTrafficAt` não vaza pelo wire.** Confirmado: é só estado local;
  nenhum field do schema é shared via dc/signaling. ✅
- **Idle peer ≠ alvo de ataque.** Atacante poderia inferir "user offline
  = idle peers" e timing-attack o re-broadcast. Mitigação: random walk
  de 30min já mistura. Marshall não vê threat novo introduzido por
  schema change.
- **Disconnect agressivo de idle peer** poderia ser sinal pra
  observador de signaling. Mitigação Marshall: NÃO disconnect
  automaticamente — só sinalizar pra orchestrator preferir `'active'`
  no publish. Discovery continua tentando manter conexões (manifesto
  §16 disponibilidade).

Divergência potencial: Satoshi pode argumentar pra **disconnect
proativo de idle peers** após N horas, pra reduzir surface. Marshall
contra: viola §16 (peer fica disponível pra outras subscriptions).
Resolução proposta: parâmetro user-controlled em settings ("agressividade
P2P: economy / balanced / max-availability"), default balanced (= manter
peers conectados, só preferir active no roteamento). Decisão final
fora deste audit.

---

## 8. Conclusão formal

**Veredito Marshall:**

À luz dos 34 princípios + invariantes do `CLAUDE.md`:

- Schema atual do WebRTC transport é **type-safe e conforme** pra
  correção/defesa (T1–T4, B1–B3 fechados). Sem `any`, sem leaks de
  type assertion runtime, encapsulamento Map respeitado.
- Schema é **insuficiente** pra responder a "P2P aberto sem usar" —
  porque `PeerStatus='open'` é overloaded e não há campo nem função
  pura que distinga utilização.
- Proposta mínima: adicionar `peer.lastTrafficAt: number | null` +
  função derivada `peerActivityMode(peer, now)` + opt-in field em
  `TransportHealth.activity`. Additive-only, zero break.
- 7 LOCK_VIA_TEST adicionais propostos (§5) — 3 fecham gaps existentes,
  4 protegem proposta nova.

Implementação: **NÃO neste audit.** Doc-only conforme escopo.
Recomendação: spawn task separado pra "Phase: P2P activity-aware
routing" se Lily/Satoshi convergem.

---

*Marshall — schema/types/conformance — 2026-05-23*
