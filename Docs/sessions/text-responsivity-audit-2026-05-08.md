# Text/Font Responsivity Audit — Drift v0.7

**Data:** 2026-05-08
**Persona:** Ted (HIMYM — arquitetura, padrões, escala)
**Escopo:** auditoria de tipografia responsiva nos 7 componentes que cobrem
~90% das telas (PostCard, PostViewer, CommentCard, ThreadHeader,
ComposeOverlay, IdentityPanel, IdentitySwitcher) + recomendação concreta
de estratégia de escala fluida + plano top-10 priorizado pra Lily.
**Doc-only.** Sem mudanças de código.

> **Antecedentes:** O Arquiteto observou que textos extrapolam cards em
> viewports estreitos. Robin (design QA #1) já flagou em CP-3 (tracking
> inconsistente) e CP-14 (font-size 10/11/12 sem regra clara). Marshall
> (CP-2 padding) e Robin (CP-7 touch targets) tocaram problemas adjacentes.
> Este doc fecha a parte tipográfica: **decidir scale formal e plano de
> migração**, não recriar inventário CL/CP.

---

## §1 Problema + viewports suportadas

### 1.1 Range de viewport real

| Classe | Width | Caso | Cap visual |
|---|---|---|---|
| Android antigo / cell estreito | 320–360 px | Galaxy A1x, iPhone SE 1ª gen | App fill todo o viewport |
| iPhone moderno | 375–430 px | 13 / 14 / 15 / Pro | App fill todo o viewport |
| Android médio | 360–412 px | Pixel 7, Galaxy S22 | App fill todo o viewport |
| Tablet portrait | 600–768 px | iPad mini portrait | App letterbox em **448 px** |
| Desktop / tablet landscape | ≥ 768 px | Desktop, iPad pro landscape | App letterbox em **448 px** |

**Drift é mobile-first com hard cap em `max-w-md` (448 px).** Confirmado em:

- `src/App.tsx:665` — root container `max-w-md mx-auto`
- `src/components/UI/FullPageCard.tsx:105` — `'fixed inset-0 z-40 mx-auto flex max-w-md ...'`
- `src/components/Post/ThreadView.tsx:244` — `max-w-md` overlay
- `src/components/Onboarding/OnboardingOverlay.tsx:171` — `max-w-md`
- `src/components/Post/ReplySheet.tsx:438` — `max-w-md`

Acima de 448 px, o app fica em **letterbox preto** com `sm:border-x`. Não
estica. Isso quer dizer que **a janela de width onde tipografia precisa
escalar é estreita: 320–448 px** (140 px de range, 1.4×). Em desktop, o
problema some — a width do container fica congelada.

### 1.2 O problema real (dimensionado)

Em `max-w-md` desktop (448 px), a width útil de um card depois do padding
default `p-4` (16 px) fica em **416 px**. Fonte body 14 px (`text-sm`)
renderiza ~52 chars/linha — confortável.

Em **viewport 320 px** (Galaxy A1x ou cell pequeno), o mesmo card com
`p-4` fica com **288 px de largura útil**. Mesma fonte 14 px → ~36
chars/linha. Mais apertado mas ainda aceitável.

**Onde quebra:**

1. **Header com 6+ chips/badges** (PostViewer linha 287-389). Em 320 px:
   `anon…D7DE3A · 5h ⚠ NSFW    DERIVA 0.234 📌 🗺 ➕ 🔇 ⊘ ⚠ ✕` é **17
   tokens** numa linha. Mesmo com `text-[10px]`, isso passa de 320 px e
   wrap quebra a hierarquia visual prevista (justify-between vira pilha).
2. **CompositeOverlay header com cancelar + DRIFT** + 5 csub circles. Em
   320 px, o footer `cancelar` (text-[10px] tracking-[2px]) + DRIFT
   (text-[14px] font-extrabold) viram 2 linhas.
3. **Card body 14 px + decorative letter 100px abs**. Fonte fixa não
   se adapta ao container — em iPhone 13 Pro estreito, o título 30 px
   (Syne 700) corta em 4-5 chars/linha, ficando ilegível.
4. **DERIVA chips inline** em PostCard linha 67 (`text-[10px]`) — string
   `você…D7DE3A · 5h ⚠ NSFW` + `DERIVA 0.234`. O Syne tracking ampliado
   inflate width. Em viewport 320, sai do card.
5. **CommentCard header**: `font-display text-base font-bold uppercase
   tracking-tag text-drift-text` (linha 117) → fonte 16 px + tracking
   2.5 px + uppercase. `anon…D7DE3A` ocupa ~115 px. Junto com timestamp
   `há 5h` + chip CW ⚠ NSFW, vai wrap em 320 px.

**Diagnóstico:** o tamanho fixo das fontes não é o problema isolado —
é a **combinação de** (a) muitos elementos inline + (b) tracking grande
em uppercase + (c) tipo de fonte (Syne é display, não eficiente em width).
Mas a alavanca mais barata é **escalar a fonte com viewport**.

---

## §2 Inventário de spots críticos (32 entradas)

Categorias usadas:
- **Header** (autor, timestamp, navegação)
- **Body** (post content, comment content)
- **Chip/badge** (CW, DERIVA, status)
- **Counter** (posição, contador, "+N novos")
- **Title** (display large)
- **CTA label** (DRIFT/SINK/CANCELAR)
- **Helper/hint** (educational copy)
- **Input/form** (placeholder, label)

Format: `arquivo:linha · classe atual · categoria · risco-overflow`.

### PostCard (`src/components/Feed/PostCard.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 1 | 67 | `text-[10px] text-drift-muted` (meta line) | Header | Médio (2 sub-strings) |
| 2 | 80 | `text-drift-accent2` (DERIVA value) | Chip | Baixo |
| 3 | 94 | `text-sm text-drift-text` (post body) | Body | Alto em 320 (long word) |
| 4 | 98 | `text-[10px] uppercase tracking-widest` (image hint) | Helper | Baixo |
| 5 | 105 | `text-[10px]` (counter row) | Counter | Médio (3 inline) |

### PostViewer (`src/components/Post/PostViewer.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 6 | 288 | `text-[10px] text-drift-muted` (header bulky) | Header | **Crítico** — 17+ tokens |
| 7 | 290 | `font-display font-bold uppercase tracking-wider text-drift-text` (anon name; `text-[10px]` herda) | Header | Alto |
| 8 | 297 | `bg-yellow-900/30 ... text-yellow-300` (CW chip; herda `text-[10px]`) | Chip | Médio |
| 9 | 306 | `uppercase tracking-widest` (DERIVA label; herda `text-[10px]`) | Chip | Médio |
| 10 | 489 | `text-xs uppercase tracking-widest text-yellow-300` (CW reveal hint) | Helper | Médio |
| 11 | 494 | `text-xs uppercase tracking-widest text-drift-accent` (toque pra revelar CTA) | CTA label | Baixo |
| 12 | 498 | `text-[10px] text-slate-600` (subhint) | Helper | Baixo |
| 13 | 510 | `font-mono text-[10px] text-drift-muted` (footer modal mode) | Footer | Médio |
| 14 | 778 | `font-mono text-[11px] uppercase tracking-[2px]` (ActionsMenu item label) | CTA label | Baixo |

### CommentCard (`src/components/Post/CommentCard.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 15 | 117 | `font-display text-base font-bold uppercase tracking-tag` (anon header) | Header | **Crítico** em 320 px |
| 16 | 123 | `font-mono text-[9px] uppercase tracking-meta` (CW chip) | Chip | Baixo |
| 17 | 130 | `font-mono text-[10px] uppercase tracking-meta` (timestamp) | Header | Médio |
| 18 | 196 | `font-mono text-[10px] uppercase tracking-meta` (toque revelar overlay) | Helper | Baixo |
| 19 | 205 | `font-mono text-[13px] leading-relaxed` (body) | Body | Alto (long word) |
| 20 | 226, 240 | `font-mono text-[10px] uppercase tracking-meta` (footer reply count) | Counter | Baixo |
| 21 | 268, 287 | `font-mono text-[11px] uppercase tracking-meta` (CwHidden / Hidden placeholder) | Helper | Baixo |

### ThreadHeader (`src/components/Post/ThreadHeader.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 22 | 104 | `font-display text-[14px] font-extrabold` (post title — TX-5) | Title | **Crítico** em 320 px |
| 23 | 111 | `font-mono text-[9px] uppercase tracking-meta` (post id chip) | Chip | Baixo |
| 24 | 122 | `font-mono text-[10px] uppercase tracking-meta` (breadcrumb) | Header | Alto (path > 4) |
| 25 | 163 | `font-mono text-[10px] tracking-meta` (counter "3/47 nível 1") | Counter | Baixo |
| 26 | 178 | `tracking-meta` (badge "+N novos"; herda `text-[10px]`) | Counter | Baixo |
| 27 | 197 | `font-mono text-[10px] uppercase tracking-meta` ("+ no post" CTA) | CTA label | Baixo |
| 28 | 206 | `font-mono text-[12px]` (X close) | CTA label | Baixo |

### ComposeOverlay (`src/components/Create/ComposeOverlay.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 29 | 221 | `font-mono text-[10px] uppercase tracking-[2px]` (cancelar) | CTA label | Baixo |
| 30 | 235 | `font-mono text-[10px] uppercase tracking-[1px]` (- SUB) | CTA label | Baixo |
| 31 | 251 | `font-display text-[14px] font-extrabold` (DRIFT button) | CTA label | Alto (capturando location…) |
| 32 | 285 | `font-mono text-[10px]` (csub circle 1/2/...) | Counter | Baixo |
| 33 | 315 | `font-mono text-[9px] uppercase tracking-meta` (1/8 ratio) | Counter | Baixo |
| 34 | 337 | `font-mono text-[9px] uppercase tracking-meta` (layout picker) | CTA label | Médio |
| 35 | 372 | `font-mono text-[13px] leading-[1.6]` (textarea body) | Body | Alto |
| 36 | 374, 380 | `text-[10px]` (chars + uploadError) | Helper | Médio |

### IdentityPanel (`src/components/Identity/IdentityPanel.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 37 | 45 | `text-[10px] uppercase tracking-widest` (tab buttons) | CTA label | Baixo |
| 38 | 150, 159 | `text-[10px] uppercase tracking-widest` (npub label) | Header | Baixo |
| 39 | 153 | `text-[11px] text-slate-300` (npub value, break-all) | Body | Médio |
| 40 | 173 | `text-[11px] text-red-300` (nsec value, break-all) | Body | Médio |
| 41 | 196, 202 | `text-[11px] uppercase tracking-widest` (copy/baixar CTAs) | CTA label | Baixo |
| 42 | 217 | `text-[11px] leading-relaxed` (confirm copy) | Helper | Baixo |
| 43 | 233 | `text-[10px] leading-relaxed text-yellow-300/70` (warning long copy) | Helper | Baixo |

### IdentitySwitcher (`src/components/Identity/IdentitySwitcher.tsx`)

| # | Linha | Classe | Categoria | Overflow risco |
|---|---|---|---|---|
| 44 | 199 | `text-[11px] leading-relaxed` (intro copy §4) | Helper | Baixo |
| 45 | 215 | `text-[11px]` (empty state) | Helper | Baixo |
| 46 | 228, 230 | `text-[10px]` (active marker) | Chip | Baixo |
| 47 | 233-234 | `text-slate-300` / `em text-slate-600` (label) | Header | Baixo |
| 48 | 238 | `text-[9px] text-slate-500` (importada chip) | Chip | Baixo |
| 49 | 246 | `break-all text-[9px] text-slate-600` (npub bech32) | Body | Baixo (break-all OK) |
| 50 | 249 | `text-[10px]` (action row) | CTA label | Médio (4 botões) |
| 51 | 292, 298 | `text-[11px] uppercase tracking-widest` (+ nsec local / 12 palavras) | CTA label | Médio |
| 52 | 322, 353, 391, 469 | `text-[11px] text-slate-400` (mode intro copy) | Helper | Baixo |
| 53 | 331, 362, 369, 405, 479, 486, 493 | `text-[11px] text-slate-200` (input/textarea value) | Input | Médio |
| 54 | 396 | `text-[10px] text-yellow-400` (BIP39 warning) | Helper | Baixo |
| 55 | 432 | `font-mono text-[12px] text-yellow-200` (BIP39 12 palavras) | Body | Baixo |
| 56 | 441 | `text-[10px] text-slate-500` (npub line) | Helper | Médio (long bech32) |

### Tally por categoria

| Categoria | Spots | Overflow alto/crítico |
|---|---|---|
| Header | 7 | 4 |
| Body | 6 | 3 |
| Chip/badge | 7 | 1 |
| Counter | 6 | 0 |
| Title | 1 | 1 |
| CTA label | 12 | 1 |
| Helper/hint | 10 | 0 |
| Input/form | 7 | 0 |
| **Total** | **56** | **10** |

---

## §3 Trade-offs analisados — clamp vs breakpoints vs container queries vs CSS vars

### 3.1 Critérios de avaliação

1. **Range útil de scaling** — Drift escala apenas em 320..448 px (1.4×).
   Acima disso, container congela e a tipografia idealmente também
   congela (não cresce em desktop com letterbox).
2. **Footprint de código** — quantas classes, props, ou utilities
   adicionais Lily precisa tocar.
3. **Compatibilidade Tailwind 3.4** — Drift está fixado em Tailwind
   3.4.x (`package.json: "tailwindcss": "^3.4.0"`). Container queries
   nativos só em 3.4+ via plugin `@tailwindcss/container-queries`.
4. **Manifesto §7 (determinismo)** — escala não pode introduzir
   flicker ou variação por device. Mesmo viewport → mesmo render.
5. **Acessibilidade** — respeita `prefers-reduced-motion`? Permite
   user-scaling do browser (zoom)? `vw`/`vh` units quebram zoom.
6. **DRY win** — quanto reduz duplicação atual (~6 valores fixos
   espalhados em 287 ocorrências de `text-[Npx]`).

### 3.2 Opção A — `clamp(min, preferred, max)` em CSS vars

**Como funciona:**

```css
:root {
  --t-xs: clamp(9px, 2.5vw, 11px);    /* meta lines, chips */
  --t-sm: clamp(11px, 3.2vw, 13px);   /* CTAs, counters */
  --t-base: clamp(13px, 3.8vw, 14px); /* body */
  --t-display: clamp(14px, 4.5vw, 18px); /* CommentCard header */
  --t-title: clamp(20px, 7vw, 30px);  /* card title Syne */
}
```

E expor via Tailwind extends ou utility custom (`text-fluid-base`).

**Pros:**

- ✅ **1 valor escala** com `vw` no preferred. Zero JS, zero
  ResizeObserver, GPU-friendly (CSS-only).
- ✅ **Cap em min/max** garante que viewport tiny não shrinka demais
  (legibilidade) e desktop não cresce além do design (manifesto §7).
- ✅ **`vw` não quebra zoom do browser** quando combinado com `min`
  em `px` — testado pelo design system Vercel + Stripe + GitHub Primer.
- ✅ **Viewports estreitos (320 px)** ganham fonte ~9-10 px em meta
  lines (vs 10 px hoje) — tradeoff: 10% menor em troca de não wrap.
  Hoje wrap = +30% altura visual.
- ✅ Determinístico — `clamp(a, vw, c)` é função pura do viewport,
  mesmo input → mesmo output. ✓ §7.

**Cons:**

- ⚠️ **vw é viewport, não container.** Em viewport 1920 px desktop com
  letterbox 448 px, `clamp(11px, 3.2vw, 13px)` resolve `min(13px,
  max(11px, 61.4px))` = **13 px** (cap saturado). OK, comportamento
  desejado.
- ⚠️ Em viewport 320 px portrait, `clamp(11px, 3.2vw, 13px)` = `min(13,
  max(11, 10.24))` = **11 px**. Estável — sem shrink abaixo do floor.
  ✓.
- ⚠️ Mas em viewport 280 px (foldable closed?), `clamp(11px, 3.2vw,
  13px)` = `min(13, max(11, 8.96))` = **11 px** (floor). Sem shrink
  além disso. ✓.
- ⚠️ Lily/Marshall precisam aprender uma sintaxe nova. Custo cognitivo
  baixo (well-known em design systems modernos).
- ⚠️ Tailwind 3.4 não tem helper nativo `text-fluid-*`. Precisa add em
  `tailwind.config.js extend.fontSize` ou usar arbitrary `text-[clamp(...)]`
  inline (ruim DRY).

### 3.3 Opção B — Tailwind `sm:` breakpoints

**Como funciona:**

```jsx
<span className="text-[10px] sm:text-[11px]">DERIVA 0.234</span>
```

Tailwind `sm` default é 640 px. Não dispara em `max-w-md` (448 px) cap.

**Variant possível:** custom breakpoint `xs` em 360 px:
```js
// tailwind.config.js
screens: { xs: '360px', sm: '640px', md: '768px' }
```

E usar `xs:text-[11px]` pra escalar entre 320..360..640.

**Pros:**

- ✅ **Familiar.** Lily já usa `sm:border-x` etc.
- ✅ **Predizível.** Step explícito vs gradual; QA é fácil (testar 4
   viewports — 320, 360, 400, 448 — cobre tudo).
- ✅ Funciona em qualquer Tailwind version sem plugin.

**Cons:**

- ❌ **Mais código.** Cada spot vira `text-[10px] xs:text-[11px]` em
   vez de `text-fluid-xs`. Em 287 ocorrências, multiplicador de churn
   muito grande.
- ❌ **Step jumps.** Em 359 px → 360 px, fonte salta de 10 → 11 px
   (10% jump). Visualmente é shift abrupto. clamp() é gradual.
- ❌ **Viewport breakpoint, não container.** Mesmo problema de B vs A
   sem ser melhor. Em desktop 1920 px com letterbox 448 px, `xs:` está
   ativo e fonte é 11 px — mas o container é só 448 px, não 1920. OK,
   mas confunde semantica (`xs:` sugere "viewport pequeno", não
   "container largo").
- ❌ **Não escala continuamente.** Entre 360 e 359 px, fonte é 10 px
   plana. Entre 360 e 640, fonte é 11 px plana. Range 360..448 (que é
   onde Drift tem useful screen) fica plano. clamp() escala.

### 3.4 Opção C — Container queries `@container`

**Como funciona:**

```css
.card { container-type: inline-size; }

@container (max-width: 320px) {
  .card-header { font-size: 9px; }
}
@container (min-width: 360px) {
  .card-header { font-size: 11px; }
}
```

Tailwind 3.4 suporta via plugin `@tailwindcss/container-queries`:
```jsx
<div className="@container">
  <span className="@xs:text-[11px] text-[10px]">...</span>
</div>
```

**Pros:**

- ✅ **Semanticamente correto.** PostCard renderizado em width 320 px
   fica menor; renderizado em width 448 px fica normal. Independente
   do viewport.
- ✅ **Permite reuso de PostCard em SubpostCarousel** (cards lado a lado
   com width menor que viewport) — fonte se ajusta.
- ✅ **Tailwind 3.4 já tem o plugin** — 1 linha em `tailwind.config.js`,
   imports de `@tailwindcss/container-queries`.

**Cons:**

- ❌ **Browser support OK mas relativamente novo.** Container queries
   @container são amplamente disponíveis em browsers modernos (Chrome
   105+, Safari 16+, Firefox 110+) — mas Drift ainda suporta PWA em
   devices Android antigos (manifesto §15 anti-censura). Não vale
   bloquear render em browser velho.
- ❌ **Drift não tem caso de uso real.** Em todo o app, cards estão
   dentro de container `max-w-md` que IS o viewport (em 320..448 mobile)
   ou IS um letterbox fixo 448 (>448 desktop). PostCard nunca é
   renderizado em 2 widths simultaneamente no mesmo viewport.
   **Container queries resolve um problema que Drift não tem.**
- ❌ **Custo cognitivo maior** que clamp — Lily precisa aprender:
   `container-type` parent + variant `@xs:` filho. clamp() é 1 conceito.
- ❌ Adiciona dependência (`@tailwindcss/container-queries`).

### 3.5 Opção D — Não fazer nada (status quo)

**Pros:**
- Zero churn.

**Cons:**
- 10 spots overflow alto/crítico (Tabela §2). Vão piorar com Syne
   bundled (V2) — fonte display tem advance metrics maiores que system
   sans default em muitos chars.
- Inconsistência atual de 6 valores fixos (9/10/11/12/13/14 + xs/sm/base)
   sem regra. CP-14 do Robin já flagou.

---

### 3.6 Recomendação

**Opção A: `clamp()` em CSS vars expostas via Tailwind extends.**

Justificativa em 3 pontos:

1. **Escala contínua resolve o problema real** — overflow em 320–360 px
   não é "viewport pequeno", é "fonte fixa não cabe em width útil
   estreita". clamp() é a ferramenta certa.
2. **`max-w-md` cap = container congela acima de 448 px** — vw no
   preferred com max em px garante que desktop letterbox NÃO cresce
   tipografia, respeitando manifesto §7 (determinismo) e o design
   mobile-first do Drift. Container queries seria overkill (não temos
   o problema que ele resolve).
3. **DRY win mais alto** — 6 levels (xs..hero) substituem todos os
   `text-[Npx]` arbitrários. Em 287 ocorrências, isso é uma migração
   grande mas linear; cada `text-[10px]` vira `text-fluid-xs` etc.
   Padrão estabelecido por Stripe, Vercel, GitHub Primer (e
   Tailwind UI desde 2024). Lily tem precedente abundante.

**Não escolho B (breakpoints)** porque os step jumps em 360/448 são
visualmente piores que clamp, e adiciona código sem reduzir os spots
problemáticos do §2 — só acrescenta mais código pra gerenciar.

**Não escolho C (container queries)** porque resolve um caso de uso
inexistente em Drift (cards multi-width simultâneos). Custo de
dependência + cognitivo sem ganho.

**Não escolho D (nada)** porque overflow é S0/S1 em 10+ spots.
Acumula com V2 (Syne local, advance metrics maiores que fallback).

---

## §4 Proposta de scale formal

### 4.1 6 levels canônicos

| Level | Token Tailwind | clamp() value | Uso prescrito | Spot exemplo (do §2) |
|---|---|---|---|---|
| `xs` | `text-fluid-xs` | `clamp(9px, 2.4vw, 10px)` | Meta lines, chips, timestamps, "(N)" counters, source badges | #1, #4, #16, #18, #20, #23, #29, #34 |
| `sm` | `text-fluid-sm` | `clamp(10px, 2.8vw, 11px)` | CTA labels uppercase tracking-meta, group titles, helper short, breadcrumb | #6, #11, #21, #22 (chip), #24-25, #27, #37-38, #41 |
| `base` | `text-fluid-base` | `clamp(11px, 3.2vw, 12px)` | Body intro copy, npub display, helper longer, mode descriptions | #39, #42-43, #44-45, #51-53 |
| `lg` | `text-fluid-lg` | `clamp(12px, 3.6vw, 13px)` | Body content (post text, comment text), input/textarea body | #3 (post card), #19 (comment), #35 (textarea), #55 (BIP39 12 palavras) |
| `display` | `text-fluid-display` | `clamp(13px, 4vw, 16px)` | CommentCard anon header (font-display + bold), post title em ThreadHeader | #15, #22 |
| `hero` | `text-fluid-hero` | `clamp(20px, 6vw, 30px)` | SubpostLayout title (Syne 700 — TextLayout `text-3xl` / `text-xl`) | (linha SubpostLayout 240-241) |

**Decorative letter** (Syne 100 px absolute) NÃO está no scale. É
elemento aria-hidden, fixo, não-responsivo (manifesto §7 — visual puro
documentado em design-system §3.2). Manter `style={{fontSize: '100px'}}`
inline.

### 4.2 Implementação Tailwind 3.4

`tailwind.config.js` extends:

```js
fontSize: {
  'fluid-xs':      ['clamp(9px, 2.4vw, 10px)',  { lineHeight: '1.4' }],
  'fluid-sm':      ['clamp(10px, 2.8vw, 11px)', { lineHeight: '1.45' }],
  'fluid-base':    ['clamp(11px, 3.2vw, 12px)', { lineHeight: '1.55' }],
  'fluid-lg':      ['clamp(12px, 3.6vw, 13px)', { lineHeight: '1.65' }],
  'fluid-display': ['clamp(13px, 4vw, 16px)',   { lineHeight: '1.2' }],
  'fluid-hero':    ['clamp(20px, 6vw, 30px)',   { lineHeight: '1.08' }],
}
```

Espelhar em `src/index.css` `:root` como CSS vars (consistente com pattern
existente):

```css
:root {
  --t-fluid-xs: clamp(9px, 2.4vw, 10px);
  --t-fluid-sm: clamp(10px, 2.8vw, 11px);
  --t-fluid-base: clamp(11px, 3.2vw, 12px);
  --t-fluid-lg: clamp(12px, 3.6vw, 13px);
  --t-fluid-display: clamp(13px, 4vw, 16px);
  --t-fluid-hero: clamp(20px, 6vw, 30px);
}
```

LOCK_VIA_TEST: adicionar guard em `tests/manifesto-conformance.test.ts`
que `tailwind.config.js` e `index.css` mantêm os 6 valores em paridade
(igual ao theme_color guard atual em design-system §5).

### 4.3 Mapping completo dos 56 spots

| Spot # | Componente | Linha | Atual | Proposto |
|---|---|---|---|---|
| 1 | PostCard | 67 | `text-[10px]` | `text-fluid-xs` |
| 2 | PostCard | 80 | (herda 10px) | (herda fluid-xs) |
| 3 | PostCard | 94 | `text-sm` (14px) | `text-fluid-lg` |
| 4 | PostCard | 98 | `text-[10px] tracking-widest` | `text-fluid-xs tracking-widest` |
| 5 | PostCard | 105 | `text-[10px]` | `text-fluid-xs` |
| 6 | PostViewer | 288 | `text-[10px]` | `text-fluid-xs` |
| 7 | PostViewer | 290 | `font-display ... text-[10px]` (herda) | `font-display ... text-fluid-xs` |
| 8 | PostViewer | 297 | herda 10px | herda fluid-xs |
| 9 | PostViewer | 306 | herda 10px | herda fluid-xs |
| 10 | PostViewer | 489 | `text-xs` | `text-fluid-sm` |
| 11 | PostViewer | 494 | `text-xs uppercase` | `text-fluid-sm uppercase` |
| 12 | PostViewer | 498 | `text-[10px]` | `text-fluid-xs` |
| 13 | PostViewer | 510 | `text-[10px]` | `text-fluid-xs` |
| 14 | PostViewer | 778 | `text-[11px]` | `text-fluid-sm` |
| 15 | CommentCard | 117 | `font-display text-base font-bold uppercase tracking-tag` | `font-display text-fluid-display font-bold uppercase tracking-tag` |
| 16 | CommentCard | 123 | `text-[9px]` | `text-fluid-xs` (10 max) — perde 1px no cap, mas visualmente OK chip |
| 17 | CommentCard | 130 | `text-[10px]` | `text-fluid-xs` |
| 18 | CommentCard | 196 | `text-[10px]` | `text-fluid-xs` |
| 19 | CommentCard | 205 | `text-[13px] leading-relaxed` | `text-fluid-lg leading-relaxed` |
| 20 | CommentCard | 226, 240 | `text-[10px]` | `text-fluid-xs` |
| 21 | CommentCard | 268, 287 | `text-[11px]` | `text-fluid-sm` |
| 22 | ThreadHeader | 104 | `font-display text-[14px] font-extrabold` | `font-display text-fluid-display font-extrabold` |
| 23 | ThreadHeader | 111 | `text-[9px]` | `text-fluid-xs` |
| 24 | ThreadHeader | 122 | `text-[10px]` | `text-fluid-xs` |
| 25 | ThreadHeader | 163 | `text-[10px]` | `text-fluid-xs` |
| 26 | ThreadHeader | 178 | (herda 10px) | (herda fluid-xs) |
| 27 | ThreadHeader | 197 | `text-[10px]` | `text-fluid-xs` |
| 28 | ThreadHeader | 206 | `text-[12px]` | `text-fluid-sm` |
| 29 | ComposeOverlay | 221 | `text-[10px] tracking-[2px]` | `text-fluid-xs tracking-[2px]` |
| 30 | ComposeOverlay | 235 | `text-[10px] tracking-[1px]` | `text-fluid-xs tracking-[1px]` |
| 31 | ComposeOverlay | 251 | `font-display text-[14px] font-extrabold` | `font-display text-fluid-display font-extrabold` |
| 32 | ComposeOverlay | 285 | `text-[10px]` | `text-fluid-xs` |
| 33 | ComposeOverlay | 315 | `text-[9px]` | `text-fluid-xs` |
| 34 | ComposeOverlay | 337 | `text-[9px]` | `text-fluid-xs` |
| 35 | ComposeOverlay | 372 | `text-[13px] leading-[1.6]` | `text-fluid-lg leading-[1.6]` |
| 36 | ComposeOverlay | 374, 380 | `text-[10px]` | `text-fluid-xs` |
| 37 | IdentityPanel | 45 | `text-[10px]` | `text-fluid-xs` |
| 38 | IdentityPanel | 150, 159 | `text-[10px]` | `text-fluid-xs` |
| 39 | IdentityPanel | 153 | `text-[11px]` (npub bech32) | `text-fluid-sm` |
| 40 | IdentityPanel | 173 | `text-[11px]` (nsec bech32) | `text-fluid-sm` |
| 41 | IdentityPanel | 196, 202 | `text-[11px] tracking-widest` | `text-fluid-sm tracking-widest` |
| 42 | IdentityPanel | 217 | `text-[11px]` | `text-fluid-sm` |
| 43 | IdentityPanel | 233 | `text-[10px]` | `text-fluid-xs` |
| 44 | IdentitySwitcher | 199 | `text-[11px]` | `text-fluid-sm` |
| 45 | IdentitySwitcher | 215 | `text-[11px]` | `text-fluid-sm` |
| 46 | IdentitySwitcher | 228, 230 | `text-[10px]` | `text-fluid-xs` |
| 47 | IdentitySwitcher | 233-234 | (herda) | (herda) |
| 48 | IdentitySwitcher | 238 | `text-[9px]` | `text-fluid-xs` |
| 49 | IdentitySwitcher | 246 | `text-[9px] break-all` | `text-fluid-xs break-all` |
| 50 | IdentitySwitcher | 249 | `text-[10px]` | `text-fluid-xs` |
| 51 | IdentitySwitcher | 292, 298 | `text-[11px] tracking-widest` | `text-fluid-sm tracking-widest` |
| 52 | IdentitySwitcher | 322, 353, 391, 469 | `text-[11px]` | `text-fluid-sm` |
| 53 | IdentitySwitcher | 331 etc | `text-[11px]` (input value) | `text-fluid-sm` |
| 54 | IdentitySwitcher | 396 | `text-[10px]` | `text-fluid-xs` |
| 55 | IdentitySwitcher | 432 | `text-[12px]` (BIP39 12 words) | `text-fluid-sm` |
| 56 | IdentitySwitcher | 441 | `text-[10px]` | `text-fluid-xs` |

### 4.4 Validação determinística por viewport

Em 320 px (calculado, sem `vw` rounding diferente entre browsers):

- `clamp(9px, 2.4vw, 10px)` = `min(10, max(9, 7.68))` = **9 px**
- `clamp(10px, 2.8vw, 11px)` = `min(11, max(10, 8.96))` = **10 px**
- `clamp(11px, 3.2vw, 12px)` = `min(12, max(11, 10.24))` = **11 px**
- `clamp(12px, 3.6vw, 13px)` = `min(13, max(12, 11.52))` = **12 px**
- `clamp(13px, 4vw, 16px)` = `min(16, max(13, 12.8))` = **13 px**
- `clamp(20px, 6vw, 30px)` = `min(30, max(20, 19.2))` = **20 px**

Em 360 px:
- xs → 9 px / sm → 10 px / base → 11.52 px / lg → 13 px / display → 14.4 px / hero → 21.6 px

Em 448 px (cap):
- xs → 10 px / sm → 11 px / base → 12 px / lg → 13 px / display → 16 px / hero → 26.88 px

Em desktop 1920 px (letterbox):
- TODOS saturam em max → 10 / 11 / 12 / 13 / 16 / 30 px (estável,
  como esperado).

**Comportamento desejado confirmado.** Em 320 px, fonte de 16 px
(CommentCard header) shrinka pra 13 px — ganha ~20% de width útil pra
caber `anon…D7DE3A · 5h ⚠ NSFW` na mesma linha.

---

## §5 Plano de implementação top 10 (Lily)

Priorização: **alta visibilidade × baixo risco**. PostCard e PostViewer
header aparecem em **toda interação primária** (feed swipe). Resolver lá
primeiro maximiza visibility-per-line-changed.

| # | Spot | Arquivo:Linha | Atual | Proposto | Justificativa |
|---|---|---|---|---|---|
| 1 | **§4 token rollout** | `tailwind.config.js` + `src/index.css` | (não existe) | Add 6 fluid sizes em theme.extend.fontSize + CSS vars `--t-fluid-*` em :root | **Pré-requisito.** Sem token, todos os outros itens não existem. ~10 linhas de código. Risco: zero (só adiciona). |
| 2 | PostViewer header bulky | `src/components/Post/PostViewer.tsx:288` | `text-[10px] text-drift-muted` | `text-fluid-xs text-drift-muted` | **Crítico** §2 — 17+ tokens inline em 320px. Resolve TX-1/TX-5 lateral. Toca 1 linha; herança cobre filhos. |
| 3 | CommentCard anon header | `src/components/Post/CommentCard.tsx:117` | `font-display text-base font-bold uppercase tracking-tag` | `font-display text-fluid-display font-bold uppercase tracking-tag` | **Crítico** §2 — fonte 16px + tracking 2.5px wrap em 320px. Resolve overflow padrão de TODA thread. |
| 4 | ThreadHeader title (TX-5) | `src/components/Post/ThreadHeader.tsx:104` | `font-display text-[14px] font-extrabold` | `font-display text-fluid-display font-extrabold` | **Crítico** §2 — title +6 chars já wrap em 320px com `truncate` cortando legibilidade. |
| 5 | PostCard body | `src/components/Feed/PostCard.tsx:94` | `text-sm text-drift-text` | `text-fluid-lg text-drift-text` | High visibility (feed). Sem overflow real, mas escala consistente com CommentCard body (item 6). |
| 6 | CommentCard body | `src/components/Post/CommentCard.tsx:205` | `text-[13px] leading-relaxed` | `text-fluid-lg leading-relaxed` | Mesma fonte do PostCard body — pareiam visualmente. Toca 1 linha. |
| 7 | PostCard meta line | `src/components/Feed/PostCard.tsx:67` | `text-[10px] text-drift-muted` | `text-fluid-xs text-drift-muted` | High visibility. Resolve overflow do `você…D7DE3A · 5h ⚠ NSFW + DERIVA` em 320px. |
| 8 | ThreadHeader breadcrumb | `src/components/Post/ThreadHeader.tsx:122` | `text-[10px] uppercase tracking-meta` | `text-fluid-xs uppercase tracking-meta` | Path > 4 níveis ja `truncate`a; fluid-xs reduz necessidade de truncar mais cedo. |
| 9 | ComposeOverlay textarea body | `src/components/Create/ComposeOverlay.tsx:372` | `text-[13px] leading-[1.6]` | `text-fluid-lg leading-[1.6]` | High visibility (compose é 2nd most-used flow). Pareia com PostCard/CommentCard body. |
| 10 | ComposeOverlay DRIFT button | `src/components/Create/ComposeOverlay.tsx:251` | `font-display text-[14px] font-extrabold` | `font-display text-fluid-display font-extrabold` | "📍 capturando location…" + DRIFT label = 26 chars em fonte 14 + extrabold + tracking. Em 320px wrap pra 2 linhas, deformando footer. fluid-display em 320 = 13px → cabe sem wrap. |

**Effort total estimado:** ~1.5h Lily (10 changes em 5 arquivos +
adição em 2 arquivos config). Cada change é 1-2 linhas. Build CI valida
LOCK_VIA_TEST e tipografia ainda render visualmente coerente (verificação
manual em viewport 320 / 375 / 414 / 448).

**Sequenciamento recomendado:**

1. Item 1 (token) primeiro — gates todos os outros.
2. Items 2-4 (críticos, headers) — resolve overflow agudo.
3. Items 5-6, 9 (body fonts) — pareia visual entre cards.
4. Items 7-8, 10 (cleanup remaining critical spots).

Deixa para PR/sessão posterior os outros 46 spots do §2 — bulk
mecânico, mas baixa prioridade visualmente (helpers, ifs raros, etc).
Pode virar issue de "migration cleanup #2" depois que o pattern estiver
provado pelos top-10.

---

## §6 Não-tocar

Coisas que **NÃO** entram nesta migração — flagadas pra evitar scope
creep:

1. **Decorative letter Syne 100px** (`SubpostLayout.tsx:446-459`) —
   elemento aria-hidden, fixo, especificado por design-system §3.2. NÃO
   incluir no scale; manter `style={{ fontSize: '100px' }}` inline.

2. **Fontes embedded** (Syne / DM Mono local) — V2 já fechou bundle local.
   Fora do escopo deste audit. Robin/Lily flag em V2 polish (já implementado).

3. **Tipografia em SVG icons** — `<text>` em SVG (lucide ou inline) usa
   `font-size` SVG attribute em px ou em em. Não Tailwind. Diferente
   sistema. Não tocar.

4. **`text-base`, `text-lg`, `text-xl`, `text-3xl` em locais não-listados**
   — `GpsErrorBanner.tsx:51`, `Image.tsx:183`, `SpreadMap.tsx:569`
   (todos `text-base` em emoji-render). Emoji em `text-base` (16px) é
   intencional pra render visual — emoji 16px é o sweet spot pra
   reconhecibilidade. NÃO migrar.

5. **`text-3xl` (30px) e `text-xl` (20px) em SubpostLayout** linha
   240-241 (CardText centered/non-centered) — incluído em `fluid-hero`
   item 4.1, mas implementação separada (V14.x do reskin). Decidir se
   migrar agora ou deferir pra sessão dedicada à TextLayout — a
   complexidade de hero scale em decorative letter context é maior.
   **Recomendação: deferir.** Rebote pra `text-3xl`/`text-xl` está OK
   no escopo atual.

6. **`tracking-widest` legacy** (CP-3 do Robin QA #1) — separação léxica.
   Tracking é dimensão ortogonal a font-size. Migrar tracking pra
   `tracking-meta`/`tracking-tag` é sessão separada (Robin já tem doc).
   Não acoplar.

7. **Touch targets** (CP-7 / AY-6 do Robin QA #1) — botões 28×28 ou
   abaixo de 44×44px. Problema de **`px-`/`py-`**, não font-size.
   Diferente eixo. Não acoplar.

8. **CW chips amber-* tokens** (CL-11/CL-21/CL-39/CL-43/CL-45 do Robin) —
   problema de cor, não font-size. Migração separada.

9. **`text-base` em CommentCard headers ELSEWHERE** — só CommentCard
   linha 117 está no top-10. Outros uses (ex: `text-base` em
   ThreadView.tsx:426, 459) são placeholder/empty states de baixa
   visibilidade — fica em backlog.

10. **`text-sm` em GpsErrorBanner h2 linha 93** — texto de erro grande,
    intencionalmente grande pra atenção. NÃO migrar pra fluid-base
    (deveria ficar 14px estável).

---

## §7 Cross-references

- `Docs/design-system.md` §3 — Tipografia (atualiza com §4 deste doc
  após Lily ship)
- `Docs/sessions/design-qa-baseline-2026-05-08.md` (Robin) §3 / §4 (CP-3,
  CP-14) — tracking + size inconsistency findings
- `Docs/sessions/ted-ux-spike-deployed-2026-05-08.md` (Ted) §2 (TX-3,
  TX-5) — overflow observations adjacentes
- `Docs/sessions/comments-ux-audit-2026-05-08.md` (Robin) — UX audit que
  toca CommentCard width e ThreadHeader title
- Manifesto §7 (determinismo) — clamp() é determinístico ✓

---

## §8 Stats

| Categoria | Total spots | Top-10 priorizado | Restante |
|---|---|---|---|
| Header | 7 | 4 (#2, 4, 7, 8) | 3 |
| Body | 6 | 3 (#5, 6, 9) | 3 |
| Title | 1 | 1 (#10? não — DRIFT é CTA não title) | 1 |
| CTA label | 12 | 1 (#10) | 11 |
| Chip/badge | 7 | 0 | 7 |
| Counter | 6 | 0 | 6 |
| Helper/hint | 10 | 0 | 10 |
| Input/form | 7 | 0 | 7 |
| **Total** | **56** | **9 + 1 token rollout** | **47** |

**Top-10 cobre 100% dos overflows altos/críticos** identificados em §2
(10 spots). Restantes 47 são polish.

---

*Audit conduzido em ~80min: leitura (35min) + investigação code (25min)
+ escrita (20min). Doc-only — Lily executa items 1-10 numa sessão de
~1.5h depois de approval. Cap budget 1.5h cumprido.*
