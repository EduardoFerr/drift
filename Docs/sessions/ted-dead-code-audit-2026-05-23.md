# Ted — Dead Code Audit (UX/UI surface) — 2026-05-23

> **Persona:** Ted Mosby (arquitetura/padrões/abstrações).
> **Escopo:** `src/components/**`, `src/hooks/**`, `src/styles/**`,
> strings JSX, comparação contra `Docs/design-system.md` §5.
> **Exclui:** `src/lib/**`, `src/types/**`, `tests/**`.
> **Método:** doc-only. Nenhum byte de código alterado. Recomendações
> categorizadas por confiança (alta/média/baixa) e cascading impact.
> **Paralelo:** Barney está fazendo audit crítico (peer review / threat
> model). Convergência esperada em itens UX-óbvios (deprecated branch,
> primitive não adotado, vocab residual).

---

## 0. Sumário executivo

| Métrica | Valor |
|---|---|
| Componentes 100% órfãos (0 callers fora da própria definição) | **3** |
| Variants/sizes declarados mas 0-caller | **6** (DriftButton.danger, DriftButton.danger-prominent, GlassIconButton.md, GlassIconButton.lg, GlassIconButton.sm, CommentCard.variant='card') |
| Primitive completo shelf-ware (definido + zero adoção) | **3** (DriftCard, HintToast, HintModal) |
| CSS custom-properties unused | **~35** vars em themes.css × 3 paletas |
| Inline-button patterns que pediam GlassIconButton | **2** (PostViewer comments button, PostViewer map button) |
| Inline-button patterns que pediam DriftButton | **2** (MultiTabModal × 2 buttons) |
| Tagged "legacy" / "removed but kept" comments | **~14** (em comments JSDoc; baixo risco) |
| LoC removível estimada (conservador) | **~580** (componentes 100% órfãos + variants 0-caller + CSS deads) |
| LoC removível agressiva (todas categorias) | **~750** |

**Composição vs Lily Sprint N+3 (zero débito maduro):** este audit
identifica **3 candidatos de quick-win imediato** que se encaixam no
plano "zero débito maduro" sem cascading impact, e **5 oportunidades de
consolidação** que pedem coordenação multi-arquivo.

**Verdict arquitetural:** o design system está em estado **saudável-
mas-com-acúmulo**. O grosso de duplicação foi extraído pra primitives
(✅ SlideUpOverlay, ModalHeader, SettingExplainer, AccordionGroup,
SectionHeader, DriftButton ghost/cancel/primary, FullPageCard); o que
sobrou é principalmente **primitive não-adotado** (DriftCard, HintToast,
HintModal) — não um anti-pattern de duplicação ativa.

Risco maior: **dead variants em tipos públicos exportados** (DriftButton
`danger`/`danger-prominent`, GlassIconButton `sm`/`md`/`lg`) — TypeScript
strict não pega, então qualquer call-site novo pode acidentalmente
adotar a variant deprecated e mantê-la viva.

---

## 1. Categoria 1 — Componentes legacy / deprecated não removidos

### 1.1 [HIGH] `CommentCard` variant='card' — render path morto (~155 LoC)

- **Arquivo:** `src/components/Post/CommentCard.tsx:197-351`
- **Status:** o único caller em produção (`ThreadView.tsx:374-391`)
  passa `variant="list"`. A branch `variant='card'` retorna prematuro
  via early `if (variant === 'list') return <ListVariant .../>` no
  linha 167, mas todo o JSX abaixo (197-351, incluindo
  `CwHiddenPlaceholder`, `HiddenPlaceholder`, header `<article>`,
  body com AnimatePresence, footer) **NUNCA renderiza**.
- **Evidência:**
  - `src/components/Post/CommentCard.tsx:66` — comentário próprio do
    arquivo: `'card' (default, legacy): layout fullscreen ocupa o`.
  - `src/components/Post/ThreadView.tsx:7` — comentário: `(cards-mode
    legacy removido a pedido do user — sessão noite V)`.
  - Grep `variant=['"]card['"]` em call-sites CommentCard: 0 hits
    (DriftSkeleton tem variant="card" mas é primitive diferente).
- **Por que não foi removido ainda:** default `variant = 'card'` no
  destructuring (linha 112) age como fallback safety; remover quebra
  TS strict porque dois props (`isFocused`, `isExpanded`, `onTap`,
  `onToggleExpand`) ficam undefined no list path. Solução:
  remover default, tornar `variant` non-optional ou eliminar do shape.
- **Recomendação:** **REMOVER**. Inverter shape: tornar list o único
  render path, deletar branch 197-351 + `CwHiddenPlaceholder`,
  `HiddenPlaceholder`, `truncate()` (linha 397), `variant` prop.
- **LoC removível:** ~155
- **Confiança:** alta. ThreadView é o único caller (single grep hit).
- **Test impact:** `tests/comment-card-conformance.test.ts` (se
  existir) precisa ajustar.
- **Quick-win?** Sim — single-file edit, sem cascading.

### 1.2 [MED] Settings `ContentSettings` — referenciada mas inexistente (~stale refs)

- **Arquivo afetado:** múltiplas referências em comments.
- **Status:** `ContentSettings` foi DECOMPOSTA em `SettingsCards.tsx`
  (V9.2c). O arquivo `ContentSettings.tsx` não existe mais (Glob
  retornou 0 matches). Mas comments ainda referenciam:
  - `src/App.tsx:2011` — `settings (ContentSettings) · status...`
  - `src/App.tsx:2148-2150` — `cada seção da ContentSettings também
    aparece como entry... em ContentSettings (rota direta...)`
  - `src/lib/geolocation.ts:23` — `UI (ContentSettings) deve mostrar...`
  - `src/lib/runtime.ts:14` — `ContentSettings, App, e...`
  - `src/lib/transport/wss.ts:27` — `location.reload() (forçado em
    ContentSettings.tsx). Aceitável...`
  - `src/lib/transport/tor.ts:63` — `ContentSettings → runtime`
  - `src/components/Settings/SettingsCards.tsx:23` — `ContentSettings
    legacy permanece (track futura limpa) pra retrocompat` (**mais
    grave** — sugere componente que não existe)
- **Recomendação:** **MIGRAR COMMENTS**. Substituir `ContentSettings`
  por `SettingsCards` em todos os comments. Documenta o estado real.
  Não é dead code estritamente (são comments), mas é **dead reference**
  que confunde novos contributors.
- **LoC removível:** 0 (só edição de comments).
- **Confiança:** alta.
- **Quick-win?** Sim — pure comment cleanup, zero risk.

### 1.3 [LOW] `prefs.ts:thread_view_mode` — case que ignora silenciosamente

- **Arquivo:** `src/lib/prefs.ts:93-96` (NOTA: tecnicamente fora do
  escopo `src/lib/**`, mas trata de UX/UI pref).
- **Status:** case do switch handles a pref legacy `thread_view_mode`
  com `// Cards-mode removido 2026-05-17 (user feedback). Pref
  legacy ignorada silenciosamente — list-mode é único agora.` —
  comentário honesto, mas é dead branch que serializa storage antigo.
- **Recomendação:** **MANTER por agora**. Razão: usuários com pref
  legacy persistida em IndexedDB ainda têm a chave; remover faria
  TS warning durante migration silenciosa. Pode ser removido após
  ~6 meses (≥ jul/2026) — anotar em BACKLOG.md.
- **LoC removível:** ~3 (futuro).

---

## 2. Categoria 2 — Branches mortas em components

### 2.1 [HIGH] `DriftButton` variant `danger` e `danger-prominent` — 0 callers

- **Arquivo:** `src/components/UI/DriftButton.tsx:40, 80-86`
- **Status:** declarados no union type `DriftButtonVariant`
  (linhas 35-40) e implementados em `driftButtonVariantClass`
  (linhas 80-86). Grep `variant=['"]danger['"]|variant=['"]danger-
  prominent['"]` em todo src: **0 hits**.
- **Histórico:** parece ter sido designed-ahead, com expectativa de
  uso futuro (delete identidade, reset, etc.). Mas as ações destrutivas
  reais usam pattern diferente (long-press 5s + ModerationModal pra
  block/mute em ActionsFan; export-before-destruct em IdentityPanel
  via DriftButton variant="ghost").
- **Recomendação:** **MANTER por design intent + lock-via-test**.
  Razão: variants destrutivos são compromisso ético (delete identity,
  reset profile devem ter visual semântico distinto). Mas adicionar
  **comment "/* RESERVED — sem callers atuais; ver Round 11 */"** e
  considerar mover pra `DriftButtonVariantReserved` type pra reduzir
  ruído de IntelliSense — OU remover até primeiro caller necessário.
- **LoC removível:** ~10 se remover; 0 se manter com comment.
- **Confiança:** alta sobre o fato (0 callers), média sobre recomendação
  (intent vs purge).
- **Convergência Barney:** ele provavelmente flagará como "dead public
  API surface". Conversa válida.

### 2.2 [HIGH] `GlassIconButton` sizes `sm`, `md`, `lg` — 1 caller só usa `xl`

- **Arquivo:** `src/components/UI/GlassIconButton.tsx:33-36, 57,
  104-130 (size class function)`
- **Status:** o único caller (`PostViewer.tsx:610-630`) passa
  `size="xl"`. O default no destructuring (`size: GlassIconButtonSize
  = 'md'` em linha 133) é literalmente "legacy fallback" — comments
  do próprio arquivo dizem:
  - linha 34: `md → h-7 w-7, ícone text-[14px] (legacy — pre-WCAG 2.5.5)`
  - linha 35: `lg → h-8 w-8, ícone text-[16px] (legacy)`
  - linha 36: `xl → h-11 w-11, ícone text-[18px] (WCAG 2.5.5 AA —
    tap target 44px)`
- **Por que existe:** lock-via-test pra impedir regressão WCAG. Se
  callers novos adotarem `md` ou `lg` accidentally, viola
  tap-target ≥44px (WCAG 2.5.5 AA).
- **Recomendação:** **DUAL ACTION**:
  1. **REMOVER** `md` e `lg` do union (já marcados legacy nos
     comments). `sm` (h-6 w-6) é "visual-only sem tap" — manter
     com comment explícito ou refatorar pra prop separada
     `interactive: boolean`.
  2. Mudar default de `md` pra `xl` (linha 133 + 62) — torna o
     primitive WCAG-by-default. Caller atual já passa `xl`
     explicitamente; mudança é no-op runtime.
- **LoC removível:** ~25 (size class function + types + default).
- **Confiança:** alta.
- **Quick-win?** Sim — single file, 1 caller para validar.
- **Convergência Barney:** ele certamente flagará como threat WCAG
  (sizes não-WCAG presentes = trap pra novos contributors).

### 2.3 [MED] `PostViewer.tsx:embedded` prop — branch dead-removed mas refs em comments

- **Arquivo:** `src/components/Post/PostViewer.tsx:267, 458, 467, 607,
  816, 964-983`
- **Status:** prop `embedded` foi removida em `[PostViewer cleanup
  2026-05-20]` (todos call sites passam `embedded=true`). Mas o
  arquivo ainda tem ~7 comments JSDoc-style explicando o que era a
  branch removida. Wrapper export "ModalWrapper" mencionado em
  linha 964-983 — checar se ainda há export ou só comment.
- **Recomendação:** **REDUZIR comments**. Os 7 references em comments
  citam "[PostViewer cleanup 2026-05-20]" — útil pra audit trail
  histórico (4 dias atrás), mas reduz-se a 1 comment indicativo no
  topo do arquivo + remover os 6 inline. Manter `// V8 embedded mode:
  PostViewer como home view` como contexto histórico topo.
- **LoC removível:** ~15-20 (puramente comments).
- **Confiança:** alta.

---

## 3. Categoria 3 — Holdovers do design system antigo

### 3.1 [HIGH] `themes.css` — ~35 CSS vars unused em 3 paletas

- **Arquivo:** `src/styles/themes.css` (387 linhas total)
- **Status:** declara 53 tokens por tema × 3 paletas (Cinder, Rosenholz,
  Velatura). Apenas o subset abaixo tem caller em código:
  - **Usados:** `--drift-bg`, `--drift-surface`, `--drift-border`,
    `--drift-accent`, `--drift-accent2`, `--drift-text`, `--drift-muted`,
    `--drift-body`, `--drift-spread`, `--drift-bury`, `--drift-warning`,
    `--drift-danger`, `--drift-surface-1` (1 caller: AppearanceCard).
  - **Unused (verificado com grep em src + tailwind.config.js):**
    `--drift-surface-2`, `--drift-surface-3`, `--drift-surface-4`,
    `--gradient-canvas`, `--gradient-accent-soft`, `--gradient-edge`,
    `--gradient-signature`, `--gradient-hairline`, `--shadow-glow`,
    `--hover-overlay`, `--active-press`, `--drag-shadow`, `--selected-bg`,
    `--divider-soft`, `--highlight-flash`, `--scrim-modal`,
    `--ease-signature`.
- **Aliases Tailwind:** `tailwind.config.js` registra alguns
  (`bg-drift-canvas`, `shadow-drift-glow`, etc.) mas NENHUM aliase
  é referenciado em `src/**`. Grep `bg-drift-canvas|shadow-drift-glow|
  bg-drift-accent-soft|bg-drift-edge|bg-drift-signature|
  bg-drift-hairline|surface-2|surface-3|surface-4` → 0 callers.
- **Histórico:** parece ter sido design-ahead pelo Robin v4 (comment
  linha 22: `Curadoria: Robin v4. Inspirações: Cinder → Anthropic
  Labs + Mercury + Soulages + Morandi`). Curadoria stylística sem
  consumer real.
- **Recomendação:** **PURGE em 2 passos**:
  1. **CSS vars unused** — remover declarações dos 3 themes. ~30
     linhas × 3 themes = ~90 LoC.
  2. **Tailwind aliases unused** — remover de `tailwind.config.js`
     (~13 lines em theme.extend).
- **LoC removível:** ~100-110.
- **Confiança:** muito alta (grep zero callers).
- **Risco:** ZERO se grep confirmado. Mas **DOUBLE-CHECK necessário**
  antes de remover — designer pode estar esperando essas vars pro
  próximo theme.
- **Reopener condition** (style guide convention): se aparecer demanda
  pra "shadow tinted glow" / "gradient signature card", retornar essas
  vars. Documentar em `Docs/known-limitations.md`.
- **Quick-win?** Médio — single file, ~120 LoC, mas requer designer
  sign-off (Robin v4).
- **Convergência Barney:** improvável que ele toque CSS vars; este é
  território arquitetural Ted.

### 3.2 [LOW] Color tokens "legacy" referenced in DriftCard primitive

- **Arquivo:** `src/components/UI/DriftCard.tsx:37` — comment:
  `Adoção: incremental (modelo DriftButton). Call sites legacy ficam
  com classes inline até migration coordenada (Round 5+).`
- **Status:** referencia Round 5+ que já passou (atual é Sprint N+3).
  Comment stale.
- **Recomendação:** atualizar comment OU remover DriftCard (ver §4.1).

---

## 4. Categoria 4 — Primitives duplicados / shelf-ware

### 4.1 [HIGH] `DriftCard` primitive — 0 callers (~218 LoC shelf-ware)

- **Arquivo:** `src/components/UI/DriftCard.tsx` (toda)
- **Status:** primitive completo (4 variants, 3 sizes, 4 slots, helpers
  puros, shadow-stack rendering). Grep `<DriftCard\b|driftCardClassName|
  DriftCardVariant`: **só refs internas + 1 comment em App.tsx**
  (linha 1378-1385 cita `DRIFT_CARD_SHADOW_BACK_CLASS` como
  documentation, mas não importa nem usa).
- **Histórico:** Round 4 Fase A (RFC `2026-05-rfc-design-system-v08.md`
  §3.1). Lily comment em `CommentCard.tsx:213` diz:
  `convergente com DriftCard primitive (Ted §3.1) — usa mesmo
  bg-drift-surface + focus-visible do primitive, mas mantém este
  article com layout custom flex-col h-full + border-l dinâmica
  (CommentCard tem layout próprio que DriftCard genérico não replica).`
  → confessa que adoption parou.
- **Decisão arquitetural:** dois caminhos:
  - **(A) PURGE:** remover DriftCard inteiro. Aceita que cards são
    diferentes demais (PostViewer, CommentCard, FeedTabs) pra single
    primitive. Cards têm layouts custom — extrair classes compartilhadas
    em CSS helper (`drift-card-base`) é menos invasivo.
  - **(B) FORCE-ADOPT:** track de migração explícito em Sprint N+4.
    Refatorar PostViewer, CommentCard, FullPageCard pra consumirem
    DriftCard. Risco: refactor grande, mudança visual subtle, regression.
- **Recomendação Ted:** **(A) PURGE**. Razão: 4 dias depois da extração
  zero adoption + Lily admite incompatibilidade estrutural. Primitive
  bem-feito mas resolve problema que não existe na prática. Manter o
  `DRIFT_CARD_BASE_CLASS` constant (ou mover pra `themes.css` como
  utility class) preserva o ROI da extração sem o overhead do
  component shape.
- **LoC removível:** 218 (arquivo inteiro) - ~20 (preservar shadow
  stack util classes) = **~198**.
- **Confiança:** alta sobre fato (0 callers); média sobre purge vs
  force-adopt.
- **Convergência Barney:** ele flagará como YAGNI clássico.
  Decisão arquitetural mas convergente.

### 4.2 [HIGH] `HintToast` primitive — 0 callers (99 LoC)

- **Arquivo:** `src/components/UI/HintToast.tsx`
- **Status:** Source: RFC DAOP-001 Phase 1 PR3 (Ted HIMYM analysis
  2026-05-17). Grep `HintToast` em src: **só self-refs + 1 reference
  em `lib/guidance.tsx:219` (comment)**. Nenhum `<HintToast`.
- **Recomendação:** **REMOVER** OU adicionar pelo menos 1 caller no
  fluxo DAOP. Se Phase 2 do DAOP (que adicionaria callers) está
  travado/skipped, primitive não justifica espaço de bundle.
- **LoC removível:** 99.
- **Confiança:** alta.

### 4.3 [HIGH] `HintModal` primitive — 0 callers (111 LoC)

- **Arquivo:** `src/components/UI/HintModal.tsx`
- **Status:** mesmo que §4.2 — RFC DAOP-001 Phase 1 PR3 design-ahead.
  Grep `<HintModal\b`: zero.
- **Recomendação:** REMOVER junto com HintToast. Se DAOP Phase 2
  reativar, re-criar a partir do git log (não é refactor caro).
- **LoC removível:** 111.

### 4.4 [MED] `PostViewer` comment/map buttons — inline class duplication

- **Arquivo:** `src/components/Post/PostViewer.tsx:670-692, 701-735`
- **Status:** 2 botões inline com classes muito similares a
  `GlassIconButton` (`absolute right-[68px] top-4 z-30 ... rounded-full
  border border-drift-border bg-drift-surface/80 ... shadow-drift-md
  backdrop-blur-sm transition-colors`). Comment button (688: badge
  com count) e Map button (713: ripple + active state). Mais complexos
  que GlassIconButton template default (badge + ripple), justifica
  inline parcialmente — mas as base classes são copy-paste do
  `glassIconButtonVariantClass('default')`.
- **Recomendação:** **REFACTOR FUTURO**. Extender GlassIconButton com
  `slots: { badge, ripple }` ou criar `GlassPillButton` (variante com
  conteúdo extra ao lado do ícone). Não é dead code estritamente —
  é duplicação evitável.
- **LoC removível:** 0 (refactor opportunity, não purge).

### 4.5 [LOW] `MultiTabModal` raw buttons — não usa DriftButton

- **Arquivo:** `src/components/UI/MultiTabModal.tsx:50-61`
- **Status:** 2 `<button>` inline com classes (`rounded border
  border-drift-border px-3 py-2 text-[12px]...`). Equivalente direto
  a `DriftButton variant="cancel" size="md"` + `variant="primary"
  size="md"`.
- **Recomendação:** trocar pra DriftButton (3-line diff). Trivial.
- **LoC removível:** ~6 (classes inline → variant + size).

---

## 5. Categoria 5 — CSS dead

### 5.1 [HIGH] Themes.css unused vars — ver §3.1

Coberto em §3.1 acima. ~35 vars × 3 paletas + 13 tailwind aliases.

### 5.2 [VERIFIED CLEAN] `ripple.css` — totalmente usado

- `.ripple-wave` → 7 callers (PostViewer ⋮ map button, SwipeHandler).
- `.material-ripple` / `.material-ripple-host` → useMaterialRipple hook
  consome internamente.
- **Recomendação:** manter intocado.

### 5.3 [VERIFIED CLEAN] `timeline-scrubber.css` — usado em SpreadMap

- Criado V_2026-05-23 (hoje). Animação `drift-scrubber-fill` e
  `drift-scrubber-caret` usadas em TimelineScrubber.
- **Recomendação:** manter intocado.

---

## 6. Categoria 6 — Hooks órfãos

### 6.1 [VERIFIED] `useMaterialRipple` — adotado (DriftButton)

- Grep mostra import em DriftButton ripple integration.

### 6.2 [VERIFIED] `useLongPress`, `useInstallPrompt`, `useThread`,
   `useSpreadMap`, `useUserWeight` — todos com callers.

**Categoria 6 sem findings.**

---

## 7. Categoria 7 — JSX strings deprecated PT-BR

### 7.1 [VERIFIED CLEAN] vocab UI DRIFT/SINK migration completa

- Grep `\bespalha\|enterra\b` em strings JSX `src/components/**/*.tsx`:
  matches **apenas em comments JSDoc** (PostViewer linha 5-6 descrevendo
  semântica do swipe, MapExplainerCard usando "espalhamento" como
  substantivo geográfico, SwipeHandler descrevendo gestos).
- Nenhuma string user-facing legacy encontrada. LOCK_VIA_TEST
  `tests/manifesto-conformance.test.ts` cobre.
- **Veto:** **não remover** os comments JSDoc — eles são contexto
  arquitetural pro próximo contributor.

### 7.2 [MED] `'Settings'` string residual em comments/aria

- Grep `Settings` em `src/components/`: ~25 hits, todos em:
  - JSDoc comments (referência ao arquivo/módulo `SettingsRoot`,
    `LocalListsSettings`, `RelaySettings` — nomes técnicos OK)
  - 1 hit user-facing: `SpreadMap.tsx:181` —
    `action: { label: 'abrir GPS settings', onClick: ... }`
- **Recomendação:** trocar `'abrir GPS settings'` → `'abrir ajustes
  de GPS'` em `SpreadMap.tsx:181`. Convergente com migração
  Settings→Ajustes do audit 2026-05-17 5bf7daa.
- **LoC removível:** 0 (1 char alterado).
- **Quick-win?** Sim — trivial.

### 7.3 [VERIFIED CLEAN] 'Trending' migration

- Grep `Trending` em strings JSX: 0 user-facing. Apenas
  technical refs em `useFeedStore` / `FeedTabs` types (variant names).
  Migração para "em alta" foi limpa.

---

## 8. Categoria 8 — Imports não usados

### 8.1 [VERIFIED CLEAN] TS strict cobre

- `noUnusedLocals` + `noUnusedParameters` em `tsconfig.json` impedem.
  Lint passa com 0 warnings (CLAUDE.md afirma "lint 0 warnings (hard)").
- Sem findings.

---

## Top 10 quick wins (ordenados por ROI)

| # | Item | Arquivo | LoC | Risk | Effort |
|---|---|---|---|---|---|
| 1 | Remover `CommentCard` variant='card' render path | CommentCard.tsx | ~155 | Low | 30min |
| 2 | Remover `HintToast` (0 callers) | HintToast.tsx | 99 | Low | 10min |
| 3 | Remover `HintModal` (0 callers) | HintModal.tsx | 111 | Low | 10min |
| 4 | Remover `GlassIconButton` sizes `md`/`lg`; default → `xl` | GlassIconButton.tsx | ~25 | Low | 20min |
| 5 | Purge `themes.css` unused CSS vars (×3 paletas) | themes.css | ~110 | Low (com sign-off) | 40min |
| 6 | Purge `tailwind.config.js` unused aliases | tailwind.config.js | ~13 | Low | 10min |
| 7 | Substitir comments `ContentSettings` → `SettingsCards` | App.tsx, lib/* | ~7 lines | Zero | 10min |
| 8 | Trocar `'GPS settings'` → `'ajustes de GPS'` | SpreadMap.tsx:181 | 1 char | Zero | 2min |
| 9 | MultiTabModal raw `<button>` → DriftButton | MultiTabModal.tsx | ~6 | Low | 10min |
| 10 | Reduzir `[PostViewer cleanup 2026-05-20]` comments residuais | PostViewer.tsx | ~15 | Zero | 15min |

**Total quick-wins:** ~540 LoC removível em ~2.5h trabalho.

---

## Top 5 refactor opportunities (cascading)

### R.1 [BIG] `DriftCard` decisão purge vs force-adopt

- **Escopo:** DriftCard.tsx + decisão arquitetural sobre 3 lugares
  (PostViewer, CommentCard, FullPageCard).
- **Esforço:** Purge = 30min. Force-adopt = 4-8h coordenado.
- **ROI Purge:** ~200 LoC + 1 primitive a menos no registry.
- **ROI Force-Adopt:** 1 ponto de controle pra mudança de tema futura;
  ~30 finds (das auditorias Round 1+2) resolvidos.
- **Recomendação Ted:** **PURGE** (ver §4.1).

### R.2 [MED] PostViewer comment+map buttons → extend GlassIconButton

- **Escopo:** GlassIconButton variant nova (`pill` ou `with-badge`) ou
  primitive separado (`GlassPillButton`).
- **Esforço:** 2-3h.
- **ROI:** elimina duplicação inline; consolida shadow-drift-md + glass
  surface pattern em 1 primitive.

### R.3 [MED] Sprint N+4 — strict-check de primitives 0-caller

- **Escopo:** lock-via-test `tests/primitive-adoption.test.ts` que
  detecta primitives exportados em `src/components/UI/` sem caller
  externo após N+30 dias da criação.
- **Esforço:** 4h (escrever o test + grace-period config).
- **ROI:** evita reincidência de HintToast/HintModal/DriftCard
  shelf-ware. Forçar discipline.

### R.4 [LOW] PostViewer.tsx 1044 LoC → split sub-files

- **Escopo:** PostViewer está beirando o threshold de "Deus-component".
  Possível extrair: `PostViewer/ActionsBar.tsx` (comment+map+⋮ buttons,
  ~120 LoC), `PostViewer/QueueOverlay.tsx`, etc.
- **Esforço:** 3-4h.
- **ROI:** legibilidade + isolamento de side-effects (long-press, ripple,
  swipe handlers interagem).

### R.5 [LOW] `DriftButton` variants `danger`/`danger-prominent` —
   decision: comment "RESERVED" vs purge

- **Escopo:** DriftButton.tsx + decisão sobre intencionalidade.
- **Esforço:** 15min.
- **ROI:** trade-off pequeno.

---

## Veto explícito — false positives confirmados

### V.1 `Collapse` primitive — 9 callers, MUITO usado

Grep mostrou 12 `<Collapse open=` hits em RelaySettings, ProfileModal,
App.tsx, SettingExplainer. Falso alarme inicial sobre "wrapper que
virou pass-through" — Collapse é primitive ativo crítico, justifica
CSS grid trick em vez de framer.

### V.2 `LayerRenderer` — usado em App.tsx mount

Single import em App.tsx:79 + render linha 1329. Sistema central de
layer-stack overlay. Não tocar.

### V.3 `MultiTabModal` componente em si — não é dead

(Sub-buttons sim podem migrar pra DriftButton — §4.5). O componente
é ativado quando OPFS detecta NoModificationAllowedError. Edge case
real (multi-tab conflict), não removível.

### V.4 Icons.tsx — 33 exports, todos usados ou near-used

Grep confirmou cada icon tem pelo menos 1 caller fora de Icons.tsx.
Não há icon órfão pra remover.

### V.5 `DriftSkeleton`, `DriftChip`, `DriftAlert`, `FullPageCard`,
   `SlideUpOverlay`, `ModalHeader`, `SectionHeader`, `AccordionGroup`,
   `RadioGroupButton`, `SettingExplainer`, `LazyBoundary`,
   `AppErrorBoundary`, `DialogHost`, `DotsIndicator`, `RelayTierBadge`,
   `AuthorChip`, `HintChip`, `PeerInterstitial`, `UpdatePrompt`,
   `DiscoverNudgeBanner`, `LensNudgeBanner`, `GpsErrorBanner`,
   `MapExplainerCard`, `LensInspector`, `NavBar`, `IdentitySwitcher`,
   `IdentityPanel`, `EditProfileCard`, `ProfileModal`, `ReplySheet`,
   `ReportModal`, `OnboardingOverlay`, `ComposeOverlay`, `ActionsFan`,
   `SwipeHandler`, `SubpostLayout`, `SubpostCarousel`, `ThreadHeader`,
   `ThreadView`, `FeedTabs`, `TimelineScrubber`, `SpreadMap`,
   `Image`, `LocalListsSettings`, `RelaySettings`, `SuaLenteCard`,
   `AppearanceCard`, `GuideCard`, `DiscoverRelaysCard`, `SettingsCards`,
   `DriftButton` (variants `primary`/`ghost`/`cancel`)

Todos têm ≥1 caller ativo confirmado. Não-removível.

### V.6 `prefs.ts:thread_view_mode` legacy case — manter (ver §1.3)

Pref legacy serialização. Manter por compat com user storage.

---

## Convergência com Barney (esperada)

Itens onde Ted (arquitetura) e Barney (peer review crítico / threat
model) devem convergir:

1. **`HintToast` / `HintModal` shelf-ware** — ambos vão flag. Barney
   pode chamar attention pra "dead component compreendido como
   "supportado" pode confundir auditor security".
2. **`GlassIconButton` `md`/`lg` sizes legacy** — Barney provavelmente
   flag como WCAG threat (trap pra novos contributors adotarem
   tap target sub-44px).
3. **`CommentCard` variant='card' render path** — ambos vão flag,
   mas Ted como dead code, Barney como bloat surface (atack-surface
   reduction).
4. **`DriftCard` shelf-ware** — Ted purge, Barney YAGNI.
5. **Comments `ContentSettings` stale** — Ted como dead reference,
   Barney como "doc rot misleading reviewer".

Itens onde Ted NÃO espera overlap:
- **CSS vars unused** — território puramente arquitetural Ted.
- **Tailwind aliases unused** — idem.
- **Inline class duplication PostViewer buttons** — refactor opportunity
  Ted, Barney provavelmente foca em comportamento.

Itens onde Barney pode flag E Ted NÃO:
- **JSX strings em comments mencionando "espalha/enterra"** — Ted
  vetou (contexto arquitetural útil). Barney pode arguir LOCK_VIA_TEST
  edge case, mas em comments o test ignora — convergente.
- **Threat de race condition em ActionsFan ⋮ menu** — fora do escopo Ted.
- **PostViewer 1044 LoC = atack-surface grande** — convergente com
  Ted §R.4 mas com framing diferente (manutenibilidade vs auditabilidade).

---

## Métrica final

- **Total findings:** 18 items distintos (12 high+med + 6 low/refactor)
- **LoC removível conservador (só HIGH + confirmados):**
  - CommentCard variant='card' render path: ~155
  - DriftCard shelf-ware: ~198
  - HintToast shelf-ware: 99
  - HintModal shelf-ware: 111
  - GlassIconButton sm/md/lg: ~25
  - themes.css unused vars: ~110
  - tailwind aliases: ~13
  - **Total: ~711 LoC**
- **LoC removível com refactor opportunities (R.1-R.5):** +200-300

**Headroom:** entry chunk atual 172 KB (hard ratchet 250 KB). Removendo
~700 LoC de UI shelf-ware é ganho de ~3-5 KB minified (rough estimate);
não é tail-cutting de bundle mas é **reduction de cognitive load** —
menos primitives no design system registry, menos variants no IntelliSense,
menos comments stale.

---

## Recomendação final

**Sprint N+3 (Satoshi "zero débito maduro") já cobre 3 itens**:
- Quick-wins #1, #2, #3, #4 da tabela acima (CommentCard, HintToast,
  HintModal, GlassIconButton sizes) — **executar nesse Sprint**.

**Sprint N+4 candidato**:
- Quick-wins #5, #6 (themes.css purge) — pede sign-off Robin v4
- R.1 decision (DriftCard purge vs force-adopt) — pede deliberação
  HIMYM+Satoshi

**Backlog**:
- R.2 (GlassPillButton extend), R.3 (primitive-adoption lock-via-test),
  R.4 (PostViewer split), R.5 (DriftButton danger variants RESERVED).

---

*Audit doc-only. Zero código alterado. Convergência com Barney audit
paralelo esperada nos pontos §4.2-4.3 (shelf-ware), §2.2 (WCAG threat),
§1.1 (dead branch surface). Itens não-overlap detalhados em §"Convergência".*
