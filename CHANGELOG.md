# Changelog

All notable changes to the Drift client. Uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow [SemVer](https://semver.org/) with the major version tracking the manifesto contract version.

## [Unreleased]

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

[Unreleased]: https://github.com/EduardoFerr/drift/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.0
