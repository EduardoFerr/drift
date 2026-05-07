# Drift

> *"Se eu quero uma rede livre de censura, eu também devo ser incapaz de censurá-la."*
> — [Manifesto](Docs/manifesto.md)

**Drift é um protocolo + cliente de referência. MIT. Sem dono.**
Use, modifique, redistribua, hospede, force. O protocolo é o contrato; o cliente é uma de muitas implementações possíveis. Esta distribuição não é canônica — qualquer fork verificável é igualmente legítimo. Se este repositório desaparecer, o protocolo persiste em qualquer cliente Nostr que respeite os kinds 9078–9081.

Rede social descentralizada construída sobre [Nostr](https://github.com/nostr-protocol/nostr). Eventos imutáveis na rede; estado materializado localmente em SQLite WASM; UI React reativa via stores Zustand. Sem servidor proprietário, sem chave mestra, sem algoritmo de feed personalizado.

A interação core são **swipes**: ↑ **DRIFT** (drifta) · ↓ **SINK** (afunda) · ← → navega subposts. PostViewer funciona como fila estilo Tinder — drift/sink avança automaticamente pro próximo post. Métrica de engajamento: **DERIVA** (score determinístico, não personalizado).

```
ESCRITA:  UI → Negócio → Protocolo → Nostr → onNostrEvent() → SQLite → invalidateFeed()
LEITURA:  UI ← Zustand store ← SQLite (atualizada por invalidateFeed após onNostrEvent)
OTIMISMO: UI ← React useState (descartado quando SQLite confirma)
```

## Stack

- React 18 + TypeScript strict + Vite
- Tailwind CSS + Framer Motion (gestos)
- nostr-tools (Nostr) + @sqlite.org/sqlite-wasm 3.51.2-build9 (PIN exato)
- Zustand (estado reativo) + Workbox (PWA)
- MapLibre GL + Deck.gl (tiles CARTO/OSM, sem API key — mapa de espalhamento, opt-in)
- @scure/bip39 (NIP-06 opt-in) + WebAuthn (Passkey opt-in)

## Os 4 kinds Drift

| Kind | Nome   | Carga |
|------|--------|-------|
| 9078 | POST   | `tags: [d, drift-version, client, category?, location?, content-warning?]`, content = `JSON({subposts})` |
| 9079 | SPREAD | `tags: [e, p, location?]`, content = `''` |
| 9080 | BURY   | `tags: [e]`, content = `''` |
| 9081 | REPORT | `tags: [e, p, reason]`, content = `''` |

Regular events imutáveis (faixa 1–9999). Drift roda em qualquer relay Nostr padrão. Identidades Drift funcionam em Damus/Snort/Coracle/Iris.

## Compromissos (não aspirações — mas com status honesto)

✅ = entregue · 🟡 = parcial · ⛔ = roadmap

- ✅ **Identidade auto-soberana e portável** (§2-3) — nsec1; trocar de device perde estado local mas nunca identidade
- 🟡 **Anonimato por design** (§4) — sem KYC ✅, multi-identidade ✅, Tor opcional 🟡 (só em Tauri build com `--features arti`)
- ✅ **Eventos imutáveis assinados** (§5-9) — Schnorr secp256k1
- 🟡 **Múltiplos transportes contra censura** (§12, §15) — WSS ✅, WebRTC ✅ (Fase 6.1-6.3), Tor ✅ em build Tauri com `cargo tauri build --features arti` (smoke e2e **VERIFIED** 2026-05-01: 7 guards Tor confirmados em 7 países, zero TLS direto a relay Nostr); 🟡 binary release CI matrix Linux/macOS/Windows ainda pendente
- 🟡 **Disponibilidade distribuída** (§16) — re-broadcast oportunista ✅, WebRTC PoI seed ✅ (Fase 7.1a), IPFS pin ⛔ (Fase 7+), sneakernet ⛔ (Fase 7+)
- 🟡 **Sem chave mestra, sem scan automático embutido**, build reproduzível (§17, §25) — chave mestra ✅; sem scan ✅; build reproduzível ✅ Linux Docker, Windows/macOS pendente
- ✅ **Score determinístico**, sem afinidade, sem bolha (§22, §24)
- ✅ **Bury não pune** o autor (§23) — diferença filosófica central
- ✅ **Compatível com ecossistema Nostr** (§28-30) — sem extensões obrigatórias

Especificação completa: [`Docs/manifesto.md`](Docs/manifesto.md) (34 princípios + roadmap vinculante até Fase 7).

## Setup

```bash
npm install
npm run dev
```

Abre em `https://localhost:5173/` (HTTPS via plugin-basic-ssl). Aceita o cert auto-assinado uma vez. Celular na mesma rede: `https://<ip>:5173/`.

`crossOriginIsolated` deve ser `true` no console (COOP/COEP obrigatórios pra OPFS).

### Modo tunnel (cell distante, PWA install)

```bash
npm run dev:tunnel        # Vite em HTTP plain (porta 5173)
cloudflared tunnel --url http://localhost:5173
```

URL `*.trycloudflare.com` tem cert válido — PWA instala em desktop e mobile.

## Instalação cross-platform (cliente nativo Tauri)

Cada tag `v*` dispara [`.github/workflows/tauri-distribution.yml`](.github/workflows/tauri-distribution.yml) e anexa binários ao GitHub Release correspondente. Build inclui `--features arti` (Tor real via `arti-client`) — entrega o §15 anti-censura por país pra users que não compilam do source.

| Plataforma | Artefato | Onde baixar |
|------------|----------|-------------|
| Linux x86_64 | `.AppImage` + `.deb` | Releases page → assets da tag |
| macOS arm64 (Apple Silicon) | `.dmg` | idem |
| Windows x86_64 | `.exe` (NSIS installer) | idem |

Cada plataforma também publica `SHA256SUMS-<plataforma>.txt` pra verificação manual (`sha256sum -c` / `Get-FileHash`).

### Workaround: binários não-assinados (alpha)

Builds atuais **não estão assinados** (Track A.2 do roadmap depende de Apple Developer cert + EV cert Windows, ~$300/ano combinado). Sistemas operacionais avisam:

- **Windows (SmartScreen)**: ao executar o `.exe`, clique em **"More info"** → **"Run anyway"**. Microsoft Defender pode também bloquear primeira execução; aceitar uma vez.
- **macOS (Gatekeeper)**: clique-direito no `.app` → **"Open"** → confirmar o aviso. Alternativa: `System Settings` → `Privacy & Security` → `Open Anyway` após primeira tentativa rejeitada.
- **Linux (.deb / .AppImage)**: sem warning de SO. Verificar hash via `SHA256SUMS-linux.txt`. Build auditável bit-identical disponível via [`Dockerfile.reproducible`](Dockerfile.reproducible) ([`Docs/build-reproducible.md`](Docs/build-reproducible.md)).

Esses warnings refletem ausência de assinatura de código, não problema de segurança intrínseco. Manifesto §17 (sem chave mestra na distribuição) e §25 (sem scan automático embutido) garantem que o binário não tem backdoor — o que está sendo construído é exatamente o que está em `src-tauri/`.

## Deploy

Ver [`Docs/deploy.md`](Docs/deploy.md) — Vercel (recomendado), GitHub Releases, self-host.

## Testes & build

```bash
npm run lint             # tsc -b --noEmit (typecheck strict, sem emitir)
npm run test             # 399 tests Vitest — funções puras (scoring, weight, moderation, NIP-65, NIP-06, schema check, transport, peer registry, etc.)
npm run build            # vite build + tsc strict
```

## Estrutura

Documentação interna em [`Docs/drift-arquitetura-v4.md`](Docs/drift-arquitetura-v4.md) e [`CLAUDE.md`](CLAUDE.md).

```
src/
├── components/    Identity, Feed, Post, Create, Profile, Onboarding, Settings, UI
├── hooks/         useFeed, usePost, useCreate, useIdentity, useWeight, useSpreadMap
├── lib/
│   ├── nostr.ts            pool + signDriftEvent + verifyDriftEvent + publishToRelays
│   ├── db.ts/db.worker.ts  SQLite WASM em Web Worker
│   ├── identity.ts         export/import nsec1, reset
│   ├── identities.ts       multi-identidade (Fase 5)
│   ├── events.ts           ÚNICA porta de escrita SQLite domínio
│   ├── protocol.ts         createPost, spreadPost, buryPost, reportPost
│   ├── sync.ts             subscribe global + rebuild + ring buffer diagnóstico
│   ├── feed.ts             getGlobalFeed + invalidateFeed + tabs
│   ├── scoring.ts          calculateScore (pura, testada)
│   ├── weight.ts           peso de perfil anti-Sybil (Fase 4)
│   ├── moderation.ts       reports + threshold dinâmico (Fase 4)
│   ├── moderation-local.ts block/mute local (Fase 5)
│   ├── transport/          abstração WSS / Tor / WebRTC
│   ├── relays.ts           gerenciamento dinâmico (Fase 5)
│   ├── nip65.ts            NIP-65 publish/parse de relay list
│   ├── follows.ts          NIP-02 (kind 3) follows
│   ├── bip39.ts            NIP-06 BIP39→nsec opt-in
│   ├── passkey.ts          WebAuthn gate opt-in
│   ├── probe.ts            probe anti-eclipse
│   ├── rebroadcast.ts      re-broadcast oportunista
│   └── cache.ts            eviction respeita spreads + pinned
├── types/         drift.ts, nostr.ts
└── config/        constants.ts, relays.ts (seed list)
```

## Status

- ✅ **Fase 1** — Setup, SQLite WASM, identidade, conexão com relays
- ✅ **Fase 2** — Protocolo, `onNostrEvent`, feed, spread/bury
- ✅ **Fase 2.5** — Portabilidade de identidade (export/import nsec1)
- ✅ **Refactor Zustand** — boot/sync/feed reativos
- ✅ **Manifesto v2.2** — 34 princípios + roadmap vinculante
- ✅ **Fase 3** — Swipes Framer Motion, upload, content-warning, location off-default
- ✅ **Fase 4** — Mapa, peso de perfil, moderação threshold dinâmico, eviction respeita spreads
- ✅ **Fase 5** — PWA polish, NIP-65, NIP-02, NIP-06, Passkey, multi-identidade, probe, re-broadcast, pinning, block/mute, feed tabs, kvvfs fallback, **399 tests Vitest**
- ✅ **Fase 5.x** — versionamento, CI, PWA polish, deploy Vercel, release automation
- 🟡 **Fase 7.1a antecipada** — TWA Android (Bubblewrap CI, infra completa; primeiro APK assinado pendente). **Caveat**: TWA carrega o PWA via Vercel — IP do user visível pra hosting; cliente nativo Tauri (Fase 6) é a via pra §28 completo
- 🟡 **Fase 6 em curso** — WebRTC ✅ (6.1-6.3); Tauri scaffold ✅ (6.5); build reproduzível ✅ Linux Docker (6.7); Tor 🟡 (6.4 etapas 1-4 shipped pra source-builders, smoke e2e + binary release pendentes)
- ⛔ **Fase 7** — Distribuição: TWA 🟡 antecipada, F-Droid (bloqueado em repo público), IPFS pin, sneakernet bundle, run-your-own-relay

Fase 6 entrega a **capacidade técnica** (§15 — múltiplos transportes); Fase 7 entrega a **garantia política** (§16-§17 — disponibilidade distribuída + sem chave mestra na distribuição). Ambas são compromissos do manifesto.

## Filosofia

> Drift não impede mentira; impede consenso estável da mentira.

Nada de feed personalizado, nada de reputação subjetiva, nada de função `deletePost`/`banUser`. Conteúdo ilegal é tratado por reports comunitários (§26) + auto-classificação voluntária (§27) + denúncia ao operador legal competente (NCMEC, SaferNet, etc.). Cliente oficial **não** escaneia conteúdo automaticamente — qualquer scanner externo embutido é chave mestra disfarçada (§25).

## Licença

[MIT](LICENSE)
