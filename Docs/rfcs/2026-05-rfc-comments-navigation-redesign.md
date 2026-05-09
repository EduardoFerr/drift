# RFC — Comments Navigation Redesign (paradigm shift)

**Status:** Draft · pending Arquiteto decision (§10)
**Author:** Robin (HIMYM persona — research, curadoria, gaps cross-cutting, docs)
**Date:** 2026-05-09
**Track:** C (NIP-22 comments) — paradigm shift on top of P0/P1/P2 polish
**Predecessors:**
- [`Docs/sessions/comments-ux-audit-2026-05-08.md`](../sessions/comments-ux-audit-2026-05-08.md) — UX audit (15 findings, S0 paradigm flagged em UX-1)
- F-19 do Barney friction audit (S0)
- [`Docs/design-comments.md`](../design-comments.md) v0.2 — spec atual (card-stack)
- [`Docs/comments.md`](../comments.md) v0.3 — protocol/data layer
**License:** CC0 1.0 Universal

> **User trigger 2026-05-09:** *"a navegabilidade entre os comentários e
> subcomentarios está horrivel, analise os melhores casos de uso"*.
>
> Esta RFC consolida UX-1 da Robin audit (S0) + F-19 Barney (S0) numa
> spec implementável. Tom: research neutro, decisão proposta firme.
>
> **Restrição:** doc-only. Sem código novo, sem renomear feature, sem
> protocol change. NIP-22 + kinds 9078..9081 + scoring + persistência
> ficam intactos.

---

## TL;DR (90 segundos)

Card-stack swipe-driven (modelo Tinder pra texto curto aninhado) é
**inadequado pra conversação aninhada** quando a thread tem >5 comments
ou >2 níveis. User comum:
- não consegue ver a thread inteira em relance
- não tem dica de breadth/depth da árvore
- precisa atravessar card-a-card por swipe
- esquece coach mark (3-6s, one-shot por session)
- confunde semântica de swipe (↑ "espalha" no PostViewer vira "afunda" em ThreadView)

**Recomendação:** **adotar list-mode como default** com cards-mode como
toggle opt-in pra "navegação imersiva". Migração via `comments_view_mode`
em `user_prefs`, default `'list'` pra users novos; users existentes
mantêm cards (preserva muscle memory) com banner "experimente novo modo
lista" first-launch após upgrade.

**Top 3 prior art:** Reddit (collapse + indent + lazy "load more replies"),
HackerNews (deep collapse `[-]` + indent agressivo), Slack/Discord
(side-panel reply preserva contexto parent). Detalhes em §2.

**Migration effort:** ~10-15h Lily Round 5 ou sprint separado de
3-4 dias. Schema unchanged. Tests determinísticos preservados.

---

## §1 — Problema atual (estado de hoje)

### 1.1 Snapshot técnico

`ThreadView.tsx` (508 linhas) é um overlay z-60 sobre PostViewer que:

- Renderiza **um** `CommentCard` central + 2-3 peek shadow cards
  (silhuetas vazias) atrás (`ThreadView.tsx:286-317`).
- DOM constante ~3 cards independente do tamanho da árvore (design §5.1
  "lazy render").
- Cursor é `path: string[]` (sequência de IDs do root → folha)
  mantido em `useState` local. Reset ao desmontar.
- Navegação:
  - swipe ←/H → `prevSibling`
  - swipe →/L → `nextSibling`
  - swipe ↑/K → `descend` (afunda na hierarquia)
  - swipe ↓/J → `ascend` (sobe pro parent; no root → exit com shake 220ms)
  - Esc → fecha tudo (sem graduação)
  - Enter → abre ReplySheet
- Coach mark overlay 3s na primeira abertura, irreversível
  (`thread_coach_seen` em `user_prefs`).

### 1.2 Fricção mensurada

Da [`comments-ux-audit-2026-05-08.md`](../sessions/comments-ux-audit-2026-05-08.md)
(15 findings, S0+S1+S2):

| User story | Fricção hoje | Origem |
|---|---|---|
| US-1 ler thread inteira rapidamente | **alta** | UX-1 (S0) — single card no viewport |
| US-2 onde estou | OK | breadcrumb + counter funcionam |
| US-3 responder com contexto | **alta** | UX-3, UX-4 — FAB sem nome do alvo, race no replyTo |
| US-4 distinguir novo/antigo | **fricção** | UX-5, UX-6 — sem marca por card, baseline reseta |
| US-5 alternar subposts/comments | OK | overlay z-60 preserva PostViewer state |
| US-6 fechar e voltar | **fricção** | UX-8 + UX-12 — swipe ↓ no root fecha (inverte intuição) |
| US-7 responder ao post (não comment) | **fricção** | UX-9 — só visível em thread vazia |

Thread com 50+ comments organizados em sub-threads vira **labirinto**:
discoverability requer aprendizado proprietário do swipe, não há overview.

### 1.3 Sintomas concretos relatados / observados

- "1/1 NÍVEL 1" no header é críptico (TX-5 fixou parcialmente — agora
  mostra título do post quando `post` prop disponível, mas counter +
  nível continuam crípticos pra newcomer).
- Subcomments só descobertos por swipe ↑ no parent — sem "+N respostas"
  visualmente expandido por default.
- Coach mark dispara, dismiss em 3s, sem reabrir sem clearing
  `localStorage` (UX-7). User que pisca perde.
- Peek shadow cards são `bg-drift-surface` puro sem texto — teaser sem
  entrega (UX-2).
- SwipeHandler atende 3 paradigmas (PostViewer SPREAD/BURY,
  ThreadView descend/ascend, ReplySheet drag-to-dismiss) — muscle
  memory colide.

---

## §2 — Best-in-class research (concrete prior art)

Pra cada produto: features, o que funciona, o que não funciona, fit
com Drift. Critérios de fit: mobile-first (max-w-md), swipe-native,
sem "for you" feed, manifesto §22 score determinístico, sem trackers.

### 2.1 Reddit (web + iOS/Android)

**Features relevantes:**
- Nested threading com indent visual progressivo (12-16px/level até
  ~6 níveis, depois plateau).
- `[-]` collapse toggle inline em todo comment; collapse persistente
  por sessão.
- "Load more replies (N)" lazy expand quando subtree grande
  (>3 children).
- Sort selector: best/top/new/controversial/old/Q&A — aplicado por
  comment subtree.
- "Continue this thread →" jump quando depth ≥ 8.
- Permalink no timestamp (URL hash navegável).

**O que funciona:**
- Lazy expand evita render explosion. User decide o que abrir.
- Indent moderado dá sense of structure sem fragmentar.
- Collapse `[-]` é ação reversível, baixíssimo cost.

**O que não funciona:**
- Em mobile com indent agressivo, deep nest fica claustrofóbico
  (text width <40 chars).
- Sort selector adiciona complexidade — Drift §22 rejeita
  personalização.

**Fit com Drift:** **alto.** Indent + collapse + lazy expand são
core. Sort selector NÃO entra (manifesto §22 score determinístico).
"Continue this thread" jump é elegante pra cap visual de depth.

### 2.2 Twitter/X

**Features relevantes:**
- Linear timeline por reply chain (não nested visual).
- Indent visual sutil via "thread line" vertical (1px) que conecta
  parent → reply.
- "Show more replies" botão sutil quando reply tem children não
  carregados.
- "Show this thread" jump quando user está num reply isolado e quer
  ver root + chain.
- Reply context preview: ao clicar reply, abre nova view com parent
  no topo + reply focado + children abaixo.

**O que funciona:**
- Thread line é overhead visual mínimo, suficiente pra mostrar
  conexão.
- "Show this thread" resolve disorientation quando user chega via
  notification num node profundo.

**O que não funciona:**
- Linear flat (sem indent real) perde estrutura quando há multiple
  reply branches sob mesmo parent.
- Algoritmo opaco decide "ver mais respostas" — não-determinístico.

**Fit com Drift:** **médio.** Thread line é polish que vale; "show
this thread" jump-to-root entra. Linear flat NÃO substitui indent
(Drift tem branching real).

### 2.3 Bluesky

**Features relevantes:**
- Threading similar Twitter mas com indent moderado real (8-12px).
- "Context" pin no topo: ao abrir reply isolado, mostra parent
  expandido como contexto.
- Mute/block per-thread — não affect ranking, só visualização local.

**O que funciona:**
- "Context" pin é forma elegante de preservar parent visível
  durante navegação focada (similar Slack side-panel).

**Fit com Drift:** **alto.** Context pin alinha com manifesto §28
(privacy default — visualização local) e UX-3 (contexto de reply
explícito).

### 2.4 Mastodon

**Features relevantes:**
- Timeline com indent moderado (6-10px) por reply chain.
- "Show N more replies" lazy expand inline.
- Thread visualization opcional (`?` toggle): tree vs linear.
- Federation handles (`@user@instance`) explícitos no header.

**O que funciona:**
- Toggle tree/linear oferece escolha sem default opinativo.
- Federation handle alinha com Drift "anonimato por design" (§28) —
  user pode mostrar identity de fora se quiser.

**Fit com Drift:** **médio.** Toggle tree/linear é overhead pra
Drift mobile-first. Mas `?` toggle precedente pra suportar UI
de modo (list/cards/hybrid).

### 2.5 Threads (Meta)

**Features relevantes:**
- **Linear flat reply list**, sem indent visual.
- Conversation-as-stream: cada reply tratado como "post novo" com
  parent linkado no header (`replying to @user`).
- Não há collapse — user scrolla tudo.

**O que funciona:**
- Cognitive load mínimo pra leitura linear.
- Bom pra conversação curta (2-3 níveis max).

**O que não funciona:**
- Branching real (3+ replies sob mesmo parent) fica indistinguível.
- Deep nest (5+ níveis) impossível de mapear.

**Fit com Drift:** **baixo.** Drift tem branching real e a tese
manifesto §22 valoriza score por comment — flatten apaga estrutura.
**Não adotar.**

### 2.6 HackerNews

**Features relevantes:**
- Indent agressivo (40px/level).
- `[-]` collapse persistente por sessão.
- Cap depth via indent plateau quando width esgota — mas mantém
  threading lógico.
- Score visível em cada comment (points), determinístico.

**O que funciona:**
- Score visible alinha 1:1 com manifesto §22 (deriva por comment
  determinístico).
- Collapse + indent é referência clássica de threaded discussion.

**O que não funciona:**
- Indent 40px é desktop-only; quebra em mobile.
- Sem lazy load — long thread renderiza tudo (perf bottleneck pra
  Drift max-w-md + virtualized concern).

**Fit com Drift:** **alto** pro espírito (indent + collapse + score
visível), **médio** pra implementação (precisa indent moderado +
lazy/virtualized).

### 2.7 Discord

**Features relevantes:**
- Threads são entidade separada do canal — abre em side panel
  (desktop) ou full-screen secundário (mobile).
- Linear dentro da thread; sem nesting de replies.
- "View parent message" pin no topo da thread.

**O que funciona:**
- Side panel preserva canal visível; user vê contexto duplo.
- Limite de 1 nível de aninhamento simplifica cognitive load.

**O que não funciona:**
- Drift tem aninhamento real (NIP-22 permite arbitrary depth) —
  flatten artificial não cabe.

**Fit com Drift:** **baixo** pro modelo, **médio** pro polish do
"parent pin" como context preserver durante reply.

### 2.8 Slack

**Features relevantes:**
- Replies abrem side panel; parent message permanece visível no
  canal principal.
- Reply count + face pile inline ("3 replies, last by @alice").
- "Also send to channel" toggle no reply (broadcast opcional).

**O que funciona:**
- Side panel é gold standard pra "responder sem perder contexto".
- Reply count + face pile dá overview sem expandir subtree.

**O que não funciona:**
- Side panel exige viewport ≥2 colunas — Drift mobile-first
  max-w-md não comporta.

**Fit com Drift:** **médio.** Padrão side-panel não cabe em mobile
single-column. Mas "parent pin sticky" durante reply replica o
benefício essencial.

### 2.9 Síntese — features que entram no design Drift

| Feature | Origem | Justificativa Drift |
|---|---|---|
| Indent moderado (4-8px/level) | Reddit, Mastodon, HN | Estrutura visível sem claustrofobia em max-w-md |
| Collapse `[-]` por subtree | Reddit, HN | User decide cognitive load |
| Lazy expand "+N respostas" | Reddit, Mastodon | Já shipado UX-11 — mantém |
| Thread line vertical conectiva | Twitter | Polish: 1px borda mostra parent→child sem espaço |
| Jump-to-parent pill (depth ≥3) | Twitter "show this thread", Bluesky context | Resolve disorientation em deep nest |
| Parent pin sticky durante reply | Slack, Bluesky | Context preserve, aborda UX-3 |
| Score visible por comment | HN | Manifesto §22 (deriva determinística por comment) |
| Cap visual de depth (plateau) | HN, Reddit | max-w-md mobile não comporta indent infinito |
| Permalink/anchor por comment | Reddit | Future-proof pra share-link (Fase 6+) |

| Feature | Origem | NÃO entra | Justificativa |
|---|---|---|---|
| Sort selector (best/top/new) | Reddit | ❌ | Manifesto §22 rejeita personalização |
| Linear flatten (sem indent) | Threads | ❌ | Apaga branching real |
| Side panel | Slack, Discord | ❌ | Mobile single-column |
| "For you" reply ranking | X, Threads | ❌ | Manifesto §24 |
| Indent agressivo 40px | HN | ❌ | Mobile-first |

---

## §3 — Critérios de design pra Drift

Hard constraints (não negociáveis):

1. **Mobile-first**: max-w-md (448px) primeiro; desktop é
   acomodação. Touch targets ≥44px (WCAG).
2. **Swipe-native**: gestos continuam disponíveis pra users que
   internalizaram. Mas **NÃO** primary pra discoverability.
3. **Manifesto §22 — score determinístico**: deriva por comment
   visível, calculada com `calculateScore(spreads, buries,
   created_at, now)` puro. Sem ML, sem personalização.
4. **Manifesto §27 — content-warning per-comment**: tag
   `content-warning` respeitada em comments igual posts; blur por
   default, override local opt-in.
5. **Manifesto §28 — privacy default**: sem view counts trackeable,
   sem read receipts, sem analytics de leitura.
6. **A11y baseline**: keyboard nav (J/K/L/H + setas + Tab + Enter +
   Esc), `role="tree"` ou `role="list"` (depending on mode), ARIA
   level/posinset/setsize, focus management, screen reader announce
   de mudanças.
7. **Reduced motion fallback**: animações degradam pra fade simples
   ou no-motion (`useReducedMotion` + `motion-reduce:` Tailwind).
8. **Performance**: thread com 200+ comments precisa scroll fluido.
   Virtualized list (`react-virtual` ou similar) ou windowing
   manual.
9. **Determinismo §7**: ordenação `buildThread` (`thread-cursor.ts:61-67`)
   continua determinístico — sort + tie-break stable.
10. **NIP-22 unchanged**: kind 1111 + tags `e/E/p/P/k/K` permanecem.
    Schema SQLite `comments` table inalterado.

Soft preferences (escolha de design):

- **List-mode default** pra users novos; cards-mode opt-in.
- **Existing users** mantêm cards (preserva muscle memory) até
  toggle explícito.
- **Indent visual** progressivo até depth 4, plateau após.
- **Tap = focus + open reply target** (não consome swipe).

---

## §4 — Proposta de redesign — paradigma híbrido

Adoção de **list-mode default** com **cards-mode como toggle**. Não é
substituição — é mudança de default. Cards continua disponível pro
user que prefere imersão swipe.

### 4.1 List-mode (default, novo)

Layout vertical scrollable. Elementos:

```
┌─────────────────────────────────────┐
│ ThreadHeader                         │  ← sticky top (mantém)
│   ← post título | 47 | +3 novos      │
│                              [≡][?][✕]│
├─────────────────────────────────────┤
│                                      │
│ ▌@alice · 2h · ▲12 ▼1                │  ← top-level (no indent)
│  comment text aqui...                │
│  ↳ 5 respostas              [tap]    │  ← lazy expand
│                                      │
│   ▌@bob · 1h · ▲4 ▼0  [-]            │  ← depth 1, indent 6px
│    reply text aqui...                │  ← border-left thread line
│    ↳ 2 respostas            [tap]    │
│                                      │
│     ▌@charlie · 30m · ▲1 ▼0          │  ← depth 2, indent 12px
│      nested reply...                 │
│      (sem mais replies)              │
│                                      │
│ ─────────────────────────             │  ← divisor entre top-levels
│ ▌@dave · 10m · ▲0 ▼0  ⓘ NEW          │  ← isNew dot
│  next top-level...                   │
│                                      │
└─────────────────────────────────────┘
                  ┌─────────────────┐
                  │ ↵ comentar      │  ← FAB (top-level reply)
                  └─────────────────┘
```

**Mecânica:**

- **Indent progressivo**: 0 / 6 / 12 / 18 / 24px (depth 0..4),
  plateau em 24px após. Border-left 1px `drift-border` conecta
  parent → children visualmente (thread line).
- **Tap em comment** → `focus state` (border accent) + abre
  ReplySheet com **target snapshot** = esse comment. Não consome
  swipe; não navega.
- **Long-press** → action menu (similar PostViewer 3-dot):
  copiar texto, copiar link (futuro), reportar, mute autor local.
- **Collapse/expand inline**: `[-]/[+]` toggle ao lado do header
  do comment. Persistente por sessão (Map<commentId, boolean> em
  store local). Default expanded.
- **"+N respostas" tap** (UX-11 já shipado) → expande subtree
  inline (lazy render). Botão muda pra `[-] N respostas`.
- **Score visible por comment**: `▲{spreads} ▼{buries}` next to
  author + timestamp. Manifesto §22.
- **isNew indicator**: comment com `created_at >= lastVisit`
  mostra `ⓘ NEW` chip ou border-left `drift-accent2` (UX-5 já
  proposto).
- **Jump-to-parent pill**: quando user scrolla pra dentro de um
  subtree e o parent saiu do viewport, sticky pill no topo do
  subtree: `↑ @alice (parent)`. Tap → scroll-to + focus parent.
- **Breadcrumb sutil top** (já existe em ThreadHeader): `Post →
  @alice → @bob` quando focus state ativo em comment depth ≥2.
- **Swipe horizontal apenas em comment focado**: não navega tree.
  Reservado pra ações futuras (mark read, dismiss). Vertical scroll
  é nativo.

**A11y:**

- `role="list"` no container; `role="listitem"` por comment.
- ARIA `aria-level={depth+1}`, `aria-posinset`, `aria-setsize`.
- Keyboard:
  - `↑ / k` → previous comment in flat order
  - `↓ / j` → next comment in flat order
  - `← / h` → collapse current subtree (or jump to parent)
  - `→ / l` → expand current subtree (or descend)
  - `Enter` → reply to focused comment
  - `Esc` → close ThreadView (or unfocus)
  - `r` → reply (alias Enter)
  - `t` → top of thread
  - `g` → bottom
- `aria-keyshortcuts` declarado no container (UX-15 fix).

### 4.2 Cards-mode (atual, opt-in)

Comportamento atual preservado **integralmente**. Toggle no header
`[≡]` ⇄ `[▭]` permite switch on demand. Persistido em
`user_prefs.comments_view_mode`.

Cards-mode é apropriado pra:
- threads pequenas (1-5 comments) onde imersão é bem-vinda
- users que internalizaram swipe e preferem speed
- modo "discussão imersiva" pra um thread específico

### 4.3 Reply context preserved

Em ambos os modos:

- Tap "↵ responder" / FAB → abre ReplySheet
- **Snapshot do target ao abrir** (UX-3, UX-4): `replyTarget` é
  capturado em ref local; cursor mover não muda.
- Header da sheet: `respondendo a @{nickname || shortNpub}` +
  blockquote dos primeiros 100 chars do comment alvo (UX-3).
- Em list-mode: parent fica visível atrás da sheet (sheet é
  bottom sheet, ocupa ~60vh — top 40vh mostra thread). Em
  cards-mode: parent é o card central, idem.

### 4.4 Transições list ⇄ cards

Toggle `[≡]/[▭]` no header preserva foco:
- list → cards: focused comment vira `cursor.path` (calcula path
  do node ao root). Coach mark NÃO reabre.
- cards → list: `cursor.path.at(-1)` vira focused comment; scroll
  pra esse position com `scrollIntoView({block: 'center'})`.

---

## §5 — Mockups ASCII (telas)

### 5.1 Thread com 5 top-levels + 2 subreplies cada (list-mode)

```
┌────────────────────────────────────┐
│ ← post: "rustup com tor" │ 12 │ +0 │
│                       [≡][?][✕]    │
├────────────────────────────────────┤
│                                    │
│ ▌@alice · 4h · ▲8 ▼1               │
│  funcionou perfeito aqui no Tails. │
│  precisei só do gpg key import.    │
│   ↳ 2 respostas         [tap pra ver]│
│                                    │
│ ─────────────────────              │
│ ▌@bob · 3h · ▲5 ▼0                 │
│  no Whonix tive que ajustar        │
│  socks proxy port.                 │
│   ↳ 2 respostas         [tap pra ver]│
│                                    │
│ ─────────────────────              │
│ ▌@carol · 2h · ▲3 ▼0               │
│  só no Linux ou windows também?    │
│   ↳ 2 respostas         [tap pra ver]│
│                                    │
│ ─────────────────────              │
│ ▌@dave · 1h · ▲2 ▼0  ⓘ NEW         │
│  obrigado, salvou minha tarde      │
│   ↳ sem respostas                  │
│                                    │
│ ─────────────────────              │
│ ▌@eve · 30m · ▲0 ▼0  ⓘ NEW         │
│  faltou citar reproducible build   │
│   ↳ 2 respostas         [tap pra ver]│
│                                    │
└────────────────────────────────────┘
                  ┌────────────┐
                  │ ↵ comentar │
                  └────────────┘
```

### 5.2 Thread vazio (list-mode)

```
┌────────────────────────────────────┐
│ ← post: "rustup com tor" │ 0       │
│                          [≡][?][✕] │
├────────────────────────────────────┤
│                                    │
│                                    │
│        sem comentários ainda       │
│                                    │
│        seja a primeira voz         │
│                                    │
│        ┌────────────┐              │
│        │ ↵ comentar │              │
│        └────────────┘              │
│                                    │
│                                    │
└────────────────────────────────────┘
```

(Único CTA central — preserva fix de UX já shipado em
`5ff16b2 fix(thread): coach pointer-events-none + hide redundant
CTAs on empty`. FAB hidden when empty.)

### 5.3 Thread deep nested (depth 5+, list-mode)

```
┌────────────────────────────────────┐
│ ← post: "manifesto rev" │ 23 │ +1  │
│                       [≡][?][✕]    │
├────────────────────────────────────┤
│ ↑ @alice (parent)         [pill]   │  ← sticky jump-to-parent
├────────────────────────────────────┤
│                                    │
│   ▌@bob · ▲4 ▼0                    │
│    ↳ "concordo com..."             │
│                                    │
│     ▌@carol · ▲2 ▼0                │
│      ↳ "mas e o caso..."           │
│                                    │
│       ▌@dave · ▲1 ▼0  [focused]    │  ← border accent
│        ↳ "depende de..."           │
│        ↳ 1 resposta     [-]        │
│                                    │
│        ▌@eve · ▲0 ▼0               │  ← depth 4, plateau
│         ↳ "sim, exatamente"        │
│                                    │
│         ▌@frank · ▲0 ▼0            │  ← depth 5, mantém plateau
│          ↳ "+1"                    │
│                                    │
└────────────────────────────────────┘
                  ┌─────────────────┐
                  │ ↵ responder dave│  ← FAB nominal
                  └─────────────────┘
```

Indent plateau após depth 4 (24px). "↑ @alice (parent)" pill no top
permite jump-to-root quando user scrollou pra dentro do subtree.

### 5.4 Thread com SPOILER hidden + reveal (list-mode)

```
┌────────────────────────────────────┐
│ ← post: "review livro" │ 8         │
│                       [≡][?][✕]    │
├────────────────────────────────────┤
│                                    │
│ ▌@alice · 1h · ▲3 ▼0               │
│  livro foi ótimo, recomendo!       │
│                                    │
│ ─────────────────────              │
│ ▌@bob · 45m · ▲2 ▼0  ⚠ SPOILER     │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          │  ← blur
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓ [tap pra revelar]   │
│                                    │
│ ─────────────────────              │
│ ▌@carol · 30m · ▲1 ▼0              │
│  resposta normal                   │
│                                    │
└────────────────────────────────────┘
```

Tap em "[tap pra revelar]" remove blur localmente (override de sessão,
não persiste — manifesto §28). Manifesto §27 respeitado.

### 5.5 Thread mid-reply (sheet aberto, parent context preserved)

```
┌────────────────────────────────────┐
│ ← post: "rustup tor" │ 12          │
│                       [≡][?][✕]    │
├────────────────────────────────────┤
│ ▌@alice · 4h · ▲8 ▼1               │  ← top, visível
│  funcionou perfeito aqui no Tails. │
│  precisei só do gpg key import.    │
├────────────────────────────────────┤
│ ╭─ respondendo a @alice ──────────╮│  ← sheet header
│ │ > "funcionou perfeito aqui no   ││  ← quote 100 chars
│ │   Tails. precisei só do gpg..." ││
│ ├─────────────────────────────────┤│
│ │                                 ││
│ │ [textarea]                      ││
│ │                                 ││
│ │                                 ││
│ ├─────────────────────────────────┤│
│ │ [⚠ CW] [📎 imagem]   [publicar] ││
│ ╰─────────────────────────────────╯│
└────────────────────────────────────┘
```

Sheet ocupa ~60vh. Top 40vh mostra parent comment + título do post —
contexto preservado. Snapshot do target ao open; cursor mover não
muda (UX-3, UX-4 fix).

---

## §6 — Migration plan

### 6.1 Arquitetura atual → nova

**State management:**

| Atual (cards) | Novo (list) | Mudança |
|---|---|---|
| `cursor: { path: string[] }` | `focusedId: string \| null` | Substitui path-traversal por ID flat |
| Sem `expandedSet` | `expandedSet: Set<commentId>` | Novo state pra collapse/expand |
| Sem scroll position | `scrollY: number` (preservado em ref) | Novo: restore scroll ao toggle modo |
| `viewMode: 'cards'` (implicit) | `viewMode: 'list' \| 'cards'` (em user_prefs) | Pref persisted |

**Components que mudam:**

- **`ThreadView.tsx`** (508→~600 linhas): rework do body. Adiciona
  conditional render por `viewMode`. List-mode usa virtualized list
  (sugestão `@tanstack/react-virtual`). Cards-mode permanece intacto.
- **`CommentCard.tsx`** (300→~360 linhas): adiciona props
  `expanded`, `onToggleExpand`, `mode`, `indentLevel`, `isFocused`,
  `onTap`, `onLongPress`. Render adapta:
  - cards-mode: idem hoje (fullscreen card)
  - list-mode: compacto, sem fullscreen, com indent + thread line
- **`ThreadHeader.tsx`** (216→~250 linhas): adiciona toggle
  `[≡]/[▭]` pra alternar modo. Breadcrumb expandido quando
  list-mode + focus em depth ≥2.
- **`SwipeHandler.tsx`**: uso reduzido. Em list-mode, swipe não
  navega tree (vertical scroll nativo, horizontal reservado pra
  ações futuras). Cards-mode mantém integralmente.

**Components/lib que NÃO mudam:**

- `useThread.ts` (75 linhas) — hook lifecycle
- `comments.ts` store + `buildThread` + subscribe lazy
- `thread-cursor.ts` (operações `nextSibling`/`prevSibling`/
  `descend`/`ascend` continuam usadas em cards-mode)
- `thread-header.ts` (siblingPosition, countNewSince)
- `scoring.ts` (manifesto §7 determinismo)
- `ReplySheet.tsx` (target snapshot já recomendado em UX-3, UX-4)
- Schema SQLite (`comments`, `comment_reactions`, etc.)
- NIP-22 protocol (kinds, tags)

### 6.2 user_prefs schema

Adicionar campo em `user_prefs`:

```typescript
// src/types/user-prefs.ts
export interface UserPrefs {
  // ... existing fields
  comments_view_mode?: 'list' | 'cards' // default 'list' for new users
  comments_expanded_threads?: Record<string, string[]> // postId → expanded comment IDs
}
```

Migration: feature `prefs.ts` setPref handles missing field
gracefully (default `'list'` pra novos users; users existentes
fallback `'cards'` se `thread_coach_seen === true`, senão `'list'`).

### 6.3 Tests novos

Em `tests/`:

- `tests/comments-list-mode.test.ts` — pure functions de flat
  ordering, indent calc, expandedSet manipulation.
- `tests/manifesto-conformance.test.ts` — adicionar regra: lista
  não introduz scoring "for you" (continua determinístico).
- E2E manual: cobertura em `Docs/sessions/comments-list-mode-qa.md`
  (cap 5 cenários: 5 top-levels, deep nest, spoiler reveal,
  toggle list⇄cards, virtualized scroll perf).

### 6.4 Effort estimate

| Task | Owner | Hours |
|---|---|---|
| ThreadView body rework + viewMode toggle | Lily | 4-5h |
| CommentCard list-mode variant | Lily | 2-3h |
| ThreadHeader toggle + breadcrumb expand | Lily | 1h |
| user_prefs schema + migration | Marshall | 0.5h |
| Virtualized list integration | Lily | 1.5-2h |
| Collapse/expand state mgmt | Lily | 1h |
| A11y review + ARIA + keyboard nav | Lily + Robin | 1h |
| Tests pure (flat ordering, indent) | Marshall | 1h |
| Manual QA cenários | Robin | 1h |
| Doc update design-comments.md v0.4 | Robin | 1h |
| **Total** | | **~14-16h** |

Equivale a ~Round 5 da Lily (1 sprint focado) ou 3-4 dias dedicados.

### 6.5 Rollout strategy

**Opção A — Replacement direto (NÃO recomendado):**
- Risco: muscle memory de users existentes quebra sem aviso.
- Pro: simplifica codebase (manter dois modos é overhead).
- Contra: viola princípio "user em primeiro lugar".

**Opção B — Feature flag opt-in (NÃO recomendado isoladamente):**
- Risco: novos users veem cards (mantém problema UX-1 S0 pra maioria).
- Pro: zero ruptura.
- Contra: defeat the purpose — fix S0 não chega no maior público.

**Opção C — Default por cohort (RECOMENDADO):**
- Novos users (sem `thread_coach_seen`): default `'list'`.
- Users existentes (com `thread_coach_seen === true`): default
  `'cards'` + banner first-launch pós-upgrade: *"experimente o novo
  modo lista pra ver toda a thread em relance — toggle no header
  ≡/▭"*. Banner dismiss persistent.
- Ambos podem alternar livremente via header toggle.

Opção C é a recomendação. Migration "natural" — quem aceita testa,
quem não, fica.

---

## §7 — Comparação UX swipe-stack atual vs list-mode proposto

| Métrica | Card-stack atual | List-mode proposto |
|---|---|---|
| Time to find specific reply | high (sequential card-a-card) | low (skim vertical) |
| Cognitive load entender estrutura da árvore | high (precisa atravessar) | low (visual instant) |
| Deep nest discoverability (depth ≥3) | low (esconde até swipe ↑) | medium-high (lazy expand visible) |
| Mobile thumb reach pra navegar | excellent (swipe é one-handed) | good (scroll é one-handed) |
| Keyboard nav | excellent (H/J/K/L mapping) | excellent (J/K/L/H + setas + r/t/g) |
| Reduced motion | poor (perde peek shadows + transitions; UX vira só fade card-trocando) | excellent (scroll é fundamental, sem motion-dependent) |
| Performance large threads (50+) | excellent (DOM ~3 cards) | medium-high (virtualized list 10-15 visible) |
| Reply context preserve | poor (sheet abre, parent some) | excellent (parent visível atrás da sheet) |
| Newcomer onboarding | poor (precisa coach mark; if missed, perdido) | excellent (modelo familiar Reddit/HN/Mastodon) |
| Swipe muscle memory PostViewer↔Thread | conflict (↑ espalha vs descend) | no-conflict (swipe não navega tree) |
| Discoverability "+N respostas" | medium (já shipou inline button UX-11) | high (sempre inline + tap expand) |
| Acessibilidade (screen reader) | medium (role=tree é correto, mas update é abrupto) | high (role=list lineares, ARIA bem-mapeada) |
| Score per comment visibility | OK (footer card) | OK (inline header) |
| isNew indicator | OK (UX-5 proposto: border-left) | OK (UX-5: chip ⓘ NEW + border-left) |

**Veredito:** list-mode ganha em 9/14 métricas, empata em 3, perde em
2 (mobile thumb reach e perf large threads — mitigáveis com
virtualized list e scroll otimizado).

---

## §8 — Anti-recommendations (preserve manifesto)

Features que **NÃO entram** no redesign, mesmo se prior art tem:

1. **Sem "expand all" auto** — escolha sempre do user. Manifesto §28
   (privacy default — minimum action without user agency). Render
   explosion adicional pra threads grandes deve ser decisão
   explícita.

2. **Sem score-by-AI sort** — manifesto §22 score determinístico
   apenas. Reddit-style "best/top/controversial" introduz
   personalização opaca. Drift `calculateScore(spreads, buries,
   created_at, now)` é a única ordenação aceita.

3. **Sem nested infinito** — cap visual depth 4 (indent plateau).
   Estrutura lógica preservada (NIP-22 permite arbitrary depth);
   apenas indent é capped pra legibilidade max-w-md.

4. **Sem "ver tópico no Twitter"** / quote thread compartilhada
   externa — fora do escopo NIP-22. Permalinks internos (Drift URL
   schema) podem entrar em Fase 6 (cliente nativo) com share-link.
   Hoje: nenhum botão de share externo no comment.

5. **Sem read receipts / view counts** — manifesto §28. Já implícito,
   mas vale registrar — não introduzir "@alice viu" ou "12k visualizações".

6. **Sem sort selector visible** — Drift não personaliza. Ordem é
   sempre `score desc + created_at asc` (já em `buildThread`). User
   não escolhe.

7. **Sem reactions (emoji) em comments** — fora do Track C.
   Confirmado em `comments.md` §1 ("Reactions/emojis em comments —
   out of scope, possível Track futuro"). Spread/bury de comments
   poderia entrar futuro (manifesto §22 já sustenta), mas exige
   novo escopo cross-cutting (`applyReactionReceived`, weighted
   scoring) — deferido.

8. **Sem auto-scroll pra "novo"** — UX-6 propõe `lastVisit`, mas
   user não é forçado a pular. Indicador `ⓘ NEW` é passivo. Botão
   `+N novos` no header (já existe) faz jump opcional.

---

## §9 — Riscos

### 9.1 Migração quebra muscle memory de users existentes

**Mitigação:** rollout opção C (cohort-based default). Users
existentes mantêm cards-mode + banner sutil pra experimentar list.
Toggle bidirecional sempre disponível.

**Severity:** medium → low com mitigação.

### 9.2 Virtualized list em PWA mobile — performance

**Risco:** scroll com 200+ comments + virtualized + Tailwind +
framer-motion pode ter jank em devices low-end.

**Mitigação:**
- Usar `@tanstack/react-virtual` (battle-tested, ~3kb gzip).
- Render simples por item: max 1 motion.div per item, outros
  static.
- Thresholds de overscan baixos (3-5 items).
- Test em device entry-level (Chrome DevTools mobile throttling
  4x slowdown + low-end CPU).

**Severity:** medium → low com mitigação.

### 9.3 Indent + max-w-md = pouco espaço pra deep nest

**Risco:** depth 5+ com 24px indent deixa text width <300px (em
viewport 448px). Em 360px viewport (iPhone SE), text width ~210px.

**Mitigação:**
- Plateau em depth 4 (24px max).
- Em viewport <400px, plateau em depth 3 (18px max).
- Jump-to-parent pill desimpede leitor que entrou via deep link.

**Severity:** low.

### 9.4 ReplySheet target race ainda existe

UX-3, UX-4 propostos mas não shipados. Se list-mode ship sem fix
de target snapshot, o problema migra (tap → focus → reply target
poderia mudar se cursor mover via keyboard concurrently).

**Mitigação:** UX-3, UX-4 são **pré-requisito** desta migração.
Ship UX-3+UX-4 antes (ou junto) do list-mode.

**Severity:** medium se ignorado, zero se UX-3+UX-4 ship junto.

### 9.5 Two modes = double maintenance burden

**Mitigação:** maioria do código (CommentCard render do conteúdo,
ReplySheet, ThreadHeader breadcrumb, store) é compartilhado.
Diferença é layout container. Effort de manutenção ~+15%, não 2x.

**Severity:** low.

### 9.6 Coach mark + onboarding precisa atualizar

**Risco:** coach atual ensina swipe ↑↓←→. Em list-mode, isso é
irrelevante.

**Mitigação:**
- Coach diferente por modo:
  - list-mode coach: "tap pra responder · long-press pra opções ·
    [-] colapsar"
  - cards-mode coach: idem hoje
- Trigger primeira vez no modo, não na primeira vez na ThreadView.

**Severity:** low.

---

## §10 — Decisão Arquiteto pendente

Três perguntas pra decidir antes da implementação. Recomendação
proposta firme em cada.

### Q1 — Drift adota redesign paradigm shift OR fica em swipe-stack atual com polish?

**Opções:**
- **A) Adotar list-mode default** (recomendado)
- B) Manter swipe-stack default, list-mode opt-in
- C) Polish-only (UX-1 não fixa, fica em "5 quick wins" da audit
  original, S0 persiste)

**Recomendação:** **A.** UX-1 é S0 da audit (Robin) e F-19 (Barney).
Polish-only deixa o problema central (newcomer abandona thread)
intacto. Opt-in (B) defeats the purpose pra novos users.

**Trade-off:** maintenance ~+15% (dois modos). Aceitável dado o
ganho.

### Q2 — Se adota: Round 5 implementation OR sprint separate?

**Opções:**
- A) Round 5 da Lily (junto com outros polish)
- **B) Sprint separate** (recomendado) — 3-4 dias dedicados, ~14-16h
  Lily + 1h Marshall + 2h Robin
- C) Adiar pra Fase 6 (cliente nativo)

**Recomendação:** **B.** Mudança grande o suficiente que merece
sprint dedicado. Round 5 mistura com outros polish e dilui foco.
Adiar pra Fase 6 (C) bloqueia fix pra users PWA atuais.

### Q3 — Migration: feature flag (user opt-in) OR replacement direto OR cohort-based default?

**Opções:**
- A) Feature flag opt-in (todos cards, list só com toggle)
- B) Replacement direto (todos forçados pra list)
- **C) Cohort-based default** (recomendado) — novos users = list,
  existentes = cards + banner upgrade

**Recomendação:** **C.** Novos users colhem o benefício imediato
(maioria do crescimento). Existentes mantêm muscle memory + descobrem
o novo modo via banner sutil. Toggle livre em ambos os casos.

---

## §11 — Spec deltas a aplicar

Se §10 aprovar, atualizar:

- **`Docs/design-comments.md`** v0.2 → v0.4:
  - §3 (model): adicionar list-mode como default
  - §4 (interactions): tap/long-press/scroll definidos
  - §6 (gestures): swipe restrito a cards-mode
  - §14 Q3 (open question): RESOLVED → list-mode default
  - novo §15: viewMode toggle + cohort migration
- **`Docs/comments.md`** v0.3 → v0.4:
  - sem mudanças no protocol layer (kinds + tags inalterados)
  - §X (data layer): documentar `expanded_threads` per-thread
    (ephemeral session state, não persistido entre sessions —
    ou persistido em `user_prefs.comments_expanded_threads`
    Map<postId, commentId[]>)
- **`Docs/design-system.md`** §X — novo padrão "thread line" border-left
  conectiva.
- **`CLAUDE.md`** — registrar invariante #18 (a inventar): `comments
  view mode é per-user, persistido, default list-mode pra novos users`.

---

## §12 — Sumário

- **Problema atual:** card-stack swipe-driven é S0 pra UX de
  conversação aninhada quando thread cresce. UX-1 (Robin) + F-19
  (Barney) confirm.
- **Prior art consultado:** Reddit, X/Twitter, Bluesky, Mastodon,
  Threads, HackerNews, Discord, Slack (8 produtos). Top 3 fit:
  Reddit (collapse + indent + lazy), HN (deep collapse + score
  visible), Slack (parent context preserved).
- **Recomendação:** **list-mode default** com cards-mode opt-in.
  Cohort-based migration. Sprint separado de 14-16h.
- **Manifesto preservado:** §22 score determinístico, §27
  content-warning, §28 privacy default, §7 buildThread determinismo.
- **Schema/protocol unchanged:** NIP-22 + kinds 9078..9081 +
  SQLite comments table intactos.
- **Trade-off principal:** maintenance ~+15% (dois modos
  coexistem) vs S0 fix pra newcomer + 9/14 UX metrics improved.

---

*Robin · cap respeitado (research ~1.5h + escrita ~1h, total ~2.5h).*
*RFC pronta pra Arquiteto decidir Q1/Q2/Q3 e despachar pra Lily +
Marshall sprint.*
