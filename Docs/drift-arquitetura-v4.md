# DRIFT — Documento de Arquitetura e Engenharia
**Versão:** 5.3
**Data:** Abril 2026
**Para:** Claude Code (implementação completa, MVP a Fase 6)

> Mudanças vs v5.2 — honestidade sobre threat model + bug fix:
> §36 novo — Threat Model explícito (o que protege, o que não protege,
> adversários considerados, por quê não somos mixnet, métricas de
> anonimato como referência); manifesto §4 atualizado com reconhecimento
> de "não somos mixnet"; bug fix — optimistic UI no contador de
> spreads/buries (manifesto §10 + §2.4 prometem mas só estavam
> implementados parcialmente); §35 renumerado (era §34 duplicado).
>
> Mudanças vs v5.1 — Fase 5 fechada com tests + docs:
> §5.5 multi-identidade implementada (`lib/identities.ts` +
> `IdentitySwitcher`); §6 NIP-65 (kind 10002) + NIP-02 (kind 3)
> integrados via `lib/nip65.ts` + `lib/follows.ts`; §11 schema com
> tabelas `identities`, `relays_user`, `blocked`, `muted` + coluna
> `raw_event` em posts/spreads/buries (re-broadcast); §12 transport
> consome `activeReadRelays()/activeWriteRelays()` dinâmicos; §16
> estrutura ganhou `lib/follows`, `lib/identities`, `lib/relays`,
> `lib/probe`, `lib/rebroadcast`, `lib/nip65`, `lib/moderation-local`,
> `lib/bip39`, `lib/passkey`; §22 invariantes Fase 5 (multi-id, NIP-65
> rotação, probe anti-eclipse, rebroadcast oportunista); §28 fallback
> `kvvfs` (localStorage) substituiu in-memory; §30.13 decision record
> (BIP39 NIP-06 + Passkey opt-ins); §34 nova — tests com Vitest.
>
> Mudanças vs v5.0 (mantidas em v5.1):
> §14 reescrito de "CSAM CHECK" para "AUTO-CLASSIFICAÇÃO + FILTROS LOCAIS"
> (manifesto §25, §27); §3.4 sem PhotoDNA; §4 diagrama sem `checkCSAM`;
> §16 estrutura sem `csam.ts` no cliente oficial padrão; §18 env sem
> `VITE_PHOTODNA_KEY`; §21 Fase 3 ajustada; §22 invariantes ajustadas;
> §24 tabela sem CSAM check obrigatório; §30.11 decisão registrada.
>
> Mudanças vs v4.1 (mantidas em v5.0):
> §20 (resistência à censura concreta), §21 (Fase 6 cliente nativo +
> Tor + WebRTC + IPFS), §31 (anti-censura por país), §32 (cliente
> nativo Tauri), §33 (disponibilidade distribuída), §30.9 (decisão
> Fase 6 = compromisso vinculante).
>
> Mantém todas as decisões anteriores: kinds 9078..9081, verify lazy,
> recalc debounced, identidade portável.

---

## 0. MANIFESTO DO PROTOCOLO DRIFT

> *"Se eu quero uma rede livre de censura, eu também devo ser incapaz de censurá-la." — Fundador do Drift*
> — Fundador do Drift

A versão completa do manifesto técnico (32 princípios, regras testáveis,
implementação por fase) está em **`Docs/manifesto.md`**. Esta seção é o
sumário executivo.

### 0.1 O que é o Drift

**O Protocolo** — regras abertas e públicas para publicação, distribuição e rankeamento de conteúdo em rede descentralizada. Pertence a todos. Ninguém modifica unilateralmente depois de lançado.

**O Cliente Oficial** — implementação de referência. Pode evoluir e ter features premium. Nunca terá poderes sobre a rede que outros clientes não tenham.

### 0.2 Garantias do Drift (compromissos vinculantes)

Não são aspirações. Cada item será entregue na fase indicada.

- **Identidade auto-soberana e portável** — secp256k1 local, exportável (✓ Fase 2.5)
- **Anonimato por design** — sem KYC, multi-identidade, Tor opt-in (✓ MVP / Fase 5 / Fase 6)
- **Anti-censura por país** — múltiplos transportes (WSS / Tor / WebRTC), múltiplos clientes, múltiplos relays (Fase 6)
- **Disponibilidade distribuída** — re-broadcast, IPFS pin, "espalhar = seedear" (Fase 5 / Fase 6)
- **Sem chave mestra** — não existe `deletePost()` global, build reproduzível (✓ MVP / Fase 6)
- **Bury não pune** — autores não perdem engajamento (✓)
- **Score determinístico** — sem afinidade, sem feed personalizado (✓)
- **Compatibilidade preservada** — Nostr, entre versões Drift, entre clientes (✓)

### 0.3 O Ponto de Não Retorno
```
Antes do lançamento  → Fundador controla tudo
Após lançamento      → Fundador tem influência moral, não técnica
Após massa crítica   → A rede existe independente de qualquer pessoa
```

---

## 1. VISÃO GERAL DO PRODUTO

### 1.1 Conceito
Drift é uma rede social descentralizada onde o conteúdo se espalha exclusivamente pelo comportamento humano. Não existe algoritmo central.

- **Swipe vertical para cima** → Espalha o post
- **Swipe vertical para baixo** → Enterra o post
- **Swipe horizontal** → Navega entre subposts

### 1.2 Princípios Fundamentais
- Descentralizado — sem servidor central
- Determinístico — mesmos eventos, mesmo estado, sempre
- Resistente à censura — incluindo Estado-nação adversário
- Disponibilidade distribuída — quem espalha, seedeia
- Anônimo por design — sem login real-world, multi-identidade
- Identidade portável, dispositivo descartável
- Código aberto, build reproduzível
- Sem notificações fora do app — filosofia zen
- Sem afinidade no feed — sem bolha algorítmica

---

## 2. DECISÃO ARQUITETURAL CENTRAL

### 2.1 O Padrão: Event Sourcing sobre Nostr

```
Eventos imutáveis (Nostr)
        │
        │ função pura determinística
        ↓
Estado materializado (SQLite WASM)
        │
        │ queries SQL
        ↓
UI React + optimistic state local (descartável)
```

Três camadas. Cada uma com responsabilidade única. Sem sobreposição.

### 2.2 Por que não Gun.js

Avaliado e descartado. Duplicava responsabilidades já melhor resolvidas (distribuição → relays, estado → event sourcing, tempo real → optimistic UI, persistência → eventos imutáveis, queries → SQLite). Ver §30.1.

### 2.3 Por que não CRDT (Automerge/Yjs)

CRDTs resolvem edições concorrentes. Drift tem eventos imutáveis e estado derivado — problemas diferentes. Ver §30.2.

### 2.4 Optimistic UI sem Gun.js

```typescript
const handleSpread = async () => {
  setOptimisticScore(s => s + 1)        // imediato
  try {
    await nostr.publish(spreadEvent)
  } catch {
    setOptimisticScore(s => s - 1)
  }
}
// Quando SQLite confirma via onNostrEvent() → optimistic descartado
```

### 2.5 O Determinismo

```typescript
function deriveState(events: DriftEvent[]): DriftState {
  return events
    .sort((a, b) => a.created_at - b.created_at)
    .reduce((state, event) => applyEvent(state, event), INITIAL_STATE)
}
```

Verificável, auditável, debugável. Base de toda a arquitetura.

---

## 3. STACK TECNOLÓGICO

### 3.1 Frontend (Cliente Web — MVP a Fase 5)
```
Framework:   React 18 + Vite
Estilo:      Tailwind CSS
Gestos:      Framer Motion
Mapa:        MapLibre GL JS + Deck.gl ArcLayer (tiles CARTO Dark Matter, sem API key)
PWA:         Workbox
Estado:      Zustand
Linguagem:   TypeScript strict
```

### 3.2 Frontend (Cliente Nativo — Fase 6)
```
Shell:       Tauri (Rust + WebView)
Tor:         arti (Rust, Tor Project oficial)
WebRTC:      libp2p ou implementação direta
IPFS:        Helia (TypeScript) ou Kubo (Go) embedado
Build:       reproduzível (lockfiles + Tauri config)
```

Cliente nativo reusa 100% do React do PWA — Tauri serve a mesma SPA.
Os módulos nativos (Tor, WebRTC, IPFS) ficam em Rust e são expostos
para o React via Tauri commands.

### 3.3 Camadas de Dados
```
Log imutável:      Nostr (identidade + eventos + broadcast)
Indexação local:   SQLite WASM via @sqlite.org/sqlite-wasm (OPFS)
Fallback:          IndexedDB (Safari < 17)
Optimistic UI:     React useState — descartável, nunca persiste
Upload imagens:    nostr.build (clearnet) / nó IPFS local (Fase 6)
Pin de viralizado: IPFS / Arweave (Fase 6)
```

### 3.4 Segurança
```
Identidade:  secp256k1 (padrão Nostr) — gerado localmente, nunca transmitido
Assinatura:  Schnorr — todo evento verificável por qualquer cliente
Conteúdo:    sem scan automático no cliente oficial padrão (manifesto §25);
             auto-classificação voluntária pelo autor + filtros locais
             opt-in pelo leitor (manifesto §27); moderação comunitária
             reativa via reports + threshold dinâmico (manifesto §26, Fase 4)
Tor:         arti (Fase 6) — modo paranoia opcional
Anonimato:   sem login real-world, multi-identidade, location off-default
```

### 3.5 Deploy e Custo
```
Frontend:    Vercel (gratuito) + GitHub Releases (APK) + F-Droid (Fase 6)
Cliente nat: Tauri build pra macOS/Windows/Linux (Fase 6)
Relays:      Públicos gratuitos + auto-hospedagem documentada
Domínio:     ~R$40/ano (não-essencial após distribuição)
Pin IPFS:    custo variável por viralidade — modelo de doações (Fase 6)
Custo fixo:  ~R$0/mês até massa crítica
```

### 3.6 Por que SQLite WASM e não IndexedDB

Notion migrou e teve 20% de melhoria. Queries SQL com índices reais vs key-value manual. Fallback IndexedDB para Safari < 17. SQLite roda em Web Worker para não travar a UI.

---

## 4. ARQUITETURA EM CAMADAS

```
┌─────────────────────────────────────────────────────────┐
│                  CLIENTE DRIFT (UI)                     │
│   FeedScreen · PostViewer · CreatePost · SpreadMap     │
│   optimistic state (React useState) — descartável      │
└────────────────────────┬────────────────────────────────┘
                         │ Zustand stores
┌────────────────────────▼────────────────────────────────┐
│                 CAMADA DE NEGÓCIO                       │
│  calculateScore() · calculateWeight() · getMaxSubposts()│
│  applyContentFilters() · processReport() (Fase 4)      │
│  evictOldPosts() (Fase 4) — respeita spreads           │
│  → funções puras (sem scan automático — manifesto §25) │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│            PROTOCOLO DRIFT (NIPs Nostr)                 │
│  createPost() k:9078  · spreadPost() k:9079            │
│  buryPost() k:9080    · reportPost() k:9081            │
│  → valida schema · assina com nsec · agnóstico a relay │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│            CAMADA DE TRANSPORTE (§32)                   │
│   wss.ts (clearnet) · tor.ts (Fase 6)                  │
│   webrtc.ts (Fase 6) · bundle.ts (export QR — Fase 6)  │
│   → API uniforme: publish() / subscribe() / health()   │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                      NOSTR                              │
│  Identidade: npub/nsec (secp256k1)                     │
│  Eventos: imutáveis, assinados, verificáveis           │
│  Broadcast: relays públicos + .onion + WebRTC peers    │
└──────────────┬──────────────────────────────────────────┘
               │ onNostrEvent() — único ponto de escrita
┌──────────────▼──────────────────────────────────────────┐
│              SQLite WASM (OPFS)                         │
│  posts · events · scores · spreads · users · sync_log  │
│  → Web Worker · fallback IndexedDB                     │
└─────────────────────────────────────────────────────────┘
```

### Regra Fundamental de Fluxo de Dados

```
ESCRITA:  UI → Negócio → Protocolo → Transporte → Nostr → onNostrEvent() → SQLite
LEITURA:  UI ← Zustand store ← SQLite (atualizada por invalidateFeed)
OTIMISMO: UI ← React state local (descartado quando SQLite confirma)
```

---

## 5. IDENTIDADE E AUTENTICAÇÃO

### 5.1 Geração (secp256k1 — padrão Nostr)

```typescript
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

async function createIdentity(): Promise<DriftIdentity> {
  const nsec = generateSecretKey()
  const npub = getPublicKey(nsec)

  await db.run(
    `INSERT INTO identity (npub, nsec_encrypted, created_at) VALUES (?, ?, ?)`,
    [npub, await encrypt(bytesToHex(nsec)), Date.now()]
  )

  return { /* ... */ }
}
```

### 5.2 Assinatura

```typescript
import { finalizeEvent } from 'nostr-tools/pure'

async function signDriftEvent(template: NostrEventTemplate): Promise<SignedEvent> {
  const identity = await getOrCreateIdentity()
  return finalizeEvent(
    { ...template, created_at: Math.floor(Date.now() / 1000) },
    nsecHexToBytes(identity.nsec)
  )
}
```

### 5.3 Modos de Identidade

| Modo | Publica | Visível |
|------|---------|---------|
| Anônimo (default) | Nada além do npub | Hash truncado |
| Semi-anônimo | kind:0 com alias | Alias |
| Identificado (escolha do user) | kind:0 com nome + avatar | Nome + avatar |

**Importante:** o cliente nunca obriga o usuário a se identificar. Se
o usuário publica seu nome real voluntariamente, é decisão dele e
direito dele.

### 5.4 Portabilidade — Identidade ≠ Dispositivo

A identidade Drift é o nsec1, não o aparelho. Os 32 bytes secp256k1
são a única fronteira entre "ainda sou eu" e "outra pessoa".

**Descartável (cache local):**
- SQLite OPFS (posts, spreads, buries, sync_log)
- master key AES-GCM no IndexedDB
- identity row no SQLite

**Permanente:**
- nsec1 (32 bytes secp256k1)

API local em `src/lib/identity.ts`:

```typescript
export async function exportIdentity(): Promise<DriftIdentity>
export async function setIdentityFromNsec(nsec1: string): Promise<DriftIdentity>
export async function resetIdentity(): Promise<void>
```

Rebuild de histórico em `src/lib/sync.ts`:

```typescript
export async function rebuildIdentityHistory(npub: string): Promise<void>
```

UX em `src/components/Identity/IdentityPanel.tsx`:
- **Backup** — npub público + nsec privado revelável + QR + copiar
- **Importar** — textarea, validação, confirm() destrutivo, rebuild

**Regra dura:** toda ação destrutiva à identidade (reset, import) deve
oferecer export antes. Recovery automático em caso de master key
dessincronizada faz log explícito + reset.

### 5.5 Múltiplas Identidades (Fase 5)

Usuário pode ter N identidades simultâneas no mesmo dispositivo.
Útil para anti-perseguição (uma identidade pública, outra para
tópicos sensíveis), e para compartimentalizar contextos.

Schema: tabela `identities` substitui `identity` (singular). Active
identity stored in `user_prefs`. Switch de identidade exige confirm
+ oferta de export da anterior. UX em `components/Identity/Switcher`.

---

## 6. PROTOCOLO DRIFT — NIPs

```typescript
export const DRIFT_KIND = {
  POST:   9078,  // post com subposts (regular event imutável)
  SPREAD: 9079,  // espalhamento (swipe up)
  BURY:   9080,  // enterro (swipe down)
  REPORT: 9081,  // report de moderação
} as const

// Reservados para fases futuras (não implementar até manifesto bumpar):
// 9082 — boost pago, se vier (manifesto §18)
// 9083+ — TBD conforme features
```

Os 4 kinds são **regular events** (faixa 1..9999): imutáveis no relay,
sem dedup por d-tag. Para o porquê, ver §30.6.

### PostEvent (kind: 9078)
```typescript
{
  kind: 9078,
  tags: [
    ['d', postId],
    ['drift-version', '1'],              // obrigatória
    ['client', 'drift-official'],        // informativa, não privilegiada
    ['category', categoria]?,
    ['location', lat, lng, city, country]?,  // off-default na Fase 3
  ],
  content: JSON.stringify({ subposts: Subpost[] }),
}
```

### SpreadEvent (kind: 9079)
```typescript
{ kind: 9079, tags: [['e', postId], ['p', authorNpub], ['location', ...]?], content: '' }
```

### BuryEvent (kind: 9080)
```typescript
{ kind: 9080, tags: [['e', postId]], content: '' }
// sem 'p' — enterro é silencioso, não notifica o autor
// sem 'reason' — não precisa justificar
```

### ReportEvent (kind: 9081)
```typescript
{ kind: 9081, tags: [['e', postId], ['p', authorNpub], ['reason', 'illegal'|'spam'|'harassment']], content: '' }
```

---

## 7. HANDLER DETERMINÍSTICO — onNostrEvent()

Único ponto onde eventos Nostr se tornam estado local.

A ordem das verificações é importante para performance: descarta cedo o
que pode ser descartado barato; só roda `verifyEvent` (~1ms/evento)
em eventos que vão ser persistidos.

```typescript
async function onNostrEvent(event: SignedEvent) {
  // 1. Cheap: kind check (Set lookup)
  if (!DRIFT_KIND_SET.has(event.kind)) return

  // 2. Cheap: schema check (tag lookup, JSON.parse só para POST)
  if (!passesSchemaCheck(event)) return

  // 3. Caro: verify Schnorr — só agora
  if (!verifySignature(event)) return

  // 4. Persiste
  switch (event.kind) {
    case DRIFT_KIND.POST:
      await db.run(`INSERT OR IGNORE INTO posts (...) VALUES (?)`, [...])
      scheduleScoreRecalc(getTag(event,'d')!)
      invalidateFeed()
      break
    case DRIFT_KIND.SPREAD:
      await db.run(`INSERT OR IGNORE INTO spreads (...) VALUES (?)`, [...])
      scheduleScoreRecalc(getTag(event,'e')!)
      break
    case DRIFT_KIND.BURY:
      await db.run(`INSERT OR IGNORE INTO buries (...) VALUES (?)`, [...])
      scheduleScoreRecalc(getTag(event,'e')!)
      break
    case DRIFT_KIND.REPORT:
      await processReport(event)
      break
  }
}
```

`scheduleScoreRecalc` faz debounce de 100ms por postId — em rajadas
(50 spreads num post viral chegando juntos), recalcula 1 vez no fim.

`invalidateFeed()` faz debounce de 150ms — re-query do SQLite e
atualização da `useFeedStore` (Zustand). UI re-renderiza sozinha.

---

## 8. CÁLCULO DE SCORE (FUNÇÃO PURA)

```typescript
function calculateScore(input: { spreads: number, buries: number, createdAt: number, now: number }): number {
  const ageHours      = Math.max(0, (input.now - input.createdAt) / 3600)
  const netEngagement = input.spreads - (input.buries * 0.3)
  return netEngagement / Math.pow(ageHours + 2, 1.5)
}

async function recalculateScore(postId: string) {
  const row = await db.get(`
    SELECT
      p.created_at,
      (SELECT COUNT(*) FROM spreads WHERE post_id = p.id) AS spreads,
      (SELECT COUNT(*) FROM buries  WHERE post_id = p.id) AS buries
    FROM posts p
    WHERE p.id = ?
  `, [postId])
  if (!row) return

  const score = calculateScoreNow(row.spreads, row.buries, row.created_at)
  await db.run(`UPDATE posts SET score = ?, spreads = ?, buries = ? WHERE id = ?`,
    [score, row.spreads, row.buries, postId])
}
```

---

## 9. SISTEMA DE PESO DO PERFIL

```typescript
function calculateAntiquity(createdAt: number): number {
  const weeks = (Date.now() - createdAt) / (7 * 24 * 3_600_000)
  return Math.min(40, weeks)
}

const ENGAGEMENT_POINTS = {
  POST_SPREAD:      +10,
  COMMENT_RECEIVED: +1,
  POST_BURIED:       0,   // bury NÃO penaliza
  REPORT_CONFIRMED: -15,
  DAILY_INACTIVE:   -1,
}

function getMaxSubposts(weight: number): number {
  if (weight < 20) return 1
  if (weight < 40) return 2
  if (weight < 55) return 4
  if (weight < 70) return 6
  if (weight < 85) return 7
  return 8
}
```

---

## 10. SISTEMA DE MODERAÇÃO

```typescript
async function getReportThreshold(): Promise<number> {
  const { count } = await db.get(
    `SELECT COUNT(*) as count FROM users WHERE last_active > ?`,
    [Date.now() / 1000 - 30 * 86400]
  )
  return Math.max(5, Math.floor(count * 0.001))
}

function getReportWeight(userWeight: number): number {
  if (userWeight < 20) return 0.5
  if (userWeight < 50) return 1.0
  if (userWeight < 75) return 1.5
  return 2.0
}
```

Score = -999 esconde do feed. **Nunca apaga do SQLite local.** O
evento permanece nos relays. Cliente alternativo pode exibir.

---

## 11. SQLite WASM — SCHEMA

Schema em `src/lib/schema.sql`. Tabelas:

- `identities` — chaves locais (Fase 5: multi). Antes: `identity`.
- `posts` — eventos kind 9078 materializados
- `spreads`, `buries`, `reports` — ações com unique(post_id, ator_pub)
- `users` — perfis agregados
- `follows` — grafo social (camada de visualização local, não ranking)
- `relays_user` — relays adicionados pelo usuário (Fase 5)
- `sync_log` — cursor por (relay, namespace)
- `user_prefs` — flags locais
- `pinned` — eventos que o user se compromete a re-broadcast / seedear (Fase 5)

Índices em `posts(score DESC)`, `posts(category)`, `posts(author_pub)`,
`spreads(post_id)`.

---

## 12. SINCRONIZAÇÃO NOSTR → SQLite

```typescript
async function startSync() {
  const { since } = await db.get(`SELECT MAX(last_since) as since FROM sync_log`) ?? { since: 0 }

  pool.subscribeMany(activeRelays(),
    [{ kinds: [9078, 9079, 9080, 9081], since: since ?? 0 }],
    {
      onevent: async (event) => { await onNostrEvent(event) }
    }
  )
}
```

`activeRelays()` retorna seed list + relays adicionados pelo user
(Fase 5) + relays descobertos via NIP-65 (Fase 5) + pelo menos 1
relay aleatório fora da lista preferida (anti-eclipse, Fase 5).

Janela inicial de 24h evita puxar todo o histórico no primeiro boot.
Cursor persistido a cada 30s em `sync_log`.

`rebuildIdentityHistory(npub)` — subscribe paralelo, sem janela,
filtrado por author. Detalhes em §5.4.

`rebroadcastOpportunistic()` (Fase 5) — quando conecta a relay novo
e ele não tem o evento, republica. Detalhes em §33.

---

## 13. FEED QUERY

```typescript
async function getGlobalFeed(limit = 50): Promise<Post[]> {
  // SELECT ... WHERE score > -999 ORDER BY score DESC, created_at DESC, id ASC
}
```

`score = -999` é flag de moderação aplicada — post some do feed mas
**continua no banco e na rede Nostr.** Cliente NÃO deleta.

Ranking é função pura sem inputs personalizados — qualquer cliente
Drift mostra a mesma ordem global. Sem afinidade. Sem "para você".
Ver manifesto §24.

Filtragem por bloqueio/silenciamento (Fase 5) é camada de
visualização, aplicada APÓS a query, sem mudar score.

---

## 14. AUTO-CLASSIFICAÇÃO + FILTROS LOCAIS

Manifesto §25 (Sem Scan Automático Obrigatório) + §27 (Auto-Classificação
Voluntária). Cliente oficial padrão NÃO faz scan automático nem
classificação ML embutida. Substituído por: autor declara,
leitor filtra.

### 14.1 Tag `content-warning` (autor declara)

```typescript
// kind: 9078 (POST) — tag opcional
// valores enumerados: 'nsfw' | 'violence' | 'spoiler' | 'ad'
//                  ou string livre (cliente oficial só renderiza os 4 acima)
{
  kind: 9078,
  tags: [
    ['d', postId],
    ['drift-version', '1'],
    ['client', 'drift-official'],
    ['content-warning', 'nsfw'],   // opcional
    // ...outras tags
  ],
  content: JSON.stringify({ subposts }),
}
```

UI de criação (`SubpostEditor`): checkboxes "marcar como NSFW",
"marcar como spoiler", "violência", "anúncio". Persistência da
escolha do user em `user_prefs` (default `false` por categoria —
não-marcação é o caminho mais leve).

### 14.2 Filtros Locais (leitor escolhe)

```typescript
// user_prefs (key/value local — nunca sai do device)
{
  show_nsfw_default: false,    // default: blur posts marcados nsfw
  hide_spoilers: true,         // default: esconde spoilers até clicar
  hide_ads: false,             // default: mostra anúncios marcados
  // location_granularity já existe pra §28
}

// feed.ts — aplica filtros NA RENDERIZAÇÃO, não na query
// (mantém §24 — score determinístico, sem afinidade)
function applyContentFilters(post: Post, prefs: UserPrefs): RenderHint {
  const cw = post.tags.find(t => t[0] === 'content-warning')?.[1]
  if (cw === 'nsfw' && !prefs.show_nsfw_default) return { blur: true, reveal: 'tap' }
  if (cw === 'spoiler' && prefs.hide_spoilers)   return { hide: true, reveal: 'tap' }
  if (cw === 'ad' && prefs.hide_ads)             return { hide: true }
  return { blur: false, hide: false }
}
```

### 14.3 Por quê "voluntária + local" e não "scan automático"

- **Sem chave mestra disfarçada** (manifesto §17). Scan embutido
  ligado por default = operador do scanner é a chave.
- **Honestidade do autor** — quem postou sabe se é NSFW. Tag é o
  sinal honesto.
- **Comunidade reforça** — quem posta NSFW sem marcar é reportado
  com `reason='nsfw-unmarked'` (manifesto §26, Fase 4).
- **Filtro local não afeta ranking** — mantém §24 (score
  determinístico igual entre clientes).
- **Plugin opt-in OFF-by-default permitido** (manifesto §25 v2.2)
  — clientes alternativos / plugins podem oferecer scan, mas nunca
  impor. Cliente oficial padrão MVP/Fase 3 não inclui.

### 14.4 Conteúdo Ilegal

Moderação reativa via §26 (reports + threshold). Categoria
`reason='illegal'` aciona threshold mais agressivo (menos reports
necessários pra esconder do feed default). UI específica de denúncia
a autoridades competentes (NCMEC, SaferNet) entra na Fase 4. Cliente
oficial NÃO impede tecnicamente publicação — não tem capacidade
arquitetural pra isso (§17), e qualquer scanner que tivesse seria
chave mestra. Detalhes em manifesto "Nota Legal e de Responsabilidade".

---

## 15. CACHE — FIFO COM PESO

```typescript
async function evictOldPosts() {
  // posts espalhados pelo usuário NUNCA são removidos
  // posts pinados (Fase 5) NUNCA são removidos
  // os outros caem por menor score quando ultrapassa 10k
}
```

Manifesto §16: posts espalhados não saem do cache. Quem espalhou
seedeia. Disponibilidade distribuída via mecânica social.

---

## 16. ESTRUTURA DE ARQUIVOS

```
drift/
├── public/
├── src/
│   ├── components/   Identity/ Feed/ Post/ Create/ Profile/ Onboarding/ UI/ Relay/
│   ├── hooks/        useFeed · usePost · useCreate · useIdentity · useWeight · useSpreadMap
│   ├── lib/
│   │   ├── nostr.ts          pool, signDriftEvent, verifyDriftEvent, publishToRelays
│   │   ├── db.ts / db.worker.ts / schema.sql
│   │   ├── identity.ts       getOrCreateIdentity, setIdentityFromNsec, resetIdentity, exportIdentity
│   │   ├── identities.ts     multi-identidade (Fase 5)
│   │   ├── crypto.ts         encrypt/decrypt, resetMasterKey
│   │   ├── bootstrap.ts      useBootStore + startBoot
│   │   ├── events.ts         onNostrEvent — única porta SQLite domínio + invalidateFeed
│   │   ├── protocol.ts       createPost, spreadPost, buryPost, reportPost
│   │   ├── sync.ts           startSync + rebuildIdentityHistory + useSyncStore
│   │   ├── feed.ts           getGlobalFeed + useFeedStore + invalidateFeed
│   │   ├── scoring.ts        calculateScore (pura)
│   │   ├── transport/        abstração de transporte (Fase 6)
│   │   │   ├── index.ts      interface Transport
│   │   │   ├── wss.ts        WSS clearnet (atual)
│   │   │   ├── tor.ts        WSS via Tor (Fase 6)
│   │   │   ├── webrtc.ts     P2P direto (Fase 6)
│   │   │   └── bundle.ts     export/import de eventos via QR/JSON (Fase 6)
│   │   ├── relays.ts         gerenciamento dinâmico (Fase 5) — store + CRUD + activeRelays
│   │   ├── rebroadcast.ts    re-broadcast oportunista (Fase 5) — manifesto §16
│   │   ├── probe.ts          probe anti-eclipse periódico (Fase 5) — manifesto §20
│   │   ├── nip65.ts          NIP-65 publish/parse de relay list (Fase 5)
│   │   ├── follows.ts        NIP-02 (kind 3) follows + store (Fase 5)
│   │   ├── identities.ts     multi-identidade CRUD + active (Fase 5) — manifesto §4
│   │   ├── moderation-local.ts  block/mute local (Fase 5) — manifesto §24
│   │   ├── bip39.ts          NIP-06 derivação de nsec via 12 palavras (Fase 5)
│   │   ├── passkey.ts        WebAuthn gate opt-in (Fase 5)
│   │   ├── upload.ts         nostr.build retry+jitter (Fase 3)
│   │   ├── weight.ts         peso de perfil + bridge SQLite (Fase 4)
│   │   ├── moderation.ts     reports + threshold dinâmico (Fase 4) — manifesto §26
│   │   ├── cache.ts          eviction respeita spreads + pinned (Fase 4) — manifesto §16
│   │   ├── pin.ts            IPFS pin de posts virais (Fase 6)
│   ├── types/        drift.ts, nostr.ts
│   └── config/       constants.ts, relays.ts (seed)
├── src-tauri/        cliente nativo (Fase 6)
│   ├── src/          Rust: tor, webrtc, ipfs bindings
│   └── tauri.conf.json
├── Docs/
│   ├── manifesto.md
│   ├── drift-arquitetura-v4.md
│   └── drift-fluxograma-v4.html
├── CLAUDE.md
├── vite.config.ts · tailwind.config.js · tsconfig.json · package.json
```

---

## 17. DEPENDÊNCIAS

### Cliente Web (MVP — Fase 5)

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "nostr-tools": "^2.7.0",
    "@sqlite.org/sqlite-wasm": "3.51.2-build9",
    "framer-motion": "^11.0.0",
    "maplibre-gl": "^4.0.0",
    "@deck.gl/core": "^9.0.0",
    "@deck.gl/layers": "^9.0.0",
    "qrcode": "^1.5.4",
    "workbox-window": "^7.0.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5",
    "@vitejs/plugin-basic-ssl": "^1.1.0",
    "vite-plugin-pwa": "^0.20.0"
  }
}
```

### Cliente Nativo (Fase 6 — additivo)

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri = "2.x"
arti-client = "0.x"          # Tor embedado
libp2p = "0.x"               # WebRTC P2P
helia / kubo                 # IPFS embedado (decisão na Fase 6)
```

---

## 18. VARIÁVEIS DE AMBIENTE

```env
# Mapa usa MapLibre GL + tiles CARTO Dark Matter (OSS, OSM-derived, sem API key).
# Não há token de mapa no cliente oficial — manifesto §17 (sem dependência crítica de fornecedor proprietário).
VITE_APP_VERSION=0.1.0

# Fase 6 (cliente nativo):
DRIFT_TOR_ENABLED=auto       # auto | always | never
DRIFT_IPFS_PIN_THRESHOLD=10  # score mínimo pra pin automático
```

Cliente oficial padrão NÃO usa PhotoDNA nem qualquer scanner externo
(manifesto §25). Não há env var pra serviço de scan no cliente
oficial. Plugins opt-in (se vierem) gerenciam suas próprias chaves
fora do default config.

---

## 19. CUSTO OPERACIONAL

| Fase | Custo mensal |
|---|---|
| MVP - Fase 5 | ~R$0 (Vercel + relays públicos + nostr.build + MapLibre/CARTO OSS, sem cobrança) |
| Fase 6 (cliente nativo) | ~R$0 fixo + IPFS pin variável conforme viralidade |

Pin de posts virais em IPFS pode crescer com escala. Modelo de custeio:
doações via Open Collective + Premium pessoal (manifesto §Monetização
da arquitetura, §26).

---

## 20. RESISTÊNCIA À CENSURA — Tabela de Adversários

| Vetor | Mitigação MVP | Mitigação Fase 6 |
|---|---|---|
| Remoção das app stores | APK direto + PWA | + F-Droid + sideload doc |
| Derrubada do domínio principal | PWA service worker offline | + APK independente + app já instalado |
| Bloqueio DNS dos relays | n/a (usa IP via WS) | + Tor (.onion bypass DNS) |
| Bloqueio SNI/DPI dos relays clearnet | Múltiplos relays | + Tor + WebRTC |
| Bloqueio de WebSocket | parcial (alguns relays HTTP polling) | + Tor + WebRTC ICE |
| Ordem judicial ao fundador | MIT, código já distribuído | + Build reproduzível |
| Apagar eventos Nostr | Imutável + replicado em N relays | + Re-broadcast + IPFS pin |
| Confisco de dispositivo | Identidade portável | + multi-identidade |
| Eclipse attack (relays maliciosos) | Múltiplos seed relays | + probe + relay aleatório |
| Confisco do operador de relay | Múltiplos relays + clientes guardam | + IPFS pin durabilidade |
| Sybil flooding (botnet) | Score + reports | + threshold dinâmico + (opt) PoW |
| Deanonymization por IP | n/a | + Tor obrigatório em modo paranoia |
| Deanonymization por timing | n/a | + Tor + jitter opcional |
| Deanonymization por location tag | location off-default | (mesmo) |

§31 detalha a estratégia anti-Estado-nação.

---

## 21. ROADMAP DE IMPLEMENTAÇÃO

### Fase 1 — Fundação ✅
1. Setup Vite + React + TypeScript + Tailwind
2. SQLite WASM — setup, schema, Web Worker
3. Identidade Nostr — gerar, salvar, carregar
4. Conexão com relays — SimplePool, publish, subscribe

### Fase 2 — Protocolo ✅
5. NIPs Drift — kinds 9078..9081, schema, validação
6. onNostrEvent() — handler determinístico, verify lazy
7. Publicar e receber posts (texto)
8. Feed lendo do SQLite com score
9. Spread / Bury via UI

### Fase 2.5 — Portabilidade de Identidade ✅
10. `exportIdentity()`, `setIdentityFromNsec()`, `resetIdentity()`
11. `rebuildIdentityHistory(npub)` — subscribe sem janela
12. `IdentityPanel` — modal Backup (QR + nsec1) e Importar
13. Botão "chave" no header
14. Recovery automático em caso de master key dessincronizada

### Refactor Zustand ✅
- `useBootStore`, `useSyncStore`, `useFeedStore` — sem poll

### Fase 3 — Mecânica Central
15. Refactor `lib/transport/` (extrai WSS de nostr.ts atrás de interface uniforme — prepara Fase 6)
16. Swipe vertical real (Framer Motion)
17. Swipe horizontal — carousel de subposts
18. Upload imagens — `lib/upload.ts` com retry exponencial + full jitter (sem scan automático — manifesto §25)
19. Tag opcional `content-warning` no kind 9078 (`drift-version`, schema, validação)
20. UI de criação: checkboxes "marcar como NSFW/spoiler/violência/anúncio"
21. UI de feed: blur/hide baseado em `user_prefs` (filtros locais opt-in — manifesto §27)
22. Polimento de optimistic UI
23. Tag `location` opt-in com granularidade `off | country | city | precise` (default `off` — manifesto §28)

### Fase 4 — Features
20. Mapa de espalhamento — MapLibre + Deck.gl
21. Sistema de peso do perfil (`weight.ts`)
22. Moderação — reports e threshold dinâmico (`moderation.ts`)
23. Onboarding overlay
24. Cache eviction respeitando posts espalhados

### Fase 5 — Resiliência e Distribuição
25. PWA — Workbox, manifest, ícones
26. Tela de perfil completa
27. Feed: Seguindo (filtro local) e Trending
28. Fallback IndexedDB completo (Safari < 17)
29. **Múltiplas identidades** + UI de switch + BIP39 opt-in (NIP-06) + Passkey opt-in
30. **Gerenciamento de relays** — UI add/remove, NIP-65 discovery, persistência
31. **Probe anti-eclipse** — verifica que relays entregam eventos conhecidos
32. **Re-broadcast oportunista** — republica posts próprios + espalhados em relays novos
33. **Pinning local** — UI para "fixar" um post (cliente garante re-broadcast e mantém em cache)
34. Bloqueio/silenciamento local (camada de visualização, não ranking)
35. Deploy Vercel + GitHub Releases (APK) + F-Droid

### Fase 6 — Cliente Nativo (Anti-Censura Forte)
36. **Setup Tauri** — desktop (macOS/Windows/Linux) + Android
37. **Camada de transporte abstrata** (`lib/transport/`)
38. **Tor integrado via arti** — modo paranoia opt-in / always-on
39. **WebRTC P2P** — sinalização via Nostr, conexão direta entre clientes
40. **IPFS embarcado (Helia ou Kubo)** — pin automático de posts virais
41. **"Espalhar = seedear"** — cliente nativo seedeia conteúdo espalhado via WebRTC
42. **Run-your-own-relay** — wizard para o user subir um relay local
43. **Export/import de bundle de eventos via QR/JSON** — sneakernet anti-bloqueio total
44. **Build reproduzível** — Tauri lockfiles + CI verificável + assinatura de releases
45. **Documentação anti-censura** — guia público de instalação em país censurado

**Compromisso:** Fase 6 não é opcional. O manifesto §15 (Anti-Censura
por País) e §16 (Disponibilidade Distribuída) só fecham aqui. Se em
algum momento o caminho técnico mostrar inviabilidade, o manifesto
ganha bump explícito com justificativa pública. Não cala, não promete
e não entrega.

---

## 22. NOTAS CRÍTICAS PARA O CLAUDE CODE

- **Sem Gun.js** — descartado §30.1
- **Sem CRDT** — descartado §30.2
- **SQLite roda em Web Worker** — nunca main thread
- **onNostrEvent() é a ÚNICA porta** de escrita em tabelas de domínio
- **Optimistic UI é React state local** — nunca SQLite
- **Funções puras** — `calculateScore` etc. recebem `now` por parâmetro
- **Verify lazy** — kind/schema check ANTES de verifyEvent
- **Recalc com debounce** 100ms via `scheduleScoreRecalc`
- **Feed reativo via Zustand** — `invalidateFeed()`, sem poll
- **Sem scan automático no cliente oficial padrão** — manifesto §25 (sem PhotoDNA, sem ML local de moderação embutido). Auto-classificação voluntária via tag `content-warning` (autor) + filtros locais opt-in (leitor).
- **TypeScript strict** — sem `any`
- **OPFS detection on init** — fallback IndexedDB automático
- **Bootstrap fora do React** — `lib/bootstrap.ts` singleton
- **Identidade portável** — toda ação destrutiva oferece export antes
- **Cliente NÃO deleta** dados moderados (score=-999 esconde, não apaga)
- **Sem afinidade no feed** — score determinístico, sem personalização
- **Sem chave mestra** — não escrever `deletePost()` ou `banUser()` global
- **MIT no primeiro commit** — antes de qualquer código público
- **Build reproduzível** Fase 6 — lockfiles + CI verificável

---

## 23. UX E FLUXOS DE TELAS

### 23.1 Estrutura de Navegação

```
App
├── Feed (tela principal)
│    └── Aba: Global · Seguindo · Categorias · Trending
├── Criar Post (editor de subposts, drag-drop, preview)
├── Busca por categoria (apenas peso médio+)
├── Perfil (posts, peso, seguidores, engajamento)
├── Identidade (modal — backup nsec1 + QR, importar nsec1)
├── Relays (Fase 5 — add/remove, NIP-65 discovery, status)
├── Modo Tor (Fase 6 — toggle paranoia)
└── Configurações (alias, avatar, location off-default, categorias)
```

### 23.2 Tela de Post (Tela Cheia)

```
▓▓▓▓▓▓░░░  2/3       ← barra de progresso (subposts)
   conteúdo do subpost atual
@alias · 2h · 🏷️tech · [🗺️]

  ↑ swipe up    = espalha o POST INTEIRO
  ↓ swipe down  = enterra o POST INTEIRO
  ← swipe left  = próximo subpost
  → swipe right = subpost anterior
```

### 23.3 Onboarding

Aparece uma única vez. Persiste em `user_prefs` com
`key='onboarding_done'`.

### 23.4 Mapa de Espalhamento

Botão 🗺️. Animação automática de ~30s mostrando propagação geográfica
via MapLibre + Deck.gl ArcLayer. Só posts com tags `location` aparecem
no mapa.

### 23.5 Modal de Identidade

- **Backup** — npub público + nsec privado oculto. Revelar mostra
  texto + QR code + copiar.
- **Importar** — textarea, validação, confirm() destrutivo, rebuild,
  reload.

### 23.6 Tela de Relays (Fase 5)

```
Relays ativos:
  ✓ wss://relay.damus.io       45ms · 234 ev
  ✓ wss://nos.lol              78ms · 189 ev
  ✗ wss://relay.nostr.band     timeout
  ✓ wss://meu-relay.com (user) 12ms · 0 ev (próprio)

[+ adicionar relay]  [importar via NIP-65]
```

### 23.7 Modo Tor (Fase 6)

Toggle no Settings: `[Off] [Auto] [Always]`.

- **Off** — só clearnet
- **Auto** — tenta clearnet primeiro, faz fallback para Tor se
  bloqueado
- **Always** — só Tor (paranoia)

Quando Tor está ativo, banner sutil no topo: "🧅 modo Tor".

---

## 24. CLIENTES OFICIAIS E ALTERNATIVOS

Posts do cliente oficial carregam `['client', 'drift-official']` e
`['drift-version', '1']`.

```typescript
function isOfficialClient(event: SignedEvent): boolean {
  return getTag(event, 'client') === 'drift-official'
    && getTag(event, 'drift-version') !== null
    && verifySignature(event)
}
```

| | Cliente Oficial Padrão | Cliente Alternativo / Plugin opt-in |
|--|----------------|-------------------|
| Badge `drift-official` | ✅ | ❌ |
| Scan automático embutido | ❌ (manifesto §25) | Possível como opt-in OFF-by-default |
| Auto-classificação `content-warning` (§27) | ✅ render | Decisão deles |
| Schema Drift validado | ✅ | Pode variar |
| Acesso à rede Nostr | ✅ | ✅ igual |
| **Poder sobre a rede** | ❌ | ❌ igual |

A identidade do usuário é compartilhada entre clientes — o nsec1
funciona em qualquer cliente Nostr (Damus, Snort, Coracle, Iris) e
em qualquer cliente Drift alternativo.

---

## 25. VÍDEOS CURTOS (ROADMAP v2)

Vídeos não entram no MVP. Solução: Livepeer (transcodificação
descentralizada). Limite de 30s no cliente oficial. Modelo de seeding
pelos próprios usuários alinha com §16 do manifesto: quem espalha
vira seeder automático (também via WebRTC na Fase 6).

---

## 26. MONETIZAÇÃO

**Compatíveis** (não comprometem manifesto):
- Premium pessoal (analytics do próprio post, mais subposts, badge)
- API para devs (acesso a infraestrutura premium — relays dedicados,
  indexação avançada — para cliente alternativos pagantes)
- Boost com teto (post ganha empurrão inicial, comunidade decide
  destino) — implementado como evento Nostr público (kind 9082, se
  vier), não algoritmo oculto
- Doações Open Collective com transparência total
- Dados agregados anônimos (tendências por região/categoria — nunca
  individuais)

**Incompatíveis** (nunca implementar):
- Venda de dados individuais
- Boost ilimitado pago (pay-to-win mata o algoritmo humano)
- Algoritmo secreto paralelo (manifesto §24)
- Anúncios direcionados (requer coleta incompatível com anonimato)
- Acesso premium à rede (manifesto §18)

---

## 27. ESTRATÉGIA DE LANÇAMENTO

Vídeo-isca: criar post interno, pedir 20-30 pessoas em países
diferentes para espalhar, gravar o mapa animado. Publicar no
Twitter/X e Reddit com legenda explicando o algoritmo humano.

Comunidades-alvo: Hacker News (Show HN), r/privacy, r/brasil
(nostalgia do Plag), Twitter/X comunidade Nostr, F-Droid.

Pós Fase 6: tutorial público de instalação em país censurado em
github.com/drift/anti-censorship-guide.

---

## 28. TIPOS TYPESCRIPT COMPLETOS

```typescript
export interface DriftIdentity {
  nsec: string           // hex — NUNCA transmitida
  npub: string           // hex
  nsecBech32: string     // nsec1...
  npubBech32: string     // npub1...
  createdAt: number      // ms
}

export interface SignedEvent {
  id: string; pubkey: string; created_at: number; kind: number
  tags: string[][]; content: string; sig: string
}

export interface Subpost {
  id: string
  type: 'text' | 'image' | 'text+image'
  text: string | null    // máx 280 chars
  imageUrl: string | null
  order: number
}

export interface Post {
  id: string; authorPub: string; content: string; subposts: Subpost[]
  createdAt: number; category: string | null; location: GeoPoint | null
  client: string | null; score: number; spreads: number; buries: number
}

export interface GeoPoint { lat: number; lng: number; city: string; country: string }

// Fase 6 — Transporte abstrato
export interface Transport {
  publish(event: SignedEvent): Promise<void>
  subscribe(filter: Filter, onEvent: (e: SignedEvent) => void): Unsubscribe
  health(): Promise<{ ok: boolean; latencyMs: number }>
  kind: 'wss' | 'tor' | 'webrtc' | 'bundle'
}

export const DRIFT_KIND = {
  POST:   9078,
  SPREAD: 9079,
  BURY:   9080,
  REPORT: 9081,
} as const

export const DRIFT_KIND_SET: ReadonlySet<number> = new Set(Object.values(DRIFT_KIND))

export const SCORE_RECALC_DEBOUNCE_MS = 100
export const FEED_INVALIDATE_DEBOUNCE_MS = 150

export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
] as const
```

---

## 29. SETUP INICIAL DO PROJETO

```bash
npm create vite@latest drift -- --template react-ts
cd drift
npm install nostr-tools "@sqlite.org/sqlite-wasm@3.51.2-build9" framer-motion \
  maplibre-gl @deck.gl/core @deck.gl/layers qrcode workbox-window zustand
npm install -D tailwindcss autoprefixer postcss vite-plugin-pwa \
  @vitejs/plugin-basic-ssl @types/qrcode
npx tailwindcss init -p
```

### vite.config.ts (essencial)

```typescript
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl(), VitePWA({ /* ... */ })],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: {
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: { format: 'es' },
})
```

Sem esses headers, `crossOriginIsolated === false` e SQLite WASM com
OPFS falha. `basicSsl()` + `host: true` permitem cel via rede local.

---

## 30. DECISÕES DE DESIGN — REGISTRO HISTÓRICO

### 30.1 Gun.js — Avaliado e Descartado (Abril 2026)

Removido. Duplicava responsabilidades já melhor resolvidas
(distribuição → relays, estado → event sourcing, tempo real →
optimistic UI, persistência → eventos imutáveis, queries → SQLite).

### 30.2 CRDT (Automerge/Yjs) — Avaliado e Descartado (Abril 2026)

CRDTs resolvem edições concorrentes. Drift não tem edições — tem
eventos imutáveis derivados.

### 30.3 Nostr como Transporte Primário — Adotado (Abril 2026)

secp256k1 portável, eventos imutáveis e auditáveis, relays públicos
gratuitos, custo zero. Na Fase 6, Tor + WebRTC se somam (não
substituem) — mesmo formato de evento, transportes intercambiáveis.

### 30.4 SQLite WASM vs IndexedDB — SQLite (Abril 2026)

Notion migrou e teve 20% de melhoria. Queries SQL com índices reais.
Fallback IndexedDB para Safari < 17.

### 30.5 1 Subpost no MVP (Abril 2026)

Começar com 1 subpost. Código suporta até 8. Simplifica criador,
valida swipe.

### 30.6 Kinds 9078..9081 (regular events) — Abril 2026

Mover de `30078..30081` (parameterized replaceable) para
`9078..9081` (regular events).

**Motivos:** colisão com NIP-78 em 30078; SPREAD/BURY/REPORT sem
d-tag seriam dedupados por relays parameterized; faixa 9000..9999
está livre; regular events combinam com filosofia imutável.

**Otimizações concomitantes:** verify lazy, recalc debounced 100ms,
query consolidada de score em 1 round-trip.

### 30.7 Inicialização Robusta do Worker SQLite — Abril 2026

`initDb()` com timeout 10s + propaga `worker.onerror`/`onmessageerror`.
Bootstrap em `lib/bootstrap.ts` como singleton fora do React (StrictMode
quebra useEffect em dev).

### 30.8 Portabilidade de Identidade — Fase 2.5 — Abril 2026

`exportIdentity` + `setIdentityFromNsec` + `rebuildIdentityHistory`.
Identidade tem que ser portável antes do user publicar conteúdo
significativo (Fase 3). Recovery automático em caso de master key
dessincronizada. nsec1 padrão em vez de BIP39 — BIP39 é polimento de
Fase 5.

### 30.9 Manifesto v2.0 e Compromisso de Fase 6 — Abril 2026

**Decisão:** o manifesto deixa de ser aspiracional e vira contrato
vinculante. Anti-censura forte (incluindo Estado-nação), disponibilidade
distribuída, anonimato por design, compatibilidade de ecossistema —
tudo passa a ser entrega obrigatória, com fase explícita.

**Implicação técnica:** cliente PWA por si só não cumpre o manifesto.
Fase 6 introduz cliente nativo Tauri com:
- Tor integrado via arti (anti-bloqueio SNI/DPI nacional)
- WebRTC P2P (anti-bloqueio de WSS clearnet inteiro)
- IPFS embarcado (durabilidade de posts virais sem depender de relay)
- Run-your-own-relay (escala superfície de censura para O(usuários))
- Build reproduzível (anti-coação do fundador via update malicioso)

**Por que isso é compromisso e não roadmap solto:** sem Fase 6, o
manifesto §15 ("Anti-Censura por País") e §16 ("Disponibilidade
Distribuída") são marketing. Com Fase 6, são propriedades verificáveis.

**Custo:** Tauri shell + arti + libp2p + IPFS — todos open-source,
todos com adoção em produção em outros projetos. Não é pesquisa.
É integração.

**Stack alternativo considerado:** browser-only com WebRTC peer-to-peer
e WASM-based onion routing. Descartado: WebRTC em browser exige
servidor de signaling público (vetor de censura), WASM Tor é
imaturo. Cliente nativo é o caminho honesto.

### 30.10 Estado Reativo via Zustand — Abril 2026

`useBootStore`, `useSyncStore`, `useFeedStore`. Substituiu pubsub
manual + poll de 1s. `invalidateFeed()` debounced 150ms é único
caminho de atualização do feed (chamado por `onNostrEvent`).

### 30.11 Sem Scan Automático no Cliente Oficial Padrão — Abril 2026

**Decisão:** cliente oficial padrão Drift não embute scanner
automático (PhotoDNA, modelo NSFW local, blocklist) ligado por
default. Manifesto §25 v2.2.

**Histórico da decisão:**
- v1: arquitetura previa `lib/csam.ts` com PhotoDNA fail-closed
  pré-assinatura (CLAUDE.md invariante #7 antiga)
- v2 (manifesto v2.1): rejeição absoluta — "lib/csam.ts não existe,
  nunca existirá"
- v3 (manifesto v2.2 — atual): refinamento — protocolo não obriga,
  cliente oficial padrão não embute, plugin opt-in OFF-by-default
  é tolerado em outros clientes / plugins, sob restrições estritas

**Por quê o caminho atual:**
- Scanner embutido ligado por default = chave mestra disfarçada
  (operador do scanner decide o que passa) — manifesto §17
- Auto-classificação voluntária do autor (§27) + reports comunitários
  (§26) cobrem a função sem chave mestra
- Plugin opt-in com consent explícito do user é agência do user, não
  poder imposto — distinto do default embutido
- Outros clientes Drift podem implementar políticas próprias —
  manifesto §32

**Implicação técnica:**
- `lib/csam.ts` removido do escopo do cliente oficial padrão MVP/Fase 3
- `lib/upload.ts` (Fase 3) só faz upload sem inspeção
- Tag `content-warning` adicionada ao schema do kind 9078
- `applyContentFilters()` em `feed.ts` aplica blur/hide na renderização
  baseado em `user_prefs` — não muda score (mantém §24)
- UI de criação ganha checkboxes de auto-classificação
- UI de feed respeita filtros locais
- `VITE_PHOTODNA_KEY` removido do `.env.example`

### 30.12 Defesas Anti-Sybil Adaptativo — Dentro do Transport, Não Protocolo Paralelo — Abril 2026

**Decisão:** as defesas contra Sybil adaptativo (random walk
obrigatório, path diversity scoring, cluster detection, limite de
influência) vivem dentro do `lib/transport/webrtc.ts` (Fase 6). Não
viram protocolo paralelo (DDP — Drift Discovery Protocol custom).
Manifesto §20.

**Histórico da decisão:**

Avaliada uma proposta de "Drift Discovery Protocol (DDP)" com
mensagens próprias (`DISCOVER`, `PEER_LIST`, `ORIGIN_REPORT`, etc.),
estado machine de nó (`INIT → DISCOVERING → CONNECTED → ISOLATED`) e
RFC formal. Análise mostrou:

- O **insight central é correto**: diversidade local não basta contra
  Sybil adaptativo com mimicry. Path diversity (caminhos
  independentes) é defesa estrutural mais forte. Random walk
  obrigatório quebra clusters fechados.

- O **vocabulário e o algoritmo são absorvíveis** — bootstrap em
  camadas, expansão obrigatória até diversidade mínima, cluster
  detection, limite de influência por peer. Aplicados em §32.3.1.

- A **proposta de DDP como protocolo paralelo NÃO foi adotada** porque:

  1. **Fragmentaria o ecossistema Nostr** (manifesto §30 —
     compatibilidade preservada). Drift é cidadão do Nostr, não fork.
     Inventar protocolo de discovery custom seria começar a sair do
     ecossistema.

  2. **Já existe NIP-65** (Relay List Metadata) no roadmap §14
     (Fase 5). Resolve a parte de discovery de relays via Nostr
     mesmo, sem inventar tipos de mensagem novos.

  3. **Bootstrap peers como tag em POST kind 9078** foi rejeitado
     como vetor de auto-promoção de operador de relay (tensão sutil
     com manifesto §17 — sem chave mestra). Discovery via NIP-65 é
     evento padrão, não tag em kind do Drift.

  4. **Inverter framing pra "P2P-first, Nostr é fallback"** quebra
     manifesto §11 (Rede como Meio — transportes intercambiáveis,
     nenhum primário). Nostr **é** a rede do Drift; WebRTC/Tor
     **adicionam** caminhos resilientes em Fase 6, não substituem.

**Caminho adotado:**

- `lib/transport/webrtc.ts` (Fase 6) implementa as defesas
  anti-Sybil adaptativo internamente, falando JSON sobre datachannel
  WebRTC. Mensagens de discovery (`DISCOVER`/`PEER_LIST`/etc.) são
  detalhe de implementação do transport, não parte do protocolo
  Drift público (§6). Detalhes em §32.3.1.

- `lib/transport/wss.ts` (atual) ganha probe ativo + cluster
  detection contra relays maliciosos na Fase 5 — mesmas defesas
  aplicadas ao transporte clearnet, no nível possível.

- Tipos de evento Drift (kinds 9078..9081) **não mudam** — sem
  `bootstrap_peers` em POST, sem campo de path diversity em SPREAD.
  O que muda é **como** o cliente descobre e prioriza endpoints,
  não o que ele publica.

**Limite reconhecido (manifesto §20 já registra):** simulação
agressiva contra um RFC formal mostrou que mesmo defesas estruturais
podem ser parcialmente capturadas por adversário com mimicry e
adaptação em tempo real. Resposta correta é assumir adversarial
design como contínuo, não buscar "garantia matemática" — defesas
elevam custo do adversário, não eliminam.

### 30.13 BIP39 (NIP-06) e Passkey como Opt-ins — Abril 2026

**Decisão:** ambas são features Fase 5 da identidade, mas **opt-ins**:
o caminho default continua sendo geração de `nsec` via `generateSecretKey()`
direto + AES-GCM master key auto-gerada. User escolhe ativar BIP39 ou
Passkey explicitamente.

**BIP39 + NIP-06** (`lib/bip39.ts`):
- Usa `@scure/bip39` + `@scure/bip32` (mesmas libs que `nostr-tools`
  internamente). Audited, sem dependências adicionais que não tínhamos.
- Path NIP-06: `m/44'/1237'/0'/0/0`. Compatível com Damus/Snort/Coracle/Iris/Amethyst.
- Tests em `tests/bip39.test.ts` validam contra os 2 vetores oficiais
  do NIP-06 (manifesto §30 — compatibilidade Nostr verificável).

**Passkey via WebAuthn** (`lib/passkey.ts`):
- Gate de unlock local — verifica antes de descriptografar a master key
  no boot. NÃO é identidade — identidade continua sendo o nsec.
- credentialId persistido em `user_prefs.passkey_id`. Boot dispara
  `verifyPasskey()` se habilitado.
- Recovery se device perde acesso ao authenticator: clear-site-data +
  importar nsec1 backup. Documentação no IdentityPanel.

**Por quê opt-in:**
- Default direto preserva UX de baixa fricção pra MVP/onboarding.
- BIP39 adiciona PBKDF2 ~2s no setup; aceitável só pra quem quer.
- Passkey requer hardware/biometria — nem todo device tem; opt-in
  evita criar barreira.
- Manifesto §4: anonimato por design. Quem quer multi-identidade ou
  recovery via 12 palavras tem; quem só quer publicar texto não precisa
  saber que isso existe.

---

## 31. ANTI-CENSURA POR PAÍS — Estratégia Concreta

Cenário-alvo: governo decreta bloqueio nacional do Drift. ISPs
recebem ordem para bloquear domínios e SNIs específicos. App stores
removem o app sob ordem judicial. Adversário com recursos de DPI e
controle de routing.

O Drift tem que continuar acessível em horas, não em dias.

### 31.1 Camadas de Resistência

```
Camada 1 — Disponibilidade do app
   ✓ PWA: bypassa app stores (instala via browser)
   ✓ APK direto: distribuível por qualquer canal (Telegram, USB)
   ✓ F-Droid: store alternativa
   ✓ Cliente nativo Tauri: instala como qualquer programa

Camada 2 — Acesso aos relays
   ✓ Múltiplos relays clearnet (4 default + N adicionados pelo user)
   ✓ Tor + .onion (Fase 6) — bypass de DNS, SNI, DPI
   ✓ WebRTC P2P (Fase 6) — sem servidor central de relay

Camada 3 — Disponibilidade de eventos
   ✓ Relays públicos fora da jurisdição
   ✓ Relays de usuários (auto-hospedagem, Fase 6)
   ✓ IPFS pin de posts virais (Fase 6)
   ✓ Re-broadcast oportunista por clientes (Fase 5)

Camada 4 — Identidade
   ✓ nsec1 portável (Fase 2.5)
   ✓ Multi-identidade (Fase 5) — reduz correlação
   ✓ Anonimato por design — sem login real-world

Camada 5 — Tráfego
   ✓ Tor (Fase 6) — IP do user não vaza pra operador de relay
   ✓ Location off-default (Fase 3)
```

### 31.2 Como Cada Camada Aumenta o Custo do Adversário

| Camada | Sem mitigação | Com mitigação Drift |
|---|---|---|
| Bloquear app | Banir das stores | Tem que perseguir cada GitHub Release, cada APK em circulação |
| Bloquear relay | Bloquear 4 IPs | Tem que perseguir N relays públicos + N relays self-hosted + Tor + WebRTC |
| Confiscar dados | Apagar de 4 servidores | Eventos replicados em N relays + IPFS + clientes locais |
| Identificar usuário | Pedir logs ao app | Sem login real-world, multi-identidade, Tor |

Custo do adversário cresce com **uso real** do Drift. Quanto mais
gente, mais relays, mais nós IPFS, mais difícil bloquear. O
adversário precisaria bloquear toda a internet.

### 31.3 Sneakernet de Último Recurso (Fase 6)

Em cenário extremo (internet inteira bloqueada), eventos podem
trafegar offline:

- Export de bundle de eventos como JSON ou QR code
- Import de bundle em outro device por câmera ou USB
- Eventos mantém assinatura — ninguém precisa confiar em quem trouxe

Implementação: `lib/transport/bundle.ts` — encode/decode e UI de
import via câmera de QR. Tag `drift-version` garante compatibilidade.

### 31.4 Documentação Pública Pós-Lançamento

Antes da Fase 6 fechar, publicar em
`github.com/drift/anti-censorship-guide`:

- Como rodar relay próprio (Docker compose pronto)
- Como usar Tor com Drift
- Como conectar via WebRTC quando WSS falha
- Como exportar/importar eventos via QR
- Como verificar build reproduzível

Documentação é parte do compromisso. Sem ela, o adversário só
precisa censurar quem sabe usar.

---

## 32. CAMADA DE TRANSPORTE (Fase 6)

API uniforme para todos os transportes:

```typescript
// src/lib/transport/index.ts
export interface Transport {
  readonly kind: 'wss' | 'tor' | 'webrtc' | 'bundle'
  publish(event: SignedEvent): Promise<void>
  subscribe(filter: Filter, onEvent: (e: SignedEvent) => void): Unsubscribe
  health(): Promise<{ ok: boolean; latencyMs: number }>
}

export class TransportPool {
  // Itera sobre transportes ativos sem saber qual é qual.
  // Health check periódico decide quais usar.
  // Sync.ts não muda — fala com TransportPool, não com cada transporte.
}
```

### 32.1 WSS (já implementado)

`lib/transport/wss.ts` — wrapper sobre `nostr-tools/SimplePool`. É a
base do MVP.

### 32.2 Tor (Fase 6, cliente nativo)

`lib/transport/tor.ts` — Tauri command que chama Rust com `arti-client`.
Rust expõe `wss_via_tor(url, request)` para o React.

Modos:
- **Auto** — tenta clearnet primeiro, faz fallback para Tor em timeout
- **Always** — só Tor (modo paranoia)
- **Off** — só clearnet (default em região não-censurada)

Latência maior que clearnet (~1-3s adicional). Aceitável para
publish; cache cobre leitura.

### 32.3 WebRTC P2P (Fase 6, cliente nativo)

`lib/transport/webrtc.ts` — Tauri command que chama Rust com `libp2p`
ou implementação WebRTC direta.

Sinalização: clientes anunciam disponibilidade de WebRTC via tag
opcional em eventos próprios (kind:0 ou via NIP-65). Pares descobrem
um ao outro via Nostr e fazem handshake direto.

Quando WSS bloqueado, peers compartilham eventos diretamente. Não
substitui relays para descoberta inicial; complementa para
distribuição contínua.

#### 32.3.1 Defesas anti-Sybil adaptativo (Manifesto §20)

Discovery de peers WebRTC é **superfície adversarial** — sem relays
neutros como ground truth, atacante pode tentar capturar a vizinhança
percebida do nó local. A defesa não é "filtrar peer ruim" (mimicry
quebra heurísticas locais); é forçar **diversidade estrutural** ao
longo do tempo.

**Estado do nó:**
```
INIT         — sem peers validados; só hints de bootstrap
DISCOVERING  — coletando peers, expandindo grafo local
CONNECTED    — diversidade mínima atingida; participa da rede
ISOLATED     — auto-detectado: baixa diversidade, alta dependência de cluster
```

**Regras de descoberta (implementadas no transport, não no protocolo
Drift — mantém compatibilidade Nostr §30):**

1. **Multi-bootstrap obrigatório.** Mínimo 3 endpoints independentes
   pra entrar em DISCOVERING. NIP-65 + tag `recommend-relay` + lista
   pessoal do user, em paralelo, com `Promise.allSettled` agregando.

2. **Expansão obrigatória até diversidade.** Em DISCOVERING, cliente
   NÃO pára de descobrir. Critério pra CONNECTED: ≥3 origens
   independentes (caminhos disjuntos até peers diferentes).

3. **Random walk obrigatório.** Mesmo em CONNECTED, periodicamente:
   ```
   - escolhe peer aleatório conhecido
   - envia DISCOVER request (filter: kinds: [0, 10002], limit: N)
   - merge das respostas no grafo local
   ```
   Quebra clusters fechados — bots não conseguem manter visão estável
   contra amostragem aleatória contínua.

4. **Path diversity scoring.**
   ```typescript
   // Pseudo
   diversity_score(peer) =
     número de caminhos independentes (origin paths disjuntos) que
     levaram à descoberta deste peer
   ```
   Peer com `diversity_score < 2` é tratado como suspeito; só entra
   no pool ativo após reaparecer por outra rota. Defesa contra
   mimicry: bot pode parecer normal localmente, mas só é "visto" via
   1-2 caminhos correlacionados.

5. **Limite de influência.** Nenhum peer pode contribuir >30% do
   conjunto conhecido. Limite hard-coded; quando ultrapassa, cliente
   ignora respostas adicionais até diversificar.

6. **Cluster detection (auto-ISOLATED).** Se >70% dos peers vêm da
   mesma origem inferida (mesmo bootstrap path, mesmo subnet, mesma
   "família" de peers que se citam mutuamente), cliente assume
   ISOLATED e força expansão por random walk antes de exibir o
   feed como representativo.

**Tipos de mensagem (camada WebRTC, JSON sobre datachannel):**

```typescript
// Pedido ativo de descoberta
{ type: 'DISCOVER', from: nodeId, knownPeers: string[] }

// Resposta — máximo 50 peers por mensagem, TTL ≤ 5
{ type: 'PEER_LIST', from: nodeId, peers: string[], ttl: number }

// Compartilha como descobriu peers (alimenta path diversity)
{ type: 'ORIGIN_REPORT', peer: string, seenVia: string[] }

// Health check
{ type: 'PING', timestamp: number }
{ type: 'PONG', latencyMs: number }
```

**Limite honesto (manifesto §20):** essas defesas reduzem
probabilidade e tempo de captura local. Não eliminam manipulação. Não
garantem visão global perfeita. O que garantem: nenhum conjunto de
bots mantém visão estável da rede para sempre — random walk +
diversidade de caminho garantem que bolhas falsas se desfazem ao
longo do tempo.

**Decisão de design:** essas defesas vivem **dentro do transport**
(`webrtc.ts`), não como protocolo paralelo separado. Drift continua
sendo cliente Nostr; o protocolo Drift (kinds 9078..9081) não muda.
Ver §30.12.

### 32.4 Bundle (Fase 6)

`lib/transport/bundle.ts` — encode/decode de eventos como JSON ou
QR code. Sneakernet (§31.3).

API:
```typescript
exportBundle(events: SignedEvent[]): { json: string; qrParts: string[] }
importBundle(json: string | qrParts: string[]): SignedEvent[]
```

Eventos importados passam pelo `onNostrEvent` normal (kind + schema +
verify). Assinatura garante que mesmo eventos vindos por canal não-confiável
são válidos.

---

## 33. DISPONIBILIDADE DISTRIBUÍDA

Eventos publicados no Drift permanecem acessíveis mesmo que relays
individuais fechem, sejam confiscados ou bloqueados. Estratégia em
camadas.

### 33.1 Cache Local Respeita Mecânica Social (Fase 4)

`evictOldPosts` (em `lib/cache.ts`) **NUNCA** remove posts que o user
espalhou. A regra:

```typescript
async function evictOldPosts() {
  const { count } = await db.get(`SELECT COUNT(*) as count FROM posts`)
  if (count <= 10_000) return

  await db.run(`
    DELETE FROM posts WHERE id IN (
      SELECT p.id FROM posts p
      LEFT JOIN spreads s ON p.id = s.post_id AND s.spreader_pub = ?
      LEFT JOIN pinned pn ON pn.post_id = p.id
      WHERE s.post_id IS NULL AND pn.post_id IS NULL
      ORDER BY p.score ASC
      LIMIT ?
    )
  `, [currentNpub, count - 10_000])
}
```

Quem espalhou, mantém. Manifesto §16: "Espalhar = seedear".

### 33.2 Re-Broadcast Oportunista (Fase 5)

Quando o cliente conecta a relay novo, verifica se o relay tem os
eventos próprios + os eventos espalhados. Se não tiver, republica.

```typescript
// lib/rebroadcast.ts
async function rebroadcastToNewRelay(relayUrl: string) {
  const myEvents = await db.exec(`
    SELECT id, raw_event FROM events_raw
    WHERE author_pub = ? OR id IN (SELECT post_id FROM spreads WHERE spreader_pub = ?)
  `, [npub, npub])

  for (const event of myEvents) {
    const exists = await checkEventOnRelay(relayUrl, event.id)
    if (!exists) await publishToRelay(relayUrl, event.raw_event)
  }
}
```

Chamado quando:
- Usuário adiciona relay manual
- Relay descoberto via NIP-65
- Cliente reconecta após offline

### 33.3 IPFS Pin de Posts Virais (Fase 6, cliente nativo)

Posts com score acima de threshold (default 10, configurável) são
pinados automaticamente em IPFS pelo cliente nativo.

```typescript
// lib/pin.ts (Tauri command pra Rust)
async function pinIfViral(post: Post) {
  if (post.score < env.DRIFT_IPFS_PIN_THRESHOLD) return
  const cid = await tauri.invoke('ipfs_pin', { rawEvent: post.rawEvent })
  await db.run(`INSERT OR IGNORE INTO pinned (post_id, cid, pinned_at) VALUES (?, ?, ?)`,
    [post.id, cid, Date.now()])
}
```

Custo de pin aumenta com viralidade — modelo de custeio em §26
(doações + premium). Limite por user para evitar spam.

### 33.4 WebRTC Seeding (Fase 6, cliente nativo)

Quando dois clientes nativos estão conectados via WebRTC, podem
trocar eventos diretamente. Útil quando:
- Relays clearnet bloqueados
- Tor lento
- Eventos antigos sumiram dos relays públicos

Seeding é opt-in no modo paranoia (revela quem tem o quê). Em modo
default, ativo silenciosamente.

### 33.5 Métricas de Disponibilidade (Fase 6)

UI mostra para cada post:
- Quantos relays têm o evento (verificado periodicamente)
- Se está pinado em IPFS (CID visível)
- Quantos peers WebRTC conhecidos têm

Permite ao user ver se um post crítico está bem distribuído ou não.

---

## 34. APÊNDICE — ROADMAP DE COMPROMISSOS

(Cópia do manifesto §Roadmap, para referência cruzada.)

| Princípio do Manifesto | MVP | Fase 3-4 | Fase 5 | Fase 6 |
|---|---|---|---|---|
| §1 Existência Autônoma | PWA | — | APK + F-Droid | Tauri |
| §3 Identidade portável | ✓ | — | Multi-id | — |
| §4 Anonimato | ✓ | Location off | Multi-id | Tor |
| §12 Múltiplos transportes | WSS | — | NIP-65 | Tor + WebRTC |
| §14 Bootstrap distribuído | Seed | — | UI relays | Pref .onion |
| §15 Anti-censura país | Parcial | — | APK | Tor + run-your-own |
| §16 Disponibilidade | Cache | Eviction respeita spreads | Re-broadcast | IPFS + WebRTC seed |
| §17 Resistência fundador | ✓ | — | — | Build reproduzível |
| §20 Resistência isolamento | 4 relays | — | Probe + relay aleatório | — |
| §21 Custo assimétrico | Parcial | — | + APK + relays user | + Tor + WebRTC + IPFS |

Ver manifesto completo em `Docs/manifesto.md`.

---

## 35. TESTS — Funções Puras (Vitest)

Manifesto §7 (Determinismo Global) exige que **mesma entrada → mesma
saída sempre**. Pra que isso seja propriedade verificável e não promessa,
funções puras críticas têm tests automatizados rodando em Node via
Vitest.

**Cobertura atual** (`tests/*.test.ts`, 82 tests passando):

- `tests/scoring.test.ts` — `calculateScore` (decay temporal, peso de
  bury 0.3x, simetria de net engagement, idade negativa clampada)
- `tests/weight.test.ts` — `calculateAntiquity`/`calculateEngagement`/
  `calculateWeight`/`getMaxSubposts` (saturação em 40+60=100, monotonia,
  bury não penaliza autor §23, inatividade só conta dias completos)
- `tests/moderation.test.ts` — `getReportThreshold`/`getReportWeight`
  (piso de 5 reports, illegal 2x agressivo com piso 3, monotonia)
- `tests/applyContentFilters.test.ts` — matrix completa
  (NSFW/violence/spoiler/ad × prefs × block/mute) — block/mute vencem
  qualquer outro sinal
- `tests/bip39.test.ts` — **vetores oficiais NIP-06**
  ("leader monkey parrot..." e "what bleak badge..."). Validação de
  checksum. Determinismo de derivação. Compatibilidade com clientes
  Nostr externos (Damus, Snort) verificável.
- `tests/nip65.test.ts` — `parseRelayList` (markers read/write,
  dedup, normalização de URL, tags malformadas)

**Comandos:**
```bash
npm run test       # roda uma vez (CI-friendly)
npm run test:watch # watch mode pra dev
```

**O que NÃO está coberto** (fica como E2E manual ou Fase 6):
- React components (rendering, interaction)
- Integração SQLite WASM (precisaria browser env)
- Pipeline `onNostrEvent` end-to-end (precisaria worker SQLite)
- WebAuthn `enablePasskey`/`verifyPasskey` (precisaria browser real)
- Compressão de imagem (`browser-image-compression` precisa Worker)

Esses ficam pra E2E test framework (Playwright Vitest browser mode) em
fase futura — manifesto §7 cobre só os algoritmos determinísticos
puros, que é onde regressão silenciosa é mais perigosa.

---

## 36. THREAT MODEL EXPLÍCITO

Drift é uma rede social descentralizada com **anonimato pseudônimo**
(identidade = chave pública, sem KYC, sem login real-world). Esta
seção lista de forma honesta o que o cliente oficial protege e o que
**não** protege. Sem essa explicitação, é fácil ter expectativa errada.

### 36.1 O que Drift PROTEGE

| Vetor | Defesa | Onde |
|---|---|---|
| Censura por servidor central | Não tem servidor central — só relays Nostr múltiplos | Manifesto §1, §11 |
| Banimento pelo fundador | Sem chave mestra técnica; build reproduzível (Fase 6) | Manifesto §17, arquitetura §17 |
| Confisco de relay individual | Replicação multi-relay + re-broadcast oportunista (Fase 5) + IPFS pin (Fase 6) | Manifesto §16, arquitetura §33 |
| Eclipse local por relay malicioso | Probe periódico + path diversity (Fase 5/6) + relay aleatório fora da config do user | Manifesto §20, arquitetura §32.3.1 |
| Vinculação a identidade real | Sem KYC, sem email/telefone, multi-identidade | Manifesto §4, §28 |
| Bloqueio de WSS clearnet por país | Tor (.onion) + WebRTC P2P (Fase 6) + sneakernet bundle | Manifesto §15, arquitetura §31 |
| Remoção das app stores | PWA + APK direto + F-Droid (Fase 5) + cliente Tauri (Fase 6) | Manifesto §1, §15 |
| Algoritmo de feed escondido | Score determinístico, mesma fórmula em todos os clientes; tests verificam | Manifesto §22, §24, arquitetura §35 |
| Sybil simples / flooding | Score + reports + threshold dinâmico + peso assimétrico | Manifesto §26, §33 |

### 36.2 O que Drift NÃO PROTEGE (e nunca prometeu)

| Vetor | Razão | Mitigação parcial possível |
|---|---|---|
| Adversário global passivo (NSA / ISP nacional sniffing tudo) | Drift não é mixnet — sem cover traffic, fragmentação, mixing | Tor opt-in (Fase 6) esconde IP do relay; uso correto + multi-id reduz correlação |
| Correlação temporal de longo prazo entre posts do mesmo nsec | Sem jitter temporal, sem dummy events. Análise de timing eventualmente vence | Multi-identidade compartimenta contextos (manifesto §4). Não publicar com relação temporal previsível ajuda. |
| Deanonymization via IP quando NÃO usa Tor | Fase 5 = sem Tor; relay vê IP do user. Fase 6 nativo = Tor opt-in. | Tor (Fase 6) ou VPN (responsabilidade do user em Fase 5) |
| Sybil adaptativo com mimicry estrutural | Defesas de path diversity reduzem mas não eliminam (manifesto §20 reconhece). Adversário paciente eventualmente captura visão local temporariamente | Random walk obrigatório (Fase 6) limita controle persistente. "Drift não impede mentira; impede consenso estável da mentira." |
| Coação física do user (rubber-hose) | Identidade é o nsec — quem coage o user a entregar tem a identidade | Multi-identidade reduz dano (compartimentar). Sem solução técnica geral. |
| Conteúdo ilegal | Cliente NÃO escaneia (manifesto §25). Moderação reativa via reports (§26). Conteúdo ilegal é responsabilidade do publicante + autoridades competentes | UX de denúncia a autoridades (NCMEC, SaferNet, etc.) — Fase 4 |
| Análise de conteúdo (linguagem, estilometria) | Drift não anonimiza estilo de escrita — autores que escrevem muito podem ser identificados por análise textual | Não publicar com a mesma identidade nos contextos onde estilo identifica |
| Compromisso do device | Se atacante ganha acesso ao device, lê tudo no SQLite (incluindo nsec encriptado, master key no IndexedDB) | Passkey opt-in (Fase 5) adiciona barreira; full-disk encryption (responsabilidade do user) |

### 36.3 Adversários considerados (assumed capabilities)

Por ordem crescente de poder:

1. **Curioso casual** — vê posts públicos, tenta inferir identidade.
   Drift protege bem (sem login real-world).
2. **Operador de relay malicioso** — esconde eventos, retorna lista
   parcial. Probe + path diversity + relay aleatório mitigam.
3. **ISP nacional / governo** — bloqueia DNS, SNI, tráfego clearnet.
   Tor + WebRTC + APK direto (Fase 5/6) mitigam.
4. **Adversário global passivo** — vê tráfego de toda a internet.
   **Drift não protege**; só mixnet protegeria. Documentado.
5. **Adversário ativo com recursos de Estado** — pode rodar relays
   coordenados, comprar timing data, pagar coação. **Mitigado
   parcialmente** (multi-identidade compartimenta), mas não há
   garantia técnica geral — manifesto §20 reconhece.

### 36.4 Por quê não viramos mixnet

Mixnets (Nym, Loopix, Tor) trocam UX por anonimato forte:

- Cover traffic 24/7 (gasta bateria + dados)
- Latência alta (mensagens demoram segundos a minutos)
- Modelo assíncrono (não-tempo-real)
- Cliente pesado (não roda em browser PWA decentemente)

Drift escolhe **publicação aberta + UX leve + transporte
intercambiável (incluindo Tor opt-in)**. Quem precisa de anonimato
forte real-time usa Briar, Cwtch, Session — produtos diferentes com
trade-offs diferentes. Drift e mixnets são complementares, não
substitutos.

### 36.5 Métricas de anonimato (referência)

A literatura formal mede anonimato via:

- **Anonymity set entropy** `H(A | O)` — entropia do conjunto de
  possíveis autores dada a observação `O`. Quanto maior, melhor.
  (Diaz, Seys, Claessens, Preneel, *Towards Measuring Anonymity*, 2002.)
- **Mutual information** `I(A; O)` — quanto a observação reduz
  incerteza sobre o autor. Quanto menor, melhor.
- **Taxa de colapso de entropia** sob múltiplas observações ao
  longo do tempo.

Drift **não mede formalmente** essas métricas — não somos um paper
acadêmico. Mas elas servem como linguagem comum pra discutir
adversários: nossa promessa é que a entropia do anonymity set não
colapsa contra os adversários §36.3 #1-#3, e somos honestos que
contra #4-#5 não temos garantia técnica.

### 36.6 Pra leitura aprofundada

- [Tor Design Paper](https://svn.torproject.org/svn/projects/design-paper/tor-design.pdf) — modelo de ameaças clássico contra adversário ativo
- [Loopix](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/piotrowska) — mixnet com ACK + cover, exemplo de anonimato forte
- Diaz et al, *Towards Measuring Anonymity* — entropy-based metrics
- [Briar Threat Model](https://briarproject.org/manual/) — exemplo de threat model honesto pra rede social descentralizada

---

*Documento v5.3 — Abril 2026.*
*Arquitetura: Event Sourcing sobre Nostr + SQLite WASM + React/Zustand + (Fase 6) Tauri/Tor/WebRTC/IPFS.*
*Manifesto v2.2 vinculante. Fase 6 é compromisso.*
*Anti-censura forte. Disponibilidade distribuída. Anonimato pseudônimo por design. Compatibilidade Nostr.*
*Sem scan automático no cliente oficial padrão. Auto-classificação voluntária + filtros locais opt-in.*
*Tests automatizados de funções puras — manifesto §7 (determinismo) verificável.*
*Threat model explícito (§36) — honestidade sobre o que protege e o que não protege.*
