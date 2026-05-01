# Changelog

All notable changes to the Drift client. Uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow [SemVer](https://semver.org/) with the major version tracking the manifesto contract version.

## [Unreleased]

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

[Unreleased]: https://github.com/EduardoFerr/drift/compare/v0.6.0-alpha.0...HEAD
[0.6.0-alpha.0]: https://github.com/EduardoFerr/drift/compare/v0.5.4...v0.6.0-alpha.0
[0.5.4]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.4
[0.5.3]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.3
[0.5.2]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.2
[0.5.1]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.1
[0.5.0]: https://github.com/EduardoFerr/drift/releases/tag/v0.5.0
