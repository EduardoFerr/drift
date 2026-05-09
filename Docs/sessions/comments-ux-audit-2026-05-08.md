# Comments UX Audit — Track C (NIP-22, kind 1111)

**Data:** 2026-05-08
**Persona:** Robin (research, curadoria, gaps cross-cutting, docs)
**Companion docs:** [`comments.md`](../comments.md) v0.3 · [`design-comments.md`](../design-comments.md) v0.2 · [`design-system.md`](../design-system.md) v0.7 · [`track-c-debt-scoping-2026-05-08.md`](track-c-debt-scoping-2026-05-08.md)
**License:** CC0 1.0 Universal

> **Trigger:** user disse, sem detalhe, "a parte de comentários, a UI/UX
> está longe do ideal". Track C P0+P1+P2 da Lily fechou bugs e polish
> básico. Mas a sensação persiste. Esta auditoria descobre **o que**
> está errado.
>
> **Método:** percorri código (5 components + 2 lib + 1 hook +
> SwipeHandler + integração PostViewer) contra spec
> (`design-comments.md` v0.2 + `comments.md` v0.3) e princípios do
> manifesto (§22, §27, §28, §34). Findings tem **evidência concreta**
> (linha de código + diff de spec vs runtime). Severity calibrada por
> "user comum nota?", effort por "Lily executa em quanto tempo?".
>
> **Restrição:** doc-only; sem implementar fix; sem renomear feature;
> sem inventar funcionalidade nova.

---

## TL;DR (60 segundos)

A spec (`design-comments.md`) propõe um **tablero 2D** elegante de
swipe: ←→ entre irmãos, ↑↓ entre níveis. O código entrega isso com
fidelidade técnica, mas a UX **frustra três usuários reais distintos**:

1. **Quem só quer ler** — não tem como ver a thread inteira em
   relance. A árvore vira "uma fila de cards à toa" e o read sequencial
   exige memorizar como descer/subir/avançar entre cards.
2. **Quem quer responder algo específico** — o FAB "↵ responder"
   sempre responde **ao card atual**, e isso só fica visível depois
   de abrir o sheet (`para npub1...xyz`). User digitando reply pra
   "@alice no nível 2" pode descobrir que respondeu pra "@bob no
   nível 5" porque o cursor mexeu durante typing.
3. **Quem só quer saber se tem coisa nova** — `+N novos` no header
   é a única pista; a baseline é o momento que **abriu a thread**, não
   o último visit. Voltar 10 min depois reconta tudo, perdendo o
   sinal "novidade desde minha última visita".

**Veredito:** o protocolo + scoring + persistência estão sólidos
(track C debt scope). A UI é coerente com a spec, mas a **spec
escolheu um modelo de navegação que prioriza fidelidade arquitetural
(tudo um card) sobre legibilidade default (lista visível)**. É possível
endireitar com 5 quick wins (~3h trabalho da Lily) que mantêm o swipe
mas restauram a "lista" como primeira camada cognitiva. Refactor
maior **não** é necessário — só uma camada de "thread overview"
opcional acima do card stack.

**Confiança final:** UX está ~55% pronta. Refactor maior **não**
necessário — fixes incrementais resolvem 80% do gap.

---

## §1 — Espaço de problema (user stories core)

User stories canônicas pra "comments num post". Para cada uma, o
estado atual e a fricção principal.

### US-1 — "Quero ler a thread inteira rapidamente"

**Esperado:** abro thread, vejo lista cronológica vertical, scrollo,
saio. Padrão de Mastodon, Threads, Reddit (modo collapsed), Twitter
(antigo).

**Hoje:** abro thread → vejo **um card** ocupando o viewport ocupado
pelo primeiro top-level. Pra ver o segundo top-level preciso swipe ←
ou →. Pra ver replies do primeiro top-level preciso swipe ↑. Não
existe overview — preciso "atravessar" a árvore card-a-card.

**Fricção:** alta. Modelo do Tinder pra texto curto é alien à
expectativa. Confirmado por: spec admite (`§14 Q3 design-comments.md`)
que ainda não decidiu "card stack peek vs fullscreen" — sinal claro
de incerteza própria. **User story core não tem caminho ágil**.

### US-2 — "Quero saber onde estou na thread"

**Esperado:** breadcrumb + indicador de profundidade + indicador de
posição.

**Hoje:** ThreadHeader tem breadcrumb (`@alice › @bob › @você`),
counter (`3/47`) e profundidade (`nível 4`).
[`ThreadHeader.tsx:50-122`](../../src/components/Post/ThreadHeader.tsx)
faz isso bem.

**Fricção:** baixa. Esta user story está OK. Único polish: tooltip
no breadcrumb truncado (TH-P1 do scoping da Lily) e key estável (TH-T1).

### US-3 — "Quero responder a um sub-thread sem perder contexto"

**Esperado:** clico "responder" em comment-X, sheet abre, vejo a quem
respondo, confirmo, publico. Volto exatamente onde estava.

**Hoje:** FAB "↵ responder" sempre fixo bottom-right. Tap abre
ReplySheet com texto "para npub1abc…xyz" como única pista de
destinatário. Mas o destinatário é **sempre o card atual no cursor**.

**Fricção crítica:**

- (a) Não dá pra "marcar" um comment longe do cursor pra responder
  ele. User precisa primeiro **navegar até** o comment desejado, depois
  tap FAB.
- (b) Texto "para npub1abc…xyz" é ilegível pra quem não decodifica
  pubkey de cabeça. Spec define `shortNpub()` em
  [`ReplySheet.tsx:100-108`](../../src/components/Post/ReplySheet.tsx)
  (`npub1abc...xyz`). Author handle / petname / nickname **não** é
  resolvido. Reply social vira pin na cabeça.
- (c) Se durante typing chega um comment novo e o cursor truncate
  (race §5.5 do design-comments), `replyTo` muda silenciosamente
  enquanto user digita. ReplySheet **não rebuilda** quando muda
  cursor (prop `replyTo` muda, mas o textarea já tem texto e o
  user só vê o "para" mudar — sem alerta). Risco baixo de occorência,
  alto impacto quando ocorre (responde em sub-thread errado).

### US-4 — "Quero distinguir o que é novo do que é antigo"

**Esperado:** marcação visual de "comments que entraram desde minha
última visita" (X, Reddit, Mastodon todos têm).

**Hoje:** ThreadHeader badge `+N novos`
([`ThreadHeader.tsx:109-121`](../../src/components/Post/ThreadHeader.tsx))
conta `created_at >= openedAt` via `countNewSince` em
[`thread-header.ts:76-87`](../../src/lib/thread-header.ts).

**Problemas:**

- Baseline é o momento de **abrir a thread** (`openedAt = useState(()
  => Math.floor(Date.now() / 1000))`,
  [`ThreadView.tsx:91`](../../src/components/Post/ThreadView.tsx)).
  Se user abre, lê 5 min, fecha, volta 10 min depois → baseline reseta,
  TODOS os comments aparecem como "novos" zero (porque created_at <
  novo openedAt).
- "Novo" no card individual **não tem marca visual**. Só o counter
  agregado no header. Card-a-card user não sabe se "este aqui" é o
  que chegou agora.
- Badge `+N novos` clica em `onRefreshNew` — re-carrega snapshot e
  reseta openedAt. Mas isso significa "esquecer o que era novo". Não
  há forma de **navegar diretamente pros novos**.

### US-5 — "Quero alternar entre subposts (PostViewer) sem perder posição na thread"

**Esperado:** abrir thread em subpost-1, navegar 10 níveis dentro da
thread, fechar, voltar pra subpost-1 com cursor onde eu estava.

**Hoje:** ThreadView é overlay z-60 sobre PostViewer. Fecha → volta
pra PostViewer mesmo subpostIdx (preservado). Cursor da thread é
**descartado** ao fechar (useState local em ThreadView não persiste).

**Fricção:**

- Fechar thread perde toda a navegação interna. User que estava no
  4º nível fechou pra ver subpost-2 do post → reabrir thread vai pra
  `roots[0]` de novo. Comportamento previsto pela spec (§5.5 e §2.1
  diz "reset quando ThreadView desmonta"), mas é **desproporcional**
  pra navegação pesada.
- Se o post tem 5 subposts e cada um tem comments, alternar subposts
  no PostViewer **não** filtra a thread (comments são por
  `post_id` raiz, não por `subpostIdx`). Mas a UI não comunica isso —
  user pode achar que "este comment é deste subpost".

### US-6 — "Quero fechar e voltar pra home sem confusão"

**Esperado:** uma única ação, óbvia, sai. Em mobile: gesto de back
ou X no header.

**Hoje:** três caminhos:
1. ✕ no ThreadHeader ([`ThreadHeader.tsx:125-133`](../../src/components/Post/ThreadHeader.tsx))
2. Esc no teclado ([`ThreadView.tsx:172-182`](../../src/components/Post/ThreadView.tsx))
3. Swipe ↓ no top-level (`ascend` retorna `'exit'`,
   [`thread-cursor.ts:147-150`](../../src/lib/thread-cursor.ts))

**Fricção:**

- Caminho 3 é **inverso da intuição mobile**. Em todo app social
  (Mastodon, Threads, X), thread fecha por **swipe pra direita** ou
  swipe-down-DO-TOPO (drag-to-dismiss). Drift usa swipe-down em
  qualquer ponto pra "subir hierarquia". No top-level, swipe-down
  fecha → user que tentou voltar do nível 1 pro post acaba indo pro
  feed inteiro.
- O TV-P1 fix (Track C P1) adicionou shake antes do exit
  ([`ThreadView.tsx:147-156`](../../src/components/Post/ThreadView.tsx)),
  mas shake é micro-feedback de **220ms** — não dá tempo de "ah,
  espera, não queria fechar" cancelar.
- ✕ é tiny (px-2 py-1) no canto direito do header. Em mobile com
  thumbsize ~44px, overflow alvo é arriscado.

### US-7 — "Quero responder ao post (não a comment)"

**Esperado:** abro thread vazia, ou navego pro topo, e tem clara
opção "comentar no post" vs "responder a este comment".

**Hoje:** EmptyState (thread sem comments) tem botão "↵ comentar"
que dispara `setReplyOpen(true)` →
[`ThreadView.tsx:336-354`](../../src/components/Post/ThreadView.tsx)
detecta `currentNode === null` e usa `replyTo: postId, replyToKind:
9078`. Funciona.

Mas: thread **com** comments — para criar um top-level novo (não
reply), user precisa…
- (a) navegar até qualquer top-level
- (b) tap FAB
- (c) sheet diz "para @alice" (não pro post)
- (d) confiar que o comment vai aparecer como sibling de @alice
  (top-level), o que de fato acontece se cursor.path.length === 1

Mas isso é **invisível**. User pode achar que está respondendo @alice
e descobrir depois que virou top-level. O contrário também: querer
responder @alice mas estar em path.length > 1 → vira reply nested.

---

## §2 — Inventory de telas/componentes

### 2.1 Componentes envolvidos

| Component | Linhas | Função | Severidade percebida |
|---|---:|---|---|
| `ThreadView.tsx` | 422 | Overlay full, orquestra cursor + render lazy + FAB + coach | M-A (concentra muita responsabilidade) |
| `CommentCard.tsx` | 261 | Renderiza um comment isolado (header + body + footer) | M (visual OK, mas isolado demais) |
| `ThreadHeader.tsx` | 136 | Sticky top: breadcrumb + counter + +N novos + ✕ | OK |
| `ReplySheet.tsx` | 617 | Bottom sheet: textarea + CW chips + image upload + alt | A (gigante, vários states em paralelo) |
| `comments.ts` | 388 | Store + buildThread + subscribe lazy + refcount | OK (Lily fechou debt) |
| `thread-cursor.ts` | 150 | nextSibling / prevSibling / descend / ascend | OK |
| `thread-header.ts` | 87 | breadcrumb / sibling position / countNewSince | OK |
| `useThread.ts` | 75 | Hook lifecycle (subscribe + load) | OK |

### 2.2 Flow visual

```
[Feed/Home Embedded PostViewer] ──tap em "💬 N"──▶ [ThreadView overlay z-60]
                                                          │
                                                          ├─ ThreadHeader (sticky top)
                                                          │
                                                          ├─ Card central (CommentCard)
                                                          │      │
                                                          │      ├─ peek shadows (sibling, child)
                                                          │      │
                                                          │      └─ swipe ←→ siblings, ↑↓ hierarquia
                                                          │
                                                          ├─ FAB "↵ responder" (sempre)
                                                          │      │
                                                          │      └─ tap ──▶ [ReplySheet bottom-up]
                                                          │
                                                          └─ Coach mark (3s overlay first time)

Fechar:  ✕ header  |  Esc  |  swipe ↓ no top-level (com shake 220ms)
```

### 2.3 Interaction surfaces (gestures + buttons)

- **Swipe** em ThreadView card = SwipeHandler reuso, mas com **semântica
  invertida** vs PostViewer (`onUp`/`onDown` são `descend`/`ascend`,
  enquanto PostViewer usa `onSpread`/`onBury`).
  [`SwipeHandler.tsx:65-66`](../../src/components/Post/SwipeHandler.tsx):
  `fireUp = onSpread ?? onUp; fireDown = onBury ?? onDown`. Mesmo
  componente, mesma direção física, **ações inversas em contexto**.
- **Drag** em ReplySheet = drag-down-to-dismiss, threshold 80px
  ([`ReplySheet.tsx:113`](../../src/components/Post/ReplySheet.tsx)).
  Terceiro paradigma de gesto.
- **Tap** em CommentCard `cwBlur` = revela conteúdo blurred (override
  local). **Tap** em outros lugares no card = no-op.

---

## §3 — Findings

15 findings; categorizados; cada um com evidência + severity + effort.

### UX-1 — Card-stack obriga descobrir thread por gesto, não por leitura

- **Categoria:** information architecture
- **Hoje:** ThreadView renderiza **um** CommentCard ocupando 100% da
  área central
  ([`ThreadView.tsx:280-298`](../../src/components/Post/ThreadView.tsx)).
  Para ver outros comments, único caminho é gesto (swipe ←→↑↓).
  Peek shadow cards aparecem com `scale 0.96 / opacity 0.4`
  ([`ThreadView.tsx:249-278`](../../src/components/Post/ThreadView.tsx))
  — visíveis mas sem texto legível.
- **Why-it-feels-wrong:** modelo Tinder/PostViewer é apropriado pra
  conteúdo discreto onde **cada item é independente** (post). Comments
  são **conversação aninhada** — leitura sequencial cronológica é a
  expectativa default em todo cliente social. Spec admite incerteza:
  `design-comments.md §14 Q3` diz "Card stack peek vs fullscreen — Decidir
  baseado em tamanho médio dos comments".
- **Severity:** S0 — bloqueia user típico. Quem só quer ler abandona.
- **Effort:** E2 — adicionar modo "lista" como opção default rompe a
  metáfora atual. Mínimo: lista vertical scrollável + manter card stack
  como modo "navegação imersiva" (toggle no header, ou auto-aplicado em
  threads com 1-3 comments). 4-6h.

### UX-2 — Peek shadow cards prometem o quê está atrás mas mostram zero conteúdo

- **Categoria:** information architecture / interaction
- **Hoje:** os peek `motion-reduce:hidden` cards
  ([`ThreadView.tsx:249-278`](../../src/components/Post/ThreadView.tsx))
  são `bg-drift-surface` puro, sem texto. User vê retângulos vazios
  embaixo do card central.
- **Why-it-feels-wrong:** spec escreve "discoverability §4.1 — usuário
  vê que tem mais conteúdo em todas as direções sem precisar swipear pra
  descobrir". Mas mostrar **só silhueta sem preview do conteúdo** não é
  discoverability — é teaser sem entrega. User percebe que "tem coisa lá"
  mas não sabe **o quê**, então gestura pra descobrir, depois gestura pra
  voltar. Custo cognitivo > benefício.
- **Severity:** S1 — irrita constantemente. Cada navegação tem 2-3
  peeks visualmente vazios.
- **Effort:** E1 — popular peek com primeira linha de texto + autor. Tipo:

  ```
  [card central: @alice "comment longo..."]
  [peek atrás: @bob ▏ "outro comment..." ▏ scale 0.96 opacity 0.4]
  ```

  Mantém arquitetura, melhora dicas. ~1.5h.

### UX-3 — FAB "↵ responder" replica em alvo invisível ao user

- **Categoria:** interaction / cognitive load
- **Hoje:** FAB sempre visível bottom-right do ThreadView
  ([`ThreadView.tsx:303-312`](../../src/components/Post/ThreadView.tsx)).
  Usa `cursor.path.at(-1)` como replyTo target
  ([`ThreadView.tsx:336-354`](../../src/components/Post/ThreadView.tsx)).
  Sheet abre com `para shortNpub(replyToAuthorPub)` no header
  ([`ReplySheet.tsx:394-396`](../../src/components/Post/ReplySheet.tsx)).
- **Why-it-feels-wrong:** user que está navegando uma thread se acostuma
  a "deslizar de comment em comment", e o FAB **não** indica que ele
  vai responder ESSE comment específico. Header da sheet diz "para
  npub1abc…xyz" — pubkey truncada. User precisa **decodificar**:
  - "este é o npub do @alice ou do @bob?"
  - "estou no nível 2 ou 3 da thread? esse pubkey corresponde a
    quem dos breadcrumbs?"
- **Severity:** S1 — irrita constantemente. Errar destinatário é
  embaraço social na rede.
- **Effort:** E1 — duas mudanças baratas:
  1. FAB exibe destinatário inline: `↵ responder a @alice`
     (extrai pubkey curta + petname se houver)
  2. Header do ReplySheet exibe trecho do comment ao qual responde:
     `> "comment em si que o user respondendo..."`. ~1.5-2h.

### UX-4 — `replyTo` muda silenciosamente quando cursor truncate durante typing

- **Categoria:** interaction (race condition)
- **Hoje:** ThreadView truncate cursor em
  [`ThreadView.tsx:67-79`](../../src/components/Post/ThreadView.tsx) se
  `index.byId.has` falha pra qualquer id no path. Trigger: comment
  moderado (score = -999 chega) ou refresh.
  ReplySheet recebe `replyTo` como prop
  ([`ReplySheet.tsx:88`](../../src/components/Post/ReplySheet.tsx)) e
  reage pra reset state quando `open` muda
  ([`ReplySheet.tsx:160-174`](../../src/components/Post/ReplySheet.tsx)),
  mas **NÃO** quando `replyTo` muda enquanto open=true.
- **Why-it-feels-wrong:** user digitou 200 chars de reply pra @alice;
  cursor truncou pra @alice's parent (porque @alice foi moderada);
  user submete; reply vai pra parent **silenciosamente**. Texto era
  contextualizado ao que @alice disse, vira non-sequitur no parent.
- **Severity:** S1 — não bloqueia uso, mas quando ocorre é alto custo
  social.
- **Effort:** E1 — 2 opções:
  1. Quando `replyTo` muda enquanto `open=true`, mostrar banner
     `⚠ destinatário mudou` no sheet, exigir confirm antes de publish.
  2. Freeze `replyTo` ao abrir sheet (snapshot). Se cursor truncate,
     sheet ainda publica pro destinatário original. Documentar via
     título do sheet `respondendo @alice (cursor moveu)`.
  ~1h.

### UX-5 — Não há marca visual de "novo" no card individual

- **Categoria:** visual / information architecture
- **Hoje:** `+N novos` aparece **só** no header
  ([`ThreadHeader.tsx:109-121`](../../src/components/Post/ThreadHeader.tsx)).
  CommentCard renderiza idêntico independente de quando o comment chegou.
- **Why-it-feels-wrong:** Mastodon, Reddit, Threads marcam comments
  novos com border colorida ou dot de "unread". Drift omite. User passa
  por um card recém-chegado sem perceber. `countNewSince` está
  computado em `thread-header.ts:76` mas o resultado não vaza pro
  CommentCard.
- **Severity:** S1 — irrita user que retorna a uma thread ativa.
- **Effort:** E0 — passar `isNew: created_at >= openedAt` como prop pro
  CommentCard, render border-left `drift-accent2` se true. ~30min.

### UX-6 — Baseline de "novo" reseta a cada open de thread

- **Categoria:** information architecture
- **Hoje:** `openedAt = useState(() => Math.floor(Date.now() / 1000))`
  ([`ThreadView.tsx:91`](../../src/components/Post/ThreadView.tsx)).
  Reset a cada mount.
- **Why-it-feels-wrong:** "novo desde abri" é diferente de "novo desde
  última visita". User abre thread, sai, volta 30min depois → quer ver
  o que chegou nesses 30min. Hoje vê 0.
- **Severity:** S1 — quem retorna a thread ativa nunca vê deltas.
- **Effort:** E1 — persistir `lastVisitByThread: Map<postId, unix>` em
  `user_prefs` ou store local. Ao mount: usar `lastVisit` como
  baseline; ao desmount: gravar `now` como `lastVisit`. ~1.5h.

### UX-7 — Coach mark dispara automaticamente, dismiss em 3s, sem reabrir

- **Categoria:** interaction / accessibility
- **Hoje:** primeira abertura → coach overlay com setas
  ([`ThreadView.tsx:399-422`](../../src/components/Post/ThreadView.tsx)),
  auto-dismiss em 3s ou tap, persiste `thread_coach_seen=true`
  irreversível.
  Lily flagou TV-P2 mas não fixou.
- **Why-it-feels-wrong:** 3s pra ler 4 ações é **rápido demais** pra
  user que pisca / olha pra notificação / scrolla um instante. Uma vez
  perdido, **nunca mais** aparece. Settings UI não tem toggle pra
  reabrir.
- **Severity:** S1 — quem perdeu o coach navega thread por descoberta
  acidental.
- **Effort:** E0 — duas mudanças:
  1. Aumentar timeout pra 5-6s (legível com calma).
  2. Botão `(?)` no ThreadHeader abre coach manualmente.
  ~30-45min.

### UX-8 — Swipe ↑↓ é semanticamente inverso do PostViewer; sem cue visual

- **Categoria:** motion / cognitive load (cross-feature consistency)
- **Hoje:** PostViewer:
  - swipe ↑ = SPREAD (ação positiva, manda pro espalhamento)
  - swipe ↓ = BURY (ação negativa, afunda no feed)

  ThreadView usa **mesmo** SwipeHandler físico mas:
  - swipe ↑ = `descend` (vai pra reply, "afunda" na hierarquia)
  - swipe ↓ = `ascend` (sobe pro parent, "subir" na hierarquia)

  SwipeHandler resolve por `fireUp = onSpread ?? onUp`
  ([`SwipeHandler.tsx:65`](../../src/components/Post/SwipeHandler.tsx)).
  **Mesmo motor, semânticas opostas em contexto adjacente.**
- **Why-it-feels-wrong:** user faz swipe ↑ no PostViewer = "espalhar".
  Tap em "💬", ThreadView abre, swipe ↑ = "descer pra reply". Cérebro
  ainda registra ↑ como "ação positiva subindo". Spec design-comments
  §14 Q2 admite: "Down vs Up semântica — escolhi UP=descer (filho) e
  DOWN=subir (parent). Inverse intuition pra alguns".
- **Severity:** S1 — irrita constantemente porque o user repete o
  fluxo todo dia. Mas user adapta com tempo.
- **Effort:** E2 reverter (mudaria spec). E1 mitigar com **cue visual
  forte** ao entrar em ThreadView (transition + dica permanente no
  header tipo `↑ desce ↓ sobe`). ~2h.

### UX-9 — Reply a top-level com cursor.path.length === 1 é invisível

- **Categoria:** information architecture
- **Hoje:** ThreadView com cursor em `roots[0]` (top-level), tap FAB
  → ReplySheet com `replyTo = roots[0].id` (não postId). Sheet diz
  "para @alice" → user publica → comment **vira sibling** de @alice
  (não top-level novo).

  Para criar top-level novo, único caminho **óbvio** é EmptyState
  ([`ThreadView.tsx:362-383`](../../src/components/Post/ThreadView.tsx))
  — só aparece se thread vazia.
- **Why-it-feels-wrong:** opção "comentar no post" só aparece se
  ninguém comentou ainda. Depois disso, virou refém de "responder a
  alguém". Twitter/Reddit/Mastodon distinguem clearly: campo de "novo
  comment no post" sempre visível no topo, "responder a este" inline
  em cada card.
- **Severity:** S1 — frustra user que quer dar opinião própria, não
  reagir a outro user.
- **Effort:** E1 — adicionar segundo botão no ThreadHeader: `+ comentar
  no post` (sempre visível). Tap → ReplySheet com `replyTo: postId,
  replyToKind: 9078`. ~1h.

### UX-10 — Imagens em comment limitadas a 40vh com object-contain — sem preview

- **Categoria:** visual / interaction
- **Hoje:** CommentCard renderiza imagem
  ([`CommentCard.tsx:156-180`](../../src/components/Post/CommentCard.tsx))
  com `max-h-[40vh] object-contain`. Tap → no-op (não abre fullscreen
  como PostViewer). `<Image>` UI component reusa de Track B.
- **Why-it-feels-wrong:** usuário toca imagem esperando ver fullscreen.
  Não acontece nada. Spec design-comments.md §4.2.1 diz "Tap expande
  pra fullscreen viewer" — implementação não está lá.
- **Severity:** S2 — rare ocorrência (poucos comments com imagem hoje),
  mas quando ocorre é frustrante.
- **Effort:** E1 — wrap em onClick handler que abre image viewer
  (componente reuso ou criar). ~1.5h.

### UX-11 — Footer "↳ N respostas" não é tappable; "↑ ver" é cosmético

- **Categoria:** interaction
- **Hoje:** CommentCard footer
  ([`CommentCard.tsx:195-208`](../../src/components/Post/CommentCard.tsx))
  mostra `↳ N respostas` (texto estático) + `↑ ver` (texto estático
  com `aria-hidden`). Lily flagou em CC-P2 do scoping.
- **Why-it-feels-wrong:** todo user moderno espera que `↳ 5 respostas`
  seja **clicável** pra "expandir/ver replies". Drift quer que user
  use swipe ↑. Texto sugere clickability, gesto exige outra coisa.
  `aria-hidden` no `↑ ver` torna invisível pro leitor de tela.
- **Severity:** S1 — irrita constantemente; user tap-tap-tap-nada-acontece.
- **Effort:** E0 — duas opções:
  1. Tornar `↳ N respostas` clickable: tap = `descend()` (mesmo que
     swipe ↑). Mantém swipe; adiciona tap como atalho.
  2. Mudar texto pra `swipe ↑ pra ver N respostas` se mantiver gesto-only.
  ~30min opção 1.

### UX-12 — Esc fecha **tudo** sem distinção do que está aberto

- **Categoria:** interaction
- **Hoje:** [`ThreadView.tsx:172-187`](../../src/components/Post/ThreadView.tsx)
  - Esc com replyOpen → fecha sheet
  - Esc com coachVisible → dismiss coach
  - Esc senão → onClose (fecha thread inteira)

  Mas sequência rápida: user com coach + reply ambos abertos (race),
  primeiro Esc fecha reply (se replyOpen tem precedência), próximo Esc
  fecha thread. Coach pode ser pulado sem ver.

  Mais relevante: cursor profundo (path.length > 1) — Esc fecha thread
  inteira, não volta nível. Vim users esperariam Esc = "subir um nível"
  ou "cancel".
- **Why-it-feels-wrong:** Esc deveria ter **graduação**: cancela
  modal/overlay mais interno antes de fechar tudo.
- **Severity:** S2 — pouca ocorrência, mas confusing quando ocorre.
- **Effort:** E1 — adicionar lógica: Esc com `path.length > 1` faz
  `ascend()` em vez de `onClose()`. ~1h.

### UX-13 — Empty state "sem comentários" sem CTA contextualizado

- **Categoria:** visual / motion
- **Hoje:** [`ThreadView.tsx:362-383`](../../src/components/Post/ThreadView.tsx).
  - "sem comentários ainda"
  - "seja o primeiro a comentar."
  - Botão `↵ comentar`
- **Why-it-feels-wrong:** OK mas estéril. User que abriu a thread está
  expressando interesse no post; momento perfeito pra encorajar
  contribuição. Texto poderia mostrar info relevante: `+0 pessoas
  comentaram` (vazio) versus `seja a primeira voz`. Conexão com manifesto
  §27 (auto-classificação) — não há hint sobre content-warning.
- **Severity:** S2 — não bloqueia.
- **Effort:** E0 — copy update + ícone. ~15min.

### UX-14 — Loading state desproporcional pra subscribe lazy

- **Categoria:** performance perception
- **Hoje:** [`ThreadView.tsx:385-396`](../../src/components/Post/ThreadView.tsx).
  "carregando comentários…" único placeholder. `loadThread` lê SQLite
  (rápido); subscribe lazy pode levar 500ms-2s pra primeiro comment via
  relay (spec admite em §3.2 do comments.md).
- **Why-it-feels-wrong:** user que abre thread vazia (cache + relay
  ainda não respondeu) vê "carregando" ad infinitum. Não há feedback
  de "buscando em N relays" ou progresso. Quando relay responde EOSE
  com 0 events, UI passa pra EmptyState — abrupto.
- **Severity:** S2.
- **Effort:** E1 — duas mudanças:
  1. Skeleton de 2-3 cards em loading (silhuetas, não texto puro).
  2. Após 3s sem resposta, transition pra "buscando em N relays… (toque
     pra cancelar)".
  ~1.5h.

### UX-15 — `aria-keyshortcuts` inconsistente entre componentes

- **Categoria:** a11y
- **Hoje:**
  - ThreadView FAB: `aria-keyshortcuts="Enter"` ([`ThreadView.tsx:308`](../../src/components/Post/ThreadView.tsx))
  - ThreadHeader ✕: `aria-keyshortcuts="Escape"` ([`ThreadHeader.tsx:129`](../../src/components/Post/ThreadHeader.tsx))
  - ReplySheet ✕: `aria-keyshortcuts="Escape"` ([`ReplySheet.tsx:403`](../../src/components/Post/ReplySheet.tsx))
  - ReplySheet publicar: `aria-keyshortcuts="Meta+Enter Control+Enter"` ([`ReplySheet.tsx:509`](../../src/components/Post/ReplySheet.tsx))
  - ThreadView Esc handler **não** tem aria-keyshortcuts globalmente declarada
  - Setas/H/J/K/L: SwipeHandler tem keyboard mas zero `aria-keyshortcuts`
- **Why-it-feels-wrong:** screen reader users não descobrem H/J/K/L
  (gesture nav). E se user procura "como navego?", a UI não declara
  `↑↓←→` em lugar nenhum a11y-acessível. Coach mark é visual-only
  (`aria-modal="false"` mas conteúdo só vê quem vê).
- **Severity:** S2.
- **Effort:** E1 — adicionar `<div aria-label="atalhos de teclado: H J K L
  setas Esc">` no ThreadView. ~45min-1h.

---

## §4 — Propostas priorizadas para findings S0/S1

### Para UX-1 (S0) — Modo lista como default

**Proposta:** introduzir toggle `mode: 'list' | 'cards'` no ThreadView,
default `'list'`. Quando `'list'`:

```
┌─────────────────────────────────────┐
│ ThreadHeader (idem)                  │
├─────────────────────────────────────┤
│ scrollable lista vertical:           │
│                                      │
│ @alice · 2h          [⚠ spoiler]    │
│ ↳ comment text...                    │
│                                      │
│   @bob · 1h                          │
│   ↳ reply text...                    │
│                                      │
│     @charlie · 30m                   │
│     ↳ nested reply...                │
│                                      │
│ ─────────────────────────            │
│ @dave · 10m                          │
│ ↳ next top-level...                  │
└─────────────────────────────────────┘
                      ↓
                  [↵ responder]
                  (long-press: troca pra modo cards p/ navegação imersiva)
```

`mode: 'cards'` mantém o atual (toggle no header `≡` icon ou similar).
Spec acomoda — lista vira modo "leitura"; card stack vira modo
"discussão imersiva".

- **Owner:** Robin (você) draftar wireframe + ajuste em design-comments.md
  v0.4. Lily implementar (~5-6h).
- **Effort:** E2 (4-6h impl + 1h spec).

### Para UX-3 (S1) — FAB nominal + sheet com quote

**Proposta:**

```typescript
// FAB no ThreadView
<button>
  ↵ responder a {nicknameOrShortAuthor(currentNode)}
</button>

// ReplySheet header
<header>
  responder a @{nickname}
  <blockquote>"{first 100 chars of currentNode.content}…"</blockquote>
</header>
```

Petname/nickname resolution: Drift hoje usa `truncate(pub)` →
`anon{…last6}`. Nada conecta isso a NIP-05 ou kind-0 metadata. Pra UX
correta, precisaria resolver ou user-side cache. Mínimo: usar
`shortNpub` mas embed o trecho do comment como quote.

- **Owner:** Lily (UI), Marshall se petname require schema.
- **Effort:** E1 (~1.5-2h sem petname; +2h se resolver kind-0).

### Para UX-4 (S1) — Freeze replyTo ao abrir sheet

**Proposta:** ao `setReplyOpen(true)`, capturar `currentNode` em ref/state
e passar como prop fixo. Cursor mover não muda alvo do sheet.
Side benefit: simplifica TV-B4 do scoping (IIFE no JSX recria
replyTo).

```diff
- replyTo={cursor?.path.at(-1) ?? postId}
+ replyTo={replyTargetSnapshot}  // capturado ao open
```

Se quiser preservar opção de "rebind", banner inline `destinatário
mudou — atualizar?`. Default: não.

- **Owner:** Lily.
- **Effort:** E0-E1 (~45min-1h).

### Para UX-5 (S1) — Border-left "novo" no CommentCard

**Proposta:** ThreadView passa `isNew = node.created_at >= openedAt` pra
CommentCard. Card render `border-l-2 border-drift-accent2` quando true.
Animação fade-out de 5s após seen (ou rely em next render quando
`isNew=false`).

- **Owner:** Lily.
- **Effort:** E0 (~30min).

### Para UX-6 (S1) — `lastVisit` per thread

**Proposta:** novo campo em `user_prefs`: `thread_last_visit:
Map<postId, unix>` ou tabela `thread_visits(post_id PK, unix INTEGER)`.

- ThreadView mount: `openedAt = lastVisit ?? now`
- ThreadView unmount: `setLastVisit(postId, now)` async fire-and-forget

- **Owner:** Marshall (schema novo) + Lily (UI hookup).
- **Effort:** E1 (~1.5h).

### Para UX-7 (S1) — Coach mark replayável

**Proposta:** `(?)` icon no ThreadHeader (esquerda do ✕). Tap reabre
coach. Local storage só decide se mostra **automaticamente** na primeira
vez; replay sempre disponível.

- **Owner:** Lily.
- **Effort:** E0 (~30-45min).

### Para UX-8 (S1) — Cue visual permanente do swipe

**Proposta:** mini-legenda no ThreadHeader (à direita do counter):

```
3/47 · nível 4 · ↑ desce  ↓ sobe  ←→ irmãos
```

Persistente, font-mono 9px, `text-drift-muted`. A11y: `aria-hidden`
porque já tem coach + ARIA tree role.

- **Owner:** Lily.
- **Effort:** E0 (~45min).

### Para UX-9 (S1) — Botão "+ comentar no post" sempre visível

**Proposta:** ThreadHeader ganha botão extra à esquerda do ✕:

```
[≡ thread][+ no post]                   3/47 nível 4   [✕]
```

Tap → ReplySheet com `replyTo=postId, replyToKind=9078`. EmptyState
botão central some (já tem header).

- **Owner:** Lily.
- **Effort:** E1 (~1h).

### Para UX-11 (S1) — Footer respostas tappable

**Proposta:**

```diff
- <span ...>↳ {childCount} respostas</span>
- {childCount > 0 && <span aria-hidden>↑ ver</span>}
+ {childCount > 0 ? (
+   <button onClick={onDescend} ...>
+     ↳ {childCount} respostas (toque ou ↑)
+   </button>
+ ) : (
+   <span ...>↳ sem respostas</span>
+ )}
```

`onDescend` recebe da prop. Mantém swipe; adiciona tap.

- **Owner:** Lily.
- **Effort:** E0 (~30min).

---

## §5 — Quick wins (top 3 impacto/esforço)

| # | Finding | Severity | Effort | 1-linha |
|---|---|---|---|---|
| 1 | UX-5 — Border-left "novo" no card | S1 | E0 (~30min) | Pass `isNew` prop, render border-left `drift-accent2` |
| 2 | UX-11 — Footer respostas tappable | S1 | E0 (~30min) | `↳ N respostas` vira `<button>` que faz `descend()` |
| 3 | UX-9 — Botão "+ comentar no post" no header | S1 | E1 (~1h) | Header sempre tem CTA pra criar top-level novo |

Total: ~2h. Cobre 3 fricções core (US-4, US-1 parcialmente, US-7) sem
tocar arquitetura.

**Bônus bem barato (E0 ~30-45min cada):** UX-7 coach replay, UX-8 cue
permanente do swipe, UX-13 copy do empty state. Mais 1.5h totais. Lily
poderia fazer 6 fixes em meia tarde.

---

## §6 — Refactor maior é necessário?

**Não.** Mas há **uma** mudança grande de paradigma que vale considerar
(UX-1 — modo lista). Sem ela, comments **funcionam** (Track C P0+P1+P2
fechou bugs/polish), mas user comum **abandona** porque modelo card-stack
exige aprendizado proprietário pra ler conversação.

### Sketch de redesign sugerido (sem inventar feature nova)

Se for fazer redesign, escopo mínimo: **adicionar modo lista**, sem
trocar protocolo, sem mudar schema, sem trocar swipe.

```
ThreadView
├─ ThreadHeader (idem)
│   ├─ breadcrumb
│   ├─ counter
│   ├─ +N novos
│   ├─ + comentar no post  ← UX-9
│   ├─ (?) coach replay    ← UX-7
│   ├─ [≡ ⇆ □□] toggle modo (3 opções: list / cards / hybrid) ← UX-1
│   └─ ✕
│
├─ Body (varia por mode):
│   │
│   ├─ mode='list' (DEFAULT):
│   │   ├─ scroll vertical
│   │   ├─ lista plana (ou indent até 3 níveis), todos visíveis
│   │   ├─ cada CommentCard compacto (não fullscreen)
│   │   ├─ tap em card = abre cards mode focado naquele card
│   │   └─ infinite scroll ou paginação após 200
│   │
│   ├─ mode='cards' (atual):
│   │   ├─ card stack como hoje
│   │   ├─ swipe ←→↑↓
│   │   └─ cue visual UX-8
│   │
│   └─ mode='hybrid' (opcional):
│       ├─ lista de top-levels só
│       └─ tap em top-level = cards mode focado
│
└─ FAB / botão "responder" (varia por mode)
```

Persistir `comments_view_mode` em `user_prefs`. Default `'list'` —
modo familiar pra novos users.

Trade-offs:
- Lista perde "imersão" do card stack. Mitigado por toggle.
- Manutenção de dois modes. Aceitável (~6h impl + tests).
- Swipe coach mark continua mostrar pra modo cards.

**Não-features que continuam fora do escopo Track C:**
- Reactions/emojis em comments (rejeitado em comments.md §1)
- Edit de comments (manifesto §5)
- Comment-only feed (comments.md §1)
- DMs (manifesto §29 — fora do MVP)

---

## §7 — Cross-cutting

### 7.1 SwipeHandler atende 3 paradigmas distintos — coliding muscle memory

| Contexto | swipe ↑ | swipe ↓ | swipe ← | swipe → |
|---|---|---|---|---|
| PostViewer | SPREAD (positiva) | BURY (negativa) | Subpost prev | Subpost next |
| ThreadView | descend (afunda) | ascend/exit (sobe) | Sibling prev | Sibling next |
| ReplySheet | (drag-only down dismiss) | drag-down dismiss | n/a | n/a |

Confusão real:
- `↑` em PostViewer = "espalho", em ThreadView = "afundo na thread".
  Usuário ativo alterna entre os dois 30x/dia → cérebro não consolida.
- `↓` em PostViewer = "enterro", em ThreadView **no top-level** = "fecho"
  (diferente de "afundar"). User tenta voltar do nível 1 e fecha.
- ReplySheet drag-down = dismiss (esperado). Mas drag-down num card
  ThreadView na **borda da sheet** pode dispatch dois handlers se
  z-index falhar — não há repro confirmada, mas é threat surface.

**Mitigação cross-cutting:**

1. **Cue visual no header** (UX-8): legenda persistente do swipe atual
   reduz custo de cognitive switching.
2. **Animação distintiva ao entrar em ThreadView**: transition curta
   (300ms) com mensagem `swipe ↕ navega thread, ↑ desce`. Aparece **só
   na primeira abertura por sessão**, não em cada open.
3. **Long-term:** considerar **inverter** thread swipe (↑ = sobe pro
   parent, ↓ = desce pra reply) na próxima major. Reverteria
   "afundar na hierarquia" do design-comments §6 mas alinharia com
   intuição mobile padrão. Decisão pra Robin discutir com Ted/Barney
   numa próxima fase. Não hoje.

### 7.2 Padrão "1 viewport = 1 entidade" replica fricção do PostViewer

Drift escolheu PostViewer fullscreen (1 post = 1 viewport)
intencionalmente — feed Tinder-like é a tese central do app. Mas
extrapolar isso pra **conversação aninhada** (comments) replica a
fricção sem o benefício. Conversação ganha valor de **co-localização
visual** (ver replies juntas do parent). Card stack desfaz isso.

Aviso pra futuro: **resistir a aplicar metáfora fullscreen-card a
qualquer feature nova** (DMs, profile threads, reports detail) sem
audit de fit.

### 7.3 Petnames / NIP-05 ausentes — toda a UI de social fica anônima

CommentCard mostra `anon{…last6 of pubkey}`. Sem NIP-05 (kind 0
metadata), sem petname local. Reply sheet idem.

Manifesto §28 (privacidade pelo mínimo) não obriga anonimização total
— só que **o app não correlaciona**. User pode publicamente declarar
nickname via kind 0. Drift não consome.

Cross-cutting: futuro Track de "metadata/kind 0" (não Track C) deveria
adicionar:
- `lib/profiles.ts` — kind 0 fetch + cache
- `usePetnameStore` — Zustand pra petname local opt-in
- CommentCard, PostViewer header, reply sheet — todos consumam

Comments **nem precisa de petname pra entregar Track C**, mas **a UX
fica significativamente melhor com nickname**. UX-3 ganha 80% do
benefício; sem petname, UX-3 fix entrega só 40%.

### 7.4 Falta integração entre comments e ações `spread`/`bury` no card

CommentCard hoje **não** mostra ↑/↓ counts ou ação de spread/bury do
**próprio comment**. Comments NIP-22 não são alvo de SPREAD/BURY no
Drift atual — confirmado em `comments.md` §1 ("Reactions/emojis em
comments — out of scope, possível Track futuro").

OK como decisão. Mas user vê PostViewer com ↑/↓ counters e abre
thread esperando o mesmo. Footer do CommentCard mostra **só** "↳ N
respostas". Falta sinal "este comment é bom?" — usuário não tem como
expressar valor em comment.

Não-fix Track C, mas vale registrar pra Track futuro: **se comments
ganharem reactions, infraestrutura cross-cutting é grande**:
- novo kind ou reuso kind 7
- `applyReactionReceived` em scoring
- weighted scoring (manifesto §22) — caps, dedup
- UI de stats no card

Decisão deferida. Esta auditoria **não** propõe abrir esse escopo.

---

## §8 — Sumário em números

| Categoria | Contagem |
|---|---:|
| Total findings | 15 |
| S0 (bloqueia) | 1 |
| S1 (irrita) | 10 |
| S2 (polish) | 4 |
| E0 (≤30min) | 5 |
| E1 (1-3h) | 7 |
| E2 (>3h, novo design) | 3 |

| User stories | Status |
|---|---|
| US-1 ler thread inteira | **alta fricção** (UX-1) |
| US-2 onde estou | OK |
| US-3 responder com contexto | **alta fricção** (UX-3, UX-4) |
| US-4 distinguir novo/antigo | **fricção** (UX-5, UX-6) |
| US-5 alternar subposts/comments | OK |
| US-6 fechar e voltar | **fricção** (parte de UX-8 + UX-12) |
| US-7 responder ao post (não comment) | **fricção** (UX-9) |

---

## §9 — Veredito

**Comments UX está ~55% pronta.** Refactor maior **NÃO** necessário —
fixes incrementais resolvem 80% do gap.

**Justificativa em 1 frase:** o protocolo + scoring + persistência +
arquitetura tree estão sólidos (Track C P0+P1+P2 fechou bugs); o que
falta é **alinhar a UX com expectativa de leitor casual** (modo lista
default + sinais de "novo" + contexto de reply mais explícito) — 5
quick wins (3h trabalho da Lily) cobrem o essencial; UX-1 modo lista
(4-6h) destrava read fluido pra users que não querem aprender card-stack
swipe.

**Próximo passo recomendado pelo Arquiteto:**

1. **Imediato (2-3h):** mandar Lily executar quick wins UX-5, UX-11,
   UX-9 + bônus UX-7, UX-8, UX-13. Fecha 6 frictions.
2. **Curto prazo (1 sprint):** decidir se UX-1 (modo lista) entra como
   `comments_view_mode` em user_prefs. Se sim, Robin (você) atualiza
   `design-comments.md` v0.4 com sketch + Lily implementa em ~6h.
3. **Médio prazo (próxima major):** considerar inverter swipe do
   ThreadView (UX-8 long-term mitigação) ou registrar a "bizarrice"
   como característica do Drift.

Não-recomendado:
- Adicionar reactions a comments (fora do Track C).
- Adicionar edit de comments (manifesto §5).
- Mudar protocolo — NIP-22 + Drift extensions estão estáveis.

---

## Apêndice A — Mapa "fricção → fix"

```
US-1 (ler thread)       ──▶ UX-1 (modo lista)        ──▶ E2 4-6h
US-2 (onde estou)       ──▶ OK
US-3 (reply contexto)   ──▶ UX-3 (FAB nominal+quote) ──▶ E1 ~1.5-2h
                            UX-4 (freeze replyTo)    ──▶ E1 ~1h
US-4 (novo/antigo)      ──▶ UX-5 (border-left novo)  ──▶ E0 ~30min
                            UX-6 (lastVisit)         ──▶ E1 ~1.5h
US-5 (alternar subposts)──▶ OK
US-6 (fechar)           ──▶ UX-8 (cue persistente)   ──▶ E0 ~45min
                            UX-12 (Esc graduado)     ──▶ E1 ~1h
US-7 (post vs comment)  ──▶ UX-9 (botão header)      ──▶ E1 ~1h
```

```
Polish ortogonal:
UX-2 peek com texto    ──▶ E1 ~1.5h
UX-7 coach replay      ──▶ E0 ~30-45min
UX-10 image fullscreen ──▶ E1 ~1.5h
UX-11 footer tappable  ──▶ E0 ~30min
UX-13 empty state      ──▶ E0 ~15min
UX-14 loading skeleton ──▶ E1 ~1.5h
UX-15 a11y consistency ──▶ E1 ~45min-1h
```

## Apêndice B — Não-findings (verificados, OK)

Auditei e **não** flaguei (porque estão OK):

- **`buildThread` determinismo** — sort + tie-break em
  `thread-cursor.ts:61-67` é correto (manifesto §7).
- **Lazy subscribe refcount** — `comments.ts:298-348` resolve Ted Issue
  #4. Múltiplos consumers compartilham 1 REQ.
- **Ratelimit visual `COMMENTS_LOAD_CAP`** — Lily fixou CM-B2 (cap só
  no SELECT inicial, não em adds). Live updates não são dropped.
- **CW filtros estendem-se a comments** — `applyContentFiltersComment`
  reuso de `applyContentFilters` mantém determinismo §7.
- **Image hash verify** — `<Image meta={...}>` herda Track B.
- **EXIF strip** — herdado em uploadBlob.
- **Reduced motion** — todos os componentes usam `useReducedMotion`
  ou `motion-reduce:` Tailwind variant.
- **Focus trap** em ReplySheet — `handleTrapKey:315-334`. Funcional.

## Apêndice C — Não-decisões (Open questions levantadas pra Arquiteto)

1. **Reverter swipe ↑↓** (UX-8 long-term)? Quebrar muscle memory atual
   pra alinhar com intuição mobile? Decisão pra Robin × Ted × Barney
   numa fase posterior. Esta auditoria não decide.
2. **Petnames / NIP-05** (UX-3 80% benefit)? Track separado, não Track
   C. Mas afeta vários componentes (PostViewer, CommentCard, ReplySheet).
   Robin pode draftar RFC.
3. **`comments_view_mode` em user_prefs default `'list'`**? Mudança que
   rompe a tese "card-stack pra tudo". Decisão arquitetural pra
   discutir antes de Lily implementar. Esta auditoria recomenda **sim**.

---

*Robin · audit cap respeitada (research ~2h + escrita ~1h)*
*Track C debt da Lily resolveu técnica; este audit identifica fricção
de UX que sobreviveu aos fixes — fricção concentrada em "modelo
card-stack default" + "contexto de reply pouco explícito" + "ausência
de petnames".*
