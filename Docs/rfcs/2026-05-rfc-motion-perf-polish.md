# RFC — Motion + Perceived Performance Polish (POST-PRIORITY)

**Status:** Draft (Round 3 — planning only, no implementation)
**Owner:** Lily (HIMYM persona — core code, runtime, fluxos de dados)
**Sibling RFCs:** Ted §4.1 design system v0.8 (motion tokens), Marshall §4.3 token enforcement
**Sources consumed:**
- `Docs/sessions/ted-delegation-plan-2026-05-08.md` §4.1 + §4.2 (motion tokens, scope)
- `Docs/sessions/design-qa-baseline-2026-05-08.md` (CP-4 8 valores duration; CP-6 skeleton; AY-9 reduced motion)
- `Docs/sessions/comments-ux-audit-2026-05-08.md` (UX-2 peek vazia, UX-14 loading)
- `Docs/sessions/ted-ux-spike-deployed-2026-05-08.md` (TX-1 sub-card flicker, TX-3 post 70% empty, TX-9 UpdatePrompt clutter)
- Code: `src/components/Post/PostViewer.tsx`, `CommentCard.tsx`, `Create/ComposeOverlay.tsx`, `UI/Image.tsx`, `UI/SlideUpOverlay.tsx`, `UI/FullPageOverlay.tsx`, `UI/UpdatePrompt.tsx`

> **Mandate (user reforço 2026-05-09):** "ainda precisamos melhorar a UI
> e UX das postagens, está feio e pouco intuitivo a usabilidade".
> Round 3 inteiro = **POST-PRIORITY**. Cada animação, skeleton,
> optimistic UI deve dar prioridade visual/funcional ao **flow de
> postagens** (criar, ler, espalhar, enterrar, comentar). Settings,
> Identity, Relays vêm depois.

> **Escopo:** doc-only. Round 4 executa. Tom: pragmático.

---

## TL;DR (60s)

Motion no Drift é **funcional mas inconsistente**. CP-4 catalogou 8
valores de `duration` distintos (0.15 → 0.32) sem regra; AY-9
identificou 4 components sem `useReducedMotion`; UX-14 e CP-6 apontam
skeleton ad-hoc só em `Image.tsx`. Optimistic UI de spread/bury vive
como `useState` nos card containers — quando relay tarda 800ms+,
user clica de novo achando que falhou.

Esta RFC consolida:

1. **5 motion tokens** (consumindo Ted §4.1 §2.3): `motion-fast`,
   `motion-base`, `motion-emphasis`, `motion-card`, mais `motion-micro`
   para hover/feedback (~120ms — gap atual).
2. **Migração das ~30 usages** de Framer Motion para os tokens, com
   POST flow priorizado.
3. **`<DriftSkeleton>`** como pattern padrão (variants `text` /
   `card` / `avatar` / `image`), aplicado primeiro a Post/Feed.
4. **Optimistic feedback unificado** para spread/bury/comment-publish
   (atualmente: silencioso ou com loading texto).
5. **Reduced motion compliance** uniforme (audit em 7 components
   faltando, fix com pattern shared).
6. **Top 5 Round 4 fixes POST-priority** (~6h Lily): PostViewer enter,
   CommentCard reveal, ComposeOverlay slide-up, ImageLightbox fade,
   FAB responder pulse + spread/bury optimistic.

Não-objetivos: trocar Framer Motion, redesenhar swipe physics,
refactor PostViewer arch, reactions em comments.

---

## §1 — Motion design tokens (consumo Ted §4.1 §2.3)

### 1.1 Tokens canônicos

Ted §4.1 propôs 4 tokens. Esta RFC adiciona **`motion-micro`** porque
hover/chip-feedback (atualmente 150ms via `transition-colors` Tailwind
default) é semanticamente distinto de "fast UI feedback" (200ms).

| Token | Duração | Easing | Uso canônico |
|---|---:|---|---|
| `motion-micro` | **120ms** | `ease-out` (`cubic-bezier(0.0, 0.0, 0.2, 1)`) | hover bg, chip flash, focus ring fade in, button press scale |
| `motion-fast` | **180ms** | `ease-out` | small modal/badge/dismiss; chip enter; toast appear |
| `motion-base` | **240ms** | `ease-in-out` (`cubic-bezier(0.4, 0.0, 0.2, 1)`) | overlay enter/exit (FullPage, SlideUp); ReplySheet drag-snap |
| `motion-emphasis` | **320ms** | spring-ish (`cubic-bezier(0.32, 0.72, 0, 1)`) | card stack transition (PostViewer, ThreadView); feature reveal |
| `motion-card` | **360ms** | spring-ish (idem) | post create reveal; thread cursor swap; mode change list↔cards |

**Notação Tailwind/CSS proposta** (Ted §4.1 §2.3 confirma estrutura):

```js
// tailwind.config.js
theme: {
  extend: {
    transitionDuration: {
      micro: '120ms',
      fast: '180ms',
      base: '240ms',
      emphasis: '320ms',
      card: '360ms',
    },
    transitionTimingFunction: {
      'drift-out': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
      'drift-inout': 'cubic-bezier(0.4, 0.0, 0.2, 1)',
      'drift-spring': 'cubic-bezier(0.32, 0.72, 0, 1)',
    },
  },
}
```

**Exposto também** como JS const em `src/lib/motion.ts` (novo) para
uso em Framer:

```ts
export const MOTION = {
  micro:    { duration: 0.12, ease: [0.0, 0.0, 0.2, 1] },
  fast:     { duration: 0.18, ease: [0.0, 0.0, 0.2, 1] },
  base:     { duration: 0.24, ease: [0.4, 0.0, 0.2, 1] },
  emphasis: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
  card:     { duration: 0.36, ease: [0.32, 0.72, 0, 1] },
} as const
```

**Por que JS const + Tailwind:** Framer Motion (`transition={...}`)
não consegue ler tokens Tailwind. Source-of-truth duplicado mas
acoplado por nomes — Marshall pode adicionar conformance test que
verifica paridade (numbers in `tailwind.config.js` === numbers in
`src/lib/motion.ts`).

### 1.2 Mapping CP-4 → token

CP-4 catalogou 8 durations atuais. Mapeamento target:

| Atual | Sites (exemplos) | → Token |
|---|---|---|
| 0.15 | DialogHost, OnboardingOverlay | `motion-micro` (0.12) ou `motion-fast` (0.18) |
| 0.18 | DialogHost, OnboardingOverlay, ReplySheet, **CommentCard** (3x) | `motion-fast` (0.18) ✓ exato |
| 0.20 | SlideUpOverlay backdrop | `motion-fast` (0.18) |
| 0.22 | ReplySheet, **CommentCard image transition** | `motion-base` (0.24) |
| 0.24 | ThreadView | `motion-base` (0.24) ✓ exato |
| 0.25 | FullPageOverlay, SlideUpOverlay modal, UpdatePrompt | `motion-base` (0.24) |
| 0.28 | ThreadView shadow cards | `motion-base` (0.24) ou `motion-emphasis` |
| 0.32 | **PostViewer card** (3x) | `motion-emphasis` (0.32) ✓ exato |

Apenas duas mudanças semanticamente notáveis: 0.20→0.18 (backdrop
acelera 10%) e 0.28→0.24 (shadow cards mais snappy). Risco visual
baixo.

### 1.3 Easing simplification

3 easings cobrem 95% dos casos. Custos `[0.32, 0.72, 0, 1]` em
PostViewer já é o `motion-spring`; manter literal lá ou refatorar
para usar `MOTION.emphasis.ease`. Recomenda-se a segunda opção, mas
**não tocar a matemática do swipe physics em SwipeHandler** (Lily plan
§7 anterior já flagou).

---

## §2 — Standardize entry/exit animations across overlays

### 2.1 Inventário de overlays (8 surfaces)

POST-priority surfaces (flow de postagens) **primeiro**:

| Surface | Atual | Issue | Prioridade Round 4 |
|---|---|---|---|
| **PostViewer** (modal mode) | `opacity 0→1, scale 0.96→1, y 20→0`, `0.32 spring` | OK exato; verbose, dispersar via token | **POST P1** |
| **CommentCard** (reveal) | 3x `motion.div opacity 0→1`, `0.18` | TX-1-style flicker se body+image montam juntos | **POST P1** |
| **ComposeOverlay** | **NENHUMA** (montagem direta) | Pop sem transition; user perde contexto de origem | **POST P0** (gap) |
| **ReplySheet** | drag-down + `0.22` exit | Pattern OK, migrar pra `motion-base` | **POST P2** |
| **ImageLightbox** (em `Image.tsx`) | **NENHUMA** (`{lightboxOpen && <div>...`) | Aparece "boom"; backdrop sem fade-in | **POST P1** |
| **FullPageOverlay** | `opacity 0→1, y 22→0`, `0.25` | TX-1 flicker com SettingsRoot underneath | NON-POST P3 |
| **SlideUpOverlay** | `y 100%→0`, `0.25` | OK | NON-POST P4 |
| **DialogHost** | `opacity 0→1, scale 0.95→1`, `0.15` | OK micro | NON-POST P5 |

POST-priority overrides Round 3 mandate: ComposeOverlay (P0), then
PostViewer/CommentCard/ImageLightbox (P1), then ReplySheet/FullPage
later.

### 2.2 Pattern "shared overlay variants"

Proposta: criar `src/lib/motion-variants.ts` com presets reutilizáveis:

```ts
import { MOTION } from './motion'

export const overlayFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: MOTION.fast,
}

export const overlaySlideUp = {
  initial: { opacity: 0, y: 22 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 14 },
  transition: MOTION.base,
}

export const cardReveal = {
  initial: { opacity: 0, scale: 0.96, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, y: -20 },
  transition: MOTION.emphasis,
}

export const composeSheet = {
  initial: { opacity: 0, y: '100%' },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: '100%' },
  transition: MOTION.base,
}

export const lightboxBackdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: MOTION.fast,
}

export const lightboxImage = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: MOTION.base,
}
```

Cada call site importa e spread:

```tsx
<motion.div {...cardReveal}>...</motion.div>
```

Reduz ~50 linhas duplicadas e elimina deriva `0.20 vs 0.22 vs 0.25`.

### 2.3 TX-1 flicker fix — reuso do FullPageCard

Já abordado em commit `5ff16b2` (FullPageCard primitive). Esta RFC
**reafirma**: todo sub-card overlay (StatusCard, RelaysCard,
IdentityCard, etc.) consome FullPageCard e a entrada usa
`overlaySlideUp`. Eliminar fades duplicados (sub-card por cima de
SettingsRoot).

### 2.4 ComposeOverlay slide-up (POST P0)

ComposeOverlay hoje aparece sem motion. User clica "+" no NavBar →
overlay aparece "snap". Pattern proposto:

```tsx
<AnimatePresence>
  {open && (
    <motion.div {...composeSheet} className="...fixed inset-0...">
      ...
    </motion.div>
  )}
</AnimatePresence>
```

Side benefit: dismissal por drag-down (reuso do gesture handler do
ReplySheet — pattern). Threshold 100px; <100px snap-back via `MOTION.base`.

---

## §3 — Skeleton consistency

### 3.1 Estado atual

CP-6 baseline:
- ✅ `Image.tsx` — `animate-pulse bg-gradient-to-br` (único)
- ❌ PostCard — sem skeleton; rendering blank até hidratado
- ❌ CommentCard — sem skeleton; "carregando comentários…" texto puro
- ❌ ImageLightbox — backdrop aparece com imagem ainda carregando
- ❌ ProfileModal — vazio até npub resolve
- ❌ Settings cards — vazio na boot

### 3.2 `<DriftSkeleton>` primitive (consume Ted §3.5)

Ted §3.5 já specifica variants `text | card | avatar`. Esta RFC
adiciona `image` (gradient match `Image.tsx`):

```tsx
type DriftSkeletonVariant = 'text' | 'card' | 'avatar' | 'image'
type DriftSkeletonProps = {
  variant: DriftSkeletonVariant
  className?: string
  count?: number  // for text — N lines
  width?: string  // for text — last line shorter
}

<DriftSkeleton variant="text" count={3} />
<DriftSkeleton variant="card" />
<DriftSkeleton variant="avatar" />
<DriftSkeleton variant="image" aspect="1/1" />
```

Internals: `animate-pulse bg-gradient-to-br from-drift-surface to-drift-bg`,
height variants, `motion-reduce:animate-none`.

### 3.3 Aplicação POST-priority

| Site | Variant | Trigger | Prioridade |
|---|---|---|---|
| **PostCard loading** | `card` (full) | Antes de SQLite hydration; 1ª render sem post | **POST P1** |
| **CommentCard loading** | `card` × 3 | ThreadView LoadingState (substitui "carregando…" texto, UX-14) | **POST P1** |
| **Image dentro de Post/Comment** | `image` | Já existe; alinhar com primitive (refator) | **POST P2** |
| **ImageLightbox preview** | `image` | Antes de imagem fullscreen carregar | **POST P2** |
| **ProfileModal** | `text` × 4 + `avatar` | Antes de kind 0 resolver | NON-POST P3 |
| **Settings boot** | `card` × 6 | Antes de SQLite read | NON-POST P4 |

**Detalhe UX-14:** ThreadView hoje mostra "carregando comentários…"
indefinidamente se relay não responde. Skeleton + timeout 3s pra
secondary message ("buscando em N relays…") cobre o gap sem upgrade
de UX-14 effort estimate (1.5h continua).

---

## §4 — Optimistic UI tightening

### 4.1 Estado atual

Pesquisa em `src/components/Post/`:

- **PostViewer spread/bury**: handlers chamam `spreadPost()` /
  `buryPost()`; UI atualiza count via SQLite refresh (debounced
  150ms via `invalidateFeed`). Botão fica disabled durante
  `isPending` mas **sem feedback positivo intermediário** —
  user vê count antigo até relay confirmar.
- **ReplySheet publicar**: `isPublishing: boolean` toggle; button
  text muda "publicar" → "publicando…". Funcional mas mudo.
- **ComposeOverlay DRIFT**: idem ReplySheet.
- **Comment delete (next phase)**: N/A.

### 4.2 Princípios POST-priority

Manifesto §22 (deterministic scoring) **não conflita** com optimistic
UI: optimistic é estado React local, descartado quando SQLite
confirma (CLAUDE.md invariante 2). Critical UX win.

**Pattern proposto: `useOptimistic<T>()` hook** em
`src/hooks/useOptimistic.ts`:

```ts
export function useOptimisticAction<TResult>(
  action: () => Promise<TResult>,
  opts?: { onConfirm?: () => void; onError?: (e: unknown) => void }
): {
  pending: boolean
  ok: boolean   // brief 'flash' of success — true por 800ms post-resolve
  error: unknown | null
  fire: () => Promise<void>
}
```

Para spread/bury especificamente:

```tsx
const spread = useOptimisticAction(() => spreadPost(postId, ...))
// UI:
<button onClick={spread.fire} disabled={spread.pending}>
  {spread.pending ? '…' : '↑'} {optimisticCount}  {/* +1 visual */}
</button>
{spread.ok && <SpreadFlash />}  {/* brief chartreuse glow, 800ms */}
```

### 4.3 Visual feedback patterns

| Action | Optimistic visual | Confirm visual | Error visual |
|---|---|---|---|
| **SPREAD** | Count `+1` instant; button `bg-drift-spread/20` press; `motion-micro` scale 1.05 | `motion-fast` glow pulse 800ms | shake `motion-fast` + count revert |
| **BURY** | Count `+1` instant; button `bg-drift-bury/20`; idem scale | idem (mas dimmer) | idem |
| **Comment publish** | Sheet `motion-base` slide-down dismiss; comment aparece **inline** com `motion-fast` opacity flash + `border-l-drift-accent2/40` 3s | `border-l` fade out via `motion-base` | sheet reabre + erro inline |
| **Post create** | ComposeOverlay `motion-base` dismiss; toast "publicando" → "publicado" `motion-fast` | feed reflete via `invalidateFeed`; novo card aparece com `motion-emphasis` | toast "falhou — retry?" |

### 4.4 Edge case — race entre relays

Se kind 9079 chega de relay A em 80ms e relay B em 1200ms, optimistic
flash resolve em 80ms (primeiro). Sem problema — `useOptimisticAction`
desliga após first SQLite confirm via `invalidateFeed`.

Se TODOS relays falham (3000ms timeout), mostrar shake + revert.
Cap timeout em `MOTION.card * 8` (~3s) para não pendurar UX
indefinidamente.

---

## §5 — Reduced motion compliance

### 5.1 Audit AY-9

Components com `useReducedMotion()`:
- ✅ ThreadView (`motion-reduce:hidden` em peek shadows)
- ✅ ReplySheet
- ✅ CommentCard (via Framer global)

Components SEM `useReducedMotion()`:
- ❌ PostViewer (3 motion.div em modal/embedded modes)
- ❌ FullPageOverlay
- ❌ SlideUpOverlay
- ❌ ComposeOverlay (pos-§2 add)
- ❌ ImageLightbox
- ❌ DialogHost
- ❌ UpdatePrompt

### 5.2 Pattern proposto

`src/lib/motion-variants.ts` exporta helper:

```ts
import { useReducedMotion } from 'framer-motion'
import { MOTION } from './motion'

export function useMotionPreset() {
  const reduced = useReducedMotion()
  return {
    fast: reduced ? { duration: 0 } : MOTION.fast,
    base: reduced ? { duration: 0 } : MOTION.base,
    emphasis: reduced ? { duration: 0 } : MOTION.emphasis,
    card: reduced ? { duration: 0 } : MOTION.card,
    micro: reduced ? { duration: 0 } : MOTION.micro,
  }
}
```

Hook returns transition objects ready for spread.

Variants em §2.2 ganham assinatura "lazy":

```ts
export function cardRevealVariants(reduced: boolean) {
  return {
    initial: reduced ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit:    reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -20 },
    transition: reduced ? { duration: 0 } : MOTION.emphasis,
  }
}
```

Trade-off: presets em §2.2 mais clean (consts); presets-as-fns mais
honest sobre reduced-motion. **Decisão:** funcs (5 LoC perdidos por
const, ganho a11y consistente).

### 5.3 Tailwind `motion-reduce:` parallel

Para anims puramente CSS (`animate-pulse` em DriftSkeleton, hover
transitions), aproveitar Tailwind `motion-reduce:`:

```tsx
<div className="animate-pulse motion-reduce:animate-none ..." />
```

Não conflita com Framer; cobre paths não-Framer.

---

## §6 — Perceived performance

### 6.1 Defer non-critical work

Atual `Image.tsx` já faz `import('../../lib/blobs')` lazy (linha
111) — **modelo a replicar**. Candidates POST-priority:

| Module | Loaded eagerly hoje | Defer trigger | Win |
|---|---|---|---|
| `comments.ts` (NIP-22) | Importado em FeedTab | Hover/tap em "💬 N" | -40KB initial bundle |
| `lightbox` lógica | Inline em `Image.tsx` | Já lazy ✓ | — |
| `bip39.ts` | Importado em IdentityPanel | Tap em "import seed" | -200KB BIP39 wordlist |
| `helia/ipfs` (Track B) | Lazy via blobs ✓ | — | — |
| `ProfileModal` kind 0 fetch | Importado em PostViewer | Tap no avatar | -10KB nip19 helpers |

**Não defer:** `protocol.ts`, `events.ts`, `feed.ts` — critical path.

### 6.2 Prefetch estratégico

Após FCP do Feed, prefetch o que o user provavelmente vai abrir:

```ts
useEffect(() => {
  if (firstFeedRender) {
    void import('./Post/ThreadView')      // user vai abrir comments
    void import('./Create/ComposeOverlay') // user vai postar
  }
}, [firstFeedRender])
```

Modular Vite split garante chunks; prefetch só warmup.

### 6.3 Image strategy

`Image.tsx` skeleton + `transition-opacity duration-200` = OK.
Migração: `duration-200` → `duration-fast` (180ms tokenizado).

Para POST cards no Feed: aplicar `loading="lazy"` no `<img>` se
ainda não tem (verificar Round 4).

### 6.4 Budget targets

- Feed FCP < 1.5s (cold cache, 4G)
- Post tap → PostViewer pintado < 200ms (já é; preserve)
- ComposeOverlay open → keyboard ready < 250ms
- Spread/bury action → optimistic flash < 16ms (one frame)

---

## §7 — Implementation plan Round 4

### 7.1 Top 10 spots priorizados (POST-priority)

Estimativas Lily-cap respeitada (Round 4 ~1 dia útil = ~6-8h).

| # | Item | File(s) | Effort | POST-prio | Depende |
|---|---|---|---|---|---|
| 1 | **PostViewer enter/exit** via `cardRevealVariants` + `useMotionPreset` | `Post/PostViewer.tsx` | 45min | ★★★ | §1 + §2.2 + §5.2 |
| 2 | **CommentCard reveal** transition (UX-14 inline + reduce flicker TX-1-like em image) | `Post/CommentCard.tsx` | 45min | ★★★ | §1 + §2.2 |
| 3 | **ComposeOverlay slide-up** (gap atual — montagem direta) | `Create/ComposeOverlay.tsx` | 1h | ★★★ | §2.4 |
| 4 | **ImageLightbox fade + scale** | `UI/Image.tsx` | 30min | ★★★ | §2.2 |
| 5 | **FAB ↵ responder pulse** + spread/bury optimistic UI | `Post/PostViewer.tsx`, `Post/ThreadView.tsx`, novo `hooks/useOptimisticAction.ts` | **2h** | ★★★ | §4.1 + §4.2 |
| 6 | `<DriftSkeleton>` primitive + PostCard skeleton | novo `UI/DriftSkeleton.tsx`, `Post/PostCard.tsx` | 1h | ★★ | §3.2 |
| 7 | CommentCard skeleton (ThreadView LoadingState 3-card) | `Post/ThreadView.tsx` | 30min | ★★ | #6 |
| 8 | `src/lib/motion.ts` + `motion-variants.ts` + Tailwind tokens | new files + `tailwind.config.js` | 30min | (foundation) | §1 |
| 9 | Reduced-motion sweep (PostViewer, FullPageOverlay, SlideUpOverlay, ComposeOverlay) | 4 files | 45min | ★ | §5.2 |
| 10 | TX-9 UpdatePrompt → toast colapsado dot | `UI/UpdatePrompt.tsx` | 1h | (NON-POST, but quick low risk) | §1 |

**Total:** ~9.25h. Lily real-cap: priorizar **#8 + #1-5 + #6-7**
(~6.75h). #9 e #10 ficam pra Round 5 se sobrar tempo, sem
prejudicar POST-flow.

### 7.2 Order of operations

```
DIA 1
  09:00 — #8 foundation (motion tokens infra) — 30min
  09:30 — #1 PostViewer enter/exit — 45min
  10:15 — #4 ImageLightbox fade — 30min
  10:45 — #2 CommentCard reveal — 45min
  11:30 — break
  11:45 — #3 ComposeOverlay slide-up — 1h
  12:45 — lunch
  13:45 — #5 spread/bury optimistic + FAB pulse — 2h
  15:45 — break
  16:00 — #6 DriftSkeleton + PostCard — 1h
  17:00 — #7 CommentCard skeleton (LoadingState) — 30min
  17:30 — review + git diff sanity
```

POST-flow done by EOD #1. Round 4 D2 cobre #9, #10 e qualquer Robin
QA #3 finds que aparecerem.

### 7.3 Test plan (Round 4 + Marshall §4.3 conformance)

- **Vitest**: `tests/motion-tokens.test.ts` (Marshall) verifica
  paridade entre `tailwind.config.js` e `src/lib/motion.ts`.
- **Visual sanity manual** — checklist:
  - PostViewer abre suave, sem flicker
  - CommentCard transitions sem stagger duplo
  - ComposeOverlay slide-up + drag-down dismiss funciona
  - ImageLightbox fade entrada (não "boom")
  - Spread → flash chartreuse → count +1 → confirma 800ms
  - Bury → flash drift-bury dim → idem
  - prefers-reduced-motion no DevTools → tudo "snappa" sem anim
- **Marshall §4.3** ESLint rule pode adicionar futuramente:
  `no-magic-motion-duration` — flag literal `duration: 0.X` quando
  não vem de `MOTION.*`.

### 7.4 Rollback plan

Cada commit Round 4 atômico, revert isolado. Branch sugerida:
`round4/motion-perf-polish`. Merge gate: build verde + Robin QA #3
visual ≥ 85% conformity (Ted §6 gate).

### 7.5 Não-tocar (anti-recomendações)

- **Easing matemático em PostViewer card swipe physics** (`SwipeHandler`):
  custom calibrado, não trocar por token spring antes de audit visual.
- **ReplySheet drag thresholds** (80px): user-tested, calibrated.
- **OnboardingOverlay step transitions**: V0/V1 polish — fora
  do escopo (cobre Lily plan §7 anterior).
- **Framer Motion como dep**: não considerar trocar por View Transitions
  API ainda — browser support insuficiente em PWA Android (Apr 2026).
- **NavBar transitions**: já estáveis, sem fricção reportada.

---

## §8 — Cross-references

- `Docs/rfcs/2026-05-rfc-design-system-v08.md` — Ted §4.1 (motion tokens canon)
- `Docs/rfcs/2026-05-rfc-event-handler-registry.md` — predecessor patterns
- `Docs/sessions/marshall-token-enforcement-plan-2026-05-08.md` — Marshall §4.3 lint rules
- `Docs/sessions/comments-ux-audit-2026-05-08.md` UX-14 (loading skeleton)
- `Docs/sessions/ted-ux-spike-deployed-2026-05-08.md` TX-1 (sub-card flicker), TX-3 (post 70% empty), TX-9 (UpdatePrompt clutter)
- `Docs/sessions/design-qa-baseline-2026-05-08.md` CP-4 (8 durations), CP-6 (skeleton), AY-9 (reduced motion)

## §9 — Open questions (Round 4 kickoff)

1. **`motion-micro` 120ms** — adicionar como 5º token (esta RFC propõe
   sim) ou colapsar em `motion-fast`? **Decisão:** sim — hover/chip
   feedback é cognitivamente distinto.
2. **`useOptimisticAction` em hooks/** — promote para `lib/` se mais
   de 3 call sites? Round 5 decision após métrica de uso real.
3. **TX-9 UpdatePrompt** — cabe em Round 4 (POST-priority) ou Round
   5? RFC marca Round 4 NON-POST P5 — **dropar pra Round 5** se
   tempo apertar; isolated, sem dependência de POST work.
4. **Imagem `loading="lazy"` no Feed** — verificar Round 4 se já
   ou bake-in.

---

*Lily · RFC cap respeitada (~1h45 escrita). Round 3 = plan only.
Round 4 = execute top 10 spots POST-priority em ~6-8h.*
*Convergência com Ted §4.1 design system v0.8 (motion tokens) e
Marshall §4.3 enforcement (motion paridade test).*
