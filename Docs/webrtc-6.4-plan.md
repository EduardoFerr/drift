# Fase 6.4 — Tor Transport

> **STATUS** (2026-05-01):
> - Scaffold + stub IPC shipped (commit `728306f`).
> - Follow-ups Barney 6.4 R6/R7 shipped (commit `9b4f54c`): banner UI onion-only sem `.onion` + docs cross-runtime PWA vs Tauri.
> - **arti dep validation shipped** ([Unreleased] commit pendente): `arti-client = "0.41"` + `tor-rtcompat = "0.41"` + `tokio = "1"` compilam clean junto com Tauri 2.11. Skeleton de bootstrap real em `tor.rs` atrás de `--features arti`. `TorClient::create_bootstrapped()` wired up. **Falta**: SOCKS5 local proxy + ponte ao `wssTransport` (sessão dedicada ~6-10h Rust).

Cumpre manifesto §15 (anti-censura por país) + §28 (privacidade pelo mínimo) + §4 (anonimato em modo paranoia).

## 1. Mecânica

```
PWA UI                           Tauri Rust shell
─────────                        ────────────────
NetworkMode setting        →     tor.rs IPC commands
('clearnet'|'tor'|'onion-only')  (tor_connect/_disconnect/_status)
                                          │
                                          ▼
                                 [arti client — Fase 6.4 real]
                                 SOCKS5 :9050 (local)
                                          │
                                          ▼
                                 wssTransport via SOCKS5 proxy
                                          │
                                          ▼
                                 Relays Nostr (.onion preferenciados)
```

User abre Settings → muda `network_mode`:
- `clearnet` (default): comportamento atual — WSS direto pros relays públicos.
- `tor`: WSS routed via SOCKS5 local. IP não vaza. Latência +500ms-2s.
- `onion-only`: só relays `.onion`. Clearnet bloqueado mesmo se disponível.

Em PWA browser: setting visível mas disabled — Tor exige cliente nativo Tauri.

## 2. O que está shipped (scaffold + stub)

### Rust IPC (Ted, `src-tauri/src/tor.rs`)

3 commands Tauri retornando `TorStatus { state, circuitCount, lastError }`:

- `tor_connect()`: STUB — retorna `state: 'error'` com `lastError: "STUB: arti integration pending"`. Real: spawn arti client, cria circuit, transição connecting→connected.
- `tor_disconnect()`: marca state como `disconnected`, zera circuit count.
- `tor_status()`: snapshot do TorState global.

API estável — quando arti chegar, internals mudam sem quebrar TS callers.

### TS types (Marshall, `src/types/drift.ts` + `src/lib/prefs.ts`)

- `NetworkMode = 'clearnet' | 'tor' | 'onion-only'`
- `UserPrefs.network_mode: NetworkMode` (default `'clearnet'`)
- Guard `isNetworkMode` em `applyRow`

### Relay config (Marshall, `src/config/relays.ts`)

```typescript
export interface RelayConfig {
  url: string                 // WSS clearnet
  onion?: string              // .onion alias opcional
}
```

`activeReadRelays/Write` consomem `network_mode`:
- `clearnet`: retorna todos `url`
- `tor`: prefere `onion` se existir, fallback `url`
- `onion-only`: filtra fora relays sem `onion`

Seed list atual: `onion` undefined em todos. User popula via Settings (próxima sessão).

### TS transport (Lily, `src/lib/transport/tor.ts`)

Implementa `Transport` interface:
- Detecta Tauri context via `window.__TAURI_INTERNALS__` ou similar
- Em PWA browser: `publish/subscribe` lança `Error("Tor exige cliente nativo Tauri — instale o desktop")`
- Em Tauri: invoca commands via `@tauri-apps/api/core`. Status atual sempre `'error'` (stub).

Wire em orchestrator condicional ao `network_mode === 'tor' || 'onion-only'` — não registrado por default.

### UI toggle (Lily, Header)

Ícone status no Header:
- 🌐 clearnet (default)
- 🧅 tor
- 🛡️ onion-only

Click abre Settings → seção "modo de rede".

## 3. Limitações honestas

### Stub não conecta de fato

`tor_connect()` retorna erro. Útil pra testar UI flow + integração TS↔Rust IPC, **não** pra ativar Tor real. Quando arti integrar:
- Cargo dep: `arti-client = "1.x"`
- Estimativa runtime: ~15s pra primeiro circuit, ~2s pra subsequentes
- Bandwidth: ~3x bandwidth de clearnet (encryption overhead)

### Capacitor / Android nativo: não coberto aqui

Plano (sessão futura):
- Detectar Orbot (Guardian Project) instalado
- `network_mode === 'tor'` ativa Orbot transparent-mode proxy
- Sem fallback embedded — depende de Orbot

### IP leak via WebRTC ICE

Mesmo em modo `tor`, WebRTC P2P pode vazar IP via STUN/TURN candidates locais. Mitigação: em modo `tor` ou `onion-only`, **WebRTC desabilitado** (orchestrator não registra `webrtcTransport`). Implementação: gate em `bootstrap.ts` — `registerTransport(webrtcTransport)` só quando `network_mode === 'clearnet'`. Cobertura: `tests/webrtc-tor-mode-isolation.test.ts` (3 cenários) + invariante estática em `tests/manifesto-conformance.test.ts` §15. **Resíduo conhecido**: `seeder.ts:seedFromSpreaders` chama `connectTo` direto (não passa pelo orchestrator) — abrir SpreadMap em modo Tor ainda dispara `RTCPeerConnection`. Tracking item separado.

## 4. Roadmap pra arti real

### 4.1. ✅ Validado (2026-05-01)

Compatibilidade dependências confirmada via `cargo check --features arti`:

```toml
# src-tauri/Cargo.toml
arti-client  = { version = "0.41", optional = true,
                 default-features = false,
                 features = ["tokio", "rustls", "onion-service-client"] }
tor-rtcompat = { version = "0.41", optional = true,
                 default-features = false,
                 features = ["tokio", "rustls"] }
tokio        = { version = "1", optional = true, features = ["full"] }
anyhow       = { version = "1", optional = true }

[features]
arti = ["dep:arti-client", "dep:tor-rtcompat", "dep:tokio", "dep:anyhow"]
```

Resultados:
- `cargo check` (default): 2.3s incremental, build atual intacto.
- `cargo check --features arti`: 4min primeira vez (~100 crates do
  workspace arti), 4.8s incremental. Compila clean com Tauri 2.11.
- **rustls preferido sobre nativetls/openssl**: sem deps C, build
  determinístico, alinha com objetivo Fase 6.7.
- **Versão real**: `1.x` foi chute equivocado (cargo recusou); arti
  está em `0.41` (cuidado com major bumps — workspace publica em
  lockstep).

### 4.2. ✅ Skeleton bootstrap shipped

`src-tauri/src/tor.rs` agora tem:

- Stub default (sem feature) — `tor_connect` retorna erro explícito
  com hint pra recompilar com `--features arti`.
- Real impl (`#[cfg(feature = "arti")]`) — `TorClient::with_runtime(...)
  .config(default).create_bootstrapped().await`. Transição
  `disconnected → connecting → connected`. Cliente vive em
  `Arc<TorClient<PreferredRuntime>>` dentro de `TorState.client`.

`TorState` shape mudou de tuple struct pra struct nomeado:

```rust
pub struct TorState {
    pub status: Mutex<TorStatus>,
    #[cfg(feature = "arti")]
    pub client: Mutex<Option<Arc<TorClient<PreferredRuntime>>>>,
}
```

Default trait segue válido — `lib.rs::run()` continua chamando
`TorState::default()` sem mudanças.

### 4.3. ⏳ Pendente (sessão dedicada ~6-10h)

1. **SOCKS5 proxy local**: arti não expõe SOCKS5 nativamente como
   biblioteca — opções:
   - **a)** Embarcar binário `arti` (CLI completa) e spawnar como
     processo filho. Custo: +5MB binário, gerência de child process.
   - **b)** Implementar SOCKS5 listener próprio em `tor.rs` que
     translate `SOCKS5 → TorClient::connect(addr)`. Custo: ~200
     linhas Rust, controle total. **Preferida.**
   - **c)** Usar `arti` como library + expor stream API via IPC
     custom (não SOCKS5). Custo: refactor TS-side mais profundo.
2. **WSS via SOCKS5 no TS**: nostr-tools `SimplePool` aceita custom
   transport via `WebSocket` constructor. Investigar se navegador
   (webview Tauri) respeita `system proxy` quando definido em
   runtime — alternativa: importar `socks-proxy-agent` no shell
   Node? Tauri webview é Edge/WebView2 (Windows) / WebKit (macOS) /
   WebKitGTK (Linux), nenhum suporta SOCKS5 programático. Solução
   prática: usar custom TCP transport via Tauri IPC, contornando
   WebSocket nativo.
3. **Tests de integração**: mock arti é caro; suite manual em PC com
   Tor real (Linux + arti rodando local).
4. **Smoke test e2e**: `network_mode: 'tor'` + relay `.onion` funcional
   → Drift carrega feed via Tor circuit.
5. **UI affordances**: spinner durante bootstrap (15-30s primeiro
   start), banner sucesso "🧅 conectado via Tor", country exit
   info opt-in.

### 4.4. Riscos atualizados

- **Bundle size**: confirmado ~100 crates extras compilados em modo
  `arti`. Estimativa binário final: ~10-15MB extra (release stripped).
  PWA não afetada (stays clearnet — nem o JS de `transport/tor.ts`
  importa nada arti-side).
- **arti workspace velocity**: 0.x ainda. Breaking changes em minor
  bumps são possíveis (`0.41 → 0.42`). Mitigação: pin exato em
  `Cargo.lock` versionado + CI rodando `cargo check --features arti`
  pra detectar drift.
- **Bootstrap latency**: 10-30s primeira vez (sem cache); ~5s com
  cache local. UX precisa spinner + cancel button.
- **WebView SOCKS5**: nem Edge/WebKit/WebKitGTK suportam SOCKS5
  programático em runtime. Solução adotada (b — listener próprio)
  contorna; mas também pode exigir custom Tauri IPC pra contornar
  fetch/WebSocket do webview que ignoram proxy.

## 5. Manifesto coverage

| Princípio | Cumprido com 6.4 stub | Cumprido com arti real |
|---|---|---|
| §4 anonimato em paranoia | parcial (modo declarado) | ✅ |
| §15 anti-censura por país | parcial (transport diversity) | ✅ |
| §28 privacidade pelo mínimo | ✅ (opt-in, default clearnet) | ✅ |

**§15 só é cumprido completamente com arti real.** Hoje, sem arti, modo `tor` retorna erro e cliente cai pra clearnet (com warning UI). Stub serve pra preparar terreno + permitir Lily testar flow TS↔Rust.

## 6. Próximos passos

- [x] ~~Validar compatibilidade `arti-client` + Tauri 2 + tokio~~ (2026-05-01, commit 22d3e11)
- [x] ~~Skeleton de bootstrap real em `tor.rs` atrás de feature flag~~ (2026-05-01, commit 22d3e11)
- [x] ~~SOCKS5 listener próprio (~250 LOC `socks5_proxy.rs`)~~ (2026-05-01, commit 7f0bad0)
- [x] ~~Bridge TS-side: custom IPC `tor_ws_open/send/close` + `TorWebSocket` injetado via `useWebSocketImplementation`~~ (2026-05-01, etapas 2-3)
- [x] ~~Wire-up `bootstrap.ts` condicional ao `prefs.network_mode`~~ (2026-05-01, etapa 4)
- [x] ~~Smoke test e2e~~ — ✅ **VERIFIED em 2026-05-01** com `cargo tauri build --features arti` no Windows. Captura Wireshark confirmou: zero TLS direto a relay Nostr em modo `onion-only`, 7 guards Tor publicamente registrados (LU/SE/CA/HU/PL/NL/FR), porta 9001 ORPort canônica. Registro em [`../sessions/sprint7-smoke-2026-05-01.md`](../sessions/sprint7-smoke-2026-05-01.md). Manifesto §15 deixou de ser asserted e virou **verified**.
- [ ] CI: adicionar job `cargo check --features arti` pra detectar drift quando arti bumpar (~30min)
- [ ] Capacitor/Android: integração Orbot (frente separada — nada disto cobre Android)
- [ ] Live circuit count via `TorClient::circmgr` (hoje placeholder=1)
- [ ] Graceful shutdown do SOCKS5 listener no `tor_disconnect` (hoje vive até processo morrer)
- [ ] Cache `arti` em app data folder do Tauri (hoje usa `$HOME/.arti` default)

## 7. Smoke test e2e — manual

Pré-req: Rust toolchain instalada (`rustup`, `cargo`, MSVC build tools no Windows).

```bash
# 1. build PWA (necessário pro Tauri embarcar)
npm run build

# 2. build Tauri com feature arti (10-15min primeira vez — compila ~100 crates)
cd src-tauri
cargo tauri build --features arti

# 3. roda binário gerado
# Windows: src-tauri/target/release/drift.exe
# Linux:   src-tauri/target/release/drift
# macOS:   src-tauri/target/release/bundle/macos/Drift.app
```

Checklist em runtime:

- [ ] App abre normalmente (clearnet)
- [ ] Settings → modo de rede → seleciona `🧅 tor` (não-disabled em Tauri!)
- [ ] Recarrega aba → boot mostra "[bootstrap] Tor conectado · proxy=127.0.0.1:XXXXX"
  no console (DevTools auto-aberta em dev)
- [ ] Feed carrega normalmente — eventos chegam via Tor (pode levar 5-30s primeiro frame)
- [ ] `tcpdump` (ou Wireshark) mostra tráfego apenas pra guards Tor (ips
      do consenso, não pros relays Nostr diretamente)
- [ ] `torStatus()` no console retorna `state: 'connected'`, `circuitCount: 1`,
      `proxyAddr: '127.0.0.1:XXXXX'`
- [ ] `tor_disconnect` libera handles (reconfigurar pra clearnet + reload funciona)
