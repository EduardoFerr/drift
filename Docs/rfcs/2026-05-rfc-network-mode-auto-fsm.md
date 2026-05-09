# ADR/RFC: `network_mode: 'auto'` + cross-transport fallback FSM

**Status:** Proposed v2 — redesign após convergência Robin/Barney
2026-05-08. **Versão 1 (Opção A FSM dedicada, ~21-29h impl) está
DESCARTADA.**
**Autor:** Ted (revisão: arquitetura, padrões, camadas, abstrações).
**Data:** 2026-05-08 (v1) · 2026-05-08 (v2 redesign).
**Disparo:** convergência de research (Robin algorithm doc) + threat
model (Barney AT-1..AT-14) revelou que v1 tinha dois bloqueadores
fundamentais não-endereçáveis dentro do paradigma original.

---

## §0 — Histórico de revisão

| Versão | Data | Status | Decisão central |
|---|---|---|---|
| **v1** | 2026-05-08 | **descartada** | "Opção A — FSM dedicada em `transport/fallback.ts`, fallback automático silent em PWA + Tauri, custo ~21-29h" |
| **v2** | 2026-05-08 | **proposed (este doc)** | First-boot prompt + Tauri-only `auto`. PWA detecta + sugere upgrade; fallback real só em Tauri+arti, sob escolha consciente do user. Custo ~12-18h. |

**Por que v2:** v1 supôs que (1) fallback automático silent era
arquiteturalmente seguro e (2) PWA poderia participar do mesmo
paradigma. Robin (algoritmo) e Barney (threat model) trabalhando em
paralelo descobriram, independentemente, que ambas suposições falham:
PWA não tem capability pra Tor real (gap não-fechável dentro do
runtime PWA), e *qualquer* probe + *qualquer* switch automático é
observable a A4/A5 (AT-11 inerente). Conjunto inviabiliza v1 sem
redesign.

v2 reusa o que aproveita do v1 — F1–F9 (forças), pattern de funções
puras `transport/policy/`, decisão "swap WebSocket global > unregister
runtime", schema migration, telemetria local-only. Descarta o que não
cabe — magic auto silent, FSM ativa em PWA, fallback como
default-recommended pra novos users sem prompt.

---

## §1 — Problem statement (v2)

Manifesto v2.2 §15 (linhas 290–310) compromete:

> Bloqueio por DNS é contornável (PWA + IP direto + Tor)
> Bloqueio por SNI/DPI dos relays clearnet é contornável (Tor + WebRTC)
> ...
> Custo do adversário cresce com o uso: censurar 100 relays é mais
> caro que censurar 4

E `Docs/drift-arquitetura-v4.md` §23.7 (linhas 1024–1033) descrevia
intent original em **3 modos** (Off / Auto / Always).

Hoje:
- `src/types/drift.ts:346` define
  `type NetworkMode = 'clearnet' | 'tor' | 'onion-only'` — sem
  `'auto'`.
- `bootstrap.ts:240–295` lê `prefs.network_mode` uma vez na boot e
  decide init-time se Tor entra; sem máquina de transição em runtime.
- Não há detecção de bloqueio. Cliente em país censurado vê app
  travado em `step: 'sync'` sem banner explícito.

**Convergência de Robin + Barney 2026-05-08 introduz duas restrições
novas que v1 não considerou:**

1. **PWA capability gap (Robin §2.1):** PWA puro **não pode fazer
   fallback real**. Sem arti (Rust + IPC), `installTorWebSocketImpl`
   é no-op funcional em browser — webview ignora system proxy
   programático. Fallback automático em PWA seria *teatro*: app
   diz "trocou pra Tor", mas o WebSocket nativo continua direto ao
   destino. Em país censurado, isso é pior que não ter feature
   (false confidence).

2. **AT-11 inherent leakage (Barney §AT-11):** *qualquer* probe é
   observable a A4/A5; *qualquer* switch automático cria "moment of
   switch" estatisticamente identificável como "este IP está fugindo
   da censura por código, não manualmente". Tor Browser não tem esse
   problema porque user *escolheu Tor desde o início* (sem switch
   visível). Drift `auto` *silent* cria fingerprint que `tor` manual
   não cria. Em país com vigilância massiva, **usar `auto` silent é
   suficiente pra flagrar "este device é Drift"**.

A combinação inviabiliza o paradigma v1 ("fallback magic, default
recomendado"). Gap concreto a fechar:

1. User em PWA precisa **ver** que rede está bloqueada (não ficar
   travado em spinner). Sem capability de Tor real, oferta caminho
   de upgrade.
2. User em Tauri+arti precisa **escolher conscientemente** se quer
   auto-fallback. Default não é "decidir por ele"; default é
   *perguntar*.
3. Manifesto §15 entrega através de PWA (detecção + upgrade hint) +
   Tauri (auto real, com prompt e mitigations).

---

## §2 — Por que v1 (Opção A) foi descartada

### 2.1 AT-11 fundamental blocker

V1 propunha probe paralelo + switch automático silent. Robin §6 e
Barney §AT-11 convergem: **qualquer probe deixa rastro estatístico**.
Mitigations propostas em v1 (jitter ±20%, batch random,
piggyback) reduzem mas não eliminam fingerprint. AT-11 é
*inerente à semântica* "detectar bloqueio + trocar transport
automaticamente":

> Qualquer cliente que automaticamente foge da censura emite sinal de
> que está fugindo da censura.

V1 nunca quantificou o trade-off "false confidence vs detecção
estatística". V2 aceita o limite: se o user **escolheu** auto
conscientemente (prompt explícito), o fingerprint não é "engano do
algoritmo", é *consequência aceita* de escolha informada. Manifesto
§17 (sem chave mestra disfarçada) reforça: cliente não decide por user.

### 2.2 PWA capability gap

V1 §3 Opção A escreveu "F8 ✓ runtime input" assumindo que `'auto'` em
PWA degenera graciosamente pra "Clearnet only com banner". Robin §2.1
matou essa hipótese:

> `auto-mode` em PWA puro **só pode detectar bloqueio**, não pode
> fazer fallback real. Sem arti, não há Tor.

Manter `'auto'` no schema PWA confunde semântica (`auto` em
arquitetura = "fallback ativo"; degradar pra detecção-passiva muda
significado). V2 adota recomendação Robin (A): PWA **não tem `auto`**
— fica com `clearnet | tor* | onion-only*` (asterisco = disabled em
PWA com tooltip "requer Drift Desktop"); detecção de bloqueio dispara
banner de upgrade.

### 2.3 Magic auto sem consent viola autonomia

V1 §8 propunha `'auto'` como **default-recomendado pra novos users**
("UI badge 'default' no botão"). Barney AT-9 (eclipse via fake
censorship) + AT-10 (persistence attack) demonstram que automatizar
escolha sem consent é vetor de manipulação:

- Rouge AP força bloqueio fake → app silent switcha pra Tor
  controlado por atacante → user sem alerta.
- Manifesto §3 (dispositivo descartável, identidade não) **não
  implica** "decisões de transport automáticas sem alerta". É exata-
  mente o oposto: identidade portável requer que decisões críticas de
  rede sejam *visíveis e revertíveis*.

V2 inverte: default novos users em **Tauri** = prompt obrigatório;
default em PWA = `'clearnet'` (igual hoje) com detecção passiva.

### 2.4 Resumo do diff conceitual v1 → v2

V1 era "FSM ativa onipresente que decide por user". V2 é "FSM
**Tauri-only** que respeita escolha consciente, expressa via prompt
explícito de boot". Mecanismos v1 (FSM, hysteresis, swap WebSocket,
telemetria local) são reusados, mas a semântica de **quando e por que
acionam** muda fundamentalmente.

---

## §3 — Novo paradigma — first-boot prompt + Tauri-only auto

### 3.1 PWA flow

`NetworkMode` em PWA permanece `clearnet | tor* | onion-only*` com
`*` = disabled (mantém portabilidade de prefs entre devices: user com
prefs `tor` setadas em Tauri abrindo PWA do mesmo perfil vê banner
"Tor exige cliente nativo, sua identidade está ativa em modo
clearnet temporariamente").

**Não há `'auto'` em PWA.** Schema validation rejeita
`setNetworkMode('auto')` em runtime PWA (zod refinement; ver §5(a)).

**Detecção sim, fallback não:**

- Em modo `'clearnet'`, se boot não consegue conectar a ≥66% dos
  relays em ≥10s, dispara `<UpgradeBanner>`:
  > "Drift detectou que sua rede pode estar bloqueando relays Nostr.
  > Para Tor automático e bypass de censura, instale Drift Desktop.
  > [Baixar] [Adicionar relay alternativo] [Ignorar]"
- Detecção é **probe-on-demand single-shot** ao boot, não scheduler.
  Sem probe periódico (manifesto §28 + AT-3 jitter overhead). Banner
  é dismissível e re-disparável manual via Settings.
- Detecção usa **mesmo algoritmo puro** que Tauri (Robin §4
  `aggregateProbeSignal`), sem a parte de switch. Code reuse — uma
  função `detectBlockage(relays, now): { blocked: boolean,
  okCount: number }` testada em vitest, consumida por ambos runtimes.

### 3.2 Tauri flow

`NetworkMode` em Tauri ganha `'auto'`:

```ts
type NetworkMode = 'clearnet' | 'tor' | 'onion-only' | 'auto'  // 'auto' Tauri-only
```

**Primeiro boot pós-instalação** (detectado via flag
`firstBootPromptShown === false` em `user_prefs`), **antes** de
qualquer probe ou conexão de rede:

- `<FirstBootPrompt>` modal explícito, **não-dismissível sem
  escolha**:

  > **Como Drift deve se conectar?**
  >
  > Sua escolha define como o Drift acessa a rede Nostr. Você pode
  > mudar depois em Configurações.
  >
  > ○ **Sempre via Tor** — máxima proteção contra censura e
  > rastreamento. Latência maior (~1-3s extra). Recomendado se você
  > está em jurisdição com censura conhecida.
  >
  > ○ **Auto** — começa em clearnet (rápido); se Drift detectar
  > bloqueio, troca pra Tor automaticamente. Detalhes ficam visíveis
  > em Configurações. Boa opção pra quem viaja entre redes diferentes.
  >
  > ○ **Sempre clearnet** — mais rápido, sem proteção contra ISP /
  > vigilância. Recomendado em rede confiável e jurisdição livre.

- User escolhe → grava `prefs.network_mode` + `prefs.firstBootPromptShown
  = true`.
- **Sem default detectado por geo-IP** (manifesto §17 + §28: cliente
  não infere localização por sinais externos não-consentidos).
- **Sem geolocation prompt automático** (Geolocation API só com
  toggle explícito em Settings, opt-in). Banner geográfico é
  **opt-in second-step** depois do prompt principal, se user clicar
  "ajude a sugerir" — não bloqueia o prompt.

User pode mudar em `<NetworkModeCard>` em Settings depois (igual
hoje). Mudança força reload (igual hoje).

### 3.3 Sem detecção silenciosa de país

Geolocation API **NÃO** é consultada por padrão. AT-11 + manifesto
§17/§28 vedam. Banner de boot pergunta sem inferir.

**Exceção opt-in** (Fase B se demand surgir): toggle em Settings
"sugerir modo baseado em fuso horário" (timezone do device é menos
sensível que geo-IP, mas ainda revelador). Default OFF. Não shippa
em Fase 6.4 atual.

---

## §4 — FSM simplificada — Tauri auto only

A FSM agora vive **só** em runtime Tauri, **só** quando
`prefs.network_mode === 'auto'`. Em outros modos (manual ou PWA),
não há FSM ativa — bootstrap segue caminho determinístico atual.

### 4.1 Estados

```
                       ┌──────────┐
                start →│  Probing │   (apenas Tauri+arti+auto)
                       └────┬─────┘
                            │
                       ┌────┴─────┐
                       │          │
              [yes,    ▼          ▼ [no, todos timeout]
              clearnet ok]   ┌───────────┐
                       ┌─→ Switching ←─┐ │
                  ┌────┴────┐         │ │
                  │Clearnet │         │ │
                  └────┬────┘         │ │
                       │ N×fail-window│ │
                       │   trip       │ │
                       ▼              │ ▼
                   Switching ─[arti ok]→ Tor
                                            │
                                            │ Tor fail (cap exceeded)
                                            ▼
                                         FailedAll
                                        (terminal — user override
                                         only, sem retry silent)
```

| State | Quando | Behavior |
|---|---|---|
| `Probing` | boot inicial em modo `'auto'` (Tauri); reentrância pós-`Switching` | Probe ativo paralelo em ≥3 relays, timeout 5s. **Boot exibe banner "verificando rede…" durante esta fase** (Barney AT-6 mitigation: pre-flight queue). Publishes ficam offline-queue até decisão. |
| `Clearnet` | probe sucesso clearnet; estável | wssTransport ativo (sem TorWebSocket override), webrtcTransport registrado. Probe **só reativo** (publish/sub failure boost). Sem probe periódico (Robin §5.4 + AT-3 fingerprint). |
| `Switching` | decisão de transição tomada | Transient: install/uninstall TorWebSocket global, força `location.reload()`. Persiste hint em `prefs.last_auto_decision = { mode: 'tor', at: now }` antes do reload. |
| `Tor` | arti bootstrap ok, TorWebSocket override ativo | wssTransport routes via Tor. webrtcTransport NÃO registrado (AT-5 + IP-leak gate F8). **NÃO probe clearnet em modo Tor (AT-5 mandatory)**. Probe Tor health periódico (10min ± 50% jitter). |
| `FailedAll` | clearnet fail + arti bootstrap fail (cap atingido) | step `'ready'` com `degradedReasons` ganha `ALL_TRANSPORTS_FAILED`. Banner explícito (Barney AT-1 mitigation: `BLOCKED_ALL` ternário). **Sem retry silent — sticky 30min mínimo**, user override only. |

### 4.2 Hysteresis (de Robin algorithm §4.3)

- **Tor → Clearnet (assimétrica conservadora):** **15min** de OK
  estável antes de desligar Tor (Robin original era 5min; Barney
  AT-12 + AT-9 reforçam: assimétrica, "voltar pra clearnet" exige
  *mais* sinais que "ir pra Tor"). Mitiga adversário que libera
  clearnet 30s pra forçar fallback (AT-9).
- **Tor health degrada → manual prompt:** Tor falhar em **60s
  (3 amostras consecutivas de circuit timeout)** → estado pula pra
  `Switching → FailedAll` (não silently volta clearnet, AT-5).
- **Cooldown 5min** pós-transição (anti-flapping AT-12). Reload
  thrashing protegido por `prefs.last_auto_decision` consultado em
  boot.
- **Cap N switches/hora:** ≤4 transições clearnet⇄Tor por janela
  rolling 1h. Excedido → fica em transport atual + banner UX
  (AT-12 mitigation).

### 4.3 Manual override sticky (Barney AT-10 mitigation)

`'auto'` é **um valor explícito de NetworkMode**, não um wrapper sobre
os outros. Se user escolhe `'clearnet'`, `'tor'` ou `'onion-only'`
manual em Settings, FSM **não roda** — `prefs.network_mode` é a fonte
única de verdade.

Em modo `'auto'`, user override em Settings:
- Trocar de `'auto'` pra `'clearnet'` → FSM para limpinho, prefs
  persiste, reload. Próxima boot é manual `'clearnet'` puro.
- Trocar de `'clearnet'` pra `'auto'` → prefs persiste, reload.
  Próxima boot ativa FSM, re-entra em `Probing`.
- **Sticky pra sempre**. Sem auto-bumps. Manifesto §17 reforça.

### 4.4 Estado **NÃO** persiste entre reloads (exceção: hint)

Estado runtime da FSM é **memória do módulo**, perdido em reload
(igual v1). Boot re-entra em `Probing`.

**Exceto:** `prefs.last_auto_decision = { mode: 'clearnet' | 'tor', at: number } | null`
persiste em `user_prefs` (Robin §8.4). Boot consulta:
- Se `auto` modo + `last.mode === 'tor'` + `(now - last.at) < 24h` →
  re-bootstrap arti direto (skip probe inicial). Probe periódico em
  background cuida do resto.
- Se `> 24h` → re-`Probing` do zero (assume rede pode ter mudado).

Trade-off: pequena persistência de pref vale boot rápido em país
censurado (não espera probe descobrir bloqueio toda vez).

---

## §5 — Implementation roadmap

Sequência crítica. Estimativas pessimistas (+50% buffer).

### (a) Schema migration + types — Marshall — 2h

- `src/types/drift.ts`:
  ```ts
  // Marker indica tipo Tauri-only (validação runtime, não tipo TS).
  export type NetworkMode =
    | 'clearnet'
    | 'tor'           // Tauri-only em runtime
    | 'onion-only'    // Tauri-only em runtime
    | 'auto'          // Tauri-only em runtime — NEW
  ```
- `src/lib/prefs.ts:applyPrefValue` — `isNetworkMode` ganha caso
  `'auto'`. **`setNetworkMode('auto')` em runtime PWA rejeita** com
  `Error('auto requires Drift Desktop')`. Validation gate centralizada
  em `prefs.ts` com check `isTauri()`.
- `prefs.firstBootPromptShown: boolean` (default `false`). Migration:
  alter table add column.
- `prefs.last_auto_decision: { mode, at } | null`. Migration: add
  TEXT JSON column.
- `tests/manifesto-conformance.test.ts` — caso `'auto'` rejeitado em
  PWA mock; aceito em Tauri mock. Conformance AT-14 (`auto` algoritmo
  100% local — sem `fetch`/`navigator.connection` imports).
- Update `DEFAULT_USER_PREFS` — fica `'clearnet'`. **Sem flip pra
  `'auto'`** (manifesto §17 + AT-10: cliente não escolhe por user;
  prompt explícito é o caminho).

**Dependência:** primeiro — types validados antes de FSM e UI.

### (b) FirstBootPrompt component — Lily — 2-3h

- Novo `src/components/Onboarding/FirstBootPrompt.tsx` (ou similar
  módulo Onboarding já existente).
- Aparece **se** `isTauri()` **AND** `prefs.firstBootPromptShown ===
  false` **AND** `prefs.network_mode === null` (ou inicial). Em PWA,
  não renderiza (mantém fluxo PWA atual sem prompt — pra users PWA,
  default `'clearnet'` segue igual hoje, com detection passiva
  cobrindo o gap).
- 3 botões radio + descrições conforme §3.2.
- Confirmar grava `prefs.network_mode` + `prefs.firstBootPromptShown
  = true`. Não força reload imediato (boot continua) — escolha entra
  em vigor a partir desse boot.
- Specs Vitest mínimos: render correto, dispatch correto, gating por
  `isTauri()`.

**Dependência:** depois de (a).

### (c) Detection logic puro (Robin algorithm reuse) — Marshall — 4-5h

- Novo `src/lib/transport/detection.ts` (puro):
  - `aggregateProbeSignal(probes, cfg, now)` — Robin §4
    pseudocódigo, função pura.
  - `pickProbeBatch(relays, state, size, now)` — Robin §4.
  - `probeRelay(relay, timeoutMs)` — I/O thin wrapper sobre
    `new WebSocket()`.
  - **Reusable em PWA e Tauri.** PWA usa pra disparar
    `<UpgradeBanner>`; Tauri usa pra alimentar FSM.
- 8-10 specs vitest em `tests/transport/detection.test.ts`.

**Dependência:** depois de (a). Pode ser concorrente com (b).

### (d) Tauri FSM — Lily — 4-6h

- Novo `src/lib/transport/fallback.ts` (Tauri-only — guard `isTauri()`
  no init):
  - State machine 5 estados (§4.1).
  - Pure decision functions (testáveis sem mocks):
    - `stateTransition(state, signal, cfg, now)` — central.
    - `shouldEnableWebRTC(currentMode): boolean` — gate F8/AT-5.
    - `applyHysteresis(state, cfg, now): boolean`.
    - `withinSwitchCap(history, cfg, now): boolean`.
  - Hysteresis usa `transport/policy/violationWindow` reusado.
  - Cooldown 5min enforced.
  - **Single source of truth** sobre modo efetivo (consumido por
    bootstrap, status indicator, telemetria).
- Wire em `src/lib/bootstrap.ts:240–295`:
  - Em modo `'auto'` (Tauri), antes de `registerTransport`, consulta
    FSM `runProbingPhase()`.
  - Banner "verificando rede…" em `step: 'auto-decide'` novo
    (Barney AT-6 mitigation: pre-flight queue antes de aceitar
    publishes).
  - `installTorWebSocketImpl` chamado pela FSM, não diretamente
    pelo bootstrap (consolidação).
  - `registerTransport(webrtcTransport, ...)` gateado por
    `fsm.shouldEnableWebRTC()`.
- Adicionar `unregisterTransport` em `orchestrator.ts` (~5 LOC) —
  útil pra dev/test, não primary path (transições usam reload).
- 8-10 specs vitest em `tests/transport/fallback-fsm.test.ts`.

**Dependência:** depois de (c).

### (e) Telemetria de switches — Marshall — 2-3h

- Nova tabela `fsm_events` em `src/lib/schema.sql` (idêntica a v1
  §10 — preservada porque não foi descartada):
  ```sql
  CREATE TABLE IF NOT EXISTS fsm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    transport TEXT,
    url TEXT,
    state_from TEXT,
    state_to TEXT,
    reason TEXT,
    payload TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fsm_events_at ON fsm_events(at);
  ```
- **Manifesto §28 compliance:** local-only, sem POST. Eviction LRU
  1000 entries / 7 dias, integrada com `evictOldPosts` 6h schedule.
- DiagnosticPanel **expõe pro user em Settings** (Barney AT-13
  mitigation: visível, não escondido). User vê histórico de
  switches automáticos, pode contestar.
- `tests/transport/fsm-telemetry.test.ts` — insert + eviction +
  query aggregate.
- Hook `_setEventSink((event) => ...)` test-only (igual `_resetRegistry`
  pattern v1).

**Dependência:** depois de (d).

### (f) Tests vitest puros — Marshall — incluído acima

Coberturas mandatory pre-merge (Barney §6):
- `aggregateProbeSignal` — todas variantes verdict.
- `stateTransition` — cada transição §4.1, hysteresis, cooldown,
  cap switches/hora.
- AT-5 enforcement: `shouldEnableWebRTC(Tor) === false` AND
  FSM **nunca probe clearnet em estado Tor** (test verifica que
  `runProbingPhase` em estado Tor não toca WebSocket clearnet).
- AT-10: setting `'clearnet'` manual em Settings persiste pós-reload,
  FSM não roda.
- AT-14: import-graph check — `fallback.ts` + `detection.ts` não
  importam `fetch` / `navigator.connection` / nada remoto.

### (g) UpgradeBanner (PWA) — Lily — 2h

- Novo `src/components/UI/UpgradeBanner.tsx` ou similar.
- Aparece em PWA quando `detection.detectBlockage()` retorna
  `blocked: true` no boot (chamado em background pós-`step: 'sync'`).
- Texto:
  > "Drift detectou bloqueio na sua rede. Tor automático exige
  > Drift Desktop. [Download Drift Desktop] [Adicionar relay
  > alternativo] [Ignorar]"
- Dismissível (persistido em `prefs.upgradeBannerDismissedAt`,
  re-aparece após 7 dias).
- 1 spec snapshot regression.

**Dependência:** depois de (c).

### Estimativa total v2

| Item | Owner | Estimativa |
|---|---|---|
| (a) Schema + types | Marshall | 2h |
| (b) FirstBootPrompt | Lily | 2-3h |
| (c) Detection logic puro | Marshall | 4-5h |
| (d) Tauri FSM | Lily | 4-6h |
| (e) Telemetria | Marshall | 2-3h |
| (f) Tests vitest puros | Marshall | (incluído acima) |
| (g) UpgradeBanner PWA | Lily | 2h |
| **Total sequencial** | | **~16-21h** ≈ 2-3 dias |
| **Total paralelo (2 personas)** | | **~10-14h** ≈ 1.5-2 dias |

V1 estimava 21-29h sequencial. V2 economiza ~5-8h por **descartar
PWA fallback theater** (não precisa criar simulacro de Tor em
PWA), simplificar FSM (Tauri-only, scope menor), e reusar
detection logic puro entre PWA e Tauri (DRY).

### Marcos de gating

- (a) merged → tipos validados, demais podem mergear.
- (b) merged → prompt funcional behind feature flag (oculto até
  (d) ship).
- (c) merged → PWA upgrade banner pode mergear independente.
- (d) merged + tests verdes → ship Tauri auto behind release flag.
- (e) merged → telemetria visível em DiagnosticPanel.
- Ship pra users: tudo merged + Robin testbed Fase A pass cenário (a)
  + (b) → §15 verified.

---

## §6 — Cross-references

### Sessões de research (companion docs 2026-05-08)

- [`Docs/sessions/auto-mode-detection-algorithm-2026-05-08.md`](../sessions/auto-mode-detection-algorithm-2026-05-08.md)
  Robin algorithm — §2.1 capability gap (origem da decisão (A)
  Tauri-only), §4 algoritmo puro reusado em (c)+(d), §6 anti-
  manipulação cruzando AT-5/AT-9, §11 implementabilidade.
- [`Docs/sessions/auto-mode-threat-model-2026-05-08.md`](../sessions/auto-mode-threat-model-2026-05-08.md)
  Barney threat model — AT-1 BLOCKED_ALL, AT-5 NUNCA probe clearnet
  em Tor, AT-9 manual confirmation, AT-10 sticky override, AT-11
  fundamental blocker (origem da decisão prompt-first), AT-12
  flapping, §3 5 mandatory mitigations.
- [`Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md`](../sessions/15-e2e-testbed-scoping-2026-05-08.md)
  Robin scoping original — §3 cenários (a)+(b)+(d), §7 item 4
  (modo `auto` deferred — agora endereçado), §8 R1-R3 limites
  testbed.

### Docs do Drift

- [`Docs/manifesto.md`](../manifesto.md) §15 anti-censura por país,
  §17 sem chave mestra (cliente não decide silent), §28 privacidade
  visível, §3 dispositivo descartável (NÃO implica decisões silent),
  §4 anonimato (limites contra A4 já admitidos linhas 110-121).
- [`Docs/drift-arquitetura-v4.md`](../drift-arquitetura-v4.md)
  §23.7 modo Tor 3 modos (legacy intent), §29.1 capability matrix
  Tauri vs PWA (validada por Robin §2.1), §32 transport.
- [`Docs/sessions/webrtc-architecture-audit-2026-05-08.md`](../sessions/webrtc-architecture-audit-2026-05-08.md)
  T1–T4 threats, defesas em `transport/policy/` reusadas em FSM.
- [`Docs/runtime-pwa-vs-tauri.md`](../runtime-pwa-vs-tauri.md) — F8
  fonte canônica.
- [`Docs/transport-paths.md`](../transport-paths.md) — matriz dos
  3 caminhos subscribe + 2 publish; FSM consulta gate webrtc.
- [`Docs/webrtc-6.4-plan.md`](../webrtc-6.4-plan.md) — IP leak via
  WebRTC ICE (precedente AT-5).

### Código do Drift

- `src/types/drift.ts:346` — `NetworkMode` extension.
- `src/types/drift.ts:308–355` — `UserPrefs` extension
  (`firstBootPromptShown`, `last_auto_decision`).
- `src/lib/prefs.ts:81–82` — `applyPrefValue` validation.
- `src/lib/bootstrap.ts:240–295` — gate atual de Tor + WebRTC; passa
  a ser controlado pela FSM em modo `'auto'`.
- `src/lib/transport/orchestrator.ts:60–78` —
  registerTransport/_resetRegistry; **adicionar** unregisterTransport
  (~5 LOC, dev/test escape hatch).
- `src/lib/transport/wss.ts:1–32` — comentário magic-at-distance Tor
  (preservado).
- `src/lib/transport/torWebSocket.ts:298–304` —
  `installTorWebSocketImpl` (controlado por FSM agora).
- `src/lib/transport/tor.ts:75–87` — `torConnect/disconnect/status`.
- `src/lib/transport/policy/violationWindow.ts` — pattern de
  hysteresis reusado em §4.2.
- `src/lib/transport/policy/pingPongTracker.ts` — pattern reusable
  em probe schedule.
- `src/lib/relays.ts:252–319` — `applyNetworkMode` (renomear pra
  `applyEffectiveMode` — mantém pureza determinística).
- `src/lib/probe.ts:1–60` — anti-eclipse probe; **separado** da FSM
  (semântica diferente — preservado).
- `src/lib/seeder.ts:67–72` — F8 documentation no seeder gate.
- `src/components/Settings/SettingsCards.tsx:102–311` —
  `NETWORK_MODE_OPTIONS` + `NetworkModeCard` (ganha 4 botões em
  Tauri, 3 em PWA).
- `src/components/Onboarding/` — local pro novo `<FirstBootPrompt>`.
- `src/components/UI/` — local pro novo `<UpgradeBanner>`.
- `src/App.tsx:1142–1215` — `StatusIndicators` HomeHeader (consulta
  FSM effective mode).
- `tests/transport/` — novos `detection.test.ts`, `fallback-fsm.test.ts`,
  `fsm-telemetry.test.ts`.
- `tests/manifesto-conformance.test.ts` — adicionar conformance AT-14
  (no remote imports em fallback/detection).

---

## §7 — Diff vs v1

| v1 elemento | v2 mantém? | Motivo |
|---|---|---|
| Opção A FSM dedicada em módulo separado | ✅ mantida (mas Tauri-only) | Single source-of-truth ainda válido. Lógica isolada testável. |
| 5-state FSM (`Probing`/`Clearnet`/`Switching`/`Tor`/`FailedAll`) | ✅ simplificada | Manteve essência; descartou complexidade de "FSM ativa em PWA". `BLOCKED_ALL` ternário (AT-1) entra como variante do `FailedAll`. |
| Hysteresis (Robin) | ✅ mantida | Anti-flapping AT-12 ainda needed. **Asimétrica reforçada (15min Tor → clearnet)**. |
| Cooldown 5min pós-transição | ✅ mantido | Anti-thrashing AT-12. |
| `auto` literal em `NetworkMode` | ✅ mas restricted | Schema valida Tauri-only via `setNetworkMode` runtime gate. Marker semântico de capability. |
| Magic silent fallback | ❌ **DESCARTADO** | AT-11 fundamental + AT-9 eclipse. Substituído por **first-boot prompt obrigatório + banner em cada switch** (AT-9 mitigation). |
| Default novos users = `'auto'` | ❌ **DESCARTADO** | Manifesto §17 + AT-10. Default permanece `'clearnet'`; user escolhe via prompt no primeiro boot Tauri. |
| PWA fallback automático | ❌ **DESCARTADO** | Capability gap (Robin §2.1) + false confidence inaceitável. Substituído por **detecção passiva + UpgradeBanner**. |
| Probe periódico em background (Tauri) | ⚠️ só em modo Tor | PWA: probe-on-demand single shot (banner trigger). Clearnet em Tauri: **só reativo** (publish/sub failure boost), sem periódico (AT-3 fingerprint + manifesto §28). |
| `applyNetworkMode` rename pra `applyEffectiveMode` | ✅ mantido | Mantém pureza determinística manifesto §7. |
| Tabela `fsm_events` separada do domínio | ✅ mantida | F4 invariante #1 — não toca posts/spreads/buries/reports. |
| Telemetria local-only | ✅ mantida | Manifesto §28. **Visível pro user em DiagnosticPanel** (AT-13 mitigation). |
| DEFAULT_USER_PREFS migration "manter escolha existing users" | ✅ mantida | AT-10 sticky override. |
| Conformance test `manifesto-conformance.test.ts` | ✅ expandido | Adiciona AT-14 (no remote imports) + AT-10 (sticky persistence) + PWA reject `auto`. |
| F1–F9 forças arquiteturais | ✅ mantidas | Restrições não mudaram; apenas a forma de respeitá-las. |
| Probe initial paralelo de 3+ relays | ✅ mantido | Robin §4 default; reusado em detection.ts. |
| Estimativa total | ⬇️ **~16-21h vs 21-29h v1** | Economiza por descartar PWA fallback theater + scope FSM Tauri-only. |
| Banner UI em `FailedAll` | ✅ mantido | AT-1 mitigation: estado ternário visível. Reforçado: **persistente, não-toast**. |
| User pode override em qualquer momento | ✅ mantido | AT-10 sticky. |
| `unregisterTransport` (~5 LOC) | ✅ mantido | Dev/test escape hatch. Não primary path. |

### Mudanças de mindset (não no código diretamente)

| v1 mindset | v2 mindset |
|---|---|
| "Auto é magic — sistema decide" | "Auto é informed choice — user escolhe via prompt" |
| "PWA degenera graciosamente pra clearnet+banner" | "PWA não tem `auto`; tem **detecção passiva** + caminho de upgrade" |
| "Default-recomendado pra todos os novos users" | "Default `'clearnet'`; prompt apresenta opções" |
| "Probe periódico em ambos os modos" | "Probe só reativo em clearnet; periódico só em Tor (e mesmo lá com jitter)" |
| "Trade-off aceito: timing channel risk" | "Trade-off explicitado: AT-11 inerente, mitigado por consent prompt" |

---

## §8 — Limites assumidos honestamente

V2 não resolve tudo. Limites documentados:

1. **AT-11 ainda existe parcialmente.** Mesmo com prompt, user que
   escolhe `'auto'` em país censurado emite "moment of switch" no
   evento de fallback. Mitigação: prompt deixa claro o trade-off
   ("Tor sempre" oferece mais anonimato que "Auto" pra esse caso).
   User com awareness escolhe; user sem awareness vai pelo default
   `'clearnet'` (AT-11 não se aplica — não há switch).

2. **AT-7 (Tor bridge enumeration) não endereçado.** Pluggable
   transports (obfs4, snowflake) ficam pra Fase 6.4 follow-up.
   Manifesto §15 honesto: `'auto'` em país altamente censurado pode
   falhar no bootstrap arti se directory auths estão bloqueados;
   `FailedAll` então mostra link pra docs "configurar bridge custom".

3. **Manifesto §15 entrega através de Tauri.** PWA cumpre §15 *parcialmente*
   (detecção + upgrade hint); entrega completa exige Tauri+arti.
   Honestidade vs marketing: PWA banner não promete o que não pode
   entregar.

4. **`auto` mais lento que `tor` manual em país censurado.**
   `tor` manual desde boot pula a fase de probe clearnet (AT-5
   exposto + tempo perdido). `'auto'` é compromisso usabilidade vs
   anonimato — prompt deixa explícito.

---

## §9 — Próximos passos

1. **Arquiteto aprova v2** ou pede iteração.
2. Marshall começa (a) — schema migration. Sequencial blocker.
3. Lily começa (b) FirstBootPrompt em paralelo.
4. Marshall executa (c) detection logic puro. Lily aguarda pra
   começar (d) FSM.
5. Robin testbed Fase A roda em paralelo desde (a) — independente,
   gera baseline pra calibração.
6. Após (d) merged: ship behind release flag, calibração via
   testbed, flip flag.
7. Telemetria (e) e UpgradeBanner (g) podem rodar concorrentes com
   (d).

---

*Ted · 2026-05-08 · ADR v2 redesign · v1 (Opção A FSM ativa) descartada
após convergência Robin algorithm + Barney threat model · v2 = first-boot
prompt + Tauri-only auto · custo total ~16-21h sequencial, ~10-14h
paralelizado · Marshall + Lily executores · cobertura testbed Robin Fase A
+ tests vitest puros · 5 mandatory mitigations Barney incorporadas
(AT-1 BLOCKED_ALL, AT-5 nunca probe clearnet em Tor, AT-9 banner em
switch, AT-10 sticky override, AT-14 100% local) · AT-11 limite
honesto documentado*
