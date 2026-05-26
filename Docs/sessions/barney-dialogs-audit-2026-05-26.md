# Barney — Audit doc-only de dialogs no codebase (2026-05-26)

**Persona:** Barney Stinson (peer review crítico)
**Sprint:** N+4 P1.7 / D7
**Scope:** Auditoria *doc-only* — zero código tocado. Inventariar todo
componente que renderiza UI tipo "dialog" / "modal" / "overlay" em
`src/components/**/*.tsx`, classificar como ✅ moderno (consome
primitive), ⚠ legacy (inline custom mas com justificativa), ou ❌
broken (window.confirm/alert ainda vivo / aria-modal ausente / backdrop
translúcido onde violou §B7/B9).

**Coordenação:** zero overlap com B.1 (RadioGroupButton callers),
B.2 (SpreadMap/PostViewer), B.4 (nsfwjs investigation).

**Saída esperada (parent):** top 3 fixes prioritários + commit hash +
recomendação dispatch follow-up.

---

## 1. Pattern canônico (state of the art, 2026-05-26)

O **design system v3** registra 3 primitives oficiais pra qualquer
overlay/modal em Drift (`Docs/design-system.md` §5):

| Primitive | Path | Caso de uso |
|---|---|---|
| `FullPageCard` | `src/components/UI/FullPageCard.tsx` | Card fullscreen `max-w-md` com close + slide-up; usado pra **conteúdo navegável** (Settings cards, Profile, Compose, ReportModal, IdentitySwitcher) |
| `SlideUpOverlay` | `src/components/UI/SlideUpOverlay.tsx` | Bottom-sheet / centered overlay com drag-to-dismiss; usado pra **ação focada** (ReplySheet, LensInspector, moderation menu, InstallPrompt) |
| `ModalHeader` | `src/components/UI/ModalHeader.tsx` | Composição interna de qualquer um dos dois — `<ModalHeader title onClose />` |

E pra `alert/confirm/prompt` (semântica nativa do browser), o pattern
canônico é o **`DialogHost` singleton** + helper `dialog.*`
(`src/lib/dialog.ts`):

```ts
if (!(await dialog.confirm('Tem certeza?'))) return
await dialog.alert('Salvo.')
const label = await dialog.prompt('Novo label:', { defaultValue: 'foo' })
```

`<DialogHost />` está montado em `App.tsx:1319` (lazy chunk) e renderiza
modal centralizado com `role=dialog aria-modal=true`, ESC cancela,
Enter confirma. **Esse é o único caminho permitido pra modal
síncrono-style.**

Regra dura derivada das lições B7/B9 (ThreadView/SpreadMap fix de
backdrop translúcido em 2026-05-22): **modal/overlay full-page tem
backdrop OPACO** (`bg-drift-bg` cheio, sem `/80` ou `/90`). Translúcido
só em SlideUpOverlay bottom-sheet variant (intencional pra deixar mapa
visível atrás do drag-handle).

---

## 2. Inventário — 16 superfícies tipo dialog/modal

Output do grep `role="dialog" | role="alertdialog" | window.confirm |
<dialog`, cross-ref com primitives. Organizado por categoria.

### ✅ Modern — consomem primitive registrado (12)

Esses são o estado da arte. Não precisam ação.

| # | Componente | file:line | Primitive | Notas |
|---|---|---|---|---|
| 1 | `ProfileModal` | `src/components/Profile/ProfileModal.tsx:115` | `FullPageCard` | ariaLabel="perfil"; ok |
| 2 | `EditProfileCard` | `src/components/Profile/EditProfileCard.tsx:112` | `FullPageCard` | ok |
| 3 | `IdentitySwitcher` | `src/components/Identity/IdentitySwitcher.tsx:198` | `FullPageCard` | usa `dialog.confirm/prompt` p/ wipes destrutivos — ok |
| 4 | `IdentityPanel` | `src/components/Identity/IdentityPanel.tsx:69` | `FullPageCard` | ok |
| 5 | `ReportModal` | `src/components/Post/ReportModal.tsx:89` | `FullPageCard` | "denunciar" — ok |
| 6 | `ReplySheet` | `src/components/Post/ReplySheet.tsx:431` | `SlideUpOverlay` | bottom-sheet com drag — ok |
| 7 | `LensInspector` | `src/components/Post/LensInspector.tsx:138` | `SlideUpOverlay` | "por que está aqui" — ok |
| 8 | `PostViewer ModerationOverlay` | `src/components/Post/PostViewer.tsx:927` | `SlideUpOverlay` | menu de moderação — ok |
| 9 | `OnboardingOverlay` | `src/components/Onboarding/OnboardingOverlay.tsx:94` | `SlideUpOverlay` | ok |
| 10 | Settings cards (família) | `src/components/Settings/*.tsx` (10+ instâncias) | `FullPageCard` | `AppearanceCard`, `DiscoverRelaysCard`, `SuaLenteCard`, `LocalListsSettings`, `RelaySettings`, `SettingsCards.tsx` (~13 sub-cards), `GuideCard` — TODOS via primitive |
| 11 | `MultiTabModal` | `src/components/UI/MultiTabModal.tsx:28` | `SlideUpOverlay` | composto + `ModalHeader hideClose` — ok |
| 12 | `ComposeOverlay` (2x) | `src/components/Create/ComposeOverlay.tsx:344,606` | `FullPageCard` | ok |
| — | `PeerInterstitial` | `src/components/UI/PeerInterstitial.tsx:38` | `FullPageCard` | ok |
| — | `MapExplainerCard` | `src/components/Feed/MapExplainerCard.tsx:159` | `FullPageCard` | ok |
| — | `GpsErrorBanner` | `src/components/UI/GpsErrorBanner.tsx:88` | `FullPageCard` | ok |
| — | InstallPrompt overlay | `src/App.tsx:2500` | `SlideUpOverlay` | ok |
| — | Status panel / About | `src/App.tsx:220,237` | `FullPageCard` | ok |

E o **`DialogHost` global** (`src/components/UI/DialogHost.tsx:121`) —
substitui `window.alert/confirm/prompt` em **22 call sites confirmados**
via `dialog.*` helper. Todos legais. Hard-validated pelo grep
`confirm(|alert(|prompt(` — única ocorrência de `window.*` é
`useInstallPrompt.ts:100 evt.prompt()` que é o `BeforeInstallPromptEvent`
nativo PWA (não é `window.prompt`; é o spec do beforeinstallprompt).
**Zero `window.confirm` vivo.**

### ⚠ Legacy custom mas justificado (3)

Componentes que NÃO consomem primitive mas têm justificativa
documentada inline. Não-blocker mas mereceriam revisão de ROI.

#### 2.1 — `ThreadView` (`src/components/Post/ThreadView.tsx:201`)

```tsx
className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col
  border-drift-border bg-drift-bg focus:outline-none sm:border-x"
// design-system: ok reason=role-tree-not-fullpage-card
```

**Justificativa inline (linhas 188-200):** ThreadView tem semantics
próprios (`role="tree"`), não `role="dialog"`. Fix B7/B9 foi aplicado
(2026-05-22) — backdrop `bg-drift-bg` opaco, espelha FullPageCard
visualmente. **Veredito:** ✅ tecnicamente fora do scope de "dialog"
(é um *tree view modal*) mas com pattern visual idêntico. Acceptable.

**Risk:** `role=tree` em fullscreen sem `aria-modal` é ambíguo pra AT —
screen reader pode navegar pra background sem perceber. Considerar
adicionar `aria-modal="true"` mesmo com role=tree (spec permite).

#### 2.2 — `Image LightboxOverlay` (`src/components/UI/Image.tsx:365`)

```tsx
<m.div role="dialog" aria-modal="true"
  className="fixed inset-0 z-[60] flex items-center justify-center
    bg-black/95 backdrop-blur-sm p-4 cursor-zoom-out">
```

**Sem primitive.** Custom inline. `bg-black/95` (não `bg-drift-bg`) —
intencional pra lightbox de imagem fullscreen. `role=dialog +
aria-modal=true` corretos, ESC fecha (via `onClick={onClose}` no
backdrop + close button explícito), backdrop opaco-95.

**Risco:** sem focus trap. User com Tab key pode escapar pro DOM
underneath. Sem ESC handler explícito — só click no backdrop. Mobile
sem hardware ESC, ok, mas keyboard desktop fica sub-padrão.

**Veredito:** ⚠ legacy P2. Não migra fácil pra `SlideUpOverlay` (sem
slide-up; semântica é lightbox). Poderia justificar primitive novo
(`LightboxOverlay`) se houver 2º call site. Hoje só `<Image>` usa.

#### 2.3 — `AppErrorBoundary` wipe modal (`src/components/UI/AppErrorBoundary.tsx:152-157`)

```tsx
<div className="fixed inset-0 z-[9999] flex items-center justify-center
  bg-drift-bg p-4">
  <div role="alertdialog" aria-modal="true"
    aria-labelledby="drift-wipe-title"
    aria-describedby="drift-wipe-desc"
    className="w-full max-w-md space-y-4 rounded
      border border-drift-danger bg-drift-surface p-5">
```

**Justificativa explícita (comentário do PR `6ebf1ca`):** B-UX-3 P0
fix em 2026-05-23 substituiu `window.confirm` por custom modal porque
o boundary **monta acima do App** — `<DialogHost />` está dentro de
`<App>` e portanto inacessível em error state. **Backdrop opaco**
(comentário linha 153: "coerente com fix B7+B9. Estado de erro merece
ainda mais clareza visual"). `role=alertdialog` correto pra ação
destrutiva irreversível (apagar IndexedDB + OPFS).

**Veredito:** ✅ legacy *aceitável* pra esse caso edge. **NÃO migrar**
— DialogHost não cobre boundary scope. Conformance test deveria
allowlistar esse caminho explicitamente. (Recomendação: ver §3.3.)

---

## 3. Top 3 fixes prioritários

### P0 — nenhum

Não achei nenhum `window.confirm`/`window.alert` vivo no código. Não
achei nenhum modal sem `aria-modal` onde devia ter. Não achei nenhum
backdrop translúcido fora dos casos justificados (SlideUpOverlay
variant `bottom-sheet`). **B-UX-3 limpou o débito P0 de dialogs em
2026-05-23.** Esse audit confirma — não há fogo aceso.

### P1.A — Image LightboxOverlay: focus trap + ESC handler

`src/components/UI/Image.tsx:346-394`. Implementar:

1. `useEffect` com `addEventListener('keydown', e => if (e.key ===
   'Escape') onClose())` enquanto `open=true`.
2. Focus trap: ao abrir, focus no `<button aria-label="fechar">`. Tab
   ciclar entre close button e backdrop (`tabIndex={0}` no backdrop).
3. Manter `onClick` backdrop como dismiss path mobile.

**ROI:** lightbox é high-traffic (cada `<Image>` em PostViewer pode
abrir). Keyboard a11y fix barato (~30 LOC). **Estimativa: 20min
dispatch single-agent.**

### P1.B — ThreadView: adicionar `aria-modal="true"` em role=tree

`src/components/Post/ThreadView.tsx:185-201`. ARIA permite
`role="tree" aria-modal="true"` (modal pode hospedar qualquer role
interativo). Sem isso, screen readers tratam ThreadView como
sub-region navegável — VoiceOver/NVDA podem ler conteúdo do background
(SpreadMap, PostViewer subjacente).

**ROI:** uma linha. Não-quebra nada. **Estimativa: 5min dispatch
trivial / piggyback em próximo commit ThreadView.**

### P2 — Conformance test allowlist explícita pra AppErrorBoundary

Hoje `tests/app-error-boundary-modal-conformance.test.ts` (já presente
em git status `A`) provavelmente cobre o custom modal — preciso
verificar que ele *justifica explicitamente* o porquê do custom (não
DialogHost) em comentário inline + assertion. Pattern: igual ao
`design-system: ok reason=` do ThreadView. Sem isso, próximo refactor
"merge dialogs" risca de quebrar B-UX-3 sem aviso.

**ROI:** doc-only / 1 comment line. Defesa contra regressão.
**Estimativa: 5min, junto com B.1 ou B.2 follow-up.**

---

## 4. Recomendação dispatch follow-up

**Único candidato P1 vale dispatch:** P1.A (Image lightbox focus trap +
ESC). É surface high-traffic, fix barato, paga em a11y compliance.

**Sugestão:** spawn task **"P1.A Image LightboxOverlay keyboard a11y"**
~20min. Não-bloqueia release. Pode ir em sprint N+5 batched com outro
a11y polish.

**P1.B + P2** são triviais (uma linha cada) — recomendo **piggyback**
em próximo commit que tocar `ThreadView.tsx` ou `AppErrorBoundary.tsx`,
sem dispatch dedicado.

**Conclusão Barney:** isso é *legendary*. O codebase tá clean — 12 de
16 dialogs consomem primitive registrado, 3 legacy têm justificativa
documentada inline, zero `window.confirm` solto. Não há trash escondido
embaixo do tapete. B-UX-3 (2026-05-23) foi o último P0 e tá fechado.
Próxima sprint pode focar em features, não em débito de modal.

---

*Audit feito em 2026-05-26. Source grep: `role=["']dialog["']`,
`role=["']alertdialog["']`, `<dialog\b`, `window\.(confirm|alert|prompt)`,
`aria-modal`, `DialogHost|ModalHost|SlideUpOverlay|FullPageCard|ModalHeader`
em `src/`. Cross-ref `Docs/design-system.md` §5 primitives registry.*
