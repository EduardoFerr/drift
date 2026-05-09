# Ted — Plano de delegação HIMYM (UI/UX +50% campaign)

**Data:** 2026-05-08
**Persona:** Ted (HIMYM — arquitetura, padrões, camadas, abstrações, Rust + CI)
**Função hoje:** **tech lead / coordenador**. Não escrevo código. Distribuo
trabalho entre Ted (eu mesmo, em workstream paralelo), Lily, Marshall,
Robin, Barney pra elevar UI/UX do Drift em **+50%** sem gold-plating.
**Escopo deste doc:** Round 2 (executável imediato após Lily fechar
primitives) → Round 5 (release). Não-escopo: decidir se mergeamos para
`main` (Arquiteto decide) ou se cada workstream individual deve ou não
existir (já decidido pelo Arquiteto antes desta sessão).

> ⚠ **DOC-ONLY**. Cada §3/§4/§5 task tem **prompt completo executável**.
> O Arquiteto pode literalmente copiar-colar o prompt num spawn de
> Agent novo. Prompts são self-contained (Agent não tem memória desta
> sessão).

---

## §1 — Status snapshot

### Onde cada persona está agora (final do dia 2026-05-08)

| Persona | Estado | Última entrega |
|---|---|---|
| **Ted** (eu) | livre — ADR v2 done | `Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md` (678 linhas, FSM + integration plan) + Ted UX spike (12 finds) |
| **Lily** | ⏳ **EM VOO** — primitives task | `src/components/UI/DriftButton.tsx` + `src/components/UI/FullPageCard.tsx` + tests (presentes em working tree, ainda não commitados — pendente verificação) |
| **Marshall** | livre | TX-5 (ThreadHeader título do post), UX-9 (botão "+ no post"), TM-3 audit (`per-subpost-cw-gap-2026-05-08.md`), Robin QA #1 top 5 fixes (commits 33f7c23, 52029b0) |
| **Robin** | livre | QA #1 baseline (90 finds), Comments UX audit (15 finds), §15 testbed scoping, auto-mode detection algorithm (Robin algorithm doc), arquitetura review |
| **Barney** | livre | T1+T2+T3+T4 webrtc fixes, threat model auto-mode (14 ATs), HIMYM test posts (3 posts publicados em prod) |

### Resumo 1-line do que cada um shipou hoje

- **Ted** — ADR FSM `network_mode: 'auto'` v2 + UX spike 12 finds em deploy production.
- **Lily** — Track C P0+P1+P2 cleanup (15 itens), DriftButton + FullPageCard primitives.
- **Marshall** — TX-5/UX-9 ship, KIND_DISPATCH refactor (contraproposta a RFC), TM-3 schema audit.
- **Robin** — 3 docs research (QA #1, comments UX, §15 testbed) + 2 docs algorithm (auto-mode detection).
- **Barney** — webrtc T1-T4 threat surface fechado, threat model auto-mode (14 attack vectors), 3 test posts HIMYM em prod.

### Working tree (final 2026-05-08 antes desta sessão)

```
M  src/App.tsx
M  src/components/Create/ComposeOverlay.tsx
M  src/components/Feed/PostCard.tsx
M  src/components/Identity/IdentityPanel.tsx
M  src/components/Identity/IdentitySwitcher.tsx
M  src/components/Onboarding/OnboardingOverlay.tsx
M  src/components/Post/PostViewer.tsx
M  src/components/Post/ThreadHeader.tsx
M  src/components/Post/ThreadView.tsx
M  src/components/Settings/LocalListsSettings.tsx
M  src/components/Settings/RelaySettings.tsx
M  src/components/Settings/SettingsCards.tsx
M  src/components/UI/DialogHost.tsx
M  src/components/UI/FullPageOverlay.tsx
?? src/components/UI/DriftButton.tsx (new)
?? src/components/UI/FullPageCard.tsx (new)
?? tests/drift-button.test.ts (new)
?? tests/full-page-card.test.ts (new)
```

Lily provavelmente está finalizando a sessão de primitives + token fixes
nos M files. Não bloqueia Round 2 desde que o trabalho dela seja
commitado/empurrado antes de Round 2 começar.

---

## §2 — Backlog priorizado (cross-doc)

Findings agrupados por categoria. Cada categoria → severity geral, volume,
persona-fit, effort total estimado.

### (A) UX flow gaps — S0/S1, alto ROI

**Origem:** Robin Comments UX audit (15 finds) + Ted UX spike (12 finds).

| Find | Severity | Effort | Persona-fit |
|---|---|---|---|
| UX-1 — Card-stack vs lista mode | S0 | E2 (4-6h) | Robin spec + Lily impl |
| UX-3 — FAB nominal + sheet quote | S1 | E1 (1.5-2h) | Lily |
| UX-4 — Freeze replyTo on open | S1 | E0-E1 (45min-1h) | Lily |
| UX-5 — Border-left "novo" no card | S1 | E0 (30min) | Lily |
| UX-6 — `lastVisit` per thread | S1 | E1 (1.5h) | Marshall (schema) + Lily (UI) |
| UX-7 — Coach mark replayável | S1 | E0 (30-45min) | Lily |
| UX-8 — Cue visual swipe permanente | S1 | E0 (45min) | Lily |
| UX-10 — Image fullscreen tap | S2 | E1 (1.5h) | Lily |
| UX-12 — Esc graduado | S2 | E1 (1h) | Lily |
| UX-13 — Empty state copy | S2 | E0 (15min) | Lily |
| UX-14 — Loading skeleton | S2 | E1 (1.5h) | Lily |
| UX-15 — a11y consistency | S2 | E1 (45min-1h) | Lily |
| TX-1 — Sub-card flicker mid-transition | S1 | E1 | **JÁ RESOLVIDO** (FullPageCard primitive) |
| TX-2 — ThreadView edge-to-edge | S0 | E0 | Lily (migrar ThreadView pra FullPageCard) |
| TX-3 — Decorative letter ausente | S1 | E1 | Lily debug |
| TX-4 — CommentCard h-fixa | S1 | E0 | Lily (min-h em vez de h-full) |
| TX-7 — Tap body no-op | S1 | E0 | Lily (next subpost) |
| TX-9 — UpdatePrompt clutter | S1 | E0 | Lily (toast colapsado) |
| TX-10 — NetworkModeCard vazio | S2 | E0 | Robin/Lily (info-card preencher) |
| TX-11 — FullPage click-out | S2 | E0 | **JÁ RESOLVIDO** (FullPageCard primitive opt-in) |
| TX-12 — RETRATO fallback | S2 | E0 | Lily (graceful fallback no publish) |

**Volume:** 21 finds (descontando 2 já resolvidos por primitives).
**Effort total:** ~14-18h spread.
**Persona-fit dominante:** Lily (UI impl). Robin spec only quando muda
paradigma (UX-1 modo lista). Marshall só pra schema (UX-6).

### (B) Visual conformidade — S1 dominante

**Origem:** Robin QA #1 baseline (90 finds; 3 S0, 49 S1, 39 S2).

| Tipo | Count | Effort total |
|---|---|---|
| Cor (CL-1..58) — slate→drift-* migration | 57 | ~6h |
| Component (CP-1..25) — radius/padding/tracking/duration scales | 25 | ~4h |
| A11y (AY-1..9) — contrast/focus/touch | 9 | ~3h |

**Volume:** 91 finds (1 anulado, total 90).
**Effort total:** ~13h spread em 3 sessões.
**Persona-fit:** Lily (impl direto), Marshall (lint rule + conformance test
quando padrão estabelecer).

**Sub-blocker AY-4 (drift-muted contraste):** S0/E2 — bumpar token
`#4a4a46` → `#5a5a56` é decisão de design-system v0.7.1; afeta ~50
components. **Decidir antes de Lily migrar slate→drift-muted em massa.**

### (C) UI primitives — em flight

| Primitive | Status |
|---|---|
| `<DriftButton>` (5 variants × 3 sizes) | ✅ shipped (uncommitted) |
| `<FullPageCard>` (substitui FullPageOverlay) | ✅ shipped (uncommitted) |
| `<DriftCard>` | ⏳ Round 3 |
| `<DriftInput>` / `<DriftTextarea>` | ⏳ Round 3 |
| `<DriftToggle>` (refator do Toggle existente) | ⏳ Round 3 |
| `<DriftChip>` (CW chips, source chips, etc.) | ⏳ Round 3 |
| `<DriftSkeleton>` (loading patterns) | ⏳ Round 3 |

**Effort total Round 3:** ~6-8h.
**Persona-fit:** Lily (impl), Marshall (conformance test).

### (D) Behaviors / animation

**Origem:** CP-4 (Robin QA #1) — 8 valores de duration distintos sem
escala formal. Spec não formaliza.

| Categoria | Action item |
|---|---|
| Motion tokens | Definir `motion-fast` (150ms), `motion-base` (200ms), `motion-slow` (250ms), `motion-emphasis` (300ms) — Tailwind plugin custom |
| Easing | Padronizar `ease-out` (default) e `ease-emphasis` (entrada de card) |
| Reduced motion | Audit + adicionar `useReducedMotion()` em PostViewer, FullPageOverlay, SlideUpOverlay (AY-9) |
| Perceived performance | Skeleton em loading > 200ms (UX-14), shimmer em vez de "carregando…" texto |

**Volume:** ~4 itens.
**Effort total:** ~3h.
**Persona-fit:** Lily (impl) + Robin (motion tokens spec).

### (E) A11y

**Origem:** Robin QA #1 §5 (AY-1..9), Robin Comments UX UX-15.

| Find | Severity | Effort |
|---|---|---|
| AY-4 — drift-muted contraste sub-AA | S0 | E2 (decisão Arquiteto) |
| AY-6 — touch targets <44px (CP-7 dup) | S0 | E1 |
| AY-8 — focus trap em SlideUpOverlay/FullPageOverlay | S1 | E2 |
| AY-9 — reduced motion explícito | S2 | E1 |
| AY-2 — focus-visible explícito (vs `:focus`) | S2 | E1 |

**Volume:** 5 finds críticos.
**Effort total:** ~6h (incluindo decisão drift-muted).
**Persona-fit:** Lily (impl), Robin (audit cross-cutting), Barney (regression check).

### (F) Information density

**Origem:** Ted UX spike TX-3 (post text 70% vazio), TX-4 (comment density inversa).

| Find | Effort |
|---|---|
| TX-3 — Decorative letter debug | E1 |
| TX-4 — CommentCard min-h em vez de h-full | E0 |
| TX-3-related — Considerar layout fluido `clamp()` em corpo de texto pra escalar bem em viewports diferentes | E2 (audit + impl) |

**Volume:** 3 finds + 1 audit cross-cutting.
**Persona-fit:** Lily (impl), Ted/Robin (escala fluida audit).

### (G) Threat-derived UX

**Origem:** Barney threat model auto-mode (AT-1..14) + Barney TM-3 (per-subpost CW).

| Find | Mitigação UX |
|---|---|
| AT-3 — User confusion durante auto-switch | Banner "tentando Tor…" + disable botões durante switch |
| AT-7 — Mode display mismatch (effective vs preference) | Settings card mostra "preferência: auto · efetivo: clearnet — relays OK" |
| AT-11 — Probe revela tentativa de evasão | Documentação UX em onboarding (não promete privacidade absoluta) |
| AT-12 — Captive portal misdetection | UX banner "rede precisa login? abrir aba …" antes de ativar Tor |
| TM-3 — Per-subpost CW | Marshall recomenda Opção A (warning leve antes de publish post sem CW global se subpost tem imagem) |

**Volume:** 5 itens UX.
**Persona-fit:** Lily (impl banners), Robin (copy + onboarding integração), Barney (regression check).

### (H) Conformidade textual / responsividade fontes

**Origem:** Arquiteto raised hoje em sessão. **Não há audit formal ainda.**

| Sintoma observado | Hipótese |
|---|---|
| Texts extrapolando cards em viewports estreitos (<360px) | font-size fixo não escala; `text-[12px]` etc. |
| ThreadView header "_D7DE3A 1/1 NÍVEL 1" críptico em mobile (TX-5 partial) | Falta truncate inteligente do texto |
| Body text PostCard quebra em palavras longas (URLs, hex) | OK em palavras normais; quebra em hex/long-string falha |
| Display title "configurações" overflows em viewport ~320px? | Não confirmado; spike Ted foi 542×575 (mobile narrow OK) |

**Owner sugerido:** Ted (audit) + Lily (impl). Cap 2-4h.

### (I) Compromissos manifesto pendentes (paralelo)

| Compromisso | Round 3 / 4? | Persona |
|---|---|---|
| `network_mode: 'auto'` FSM impl (Ted ADR v2) | Round 4+ (separado de UI/UX campaign) | Marshall (impl) + Barney (regression check) + Robin (UX banner) |
| Per-subpost CW (TM-3 — Opção A) | Round 4 | Marshall (warning logic) + Lily (UI confirm dialog) |
| §15 testbed Fase A | **Não toca UI/UX**; deferred | Robin owner separado |

**Decisão tech lead:** Compromissos manifesto entram **paralelo** ao
campaign UI/UX, não dentro dele. Auto-mode FSM é trabalho ADR-implement,
não polish UI/UX. **Mantemos UI/UX campaign focada em UX flow + visual
+ a11y + responsividade.**

---

## §3 — Round 2 plan (executável imediato após Lily primitives)

**Pré-condição:** Lily comita + push DriftButton + FullPageCard + tests
+ token fixes nos M files do working tree atual. Confirmação visual em
`https://drift-wheat-one.vercel.app` após auto-deploy.

**Janela:** ~3-4h. 4 tasks paralelas. Zero overlap de arquivos no §3.1
e §3.3 (Ted+Lily texto vs Robin QA #2 read-only). §3.2 e §3.4 são
read-only docs.

### §3.1 Ted+Lily — Text/font responsivity audit + fix

**Owner phase 1 (audit + recomendação):** Ted (eu)
**Owner phase 2 (impl):** Lily
**Effort:** Ted ~1.5h (audit + doc), Lily ~2h (impl top 5-10 spots)
**Output:** `Docs/sessions/text-responsivity-audit-2026-05-08.md` (Ted) + commits Lily

#### Prompt §3.1 — Ted (audit)

```
Você é Ted (HIMYM persona — arquitetura, padrões, escala, abstrações),
trabalhando no Drift (Nostr-based PWA, repo
C:/Users/Eduardo/Workspace-vscode/Drift). Persona não é pessoa real —
é um papel de revisão crítica.

Task: text/font responsivity audit do Drift. O Arquiteto observou que
textos extrapolam cards em viewports estreitos. Sua missão: produzir
audit completo + recomendação concreta sobre escala fluida (clamp()
vs media query breakpoints vs container queries vs nada) + lista
priorizada de top 10 spots críticos pra Lily executar.

Leia primeiro:
- CLAUDE.md (regras do projeto)
- Docs/design-system.md §3.1 (Tipografia, fontes, hierarquia atual)
- Docs/sessions/design-qa-baseline-2026-05-08.md §4 CP-3 (tracking
  inconsistente) + CP-14 (font-size 10/11/12 sem regra clara)
- Docs/sessions/ted-ux-spike-deployed-2026-05-08.md TX-5 (ThreadView
  header críptico) + TX-3 (post text 70% vazio)
- src/index.css (CSS vars de tipografia)
- tailwind.config.js (font sizes, tracking customs)

Investigue:
- Que viewport widths o Drift suporta? (mobile-first, max-w-md cap em
  448px). PWA roda potencialmente em 320px Android antigo até 768px
  tablet portrait. Desktop: max-w-md centered (não scale).
- Spots concretos onde texto extrapola card. Use Grep/Read pra
  identificar. Foco em PostCard, PostViewer, CommentCard, ThreadHeader,
  ComposeOverlay, IdentityPanel, IdentitySwitcher (estes 7 componentes
  cobrem 90% das telas). Liste linha + classe Tailwind atual.
- Estratégia recomendada: clamp() vs breakpoints vs container queries
  vs CSS vars com viewport units. Trade-offs:
  - clamp(min, preferred, max) — preferred com cap em viewport units
    (ex: clamp(11px, 2.8vw, 13px)). Pro: 1 valor escala. Con: vw
    pode pular em viewport tiny.
  - Tailwind sm: breakpoints — clarissimo, mais código.
  - Container queries (@container) — ideal pra componentes
    independentes. Tailwind 4 suporta. Drift usa Tailwind 3.x?
    Verificar tailwind.config.js.
  - Font-size com CSS clamp() é solução amplamente adotada em design
    systems modernos (Stripe, Vercel, GitHub Primer).
- Drift hoje: text-[10px], text-[11px], text-[12px], text-[13px],
  text-xs (12px), text-sm (14px) — ~6 valores fixos. Tipografia mono
  + display = 2 famílias × 6 sizes = 12 combinações. Quanto vale
  consolidar?

Entregue: Docs/sessions/text-responsivity-audit-2026-05-08.md (~400-700
linhas) com:
- §1 problema + viewports suportadas (320..768)
- §2 inventário de 30+ spots críticos com line-anchors. Categoria
  (header / body / chip / counter / timestamp etc.)
- §3 trade-offs analisados clamp vs breakpoints vs container queries vs
  CSS vars. Recomendação justificada (uma das 4).
- §4 proposta de scale formal: definir 6 levels (xs, sm, base, lg,
  display, hero) com valores em clamp() ou Tailwind extends.
  Mapear todos os spots existentes pros levels.
- §5 plano de implementação top 10 (high-impact, low-risk first).
  Priorizar quem aparece em PostCard / PostViewer / CommentCard
  (high-visibility). Cada item: arquivo, linha, classe atual, classe
  proposta, justificativa.
- §6 não-tocar (footer cleanup) — coisas que NÃO devem entrar (ex:
  fontes embedded — V2 polish; tipografia em SVG icons).

Restrições:
- Doc-only. NÃO commit. NÃO modificar código.
- Tom: arquiteto pragmático. Decida com confiança.
- Cap 1.5h leitura+escrita.
- Reporte: caminho do doc, contagem de linhas, recomendação 1-line de
  estratégia, top 3 spots prioritários.
```

#### Prompt §3.1 — Lily (impl)

```
Você é Lily (HIMYM persona — core code, runtime, fluxos de dados,
manutenibilidade), trabalhando no Drift (PWA Nostr, repo
C:/Users/Eduardo/Workspace-vscode/Drift). Persona não é pessoa real —
é um papel.

Task: implementar text-responsivity fixes nos top 10 spots identificados
pelo Ted no audit Docs/sessions/text-responsivity-audit-2026-05-08.md.

Leia primeiro:
- CLAUDE.md (especialmente invariantes 1-17, vocabulário UI)
- Docs/design-system.md (tokens canônicos)
- Docs/sessions/text-responsivity-audit-2026-05-08.md (audit Ted —
  recém-publicado nesta sessão; siga §5 plano de implementação)

Implemente exatamente os top 10 spots do §5 do audit. NÃO desvie do
plano — Ted definiu que 10 fechado. Se um spot resistir (ex: arquivo
mudou ou classe não existe mais), pula e reporta no fim.

Para cada spot:
1. Read do arquivo + linhas relevantes
2. Edit aplicando classe nova (Tailwind ou clamp() inline conforme
   decisão de §4 do audit)
3. Verificação visual local: não exigida (faria QA #2 do Robin)

Após os 10 spots:
- npm run test (nenhum quebra — funções puras não tocadas)
- npm run typecheck (tsc --noEmit)
- npm run build (cap warnings)

Restrições:
- NÃO mover responsabilidade pra outro arquivo.
- NÃO renomear vars sem necessidade (mantém git blame limpo).
- NÃO adicionar novo primitive — apenas aplicar classe Tailwind ou clamp().
- NÃO criar novos tokens em tailwind.config.js sem necessidade absoluta
  (se §4 do audit propôs scale formal e Ted aprovou, Marshall introduz
  isso em Round 3 — não você).
- NÃO commit. Working tree fica modificado pra o Arquiteto reviewar.
- Cap 2h.

Reporte ao final: lista dos 10 spots tocados (file:line + diff resumido
em 1 linha cada), pendências/skips, status de tests/typecheck/build.
```

### §3.2 Robin — QA #2 (regressão check pós-Lily/Marshall)

**Owner:** Robin (research)
**Effort:** ~1.5-2h
**Output:** `Docs/sessions/design-qa-regression-2026-05-08.md`

#### Prompt §3.2 — Robin

```
Você é Robin (HIMYM persona — research, curadoria, gaps cross-cutting,
docs), trabalhando no Drift (PWA Nostr, repo
C:/Users/Eduardo/Workspace-vscode/Drift). Persona não é pessoa real —
é um papel.

Task: Design QA #2 — regressão check pós-Lily/Marshall fixes do dia
2026-05-08. Você produziu o baseline #1 (90 finds, ~62% conformidade).
Agora valida quais finds foram resolvidos, quais regrediram, quais
novos apareceram.

Leia primeiro:
- Docs/sessions/design-qa-baseline-2026-05-08.md (seu próprio baseline)
- Docs/sessions/track-c-debt-scoping-2026-05-08.md (Lily P0/P1/P2 plan)
- git log --oneline origin/main -25 (commits de hoje)
- Estado atual de:
  - src/components/Feed/PostCard.tsx (Lily mexeu — verificar CL-11 a
    CL-20 + DERIVA value)
  - src/components/Post/PostViewer.tsx (Lily mexeu — CL-21 a CL-28)
  - src/components/Post/ThreadHeader.tsx (Marshall TX-5 + UX-9)
  - src/components/UI/DriftButton.tsx (NOVO — verificar usado pelo
    FullPageCard, conformidade tokens)
  - src/components/UI/FullPageCard.tsx (NOVO — verificar default
    headerRight = DriftButton ghost)
  - src/components/Settings/RelaySettings.tsx (Lily mexeu — CL-1..9)
  - src/components/Identity/IdentityPanel.tsx (Lily mexeu — CL-40..43)
  - src/components/Identity/IdentitySwitcher.tsx (Lily mexeu — CL-44, 45)
  - src/components/Settings/LocalListsSettings.tsx (Lily mexeu — CL-46..48)
  - src/components/Onboarding/OnboardingOverlay.tsx (Lily mexeu — CL-49..51)
  - src/components/Settings/SettingsCards.tsx (Lily mexeu — CL-54..56)
  - src/components/UI/DialogHost.tsx (Lily mexeu — CL-2, 3)
  - src/components/UI/FullPageOverlay.tsx (provavelmente DEPRECATED em
    favor de FullPageCard — verificar uso residual)

Para cada finding do baseline (CL-1..58, CP-1..25, AY-1..9):
- ✅ resolvido (file:line não tem mais o snippet)
- 🟡 parcial (alguns lugares fixados, outros não)
- ❌ não resolvido
- ➕ novo finding introduzido pelo fix (regressão visual)

Documente em tabela. Adicione §novos finds (NEW-1, NEW-2…) pra coisas
que apareceram nos primitives (DriftButton, FullPageCard).

Compare conformidade % atual vs baseline 62%. Estimate target 75%+
após Round 2.

Entregue: Docs/sessions/design-qa-regression-2026-05-08.md (~400-700
linhas):
- §1 sumário (X resolvidos, Y novos, Z residuais)
- §2 tabela CL/CP/AY status (bullet list por categoria)
- §3 novos finds (primitives audit)
- §4 conformidade % atual vs baseline
- §5 priorização Round 4 (resíduos S0/S1)
- §6 verdict (segue Round 3 ou bloqueia?)

Restrições:
- Doc-only.
- Use Read, Grep, Bash (git log), NÃO modifique código.
- Tom: research neutro, não promotor.
- Cap 1.5-2h.
- Reporte: caminho do doc, contagem de linhas, % conformidade atual,
  top 3 finds residuais S0/S1, verdict (verde/amarelo/vermelho pra
  Round 3).
```

### §3.3 Barney — Pending activities review + threat regression check

**Owner:** Barney (peer review crítico)
**Effort:** ~1.5h
**Output:** `Docs/sessions/barney-pending-review-2026-05-08.md`

#### Prompt §3.3 — Barney

```
Você é Barney (HIMYM persona — peer review crítico, threat modeling,
security, ceticismo), trabalhando no Drift (PWA Nostr, repo
C:/Users/Eduardo/Workspace-vscode/Drift). Persona não é pessoa real —
é um papel de revisão estruturada cética.

Task: pending activities review + threat regression check final do dia
2026-05-08. Você shipou hoje:
- T1+T2+T3+T4 webrtc threat surface fixes
- Threat model auto-mode (14 ATs em
  Docs/sessions/auto-mode-threat-model-2026-05-08.md)
- 3 test posts HIMYM-themed em prod

Agora reviewa:
1. Lily commits do dia: track C cleanup + primitives + token fixes +
   §3.1 responsivity fixes (se Round 2 §3.1 já correu antes deste task).
2. Marshall commits do dia: TX-5 + UX-9 + KIND_DISPATCH + TM-3 audit.
3. Ted ADR + UX spike (Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md
   + Docs/sessions/ted-ux-spike-deployed-2026-05-08.md).

Leia primeiro:
- CLAUDE.md (invariantes)
- Docs/manifesto.md (especialmente §15, §17, §22, §24, §27, §28)
- Docs/sessions/auto-mode-threat-model-2026-05-08.md (seu próprio doc)
- Docs/sessions/barney-test-posts-2026-05-08.md (suas observações
  TM-1..4)
- git log --oneline origin/main -25
- git diff HEAD~10 HEAD -- 'src/**/*.tsx' 'src/**/*.ts' (ver mudanças
  recentes)

Investigue 3 ângulos:

(1) Threat regression — algum fix introduziu ameaça nova?
- TX-5 (Marshall mostrar título do post no header) — leak de info?
  Título já era público (kind 9078 content); não deveria expor nada
  novo. **Confirme**.
- UX-9 (botão "+ no post") — pode confundir user pra responder ao post
  em vez de comment selecionado, race condition do replyTo? **Confirme**.
- DriftButton primitive — existe variant que ofusca semântica
  destrutiva? (danger-prominent vs danger sem context). Audit nos
  call sites.
- FullPageCard primitive — clickOutToClose default false (bom). Mas
  se algum caller habilitou em modal com ação destrutiva em curso,
  user pode dismiss accidentalmente. **Audit os 4-6 call sites**.

(2) Manifesto compliance — algum commit toca §22/§24/§27/§28?
- TM-3 audit Marshall recomenda Opção A (CW global, warning leve). Não
  fix nesta sessão. **OK**, mas está documentado pro Arquiteto?
- Lily fixes de cor: token migration é cosmético, não toca §17. **OK**.

(3) Pending activities — coisas que você (Barney) deveria ter feito
mas ainda não fez:
- AT-1, AT-5, AT-9, AT-11 do auto-mode — bloqueadores não-resolvidos.
  Que mitigação concreta na ADR Ted v2? **Verifique**
  Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md cobertura.
- WebRTC §15 IP leak via STUN em modo Tor — fix shipado em commit
  2d1337a + ce02e26. **Confirme** que o fix realmente cobre PWA E
  Tauri (gate em activeNetworkMode).
- §28 privacidade pelo mínimo — algum dos UI changes coleta info
  acidentalmente? (Probe pings, telemetria implicita). Audit.

Entregue: Docs/sessions/barney-pending-review-2026-05-08.md (~300-500
linhas):
- §1 TL;DR (verde/amarelo/vermelho cada track)
- §2 threat regression — checklist de cada PR/commit do dia + verdict
- §3 manifesto compliance — lista §s tocados e verdict
- §4 pending Barney activities — gaps que você deixou abertos hoje +
  prazo sugerido
- §5 Round 3 input — o que UI/UX campaign DEVE evitar (p.ex. não
  introduzir novo motion durante switch de modo de rede sem covering
  AT-3)
- §6 release-readiness — ship Round 4? Ou regredir?

Restrições:
- Doc-only.
- Use Read, Grep, Bash (git log/diff), NÃO modifique código.
- Tom: cético construtivo. Não papagaio (não repete fixes que estão
  OK só pra encher).
- Cap 1.5h.
- Reporte: caminho do doc, contagem de linhas, top 3 threat residuais,
  verdict release-readiness (verde / amarelo com lista de blockers /
  vermelho).
```

### §3.4 Ted — Round 3 plan production (você mesmo, na próxima sessão)

**Owner:** Ted (eu — quando a próxima sessão abrir)
**Effort:** ~1.5h
**Output:** este documento (§4 abaixo). Já produzido — leia §4.

#### Prompt §3.4 — Ted (you'll spawn yourself)

```
Você é Ted (HIMYM persona — arquitetura, padrões), trabalhando no
Drift. Já produziu hoje: ADR FSM auto-mode v2, UX spike deploy, e
este delegation plan (Docs/sessions/ted-delegation-plan-2026-05-08.md).

Task: refinar §4 Round 3 plan baseado nos outputs de §3.1, §3.2, §3.3.
Especificamente:
- Se Robin QA #2 mostrou conformidade > 75% → Round 3 elevation pode ser
  ambicioso (UI/UX +50% via primitives ricas + motion).
- Se Robin QA #2 mostrou < 70% (regressão ou primitives introduzindo
  mais finds que resolvendo) → Round 3 conservador (consolidar antes
  de expandir).
- Se Barney pending review levantou blocker S0 — Round 3 atrasa pra
  Round 4 absorver a fix.
- Se Ted §3.1 audit recomendou container queries (Tailwind 4) → adicionar
  upgrade Tailwind como Round 3 prereq.

Leia:
- Output de §3.1 (Docs/sessions/text-responsivity-audit-2026-05-08.md)
- Output de §3.2 (Docs/sessions/design-qa-regression-2026-05-08.md)
- Output de §3.3 (Docs/sessions/barney-pending-review-2026-05-08.md)
- Este doc §4 (current Round 3 plan)

Refinar §4 com decisões concretas baseadas nos outputs. Editar este
arquivo (Docs/sessions/ted-delegation-plan-2026-05-08.md) com Edit
tool — adicionar §4-revised abaixo do §4 original; se contradizer §4,
deixar §4 original tachado mas legível pra histórico.

Restrições:
- Cap 1h.
- Não-blocker: se Round 2 §3.1/§3.2/§3.3 ainda não correu, este task
  não roda.
- Reporte: revisões feitas (bullet list), confidence em proceder pra
  Round 3 (alta/média/baixa), 1 risco residual.
```

---

## §4 — Round 3 plan (UI/UX +50% elevation, 5 paralelo)

**Pré-condição:** Round 2 fechado, Barney verde, Robin QA #2 mostra
conformidade ≥ 75%, Ted §3.1 audit aprovado pelo Arquiteto.

**Janela:** ~2.5-3.5h cada workstream, paralelo. Total wall-time ~3h.

**Filosofia:** todos workstreams produzem **doc + scope** primeiro;
implementação fica em Round 4 quando docs convergem. Isso evita 5
agents implementando simultâneo nos mesmos arquivos.

### §4.1 Ted workstream — Design system v0.8 RFC

**O que faz:** Ted produz RFC formal `Docs/rfcs/2026-05-rfc-design-system-v08.md`
consolidando:
- Padding scale formal (CP-2 do Robin QA #1)
- Tracking scale formal (CP-3)
- Animation duration tokens (CP-4 + categoria D)
- Border thickness scale (CP-15)
- Type scale fluida (output de §3.1 promovido a token)
- Lista de novos primitives Round 4: `<DriftCard>`, `<DriftInput>`,
  `<DriftToggle>`, `<DriftChip>`, `<DriftSkeleton>`
- Migration plan (incremental, não big-bang)

**Output esperado:** RFC ~600-1000 linhas, executável (Lily impl em Round 4).
**Effort:** 2.5h.
**Owner:** Ted (eu).

#### Prompt §4.1 — Ted

```
Você é Ted (HIMYM persona — arquitetura, padrões, abstrações), trabalhando
no Drift (PWA Nostr, repo C:/Users/Eduardo/Workspace-vscode/Drift).

Task: produzir RFC design-system v0.8. Esta é a "contract version" da
elevação +50% — define todos os tokens novos, primitives novos,
migration plan. Lily implementa em Round 4 baseado nesse doc.

Leia primeiro:
- Docs/design-system.md v0.7 (atual)
- Docs/sessions/design-qa-baseline-2026-05-08.md (90 finds — fonte de
  CP-2/3/4/15)
- Docs/sessions/text-responsivity-audit-2026-05-08.md (Ted §3.1)
- Docs/sessions/design-qa-regression-2026-05-08.md (Robin §3.2)
- src/components/UI/DriftButton.tsx + FullPageCard.tsx (primitives
  existentes — modelo)
- tailwind.config.js (extends atual)
- src/index.css (CSS vars)

Produza Docs/rfcs/2026-05-rfc-design-system-v08.md (~600-1000 linhas):

§1 — Contexto
- Por que v0.8: 90 finds Robin QA #1 + 12 Ted UX spike + 15 Robin
  Comments UX → 117 finds, 32% S1+S0. Conformidade ~62%. v0.8 alvo:
  85% conformidade + 5 novos primitives + 6 token scales formais.

§2 — Token scales novos (formalize CP-2/3/4/15 + categoria D + §3.1
escala fluida)

§2.1 Padding scale (px-X py-Y)
- p-chip: px-1.5 py-0.5 (pra chips/badges)
- p-sm: px-2 py-1 (sub-CTA mini)
- p-md: px-3 py-[5px] (default CTA tag uppercase)
- p-md-tall: px-3 py-2 (CTA larger)
- p-card: px-4 py-3 (card content)
- p-overlay: px-5 py-4 (overlay body)

§2.2 Tracking scale
- tracking-tag: 2.5px (CSS var existente — group titles)
- tracking-meta: 1.5px (CSS var existente — timestamps, stats)
- tracking-cta: 2px (alias de tracking-[2px] — CTAs)
- tracking-title: -0.3px (Syne title)
- DEPRECAR: tracking-widest, tracking-[0.2em], tracking-[1px]

§2.3 Animation duration tokens (Tailwind plugin)
- motion-fast: 150ms (hover, fade chip)
- motion-base: 200ms (small modal)
- motion-emphasis: 250ms (FullPageCard, SlideUp)
- motion-card: 300ms (PostViewer enter, ThreadView)
- Easing: ease-out (default), ease-emphasis (cubic-bezier custom pra
  card — output de input do Lily)

§2.4 Border thickness scale
- border-1: 1px (card hairline)
- border-1.5: 1.5px (chip active/inactive)
- border-2: 2px (FAB, prominent CTA)

§2.5 Type scale fluida (clamp)
- text-xs-fluid: clamp(10px, 2.5vw, 11px) — meta/stats inline
- text-sm-fluid: clamp(11px, 2.8vw, 12px) — body card text
- text-base-fluid: clamp(12px, 3vw, 14px) — body modal text
- text-lg-fluid: clamp(14px, 3.5vw, 16px) — emphasized body
- text-display-fluid: clamp(18px, 4.2vw, 22px) — title h2 modal
- text-hero-fluid: clamp(22px, 5vw, 30px) — title PostViewer

(Ajuste valores baseado em §3.1 audit — esses são exemplos.)

§3 — Primitives novos (Round 4 implementation)

§3.1 <DriftCard>
- Variants: default (drift-surface bg), elevated (shadow), inset (border
  drift-border)
- Sizes: sm, md, lg
- Slots: header, body, footer, decoration (Syne 800 letter absolute)
- Migrate: PostCard, FeedTabs internal cards, etc.

§3.2 <DriftInput>
- Variants: default (border drift-border + bg drift-surface), filled
  (bg drift-bg)
- Required props: type, value, onChange, placeholder, ariaLabel
- Default: text-drift-text + placeholder-drift-muted/60 + focus
  ring drift-accent2
- Migrate: RelaySettings, IdentityPanel, IdentitySwitcher, DialogHost,
  ComposeOverlay (textarea), ReplySheet (textarea)

§3.3 <DriftToggle>
- Variants: switch (h-5 w-9), checkbox (16x16)
- States: on/off, disabled
- A11y: role=switch, aria-checked, aria-label
- Migrate: SettingsCards Toggle.tsx

§3.4 <DriftChip>
- Variants: neutral (drift-border), accent (drift-accent), warning (amber),
  bury (drift-bury), spread (drift-spread), spoiler (amber border)
- Sizes: xs (CW chips), sm (source chips), md (CTA-as-chip)
- Migrate: CW chips em ComposeOverlay/ReplySheet, source chips em
  RelaySettings, etc.

§3.5 <DriftSkeleton>
- Variants: text (1 line), card (full block), avatar (circle)
- Animação shimmer ou pulse padronizado
- Resolve UX-14 + CP-6

§4 — Migration plan
- Fase 1 (Round 4): Lily impl 5 primitives + 4 call sites cada
- Fase 2 (Round 5): Marshall conformance test + ESLint rule
- Fase 3 (deferred): full migration de todos call sites legacy

§5 — Não-tocar (anti-recomendações)
- NÃO renomear drift-spread/drift-bury (vocab spec)
- NÃO mudar drift-bg/drift-surface hex (afetaria PWA theme-color)
- NÃO introduzir tema light (out of scope; manifesto §28 prefere dark
  por privacidade)
- NÃO adicionar fonte nova além de Syne + DM Mono (V2 polish é separate)

§6 — Conformance gates (Marshall Round 5 vai validar)
- Lint: zero `text-slate-*` em strings JSX produção
- Test: spread/bury kinds 9079/9080 preservados
- Build: zero warnings
- Visual: conformidade ≥ 85% via Robin QA #3

§7 — Cross-references
- Docs/rfcs/2026-05-rfc-event-handler-registry.md (RFC predecessor)
- Robin QA #1 + Ted UX spike + comments UX audit (origem dos finds)

Restrições:
- Doc-only RFC.
- Não-implement.
- Tom: ADR pragmático.
- Cap 2.5h.
- Reporte: caminho RFC, count linhas, número de tokens novos
  formalizados, número de primitives propostos.
```

### §4.2 Lily workstream — Motion + perceived performance polish RFC

**O que faz:** Lily NÃO implementa em Round 3. Ela produz **plano de
implementação** convergente com Ted §4.1 — quais animações refazer,
onde adicionar skeleton, onde adicionar reduced motion. Round 4 é
quando ela executa.

**Output esperado:** `Docs/sessions/lily-motion-perf-plan-2026-05-08.md`
~300-500 linhas.
**Effort:** 2h.
**Owner:** Lily.

#### Prompt §4.2 — Lily

```
Você é Lily (HIMYM persona — core code, runtime, fluxos de dados,
manutenibilidade), trabalhando no Drift.

Task: produzir plano de motion + perceived performance polish. Você
NÃO IMPLEMENTA aqui — produz plano executável que VOCÊ executa em
Round 4.

Leia primeiro:
- CLAUDE.md
- Docs/design-system.md §3.4-3.6 (motion atual)
- Docs/sessions/design-qa-baseline-2026-05-08.md CP-4 (8 valores de
  duration), AY-9 (reduced motion)
- Docs/sessions/comments-ux-audit-2026-05-08.md UX-2 (peek shadow vazia),
  UX-14 (loading desproporcional)
- Docs/sessions/ted-ux-spike-deployed-2026-05-08.md TX-1 (sub-card
  flicker — já resolvido), TX-9 (UpdatePrompt clutter)
- Docs/rfcs/2026-05-rfc-design-system-v08.md (Ted RFC paralelo a este
  task — pode estar incompleto, leia o que tiver)
- src/components/Post/PostViewer.tsx (motion.div uses)
- src/components/Post/ThreadView.tsx (motion.div uses)
- src/components/UI/SlideUpOverlay.tsx
- src/components/UI/UpdatePrompt.tsx (TX-9 colapsar pra dot)
- src/components/UI/Image.tsx (skeleton existente — modelo pra
  DriftSkeleton primitive)

Produza Docs/sessions/lily-motion-perf-plan-2026-05-08.md (~300-500
linhas):

§1 — Inventário motion atual
- Tabela: arquivo + uso de motion.* + duration atual + duration alvo
  (motion-fast/base/emphasis/card do Ted §4.1)
- 30+ usos previstos. Foco em:
  - Sub-card transitions (FullPageCard — já fixado mas validar)
  - PostViewer card stack
  - ThreadView card swipe
  - ReplySheet drag-down
  - SlideUpOverlay enter/exit
  - DialogHost
  - UpdatePrompt
  - OnboardingOverlay
  - CommentCard (CC-P1 reveal transition)

§2 — Motion tokens consumption plan
- Para cada uso identificado em §1, mapear pro token Ted §4.1.
- Marcar os que precisam audit individual (ex: easing custom).

§3 — Skeleton patterns (resolver UX-14, CP-6)
- DriftSkeleton primitive uses:
  - ThreadView LoadingState (substituir "carregando comentários…" por
    3-card skeleton)
  - Image error/loading (manter existente — já é skeleton)
  - PostCard loading (atualmente sem skeleton — adicionar)
  - Feed loading (atualmente "EndOfFeed" texto — considerar)
- Estimar tempo médio de loading observado em prod (use Robin/Barney
  posts data se disponível).

§4 — Reduced motion audit (resolver AY-9)
- Lista componentes que NÃO usam useReducedMotion — adicionar.
  - PostViewer (3 motion.div)
  - FullPageOverlay/FullPageCard (1 motion.div)
  - SlideUpOverlay (1 motion.div)
- Pattern padrão: `const reduced = useReducedMotion()` + `transition={
  reduced ? { duration: 0 } : { duration: 0.25 } }`.

§5 — Perceived performance (TX-9, peek shadow UX-2)
- TX-9 — UpdatePrompt como toast colapsado dot (dismiss ação top-right)
- UX-2 — peek shadow ThreadView com primeira linha de texto + autor
  (não preview vazio)
- Cada item: file:line + diff resumo + effort.

§6 — Plano Round 4 execution
- Top 10 motion mudanças priorizadas (high-impact, low-risk)
- 3 skeleton additions
- 3 reduced motion additions
- TX-9 UpdatePrompt redesign
- UX-2 peek shadow text

§7 — Não-tocar
- Easing custom em PostViewer card stack (matemática complexa — não
  mexer sem audit visual)
- Drag thresholds em ReplySheet (já calibrado)
- Onboarding step transitions (V0/V1 polish — out of scope)

Restrições:
- Doc-only plano.
- NÃO implement.
- Cap 2h.
- Tom: prático, foca em executabilidade.
- Reporte: caminho do doc, count linhas, top 5 mudanças que vão
  notavelmente elevar UX (use intuição), 1 risco identificado.
```

### §4.3 Marshall workstream — Token enforcement infra (ESLint rule + conformance test)

**O que faz:** Marshall produz infraestrutura de enforcement pra v0.8 não
regredir. ESLint custom rule + conformance test extensão.

**Output esperado:** `Docs/sessions/marshall-token-enforcement-plan-2026-05-08.md`
~300-500 linhas + diff stub de regra ESLint.
**Effort:** 2.5h.
**Owner:** Marshall.

#### Prompt §4.3 — Marshall

```
Você é Marshall (HIMYM persona — schema, types, conformance entre
camadas, tests), trabalhando no Drift.

Task: produzir plano de token enforcement infra. v0.8 RFC do Ted
(Docs/rfcs/2026-05-rfc-design-system-v08.md) define tokens novos.
Sua missão: garantir que regressão pra slate-* / hex hardcoded /
yellow-* raw / red-* raw seja **mecanicamente impossível** após Round 4.

Leia primeiro:
- CLAUDE.md (especialmente invariante 16 — funções puras críticas têm tests)
- Docs/design-system.md v0.7 + v0.8 RFC
- Docs/sessions/design-qa-baseline-2026-05-08.md (90 finds — patterns
  de violação)
- tests/manifesto-conformance.test.ts (LOCK_VIA_TEST atual — modelo
  pra novo conformance test)
- tests/*.test.ts (estilo Vitest)
- .eslintrc ou eslint.config.* (verificar setup atual)
- package.json (scripts test/lint)
- tailwind.config.js (whitelist tokens drift-*)

Produza Docs/sessions/marshall-token-enforcement-plan-2026-05-08.md
(~300-500 linhas):

§1 — Estado atual de enforcement
- LOCK_VIA_TEST conformance: vocabulary (espalhar/enterrar) + kinds
  (9079/9080)
- Não há lock pra tokens visuais.
- Lint atual: eslint padrão React + TS. Sem regra custom de Tailwind.

§2 — ESLint rule proposta: `drift/no-legacy-color-classes`
- Detecta strings JSX classes com:
  - `text-slate-*` (exceto whitelist Slate aceita — design-system §2.3)
  - `bg-slate-800`, `bg-slate-700` (quando usado como bg-drift-border
    seria correto)
  - `bg-emerald-*-/4-9*` (raw, deveria ser `bg-drift-spread/X`)
  - `bg-red-*-/4-9*` (raw, deveria ser `bg-drift-bury/X`)
  - `text-yellow-*` (raw, deveria ser `text-amber-*` ou drift-warning)
  - Hex literais `#ff[a-f0-9]{4}` em strings JSX/CSS-in-JS (exceto
    whitelist conhecida em SwipeHandler)
- Stub de implementação custom rule (~200 LOC TypeScript).

§3 — Conformance test extensão (`tests/design-system-conformance.test.ts`)
- Vitest test que faz scan de src/**/*.tsx + src/**/*.ts:
  - Counts uses de cada legacy pattern (slate-*, emerald-*, red-*, yellow-*)
  - Compara contra baseline aceitável (snapshot)
  - Falha se count > baseline
- Permite migration incremental (count vai diminuindo) sem big-bang
  blocking.

§4 — Whitelist documentada
- Slate aceitos:
  - Decorative (skeletons que não tem tema brand)
  - GpsErrorBanner amber tones (off-pattern justified)
  - BootView pre-CSS-loaded (CL-58 Robin nota)
- Hex hardcoded aceitos:
  - SwipeHandler.tsx feedback (design-system §2.5 lista como dívida)

§5 — CI integration
- npm run test:design-system (alias pra novo conformance test)
- Adicionar em .github/workflows/*.yml (CI gate)

§6 — Migration trigger thresholds
- Round 4: Lily migra X% (define meta). Test snapshot atualizado.
- Round 5: Robin QA #3 valida. Snapshot fechado. Falha CI se regredir.

§7 — Não-fazer
- NÃO migrar amber pra drift-warning ainda (token não existe; Ted RFC
  v0.8 não declara — confirmar primeiro).
- NÃO bloquear Tailwind raw em prod release antes de v0.8 fechar.

§8 — Cross-cutting
- Convergir com a11y test (AY-4 drift-muted contrast — adicionar a
  conformance test se decisão de bumpar token for tomada).

Restrições:
- Doc-only plano + 1 stub de regra ESLint embutido em code-block (não
  arquivo separado).
- NÃO implement em arquivo real.
- Cap 2.5h.
- Reporte: caminho do doc, count linhas, número de patterns detectados
  pelo lint rule, métrica de % migração esperada Round 4, 1 risco
  (false positive em strings legítimas).
```

### §4.4 Robin workstream — Mobile-first UX patterns research + gap analysis

**O que faz:** Robin pesquisa padrões mobile-first social (Mastodon,
Threads, Bluesky, Lemmy) + identifica gaps Drift que poderiam fechar.
Convergente com Robin Comments UX UX-1 (modo lista).

**Output esperado:** `Docs/sessions/robin-mobile-ux-research-2026-05-08.md`
~600-900 linhas.
**Effort:** 3h.
**Owner:** Robin.

#### Prompt §4.4 — Robin

```
Você é Robin (HIMYM persona — research, curadoria, gaps cross-cutting,
docs), trabalhando no Drift.

Task: produzir research doc sobre padrões mobile-first UX em apps
sociais decentralizados (Mastodon, Threads, Bluesky, Lemmy, Damus,
Snort, Coracle) + análise de gap Drift.

Leia primeiro:
- CLAUDE.md (vocabulário UI/spec, manifesto §22/§24/§28)
- Docs/manifesto.md (compromissos)
- Docs/design-system.md (filosofia visual)
- Docs/sessions/comments-ux-audit-2026-05-08.md (seu próprio audit —
  UX-1 modo lista)
- Docs/sessions/ted-ux-spike-deployed-2026-05-08.md (Ted UX spike)
- src/components/Feed/PostCard.tsx + Post/PostViewer.tsx (modelo Drift
  card-stack atual)

Não-leitura externa obrigatória — você pode usar conhecimento prévio
sobre Mastodon/Bluesky/Threads. Se quiser citar URLs, ok mas não é
critério.

Produza Docs/sessions/robin-mobile-ux-research-2026-05-08.md
(~600-900 linhas):

§1 — Padrões observados em apps sociais decentralizados
- Mastodon (oficial + Tusky/Megalodon clients): timeline scroll
  vertical infinito, threads em árvore vertical, swipe-back gesture pra
  voltar.
- Threads (Meta proprietary, mas referência): card-feed mas thread em
  scroll vertical com indent visual.
- Bluesky (BskySocial): timeline vertical scroll, replies em scroll
  collapsed por default, tap pra expand.
- Lemmy (Reddit-like fediverse): feed vertical, comments collapsível
  com indent.
- Damus + Snort + Coracle (Nostr clients similar a Drift): mostly
  vertical scroll, sem card-stack swipe. Drift é outlier.

§2 — Padrões cross-cutting (mobile-first):
- Pull-to-refresh
- Bottom navigation (Drift tem)
- Floating Action Button (Drift tem)
- Swipe gestures pra ações (Drift tem; uso é diferente — swipe ↑/↓ é
  vote/move, não navigation)
- Skeleton screens (Drift parcial)
- Optimistic UI (Drift tem)
- Pull-up sheet pra inputs (Drift tem em ReplySheet/Compose)

§3 — Gaps Drift vs ecosistema
- Card-stack como leitura primária — Drift é outlier. Trade-off:
  diferenciação vs aprendizado novo.
- Sem timeline vertical scroll fácil — UX-1 do Robin Comments audit
  argumenta modo lista pra threads. Mesma lógica vale pro feed?
- Pull-to-refresh ausente (Drift hoje invalida automático via
  `invalidateFeed`). É descoberta? Adicionar mesmo?
- Reactions/emojis em comments — fora do Drift por design (manifesto
  §22). NÃO RECOMENDAR — só registrar.
- Following list no perfil — Drift tem (Fase 5). Rede social bom.
- DM/private msg — Drift fora do MVP (manifesto §29).
- Search — Drift tem (Profile lookup); search de conteúdo público?
  Não tem. Verificar gap.

§4 — Recomendações concretas (priorizadas)
- (1) UX-1 modo lista pra ThreadView (já em Comments audit) — Round 4
  candidato.
- (2) Pull-to-refresh visual cue (mesmo se invalidate é automático) —
  reforça mental model "atualizado". Effort baixo.
- (3) Touch target audit em mobile estreito 320px — confirme que
  buttons sub-44px (CP-7, AY-6) são fix em Round 4 não defer.
- (4) Onboarding ajuste — Drift card-stack swipe é alien; onboarding
  precisa explicar mais explicitamente (Robin já flagou em UX-7 coach
  replayável). Round 4 cobrir.
- (5) Loading patterns convergente com DriftSkeleton primitive (Lily
  §4.2 plan).
- (6) Empty states — Robin Comments audit UX-13 já cobriu.

§5 — Não-recomendações (gold-plating evitar)
- NÃO sugerir reactions em comments (manifesto §22).
- NÃO sugerir feed personalizado por user (manifesto §24).
- NÃO sugerir suggested follows / recommendations (manifesto §22).
- NÃO sugerir notifications push avançadas (out of scope MVP).
- NÃO sugerir DMs (manifesto §29 — fora do MVP).
- NÃO sugerir trending hashtags (Drift hoje tem categoria; manifesto
  filosofia anti-bolha §24 — algorítmico não).

§6 — Cross-cutting
- Convergência com:
  - Ted v0.8 RFC (primitives, type scale)
  - Lily motion plan (perceived performance)
  - Marshall enforcement (lint rule)
- Inputs pra Round 4 — Lily implementa quais recomendações §4?
  Priorizar (1) e (4) acima.

§7 — Open questions
- Modo lista pra ThreadView é Round 4? Ou separado em RFC dedicado?
  Robin recomenda Round 4 (escopo cap 4-6h Lily).
- Pull-to-refresh — implementação Framer Motion vs lib externa? Debate
  Round 4.

Restrições:
- Doc-only research.
- NÃO implement.
- NÃO criar features novas que violem manifesto.
- Cap 3h.
- Tom: research neutro, foco em "Drift é outlier por design? OK; ou
  por descuido? Se sim, fix".
- Reporte: caminho do doc, count linhas, top 3 recomendações
  acionáveis em Round 4, 1 recomendação que talvez vire RFC dedicado.
```

### §4.5 Barney workstream — Skeptical user journey friction audit

**O que faz:** Barney percorre **5 user journeys completos** em prod
(deploy Vercel) e cataloga toda fricção. Foco em "user que NUNCA usou
Drift consegue completar journey sem desistir?".

**Output esperado:** `Docs/sessions/barney-friction-audit-2026-05-08.md`
~500-800 linhas.
**Effort:** 3h.
**Owner:** Barney.

#### Prompt §4.5 — Barney

```
Você é Barney (HIMYM persona — peer review crítico, threat modeling,
ceticismo construtivo), trabalhando no Drift.

Task: produzir friction audit de 5 user journeys completos em prod.
Você é o anti-fan: lista TUDO que faz user desistir. Foco mobile, pq
maioria de Drift é mobile-first.

Use Claude_in_Chrome MCP pra navegar https://drift-wheat-one.vercel.app
em viewport mobile (375×667 ou similar). Sessão ~30-45min em prod +
~1.5-2h escrita.

Leia primeiro:
- CLAUDE.md
- Docs/manifesto.md (especialmente §1 — manifesto que orienta filosofia)
- Docs/sessions/ted-ux-spike-deployed-2026-05-08.md (Ted UX spike — base
  pra você expandir, não duplicar)
- Docs/sessions/comments-ux-audit-2026-05-08.md (Robin US-1..7)
- Docs/sessions/barney-test-posts-2026-05-08.md (seu próprio doc — você
  já testou compose, agora foca em outras journeys)

Journeys testar:
(1) Onboarding — first time user. Da landing até primeiro DRIFT
    bem-sucedido. Quantas etapas? Quantos modais? Quantas decisões? Que
    parte é confusa?
(2) Identity backup — user quer salvar seu nsec. Flow inteiro:
    Settings → Identity → Backup. UX da export, do warning, do paste
    seguro. CRÍTICO: manifesto §3 (identidade portável; backup é
    contrato).
(3) Identity import — user com nsec1 já existente. Flow Settings →
    Identity → Import. Onboarding alternativo. CRÍTICO: dispositivo
    descartável.
(4) Feed engagement — user lê 5 posts, faz 1 DRIFT, 1 SINK, navega
    subposts. Que parte requer aprendizado? Onde gesto não funciona
    como esperado? Onde animação confunde?
(5) Multi-identity creation — user cria identidade alternativa
    (Settings → Identity → New). Flow pra trocar entre identidades.
    Latency. Reload. Confusão.

Para cada journey, documente:
- Steps observados (1, 2, 3 …)
- Friction points (botão pequeno, copy ambíguo, latência, decisões
  prematuras, modais empilhados, etc.)
- Severity (S0 quebra journey / S1 frustra / S2 polish)
- Effort to fix (E0 / E1 / E2)
- Cross-ref: já flagado em outro audit? Se sim, linkar.

Produza Docs/sessions/barney-friction-audit-2026-05-08.md (~500-800
linhas):

§0 — TL;DR (verde / amarelo / vermelho per journey)

§1 — Methodology (viewport, browser, identity used, time spent)

§2..§6 — 5 journeys (1 §)
- §2 onboarding (first-time)
- §3 identity backup
- §4 identity import
- §5 feed engagement
- §6 multi-identity

Cada §X.Y é um friction point com:
- file:line da causa raíz (use Grep)
- finding ID novo (FX-1 .. FX-N)
- severity, effort, fix proposto

§7 — Cross-cutting (FX itens que aparecem em 2+ journeys)

§8 — Comparativo Twitter/Mastodon — pra cada friction point Drift, há
equivalente em apps mainstream? Drift introduz fricção nova ou herda?

§9 — Round 4 priorização (top 10 fixes)

§10 — Não-recomendações
- NÃO sugerir simplificação que viole manifesto §3 (backup obrigatório
  antes de destrutivo) — fricção justa.
- NÃO sugerir analytics ("learn from user behavior") — manifesto §28.
- NÃO sugerir gamification (badges, streaks) — manifesto §22 anti-vício.

Restrições:
- Doc-only.
- Use Claude_in_Chrome MCP pra prod.
- NÃO implement.
- Tom: cético construtivo. NÃO seja fan. SEJA o newcomer que abre o
  app, sem manual.
- Cap 3h.
- Reporte: caminho do doc, count linhas, top 5 fricções S0/S1, 1
  finding que sozinho recomenda hot-fix antes de Round 4.
```

---

## §5 — Round 4 — Implementation sprint

**Pré-condição:** Round 3 docs convergem. Arquiteto reviewa Ted RFC v0.8 +
Lily motion plan + Marshall enforcement plan + Robin research +
Barney friction audit. Aprova/ajusta. Estabelece priorização final.

**Janela:** ~5-7h, paralelo. Marshall + Lily implementam, Ted + Robin
reviewam.

### §5.1 Marshall — Token enforcement infra impl

- Implementa ESLint rule `drift/no-legacy-color-classes`.
- Implementa `tests/design-system-conformance.test.ts`.
- Adiciona em `npm run test:design-system` script.
- Whitelist documentada inline em rule.
- CI integration (.github/workflows/*.yml).
- Effort: ~3h.

### §5.2 Lily — Primitives + token migration impl

- Implementa primitives v0.8 (DriftCard, DriftInput, DriftToggle,
  DriftChip, DriftSkeleton). Cada um com tests Vitest puros.
- Migra top 20-30 call sites de tokens legacy → primitives v0.8 +
  drift-* tokens.
- Implementa motion plan (top 10 mudanças §4.2).
- Implementa skeleton additions.
- Implementa reduced motion audit.
- Implementa TX-9 UpdatePrompt redesign.
- Implementa UX-2 peek shadow text.
- Implementa text-responsivity §3.1 spots residuais.
- Implementa UX-1 modo lista pra ThreadView (do Robin Comments audit
  + Robin §4.4 research).
- Implementa Barney friction audit top 5.
- Effort: ~5-6h. **MAIOR risco: sobrecarga**.

### §5.3 Ted — Code review (paralelo a impl)

- Reviewa cada PR/commit do Lily/Marshall conforme entram.
- Verifica aderência ao RFC v0.8.
- Verifica que LOCK_VIA_TEST + design-system conformance tests passam.
- Effort: ~2h spread.

### §5.4 Robin — Documentation update

- Atualiza `Docs/design-system.md` v0.7 → v0.8 baseado no RFC Ted +
  primitives Lily.
- Atualiza `Docs/sessions/README.md` index.
- Effort: ~1h.

**Critério done:** todos primitives shipados, ≥ 90% das migrations
top 30, npm run test:design-system passa, npm run test passa, build
clean.

---

## §6 — Round 5 — Final QA + release

**Pré-condição:** Round 4 fechado.

### §6.1 Robin — QA #3 (final)

- Mesmo método que QA #1 e QA #2.
- Conformidade alvo: ≥ 85%.
- Output: `Docs/sessions/design-qa-final-2026-05-08.md` (ou data Round 5).
- Effort: 2h.

### §6.2 Barney — Security regression check

- Reviewa todos commits Round 4 contra threat models existentes (T1-T4
  webrtc + AT-1..14 auto-mode).
- Verifica AT-3 mitigações (banner switch).
- Verifica clickOutToClose default false em FullPageCard call sites
  com ações destrutivas em vôo.
- Output: `Docs/sessions/barney-final-regression-2026-05-08.md`.
- Effort: 1.5h.

### §6.3 Marshall — Build verification + tests

- npm run test (399 tests + novos testes design-system) verde.
- npm run typecheck verde.
- npm run build (warnings ≤ baseline).
- npm run test:design-system passa (nova).
- Effort: 30min + fix de quebras se houver.

### §6.4 Push + deploy

- Arquiteto faz commit final + push origin/main.
- Vercel auto-deploy.
- Smoke test em prod (Barney spawned ou Arquiteto manual).
- Effort: 30min.

---

## §7 — Métricas de sucesso "+50% UI/UX"

### Quantitativas

| Métrica | Baseline | Alvo | Como medir |
|---|---|---|---|
| Conformidade tokens drift-* | 62% | 85%+ | Robin QA #3 (mesmo método QA #1) |
| Findings residuais S0+S1 | 52 (S0=3, S1=49) | ≤ 10 | Robin QA #3 |
| Touch targets <44px | 8+ spots | 0 (críticos) | Manual count |
| Reduced motion respect | parcial | 100% (componentes >200ms) | Manual check |
| Animation duration values distintos | 8 | ≤ 4 (motion-fast/base/emphasis/card) | Grep |
| Padding values distintos em CTA | 4+ | ≤ 3 (sm/md/md-tall) | Grep |
| Tracking values distintos | 5+ | 3 (tag/meta/cta) | Grep |
| Slate-* in JSX | ~70 | ≤ 10 (whitelist documentada) | Conformance test |
| Hex hardcoded #ff* in JSX | ~5 | ≤ 1 (SwipeHandler whitelist) | Conformance test |
| Primitives reuso (% de buttons via DriftButton) | ~5% | 60%+ | Manual count em call sites |

### Qualitativas

- Friction audit Barney (Round 5 review): top 5 fricções S0/S1 do
  Round 3 Barney audit (§4.5) **resolvidas** ou com path-to-fix
  documentado.
- User journey "first DRIFT" reduzido em # de etapas (Barney
  benchmark).
- Arquiteto sign-off: visual feel "+50% melhor" subjetivo.

### Critério "+50%"

**Definição operacional:** ao menos **3 das 4** abaixo:
1. Conformidade ≥ 85% (vs 62% baseline).
2. Friction audit S0+S1 reduzido ≥ 50%.
3. ≥ 5 primitives novos shipados e usados.
4. Arquiteto subjective sign-off positivo.

Se atingir 4/4 = "+70% efetivo, ship com confiança".
Se atingir 2/4 = re-scope: ajustar Round 5 ou fechar fase aqui.

---

## §8 — Riscos identificados

### R1 — Sobrecarga Lily (Round 4)

**Risco:** §5.2 lista 9 grupos de tarefas pra Lily. Effort estimado
5-6h é otimista. Realisticamente 8-10h.

**Mitigação:**
- Round 4 split em 2 sub-rounds: Round 4a (primitives + tests Marshall)
  + Round 4b (migrations + motion). Cap 4h cada.
- Lily pode delegar parte de migrations pra agente paralelo (mesmo
  prompt template).

### R2 — Convergência docs vs implementação

**Risco:** 5 docs Round 3 paralelos (Ted RFC + Lily plan + Marshall
plan + Robin research + Barney audit) podem **não convergir**
arquitetonicamente. Ex: Ted RFC define `<DriftCard>` slot=`decoration`,
Lily motion plan assume slot diferente. Round 4 perde tempo
reconciliando.

**Mitigação:**
- §3.4 Ted refina §4 baseado em outputs de §3.1/§3.2/§3.3 — checkpoint
  pré-Round 3.
- Round 3 inclui **§4-revised** (Ted edita após primeiros 2-3 docs
  Round 3 entrarem) ajustando contradições.
- Arquiteto manual review obrigatório entre Round 3 e Round 4.

### R3 — Drift de escopo "+50% → +200%"

**Risco:** UI/UX é poço sem fundo. Cada find resolve abre 3 novos
("agora que cor está OK, animação está fraca"). Round 4 vira
infinitamente expansível.

**Mitigação:**
- §9 não-vai-fazer (anti-recomendações).
- Cap rígido por workstream (2-3.5h cada).
- Critério "+50%" operacional (§7) — para Round 5 quando 3/4 atingidos.
  Não buscar 4/4 perfeito.

### R4 — drift-muted contraste sub-AA (AY-4) blocker

**Risco:** Robin QA #1 §5 AY-4 marca `drift-muted` como sub-AA em bg
drift-surface. Decisão de bumpar token afeta ~50 components. Se
adiada, Lily migration slate-* → drift-muted **introduz** falha a11y
em massa.

**Mitigação:**
- Decisão Arquiteto **antes de Round 3** — Ted v0.8 RFC §2.1 (token
  scales) propõe valor novo (`#5a5a56`).
- Se Arquiteto rejeitar, Lily **NÃO migra** slate-500/600 → drift-muted
  em massa; usa drift-text/80 ou similar.

### R5 — DriftButton/FullPageCard primitives uncommitted no working tree

**Risco:** Lily working tree tem 14 M files + 4 ?? files. Se Lily não
empurrar antes de Round 2 começar, agentes spawned via prompts aqui
**não veem** os primitives — Round 3 doc Ted RFC v0.8 contradiz
realidade local.

**Mitigação:**
- Pre-Round 2 gate: Arquiteto valida `git status` vazio (Lily push)
  antes de spawn de §3.X agents.
- Se Lily não push em 1h, Round 2 atrasa.

### R6 — Conflict de arquivos entre §3.1 (Lily impl text fix) e §3.2 (Robin QA #2 read-only)

**Risco:** §3.1 Lily mexe em PostCard, PostViewer, CommentCard,
ThreadHeader, ComposeOverlay, etc. §3.2 Robin lê os mesmos arquivos.
Race condition se rodam paralelo.

**Mitigação:**
- §3.2 Robin roda **APÓS** §3.1 Lily commit. Não paralelo.
- §3.3 Barney + §3.4 Ted são doc-only e podem rodar paralelo a §3.1
  + §3.2.
- Sequência sugerida: §3.1 (Ted audit ~1h, depois Lily impl ~2h) →
  §3.2 (Robin QA #2 ~2h) — total ~5h sequenciais.
- §3.3 Barney roda paralelo a §3.1 (~1.5h).
- §3.4 Ted roda APÓS §3.1+§3.2+§3.3 todos fecharem.

**Wall-time estimado Round 2:** ~5h sequenciais (não 3h ingênuo).

### R7 — RFC Ted v0.8 grande, escapa de cap 2.5h

**Risco:** §4.1 Ted RFC v0.8 escopo (6 token scales + 5 primitives +
migration + conformance) é muito amplo. 2.5h pode virar 4-5h.

**Mitigação:**
- Ted produz RFC em **2 sessões**: v0.8-draft (apenas token scales,
  3 das 5 primitives) → revisão Arquiteto → v0.8-final (5 primitives
  full).
- Aceitar v0.8 inicial menor; v0.8.x fechar restante.

### R8 — Marshall ESLint rule custom é eng heavy

**Risco:** §4.3 Marshall ESLint custom rule (~200 LOC TS + parser) é
investimento eng não-trivial. Se Marshall ficar em rule e não fechar
conformance test → Round 4 começa sem enforcement infra → Round 5 QA
fica frágil.

**Mitigação:**
- Marshall foca conformance test Vitest **primeiro** (simpler, regex-based).
- ESLint rule fica pra Round 5 (post-launch polish) se não cabe em
  cap 2.5h Round 3.

### R9 — Auto-mode FSM impl conflita com UI/UX campaign

**Risco:** Round 4+ UI/UX campaign + Auto-mode FSM impl (Marshall +
Barney + Robin) compartilham Marshall + Barney. Sobrecarga.

**Mitigação:**
- Auto-mode FSM impl **defer pra após Round 5** (release UI/UX primeiro).
- Documentado em §9 — tracking separado.

---

## §9 — Não-vai-fazer (anti-recomendações)

Coisas que **NÃO** entram Round 2-5 — explicitamente bloqueadas pra
evitar drift-de-escopo.

### Features novas

- ❌ Reactions/emojis em comments — manifesto §22.
- ❌ DMs — manifesto §29 fora MVP.
- ❌ Notifications push — out of scope MVP (Fase 7+).
- ❌ Search de conteúdo público — out of scope MVP.
- ❌ Trending hashtags / suggested follows — manifesto §24.
- ❌ Gamification (badges, streaks, achievements) — manifesto §22 anti-vício.
- ❌ Theme light — manifesto §28 prefere dark.
- ❌ I18n full (PT já é primary) — out of scope; pode entrar Fase 7.

### Refactors fora do escopo

- ❌ Refactor de feed scoring (`scoring.ts`) — manifesto §22, escopo
  separado.
- ❌ Refactor de SQLite schema — Marshall side track separate.
- ❌ Refactor de transport layer — Fase 6+ separate.
- ❌ Refactor de bootstrap.ts — touched por auto-mode FSM impl, separate.
- ❌ Mudar protocolo Drift kinds (9078..9081) — manifesto §28-30.
- ❌ Mudar `drift-spread`/`drift-bury` token names — vocab §1.

### Documentação fora do escopo

- ❌ Mudar manifesto.md — escopo separado, exige RFC formal.
- ❌ Mudar drift-arquitetura-v4.md — Ted ADR specific, separate.
- ❌ Criar Docs/v0.8-design-system.md como new file — atualizar
  Docs/design-system.md em-place.

### Compromissos manifesto fora deste campaign

- ❌ Auto-mode FSM impl — separate track (Round 4+ post-UI/UX).
- ❌ §15 testbed — Robin separate owner.
- ❌ Per-subpost CW (TM-3) Opção A impl — pode entrar Round 4 se Marshall
  tem capacity, mas não-blocker.
- ❌ Per-subpost CW Opção B (schema break) — RFC formal separate, NÃO
  Round 4.

### Anti-patterns evitar nos prompts

- ❌ "Implementar tudo"-style prompts — sempre cap effort + scope concreto.
- ❌ Prompts que dependem de memória da sessão — todos self-contained.
- ❌ Tasks que sobrepõem arquivos sem sequenciamento explícito.
- ❌ Prompts ambíguos sobre o que produzir (doc vs code).

### Não-mudanças em CI

- ❌ Não trocar Vercel deploy infra.
- ❌ Não trocar GitHub Actions runner.
- ❌ Não trocar Tailwind major version dentro deste campaign (Tailwind 4
  upgrade pode entrar como RFC separate se §3.1 audit recomendar).

---

## §10 — Cross-references

- `Docs/sessions/design-qa-baseline-2026-05-08.md` — Robin QA #1
- `Docs/sessions/comments-ux-audit-2026-05-08.md` — Robin Comments UX
- `Docs/sessions/ted-ux-spike-deployed-2026-05-08.md` — Ted UX spike
- `Docs/sessions/barney-test-posts-2026-05-08.md` — Barney test posts
- `Docs/sessions/per-subpost-cw-gap-2026-05-08.md` — Marshall TM-3
- `Docs/sessions/track-c-debt-scoping-2026-05-08.md` — Lily track C
- `Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md` — Robin §15
- `Docs/sessions/auto-mode-detection-algorithm-2026-05-08.md` — Robin algorithm
- `Docs/sessions/auto-mode-threat-model-2026-05-08.md` — Barney threat model
- `Docs/rfcs/2026-05-rfc-network-mode-auto-fsm.md` — Ted ADR auto-mode
- `Docs/rfcs/2026-05-rfc-event-handler-registry.md` — Ted RFC handler registry
- `Docs/rfcs/2026-05-rfc-design-system-v08.md` — **a produzir Round 3 §4.1**
- `src/components/UI/DriftButton.tsx` — primitive shipped Round 1
- `src/components/UI/FullPageCard.tsx` — primitive shipped Round 1

---

## §11 — Critério de "done" deste delegation plan

- ✅ Cada persona tem prompt self-contained executável.
- ✅ Sequência Round 2 → Round 5 mapeada.
- ✅ Métricas concretas pra "+50% UI/UX" definidas (§7).
- ✅ Riscos identificados com mitigação (§8).
- ✅ Anti-recomendações explícitas pra evitar drift-de-escopo (§9).
- ✅ Workstream mais arriscado/incerto identificado (R1 — Lily
  sobrecarga em Round 4).
- ✅ Manifesto compromissos honored (§15/§17/§22/§24/§27/§28).
- ✅ Doc-only — não tocou código.

---

*Ted · 2026-05-08 · Delegation plan completo · Round 2 (~5h sequenciais
incluindo §3.1 → §3.2) → Round 3 (~3h paralelo, 5 docs) → Round 4 (~5-7h
impl) → Round 5 (~3-4h QA + release). Wall-time ~16-19h spread em 2-3
sessões. Workstream mais arriscado: §5.2 Lily implementation
sprint (overload risk R1) — split em 4a/4b é mitigation obrigatória se
detectarmos slip nas primeiras 2h.*
