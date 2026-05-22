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

**📋 Sprint N+2 plano consolidado (Satoshi + Ted 2026-05-21):**
`Docs/sessions/satoshi-ted-sprint-n2-plan-2026-05-21.md`

Resumo (~8d P0 + 3.5d P1 + 1.5d P2 = 10-13d, buffer-tolerant):

**Pré-sprint:** smoke test ~2.5h (Satoshi push — ~50 commits sem
validação Vercel completa = risco real).

**P0 — must-ship:**
| # | Item | Est | LOCK_VIA_TEST |
|:---:|---|:---:|---|
| 0.1 | §16 IPFS pin automático | 2d | `viral-ipfs-pin.test.ts` |
| 0.2 | Lentes pluggable POC (Registry + 2 lentes + UI) | 4-5d | `lens-plugin-conformance.test.ts` |
| 0.3 | §15 Doc país censurado | 1.5d | — |
| 0.4 | §25 CI grep zero scan | 0.5d | `no-scan-automatico.test.ts` |

**P1 — reforça abstração:**
| # | Item | Est |
|:---:|---|:---:|
| 1.5 | Extract `<ActionsFan>` primitive | 1.5d |
| 1.6 | `useLensToggle` hook (DRY 3 toggles) | 1d |
| 1.7 | LHCI re-measure + delta vs cwv-final-report-2026-05-09 | 1d |
| 1.8 | Auto-trigger re-broadcast em addRelay() (Satoshi #1) | 30min |
| 1.9 | Auto-pin IPFS hook em score > threshold (parte de P0 0.1) | (incluso) |

**P2 — se folga:**
| # | Item | Est |
|:---:|---|:---:|
| 2.10 | §20 random walk pós-CONNECTED — DOC ONLY (Satoshi #3) | 0min (doc) |
| 2.11 | Profile picture render em feed/comments (Lily fix) | 4-6h |
| 2.12 | `Docs/architecture-phases.md` 6/7 → épicos | 1d |

**Veto explícito (NÃO shipar):** content-hash, N/2 refill, PR-4c
worker, GAP-CLUSTER LPA, sneakernet QR, NIP-44 DMs UI, composição
§6 lentes (defer Sprint N+3 pós feedback do POC).

Sprint começa quando user der GO. Design lenses ready em
`Docs/lens-pluggable-design.md`.

---

**Regra 2026-05-17**: cada fechamento DEVE ter commit hash anexo, mesmo
que seja `(no-commit, decisão registrada apenas)`. Permite reconstruir
o "porquê" via `git show <hash>`.

Última atualização: 2026-05-17

---

## ✅ Fechados — sessão 2026-05-17 (rounds finais)

Sequência de 7 rounds shipped após HIMYM dispatches. Todos pushed:

- [x] **#1 UserPrefs sovereignty bump** (3 endpoints customizáveis) —
  fechado em [f8db723]. `upload_endpoint` + `map_tile_url_template` +
  `report_threshold_override` em UserPrefs schema; readers em upload.ts,
  SpreadMap.tsx, moderation.ts com fallback default. Conformance 3
  it.todo → it() em `no-telemetry.test.ts`.

- [x] **#2 OnboardingOverlay → SlideUpOverlay** — fechado em [7fa7280].
  SlideUpOverlay ganha prop `boost?: boolean` (z-[60] dominância sobre
  UpdatePrompt). Allowlist conformance #2 enforce com 4 legacy
  documentados.

- [x] **#3 SuaLenteCard polish** (Lily approach a) — fechado em [4c36a18].
  Labels descritivos ("sem reordenação" / "levemente prioriza..."), helper
  text com exemplos concretos, CTA "ver feed agora" (EyeIcon), "como
  funciona" reorganizado em 3 linhas estruturadas.

- [x] **#5 ReplySheet → SlideUpOverlay bottom-sheet** — fechado em
  [9fb525f]. SlideUpOverlay estendido com `variant='bottom-sheet'` +
  `dragToDismiss` + `dragHandleVisible` (embarca pointer events + RAF
  spring back; tuning bit-a-bit do ReplySheet pre-migration). Allowlist
  reduzida pra 3 entries.

- [x] **#4 Satoshi Lacuna 2: nsec exposure guards** — fechado em [b76245b].
  `lib/identity-exposure.ts` com `recordExposure` + `requirePasskeyForExport`
  + `isOverRateLimit` + `formatLastExposed`. Passkey gate em
  reveal/copy/download. Audit chip top-of-tab "última exposição: X
  atrás". Rate-limit warning ≥3 exposures em 10min. 8 conformance tests.

- [x] **#8 RFC DAOP-001 Phase 1 PR1** (refactor puro) — fechado em
  [c823e8f]. `lib/guidance.tsx` com `ONBOARDING_RULES` declarativo (5
  IDs estáveis: welcome/swipes/identity/location/manifest-rules).
  OnboardingOverlay vira consumer puro. 9 conformance tests. Abre
  caminho pra PR2 (capabilities) + PR3 (HintChip/Toast/Modal).

- [x] **Slim mode UX (long-press 5s)** — fechado em [848d78b]. Long-press
  5s troca semantics: moderação → toggle modo slim (chrome hidden, card
  fullscreen). Moderação migrou pro ActionsFan item `moderar`.

---

## RFC DAOP-001 — próximos PRs (Phase 1)

Plano Ted HIMYM 2026-05-17 (analysis registrada em commit do PR1 [c823e8f]).

- [x] **DAOP PR2: `lib/capabilities.ts`** — fechado em [3299b26].
  Capabilities derivadas (`hasFirstPost`, `hasFirstSpread`, `hasFollow`,
  `hasBackup`, `dismissedRuleIds`) via queries puras SQLite + bag em
  `user_prefs.capabilities_dismissed`. `GuidanceRule.appliesIf?` opcional;
  regra `identity` skipa pra quem já fez backup (reusa `last_nsec_export_at`
  do guard Satoshi [b76245b]). `filterApplicableRules()` puro + testável.
  `useCapabilitiesStore` reativo via Zustand. OnboardingOverlay consome
  filtered rules + `dismissRules()` no finish (permite PR3 re-mostrar
  rules como hints contextuais). 12 conformance tests novos.

- [x] **DAOP PR3: HintChip / HintToast / HintModal primitives** —
  fechado em [d0b7ac5]. 3 componentes UI consumindo GuidanceRule +
  capabilities. HintChip (passive, DriftChip + dismiss X), HintToast
  (reactive, DriftAlert fixed-bottom + auto-dismiss 8s), HintModal
  (interactive, SlideUpOverlay + snooze). Todos respeitam appliesIf +
  dismissedRuleIds. Manifesto §28: zero fetch/Nostr — local-only.
  15 conformance tests novos. Hint surfaces prontas pra adoção por
  features (caller decide quando montar).

---

## Sovereignty / Power-user — UI pending

- [x] **PostViewer ModalWrapper removido (dead code)** — fechado em
  [59741c6]. `ModalWrapper` era branch pré-V8 home-view; único call
  site (App.tsx) passa `embedded` desde V8, então ModalWrapper jamais
  executou em prod. Removido `function ModalWrapper`, `EXIT_VARIANTS`
  constant (só usado por ele), e `Wrapper = embedded ? ... :
  ModalWrapper` (hardcoded EmbeddedWrapper). Branches `!embedded` no
  render path mantidas (cleanup separado se justificar). Allowlist
  OVERLAY_LEGACY ratchet final: 1 entry (apenas ThreadView tree
  exceção).

- [x] **ComposeOverlay PreviewOverlay → FullPageCard** — fechado em
  [9454384]. PreviewOverlay (preview do post antes de publicar) usava
  `<div absolute inset-0 z-10>` + `role="dialog"` ad-hoc. Migrado pra
  FullPageCard primitive (gerencia role/aria-modal/ESC/headerRight).
  Header "prévia" + botão "voltar" via headerRight. Allowlist
  OVERLAY_LEGACY ratchet: 3 → 2 entries (ComposeOverlay removida; faltam
  PostViewer ModalWrapper + ThreadView tree).

- [x] **Settings UI pra 3 endpoints customizáveis** — fechado em
  [e213c24]. Decisão UX: card próprio (`SovereigntyCard`) em "sistema"
  group (não nested em NetworkMode/MapView — mistura semânticas
  heterogêneas que dividem único princípio §17 "rotear pra infra
  própria"). 3 campos com inputs livres + botão salvar (dirty-only) +
  botão limpar (restaura default). Validação client-side mínima;
  setPref já filtra (defense in depth). Wiring em App.tsx
  (SettingsTarget 'soberania' + lazy import + menu entry com
  ServerIcon + "endpoints próprios — upload, mapa, moderação" hint).

---

## Trust Lens Phase 1 — decisões políticas abertas

(Originadas das deliberações HIMYM Stage 1-3, ainda não resolvidas.)

- [x] **GAP-1: PPR decay temporal** — fechado 2026-05-20 em [2de0fc0].
  Decisão: (b) exp decay 30d half-life, **opt-in** via
  `lens_ppr_decay_enabled` (default OFF preserva math bit-exact).
  Aplicado apenas no walk-time; `lens_edges.influence` SQLite intacto.
  Pure helper `temporalDecay` em trust/ppr.ts + 6 conformance tests
  (#22-#27). Toggle UI em SuaLenteCard ("esquecer follows antigos").
  KNOWN LIMITATION (Satoshi pair-review): updated_at é refresh-on-write
  → Sybil edge-refresh bypassa decay. Defesa correta requer coluna
  `created_at` em lens_edges (schema bump deferred pra Phase 2 quando
  telemetria mostrar attack real). Item separado no backlog abaixo.

- [x] **Lens edges `created_at` imutável (Gap B Sybil edge-refresh defense)**
  Fechado 2026-05-20 (Satoshi devsec implementation). Schema bump
  additive + backfill conservative (`created_at = updated_at` pra rows
  pré-migration) + writers imutáveis (não tocam created_at em ON
  CONFLICT) + reader usa `created_at ?? updated_at` (COALESCE defesa
  em camada) + 4 conformance tests source-grep (#28-#31). Surface
  residual: grace window 1-write em rows pré-migration; refactor DRY
  dos 2 writers duplicados defer.

- [x] **Time-window decay nos reports (Gap A insider mitigation PARCIAL)**
  Fechado 2026-05-21 (Barney devsec implementation). Half-life 48h
  escolhido como sweet spot entre defender brigada slow-burn (24-72h)
  e preservar consenso lento legítimo. Opt-in via
  `UserPrefs.report_decay_enabled` (default OFF). Função pura
  `calculateEffectiveReportWeight` + 8 tests em moderation.test.ts.
  **Surface residual documentada:** brigada flash <1h (test específico
  confirma decay 48h ~não pega) + consenso >120h (perda ~45%). Fix
  completo requer GAP-CLUSTER cluster detection. Ver
  known-limitations.md §5c.

- [~] **Content-hash dedup como anti-spam — NO-GO atual (pesquisado 2026-05-21)**
  User proposta: SHA-256(content) como identificador pra dedup
  (mesmo conceito do NIP-94 imagens). Satoshi + Ted deliberaram em
  paralelo. Decisão final user: option A (NO-GO + documentação).
  Razões NO-GO: evasão custo zero (1 char muda hash), redundante com
  weight=0 (Sybil novo já invisível), falsos positivos em breaking
  news, slope perigosa rumo a filtro centralizado.
  Plano Ted Opção B (view-layer puro) pronto se reabrir:
  - Coluna `posts.content_hash TEXT` + index
  - `hashPostContent(subposts)` pure: NFC + trim + whitespace collapse
    (NÃO lowercase) + JSON canonical + SHA-256
  - Opt-in via `UserPrefs.dedup_enabled` default false
  - Penalty em `calculateScore` (factor 0.5 default)
  - Satoshi mitigations: never hide own post, threshold >5/1h
  Full deliberação: `Docs/sessions/content-hash-dedup-deliberation-2026-05-21.md`
  Reabrir requer evidência concreta de spam NÃO resolvido por
  weight=0, não suspicion geral.

- [~] **Tinder queue patterns — parcialmente shipado (Lily audit 2026-05-21)**
  Ver `Docs/sessions/lily-tinder-audit-2026-05-21.md`.
  - [x] Item 2 (Zustand queue cap FEED_QUEUE_CAP=100) — shipado
  - [x] Item 3 (snapshotTs + FeedSnapshotAgeBadge UI) — shipado
  - [x] Item 3 batch atômico — já era feito (✅ pré-existente)
  - [ ] **Item 1: Threshold N/2 refill (deferred)** — 8h plano:
    `useFeedStore` cursor explícito + `ensureQueueDepth(currentIdx)`
    dispara fetch batch quando `cursor > posts.length -
    FEED_REFILL_THRESHOLD(25)`. LOCK_VIA_TEST `feed-refill.test.ts`.
    Reabrir quando: logs mostrarem feed >100 posts/user frequente OR
    user report de "spinner ao chegar no fim".
  - [ ] Item 4 rewind RAM (defer — feature paga Tinder, fora MVP)
  - [ ] Item 5 cold start parcial (defer — SQLite WASM rápido já cobre)

- [ ] **Lens edges: column `created_at` imutável (Sybil-refresh defense)**
  Trigger: Satoshi audit pair-review 2026-05-20. Hoje `lens_edges.updated_at`
  é refresh-on-write — atacante "renova edges" antigos zerando o decay
  (GAP-1). Fix: schema bump pra adicionar `created_at INTEGER NOT NULL`
  (imutable), decay usa `max(age_created, age_updated)` (conservative).
  Bloqueio: schema bump requer migration script + LOCK_VIA_TEST update.
  Defer até telemetria mostrar attack pattern real OR antes de Phase 2
  Web of Trust audit.

- [x] **GAP-2: filter → edge feedback loop** — fechado 2026-05-20
  em [PENDING-pool]. Decisão: **NÃO IMPLEMENTAR** (Satoshi pick).
  Razões:
  - Anti-Sybil > convenience: feedback loop seria vetor de ataque
    onde Sybil rings usariam filter-rule farming pra silenciar
    autores legítimos via edge collapse cross-rede
  - Manifesto §22 (sem reputação): filter rule é layer LOCAL (mute);
    não deve modificar grafo de influência que outros users compartilham
    via re-derive cross-device
  - User power que quer "não ver X" usa filter rule (já existe);
    quer "X some pra todo mundo" é reputação coletiva — vetada §22
  - UX cost baixo: filter rules já escondem posts visualmente; PPR
    decay temporal (GAP-1) resolve "follows antigos pesam demais"
    sem expor vetor adversarial
  Próximo passo se reabrir: requereria threat model novo + Satoshi/Barney
  consenso ALL-CLEAR (não conseguimos achar attack vector mitigável).

- [x] **GAP-CLUSTER: detecção de cluster (LPA)** — fechado 2026-05-20
  em [PENDING-pool]. Decisão: **DEFER PHASE 2** (Ted/Lily consensus).
  Razões: LPA tem custo computacional não-trivial (O(V·E) por iteração,
  múltiplas iterações até convergência) sem ROI claro hoje — base
  usuário ainda pequena, dados de uso real pra calibrar não existem.
  Reabrir quando: (a) DAU > 1000 + grafo médio >100 follows POR user,
  (b) FORA/Vertex feedback indicar gap concreto em discovery.

- [x] **PR-4c timing — worker thread pra recompute** — fechado
  2026-05-20 em [PENDING-pool]. Decisão: **NÃO SHIP AGORA** (Ted/Marshall
  consensus). Razões:
  - PR-4b shipped main-thread com ~75ms median em mid-range phone —
    abaixo do RAIL 100ms threshold pra "responsivo"
  - Worker overhead (postMessage serialization + thread spawn) pode
    igualar ou exceder ganho pra payload pequeno (típico user <500 follows)
  - Premature optimization risk: sem profile real de "este recompute
    travou minha UI", complexidade extra é débito
  Reabrir quando: telemetria local mostrar p95 > 200ms OR user report
  de UI stutter em PostViewer scroll durante lens recompute.

- [x] **PR-5 scope expansion** — fechado 2026-05-20 em [ac262ca].
  Toggle "mostrar quando lente reordenou" shipped via SuaLenteCard
  ReorderIndicatorToggle + LensInspector chip styling gateado.
  Default OFF, opt-in pra user power.

- [x] **Robin multi-list research re-dispatch** — fechado 2026-05-20
  em [PENDING-pool] (decisão registrada). Agente background original
  expirou há dias; research materializado em
  `Docs/sessions/lily-multi-list-deep-dive-*.md`. Decisão conservadora:
  ABORTAR re-spawn — research já consolidado, nova rodada seria
  redundante. Se precisar revisitar, dispatch novo HIMYM com escopo
  fresh em vez de re-spawnar legacy.

---

## Bugs reportados — em investigação

- [x] **Long-press 5s → 3s + ripple CSS animation (substituiu progress bar)**
  User pedido 2026-05-21. Shipado same session:
  - LONG_PRESS_MS 5000 → 3000 em PostViewer.tsx
  - Progress bar linear + label substituídos por **animação radial CSS**
    a partir do ponto exato do toque (pressOrigin coord)
  - 3 ondas concêntricas com delays 0/0.4/0.8s — usuário SENTE tempo
    passar via expansão visível, sem leitura de texto
  - `src/styles/ripple.css` novo: @keyframes ripple-wave + reduced-motion
    fallback (WCAG 2.3.3)
  - Micro-label discreto bottom-center pra a11y (aria-live polite)

- [~] **Ativar localização — fix shipado 2026-05-21**
  Lily audit `Docs/sessions/profile-picture-audit-2026-05-21.md` style
  (read-only Explore). Diagnóstico: 2 problemas:
  - **Layout reflow:** div summary cresce/encolhe ao mudar granularity
    → fix: minHeight 88px + sempre renderiza (zero reflow)
  - **Confusão "GPS travando":** user pensa que ativar precise dispara
    GPS imediato → fix: nota explicativa "GPS só é solicitado ao
    publicar/driftar — ativar aqui NÃO bloqueia"
  Residual: PermissionsCard (fora deste fix) ainda pode travar 10s sem
  feedback — registrar como gap separado se reproduzir.
  Reportado user 2026-05-21. Sintoma: ao tentar ativar location
  granularity (Settings → Localização), tela trava OU layout quebra.
  Agent dispatch pra audit:
  - LocationCard render correto pra todos granularities?
  - getCurrentLocation Promise hangs sem timeout?
  - granularity 'precise' espera GPS browser API; timeout adequado?
  - Layout responsivo em mobile?
  Investigação pendente.

- [x] **Mapas mostrando mesmas localizações — diagnóstico Ted 2026-05-21**
  NÃO É BUG CÓDIGO. Ted audit (Read-only Explore) confirmou:
  - Queries SQL retornam datasets distintos (post ⊂ global, network
    ⊆ global filtered by follows)
  - Cache invalidation correto (useEffect deps `[data, mapView]`)
  - Sem reutilização cross-mode
  **Root cause:** falta de dados (small base ~4-10 spreads geo).
  - Se base tem 5 spreaders distintos e user segue 3 deles, os 3 modes
    naturalmente convergem visualmente
  - Aceito por construção em MVP — modes ficarão distintos quando base
    crescer (DAU >100 + spreaders geo distintos)
  **Mitigation futura (não-urgente):**
  - UI hint "base pequena — modes podem parecer similares" quando
    spreads count < 20
  - Cores distintas por mode (post=âmbar, global=mint, network=rosa)
  Reabrir quando user reportar regressão real OU base crescer + modes
  continuarem idênticos.

- [~] **Profile picture parcialmente funciona — auditado 2026-05-21**
  Lily audit:
  `Docs/sessions/profile-picture-audit-2026-05-21.md`. **Diagnóstico:**
  NÃO é bug — feature MVP+1 incompleta. User CONSEGUE publicar (kind 0
  com picture), avatar APARECE em ProfileModal. **Mas NÃO aparece** em
  feed/PostViewer/CommentCard porque `feed.ts:rowToPost()` (linhas
  319-339) omite `authorAvatar`/`authorAlias` (campos opcionais nunca
  populados).
  **Fix proposto** (~4-6h, ~200 LoC + tests):
  - feed.ts rowToPost: LEFT JOIN users_metadata
  - SubpostLayout: header autor (avatar + name) nos 3 layouts
  - CommentCard: idem
  - LOCK_VIA_TEST: avatar em feed === picture em kind 0
  Cabe em Sprint N+2 P2 OR defer (cosmético — manifesto não exige).

- [~] **Redundância — audit Satoshi 2026-05-21 (7 OK / 3 parciais / 1 não-impl)**
  Doc: `Docs/sessions/satoshi-redundancia-audit-2026-05-21.md`.
  **Diagnóstico:** Drift não falha em redundância core. 2 gaps de
  **automação** (não código).
  **Top 3 closures Sprint N+2 (~2.5h total):**
  - **#1 Auto-trigger re-broadcast em `addRelay()`** (~30min) —
    rebroadcast existe mas é manual. Promessa §16 só funciona se user
    saber clicar. Fix ZERO risk.
  - **#2 Auto-pin IPFS em score > threshold** (~60min) — alinha com
    Sprint N+2 P0 0.1 já priorizado (§16 IPFS pin automático).
  - **#3 Random walk pós-CONNECTED — DOC ONLY** (0min) — registrar em
    known-limitations com reopener Fase 6 WebRTC.
  **Cenários NÃO TOCAR:** multi-id, backup nsec, NIP-65, SQLite
  rebuild, probe ciclo — gold-plating risk.

---

## Performance / Métricas

- [ ] **Mais uma rodada LHCI — melhorar métricas Core Web Vitals**
  Adicionado pelo user 2026-05-21. Última rodada LHCI registrada em
  `Docs/sessions/cwv-final-report-2026-05-09.md` e
  `round-11-perf-2026-05-16.md`. Reabrir pra:
  - Re-measure LCP / CLS / INP / TTFB / TBT pós sessões maratona
    2026-05-17→05-21 (PostViewer cleanup, primitives novos, mapa 5
    refactors, etc.)
  - Identificar regressões (PostViewer perdeu 270 LoC mas ganhou
    HintChip, SoloSpreaderWarning, ModeToggle, social-nodes layer —
    delta?)
  - Bundle size delta (deck.gl layers tree-shake ainda OK pós-E?)
  - LCP threshold mid-range mobile (Lily targets 2.5s)
  - INP threshold 200ms (post SINK sessionBuriedIds adicionou
    useMemo extra — verify não regrediu)
  Bloqueio: nenhum técnico — só agendar quando user quiser.
  Tools: Vercel deploy preview + Chrome DevTools Lighthouse OR
  GitHub Actions LHCI workflow (se já existe; senão adicionar).

---

## Infra / Arquitetura — adicionados 2026-05-17 (sessão noite)

- [x] **i18n — spike + relatório** — fechado em [86ff522].
  Relatório completo em `Docs/sessions/i18n-spike-2026-05-17.md`.
  Recomendação: **LinguiJS v4** (bundle ~2 KB, macros AOT, ICU
  completo, types gerados). Catalog PO files por locale em
  `src/locales/<lang>/messages.po`. Weblate self-host pra workflow
  comunidade (manifesto §17 — sem chave mestra em plataforma de
  tradução). Phase 1A: PT-BR + EN (10 dias, +8 KB bundle, dentro do
  budget). RTL (AR/HE) defer pra Phase 2. Glossário protocolar
  (SPREAD/BURY/NIP-*/nsec/npub) congelado via LOCK_VIA_TEST. Decisões
  abertas: GO/NO-GO Phase 1A, Weblate hosting, initial locales,
  CONTRIBUTING-i18n.md author. Bloqueio: aguardando user direcionar
  scheduling.

- [x] **Ícones header (🌐 NetworkMode + 📍 LocationGranularity) — escopo
  expandido?** — fechado 2026-05-20 em [PENDING-pool]. Decisão:
  **STATUS QUO** — não expandir. Razões (HIMYM consenso):
  - Lily: gestural overload (long-press 5s já usado pra slim mode; mais
    long-press em ícones cria conflito de gesture)
  - Ted: dual-path atalho pra Settings é affordance simples e
    discoverable; cycle Tap reduziria descoberta de outros modos
  - Barney: long-press status detalhado tem valor mas StatusCard já
    cobre via menu Settings → Status
  - Robin: Twitter/Discord/Linear não fazem multi-function em status
    icons; pattern raro
  Reabrir se user reportar fricção real procurando status sem ter
  que abrir Settings.

- [x] **Atomic Design adoption** — fechado 2026-05-20 em [PENDING-pool].
  Decisão: **GRANDFATHER + GUIDELINE FORWARD** (Ted/Lily pick).
  - **NÃO refatorar** estrutura atual (src/components/{UI,Settings,
    Post,Profile,Identity,Create} por domínio). Custo (touching ~80
    arquivos, churn de imports, conformance refresh) >> benefício.
  - **Aplicar guideline em novos primitives**: arquivos novos em
    `src/components/UI/` continuam sendo "atoms" implícitos
    (DriftButton, Toggle, DriftChip, RadioGroupButton, HintChip,
    SettingExplainer, AccordionGroup). Composições novas ("molecules")
    co-locadas no domínio (Settings/SuaLenteCard usa atoms de UI).
    "Organisms" = cards do dominio (PostViewer, ProfileModal, etc.).
  - **Manifesto §17 alignment**: estrutura por domínio reflete o
    modelo mental do user-developer (busco config → vou em Settings;
    busco card de post → vou em Post). Atomic-Design por níveis
    abstratos seria optimização pra design-systems puristas, não pra
    contributors externos.
  - **Reabrir se**: design-system extraction virar produto separado
    (lib publicada), OR contributors externos reportarem fricção
    procurando componentes na estrutura por domínio.

## BUGS — prioridade alta (correção sem polish)

- [x] **Satoshi findings — CSV validation + race fix** — fechado em
  [7eb0549]. Top vuln #1 (upload_endpoint badge) ficou em [2e9fa75];
  restantes #2 + #3 fechados aqui:
  - **#2 `parseDismissedBag`**: RULE_ID_PATTERN `/^[a-z0-9][a-z0-9-]*$/`
    valida shape em parse + serialize (defense in depth). IDs
    malformados (espaços, vírgulas, chars especiais) silenciosamente
    descartados — bag sempre íntegro.
  - **#3 `dismissRule/dismissRules`**: refatorados pra
    `persistDismissedIds` helper que lê SOURCE OF TRUTH (SQLite via
    `db.get`), não confia no store. Funciona mesmo durante race no
    boot (caps=null). Store atualizado best-effort se loaded.
  - 5 testes novos em capabilities-conformance (RULE_ID_PATTERN
    presence + parse/serialize filter + persist behavior +
    delegation + race tolerance).

- [x] **Settings/menus — friction audit + framework completo** —
  audit em `Docs/sessions/settings-friction-audit-2026-05-18.md`.
  Shipado em 5 commits (Phase 1+2+3+5+6):
  - [45cd93f] Phase 1: SettingExplainer primitive + 3 cards
  - [0350ac8] Phase 2: refactor restantes 6 cards (allowlist zerado)
  - [e27a3f4] Phase 3: level=advanced gate + AdvancedToggle (depois
    substituído na Phase 6)
  - [8468518] Phase 4: AccordionGroup primitive + 4 cards
  - [ca96ed8] Phase 6: Menu Detalhado com 4 flags granulares
    (substitui binário advanced) + MenuDetailCard
  - [343a736] Phase 6.1: 5ª flag (labels ActionsFan)
  Resultado: 24 conformance tests + 9 cards refatorados. Gold standard
  pattern SuaLenteCard replicado em todos via primitive.

- [x] **AccordionGroup primitive (Ted HIMYM)** — shipado em [8468518].
  React Context com accordionId semântico; reusa Collapse +
  ChevronDownIcon. SettingExplainer ganha branch in-group vs standalone.
  4 cards Settings multi-explainer integrados (Filters/Diag/Sov/Peers).

- [x] **SuaLenteCard polish (Lily HIMYM)** — shipado em [b597301]. P0
  track fill + P1 label demote + P2 dots clicáveis + P3 collapse
  "como funciona" + P4 remove inner card.

- [x] **Bootstrap first-load UI freeze (Barney+Robin HIMYM)** —
  Hipótese #1 [3a0332f] auto-finish quando rules vazio +
  Hipótese #2 [2b344d0] HomeEmpty skeleton durante !feedLoaded.

- [x] **Upload endpoint badge (Satoshi audit)** — shipado em [2e9fa75].
  ComposeOverlay mostra warning quando upload_endpoint customizado +
  hasAnyImage. Defesa via visibilidade contra pre-poisoned device.

- [~] **Radio-group active state invisível em Velatura (parcialmente
  fechado)** — fix point-by-point shipado nas Phase 1+2:
  - LocationCard [45cd93f]: `border-drift-accent bg-drift-accent/15
    text-drift-accent` (era /50 e /10). Visível em Velatura.
  - NetworkModeCard [45cd93f]: mesmo pattern. Visível.
  - MapViewCard: usa segmented control com pill animado layoutId,
    pattern diferente, já era OK.
  - FiltersCard: refatorado com SettingExplainer + Toggle, não
    radio-group.

  **Ainda aberto:**
  - Cross-component audit completo (busca por padrão `/10` `/30`
    `/50` em outros radio-groups ad-hoc fora de Settings)
  - Extract primitive `<RadioGroupButton>` / `<SegmentedControl>`
    pra prevenir regressão
  - LOCK_VIA_TEST `radio-active-contrast` validando luminance/
    saturation diff em todos 3 temas (WCAG 3:1 mínimo entre states)

  Bloqueio: HIMYM dedicado (Lily UX pattern + Marshall conformance)
  quando for prioridade. Não-urgente — bug visível foi resolvido nos
  3 cards onde user reportou.

- [~] **PWA SW serve HTML stale após deploy Vercel novo** — fix em 2
  partes:
  - **Parte NÃO-política (fechada em [9e05c8f])**: Workbox config
    ganha `cleanupOutdatedCaches: true` + `navigateFallback: '/index.
    html'` + NetworkFirst pra navigation requests (timeout 3s). Quando
    SW novo ativa, precache antigo é limpo (sem chunks órfãos). HTML
    sempre tenta fresh do server, cache só usado offline. `register-
    Type: 'prompt'` intocado — user continua clicando "atualizar"
    explícito (§17 preservado). HIMYM convergência: Ted/Barney/Robin
    aprovaram, Lily neutral, Satoshi positivo (stale precache era
    attack surface mínima).
  - **Parte política (ainda aberta)**: decisão `registerType: 'prompt'`
    vs `'autoUpdate'`. Hoje user clica "atualizar" no banner; com
    autoUpdate, SW troca silenciosamente. Trade-off:
    - prompt = §17 forte (user consent), mas pode ignorar prompt e
      ficar em versão antiga indefinidamente
    - autoUpdate = sempre fresh, mas "chave mestra disfarçada" — quem
      controla deploy pode pushar JS arbitrário sem user perceber
    Bloqueio: decisão sua. Status quo (prompt) continua funcional
    porque a parte não-política reduz drasticamente o impacto de
    stale precache.
  - Recuperação imediata (botões "forçar atualização" no error
    screen) continua disponível em [2f453a8].



- [x] **BUG-LONGPRESS-FAN** — fechado 2026-05-17 em [aff356d].
  `data-no-longpress="true"` no wrapper `<m.div>` de cada FanItem.
  Pattern já estabelecido pra ⋮ trigger (linha 671 PostViewer).

- [x] **BUG-UPDATE-BUTTON: "atualizar" não faz nada sem feedback** —
  fechado 2026-05-17 em [52e7175]. User reportou que botão "atualizar"
  no Settings > Sobre frequentemente "não fazia nada" e precisava F5
  manual sem indicativo visual. Causa: confiávamos que
  `updateServiceWorker(true)` faz reload sozinho; em Chromium PWA
  installed mode + SW state estranho, falhava silenciosamente.
  Fix: estados visuais granulares (checking/applying/reloading/latest),
  `window.location.reload()` explícito como fallback após 800ms,
  bg color diferenciado por fase, aria-live="polite".

## Satoshi adversarial audit — lacunas pendentes

- [ ] **Satoshi Lacunas 1/3/4/5 — definição + priorização** — após
  Lacuna 2 (nsec exposure guards) ship em [b76245b], lacunas restantes
  não foram registradas no repo com definição crisp. Hipóteses
  candidatas mencionadas em sessões anteriores:
    - PPR (Personal Page Rank) gaming via Sybil/coordinated farming
    - Eviction silenciosa de posts pinned vs spread cache (§16 vector)
    - NIP-65 fingerprint (relay list pública vaza social graph)
    - Reports kind 9081 doxxing (reporter pubkey exposto, vetor de
      retaliation se chains de reports forem auditáveis)
  Bloqueio: precisa Satoshi HIMYM dispatch dedicado pra threat-modelar
  cada uma + priorização (qual viola manifesto mais urgentemente).
  Não shipping cego — risco de fix superficial que não resolve raiz.

## RFC reviews — adicionados 2026-05-17 (sessão noite VI)

- [ ] **RFC DAOP-001 (Drift Adaptive Onboarding Protocol)** — Ted HIMYM
  review concluído. Veredict: aceita como **inspiração**, rejeita branding
  "Protocol" (não é protocolo, é arquitetura de cliente). Recomendação:
  renomear pra "Drift Adaptive Onboarding — Client Architecture".

  **Phase 1 minimal (~1 sprint, viável agora):**
  - `lib/capabilities.ts`: capacidades derivadas de queries SQLite locais
    (`hasFirstPost`, `hasFirstSpread`, `hasBackup`, `hasFollow`) — funções
    puras testáveis (CLAUDE.md invariante #16)
  - `user_prefs.capabilities_dismissed` bag substitui `onboarding_done`
    boolean por granularidade
  - `lib/guidance.ts`: store Zustand com regras declarativas hardcoded
    versionadas no client (regras = código, auditáveis)
  - Refactor `OnboardingOverlay` pra consumir mesmas regras (steps =
    capability gaps no boot)
  - 3 componentes UI: `HintChip` (passive), `HintToast` (reactive),
    `HintModal` (interactive)

  **Phase 2:** capability re-derivation no `setIdentityFromNsec`, hints
  contextuais em Discovery/Settings/PeersCard, i18n das regras.

  **Phase N (decisões políticas):** sugestões follows curadas (precisa
  HIMYM antes — colide §24), behavioral signals locais.

  **NUNCA fazer (manifesto irremediável):**
    - Kind Nostr novo `capability_acquired` (viola #14 + §28)
    - AI onboarding agent remoto/local-treinado-por-terceiro no cliente
      oficial (§17, §25, invariante #7)
    - Reputation-aware onboarding / trust-based guidance (§22)
    - Feed personalizado pra newcomer (§24)
    - Behavioral signals exportadas (§28)
    - Guidance Engine remoto servindo regras

  Próximos dispatches HIMYM se for adiante: Lily (copy hints PT, hierarquia
  HintChip/Toast/Modal, degradação progressiva), Marshall (LOCK_VIA_TEST
  pra non-export de signals, capabilities.ts pure function), Barney
  (threat: timing correlation pra deanonymizar newcomer; AI poisoning
  Phase N), Satoshi (capability portability sem servidor — re-derivação
  por replay é suficiente; gaming neutro porque caps não rankeiam),
  Robin (research onboarding decentralizado Damus/Coracle/Snort/Bluesky).

  **Recomendação imediata:** primeiro PR extrai 5 telas atuais do
  `OnboardingOverlay.tsx` pra regras declarativas em `lib/guidance.ts`
  mantendo paridade visual — refactor puro, abre caminho pra capabilities
  derivadas no PR seguinte.

  Bloqueio: aguardando user decision se adota Phase 1 minimal.

## UX / Design — adicionados 2026-05-17 (sessão noite V)

### ActionsFan (vertical icon menu sobre post)

- [x] **ActionsFan icons emoji → SVG** — fechado 2026-05-17 em [aff356d].
  ShareIcon (📤) + ImageIcon (🖼) adicionados a `UI/Icons.tsx`; mapping
  no FanIcon helper completo. Sprint 2/3 SVG migration agora cobre 100%
  do ActionsFan.

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

- [~] **Avatar cadastrado não exibido no perfil** — investigado
  2026-05-17. ProfileModal:120 JÁ renderiza Avatar component que tem
  `<img src={metadata.picture}>`. Causa raiz provável: cache stale
  pós-edit (kind 0 publicado mas não round-trippou via relay ainda).
  Refinado em [ba8b054] com defesa adversarial Barney (scheme whitelist
  https/data:image + referrerPolicy="no-referrer" + loading="lazy"
  contra DoS). Cache stale fica pra investigação futura — não-trivial
  (envolve fluxo onNostrEvent).

### MapViewCard

- [x] **MapViewCard — toggle FECHADO/ABERTO visual pobre** — fechado
  2026-05-17 em [6abf4cb]. Segmented control com pill chartreuse
  animada (motion.span animate x + spring), mesmo padrão FeedTabs
  indicator. Helper text movido pra fora do container.

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

- [x] **Onboarding com muito CLS entre steps** — fechado 2026-05-17 em
  [6abf4cb]. Container do `<m.div key={step}>` ganhou `min-h-[320px]`
  + CSS `contain: layout`. Steps variam 3-8+ linhas, sem min-h os
  buttons saltavam. Cobre step médio sem desperdiçar viewport mobile.

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
