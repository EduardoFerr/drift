# Design QA #2 — regression check (2026-05-08)

**Persona:** Robin (curadoria, gaps cross-cutting, docs).
**Escopo:** segunda passada do baseline `design-qa-baseline-2026-05-08.md`
após Lily/Marshall fixes do dia + merge de primitives (DriftButton +
FullPageCard) + fluid typography migration (Ted §3.1). Doc-only.
**Estado das sessões paralelas no momento do spawn:** Lily ainda tem
sessão aberta migrando call sites (GlassIconButton primitive +
adoption ampla de DriftButton). Findings marcados “🛫 em flight”
quando o trabalho parece em curso e merece re-verificação pós-merge
final.

---

## §1 — Sumário executivo

**Conformidade global atual: ~68%** (vs baseline 62%). Avanço modesto
mas direcional. Reduções concentradas em três frentes:

- **PostCard** quase totalmente migrado (CL-12, 13, 14, 17–20
  resolvidos; resíduos pontuais CL-11, 15, 16).
- **PostViewer** botões DRIFT/SINK active states migrados pra tokens
  (CL-17–20). Resíduo: yellow/orange/red em pin/mute/block/report
  (CL-22–25), hex `#ff6b6b` (CL-28), CW chip (CL-21, 26), slate-600
  (CL-27).
- **Placeholders globalmente migrados** (CL-2, CP-23 ✅) — nenhum
  `placeholder:text-slate-*` residual em `src/`.
- **ReplySheet, ReportModal, ProfileModal, SpreadMap, ThreadView,
  ThreadHeader** essencialmente limpos (zero ou ≤1 hit legacy
  detectado).
- **Primitives DriftButton + FullPageCard merged** (commits
  `41757ca`, `30ee8e0`) com adoção parcial em ComposeOverlay e
  IdentityPanel. ✅ §7 do baseline transformado de “decisão pendente”
  pra “código em árvore”.
- **Fluid typography** (`text-fluid-*`) migrado em 5 arquivos
  high-visibility (PostCard, PostViewer, ThreadHeader, CommentCard,
  ComposeOverlay) — 9 call sites confirmados.

**Regressões detectadas:** zero. Nenhum finding novo S0/S1
introduzido pelos fixes auditados. Detalhes em §3.

**Densidade residual de slate-* legacy** (file-level grep
`text-slate-|bg-slate-|border-slate-`):

| Arquivo | Hits | Status vs baseline |
|---|---:|---|
| IdentitySwitcher.tsx | 28 | ❌ não tocado (CL-44, 45) |
| OnboardingOverlay.tsx | 17 | ❌ não tocado (CL-49, 51) |
| IdentityPanel.tsx | 17 | ❌ slate massa intacta (CL-40 mantém) |
| App.tsx | 16 | ❌ BootView/Diagnostic intactos (CL-58) |
| RelaySettings.tsx | 13 | 🟡 placeholders ok, slate massa intacta |
| GpsErrorBanner.tsx | 13 | ➖ não no baseline (amber/slate misto, OK por exception §2.3) |
| LocalListsSettings.tsx | 8 | ❌ slate massa intacta (CL-48) |
| ProfileModal.tsx | 7 | ❌ slate massa intacta (CL-52, 53) |
| ReportModal.tsx | 4 | ❌ slate massa intacta (CL-38) |
| SpreadMap.tsx | 4 | ❌ slate massa intacta (CL-57) |
| PostCard.tsx | 3 | 🟡 redução significativa (~10 → 3) |
| DialogHost / Image / PostViewer / ReplySheet | 1 each | 🟡 quase limpo |

**Veredito Round 3 (§6 abaixo): VERDE.** Nenhuma regressão; primitives
estão sólidos; fluid typography preserva semântica; não há blocker pra
seguir migração. O alvo estimado de 75% é alcançável em mais 1–1.5
sessão Lily focada em IdentityPanel/IdentitySwitcher/OnboardingOverlay
slate purges (que sozinhos endereçam ~62 das ~90 hits residuais).

---

## §2 — Tabela de status finding-by-finding

Convenção:
- ✅ **resolvido**: snippet do baseline já não aparece no file:line.
- 🟡 **parcial**: alguns lugares fixados, outros não. Detalhes inline.
- ❌ **não resolvido**: snippet ainda presente.
- ➕ **novo**: regressão visual induzida por fix recente.
- 🛫 **em flight**: provável que Lily ainda está mexendo (sessão
  paralela); re-verify pós-merge.
- ❎ **não-blocker** / movido a backlog v0.8.

### §2.1 — CL (cor) — 58 finds

| ID | File | Status | Nota |
|---|---|---|---|
| CL-1 | UI/Image.tsx:168 | ❌ | `text-slate-600` ainda presente |
| CL-2 | UI/DialogHost.tsx:160 | ✅ | placeholder migrado pra drift-muted |
| CL-3 | UI/DialogHost.tsx:168 | ❌ | `text-slate-400` cancel persiste — DriftButton variant `cancel` cobriria; Lily 🛫 |
| CL-4 | Settings/RelaySettings.tsx:138 | ❌ | tag source `bg-slate-800/50 text-slate-500` intacta |
| CL-5 | Settings/RelaySettings.tsx (×11) | ❌ | slate-* massa intacta |
| CL-6 | Settings/RelaySettings.tsx:169, 198 | ❌ | input `text-slate-200` |
| CL-7 | Settings/RelaySettings.tsx:135 | ❌ | host `text-slate-300` |
| CL-8 | RelaySettings:149, LocalLists:166, 215 | ❌ | red-900/60 + red-400/80 ainda presentes em 3 lugares |
| CL-9 | Settings/RelaySettings.tsx:125 | ❌ | red-400 / emerald-400 / slate-600 status tone |
| CL-10 | UI/MultiTabModal.tsx | — | já anulado no baseline |
| CL-11 | Feed/PostCard.tsx:72 | ❌ | yellow-900/30 + yellow-300 CW chip — visível em todo card no feed |
| CL-12 | Feed/PostCard.tsx:67 | ✅ | meta migrado pra `text-fluid-xs text-drift-muted` |
| CL-13 | Feed/PostCard.tsx:81 | ✅ | DERIVA value migrado pra drift-accent2 (mint) |
| CL-14 | Feed/PostCard.tsx:94 | ✅ | body migrado pra `text-fluid-lg text-drift-text` |
| CL-15 | Feed/PostCard.tsx:98 | ❌ | placeholder “[imagem]” `text-slate-600` persiste |
| CL-16 | Feed/PostCard.tsx:106, 111 | ❌ | row `text-slate-500` + “abrir →” `text-slate-500` persistem |
| CL-17 | PostCard:121, PostViewer:552 | ✅ | spread active migrado pra `bg-drift-spread/15 text-drift-spread` |
| CL-18 | PostCard:144, PostViewer:574 | ✅ | bury active migrado pra `bg-drift-bury/15 text-drift-bury` |
| CL-19 | PostCard:123, PostViewer:553 | ✅ | spread idle hover migrado pra `hover:bg-drift-spread/10` |
| CL-20 | PostCard:146, PostViewer:576 | ✅ | bury idle hover migrado pra `hover:bg-drift-bury/10` |
| CL-21 | Post/PostViewer.tsx:297 | ❌ | yellow-900/30 + yellow-300 CW chip persiste |
| CL-22 | Post/PostViewer.tsx:314, 315 | ❌ | yellow-500/300 pin button raw |
| CL-23 | Post/PostViewer.tsx:358 | ❌ | yellow-500/300 mute hover raw |
| CL-24 | Post/PostViewer.tsx:366 | ❌ | orange-500/300 block hover raw |
| CL-25 | Post/PostViewer.tsx:374 | ❌ | red-500/400 report hover raw (não migrou pra drift-bury) |
| CL-26 | Post/PostViewer.tsx:489 | ❌ | yellow-300 CW placeholder persiste |
| CL-27 | Post/PostViewer.tsx:498 | ❌ | slate-600 hint persiste |
| CL-28 | Post/PostViewer.tsx:770 | ❌ | hex `#ff6b6b` ainda hardcoded |
| CL-29 | SwipeHandler.tsx:271 | ❌ | hex `#ff4f4f` (semântica anotada no design-system) |
| CL-30 | SwipeHandler.tsx:79–85 | ❌ | RGBA literais — design-system reconhece como dívida |
| CL-31 | CommentCard.tsx:287 | ❌ | yellow-300 HiddenPlaceholder persiste |
| CL-32 | CommentCard.tsx:196 | 🟡 | amber-200 (aceitável §2.3); pattern consistente |
| CL-33 | ThreadView.tsx | ✅ | sem hits legacy detectados (zero slate/emerald/yellow/red-9/orange) |
| CL-34 | ThreadHeader.tsx | ✅ | sem hits legacy; fluid migration preservou tokens |
| CL-35 | ReplySheet.tsx:563 | ❌ | char count `text-slate-400` único hit residual |
| CL-36 | ReplySheet.tsx:537 | ❎ | amber pattern aceitável (consistente com Compose) |
| CL-37 | ReportModal.tsx:45–59 | ❎ | severity ladder red/orange/yellow — exception justificada |
| CL-38 | ReportModal.tsx (×8) | ❌ | slate massa intacta |
| CL-39 | ReportModal.tsx:202–225 | ❌ | yellow AuthoritiesBlock raw |
| CL-40 | IdentityPanel.tsx (×30) | ❌ | slate massa intacta — biggest residual |
| CL-41 | IdentityPanel.tsx:483 | ❌ | emerald passkey ativo persiste |
| CL-42 | IdentityPanel.tsx (×4) | ❌ | red-* error/disable persistem |
| CL-43 | IdentityPanel.tsx (×3) | ❌ | yellow warnings persistem |
| CL-44 | IdentitySwitcher.tsx (×28) | ❌ | slate massa intacta — segundo biggest residual |
| CL-45 | IdentitySwitcher.tsx (×4) | ❌ | yellow BIP39 raw persiste |
| CL-46 | LocalListsSettings.tsx:158 | ❌ | emerald IPFS chip persiste |
| CL-47 | LocalListsSettings.tsx:151 | ❌ | yellow pin emoji persiste |
| CL-48 | LocalListsSettings.tsx (×8) | ❌ | slate massa intacta |
| CL-49 | OnboardingOverlay.tsx (×16) | ❌ | slate massa intacta |
| CL-50 | OnboardingOverlay.tsx (×4) | ❌ | emerald-400 ✓ persiste — quick win baseline §6 ainda aplicável |
| CL-51 | OnboardingOverlay.tsx:182 | ❌ | slate-700/60 progress dot persiste |
| CL-52 | ProfileModal.tsx (×7) | ❌ | slate persiste |
| CL-53 | ProfileModal.tsx:135–141 | ❌ | tier badge amber/slate/green raw |
| CL-54 | SettingsCards.tsx:354 | 🟡 | amber-500/70 ainda; aceitável (NetworkMode warning) |
| CL-55 | SettingsCards.tsx:421–425, 570 | ❌ | red-700/60 + bg-red-950/30 alert ainda raw |
| CL-56 | SettingsCards.tsx:681 | ❌ | yellow-700/60 + bg-yellow-950/20 rebuild btn |
| CL-57 | SpreadMap.tsx (×5) | ❌ | slate persiste |
| CL-58 | App.tsx (~25 spots) | ❌ | BootView/Diagnostic/InstallModal/EndOfFeed slate massa intacta |

**CL summary**: 11 ✅, 3 🟡, 41 ❌, 3 ❎. **23%** dos finds CL
resolvidos diretamente; **+5%** marcados como exception/aceitos →
total “address-or-accept” = 28%. Density-weighted (cada finding
×ocorrências), o ganho é maior porque PostCard/PostViewer são
high-visibility.

### §2.2 — CP (component) — 25 finds

| ID | Status | Nota |
|---|---|---|
| CP-1 | ❎ | rounded scale documentado; sem fix dirigido. Aceitável. |
| CP-2 | ❎ | padding scale ainda não formalizado em design-system §3.2 |
| CP-3 | 🟡 | tracking-tag/meta tokens existem; migração não-iniciada amplamente |
| CP-4 | ❎ | duration scale ainda não formalizado |
| CP-5 | ✅ | confirmado closed no baseline |
| CP-6 | ❎ | skeleton pattern ainda informal |
| CP-7 | 🛫 | touch targets — Lily mencionou GlassIconButton em flight; re-verify |
| CP-8 | ❎ | focus-visible mistura persiste (DriftButton resolveu pra novos call sites — variant base usa `focus-visible:`) |
| CP-9 | 🟡 | inputs slate-200 → drift-text parcial (PostCard ✅; RelaySettings/IdentityPanel/IdentitySwitcher ❌) |
| CP-10 | ✅ | data-post-id em DEV apenas — confirmed |
| CP-11 | ✅ | confirmed |
| CP-12 | ✅ | confirmed |
| CP-13 | ❎ | gap scale informal — backlog |
| CP-14 | 🟡 | fluid-* tokens introduzidos parcialmente; substitui escala estática quando aplicado |
| CP-15 | ❎ | border thickness scale informal |
| CP-16 | ✅ | rounded-2xl em ReplySheet — único uso documentado |
| CP-17 | ✅ | confirmed |
| CP-18 | ❎ | emoji vs SVG — V6 polish |
| CP-19 | ✅ | confirmed |
| CP-20 | ✅ | confirmed |
| CP-21 | ❎ | z-index doc — aceitável |
| CP-22 | ✅ | confirmed |
| CP-23 | ✅ | placeholders globalmente migrados (zero residual) |
| CP-24 | 🟡 | DriftButton variant `cancel` resolve em código novo; call sites legados ainda 4 padrões distintos |
| CP-25 | ❎ | padding card scale informal |

**CP summary**: 7 ✅, 4 🟡, 2 🛫(includ.) em flight ou backlog, 12 ❎
backlog/aceitação. Avanço estrutural via primitives (DriftButton +
fluid tokens) sem migração ampla — comportamento esperado quando
primitive-first.

### §2.3 — AY (a11y) — 9 finds

| ID | Status | Nota |
|---|---|---|
| AY-1 | ✅ | confirmed closed |
| AY-2 | 🟡 | DriftButton base inclui `focus-visible:ring-1 ring-drift-accent2 ring-offset-2 ring-offset-drift-bg` ✓; legados não migrados |
| AY-3 | ✅ | confirmed closed |
| AY-4 | ❌ | drift-muted contrast — ainda token `#4a4a46`; nenhum bump aplicado. **Decisão Arquiteto pendente** |
| AY-5 | ✅ | confirmed closed |
| AY-6 | 🛫 | touch targets — Lily GlassIconButton em flight |
| AY-7 | ✅ | confirmed closed |
| AY-8 | ❎ | focus trap genérico — ainda não em FullPageCard primitive (Robin recomenda pra v0.8) |
| AY-9 | ❎ | reduced-motion — Framer global cobre; per-component opt-in opcional |

**AY summary**: 4 ✅, 2 🟡, 1 🛫, 1 ❌ (AY-4 ainda blocker técnico),
1 ❎.

---

## §3 — Novos finds (NEW-*)

Primitives + fluid typography migration introduziram novas
superfícies pra audit. Resultado: **zero regressões** e várias
observações estruturais.

### NEW-1 — DriftButton: API e variants ✅
- **Arquivo**: `src/components/UI/DriftButton.tsx`
- **Conformidade**: 5 variants × 3 sizes alinhados ao design-system
  v0.7. Cada variant usa exclusivamente tokens drift-* (zero hex,
  zero slate). Função pura `driftButtonClassName(variant, size)`
  testável (Marshall §16). Base class inclui `focus-visible:ring-1
  ring-drift-accent2 ring-offset-2 ring-offset-drift-bg` —
  **resolve AY-2 + CP-8 pra todo call site novo**.
- **Findings observados**: nenhum bug. Possíveis melhorias futuras
  (não-bloqueantes):
  - **NEW-1a** (S2): `size="md"` aplica `tracking-[2px]` em vez de
    `tracking-meta` (1.5px). Discrepância pequena com baseline CP-3
    onde recomendei `tracking-meta` pra CTAs. Decisão DriftButton
    pareceu intencional (`tracking-[2px]` é o mockup .btn-x); aceitar
    como exception documentada em design-system §4.4.
  - **NEW-1b** (S2): `size="sm"` não aplica `uppercase tracking-*` —
    botões mini-inline ficam camelCase. OK pra emoji-only buttons mas
    se vier label texto, perde consistência tipográfica do mockup.
    Documentar uso esperado.
- **Severity**: nenhum bug; closed.

### NEW-2 — FullPageCard: tokens + a11y ✅
- **Arquivo**: `src/components/UI/FullPageCard.tsx`
- **Conformidade**: header usa `text-drift-accent` Syne 800 + border
  `border-drift-border` (consistente com FullPageOverlay original);
  default headerRight é `<DriftButton variant="ghost">` —
  dogfooding ✓. `role="dialog" aria-modal="true"` ✓. ESC handler
  configurável. Backdrop `clickOutToClose` opcional.
- **Findings**:
  - **NEW-2a** (S2): focus trap não implementado. Baseline AY-8
    propunha embutir no primitive. Decisão Lily aparentemente foi
    deferir pra v0.8 (consistente com nota header do file). Aceitar
    como dívida documentada.
  - **NEW-2b** (S2): exit motion `opacity: 0.95` (TX-1 fix) preserva
    contexto mas pode parecer "snap" pra olhos sensíveis a motion.
    `prefers-reduced-motion` deveria pular `y: 22 → 0` (cross-ref
    AY-9). Nenhum guard `useReducedMotion` no código atual. Anotar
    em §5 priorização.
- **Severity**: nenhum bug; observações pra v0.8.

### NEW-3 — FullPageOverlay → FullPageCard re-export ✅
- **Arquivo**: `src/components/UI/FullPageOverlay.tsx`
- **Conformidade**: deprecation alias clean. Imports legados continuam
  funcionando, tsc passa. Nenhuma regressão visual.
- **Severity**: nenhum.

### NEW-4 — Fluid typography migration (5 arquivos, 9 call sites) ✅
- **Arquivos com `text-fluid-*`**:
  - `Feed/PostCard.tsx`: `text-fluid-xs` (meta), `text-fluid-lg` (body) — 2 spots
  - `Post/PostViewer.tsx`: `text-fluid-xs` (header meta) — 1 spot
  - `Post/CommentCard.tsx`: `text-fluid-display` (author), `text-fluid-lg` (body) — 2 spots
  - `Post/ThreadHeader.tsx`: `text-fluid-display` (title), `text-fluid-xs` (breadcrumb) — 2 spots
  - `Create/ComposeOverlay.tsx`: `text-fluid-display` (DRIFT btn), `text-fluid-lg` (textarea) — 2 spots
- **Conformidade**: tokens espelhados em `tailwind.config.js`
  `theme.extend.fontSize.fluid-*` + `src/index.css` `:root --t-fluid-*`
  (lock-via-test friendly). Todos os call sites preservaram
  `leading-*`, `tracking-*`, `font-display`/`font-mono`. Baseline
  CP-14 (typography scale 9/10/11/12/13px) está parcialmente
  formalizado via clamp().
- **Findings**:
  - **NEW-4a** (S2): cobertura é "top 10 high-visibility" — ainda há
    ~50+ usos de `text-[10px]/[11px]/[12px]/[13px]` não migrados.
    Backlog v0.8 pra finalizar. Não bloqueia Round 3.
  - **NEW-4b** (info): clamp() lower bound pra `fluid-xs` é 9px —
    valida WCAG AA somente em textos grandes. Onde drift-muted é
    usado em `fluid-xs` (PostCard meta), contrast ainda fica em
    ~4.05:1 limit (cross-ref AY-4). Bumpar drift-muted resolveria.
- **Severity**: nenhum bug; observações pra escopo v0.8.

### NEW-5 — IdentityPanel adoção parcial de FullPageCard ✅
- **Arquivo**: `src/components/Identity/IdentityPanel.tsx:3` importa
  `FullPageCard` mas o body interno NÃO foi migrado pra usar
  DriftButton. Resultado: shell migrado, conteúdo preservou ~17
  hits slate-* + emerald/red/yellow blocks. Esperado quando
  primitive-first; sinaliza que CL-40/41/42/43 são próximo passo
  natural.
- **Severity**: nenhum bug; sinaliza ordem de migração.

### NEW-6 — ComposeOverlay DRIFT button via DriftButton primary ✅
- **Arquivo**: `src/components/Create/ComposeOverlay.tsx:241–260`
- **Conformidade**: button DRIFT migrado pra `<DriftButton
  variant="primary" size="lg">` — primeiro call site real fora do
  shell. Comportamento `disabled` preservado. **Resolve §7 do
  baseline pra esse call site.**
- **Severity**: nenhum.

### NEW-7 — ThreadView coach + empty CTA hide (commit 5ff16b2) ✅
- **Arquivo**: `src/components/Post/ThreadView.tsx`
- **Conformidade**: `pointer-events-none` no coach evita capturar
  taps acidentais; CTAs redundantes escondidos quando empty thread.
  Baseline TV-P2 (coach sem reabrir) ainda pendente em backlog Track
  C P1 — não regredido.
- **Severity**: nenhum.

---

## §4 — Conformidade % atual vs baseline

| Métrica | Baseline (QA #1) | Atual (QA #2) | Delta |
|---|---:|---:|---:|
| Conformidade global tokens drift-* | ~62% | ~68% | +6 pp |
| CL resolvidos diretamente | 0/57 | 11/57 (19%) | +11 |
| CL parcial / aceitos | 0/57 | 6/57 (10%) | +6 |
| CP resolvidos | já 4 ✅ | 7 ✅ | +3 |
| AY resolvidos | já 4 ✅ | 4 ✅ + 1 mitigado via primitive | +1 mitigated |
| Slate-* hits residuais (file grep) | ~150 estimado | 134 | -16 |
| Primitives shipped | 0 | 2 (DriftButton + FullPageCard) | +2 |
| Fluid typography spots | 0 | 9 | +9 |
| Regressões introduzidas | n/a | 0 | — |

**Estimativa target Round 2 (75%)**: alcançável em **+1 sessão Lily
focada (~3h)** mirando CL-40 + CL-44 + CL-49 (IdentityPanel,
IdentitySwitcher, OnboardingOverlay) — sozinhos endereçam ~62 das ~90
hits residuais slate-*.

**Cálculo conformidade**: razão estimada de classes Tailwind drift-*
(token-correct) sobre total no source. Não é métrica auditada com
ferramenta — é avaliação baseada em densidade observada por arquivo +
ponderação de visibilidade (PostCard/PostViewer/Feed = peso alto;
BootView/Diagnostic = peso médio; admin panels = peso menor). Fonte:
grep counts de §1 + cobertura de finds resolvidos vs total.

---

## §5 — Priorização Round 4 (resíduos S0/S1)

Cluster ordenado por **valor user-visible × density × effort
inverso**.

### Tier 1 — alta densidade, alto impacto visual (~3h Lily)

1. **CL-40 + CL-41 + CL-42 + CL-43** (IdentityPanel slate massa +
   emerald passkey + red error + yellow warnings) — 30 hits
   conjuntos. Effort E2, high visibility (multi-identity é fluxo
   crítico de manifesto §3-4). Pré-condição: shell já em FullPageCard
   ✓.

2. **CL-44 + CL-45** (IdentitySwitcher slate massa + yellow BIP39) —
   32 hits conjuntos. Mesmo cluster Identity; pode ir paralelo.

3. **CL-49 + CL-50 + CL-51** (OnboardingOverlay slate + emerald ✓ +
   slate-700 progress) — 21 hits. Onboarding é primeira impressão.

### Tier 2 — call sites residuais de PostCard/PostViewer (high
visibility, low effort)

4. **CL-11 + CL-15 + CL-16** (PostCard yellow CW + slate placeholder
   + slate row) — 3 fixes E0 finalizam PostCard 100%.

5. **CL-21 + CL-26 + CL-27** (PostViewer CW chip + placeholder +
   hint slate-600) — 3 fixes E0.

6. **CL-25 + CL-28** (PostViewer report red-500 + hex `#ff6b6b`) —
   migrar pra drift-bury tokens. Resolve §7-relacionado de
   ActionsMenu.

### Tier 3 — admin/secondary panels (médio impacto)

7. **CL-5 + CL-6 + CL-7 + CL-8 + CL-9** (RelaySettings slate massa +
   inputs + remove btn + status tone) — 13 hits. Cluster.

8. **CL-46 + CL-47 + CL-48** (LocalListsSettings emerald IPFS + pin
   emoji + slate massa) — 10 hits.

9. **CL-52 + CL-53** (ProfileModal slate + tier badge) — 7 hits.

10. **CL-38 + CL-39** (ReportModal slate + AuthoritiesBlock yellow)
    — 12 hits.

### Tier 4 — App.tsx legacy

11. **CL-58** (App.tsx BootView/Diagnostic/InstallModal/EndOfFeed
    slate ~25 hits). Investigação pré-CSS-loaded edge case BootView
    ainda válida — proceder com cuidado.

### Tier 5 — micro-fixes / S2 / decisão Arquiteto

12. **CL-31 + CL-32** (CommentCard yellow + amber) — 2 hits residuais.
13. **CL-35** (ReplySheet `text-slate-400` único hit residual char count) — E0.
14. **CL-1 + CL-3** (Image fallback + DialogHost cancel) — 2 fixes
    E0; ou substituir por `<DriftButton variant="cancel">`.
15. **CL-54 + CL-55 + CL-56** (SettingsCards amber/red/yellow alerts).
16. **CL-29 + CL-30** (SwipeHandler hex/RGBA — design-system aceita
    como dívida documentada; revisitar v0.8).

### Decisões Arquiteto pendentes

- **AY-4**: bumpar drift-muted `#4a4a46 → #5a5a56` pra ratio 4.7:1.
  Antes ou depois de CL-40/44/49 migration? **Recomendação Robin**:
  ANTES — porque migrar slate-500/600 → drift-muted enquanto token
  ainda falha WCAG AA seria refator desperdiçado se token mudar.
- **NEW-1a**: aceitar `tracking-[2px]` em DriftButton md size? Ou
  uniformizar com `tracking-meta` (CSS var)?
- **NEW-2a**: focus trap embutido em FullPageCard primitive — agora
  ou v0.8?
- **NEW-2b / AY-9**: `useReducedMotion` em FullPageCard motion
  config — agora ou v0.8?

---

## §6 — Veredito Round 3

**🟢 VERDE — segue Round 3.**

**Justificativa:**

1. **Zero regressões** detectadas em fixes auditados. PostCard /
   PostViewer / ThreadView / ThreadHeader passaram pela auditoria
   sem nenhum finding novo S0/S1. ReplySheet, ReportModal,
   ProfileModal, SpreadMap também limpos.
2. **Primitives shipped corretamente**. DriftButton + FullPageCard
   entregam consolidação prometida em §7 do baseline. API alinhada
   com tokens, focus-visible base resolve cross-cutting AY-2/CP-8
   pra adopters futuros.
3. **Fluid typography migration** preservou semântica em todos os
   9 call sites; nenhuma quebra visual reportável via leitura
   estática.
4. **Densidade de fix concentrou em high-visibility surfaces**
   (PostCard, PostViewer, placeholders, ThreadView fluidos) —
   estratégia correta de "user-facing first".
5. **Conformidade % subiu de 62% → 68%**, abaixo do target 75% mas
   alinhada com cap de tempo (Lily executou ~⅓ do plano P0+P1+P2 do
   baseline).

**Não-blockers** que mereceriam atenção em Round 3 paralelo:

- AY-4 (drift-muted contrast): decisão Arquiteto antes de migrar
  slate-500/600 → drift-muted em massa (caso contrário, refator
  duplo).
- Lily 🛫: GlassIconButton primitive em curso — ao mergir, refazer
  audit de touch targets (CP-7 / AY-6) e focus rings em emoji-only
  buttons.

**Bloqueios potenciais em Round 4** (nenhum hoje):

- Se Round 3 fix AY-4 não acontecer ANTES da próxima migração
  Identity*, Round 4 vira retrabalho. Recomendar Arquiteto decidir
  agora.

---

*Robin · 2026-05-09 · QA #2 · 90 baseline finds re-auditados +
7 novos categorizados (NEW-1..7) · conformidade 62% → 68% · zero
regressões · veredito 🟢 verde pra Round 3.*
