# RFC — Design System v0.8 (POST-priority elevation)

**Status:** Draft (contract version)
**Author:** Ted (HIMYM persona — arquitetura, padrões, abstrações)
**Date:** 2026-05-08
**Predecessor:** `Docs/design-system.md` v0.7
**Sibling RFC:** `Docs/rfcs/2026-05-rfc-event-handler-registry.md`
**Implementation:** Lily, Round 4 (referencia este doc)
**Validation:** Marshall, Round 5 (conformance gates §6)
**Tom:** ADR pragmático
**Ambition cap:** 2.5h research/spec; cap implementation cost ~1 dia Round 4

---

## Sumário executivo

v0.8 promove ad-hoc patterns acumulados durante V0–V5 + Round 1–2 do
HIMYM redesign campaign para **tokens formais** e **primitives
reutilizáveis**. **Foco operacional desta versão: elevar UX/UI do
flow de postagens** (PostViewer card, CommentCard thread,
ComposeOverlay create) — área que o user marcou como "feio e pouco
intuitivo". Outros surfaces (Settings, Identity, Onboarding) seguem
em second-tier.

**Quantitativo:**

- 117 finds (Robin QA #1: 90 + Ted UX spike: 12 + Robin Comments UX: 15)
  reduzidos a **6 token scales** + **5 primitives novos**
- Conformidade global: 62% (v0.7 baseline) → **alvo 85% (v0.8)**
- Conformidade post components: ad-hoc → **alvo ≥ 90%** (peso elevado)
- Round 4 effort: ~6h Lily (PostViewer/CommentCard/ComposeOverlay first)
- Round 5 effort: ~3h Marshall (lint + conformance test)

---

## §1 — Contexto

### §1.1 Por que v0.8 agora

Três auditorias paralelas convergiram em achados sobrepostos:

| Audit | Finds | S1+S0 |
|---|---|---|
| Robin QA #1 (`design-qa-baseline-2026-05-08.md`) | 90 | ~28 |
| Ted UX spike (`ted-ux-spike-deployed-2026-05-08.md`) | 12 | 5 |
| Robin Comments UX (`comments-ux-audit-2026-05-08.md`) | 15 | 4 |
| **Total** | **117** | **~37 (32%)** |

Robin QA regression (`design-qa-regression-2026-05-08.md`) verdict
verde 🟢 com **68% de conformidade** após Round 1+2 — gap residual
restante são padrões que **não são tactical**, são arquiteturais
(faltam tokens, faltam primitives). Tactical fixes apenas saturam.

### §1.2 Por que POST-priority

User feedback explícito (Round 3 kickoff): *"ainda precisamos
melhorar a UI e UX das postagens, está feio e pouco intuitivo a
usabilidade"*.

Mapeamento finds → componentes mostra concentração no eixo post:

- **PostViewer.tsx** — 18 finds (CP-2 padding, CP-3 tracking, CP-4
  motion, CP-15 border) — single biggest offender
- **CommentCard.tsx / ThreadView.tsx** — 14 finds (UX-Cm-1 a UX-Cm-15,
  thread depth indication, reply nest, timestamp hierarchy)
- **ComposeOverlay.tsx + ReplySheet.tsx** — 11 finds (input
  inconsistency, CW chip ad-hoc, character counter UX)
- (resto distribui em 12+ outros components)

→ **43 finds (37%) vivem no flow de postagens.** Resolver post-flow
primeiro tem maior ROI percebido pelo user.

### §1.3 Princípios de design v0.8

Reafirmados de v0.7, restated pra contrato:

1. **Tokens > inline values.** Hex hardcoded ou `tracking-[2px]` ad-hoc
   = débito.
2. **Primitives > pattern duplication.** Se 3+ call sites repetem o
   mesmo shape, extrair primitive.
3. **Semantic > visual.** Naming vai por intenção (`p-card`,
   `motion-card`), não por valor (`p-12-13`).
4. **Vocabulary lock preservado.** Manifesto §28; CSS classes/tokens
   `drift-spread`/`drift-bury` permanecem; UI strings continuam
   `DRIFT`/`SINK`.
5. **Determinismo (manifesto §7).** Animações com easing + duration
   declarativos; nada de `Math.random`/`Date.now` em motion.
6. **A11y first.** Contraste WCAG AA mínimo; focus visible; reduced
   motion respeitado.
7. **POST-priority weighting.** Cada token e primitive avaliado por
   "isso melhora PostViewer/CommentCard/ComposeOverlay primeiro?"
   antes de "isso melhora Settings/Identity?".

---

## §2 — Token scales novos (formalize CP-2/3/4/15 + categoria D + §3.1 fluida)

Tokens aqui adicionam-se ao `tailwind.config.js` em `theme.extend`.
Reutilizam padrão CSS-var-com-fallback já estabelecido em v0.7
(letterSpacing/lineHeight/spacing).

### §2.1 Padding scale `p-*` (CP-2)

**Origem:** Robin QA CP-2 (~24 ad-hoc paddings detected). v0.7 não
tem scale formal, components escolhem `px-3 py-[5px]`, `px-4`, `p-3`
ad-hoc.

**Novo (Tailwind plugin via `theme.extend.spacing` + utility classes):**

| Token | Valor | Uso primário |
|---|---|---|
| `p-chip` | `px-1.5 py-0.5` (6px / 2px) | CW chips, badges inline em PostCard, source tags |
| `p-sm` | `px-2 py-1` (8px / 4px) | Sub-CTAs (`< sub` button), mini icon-buttons |
| `p-md` | `px-3 py-[5px]` (12px / 5px) | **Default CTA tag uppercase** — DriftButton size md baseline |
| `p-md-tall` | `px-3 py-2` (12px / 8px) | CTA larger (publicar, importar) |
| `p-card` | `px-4 py-3` (16px / 12px) | **PostCard / CommentCard body** — POST priority |
| `p-overlay` | `px-5 py-4` (20px / 16px) | FullPageCard header/footer, ComposeOverlay body |

**Implementação:** Tailwind utility classes via plugin, NÃO renomear
spacing scale built-in. Classes geradas:

```js
plugins: [
  plugin(({ addUtilities }) => {
    addUtilities({
      '.p-chip': { padding: '2px 6px' },
      '.p-sm': { padding: '4px 8px' },
      '.p-md': { padding: '5px 12px' },
      '.p-md-tall': { padding: '8px 12px' },
      '.p-card': { padding: '12px 16px' },
      '.p-overlay': { padding: '16px 20px' },
    })
  }),
]
```

**Migração:**
- DriftButton size mapping interno → `p-md` (replace `px-3 py-[5px]`)
- PostCard wrapper → `p-card`
- CommentCard wrapper → `p-card`
- ComposeOverlay textarea container → `p-overlay`

**Não-tocar:** `px-card-x` / `px-card-x-wide` (CSS vars já em uso em
SubpostLayout) permanecem — coexistem.

### §2.2 Tracking scale (CP-3)

**Origem:** Robin QA CP-3 (~18 ad-hoc trackings: `tracking-widest`,
`tracking-[0.2em]`, `tracking-[1px]`, `tracking-[2px]`, etc.).

**Estado v0.7:** `tag` (2.5px) e `meta` (1.5px) e `title` (-0.3px) já
existem. Falta tracking-cta canônico.

**Novo:**

| Token | Valor | Uso |
|---|---|---|
| `tracking-tag` (existe) | `var(--tracking-tag, 2.5px)` | Group titles, "DERIVA", "NSFW" badges |
| `tracking-meta` (existe) | `var(--tracking-meta, 1.5px)` | Timestamps, stats, "DRIFT 12 · SUB 3 · HÁ 4h" |
| **`tracking-cta` (novo)** | `var(--tracking-cta, 2px)` | **Default CTA uppercase** — DriftButton md/lg |
| `tracking-title` (existe) | `var(--tracking-title, -0.3px)` | Syne 800 títulos display |

**Deprecar (lint warn, não erro hard):**
- `tracking-widest` em strings JSX → `tracking-cta`
- `tracking-[0.2em]` → `tracking-cta`
- `tracking-[1px]` → `tracking-meta`
- `tracking-[2px]` → `tracking-cta`

ESLint rule `drift/no-adhoc-tracking` proposta em §6.

### §2.3 Animation duration tokens (CP-4 + categoria D)

**Origem:** Robin QA CP-4 + Lily Track-C debt (`track-c-debt-scoping-2026-05-08.md`)
+ Ted UX spike TX-1/TX-2 (durations vary 150-400ms ad-hoc).

**Novo (Tailwind `theme.extend.transitionDuration` + `transitionTimingFunction`):**

```js
transitionDuration: {
  'motion-fast': '150ms',       // hover feedback, fade chip
  'motion-base': '200ms',       // small modal in/out, dropdown
  'motion-emphasis': '250ms',   // FullPageCard, SlideUpOverlay (existing)
  'motion-card': '300ms',       // PostViewer enter, ThreadView open (POST priority)
  'motion-tab': '280ms',        // FeedTabs indicator slide (existing pattern)
},
transitionTimingFunction: {
  'ease-emphasis': 'cubic-bezier(0.2, 0.8, 0.2, 1)',  // smooth card slide
  'ease-elastic': 'cubic-bezier(0.34, 1.56, 0.64, 1)', // tab indicator overshoot
},
```

**Defaults aplicados:**

| Componente | Duration | Timing |
|---|---|---|
| **PostViewer enter** | `motion-card` | `ease-emphasis` |
| **CommentCard expand** | `motion-base` | `ease-out` |
| **ComposeOverlay open** | `motion-emphasis` | `ease-out` (preserva v0.7) |
| FullPageCard | `motion-emphasis` | `ease-out` |
| FeedTabs indicator | `motion-tab` | `ease-elastic` |
| Hover/focus | `motion-fast` | `ease-out` |

**Reduced motion:** Lily plan separately (`lily-motion-perf-plan-*`) —
todos motion tokens devem respeitar `prefers-reduced-motion: reduce`
via wrapping em `@media (prefers-reduced-motion: no-preference)` ou
Framer Motion's built-in.

### §2.4 Border thickness scale (CP-15)

**Origem:** Robin QA CP-15 (`border` default 1px misturado com
`border-2` ad-hoc; chip borders 1.5px hardcoded; FAB outline indef).

**Novo (Tailwind `theme.extend.borderWidth`):**

```js
borderWidth: {
  '1': '1px',
  '1.5': '1.5px',
  '2': '2px',
}
```

| Token | Uso |
|---|---|
| `border-1` | Card hairline (PostCard, CommentCard, FullPageCard) |
| `border-1.5` | Chip active/inactive (DriftChip primitive — POST priority) |
| `border-2` | FAB, prominent CTA (NavBar central, swipe badge `i-sink`/`i-sub`) |

**Migração ESLint:** `border-\[1px\]` / `border-\[2px\]` ad-hoc →
tokens. `border` (default Tailwind = 1px) permanece OK; preferência
explicit `border-1` em components novos.

### §2.5 Type scale fluida (output do Ted §3.1 audit, promovido a token)

**Estado:** `tailwind.config.js` v0.7 já adicionou `fluid-xs`...`fluid-hero`
em commit `9157892`. v0.8 **formaliza** o uso (canon, não opt-in) e
depreca alternativas hardcoded.

**Tabela canônica (preservada de v0.7 commit):**

| Token | clamp() | Uso primário |
|---|---|---|
| `text-fluid-xs` | `clamp(9px, 2.4vw, 10px)` | Stats meta inline (DRIFT/SINK count) |
| `text-fluid-sm` | `clamp(10px, 2.8vw, 11px)` | **CommentCard body** — POST priority |
| `text-fluid-base` | `clamp(11px, 3.2vw, 12px)` | **PostCard body, ComposeOverlay textarea** |
| `text-fluid-lg` | `clamp(12px, 3.6vw, 13px)` | Modal body, emphasized text |
| `text-fluid-display` | `clamp(13px, 4vw, 16px)` | h2 modal título |
| `text-fluid-hero` | `clamp(20px, 6vw, 30px)` | **PostViewer card title** — POST priority |

**Migração:**
- `text-[10px]`/`text-[11px]`/`text-[12px]`/`text-[13px]` em PostCard
  / CommentCard / PostViewer → tokens fluidos correspondentes
- `text-xs`/`text-sm`/`text-base` Tailwind built-in: continuam OK em
  Settings/Identity/Onboarding (second-tier)

**Lint:** `drift/prefer-fluid-text` warn em components do post-flow
(`src/components/Post/**`, `src/components/Create/**`,
`src/components/Comments/**`).

### §2.6 Resumo §2 — count

**6 token scales formalizados:**
1. Padding (`p-chip` → `p-overlay`, 6 tokens)
2. Tracking (3 existentes confirmados + 1 novo `tracking-cta`)
3. Animation duration (5 tokens novos)
4. Animation timing function (2 tokens novos)
5. Border thickness (3 tokens novos)
6. Type scale fluida (6 tokens, formalizando v0.7 commit)

**Total novos tokens individuais: ~25.**

---

## §3 — Primitives novos (Round 4 implementation)

Ordenados por **POST-priority weighting**: primitives que afetam
PostViewer / CommentCard / ComposeOverlay vêm primeiro. Round 4
implementa nesta ordem.

### §3.1 `<DriftCard>` — POST PRIORITY #1

**Por que primeiro:** PostCard, CommentCard, FeedTab cards internas
todos repetem a mesma shape (border + bg + radius + padding). 18+
finds Robin QA convergem aqui. Resolver DriftCard dá ROI imediato em
3 components do post-flow.

**API:**

```typescript
export type DriftCardVariant = 'default' | 'elevated' | 'inset' | 'shadow-stack'
export type DriftCardSize = 'sm' | 'md' | 'lg'

export interface DriftCardProps {
  variant?: DriftCardVariant       // default 'default'
  size?: DriftCardSize             // default 'md'
  /** Slot opcional Syne 800 letter absolute decorativa (ex: PostCard "D") */
  decoration?: ReactNode
  /** Header slot (Syne title + chip row) */
  header?: ReactNode
  /** Body slot — children livre */
  children: ReactNode
  /** Footer slot (sticky action row) */
  footer?: ReactNode
  /** Pass-through className extra */
  className?: string
  /** onClick — torna o card clickable + role="button" + focus-visible */
  onClick?: () => void
  /** Aria label se interactive */
  ariaLabel?: string
}
```

**Variants:**

| Variant | Visual |
|---|---|
| `default` | `bg-drift-surface border-1 border-drift-border rounded` (PostCard, CommentCard padrão) |
| `elevated` | + `shadow-[0_4px_18px_rgba(0,0,0,0.4)]` (PostViewer card top) |
| `inset` | `bg-drift-bg border-1 border-drift-border` (sub-cards aninhados em FullPageCard) |
| `shadow-stack` | Render principal + 2 shadow cards atrás (Tinder-style PostViewer §4.2 v0.7) |

**Sizes (padding via §2.1):**
- `sm` → `p-card` reduzido (px-3 py-2)
- `md` → `p-card` (px-4 py-3) — default
- `lg` → `p-overlay` (px-5 py-4)

**Migration targets (Round 4 Fase 1):**
1. `src/components/Post/PostCard.tsx` → `<DriftCard variant="default">`
2. `src/components/Post/PostViewer.tsx` → `<DriftCard variant="shadow-stack" size="lg">`
3. `src/components/Comments/CommentCard.tsx` → `<DriftCard variant="default" size="sm">`
4. `src/components/Feed/FeedTabs.tsx` internal cards → `<DriftCard variant="inset">`

**Decoration slot exemplo:**
```tsx
<DriftCard
  decoration={<span aria-hidden className="..."> D </span>}
  ...
>
```

### §3.2 `<DriftSkeleton>` — POST PRIORITY #2

**Por que segundo:** Feed initial load + thread expand sem estado de
loading visual = jank percebido. UX-14 (`comments-ux-audit`) + CP-6
(QA baseline) ambos pedem skeleton padronizado. Direct impact em
**perceived performance do feed de posts**.

**API:**

```typescript
export type DriftSkeletonVariant = 'text' | 'card' | 'avatar' | 'thread'

export interface DriftSkeletonProps {
  variant: DriftSkeletonVariant
  /** Quantas iterações (text=lines, card=stack count) */
  count?: number   // default 1
  /** Animation: shimmer (default) | pulse | static (a11y reduced motion) */
  animation?: 'shimmer' | 'pulse' | 'static'
  className?: string
}
```

**Variants:**

| Variant | Render |
|---|---|
| `text` | 1 line `h-3 w-full bg-drift-border/40` (count = N lines, last line w-3/4) |
| `card` | DriftCard shape full (header + 2 text lines + footer) |
| `avatar` | Circle `h-8 w-8 rounded-full bg-drift-border/40` |
| `thread` | Card + indented child cards (CommentCard skeleton) |

**Animation default:** shimmer via `@keyframes` linear gradient
animation 1.4s infinite. Honor `prefers-reduced-motion` → fallback
`pulse` 2s ease-in-out infinite. `static` em testes ou onde animation
quebra.

**Migration targets:**
1. **Feed initial load** (PostFeed.tsx) → `<DriftSkeleton variant="card" count={3} />`
2. **Thread expand loading** (ThreadView.tsx) → `<DriftSkeleton variant="thread" count={2} />`
3. ProfileModal stats loading → `<DriftSkeleton variant="text" count={3} />`

### §3.3 `<DriftChip>` — POST PRIORITY #3

**Por que terceiro:** CW chips em ComposeOverlay/ReplySheet, source
chips em RelaySettings, CTA-as-chip em PostViewer (DRIFT count badge)
= 7+ ad-hoc shapes. Direct impact no compose flow ("write a post"
UX) **e** post viewer (CW indicator render).

**API:**

```typescript
export type DriftChipVariant =
  | 'neutral'    // border drift-border, text drift-muted
  | 'accent'     // border drift-accent, text drift-accent
  | 'accent2'    // border drift-accent2, text drift-accent2
  | 'spread'     // border drift-spread, text drift-spread
  | 'bury'       // border drift-bury, text drift-bury
  | 'warning'    // border amber-400, text amber-400 (CW chip)
  | 'spoiler'    // border amber-400 dashed (CW spoiler subtype)

export type DriftChipSize = 'xs' | 'sm' | 'md'

export interface DriftChipProps {
  variant?: DriftChipVariant   // default 'neutral'
  size?: DriftChipSize          // default 'sm'
  active?: boolean              // toggles bg fill version
  onClick?: () => void          // pressable chip
  children: ReactNode
  ariaLabel?: string
  /** Optional leading icon */
  icon?: ReactNode
}
```

**Sizes (via §2.1 padding scale):**
- `xs` → `p-chip` + `text-fluid-xs` + `tracking-meta` (CW tags)
- `sm` → `p-sm` + `text-fluid-sm` + `tracking-cta` (source chips, default)
- `md` → `p-md` + `text-fluid-base` + `tracking-cta` (CTA-as-chip)

**Active state:** when `active={true}`, fill = variant color at 12%
opacity (`bg-drift-accent/12`), border at full intensity. Inactive =
border only.

**Migration targets:**
1. **ComposeOverlay CW chips** (`src/components/Create/ComposeOverlay.tsx`)
   → `<DriftChip variant="warning" size="xs" active={hasCw}>nsfw</DriftChip>`
2. **ReplySheet CW chips** (idem ComposeOverlay)
3. **PostCard CW indicator** → `<DriftChip variant="warning" size="xs">CW</DriftChip>`
4. RelaySettings source chips (second-tier)

### §3.4 `<DriftInput>` — second-tier (compose textarea is POST-adjacent)

**Por que aqui (e não top):** Settings forms são second-tier; ComposeOverlay
textarea é o único POST-adjacent uso. Lily resolve textarea
inline durante PostCard migration sem necessidade de DriftInput
implementado em Round 4 fase 1. Fase 2 OK.

**API:**

```typescript
export type DriftInputVariant = 'default' | 'filled' | 'textarea'

export interface DriftInputProps {
  variant?: DriftInputVariant
  type?: 'text' | 'password' | 'email' | 'url' | 'number'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string             // required (a11y)
  disabled?: boolean
  required?: boolean
  /** Apenas variant='textarea' */
  rows?: number
  /** Mostra contador chars (POST-adjacent: ComposeOverlay quer isso) */
  maxLength?: number
  showCounter?: boolean
  className?: string
}
```

**Variants:**
- `default` → `border-1 border-drift-border bg-drift-surface text-drift-text placeholder-drift-muted/60 focus:ring-2 focus:ring-drift-accent2`
- `filled` → idem, mas bg `drift-bg` (em FullPageCard sub-cards)
- `textarea` → `<textarea>` element + `min-h-[80px] resize-y` + counter slot

**Migration targets:**

Round 4 Fase 1 (POST-adjacent):
1. ComposeOverlay textarea → `<DriftInput variant="textarea" maxLength={2000} showCounter>`
2. ReplySheet textarea → idem

Round 4 Fase 2 (second-tier — defer):
- RelaySettings URL inputs
- IdentityPanel nsec import field
- IdentitySwitcher rename input
- DialogHost prompt input

### §3.5 `<DriftToggle>` — second-tier (Settings only)

**Por que último:** Zero call sites no flow de postagens. Settings
form polish, importante mas não bloqueante pra "elevar UX/UI das
postagens".

**API:**

```typescript
export type DriftToggleVariant = 'switch' | 'checkbox'

export interface DriftToggleProps {
  variant?: DriftToggleVariant
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string             // required
  disabled?: boolean
  label?: ReactNode             // optional inline label (uses <label> wrap)
  size?: 'sm' | 'md'            // default 'md'
}
```

**Variants:**
- `switch` → `h-5 w-9` track + `h-4 w-4` thumb, `drift-accent` fill on
- `checkbox` → `h-4 w-4` square + checkmark stroke

**A11y:** `role="switch"` (variant=switch) ou `role="checkbox"`,
`aria-checked`, focus-visible ring.

**Migration targets (defer to Fase 2):**
- SettingsCards Toggle.tsx (todos)
- ContentFilterSettings checkboxes
- Network mode radio (talvez `<DriftRadio>` futuro)

### §3.6 Summary §3 — count e priority order

**5 primitives novos:**

| # | Primitive | POST-priority | Effort Lily | Round 4 phase |
|---|---|---|---|---|
| 1 | `<DriftCard>` | **HIGH** | ~2h | Fase 1 |
| 2 | `<DriftSkeleton>` | **HIGH** | ~1h | Fase 1 |
| 3 | `<DriftChip>` | **HIGH** | ~1.5h | Fase 1 |
| 4 | `<DriftInput>` | MEDIUM (textarea POST-adj) | ~1.5h | Fase 1 (textarea variant only) → Fase 2 (rest) |
| 5 | `<DriftToggle>` | LOW | ~1h | Fase 2 |

**Round 4 Fase 1 total Lily effort:** ~5.5h (3 high + 1 medium textarea-only).

---

## §4 — Migration plan

### §4.1 Filosofia: incremental, não big-bang

V0.7 estabeleceu pattern (DriftButton, FullPageCard) onde primitive
existe **opt-in**, call sites legacy permanecem até migração coordenada.
v0.8 mantém: nenhum primitive deleta inline class. Migration acontece
em waves.

### §4.2 Round 4 Fase 1 — POST-priority (Lily, ~6h)

**Critério:** todos os primitives high-priority + call sites no flow
de postagens.

**Tasks ordenadas:**

1. **(0.5h) Tokens em `tailwind.config.js`:**
   - Adicionar `transitionDuration` motion-* (§2.3)
   - Adicionar `transitionTimingFunction` ease-emphasis/elastic (§2.3)
   - Adicionar `borderWidth` 1/1.5/2 (§2.4)
   - Adicionar plugin Tailwind utility `p-chip..p-overlay` (§2.1)
   - Adicionar `tracking-cta` em letterSpacing (§2.2)
   - **Espelhar em `src/index.css`** CSS vars correspondentes

2. **(2h) `<DriftCard>` primitive:**
   - Implementar `src/components/UI/DriftCard.tsx`
   - 4 variants × 3 sizes
   - Pure helpers exportados (driftCardClassName, etc.) — modelo DriftButton
   - Tests `tests/drift-card.test.ts` (pure helpers)

3. **(1h) `<DriftSkeleton>` primitive:**
   - Implementar `src/components/UI/DriftSkeleton.tsx`
   - 4 variants + 3 animations
   - Honor `prefers-reduced-motion`
   - Tests pure helpers

4. **(1.5h) `<DriftChip>` primitive:**
   - Implementar `src/components/UI/DriftChip.tsx`
   - 7 variants × 3 sizes × active state
   - Pure helpers
   - Tests

5. **(1h) Call site migrations (POST-flow primeiro):**
   - PostCard.tsx → DriftCard
   - PostViewer.tsx → DriftCard variant=shadow-stack
   - CommentCard.tsx → DriftCard variant=default size=sm
   - ComposeOverlay.tsx CW chips → DriftChip variant=warning
   - ReplySheet.tsx CW chips → DriftChip
   - PostFeed loading → DriftSkeleton variant=card
   - ComposeOverlay textarea → DriftInput variant=textarea (mini-impl
     dentro desse arquivo OU primitive completo — Lily decide pelo
     escopo de tempo)

**Saída esperada Fase 1:** PostViewer + CommentCard + ComposeOverlay
**visualmente coerentes**, conformidade post-components ≥ 90%.

### §4.3 Round 4 Fase 2 — Second-tier (Lily, ~3h, opcional)

**Critério:** Settings, Identity, Onboarding components.

- DriftInput rest of variants
- DriftToggle primitive completo
- Migrar Toggle.tsx call sites
- Migrar RelaySettings/IdentityPanel/IdentitySwitcher inputs

**Pode slot em Round 5 ou Round 6** se Fase 1 estourar tempo.

### §4.4 Round 5 — Conformance (Marshall, ~3h)

- ESLint rule `drift/no-adhoc-tracking` (§2.2)
- ESLint rule `drift/no-adhoc-border` (§2.4)
- ESLint rule `drift/prefer-fluid-text` warn em `src/components/Post/**`
- Conformance test `tests/design-system-v08-conformance.test.ts`:
  - Zero `text-slate-*` em strings JSX produção
  - Tokens novos referenciados em ≥1 component
  - PostCard/CommentCard/PostViewer usam DriftCard
  - Spread/bury kinds 9079/9080 preservados
- Build sem warnings
- Robin QA #3 → conformidade ≥ 85% global, ≥ 90% post-flow

### §4.5 Fase 3 (deferred, sem owner ainda)

Full migration de todos call sites legacy. Tracked como débito
contínuo. Não bloqueia v0.8 ship.

---

## §5 — Não-tocar (anti-recomendações)

Decisões já tomadas que v0.8 **não revisa**:

1. **Não renomear `drift-spread`/`drift-bury`** — vocabulary lock manifesto §28.
2. **Não mudar hex `drift-bg`/`drift-surface`** — afeta PWA `theme-color`
   sync (5 fontes da verdade, §5 design-system v0.7).
3. **Não introduzir tema light** — manifesto §28 prefere dark por
   privacy (OLED battery, redução de tracking via fingerprinting de
   tema). Out of scope v0.8.
4. **Não adicionar fonte além Syne + DM Mono** — V2 polish bundle
   local separado; nova fonte = nova bundle = privacidade impacto.
5. **Não tocar `space-y-*` Tailwind built-in** — padding scale §2.1
   é orthogonal.
6. **Não remover `card-x`/`card-x-wide` CSS vars** — coexistem com
   §2.1; usadas em SubpostLayout que tem semântica diferente.
7. **Não introduzir framework de animation novo** — Framer Motion
   permanece único. Tokens §2.3 alimentam Framer via inline ou via
   styled wrappers; não é Lottie/anime.js etc.
8. **Não adicionar prop `theme` em primitives** — primitives consomem
   tokens via Tailwind classes diretas; theme switching futuro (se
   houver) acontece via CSS var override no `:root`.
9. **Não criar `<DriftModal>` separado de FullPageCard** — FullPageCard
   já é o pattern modal canônico. v0.8 mantém.
10. **Não adicionar primitive `<DriftBadge>`** — DriftChip variant=xs
    + non-clickable cobre o caso. Avoid primitive sprawl.

---

## §6 — Conformance gates

Validados em Round 5 por Marshall.

### §6.1 Lint gates

| Gate | Pass criteria |
|---|---|
| `drift/no-adhoc-tracking` | Zero `tracking-\[\d+px\]` em strings JSX produção |
| `drift/no-adhoc-border` | Zero `border-\[\d+px\]` (use border-1/1.5/2) |
| `drift/no-text-slate` | Zero `text-slate-*` em `src/components/Post/**` e `src/components/Create/**` (POST-priority — second-tier components OK) |
| `drift/prefer-fluid-text` (warn) | `text-\[\d+px\]` em POST-flow → warn |

### §6.2 Test gates

| Test | Location |
|---|---|
| Token paridade Tailwind ↔ CSS vars | `tests/manifesto-conformance.test.ts` (extender) |
| Vocab lock preserved | `tests/manifesto-conformance.test.ts` (existente) |
| DriftCard pure helpers | `tests/drift-card.test.ts` (novo) |
| DriftSkeleton pure helpers | `tests/drift-skeleton.test.ts` (novo) |
| DriftChip pure helpers | `tests/drift-chip.test.ts` (novo) |
| Migration coverage post-flow | `tests/design-system-v08-conformance.test.ts`: regex assert PostCard/CommentCard/PostViewer render via DriftCard |

### §6.3 Build gates

- `npm run build` zero warnings
- `npm run lint` zero erros (warnings OK em Fase 1, hardenar Fase 2)
- `npm run test` 399+ tests verde

### §6.4 Visual gates (Robin QA #3)

| Métrica | Alvo |
|---|---|
| Conformidade global | **≥ 85%** (de 68% baseline regression) |
| Conformidade post components (PostViewer + CommentCard + ComposeOverlay) | **≥ 90%** (POST-priority weighting) |
| Finds S0 (regression) | 0 |
| Finds S1 (high) | ≤ 5 (de ~17 atual) |

### §6.5 A11y gates

- Contraste WCAG AA mínimo em todas variants novas (DriftChip variant
  warning sobre drift-bg = 9.8:1 ✓; DriftCard variants ≥ 4.5:1 ✓)
- Focus-visible ring em DriftCard onClick
- `prefers-reduced-motion: reduce` honored em DriftSkeleton
- aria-label required em DriftInput, DriftToggle, DriftChip onClick
- `role="switch"` em DriftToggle variant=switch

---

## §7 — Cross-references

### §7.1 Predecessores

- **`Docs/design-system.md` v0.7** — tokens base, vocabulary lock,
  patterns 4.1-4.7. v0.8 estende, não substitui.
- **`Docs/manifesto.md` v2.2** — §7 determinismo, §22 score sem
  afinidade, §24 sem bolha, §28 vocabulary lock. v0.8 conforma.
- **`Docs/rfcs/2026-05-rfc-event-handler-registry.md`** — RFC pattern
  predecessor (mesmo formato ADR pragmático).

### §7.2 Origens dos finds (auditorias)

- **`Docs/sessions/design-qa-baseline-2026-05-08.md`** (Robin QA #1) —
  CP-2 (padding), CP-3 (tracking), CP-4 (motion), CP-15 (border), CP-6
  (skeleton). 90 finds.
- **`Docs/sessions/design-qa-regression-2026-05-08.md`** (Robin QA #2) —
  verdict 🟢 verde 68% conformidade. Gap analysis motivando v0.8.
- **`Docs/sessions/text-responsivity-audit-2026-05-08.md`** (Ted §3.1)
  — type scale fluid (§2.5).
- **`Docs/sessions/comments-ux-audit-2026-05-08.md`** (Robin) — UX-Cm-*
  finds informando CommentCard / DriftCard size=sm + thread skeleton.
- **`Docs/sessions/ted-ux-spike-deployed-2026-05-08.md`** (Ted) — TX-1
  até TX-12, FullPageCard pattern → DriftCard variant=elevated.
- **`Docs/sessions/track-c-debt-scoping-2026-05-08.md`** (Lily) —
  motion debt, alimentando §2.3.

### §7.3 Sucessores planejados

- **`Docs/sessions/lily-motion-perf-plan-2026-05-08.md`** (Round 3
  paralelo §4.2) — convergência com §2.3 motion tokens + reduced
  motion handling em DriftSkeleton/DriftCard.
- **Round 4 implementation** — Lily executa §3 + §4.2.
- **Round 5 conformance** — Marshall executa §6.
- **Round 6 (proposto)** — full migration Fase 3 + DriftRadio + se
  tiver appetite, micro-interactions polish.

---

## §8 — Apêndice: Decision log

### §8.1 Por que 5 primitives, não 7+?

**Considerados e rejeitados:**

- `<DriftBadge>` — DriftChip variant=xs cobre. Avoid sprawl.
- `<DriftDropdown>` — apenas 2 call sites (RelaySettings, ContentFilter).
  Não justifica primitive ainda. Round 6 talvez.
- `<DriftRadio>` — só 1 call site relevante (network mode).
  DriftToggle variant=radio possível extensão futura.
- `<DriftAvatar>` — Drift identidade é npub não user com avatar; sem
  call site. Out of scope.
- `<DriftTooltip>` — pattern não estabelecido em v0.7. Round 6 talvez.

### §8.2 Por que `<DriftCard>` no topo (POST-priority)?

Quantitativo: 18 finds (Robin QA) + 14 finds (Comments UX) + 7 finds
(Ted UX spike) → **39 finds (33%) resolvíveis por DriftCard**. Maior
ROI single-primitive na campanha v0.8. PostCard/PostViewer/CommentCard
todos consumem.

### §8.3 Por que NÃO renomear `tracking-tag` pra `tracking-uppercase`?

Existe há ≥3 commits, ≥40 call sites. Renomear quebra grep histórico
sem ganho semântico (tag = aria-label semântico já implícito). Mantido.

### §8.4 Por que motion duration vai como Tailwind token, não CSS var?

Framer Motion consome diretamente em props (`transition={{ duration:
0.3 }}`). Tailwind token via `theme.extend.transitionDuration` permite
classe CSS pra non-Framer (e.g., `transition-[motion-fast]`). CSS var
seria redundante (Framer não lê). Decidido: Tailwind apenas.

### §8.5 Risco residual

- **Bundle size:** +5 primitives ≈ +6kb gzipped estimado. Aceitável
  (<1% de bundle atual ~700kb).
- **Lily implementation overrun:** Fase 1 ~5.5h estimado; se overrun,
  defer DriftInput textarea-only → Fase 2, mantém 3 high primitives
  (Card/Skeleton/Chip) Fase 1 = ~4.5h.
- **Robin QA #3 falha em ≥85%:** rollback impossible (incremental, não
  big-bang) — gap fica como débito Fase 3. Aceitável.

---

## Histórico

- **2026-05-08 v0.8 RFC draft (Ted):** consolidação de 117 finds
  (Robin QA #1 + Ted UX spike + Robin Comments UX) em 6 token scales
  + 5 primitives + migration plan. POST-priority weighting reflete
  user feedback de Round 3 ("postagens estão feias e pouco intuitivas").
  Conformance gates pra Round 5 Marshall.

---

*RFC produzido por Ted (HIMYM persona — arquitetura). Implementation
em Round 4 by Lily. Validation em Round 5 by Marshall. POST-priority
preservada em todos os marcos: PostViewer + CommentCard +
ComposeOverlay são o pulse da v0.8.*
