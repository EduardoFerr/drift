# Threat Model — Verify Worker Boundary

| Field         | Value                                                                                  |
|---------------|----------------------------------------------------------------------------------------|
| Title         | Verify Worker — Schnorr `verifyEvent` em Web Worker dedicado · threat model            |
| Date          | 2026-05-16                                                                             |
| Author        | Barney (peer review crítico — security / threat modeling)                              |
| Status        | Draft · pareia com RFC Ted (`Docs/rfcs/2026-05-rfc-verify-worker.md`, mesmo dia)       |
| Manifesto     | §5 pipeline canônico, §7 determinismo, §8 nsec, §10 cliente leve, §17 sem chave mestra |
| Arquitetura   | v5.3 · CLAUDE.md invariantes #1, #5, #6, #7, #8                                        |
| Relacionado a | RFC perf round 10 (`Docs/rfcs/2026-05-rfc-perf-architecture-round-10.md`), Lily long-task audit (`Docs/sessions/lily-long-task-audit-2026-05-15.md` §6/§9 rank 2), supply-chain audit (`Docs/security/supply-chain-audit-2026-05-15.md`), CSP policy (`Docs/security/csp-policy-2026-05-15.md`) |
| Escopo        | T1–T6 do boundary main↔worker introduzido ao mover `verifyDriftEvent` (Schnorr secp256k1) pra worker dedicado |

Este documento é **prereq de arquitetura** pra Ted incorporar no RFC do
verify worker. Não é code review (não houve implementação). Roda em
paralelo com o RFC mesmo dia (2026-05-16) — recomendações P1 abaixo são
gates duros pra Ted ratificar antes de PR de implementação.

---

## TL;DR

Mover `verifyDriftEvent` do main thread pra worker dedicado entrega ~500-2000 ms
de scripting/min em verify-storm (Lily §2.5, rank 2 deferred). **Não muda
o contrato canônico de §5** desde que o boundary preserve a ordem
**verify ANTES de persist** — e isso é design choice, não consequência
automática. Há **6 threats novos** no boundary cross-thread:

| # | Threat                                                       | Sev   | Mitigação P1 |
|---|--------------------------------------------------------------|-------|---|
| **T1** | Race: main persiste antes do worker confirmar verify         | Crítica | Boundary half-duplex — main NUNCA chama `persist` antes de receber `{ok: true}` do worker |
| **T2** | XSS injeta payload no worker → forja `verify: true`          | Alta  | Worker isolado por origin + CSP `worker-src 'self' blob:` (já existe). SRI no chunk `verify-worker-*.js` (extender `inject-sri.mjs`) |
| **T3** | Backpressure flood: atacante satura queue do worker          | Alta  | Cap de queue 5000; drop NEWEST + warning. Métricas exportáveis |
| **T4** | Drop policy hostil: drop oldest faria atacante deslocar legítimo | Média | Drop NEWEST (não OLDEST), idempotência cross-relay protege casos limite |
| **T5** | Worker init falha → fallback sync (DoS via worker break)     | Média | Sem fallback automático. Banner `BootView` "verify degraded — refresh", boot bloqueia |
| **T6** | Worker comprometido lê `event.content` (vazamento contextual)| Baixa | Sem mitigação extra — content é público no Nostr; worker só vê payload assinado |

**Invariantes preservados (não-negociáveis):**

- §1 — `onNostrEvent` continua sendo ÚNICA porta de INSERT em domínio.
  Worker NÃO escreve no SQLite. Worker só faz verify Schnorr → retorna
  `{eventId, ok: boolean}`. Main thread, após receber `ok`, chama
  `handler.persist()` no pipeline existente.
- §5 — Ordem `kind → schema → verify → persist` preservada literal. A
  3a fase agora é assíncrona, mas só termina antes do 4o passo iniciar.
- §7 — Schnorr é determinístico (`verifyEvent(e)` retorna mesma resposta
  pra mesmo input em main ou worker). Worker mudar não muda resultado.
- §8 — Worker NÃO tem acesso a nsec. Só vê `event = {pubkey, content, sig, tags}`
  que já é público assinado. nsec continua APENAS em `identity.ts` no main.

---

## 1. Modelo de adversário

| Adversário                                | Capacidade                                                                                            | Aplicável a |
|-------------------------------------------|-------------------------------------------------------------------------------------------------------|-------------|
| **A1 — Atacante via Nostr (event flood)** | Publica milhares de eventos por segundo em relays que o cliente está subscribed. Pubkey descartável.  | T3, T4      |
| **A2 — XSS in-process** (parcial)         | Conseguiu injetar script via `style-src 'unsafe-inline'` exploit residual ou vetor não-coberto por CSP. Limitado: `script-src 'self'` (sem unsafe-inline/eval) bloqueia execução direta. | T2          |
| **A3 — CDN/Vercel compromise**            | Servir bytes alterados do chunk `verify-worker-*.js` sob mesmo filename hash.                          | T2          |
| **A4 — Browser extension hostil**         | Mesmo-origem com qualquer página, pode injetar scripts em qualquer window.                            | T2 (parcial), T6 |
| **A5 — Estado-nação / observador de rede**| Lê tráfego TCP/WSS. Fora de escopo deste threat model (cobertos em CSP/WebRTC ICE/Tor docs).          | Out-of-scope |
| **A6 — Atacante in-process com nsec já comprometida** | Pode forjar `Date.now()`, ler IndexedDB, exfilar nsec.                                       | Out-of-scope (já é game-over per webrtc-ice doc) |

Adversário-base de referência: **A1** (flood via Nostr). É o adversário
realista e contínuo — não requer 0day, só pubkey + relay e custo zero
(spam é o caso esperado em qualquer rede aberta).

A2/A3 são consideráveis sob threat model do supply-chain audit (T1
maintainer hijack, T3 npm cache poisoning) — supply-chain audit
2026-05-15 já cobriu o vetor de upload (nostr-tools, @noble/secp256k1,
@noble/hashes). Deps do worker chunk ESTÃO no escopo do audit existente
(seção 2: `nostr-tools`, `@noble/secp256k1`, `@noble/hashes` classificados
"alta criticidade"). Veredito: deps audit-clean, mas SRI extra recomendado
(P3 do supply chain → promovido a P2 aqui por causa do boundary novo).

---

## 2. Threats T1–T6

### T1 · Race main↔worker — persist antes de verify confirmar

| Campo             | Valor |
|-------------------|---|
| Adversário        | A1 (event flood) + design bug |
| Vetor             | Pipeline canônico atual (`events.ts:124-139`) é **sync no main**: `verifyDriftEvent` retorna `boolean` direto antes de `handler.persist`. Mover verify pra worker introduz `await` ou callback no meio do pipeline. Se Ted implementar com `worker.postMessage({event, id}); /* outro código roda aqui */; on('message', () => persist())`, há janela onde main pode receber OUTRO evento via `sync.ts:220-223` e chamar `onNostrEvent` reentrant. Se a 2a chamada não aguardar o resultado do worker pro 1o evento, ou se o pipeline persistir baseado em queue position (não em verify ack), **um INSERT pode acontecer pra evento cuja signature ainda não foi verificada**. |
| Pré-requisito     | Implementação do worker boundary que não preserve a invariante "persist só roda após receber ack do worker correspondente ao eventId" |
| Impacto           | **Integridade — crítica**. Atacante publica evento com signature inválida → cliente persiste no SQLite. Quebra invariante CLAUDE.md #5 e #1. Manifesto §5 (pipeline canônico) viola. |
| Probabilidade     | Alta SEM design discipline. Race condition é o caso esperado em código multi-threaded sem locking explícito. |
| Severidade        | **Crítica** — viola contrato fundamental "evento inválido NUNCA persiste". |
| Mitigação P1      | **Boundary half-duplex assíncrono por eventId**: main envia `{type: 'verify', id, event}` ao worker; main armazena `pending: Map<id, Promise<boolean>>`. `onNostrEvent` await na resolução do Promise antes de chamar `handler.persist`. NÃO usar evento-por-evento RPC sync (`Atomics.wait`/`SharedArrayBuffer`) — bloqueia main thread, derrota o propósito. Usar `postMessage` + correlação por id, padrão idêntico ao `db.ts:51-58` (`call<T>(type, payload)`) que já funciona em prod. |
| Mitigação P2      | Test conformance em `tests/verify-worker.test.ts` que mock-fail o worker e verifica que `persistPost` NUNCA é chamado pra evento cujo `verify: false` veio do mock. |
| Mitigação P3      | Adicionar log line em `events.ts:138` (após `await handler.persist`) com `console.debug('[onNostrEvent] persisted', event.id)` em DEV — facilita catch de race em manual testing. |

### T2 · Worker chunk comprometido — verify forjado como `true`

| Campo             | Valor |
|-------------------|---|
| Adversário        | A2 (XSS injection), A3 (CDN compromise), A4 (extension) |
| Vetor             | Worker é mesmo-origem mas é arquivo `.js` separado. Atacante que substitui bytes do `dist/assets/verify-worker-*.js` (A3) ou que injeta `<script>` antes do worker spawn e sobrescreve `Worker.prototype.postMessage` (A2/A4) pode fazer worker SEMPRE retornar `{ok: true}` sem rodar Schnorr. Main thread, confiando no worker, persiste eventos com signature inválida. Resultado: atacante publica posts/spreads/buries forjados em nome de qualquer pubkey. |
| Pré-requisito     | Ataque ao bundle (A3) ou XSS prévio (A2) ou extensão hostil (A4). A2 hoje é altamente improvável (CSP `script-src 'self'` bloqueia inline; `style-src 'unsafe-inline'` não permite execução JS). |
| Impacto           | **Integridade — crítica** se concretizado. Mas adversário com A3 já tem capacidade ampla — pode substituir `events.ts:onNostrEvent` direto. Worker não é a única superfície. |
| Probabilidade     | **Baixa** sob defesas atuais (CSP estrito + SRI baseline em dist). Mas a superfície agora é 1 chunk a mais — extensão direta do mesmo vetor. |
| Severidade        | **Alta** se mitigação SRI não cobrir o worker chunk. Mesmo nível de severidade que comprometimento de `index-*.js`. |
| Mitigação P1      | **Estender `scripts/inject-sri.mjs`** pra cobrir chunks de worker (`verify-worker-*.js`, `db.worker-*.js`). Hoje SRI cobre `<script type="module">` + `<link rel="modulepreload">` + `<link rel="stylesheet">` (CSP doc §script-src). **Workers NÃO têm `integrity` attribute nativo** (browser quirk: `new Worker(url)` ignora integrity). Workaround documentado em web.dev SRI: fetch o chunk via `fetch(url)` → `crypto.subtle.digest('SHA-384', bytes)` → compare com hash baked-in via build, então `new Worker(URL.createObjectURL(blob))` se match. Custo: 1 fetch extra no init. Justificado pela criticidade. |
| Mitigação P2      | Worker isolation reforçado: confirmar `worker-src 'self' blob:` cobre o pattern Worker-via-blob (CSP doc §worker-src já permite — sem mudança). |
| Mitigação P3      | Conformance test em `tests/cwv-conformance.test.ts` (S2 SRI section) que valida hash do chunk `verify-worker-*.js` está presente na lookup table do `verify-worker-loader.ts` (ou onde quer que Ted decida materializar a hash baseline). |
| Cross-link        | Supply-chain audit `2026-05-15.md` §4 T4 "Compromise de pacote crítico (nostr-tools)" — mesmo vetor mas no upstream. SRI baseline (P4 lá) endereça ambos. **Recomendação:** Barney P4 do supply chain (SRI baseline de bundle final) **promovido a P2** pela introdução do worker chunk novo. |

### T3 · Backpressure flood — atacante satura queue do worker

| Campo             | Valor |
|-------------------|---|
| Adversário        | A1 (event flood via Nostr) |
| Vetor             | Atacante com pubkey burner publica milhares de eventos forjados (kind 9078 com `drift-version` válido pra passar schema check cheap, signature inválida — não importa, atacante quer só entrar no pipeline). Subscribe Drift (`SUBSCRIBE_LIMIT = 500` por relay × 4 relays = 2000 evento burst no boot, mas pós-EOSE não tem cap real). Pipeline atual processa esses eventos sequencial no main em microtasks. Mover verify pra worker introduz uma queue intermediária: enquanto worker processa eventos válidos, atacante pode encher a queue com lixo. Se queue não tem cap, memória cresce ilimitado (DoS). Se queue tem cap, drop policy importa (T4). Se worker é single-threaded, latência cresce — events legítimos esperam atrás do lixo. |
| Pré-requisito     | Atacante com pubkey + acesso a publicar em qualquer relay do cliente |
| Impacto           | **Disponibilidade — alta**. DoS no pipeline de eventos. Feed para de atualizar. Score recalc atrasa. UX degraded até queue drain. Memória pode crescer descontrolada. |
| Probabilidade     | **Alta** — spam é caso esperado em rede aberta. Não requer ataque sofisticado. |
| Severidade        | **Alta** — viola §10 (cliente leve) e indiretamente §13 (LCP target). Não viola integridade (eventos lixo são rejeitados no verify, só desperdiçam recursos). |
| Mitigação P1      | **Cap de queue: 5000 eventos pendentes**. Suficiente pra absorver burst inicial (2000 do subscribe) + 3x margem. Acima disso, drop NEWEST (vide T4) com `console.warn` log em DEV. |
| Mitigação P1      | **Cheap schema check NA QUEUE em main** ANTES de enviar pro worker. Hoje `handler.validate` já roda no main (`events.ts:131`); manter essa ordem. Eventos com schema inválido NÃO entram no worker — economia massiva sob A1 que envia lixo com tag `drift-version` mas formato quebrado. Pipeline mantém: kind → schema (main, cheap) → enqueue pro worker → worker faz verify caro → ack volta → persist (main). |
| Mitigação P2      | **Métricas exportáveis**: `verifyWorkerMetrics: { queueSize, eventsVerifiedTotal, dropped: { sinceBoot, last1min }, workerLatencyP95 }`. Expor em `DiagnosticPanel` (já existe pra sync.ts:RecentEvent — padrão estabelecido). Útil pra debug em prod e pra user ter visibilidade quando o pipeline degrada. |
| Mitigação P2      | **Worker reset auto** se queue saturada por > 30s (queue ≥ 4500 por > 30s sustentado): terminate worker, novo spawn, drop queue em flight. Trade-off: alguns eventos legítimos perdidos. Mas idempotência cross-relay (`INSERT OR IGNORE`) significa eventos repetem via subscribe — recuperação é natural. Sem reset, atacante pode segurar o worker em saturação indefinidamente. |
| Mitigação P3      | **Rate limiting por pubkey origem**: se 1 pubkey envia > 50 eventos/s sustained, gate temporário (5 min) — eventos dessa pubkey entram em lane secundária de baixa prioridade. **Não fazer no MVP**: complexidade alta, manifesto §22 (sem reputação subjetiva) precisa interpretação cuidadosa. Defer pra Fase 7 se métricas mostrarem ataque real. |

### T4 · Drop policy hostil — atacante força drop de eventos legítimos

| Campo             | Valor |
|-------------------|---|
| Adversário        | A1 |
| Vetor             | Se queue cap = 5000 e drop policy = **OLDEST**, atacante envia 5001 eventos lixo. Os 5000 lixo enfileiram. Quando 5001o entra, oldest é dropado — pode ser evento legítimo que entrou primeiro mas estava na cauda da fila esperando worker. Atacante força drop de eventos legítimos sustentadamente. Pipeline mantém superfície de DoS contra disponibilidade. |
| Pré-requisito     | Drop policy = OLDEST + cap finito |
| Impacto           | **Disponibilidade — média**. Eventos legítimos perdidos. Mas idempotência cross-relay mitiga: relay reenvia, eventos voltam. Não é dado perdido permanente — só latência adicional. |
| Probabilidade     | **Alta sob A1** se drop = OLDEST. |
| Severidade        | **Média** — perda recuperável via relays. Mas combina com T3 pra fazer DoS de feed updates. |
| Mitigação P1      | **Drop NEWEST, não OLDEST**. Justificativa: eventos que CHEGARAM primeiro têm prioridade de processamento (FIFO). Atacante que tenta encher só consegue que SEUS PRÓPRIOS eventos sejam dropados (os mais recentes na fila). Eventos legítimos que entraram antes do flood permanecem na queue e são processados. Sob A1, drop=NEWEST minimiza ataque eficácia. |
| Mitigação P2      | Combinar com T3 mitigation 1: cheap schema check antes da queue elimina maior parte do lixo (signature inválida no flood ainda passa schema porque schema não verifica sig, mas a maior parte do lixo de atacante real falha no schema também — formato Drift é específico). |
| Mitigação P3      | Log line em DEV: `console.warn('[verify-worker] queue full, dropping NEWEST', eventId)` — facilita catch de flood em manual testing. NÃO logar em prod (overhead + memória + dá pista pro atacante que ele acertou cap). |

### T5 · Worker init falha — DoS via worker break

| Campo             | Valor |
|-------------------|---|
| Adversário        | A1 (induzido), A2 (direto), bug do browser/runtime |
| Vetor             | Worker spawn pode falhar por: (a) `Worker` API indisponível (browser velho, mas Drift já requer crossOriginIsolated, então API existe); (b) chunk `verify-worker-*.js` 404 (deploy ruim, CDN issue); (c) WASM module init crash dentro do worker; (d) atacante com extensão hostil substitui `new Worker` por throw. Se Ted implementar fallback **sync no main** quando worker falha, atacante que consegue derrubar worker (extensão A4 ou bug) força cliente a rodar verify sync — derrotando o propósito de mover. Sob A1 (flood) + fallback sync, INP volta a 200-500ms — degradação visível mas não fatal. Sob A2 (XSS substitui worker spawn), pior: atacante força fallback sync mas combina com T2 (XSS já pode comprometer verify sync também — game over genérico). |
| Pré-requisito     | Fallback sync no main quando worker falha |
| Impacto           | **Disponibilidade — média**. Degradação UX, não perda de integridade. |
| Probabilidade     | **Baixa** — Worker é API estável. Maior risco: deploy ruim (CDN serve 404 pro chunk). |
| Severidade        | **Média**. Combinado com T2/T3 pode esconder ataque mais grave. |
| Mitigação P1      | **SEM fallback automático sync no main**. Worker init falha → boot bloqueia em `BootView` com banner explícito: "Verify worker indisponível — atualize ou tente em outro browser. Detalhe técnico: <error.message>". Refresh button + bug report link. Justificativa: §10 (cliente leve) presume que verify worker FUNCIONA; sem ele o cliente não atende contrato §5. Melhor falhar visível que degradar silencioso. |
| Mitigação P2      | **Timeout no init** (paralelo ao `INIT_TIMEOUT_MS = 15_000` do `db.ts:21`): 10s pra worker reportar `{type: 'ready'}`. Se timeout, mesmo path do P1 (banner + refresh). Sem timeout, worker engasgado trava boot indefinido. |
| Mitigação P2      | **Health check periódico**: ping/pong com worker a cada 60s. Se 3 pings sem pong, mesmo path (banner + reload). Combina com T3 worker reset auto. |
| Mitigação P3      | Documentar em `BootView`/erro panel: link pra issue tracker pra user reportar falha de worker init com `navigator.userAgent` + último log. Telemetria opt-in (manifesto §4 anonimato — sem telemetria automática). |
| Cross-link        | `db.ts:108-115` (`worker.onerror`) já estabelece padrão de "rejectAllPending(reason)" quando worker quebra. Verify worker deve seguir o mesmo template — `events.ts` recebe erros via `pending: Map<id, Promise<boolean>>` rejection, propaga pra `onNostrEvent` que log+skip o evento. |

### T6 · Cross-origin worker access — extension ou iframe injection

| Campo             | Valor |
|-------------------|---|
| Adversário        | A4 (extensão hostil), iframe injection com CSP misconfigured |
| Vetor             | Worker é mesmo-origem (`worker-src 'self'`, CSP doc §worker-src). Atacante NÃO consegue spawn worker do Drift origin a partir de outra origem (browser bloqueia). Mas: (a) **extensão hostil** com permissão `<all_urls>` injeta script em qualquer page → consegue ler `postMessage` traffic entre main↔worker, e potencialmente modify `Worker.prototype.postMessage`; (b) **iframe-Drift dentro de site malicioso** — bloqueado por `frame-ancestors 'none'` (CSP doc §frame-ancestors); (c) **Drift dentro de iframe LEGÍTIMO** (futuro: embed em outro app?) — não há roadmap pra isso, fora de escopo. |
| Pré-requisito     | (a) Extensão hostil instalada **e** com permissão pra Drift origin |
| Impacto           | **Confidentiality — baixa**. Worker só vê `event = {pubkey, content, sig, tags}` que JÁ É PÚBLICO no Nostr (assinado, broadcast em relays). Não há segredo no worker. Atacante que lê postMessage entre main↔worker não ganha info que não conseguiria via relay subscribe direto. |
| Probabilidade     | Baixa em geral, alta entre users com extensões shady. Drift não tem como prevenir extensões hostis. |
| Severidade        | **Baixa**. Worker boundary não AUMENTA superfície confidencial (já era pública). |
| Mitigação P1      | **Nenhuma adicional**. CSP `frame-ancestors 'none'` (já existe) cobre embed hostil. Extensão hostil é threat model out-of-scope (manifesto §17 — cliente não pode defender de extensão que user instalou voluntariamente). |
| Mitigação P2      | Documentar em policy: "Worker tem mesmas garantias de privacidade que main thread. Não há segredo dentro do worker. nsec NUNCA passa o boundary main↔verify-worker." (vide §3 abaixo) |
| Mitigação P3      | Conformance test: grep pra confirmar que `nsec`/`identity.nsec`/`nsecHexToBytes` NÃO aparecem em `src/lib/verify-worker.ts` (futuro arquivo). Hoje `nostr.ts:21` importa `nsecHexToBytes` no main; worker NÃO deve importar `identity.ts` direto. |

---

## 3. Invariantes preservados — checklist pra Ted incorporar no RFC

### 3.1 Invariante #1 (CLAUDE.md) — onNostrEvent ÚNICA porta INSERT em domínio

**NÃO** colocar INSERT no worker. Boundary correto:

```
Worker side (verify-worker.ts):
  onmessage = ({id, event}) => {
    const ok = verifyEvent(event)        // pure crypto
    postMessage({id, ok})                // no DB, no INSERT
  }

Main side (events.ts:onNostrEvent):
  if (!handler.validate(event)) return   // cheap schema (main)
  const ok = await verifyAsync(event)    // worker round-trip (await)
  if (!ok) return
  await handler.persist(event)           // INSERT (main, via db.ts → db.worker)
```

Conformance test:

- `tests/manifesto-conformance.test.ts` deve falhar se `src/lib/verify-worker.ts`
  contiver `import .* db` ou `INSERT|UPDATE|DELETE` (regex em strings).
- Hoje invariante #1 é validado em `tests/manifesto-conformance.test.ts:655-679`
  por path literal (`src/lib/events.ts` é única source de `INSERT INTO posts`).
  Adicionar regex anti-INSERT em verify-worker mantém o spirit.

### 3.2 Invariante #5 — ordem pipeline cheap → expensive → persist

Manter ordem **kind → schema → verify (now async) → persist** literal.
**Schema check fica no main** (não migrar pro worker):

- Razão 1: schema é cheap (< 0.1ms), round-trip ao worker custa mais que o
  check em si.
- Razão 2: schema check é gate ANTES do worker queue — eventos lixo nem
  entram no worker (mitigação T3).
- Razão 3: `handler.validate` em `events.ts:131` referencia `KIND_DISPATCH`
  que é uma lookup table estática (events.ts:96-122). Mover isso pro worker
  duplicaria a tabela ou exigiria import — refactor maior sem ganho.

### 3.3 Invariante #6 — recalc score debounced

Sem mudança. `scheduleScoreRecalc(postId)` continua no main em `persist*`
handlers (events.ts:649-661). Worker não conhece score recalc.

### 3.4 Invariante #7 — determinismo

Schnorr é determinístico. Worker rodando `verifyEvent` produz mesmo
resultado que main rodando `verifyEvent`. **Nenhuma mudança semântica.**

Conformance:
- Teste em `tests/verify-worker.test.ts` (novo): assina 100 eventos
  fixture conhecidos, verifica via worker, compara com fixture pre-computed
  de `verifyEvent` sync. Match exato.

### 3.5 Invariante #8 — nsec nunca sai do dispositivo (e nunca entra no worker)

**Worker NÃO importa `identity.ts`.** Worker recebe apenas eventos JÁ
ASSINADOS (`SignedEvent = {pubkey, content, sig, tags, id, kind, created_at}`).
Tudo é público.

`finalizeEvent` (que usa nsec) continua APENAS em `nostr.ts:47` (signing
path). Verify path (worker) é pubkey-only — `verifyEvent` deriva pubkey
de cada evento e checa sig.

Conformance:
- Adicionar regex em `tests/manifesto-conformance.test.ts`: arquivo
  `src/lib/verify-worker.ts` NÃO contém `nsec|finalizeEvent|generateSecretKey|getOrCreateIdentity`.

### 3.6 Invariantes adicionais (boundary-specific)

| # | Regra                                                                  | Verificação |
|---|------------------------------------------------------------------------|---|
| BW1 | Worker fala APENAS via `postMessage` correlacionado por `id`         | Code review |
| BW2 | Main thread NUNCA chama `persist` antes de `await verifyAsync` ack   | T1 test |
| BW3 | Worker NÃO importa `db`, `identity`, `crypto.ts` (master key)        | Grep test |
| BW4 | Worker importa APENAS `nostr-tools/pure` (verifyEvent) + @noble deps | Audit chunk size + import graph |
| BW5 | Queue tem cap finito (5000), drop NEWEST                             | T3/T4 test |
| BW6 | Worker init failure bloqueia boot com banner explícito (no sync fallback) | T5 test |

---

## 4. Audit cripto — chunk worker

Worker chunk estimado (estimativa de Ted no RFC, sujeita a verificação
em build real):

```
verify-worker-*.js
├── verifyEvent (nostr-tools/pure)            ← exportado
│   ├── schnorrVerify (secp256k1 BIP-340)
│   ├── sha256 (event.id derivation)
│   └── getEventHash
├── @noble/secp256k1                          ← Schnorr primitives
└── @noble/hashes                             ← SHA-256
```

**Audit status (cross-link supply-chain audit 2026-05-15):**

- `nostr-tools` (^2.7.0) — "alta criticidade", maintainer fiatjaf + nbd-wtf,
  ativo, auditado pelo ecossistema Nostr. ✅
- `@noble/secp256k1` (transitiva via `@scure/*` ou via `nostr-tools/pure`) —
  Paul Miller (paulmillr), reputable, foco em crypto minimal. ✅
- `@noble/hashes` — mesma fonte (paulmillr). ✅

Veredito: deps do worker chunk **estão dentro do conjunto auditado** em
supply-chain audit §2 "Direct dependencies — risk assessment". Não há
dep nova introduzida pelo worker. Reuso direto do que já roda em prod.

**Recomendação cripto-side:** Worker deve usar **exatamente os mesmos
imports** que `nostr.ts:14` (`import { verifyEvent } from 'nostr-tools/pure'`).
NÃO usar `nostr-tools` barrel (RFC perf round 10 §2.3 documenta pitfall:
barrel re-exports impedem tree-shaking). Já é prática estabelecida.

---

## 5. Backpressure design — recomendações ranqueadas pra Ted incorporar

Sumário das recomendações de mitigação T3/T4/T5 numa view única:

| # | Recomendação                                                   | Mapped to | Esforço RFC |
|---|----------------------------------------------------------------|-----------|---|
| **P1.1** | Cap de queue: 5000 eventos pendentes                      | T3        | 0.5h |
| **P1.2** | Drop policy: NEWEST (atacante consome seu próprio drop)    | T4        | 0.1h |
| **P1.3** | Cheap schema check ANTES de enqueue no main                | T3        | 0h (já existe em `events.ts:131`) |
| **P1.4** | Boundary half-duplex por eventId — main aguarda ack worker antes de persist | T1 | 1h |
| **P1.5** | SEM fallback sync no main quando worker quebra              | T5        | 0h (decisão de design) |
| **P1.6** | Estender `scripts/inject-sri.mjs` pra cobrir worker chunks  | T2        | 2h |
| **P2.1** | Worker reset auto se queue saturada > 30s                   | T3        | 2h |
| **P2.2** | Health check periódico (ping/pong 60s)                      | T5        | 1h |
| **P2.3** | Métricas exportáveis (queueSize, dropped, P95 latency) em DiagnosticPanel | T3 | 3h |
| **P2.4** | Timeout no init (10s) com BootView banner explícito         | T5        | 0.5h |
| **P3.1** | Log lines DEV pra drop NEWEST + race + worker errors        | T3/T4     | 0.5h |
| **P3.2** | Rate limiting por pubkey (deferred — Fase 7+)               | T3        | N/A |

**P1 são gates duros** — RFC do Ted deve incorporar TODOS. P2 são strongly
recommended antes de shippar GA (não bloqueia merge inicial mas bloqueia
ratchet promoção em `cwv-conformance.test.ts`). P3 são polish.

---

## 6. Cross-references e dependências

### Threat models siblings
- `Docs/security/webrtc-ice-threat-model-2026-05-15.md` — Barney mesmo
  pattern (T1-T6 + adversários A1-A5). Estilo coerente.
- `Docs/security/supply-chain-audit-2026-05-15.md` — §2 cobre deps que
  vivem no worker chunk (nostr-tools, @noble/*). P4 SRI baseline citado
  acima como dep de mitigação T2.
- `Docs/security/csp-policy-2026-05-15.md` — §worker-src `'self' blob:`
  cobre o pattern atual; verify worker reusa sem mudança.
- `Docs/webrtc-threats.md` — pattern de drop policy e queue cap (T-WRTC-014
  rate limit) é precedente. Reusar formulação.

### RFC siblings
- `Docs/rfcs/2026-05-rfc-verify-worker.md` — RFC do Ted que este doc
  pareia (mesmo dia 2026-05-16). Este threat model é prereq de aceitação
  do RFC.
- `Docs/rfcs/2026-05-rfc-perf-architecture-round-10.md` — §2 bundle
  chunking strategy. Novo chunk `verify-worker-*.js` deve seguir as regras
  de chunking documentadas lá (deve ser lazy? eager? — decisão de Ted no
  RFC; recomendação Barney: **eager** porque verify roda em todo evento
  via subscribe pós-boot, lazy adiciona latência ao primeiro burst).
- `Docs/sessions/lily-long-task-audit-2026-05-15.md` §6 rank 2 e §9 rank
  2 "Mover `verifyDriftEvent` pro worker" — motivação original. §2.5
  estima ganho 500-2000ms scripting/min sob verify-storm.

### Manifesto
- §5 pipeline canônico cheap → expensive → persist → recalc → invalidate
- §7 determinismo (Schnorr é deterministic ✓)
- §8 nsec nunca sai do dispositivo (worker NÃO recebe nsec)
- §10 cliente leve (mover verify off main thread é entrega §10)
- §13 LCP ≥ 95 Lighthouse Performance (libera main thread de verify storm)
- §17 sem chave mestra (worker NÃO é vetor de chave mestra — só verifica
  signatures públicas)

### CLAUDE.md invariantes
- #1 — onNostrEvent única porta INSERT (BW1, BW3 acima)
- #5 — ordem pipeline (BW2 acima)
- #6 — recalc debounced (preservado por design)
- #7 — determinismo (Schnorr determinístico)
- #8 — nsec (BW3 acima)

---

## 7. Próximos passos

1. **Ted incorporar P1.1-P1.6 no RFC** (mesmo dia, 2026-05-16). RFC sem
   essas mitigações não passa Barney sign-off.
2. **Marshall criar fixture deterministic** em `tests/fixtures/verify-worker/`:
   100 eventos {válidos: 70, signature inválida: 20, schema inválido: 10}.
   Test compara verify worker output com verify sync output (must match
   exato pra válidos+inválidos).
3. **Implementation PR** referenciar este doc + RFC Ted no commit message.
   Conformance tests (BW1-BW6) merge no mesmo PR.
4. **Pós-merge**: profile real device (Lily §10.1) com worker ativo,
   capturar verify-storm trace. Target: zero long task > 50ms no main durante
   subscribe burst de 500 events.
5. **Promoção SRI**: supply-chain audit P4 → P2 (este doc), aplicar
   extensão de `inject-sri.mjs` cobrindo workers no mesmo PR ou
   imediatamente após.

---

*Threat model executado por Barney 2026-05-16. Pareia com RFC Ted mesmo
dia. Audit cruzado com supply-chain audit (2026-05-15) e CSP policy
(2026-05-15). Reproduzir threats T3/T4 em manual: publicar 5000+ eventos
com pubkey burner em relay local; observar `verifyWorkerMetrics.dropped`
> 0 e `queueSize` ≤ 5000 sustained.*
