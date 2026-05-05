# Drift — Instruções para Claude Code

Bem-vindo. Este projeto é uma rede social descentralizada. Antes de
escrever qualquer linha, leia este arquivo inteiro. Em casos de dúvida,
consulte:

- **`Docs/manifesto.md`** — contrato (34 princípios + roadmap de
  compromissos). **Cada princípio aqui vai ser entregue.** Não é
  aspiração; é compromisso público. Quando arquitetura conflita com
  manifesto, manifesto vence.
- **`Docs/drift-arquitetura-v4.md`** — fonte da verdade arquitetural
- **`Docs/drift-fluxograma-v4.html`** — fluxos visuais

## Método de desenvolvimento — personas LLM (Ted/Marshall/Barney/Lily/Robin)

Este projeto usa **personas LLM** como ferramenta estruturada de
revisão crítica. Em sessões com agentes, o desenvolvedor principal
("o Arquiteto") assume papéis distintos pra forçar perspectivas
complementares e evitar viés de confirmação:

- **Ted** — arquitetura, padrões, camadas, abstrações, Rust + CI
- **Barney** — peer review crítico, threat modeling, security, ceticismo
- **Marshall** — schema, types, conformance entre camadas, tests
- **Lily** — core code, runtime, fluxos de dados, manutenibilidade
- **Robin** — research, curadoria, gaps cross-cutting, docs

**Personas não são pessoas reais.** Documentos de plano que
referenciam "peer review do Barney" ou "Ted aprovou" significam que o
plano passou por análise crítica estruturada naquele papel — não por
um humano externo. Em planos novos, prefira atribuir por **tipo de
revisão** (`[revisão: segurança]`, `[revisão: conformance]`) em vez do
nome da persona — mantém o rastro analítico sem sugerir equipe que
não existe.

Documentos de plano de fases concluídas vivem em `Docs/archive/`;
artefatos de sessão (auditoria pontual, conformance check de uma data
específica) vivem em `Docs/sessions/`. Raiz de `Docs/` reservada pra
documentação ativa.

## Vocabulary mapping (UI vs spec/código)

Drift mantém **separação léxica** entre camada user-facing e camada
protocolo/código. Crítico pra novos contributors / agentes:

| Camada | Termos | Onde aparece |
|---|---|---|
| Protocol/spec/código | **SPREAD** (kind 9079) / **BURY** (kind 9080) | Manifesto, `protocol-spec.md`, function names (`spreadPost`, `buryPost`), CSS classes (`drift-spread`, `drift-bury`), TypeScript types (`'spread' \| 'bury'`), comentários técnicos, fixture files |
| UI user-facing | **DRIFT** (verbo da ação ↑) / **SINK** (verbo da ação ↓) / **DERIVA** (substantivo, score) | Strings JSX em `src/components/**/*.tsx`, labels de botão, toasts, onboarding copy, README seção pública |

**NÃO** renomear `spreadPost()` pra `driftPost()` "por consistência" —
quebra grep histórico, refs em PRs, documentação de spec, sem ganhar
nada (UI já comunica DRIFT pro user via strings JSX).

**NÃO** introduzir "espalhar"/"enterrar" em UI string nova — vocabulário
PT antigo já foi migrado. Use DRIFT/SINK em copy nova.

LOCK_VIA_TEST ativo: `tests/manifesto-conformance.test.ts` falha se:
- `\bespalha\|enterra\b` aparece em strings JSX (`>...<` ou `'...'`/`"..."`).
- Spec deixa de associar `9079` a `SPREAD` ou `9080` a `BURY`.

Glossário canônico: [`Docs/design-system.md`](Docs/design-system.md) §1.

---

## TL;DR — Em 30 segundos

Drift = **Event Sourcing sobre Nostr**. Eventos imutáveis na rede,
estado materializado localmente em SQLite WASM, UI React lê do SQLite
via stores Zustand reativas (sem poll), com optimistic state local
para latência.

```
ESCRITA:  UI → Negócio → Protocolo → Nostr → onNostrEvent() → SQLite → invalidateFeed()
LEITURA:  UI ← Zustand store ← SQLite (atualizada por invalidateFeed após onNostrEvent)
OTIMISMO: UI ← React useState (descartado quando SQLite confirma)
```

**A interação core são swipes:** ↑ espalha, ↓ enterra, ← → navega
subposts. Os 4 kinds Drift são `9078..9081` (regular events imutáveis).

**Compromisso público:** anti-censura forte (incluindo Estado-nação),
anonimato por design, disponibilidade distribuída, identidade portável.
Cliente PWA cobre o básico; cliente nativo (Tauri/Android, Fase 6)
adiciona Tor, WebRTC e IPFS pin pra entregar o manifesto inteiro.

---

## Invariantes — quebrar isso quebra o sistema

### 1. `onNostrEvent()` é a ÚNICA porta de **INSERT** em domínio

Tabelas de domínio (`posts`, `spreads`, `buries`, `reports`) recebem
`INSERT` exclusivamente por `src/lib/events.ts` → `onNostrEvent()`.
Após persistir, ele chama `invalidateFeed()` (debounced) — caminho
canônico que dispara re-query do SQLite pra atualizar a store React.

**Exceções autorizadas (UPDATE/DELETE locais)** — manutenção do cache,
não criação de estado novo:

- `cache.ts:evictOldPosts` — `DELETE FROM posts/buries` quando
  contagem ultrapassa SOFT_LIMIT. Manifesto §16 (cache local respeita
  spreads + pinned). Eviction é gestão de espaço, não censura.
- `moderation.ts:maybeModerate` — `UPDATE posts SET score = -999`
  quando reports atingem threshold dinâmico. Manifesto §26. Score
  -999 esconde do feed; cliente alternativo pode exibir mesmo assim.

**Regra dura pra todo UPDATE/DELETE em domínio**: chamar
`invalidateFeed()` após o write. Sem isso, `useFeedStore` fica stale
até próximo evento entrar via `onNostrEvent`. Validar nos PRs.

Exceções operacionais locais (não-domínio): `identity`, `sync_log`,
`user_prefs`, e tabelas de relay management (Fase 5+).

### 2. Optimistic UI nunca alimenta o SQLite

Optimistic é React state local (`useState` em componentes ou hooks).
Descartado silenciosamente quando o evento real chega.

### 3. Funções puras pra negócio

`calculateScore`, `calculateWeight`, `getMaxSubposts`, etc., são
funções puras: mesma entrada → mesma saída → sempre. Sem
`Date.now()` implícito (passe `now` por parâmetro).

Determinismo é princípio do manifesto (§7). Quebrar isso quebra a
convergência entre clientes.

### 4. SQLite roda em Web Worker, sempre

Main thread nunca abre o banco. Interface em `src/lib/db.ts` →
`src/lib/db.worker.ts`.

### 5. Pipeline de `onNostrEvent` — ordem importa

```
1. Cheap: kind check    (DRIFT_KIND_SET.has)
2. Cheap: schema check  (tag lookup, JSON.parse só p/ POST)
3. Caro: verify Schnorr (~1ms/evento — só agora)
4. Persist + scheduleScoreRecalc(postId)
5. invalidateFeed() (debounced 150ms)
```

### 6. Recalc de score é debounced

`scheduleScoreRecalc(postId)` em events.ts. Janela de 100ms.

### 7. Sem scan automático de conteúdo no cliente oficial

Cliente oficial Drift NÃO escaneia, classifica ou filtra conteúdo
automaticamente — sem PhotoDNA, sem ML local de moderação, sem
blocklists embutidas. Manifesto §25 (Sem Chave Mestra Disfarçada):
qualquer scanner externo é chave mestra disfarçada. O operador do
scanner (Microsoft, Cloudflare, modelo treinado por terceiro) decide
o que pode passar — vetor de censura inaceitável.

O que o cliente faz no lugar:
- **§27 Auto-classificação voluntária**: autor marca tag opcional
  `content-warning` (`nsfw` | `violence` | `spoiler` | `ad`); leitor
  configura filtros locais opt-in (blur por default, toggles em
  `user_prefs`).
- **§26 Moderação comunitária reativa** (Fase 4): reports kind 9081
  + threshold dinâmico → score = -999 esconde do feed local.

Scan automático opt-in (PhotoDNA, classificador NSFW, etc.) pode
existir como **plugin** ou em **cliente alternativo**, sempre OFF
por default e sob escolha explícita do user. Nunca é obrigatório
no protocolo nem no cliente oficial padrão. Manifesto §25 v2.2.

### 8. nsec NUNCA sai do dispositivo, NUNCA persiste em claro

Geração local secp256k1, AES-GCM 256, master key não-exportável em
IndexedDB separada do OPFS.

### 9. Identidade é portável; dispositivo é descartável

A identidade Drift = nsec1. Roda em qualquer cliente Nostr. Trocar
de device perde estado local mas NUNCA identidade.

`identity.ts`: `exportIdentity`, `setIdentityFromNsec`,
`resetIdentity`. `sync.ts`: `rebuildIdentityHistory(npub)`.

**Regra dura:** toda ação destrutiva à identidade deve oferecer
export ANTES de executar.

### 10. Estado reativo via Zustand, sem poll

UI consome via stores:
- **boot** → `bootstrap.ts:setBoot()`
- **sync** → handlers de subscribe em `sync.ts`
- **feed** → `invalidateFeed()` em `events.ts` (debounced 150ms)

**Não há poll.**

### 11. Sem afinidade no feed

Ranking é função pura de score. **Não personalizar feed por usuário.**
Bloqueios/silenciamentos são camada de visualização local, não de
ranking. Manifesto §24.

### 12. Sem chave mestra, jamais

Não escrever função `deletePost()`, `banUser()`, `flagAsSpam()`
global, ou qualquer coisa que dê ao fundador poder sobre conteúdo
de outros usuários. Mesmo que pareça útil. Mesmo que seja "só pra
moderar X".

Scanner automático embutido no cliente oficial é a forma sutil
desse mesmo poder — o operador do scanner herda a chave mestra.
Por isso §7 (sem scan automático). Conteúdo ilegal é endereçado
por §26 (reports comunitários, threshold dinâmico) e §27
(auto-classificação voluntária + filtros locais). Cliente oficial
encoraja o user a denunciar a autoridades competentes (NCMEC,
SaferNet, etc.) — UI específica vem na Fase 4. Manifesto §17.

### 13. Cliente NÃO deleta dados moderados do SQLite

Score = -999 esconde do feed. Apagar do banco, não. O usuário pode
exportar, auditar, ou usar cliente alternativo que exibe.

`evictOldPosts()` (Fase 4) **NUNCA** remove posts que o user
espalhou — manifesto §16 (disponibilidade distribuída via mecânica
social).

### 14. Compatibilidade com ecossistema Nostr

Cliente Drift respeita NIP-01 sem extensões obrigatórias. Não
inventa kinds privados. Tag `drift-version` distingue eventos
Drift. Identidades Drift funcionam em Damus/Snort/Coracle/Iris.

**Não inventar protocolo de discovery próprio paralelo ao Nostr.**
Defesas anti-Sybil adaptativo (random walk obrigatório, path
diversity scoring, cluster detection) vivem dentro do transport
(`lib/transport/webrtc/`, Fase 6), não como kinds/tags próprias
no protocolo Drift público. NIP-65 cobre discovery de relays via
Nostr padrão (Fase 5, `lib/nip65.ts`). NIP-02 cobre follows
(`lib/follows.ts`). NIP-06 cobre BIP39→nsec opcional
(`lib/bip39.ts`). Decisão registrada em arquitetura §30.12 e §30.13.

Manifesto §28-30.

### 15. Multi-identidade não pode confundir o pipeline

Identidade ativa atual é determinada por `user_prefs.active_identity`.
A tabela `identity` (singular) é mantida em sync com a identidade
ativa via `lib/identities.ts:setActiveIdentity`. **NÃO escrever em
`identity` (singular) direto** — sempre via `setActiveIdentity` pra
manter coerência multi-id.

Trocar identidade ativa exige `location.reload()` em seguida — sync
e feed precisam reset clean. Manifesto §3 (dispositivo descartável,
identidade não) torna isso aceitável.

### 16. Funções puras críticas têm tests Vitest

`scoring.ts`, `weight.ts`, `moderation.ts`, `feed.ts:applyContentFilters`,
`bip39.ts:deriveNostrKeyFromMnemonic` (NIP-06), `nip65.ts:parseRelayList`
têm tests em `tests/*.test.ts`. **Quebrar testes = quebrar manifesto §7
(determinismo)**. Antes de mudar essas funções, rode `npm run test`
e mantenha verde.

Tests rodam em Node, não browser — só cobrem lógica pura (sem React,
SQLite WASM, WebAuthn). Integração end-to-end ainda manual.

### 17. Relays são dinâmicos (Fase 5+) — sem hardcode

`config/relays.ts` é apenas a **seed list inicial** populada na
primeira boot via `ensureSeedRelays()`. Após isso, `wssTransport`
consome `activeReadRelays()/activeWriteRelays()` que lê de
`relays_user`. **NÃO importar `RELAYS` direto em `sync.ts` ou outras
camadas** — sempre via `lib/relays.ts`.

Re-broadcast oportunista dispara via `addRelay()` quando o user
adiciona relay novo. Probe anti-eclipse roda a cada 30min via
`startProbe()` em bootstrap.

---

## Stack — não trocar sem combinar

```
React 18 + TypeScript strict + Vite           [MVP-Fase 5]
Tailwind CSS                                  [todas as fases]
Framer Motion (gestos)                        [Fase 3]
MapLibre GL + Deck.gl ArcLayer (CARTO tiles)  [Fase 4]
nostr-tools (Nostr)                           [todas]
@sqlite.org/sqlite-wasm 3.51.2-build9 (PIN)  [todas]
zustand                                        [todas]
qrcode                                         [Fase 2.5+]
Workbox (PWA)                                  [Fase 5]
@vitejs/plugin-basic-ssl                       [dev]

Fase 6 (cliente nativo):
Tauri                                          [shell desktop]
arti / tor                                     [transporte Tor]
helia / js-ipfs                                [pin de posts virais]
```

**SQLite WASM** precisa pin exato: pacote publica como pre-release.

**COOP/COEP** obrigatórios em dev e prod. Sem eles,
`crossOriginIsolated === false`, OPFS quebra.

**HTTPS no dev** via plugin-basic-ssl + `server.host = true`. Cel
via rede local precisa secure context.

---

## Tecnologias proibidas / decisões já tomadas

- **Gun.js** — descartado em arquitetura §30.1
- **CRDT (Automerge/Yjs)** — descartado em arquitetura §30.2
- **`any` em TypeScript** — strict mode
- **Algoritmo de feed personalizado** — manifesto §24
- **PoW obrigatório** — opcional, manifesto §31
- **Reputação subjetiva** — descartada, manifesto §22
- **Função `deletePost`/`banUser` global** — proibido, manifesto §17

---

## Os 4 kinds Drift

| Kind | Nome | O que carrega |
|---|---|---|
| 9078 | POST | `tags: [d, drift-version, client, category?, location?]`, content = `JSON({subposts})` |
| 9079 | SPREAD | `tags: [e, p, location?]`, content = `''` |
| 9080 | BURY | `tags: [e]`, content = `''` |
| 9081 | REPORT | `tags: [e, p, reason]`, content = `''` |

Regular events (faixa 1-9999), imutáveis. Por que não 30078..30081?
Arquitetura §30.6.

Kinds reservados para fases futuras:
- **9082** — Boost pago, se vier (manifesto §18)
- **9083+** — TBD conforme features

---

## Estrutura

```
src/
├── components/    Identity/, Feed/, Post/, Create/, Profile/, Onboarding/, UI/, Relay/ (Fase 5)
├── hooks/         useFeed, usePost, useCreate, useIdentity, useWeight, useSpreadMap
├── lib/
│   ├── nostr.ts          pool, signDriftEvent, verifyDriftEvent, publishToRelays
│   ├── db.ts / db.worker.ts / schema.sql
│   ├── identity.ts        getOrCreateIdentity, setIdentityFromNsec, resetIdentity, exportIdentity
│   ├── identities.ts      multi-identidade (Fase 5)
│   ├── crypto.ts          encrypt/decrypt, resetMasterKey
│   ├── bootstrap.ts       useBootStore + startBoot
│   ├── events.ts          onNostrEvent — ÚNICA porta SQLite domínio + invalidateFeed
│   ├── protocol.ts        createPost, spreadPost, buryPost, reportPost
│   ├── sync.ts            startSync + rebuildIdentityHistory + useSyncStore
│   ├── feed.ts            getGlobalFeed + useFeedStore + invalidateFeed
│   ├── scoring.ts         calculateScore (pura)
│   ├── transport/         abstração de transporte (Fase 6)
│   │   ├── wss.ts         WSS clearnet (atual)
│   │   ├── tor.ts         WSS via Tor (Fase 6, cliente nativo)
│   │   └── webrtc/        P2P direto Fase 6 (12 arquivos: index/types/state/config/ice/peer/pipeline/rateLimit/health/reconnect/discovery/boot)
│   ├── relays.ts          gerenciamento dinâmico de relays (Fase 5) — store + CRUD + activeRelays
│   ├── nip65.ts           NIP-65 publish/parse de relay list (Fase 5)
│   ├── follows.ts         NIP-02 (kind 3) follows + store (Fase 5)
│   ├── identities.ts      multi-identidade (Fase 5) — manifesto §4
│   ├── moderation-local.ts  block/mute local (Fase 5) — manifesto §24
│   ├── bip39.ts           NIP-06 BIP39→nsec opt-in (Fase 5)
│   ├── passkey.ts         WebAuthn gate opt-in (Fase 5)
│   ├── probe.ts           probe anti-eclipse (Fase 5) — manifesto §20
│   ├── rebroadcast.ts     re-broadcast oportunista (Fase 5) — manifesto §16
│   ├── upload.ts          nostr.build retry+jitter (Fase 3)
│   ├── weight.ts          peso de perfil + bridge SQLite (Fase 4)
│   ├── moderation.ts      reports + threshold dinâmico (Fase 4)
│   ├── cache.ts           eviction respeita spreads + pinned (Fase 4)
│   └── pin.ts             IPFS pin de posts virais (Fase 6)
├── types/         drift.ts, nostr.ts
└── config/        constants.ts, relays.ts (seed list)
```

---

## Estado da implementação (Abril 2026)

- ✅ **Fase 1** — Setup, SQLite WASM, identidade, conexão com relays
- ✅ **Fase 2** — Protocolo (kinds 9078..9081), `onNostrEvent`, feed, spread/bury
- ✅ **Fase 2.5** — Portabilidade de identidade (export/import nsec1, rebuildIdentityHistory)
- ✅ **Refactor Zustand** — boot/sync/feed reativos, sem poll
- ✅ **Manifesto v2.2** — 34 princípios + roadmap vinculante
- ✅ **Fase 3** — Swipes Framer Motion, upload imagens (sem scan automático), tag `content-warning` + filtros locais, location off-default, transport abstrato
- ✅ **Fase 4** — Mapa, peso de perfil, moderação threshold dinâmico, eviction respeita spreads, onboarding, denúncia autoridades
- ✅ **Fase 5** — PWA polish, NIP-65, NIP-02, NIP-06 (BIP39 opt-in), Passkey opt-in, multi-identidade, probe anti-eclipse, re-broadcast oportunista, pinning UI, block/mute, feed tabs (Global/Seguindo/Trending), Profile, kvvfs fallback, 399 tests Vitest
- ✅ **Fase 5.x (operacional)** — versionamento + CHANGELOG, CI GitHub Actions (tsc + tests + build), PWA polish (manifest enriched + shortcuts + meta description + ?action= URL handling), deploy Vercel + GitHub integration, release automation (tag v* → GitHub Release com dist.zip + SHA256SUMS)
- ⏳ **Fase 6** — Cliente nativo Tauri (Tor via arti, WebRTC P2P, multi-transport orchestration), build reproduzível. **Capacidade técnica** de §15 (anti-censura por país)
- ⏳ **Fase 7** — Distribuição do cliente E do protocolo: TWA Android (✅ antecipada — Bubblewrap CI), Capacitor (alternativa), F-Droid manifest, Play Store opcional, IPFS pin via helia, run-your-own-relay, sneakernet bundle. **Garantia política** de §16 (disponibilidade distribuída) e §17 (sem chave mestra na distribuição)

Fase 6 + Fase 7 são compromissos do manifesto, não opções:
- §15 anti-censura por país → cabe em Fase 6 (transporte: Tor + WebRTC)
- §16 disponibilidade distribuída → cabe em Fase 7 (IPFS pin, sneakernet, re-broadcast, run-your-own-relay)
- §17 sem chave mestra + build reproduzível → cabe em Fase 7 (F-Droid build reproduzível, hashes públicos, sideload sem store)

---

## Padrões

### nostr-tools v2
```typescript
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import { nip19 } from 'nostr-tools'
import type { Event as SignedEvent, EventTemplate } from 'nostr-tools'
```

### SQL via worker
```typescript
import { db } from './db'
await db.run(`INSERT OR IGNORE INTO posts (...) VALUES (?)`, [...])
const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM posts`)
const rows = await db.exec<PostRow>(`SELECT * FROM posts WHERE score > ? LIMIT ?`, [-999, 50])
```

### Idempotência
Sempre `INSERT OR IGNORE`. Relays diferentes entregam o mesmo evento;
crashes podem reprocessar.

### Stores Zustand
```typescript
import { create } from 'zustand'

interface FooState { /* ... */ }
const INITIAL: FooState = { /* ... */ }

export const useFooStore = create<FooState>(() => INITIAL)

function setFoo(updater: (s: FooState) => FooState): void {
  useFooStore.setState(updater)
}

const value = useFooStore(s => s.value)  // selector granular
```

Setters expostos publicamente são semânticos (`incrementEvents`,
`invalidateFeed`), nunca `setState` cru.

### Bootstrap fora do React
Singleton em `src/lib/bootstrap.ts`. NÃO dentro de `useEffect` —
StrictMode quebra.

### Feed sem poll
`onNostrEvent` chama `invalidateFeed()` (debounced 150ms). **Não
adicionar `setInterval` para refresh do feed.**

### Funções puras
```typescript
// ✅ testável, determinístico
function calculateScore(input: { spreads, buries, createdAt, now }) {
  const age = (input.now - input.createdAt) / 3600
  return /* ... */
}
```

### Transporte abstrato (Fase 6)
```typescript
// API que cada transport.* implementa
interface Transport {
  publish(event: SignedEvent): Promise<void>
  subscribe(filter: Filter, onEvent: Handler): Unsubscribe
  health(): Promise<{ ok: boolean; latencyMs: number }>
}
```

WSS, Tor, WebRTC plugam atrás dessa interface. `sync.ts` itera
sobre transportes ativos sem saber qual é qual.

---

## Setup

```bash
npm install
npm run dev
```

Vite abre em `https://localhost:5173/` (HTTPS via plugin-basic-ssl).
Aceitar warning de cert auto-assinado uma vez. Cel:
`https://<ip>:5173/`.

`crossOriginIsolated` deve ser `true` no console.

---

## Filosofia (resumo — fonte completa em `Docs/manifesto.md`)

> *"Se eu quero uma rede livre de censura, eu também devo
> ser incapaz de censurá-la."* — Manifesto

**Compromissos do Drift (não aspirações; alguns ainda em construção — ver status real abaixo):**

- ✅ Identidade auto-soberana e portável (§2-3)
- 🟡 Anonimato por design — sem KYC, multi-identidade ✅; Tor opcional só em Tauri+arti (Fase 6.4) (§4)
- ✅ Eventos imutáveis assinados (§5-9)
- 🟡 Múltiplos transportes contra censura — WSS ✅; WebRTC ✅ (Fase 6.1-6.3); Tor ✅ em build Tauri com `--features arti` (smoke e2e VERIFIED 2026-05-01, §15) (§12, §15)
- 🟡 Disponibilidade distribuída — re-broadcast oportunista ✅; PoI WebRTC seed ✅ (Fase 7.1a); IPFS pin ⛔ (Fase 7+) (§16)
- 🟡 Sem chave mestra ✅; build reproduzível ✅ Linux (Fase 6.7); Windows/macOS pendente (§17)
- ✅ Bury não pune (§23)
- ✅ Score determinístico, sem afinidade, sem bolha (§22, §24)
- ✅ Compatibilidade com ecossistema Nostr (§28-30)

Quando dúvida sobre uma feature nova, abre o manifesto antes do
código. Especialmente Fase 6 — várias features aparentemente
"opcionais" são compromissos.

---

*Última atualização: Maio 2026 · Manifesto v2.2 · Arquitetura v5.3 · 34 princípios · 399 tests Vitest · Fase 5 + 5.x fechadas; Fase 6 em curso (6.4 etapas 1-4 shipped pra source-builders) · roadmap vinculante até Fase 7*
