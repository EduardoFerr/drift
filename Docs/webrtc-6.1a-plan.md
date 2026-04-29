# Fase 6.1a — Plano Executável de Implementação

Drafts concretos pra `transport/webrtc.ts` esqueleto + mock signaling. Complementa [`webrtc-seeding.md`](webrtc-seeding.md) (visão arquitetural). Este doc é o **plano de execução pra esta sessão de coding**.

Status: aprovado pelo Ted, em peer review pelo Barney.

## 1. Especificação completa da interface Transport

**Já existe e é formal** em `src/lib/transport/index.ts` (linhas 32-85). `webrtcTransport` deve implementar exatamente este contrato:

```typescript
export interface Transport {
  readonly kind: 'wss' | 'tor' | 'webrtc' | 'bundle'  // → 'webrtc'
  publish(event: SignedEvent): Promise<PublishResult>
  subscribe(filter: Filter, handlers: SubscribeHandlers): Unsubscribe
  health(timeoutMs?: number): Promise<TransportHealth[]>
}

export interface PublishResult {
  ok: number
  failed: number
  perRelay: { url: string; ok: boolean; error?: string }[]
  // No webrtc: `url` = peerId. Reusamos campo, semântica adapta.
}

export interface TransportHealth {
  url: string         // peerId
  ok: boolean         // DataChannel readyState === 'open'
  latencyMs: number | null  // medido por ping/pong no DataChannel
}

export interface SubscribeHandlers {
  onevent: EventHandler
  oneose?: () => void  // chamado após "flush inicial" — ver §5
}
```

Métodos adicionais NÃO entram na interface. `getPeers()`, `close()` ficam como exports separados pra DEV/teste:

```typescript
export function getPeers(): ReadonlyArray<{ id: string; status: PeerStatus; latencyMs: number | null }>
export function closeAll(): Promise<void>
export const webrtcTransport: Transport
```

## 2. Schema BroadcastChannel signaling mock

```typescript
// src/lib/transport/webrtc-signaling-mock.ts
export type SignalingMessage =
  | HelloMsg | OfferMsg | AnswerMsg | IceMsg | ByeMsg

interface BaseMsg {
  /** peerId do emissor — random UUID v4 gerado no boot do tab. */
  from: string
  /** epoch ms — para tie-break e debug. Invariante: monotônico por peer. */
  ts: number
}

export interface HelloMsg extends BaseMsg {
  type: 'hello'
  /** broadcast pro canal — sem `to`. */
  drift: {
    /** Capabilities: extensibilidade futura. v0 = ['datachannel-v1'].
     *  Quando suportarmos múltiplos protocolos (ex: chunked transfer),
     *  peer ignora aqueles que não reconhece. Sem version bump global. */
    capabilities: string[]
  }
}

export interface OfferMsg extends BaseMsg {
  type: 'offer'
  to: string         // peerId destino — peer ignora se !== seu próprio id
  sdp: string        // RTCSessionDescriptionInit.sdp
}

export interface AnswerMsg extends BaseMsg {
  type: 'answer'
  to: string
  sdp: string
}

export interface IceMsg extends BaseMsg {
  type: 'ice'
  to: string
  candidate: RTCIceCandidateInit  // null = end-of-candidates (trickle)
}

export interface ByeMsg extends BaseMsg {
  type: 'bye'  // broadcast — peer remove `from` do registro
}
```

**Discovery / race condition (tie-break)** — corrigido pós-review do Barney:

Independente de quem é "novo" ou "antigo", **toda recepção de `hello` aciona o mesmo cálculo determinístico**: comparar `min(myId, sender.from) === myId`. Se sim, este peer inicia o offer; caso contrário, aguarda. Isso elimina glare em qualquer ordem de chegada — inclusive 2 peers entrando simultaneamente.

Quem emite `hello`: peer recém-bootado (re)anuncia presença ao entrar no canal. Peers existentes podem re-anunciar periodicamente (não em 6.1a, deixar pra 6.2 — `helloHeartbeat`).

## 3. Estado interno do webrtcTransport

```typescript
type PeerStatus =
  | 'connecting'   // RTCPeerConnection criada, ICE em curso
  | 'open'         // DataChannel.readyState === 'open'
  | 'closing'      // bye recebido ou close() chamado
  | 'closed'       // recursos liberados
  | 'failed'       // ICE failed ou DataChannel error

interface PeerState {
  id: string
  pc: RTCPeerConnection
  dc: RTCDataChannel | null  // null até onopen do canal
  status: PeerStatus
  createdAt: number
  lastPingMs: number | null  // round-trip ping/pong, atualizado a cada 30s
  /** Buffer pra mensagens enviadas antes de dc.readyState === 'open'.
   *  CRÍTICO (peer review Barney #4): em transição pra status='failed' ou
   *  'closed', resetar `outboundQueue.length = 0`. Se DC nunca abre,
   *  buffer vaza memória proporcional aos publishes pré-conexão. */
  outboundQueue: string[]
}

interface SubscriptionRecord {
  id: string                // UUID — usado pelo Unsubscribe pra remover
  filter: Filter
  handlers: SubscribeHandlers
  /** Marca pra dedup local: evita re-entregar evento que já passou. */
  seenIds: Set<string>      // capped a N=1000, FIFO
}

// Singleton state (module-scoped):
const peers = new Map<string, PeerState>()
const subscriptions = new Map<string, SubscriptionRecord>()
let signaling: SignalingChannel | null = null  // lazy init no primeiro subscribe/publish
const myPeerId: string = crypto.randomUUID()
```

**Cleanup (invariante #2 — sem leaks)**: cada `Unsubscribe` retornado por `subscribe()` faz `subscriptions.delete(id)`. `closeAll()` (DEV/teste) itera `peers`, chama `pc.close()` em cada, limpa o Map. Listener `bye` recebido → cleanup imediato do `PeerState` correspondente. `beforeunload` no boot dispara `bye` broadcast e `closeAll()`.

## 4. matchFilter — função pura testável

```typescript
// src/lib/transport/matchFilter.ts
import type { SignedEvent } from '../../types/nostr'
import type { Filter } from './index'

export function matchFilter(event: SignedEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.since !== undefined && event.created_at < filter.since) return false
  if (filter.until !== undefined && event.created_at > filter.until) return false

  // Tag filters: `#<letter>` — qualquer tag [<letter>, value, ...] casa
  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#') || key.length !== 2) continue
    const wanted = (filter as Record<string, string[]>)[key]
    if (!wanted || wanted.length === 0) return false  // edge: array vazio = nenhum casa
    const tagName = key.slice(1)
    const found = event.tags.some(
      (t) => t[0] === tagName && typeof t[1] === 'string' && wanted.includes(t[1]),
    )
    if (!found) return false
  }
  return true
}
```

**Edge cases**:
- Filter vazio `{}` → `true` pra todo evento (NIP-01 conformant: ausência = sem restrição).
- `kinds: []` → `false` sempre (array presente mas vazio = nenhum kind aceito). Mesma regra para `ids`, `authors`, `#e`, `#p`.
- `since === until === event.created_at` → `true` (limites inclusivos).
- Event com `tags: []` e filter com `#e` presente → `false`.

## 5. Pipeline de evento recebido pelo DataChannel

Respeita invariante #5 (kind→schema→verify→persist). webrtc.ts é **pré-persist**: só entrega ao subscriber. `sync.ts` é quem chama `onNostrEvent` e persiste.

```typescript
function handleDataChannelMessage(peer: PeerState, raw: string): void {
  // 1. Parse defensivo
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    console.warn('[webrtc] malformed JSON from', peer.id); return
  }

  // 2. Shape mínima — guard barato antes do verify caro
  if (!isPlausibleSignedEvent(parsed)) return

  const event = parsed as SignedEvent

  // 2.5. KIND CHECK pré-verify (peer review Barney #1 — CRÍTICO).
  // Sem isso, peer hostil envia 1000 eventos válidos kind:1 (Nostr global)
  // e queima ~1000ms de CPU em verifyDriftEvent. Invariante #5 do CLAUDE.md
  // exige kind check ANTES de schema/verify. Invariante #14: cliente Drift
  // só processa kinds Drift; outros são ruído no transport WebRTC.
  if (!DRIFT_KIND_SET.has(event.kind)) return

  // 3. Schnorr verify ANTES de qualquer side-effect (invariante #5)
  if (!verifyDriftEvent(event)) {
    console.warn('[webrtc] sig invalid from', peer.id, event.id?.slice(0, 8))
    return
  }

  // 4. Match filtro de cada subscription + dedup local
  for (const sub of subscriptions.values()) {
    if (sub.seenIds.has(event.id)) continue
    if (!matchFilter(event, sub.filter)) continue
    sub.seenIds.add(event.id)
    if (sub.seenIds.size > 1000) {
      const first = sub.seenIds.values().next().value
      if (first) sub.seenIds.delete(first)
    }

    // 5. Entrega ao subscriber. Erros do handler isolados.
    Promise.resolve(sub.handlers.onevent(event)).catch((err) =>
      console.error('[webrtc] onevent failed:', err),
    )
  }
}

function isPlausibleSignedEvent(x: unknown): x is SignedEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return typeof e.id === 'string' && e.id.length === 64
    && typeof e.sig === 'string' && e.sig.length === 128
    && typeof e.pubkey === 'string' && e.pubkey.length === 64
    && typeof e.kind === 'number'
    && typeof e.created_at === 'number'
    && typeof e.content === 'string'
    && Array.isArray(e.tags)
}
```

**NÃO chamar `onNostrEvent` aqui.** `sync.ts` faz isso após receber via `handlers.onevent`. Separação de camadas: transport entrega; sync orquestra.

**Consumidor de `webrtcTransport.subscribe` em 6.1a** (clarificação Barney #4):
- Em 6.1a, `sync.ts` continua usando APENAS `wssTransport`. Não toca em webrtc.
- `webrtcTransport.subscribe` é exposto via `window.driftWebRTC.transport` em DEV pra teste manual + tests Vitest puros (cobrindo só matchFilter + signaling mock).
- Integração `sync.ts` ↔ webrtc (pra eventos via DataChannel chegarem em `onNostrEvent` → SQLite) é **trabalho de 6.2 (multi-transport orchestration)**. Em 6.1a, smoke test e2e verifica apenas que publish/subscribe funciona end-to-end via `window.driftWebRTC` direto entre 2 abas.

## 6. Estrutura de arquivos final

```
NEW src/lib/transport/webrtc.ts                         (~250 linhas)
NEW src/lib/transport/webrtc-signaling-mock.ts          (~120 linhas)
NEW src/lib/transport/matchFilter.ts                    (~40 linhas)
NEW src/lib/transport/__tests__/matchFilter.test.ts
NEW src/lib/transport/__tests__/peerRegistry.test.ts
NEW src/lib/transport/__tests__/signaling-mock.test.ts
MOD src/lib/transport/index.ts                          (+1 linha: re-export webrtcTransport)
MOD src/main.tsx                                        (DEV: window.driftWebRTC = { getPeers, closeAll })
MOD package.json                                        (version bump 0.6.0-alpha)
MOD CHANGELOG.md                                        (entrada Fase 6.1a)
```

## 7. Decomposição em commits

**Commit A — primitivos puros** (sem WebRTC API).
Arquivos: `matchFilter.ts`, `__tests__/matchFilter.test.ts`, tipos `PeerState`/`SubscriptionRecord` em `webrtc.ts` (stubs). Tests vitest puros, rodam em jsdom sem RTCPeerConnection.
Mensagem: `feat(transport): matchFilter NIP-01 + peer registry types (Phase 6.1a)`

**Commit B — signaling mock isolado**.
Arquivos: `webrtc-signaling-mock.ts`, `__tests__/signaling-mock.test.ts`. Testa hello/offer/answer/ice/bye via dois `BroadcastChannel` no mesmo realm + tie-break determinístico.
Mensagem: `feat(transport): BroadcastChannel signaling mock for WebRTC dev`

**Commit C — webrtcTransport completo**.
Arquivos: `webrtc.ts` (publish/subscribe/health), `index.ts` re-export, `main.tsx` DEV bridge. Testes manuais e2e (não unit — requer RTCPeerConnection real, dois tabs).
Mensagem: `feat(transport): webrtcTransport with mock signaling (Phase 6.1a)`

**Commit D — version + docs**.
`package.json` 0.5.x → 0.6.0-alpha, `CHANGELOG.md` entrada, possíveis updates em `Docs/webrtc-seeding.md` marcando 6.1a checked.
Mensagem: `chore: bump 0.6.0-alpha — Phase 6 transport layer started`

Tests do commit anterior **devem passar** antes de avançar pro próximo.

## 8. Armadilhas previsíveis

1. **jsdom sem RTCPeerConnection** — Vitest jsdom env não tem `RTCPeerConnection` nem `RTCDataChannel`. Tests unit cobrem só `matchFilter` + signaling mock (BroadcastChannel existe no jsdom moderno; se não, polyfill). Tests do `webrtcTransport` real são **e2e manual** em browser.

2. **ICE trickle vs all-at-once** — Implementar **trickle** (envia cada candidate via `IceMsg` no `pc.onicecandidate`; `null` candidate = end-of-candidates). Não acumular e mandar batch — atrasa conexão em 2-5s.

3. **DataChannel reconnect** — Quando peer fecha (`dc.onclose` ou `pc.connectionState === 'failed'`), **NÃO tentar reconectar automaticamente** em 6.1a. Marca `status='closed'`, remove do `peers`, libera. Reconnect é responsabilidade da camada acima (seeder.ts em 7.1) ou de novo `hello` quando peer voltar.

4. **Memory leak por subscription órfã** — Se chamador chama `subscribe()` e nunca o `Unsubscribe`, `seenIds` cresce até cap (1000) mas `SubscriptionRecord` fica preso. Mitigação: documentar contrato no JSDoc + `closeAll()` limpa tudo. Em DEV, log warning se `subscriptions.size > 50`.

5. **Filter `{}` semantics** — Passa todo evento (NIP-01). Se chamador não esperava isso, dispara handler em 100% do tráfego. Test cobre explicitamente. Documentar no JSDoc.

6. **Outbound queue leak em failed/closed** (Barney #4) — Mensagens publish() enfileiradas em `peer.outboundQueue` antes de `dc.onopen` ficam no Map se DC nunca abrir (ICE failed após 30s). Mitigação: na transição `connecting → failed/closed`, reset `outboundQueue.length = 0`. Sem isso, vaza memória proporcional aos publishes pré-conexão.

7. **`beforeunload` não é confiável em TWA/Tauri** (Barney #10) — Cleanup via `pagehide` + `bye` broadcast é mais robusto cross-platform. Em mobile, `beforeunload` pode nem disparar quando user mata o app.

8. **`crypto.randomUUID()` em module scope** (Barney nit) — Em SSR/test runner, `crypto` global pode não existir. Usar lazy init: `let _myPeerId: string | null = null; const myPeerId = () => _myPeerId ??= crypto.randomUUID()`.

## 9. Critério de aceite

**Tests novos**:

- `matchFilter.test.ts`:
  - filter vazio `{}` → matches todo evento
  - `kinds: []` → matches nenhum
  - `kinds: [1]` + event kind 1 → match; kind 2 → no
  - `authors` + multiple values → match no OR
  - `since`/`until` boundaries inclusivos
  - `#e` presente sem tag correspondente → no match
  - `#e` casa quando event.tags tem `['e', value]` com value no array
  - combinação AND: kinds + authors + since
  - tag filter com array vazio (`#e: []`) → no match

- `peerRegistry.test.ts` (puros, sem RTC):
  - inserção/remoção de PeerState
  - `getPeers()` retorna readonly snapshot
  - cleanup em `bye` remove entry
  - status transitions: connecting → open → closed válidas

- `signaling-mock.test.ts`:
  - dois canais no mesmo realm trocam `hello`
  - tie-break: peer com id lexicograficamente menor envia offer
  - mensagens com `to !== myId` são ignoradas
  - `bye` propaga remoção

**Smoke test e2e manual**:

```bash
npm run dev
# Tab 1: localhost:5173
# Tab 2: localhost:5173 (mesma origem → BroadcastChannel funciona)

# Tab 1 console:
window.driftWebRTC.getPeers()  // → [{ id: '<tab2-id>', status: 'open', latencyMs: <num> }]

# Tab 2 console — assina e publica:
const ev = await window.drift.signEvent({ kind: 1, content: 'hello webrtc', tags: [] })
await window.driftWebRTC.transport.publish(ev)  // → { ok: 1, failed: 0 }

# Tab 1 console — subscribe antes do publish:
const unsub = window.driftWebRTC.transport.subscribe(
  { kinds: [1] },
  { onevent: (e) => console.log('GOT', e.id) }
)
unsub()
window.driftWebRTC.closeAll()
```

**Performance**: criar peer + abrir DataChannel não bloqueia main thread > 50ms.

**Invariantes do CLAUDE.md respeitadas**:
- #2 (no leaks): `closeAll()` + `Unsubscribe` + `bye` cleanup auditados
- #5 (verify pre-persist): `verifyDriftEvent` no pipeline §5 antes de qualquer entrega
- #14 (sem discovery paralelo): mock signaling é DEV-only; produção usa NIP-44 DM (Fase 6.1b)

---

**Estimativa**: 6-8h, 1-2 sessões. Commits A-D incrementais; aborto fácil entre eles se algo aparecer.
