# Design — ThreadView com navegação swipe (Track C)

**Status:** Draft v0.2 · **Data:** 2026-05-07
**Companion:** [`comments.md`](comments.md) (RFC do protocolo, v0.3)
**Personas:** arquitetura por Ted, UX/a11y por Barney
**License:** CC0

> Este doc cobre a **camada de UX/UI** do Track C. Spec do protocolo
> (kind 1111, schema, score) está em [`comments.md`](comments.md).
> Aqui descrevemos como threads são **navegadas** — modelo swipe
> consistente com o resto do Drift (PostViewer já usa o padrão).

---

## 1. Modelo de interação

Cada comentário renderiza como um **card individual** ocupando o
viewport. Navegação 2D via swipe:

| Gesto | Ação | Direção visual |
|---|---|---|
| swipe ← (LEFT) | próximo irmão | card atual sai pra esquerda; próximo entra da direita |
| swipe → (RIGHT) | irmão anterior | card atual sai pra direita; anterior entra da esquerda |
| swipe ↑ (UP) | desce na hierarquia (vai pro **primeiro filho**) | card atual sobe; filho entra de baixo |
| swipe ↓ (DOWN) | sobe na hierarquia (vai pro **parent**) | card atual desce; parent entra de cima |

Equivalentes keyboard (a11y):

| Tecla | Ação |
|---|---|
| `H` ou `←` | irmão anterior |
| `L` ou `→` | próximo irmão |
| `K` ou `↑` | descer (primeiro filho) |
| `J` ou `↓` | subir (parent) |
| `Enter` | abrir reply form |
| `Esc` | fechar ThreadView |

Convenção H/J/K/L herda do PostViewer existente (Vim-like).

---

## 2. Modelo de estado

### 2.1. UI cursor (efêmero, React state local)

```typescript
interface ThreadCursor {
  /** Sequência de event ids do root até o nó atual.
   *  path[0] = top-level comment
   *  path[length-1] = comment atualmente visível
   *  Length ≥ 1. */
  path: string[]
}
```

Persistido em `useState` dentro de `<ThreadView>`. **Não é Zustand** —
escopo é o viewport único; reset quando ThreadView desmonta.

### 2.2. Tree materializada (Zustand store por aba)

```typescript
interface ThreadStore {
  /** Map plano de id → CommentNode. Lookup O(1). */
  nodes: Map<string, CommentNode>
  /** Adjacency: id → [child_ids ordenados]. Sort estável dentro. */
  childrenOf: Map<string, string[]>
  /** Top-level comments (reply_to === post_id). */
  roots: string[]
  /** postId que esta tree representa. */
  postId: string
  /** Geração — incrementada a cada mutação. UI listens pra
   *  invalidate cursor cache. */
  generation: number
}

// Em src/lib/comments.ts:
export const useThreadStore = create<ThreadStore>(...)
```

Tree é **projeção determinística** do conjunto de eventos kind 1111
em SQLite (manifesto §7). Cursor é UI state efêmero (igual `subpostIdx`
no PostViewer).

### 2.3. Sort determinístico

`buildThread` gera tree única para todos os clientes Drift dado o
mesmo conjunto de eventos:

```typescript
// dentro de cada bucket de irmãos:
sort((a, b) =>
  a.created_at !== b.created_at
    ? a.created_at - b.created_at  // ASC
    : a.id < b.id ? -1 : 1          // tie-break id ASC
)
```

Manifesto §7 (determinismo) — usuário A em Damus relay e usuário B em
nostr.wine veem mesma ordem.

---

## 3. Navegação 2D

### 3.1. Operações sobre cursor

```typescript
function nextSibling(cursor, store): ThreadCursor | null {
  const parent = cursor.path.length === 1
    ? store.roots                                // top-level
    : store.childrenOf.get(cursor.path.at(-2)!)
  const currentId = cursor.path.at(-1)!
  const idx = parent.indexOf(currentId)
  if (idx === -1 || idx === parent.length - 1) return null  // fim — clamp, não wrap
  return { path: [...cursor.path.slice(0, -1), parent[idx + 1]] }
}

function prevSibling(cursor, store): ThreadCursor | null { /* simétrico, idx-1 */ }

function descend(cursor, store): ThreadCursor | null {
  const childIds = store.childrenOf.get(cursor.path.at(-1)!) ?? []
  if (childIds.length === 0) return null
  return { path: [...cursor.path, childIds[0]] }  // primeiro filho
}

function ascend(cursor, store): ThreadCursor | null | 'exit' {
  if (cursor.path.length === 1) return 'exit'  // saiu do root → fecha ThreadView
  return { path: cursor.path.slice(0, -1) }
}
```

**Clamp, não wrap:** chegou no último irmão e tentou LEFT? No-op +
haptic feedback (igual SubpostCarousel atual). Wrap confunde —
manifesto §7 (previsibilidade > "magia").

### 3.2. Decisão UP-no-root vs UP-em-meio

UP sair do nível mais raso (top-level comment) **fecha** o ThreadView
e volta ao PostViewer. Preserva a metáfora "subir = sair":

- Em comment top-level (`path.length === 1`), UP fecha thread.
- Em comment aninhado, UP vai pro parent.

Botão close (`✕`) fixo no header é fallback alternativo — sempre
disponível, sem depender do gesture knowledge.

---

## 4. Render

### 4.1. Card stack (não fullscreen sozinho)

Reuso do **mesmo padrão visual do PostViewer**: card central + 1-2
shadow cards atrás (peek). No ThreadView:

- **Card central** — comment atual no `path.at(-1)`
- **Peek atrás (próximo irmão)** — scale 0.96, translateY 7px, opacity 0.4
- **Peek atrás (irmão depois desse)** — scale 0.92, translateY 14px, opacity 0.18
- **Peek embaixo (primeiro filho)** — translateY +14px, scale 0.92, opacity 0.4 (só se há filho)

Visual signals: usuário vê que tem mais conteúdo em todas as direções
sem precisar swipear pra descobrir (Barney HIGH #5 — discoverability).

### 4.2. Sticky header com breadcrumb

Top do ThreadView mostra contexto persistente (Barney HIGH #3 — perda
de contexto):

```
@alice › @bob › @você
3/47  ·  nível 4  ·  nova ↑ 2
```

- **Breadcrumb** = autores do `path[0..-1]` truncado se > 4 níveis
  (`@alice › … › @charlie › @você`)
- **Counter** = posição atual no nível (3/47 = "3º irmão de 47") +
  profundidade (nível 4 = path.length 4)
- **Badge "nova ↑ 2"** = N comments novos chegaram durante navegação
  (ver §5.3)

Header é shrink-0 ~56px. Card central recebe restante do espaço.

### 4.2.1 CommentCard com mídia (C.6.2 + C.6.3)

Quando o evento kind 1111 carrega `content-warning` e/ou `imeta`, o
card recebe affordances dedicadas:

```
┌─────────────────────────────────────────────┐
│ [⚠ spoiler]   ← badge fixo, topo do card    │
│                                             │
│ @alice · 2h                                 │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ │   [imagem renderizada via <Image/>]     │ │
│ │   (blurred se filter ativo)             │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ texto do comment, max 1000 chars...         │
│                                             │
│  ↵ responder                                │
└─────────────────────────────────────────────┘
```

**Badge content-warning (topo do card):**
- Pill compacto, cor depende do tipo (`nsfw` rosa, `violence`
  vermelho, `spoiler` âmbar, `ad` cinza).
- `aria-label="aviso de conteúdo: spoiler"`.
- Tap → toast com explicação + atalho pro toggle correspondente
  em `user_prefs`.

**Imagem (`<Image/>` reuso de Track B):**
- Componente `<Image meta={{ url, hash, mime, dim }} />` (Track B,
  `src/components/UI/Image.tsx`) é reusado sem mudanças. Hash
  verify SHA-256 obrigatório acontece dentro do componente.
- Cap visual: `max-height` 60% do card; `object-fit: contain`. Tap
  expande pra fullscreen viewer (mesmo padrão do PostViewer).
- `applyContentFilters` aciona blur quando filter da categoria
  ativo; overlay "tap pra mostrar" é override local UI-only (não
  toca SQLite).

**Combinado CW + imagem:** badge sempre visível; imagem blurred se
filter ativo. Texto fica abaixo, sem blur (texto não herda warning
— só a mídia visual).

**Determinismo:** mesma tree + mesmo `user_prefs` → mesmo conjunto
de cards visíveis vs blurred (manifesto §7). Toggle local "mostrar
mesmo assim" é `useState` efêmero, não persiste.

### 4.3. Reply button

Botão fixo bottom-right (FAB-like): `↵ responder`. Tap abre **bottom
sheet dedicada** (não card-stack), keyboard-aware. Quando user submete,
reply é publicado como kind 1111 com `reply_to: current.id`. Se publish
sucesso, badge "+1" no contador (não auto-navega — user decide quando
ver o próprio).

---

## 5. Performance e edge cases

### 5.1. Tree de 1k+ nós

Render NÃO renderiza tree inteira no DOM. Apenas:
- Card central (`path.at(-1)`)
- Vizinhos imediatos (1 prev sibling, 1 next sibling, parent, primeiro filho)
- Peek shadow cards (2 visuais, conteúdo é só silhueta)

Total DOM nodes: **~6 cards** independente do tamanho da tree.

### 5.2. Cap de comments por post (Barney HIGH #2)

SQL query carrega max **200 comments** por post no read (`LIMIT 200
ORDER BY created_at DESC`). Cap configurable em `user_prefs` (default
200). Beyond → "ver mais" pagina por `created_at < oldest_loaded`.

Per-author cap: máximo **3 comments do mesmo author_pub no display
inicial**. Mais que 3 → colapsa em "+N do mesmo autor" (clicável,
expande). Reduz Sybil flood visual.

### 5.3. Novo comment durante navegação

Subscribe entrega kind 1111 enquanto user está navegando:

1. **Não realocar cursor.** Tree muta (novo nó adicionado em
   `nodes`/`childrenOf`/`roots`); cursor.path continua válido.
2. **Header badge** "+N novos comentários" (não-intrusivo, swipe
   gesture continua disponível).
3. Tap no badge → recarrega snapshot da tree e mantém cursor no
   mesmo `path`. Se algum comment do path foi removido (raro:
   moderação chegou nesse intervalo), volta pro nó mais profundo
   ainda válido.

### 5.4. Comment moderado (score = -999)

Comment moderado **não é deletado** (manifesto §17). UI:

- No swipe LEFT/RIGHT, **pula** comments com score=-999 (skipa para
  o próximo válido).
- Se filhos dependem dele pra contexto, renderiza placeholder
  `[comentário oculto]` no path quando user passa pelo nível.
- Botão "ver oculto" no placeholder permite override local (UI-only,
  nunca toca SQLite).

### 5.5. Race: cursor aponta pra nó que sumiu

`buildThread` rebuild durante navegação pode invalidar `path`. Se
`path[i]` sumiu de `nodes`:

1. Truncate path até último id ainda válido.
2. Se path vira vazio (root sumiu), exit ThreadView.
3. Toast "comment removido — voltando pro nível anterior".

---

## 6. Animações

Reuso do timing PostViewer (mantém vocabulário visual unificado):

| Movimento | Easing | Duration |
|---|---|---|
| LEFT/RIGHT (siblings) | `[0.32, 0.72, 0, 1]` (ease padrão) | 0.32s |
| UP (descer pra filho) | `[0.34, 1.56, 0.64, 1]` (overshoot) | 0.36s |
| DOWN (subir pra parent) | `[0.32, 0.72, 0, 1]` | 0.32s |
| Exit (UP no root → fecha) | `[0.32, 0.72, 0, 1]` | 0.28s |

Overshoot só em UP-descer reforça sensação de "afundar" na hierarquia
— micro-feedback tátil que reforça o significado do gesto.

---

## 7. Acessibilidade (Barney HIGH #2)

### 7.1. Keyboard

Todas as ações têm equivalente keyboard (já tabulado em §1).

### 7.2. ARIA

```html
<div role="tree" aria-label="thread de comentários do post X">
  <div role="treeitem"
       aria-level={path.length}
       aria-posinset={siblingIdx + 1}
       aria-setsize={siblingCount}
       aria-expanded={hasChildren ? 'false' : undefined}
       tabIndex={0}>
    ...
  </div>
</div>
```

Screen reader anuncia: "comment de @alice, nível 3, 4 de 12 nesta
profundidade, expandível". Sem isso, DOM linear não comunica
hierarquia.

### 7.3. Reduced motion

`prefers-reduced-motion: reduce` → desabilita translate/scale dos
shadow cards, mantém só fade. Conformance test em
`tests/manifesto-conformance.test.ts` valida que componentes novos
respeitam.

---

## 8. Conflito semântico com PostViewer (Barney HIGH #1)

PostViewer já usa LEFT/RIGHT pra **subposts** dentro do post.
ThreadView usa LEFT/RIGHT pra **comments siblings**. Risco: usuário
não saber qual contexto.

**Mitigação:**

- ThreadView é **overlay** sobre PostViewer (z-index acima).
- Quando ThreadView ativo, **PostViewer fica congelado** (gestos
  desabilitados, blur sutil de 0.5px no fundo).
- Header do ThreadView visualmente distinto (border-top + bg
  drift-surface/95 + breadcrumb breadcrumbs próprios).
- Ao fechar ThreadView, retorna pro PostViewer no mesmo `subpostIdx`
  — não perde posição.

User entende: "estou navegando comments" vs "estou navegando subposts"
porque os escopos são visualmente disjuntos.

### 8.1. Como abrir ThreadView

Botão `💬 N` no PostViewer footer (já existe como placeholder).
Tap → ThreadView monta sobre PostViewer + lazy subscribe (REQ pro
relay) + cursor inicia em `roots[0]` (primeiro top-level comment) ou
"empty state" se zero comments.

---

## 9. Discoverability (Barney HIGH #5)

Primeira vez que user abre ThreadView:

1. Coach-mark animado mostra os 4 swipes (~3s loop) com legenda.
2. Persistido em `user_prefs.thread_coach_seen = true`.
3. Próximas aberturas: sem coach-mark.

Peek visual dos shadow cards (next sibling, first child) é hint
constante — usuário vê que tem mais sem precisar do coach.

---

## 10. Reply form

Bottom sheet dedicada (não card-stack):

- Tap em `↵ responder` no FAB → sheet sobe de baixo (~50% viewport).
- Conteúdo: textarea (max 1000 chars), tag autocomplete `@npub`,
  botão "publicar" + "cancelar".
- Reply é kind 1111 com `reply_to: cursor.path.at(-1)` (resposta
  ao comment atualmente visível).
- Sheet usa **gesture próprio** (drag-down to dismiss); NÃO usa o
  swipe do ThreadView (evita colisão Barney HIGH #6).

Keyboard automaticamente abre quando textarea recebe focus.

### 10.1 ReplySheet com imagem + content-warning (C.6.2 + C.6.3)

Sheet ganha duas affordances opcionais alinhadas com `comments.md`
v0.3 §3.6 e §3.7:

```
┌──────────────────────────── ReplySheet ────┐
│  responder a @alice                    ✕   │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │  [textarea max 1000 chars]             │ │
│ │                                        │ │
│ └────────────────────────────────────────┘ │
│                                            │
│  ⚠ aviso:  [nsfw] [violence] [spoiler] [ad]│
│            ↑ chips toggle, single-select   │
│                                            │
│  📎 anexar imagem  (cap 1)                 │
│  ┌────────────┐                            │
│  │ [preview]  │  remover ✕                 │
│  └────────────┘                            │
│                                            │
│              [cancelar]  [publicar]        │
└────────────────────────────────────────────┘
```

**Picker de content-warning (4 chips):**
- `nsfw | violence | spoiler | ad` — single-select (toggle 1 de 4
  ou nenhum). Espelha o picker já presente em ComposeOverlay (kind
  9078); reuso de `<ContentWarningPicker/>` com props idênticos.
- Default: nenhum selecionado (tag `content-warning` omitida).
- Aplica em ambas as camadas: ao texto e à imagem (se houver).
- Persistência: zero — pré-publish é estado local; pós-publish é
  serializado na tag `content-warning` do evento.

**Image upload (cap 1):**
- Reusa **mesmo flow** do ComposeOverlay (`uploadBlob` de Track B):
  compressão local → SHA-256 → tenta Helia + HTTP, retorna
  `{ url, hash, mime, size, dim }`.
- UI única slot (vs N slots no compose de post). Botão "📎 anexar
  imagem" desabilita após 1 imagem; user precisa remover pra trocar.
- Preview thumbnail no sheet com botão `✕ remover` (limpa local
  state, não publica nada ainda).
- EXIF strip + hash verify herdados sem código novo.
- Spinner "garantindo cópias..." durante upload (mesma cópia da
  ComposeOverlay).

**Estado pré-publish (local React state em `<ReplySheet>`):**
```typescript
interface ReplyDraft {
  text: string                     // max 1000 chars
  contentWarning: 'nsfw'|'violence'|'spoiler'|'ad'|null
  image: { url: string, hash: string, mime: string, dim?: string }|null
}
```

Submit chama `protocol.commentOnPost({ postId, replyTo, text,
contentWarning, blobs })` (signature já definida em `comments.md`
§4.2). Sheet fecha após publish OK; reply aparece via subscribe →
`onNostrEvent` → `useThreadStore` invalidate (mesmo loop de
qualquer comment).

**Falhas:**
- Upload falha → toast "falha ao subir imagem"; user pode tentar
  de novo ou remover anexo e publicar text-only.
- 2-confirmação de cópias não bate (Track B §5.5) → mesma UX da
  ComposeOverlay: "apenas 1 cópia disponível, publicar?".

**A11y:**
- Chip group com `role="radiogroup"` + `aria-label="aviso de
  conteúdo"`; cada chip `role="radio"`.
- Image input com `aria-label="anexar uma imagem ao comentário"`.
- Sheet mantém focus trap (já implementado no `<BottomSheet/>`).

---

## 11. Componentes

```
src/components/Post/
├── ThreadView.tsx          ← novo, overlay sobre PostViewer
├── ThreadHeader.tsx        ← breadcrumb + counter + new-badge
├── CommentCard.tsx         ← single comment render (replaces "node")
├── ReplySheet.tsx          ← bottom sheet pra publicar reply
└── (extends SwipeHandler.tsx — adiciona onUp/onDown opcionais)

src/lib/
├── comments.ts             ← useThreadStore + buildThread + cursor ops
└── thread-cursor.ts        ← funções puras nextSibling/prevSibling/etc.

src/hooks/
└── useThread.ts            ← lazy subscribe + cleanup; refcount per postId
```

`SwipeHandler` atual (`src/components/Post/SwipeHandler.tsx`) já tem
`onPrev/onNext`. Estender com `onUp/onDown` opcionais é
**non-breaking** (props opcionais). Validação Ted §reuso.

---

## 12. Testes

### 12.1. Funções puras

```typescript
// tests/thread-cursor.test.ts
describe('nextSibling', () => {
  it('avança no mesmo nível')
  it('clamp no último irmão (no-op, não wrap)')
})
describe('descend', () => {
  it('vai pro primeiro filho ordenado')
  it('null se sem filhos')
})
describe('ascend', () => {
  it('volta pro parent')
  it('retorna sentinel "exit" quando path.length === 1')
})
describe('buildThread', () => {
  it('determinístico — mesmo conjunto de eventos → mesma tree')
  it('replies órfãos viram top-level temporariamente')
  it('comment moderado (score=-999) presente mas marcado')
})
```

### 12.2. Conformance

```typescript
// adições em tests/manifesto-conformance.test.ts
it('ThreadView respeita prefers-reduced-motion')
it('SwipeHandler estendido mantém compat com PostViewer (props opcionais)')
it('cursor ops são funções puras (sem Date.now, sem random)')
```

### 12.3. Integration (manual smoke)

- Abrir ThreadView com 100 top-level comments
- Swipe LEFT 10x — não trava
- Swipe DOWN, depois UP — volta exatamente
- Novo comment chega via subscribe — badge aparece, cursor estável
- Esc fecha — volta pro PostViewer no mesmo subpostIdx
- Tab navegação keyboard funciona em todos os controls

---

## 13. Phasing (sub-fases dentro de C.4 + extensões C.6.x)

A spec do protocolo (`comments.md`) define C.0..C.6. Esta UI é o
escopo de **C.4** (~5-6h estimado) + extensões UI dos polish C.6.2
e C.6.3. Sub-fases internas:

| Sub | Scope | Esforço | Status |
|---|---|---|---|
| **C.4.1** | `useThreadStore` + buildThread + cursor ops puras + 20 testes | ~1.5h | ✅ |
| **C.4.2** | `<ThreadView>` shell + `<CommentCard>` + SwipeHandler estendido | ~1.5h | ✅ |
| **C.4.3** | `<ThreadHeader>` (breadcrumb + counter + new-badge) | ~1h | ✅ |
| **C.4.4** | `<ReplySheet>` + publish flow (text-only) | ~1h | ✅ |
| **C.4.5** | A11y (keyboard, ARIA, reduced-motion) + coach-mark + integration | ~1h | ✅ |
| **C.6.1** | Count prefetch (filter agregado) | ~1h | ✅ |
| **C.6.2** | `<CommentCard>` badge CW + `applyContentFilters` blur + `<ReplySheet>` chip group (§4.2.1, §10.1) | ~1h | ✅ |
| **C.6.3** | `<CommentCard>` `<Image meta>` render + `<ReplySheet>` upload slot (cap 1) (§4.2.1, §10.1) | ~1-2h | ✅ |

Cada sub é shippável independente. C.6.2 e C.6.3 são ortogonais: ship
um sem o outro funciona (cards sem CW renderizam normal; cards com
CW mas sem imagem só mostram badge).

---

## 14. Open questions

1. **Reply form: inline vs sheet** — escolhi sheet (Barney HIGH #6).
   Trade-off: sheet usa pouco espaço da tela mas exige tap extra pra
   abrir; inline (textarea sempre visível) reduz friction mas roubá
   espaço do card. Validar com user em C.4.4 prototype.

2. **Down vs Up semântica** — escolhi UP=descer (filho) e DOWN=subir
   (parent). Inverse intuition pra alguns: "subir na thread" pode
   significar ler de novo desde o início (parent → root). Decisão
   atual privilegia metáfora física: "afundar na hierarquia".
   Reabrir se user testing mostrar inversão.

3. **Card stack peek vs fullscreen** — escolhi peek (consistência
   com PostViewer). Trade-off: fullscreen dá mais espaço pro texto
   do comment, especialmente em mobile pequeno. Decidir baseado em
   tamanho médio dos comments na prática (~200 chars típico).

4. **Profundidade hard-cap** — sem limite no protocolo. Visual cap 5
   níveis com indentação satura (níveis 6+ flatten). Mas swipe DOWN
   pode ir indefinidamente. Hard cap em 20 níveis (proteção anti-troll
   reply-de-reply infinito)? Aceitar e ver se acontece na prática?

---

## 15. Issues que viraram blockers em comments.md

Ted e Barney identificaram itens em `comments.md` que precisam fix
antes de C.1 (schema):

- **Ted Issue #1 [BLOCK]** — `persistComment` deve ser inline em
  `onNostrEvent` (case kind === 1111), não função separada exportada.
  Invariante "única porta INSERT" (CLAUDE.md §1).
- **Ted Issue #2 [FIX]** — Remover FK `comments.post_id REFERENCES
  posts(id)`. Race comment-antes-do-post existe e é compromisso §16.
  Usar índice simples; `buildThread` já trata órfãos.
- **Ted Issue #3 [FIX]** — Documentar semantics de `weight × cap` no
  recalc: snapshot temporal vs current weight. Atualmente
  `MIN(weight) GROUP BY author_pub` é não-determinístico se weight
  muta no tempo. Espelhar `applySpread`.
- **Ted Issue #4 [FIX]** — Refcount lazy subscribe per postId.
  Múltiplos consumers (PostViewer + ThreadView + prefetch C.6) abrem
  REQ duplicado.
- **Barney HIGH #1 [FIX]** — Sanity check em persistComment: validar
  `E[1] === post_id` e `reply_to` existe em comments daquele post.
  Sem isso, atacante anexa replies cross-post free-riding visibilidade.
- **Barney HIGH #3 [FIX]** — Excluir `c.author_pub == post.author_pub`
  no recalc (post author comentando no próprio post = boost grátis).

Estes vão pra `comments.md` v0.2 antes de qualquer código de C.1.

---

## 16. Histórico

- **2026-05-07 v0.2**: Extensões UI pra C.6.2 + C.6.3:
  - §4.2.1 `CommentCard` com badge `content-warning` + render
    `<Image/>` reusado de Track B + blur via `applyContentFilters`.
  - §10.1 `ReplySheet` com chip group de CW (single-select de
    `nsfw|violence|spoiler|ad`) + upload slot (cap 1 imagem,
    pipeline `uploadBlob` reusada).
  - §13 phasing atualizado pra incluir C.6.1/6.2/6.3 com status ✅.
  - Companion bumped pra `comments.md` v0.3.
  - Sem mudança nas decisões de cursor, swipe, ou ARIA.

- **2026-05-07 v0.1**: Draft inicial. Sintetizou:
  - Spec swipe do user (LEFT/RIGHT siblings, UP/DOWN hierarquia)
  - Arquitetura Ted (cursor model, render lazy, animações, reuse SwipeHandler)
  - UX critique Barney (a11y keyboard, breadcrumb, race, discoverability,
    reply sheet, conflito PostViewer)
  - 6 issues blocker pra `comments.md` v0.2 listados em §15
