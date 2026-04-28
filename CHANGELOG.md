# Changelog

All notable changes to the Drift client. Uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow [SemVer](https://semver.org/) with the major version tracking the manifesto contract version.

## [Unreleased]

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

[Unreleased]: https://github.com/EduardoFerr/drift/compare/v0.5.4...HEAD
[0.5.4]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.4
[0.5.3]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.3
[0.5.2]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.2
[0.5.1]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.1
[0.5.0]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.0
