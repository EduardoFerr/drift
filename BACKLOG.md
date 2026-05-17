# Drift — Backlog de Decisões Pendentes

Registro durável de decisões abertas que precisam de input do user.
Não é todo-list de implementação — é rastro de **rumos** que ficaram
abertos entre tarefas.

> **Escopo deste arquivo (raiz)**: decisões de sessão de chat — UX,
> refactors, rumos arquiteturais, pendências reportadas pelo user.
> Atualizado a cada commit; itens fechados ganham hash anexo.
>
> **NÃO confundir** com `Docs/research-backlog.md` — esse outro
> arquivo guarda pesquisas externas pendentes (libs, RFCs, padrões
> que dependem de WebFetch/WebSearch), Phase-scoped, mantido pela
> persona Robin. Sem overlap.

Formato:
- Item aberto: `- [ ] <decisão> — contexto: <origem> — bloqueio: <quem/quê>`
- Item fechado: `- [x] <decisão> — fechado YYYY-MM-DD em <commit-hash> — <1 linha resolução>`

**Regra 2026-05-17**: cada fechamento DEVE ter commit hash anexo, mesmo
que seja `(no-commit, decisão registrada apenas)`. Permite reconstruir
o "porquê" via `git show <hash>`.

Última atualização: 2026-05-17

---

## Trust Lens Phase 1 — decisões políticas abertas

(Originadas das deliberações HIMYM Stage 1-3, ainda não resolvidas.)

- [ ] **GAP-1: PPR decay temporal** — edges devem decair sozinhos com idade?
  Hoje só tem TTL 90d hard cut em não-follows.
  Contexto: Barney WoT audit Stage 3.
  Bloqueio: precisa de decisão entre (a) sem decay, (b) exp decay 30d half-life,
  (c) score-based decay.

- [ ] **GAP-2: filter → edge feedback loop** — quando user adiciona filter
  rule que bloqueia autor X, o edge influence para X deve cair também?
  Contexto: Robin §27 loop fix discussion.
  Bloqueio: tradeoff entre (a) loop = melhor UX, (b) loop = anti-Sybil hack
  via filter-rule farming.

- [ ] **GAP-CLUSTER: detecção de cluster (LPA)** — Phase 2 candidato.
  Contexto: Ted nodes/clusters session 2026-05-17.
  Bloqueio: aguardando dados reais de uso pra decidir prioridade vs FORA/Vertex.

- [ ] **PR-4c timing** — worker thread pra recompute. Phase 1.5 vs Phase 2?
  Contexto: PR-4b shipped main-thread (~75ms). Plan §1.4.
  Bloqueio: precisa medição em mid-range phone real pra justificar urgência.

- [ ] **PR-5 scope expansion** — adicionar toggle "mostrar quando lente
  reordenou um post" (plan §1.5 menciona). Phase 1.5 ou agora?
  Contexto: shipped sem o toggle (PR-5 c89774b).
  Bloqueio: validar primeiro se inspector chip basta.

- [ ] **Robin multi-list research re-dispatch** — agente rodando background
  desde início da sessão. Re-spawn ou abortar?
  Contexto: ver `Docs/sessions/lily-multi-list-deep-dive-*.md`.
  Bloqueio: aguardando user direcionar.

---

## Infra / Arquitetura — adicionados 2026-05-17 (sessão noite)

- [ ] **i18n — spike + POC + relatório** — investigar internacionalização
  do Drift. App hoje é monolinguagem PT-BR (com termos protocolares EN).
  Spike deve cobrir:
    - Bibliotecas avaliadas: react-intl (FormatJS), i18next + react-i18next,
      LinguiJS, Format-Message, custom Zustand-based, $localize Angular-style
    - Custo de bundle (gz delta), runtime overhead, DX
    - Modelo de chaves: hierárquico (`settings.network.title`) vs flat
      (`settings_network_title`)
    - ICU MessageFormat (plural/gender) — necessário pro Drift?
    - Pluralização PT-BR (singular/plural) — quão crítico?
    - RTL languages (árabe, hebraico) — escopo Phase 2?
    - Como interagir com glossário protocolar (DRIFT, SPREAD, BURY, nsec)
      que NUNCA traduz?
    - Onde guardar strings: JSON imports vs inline + extract script?
    - Workflow tradução: machine-only, comunidade, ambos?
    - Detecção idioma: navigator.language? user pref override?
  Entregar: relatório em `Docs/sessions/i18n-spike-2026-MM-DD.md` com
  recomendação + custo + roadmap (não código de produção).
  Bloqueio: precisa decisão de prioridade vs outros gaps; aguardando
  go pra spike.

- [ ] **Ícones header (🌐 NetworkMode + 📍 LocationGranularity) — escopo
  expandido?** — hoje são dual-path pra Settings (atalhos visuais).
  User questiona: vale centralizar mais funções neles? Ex:
    - Long-press → status detalhado (peers, relays, latência)
    - Tap → cycle entre presets (clearnet → tor → onion-only)
    - Combinar com PeersCard / RelaySettings no mesmo card
  HIMYM deliberou (relatório nesta sessão).
  Bloqueio: aguardando decisão pós-deliberação.

- [ ] **Atomic Design adoption** — user perguntou se seguir atomic design
  (atoms / molecules / organisms / templates / pages) facilitaria
  construções como StatusIndicators + tooltips + tab groups. HIMYM
  deliberou (relatório nesta sessão).
  Bloqueio: aguardando decisão de scope (refactor grande vs grandfather
  existente + aplicar só em novos components).

## UX / Design — adicionados 2026-05-17 (sessão noite III)

- [ ] **InstallModal — design antigo confirmado** (src/App.tsx:2131-2218)
  Audit dialog 2026-05-17 confirma: NÃO usa primitives do design system:
    - ❌ Não usa `FullPageCard` nem `SlideUpOverlay`
    - ❌ Não usa `SectionHeader` (extraído em [680a7c6])
    - ❌ Botões inline em vez de `DriftButton`
    - ❌ Emoji 📥 + ✕ em vez de SVG icons (Sprint 2/3 não cobriu)
    - ❌ Backdrop ad-hoc `bg-black/70` em vez de SlideUpOverlay backdrop
  Decisão: migrar pra `SlideUpOverlay` + `ModalHeader` + `DriftButton`
  + SVG icons (Download/X). Mantém tom específico do passo-a-passo iOS.
  Bloqueio: nenhum — quick win (~30min), padrão estabelecido.

- [ ] **Audit sistemático de dialogs antigos** — gerador da pergunta
  user 2026-05-17 ("alguns dialogs parecem não ter seguido o novo
  design"). InstallModal já identificado; precisa varrer outros
  candidatos: BootView dialogs, dialog.confirm/prompt instances,
  qualquer modal inline em App.tsx que ainda não migrou.
  Contexto: Lily UX audit pendente.
  Bloqueio: HIMYM Lily/Marshall podem fazer audit sistemático com grep
  `role="dialog"` + cross-reference com FullPageCard/SlideUpOverlay.

- [ ] **Contraste de texto em dialogs sobre backdrop dinâmico** —
  user pergunta se precisa técnica para contraste. Auditoria:
    - InstallModal usa `bg-drift-surface` SEM alpha (opaco) — contraste
      OK em cinder/rosenholz; risco em velatura (light theme).
    - Bg-black/70 no backdrop tem blur — texto do modal não atravessa.
    - Surface opaco já é a "técnica" — não precisa text-shadow nem stroke.
    - MAS: outros dialogs (DialogHost custom?) podem usar surface/N alpha
      que tira o opaco. Precisa varredura junto com #1.
  Decisão técnica registrada: text-shadow é fallback **só** quando bg é
  inevitavelmente dinâmico (mapa/foto). Em dialog padrão, manter surface
  opaco + medir contrast ratio por tema é a fix correta.
  Bloqueio: depende do audit #1 — uma vez listados todos os dialogs,
  Marshall WCAG audit confirma quais precisam fix.

## UX / Design — adicionados 2026-05-17 (sessão noite II)

- [ ] **ComposeOverlay textarea — baixo contraste em alguns temas** —
  campo "escreva o que vai derivar…" fica ilegível em pelo menos um dos
  temas (cinder/rosenholz/velatura). Placeholder + text color provavelmente
  têm alpha demais sobre bg-drift-surface. Precisa medir contrast ratio
  por tema (similar Marshall WCAG audit fechado em [6e4f1ce]).
  Contexto: screenshot user 2026-05-17 sessão noite II.
  Bloqueio: precisa identificar tema afetado + ratio atual. HIMYM Marshall
  pode auditar.

- [ ] **ComposeOverlay — "Publicar" → "Prévia do post"** — UX flow:
    1. Botão atual "Publicar ↑" no rodapé do compose vira "Prévia do post"
    2. Tap → mostra preview full-screen do post + subposts renderizado
       como se estivesse postado (mesmo PostViewer real, mas read-only)
    3. Na tela de preview aparece botão "Publicar" final
    4. "Prévia" existente do card (botão pequeno no rodapé do card único)
       fica preservada — é prévia de UM card; "Prévia do post" é do
       post completo com subposts navegáveis
  Contexto: user feedback 2026-05-17 — diferenciar "prévia do card"
  (1 subpost) de "prévia do post" (post completo com swipes).
  Bloqueio: precisa decidir se PostViewer aceita modo "preview" novo
  ou se cria PostPreview component separado. HIMYM pode deliberar.

## UX / Design — adicionados 2026-05-17 (sessão tarde)

- [x] **Refresh icon location no header** — fechado 2026-05-17 em [253fe48]
  — HIMYM consenso 4/4: removido. Substituído por tap-on-active-tab
  (Twitter/Bluesky pattern) + auto-refresh invalidateFeed já existente.
  Conformance test `tests/feed-tabs-gesture-conformance.test.ts` trava.

- [ ] **Dialogs com design antigo** — alguns dialogs (confirmações,
  prompts) não seguiram o novo design system. Item refinado em
  2026-05-17 sessão noite III: ver items "InstallModal — design antigo
  confirmado" + "Audit sistemático de dialogs antigos" no topo do
  arquivo. Este item passa a ser umbrella.
  Bloqueio: aguarda audit sistemático fechar.

- [ ] **Onboarding com muito CLS entre steps** — Cumulative Layout Shift
  alto durante transições de step no OnboardingOverlay. Provavelmente
  height/width dos containers muda entre slides causando jank visual.
  Contexto: feedback user 2026-05-17.
  Bloqueio: precisa medir CLS real (DevTools) + identificar steps
  culpados; possíveis fixes (min-h fixo, transition contained, skeleton
  durante swap).

- [ ] **HIMYM flavor curado** — user forneceu links Pinterest (fotos da
  série) + scarymommy (quotes). Considerar: easter eggs nos templates de
  agente? Aside cards na docs? Loading screen com quote rotativo?
  Links:
    - https://br.pinterest.com/search/pins/?q=Como%20eu%20conheci%20sua%20m%C3%A3e&... (fotos)
    - https://www.scarymommy.com/how-i-met-your-mother-quotes (frases)
  Bloqueio: scope creep — decidir se é diversão ou rabbit hole.

- [ ] **Stroke/border em texto sobre transparência** — técnica:
  `-webkit-text-stroke` ou `paint-order: stroke fill` cria contorno
  legível sobre backgrounds dinâmicos (mapa, foto). Decisão técnica
  registrada 2026-05-17:
    - Aumenta contraste **percebido**, mas WCAG não credita (auditores
      checam fill vs bg)
    - text-shadow é mais aceito (sombra simétrica como halo)
    - Em texto ≤14px borra glyphs (anti-aliasing vs outline)
    - Bom pra headings/labels grandes, ruim pra body/badges
  Recomendação: usar como **fallback estético** em bg dinâmico (mapa);
  fix correta é elevar alpha do bg (Marshall regra de 2 camadas).
  Bloqueio: aguardando decisão se aplica como fallback ou se vamos
  só elevar alpha.

## UX / Design — descobertos 2026-05-17 (sessão manhã)

(Origem: user feedback em screenshot do drift-wheat-one.vercel.app.)

- [x] **IdentityPanel — nsec input overflow + copy button** — fechado
  2026-05-17 em [5bf7daa] (overflow + copy npub) + [a8d3d51] (Barney §8
  guards: auto-clear clipboard 30s, auto-hide reveal 60s, warning
  Win+V/iCloud, QR/download promovidos). 8 conformance tests em
  `tests/identity-nsec-guards-conformance.test.ts`.

- [x] **IdentityPanel — design legado** — fechado 2026-05-17 em [5bf7daa]
  (Ted veredict: refactor in-place, já usa FullPageCard, só conteúdo
  desalinhado — pl-3→min-w-0 corrige causa raiz) + [680a7c6] (SectionHeader
  extract atomic-lite, 6 call-sites DRY).

- [x] **Baixo contraste em backgrounds com blur** — fechado 2026-05-17
  em [6e4f1ce] — 3 hits AA críticos corrigidos (SpreadMap atribuição+badge,
  ThreadHeader sticky). Marshall regra de 2 camadas + conformance test
  `tests/wcag-contrast-conformance.test.ts`. Hits MÉDIA em GlassIconButton
  + PostViewer botão flutuante ainda pendentes (depend de backdrop dinâmico).

- [x] **Vocabulário PT-BR — auditoria geral** — fechado 2026-05-17 em
  [9a99076] — 6 strings P0/P1 migradas (Settings→Ajustes, trending→em alta,
  granularidade country/city/precise→país/cidade/GPS). Robin audit registrou
  glossário canônico EN-intocado (DRIFT/SPREAD/BURY/nsec/npub/NIP).

---

## Roadmap Phase 2 — triggers pendentes

(11 items conforme plan §2-3. Triggers: data, métrica, ou request explícito.)

- [ ] FORA integration — trigger: graph >1k follows
- [ ] Vertex DVM benchmark — trigger: phone low-end real
- [ ] NIP-85 Trusted Assertions — trigger: ecosystem adoption
- [ ] (8 outros — ver Docs/plans/trust-lens-phase1-plan.md §2)

---

## Conformance / Hardening — 16 testes ainda em it.todo()

- [ ] 6 grep-based conformance (#1-5 trust-lens + outros)
- [ ] 3 Stage 3 testes (audit log, URL whitelist, edge cap)
- [ ] 3 Phase 2 cluster (depende de GAP-CLUSTER decidir)
- [ ] 1 GAP-8 (Barney WoT)
