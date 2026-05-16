# RFC: mover `verifyDriftEvent` pra worker dedicado

**Status**: Proposed (design only — implementação fica pra sprint próprio)
**Autor**: Ted (revisão: arquitetura)
**Data**: 2026-05-16
**Persona inputs**: Lily (gatilho — audit estática rank 2), Barney (threat model do channel main↔worker), Marshall (test strategy)
**Relacionado**:
- `Docs/sessions/lily-long-task-audit-2026-05-15.md` §2.5 e §9 rank 2 — origem do high-ROI deferido
- CLAUDE.md invariantes #1 (única porta INSERT) e #5 (pipeline ordem cheap→caro)
- `Docs/rfcs/2026-05-rfc-event-handler-registry.md` — pipeline já desenhado pra ser registry-friendly

---

## §1 — Problem statement

`verifyDriftEvent` (Schnorr secp256k1, ~1 ms/evento em desktop, ~2-4 ms em mobile mid) roda **síncrono no main thread** dentro de `onNostrEvent` (events.ts:134). Por design — invariante #5: kind/schema cheap antes, verify caro só pra eventos que vão ficar.

Caminho funcional segue intacto. O custo emerge no **verify-storm pós-subscribe**:

- `startSync` (deferido pra `requestIdleCallback` em Robin v1, bootstrap.ts:315-356) abre WebSockets via SimplePool.
- Cada relay devolve até `SUBSCRIBE_LIMIT = 500` events stored (sync.ts:70). 4 relays seed = teto teórico ~2000 events dedupados pelo orchestrator no boot.
- Em rajada típica pós-EOSE: 500-2000 events em ~2-4s. Mesmo diluído em microtasks (1 event = 1 task via `pool.subscribeMany` callback), cada batch lança ~50-200 ms scripting contíguo do verify Schnorr.
- Mobile mid (Moto G4 4× slowdown): 500 events × ~3-4 ms = ~1500-2000 ms scripting pós-paint. INP regressivo se o user tentar swipe nessa janela.

Mover `verifyDriftEvent` pra worker dedicado dilui esse custo pra fora do main, mantendo intacto o pipeline canônico do `onNostrEvent`. Lily audit §9 ranqueou como rank 2 (alto ROI, médio-alto risco de refactor).

**Por que worker dedicado e não o `db.worker`**: db.worker está single-threaded com lock implícito do SQLite WASM. Adicionar verify lá serializa verify + I/O numa fila só — perde paralelismo. Worker novo é cheap (<100KB chunk, sem WASM) e roda em paralelo ao SQLite.

---

## §2 — Pipeline atual vs proposto

### Atual (events.ts:124-139)

```ts
export async function onNostrEvent(event: SignedEvent): Promise<void> {
  // 1. Cheap: kind check (Record lookup, O(1))
  const handler = KIND_DISPATCH[event.kind]
  if (!handler) return
  // 2. Cheap: schema check (sem db, sem crypto)
  if (!handler.validate(event)) return
  // 3. Expensive: signature check (~1ms — SÍNCRONO no main)
  if (!verifyDriftEvent(event)) return
  // 4. Persist (INSERT + invalidateFeed + scheduleScoreRecalc)
  await handler.persist(event)
}
```

### Proposto

```ts
export async function onNostrEvent(event: SignedEvent): Promise<void> {
  // 1-2. Cheap checks continuam SYNC, antes do await (invariante #5
  //      preservada: ainda cheap→caro; await só na etapa cara).
  const handler = KIND_DISPATCH[event.kind]
  if (!handler) return
  if (!handler.validate(event)) return
  // 3. Expensive: signature check (~1ms NO WORKER, +0.1-0.3ms postMessage RT)
  //    Main thread continua executando outras tasks durante o verify.
  if (!(await verifyEventAsync(event))) return
  // 4. Persist (sem mudança)
  await handler.persist(event)
}
```

Pipeline ordem (invariante #5) é preservado por construção: kind/schema cheap continuam sync **antes** do `await`. Verify só roda no worker pra events que passaram nos cheap checks — economia mantida.

Invariante #1 (única porta INSERT) intocada: handler.persist segue rodando no main, recebe verify-ok do worker.

---

## §3 — Worker proposal

### 3.1 Arquivo: `src/lib/verify.worker.ts`

```ts
// Imports MÍNIMOS — chunk tem que ser pequeno.
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as SignedEvent } from 'nostr-tools'

interface InMessage { id: number; event: SignedEvent }
interface OutMessage { id: number; ok: boolean }

self.onmessage = (e: MessageEvent<InMessage>) => {
  const { id, event } = e.data
  let ok = false
  try {
    ok = verifyEvent(event)
  } catch {
    ok = false
  }
  ;(self as unknown as Worker).postMessage({ id, ok } satisfies OutMessage)
}
```

Sem state interno. Sem buffer. Mensagens são request/response 1:1 correlacionadas por `id`. Worker é stateless por design — facilita restart em crash (§7).

### 3.2 API ergonômica: `src/lib/verify.ts`

```ts
import type { SignedEvent } from '../types/nostr'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (ok: boolean) => void>()
let queueDepth = 0
let dropCount = 0

const QUEUE_DEPTH_LIMIT = 2000   // ver §6
const INIT_TIMEOUT_MS = 1000     // ver §7

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./verify.worker.ts', import.meta.url), {
      type: 'module',
      name: 'drift-verify',
    })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean }>) => {
      const resolver = pending.get(e.data.id)
      if (!resolver) return
      pending.delete(e.data.id)
      queueDepth--
      resolver(e.data.ok)
    }
    worker.onerror = () => recover('worker error')
    worker.onmessageerror = () => recover('messageerror')
    return worker
  } catch (err) {
    console.warn('[verify] worker init falhou — fallback sync:', err)
    return null
  }
}

export function verifyEventAsync(event: SignedEvent): Promise<boolean> {
  const w = ensureWorker()
  if (!w) return Promise.resolve(verifyEventSync(event))    // §7 fallback

  if (queueDepth >= QUEUE_DEPTH_LIMIT) {
    dropCount++
    return Promise.resolve(false)                           // §6 backpressure
  }

  const id = ++nextId
  return new Promise<boolean>((resolve) => {
    pending.set(id, resolve)
    queueDepth++
    w.postMessage({ id, event })
  })
}

// Métricas em DEV (§6.2)
export function getVerifyMetrics() {
  return { queueDepth, dropCount, pendingCount: pending.size }
}

// Stats só em DEV — não exportar pra prod (privacy / surface area)
```

Fallback sync (`verifyEventSync`) usa o `verifyDriftEvent` atual diretamente — sem regressão funcional se worker falhar.

### 3.3 Integração em events.ts

Única mudança em events.ts:134:

```diff
- if (!verifyDriftEvent(event)) return
+ if (!(await verifyEventAsync(event))) return
```

`onNostrEvent` já é `async` (events.ts:124) — sem mudança de assinatura. Callers (`sync.ts` orchestrator callback, `webrtc/pipeline.ts:91`) já consomem como Promise.

**Caso especial webrtc/pipeline.ts:91**: chama `verifyDriftEvent` direto antes de entregar pra subscriber. Pode (e deve) migrar pra `verifyEventAsync` no mesmo refactor — verify-storm cross-transport tem mesmo padrão (Fase 6.4).

---

## §4 — Chunking strategy (Vite manualChunks)

### 4.1 Worker chunk

Vite gera automaticamente um chunk separado pra `new Worker(new URL(...))` (vide `db.worker-tLYF_uuU.js` no dist atual, padrão idêntico ao SQLite worker). Esse chunk **inclui** as deps do worker — `nostr-tools/pure` + `@noble/secp256k1` + `@noble/hashes`.

**Estimativa de tamanho do chunk worker** (`verify.worker-*.js`):
- `verifyEvent` de nostr-tools/pure: ~3 KB raw (wrapper sobre noble)
- `@noble/secp256k1` schnorr path: ~25-35 KB raw
- `@noble/hashes` (sha256 + utils): ~10-15 KB raw
- Worker glue + types: <1 KB
- **Total estimado: ~40-55 KB raw / ~14-18 KB gzip**

Esse chunk é **lazy por construção** (browser só baixa quando `new Worker()` é chamado, ou seja, quando primeiro evento chega via sync). Vai pra `requestIdleCallback` path de `startSync` — fora do critical do FCP/LCP.

### 4.2 Impacto em `vendor-nostr` (eager)

`vendor-nostr` hoje inclui (vite.config.ts:295-298):
```
nostr-tools + @noble/secp256k1 + @noble/hashes + @scure/base
```

**Análise — o que mais usa secp256k1 no main thread?**

Grep `verifyEvent|finalizeEvent|getPublicKey|generateSecretKey` em src/:
- `lib/nostr.ts:14` — `finalizeEvent` (assinar) + `verifyEvent` (verificar)
- `lib/identity.ts` — `generateSecretKey` + `getPublicKey` (no boot, raro)
- `lib/protocol.ts` — chama `signDriftEvent` (assinar) — publish flow
- `lib/transport/webrtc/pipeline.ts` — `verifyDriftEvent` (inbound)

**Usos eager**:
- `signDriftEvent` em publish flow: usuário cria post / spread / bury / report / comment. Raro pós-boot (~10-100/sessão), latency-bounded por user action (não rajada).
- `verifyDriftEvent` em webrtc inbound: também mover pra worker (§3.3).
- `getPublicKey` / `generateSecretKey` em identity bootstrap: 1× no boot, irrelevante.

**Decisão**: signing (`finalizeEvent`/`signDriftEvent`) **fica no main**. Motivos:
1. Frequência baixa (publish é user-driven, não burst).
2. `signDriftEvent` precisa de `nsec` que vive em `identity.ts` → cache + AES-GCM master key (`crypto.ts`). Mandar nsec pro worker complica threat model (Barney input — §7.3 abaixo).
3. Ganho marginal: 1-2 ms por publish vs. user reaction-time (~100 ms). Não compensa overhead arquitetural.

**Conseqüência**: `@noble/secp256k1` + `@noble/hashes` permanecem em `vendor-nostr` eager (signing precisa). **Worker chunk DUPLICA essas deps** — Rollup vai code-split, mas chunks separados podem manter cópias parciais.

**Mitigação opcional** (deferir pra round CWV-4): mover `@noble/secp256k1` + `@noble/hashes` pra `vendor-noble` separado, vendor-nostr fica só com nostr-tools utils, e worker chunk importa `vendor-noble` como shared chunk. Rollup chunking suporta — exige análise empírica com `npm run build:analyze`. **Não pré-otimizar** sem o número.

**Delta esperado em vendor-nostr** (chunk eager):
- Cenário A (não mexe em manualChunks): vendor-nostr **+0 KB** (sem mudança). Worker chunk **+40-55 KB raw** lazy.
- Cenário B (split @noble pra vendor-noble compartilhado): vendor-nostr **-30-50 KB raw** (perde @noble), vendor-noble **+30-50 KB raw** ainda eager (signing main). Net entry **~0 KB** (mesmo total, só re-split). Worker chunk **-30-50 KB** (compartilha vendor-noble).

Cenário A é o caminho default — simples, ratchet de bundle entry estável. Cenário B é optimization round subsequente se profile mostrar valor.

---

## §5 — Backpressure / queue design

### 5.1 Cenário motivador

Verify-storm: 2000 events em ~3s. Worker processa ~1ms cada → ~3s. Main thread emite ~2000 postMessages em <100ms (microtasks rápidos). **Worker tem 2000 pendentes mas processa serialmente**.

Sem cap: `pending` Map cresce até worker drenar. Memory: 2000 × (event ~2KB + Promise handle) = ~4-5 MB transient. Não-trivial em mobile, mas finito.

Risco real: relays maliciosos / bug em filter relay → 10k+ events em rajada → memory pressure + INP regredido pela fila de postMessage backlog.

### 5.2 Política proposta

```ts
const QUEUE_DEPTH_LIMIT = 2000  // teto SUBSCRIBE_LIMIT × N relays
```

- `queueDepth >= LIMIT` → `verifyEventAsync` retorna `false` imediatamente sem enfileirar (drop newest).
- **Drop newest, não oldest**: events em flight no worker já consumiram CPU; descartar agora desperdiça. Drop o que ainda nem chegou na fila.
- Drop conta como `false` (verify fail) → `onNostrEvent` early-return → evento perdido localmente. Manifesto §7 (determinismo): convergência exige eventualmente reprocessar. Mitigação:
  - `pool.subscribeMany` re-entrega events stored se cliente reconectar.
  - `rebuildIdentityHistory(npub)` cobre catch-up explícito.
  - Drop é último recurso — limite alto (2000) significa que só ataque real ou bug atinge.

### 5.3 Métricas (DEV-only)

```ts
queueDepth      // current pending no worker
dropCount       // monotônico — quantos events foram dropados desde init
pendingCount    // pending.size (deve === queueDepth, sanity check)
```

Expor via `getVerifyMetrics()` chamada por DiagnosticPanel ou test harness. **NÃO expor em prod** — ataque pode inferir cliente lag por dropCount visível em ataques de timing (Barney input).

Log em DEV: `console.log('[verify] drop', dropCount)` a cada 100 drops. Não logar cada um — flood ruidoso em verify-storm legítimo.

---

## §6 — Erros e recovery

### 6.1 Worker init falha

Worker constructor lança em browsers antigos / contextos sem `import.meta.url` resolução / CSP estrito. `ensureWorker` captura, retorna `null`, `verifyEventAsync` cai pro fallback sync.

**Fallback sync** = comportamento atual (verifyDriftEvent no main). Zero regressão funcional, perde só o ganho de off-main. Log uma vez: `[verify] worker init failed, using sync fallback`.

### 6.2 Worker crash (onerror / onmessageerror)

```ts
function recover(reason: string): void {
  console.error('[verify] worker crash:', reason)
  // Reject all pendentes — caller pode reprocessar via re-subscribe
  for (const [, resolver] of pending) resolver(false)
  pending.clear()
  queueDepth = 0
  // Tear down
  worker?.terminate()
  worker = null
  // Re-init lazy no próximo verifyEventAsync — não reinicia agora (evita
  // loop se causa for permanente). Próximo call faz ensureWorker() de novo.
}
```

Trade-off: events em flight quando crash acontece **ficam perdidos localmente**. Aceitável — relay re-entrega via subscribe ativo, e crash é raro.

### 6.3 Init timeout

Worker construtor é sync (retorna handle imediatamente), mas primeiro `onmessage` pode demorar se chunk lazy ainda está baixando (~50-200 KB). Não bloqueia `verifyEventAsync` — call dispara `postMessage` mesmo antes do worker estar "ready" (browser bufferiza interno).

Sem timeout explícito necessário — backpressure (§5) já cobre o caso "worker travado por X segundos".

### 6.4 Threat model channel main↔worker

Barney input (§7 audit comparável a Auto-Mode threat model):

| Ataque | Vetor | Mitigação |
|---|---|---|
| Worker recebe event malformado e crasha | Atacante força input que detona @noble | `try/catch` em onmessage. Crash trata como `false`. |
| Worker é lento de propósito (DoS) | Atacante feed many slow-to-verify events | Backpressure §5 drop newest após cap. SUBSCRIBE_LIMIT já bound o input. |
| Main thread espera Promise pendurada infinitamente | Worker travado sem responder | onerror catch + crash recovery §6.2 rejeita pendings. |
| Worker exfiltra event content via outro canal | Worker tem só `postMessage` pro main | Worker não importa fetch / IndexedDB / cookies / localStorage. Sem net stack acessível. |
| nsec sendo passado pro worker | NÃO É CASO — signing fica no main (§4.2) | Worker recebe SignedEvent (público por design) e devolve boolean. Zero secret no canal. |

**Conclusão**: surface area do worker é mínima e pública. Sem nsec passing, sem network, sem DB. Mais seguro que webrtc/pipeline.ts que processa input untrusted no main thread hoje.

---

## §7 — Test strategy (Marshall — pra implementação futura)

### 7.1 Unit tests (pure)

`tests/verify-queue.test.ts`:
- `verifyEventAsync` enfileira call e resolve com boolean do worker.
- Backpressure: enfileira N events com N > QUEUE_DEPTH_LIMIT, validar dropCount.
- Order: events resolvidos in-order (id correlation).
- Worker mock: harness simula worker via Function.prototype substitute.

`tests/verify-worker-mock.test.ts`:
- Mock `new Worker()` retornando `MessageChannel` puro.
- Validar shape de InMessage / OutMessage.
- Validar onerror dispara recovery.

### 7.2 Integration tests (events.ts pipeline)

`tests/events-pipeline-verify-async.test.ts`:
- Mock `verifyEventAsync` retornando true → INSERT acontece.
- Mock retornando false → noop, sem INSERT.
- Verify rejeitado MID-FLIGHT (worker crash) → cleanup correto, próximos events ok.
- Invariante #5 preservada: cheap checks (kind/schema) ainda rejeitam SEM chamar verify worker.

### 7.3 Conformance / regression

`tests/verify-storm-conformance.test.ts`:
- Gerar 500 events válidos + 100 inválidos misturados.
- Submeter em rajada (sem await intercalado).
- Assert: todos os 500 válidos persistiram, nenhum inválido entrou em SQLite.
- Bound: total time não passa de X ms (perf threshold pra detectar regressão).

### 7.4 Lock by test

Adicionar ao `tests/manifesto-conformance.test.ts`:
- Lint pattern: `verifyDriftEvent\(.*\)` SEM `await` em events.ts main path → fail (forçar uso do verifyEventAsync).
- Path check: `src/lib/verify.worker.ts` existe + imports `nostr-tools/pure`.
- Worker chunk presente em `dist/assets/verify.worker-*.js` (build smoke).

---

## §8 — Sub-etapas implementáveis (ranqueadas)

| Etapa | Escopo | Risco | Bloqueante? |
|---|---|---|---|
| 1 | Criar `verify.worker.ts` + `verify.ts` wrapper. NÃO ligar em events.ts ainda. | baixo | não |
| 2 | Adicionar tests unitários (§7.1) — wrapper isolado, sem events.ts. | baixo | não |
| 3 | Trocar `verifyDriftEvent` por `verifyEventAsync` em events.ts:134. Tests de integração (§7.2). | médio | não — fallback sync cobre |
| 4 | Trocar em webrtc/pipeline.ts:91. | médio | não |
| 5 | Adicionar conformance test (§7.4 — path + lint). | baixo | não |
| 6 | Métricas DEV-only via DiagnosticPanel. | baixo | não |
| 7 | Round CWV-4 (opcional): split @noble pra vendor-noble compartilhado se profile justificar. | médio | não — optimization round |

Etapas 1+2 são standalone — podem mergear isoladas sem impacto runtime (worker existe mas não é usado).
Etapa 3 é o flip — onde o ganho aparece. Tests 7.2+7.3 são pré-requisito.

**Estimativa total**: ~1-2 dias dev focado (~8h código + ~4h tests + ~2h build/verify). Sprint próprio justificado.

---

## §9 — Métricas esperadas

### 9.1 Latência por event verify

| Cenário | Sync (atual) | Async worker | Delta |
|---|---|---|---|
| Desktop M1, idle main | ~0.8-1.2 ms | ~1.2-1.8 ms (verify + 0.1-0.3 ms RT) | +0.3-0.6 ms |
| Desktop M1, main saturated | ~0.8-1.2 ms (bloqueia main) | ~1.2-1.8 ms (worker paralelo) | +0.3-0.6 ms wall, **0 ms main scripting** |
| Mobile mid (Moto G4 4×) | ~3-4 ms (bloqueia main) | ~3-4 ms (worker paralelo) + ~0.3-1 ms RT | +0.3-1 ms wall, **0 ms main scripting** |

**Threshold de ROI**: postMessage RT < 5 ms (estipulado no prompt). Empiricamente em Chrome: postMessage com SignedEvent (~2 KB JSON) custa ~0.1-0.3 ms desktop, ~0.5-1 ms mobile. **Confortavelmente abaixo** do threshold.

### 9.2 INP / TBT impact

Verify-storm boot: 500 events × ~1 ms = ~500 ms scripting **deslocados do main**.
- TBT (total blocking time): -500 a -2000 ms pós-paint.
- INP: melhora porque main thread fica disponível pra responder a swipe/tap durante o storm.
- LCP: sem impacto direto (already-painted por Robin v1; verify storm é pós-paint).

### 9.3 Bundle size delta

| Chunk | Antes | Depois | Notes |
|---|---|---|---|
| `index-*.js` (entry) | 201 KB raw / ~60 KB gz | **201 KB raw / 60 KB gz** | Sem mudança — verify wrapper é tree-shakable / <1 KB |
| `vendor-nostr-*.js` (eager) | ~XXX KB | **sem mudança** (cenário A) | nostr-tools/pure ainda usado por signing |
| `verify.worker-*.js` (NOVO, lazy) | — | **~40-55 KB raw / ~14-18 KB gz** | Baixado quando primeiro verify call dispara |
| Hard ratchet entry chunk | ≤ 250 KB | **mantido** ≤ 250 KB | RFC não regride ratchet |

Worker chunk só baixa quando `startSync` dispara (`requestIdleCallback` post-paint). Zero impacto em FCP/LCP/TTI. Repeat-visit: chunk cached (Workbox runtime caching pode incluir em `lazy-chunks` se necessário — vite.config.ts:118).

### 9.4 Memory delta

- Worker thread: ~5-10 MB heap (nostr-tools + noble + V8 baseline).
- Pending Map main-side: cap 2000 entries × ~3 KB Promise handle + event ref = ~6 MB transient durante storm, ~0 idle.
- **Trade-off**: ~10 MB extra durante boot storm, dissipa após storm. Mobile mid (4-6 GB RAM): aceitável.

---

## §10 — Não-fazer (avaliado, risco > ganho)

1. **Mover signing pro worker**: §4.2 — nsec exposure desnecessária pra ganho marginal (publish é user-driven, não burst).
2. **WASM verify (uniffi / wasm-bindgen Rust)**: 2-3× mais rápido que JS noble, mas WASM chunk é ~80-120 KB extra e load time ~50-100 ms. ROI invertido — workers JS já cobrem o caso.
3. **Pool de workers**: 2-4 workers paralelos pra verify ainda mais rápido. Verify Schnorr é CPU-bound — 1 worker já isola main. Pool aumenta complexidade (ordering, dispatch fairness) sem evidence de bottleneck residual. Deferido pra round futuro sob profile real.
4. **Transferable objects pra event payload**: SignedEvent tem strings (id, sig, pubkey, content, tags). Strings em JS NÃO são transferable — só ArrayBuffer/MessagePort. Serialization padrão (structured clone) já é eficiente pra esse shape (~0.1 ms).
5. **OffscreenCanvas-style verify batching**: receber N events numa única postMessage, validar todos no worker, devolver array. Reduz RT count mas perde fairness (1 event lento atrasa todos). Backpressure §5 já cobre o caso patológico.

---

## §11 — Open questions (deferred)

- **Q1**: signing também migra pra worker no futuro se publish-burst aparecer (ex: catch-up de drafts offline)? Reabrir se evidência empírica surgir.
- **Q2**: vendor-noble split (§4.2 cenário B) — quando rodar `npm run build:analyze` em sprint dedicado, decidir baseado em bundle empírico.
- **Q3**: worker compartilhado entre features futuras? Ex: Fase 6 IPFS pin pode precisar verify de CIDs (sha256 chunks). Verify worker poderia virar `crypto.worker` genérico. **Esperar** Fase 6 chegar antes de generalizar — YAGNI.
- **Q4**: DiagnosticPanel UI pra métricas verify (§5.3 expose). Trivial — adiar pra etapa 6 da implementação.

---

## §12 — Decisão

**Recomendação**: aprovar como design baseline pra sprint dedicado. Etapas 1-3 são o mínimo pra capturar ganho; etapas 4-7 são polish incremental. Sem bloqueante arquitetural — pipeline `onNostrEvent` foi desenhado pra esse momento (assíncrono desde sempre, cheap→caro explícito, invariante #5 preservada por construção).

Roll-out gradual via fallback sync §6.1 elimina risco de regressão funcional. Tests §7.4 lock previnem drift futuro.

---

*Ted, 2026-05-16 · RFC arquitetural, não-bloqueante · derivado de Lily audit 2026-05-15 §9 rank 2*
