# RFC — Threads de Comentários (Track C)

**Status:** v0.3 (C.6.2 + C.6.3 — content-warning + imeta em comments) · **Data:** 2026-05-07
**Manifesto:** §22 (score determinístico), §24 (sem afinidade), §26
(moderação reativa), §27 (auto-classificação), §29 (compat Nostr).
**License:** CC0 1.0 Universal (manifesto + spec do Drift são domínio público).

> v0.3 documenta as extensões de polish do C.6: `content-warning`
> (NIP-36 reuse) e `imeta` (NIP-94 reuse, integração Track B). Sem
> mudança no kind nem na pipeline de persist; comentários ganham
> auto-classificação opcional e suporte a 1 imagem por comment.
>
> v0.2 incorporou os 6 issues de revisão Ted/Barney listados em
> [`design-comments.md`](design-comments.md) §15. C.1 (schema + persist
> + protocol.commentOnPost + tests) shipped antes deste polish.

---

## 1. Resumo

Drift hoje tem 4 kinds (9078..9081) — POST, SPREAD, BURY, REPORT —
mas **nenhuma forma de discussão estruturada por post**. Manifesto §22
(`COMMENT_RECEIVED: +1` já está em `ENGAGEMENT_POINTS`) reserva o sinal
mas o protocolo não emite o evento.

**Esta RFC propõe:**

1. **Reuso de NIP-22 (kind 1111)** — comments são kind padrão do Nostr,
   visíveis em qualquer cliente NIP-22-aware (habla.news, Highlighter,
   etc.). Drift agrega tags próprias (`drift-version`, `content-warning`,
   `imeta` do Track B) sem quebrar compat (§29).
2. **Lazy subscription on-demand** — cliente NÃO subscribes a kind 1111
   no boot. Apenas quando user abre um post (PostViewer), cliente
   adiciona um filter `{ kinds: [1111], '#E': [postId] }` ao subscribe
   ativo. Saiu do post → unsubscribes. Custo de boot inalterado.
3. **Tree determinístico** — replies materializadas em SQLite com
   `parent_event_id` (raiz do post) + `reply_to_event_id` (resposta
   direta). Render em árvore com sort `created_at ASC` + tie-break
   `id ASC` — todos clientes Drift veem a MESMA árvore (manifesto §7).
4. **Score weighted by commenter weight** — `applyCommentReceived` em
   scoring.ts soma +1 × weight do commenter. Sybil novo (weight ~0)
   contribui ~0; user estabelecido contribui ~1. Cap por post pra
   evitar comment-flood inflando score artificialmente.

**Fora do escopo (rejeitado pra v1):**
- Reactions/emojis em comments (kind 7 reuso) — out of scope, possível
  Track futuro
- Edição de comments (NIP-09 deletion) — manifesto §5 (eventos
  imutáveis); cliente não suporta editar próprio comment
- Comment-only feed/notifications — Drift é feed de POSTS, não de
  comments. Reverte §24 se permitir
- Threading multi-níveis com colapso UI — todos os comments são
  visíveis; cap de 5 níveis indenta visualmente, depois flatten
- Comments imutáveis vs replaceable (kind 30000+ paramaterized) —
  imutável (kind 1111) é a escolha NIP-22

---

## 2. Estado atual (gap concreto)

| Componente | Hoje | Gap |
|---|---|---|
| `ENGAGEMENT_POINTS.COMMENT_RECEIVED` | `+1` definido | ✗ não consumido em `scoring.ts` |
| Tabela SQLite | posts/spreads/buries/reports | ✗ sem `comments` |
| `onNostrEvent` | trata 4 kinds Drift | ✗ ignora kind 1111 |
| `protocol.ts` | createPost/spreadPost/buryPost/reportPost | ✗ sem `commentOnPost` |
| Subscribe | filtra `kinds: [9078..9081]` | ✗ sem suporte lazy a comments |
| UI | PostViewer mostra subposts + actions | ✗ sem ThreadView |

---

## 3. Postura adotada

### 3.1 Kind 1111 NIP-22 (não kind Drift próprio)

NIP-22 ([`nostr-protocol/nips/22.md`](https://github.com/nostr-protocol/nips/blob/master/22.md))
define kind 1111 pra comentários em qualquer evento. Drift adota.

**Por que não kind 9083 Drift-native:**
- Reuso aproveita ecosystem Nostr — comment Drift renderiza em
  habla.news, Coracle, etc. Manifesto §29 (compat).
- Reduz fragmentação — múltiplos clientes de comments no Nostr
  convergem em NIP-22.
- Drift agrega tags PRÓPRIAS (sub-conjunto válido NIP-22 do qual
  outros clientes não dependem) sem quebrar compat.

**Trade-off aceito:** outros clientes Nostr podem renderizar comments
sem o conteúdo cosmético Drift (`drift-version`, layout, etc.). OK.

### 3.2 Lazy subscription on-demand

Cliente NÃO subscribes a `kinds: [1111]` no boot. Custos de bandwidth
de comments ficam em zero até user **interessar** num post.

**Trigger:** `PostViewer` abre → `subscribeComments(postId)` adiciona
filter ao pool ativo. PostViewer desmonta → unsubscribe.

**Trade-off:** primeira abertura de um post tem latência (subscribe +
relay walk → ~500ms-2s). Aceito — UX previsível, badge "carregando
comentários…" no ThreadView.

**Otimização C.6:** prefetch de comment-count via filter agregado
(REQ com `kinds: [1111], '#E': [...50 postIds visíveis]`). Renderiza
"42 comentários" no card antes de abrir, sem materializar threads
inteiros. Fica diferido pra polish.

### 3.3 Storage e tree assembly

Tabela `comments` (v0.2 — **sem FK**, ver Ted Issue #2 abaixo):
```sql
CREATE TABLE IF NOT EXISTS comments (
  id              TEXT PRIMARY KEY,    -- event.id hex 64
  post_id         TEXT NOT NULL,       -- root event.id (kind 9078)
  reply_to        TEXT NOT NULL,       -- direct parent (= post_id se top-level)
  author_pub      TEXT NOT NULL,
  content         TEXT NOT NULL,       -- plain UTF-8 (NIP-22)
  created_at      INTEGER NOT NULL,
  raw_event       TEXT NOT NULL,       -- JSON pra rebuild + tags imeta opcional
  score           REAL DEFAULT 0       -- moderação: -999 esconde
);
CREATE INDEX IF NOT EXISTS idx_comments_post  ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_reply ON comments(reply_to);
```

**v0.2 fix (Ted Issue #2):** removida FK `post_id REFERENCES posts(id)`.
Race comment-antes-do-post existe e é compromisso do manifesto §16
(eventos chegam fora de ordem por relays distintos). FK rejeitaria
INSERT de comments órfãos; `buildThread` no read path (futuro C.3) já
trata órfãos como top-level temporários quando parent ainda não chegou.

Tree assembly (read path):
```typescript
function buildThread(rows: CommentRow[]): CommentNode[] {
  const byId = new Map<string, CommentNode>()
  const roots: CommentNode[] = []

  // Sort estável: created_at ASC, tie-break id ASC.
  rows.sort((a, b) =>
    a.created_at !== b.created_at
      ? a.created_at - b.created_at
      : a.id < b.id ? -1 : 1
  )

  for (const r of rows) {
    const node: CommentNode = { ...r, replies: [] }
    byId.set(r.id, node)
  }
  for (const r of rows) {
    const node = byId.get(r.id)!
    if (r.reply_to === r.post_id) {
      // Top-level (resposta direta ao post)
      roots.push(node)
    } else {
      // Reply a outro comment
      const parent = byId.get(r.reply_to)
      if (parent) parent.replies.push(node)
      else roots.push(node) // parent não chegou ainda → vira top-level temporariamente
    }
  }
  return roots
}
```

Determinismo: mesmo conjunto de comments → mesma árvore renderizada
em todos clientes (§7).

### 3.4 Score weighted by commenter weight (manifesto §22)

`applyCommentReceived` espelha `applySpread`:
- Cada comment recebido contribui +1 × weight do commenter
- Cap por post: COMMENTS_SCORE_CAP = 30 (mesmo de spread no manifesto)
- Não é incremental — recalc full quando comment chega (já é o pattern
  de scheduleScoreRecalc)

Anti-comment-flood: peso baixo de novo identidade reduz contribuição.
Sybil novo postando 100 comments num post adiciona ~0 ao score.

### 3.5 Cap visual de profundidade

Tree pode ter depth arbitrária (replies-de-replies-de-replies). UI
indenta até 5 níveis; níveis 6+ flatten (mesma indentação que 5).
NÃO esconde — todos visíveis.

Justificativa: 5 níveis cobre 95% das discussões reais. Beyond
demanda barra de scroll horizontal ou recolhimento — degenerate
UX. Decisão de UX, não de protocolo.

### 3.6 Content-warning em comments (NIP-36 reuse)

[NIP-36](https://github.com/nostr-protocol/nips/blob/master/36.md)
define a tag `['content-warning', <reason>?]` como sinal genérico de
"conteúdo sensível"; não restringe kind. Drift reusa em kind 1111 com
o **mesmo conjunto fechado de valores** já adotado em kind 9078
(manifesto §27): `nsfw`, `violence`, `spoiler`, `ad`. A tag é opcional
e single-valued; segunda tag `content-warning` no mesmo evento é
ignorada (primeira ocorrência vence).

**Por que não kind 9081 (REPORT) ou outro mecanismo:** REPORT é
sinalização de **terceiro** (denúncia comunitária, §26). Aqui o
**autor** auto-classifica (§27); papéis distintos.

**Compat:**
- Outros clientes NIP-36-aware (Damus, habla.news, alguns Highlighter
  builds) já aplicam blur/hide em kind 1 e renderiza CW em kind 1111
  na medida em que o cliente delega o handling pro layer NIP-36
  genérico (não case-by-kind). Em clientes que não respeitam NIP-36
  fora de kind 1, comment renderiza sem warning — degradação
  aceitável (manifesto §29).
- Valores fora do conjunto Drift (`{nsfw, violence, spoiler, ad}`)
  são preservados no `raw_event` mas tratados como "warning genérico"
  pelo `applyContentFilters` local — não derrubam o comment, só
  deixam de matchar toggle específico do leitor.

**Drift UI:** mesmo `applyContentFilters` de posts (`feed.ts`)
estende-se a comments. Toggles em `user_prefs` (`filter_nsfw`,
`filter_violence`, `filter_spoiler`, `filter_ad`) controlam blur
default por categoria; tap "mostrar mesmo assim" é override local
(UI-only, não persiste no SQLite, não toca evento).

**Persistência:** valor da tag (se presente) é guardado em coluna
nova `comments.content_warning TEXT NULL` (migration v3). Apenas
strings do conjunto Drift são salvas tipadas; outros valores ficam
no `raw_event` JSON pra round-trip honesto.

### 3.7 Imagens via imeta (Track B integration)

Comments NIP-22 ganham suporte a **1 imagem opcional** via reuso da
mesma tag `imeta` que Track B já estabeleceu pra posts kind 9078
(ver [`blob-distribution.md`](blob-distribution.md) §3.5 e §6).
NIP-22 não fala explicitamente de `imeta` mas a tag é um helper
genérico de NIP-94 — válido em qualquer kind.

**Diferenças vs post (kind 9078):**

| Aspecto | POST (9078) | COMMENT (1111) |
|---|---|---|
| Cap de imagens | N por subpost × M subposts | **1 por comment** |
| Pipeline upload | `blobs.uploadBlob` (Track B) | mesma `blobs.uploadBlob` |
| Hash SHA-256 verify | obrigatório | obrigatório |
| Helia pin opt-in | via SPREAD | **não** — comments não viram pin (§3.5.2 escopo limitado a kind 9078) |
| HTTP fallback gateway | sim | sim |
| EXIF strip | já em B.2 | mesma pipeline, herdado |

**Justificativa do cap = 1:** comments são interjeição na thread,
não publicação. UX de N imagens em comment polui ThreadView (§4.2.1
do `design-comments.md`). Hard cap no protocolo — múltiplas tags
`imeta` num mesmo kind 1111 fazem o cliente Drift reter **apenas a
primeira** (silently drops o resto, igual lógica de
`content-warning`).

**Compat:** clientes NIP-22-aware sem suporte a `imeta` nesse kind
renderizam o comment como texto puro; com NIP-94 generic support
(habla.news, Coracle parcial) renderizam imagem inline. Drift
extensions (`drift-version`, `client`) ignoradas safely.

**Persistência:** colunas novas em `comments` (migration v3):
- `image_url TEXT NULL` — URL HTTP ou `ipfs://<cid>`
- `image_hash TEXT NULL` — SHA-256 hex (obrigatório se image_url
  presente; rejeita persist se mismatch)
- `image_mime TEXT NULL`
- `image_dim TEXT NULL` — `"WxH"` opcional

`raw_event` ainda guarda a tag `imeta` original pra round-trip
fidedigno se algum cliente futuro quiser re-publicar.

---

## 4. Arquitetura proposta

### 4.1 Camadas

```
┌──────────────────────────────────────────────────────────┐
│  UI (ThreadView, CommentNode, ReplyForm)                 │
└───────────────────────┬──────────────────────────────────┘
                        │
            ┌───────────▼────────────┐
            │  hooks/useThread       │  ← lazy subscribe + Zustand store
            │  - useThread(postId)   │
            │  - returns CommentNode[] tree
            └───────────┬────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐   ┌──────▼──────┐  ┌────▼─────┐
   │ comments│   │ protocol.ts │  │ scoring  │
   │ store   │   │ commentOn  │  │ apply    │
   │ (zustand)│   │  Post()    │  │ Comment  │
   └─────────┘   └─────────────┘  └──────────┘
                        │
                ┌───────▼────────┐
                │ events.ts      │
                │ persistComment │  ← onNostrEvent extension
                └───────┬────────┘
                        │
                ┌───────▼────────┐
                │ SQLite         │
                │ comments table │
                └────────────────┘
```

### 4.2 Componentes novos

- **`src/lib/comments.ts`** — store + queries
  (`useThread`, `commentsByPost`, `subscribeComments`, `unsubscribeComments`)
- **`src/lib/protocol.ts`** — adiciona `commentOnPost({ postId, replyTo, text, contentWarning, blobs? })`
- **`src/lib/events.ts`** — adiciona case `kind === 1111` em `onNostrEvent`
- **`src/lib/scoring.ts`** — `applyCommentReceived` invocado em
  `scheduleScoreRecalc` quando comment chega
- **`src/lib/db.worker.ts`** schema migration — tabela `comments`
- **`src/components/Post/ThreadView.tsx`** — render da árvore +
  lazy load skeleton + ReplyForm
- **`src/components/Post/CommentNode.tsx`** — single comment + reply
  button + depth indent
- **`src/hooks/useThread.ts`** — manage lifecycle (subscribe on mount,
  unsubscribe on unmount)

---

## 5. Fluxos

### 5.1 Publish comment (top-level ou reply)

```
1. User digita no ReplyForm → click "responder"
2. protocol.commentOnPost({ postId, replyTo: postId | parentCommentId, text, ... })
   a. Monta tags NIP-22:
      ['E', postId]                     // root marker (NIP-22 mandatório)
      ['K', '9078']                     // root kind
      ['P', postAuthorPub]              // root author
      ['e', replyTo]                    // direct parent
      ['k', replyToKind]                // parent kind ('9078' top-level, '1111' nested)
      ['p', replyToAuthorPub]           // parent author
      ['drift-version', '1']            // Drift extension
      ['client', 'drift-official']      // Drift extension
      [content-warning]?                // opcional, se autor declarou
   b. signDriftEvent({ kind: 1111, tags, content: text })
   c. publishToRelays(event)
3. Evento volta pelo subscribe → onNostrEvent → persistComment
4. UI re-renderiza thread (zustand invalidate)
```

### 5.2 Fetch thread (user abre post)

```
1. PostViewer mount → useThread(postId)
2. Hook adiciona filter ao pool ativo:
   { kinds: [1111], '#E': [postId], limit: 200 }
3. Eventos chegam via subscribe → onNostrEvent → persistComment
4. Hook lê de SQLite (reactive via zustand): SELECT * FROM comments
   WHERE post_id = ? ORDER BY created_at ASC, id ASC
5. buildThread(rows) → CommentNode[] tree
6. Render tree
7. PostViewer unmount → useThread cleanup → REQ closed
```

### 5.3 Lazy unmount handling

Race: user fecha post antes do REQ retornar. Subscribe é cancelado;
eventos que já chegaram permanecem em SQLite (idempotente — IGNORE
em INSERT). Re-abrir post mostra cache local + new REQ pra preencher
gap.

### 5.4 Score recalc

```
persistComment(event):
  1. INSERT OR IGNORE INTO comments
  2. updateUserActivity(commenter, created_at)
  3. invalidateFeed()  // se cliente exibe contador no feed (B.6 polish)
  4. scheduleScoreRecalc(post_id)  // recalc score do post pai
```

`recalculateScore` agora considera comments:
```typescript
const commentScore = await db.exec(`
  SELECT SUM(weight) AS total FROM (
    SELECT MIN(weight) AS weight FROM comments c
    JOIN ... weight calc ...
    WHERE c.post_id = ? AND c.score > -999
    GROUP BY c.author_pub
  )
`)
const cappedComment = Math.min(commentScore.total, COMMENTS_SCORE_CAP)
const newScore = applyCommentReceived(currentScore, cappedComment)
```

`MIN(weight) ... GROUP BY author_pub` evita comment-flood: cada
commenter contribui no MAX 1× × seu weight, independente de quantos
comments postou.

---

## 6. Wire format

### 6.1 Tag specification (NIP-22 + Drift extensions)

```json
{
  "kind": 1111,
  "tags": [
    ["E", "<root_post_id_hex>", "<relay_hint>?", "<root_pubkey>"],
    ["K", "9078"],
    ["P", "<root_author_pubkey>"],
    ["e", "<direct_parent_id>", "<relay_hint>?", "<parent_pubkey>"],
    ["k", "<direct_parent_kind>"],
    ["p", "<direct_parent_author_pubkey>"],
    ["drift-version", "1"],
    ["client", "drift-official"],
    ["content-warning", "spoiler"]   // opcional
  ],
  "content": "Texto do comment, plain UTF-8, max 1000 chars",
  "pubkey": "<commenter_pubkey>",
  "created_at": <unix_seconds>,
  "id": "<event_id_sha256>",
  "sig": "<schnorr>"
}
```

**Diferenças NIP-22 → Drift:**
- Maiúsculas (`E`, `K`, `P`) = root marker (NIP-22 padrão)
- Minúsculas (`e`, `k`, `p`) = direct parent (NIP-22 padrão)
- Drift adiciona `drift-version` + `client` (sem-impacto em NIP-22 readers)

**Limite de tamanho:** 1000 chars no `content` (vs 280 do POST). Comments
podem ser explicações mais longas; cap maior aceitável.

### 6.2 Wire format com `content-warning` (C.6.2)

```json
{
  "kind": 1111,
  "tags": [
    ["E", "<root_post_id>", "", "<root_pubkey>"],
    ["K", "9078"],
    ["P", "<root_author>"],
    ["e", "<parent_id>", "", "<parent_pubkey>"],
    ["k", "1111"],
    ["p", "<parent_author>"],
    ["drift-version", "1"],
    ["client", "drift-official"],
    ["content-warning", "spoiler"]
  ],
  "content": "Olha, no final do filme o vilão era o mordomo desde o início.",
  ...
}
```

Valores aceitos pelo cliente Drift: `nsfw | violence | spoiler | ad`.
Outros são preservados em `raw_event` e tratados como "warning
genérico" no leitor.

### 6.3 Wire format com `imeta` — 1 imagem (C.6.3)

```json
{
  "kind": 1111,
  "tags": [
    ["E", "<root_post_id>", "", "<root_pubkey>"],
    ["K", "9078"],
    ["P", "<root_author>"],
    ["e", "<parent_id>", "", "<parent_pubkey>"],
    ["k", "9078"],
    ["p", "<parent_author>"],
    ["drift-version", "1"],
    ["client", "drift-official"],
    ["imeta",
      "url https://nostr.build/i/xyz.jpg",
      "x e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "m image/jpeg",
      "size 124301",
      "dim 1280x720"
    ]
  ],
  "content": "vejam essa screenshot que peguei",
  ...
}
```

Cap: **uma única tag `imeta`** considerada pelo cliente Drift; demais
ignoradas. Hash `x` obrigatório — fetch verifica e rejeita mismatch
(igual pipeline de posts, `blob-distribution.md` §5.2).

### 6.4 Combinado: content-warning + imeta

Tags coexistem; tag `content-warning` aplica blur sobre a imagem
renderizada, igual ao tratamento em kind 9078. Mesma lógica de
`applyContentFilters`.

---

## 7. Failure modes

| Falha | Comportamento |
|---|---|
| User abre post, REQ falha, sem comments cached | Skeleton + "carregando comments…" + retry button |
| Comment chega antes do post (race) | Persistido com `post_id` que não existe ainda; FK fails — usar `INSERT OR IGNORE` sem FK no insert path; FK só checa quando post chega via `INSERT OR IGNORE INTO comments WHERE post_id IN (SELECT id FROM posts)` |
| Reply chega antes do parent | `buildThread` trata como top-level temporariamente; quando parent chega, refresh detecta e move pro lugar certo |
| Comment.score = -999 (moderado) | Esconde do thread; tree assembly pula o nó (mas os filhos viram top-level "órfãos"; UX: show "comment removido" placeholder) |
| Profundidade > 5 níveis | Indentação satura no nível 5; níveis 6+ visíveis com mesma indentação |
| User offline | Subscribe falha gracefully; UI mostra cache local + banner "offline, alguns comments podem estar desatualizados" |

---

## 8. Backwards compat

- **Posts existentes** (kind 9078) — comments são feature aditiva. Posts
  antigos ganham capacidade de receber comments retroativa quando users
  começarem a postar comments via NIP-22.
- **Score recalc** — quando C.5 deploy, score de todos posts existentes
  re-calcula automaticamente via `scheduleScoreRecalc(postId)` em
  cada comment recebido. Sem migration data step.
- **Outros clientes Nostr** — recebem nossos comments kind 1111 e
  renderizam normalmente. Tag `drift-version` é metadata adicional.

---

## 9. Privacy considerations

- **Linkability:** comment expõe relação entre commenter pubkey e post.
  Manifesto §28 (privacidade pelo mínimo): commenter usa identidade
  ativa atual, igual ao post. Multi-identity já existe (manifesto §4).
- **Conteúdo de comments** — plain text NIP-22, não cifrado. Não
  pretendemos comments privados nesta RFC.
- **Location em comments** — não suportado. Comments NÃO carregam tag
  `location`. Diferença vs POST: post é "compartilho minha experiência
  daqui"; comment é "respondendo um conteúdo". Manifesto §28 default
  off pra location aplica mais forte aqui.
- **EXIF / metadata em imagens anexadas** — Track B.2 já strips. Comments
  podem ter `imeta` no futuro (C.6 polish), mesmas garantias.

---

## 10. Migration / phasing

| Fase | Scope | Esforço | Critério de aceite |
|---|---|---|---|
| **C.0** (este doc) | RFC | ~2h | Persona review pass; user aprova direção |
| **C.1** | Schema + onNostrEvent + persistComment | ~3-4h | Comments persistem em SQLite; events.ts tests passam |
| **C.2** | protocol.commentOnPost + commentsStore | ~2h | Cliente consegue publicar comment; `INSERT OR IGNORE` idempotente |
| **C.3** | useThread hook + lazy subscribe | ~3h | PostViewer abre → REQ; fecha → CLOSE; cache local read OK |
| **C.4** | UI: ThreadView + CommentNode + ReplyForm + depth cap | ~5-6h | Tree render determinístico; reply form publica; conformance test |
| **C.5** | scoring.applyCommentReceived + recalc integration | ~1-2h | Score reflete comments com weight; cap funciona; unit tests |
| **C.6.1** | Count prefetch (filter agregado kind 1111 sobre 50 postIds) | ~1h | ✅ Feed mostra "42 comentários" sem materializar threads inteiros |
| **C.6.2** | `content-warning` em comments (NIP-36 reuse) | ~1h | ✅ Tag opcional persistida; `applyContentFilters` aplica blur por categoria |
| **C.6.3** | `imeta` em comments (NIP-94 reuse, 1 imagem) | ~1-2h | ✅ Upload via Track B `blobs.uploadBlob`; hash verify; render inline |

**Total: ~17-22h.** Cada fase é shipável independente. C.4 pode shipar
sem C.5 (comments aparecem mas score não é afetado ainda); C.3 sem C.4
(thread carrega mas UI ainda usa placeholder). C.6.* são polish
ortogonais e podem entrar em qualquer ordem após C.4.

---

## 11. Open questions

1. **Reply notifications** — user A comenta no post de user B. B é
   notificado? Manifesto §1 (existência autônoma) sugere não-push. Mas
   UX espera saber. Solução: indicator local em UI (badge nos posts do
   user que receberam comment novo) sem push externo. Detalhar em C.4.
2. **Edit/Delete em comments** — manifesto §5 (eventos imutáveis) diz
   não. Mas user errou typo. Cliente Drift NÃO oferece edit; outros
   clientes via NIP-09 (delete) podem. Drift respeita kind 5 deletes
   pra comments (esconde se delete chega) — ou ignora? Decisão: ignora
   por ora (consistência com como tratamos kind 5 hoje). Open.
3. **Spam comments / rate limit** — alguém posta 1000 comments num
   post pra inflar score. Mitigação: weight × cap já reduz impacto.
   Mas UI ainda renderiza 1000 comments. Cap de display: máximo 500
   comments por post no read; "ver mais" pagina por created_at. Detalhar
   em C.4 (UX).
4. **Comment em comment de comment de... — limite real?** Manifesto e
   NIP-22 não impõem. Drift hoje cap visual 5 níveis. Hard cap no
   protocolo? Não — qualquer reply é válido. Só visual.
5. **Comments offline** — user composes comment offline, queue local
   pra publish quando reconectar? Optimistic UI já cobre POST/SPREAD;
   estender pra comments demanda pendingActions store. Detalhar em C.4.
6. **Reusable comment thread store** — `comments.ts` store por post
   ou um único store com `Map<postId, CommentNode[]>`? Single store
   simplifica subscribe lifecycle. Detalhar em C.1.

---

## 12. References

- [NIP-22 — Comments on Anything](https://github.com/nostr-protocol/nips/blob/master/22.md)
- [NIP-36 — Sensitive Content / Content Warning](https://github.com/nostr-protocol/nips/blob/master/36.md)
- [NIP-94 — File Metadata (`imeta` tag)](https://github.com/nostr-protocol/nips/blob/master/94.md)
- [`Docs/manifesto.md` §22, §24, §26, §27, §29](manifesto.md)
- [`Docs/protocol-spec.md`](protocol-spec.md) (CC0 single source dos kinds)
- [`Docs/blob-distribution.md`](blob-distribution.md) — modelo de RFC seguido aqui
- [`src/config/constants.ts:46`](../src/config/constants.ts) — `COMMENT_RECEIVED: +1` reservado

---

## Histórico

- **2026-05-07 v0.3**: C.6.2 (`content-warning` NIP-36 reuse) + C.6.3
  (`imeta` NIP-94 reuse, 1 imagem por comment, integração Track B)
  documentados como polish do C.6. Adicionadas §3.6, §3.7, §6.2, §6.3,
  §6.4. Migration v3 da tabela `comments` (colunas `content_warning`,
  `image_url`, `image_hash`, `image_mime`, `image_dim`). C.6.1 (count
  prefetch) também separado em sub-fase própria. Sem mudança no kind
  1111, na pipeline de persist (`onNostrEvent` switch case existente)
  ou na invariante #1 (`persistCommentRow` continua privada). Compat
  preservada: clientes NIP-22-aware sem suporte a NIP-36/NIP-94 nesse
  kind degradam pra texto puro sem warning, sem quebrar render.

- **2026-05-07 v0.2**: C.1 implementado (schema + persist + protocol +
  tests). Incorpora fixes da revisão Ted/Barney
  (`design-comments.md` §15):
  - **Ted #1 [BLOCK] resolvido**: `persistCommentRow` é função PRIVADA
    em `events.ts` invocada inline no switch de `onNostrEvent` —
    invariante #1 ("única porta de INSERT em domínio") preservada. Não
    exportada, não chamada de fora.
  - **Ted #2 [FIX] resolvido**: schema `comments` sem FK pra `posts(id)`.
    Race comment-antes-do-post é compromisso §16; órfãos tratados em
    `buildThread` (read path, futuro C.3).
  - **Ted #3 [FIX] deferido pra C.5**: semântica weight × cap no recalc
    de score (snapshot temporal). Não toca C.1 — score de comments só
    entra no scoring em C.5.
  - **Ted #4 [FIX] deferido pra C.3**: refcount lazy subscribe per
    postId. C.1 não subscribe — apenas persiste eventos kind 1111 que
    chegam pelo subscribe genérico do sync ativo.
  - **Barney HIGH #1 [FIX] resolvido**: sanity check em
    `persistCommentRow`. Top-level reply (parent kind=9078) onde `e[1]
    !== E[1]` ou `p[1] !== P[1]` é REJEITADO (silently dropped) —
    atacante não anexa replies cross-post pra free-ride visibilidade.
    Reply nested (parent kind=1111) é aceito com parent ≠ root porque
    parent comment pode estar em outra ordem de chegada (manifesto §16);
    `buildThread` resolve no read.
  - **Barney HIGH #3 [FIX] deferido pra C.5**: exclusão de
    `c.author_pub == post.author_pub` no recalc — só importa quando
    score consome comments (C.5).
  - **Bonus**: cap `COMMENT_MAX_CHARS = 1000` enforced no schema check
    (rejeita antes do INSERT) e no `protocol.commentOnPost` (rejeita
    antes do sign).

- **2026-05-07 v0.1**: Draft inicial. Decisões herdadas:
  - NIP-22 (kind 1111) reuse vs kind 9083 Drift-native — escolhido NIP-22
  - Lazy subscribe on PostViewer mount/unmount
  - Tabela `comments` com tree assembly determinístico no read path
  - Score weighted by commenter weight + cap por post
  - Cap visual 5 níveis de indentação
  - Pendente revisão crítica das 5 personas LLM antes de C.1.
