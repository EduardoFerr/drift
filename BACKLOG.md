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

## BUGS — prioridade alta (correção sem polish)

- [ ] **BUG-LONGPRESS-FAN: long-press em ícone do ActionsFan ativa
  moderação 5s** — gesture conflict: PostViewer.tsx tem long-press 5s
  na card area pra abrir ModerationModal; quando user segura ícone do
  fan (block/mute/follow/etc), o ícone NÃO faz preventPointerDown ou
  similar, então o gesture do parent dispara junto. Resultado: user
  pretende ver tooltip/feedback do fan, mas barra de moderação inicia.
  Contexto: user feedback 2026-05-17 sessão noite V.
  Fix proposto: `data-no-longpress="true"` nos botões do ActionsFan
  (pattern já usado no ⋮ trigger em PostViewer.tsx:670) OU stopPropagation
  no onPointerDown dos botões do fan. Verificar primeiro qual é o
  vector exato.
  Bloqueio: nenhum — bugfix direto. ~15min.

## UX / Design — adicionados 2026-05-17 (sessão noite V)

### ActionsFan (vertical icon menu sobre post)

- [ ] **ActionsFan icons — alguns ainda emoji, não SVG** — Sprint 2/3
  SVG migration cobriu PostViewer header + IdentityPanel + IdentitySwitcher,
  mas ActionsFan (visível em embedded mode) ainda tem ícones Unicode
  em alguns slots. Audit: cross-ref `src/lib/actions-fan.ts` `buildFanItems`
  com SVG icons disponíveis em `UI/Icons.tsx`. Substituir restantes
  (provavelmente compartilhar/share-image/silenciar).
  Bloqueio: nenhum — quick win ~20min.

- [ ] **ActionsFan visibilidade sobre foto/background dinâmico** — icons
  do fan ficam invisíveis quando post tem foto clara por trás (screenshot
  user 2026-05-17). Causas combinadas:
    1. bg do botão é `glass` (transparente) sem opacidade suficiente
    2. icon stroke fino (1.5px Feather padrão) some sobre noise visual
    3. sem sombra/halo no icon
  Fix proposto (Marshall pattern):
    - Aumentar alpha do bg pra `/85` mínimo (regra de 2 camadas)
    - Adicionar `drop-shadow` no SVG (CSS filter) OU stroke duplicado
      (white background stroke + colored fill stroke — pattern de map
      icons)
    - OU substituir Feather-style por filled icons (Phosphor regular
      ou Heroicons solid) — R36 SVG icon libs research pode ajudar
  Bloqueio: precisa decidir entre quick-fix (drop-shadow CSS) e
  research-then-fix (lib filled icons). HIMYM Lily/Marshall.

- [ ] **ActionsFan — labels PT-BR ao lado dos icons** — usabilidade
  de descoberta. Icons sozinhos são ambíguos (fixar O QUÊ? seguir O
  QUÊ? silenciar O QUÊ?). User sugeriu labels curtos (1-2 palavras)
  à esquerda do icon:
    - Compartilhar Post
    - Compartilhar Imagem
    - Mapa de Spread
    - Fixar post
    - Seguir autor
    - Silenciar autor
    - Bloquear autor
    - Reportar post
  Trade-off: aumenta largura do fan vs fan-stacked vertical com label
  inline. Em mobile max-w-md, label largo pode estourar.
  Bloqueio: HIMYM Lily — decidir layout (label sempre visível? só
  no hover/long-press? expandido on first-show + dismissable?).

### Profile

- [ ] **Avatar cadastrado não exibido no perfil** — user salvou imagem
  de avatar em EditProfileCard mas não aparece renderizada em lugar
  nenhum visível do perfil. Possíveis causas:
    1. Avatar URL salva em metadata kind 0 mas Profile view não lê
    2. ProfileModal não tem `<img src={metadata.picture}>` (só nome)
    3. Cache de profile metadata stale após edit
    4. URL salva mal-formada (validation gap)
  Audit: `src/components/Profile/ProfileModal.tsx` + `EditProfileCard.tsx`
  cross-ref com `metadata.picture` field NIP-01.
  Bloqueio: nenhum — bugfix funcional ~30min.

### MapViewCard

- [ ] **MapViewCard — toggle FECHADO/ABERTO visual pobre** — single text
  color change indica estado ativo, mas user não percebe imediatamente
  qual está selecionado. Pattern: visual radiogroup com bg destacado +
  border accent (similar tabs do FeedTabs com indicator slide), ou
  segmented control iOS-style com pill animada.
  Bloqueio: nenhum — refactor visual ~30min, padrão já existe em
  outros toggles.

### DiagnosticCard

- [ ] **Reconstruir histórico só busca relays — incluir P2P/WebRTC/LAN?**
  `rebuildIdentityHistory(npub)` em `src/lib/sync.ts` hoje só re-pede
  pros relays. User sugere: incluir descoberta P2P (peer link, WebRTC
  signaling Nostr DM), mesma rede LAN (mDNS quando habilitar),
  bundle import. Manifesto §15 anti-censura por país: se relays estão
  bloqueados, fallback P2P é exatamente o caminho.
  Decisão: separar em (a) bugfix simples adicionar P2P fontes existentes,
  ou (b) feature maior orchestrando multi-transport com UI de progresso?
  Bloqueio: HIMYM Ted/Marshall — decidir arquitetura. Possivelmente
  cabe num plano Fase 6.x ou 7.

### SuaLenteCard

- [ ] **SuaLenteCard — UI/UX confusa, vale rodada deliberação** — user
  feedback 2026-05-17 sessão noite V. Após ship em [c89774b], user
  testou e achou interface confusa. Possíveis pontos:
    1. Slider sem feedback claro do efeito real no feed
    2. Labels "Nenhuma/Moderada/Forte" abstratos — user não sabe o que muda
    3. "Como funciona" muito textual, sem visualização
    4. Falta CTA "ver feed com lente ativa" pra testar antes
    5. Inspector chip do PostViewer talvez não ligado mentalmente ao card
  HIMYM rodada completa: Lily (UX), Robin (research patterns onboarding
  de features novas), Marshall (vocabulary lock conferir). Eventualmente
  Phase 1.5 pode trazer visualização no mapa (já no plan §2).
  Bloqueio: HIMYM dispatch + decisão de scope (quick polish vs redesign).

## UX / Design — adicionados 2026-05-17 (sessão noite IV)

- [ ] **Banners "ANTES DE PUBLICAR" / avisos longos inline — tooltip ou
  dialog?** — banner ainda inline em EditProfileCard (~25% viewport).
  Em [7cf4ec0] foi MIGRADO pra DriftAlert primitive (DRY com nudge
  banners), mas a decisão de **CONVERTER pra tooltip/dialog** segue
  pendente. HIMYM Lily/Barney deliberar §28 privacy-visible vs UX clean.

- [x] **Views ainda sem design novo (audit umbrella expansion)** —
  audit fechado 2026-05-17 (HIMYM Lily + Marshall). Resultados:
    - EditProfileCard JÁ era compliant (FullPageCard + DriftButton);
      gap real era apenas banner inline — fechado em [7cf4ec0] via
      DriftAlert primitive.
    - 5 views legacy identificadas: ComposeOverlay sub-overlay,
      OnboardingOverlay shell, ReplySheet bottom-sheet, PostViewer
      ModalWrapper, ThreadView overlay. Conformance tests it.todo
      criados em [7cf4ec0] pra liberar ENFORCE por PR de migração.
    - GpsErrorBanner whitelist (icon-leading layout — TODO: estender
      DriftAlert com prop leadingIcon).
  Próximos PRs (Lily ROI ordering): ReplySheet → SlideUpOverlay
  (~1h, alta freq), OnboardingOverlay → SlideUpOverlay (~45min,
  first impression).

## UX / Design — adicionados 2026-05-17 (sessão noite III)

- [x] **InstallModal — design antigo confirmado** — fechado 2026-05-17
  em [b2c5f6b]. Migrado pra SlideUpOverlay + ModalHeader + DriftButton
  + DownloadIcon SVG. Emoji 📥 ✕ removidos, backdrop ad-hoc removido,
  botões inline substituídos por variants primary/ghost/cancel.

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

- [x] **ComposeOverlay textarea — baixo contraste em alguns temas** —
  fechado 2026-05-17 em [4b673ad]. Causa raiz: double-alpha
  `bg-drift-bg/60` + `placeholder:text-drift-muted/40` = ratio 1.68:1
  em velatura (FALHA AA). Fix systemático: 13 form fields em 8 arquivos
  migrados de `placeholder:text-muted/25-40` → `/70`; ComposeOverlay
  bg também trocado pra opaco. Conformance test estendido cobre vetor 2
  (placeholder form fields) além do vetor 1 (backdrop-blur).

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
