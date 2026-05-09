# `network_mode: 'auto'` — algoritmo de detecção de censura + fallback Tor

**Data:** 2026-05-08
**Persona:** Robin (research, curadoria, gaps cross-cutting, docs)
**Escopo:** especificação de algoritmo concreto pra detectar bloqueio
de relays Nostr clearnet e ativar Tor automaticamente. Pseudocódigo,
parâmetros, edge cases — entregável pra Marshall + Lily implementarem
literalmente.
**Não-escopo:** TypeScript pronto pra colar; ADR arquitetural (Ted em
paralelo); threat model formal (Barney em paralelo); implementação no
testbed (Marshall + Robin Fase A do §15 testbed).
**Disparo:** `Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md` §7
item 4 (modo `auto` deferred) + §2 surpresa 1 (`auto` declarado em
arquitetura, ausente em código). Ted ADR cobre "onde mora" e "owner";
este doc cobre "como decide".

> ⚠ **ARTEFATO DE SESSÃO** — research doc. Não é norma de
> implementação até Arquiteto aprovar e propagar pra
> `Docs/fase-6-roadmap.md` ou `Docs/drift-arquitetura-v4.md`. Os
> parâmetros sugeridos (timeouts, thresholds, hysteresis) são pontos
> de partida calibráveis pelo testbed §15.

---

## §1 — Problem statement

### 1.1 Manifesto (verbatim)

`Docs/manifesto.md` §15 (linhas 289–310):

> **15. Anti-Censura por País**
>
> Um Estado-nação que tenta bloquear o Drift na sua jurisdição não
> deve conseguir mais do que tornar o uso menos conveniente.
>
> **Regras:**
> - Bloqueio por DNS é contornável (PWA + IP direto + Tor)
> - Bloqueio por SNI/DPI dos relays clearnet é contornável (Tor + WebRTC)
> - Bloqueio das app stores é contornável (APK direto, F-Droid, PWA)
> - Bloqueio do dev server / domínio do fundador não derruba a rede
> - Custo do adversário cresce com o uso: censurar 100 relays é mais
>   caro que censurar 4
>
> **Implementação:**
> - §12 (múltiplos transportes) + §14 (bootstrap distribuído) + §1
>   (cliente em múltiplas formas) — combinação que cumpre §15

E `Docs/manifesto.md` §7 (linhas 162–174):

> **7. Determinismo Global**
>
> Clientes independentes devem convergir para o mesmo estado lógico
> dado o mesmo conjunto de eventos.
>
> **Regras:**
> - Mesma entrada → mesma saída → sempre
> - Funções de negócio são puras (sem `Date.now()` implícito, sem I/O)

### 1.2 Gap restated

`Docs/drift-arquitetura-v4.md` §23.7 (linha 1024–1033) e §18 (linha
809) descrevem 3 modos:

```
DRIFT_TOR_ENABLED=auto   # auto | always | never
[Off] [Auto] [Always]
- Off    — só clearnet
- Auto   — tenta clearnet primeiro, faz fallback para Tor se bloqueado
- Always — só Tor (paranoia)
```

Mas `src/types/drift.ts:346` define:

```ts
export type NetworkMode = 'clearnet' | 'tor' | 'onion-only'
```

— sem `auto`. `bootstrap.ts:240–265` consulta `getPrefs().network_mode`
como string fixa. **Não há fallback automático clearnet→Tor
implementado.** Toggle é decisão manual pelo user em Settings.

A consequência prática (§15 scoping §3 cenário a): user que chega em
país censurado com cliente em modo `clearnet` vê app travar sem
banner explícito, abre Settings, troca pra `tor` manualmente,
recarrega. Só funciona se ele consegue chegar até a UI — **o que não
é trivial se DNS está bloqueado e o app não bootou**.

Pergunta deste doc: **dado que o app vai detectar "estou bloqueado"
empiricamente, como ele decide com confiança, em que cadência, com
que sensibilidade?** Saídas precisam ser:

1. **Concretas o suficiente** pra Marshall escrever testes Vitest e
   Lily plugar no `bootstrap.ts`.
2. **Conservadoras o suficiente** pra não acionar Tor em redes
   levemente flaky (false-positive frusta UX em país livre).
3. **Sensíveis o suficiente** pra não deixar user travado em país
   censurado (false-negative viola §15).
4. **Auditáveis** — telemetria local pro user ver "por que entrou em
   modo Tor" (manifesto §28: privacidade pelo mínimo, e §17
   auditável).

Inputs do problema:
- Lista de relays ativos (`activeReadRelays()` — `lib/relays.ts:314`)
- Tempo (boot, reconexões, transições foreground)
- Histórico de sucesso/falha por relay (`relays_user.last_ok_at`,
  `last_err`)
- Capability matrix do runtime (PWA vs Tauri+arti — descoberto em
  runtime via `isTauri()`)

Outputs:
- Decisão `{ mode: 'clearnet' | 'tor', reason: string, confidence: 'low' | 'high' }`
- Telemetria estruturada local (sem analytics — manifesto §28)
- Sinais pra UI (banner "tentando Tor…", "rede inacessível —
  recomenda Tor")

---

## §2 — Restrições do espaço de design

### 2.1 PWA vs Tauri (capability gap)

| Capability | PWA (browser) | Tauri (desktop/mobile com `--features arti`) |
|---|---|---|
| `WebSocket` clearnet | ✅ | ✅ (delegado a `TorWebSocket` quando modo tor) |
| Tor real (arti) | ❌ não existe | ✅ via IPC bridge (`torWebSocket.ts`) |
| Raw socket | ❌ navegador sandbox | 🟡 só via Rust side (não exposto ao TS) |
| ICMP / ping | ❌ | 🟡 não exposto ao TS no MVP |
| TCP connect timeout custom | 🟡 limitado pelo browser | ✅ (controlamos no Rust) |
| Geolocation API | ✅ se user permitir | ✅ |
| `navigator.connection` (NetworkInformation) | 🟡 só Chrome/Edge | n/a |
| `online`/`offline` events | ✅ | ✅ |
| Visibility API (foreground/background) | ✅ | ✅ |
| Resolver DNS forçado (DoH custom) | 🟡 fetch p/ resolver alternativo | ✅ Rust pode fazer |

**Implicação dura:** `auto-mode` em PWA puro **só pode detectar
bloqueio**, não pode **fazer fallback real**. Sem arti, não há Tor.

A decisão arquitetural correta é uma das duas:

- **(A) `auto` é Tauri-only.** PWA mantém `clearnet | tor* | onion-only*`
  com `*` = disabled (mantido pra portabilidade de prefs entre devices —
  user com prefs `tor` que abre PWA vê banner "Tor exige cliente
  nativo"). PWA detecta bloqueio e mostra banner "instale cliente
  nativo pra Tor automático" (ver §11 implementabilidade).
- **(B) `auto` em PWA significa "detectar bloqueio + alertar"**, sem
  fallback real. UI mostra banner "rede bloqueada — instale cliente
  nativo OU adicione relays alternativos".

Recomendação Robin: **(A)**. (B) introduz semântica nova ("detect-only
auto") que confunde — `auto` em arquitetura significa fallback. Manter
contrato consistente: `auto` requer Tauri + arti; PWA mostra `auto`
disabled em Settings com tooltip "requer Drift desktop". Decisão final
fica com Ted ADR — este doc assume (A) daqui em diante. **Se Ted
decidir (B), §4 algoritmo se reduz a §4 fase 1 (probe) sem fase 4
(switch); é subset.**

### 2.2 Manifesto §7 — determinismo

§7 exige funções de negócio puras: mesma entrada → mesma saída.
Aplicado a `auto-mode`:

- **Funções puras**: agregação de probe results em decisão
  (`aggregateProbeSignal(results, cfg, now) → Decision`). Tested via
  Vitest, sem I/O. Modelo: `lib/transport/policy/violationWindow.ts`,
  `pingPongTracker.ts` — 100% pure mutators sobre arrays passados.
- **Funções com I/O isoladas**: `runProbe(relay, timeoutMs)` (abre
  WebSocket, mede). I/O fica em camada fina, decisão pura por baixo.
  Mesmo padrão de `lib/probe.ts:probeRelay` atual.
- **Determinismo NÃO se aplica a side effects**: trocar para Tor é
  ação no runtime, não estado materializado dos eventos Nostr.
  Diferentes clientes podem tomar decisões diferentes (um detectou
  bloqueio, outro não) sem violar §7 — convergência §7 é sobre
  *estado lógico dos eventos*, não comportamento de transporte.

Implicação concreta: **a função de decisão é pura e testável**. A
camada de I/O ao redor (probe scheduler, cleanup de subscriptions)
é integration-testável (testbed §15 cobre).

### 2.3 Boot UX (latência baixa)

Bootstrap.ts hoje (linhas 163–328) tem caminho crítico:

```
isolation → db → identity → sync → ready
```

`startSync()` é onde os WebSockets abrem. Hoje, em rede saudável,
"ready" acontece em ~500ms-2s. **Probe não pode bloquear o boot.**

Opções:
- **(i) Probe paralelo a `startSync`**: probe roda em background;
  `startSync` segue clearnet imediatamente. Se probe detecta bloqueio
  em ~10s, banner "tentando Tor" aparece, e auto-switch reinicia o
  sync via Tor.
- **(ii) Probe síncrono pré-`startSync`**: bloqueia ready em ~10s.
  Cair fora.

Recomendação: **(i)**. Boot rápido em rede normal vence; o overhead
de "trocar pra Tor depois de 10s" só existe em rede censurada (e
nesse caso, 10s é melhor que infinito). Modelo: probe.ts já roda
async, não bloqueia boot.

### 2.4 False-positive vs false-negative

Trade-off central. Definições operacionais:

- **False-positive** (FP): app aciona Tor quando clearnet ainda
  funcionaria. Custo: 5-30s adicional de bootstrap Tor + overhead
  contínuo da circuit. UX ruim em rede legitimamente flaky.
- **False-negative** (FN): app não aciona Tor quando clearnet está
  bloqueado. Custo: user em país censurado vê app travado, viola §15.

Assimetria: **FN é pior eticamente** (manifesto compromisso). FP é
pior em escala (afeta 99% dos users em rede livre).

Estratégia: **threshold conservador pra detecção** + **fallback
agressivo de retorno a clearnet** (hysteresis curta de "Tor desliga
quando clearnet reaparece estável"). Detalhes em §4.

### 2.5 Adversário ativo

Manifesto §15 não é só contra ISP passivo. Ataques considerados:

- **Bloqueio total** (DNS + IP + SNI). Defesa: Tor.
- **Bloqueio parcial enganoso** (ISP responde com DNS spoofado pra
  relay falso). Defesa: probe valida assinaturas Schnorr nos eventos
  retornados (relay malicioso não consegue forjar event.id sem
  privkey). Já coberto por `verifyDriftEvent` em `nostr.ts`.
- **Bloqueio de Tor seletivamente** (ISP deixa clearnet passar e
  bloqueia 9001/443 de directory authorities Tor). Defesa: detectar
  que `torConnect()` falha consistentemente E clearnet também falha
  → modo `manual escalation` (UI pede ao user pra adicionar bridge,
  ou reportar — Fase 7 sneakernet input).
- **Forçar fallback pra clearnet** (adversário bloqueia Tor pra
  user que está em modo Tor manual, esperando que `auto` retorne pra
  clearnet, vazando IP). Defesa: hysteresis (Tor não desliga só
  porque um probe clearnet teve sucesso); usuário em modo `tor`
  manual NÃO entra em `auto` (separação dura). Detalhes em §6.
- **Side-channel timing attack via probe**: se probe schedule é
  determinístico (a cada exatamente 5min), atacante observa padrão e
  identifica "user Drift". Defesa: jitter na cadência. Detalhes em
  §6.

---

## §3 — Sinais de detecção possíveis

Lista exaustiva, com pros/cons. `*` marca sinais que entram no
algoritmo recomendado §4; outros são research alternatives.

### (a) Connection refused / DNS failure em wss://... `*`

**Como detectar:** abrir `new WebSocket(url)` e capturar `error`
event. NXDOMAIN ou ECONNREFUSED chegam como erro genérico no browser
(spec WHATWG WebSocket esconde causa pra evitar fingerprinting), mas
o tempo até `error` distingue:
- DNS failure: ~50-200ms (resolver imediatamente "not found")
- Connection refused: ~50-200ms (TCP RST imediato)
- Timeout: ~5-30s (TCP retry exhaustion)

No Tauri+arti, mais granularidade disponível via Rust side, mas pra
PWA-compatible, abstrair tudo como "open failed within Xs" basta.

**Custo:** muito baixo — 1 WebSocket open por relay. ~200ms em
sucesso, ~5-30s em failure (cap por timeout).

**False-positive rate:** baixa — connection refused/DNS failure são
sinais fortes. Pode haver FP em redes corporativas com proxy
transparente, mas raro.

**Vulnerabilidade adversária:** baixa — adversário não pode "fingir
sucesso" sem entregar conexão real. Adversário pode atrasar
indefinidamente (precisa de timeout — coberto por (b)).

### (b) Timeout > N seg (configurável) `*`

**Como detectar:** wrapping de `new WebSocket(url)` com `setTimeout`
que cancela e marca falha se `onopen` não chegou em Ns.

**Custo:** baixo — só consome um setTimeout slot. N=8s sugerido (ver
§4 calibração).

**False-positive rate:** **alta em mobile flaky** (3G ruim, túnel,
elevador). Mitigação: combinar com (e) retry-em-N-relays — não
acionar Tor por timeout em 1 relay isolado.

**Vulnerabilidade adversária:** moderada — adversário pode ficar
abaixo do threshold (bloquear 7s, deixar passar 9s) pra evitar
detecção. Mitigação: probe múltiplos relays em paralelo, usar agregado.

### (c) Sent EVENT, never received OK ou EOSE em janela `*`

**Como detectar:** após handshake bem-sucedido, manda subscription com
filter conhecido (kinds: [DRIFT_KIND.POST], limit: 1). Espera EOSE
ou pelo menos 1 event em janela.

**Custo:** moderado — handshake completou, subscription consumiu 1
RTT. ~1-3s em sucesso.

**False-positive rate:** moderada — relay sobrecarregado pode demorar
genuinamente. Mitigação: timeout generoso (10s).

**Vulnerabilidade adversária:** **alta**. Adversário sofisticado opera
relay que aceita subscribe mas nunca entrega events Drift (filter
discrimina kinds 9078-9081). Defesa: probe cruza com Schnorr — se
nenhum evento chega, podemos ainda inferir bloqueio mesmo se a
conexão está "viva". Já é o modelo do `lib/probe.ts:runProbe` (que
checa eventos *conhecidos*). Reusable.

### (d) WebSocket close abrupto após handshake `*`

**Como detectar:** `ws.onopen` dispara, depois `ws.onclose` em <2s
sem mensagem trocada. Especialmente código 1006 (abnormal close) sem
fin.

**Custo:** muito baixo.

**False-positive rate:** baixa — fechamento abrupto pós-handshake é
sinal forte (DPI inspecting payload e cortando).

**Vulnerabilidade adversária:** baixa — caro pro adversário fingir
"open ok" e fechar instantâneo (precisa do TLS handshake completo).

### (e) Sucessivas falhas em N relays distintos no boot `*`

**Como detectar:** agregar resultados de (a)-(d) sobre N relays em
paralelo. Threshold: ≥66% falhou → "censurado".

**Custo:** depende do batch (N=4 sugerido).

**False-positive rate:** baixa quando combinada — improvável que
3 de 4 relays geograficamente diversos falhem por azar.

**Vulnerabilidade adversária:** mitigação de (b): adversário precisa
bloquear todos os N pra evitar detecção, o que aumenta custo (manifesto
§15 "censurar 100 relays é mais caro que 4").

### (f) Probe nostr.band (ou outro relay "canário")

**Como detectar:** relay específico que sabemos estar online em rede
livre. Se canary falha, é sinal.

**Custo:** muito baixo (1 conexão).

**False-positive rate:** depende do canary. Se relay morrer, FP
explode pra todos os users.

**Vulnerabilidade adversária:** **alta**. Adversário identifica
canary (publicado em código open-source) e bloqueia *primeiro*.
**NÃO recomendado.** Em vez disso, usar (e) sobre lista dinâmica de
relays do user (`activeReadRelays()`).

### (g) Sinais externos (Geolocation API)

**Como detectar:** consultar `navigator.geolocation` com permissão do
user → país conhecido censurado → preempt Tor.

**Custo:** baixo (uma chamada).

**False-positive rate:** alta — VPN, proxy, viagem. User italiano
visitando China em férias não quer Tor automaticamente em todas as
abas.

**Vulnerabilidade adversária:** **inaceitável**. Geolocation requer
permissão explícita; pedir geolocation como **default** no boot viola
manifesto §28 (privacidade pelo mínimo) e §4 (anonimato por design —
não vinculamos identidade Drift a localização). **NÃO recomendado.**

Pode ser **opt-in opcional** ("pre-warm Tor se eu estiver fora de
país X"), mas Fase B+ e fora deste algoritmo.

### (h) User reports relay bloqueado (manual signal feeding into auto)

**Como detectar:** botão "este relay parece bloqueado" em Settings.
Feed entra no algoritmo como prior bayesiano.

**Custo:** zero infra; UX cost trivial.

**False-positive rate:** depende — user pode reportar relay
saudável.

**Vulnerabilidade adversária:** baixa.

**Recomendação:** incluir como **input opcional ao algoritmo** mas
não como gatilho único. UX em Fase B (não Fase A do auto-mode).

### (i) WebRTC ICE candidate gathering reveals NAT/firewall pattern

**Como detectar:** `RTCPeerConnection.gatheriIceCandidates` retorna
conjunto vazio ou só host candidates → sinal de NAT severo / firewall
bloqueando STUN.

**Custo:** moderado (gather demora 2-5s).

**False-positive rate:** **alta** — NAT severo é comum (corp WiFi,
celular CGNAT) e não é censura.

**Vulnerabilidade adversária:** baixa.

**Recomendação:** NÃO usar como sinal de censura — too noisy. Pode ser
sinal pra "WebRTC vai sofrer", relevante pro orchestrator da Fase 6.6
(disable WebRTC weight), mas não pra `auto-mode`.

### (j) `navigator.onLine` / `online`/`offline` events `*` (negativo)

**Como detectar:** browser-level — se `false`, dispositivo está
desconectado totalmente.

**Custo:** zero (event listener).

**False-positive rate:** alta — Chrome/Firefox spec é vaga ("trying
to access network"), nem sempre confiável.

**Vulnerabilidade adversária:** n/a (não é vetor positivo de
detecção).

**Uso recomendado:** **gate inverso**. Se `navigator.onLine === false`,
NÃO acionar Tor (Tor não vai funcionar offline; só drena bateria).
Pausar probe schedule. Detalhes em §8 edge case "user offline total".

### (k) `document.visibilitychange` `*` (timing-only)

**Como detectar:** Visibility API.

**Custo:** zero.

**Uso recomendado:** **trigger** — quando app volta de background
(`visible`), re-rodar probe (rede pode ter mudado: switch Wi-Fi → 4G,
acordou de sleep). NÃO é sinal de censura sozinho.

### (l) Histórico em `relays_user.last_ok_at` / `last_err` `*`

**Como detectar:** consultar `lib/relays.ts:RelayRecord` antes de
probe — relay que falhou nas últimas 24h é desprioritizado.

**Custo:** zero (já no banco).

**Uso recomendado:** **prior** — usado pra decidir ordem do batch de
probe (relay com sucesso recente vai primeiro; relay falhou recente
vai por último).

### (m) HTTP-fallback connectivity check (ex.: GET https://1.1.1.1/cdn-cgi/trace)

**Como detectar:** fetch a um endpoint genérico não-Drift conhecido
(Cloudflare 1.1.1.1, Google generate_204).

**Custo:** baixo.

**False-positive rate:** baixa — sucesso significa "rede genericamente
funciona", falha significa "offline OU bloqueio genérico".

**Vulnerabilidade adversária:** moderada — usar sinal genérico ajuda
distinguir "offline total" (não fazer Tor) de "Drift bloqueado
seletivamente" (fazer Tor). Mas: Drift cliente fazendo fetch a
1.1.1.1 vaza fingerprint pra ISP ("este device usa Drift"). Trade-off.

**Recomendação:** opt-in via env var ou setting `auto_mode_canary` —
default OFF. Em Fase A do auto-mode, **não usar**. Considerar Fase B
se evidência empírica do testbed mostrar que distinguir offline-vs-
censura é necessário.

### Síntese: sinais que o algoritmo §4 usa

Combinar (a) + (b) + (c) + (d) + (e) sobre lista dinâmica de relays,
gates por (j) + (k), prior por (l). (h) opcional pra Fase B.

---

## §4 — Algoritmo recomendado — versão 1.0

### 4.1 Pseudocódigo

```
// === DECISION TYPES ===

type Decision =
  | { mode: 'clearnet', reason: 'healthy' | 'starting', confidence: 'low' | 'high' }
  | { mode: 'tor',      reason: 'blocked' | 'history', confidence: 'low' | 'high' }
  | { mode: 'manual',   reason: 'both-failed' | 'offline', confidence: 'high' }

type ProbeResult = {
  relay: string
  outcome: 'ok' | 'dns-fail' | 'tcp-fail' | 'tls-fail' | 'silent' | 'timeout' | 'abrupt-close'
  durationMs: number
  at: number
}

type AutoState = {
  phase: 'idle' | 'probing' | 'clearnet-ok' | 'switching-to-tor' | 'tor-ok' | 'manual-required'
  lastDecisionAt: number
  consecutiveSuccesses: number    // pra hysteresis (Tor → clearnet)
  consecutiveFailures: number     // pra escalation
  recentProbes: ProbeResult[]     // janela curta (últimos 60s)
  backoffMs: number               // exponencial em Tor-falhou
}

// === CONFIG (calibrável via testbed §15) ===

CONFIG = {
  PROBE_TIMEOUT_MS: 8000,           // por relay; mobile flaky-tolerant
  PROBE_BATCH_SIZE: 4,              // quantos relays em paralelo
  PROBE_QUORUM_FAIL: 0.66,          // ≥66% falhou → blocked
  PROBE_QUORUM_OK: 0.50,            // ≥50% ok → clearnet healthy
  HYSTERESIS_TOR_TO_CLEARNET_MS: 5 * 60 * 1000,  // 5min de OK estável
  REPROBE_INTERVAL_TOR_MS: 10 * 60 * 1000,       // a cada 10min em modo Tor
  REPROBE_INTERVAL_CLEARNET_MS: 0,               // só reativo em clearnet
  TOR_BACKOFF_INITIAL_MS: 30 * 1000,             // 30s
  TOR_BACKOFF_MAX_MS: 30 * 60 * 1000,            // 30min cap
  TOR_BACKOFF_MULT: 2,
  PROBE_JITTER_PERCENT: 0.20,       // ±20% no schedule
  CONSEC_FAIL_TO_PROBE: 3,          // N falhas reativas antes de probe
}

// === MAIN ENTRY ===

async fn detectAndFallback(
  state: AutoState,
  relays: RelayRecord[],
  capability: { hasArti: boolean },
  now: number
): Promise<{ decision: Decision, newState: AutoState }> {

  // Gate 0: PWA sem arti — auto não aplica
  if (!capability.hasArti) {
    return {
      decision: { mode: 'clearnet', reason: 'starting', confidence: 'low' },
      newState: { ...state, phase: 'idle' }
    }
  }

  // Gate 1: device offline — não acionar Tor (não vai resolver)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      decision: { mode: 'manual', reason: 'offline', confidence: 'high' },
      newState: { ...state, phase: 'idle' }
    }
  }

  // Phase 1: parallel probe
  const candidates = pickProbeBatch(relays, state, CONFIG.PROBE_BATCH_SIZE, now)
  const probes = await Promise.all(
    candidates.map(r => probeRelay(r, CONFIG.PROBE_TIMEOUT_MS, now))
  )

  // Phase 2: aggregate signal (PURE function — testable)
  const signal = aggregateProbeSignal(probes, CONFIG, now)

  // Phase 3: decide (PURE function — testable)
  const next = stateTransition(state, signal, CONFIG, now)

  // Phase 4: side effects (caller orchestrates)
  return next
}


// === PURE FUNCTIONS (Vitest) ===

/** Agrega N probes em sinal binário com confidence. */
fn aggregateProbeSignal(
  probes: ProbeResult[],
  cfg: typeof CONFIG,
  now: number
): { verdict: 'ok' | 'blocked' | 'mixed', okCount: number, total: number } {
  if (probes.length === 0) return { verdict: 'mixed', okCount: 0, total: 0 }

  const okCount = probes.filter(p => p.outcome === 'ok').length
  const failCount = probes.length - okCount
  const failRatio = failCount / probes.length

  if (failRatio >= cfg.PROBE_QUORUM_FAIL) {
    return { verdict: 'blocked', okCount, total: probes.length }
  }
  if (okCount / probes.length >= cfg.PROBE_QUORUM_OK) {
    return { verdict: 'ok', okCount, total: probes.length }
  }
  return { verdict: 'mixed', okCount, total: probes.length }
}

/** State machine pura. PRINCIPAL função testada. */
fn stateTransition(
  state: AutoState,
  signal: ReturnType<typeof aggregateProbeSignal>,
  cfg: typeof CONFIG,
  now: number
): { decision: Decision, newState: AutoState } {

  // Caso 1: clearnet saudável (verdict=ok)
  if (signal.verdict === 'ok') {
    if (state.phase === 'tor-ok') {
      // Estávamos em Tor; clearnet voltou. Hysteresis: precisa Ns
      // de OK consecutivo antes de desligar Tor.
      const consec = state.consecutiveSuccesses + 1
      if (consec * cfg.REPROBE_INTERVAL_TOR_MS >= cfg.HYSTERESIS_TOR_TO_CLEARNET_MS) {
        // Hysteresis cumprida — desliga Tor
        return {
          decision: { mode: 'clearnet', reason: 'healthy', confidence: 'high' },
          newState: { ...state, phase: 'clearnet-ok', consecutiveSuccesses: 0,
                       consecutiveFailures: 0, lastDecisionAt: now }
        }
      }
      // Hysteresis ainda não cumprida — segue em Tor
      return {
        decision: { mode: 'tor', reason: 'history', confidence: 'low' },
        newState: { ...state, consecutiveSuccesses: consec, lastDecisionAt: now }
      }
    }
    // Clearnet saudável e estávamos em clearnet (ou idle) — segue normal
    return {
      decision: { mode: 'clearnet', reason: 'healthy', confidence: 'high' },
      newState: { ...state, phase: 'clearnet-ok', consecutiveFailures: 0,
                   lastDecisionAt: now }
    }
  }

  // Caso 2: clearnet bloqueado (verdict=blocked)
  if (signal.verdict === 'blocked') {
    if (state.phase === 'tor-ok') {
      // Já estamos em Tor e clearnet ainda bloqueado — segue
      return {
        decision: { mode: 'tor', reason: 'blocked', confidence: 'high' },
        newState: { ...state, consecutiveSuccesses: 0, lastDecisionAt: now }
      }
    }
    // Estávamos em clearnet — switch
    return {
      decision: { mode: 'tor', reason: 'blocked', confidence: 'high' },
      newState: { ...state, phase: 'switching-to-tor',
                   consecutiveFailures: state.consecutiveFailures + 1,
                   lastDecisionAt: now }
    }
  }

  // Caso 3: misto / inconclusivo (verdict=mixed)
  // Não troca de modo — mantém estado anterior, agenda re-probe
  return {
    decision: state.phase === 'tor-ok'
      ? { mode: 'tor', reason: 'history', confidence: 'low' }
      : { mode: 'clearnet', reason: 'healthy', confidence: 'low' },
    newState: { ...state, lastDecisionAt: now }
  }
}

/** Seleciona qual subset de relays probar. PURE pa testar
 *  determinística com seed. */
fn pickProbeBatch(
  relays: RelayRecord[],
  state: AutoState,
  size: number,
  now: number
): RelayRecord[] {
  // Prior 1: relays com sucesso recente vão primeiro (mais barato testar)
  // Prior 2: relays com falha persistente últimas 24h vão por último
  // Prior 3: shuffle determinístico por timestamp pra evitar fingerprint
  //         (atacante observando "user sempre testa damus.io primeiro" =
  //         info leak)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000
  const sorted = [...relays].sort((a, b) => {
    const aRecent = a.lastOkAt && (now - a.lastOkAt) < ONE_DAY_MS
    const bRecent = b.lastOkAt && (now - b.lastOkAt) < ONE_DAY_MS
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return +1
    return 0
  })
  // Shuffle dentro da mesma "tier" usando hash(now) — determinístico
  // por boot mas varia entre boots
  const tier1 = sorted.filter(r => r.lastOkAt && (now - r.lastOkAt) < ONE_DAY_MS)
  const tier2 = sorted.filter(r => !tier1.includes(r))
  const seed = Math.floor(now / 60000) // varia a cada 1min
  return [...shuffleByseed(tier1, seed), ...shuffleByseed(tier2, seed)]
    .slice(0, size)
}
```

### 4.2 Parâmetros recomendados (calibração inicial)

| Param | Default | Motivação |
|---|---|---|
| `PROBE_TIMEOUT_MS` | **8000** | 8s tolera 3G ruim sem ser eterno. Tor Browser usa 10s. Snowflake usa 15s. Drift mais agressivo porque cobre cenário "tô tentando voltar pra clearnet" — trade-off ok. |
| `PROBE_BATCH_SIZE` | **4** | Combina com seed list (3 relays, +1 user). Manifesto §15 "censurar 4 vs 100 relays" — 4 é o threshold mínimo histórico. Caro probar 100 toda vez. |
| `PROBE_QUORUM_FAIL` | **0.66** | 3 de 4 falharem → blocked. Mais conservador que 0.5 (evita FP de "1 relay morreu"). Menos agressivo que 1.0 (não exige unanimidade — adversário precisa bloquear tudo, o que é o caso real). |
| `PROBE_QUORUM_OK` | **0.50** | 2 de 4 OK → healthy. Asymetric: voltar pra clearnet exige menos confiança que entrar em Tor (porque sair de Tor é "downgrade de segurança aceito" se rede aparenta voltar). |
| `HYSTERESIS_TOR_TO_CLEARNET_MS` | **5 * 60 * 1000** | 5min de OK estável antes de desligar Tor. Mitiga adversário que libera clearnet 30s pra forçar fallback. |
| `REPROBE_INTERVAL_TOR_MS` | **10 * 60 * 1000** | 10min em modo Tor — não precisa ser agressivo (Tor já funciona). |
| `REPROBE_INTERVAL_CLEARNET_MS` | **0** | Em modo clearnet, NÃO probe periódico. Só reativo (`navigator.onLine` ou consec failure) — manifesto §28 (probes constantes vazam fingerprint). |
| `TOR_BACKOFF_INITIAL_MS` | **30 * 1000** | Se Tor também falhar, retry em 30s. |
| `TOR_BACKOFF_MAX_MS` | **30 * 60 * 1000** | Cap em 30min — não retry agressivo se rede está mesmo down. |
| `TOR_BACKOFF_MULT` | **2** | Exponencial: 30s → 60s → 120s → ... → 30min. |
| `PROBE_JITTER_PERCENT` | **0.20** | ±20% no schedule pra evitar fingerprint. |
| `CONSEC_FAIL_TO_PROBE` | **3** | 3 publish/sub failures consecutivas em modo clearnet → trigger probe. Reativa, não periódica. |

**Calibração:** estes valores são chutes informados. **Testbed §15 Fase
A** (cenário a — clearnet bloqueado) deve medir empiricamente:
- Time-to-fallback p50/p95 com `PROBE_BATCH_SIZE = 4` e
  `PROBE_TIMEOUT_MS = 8000`. Ajustar se p95 > 30s.
- False-positive rate em rede saudável simulada com 5% packet loss.
  Ajustar `PROBE_QUORUM_FAIL` se >5% acionar Tor.

### 4.3 Hysteresis explicada

Por que **5min de OK** antes de Tor → clearnet?

- Adversário libera clearnet 30s pra observar se cliente sai de Tor.
  Se ele identificar comportamento "sai de Tor após 1 OK", força
  vazamento de IP.
- 5min é compromisso entre "agilidade pra recuperar UX" e "robustez
  contra manipulação". Tor Browser usa heurística similar (não
  reusa circuit que falhou recentemente).
- Implementação: cada probe a cada `REPROBE_INTERVAL_TOR_MS` (10min)
  bate-se contra `consecutiveSuccesses`. Após
  `HYSTERESIS_TOR_TO_CLEARNET_MS / REPROBE_INTERVAL_TOR_MS = 0.5`
  probes — i.e., **1 probe consecutivo OK** seguido de no mínimo 5min
  no estado é o suficiente. (Math: 1 probe a cada 10min com 5min de
  hysteresis = ceil(5/10) = 1 probe + tempo decorrido.)

  **Correção do cálculo:** mudei pra `consecutiveSuccesses *
  cfg.REPROBE_INTERVAL_TOR_MS >= cfg.HYSTERESIS_*` — i.e., 1 sucesso
  já satisfaz porque a janela já passou (10min > 5min). Pra reforçar
  "estável", aumentar `HYSTERESIS` pra 15min (precisaria 2 sucessos
  consecutivos com 10min entre). Recomendação: **15min de hysteresis**
  na versão 1.0 — Marshall pode tunar baseado em testbed.

### 4.4 Backoff explicada

Se Tor falhar (state `switching-to-tor` → `manual-required`):
1. Primeira falha: aguarda `TOR_BACKOFF_INITIAL_MS` (30s), retry.
2. Segunda falha: aguarda 30s × 2 = 60s, retry.
3. Continua até `TOR_BACKOFF_MAX_MS` (30min).
4. Após 30min, sucesso resseta backoff.

**UX:** após 3 retries consecutivos falhando (acumulado ~3.5min), UI
mostra banner explícito: "Rede bloqueada — clearnet e Tor não
respondem. [Retry] [Adicionar bridge Tor]". Em Fase 7+, [Sneakernet
import] aparece.

---

## §5 — Probe schedule

Quando rodar o algoritmo:

### 5.1 Boot inicial — não-bloqueante

```
bootstrap.ts:
  1. db, identity, prefs, relays, identities, follows  (sequencial)
  2. step = 'sync'
  3. networkMode = getPrefs().network_mode
  4. IF networkMode === 'auto' AND isTauri() AND hasArti():
       startAutoMode()  // não bloqueante, fire-and-forget
       // continua com 'clearnet' default; auto-mode pode promover depois
  5. registerTransport(wssTransport)
  6. registerTransport(webrtcTransport) IF mode allows
  7. await startSync()  // segue normal
  8. step = 'ready'

startAutoMode:
  // Roda em paralelo com startSync. Se detectar bloqueio em <10s,
  // emite evento que orchestrator + bootstrap captura para
  // re-router (incluindo possível location.reload() — TBD pelo Ted ADR).
  setTimeout(() => runProbeAndDecide(), CONFIG.AUTO_BOOT_DELAY_MS)
```

`AUTO_BOOT_DELAY_MS = 5000` — 5s pra dar chance do `startSync`
estabilizar. Se `startSync` já falhou em 5s (cenário a), probe entra
mais cedo via reactive trigger (§5.2).

### 5.2 Reativo — falhas consecutivas

`wssTransport.publish` e `subscribe` registram falhas. Se
`CONSEC_FAIL_TO_PROBE` (3) falhas consecutivas em janela curta,
trigger probe imediato.

Implementação: contador shared no orchestrator. Cada
`publish/subscribe` failure incrementa; cada sucesso reseta. Quando
hit 3, emite evento `transport:degraded` que `auto-mode` consume.

```
wssTransport.publish (em publish.ts ou shared metric):
  if (failed > 0 && ok === 0) {
    consecFails++
    if (consecFails >= CONFIG.CONSEC_FAIL_TO_PROBE) {
      consecFails = 0
      emit('transport:degraded')
    }
  } else if (ok > 0) {
    consecFails = 0
  }
```

### 5.3 Periódico em modo Tor

`REPROBE_INTERVAL_TOR_MS` = 10min. Setup tipo `lib/probe.ts`
(setInterval com idempotência). Adiciona jitter ±20% pra evitar
fingerprint.

```
setInterval(() => {
  const jitter = (Math.random() * 2 - 1) * CONFIG.PROBE_JITTER_PERCENT
  const nextDelay = REPROBE_INTERVAL_TOR_MS * (1 + jitter)
  // schedule next via setTimeout (re-arm cycle)
}, REPROBE_INTERVAL_TOR_MS)
```

### 5.4 Periódico em modo clearnet

**NÃO há.** Manifesto §28 (privacidade pelo mínimo). Probe periódico
em modo clearnet vaza fingerprint pro ISP ("este device sonda relays
em pattern X"). Fallback é puramente reativo (5.2).

Exceção: se user explicitamente pediu "modo paranóia leve"
(`auto_mode_aggressive` pref futuro), ativa probe periódico em
clearnet também. Default OFF.

### 5.5 Foreground transition

`document.visibilitychange` → quando vira `'visible'`:
- Se modo era clearnet: roda probe imediato (rede pode ter mudado).
- Se modo era tor: agenda probe na próxima janela do scheduler
  (não força — Tor já funcionando, evitar sobrecarga).

### 5.6 Network change events

`navigator.connection.change` (Chrome/Edge) ou inferência via
`online`/`offline`: trigger probe imediato.

---

## §6 — Anti-manipulação (cross com Barney threat model)

### 6.1 Adversário forja sucesso

**Vetor:** ISP intercepta WebSocket, responde com handshake válido +
mantém conexão aberta + entrega events vazios (filter retorna []).
Probe vê "conexão OK, EOSE recebido" → conclui clearnet healthy →
NÃO ativa Tor → user em modo "censurado-passivo".

**Mitigação atual (Drift):** `verifyDriftEvent` em `nostr.ts` valida
Schnorr. Eventos forjados são descartados.

**Mitigação adicional pro probe:** **probe valida que eventos
retornados são conhecidos**. Modelo do `lib/probe.ts:probeRelay` —
manda filter `{ ids: [...known events from local SQLite...] }`. Se
relay retorna 0 de N events conhecidos, é silent → flag.

**Aplicado a auto-mode:**
- Probe etapa 1 (cheap): TCP/TLS handshake. Se falha → blocked.
- Probe etapa 2 (caro mas robust): subscribe `{ ids: [<3 known event ids>] }`,
  esperar EOSE + ≥1 event. Se EOSE chega mas 0 events → suspect
  silent (mesma flag de probe.ts). Em probe inicial (boot, banco
  vazio), pula etapa 2 e usa só etapa 1 + etapa 3 (recente subscribe
  com kind=POST limit=1, esperar pelo menos 1 evento).
- Aceita fallback ainda assim em "etapa 1 ok, etapa 2 silent"? Sim —
  trata como "blocked" (relay possivelmente comprometido).

### 6.2 Adversário força fallback pra clearnet

**Vetor:** user em modo `tor` manual (escolha consciente). Adversário
bloqueia Tor seletivamente (dropa 9001/443) pra forçar app pra
clearnet, expondo IP.

**Mitigação:**
- **Modo `tor` manual e modo `auto` são separados.** User em `tor`
  manual NUNCA cai em `clearnet` automaticamente. Se Tor falha em
  modo manual, app fica em error state com banner "Tor não
  conectou — [Retry] [Voltar pra clearnet em Settings]".
- Modo `auto` em fallback Tor failed: NÃO cai pra clearnet
  silenciosamente. Vai pra `manual-required` → user decide.
- Implementação dura: o estado `manual-required` requer ação user
  (botão "voltar pra clearnet ciente que estou expondo IP").

### 6.3 Side-channel: probe schedule revela "drift user em país X"

**Vetor:** ISP observa que device X faz probe a cada exatos 5min,
combina com fingerprint (TLS, port 443 apenas pra hosts conhecidos
de Drift) → identifica.

**Mitigação:**
- **Jitter ±20%** no schedule (`PROBE_JITTER_PERCENT`). Probe a cada
  10min ± 2min.
- **Batch random** de relays (`pickProbeBatch` shuffle determinístico
  por seed = ts/60000, varia a cada minuto).
- **Não probar se rede saudável** (modo clearnet sem trigger). Só
  probe quando há sinal positivo de problema.
- **Reusar conexões** (`SimplePool` já cache) em vez de abrir/fechar
  WebSocket dedicado a cada probe.

### 6.4 Adversário injeta relay malicioso na lista do user

**Vetor:** atacante convence user a adicionar relay `wss://patriot.example`
(via NIP-65 spoofado, recommend tag, social engineering). Em modo
auto, esse relay sempre responde "ok" → puxa quorum pra clearnet.

**Mitigação:**
- **Skin in the game:** probe etapa 2 (events conhecidos). Relay
  malicioso responde "ok" mas não tem events Drift conhecidos do
  user → flag silent → diminui peso na decisão.
- **Diversidade obrigatória no batch:** `pickProbeBatch` garante
  pelo menos 1 relay seed (manifest origin) no batch. Atacante
  precisaria comprometer relays seed também (custo alto).
- **Threshold `PROBE_QUORUM_FAIL` = 0.66:** 1 relay malicioso "ok" em
  batch de 4 só vale 25% — abaixo do threshold. Precisa de 2
  maliciosos pra envenenar 50%, ainda abaixo de 0.66.

### 6.5 Telemetria como vetor

Probe state interno (`AutoState.recentProbes`) pode conter URLs e
timestamps. Se vazar (via export, dev tools acidental, plugin), revela
padrão de uso.

**Mitigação:**
- `recentProbes` cap: últimos 60s só (ou últimas 16 entradas, o que
  vier primeiro).
- NÃO persistir `AutoState` em SQLite — in-memory only. Reset a cada
  boot.
- Logs estruturados (Fase A testbed) só em buildmode test/dev.
  Production: console.log mínimo, sem URLs detalhadas.

Cross-ref: este ponto é input pro **threat model formal do Barney
T5** (se ele criar T5 cobrindo auto-mode, este §6 é a contribuição
inicial).

---

## §7 — Telemetria (cross com Ted ADR)

### 7.1 Eventos a logar (in-memory ring buffer)

Por compromisso §28, NÃO há analytics externo. Telemetria é local,
exposta pro user via Diagnostic Panel + opt-in export pra debug.

| Evento | Payload | Quando |
|---|---|---|
| `auto:probe-started` | `{ batch: string[], at: number, reason: 'boot' \| 'reactive' \| 'periodic' \| 'foreground' }` | Toda probe |
| `auto:probe-result` | `{ relay: string, outcome: ..., durationMs: number }` | Cada probe individual |
| `auto:signal` | `{ verdict, okCount, total, at }` | Pós-aggregateProbeSignal |
| `auto:decision` | `Decision + { previousMode: ..., transitionMs: number }` | Pós-stateTransition |
| `auto:tor-bootstrap` | `{ outcome: 'ok' \| 'fail', durationMs, error?: string }` | Quando ativa Tor |
| `auto:hysteresis-tick` | `{ consecutive: number, remainingMs: number }` | Em modo Tor com clearnet aparentemente OK |

Buffer: ring buffer in-memory de 200 entries. Não persiste.

### 7.2 Exposto pro user (manifesto §28 transparência)

UI em `Settings → Diagnostics → Modo de rede`:
- Modo atual: `clearnet | tor | auto:clearnet | auto:tor`
- Última decisão: timestamp + razão
- Probe history (últimas 10): tabela `relay | outcome | duration`
- Botão "exportar log" (.json, dev/debug)
- Botão "rodar probe agora" (manual trigger)

### 7.3 Não-PII

- URLs de relays públicos: OK (não-PII).
- Timestamps: OK.
- Outcome flags: OK.
- IPs do user: NUNCA logar (`navigator.connection` retorna tipo
  genérico, não IP — safe).
- Geolocation: NUNCA usar.
- Cookie/session: n/a.

### 7.4 Cross-ref com Ted ADR

ADR Ted define **onde mora** o auto-mode (módulo novo
`lib/transport/autoMode.ts`? extensão de `bootstrap.ts`? plugin
no orchestrator?). Telemetria deve respeitar essa decisão — se
auto-mode é um módulo novo, ele expõe `getAutoModeMetrics()` que UI
e dev console consomem.

Decisão deferred ao Ted ADR. Recomendação Robin: **módulo separado
`lib/transport/autoMode.ts`** — testabilidade pure functions
isolada, ciclo de import limpo.

---

## §8 — Edge cases

### 8.1 User offline total (sem WiFi/celular)

`navigator.onLine === false`. Não acionar Tor. Pausar scheduler.
Quando `online` event dispara, retomar.

```
window.addEventListener('offline', () => pauseAutoMode())
window.addEventListener('online',  () => resumeAutoMode({ probe: true }))
```

UI: banner global "sem rede" (já existe no Drift).

### 8.2 Captive portal (hotel WiFi)

Sintoma: WebSocket abre mas eventos nunca chegam (ou recebe HTML do
captive em frames non-WS — quebra parsing). 

**Detecção:** etapa 2 do probe (events conhecidos) falha em **todos**
os relays. Etapa 1 (TCP) **passa**.

**Decisão:** flag como `mixed` (não `blocked`). Não acionar Tor
permanente — Tor não vai funcionar atrás de captive (TCP bloqueado
pra 9001).

**UX:** banner "captive portal detectado — abra navegador e
autentique-se. [Retry após auth]".

Implementação: outcome novo `'captive-suspected'` quando etapa 1 ok +
etapa 2 falha em ≥80% dos probes. Trata como `mixed` (não muda modo).

### 8.3 Mobile data switching (3G ↔ WiFi)

Trigger: `navigator.connection.change` (Chrome). Em browsers que não
expõem, polling indireto via online/offline ou outras heurísticas.

**Comportamento:**
- Imediato após change: pausar 2s pra rede estabilizar.
- Roda probe imediato.
- Se em modo Tor antes do switch e clearnet retorna OK: **NÃO
  desliga Tor imediatamente** (hysteresis 15min se aplica). Trade-off
  aceito: user em transição perde 5-10s extra de latência Tor por
  não saber se a rede nova é segura ainda.

Anti-flapping: rate-limit de transições. Não pode trocar de modo mais
que 1× a cada 60s. Excesso loga warning.

### 8.4 Reload da app — herdar último estado?

Opções:
- **(a) Fresh start sempre:** boot começa em `clearnet`, probe corre
  do zero. Mais simples, mais lento em país censurado (re-detecta
  toda vez).
- **(b) Persistir último estado:** salva `prefs.last_auto_decision` no
  banco. Boot lê, se `last == 'tor' && timeSince < 24h`, parte direto
  em Tor (skip probe inicial, faz probe periódico depois).

Recomendação: **(b) com expiração curta** (24h). Trade-off:
- Pro: user em país censurado tem boot rápido em Tor (não espera
  probe descobrir bloqueio toda vez).
- Con: persistência leve do estado de auto-mode (1 row em
  `user_prefs` ou tabela nova).

Implementação: `lib/prefs.ts` ganha campo `last_auto_decision: { mode,
at } | null`. Boot lê. Se `(now - at) < 24*60*60*1000` E `mode ===
'tor'`, parte em Tor sem probe inicial; probe periódico cuida do
resto.

**Cross-ref:** Ted ADR decide se isso "mora em prefs" ou em tabela
nova `auto_mode_state`. Recomendação Robin: prefs é fine — campo
opcional, não invasivo.

### 8.5 Boot durante boot (race)

`startBoot()` é singleton (idempotente). `startAutoMode()` chamado
de dentro de `doBootstrap` deve ser idempotente também. Se chamado
2× (StrictMode, multi-tab), retorna mesma promise.

```
let autoModePromise: Promise<void> | null = null
export function startAutoMode(): Promise<void> {
  if (autoModePromise) return autoModePromise
  autoModePromise = doAutoMode()
  return autoModePromise
}
```

### 8.6 User troca prefs durante auto-mode rodando

User em Settings troca de `auto` pra `clearnet` manual. Auto-mode
deve parar limpinho.

```
stopAutoMode():
  clearTimers()
  releaseSubscriptions()
  autoModePromise = null
  // estado próximo: prefs.network_mode === 'clearnet' → wssTransport
  // segue normal; user precisa reload (mesma convenção do switch
  // identity / network_mode atual).
```

### 8.7 Tor circuit cai durante uso (não no boot)

Cenário: user em modo auto, Tor ativo há 1h, circuit morre por
qualquer razão (relay Tor offline, network jitter).

**Comportamento atual (sem auto-mode):** `TorWebSocket._dispatchClose`
emite close 1006, `wssTransport` reconnect via SimplePool, que tenta
novo handshake (ainda em Tor). Se TorWebSocket._open falha
recursivamente, fica em loop.

**Auto-mode:** o reactive trigger (`CONSEC_FAIL_TO_PROBE`) deveria
disparar — 3 falhas consecutivas → probe → se clearnet OK, decide
Tor → clearnet (com hysteresis). Hysteresis em modo `tor-stuck` pode
ser shorter (`HYSTERESIS_TOR_DOWN_MS = 1min`) — diferente de
`HYSTERESIS_TOR_TO_CLEARNET_MS` que é "Tor funcionando OK e clearnet
voltou" (5-15min).

Adicionar config:
- `HYSTERESIS_TOR_DOWN_MS`: **60 * 1000** — quando Tor está
  comprovadamente DOWN, hysteresis curta pra recuperar UX rápido (Tor
  parou de funcionar é diferente de Tor funciona-bem-mas-clearnet-voltou).

### 8.8 PWA detecta bloqueio mas não tem arti

Capability gate (§4 Gate 0): retorna `{ mode: 'clearnet', reason:
'starting' }`. PWA NÃO ativa Tor, mas pode mostrar banner explícito:

> "🚧 Rede aparenta bloqueio. Drift Desktop suporta Tor automático.
> [Baixar Drift Desktop] [Adicionar relays alternativos]"

Esta é a recomendação Robin pra escopo (B) — PWA detecta sem
fallback. **Mesmo se Ted decidir (A) `auto` Tauri-only, o PWA pode
detectar passivamente** e oferecer caminho de upgrade. Decisão final
no ADR.

---

## §9 — Comparação com prior art

> Baseado em literatura técnica disponível: Tor Project docs, Tor
> Browser Connection Assist (introduzido 2022), Snowflake design
> docs, Psiphon source, Signal "Censorship Circumvention" feature
> (2018+). WebSearch externo não disponível nesta sessão; refs
> abaixo são de domínio público e podem ser verificadas pelo Ted/
> Marshall ao implementar.

### 9.1 Snowflake (Tor Project pluggable transport)

**O que faz:** WebRTC bridges com voluntários proxiando tráfego
Tor. Cliente faz rendezvous via broker HTTP, recebe peer ID, conecta
WebRTC, tunela através do peer.

**Estratégia de seleção:**
- Sempre tenta múltiplos snowflakes em paralelo (default 3).
- Se um cair, pega outro do broker.
- Não há "auto-detect" — Snowflake é sempre-on quando habilitado.

**O que Drift PODE reusar:**
- **Probe paralelo de múltiplos endpoints**. Drift faz isso no batch
  de 4 relays.
- **Recuperação ágil quando peer cai**. Drift faz via reconexão
  do SimplePool, mas pode aprender a manter pool de "warm circuits"
  — futuro.

**O que Drift NÃO cabe:**
- Snowflake pré-supõe usuário já decidiu "preciso de circumvention".
  Drift `auto` precisa decidir POR ele, sem ação manual.
- Snowflake é transporte, não detector. Drift precisa do detector
  *antes*.

**Ref:** https://snowflake.torproject.org/

### 9.2 Tor Browser Connection Assist (2022+)

**O que faz:** ao primeiro launch, se Tor conexão direta falha em
~30s, automatically retries with bridges (built-in obfs4 + meek-azure
+ Snowflake). Se essa falha, oferece "request bridge" via moat
(domain-fronted requests).

**Algoritmo (simplificado):**
1. Tenta direct connection com timeout ~30s.
2. Se falha, escolhe bridges baseado em **país detectado** (via
   Tor Browser geo-IP database — não pede ao user).
3. Tenta bridges em paralelo, primeiro que funciona toma over.
4. Se todos falham, mostra UI "request bridge".

**O que Drift PODE reusar:**
- **Auto-fallback como default behavior** — Tor Browser não exige
  toggle do user; Drift `auto` deve ser igualmente proativo.
- **Multi-stage timeout** — direct primeiro (curto), depois fallback
  com timeout maior. Drift: clearnet 8s, depois Tor com timeout
  arti default (5-30s).

**O que Drift NÃO cabe:**
- Tor Browser usa **detecção geo-IP**. Drift §28 não pode (privacidade
  pelo mínimo). Drift detecta puramente comportamentalmente
  (probe failure quorum).
- Tor Browser tem **bridge directory dinâmico**. Drift não tem isso
  ainda — Fase 7 sneakernet input cobre vagamente.

**Ref:** https://gitlab.torproject.org/tpo/applications/tor-browser/
(wiki Connection Assist)

### 9.3 Psiphon

**O que faz:** circumvention SDK com múltiplos protocolos
(SSH, HTTPS, OSSH, MEEK, Quic). Cliente "tactics" decide qual
protocolo usar baseado em performance + GeoIP + lista dinâmica.

**Algoritmo (simplificado):**
1. Boot: carrega "tactics" (config remoto assinado).
2. Tenta protocolos em ordem definida em tactics, paralelo (top 3).
3. Primeiro que conecta dentro de timeout vira ativo.
4. Continua com protocolos lentos em background — se um melhor
   responder, pode fazer "switch" sem dropar conexão.

**O que Drift PODE reusar:**
- **Tactics como prior**: Drift pode ter `lib/transport/autoMode/tactics.ts`
  com defaults atualizáveis (via PR — não dynamic remote, manifesto
  §17). Tactics dizem "default probe timeout = 8s, batch = 4, etc.";
  user/calib testbed atualiza arquivo.
- **Race-to-first-OK**: Drift orchestrator já faz para publish.
  Auto-mode pode aplicar pra connect também — em modo auto, abre
  conexão clearnet E circuit Tor simultaneamente (se hasArti),
  primeiro a entregar EOSE vence. Trade-off: Tor sempre puxa recursos
  mesmo em rede livre. Default OFF; opt-in `auto_aggressive`.

**O que Drift NÃO cabe:**
- Psiphon usa **config remoto assinado** com tactics atualizados.
  Drift §17 não aceita config remoto (chave mestra disfarçada de
  "operador da chave de assinatura tactics").
- Psiphon assume **infra centralizada do Psiphon Inc.** Drift é
  stateless; cada cliente decide.

**Ref:** https://github.com/Psiphon-Inc/psiphon-tunnel-core

### 9.4 Signal Censorship Circumvention (2018)

**O que faz:** Signal usa **domain fronting** (host header diferente
do SNI) através de Cloudflare/Google/Amazon, pra escapar bloqueios
SNI. Quando direct conexão pro signal.org falha 5x consecutivos,
ativa domain fronting automaticamente.

**O que Drift PODE reusar:**
- **Threshold "5 consecutive failures"** como sinal robusto. Drift
  usa `CONSEC_FAIL_TO_PROBE = 3` (mais agressivo porque latência de
  re-decisão importa mais em Drift live feed).

**O que Drift NÃO cabe:**
- Domain fronting depende de cloud providers terceiros
  (Cloudflare/Google) que removeram suporte 2018+. Não é vetor
  Drift.
- Signal infra centralizada; Drift descentralizado.

**Ref:** https://signal.org/blog/doodles-stickers-censorship/ (post
de blog 2018) e https://www.usenix.org/system/files/foci20-paper-frolov_0.pdf
(análise acadêmica).

### 9.5 Tor Sealed Sender Discovery / general fallback patterns

Sealed Sender é privacy feature, não censorship. Pulando.

### 9.6 Resumo aplicado a Drift

| Feature | Tor Browser CA | Snowflake | Psiphon | Signal | Drift `auto` |
|---|---|---|---|---|---|
| Auto-detect bloqueio | ✅ | ❌ (sempre on) | ✅ | ✅ | ✅ proposto |
| Probe paralelo de múltiplos endpoints | ✅ bridges | ✅ snowflakes | ✅ protos | n/a | ✅ relays |
| Threshold de falhas | ~30s timeout | n/a | tactics | 5 consec | 3 consec + 0.66 quorum |
| GeoIP-based decision | ✅ | ❌ | ✅ | ❌ | **❌ explicitly NOT** (§28) |
| Hysteresis para voltar | n/a (não volta) | n/a | ✅ implícito | ✅ | ✅ 15min |
| Side-channel jitter | ❌ | ❌ | ❌ | ❌ | ✅ proposto |
| User opt-in necessário | ❌ default | ❌ (toggle Tor) | ❌ | ❌ default | ❌ (em modo auto) |
| Persistência de estado | parcial | ❌ | ✅ | ✅ | ✅ proposto (24h) |
| Telemetria local apenas | ❌ envia bug reports | parcial | ❌ envia | ❌ | ✅ §28 |

Drift reaproveita: probe paralelo, threshold composto (consec + quorum),
hysteresis, persistência curta. Drift inova: GeoIP-free detection
(comportamental puro), side-channel jitter explícito, telemetria
estritamente local.

---

## §10 — Critérios de sucesso

Métricas pra validar que algoritmo §4 cumpre §15. Bound pra cada,
medido em testbed §15 Fase A.

### 10.1 Time-to-fallback

Definição: timestamp de "boot completou em rede censurada" →
timestamp de "primeira mensagem entregue via Tor".

**Bounds:**
- **P50 < 30s** (mediana — user típico espera <30s pra app responder).
- **P95 < 60s** (cauda — pior caso aceitável; Tor bootstrap pode
  tomar 30s + probe 10s = 40s, mais 20s de buffer).

**Como medir:** testbed §15 cenário (a) com `network_mode: 'auto'`
ativo (após auto-mode shipped). Wireshark + harness emitting
structured events. 50 runs sequenciais. Histogram.

### 10.2 False-positive rate

Definição: em rede saudável simulada com 5% packet loss + 100ms
latência random, % de boots que acionam Tor sem necessidade.

**Bound:**
- **<3%** com config default. <1% é stretch.

**Como medir:** testbed sintético — 100 boots, ambiente
"flaky-mas-funcional" (`tc qdisc netem delay 100ms 50ms 25%
distribution paretonormal loss 5%`). Conta quantos vão pra Tor.

**Calibração:** se >3%, aumentar `PROBE_QUORUM_FAIL` pra 0.75 ou
`PROBE_TIMEOUT_MS` pra 12000.

### 10.3 False-negative rate

Definição: em rede censurada (cenário a do §15 testbed), % de boots
que **NÃO** acionam Tor.

**Bound:**
- **<5%** — quase sempre detecta.

**Como medir:** testbed cenário (a). 50 boots. Conta quantos ficam
em clearnet sem trocar. Cada FN é regressão crítica.

### 10.4 Time-to-detect (cenário b — Tor falha após ativado)

Definição: Tor estava OK, depois falha (peer Tor cai). Timestamp de
"última mensagem via Tor" → timestamp de "decisão de escalar pra
manual ou tentar clearnet de novo".

**Bound:**
- **P50 < 2min** (3 consec failures × ~30s entre tentativas).
- **P95 < 5min**.

### 10.5 No flapping

Definição: em janela de 1h em rede com sinal forte (clearnet
healthy), número de transições de modo deve ser ≤1.

**Bound:**
- **≤1 transição/hora** em rede estável.

**Como medir:** testbed run de 1h em rede saudável simulada.

### 10.6 Bandwidth overhead

Definição: bytes consumidos por probe scheduler / hora.

**Bound:**
- **<100KB/h** em modo Tor (probe a cada 10min × 4 relays × ~5KB
  cada = 20KB × 6 = 120KB/h. Aceito 100KB/h estretch — pode ser
  necessário cap mais agressivo se relevante).

**Calibração:** se exceder, aumentar `REPROBE_INTERVAL_TOR_MS` pra
20min ou diminuir `PROBE_BATCH_SIZE` pra 3.

### 10.7 No determinismo violation

`stateTransition` e `aggregateProbeSignal` são puras. Tests Vitest
exigem: mesma `(state, signal, cfg, now)` → mesmo `(decision, newState)`.

**Bound:**
- **100%** — qualquer flake em test = bug.

---

## §11 — Implementabilidade (checklist Marshall/Lily)

### 11.1 Funções puras testáveis (Vitest)

Prioridade P0 — modelo de `lib/transport/policy/violationWindow.ts`:

| Função | Inputs | Output | Test file |
|---|---|---|---|
| `aggregateProbeSignal(probes, cfg, now)` | array, config, ts | `{ verdict, okCount, total }` | `tests/auto-mode-aggregate.test.ts` |
| `stateTransition(state, signal, cfg, now)` | object, object, config, ts | `{ decision, newState }` | `tests/auto-mode-state.test.ts` |
| `pickProbeBatch(relays, state, size, now)` | array, object, number, ts | array | `tests/auto-mode-pick.test.ts` |
| `computeBackoff(state, cfg)` | object, config | number (ms) | `tests/auto-mode-backoff.test.ts` |
| `shouldHysteresis(state, cfg, now)` | object, config, ts | boolean | `tests/auto-mode-hyst.test.ts` |

LOC estimado pures: ~200 LOC + ~400 LOC tests. Modelo: `policy/`
files são 60-130 LOC + 80-200 LOC tests.

### 11.2 Funções com I/O (integration testable)

| Função | Side effects | Test approach |
|---|---|---|
| `probeRelay(relay, timeoutMs, now)` | abre WebSocket, espera response | mock WebSocket impl, similar a tests do `lib/probe.ts` |
| `runAutoMode()` | scheduler, integra above | testbed §15 Fase A |
| `installTorWebSocketImpl()` | já existe — reusar | smoke test 2026-05-01 cobre |

### 11.3 Onde plugar em `bootstrap.ts`

```diff
  setBoot((p) => ({ ...p, step: 'sync' }))

+ // Auto-mode (Fase 6.x — após ADR Ted): se prefs.network_mode === 'auto'
+ // E runtime suporta arti, pré-decide ou começa probe.
+ const networkMode = getPrefs().network_mode
+ let resolvedMode = networkMode
+ if (networkMode === 'auto' && isTauri() && /* hasArti */) {
+   const decision = await preBootDecideMode()  // pode usar prior persistido
+   resolvedMode = decision.mode === 'tor' ? 'tor' : 'clearnet'
+ }

- if (isTauri() && (networkMode === 'tor' || networkMode === 'onion-only')) {
+ if (isTauri() && (resolvedMode === 'tor' || resolvedMode === 'onion-only')) {
    // ... torConnect, installTorWebSocketImpl ...
  }

  // ... registerTransport ...

  await startSync()

+ // Start auto-mode runtime monitor (não-bloqueante)
+ if (networkMode === 'auto' && isTauri() && /* hasArti */) {
+   void startAutoMode()
+ }

  setBoot((p) => ({ ...p, step: 'ready' }))
```

**Cuidado:** se `auto` decide `tor` mid-boot e arti falha, fallback
pra `clearnet` com `degradedReasons` (já existe pattern). Marshall
preserva o pattern.

### 11.4 Tipos novos

```ts
// src/types/drift.ts:346
- export type NetworkMode = 'clearnet' | 'tor' | 'onion-only'
+ export type NetworkMode = 'clearnet' | 'tor' | 'onion-only' | 'auto'
```

E pref novo opcional:

```ts
// UserPrefs em drift.ts
+ last_auto_decision: { mode: 'clearnet' | 'tor', at: number } | null
```

Migration banco: `user_prefs` ganha coluna `last_auto_decision` (TEXT
JSON) — já é convenção do schema atual.

### 11.5 Tamanho estimado total

| Componente | LOC code | LOC tests |
|---|---|---|
| `lib/transport/autoMode/index.ts` (orquestração) | ~150 | n/a (integration) |
| `lib/transport/autoMode/pure.ts` (functions puras) | ~200 | ~400 |
| `lib/transport/autoMode/probe.ts` (I/O) | ~150 | ~150 (mock WS) |
| `lib/transport/autoMode/persistence.ts` (last_auto_decision) | ~50 | ~80 |
| `bootstrap.ts` integração | +30 | n/a |
| `Settings.tsx` UI (banner + toggle "auto") | +50 | n/a |
| `prefs.ts` extensão `last_auto_decision` | +20 | +20 |
| **Total** | **~650 LOC** | **~650 LOC** |

Tempo estimado (Marshall + Lily par): **2-3 dias úteis** após ADR Ted
fechado.

### 11.6 Gates de aceitação

PR não merga se:
1. Pure functions < 100% coverage Vitest.
2. Integration smoke (testbed §15 Fase A cenário a) falha.
3. False-positive >3% em testbed sintético.
4. Time-to-fallback P95 >60s em testbed.
5. Lint/tsc clean (manifesto §7 strict).

---

## §12 — Cross-references

### 12.1 Docs Drift relacionados

- [`Docs/manifesto.md`](../manifesto.md) §15 (anti-censura por país),
  §7 (determinismo), §17 (auditável), §28 (privacidade pelo mínimo)
- [`Docs/drift-arquitetura-v4.md`](../drift-arquitetura-v4.md)
  §18 env var DRIFT_TOR_ENABLED, §23.7 modo Tor toggle, §32
  transport layer
- [`Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md`](15-e2e-testbed-scoping-2026-05-08.md)
  §2 surpresa 1 (auto missing), §7 item 4 (deferred), §3 cenários
- [`Docs/sessions/webrtc-architecture-audit-2026-05-08.md`](webrtc-architecture-audit-2026-05-08.md)
  §2.3 threat surface T1-T4 (modelo de threat model)
- [`Docs/sessions/sprint7-smoke-2026-05-01.md`](sprint7-smoke-2026-05-01.md)
  smoke Tor isolado (modelo de testbed run)
- **Pendente:** ADR Ted sobre auto-mode (em paralelo a este doc) —
  define **onde mora** e **owner**
- **Pendente:** threat model Barney sobre auto-mode — formaliza §6
  acima

### 12.2 Código Drift relacionado

- `src/lib/probe.ts` — modelo de probe periódico (30min, batch
  paralelo, idempotente)
- `src/lib/bootstrap.ts:225–328` — wire-up Tor + transport register
- `src/lib/transport/wss.ts` — primário (peso 10)
- `src/lib/transport/torWebSocket.ts` — `installTorWebSocketImpl`
- `src/lib/transport/orchestrator.ts` — multiplexer
- `src/lib/transport/policy/` — modelo de funções puras (4 utils,
  8 funções, ~400 LOC)
- `src/lib/relays.ts:activeReadRelays/activeWriteRelays` — fonte de
  lista pra probe
- `src/lib/relays.ts:RelayRecord` — tem `lastOkAt`, `lastErr`,
  `enabled` — usados como prior em `pickProbeBatch`
- `src/types/drift.ts:NetworkMode` — extensão proposta
- `src/lib/prefs.ts` — extensão `last_auto_decision`

### 12.3 Externos (prior art)

- Tor Browser Connection Assist —
  https://gitlab.torproject.org/tpo/applications/tor-browser/-/wikis/Connection-Assist
- Snowflake — https://snowflake.torproject.org/
- Psiphon Tunnel Core — https://github.com/Psiphon-Inc/psiphon-tunnel-core
- Signal Censorship Circumvention 2018 —
  https://signal.org/blog/doodles-stickers-censorship/
- "Conjure: Summoning Proxies from Unused Address Space" (USENIX
  Security 2019) — modelo de detecção comportamental sem GeoIP
- iptables `string` match docs — DPI simulation pro testbed §15
- `tc-netem(8)` — flaky network simulation pra calibração
  false-positive

---

## §13 — Recomendação resumida

**Algoritmo proposto v1.0:**

1. **Probe paralelo** de 4 relays (`pickProbeBatch`), cada com
   timeout 8s. Outcomes classificados em ok / dns-fail / tcp-fail
   / silent / timeout.
2. **Quorum**: ≥66% falhou → blocked, ≥50% ok → healthy, else mixed.
3. **State machine pura** decide: clearnet → tor on blocked; tor →
   clearnet on healthy + 15min hysteresis; tor → manual on Tor
   fail backoff exhausted.
4. **Schedule**: probe inicial 5s pós-boot (paralelo a `startSync`),
   reativo após 3 consec failures, periódico só em modo Tor (10min
   ± 20% jitter).
5. **Capability-gated**: PWA puro detecta mas não fallback (banner
   "instale Drift Desktop"); Tauri+arti faz auto switch real.
6. **Anti-manipulação**: probe etapa 2 valida Schnorr contra eventos
   conhecidos; modo `tor` manual NUNCA cai pra clearnet automático;
   jitter de schedule contra fingerprint.
7. **Telemetria local apenas** (manifesto §28); ring buffer
   in-memory; UI Diagnostic expõe pro user.

**Implementabilidade:** ~650 LOC code + ~650 LOC tests, ~2-3 dias
após ADR Ted. Pure functions cobertura 100% Vitest; integration
testada via testbed §15 Fase A.

**Calibração:** parâmetros são chutes informados; testbed §15
mede empiricamente e ajusta antes de ship pra users.

---

*Robin · 2026-05-08 · ~5500 palavras · v1.0 · cross-ref: ADR Ted
(em paralelo, pendente), threat model Barney (em paralelo, pendente),
testbed §15 Fase A (Marshall + Robin Fase A) · capability gap
flagado: PWA puro não pode fazer fallback real, só detecção +
upgrade hint.*
