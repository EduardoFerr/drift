# Drift — Backlog de Decisões Pendentes

Registro durável de decisões abertas que precisam de input do user.
Não é todo-list de implementação — é rastro de **rumos** que ficaram
abertos entre tarefas.

Formato: `- [ ] <decisão> — contexto: <origem> — bloqueio: <quem/quê>`
Quando user fecha, marcar `[x]` com data + 1 linha de resolução.

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

## UX / Design — adicionados 2026-05-17 (sessão tarde)

- [ ] **Refresh icon location no header** — o ícone de atualizar próximo ao
  badge "DERIVA X.XXX" / "trending" parece deslocado. HIMYM deve deliberar:
  ainda é necessário neste local? Qual UI/UX já tem o mesmo efeito
  (pull-to-refresh? auto-refresh?)? Ou um gestual basta (reduzir fricção
  cognitiva)?
  Contexto: screenshot 2026-05-17 sessão PR-5.
  Bloqueio: HIMYM deliberação pendente.

- [ ] **Dialogs com design antigo** — alguns dialogs (confirmações, prompts)
  não seguiram o novo design system (FullPageCard + section-header +
  drift-accent2). Revisar todos os `dialog.confirm` / `dialog.prompt` e
  componentes em `src/lib/dialog.ts` + DialogHost.
  Bloqueio: precisa varredura sistemática + decisão sobre quais migrar.

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

- [ ] **IdentityPanel — nsec input overflow** — campo "NSEC PRIVADO" estoura
  largura da tela em mobile. Sem botão de copy visível.
  Contexto: screenshot 2026-05-17 sessão PR-5.
  Bloqueio: HIMYM deliberando (Ted/Marshall/Barney/Lily/Robin).

- [ ] **IdentityPanel — design legado** — UI desse card destoa do resto do
  app (header velho, padding diferente). Migrar pra FullPageCard pattern?
  Contexto: mesma screenshot.
  Bloqueio: HIMYM deliberando.

- [ ] **Baixo contraste em backgrounds com blur** — cards com bg/85
  + backdrop-blur ficam bonitos mas comprometem leitura.
  Contexto: feedback user 2026-05-17.
  Bloqueio: HIMYM deliberando (precisa medir contrast ratios WCAG AA/AAA).

- [ ] **Vocabulário PT-BR — auditoria geral** — user citou "textos devem
  estar em português". Verificar se há strings EN sobraram no app.
  Contexto: feedback geral.
  Bloqueio: precisa varredura sistemática (grep + revisão).

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
