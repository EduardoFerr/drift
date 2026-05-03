# Fase 6 — Roadmap honesto

**Status (2026-05-02)**: Fase 6 essencialmente fechada. Fase 6 = "cliente nativo + transportes alternativos + capacidade técnica do §15 (anti-censura por país)". **6.1a, 6.1b, 6.2, 6.3, 6.5, 6.6, 6.7** entregues; **6.4 Tor transport** com `arti` real shipped + smoke test e2e **VERIFIED 2026-05-01** (manifesto §15 cumprido pra source-builders + binários cross-platform via Track A.1 em `v0.6.0-alpha.3`). Restam 5 follow-ups menores em 6.4 ([§6 do plan](webrtc-6.4-plan.md)) antes de migrar pra `archive/`.

**Compromisso do manifesto** (§ROADMAP, linha 950):
> "Fase 6 + Fase 7 não são 'talvez'. São 'vão acontecer'. Se em algum momento o caminho técnico mostrar que algo dessas fases é inviável como prometido, o manifesto é atualizado com bump de versão e justificativa pública. Não cala, não promete e não entrega."

---

## Sub-fases

### ✅ 6.1a — WebRTC core + mock signaling (entregue em `0.6.0-alpha.0`)

- `src/lib/transport/webrtc/` (pasta — 12 arquivos pós-Sprint-4: peer/pipeline/state/health/reconnect/discovery/boot/ice/rateLimit/config/types/index)
- `src/lib/transport/webrtc-signaling-mock.ts` (BroadcastChannel same-origin pra dev/PoC)
- DEV bridge `window.driftWebRTC`
- Peer review fixes: ICE timeout 30s, glare collision rollback, rate limit token bucket
- 280 → 303 tests verdes ao longo da implementação

### ✅ 6.1b — Nostr DM signaling (entregue em `0.6.0-alpha.1`)

- `src/lib/transport/webrtc-signaling-nostr.ts` (NIP-44 + kind 1059)
- Replay window assimétrico (drop só futuro; passado libera store-and-forward)
- LRU dedup por event.id, rate limit per-sender + send-side, anti-spoof
- DI via flag `VITE_USE_NOSTR_SIGNALING`
- 305 tests verdes

### ✅ 6.2 — Path diversity + peer registry persistente (entregue em `[Unreleased]`)

**Plano**: `Docs/archive/webrtc-6.2-plan.md`. Shipped via 5 sub-fases.

Escopo:
- **Random walk obrigatório** (manifesto §20): mesmo após `CONNECTED`, cliente continua descobrindo via amostragem aleatória de peers conhecidos
- **Path diversity scoring**: peer/relay avaliado por quantos caminhos independentes levam até ele, não por comportamento bom no vizinho imediato
- **Cluster detection**: se >70% dos peers vêm da mesma origem inferida, cliente entra em estado `ISOLATED`
- **Limite de influência**: nenhum peer pode contribuir com >30% do conjunto conhecido
- **Peer registry persistente** (SQLite): npubs vistos + last seen + path scores
- **Nsec efêmero por sessão** (T-004/T-005 mitigation — Barney peer review #1 do plano 6.1b)
- **Cache de getConversationKey** (otimização adiada de 6.1b)

Estimativa: **2-3 sessões coordenadas** (~12-15h). Manifesto §20.

### ✅ 6.3 — TURN + reconnect + health checks (entregue em `[Unreleased]`)

Escopo:
- **TURN servers**: peer-to-peer falha em ~30% dos casos (symmetric NAT, 4G CGN). TURN relay TCP cobre mobile real.
- **Reconnect com backoff exponencial** quando peer cai
- **Health checks** (ping-pong RTT, peer.lastPingMs real em vez de placeholder)
- **Smoke test mobile validado** (PC ↔ celular 4G via TURN)

Trade-off: TURN relay TCP custa banda. Default usar TURN público (Twilio, Cloudflare) ou self-hosted? Decisão arquitetural pendente.

Estimativa: **1-2 sessões** (~8h). Manifesto §15 (mobile real).

### 🟢 6.4 — **Tor transport** (`tor.ts`) — arti real shipped + smoke test e2e VERIFIED 2026-05-01; follow-ups menores pendentes

**Status atualizado 2026-05-02**: arti real (não-stub) shipped via `cargo tauri build --features arti`. Smoke test e2e (Wireshark, baseline clearnet vs onion-only) **VERIFIED 2026-05-01** — manifesto §15 deixa de ser *asserted* e vira *verified* pra source-builders. Distribuição binária cross-platform shipped em `v0.6.0-alpha.3` (Track A.1: `.deb`/`.AppImage`/`.dmg`/`.exe` com `--features arti`). **Plano técnico detalhado e checklist de follow-ups em [webrtc-6.4-plan.md](webrtc-6.4-plan.md)** — mantido como doc separado por convenção (ver `archive/README.md`); migra pra `archive/` quando follow-ups §6.4 do plan fecharem.

**Follow-ups pendentes (de [webrtc-6.4-plan.md §6](webrtc-6.4-plan.md))**: CI job `cargo check --features arti`, Capacitor/Android via Orbot, live circuit count em UI, graceful shutdown, cache dir local. Não-bloqueantes pra §15 verificado em build Tauri; bloqueiam fechamento ✅ formal de 6.4.

**Shipped hoje**:
- `src-tauri/src/tor.rs` — 3 IPC commands (`tor_connect/disconnect/status`) retornando `TorStatus { state, circuitCount, lastError }`. `tor_connect()` é stub: retorna `state: 'error'` + `lastError: "STUB: arti integration pending"`.
- `NetworkMode = 'clearnet' | 'tor' | 'onion-only'` em `UserPrefs.network_mode` (default `clearnet`)
- `RelayConfig` ganha `onion?: string` opcional; `activeReadRelays/Write` consomem `network_mode` (clearnet → todos `url`; tor → prefere `onion`; onion-only → filtra fora sem `onion`)
- `src/lib/transport/tor.ts` — consome IPC; em PWA browser lança erro "exige cliente nativo Tauri"; em Tauri retorna stub error
- UI toggle no Header (🌐 / 🧅 / 🛡️) abre Settings → "modo de rede"

**Pré-requisito**: 6.5 (Tauri) ✅ — Tor não roda em PWA browser.

#### Tor toggle UX (cliente nativo Tauri)

Setting: `network_mode: 'clearnet' | 'tor' | 'onion-only'`

| Mode | Comportamento |
|---|---|
| `clearnet` (default) | Igual hoje — WSS direto pros relays públicos |
| `tor` | WSS via SOCKS5 proxy local (arti embedded) — IP do user não vaza pro relay |
| `onion-only` | Só conecta a relays `.onion`; clearnet bloqueado. Modo paranoia máximo |

**UI**:
- Toggle em Settings → "modo de rede"
- Ícone de status no Header: 🌐 (clearnet) / 🧅 (tor) / 🛡️ (onion-only)
- Clarinha visual: ligar Tor adiciona ~500ms-2s de latência por request, batch de relays cai pra ~3 simultâneo (em vez de 8)

**Rollout**:
- Cliente PWA browser: setting **disabled** com mensagem "ative no cliente desktop pra usar Tor — link pra download Tauri"
- Cliente Tauri: setting visível e funcional

#### Implementação (Tauri)

- `arti` (Rust crate, Tor client puro Rust) compilado no shell Tauri como background service
- Cliente JS abre socket via Tauri command que tunnel via SOCKS5 local
- `src/lib/transport/tor.ts` implementa interface `Transport` chamando IPC Tauri
- Lista de relays `.onion` mantida em `config/relays.ts` ao lado dos clearnet
- Pref por `.onion` quando `network_mode === 'tor'` se relay tem onion alias

#### Implementação (Capacitor / Android nativo)

- Detecta Orbot (Guardian Project) instalado
- Setting `network_mode: 'tor'` ativa Orbot transparent-mode proxy
- Sem fallback embedded — depende de Orbot. Documentar.

Estimativa restante (arti real): **1-2 sessões** (~10-15h). Manifesto §4, §15, §28.

### ✅ 6.5 — **Tauri desktop wrapper** (scaffold shipped + validado 2026-04-29)

**Pré-requisito**: nenhum. Eduardo validou `npm run tauri:dev` abrindo janela com Drift.

Escopo:
- `src-tauri/` ganha Cargo.toml + main.rs com webview embarcando o build Vite
- Build matrix: Linux (deb/AppImage), macOS (dmg), Windows (msi)
- Code signing: keys em GitHub Secrets, workflow assina e publica nas releases
- Auto-update via Tauri updater (manifesto §31 — preserva compat)
- IPC commands: `tor.connect()`, `tor.disconnect()`, `tor.status()` (placeholders pra 6.4)
- Permissions `tauri.conf.json`: rede pros relays, fs pra OPFS, sem outras
- Bundle size esperado: ~10-15MB (vs 50-100MB Electron)

Estimativa: **2-3 sessões** (~15h). Manifesto §1 (Tauri desktop habilita §15).

### ✅ 6.6 — Multi-transport orchestration (`sync.ts`) (entregue como parte de 6.2-D/E)

**Pré-requisito**: 6.4 (Tor existir) ou pelo menos placeholder — atendido com WSS + WebRTC, Tor entra quando 6.4 fechar.

Escopo:
- Hoje `sync.ts` chama `wssTransport.subscribe(...)`. Mudar pra iterar `[wssTransport, torTransport, webrtcTransport]`
- Cada transport entrega eventos via `onNostrEvent` (porta única, invariante #1)
- Dedup natural via `INSERT OR IGNORE` no SQLite (mesmo evento de 2 transports → persist 1×)
- Health check periódico: se WSS falha, cai pro Tor; se Tor lento, prefere clearnet
- Pref: `transport_priority: ['wss', 'tor', 'webrtc']` ou auto

Estimativa: **1 sessão** (~6h, se 6.4 estiver pronto). Manifesto §12 (múltiplos transportes).

### ✅ 6.7 — Build reproduzível (entregue em `[Unreleased]`)

**Pré-requisito**: 6.5 (build do Tauri) ✅.

Escopo:
- Dockerfile determinístico: pinned versões Rust, Node, system libs
- `package-lock.json` + `Cargo.lock` rigorosamente versionados
- CI workflow `reproducible-build.yml`: clona, builda, gera SHA256 → publica como release artifact
- Documentação: como user verifica que binário publicado bate com source
- Manifesto §17 (build reproduzível garantia)

Estimativa: **1 sessão** (~6h). Manifesto §17.

---

## Resumo

| Sub-fase | Status | LOC est. | Sessões | Manifesto principal |
|---|---|---|---|---|
| 6.1a WebRTC core | ✅ | 432 + signaling | 3 | §12 |
| 6.1b Nostr signaling | ✅ | ~250 | 1 | §14, §29 |
| 6.2 Path diversity | ✅ | ~700 (peerRegistry+peerScore+orchestrator+wire) | 1 (paralelo) | §20 |
| 6.3 TURN + reconnect | ✅ | ~250 | 1 | §15 (mobile) |
| 6.4 Tor transport | 🟢 arti real + smoke VERIFIED | ~200 (TS+Rust) + arti workspace | 5 follow-ups menores | §4, §15, §28 |
| 6.5 Tauri desktop | ✅ | ~100 + Rust scaffold | 1 | §1 (capacidade §15) |
| 6.6 Multi-transport | ✅ (incluído em 6.2) | ~150 | — | §12 |
| 6.7 Build reproduzível | ✅ | docs + CI + Dockerfile | 1 | §17 |

**Total restante**: arti real shipped + §15 verified em 2026-05-01. **Fase 6 essencialmente fechada** modulo 5 follow-ups menores em 6.4 ([plan §6](webrtc-6.4-plan.md)) que não bloqueiam funcionalidade. Quando todos `[ ]` do §6 do plan virarem `[x]`, 6.4 fecha ✅ e plan migra pra `archive/`.

---

## Ordem sugerida (dependências)

```
6.1a ─┐
      ├─→ 6.1b ─┐
      │         ├─→ 6.2 ──┐
      │         │         │
      └─────────┴─→ 6.3 ──┤
                          │
            6.5 (Tauri) ──┼─→ 6.4 (Tor) ──→ 6.6 (multi-trans)
                          │
                          └─→ 6.7 (build reproduzível)
```

**Caminho mais curto pra §15 cumprido**: 6.5 → 6.4 → 6.6. Sem 6.5, Tor é tecnicamente impossível em PWA browser.

**Caminho mais barato em valor entregue**: 6.6 primeiro (multi-transport com WSS + WebRTC, sem Tor) — habilita parte de §12 hoje, ~6h trabalho.

**Caminho mais defensivo**: 6.2 + 6.3 (path diversity + TURN) primeiro — robustece o que já tem antes de empilhar mais transports.

---

## Follow-up pós-Fase 6 (entregue paralelo)

### ✅ 7.1a — PoI auto-discovery via SpreadMap (entregue em `[Unreleased]`)

Tecnicamente Fase 7 (distribuição), mas funcionalmente fecha o loop dos transports da Fase 6:

- `src/lib/seeder.ts:seedFromSpreaders(postId)` (Lily): lê `spreader_pub` do SQLite, dispara `webrtcTransport.connectTo(npub)` paralelo. Idempotente, respeita `WEBRTC_LIMITS.MAX_PEERS=32`.
- Hook em `useSpreadMap`: fire-and-forget após load, render não bloqueia.
- Modo Nostr ativa handshake kind 1059 real; modo mock no-op.
- Trade-off: sem TURN (6.3 — `VITE_TURN_SERVERS=`), 4G CGN pode falhar. Sem random walk runtime ainda (TODO 6.2-D follow-up), só descoberta passiva.

Manifesto §16: "espalhar = seedear" agora é mecânica automática quando user abre o mapa. Detalhes em [archive/webrtc-seeding.md](archive/webrtc-seeding.md) §"Fase 7.1" e CHANGELOG.

---

## Implicação política

Hoje (`0.6.0-alpha.1`), §15 (anti-censura por país) **NÃO** é cumprido:

- WebRTC P2P depende de signaling via relay clearnet (NIP-44 cifrado, mas vai pelos mesmos relays). Bloquear relays Nostr → bloquear discovery WebRTC.
- Sem Tor, WSS clearnet pode ser bloqueado por SNI/DPI por Estado-nação.
- Single transport (WSS) com 4 relays seed: bloqueio DNS dos 4 trava bootstrap inicial.

Estado-nação que queira bloquear Drift hoje precisa só:
1. Bloquear DNS dos 4 relays seed
2. Se user tenta WebRTC P2P, bloquear signaling Nostr
3. Pronto — Drift não opera

§15 só fica cumprido **quando 6.4 (Tor) + 6.5 (Tauri) + 6.6 (orchestration) chegam**. Manifesto v2.2 reconhece isso explicitamente listando essas frentes em "Fase 6".

`0.6.0-alpha.x` é honesto sobre ser PoC alpha — milestone interna, não release que cumpre Fase 6 oficialmente. Quando todas as 7 sub-fases fecham, vira `0.6.0` (sem suffix).

---

## Próxima decisão

User decide ordem de ataque. Opções práticas:

- **Pequena/útil agora**: 6.6 (multi-transport WSS + WebRTC) — ~6h, valor imediato
- **Robustez**: 6.2 (path diversity) — ~12h, defesa em profundidade
- **Estrutural**: 6.5 (Tauri desktop) — ~15h, destrava 6.4 e 6.7
- **Política**: 6.4 (Tor) — exige 6.5 antes; ~20h só Tor

Recomendação: **6.5 → 6.4 → 6.6** sequencial em sessões dedicadas. Garante §15 inteiro de uma vez. ~6 semanas em ritmo moderado.
