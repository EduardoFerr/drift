# Changelog

All notable changes to the Drift client. Uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow [SemVer](https://semver.org/) with the major version tracking the manifesto contract version.

## [Unreleased]

## [0.6.0-alpha.2] — 2026-05-01

### Added (Fase 6.4 — arti dep validation + bootstrap skeleton)

- **`src-tauri/Cargo.toml`** — feature flag `arti` opt-in:
  - `arti-client = "0.41"` + `tor-rtcompat = "0.41"` + `tokio = "1"` (full) + `anyhow = "1"`. Workspace arti ainda em 0.x (chute inicial 1.x recusado pelo cargo; cargo retornou lista mostrando 0.41 como atual).
  - `default-features = false` em ambos arti crates pra preferir `rustls` sobre `nativetls/openssl` — sem deps C, build determinístico (alinha Fase 6.7).
  - Build atual (sem `--features arti`) intacto: ~100 crates extras só entram quando feature ligada. PWA-only / Tauri sem Tor seguem leves.
- **`src-tauri/src/tor.rs`** — gates duplos `#[cfg(feature = "arti")]`:
  - `TorState` shape muda de tuple struct pra struct nomeado: `{ status: Mutex<TorStatus>, client: Mutex<Option<Arc<TorClient<PreferredRuntime>>>> }`. Default trait segue válido; `lib.rs::run()` inalterado.
  - `tor_connect`: stub default mantém erro com hint pra recompilar; com feature `arti` faz transição `disconnected → connecting`, chama `TorClient::with_runtime(PreferredRuntime::current()?).config(default).create_bootstrapped().await`, armazena `Arc<TorClient>` em `state.client`, transita pra `connected`.
  - `tor_disconnect`: drop do `Arc<TorClient>` via `*c = None`.
- **Validação shipped**: `cargo check` (default 2.3s incremental) + `cargo check --features arti` (4min primeira vez, 4.8s incremental). 399 tests TS verdes.
- **Bloqueadores documentados em `Docs/webrtc-6.4-plan.md` §4.3**: SOCKS5 listener próprio (~200 LOC Rust — webview Tauri ignora system proxy programático), bridge IPC TS↔Rust pra rotear WSS frames, wire-up `bootstrap.ts`. Estimativa restante caiu de 10-15h pra **6-10h** após validação de deps.

**Manifesto §15** (anti-censura por país): capability técnica avança; compromisso integral cumpre quando SOCKS5 + bridge resolvidos.

### Fixed (follow-ups Barney non-blocking — peer reviews 7.1a + 6.4)

- **7.1a R2 — peers blacklisted não queimam slot `MAX_PEERS`**: `peerRegistry.ts` ganha `isBlacklisted(npub): Promise<boolean>` que consulta `blacklisted_until > now()`. `seeder.ts` aplica filtro via `Promise.all` em paralelo após `connectedIds`, antes do cap. Preserva ordem do `ORDER BY RANDOM()` (invariante R1).
- **7.1a R4 — cap FIFO no `SEEDED_POSTS`**: `Set<string>` crescia unbounded em sessões longas (~horas, dezenas de mapas abertos). Cap 256 entradas com eviction FIFO via Set iteration order. Helper `markSeeded()` centraliza lógica. Re-seed em posts evictados é idempotente (connectTo no-op em peers já abertos).
- **6.4 R6 — banner alerta `onion-only` com lista vazia**: `ContentSettings.tsx` cruza `useRelaysStore` com `SEED_RELAY_CONFIGS` pra detectar "onion-only sem `.onion` habilitado". Renderiza `role=alert` vermelho explicando isolamento iminente + ações corretivas. Reativo via store. Manifesto §15 (anti-censura precisa ser auditável).
- **6.4 R7 — `Docs/runtime-pwa-vs-tauri.md`** (novo, ~140 linhas): matriz de 14 capabilities × 2 runtimes, pontos de gating no código (`network_mode` picker, `torInvoke` early-throw, bootstrap TODO, banner R6), regra de quando duplicar vs gating, smoke checklist. INDEX.md linka em Operacional.

---

## [0.6.0-alpha.1.bundle] — 2026-04-29 a 2026-05-01

> Originalmente acumulado em `[Unreleased]` enquanto múltiplas frentes paralelas convergiam. Mantido como bloco único no histórico — todas as entradas abaixo estavam no diff `0.6.0-alpha.1..0.6.0-alpha.2`.

### Added (Fase 6.4 — Tor transport scaffold + stub)

🟡 **Scaffold + stub shipped**. Integração `arti` real (Rust crate Tor client) fica pra sessão dedicada (~10-15h Rust). Coordenado por 4 personas (Ted Rust IPC / Marshall types+config / Lily TS transport+UI / Robin docs):

- **`src-tauri/src/tor.rs`** (Ted): 3 IPC commands Tauri retornando `TorStatus { state: 'disconnected'|'connecting'|'connected'|'error', circuitCount, lastError }`. `tor_connect()` é STUB — retorna `state: 'error'` + `lastError: "STUB: arti integration pending"`. `tor_disconnect()` zera estado. `tor_status()` snapshot do TorState global. API estável — quando `arti-client` chegar, internals mudam sem quebrar callers TS.

- **`NetworkMode` type + `UserPrefs.network_mode`** (Marshall, `src/types/drift.ts` + `src/lib/prefs.ts`): `'clearnet' | 'tor' | 'onion-only'`, default `'clearnet'`. Guard `isNetworkMode` em `applyRow`.

- **`RelayConfig.onion?: string`** (Marshall, `src/config/relays.ts`): alias `.onion` opcional ao lado de `url` clearnet. `activeReadRelays/Write` consomem `network_mode`: clearnet → todos `url`; tor → prefere `onion` se existir, fallback `url`; onion-only → filtra fora relays sem `onion`. Seed list atual com `onion` undefined em todos — user popula via Settings (próxima sessão).

- **`src/lib/transport/tor.ts`** (Lily): implementa `Transport` interface consumindo IPC via `@tauri-apps/api/core`. Em PWA browser (sem `window.__TAURI_INTERNALS__`), `publish/subscribe` lança `Error("Tor exige cliente nativo Tauri — instale o desktop")`. Em Tauri, status atual sempre `'error'` (stub). Wire em orchestrator condicional ao `network_mode === 'tor' || 'onion-only'` — não registrado por default.

- **UI toggle Header** (Lily): ícone status 🌐 (clearnet) / 🧅 (tor) / 🛡️ (onion-only). Click abre Settings → seção "modo de rede".

- **`Docs/webrtc-6.4-plan.md`** (Robin): doc completo (mecânica, scaffold shipped, limitações honestas, roadmap arti, manifesto coverage). [INDEX.md](Docs/INDEX.md) e [fase-6-roadmap.md](Docs/fase-6-roadmap.md) §6.4 atualizados — status 🟡.

**Limitações honestas**:
- Stub não conecta de fato. Útil pra testar UI flow + integração TS↔Rust IPC, **não** pra ativar Tor real.
- IP leak via WebRTC ICE: em modo `tor`/`onion-only`, WebRTC será desabilitado pelo orchestrator (sessão futura — não implementado hoje).
- Capacitor/Android via Orbot: frente separada, não coberta aqui.

**Manifesto**: §15 (anti-censura por país) só fica cumprido **inteiro** quando `arti` real integrar. Hoje, scaffold serve pra preparar terreno + permitir Lily testar flow TS↔Rust. §28 (privacidade pelo mínimo) já cumprido (opt-in, default clearnet).

### Added (Fase 7.1a — PoI auto-discovery via SpreadMap)

- **`src/lib/seeder.ts`** (Lily): nova função `seedFromSpreaders(postId)` que lê `spreader_pub` distintos do SQLite local e dispara `webrtcTransport.connectTo(npub)` paralelo pra cada um. Idempotente (dedup por postId na sessão), respeita `WEBRTC_LIMITS.MAX_PEERS=32`, best-effort (failures swallow — `peerRegistry` registra via `recordFailure` em outras camadas).

- **Hook em `useSpreadMap.ts`**: após carregar dados com sucesso, dispara `void seedFromSpreaders(postId)` fire-and-forget. Render do mapa não bloqueia.

**Mecânica**: abrir mapa de um post = "ato de interesse" → seed automático com peers que ja espalharam aquele conteúdo. Materializa manifesto §16 (mecânica social vira infraestrutura técnica). Em modo Nostr (`VITE_USE_NOSTR_SIGNALING=1`), peer.id é npub estável e `connectTo` dispara handshake real via signaling kind 1059. Em modo mock, `connectTo` é no-op (UUID per-tab não persiste).

**Trade-offs**:
- Sem TURN configurado, conexão pode falhar em mobile real (4G CGN). Combinar com Fase 6.3 (`VITE_TURN_SERVERS=`).
- Sem random walk runtime ainda ativo (TODO 6.2-D follow-up), seeding cobre só descoberta passiva via spread map. Opening posts virais = exposição maior; abrindo post nicho = exposição limitada. Aceitável MVP.

### Manifesto §16 covered

> "Espalhar = seedear: quem espalhou um post se compromete (no cliente oficial) a republicá-lo se um par solicitar. Mecânica social vira infraestrutura técnica."

7.1a fecha o loop: cliente que abre o mapa **descobre** os spreaders e **conecta** automaticamente. Sem ação manual.

### Added (Fase 6.3 — TURN + Reconnect + Health checks)

Coordenado por 4 personas (Lily core / Robin docs / Marshall tests / Barney review):

- **TURN servers via env var** (`VITE_TURN_SERVERS`, `webrtc.ts:_parseTurnServers + getICEServers`): cobre mobile real (4G CGN, symmetric NAT) que STUN-only não atravessa. Default vazio (manifesto §28 — TURN provider vê IP do user; opt-in consciente). Aceita formato `turn:host:port?username=foo&credential=bar`, comma-separated. **Aviso crítico**: Vite embute `VITE_*` no bundle público; credentials Twilio/Cloudflare paid **NÃO** devem ir aqui (ephemeral creds via REST API). OK pra TURN gratuito (numb.viagenie.ca) ou self-hosted coturn.

- **Reconnect com backoff exponencial** (`webrtc.ts:_scheduleReconnect`): peer com `pc.connectionState === 'failed'` agenda reconexão automática 1s → 2s → 4s → 8s → 16s → 30s (cap), `MAX_ATTEMPTS=5` antes de giveup. Reset counter em `dc.onopen` (sucesso). **Grace period 5s** em `disconnected` antes de schedulear (Barney R2 — evita storm em Wi-Fi handover / 4G↔5G oscillation). Só roda em modo Nostr (peer.id estável; mock UUID per-tab não persiste).

- **Health check ping/pong** (`webrtc.ts:startHealthCheckTimer`): cada peer envia `__drift-ping__:<ts>` via DataChannel a cada 15s; outro lado responde `__drift-pong__:<ts>`. RTT atualiza `peer.lastPingMs` (era placeholder). Peer fica `degraded` se latência > 5s OU sem ping enviado há > 30s. **Anti-pong-injection** (Barney R1): `_handlePong` valida `pingTs >= peer.lastPingSentAt - 1s` — atacante não pode fingir saudável com pong fake.

- **`getPeers()` retorna `lastPingMs` real**: era placeholder `null` em 6.1a; agora reflete RTT medido pelo health timer.

- **`Docs/webrtc-6.3-plan.md`** (Robin): doc completo (TURN mecânica, reconnect backoff, health, tests, smoke e2e, limites, manifesto coverage).

- **`tests/webrtc-reconnect.test.ts`** (13 tests) + **`tests/webrtc-health.test.ts`** (16 tests): backoff puro, counter, ping/pong RTT, degraded detection, TURN parser. **381/381 verdes** total (era 351, +29 novos).

- **`.env.example` + `vite-env.d.ts`**: `VITE_TURN_SERVERS` documentado com warning sobre VITE_ embedding no bundle.

**Manifesto §15** (anti-censura mobile): WebRTC viável em 4G real com TURN. **§28** preservado: TURN opt-in, default sem leak.

### Added (Fase 6.7 — Build reproduzível)

Coordenado por 4 frentes paralelas (Ted/Marshall/Robin + integração):

- **`Dockerfile.reproducible`** (Ted, raiz): multi-stage build determinístico (PWA + Tauri Linux). Versões pinned: Node 20.18.1, Rust 1.83.0, Debian bookworm-slim. `SOURCE_DATE_EPOCH=1735689600` (2025-01-01 UTC) + `LC_ALL=C.UTF-8` + `TZ=UTC` + `CARGO_INCREMENTAL=0` + `cargo build --locked --frozen` → bit-identical entre builds. Stages: `pwa-builder` → `tauri-builder` → `artifacts` (output coleta `dist/`, `tauri/bundle/`, `SHA256SUMS`). `.dockerignore` exclui `node_modules/`, `target/`, `dist/`, `.git/`, `.env*`, etc. Manifesto §17.

- **`.github/workflows/reproducible-build.yml`** (Marshall): trigger em tag `v*` ou `workflow_dispatch`. Builda via Docker, gera `drift-pwa-<tag>.zip` + `drift-tauri-linux-<tag>.zip` + `SHA256SUMS-reproducible`, anexa ao GitHub Release existente (coexiste com `release.yml` — não substitui). Permissions mínimas (`contents: write`), concurrency cancel-in-progress, `fail_on_unmatched_files: false` (release parcial OK se Tauri stage falhar).

- **`Docs/build-reproducible.md`** (Robin): doc completo de verificação (clone source na tag → docker buildx → empacote local → compare SHA256). Cobertura honesta: ✅ Linux PWA bit-identical, ✅ Linux Tauri (.deb/.AppImage) bit-identical, ❌ Windows/macOS (signing detached fica pra futuro), ❌ F-Droid Android (pendente 7.2). Limitações honestas: reprodutibilidade ≠ ausência de backdoor; user precisa **ler** o source.

- **`package.json` engines**: `node: ">=20.18.0"` (alinha com Dockerfile pinned), `npm: ">=10"`. Antes era `>=22` que conflitava com o build oficial Linux em Node 20.x.

- **`Docs/INDEX.md`**: entrada `build-reproducible.md` + atualização `tauri-setup.md` (6.5 ✅ validado em 2026-04-29).

**§17 cumprido**: qualquer auditor independente verifica em ~5min que binário publicado bate exatamente com `git tag` source. Reprodutibilidade Linux-only por enquanto — Windows/macOS exigem signing detached (fora 6.7).

### Added (Fase 6.2 — wire-up final dos TODOs)

Fecha integração runtime dos 3 TODOs deixados em `webrtc.ts` (commit anterior):

- **Random walk runtime** (`webrtc.ts:performRandomWalk`): substitui o stub por implementação real. Lê peers conhecidos via `peerRegistry.getKnownPeers({ excludeBlacklisted: true })`, faz Fisher-Yates sample (25% slots aleatórios — manifesto §20), `peerScore.scorePeer` nos demais (75%), top-N por score, dispara `connectTo(npub)` paralelo best-effort. Gating: só roda em modo Nostr (peer.id = npub estável); em mock, skip silencioso porque UUID não persiste no registry. Skip se `MAX_PEERS` cap atingido.

- **Blacklist cross-proto persistido** (`webrtc.ts:handleDataChannelMessage`): quando `crossProtoCount >= 50`, além de matar o peer em memória, chama `peerRegistry.blacklist(peer.id, BLACKLIST_TTL_MS)` pra persistir TTL 1h no SQLite. Próxima sessão também rejeita o npub via `getKnownPeers({ excludeBlacklisted: true })`.

- **Registry handshake/failure no DC lifecycle**: `dc.onopen` chama `peerRegistry.recordHandshake(peer.id)` (alimenta `connCount` + `last_seen`); `pc.onconnectionstatechange === 'failed'` chama `peerRegistry.recordFailure(peer.id, 'ice')` (alimenta `fail_count` sem tocar `last_seen`). Ambos best-effort com swallow — registry é alimentação de scoring, não bloqueia hot path DC.

**Manifesto §20 ativo**: peers conhecidos são amostrados, scored e reconectados periodicamente; bots dependem de cluster controlado, random walk corrói estatisticamente. **Em modo mock**, sem mudança operacional (gating skip).

### Added (Fase 6.2 — Peer Registry + Path Diversity + Multi-Transport)

5 sub-fases coordenadas por 4 agentes em paralelo + integração:

- **6.2-A — `peerRegistry.ts`** (Marshall): persistência SQLite de peers conhecidos. Migration `peers_known` v7 (idempotente, não-destrutiva). API: `recordHandshake`, `recordFailure`, `recordLatency` (EWMA α=0.3 via SQL CASE), `recordCrossProto` (auto-blacklist em 50 violações), `blacklist`, `getKnownPeers`. Zero cache em memória — toda call bate SQLite. 15 tests em `tests/peerRegistry.test.ts`. Manifesto §20.

- **6.2-B — `peerScore.ts`** (Robin): função pura de scoring + path diversity (manifesto §7, §11, §20). `scorePeer(inputs)` combina reliability (35%), latency (25%), recency 7d-decay (15%), diversity bonus ASN/country (25%). `pathDiversityScore(connected)` retorna entropy Shannon normalizada da distribuição de ASNs. `sampleWithoutReplacement` Fisher-Yates pra random walk. **Manifesto §11**: nenhum input vem de afinidade de conteúdo. 18 tests.

- **6.2-C — Caps + cross-proto threshold em `webrtc.ts`** (Barney): `WEBRTC_LIMITS` exportado (MAX_PEERS=32, MAX_PEERS_PER_PUBKEY=1, RATE_LIMIT_MSG_PER_SEC=100, CROSS_PROTO_THRESHOLD=50, BLACKLIST_TTL_MS=1h). `getOrCreatePeer` retorna `PeerState | null` quando hard cap atinge — call sites tratam (`handleRemoteOffer`, `hello`, `connectTo`). `handleDataChannelMessage` incrementa `crossProtoCount` em kind fora de `DRIFT_KIND_SET`; mata peer ao atingir 50. `performRandomWalk()` stub (logs `pending peerRegistry+peerScore`); timer 30min via `startRandomWalkTimer()`/`stopRandomWalkTimer()`, integração runtime fica pra commit futuro. 8 tests novos em `tests/webrtcCaps.test.ts`. Manifesto §15, §20.

- **6.2-D — `orchestrator.ts`** (Lily): multiplexer de transportes implementando `Transport`. `publish` agrega resultados de todos os transports registrados; `subscribe` faz fan-out + dedup cross-transport via LRU(1000) por `event.id`; `health` concat com prefixo (`wss:relay.url`, `webrtc:peer-id`). `registerTransport(t, opts)` é idempotente. **Comportamentalmente equivalente** ao wssTransport direto quando só ele está registrado. 14 tests em `tests/orchestrator.test.ts`. Manifesto §12.

- **6.2-E — Wire `sync.ts` + `nostr.ts` → orchestrator** (Lily): `sync.ts:startSync` migra de `pool.subscribeMany` direto pra `orchestrator.subscribe` (subscription type muda de `{close: () => void}` pra `Unsubscribe = () => void`). `nostr.ts:publishToRelays` migra de `wssTransport.publish` pra `orchestrator.publish`. `bootstrap.ts` registra `wssTransport` (weight 10) + `webrtcTransport` (weight 5) antes de `startSync`. **Eventos via WebRTC agora chegam no SQLite via pipeline normal** (`onNostrEvent` continua única porta — invariante #1). Comportamentalmente idêntico em modo mock (sem peers WebRTC = só WSS); ativa P2P real quando `VITE_USE_NOSTR_SIGNALING=1` + `connectTo(npub)`.

**Tests delta**: 296 → 351 verdes (+55 novos). Sem regressão.

### Added (Fase 6.5 — Tauri desktop scaffold)

- **`src-tauri/`** (Ted): scaffold Tauri v2 estável. `Cargo.toml` (tauri 2.x + tauri-plugin-shell), `main.rs` + `lib.rs`, `tauri.conf.json` (janela 1280x800, identifier `com.driftnet.client`, devUrl `https://localhost:5173`, frontendDist `../dist`, CSP espelhando `vercel.json` COOP/COEP), `capabilities/default.json` (permissões mínimas — `core:default`, `shell:allow-open`; SEM fs/dialog/notification/clipboard, manifesto §28).

- **`Docs/tauri-setup.md`** (Ted): onboarding completo (pré-reqs Rust toolchain, `npm run tauri:dev/build`, ícones via `npx tauri icon`, limitações conhecidas — sem Tor até 6.4, sem code signing até 6.7, sem CI multi-plataforma até 6.7).

- **`package.json`**: scripts `tauri`/`tauri:dev`/`tauri:build`. Deps `@tauri-apps/api ^2` (runtime) + `@tauri-apps/cli ^2` (dev).

- **`.gitignore`**: ignora `src-tauri/target/` e `gen/schemas/`. **`Cargo.lock` versionado** (manifesto §17 — build reproduzível).

**Status**: scaffold pronto, **não testado** (não foi rodado `cargo check` — user precisa instalar Rust toolchain). Próximos passos documentados em `Docs/tauri-setup.md`.

### Removed (limpeza de débito técnico)

- **`_buildArcs` e `SpreadMapData.arcs`** (código zumbi pós-heatmap): após a migração pro `HeatmapLayer` em `0.6.0-alpha.0`, o campo `arcs` continuava sendo populado em `useSpreadMap.ts` mas nenhum consumidor usava (`grep data.arcs` zero matches). Marcados `@deprecated` com promessa de "manter 1 release pra retrocompat", mas a auditoria mostrou que ninguém depende — então **removidos imediatamente**: `arcs` field em `SpreadMapData`, função `_buildArcs`, tipo `SpreadArc`. Tests órfãos (9) removidos de `tests/spread-map.test.ts`; mantidos os 5 de `_computeBounds`. 305 → 296 tests verdes (sem perda de cobertura real). Git histórico cobre quem precisar do código removido.

### Docs (hygiene)

- **`signaling.ts` JSDoc** marca 6.1b como ✅ shipped (era "Fase 6.1b, futura").
- **`Docs/webrtc-6.1b-plan.md`** ganha header de status "✅ entregue em `0.6.0-alpha.1`" — documento mantido como referência histórica do plano executado.
- **`Docs/webrtc-seeding.md`** linha 6.1b ganha ✅.
- **`Docs/INDEX.md`** atualiza 3 referências a 6.1b refletindo shipped.

### Added (defense in depth — peer review pendências)

- **Rate limit local no `send()` do `nostrSignalingChannel`** (`webrtc-signaling-nostr.ts`): token bucket 30 msgs/60s. Defesa contra flood self-imposto (bug em layer acima ou loop infinito em ICE trickle). Drop silencioso quando exceder; caller não deve reagir. Diferente do `RATE_LIMIT_PER_SENDER` receive-side (anti-Sybil de remetentes); este é send-side (anti-self-flood). +1 test em `tests/signaling-nostr.test.ts` (305 verdes).

- **`myPeerId()` defense in depth** (`webrtc.ts`): retorna `signalingChannel.peerId` quando disponível em vez de só `_myPeerId` cacheado. Garante consistência caso algum caller hipotético chame antes de `ensureSignalingAsync` completar (improvável — todos os call sites awaitam, mas defesa em profundidade barata).

### Fixed (signaling Nostr — follow-up de 0.6.0-alpha.1)

- **Store-and-forward signaling não funcionava** (`webrtc-signaling-nostr.ts:78,96`, peer review do próprio release). O `replay window` usava `Math.abs(tNow - eventTsMs) > 60s` (simétrico) — droppava eventos legítimos do passado também. Combinado com `subscribe.since: now-60s`, peers que bootavam mais de 1 minuto após A publicar offer perdiam todos os signals acumulados nos relays. Quebrava o caso de uso "A publica offer enquanto B offline; B recebe ao bootar" documentado em `webrtc-6.1b-plan.md` §2 e manifesto §16. **Fix**: 
  - `FUTURE_SKEW_TOLERANCE_MS = 60s` — só drop eventos no futuro suspeito (clock skew); passado é responsabilidade da LRU dedup (anti-replay genuíno).
  - `SUBSCRIBE_SINCE_WINDOW_MS = 24h` — subscribe pega últimas 24h pra cobrir retention típica de relay (1-7d). 
  - Test `'replay window 2min atrás'` invertido pra `'store-and-forward 2h atrás dispatched'`. Test novo `'drop em evento futuro >60s'` cobre clock skew real. 304 tests verdes.

## [0.6.0-alpha.1] — 2026-04-29

Phase 6.1b — **signaling real via Nostr DM cifrado (NIP-44 + kind 1059)**. Mock BroadcastChannel deixa de ser o único caminho — peers em redes diferentes agora se conectam usando relays Nostr existentes como rendezvous, sem inventar diretório paralelo (manifesto §14, invariante #14).

Habilitado via flag `VITE_USE_NOSTR_SIGNALING=1`. Default continua mock pra dev rápido com 2 abas locais — produção real via Nostr é opt-in até validação completa em campo (NAT real, relays diversos).

### Added

- **NIP-44 v2 facade** (`src/lib/nostr.ts` — `encryptDM`, `decryptDM`, Robin/6.1b-A): wrappers finos sobre `nostr-tools.nip44.encrypt/decrypt` com `getConversationKey` derivado por chamada (cache fica pra 6.2). 11 tests em `tests/nip44-facade.test.ts` cobrem round-trip Alice/Bob, UTF-8/JSON 5KB, decrypt com chave errada (throws), payload corrompido (throws), cross-check byte-a-byte com `nip44.encrypt/decrypt` cru. Manifesto §29 (privacidade opcional pra conteúdo).

- **`nostrSignalingChannel`** (`src/lib/transport/webrtc-signaling-nostr.ts`, Barney/6.1b-C): impl `SignalingChannel` via Nostr DM cifrado. Subscribe `{ kinds:[1059], '#p':[myNpub], since: now-60s }`; cada msg de signaling vira evento kind 1059 cifrado NIP-44 v2 com tag `['p', peerNpub]`. Defesas em camadas:
  - Replay window 60s + LRU dedup por `event.id` (TTL 5min, cap 5000) — cobre T-012
  - Rate limit token bucket por sender pubkey (10 msgs/60s) — cobre T-006
  - Anti-spoof: `msg.from` (interno cifrado) deve `=== event.pubkey` (público assinado)
  - Drop silencioso em decrypt fail / JSON malformado / shape inválido
  - `bye`/`hello` viram no-op (Nostr não tem broadcast — peer detecta close via `dc.onclose`; PoI substitui hello)

  12 tests em `tests/signaling-nostr.test.ts` cobrindo round-trip Alice→Bob, ICE forwarding, drop em decrypt fail, anti-spoof, replay window, dedup, rate limit, send drop em bye/hello, sanitização de `from`, close idempotente. 303 tests verdes total.

### Changed

- **`webrtc.ts` ganhou DI de SignalingChannel** (Marshall/6.1b-D): `ensureSignaling` síncrono virou `ensureSignalingAsync()` com promise singleton anti-race. Em modo Nostr, dynamic-import de `getOrCreateIdentity` + `wssTransport` + `nostrSignalingChannel`; `_myPeerId` é setado pro `id.npub` antes do channel ser exposto, tie-break lex compare continua funcionando. Modo mock (default) mantém comportamento 6.1a sem mudança.

- **`.env.example`** ganha `VITE_USE_NOSTR_SIGNALING=` (off por default), `vite-env.d.ts` declara o tipo.

- **`window.driftWebRTC.signalingMode`** (DEV bridge em `main.tsx`): expõe modo atual ('mock' | 'nostr') pra debug em console.

### Architecture

- `webrtc-signaling-mock.ts` continua intacto — `SignalingChannel` interface em `signaling.ts` permite trocar implementações sem mudar resto do transport (manifesto §11 — rede como meio).
- Discovery PoI-only no modo Nostr: caller chama `transport.connectTo(peerNpub)` com npub conhecido via SQLite local (ex: `spreader_pub` de spreads conhecidos). Sem heartbeat global, sem broadcast (invariante #14).
- Threats cobertas: T-004/T-005 (linkability/mapping social — preparado pra nsec efêmero em 6.2 conforme `webrtc-6.1b-plan.md` §1), T-006 (Sybil signaling), T-008 (DC flooding já em 6.1a + reforço aqui), T-011 (MITM via NIP-44 v2 AEAD + Schnorr verify), T-012 (replay), T-013 (kind injection já em 6.1a), T-023 (decrypt timing constant). T-001 (IP leak ICE), T-007 (eclipse) e T-017 (path diversity) ficam pra 6.2/6.3.

### Limites conhecidos

- **Sem TURN**: symmetric NAT em 4G carrier-grade pode bloquear conexão entre peers móveis em redes diferentes. Smoke test e2e validado entre PCs em LANs residenciais; mobile real fica pra 6.3.
- **Discovery manual**: `connectTo(npub)` exposto em DEV bridge; integração automática com `useSpreadMap` (PoI-driven seeding) é Phase 7.1a.
- **Default mock**: produção opt-in via flag até validação em campo. Próximo passo natural: setar default `VITE_USE_NOSTR_SIGNALING=1` quando smoke real consolidado.

## [0.6.0-alpha.0] — 2026-04-29

Phase 6.1a-C closes — WebRTC core + mock signaling shipped. Manifesto v2.2 (34 princípios, sem mudança).

Marca o início da Fase 6 (cliente nativo + transportes alternativos). `alpha.0` sinaliza PoC funcional via mock signaling local (BroadcastChannel between same-origin tabs); signaling real via Nostr DM NIP-44 vem em `0.6.x` (Fase 6.1b). Manifesto v2.2 contract version inalterado.

Highlights:
- **WebRTC P2P transport** com pipeline §5 (kind/schema/Schnorr/filter), peer review fixes (ICE timeout, glare collision rollback, rate limit token bucket), DEV bridge `window.driftWebRTC` pra smoke test e2e
- **Spread map evolução visual**: ArcLayer radial → HeatmapLayer (densidade) — alinhado ao manifesto §6/§28 (mostra fato sem inventar relação; k-anonymity emergente)
- **OPFS multi-tab graceful**: modal educativo quando 2 abas competem pelo mesmo banco local
- **Vercel Deployment Protection** ajustada pra `preview-only` — production hostnames públicos, manifest fetch funciona em todos
- **Settings de mapa** (`fit-bounds` / `open`) + 5 tests novos

### Changed (mapa)

- **Visualização de spread: ArcLayer (radial) → HeatmapLayer (densidade)** (`SpreadMap.tsx`, Barney). Após debate de cascata explícita (tag `via`) vs heurística greedy vs radial, escolhido **heatmap** como solução alinhada ao manifesto: mostra densidade geográfica (fato observável) sem inventar relações nem rastrear vínculos de propagação. Bonus: k-anonymity emergente em áreas densas (manifesto §28). Layers: HeatmapLayer (gradiente azul→amarelo→vermelho) + ScatterplotLayer da origem (amber, raio 8, destaque do autor) + ScatterplotLayer dos destinos (verde alpha 140, raio 3). Adicionada dep `@deck.gl/aggregation-layers@^9.0.0`. `_buildArcs` e campo `arcs` marcados `@deprecated` por 1 release pra retrocompat.

### Added (multi-tab)

- **`MultiTabModal` + catch OPFS xLock** (`db.worker.ts`, `db.ts`, `bootstrap.ts`, `App.tsx`, `components/UI/MultiTabModal.tsx`, Lily). 2ª aba do mesmo origin lançava `NoModificationAllowedError` no SQLite OPFS — app travava em "carregando…". Agora worker captura, propaga `MULTI_TAB_CONFLICT` específico, modal educativo orienta user a fechar uma das abas (botões "Fechar" / "Recarregar"). OPFS permite só 1 SyncAccessHandle por arquivo — limitação do spec, não bug do Drift; modal é fix pragmático sem multi-tab support real.

### Fixed (hygiene)

- **`consumeRateBudget` log spam** (`transport/webrtc.ts:395`, Robin): após `peer.status='failed'/'closed'`, função continuava logando "peer killed" e acumulando violações em loop. Test `webrtc-ratelimit > refill nunca passa de RATE_BURST` poluía stderr com ~50 linhas. Fix: 1 linha early-return no início. 8 tests verdes; stderr limpo.

### Docs

- **`Docs/vercel-protection.md` — decisão "não implementar X-Robots-Tag"** (Ted). Drift descoberto via npub/Nostr/sneakernet, não SEO orgânico. Hardening trivial sem ROI hoje. Trigger pra revisitar: SEO afetar ranking real.

### Operacional

- **Vercel Deployment Protection: `Standard` → `Only Preview`** (2026-04-29). Hostnames auto-gerados de production (`drift-{hash}-...vercel.app`) estavam retornando 401 em `manifest.webmanifest`, quebrando PWA install. Causa: `ssoProtection.deploymentType: "all_except_custom_domains"` (default Vercel pra projetos comerciais) bloqueava todos os hostnames exceto o alias custom `drift-wheat-one.vercel.app`. Mudou pra `"preview"` via REST API — production deployments públicos, previews continuam protegidos. Justificativa + comandos de reversão em [Docs/vercel-protection.md](Docs/vercel-protection.md). Manifesto §16/§17.

### Added

- **Pref `map_view: 'fit-bounds' | 'open'`** (`types/drift.ts`, `lib/prefs.ts`): controla enquadramento do mapa de spread.
  - `fit-bounds` (default): foca o viewport nos pontos do post (origem + destinos) via `MapLibre.fitBounds` com `padding: 60, maxZoom: 11`. Caso comum — "quero entender este post".
  - `open`: globo inteiro com `zoom: 1.5`. Útil pra posts virais com espalhamento intercontinental.
  - UI em `ContentSettings.tsx` → seção "mapa de spread" com radio fechado/aberto.
  - `_computeBounds` exportada (test-only); 5 tests novos em `tests/spread-map.test.ts` cobrindo bbox vazio, 1 ponto degenerado, N pontos, hemisférios mistos, determinismo (manifesto §7).

### Fixed (mapa render — follow-up do 414430d)

- **`MapboxOverlay is not a constructor`** (`SpreadMap.tsx:199`): import vinha de `@deck.gl/core` (errado — `MapboxOverlay` mora em `@deck.gl/mapbox`). Cast `as unknown as` silenciava o erro de tipos; runtime explodia assim que o `useEffect` disparava. Bug latente — só visível depois que `useSpreadMap` passou a retornar `hasGeometry === true` (commit anterior). Adicionada dep `@deck.gl/mapbox@^9.0.0`; trocado o `import('@deck.gl/core')` por `import('@deck.gl/mapbox')`.

### Security

- **WebRTC: ICE timeout 30s** (`transport/webrtc.ts`, Barney audit #1, HIGH): peers travados em `connecting` (ICE não resolve por firewall/STUN down) viravam zombie no map → RAM leak linear. Agora `setTimeout` em `getOrCreatePeer` mata e remove peer após 30s sem resolver.
- **WebRTC: glare collision (perfect negotiation)** (`handleRemoteOffer`, Barney audit #2, CRITICAL): quando ambos os lados disparavam `initiateOffer` pelo tie-break, o `setRemoteDescription` no estado `'have-local-offer'` explodia com DOMException e o handshake falhava silencioso. Agora o lado lex-loser faz `setLocalDescription({type: 'rollback'})` e aceita a offer remota; lex-winner descarta.
- **WebRTC: rate limit por peer (token bucket)** (`consumeRateBudget`, Barney audit #3): peer malicioso podia inundar o cliente com mensagens lixo afogando o event-loop antes mesmo do kind check. Bucket 200 burst / 100 msg-s sustained, 3 violações em 60s → peer killed. Cobertura: 8 tests em `tests/webrtc-ratelimit.test.ts`. Manifesto §15.

### Fixed

- **Sync entre devices**: janela de fetch em `sync.ts` ampliada de 24h para 7d. Devices que ficavam offline >1 dia perdiam eventos próprios ao reabrir. Commit 6062422.
- **Mapa não abre**: faltava migration adicionando coluna `location` em `spreads` — `MapView` quebrava ao tentar `SELECT location FROM spreads`. Migration aplicada em `schema.sql` + step de migração runtime. Commit 6062422.
- **Spread+bury simultâneo do mesmo user**: scoring agora aplica semântica "última ação vale" — quando o mesmo `pubkey` tem SPREAD e BURY do mesmo post, o `created_at` mais recente prevalece e o anterior é ignorado no score. Endereça bug identificado por Marshall em [conformance-conversa-29-04.md](Docs/conformance-conversa-29-04.md) §1 (manifesto §6 verdade por eventos). Commit 3cdd211.
- **Hints enganosos em `location_granularity`**: textos descritivos das opções de granularidade GPS em `ContentSettings.tsx` davam expectativa errada do que é coletado/exposto. Reescritos pra refletir o que de fato vai pro evento Nostr (manifesto §28 privacidade pelo mínimo). Commit 9240064.
- **Mapa de spread sem origem nem arcos** (3 bugs arquiteturais coordenados por 5 agentes): (1) `useSpreadMap.ts:125-134` — `buildArcs` exigia `records.length >= 2`, então post com 1 espalhador renderizava mapa vazio; agora aceita `origin: GeoPoint | null` separado de `destinations[]` e desenha arco mesmo com 1 destino. (2) `useSpreadMap.ts` — origem do arco era `spreads[0]`, semanticamente errado ("primeiro espalhador" tratado como "origem do post"); agora consome `posts.location` (autor) como origem verdadeira, com fallback graceful. (3) `SpreadMap.tsx` — só registrava `ArcLayer`; sem `ScatterplotLayer` os pontos individuais (origem + destinos) ficavam invisíveis quando geometria não suportava arco. Manifesto §28 (transparência: o mapa precisa refletir o que de fato existe).

### Changed

- **Scoring weighted (anti-Sybil)**: `calculateScore` agora soma `weight` dos espalhadores/enterradores em vez de `COUNT(*)`. 1 conta com peso 5 vale o mesmo que 5 contas com peso 1 — Sybil farms perdem o ganho assimétrico. Manifesto §22 (peso de perfil) + §24 (score determinístico). Commit 3cdd211.
- **Manifesto §23 (bury não pune)**: estendido com seção **"Mudança de opinião"** (user pode reverter SPREAD↔BURY publicando novo evento, último vale) e **"Score weighted"** (especifica fórmula Σ`weight` vs COUNT).
- **Manifesto §24 (score determinístico)**: fórmula atualizada pra refletir Σ`weight` e semântica última-ação.
- **`ProfileModal` removeu weight numérico exato**: substituído por badge de tier discreto via `getWeightTier` (gaming-resistant — exibir o número exato incentiva farming pra atingir thresholds visíveis). 3 tiers: 🏆 estabelecido (amber), ⭐ ativo (slate), 🌱 novo (green); tooltip cita manifesto §22.
- **Mapa de spread — estado vazio acionável** (`SpreadMap.tsx`): empty state antes mostrava texto "Ative em Settings" sem CTA; agora renderiza botão "Ativar GPS" que abre Settings com scroll-to-section direto na seção de location. Reduz fricção do opt-in sem violar §28 (continua opt-in explícito).
- **Header `📍` sempre visível** (`App.tsx`): antes o ícone só aparecia DEPOIS de ativar location (UX circular: "ative pra ver o controle de ativar"). Agora sempre presente — cinza off / accent on — e clique sempre abre Settings na seção de location, independente do estado atual. Manifesto §28 (transparência: controle visível mesmo quando inativo).
- **Onboarding menciona location** (`Onboarding/OnboardingOverlay.tsx`): adicionada tela skipável explicando o opt-in de GPS (off por default, granularidade configurável, ligada ao mapa de spread). Endereça gap de descoberta — usuário não sabia que o recurso existia. Manifesto §28 (consentimento informado, não enterrado em Settings).

### Added

- **`getWeightTier(weight)`**: função pura em `lib/weight.ts` que classifica peso de perfil em tiers (sinal social, manifesto §22). Aplicada no `ProfileModal` como badge.
- **Chunking 500-by-500 em `recalculateScore`**: evita estouro do limite SQLite `IN(?)` (~999 placeholders) em posts virais com muitos espalhadores. Lote os IDs e agrega resultados.
- **`GpsErrorBanner`** (`src/components/UI/GpsErrorBanner.tsx`): banner de feedback UI quando `getCurrentLocation` falha, com `GpsHelpModal` interno cobrindo 4 plataformas (Chrome desktop, Firefox, iOS Safari, Android Chrome). Gating em `App.tsx`: aparece apenas quando `granularity != 'off'`, falha ocorreu há <60s, e não foi dismissed pelo user.
- **`getLastFailureReason()`** em `src/lib/geolocation.ts`: getter sobre estado interno `lastFailureReason` (denied / unavailable / timeout / insecure-context) consumido pelo banner. +7 tests cobrindo transições.
- **`transport/webrtc.ts` core** (Fase 6.1a-C, 432 LOC): implementação completa `publish` / `subscribe` / `health` + `RTCPeerConnection` lifecycle. Pipeline §5 com kind check pré-verify (Barney peer review #1), `pagehide` cleanup (#10), `outboundQueue` reset em estado `failed`/`closed` (#4). **Apenas com mock signaling local** (`webrtc-signaling-mock.ts` via BroadcastChannel) — signaling real via Nostr DM NIP-44 fica pra 6.1b.
- **DEV bridge `window.driftWebRTC`** em `src/main.tsx`: expõe handle do transporte WebRTC pro console em build de dev pra smoke test e2e (2 abas trocando evento via DataChannel).
- **Docs**: [Docs/conversa-29-04-analise.md](Docs/conversa-29-04-analise.md) (Ted) — síntese das propostas Gemini/ChatGPT; [Docs/conformance-conversa-29-04.md](Docs/conformance-conversa-29-04.md) (Marshall) — validação contra invariantes e manifesto; [Docs/webrtc-6.1a-c-checklist.md](Docs/webrtc-6.1a-c-checklist.md) (Barney) — checklist de aceite 6.1a-C.

## [0.5.4] — 2026-04-27

### Fixed

- **TWA build (continuação)**: `bubblewrap update` também é interativo e pede senhas quando detecta mudança de signingKey. v0.5.3 só tinha o expect driver no `build`; o `update` ainda usava `yes ""` que falha com "Minimum length is 1 but input is 0" → loop infinito → OOM (exit 134) após ~8min.
- Extraído `scripts/bubblewrap-driver.sh` reusável que casa prompts pelo texto (regex case-insensitive) e responde com a senha correta. Workflow chama o driver tanto em `update` quanto em `build`. Inclui handler de timeout, prompts yes/no, e diagnóstico de prompt não-mapeado.

## [0.5.3] — 2026-04-27

### Fixed

- **TWA build**: `bubblewrap init` no CI sobrescreve `twa-manifest.json` com seus defaults (signingKey aponta pra `android.keystore` + alias `android`; packageId genérico; versionName 1.0.0). Build subsequente procurava `android.keystore` (que não existia) → travava no prompt de senha → expect timeout após 20min.
- **Solução**: workflow agora tem step explícito "Sync twa-manifest" que roda APÓS init e re-aplica os campos críticos do projeto (signingKey aponta pra `drift-release.keystore` + alias `drift`, packageId `com.driftnet.client`, versionName/Code da tag git). Garantia idempotente independente de init sobrescrever ou não.

## [0.5.2] — 2026-04-27

### Changed

- **Mapa**: migrado de Mapbox GL JS para MapLibre GL — sem token obrigatório, tiles raster CARTO Dark Matter (OSS, sem API key). Manifesto §17 (sem chave mestra / sem dependência crítica de fornecedor proprietário).
- `package.json`: removidas deps `mapbox-gl` + `@types/mapbox-gl`; adicionado `maplibre-gl@5.24.0` (traz tipos próprios, sem `@types/`).
- `.env.example`, `vite-env.d.ts`: removida referência a `VITE_MAPBOX_TOKEN`.
- Docs (CHANGELOG, README, CLAUDE.md, Docs/deploy.md, Docs/drift-arquitetura-v4.md, Docs/drift-fluxograma-v4.html) atualizados.

### Why

Mapbox exige token obrigatório, free tier termina em 50k loads/mês com risco de cobrança, e o serviço pode virar ponto de falha/censura. MapLibre é fork OSS API-compatível; CARTO Dark Matter serve tiles raster gratuitos sem API key. `MapboxOverlay` do `@deck.gl/core` continua funcionando porque maplibre-gl é fork API-compatível com mapbox-gl.

## [0.5.1] — 2026-04-27

Sub-fases operacionais e antecipação de Fase 7 (distribuição):

### Added

- **Vercel deploy** + GitHub integration ativa (push em main → deploy automático). URL prod: https://drift-wheat-one.vercel.app
- **`vercel.json` hardening**: COOP/COEP, X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy restritiva, cache imutável em `/assets/*`, must-revalidate em `sw.js` e `manifest.webmanifest`, SPA rewrite excluindo `/.well-known/`
- **`.github/workflows/release.yml`**: trigger em tag `v*`, build + valida package.json:version vs tag, empacota `dist-vX.Y.Z.zip` + `SHA256SUMS`, extrai release notes da seção do CHANGELOG, cria GitHub Release
- **`.github/workflows/twa.yml`** (Fase 7 antecipada): build APK + AAB Android via Bubblewrap em CI. Java 17 + Android SDK + keystore dos secrets. Anexa ao Release.
- **`app/twa/twa-manifest.json`**: config Bubblewrap (package `com.driftnet.client`, host fixo, ícones, shortcuts, signing path)
- **`public/.well-known/assetlinks.json`**: Digital Asset Links pra TWA abrir sem barra do Chrome
- **PWA polish**: manifest com `lang: pt-BR`, `display_override`, `launch_handler.client_mode: focus-existing`, `prefer_related_applications: false`, shortcuts (Novo post, Configurações). Meta description + application-name no `index.html`. Handler de `?action=compose|settings` em `App.tsx`
- **Docs**: `Docs/deploy.md` (Vercel/self-host/tunnel/troubleshooting), `Docs/twa.md` (keystore, secrets, distribuição, troubleshooting Asset Links)

### Changed

- **Roadmap**: separação clara entre Fase 6 (cliente nativo, transportes) e **Fase 7 (distribuição do cliente E do protocolo)**. Manifesto §15 → 6; §16-§17 → 7.

## [0.5.0] — 2026-04-27

First public release. Closes Phase 5 of the architecture roadmap. Manifesto v2.2 (34 principles + binding roadmap to Phase 6).

### Added

- **PostViewer estilo Tinder** — espalhar (↑) ou enterrar (↓) avança automaticamente pro próximo post da fila com animação direcional. Próximo post pré-renderizado via React (já em memória do `useFeedStore`).
- **NIP-65** (`lib/nip65.ts`) — publish/parse de relay list metadata (kind 10002). Permite descoberta de relays via Nostr padrão.
- **NIP-02 follows** (`lib/follows.ts`) — kind 3 follow lists, store reativa, aba "Seguindo" no feed.
- **NIP-06 BIP39 opt-in** (`lib/bip39.ts`) — derivação `m/44'/1237'/0'/0/0` com vetores oficiais testados.
- **WebAuthn Passkey opt-in** (`lib/passkey.ts`) — gate biométrico/hardware-key pra desbloquear nsec local.
- **Multi-identidade** (`lib/identities.ts`) — múltiplas identidades por dispositivo, switcher UI, identidade ativa em `user_prefs`.
- **Probe anti-eclipse** (`lib/probe.ts`) — sample randômico de event.ids vs cada relay a cada 30min, flag de relay silencioso/incompleto.
- **Re-broadcast oportunista** (`lib/rebroadcast.ts`) — quando user adiciona relay novo, republica eventos próprios + interações.
- **Block/mute local** (`lib/moderation-local.ts`) — filtro de visualização, sem afetar score (manifesto §24).
- **Pinning UI** — fixar posts importantes localmente, evita eviction.
- **Feed tabs** — Global / Seguindo / Trending.
- **kvvfs fallback** — Safari < 17 e contextos sem OPFS usam localStorage (~5MB).
- **99 testes Vitest** — funções puras: scoring, weight, moderation, NIP-65 parse, NIP-06 derivation, schema check.
- **PWA install** — manifest com PNG 192/512/maskable, service worker via vite-plugin-pwa, prompt customizado.
- **Tunnel mode** (`npm run dev:tunnel`) — Vite HTTP plain pra Cloudflare/ngrok com cert válido (PWA install em mobile sem ajustar trust store).

### Changed

- **NIP-01 conformance crítica** — `posts.id` agora é `event.id` (hex 64). Antes era UUID local em tag `d`, o que violava o formato esperado em `e` por SPREAD/BURY/REPORT. nostr-tools rejeitava com `unexpected size for fixed-size tag: e`, impedindo sincronização entre devices. Migração `schema_v=6` rebuild de domínio (preserva identidade, prefs, relays).
- **`passesSchemaCheck`** agora valida `^[0-9a-f]{64}$` em `e` para SPREAD/BURY/REPORT (defesa-em-profundidade).
- **Probe** usa filtro `ids` (NIP-01 padrão) em vez de `#d` custom (que dependia da tag `d` removida).
- **Manifesto v2.2 §25** — sem scan automático embutido no cliente oficial (sem PhotoDNA, sem nsfwjs, sem ML moderation). Scanner externo é "chave mestra disfarçada".
- **§27 auto-classificação voluntária** — autor marca tag opcional `content-warning`; leitor configura filtros locais opt-in (blur por default).
- **§26 moderação reativa** — reports kind 9081 com peso anti-Sybil; threshold dinâmico → score = -999 esconde do feed local.
- **Eviction respeita spreads** — `evictOldPosts()` nunca remove posts que o user espalhou (manifesto §16).
- **Relays dinâmicos** — `config/relays.ts` é apenas seed list inicial. Após boot, `wssTransport` consome `activeReadRelays()/activeWriteRelays()` que lê de `relays_user`.
- **Identidade portável** — export/import nsec1 via QR code; `rebuildIdentityHistory(npub)` puxa todo histórico Drift do author de qualquer relay.

### Fixed

- Sync entre devices PC ↔ celular (era completamente quebrado por causa do bug NIP-01 da tag `e`).
- `App.tsx` — memoização de `viewerIdx`/`nextPost` evita O(n) findIndex em cada render.
- Race condition spread-antes-do-post — `invalidateFeed()` direto em `persistSpread`/`persistBury` garante UI atualizada quando spread chega antes do post.

### Architecture

- **Event Sourcing sobre Nostr** — eventos imutáveis na rede, estado materializado em SQLite WASM, UI reativa via Zustand sem poll.
- **`onNostrEvent` é a ÚNICA porta de escrita** em tabelas de domínio (`posts`, `spreads`, `buries`, `reports`).
- **SQLite em Web Worker** sempre — main thread não toca o banco. OPFS preferencial, kvvfs fallback, memória último recurso.
- **Optimistic UI nunca alimenta o SQLite** — React state local, descartado quando evento real chega.
- **Pipeline de `onNostrEvent`** com ordem deliberada: kind check → schema check → verify Schnorr (caro, só roda no que vai ficar) → persist → recalc debounced → invalidateFeed debounced.

### Phases (histórico)

- **Phase 1** — Setup, SQLite WASM, identidade, conexão com relays
- **Phase 2** — Protocolo (kinds 9078..9081), `onNostrEvent`, feed, spread/bury
- **Phase 2.5** — Portabilidade de identidade (export/import nsec1, `rebuildIdentityHistory`)
- **Refactor Zustand** — boot/sync/feed reativos, sem poll
- **Manifesto v2.2** — 34 princípios + roadmap vinculante até Fase 6
- **Phase 3** — Swipes Framer Motion, upload imagens, content-warning, location off-default, transport abstrato
- **Phase 4** — Mapa Mapbox+Deck.gl, peso de perfil anti-Sybil, moderação threshold dinâmico, eviction respeita spreads, onboarding, denúncia autoridades
- **Phase 5** — tudo deste release

### Roadmap

- **Phase 5.x** — APK distribution (TWA/Capacitor), F-Droid, CI GitHub Releases, hospedagem PWA
- **Phase 6** — Cliente nativo Tauri (Tor via arti, WebRTC P2P, IPFS pin via helia, run-your-own-relay), build reproduzível, sneakernet bundle. Compromisso de manifesto §15-§17.

[Unreleased]: https://github.com/EduardoFerr/drift/compare/v0.6.0-alpha.1...HEAD
[0.6.0-alpha.1]: https://github.com/EduardoFerr/drift/compare/v0.6.0-alpha.0...v0.6.0-alpha.1
[0.6.0-alpha.0]: https://github.com/EduardoFerr/drift/compare/v0.5.4...v0.6.0-alpha.0
[0.5.4]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.4
[0.5.3]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.3
[0.5.2]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.2
[0.5.1]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.1
[0.5.0]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.0
