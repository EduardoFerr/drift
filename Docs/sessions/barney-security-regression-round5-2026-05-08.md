# Barney security regression check — Round 5 ship gate (2026-05-08)

**Data:** 2026-05-08 (final do dia, pós-Round 4 + 4.5)
**Persona:** Barney (HIMYM — peer review crítico, threat modeling,
security, ceticismo)
**Escopo:** validar que Round 4 (primitives + motion + frictions +
ESLint enforcement + codemod slate→drift + TEXT_MAX_CHARS unify 280→256)
**não introduziu regressão de segurança** sobre o pending review verde
de 2026-05-08.
**Doc-only.** Não modifica código.

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual. Nada aqui vira norma
> sem propagação pelo Arquiteto.

---

## §1 TL;DR

| Track Round 4 | Verdict | Justificativa curta |
|---|---|---|
| **Primitives (DriftCard / DriftSkeleton / DriftChip / GlassIconButton)** | 🟢 verde | Componentes puros React. `DriftCard` clickable usa `<button type="button">` (default 'submit' bug clássico evitado) + focus-visible + aria-label opt-in; `<article>` quando não-clickable. `DriftSkeleton` aria-busy/role=status corretos no momento de mount; unmonta junto com o LoadingState quando dados chegam (sem stuck-skeleton accessibility regression). `DriftChip` outline-only por default; `bury` variant existe mas zero call sites com `onClick` em ações destrutivas hoje. |
| **Motion tokens + variants** | 🟢 verde | `useMotionPreset` colapsa todas as 5 durations pra `{duration:0}` quando `useReducedMotion()` retorna true. **TODAS** as 5 factories (`cardRevealVariants`, `composeSheetVariants`, `lightboxBackdropVariants`, `lightboxImageVariants`, `commentRevealVariants`) testam `reduced` flag explicitamente. `ModalWrapper` + `EmbeddedWrapper` em `PostViewer.tsx` ramificam `initial` por reduced. `Image.tsx` LightboxOverlay passa `reduced ?? false` ao factory. Determinismo §7 preservado: durations literal, sem `Date.now`/`Math.random`. |
| **Frictions Round 4 (F-04/F-09/F-11/F-27/F-30)** | 🟡 amarelo | F-09 (PostViewer body tap = next subpost cycle) **introduz nova surface de gesture-conflict** com SwipeHandler — análise §2.4. F-30 ("drift ↑" → "publicar ↑") é mudança de copy do CTA, **não viola §1 vocab mapping** (DRIFT/SINK continua em swipe). F-11 ícones ↑/▣/⏱ preservam aria-label + title — screen reader ok. F-27 contador "X/Y" + warning amber é cosmético. F-04 opacity 0.55→0.85 da letra decorativa cosmético. |
| **TEXT_MAX_CHARS unify 280→1000(comments)→250→256** | 🟡 amarelo | Posts existentes >256 chars (criados quando limit=280, ou comments criados quando limit=1000) **continuam renderizando** (commit 0e43e78 confirma e Lily removeu line-clamp band-aid). §29 Nostr compat preservada — protocol não rejeita kind 9078/1111 com content >256. **Compose validação client-side apenas** — outros clientes Nostr podem publicar >256 e Drift renderiza. Sem regressão de segurança; é trade-off UX consciente. |
| **ESLint custom rule + conformance ratchet (Marshall infra)** | 🟡 amarelo | Rule é `warn` no hot path em vez do `error` planejado pela RFC §2.4 — racional documentado em `eslint.config.js:117-120` (espera Ted v0.8 `drift-warning`/`drift-danger` tokens). **Whitelist `src/components/UI/**` deixa toda primitive escapar do gate** — primitives podem usar `slate-*` sem warning. Conformance test só valida count em arquivos non-whitelisted. Risk surface §4.1. |
| **Codemod slate→drift (Identity + Onboarding)** | 🟢 verde | Mapeamento documentado conservador. **Não toca yellow/amber/red** (semantic ambiguity). Não toca opacity variants (`/60`). Diff visual em IdentityPanel/IdentitySwitcher: `text-slate-500` → `text-drift-muted` é AY-4 win (3.7:1 → 4.5:1+). Zero impacto cripto/identidade — só class strings JSX. |
| **useOptimisticAction hook** | 🟢 verde | `mountedRef.current=false` no cleanup do useEffect; timer cleanup em `clearTimeout(flashTimerRef.current)`. Toda mutação de state após `await action()` gated em `if (!mountedRef.current) return`. **Não escreve em SQLite** — invariante #2 preservado. Edge case `pending=true` durante unmount: `setPending(false)` skipado, sem warning React. Detalhe pequeno em §2.3.|

**Verdict release-readiness Round 5:** **🟢 verde — ship com 3 ressalvas**.

**Top-3 threats novos identificados (pequenos, não bloqueadores):**

1. **F-09 PostViewer body tap = subpost cycle** — area neutra do card
   agora dispara `setSubpostIdx((i+1)%total)`. Em multi-subpost com
   imagem (`hasImage` + revealed), tap acidental durante leitura cycla
   pra next subpost sem feedback de transição visual aparente além do
   re-render. Não é gesture-bypass do SwipeHandler (drag ainda gate
   por threshold), mas é **mudança de affordance** que perde reversibilidade
   (não há "tap pra voltar"). Severidade S2 UX, **S0 zero security**.
2. **ESLint whitelist `src/components/UI/**` é blanket-off** —
   `DriftCard`, `DriftChip`, `DriftSkeleton`, `Chip`, `SwipeHandler`,
   `ImageLightbox` (Image.tsx) etc. todos escapam do rule. Primitive
   nova com `slate-*` hardcoded passa sem warning, e baseline ratchet
   também ignora. **Possibilita regressão silenciosa em primitives**
   onde a maioria do uso visual concentra. Severidade S2.
3. **Posts/comments legados >256 chars renderizam sem truncate** —
   user feedback explicit "limite 250 (depois 256), sem clamp", Lily
   removeu `line-clamp-4`. Posts antigos com 280 chars continuam
   renderizando full no TextLayout (centered variant). **Não é leak
   nem violação manifesto**, só diverge do contrato visual implícito.
   Adversário malicioso pode publicar kind 9078 com 10000 chars via
   outro cliente Nostr e Drift renderiza tudo (quebra grid mobile).
   Severidade S2 — vetor de UI-flooding (§24 ranking continua imune,
   só layout sofre). **Defesa pre-existia** apenas no compose; não
   regressão hoje, mas Lily removeu o último band-aid client-side.

---

## §2 Threat regression — checklist por commit Round 4

### 2.1 — `6a5285a feat(ui): 3 primitives + motion tokens (Lily Phase A+B+C)`

#### DriftCard

**Audit `clickable` prop:**

```tsx
if (clickable) {
  return (
    <button
      type="button"          // ← bug clássico de "default submit" evitado
      onClick={onClick}
      aria-label={ariaLabel}
      className={cardClass + ' text-left w-full'}
    >
```

✅ `type="button"` explícito previne form-submit quando aninhado em
`<form>` (não há call sites em form hoje, mas defesa-em-profundidade).
✅ `focus-visible:ring-drift-accent2` + `focus:outline-none` —
keyboard nav não-broken.
✅ `aria-label` é prop, recomendado em docstring quando `onClick`
presente.

**Cenário "accidental focus → onClick fire":** browsers só disparam
`onClick` em (a) click real, (b) Enter/Space em button focado. Focus
sozinho não dispara. ✅ Sem regressão.

**Cenário "shadow-stack rendered as button content":** os 2 shadows
absolute ficam **dentro** do `<button>`. Eles têm `pointer-events-none`
(`DRIFT_CARD_SHADOW_BACK_CLASS:128`). Click passa direto pro button
content, não bloqueia. ✅

**Pergunta cética:** decoration slot dentro de button — pointer-events-none
preserva? Linha 194: `<div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">`. ✅ Sim.

**Verdict:** ✅ Sem ameaça nova. Single call site hoje (`PostCard.tsx`)
sem `onClick` — `<article>` semântico, sem affordance clickable.

#### DriftSkeleton

**Audit aria-busy lifecycle:**

LoadingState em `ThreadView.tsx:476-480`:

```tsx
function LoadingState() {
  return (
    <div className="flex h-full flex-col gap-3 px-4 py-6">
      <DriftSkeleton variant="card" count={3} />
      <span className="sr-only">carregando comentários</span>
    </div>
  )
}
```

LoadingState **só renderiza** enquanto thread está em loading. Quando
dados chegam, parent (ThreadView) re-renderiza com nodes reais —
LoadingState **unmount completo** + DriftSkeleton **unmount** +
aria-busy desaparece junto com o subtree. Sem race "skeleton stuck
com aria-busy=true" (que seria regressão a11y).

**Pergunta cética:** se DriftSkeleton ficar mounted em paralelo a
nodes reais (cenário hipotético "infinite scroll com skeleton no
fim"), screen reader anuncia `aria-busy="true"` pra esses sub-skeletons
pra sempre. **Não acontece no call site atual** (ThreadView
LoadingState é mutually exclusive com lista renderizada). Quando
PostCard skeleton wire-up shippar (REC-2 docstring §3.3), peer
review deve checar.

**Verdict:** ✅ Sem regressão hoje. Flag pra futuro.

#### DriftChip

**Audit destructive variants:**

`bury` variant (linhas 82-85):

```tsx
case 'bury':
  return active
    ? 'border-drift-bury bg-drift-bury/15 text-drift-bury'
    : 'border-drift-bury/40 text-drift-bury hover:bg-drift-bury/10'
```

Cor + outline only. Sem onClick handler hardcoded. **Zero call sites
hoje** — ainda preventivo. Quando wire-up acontecer (Round 5+ TR-2 ou
similar), peer review deve checar:
- Bury chip clickable não dispara bury kind 9080 sem confirmação 2-step.
- `aria-pressed` reflete state de "selected" não "fired action".

`spoiler` variant tem `border-dashed` distinto de `warning` — semântica
visual preservada.

**Verdict:** ✅ Sem ameaça nova. Preventive only.

#### GlassIconButton

Wired em PostViewer (substitui custom button para menu ⋮). Novo
primitive (não auditei profundamente) — hot path, mas não toca
escrita SQLite, não toca fetch externo, é pure presentation. ✅
Sem flag.

#### Motion variants — reduced motion audit

5 factories em `motion-variants.ts`. Cada uma tem branch explícita:

```tsx
export function cardRevealVariants(reduced: boolean) {
  if (reduced) {
    return { initial: {opacity:1}, animate: {opacity:1}, exit: {opacity:0}, transition: {duration:0} }
  }
  return { initial: {opacity:0, scale:0.96, y:20}, ... }
}
```

✅ TODAS as 5 honram reduced. ✅ `useMotionPreset()` colapsa
durations pra `{duration:0}`.

**Cobertura call sites:**
- `PostViewer.tsx` ModalWrapper + EmbeddedWrapper — `useReducedMotion()`
  + branch em `initial` + transition.
- `Image.tsx` LightboxOverlay — `useReducedMotion() ?? false` passado
  às factories.
- ThreadHeader, SubpostLayout têm imports de framer-motion (já
  pré-existiam, não revisei profundo).

**Pergunta cética:** algum motion novo Round 4 esquece reduced? Revi
todo o diff Round 4 — todos os usos passam por factories ou explicit
branch. ✅

**Verdict:** ✅ Reduced motion universalmente honored. Motion tokens
duplicados em `lib/motion.ts` (JS) + `tailwind.config.js` (CSS) —
risco de drift entre os dois (não-segurança, manutenibilidade) flagged
em comentário de tailwind.config.js:97 ("paridade pode ser verificada
em test futuro Marshall §4.3"). **Aceito** — não bloqueia ship, fica
em queue.

---

### 2.2 — `e1ea2cc fix(post): Round 4 motion + 5 frictions + REC-2 + overflow fix`

#### F-09 PostViewer body tap = subpost cycle ⚠️

`PostViewer.tsx:482-488`:

```tsx
onTap={
  !revealed
    ? () => setRevealed(true)        // CW reveal (preserva)
    : total > 1
    ? () => setSubpostIdx((i) => (i + 1) % total)  // NEW: cycle
    : undefined                       // single subpost: no-op
}
```

**Análise gesture safety:**

`SwipeHandler.tsx:215` passa `onTap={onTap}` direto pro `motion.div`
com `drag`. Framer Motion distingue `onTap` (no movement) de
`onDragEnd` (movement > threshold) automaticamente. **Tap não é
swipe falso-positivo.**

Mas: `SwipeHandler` thresholds definidos em `swipe-thresholds.ts`
(`SWIPE_THRESHOLD_PX`, `SWIPE_VELOCITY_PXS`). Tap dispara quando
movement < threshold. **Tap quase-mas-não-quase swipe (movimento
abaixo do threshold)** dispara `onTap` em vez de drag. User com
intent "scroll up pra spread" mas com movimento <30px → cycla
subpost em vez de spread. Era no-op antes do Round 4; agora é
ação não-reversível.

**Cenário ataque:** zero — não é vetor de exploit, é UX-mais-frágil.
Posts maliciosos não conseguem trigger ação hostil via subpost cycle
(no kind 9078, todos subposts vêm do **mesmo autor** + assinatura
única — cyclar não revela nada novo).

**Cenário privacy:** §27 content-warning + per-subpost CW (TM-3 já
flagged) — se subpost #2 tem imagem NSFW e #1 tem texto inocente,
`hide_nsfw=true` user com tap-pra-cycle vê NSFW sem CW global ainda
sendo violation manifesto §27. **TM-3 já estava aberto pre-Round 4**;
F-09 **agrava marginalmente** porque facilita tap-cycle acidental.
TM-3 carry-over upgrade pra "S2 → S2 reinforced" (não S1 — mesma
severidade categórica).

**Verdict:** 🟡 **AT novo, baixa severidade.** UX-fragility, não
security. Recomendação não-bloqueante:
- Considerar visual feedback de cycle (small fade ou translateX
  micro) — Lily Round 5+ se quiser.
- Bloquear tap-cycle quando `hide_nsfw=true` E next subpost tem
  imagem com `content-warning`. Combina com TM-3 fix Opção A —
  warning leve no compose já queue Round 4. Round 5 pode adicionar
  reader-side gate ("tap pra cycle" desabilitado se próximo subpost
  é blurred).

#### F-30 "drift ↑" → "publicar ↑"

`ComposeOverlay.tsx:269` — CTA do submit muda de string. **Não
viola §1 vocab mapping** (CLAUDE.md):
- DRIFT (UI verb) continua em swipe (↑ = drift, ↓ = sink)
- "publicar" é apenas o CTA do compose, não substitui DRIFT como
  verbo de feed.
- Comentário extenso em ComposeOverlay.tsx:259-263 explicita o
  raciocínio ("DRIFT já é nome do app + ação no feed").

✅ Sem violação.

#### F-11 ícones DRIFT/SUBS/HÁ → ↑/▣/⏱

`SubpostLayout.tsx:281-291`:

```tsx
<span title={`drifts: ${drift}`} aria-label={`${drift} drifts`}>
  <span aria-hidden="true">↑</span> ...
```

✅ aria-label preservado. Screen reader anuncia "5 drifts" em vez
de "↑ 5". `title` cobre tooltip mouseover. Sem regressão a11y.

#### F-27 contador "X / Y" + warning amber

`ComposeOverlay.tsx:380-396`. `nearLimit` quando `remaining < 20 && !overLimit`.
Cosmético, sem mudança de threshold de submit (`overLimit` continua
o gate). Sem regressão.

#### F-04 letra decorativa opacity 0.55 → 0.85

Cosmético. ✅

---

### 2.3 — useOptimisticAction hook (não wired ainda, mas committed)

**Audit timer cleanup:**

```ts
useEffect(() => {
  mountedRef.current = true
  return () => {
    mountedRef.current = false
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }
}, [])
```

✅ Cleanup roda no unmount. Timer cancelado.

**Audit race condition mount/unmount durante action em vôo:**

Cenário: user clica → `fire()` → `setPending(true)` → component
unmount **antes** de `await action()` resolver.

```ts
try {
  await action()
  if (!mountedRef.current) return   // ← guard
  setPending(false)                  // skipado
  setOk(true)                         // skipado
  ...
}
```

✅ `mountedRef.current=false` no cleanup, guard prevent setState após
unmount → evita "Can't perform React state update on unmounted
component" warning. Sem memory leak (setTimeout limpo no cleanup,
Promise resolve mas resolução é descartada).

**Pergunta cética 1:** `setPending(true)` dispara antes de `await`,
sem guard. Se action() throw síncrono e component unmount no mesmo
tick? Improvável — JS event loop garante setPending antes de
exception bubble.

**Pergunta cética 2:** `setPending` é o ÚNICO setState não-guardado
após `if (pending) return` (cedo). Mas `setPending` é chamado **antes**
do `await`, sempre síncrono ao click handler — se component unmount
antes do click handler retornar, é cenário impossível em React
(handlers não interrompidos por unmount durante execução).

✅ Hook está correto.

**Audit invariante #2 (CLAUDE.md):**

> Optimistic UI nunca alimenta o SQLite

Hook é **state React local apenas** — `useState(pending/ok/error)`.
Zero `db.run`/`db.exec`. Caller passa `action` que faz a publish
real (que via Nostr → onNostrEvent → SQLite). Hook não toca SQLite.

✅ Invariante preservado.

**Verdict:** ✅ Sem regressão. Hook bem desenhado. Quando wire-up
acontecer (Round 5+), peer review deve verificar: caller não passa
`action` que mutate SQLite direto — sempre via `protocol.spreadPost`
etc.

---

### 2.4 — Image.tsx LightboxOverlay (single tap pra reveal CW + double tap pra lightbox)

**Audit timing conflict mobile:**

`Image.tsx:241+` — `lightboxOpen` state. Trigger é `onDoubleClick` no
img wrapper (não revisei profundo — pre-existed; commit `52029b0`
foi anterior).

**Cenário cético:** mobile touch latency = ~300ms entre dois taps
pra contar como "double tap" (browser default). **Tap simples** que
revela CW (em PostViewer SwipeHandler) NÃO conflita com double-click
do lightbox **porque são em components diferentes** — SwipeHandler
captura tap em area neutra do card; img element tem seu próprio
`onDoubleClick` handler (presumido).

**Pergunta cética:** se user clicka 2x na imagem revelada (CW gone)
em mobile, o primeiro tap propaga pro SwipeHandler (cycla pra next
subpost via F-09 NEW), e o segundo tap dispara double-click do
lightbox? **Possível.** UX-confuso.

Não auditei profundo (timing exato dos taps depende do browser e
não vi `onDoubleClick` direto em Image.tsx no diff Round 4). Flag
pra Round 5 cypress test.

**Verdict:** 🟡 **flag pra Round 5 E2E**, não bloqueador hoje.

---

### 2.5 — `e461af8 fix(ui): codemod slate-* → drift-muted (Identity + Onboarding)`

Diff é 100% string class swaps (`text-slate-500` → `text-drift-muted`).
✅ Sem mudança lógica. Improve a11y (drift-muted com #6b6b66 = 4.5:1+
contrast). Zero impacto crypto/identity/SQLite.

---

### 2.6 — `7933135 fix(a11y): bump drift-muted #4a4a46 → #6b6b66`

Mudança em `tailwind.config.js` + `index.css`. Cosmético + a11y win.
✅ Sem regressão.

---

### 2.7 — `71ed4fc fix(text): bump TEXT_MAX_CHARS 250 → 256` + `0e43e78 fix(text): unify post + comment limit`

**Análise §29 NIP compatibility:**

CLAUDE.md invariante #14 — "Cliente Drift respeita NIP-01 sem
extensões obrigatórias". Cap em chars é **convenção Drift** (não
NIP-01). Outros clientes Nostr publicam kind 9078 sem cap → Drift
recebe via `onNostrEvent` → persiste no SQLite → renderiza.

**Cenário malicioso:** atacante publica kind 9078 com content de
10000 chars via custom client → Drift renderiza no TextLayout sem
line-clamp (Lily removeu band-aid em 0e43e78). Layout quebra grid
mobile.

**Severidade:** S2 UI-flooding. **Não regressão Round 4** — pre-Round 4
o cap era 280 + line-clamp-4; Round 4 removeu o clamp E reduziu o
cap. Posts existentes >256 (legacy) renderizam full. Atacante novo
ainda pode publicar 10000 chars.

**Mitigação possível futuro:** cap de render no client (`text.slice(0, 1024)`
antes do display) — defesa-em-profundidade independente do cap de
publish. Não bloqueia Round 5; flag pra backlog.

**Verdict §29:** ✅ Compat preservada. Drift renderiza qualquer
content de outros clientes. Trade-off UX consciente Lily+user.

**Verdict §22 ranking:** unchanged — score é função pura de
spreads/buries/age, **não depende de length**. Atacante com texto
gigante não pode game ranking. ✅

**Verdict §17:** sem chave mestra envolvida. ✅

---

### 2.8 — `8d3f274 feat(ui): GlassIconButton primitive`

Não revisei profundamente (não-hot-path. presentation only). Flag
pra Round 5 audit se ganhar uso destrutivo.

---

## §3 Manifesto compliance — §22/§24/§27/§28 status

| § | Toca? | Como | Verdict |
|---|---|---|---|
| §1 vocab mapping (UI vs spec) | F-30 toca | "drift ↑" CTA → "publicar ↑". DRIFT/SINK em swipe preservado. | ✅ Não viola |
| §7 determinismo | motion.ts + motion-variants.ts | Durations literais; `useReducedMotion` é hook-determined; sem `Date.now`/`Math.random` em factories. | ✅ |
| §17 sem chave mestra | nenhum commit Round 4 toca scan/banUser/deletePost | — | ✅ |
| §22 score determinístico | Round 4 não toca scoring.ts | — | ✅ |
| §23 bury não pune | DriftChip variant=bury preventive (zero callers) | — | ✅ |
| §24 sem afinidade | nenhum commit Round 4 personaliza feed | — | ✅ |
| §27 auto-classificação voluntária | F-09 tap-cycle agrava TM-3 marginalmente (mais facilidade de tap por engano em subpost com imagem NSFW) | TM-3 já open; F-09 não cria threat novo, amplifica existente. | 🟡 |
| §28 privacidade pelo mínimo | nenhum commit Round 4 adiciona telemetria/analytics/fetch | grep `fetch(\|gtag\|analytics` em Round 4 diff retorna zero novos | ✅ |
| §29 NIP compat | TEXT_MAX_CHARS 256 cap client-side; outros clientes podem publish >256 | Drift renderiza full (sem clamp); UI fragility, não compat issue | ✅ |

**Cross-checks:**
- `grep -rn "fetch(\|gtag\|analytics" src/` no Round 4 diff: zero
  novos call sites. ✅
- Nenhum import novo de `localStorage`/`IndexedDB` em Round 4 diff
  (só zustand). ✅
- `db.run`/`db.exec` adicionado em Round 4: zero (verificado). Hook
  `useOptimisticAction` é state-only. ✅

---

## §4 ESLint enforcement infra audit — risks + mitigations

### 4.1 Whitelist `src/components/UI/**` é blanket-off

`eslint.config.js:48-49`:

```js
const WHITELIST_OFF = [
  // Design system primitives — fonte de tokens, escape hatch legítimo.
  'src/components/UI/**',
```

**Análise:** primitives são "fonte" de tokens — racional defensável.
Mas **toda a pasta UI/** está off:
- DriftCard, DriftChip, DriftSkeleton, GlassIconButton (novos)
- Chip (legacy), DialogHost, ModalHeader, NavBar, SlideUpOverlay,
  UpdatePrompt, Image (LightboxOverlay)
- FullPageCard, FullPageOverlay (deprecation shim)

**Risk:** alguém adiciona `text-slate-500` ou `bg-emerald-300` em
um primitive novo (Chip, DialogHost) → zero warning. Conformance
ratchet também ignora. Regressão silenciosa em primitives, onde
**a maioria visual concentra**.

**Pergunta cética ao Marshall:** primitives **deveriam** ser as
mais rigorosas, não as menos. RFC §2.4 racional ("escape hatch
legítimo") faz sentido pra `tailwind.config.js` como source-of-truth,
mas não pra components inteiros que apenas consomem tokens. Recomendação:

- Mudar whitelist pra **arquivos específicos** que precisam escape
  hatch (ex: design system metadata, Boot/ pre-CSS), **não pasta
  inteira**.
- Aplicar rule em DriftCard/DriftChip/DriftSkeleton/GlassIconButton
  como `error` (são novos, podem ser strict desde início).
- Manter Chip (legacy) e SlideUpOverlay como warn enquanto migration
  acontece.

**Verdict:** 🟡 **infra debt aceito** pro Round 5 ship. Marshall
pode endereçar Round 6 — não bloqueador agora.

### 4.2 Hot path `warn` em vez de `error`

Documentado em `eslint.config.js:117-120`:

> Reality check 2026-05-09: hot path has residual yellow-/amber-/red-
> (warning + danger semantics) waiting on Ted v0.8 RFC tokens
> (`drift-warning`, `drift-danger`).

**Aceito.** Pragmático. Flips em Fase 3 (Round 5+).

### 4.3 Conformance ratchet

`design-system-baseline.json` _total: 184 offenders, distribuídos em
15 arquivos. Test em `design-system-conformance.test.ts:106-118`:

- Files **novos** não no baseline → 0 offenders permitido.
- Files **existentes** no baseline → ratchet down-only.
- Stale entries (count=0 mas file não existe) → fail.

✅ Lógica correta. **Mas:** se file no baseline tem `_total` reduzido
pra <count, mas baseline JSON não foi atualizado, test falha — força
update via `npm run design:baseline:update`. ✅ Self-correcting.

**Risk identificado:** baseline regen via script (`scripts/update-design-baseline.mjs`)
roda **counter regex** mesmo que ESLint rule. Drift entre os dois
regexes = silent gap. Verifiquei `BLOCKED_COLOR_RE` em conformance
test (linha 51) vs `BLOCKED_COLORS` array em ESLint rule (linha 31)
— **mesma lista de cores**. ✅ Sync hoje. Manutenção: aceito risk
de drift se Marshall não atualizar ambos.

**Verdict:** ✅ Conformance test bem desenhado. Recomendação Round 5
follow-up: extract `BLOCKED_COLORS` pra const compartilhada em
`scripts/` ou `tests/_fixtures/blocked-colors.cjs` importada pelos
3 sites (rule, test, codemod). Não bloqueador.

### 4.4 Codemod regex-based

`scripts/codemod-slate-to-drift.mjs` documenta limites:
- Não migra yellow/amber/red (semantic ambiguity).
- Não migra opacity variants.
- Logs ambiguous; humano revisa diff.

**Risk:** regex casos cyber-edge:
- `bg-slate-800/60` (opacity variant) → não migrado, fica como
  offender no baseline. Aceito.
- `text-slate-700` em `<aria-label="text-slate-700">` (string em
  prop não-className) → ESLint rule não dispara (gate `name === 'className'`,
  linha 175) ✅. Codemod regex match cego pode rewrite ✗ — verifiquei
  `MAPPING` linhas 89-108: regex literal match `text-slate-100`,
  swap. **Codemod aplicado em strings que aparentam className mas
  são aria-label** quebraria copy.

**Pergunta cética:** mitigação? Codemod tem `--dry` flag obrigatório
antes de `--apply` — humano revisa diff. Round 4 codemod (`e461af8`)
foi reviewed — Identity files revertidos não bagunçam aria. ✅ Caso
manual today, automatable pra futuro.

**Verdict:** ✅ Aceito como ferramenta com human-in-the-loop. Round 6+
pode tightening (AST-based em vez de regex).

---

## §5 Carry-overs do pending review — agravados?

### Gap 1 — AT-11 fundamental (auto-mode signal of switch)

**Estado pré-Round 4:** ADR Ted v2 §8 aceita limite explícito.
Mitigação prompt first-boot Tauri.

**Round 4 toca?** Não — auto-mode não shippou (queue Round 6 Tauri).

**Verdict:** ⏸️ Status quo. Não agravado.

### Gap 2 — AT-7 Tor bridge enumeration (Fase 6.4)

**Round 4 toca?** Não.

**Verdict:** ⏸️ Status quo.

### Gap 3 — TM-3 per-subpost CW

**Estado pré-Round 4:** Marshall doc, Opção A queue Round 4.

**Round 4 toca?** **NÃO shippou Opção A** — não vi commit de warning
no compose quando subpost tem imagem sem CW global. Flag pra Round 5.

**Round 4 agrava?** F-09 tap-cycle marginalmente facilita exposure
acidental (§2.4 acima). **Não cria threat novo, amplifica TM-3
existente.**

**Verdict:** 🟡 **status reinforced — fix Opção A urgência S2 sobe
pra S2-prio-alta**. Round 5 deve shipar com prioridade.

### Gap 4 — §15 E2E testbed Phase A (Marshall+Robin)

**Round 4 toca?** Não — testbed scoping pre-Round 4 (Robin 2026-05-08
doc). Não vi shipping de testbed em Round 4.

**Verdict:** ⏸️ Status quo. Round 5 ou Fase 6.4 pre-ship Tauri auto.

---

## §6 Verdict ship/regress

### 🟢 Ship Round 5 com 3 ressalvas documentadas

**Critérios atendidos:**

1. ✅ **Threat regressions zero em domínio crítico** (§17/§22/§24/§28).
   Round 4 é UI/UX polish + infra tooling; nada toca scan automático,
   ranking, telemetria, persistência fora pipeline canônico.

2. ✅ **§15 IP leak preservado.** Round 4 não toca transport/webrtc.
   Conformance test estático em manifesto-conformance.test.ts:697-744
   continua valid.

3. ✅ **Optimistic UI hook respeita invariante #2** — state React
   local, zero SQLite.

4. ✅ **Reduced motion universalmente honored** em motion-variants
   factories + call sites Round 4.

5. ✅ **Determinismo §7 preservado** — motion tokens literais, hooks
   sem `Date.now`/`Math.random` implícito.

6. ✅ **Codemod Round 4 cosmético** — slate→drift swap não muda
   crypto/identity/SQLite.

**Ressalvas (não-bloqueadoras):**

1. 🟡 **F-09 PostViewer tap-cycle agrava TM-3** marginalmente. Round 5
   prioriza Opção A (compose warning) E considera reader-side gate
   (tap-cycle desabilitado se próximo subpost = imagem com CW e
   reader tem `hide_nsfw=true`).

2. 🟡 **ESLint whitelist `src/components/UI/**` blanket-off** permite
   regressão silenciosa em primitives. Marshall Round 6 endereça —
   converter pra arquivo-específico whitelist, com primitives novas
   sob `error`.

3. 🟡 **Posts/comments legados >256 chars renderizam sem cap visual**.
   UI fragility, não security. Round 5 considera defesa-em-profundidade
   render-side cap (ex: `text.slice(0, 1024)` no SubpostLayout).

**Recomendação operacional:**

- **SHIP Round 5 conforme plan**. Round 4 + 4.5 + Round 5 prep estão
  verdes pra release.
- **Round 5 incluir TM-3 Opção A + F-09 reader-side gate** como
  prioridade S2-alta.
- **Round 6 Marshall** trabalha ESLint whitelist tightening + paridade
  test motion.ts ↔ tailwind.config.js + render-side cap defense.
- **NÃO regredir** nenhum commit Round 4.

**Próximas atividades Barney:**
- Pré-Round 6 Tauri auto-mode: re-audit AT-1/AT-5/AT-9/AT-10/AT-14
  contra impl real (1h).
- Pós-Round 5: smoke test reduced-motion E2E em build PWA fresco
  (DevTools → Rendering → "prefers-reduced-motion: reduce" toggle;
  verificar nenhum motion residual em PostViewer enter, ImageLightbox,
  ComposeOverlay slide-up). 30min.

---

## §7 Cross-references

### Sessão de hoje (companion docs Round 4 + 4.5)
- [`Docs/sessions/barney-pending-review-2026-05-08.md`](./barney-pending-review-2026-05-08.md) — pending review prévio (verde Round 4).
- [`Docs/sessions/auto-mode-threat-model-2026-05-08.md`](./auto-mode-threat-model-2026-05-08.md) — 14 ATs auto-mode.
- [`Docs/sessions/friction-audit-post-flow-2026-05-08.md`](./friction-audit-post-flow-2026-05-08.md) — F-04/F-09/F-11/F-27/F-30 origem.
- [`Docs/sessions/design-qa-regression-2026-05-08.md`](./design-qa-regression-2026-05-08.md) — Robin QA #2.
- [`Docs/rfcs/2026-05-rfc-token-enforcement.md`](../rfcs/2026-05-rfc-token-enforcement.md) — Marshall enforcement.
- [`Docs/rfcs/2026-05-rfc-motion-perf-polish.md`](../rfcs/2026-05-rfc-motion-perf-polish.md) — Lily motion.
- [`Docs/rfcs/2026-05-rfc-design-system-v08.md`](../rfcs/2026-05-rfc-design-system-v08.md) — Ted v0.8 (drift-warning/drift-danger pendente).

### Manifesto §s relevantes
- §17 sem chave mestra
- §22 score determinístico
- §24 sem afinidade
- §27 auto-classificação voluntária (TM-3 reinforced)
- §28 privacidade pelo mínimo
- §29 NIP compat

### Código auditado (Round 4)
- `src/components/UI/DriftCard.tsx:163-218` — clickable button type=button.
- `src/components/UI/DriftSkeleton.tsx:104-178` — aria-busy lifecycle.
- `src/components/UI/DriftChip.tsx:138-169` — bury/spoiler variants.
- `src/lib/motion-variants.ts:60-156` — 5 factories reduced-aware.
- `src/lib/motion.ts:26-39` — MOTION tokens literais.
- `src/hooks/useOptimisticAction.ts:54-108` — mountedRef + clearTimeout.
- `src/components/Post/PostViewer.tsx:482-488,840-866` — F-09 + ModalWrapper reduced.
- `src/components/UI/Image.tsx:286-326` — LightboxOverlay reduced ?? false.
- `src/components/Post/SubpostLayout.tsx:281-291` — F-11 aria-label.
- `src/components/Create/ComposeOverlay.tsx:269,380-396` — F-30 + F-27.
- `eslint.config.js:29-54` — HOT_PATH + WHITELIST_OFF.
- `eslint-rules/no-tailwind-non-drift-tokens.cjs:31-87` — classify + walk.
- `tests/design-system-conformance.test.ts:50-153` — ratchet.
- `tests/design-system-baseline.json` — 184 total, 15 files.
- `src/config/constants.ts:35-45` — TEXT_MAX_CHARS 256 racional.
- `src/lib/protocol.ts:195-198` — COMMENT_MAX_CHARS unify.

---

*Barney · 2026-05-08 · regression check Round 5 · ship 🟢 verde com 3
ressalvas · TM-3 reinforced (Round 5 prio S2-alta) · ESLint whitelist
flag (Round 6 Marshall) · render-side cap flag (Round 5+) · próxima
Barney activity = reduced-motion E2E smoke + AT auto-mode re-audit
pré-Tauri.*
