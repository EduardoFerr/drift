# RFC — Fase 6 Tor integration: roadmap pra §15 ✅ end-to-end

| Field        | Value                                                           |
|--------------|-----------------------------------------------------------------|
| Title        | Fase 6 Tor integration — gaps + roadmap até §15 ✅              |
| Date         | 2026-05-15                                                      |
| Author       | Ted (arquitetura)                                               |
| Status       | Draft                                                           |
| Revisões     | [revisão: segurança] (Barney), [revisão: conformance] (Marshall) — pending |
| Manifesto    | §4, §15, §17, §28                                               |
| Arquitetura  | v5.3 §30.12, §30.13; webrtc-6.4-plan.md §"arti integration"     |
| Supersedes   | —                                                               |
| Depende de   | `--features arti` build (Cargo.toml:76), Fase 6.7 (build reproduzível) |

---

## 1. Background — estado atual

Drift entrega Tor como **transport opt-in no cliente nativo Tauri**.
Coverage matrix Robin R1 marca §15 como 🟡: capacidade técnica
entregue, plumbing UX residual. Esta RFC consolida o que ainda
separa o estado atual (🟡) de §15 ✅.

### O que está pronto

**Rust shell (`src-tauri/`)** — atrás do feature flag `arti`:

| Arquivo                  | Responsabilidade                                                        |
|--------------------------|-------------------------------------------------------------------------|
| `src-tauri/Cargo.toml`   | feature `arti` opt-in (arti-client 0.41 + tor-rtcompat + tokio + tokio-tungstenite). Default build é leve sem arti. |
| `src/tor.rs`             | IPC commands `tor_connect`, `tor_disconnect`, `tor_status` + `TorState` global (mutex client, atomic stream counter). |
| `src/socks5_proxy.rs`    | Listener SOCKS5 RFC 1928 em `127.0.0.1:<porta>`, traduz `CONNECT` → `arti_client.connect()`. Subset: NO_AUTH, DOMAIN/IPV4, CONNECT only. |
| `src/tor_ws.rs`          | Bridge WebSocket IPC (`tor_ws_open`/`send`/`close`) — webview ignora SOCKS5 programático, então `tokio-tungstenite` roda *dentro* do `arti DataStream`. Emite eventos Tauri `tor_ws::msg|close|error`. |

**TS bridge (`src/lib/transport/`)**:

| Arquivo                  | Responsabilidade                                                        |
|--------------------------|-------------------------------------------------------------------------|
| `tor.ts`                 | Wrappers TS dos 3 IPC commands + `getTorProxyAddr()` helper. Dynamic import de `@tauri-apps/api`. |
| `torWebSocket.ts`        | Classe `TorWebSocket` (mimetiza WebSocket nativo) + `installTorWebSocketImpl()` que injeta no `nostr-tools/pool` via `useWebSocketImplementation`. Subset cobre `nostr-tools` (sem `ping()` — `enablePing: true` quebra). |

**Bootstrap wire-up** (`src/lib/bootstrap.ts:235-266`):

```text
if (isTauri() && (networkMode === 'tor' || networkMode === 'onion-only')) {
  tor.ts + torWebSocket.ts (lazy import)
  torConnect()
    ok    → installTorWebSocketImpl() — wssTransport passa a tunelar via Tor sem mudança
    fail  → addDegradedReason('TOR_BOOTSTRAP_FAILED' | 'TOR_FEATURE_OFF') — não bloqueia boot
}
```

Lazy import (CWV-3, 2026-05-15) garante zero custo de bundle em PWA puro.

**UI** (`src/components/Settings/SettingsCards.tsx:264-407`) —
`NetworkModeCard`:

- Picker 3-way: `clearnet` / `tor` / `onion-only`.
- Gating: `requiresTauri` desabilita `tor`/`onion-only` em PWA.
- Trocar mode exige `location.reload()` (convenção Drift — `setActiveIdentity` idem).
- 4 banners de alerta condicionais já em produção:
  - `torSelectedInPwa` (leak silencioso de IP)
  - `torConfiguredButBootError`
  - `torDegradedReason` (TOR_BOOTSTRAP_FAILED | TOR_FEATURE_OFF)
  - `!onionAvailable` (onion-only sem relay `.onion`)

**Roteamento de relay URLs** (`src/lib/relays.ts:289-326`) —
`activeReadRelays/activeWriteRelays` já consultam `network_mode`:

- `tor`: prefere `.onion` quando o seed tem alias; senão usa clearnet via TorWebSocket.
- `onion-only`: filtra fora qualquer URL sem `.onion` conhecido.

**Smoke test e2e** — `Docs/sessions/sprint7-smoke-2026-05-01.md`:
✅ PASS em `0cd2362`. Wireshark confirmou zero SNI de relay Nostr
em modo `onion-only`. Tráfego foi 100% pra portas Tor guard
(444/9001/9100/9200). §15 VERIFIED nessa baseline.

### O que **NÃO** está pronto — gaps mapeados

Os gaps abaixo são listados sem ordenação ainda; sub-etapas
faseadas em §6.

1. **Sem indicador visual permanente "via Tor / clearnet"**. Settings
   tem o picker + banners de erro, mas não há badge no chrome do app
   (header/footer) mostrando estado atual de rede. User precisa
   abrir Settings pra saber se está realmente sob Tor. Custos
   §28 (privacidade pelo mínimo) → user deve saber sempre.

2. **Sem first-run UX educando sobre Tor**. Onboarding existente
   (Fase 4) não menciona modo Tor. User chega em Settings e
   precisa ler manifesto §15 + 4 banners pra entender custo
   (latência +500ms-2s) vs ganho (IP não vaza).

3. **Bootstrap `tor_connect` sem timeout/retry exposto**.
   `TorClient::create_bootstrapped()` em arti pode levar 10-60s
   na primeira boot (sem cache de consensus). Hoje:
   - Sem progresso intermediário (UI fica em spinner cego durante todo bootstrap)
   - Sem timeout client-side (se arti trava no guard handshake, boot fica indefinidamente em `connecting`)
   - Sem retry button no banner de falha — user precisa fechar Settings, reload manual

4. **Eventos pendentes durante bootstrap não têm comportamento definido**.
   `startSync()` está em `scheduleIdle` pós-`step:'ready'`. Em modo Tor:
   - Boot marca `step:'ready'` ANTES de `tor_connect` resolver? **NÃO** — bootstrap.ts:235-266 roda síncrono antes do setBoot(ready). ✓
   - Mas se user já tinha tab aberta + tor estava ON + reload + tor_connect demora 30s, UI fica em `step:'connecting' | 'syncing'` por 30s sem feedback granular. Sub-progresso (consensus download %, guard handshake) não chega ao TS.

5. **Sem estratégia de circuit refresh**. arti não expõe API
   estável de NEWNYM (Tor C control protocol equivalente). Mas
   pra anonimato real, posts repetidos vindos do mesmo guard
   permitem correlação temporal. Hoje: 1 circuit pra toda a
   sessão. Política precisa decisão (per-post? per-sessão?
   timer?). **arti API gap** — investigar `TorClient::isolated_client()` ou
   `IsolationToken`.

6. **Onion-only mode interage mal com WebRTC**. `bootstrap.ts:333`
   já gate-keeps WebRTC pra clearnet only (correto: STUN/ICE
   vaza IP). Mas em modo `tor` simples (não onion-only), WebRTC
   também é desligado. Decisão registrada (§30.13) mas vale
   anotar: §15 garantia em modo `tor` é só pro WSS; rede P2P
   fica off. Aceitável, mas user não sabe.

7. **Sem fallback automático configurável**. Hoje em falha de
   Tor, app degrada silenciosamente pra clearnet com banner
   warning. **Manifesto §15** (anti-censura por país) sugere
   que em país hostil, fallback automático pra clearnet *é
   exatamente o que o adversário quer* — leak imediato do IP.
   Comportamento atual = "fail open" privacidade. **§4 (anonimato
   por design)** pede "fail closed" como opção pelo menos em
   `onion-only`. Hoje onion-only sem .onion já bloqueia (relays
   filtrados → 0 relays → sync efetivamente offline), mas em
   modo `tor` puro com bootstrap falhando, o app continua
   posting em clearnet. **Bug latente, não regressão.**

8. **`tor_ws.rs` drop silencioso de binary frames**. Hoje
   `tungstenite::Message::Binary` é dropado sem aviso. NIP-01
   é text/JSON, mas algumas extensões (NIP-44, blossom) usam
   binary. Risco de futuras incompatibilidades silenciosas.

9. **Cache de Tor data dir não-customizado**. `TorClientConfig::default()`
   usa `$HOME/.arti` no host — vaza presença do Drift no FS do user
   fora do app data dir. Comentado em tor.rs:163-165 como refinement.
   Forense leve (não privacidade direta), mas relevante pra §17
   (manifesto: build reproduzível + comportamento previsível).

10. **Sem testes automatizados**. Smoke test e2e é manual
    (Wireshark + execução em Windows). CI atual não roda
    `--features arti` build (arti workspace = ~30 crates, ~5min
    primeira build, libsqlite3 bundled fix necessário). Cada
    refactor de bootstrap pode regredir §15 sem detecção.

11. **`enablePing: true` proibido implícito**. `torWebSocket.ts:35-43`
    documenta que `useWebSocketImplementation(TorWebSocket)` quebra
    se SimplePool for instanciado com `enablePing: true`. Hoje
    nostr-tools default é false; se algum upgrade mudar default,
    falha em runtime só em modo Tor — bug difícil de capturar.
    Mitigação: guarda `ping = () => {}` no-op + pong sintético
    (comentado no source). Investir agora ou aceitar dívida.

12. **Multi-identidade + Tor — sem isolamento de circuit**. Trocar
    de identidade (manifesto §3-4) hoje compartilha o mesmo guard
    Tor. Atacante observando guard correlaciona timing de posts
    sob `npub_A` e `npub_B` → linkability. Mitigação séria exige
    `IsolationToken` por identity (arti API).

---

## 2. Goals — o que conta como "Fase 6 Tor done"

1. **§15 ✅ end-to-end** — user em qualquer plataforma Tauri
   suportada (Linux/macOS/Windows) consegue: instalar build com
   `--features arti`, ligar modo Tor via UI sem ler doc, ver
   feedback visual de progresso durante bootstrap, ver indicador
   permanente de rede em uso, sob falha entender o que fazer.

2. **§4 (anonimato por design) reforçado** — opção "strict mode"
   (fail closed): em onion-only, falha de Tor = app não posta /
   não sincroniza, nunca degrada pra clearnet. User opt-in.

3. **§28 (privacidade pelo mínimo)** — circuit refresh por
   identidade (multi-id sem linkability via guard). Cache em app
   data dir.

4. **CI cobertura** — `--features arti` build entra em CI
   (job opcional, não blocking de PR — custo de tempo). Smoke
   e2e re-executável via script (não Wireshark manual).

---

## 3. Non-goals

Pra prevenir scope creep:

- **Drift NÃO opera Tor hidden service (.onion) próprio**.
  Operadores de relay são livres pra publicar alias `.onion`
  no NIP-65; cliente consome. Cliente nunca é endpoint.
- **NÃO substitui WebRTC P2P por Tor**. WebRTC continua off em
  modo Tor (decisão §30.13). Pra rede mesh sob censura, Fase 7+
  endereça via i2p/sneakernet/relay autohospedado.
- **NÃO suporta Tor em PWA browser**. Manifesto §15 reconhece:
  arti em WASM não é viável (size, perf, falta de net APIs).
  Stays Tauri-only. PWA + Tor sistêmico (Brave/Tor Browser
  apontando pra Drift PWA) já funciona naturalmente — fora do
  escopo deste RFC.
- **NÃO embarca binário `arti-cli`**. Listener próprio em Rust
  (socks5_proxy.rs) cobre.
- **NÃO implementa bridges/pluggable transports** (obfs4, snowflake)
  nesta fase. arti vanilla funciona em maioria dos países; bridges
  ficam pra sprint específico se evidência empírica demandar.
- **NÃO migra arti pra versão estável "1.0"** se isso atrasar
  meses — pin em 0.41 enquanto upstream maturece.

---

## 4. Design

### 4.1 UI — chrome permanente de rede

Adicionar componente `NetworkBadge` no header (próximo ao avatar
identity). Estados:

| Estado          | Render                                | Tooltip                                    |
|-----------------|---------------------------------------|--------------------------------------------|
| clearnet        | `· clearnet` (muted, low salience)   | "Tráfego direto pros relays. IP visível." |
| tor-connecting  | `⏳ tor`                              | "Bootstrap em curso… ~10-60s primeira vez" |
| tor-connected   | `🧅 tor` (accent)                     | "Via SOCKS5/arti · circuits=N"             |
| tor-error       | `⚠ tor offline` (warn)                | "Tor caiu — clique pra Settings"           |
| onion-only      | `🛡 onion` (accent2)                  | "Só relays .onion · N online"              |

Clique → `<Link to="/settings#network">`. Componente lê de
`useBootStore` (degradedReasons, step) + `usePrefsStore`
(network_mode) — sem nova store.

### 4.2 Bootstrap progress events

`tor.rs::tor_connect` hoje resolve só em sucesso/falha terminal.
Adicionar: emit `tor::bootstrap_progress` events via `AppHandle`
durante bootstrap. arti expõe `TorClient::bootstrap_events()`
stream — encaminhar:

```text
tor::bootstrap_progress { phase: 'directory' | 'guard' | 'circuit', percent: 0-100 }
```

TS bootstrap.ts subscribes + chama `setBoot({ step: 'tor-bootstrap', torProgress: { phase, percent } })`.
Splash screen mostra "Tor · baixando consensus · 47%".

**Custo**: ~30 LOC Rust (subscribe ao stream + emit), ~20 LOC TS
(listener + store extension).

### 4.3 First-run UX

Quando user habilita `tor` pela primeira vez (transição
`clearnet → tor` em `NetworkModeCard.changeMode`), antes do
reload mostrar `<TorIntroDialog>`:

- O que muda: IP não vaza pros relays.
- O que custa: 500ms-2s a mais por publish, ~10-60s primeira boot.
- Estado: 1 circuit por sessão (hoje) → refresh por identity
  (após sub-etapa 6.4.6).
- Limitação: WebRTC fica off (P2P direto vazaria IP via STUN).
- Limitação: fora de Tauri, modo Tor não é suportado.

Confirmar → `setPref('network_mode', 'tor')` + reload.
Cancelar → no-op.

### 4.4 Bootstrap timeout + retry

Wrapper TS em torConnect:

```ts
async function torConnectWithTimeout(ms = 90_000): Promise<TorStatusIPC> {
  return Promise.race([torConnect(), timeout(ms, 'tor-bootstrap-timeout')])
}
```

90s default (cobre cold boot pessimista). Em timeout:
`addDegradedReason('TOR_BOOTSTRAP_TIMEOUT', ...)` + banner com
botão **Tentar de novo** que chama `torConnect()` sem reload
(`installTorWebSocketImpl` já é idempotente — verificar e
documentar).

Botão "Tentar de novo" também aparece em `TOR_BOOTSTRAP_FAILED`.

### 4.5 Strict mode (fail closed) opt-in

Adicionar pref `tor_strict_mode: boolean` (default `false`).
Quando `true` + `network_mode ∈ {tor, onion-only}` + bootstrap
falha:

- `wssTransport` registra mas `publish/subscribe` retornam erro
  imediato `TOR_REQUIRED_BUT_OFFLINE`.
- UI: banner persistente "Tor offline · modo estrito ativo · app
  em read-only local".
- Feed segue lendo do SQLite (cache da sessão anterior) — não
  bloqueia UI, só bloqueia network.
- Settings permite trocar pra clearnet com aviso explícito
  ("vai vazar IP nos próximos posts").

Sem strict mode (default), comportamento atual é mantido:
degrada pra clearnet com banner.

Manifesto §4 — anonimato é compromisso, mas usuários casuais
não devem ser surpreendidos por app travado. Opt-in equilibra.

### 4.6 Circuit isolation por identity

Em `setActiveIdentity` (multi-id), quando feature arti ativa:

```ts
// pseudo
const torClient = await getTorClient() // expose via novo IPC `tor_isolated_client`
const isolated = torClient.isolatedClient() // arti API
swapPoolWebSocketImpl(isolated)
```

Investigação necessária: `arti_client::IsolationToken` API
status (estable em 0.41? quebra com upgrade?). Se instável,
fallback: forçar reload em troca de identity (já é o caso hoje
por outras razões — invariante #15). Documentar como aceitável
mas suboptimal.

### 4.7 CI — `--features arti` build

Job opcional em `.github/workflows`:

- Trigger: `workflow_dispatch` + nightly cron + PR com label `tor`.
- Steps: cache `~/.cargo + target`, `cargo check --features arti`
  (skip full release build em PR — 5min). Nightly faz release build
  + roda smoke script.
- Smoke script: `scripts/smoke-tor.sh` — sobe headless tauri,
  set `network_mode=tor`, aguarda `state=connected`, publica
  evento dummy via IPC, captura PCAP via `tshark` (Linux) ou
  `windump` (Windows runner), grep SNI = 0 hits pros hosts
  clearnet. Reproduzir Wireshark manual de 2026-05-01.

Custo: ~1.5h setup inicial, ~5min/exec.

### 4.8 Hardening menor

- `tor.rs:163`: customizar `cache_dir` pra `app_data_dir()` Tauri
  (não `$HOME/.arti`). 1 commit, ~10 LOC.
- `tor_ws.rs:230`: log warning quando binary frame chega
  (em vez de drop silent). Marca dívida se ocorrer em campo.
- `torWebSocket.ts`: stub `ping = () => { setTimeout(() => emit('pong'), 0) }`
  preventivo. ~5 LOC.

---

## 5. Manifesto alignment

- **§4 (anonimato por design)** — strict mode (4.5) torna
  promessa cumprível mesmo em rede hostil. Circuit isolation
  por identity (4.6) impede correlação multi-id via guard.
- **§15 (anti-censura por país)** — capacidade técnica entregue
  (smoke 2026-05-01); este RFC fecha UX + observabilidade pra
  user real conseguir usar sem ler doc. CI (4.7) garante que
  futuros refactors não regridem silenciosamente.
- **§17 (sem chave mestra)** — cache em app data dir (4.8) +
  socks5_proxy ~150 LOC auditável + sem child process `arti-cli`.
  arti workspace é mais código, mas pinado e auditável pelo
  user (build reproduzível depende de Fase 6.7).
- **§28 (privacidade pelo mínimo)** — NetworkBadge (4.1)
  garante que user sabe sempre se está sob Tor. First-run
  (4.3) educa sobre trade-offs.

---

## 6. Implementation plan — sub-etapas faseadas

Cada sub-etapa = 1 sprint (~3-5 dias arquiteto + 1-2 dias revisão).

| # | Sub-etapa                              | Esforço | Bloqueia §15 ✅? |
|---|----------------------------------------|---------|-----------------|
| 6.4.5 | NetworkBadge component + wiring   | 2-3d    | Sim — §28       |
| 6.4.6 | Bootstrap progress events + timeout+retry | 4-5d | Sim — UX boot   |
| 6.4.7 | First-run TorIntroDialog          | 2d      | Não, mas §28    |
| 6.4.8 | Strict mode (fail closed) opt-in  | 3-4d    | Sim — §4        |
| 6.4.9 | Hardening (cache_dir, ping stub, binary warn) | 1d | Não, debt |
| 6.4.10 | Circuit isolation por identity   | 4-5d *  | Não — best effort |
| 6.4.11 | CI `--features arti` + smoke script auto | 3d  | Não, mas regression guard |
| 6.4.12 | RFC review + sign-off Barney/Marshall + matrix update | 1d | Fechamento |

\* depende de investigação API `IsolationToken` — se arti não
expõe estável, sub-etapa vira "documentar limitation + force
reload" em ~1d.

**Total**: ~20-25 dias-trabalho de arquiteto. Realisticamente
3-4 sprints calendar (paralelizando review/code).

### Ordem sugerida de execução

1. **6.4.5 + 6.4.7** em paralelo (UI-only, sem refactor Rust).
2. **6.4.9** (hardening trivial — quick wins).
3. **6.4.6** (bootstrap UX — depende de Rust changes).
4. **6.4.8** (strict mode — depende de 6.4.5 pro banner).
5. **6.4.11** (CI — depende dos changes acima estarem estáveis).
6. **6.4.10** (circuit isolation — best-effort após o resto).
7. **6.4.12** (sign-off).

---

## 7. Open questions

1. **`enablePing` defense — implementar agora?** torWebSocket.ts:35-43
   documenta dívida. 6.4.9 inclui stub preventivo, mas se Barney
   (revisão segurança) achar que pong sintético é signal corrompido,
   preferir crash explícito quando ping é tentado. Trade-off:
   resiliência vs honestidade do contrato.

2. **`tor_strict_mode` é per-identity ou global?** Hoje pref store
   é global. Se cada identity tem sua expectativa de anonimato
   (work npub = clearnet OK, paranoid npub = strict), faria
   sentido per-identity. Mas complica UI substancialmente.
   Recomendação: **global no MVP**, per-identity como follow-up
   após user evidence.

3. **Splash screen com tor progress vs spinner cego?** 6.4.6
   propõe progress bar. Alternativa: spinner + texto rotativo
   ("conectando…", "ainda conectando…", "primeira boot pode levar
   1min…"). Progress real é mais sincero mas custa ~50 LOC extras
   pra subscribe+forward dos arti events. Recomendação: progress
   real — desktop user com ~60s de espera merece honestidade.

4. **CI nightly vs PR-label-triggered**? Build de 5min é caro pra
   CI matrix do repo. Compromisso: nightly + label `tor` em PR.
   Decisão de quem aplica a label = quem editar arquivo em
   `src-tauri/src/tor*.rs` ou `src/lib/transport/tor*.ts`
   (regex auto-label via GH Action).

5. **i18n strings dos novos componentes?** Drift tem strings PT
   embutidas (manifesto declarado PT-first). Strict mode banner,
   TorIntroDialog, NetworkBadge tooltips — manter PT-only ou
   estruturar pra i18n? Hoje resto do app é PT inline; manter
   coerência (PT inline) até skill `i18n-localization` rodar
   pass dedicado.

---

## 8. Alternatives considered

### 8.1 Embarcar `arti-cli` como child process

**Rejeitada**. +5MB no bundle, gerência de signal/port/shutdown.
Listener próprio em socks5_proxy.rs já cobre ~150 LOC.

### 8.2 Tor em PWA via WASM build do arti

**Rejeitada (por enquanto)**. arti maintainers não suportam
WASM target oficialmente; bundle size esperado >10MB; APIs de
rede (raw TCP) faltam no browser. Mesmo se acontecer,
correlation attacks via WebRTC ICE / fingerprinting tornam
"PWA + Tor" pouco honesto pro user. Tauri-only é admissão clara.

### 8.3 i2p em vez de Tor

**Rejeitada**. Userbase muito menor, audit footprint menor,
sem implementação Rust pura comparável a arti, hostility maior
em países que monitoram protocolos (Tor é "menos suspeito" em
muitos países). Pode entrar como transport adicional Fase 7+
se evidência demandar.

### 8.4 Mixnets (Nym, Loopix)

**Rejeitada (por enquanto)**. Latência alta (10-30s por mensagem)
incompatível com UX de feed social. Modelo de pagamento (NYM token)
introduz vetor de censura. Pra modo "panic" futuro pode fazer
sentido — fora do escopo Fase 6.

### 8.5 Tor Browser bundle externo + Drift apontando

**Rejeitada como solução única**, mas continua **funcionando
naturalmente** sem código adicional: user pode rodar Drift PWA
dentro de Tor Browser. Documentar como caminho válido pra users
sem Tauri.

---

## 9. Risks & mitigations

| Risco                                     | Probabilidade | Mitigação |
|-------------------------------------------|---------------|-----------|
| arti 0.41 → 0.42 quebra API IsolationToken | Média        | Pin major. Sub-etapa 6.4.10 tem fallback (force reload). |
| CI nightly arti build oxida (5min flaky)  | Alta         | Cache `~/.cargo + target/`. Allowlist re-run em flake. Non-blocking de PR. |
| Strict mode confunde user casual          | Média        | Opt-in (default off). First-run dialog explica trade-off. |
| Smoke script tshark/windump cross-platform | Média        | Começar Linux only; Windows runner = follow-up. |
| Bootstrap progress events em arti são privates | Baixa-Média | Pre-check API antes da sub-etapa 6.4.6. Fallback: barra fake based em timeout. |
| TorIntroDialog adiciona fricção, user abandona | Baixa       | Cancel = no-op (não muda mode). User volta quando quiser. |

---

## 10. References

- Manifesto v2.2 §4, §15, §17, §28 — `Docs/manifesto.md`
- Arquitetura v5.3 §30.12, §30.13 — `Docs/drift-arquitetura-v4.md`
- Smoke test e2e — `Docs/sessions/sprint7-smoke-2026-05-01.md`
- arti integration spec — `Docs/webrtc-6.4-plan.md` §"arti integration"
- Coverage matrix R1 — Robin sprint output (status §15 🟡)
- Source:
  - `src-tauri/Cargo.toml:40-76` (feature flag)
  - `src-tauri/src/{tor,socks5_proxy,tor_ws}.rs`
  - `src/lib/transport/{tor,torWebSocket}.ts`
  - `src/lib/bootstrap.ts:220-266`
  - `src/components/Settings/SettingsCards.tsx:264-407`
  - `src/lib/relays.ts:289-326`
- Commit relevante: `0cd2362` (baseline smoke verified)

---

*Status: Draft · pendente [revisão: segurança] (Barney B5 paralelo) + [revisão: conformance] (Marshall M1 paralelo). Sign-off vira sub-etapa 6.4.12.*
