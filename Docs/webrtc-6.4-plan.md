# Fase 6.4 — Tor Transport

> **STATUS**: scaffold + stub shipped em `[Unreleased]`. Real `arti` integration TBD em sessão dedicada (~10-15h Rust).

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

Mesmo em modo `tor`, WebRTC P2P pode vazar IP via STUN/TURN candidates locais. Mitigação: em modo `tor` ou `onion-only`, **WebRTC desabilitado** (orchestrator não registra `webrtcTransport`). Documentar pra usuário.

## 4. Roadmap pra arti real

Sessão dedicada (~10-15h):

1. Adicionar `arti-client` em `src-tauri/Cargo.toml`. Verificar tamanho do bundle (arti adiciona ~10-15MB).
2. Substituir stub em `tor.rs:tor_connect()` por:
   - `TorClient::create_bootstrapped(...)` → cria circuit
   - State global vira `Arc<Mutex<Option<TorClient<...>>>>`
   - Spawn task que monitora circuit health
3. SOCKS5 proxy local (porta 9050) — arti expõe via `arti-rpc-server` ou socket direto.
4. WSS via SOCKS5: configurar `pool` (nostr-tools SimplePool) com `agent: SocksProxyAgent('socks5://127.0.0.1:9050')`. Verificar se nostr-tools 2.x aceita custom agent.
5. Tests de integração com Tor real (mock arti seria caro; testar manualmente em PC com Tor instalado).
6. Smoke test e2e: `network_mode: 'tor'` + relay `.onion` funcional → Drift carrega feed via Tor circuit.

### Riscos

- **Bundle size**: arti adiciona ~15MB. PWA não é afetada (stay clearnet); Tauri desktop fica ~25MB total. Aceitável.
- **arti API instable**: 1.x é estável mas ainda tem breaking changes minor. Pin versão exata em Cargo.lock.
- **Performance bootstrap**: primeira conexão ~15s. UX: spinner + "conectando ao Tor...".

## 5. Manifesto coverage

| Princípio | Cumprido com 6.4 stub | Cumprido com arti real |
|---|---|---|
| §4 anonimato em paranoia | parcial (modo declarado) | ✅ |
| §15 anti-censura por país | parcial (transport diversity) | ✅ |
| §28 privacidade pelo mínimo | ✅ (opt-in, default clearnet) | ✅ |

**§15 só é cumprido completamente com arti real.** Hoje, sem arti, modo `tor` retorna erro e cliente cai pra clearnet (com warning UI). Stub serve pra preparar terreno + permitir Lily testar flow TS↔Rust.

## 6. Próximos passos

- [ ] Sessão dedicada: integrar arti real no `tor.rs`
- [ ] Adicionar UI explicativa em Settings sobre limitações (PWA disabled, latência Tor, IP leak via WebRTC desabilitado em modo tor)
- [ ] Smoke test e2e com PC + Tor real
- [ ] Capacitor/Android: integração Orbot (frente separada)
