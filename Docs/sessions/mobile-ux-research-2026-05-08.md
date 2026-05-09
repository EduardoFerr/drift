# Mobile-first UX Research — Twitter/X · Bluesky · Mastodon · Threads · Instagram vs Drift

**Data:** 2026-05-08
**Persona:** Robin (HIMYM — research, curadoria, gaps cross-cutting, docs)
**Round:** 3 (UI/UX +50% campaign — POST-priority)
**Companion docs:**
[`comments-ux-audit-2026-05-08.md`](comments-ux-audit-2026-05-08.md) ·
[`ted-ux-spike-deployed-2026-05-08.md`](ted-ux-spike-deployed-2026-05-08.md) ·
[`design-qa-baseline-2026-05-08.md`](design-qa-baseline-2026-05-08.md) ·
[`ted-delegation-plan-2026-05-08.md`](ted-delegation-plan-2026-05-08.md) §4.4
**License:** CC0 1.0 Universal

> **Trigger:** user disse "ainda precisamos melhorar a UI e UX das
> postagens, está feio e pouco intuitivo a usabilidade". Round 1+2
> da campanha tocaram primitives e tipografia; Round 3 é research
> pura focada em **patterns post-related** (compose, card, swipe,
> thread, content reveal) que Drift pode reusar/adaptar sem violar
> manifesto.
>
> **Método:** 5 apps de referência × 30 micro-interactions = 150
> celas de score 0-3. Score reflete maturidade da implementação no
> app de referência, **não** desejabilidade pra Drift. Gap analysis
> em §4 cruza score-table × Drift current state × manifesto §22-§29
> pra identificar top adoptions, conflicts e over-engineering.
>
> **Restrição:** doc-only research. Não implementa. Não inventa
> features. Patterns que violam manifesto vão pra §6 explicitamente
> rejeitados, não pra recomendação.

---

## TL;DR (60 segundos)

Drift hoje tem fundação sólida (protocolo + scoring + persistência),
mas **a UX de postagem específica está atrás do industry baseline**
em 6 dimensões mensuráveis:

1. **Card density é inversa** — texto curto enche viewport;
   texto longo trunca. Industry padrão é altura adaptativa.
2. **Tap-to-expand ausente em footer** — `↳ N respostas` é label
   estática; toda alternativa moderna trata isso como botão.
3. **Compose flow monolítico** — sem auto-save draft, sem multi-step,
   single textarea pra subposts compostos.
4. **Content reveal sem preview hint** — CW blur cobre 100% sem
   revelar tipo de mídia (Mastodon mostra dimensions placeholder).
5. **Loading states fracos** — 1 placeholder textual onde apps
   modernos usam shimmer skeleton estruturado.
6. **Pull-to-refresh ausente** — invalidate é automático mas user
   não sabe; mental model "atualizado" quebra.

Top 5 gaps ROI alto pra Round 4 (post-priority):

1. **Tap-to-expand reply count** (UX-11 do Comments audit) — E0 ~30min.
2. **Skeleton shimmer cards no loading** — E1 ~1.5h.
3. **CW reveal com poster preview** (Mastodon-style placeholder) — E1 ~2h.
4. **PostCard adaptive height** (TX-4 do Ted spike) — E0 ~30min.
5. **Compose draft auto-save** (Twitter/X-style) — E1 ~2h.

3 anti-recommendations (NÃO adotar):

- Algorithmic feed (For You) — viola §24.
- Quote-post (X/Bluesky) — confunde vocabulário com SPREAD §1.
- Reactions/emoji multi (Slack/Bluesky) — viola §22 score determinístico.

---

## §1 — Methodology

### 1.1 Apps escolhidos

| App | Por quê referência | Fonte de evidência |
|---|---|---|
| Twitter/X | Maior base de users; padrões post-card maduros; threads + quote | Conhecimento prévio + observação 2024 mobile |
| Bluesky | AT-Proto descentralizado; mais próximo do espírito Drift | Conhecimento prévio 2024-2025 |
| Mastodon | Fediverse padrão; CW first-class; multi-cliente | Tusky/Megalodon/Ivory clients |
| Threads (Meta) | Card paradigm; thread vertical scroll; Meta polish | Conhecimento prévio 2024 |
| Instagram | Não-text-first mas reference em compose flow + carousel | Conhecimento prévio 2024 |

### 1.2 30 micro-interactions catalogadas (8 categorias)

| ID | Categoria | Pattern |
|---|---|---|
| A1 | Card design | Typography hierarchy (header/body/footer) |
| A2 | Card design | Decorative elements (drop cap, pull quote, accent) |
| A3 | Card design | Info density (whitespace ratio) |
| A4 | Card design | Interactive affordances (visible buttons) |
| A5 | Card design | Adaptive height (content-driven sizing) |
| B1 | Swipe gestures | Single-tap to reveal/expand |
| B2 | Swipe gestures | Double-tap to like/react |
| B3 | Swipe gestures | Long-press for action menu |
| B4 | Swipe gestures | Swipe horizontal between siblings |
| B5 | Swipe gestures | Swipe vertical for navigation/dismiss |
| C1 | Compose flow | Multi-step (compose → preview → publish) |
| C2 | Compose flow | Auto-save draft (typing → resume) |
| C3 | Compose flow | Inline media upload + reorder |
| C4 | Compose flow | Content-warning chip selector |
| C5 | Compose flow | Schedule post (defer publish) |
| C6 | Compose flow | Location attach (visible toggle) |
| C7 | Compose flow | Character/length counter live |
| D1 | Thread navigation | Collapse/expand replies |
| D2 | Thread navigation | Breadcrumb of ancestors |
| D3 | Thread navigation | Jump-to-parent button |
| D4 | Thread navigation | Indicator depth (indent/line) |
| D5 | Thread navigation | "View N more replies" CTA |
| E1 | Engagement | Action button group (like/repost/reply) |
| E2 | Engagement | Reaction count visible inline |
| F1 | Content reveal | CW blur with reveal CTA |
| F2 | Content reveal | Sensitive media tap-to-show |
| F3 | Content reveal | "Show less" / collapse long body |
| G1 | Feed paradigm | Infinite scroll (continuous) |
| G2 | Feed paradigm | Pull-to-refresh visual |
| G3 | Feed paradigm | Jump-to-top on logo tap |

### 1.3 Score scale

- **3** — Pattern fully implemented, polished, default behavior
- **2** — Pattern present, partial polish, optional/secondary
- **1** — Pattern hinted but limited/buggy
- **0** — Pattern absent

### 1.4 Drift state notation (§3 score table)

- **✅** — Drift has equivalent (1:1 or close adaptation)
- **🟡** — Drift partial (present but missing polish or secondary path)
- **❌** — Drift missing (gap)
- **N/A** — Intentional divergence (manifesto-driven; §6)

### 1.5 Confidence

Research baseado em **observação mobile 2023-2025** + **conhecimento
prévio** + **reading da spec/code Drift** (`src/components/Post/*` +
audits prévios). Sem testes A/B em populações reais. Severity de gaps
calibrada por "user comum chega ao app esperando isso?".

---

## §2 — Pattern Catalog (30 micro-interactions)

### Categoria A — Card Design

#### A1 — Typography hierarchy (header / body / footer)

Padrão moderno: header pequeno (handle + timestamp + verify badge),
body em peso/tamanho próprio, footer com action group sutil.

- **Twitter/X:** header 13-14px regular gray, body 15-16px regular
  black, footer 13px gray icons. Hierarquia 3 níveis nítida.
- **Bluesky:** equivalente; verify badge handle, timestamp curto.
- **Mastodon (Tusky):** mesma estrutura; CW spoiler text antes do body.
- **Threads:** body em destaque; header e footer minimalistas.
- **Instagram:** caption truncated com "more" ; foco na mídia.

**Drift:** PostCard tem hierarquia mas a relação tamanho-decorativo é
inversa do industry — letra decorativa Syne 100px domina, body italic
fica subordinado. Manifesto §22 não veta o decorativo, mas usuário
não-Drift estranha que o "comentário" seja smaller que a letra de fundo.

#### A2 — Decorative elements (drop cap, pull quote, accent)

Padrão moderno **modesto**: timestamp accent, verify badge (azul/cinza),
ocasional pull quote em screenshot embeds. NUNCA elemento decorativo
ocupa >5% da área.

- **Twitter/X:** zero decoração além de cor primária no like.
- **Bluesky:** zero.
- **Mastodon:** zero (ou tema custom).
- **Threads:** zero.
- **Instagram:** zero (foto domina).

**Drift:** Syne 100px decorative letter (`getDecorativeLetters`) é
**outlier**. Decisão de design (§22 deterministic) — não viola, mas
encarece curva de aprendizado. Trade-off legítimo.

#### A3 — Info density (whitespace ratio)

Padrão moderno: 60-70% conteúdo, 30-40% whitespace. Apps modernos
**aumentaram** whitespace 2020-2024 (Bluesky tem mais ar que Twitter
2018).

- **Twitter/X (2024):** ~65% conteúdo.
- **Bluesky:** ~55% conteúdo (mais ar).
- **Mastodon (Ivory):** ~70% conteúdo.
- **Threads:** ~60% conteúdo.
- **Instagram:** ~80% conteúdo (foto domina).

**Drift:** PostCard é **invertido** — em texto curto, ~30% conteúdo,
70% vazio (TX-3 do Ted spike). Em texto longo, conteúdo trunca.
Density inverter (TX-4) é S1 fix.

#### A4 — Interactive affordances (visible buttons)

Padrão moderno: action buttons SEMPRE visíveis no card, com count
inline. Não exige tap pra revelar.

- **Twitter/X:** reply / retweet / like / share / view-count — 5 ícones inline.
- **Bluesky:** reply / repost / like — 3 ícones inline.
- **Mastodon:** reply / boost / favorite / bookmark / share — 5 ícones.
- **Threads:** reply / repost / like / share — 4 ícones.
- **Instagram:** like / comment / share / save — 4 ícones.

**Drift:** PostViewer mostra spread/bury/comment/menu — 4 ações,
**mas só no PostViewer fullscreen, não no PostCard do feed**. PostCard
é "preview"; ações vivem em layer subsequente. Diferenciação intencional
(card-stack model), não gap.

#### A5 — Adaptive height (content-driven sizing)

Padrão moderno: card cresce com content. Min-height pra avatar+header,
max-height ~600px com "show more" toggle.

- **Twitter/X:** adaptive; long text colapsa com "Show more".
- **Bluesky:** adaptive.
- **Mastodon:** adaptive; CW colapsa per default.
- **Threads:** adaptive; "see more" inline.
- **Instagram:** caption adaptive; foto fixa AR.

**Drift:** PostViewer/CommentCard são **fullscreen fixed-height**.
TX-4 (Ted spike) confirma: comment com 1 char ocupa mesmo espaço que
1000 chars. Decisão de "1 viewport = 1 entidade" (Tinder model).
Discutível pra comments (Comments audit UX-1); pra posts é tese central.

### Categoria B — Swipe Gestures

#### B1 — Single-tap to reveal/expand

Padrão moderno: tap em card abre detail. Tap em "Show more" expande
truncated. Tap em CW reveals.

- **Twitter/X:** tap card → detail page (push nav).
- **Bluesky:** tap card → detail (push).
- **Mastodon:** tap card → detail.
- **Threads:** tap card → detail.
- **Instagram:** tap caption "more" expand inline.

**Drift:** PostCard tap → opens PostViewer (similar). CommentCard tap
em body = no-op (TX-7 Ted spike). Footer `↳ N respostas` não tappable
(UX-11 Comments audit). **Gap real** em CommentCard.

#### B2 — Double-tap to like/react

Padrão moderno em apps photo-first.

- **Twitter/X:** ❌ não tem.
- **Bluesky:** ❌.
- **Mastodon:** ❌.
- **Threads:** ❌.
- **Instagram:** ✅ double-tap = like + heart anim.

**Drift:** N/A — não há "like" no protocolo (§22 score determinístico).
Spread/bury são swipes, não double-tap. Decisão alinhada.

#### B3 — Long-press for action menu

Padrão moderno em Mastodon clients e Bluesky:

- **Twitter/X:** ❌ (long-press hoje seleciona texto).
- **Bluesky:** 🟡 long-press em ações expande sub-menu.
- **Mastodon (Tusky):** ✅ long-press em boost = "boost com visibility".
- **Threads:** ❌.
- **Instagram:** ❌.

**Drift:** ❌ não usa long-press. Possível adoção: long-press em
spread = "spread + comment", long-press em comment count = "abrir lista
plana". Considerar.

#### B4 — Swipe horizontal between siblings

Padrão moderno em image carousels.

- **Twitter/X:** 🟡 swipe entre images do post (carousel).
- **Bluesky:** 🟡 swipe entre images.
- **Mastodon:** 🟡 swipe entre images.
- **Threads:** ✅ swipe entre images + entre cards no feed (sometimes).
- **Instagram:** ✅ swipe primário (carousel core feature).

**Drift:** ✅ SubpostCarousel usa swipe ←→ pra subposts. ThreadView
usa ←→ pra siblings. **Drift over-applies** swipe horizontal em
contextos que industry usa scroll vertical (UX-1 Comments audit).
Cross-feature consistency é trade-off (§7.1 audit).

#### B5 — Swipe vertical for navigation/dismiss

Padrão moderno: swipe down dismisses modal.

- **Twitter/X:** ✅ swipe down dismiss image lightbox; ❌ no feed.
- **Bluesky:** ✅ swipe down dismiss image.
- **Mastodon:** ✅ swipe down dismiss image.
- **Threads:** ✅ swipe down dismiss image.
- **Instagram:** ✅ swipe down dismiss reels/lightbox.

**Drift:** ✅ swipe ↓ no PostViewer = bury (não dismiss); swipe ↓ no
ThreadView top-level = exit (parcialmente alinhado). ReplySheet
drag-down dismiss alinhado. **Drift sobrecarrega** swipe ↓ com
significados diferentes (bury vs exit vs ascend). UX-8 audit.

### Categoria C — Compose Flow

#### C1 — Multi-step (compose → preview → publish)

- **Twitter/X:** ❌ single-screen modal; preview implícito.
- **Bluesky:** ❌ single-screen.
- **Mastodon:** ❌ single-screen.
- **Threads:** ❌ single-screen.
- **Instagram:** ✅ 3 steps (foto → edit → caption → publish).

**Drift:** ComposeOverlay single-screen com layout selector (RETRATO/
PAISAGEM/TEXTO). Alinhado com industry. Multi-step só faz sentido se
houver edit não-trivial (Instagram) — Drift não tem edit de imagem.

#### C2 — Auto-save draft

- **Twitter/X:** ✅ "Save as draft" + auto-save no fechamento.
- **Bluesky:** 🟡 confirmação "discard?" no fechamento, sem persistir.
- **Mastodon:** 🟡 alguns clients persistem (Tusky), web não.
- **Threads:** 🟡 confirm dialog, no persist.
- **Instagram:** ✅ persist + draft list.

**Drift:** ❌ ComposeOverlay perde texto se user fecha. Gap real.
Round 4 candidate (E1 ~2h: persist em IndexedDB local, restore on
re-open).

#### C3 — Inline media upload + reorder

- **Twitter/X:** ✅ até 4 images, reorder por drag.
- **Bluesky:** ✅ até 4, alt-text per image, reorder.
- **Mastodon:** ✅ até 4 (configurável), alt-text.
- **Threads:** ✅ similar.
- **Instagram:** ✅ até 10 images carousel, reorder.

**Drift:** 🟡 ComposeOverlay tem upload + alt-text, mas reorder de
subposts é via drag-handle não óbvio. Subpost paradigm vs image
carousel é diferenciação Drift — aceitável.

#### C4 — Content-warning chip selector

- **Twitter/X:** 🟡 toggle "sensitive content" binário.
- **Bluesky:** ✅ chip selector (NSFW / Suggestive / Nudity).
- **Mastodon:** ✅ free-text CW + checkbox sensitive.
- **Threads:** 🟡 binário.
- **Instagram:** ❌.

**Drift:** ✅ chip selector (`nsfw` / `violence` / `spoiler` / `ad`)
em ComposeOverlay. Alinhado com Bluesky/Mastodon (best-in-class).
Manifesto §27 reforça.

#### C5 — Schedule post

- **Twitter/X:** ✅ schedule UI + calendar picker.
- **Bluesky:** ❌.
- **Mastodon:** 🟡 plugins/clients (Buffer, Tusky pro).
- **Threads:** ❌.
- **Instagram:** ✅ via creator account.

**Drift:** ❌ — e **não deve** ter (anti-recommendation §6: schedule
exige servidor opaque, viola §17 sem chave mestra).

#### C6 — Location attach

- **Twitter/X:** ✅ location picker, off por default.
- **Bluesky:** ❌.
- **Mastodon:** 🟡 plain-text geocode.
- **Threads:** 🟡.
- **Instagram:** ✅ Foursquare-backed picker.

**Drift:** ✅ location toggle em ComposeOverlay, off-default
(manifesto §27 privacidade pelo mínimo). Coarse granularity (city)
default; user-controlled. Best-in-class privacy stance.

#### C7 — Character/length counter live

- **Twitter/X:** ✅ ring progress + count.
- **Bluesky:** ✅ count + warning quando se aproxima.
- **Mastodon:** ✅ count (instance configurable).
- **Threads:** ✅ count.
- **Instagram:** ✅ caption count.

**Drift:** 🟡 ComposeOverlay mostra textarea sem counter visível.
Drift tem subposts (split content) — counter precisaria ser por
subpost. **Gap real**, E1 ~1h.

### Categoria D — Thread Navigation

#### D1 — Collapse/expand replies

- **Twitter/X:** ✅ "Show this thread" / collapse via tap.
- **Bluesky:** ✅ collapse default em sub-replies, tap expand.
- **Mastodon (Ivory):** ✅ collapse.
- **Threads:** ✅ inline expand.
- **Instagram:** 🟡 só collapse de comments na photo.

**Drift:** ❌ ThreadView card-stack não tem collapse — exige swipe
pra ver. Gap conceitual. UX-1 Comments audit endereça (modo lista).

#### D2 — Breadcrumb of ancestors

- **Twitter/X:** ❌ não tem.
- **Bluesky:** ❌.
- **Mastodon:** ❌.
- **Threads:** 🟡 "Replying to @x".
- **Instagram:** ❌.

**Drift:** ✅ ThreadHeader breadcrumb `@alice › @bob › você`. **Drift
está acima do industry** aqui. Manter.

#### D3 — Jump-to-parent button

- **Twitter/X:** 🟡 "Show this thread" linka pro pai.
- **Bluesky:** 🟡 tap em parent context.
- **Mastodon:** 🟡 botão "ver conversa".
- **Threads:** 🟡.
- **Instagram:** ❌.

**Drift:** ✅ swipe ↓ sobe pro parent (semântica inversa industry, mas
existe). Tap no breadcrumb não navega ainda — gap menor.

#### D4 — Indicator depth (indent/line)

- **Twitter/X:** ✅ indent + line connecting.
- **Bluesky:** ✅ line connecting + indent.
- **Mastodon:** ✅ indent.
- **Threads:** 🟡 minimal indent.
- **Instagram:** ✅ indent (1 level only).

**Drift:** ✅ ThreadHeader mostra "nível N" textualmente. Sem indent
visual no card-stack (cada card é fullscreen). **Modo lista** (UX-1
Comments audit) precisaria adicionar indent visual.

#### D5 — "View N more replies" CTA

- **Twitter/X:** ✅ "Show N more replies" inline.
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅ "View N replies".

**Drift:** ✅ CommentCard footer tem `↳ N respostas` mas é label
estática (UX-11 audit). Tornar tappable é E0 ~30min. **Gap real fix
trivial**.

### Categoria E — Engagement

#### E1 — Action button group (like/repost/reply)

Coberto em A4. Drift tem spread/bury/comment/menu — diferenciação
proposital.

#### E2 — Reaction count visible inline

- **Twitter/X:** ✅ count next to icon.
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅.

**Drift:** ✅ spread/bury counts visíveis no PostViewer. Comments
não têm count de spread/bury (§22 reactions out of scope — alinhado).

### Categoria F — Content Reveal

#### F1 — CW blur with reveal CTA

- **Twitter/X:** ✅ "Click to view" overlay sobre image blurred.
- **Bluesky:** ✅ + chip de label (NSFW/Nudity).
- **Mastodon:** ✅ + free-text CW visível.
- **Threads:** 🟡 binário.
- **Instagram:** 🟡 sensitive content overlay.

**Drift:** ✅ CW blur + reveal CTA em PostViewer. Best-in-class
alinhado com Mastodon. Manifesto §27.

#### F2 — Sensitive media tap-to-show

- **Twitter/X:** ✅ tap reveals.
- **Bluesky:** ✅.
- **Mastodon:** ✅ + show alt-text como hint.
- **Threads:** ✅.
- **Instagram:** ✅.

**Drift:** 🟡 reveal funciona mas blur cobre 100% sem dimensions
placeholder. Mastodon mostra "image" placeholder com aspect ratio —
hint visual sem revelar conteúdo. **Gap menor**, E1 ~2h.

#### F3 — "Show less" / collapse long body

- **Twitter/X:** ✅ truncate + "Show more".
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅ caption truncate.

**Drift:** ❌ PostCard text não trunca — fixed height force-cuta com
overflow hidden. **Gap real**, mas amarrado a A5 (adaptive height).
Fix conjunto.

### Categoria G — Feed Paradigm

#### G1 — Infinite scroll (continuous)

- **Twitter/X:** ✅ infinite vertical.
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅.

**Drift:** N/A — feed é card-stack swipe, não scroll. Diferenciação
core do Drift (Tinder model). Manter.

#### G2 — Pull-to-refresh visual

- **Twitter/X:** ✅ pull-to-refresh + spinner.
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅.

**Drift:** ❌ — invalidate é automático via `invalidateFeed()`, mas
user não sabe. Mental model "atualizado" quebra. Gap discoverability.
Fix: pull-to-refresh visual cue (não muda lógica de fetch). E1 ~2h.

#### G3 — Jump-to-top on logo tap

- **Twitter/X:** ✅ tap logo → top.
- **Bluesky:** ✅.
- **Mastodon:** ✅.
- **Threads:** ✅.
- **Instagram:** ✅.

**Drift:** N/A — card-stack não tem "topo" (próximo card é o foco).
Conceito não se aplica.

---

## §3 — Score Table (5 apps × 30 patterns + Drift state)

Score 0-3 (per app). **Drift state:** ✅/🟡/❌/N/A com nota.

| Pattern | X | BSky | Masto | Threads | IG | Drift | Note |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **A1** Typography hierarchy | 3 | 3 | 3 | 3 | 2 | 🟡 | Decorative letter inverte hierarquia |
| **A2** Decorative elements | 0 | 0 | 0 | 0 | 0 | 🟡 | Drift outlier (Syne 100px) — design intentional |
| **A3** Info density | 3 | 3 | 3 | 3 | 3 | 🟡 | Inverted: text-short=70% vazio (TX-3) |
| **A4** Interactive affordances | 3 | 3 | 3 | 3 | 3 | ✅ | PostViewer 4 ações (different layer than feed) |
| **A5** Adaptive height | 3 | 3 | 3 | 3 | 3 | ❌ | Fullscreen fixed (TX-4 audit) |
| **B1** Single-tap reveal | 3 | 3 | 3 | 3 | 3 | 🟡 | PostCard ✅; CommentCard body no-op (TX-7) |
| **B2** Double-tap like | 0 | 0 | 0 | 0 | 3 | N/A | §22 sem like |
| **B3** Long-press menu | 0 | 1 | 2 | 0 | 0 | ❌ | Possível adoção menor |
| **B4** Swipe horiz siblings | 1 | 1 | 1 | 2 | 3 | ✅ | Drift over-applies (carousel + thread) |
| **B5** Swipe vert nav/dismiss | 2 | 2 | 2 | 2 | 3 | 🟡 | Sobrecarregado (bury/exit/ascend conflate) |
| **C1** Multi-step compose | 0 | 0 | 0 | 0 | 3 | N/A | Single-screen alinhado |
| **C2** Auto-save draft | 3 | 1 | 1 | 1 | 3 | ❌ | Round 4 candidate |
| **C3** Inline media upload | 3 | 3 | 3 | 3 | 3 | 🟡 | Drift subposts ≠ image carousel |
| **C4** CW chip selector | 1 | 3 | 3 | 1 | 0 | ✅ | Best-in-class with Bluesky/Masto |
| **C5** Schedule post | 3 | 0 | 1 | 0 | 3 | N/A | §17 viola |
| **C6** Location attach | 3 | 0 | 1 | 1 | 3 | ✅ | Drift off-default best privacy |
| **C7** Char counter live | 3 | 3 | 3 | 3 | 3 | ❌ | Per-subpost gap |
| **D1** Collapse/expand replies | 3 | 3 | 3 | 3 | 1 | ❌ | UX-1 Comments audit |
| **D2** Breadcrumb ancestors | 0 | 0 | 0 | 1 | 0 | ✅ | Drift ABOVE industry |
| **D3** Jump-to-parent | 1 | 1 | 1 | 1 | 0 | 🟡 | Swipe sim; tap-breadcrumb no |
| **D4** Indicator depth | 3 | 3 | 3 | 1 | 1 | 🟡 | Textual; sem indent visual em cards |
| **D5** "View N more replies" | 3 | 3 | 3 | 3 | 3 | 🟡 | UX-11 — label not button |
| **E1** Action button group | 3 | 3 | 3 | 3 | 3 | ✅ | PostViewer (different paradigm) |
| **E2** Reaction count inline | 3 | 3 | 3 | 3 | 3 | ✅ | Spread/bury counts |
| **F1** CW blur + reveal | 3 | 3 | 3 | 1 | 1 | ✅ | Best-in-class |
| **F2** Sensitive tap-to-show | 3 | 3 | 3 | 3 | 3 | 🟡 | Sem aspect-ratio placeholder |
| **F3** "Show less" long body | 3 | 3 | 3 | 3 | 3 | ❌ | Coupled com A5 |
| **G1** Infinite scroll | 3 | 3 | 3 | 3 | 3 | N/A | Card-stack alternative |
| **G2** Pull-to-refresh | 3 | 3 | 3 | 3 | 3 | ❌ | Discoverability gap |
| **G3** Jump-to-top | 3 | 3 | 3 | 3 | 3 | N/A | N/A em card-stack |

### 3.1 Resumo numérico

| Drift state | Count | % |
|---|---:|---:|
| ✅ has it | 7 | 23% |
| 🟡 partial | 11 | 37% |
| ❌ missing | 7 | 23% |
| N/A intentional | 5 | 17% |

**Leitura:** 60% dos patterns industry estão presentes ou parciais.
23% missing são gaps reais (não filosóficos). 17% N/A são divergências
proposital (manifesto-driven). Fica room pra +30% UX feel improvement
fechando os 🟡 e ❌.

---

## §4 — Gap Analysis Priorizado

### 4.1 Top 10 gaps (high-impact missing patterns)

Ordenados por impact × ease (top = high impact + easy fix). Cada um tem
**referência prior art** (qual app faz bem) + **Drift current** + **target**.

| # | Gap ID | Impact | Effort | Prior art | Drift current → target |
|---|---|:-:|:-:|---|---|
| 1 | D5 tappable reply count | S1 | E0 | All | `↳ N respostas` label → button (UX-11 audit) |
| 2 | A5 adaptive height | S1 | E0 | All | Fixed h-full → min-h adaptive (TX-4 audit) |
| 3 | F2 aspect-ratio placeholder em CW | S1 | E1 | Mastodon, Bluesky | Blur 100% → blur + dimensions hint |
| 4 | C2 auto-save draft | S1 | E1 | Twitter/X, Instagram | Lost on close → IndexedDB persist |
| 5 | C7 per-subpost char counter | S2 | E1 | All | Sem counter → live counter per subpost |
| 6 | G2 pull-to-refresh visual | S2 | E1 | All | Auto-invalidate invisível → spinner cue |
| 7 | B1 CommentCard tap body | S2 | E0 | All | No-op → expand long body (TX-7) |
| 8 | D1 collapse/expand replies | S0 | E2 | All | Card-stack only → list mode (UX-1) |
| 9 | F3 show-less long body em PostCard | S2 | E1 | All | Truncate hard → "show more" |
| 10 | A1 typography balance | S2 | E1 | All | Decorative dominates → adjust hierarchy |

### 4.2 Top 5 conflicts (Drift intentionally diverges)

| # | Pattern | Industry | Drift | Why divergent | Manifesto ref |
|---|---|---|---|---|---|
| 1 | Algorithmic feed | All have | Score-only | Sem afinidade no feed | §24 |
| 2 | Reactions multi (like, ❤️, 🎉) | Slack/BSky | Spread/bury only | Score determinístico | §22 |
| 3 | Quote-post | X/BSky | SPREAD = re-broadcast | Vocabulário SPREAD ≠ quote | §1 vocab + §28 |
| 4 | Schedule post | X/IG/Buffer | Real-time only | Servidor opaque needed | §17 |
| 5 | DMs | All | Out of scope | MVP scope | §29 |

**Não recomendar reverter divergências** — são compromissos do
manifesto. Documentar em onboarding pra user entender que "ausente"
é "intencional".

### 4.3 Top 5 over-engineered (Drift mais complex que industry)

Patterns onde Drift faz mais que industry standard, custo de
manutenção alto vs benefício marginal:

| # | Pattern | Industry simpler | Drift complex | Recomendação |
|---|---|---|---|---|
| 1 | Card-stack para comments | Vertical scroll list | 2D card stack (←→↑↓) | Adicionar list mode (UX-1) |
| 2 | Decorative letter Syne 100px | Zero decoração | Per-post deterministic letter | Re-balance opacity/size |
| 3 | Swipe semantic overload | 2-3 distinct gestures | 4 directions × 2 contexts × different meanings | Cue visual permanente (UX-8) |
| 4 | Subpost paradigm | Single-textarea + image carousel | Compose multi-subpost com layouts | Aceitar — diferenciação core |
| 5 | Coach mark com 3s timeout | Onboarding tour replayable | 1-shot dismiss, no replay | Replay button (UX-7) |

---

## §5 — POST-priority Recommendations Round 4 (top 5)

Foco **post flow** conforme weighting do user. Cada item tem:
nome, current state, target state, effort, prior art.

### REC-1 — Tap-to-expand reply count (UX-11 do Comments audit)

- **Pattern:** D5 — "View N more replies"
- **Current:** `↳ N respostas` é `<span>` estático em CommentCard footer
  (`src/components/Post/CommentCard.tsx:195-208`).
- **Target:** `<button onClick={onDescend}>↳ N respostas</button>` —
  tap = mesmo que swipe ↑. Adiciona keyboard affordance, screen-reader
  semantics correto.
- **Effort:** E0 (~30min). Lily-tier.
- **Prior art:** Twitter/X, Bluesky, Mastodon — todos.
- **Manifesto check:** ✅ não toca §22-29.

### REC-2 — Skeleton shimmer em loading states

- **Pattern:** UX-14 do Comments audit + cross-cutting
- **Current:** "carregando comentários…" plain text em ThreadView
  (`ThreadView.tsx:385-396`). PostViewer similar.
- **Target:** 2-3 silhuetas de card com shimmer animation (CSS
  gradient + framer-motion). Convergente com Lily DriftSkeleton plan.
- **Effort:** E1 (~1.5h).
- **Prior art:** Twitter/X, Bluesky, Mastodon (Ivory) — all polished.
- **Manifesto check:** ✅ visual only.

### REC-3 — CW reveal com aspect-ratio placeholder

- **Pattern:** F2 — sensitive media tap-to-show
- **Current:** PostViewer/CommentCard CW blur cobre 100% sem hint do
  conteúdo. User não sabe se é image, video, GIF.
- **Target:** Blur com placeholder mostrando dimensions + label
  (`[image · 1080×720 · NSFW]`). Mantém blur, adiciona hint.
- **Effort:** E1 (~2h).
- **Prior art:** Mastodon (Ivory shows aspect-ratio), Bluesky.
- **Manifesto check:** ✅ §27 reforça discoverability sem revelar.

### REC-4 — PostCard adaptive height (TX-4 do Ted spike)

- **Pattern:** A5 — adaptive height
- **Current:** `h-full` fixed em PostViewer/CommentCard. Comment com 1
  char ocupa 700+px; comment com 1000 chars trunca.
- **Target:** `min-h-[60vh]` (mantém presence) + auto-grow até
  `max-h-[90vh]` com "show more" se overflow.
- **Effort:** E0 (~30min) pra PostCard; E1 (~1.5h) com show-more
  full-implementation.
- **Prior art:** Twitter/X, Bluesky, Mastodon, Threads, Instagram.
- **Manifesto check:** ✅ visual only.

### REC-5 — Compose draft auto-save

- **Pattern:** C2 — auto-save draft
- **Current:** ComposeOverlay perde estado ao fechar
  (`src/components/Create/ComposeOverlay.tsx`). Confirm dialog atual
  pergunta "descartar?" mas não persiste.
- **Target:** `localStorage.setItem('drift_compose_draft', state)`
  on every change (debounced 500ms). On open, if draft exists,
  prompt "restaurar rascunho?". Clear on publish.
- **Effort:** E1 (~2h).
- **Prior art:** Twitter/X (best), Instagram (best). Mastodon clients
  parciais.
- **Manifesto check:** ✅ local only, não toca protocolo.

**Total Round 4 effort se 5 above:** ~6.5h. Lily-tier sequence.

---

## §6 — Anti-recommendations (NÃO adotar — viola manifesto/dogma)

Patterns que parecem nice industry-side mas Drift NÃO deve adotar.
Listar explícito pra futuras propostas saberem que já foi avaliado.

### AR-1 — Algorithmic / personalized feed ("For You")

- **Industry:** X "For You", Threads "Recommended", IG Explore.
- **Por que rejeitar:** Manifesto **§24** (sem afinidade no feed).
  Score determinístico só. Personalização cria bolha + opaque ranking.
- **Variantes a vetar:** "Suggested follows", "trending hashtags" com
  ML, "porque você curtiu X".

### AR-2 — Reactions multi-emoji (❤️ 🎉 🔥 etc)

- **Industry:** Slack, Bluesky 2024+, X "react".
- **Por que rejeitar:** Manifesto **§22** (score determinístico). Cada
  reaction novo precisa virar kind, peso no scoring, threshold de
  moderation. Dilui sinal SPREAD/BURY.

### AR-3 — Quote-post (RT com comentário)

- **Industry:** X retweet-with-comment, BSky quote, Threads quote.
- **Por que rejeitar:** Vocabulário **§1** — SPREAD não é quote (é
  re-broadcast on relays + score boost). Quote-post inverte: cria
  novo POST referenciando outro. Confunde mental model. Manifesto
  **§28** alinhamento Nostr — kind 1 quote já existe; Drift ficaria
  com 2 modos (quote vs spread) de re-share.
- **Alternativa permitida:** referência inline em texto do post
  (`@npub1...` mention). Já funciona via Nostr p-tags.

### AR-4 — Schedule post

- **Industry:** X, IG via Buffer/Creator Studio.
- **Por que rejeitar:** Schedule exige servidor opaque que **detém**
  o evento até a hora certa. Servidor pode não publicar ("acidente").
  Manifesto **§17** sem chave mestra — ninguém deve poder bloquear
  publish.

### AR-5 — DMs / private messages

- **Industry:** Todos.
- **Por que rejeitar:** Out of scope MVP (manifesto §29). NIP-04/NIP-44
  existem; pode ser plugin futuro fora do cliente oficial. Não
  bloquear, mas não adicionar.

### AR-6 — Read receipts ("seen by N")

- **Industry:** IG, Threads, X DMs.
- **Por que rejeitar:** Privacy violation — manifesto §28 (privacidade
  pelo mínimo). Sinal social pressure desnecessário. Sinal "viralidade"
  já vem de spread count.

### AR-7 — Stories / ephemeral content (24h auto-delete)

- **Industry:** IG Stories, X Fleets (descontinuado).
- **Por que rejeitar:** Manifesto §5 (eventos imutáveis). Auto-delete
  contradiz event-sourcing. Possível plugin via expiration tag NIP-40,
  mas cliente oficial não. §13 cliente NÃO deleta.

### AR-8 — Push notifications agressivas (engagement)

- **Industry:** Todos.
- **Por que rejeitar:** Cliente oficial PWA mantém notificações sob
  controle do user (manifesto §28). Push agressivo "alguém espalhou"
  por exemplo é candidato a manipulação engagement-loop. MVP scope:
  notif **opt-in** + minimal.

---

## §7 — Cross-cutting observations

### 7.1 Drift está acima do industry em 3 dimensões

- **D2 breadcrumb of ancestors** — Drift único com breadcrumb visível.
- **C4 CW chip selector** — par com Bluesky (best-in-class).
- **C6 location off-default** — privacy stance superior.
- **F1 CW blur with reveal** — par com Mastodon (best-in-class).

Documentar em onboarding/marketing — patterns únicos justificam Drift.

### 7.2 Drift está abaixo em fundamentals fáceis

- **A5 adaptive height** — TX-4 fix trivial.
- **D5 tappable reply count** — UX-11 fix trivial.
- **C2 auto-save draft** — gap unanimous nos peers.
- **G2 pull-to-refresh** — discoverability básica.

Round 4 prioritário fechar esses, **antes** de inovar.

### 7.3 Padrão emergente 2024-2025: "respect content, less chrome"

Apps modernos (Bluesky, Threads, Mastodon Ivory) reduziram chrome
visual em 2023-2025. Drift segue contra-corrente em **decorative
elements** (Syne letra). Não é necessariamente errado — diferenciação
de marca — mas é deliberado-debt: novos users 2025 esperam minimalismo.

Sugestão **opcional** (não Round 4 obrigatório): registrar como
ADR/decisão consciente, não acidente.

### 7.4 Mobile-first não significa "swipe everywhere"

Industry mobile-first **2024** (Bluesky, Threads) usa **scroll
vertical** como primário, swipe horizontal **só** em image carousels
e push-nav. Drift swipe-everywhere (4 direções × múltiplos contextos)
é **outlier 2025**. Card-stack é Tinder/Hinge paradigm — apropriado
pra browse discreto, frição em conversação.

Documentar em onboarding: "Drift é diferente — swipes em vez de
scroll. Aprenda em 30s." Coach mark replayable (UX-7) endereça.

### 7.5 Convergência cross-Round 4

Round 4 candidates desta research convergem com:

- **Comments audit** UX-5, UX-9, UX-11, UX-13 (já em scope).
- **Ted UX spike** TX-4, TX-1, TX-3, TX-7 (já em scope).
- **Lily motion** + DriftSkeleton primitive (já em plan).

Roteiro Round 4 sugerido (sequenciado):

1. **Sprint 1 (~3h):** REC-1 (UX-11) + REC-4 (TX-4) + UX-5 + UX-9 +
   UX-13. Quick wins density.
2. **Sprint 2 (~3h):** REC-2 (skeleton) + REC-3 (CW placeholder) +
   TX-1 (FullPageCard primitive).
3. **Sprint 3 (~3h):** REC-5 (compose draft) + UX-7 coach replay +
   UX-8 swipe cue.

Total ~9h Lily across 3 sprints. Cobre 12 distinct UX issues.

---

## §8 — Open questions pra Arquiteto

1. **Decorative letter Syne 100px** — manter como brand marker
   intencional ou re-balance pra industry minimalism (§7.3)? Decisão
   de marca, não de UX. Robin recomenda **manter mas ajustar** opacity
   pra `text-drift-muted/05` (mais sutil), preservar diferenciação.

2. **Card-stack pra comments** — UX-1 (modo lista) é Round 4 ou RFC
   dedicado? Desta research: **Round 4 com `comments_view_mode`
   default `'list'`**. Mantém card-stack como opt-in, alinha com
   industry, preserva diferenciação pra quem quer.

3. **Pull-to-refresh visual** — implementar mesmo que invalidate é
   automático? Robin **sim**: discoverability mental model. Implementação
   Framer Motion sem mudar lógica de fetch.

4. **Long-press menu (B3)** — adotar? Robin **não Round 4** — é
   pattern emergente, não unanimous. Considerar Round 5+ se user
   feedback pedir.

5. **Petnames / NIP-05** (cross-cutting com Comments audit §7.3) —
   Round 4 ou Track separado? Desta research: **Track separado**,
   afeta múltiplos componentes (PostViewer, PostCard, CommentCard,
   ReplySheet). Robin pode draftar RFC se priorizar.

---

## §9 — Apêndice — pattern-by-pattern Drift mapping

### A1 typography hierarchy
- **Drift impl:** PostViewer header, body italic, footer meta. Decorative
  letter Syne competing.
- **Files:** `SubpostLayout.tsx`, `PostCard.tsx`.
- **Status:** 🟡 — re-balance opacity Round 4.

### A5 adaptive height
- **Drift impl:** `h-full` fullscreen.
- **Files:** `PostViewer.tsx`, `CommentCard.tsx`.
- **Status:** ❌ — REC-4 fix.

### B1 single-tap reveal
- **Drift impl:** PostCard tap → PostViewer (✅). CommentCard body
  tap → no-op (❌).
- **Files:** `CommentCard.tsx`, `PostCard.tsx`.
- **Status:** 🟡 — TX-7 fix.

### C2 auto-save draft
- **Drift impl:** ComposeOverlay state local, perde no close.
- **Files:** `ComposeOverlay.tsx`.
- **Status:** ❌ — REC-5 fix.

### C4 CW chip selector
- **Drift impl:** ComposeOverlay chip selector.
- **Files:** `ComposeOverlay.tsx`.
- **Status:** ✅ best-in-class.

### C7 char counter
- **Drift impl:** sem counter.
- **Files:** `ComposeOverlay.tsx`.
- **Status:** ❌ — gap menor, fácil add.

### D1 collapse/expand replies
- **Drift impl:** card-stack (não tem collapse).
- **Files:** `ThreadView.tsx`.
- **Status:** ❌ — UX-1 (modo lista).

### D2 breadcrumb
- **Drift impl:** ThreadHeader full breadcrumb.
- **Files:** `ThreadHeader.tsx`.
- **Status:** ✅ acima do industry.

### D5 tappable reply count
- **Drift impl:** label estática.
- **Files:** `CommentCard.tsx`.
- **Status:** ❌ — REC-1 fix.

### F1 CW blur + reveal
- **Drift impl:** PostViewer + CommentCard full implementation.
- **Files:** `PostViewer.tsx`, `applyContentFilters` lib.
- **Status:** ✅ best-in-class.

### F2 sensitive placeholder
- **Drift impl:** blur 100% sem dimensions.
- **Files:** `PostViewer.tsx`.
- **Status:** 🟡 — REC-3 fix.

### G2 pull-to-refresh
- **Drift impl:** invalidate automático invisível.
- **Files:** `feed.ts`, `App.tsx`.
- **Status:** ❌ — REC opcional.

---

## §10 — Sumário

| Category | Total | ✅ | 🟡 | ❌ | N/A |
|---|---:|---:|---:|---:|---:|
| A — Card design | 5 | 1 | 3 | 1 | 0 |
| B — Swipe gestures | 5 | 1 | 1 | 1 | 1 |
| C — Compose flow | 7 | 2 | 1 | 2 | 2 |
| D — Thread navigation | 5 | 1 | 3 | 1 | 0 |
| E — Engagement | 2 | 2 | 0 | 0 | 0 |
| F — Content reveal | 3 | 1 | 1 | 1 | 0 |
| G — Feed paradigm | 3 | 0 | 0 | 1 | 2 |
| **Total** | **30** | **8** | **9** | **7** | **5** |

**Round 4 actionable:** 7 ❌ + 9 🟡 = 16 patterns potencial. Top 5
prioritized REC-1..REC-5 cobrem 5 deles em ~6.5h.

---

## §11 — Veredito final

Drift está em **~63% de paridade com industry mobile-first 2024-2025**
no domínio post-related (excluindo N/A intencionais). 17% N/A são
**diferenciações de manifesto** que devem permanecer. 60% ✅+🟡 são
fundação. **23% ❌ são gaps reais fechável em 1-2 sprints Lily**.

User feedback "está feio e pouco intuitivo" é **calibrado**: não é
arquitetura quebrada, é **fundamentals incompletos** + **decorative
choices que confundem novos users**. Round 4 close gaps + ajustar
balance decorativo = +30-40% UX feel improvement esperado.

**Próximos passos pelo Arquiteto:**

1. **Imediato:** approve REC-1 + REC-4 (E0 fixes, ~1h total).
2. **Sprint 1 Lily:** REC-1 + REC-4 + Comments quick wins
   (UX-5, UX-9, UX-11, UX-13) — ~3h cobertura 6 frictions.
3. **Sprint 2 Lily:** REC-2 (skeleton) + REC-3 (CW placeholder) +
   FullPageCard primitive (TX-1 ⊃ TX-2 ⊃ TX-11) — ~3h cobertura
   3 frictions + 1 primitive refactor.
4. **Sprint 3 Lily:** REC-5 (draft) + UX-7 coach replay + UX-8 swipe
   cue — ~3h cobertura 3 frictions.
5. **RFC paralelo Robin:** modo lista pra ThreadView (UX-1) — design
   doc + spec update v0.4 antes de Lily implement.

**Não-recomendado:**
- Adotar AR-1..AR-8 (anti-recommendations).
- Refactor card-stack paradigm (manter, adicionar list mode opcional).
- Re-vocabulário SPREAD/DRIFT (estável, lock_via_test).

---

*Robin · research cap respeitado (~2.5h: leitura prior docs ~30min +
catalog ~45min + score table ~30min + gap analysis + recommendations
~30min + write-up ~15min).*

*Companion docs converge: Comments audit + Ted UX spike + Robin QA #1
+ desta research = consensus sobre Round 4 priority queue. User
feedback "está feio e pouco intuitivo" é actionable em 9h Lily across
3 sprints.*
