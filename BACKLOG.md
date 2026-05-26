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

**📋 Sprint N+3 plan Satoshi (2026-05-21) — ZERO DÉBITO MADURO:**
`Docs/sessions/satoshi-sprint-n3-plan-2026-05-21.md`

Resumo (8-11d buffer-tolerant, 4 batches paralelos = 5-6d wall-clock):

**P0 (3.5d) — must-ship:**
| # | Item | Est | LOCK |
|:---:|---|:---:|---|
| 0.1 | D3 Profile picture render (já shipado N+2 2137243 — confirmar) | 4-6h | feed-author-avatar |
| 0.2 | D2 LHCI re-measure + delta | 1d | (doc) |
| 0.3 | D6 RadioGroupButton audit + WCAG contrast | 1d | radio-active-contrast |
| 0.4 | D11 SuaLenteCard polish round 2 | 1d | UX |

**P1 (2.25d) — abstração:**
| # | Item | Est |
|:---:|---|:---:|
| 1.5 | D1 useLensToggle hook | 1d |
| 1.6 | D4 ActionsFan visibility (drop-shadow) | 4h |
| 1.7 | D7 Audit dialogs antigos | 4h |
| 1.8 | D16 dismissRule rate-limit | 2h |

**P2 (2.75d) — stretch:**
| # | Item | Est |
|:---:|---|:---:|
| 2.9 | D5 ActionsFan labels PT-BR | 4h |
| 2.10 | D21 9 conformance it.todo → it() | 6h |
| 2.11 | D8 EditProfileCard banner → tooltip | 2h |
| 2.12 | D9 ComposeOverlay preview flow | 1d |

**Vetos:** D14 Satoshi Lacunas (threat-model first), D17/D22 (telemetria),
D12 (decisão user §17), D15/D18/D19/D20 (Phase 2/Fase 6), composição §6
lentes (defer N+4 pós feedback POC).

**Risco residual:** ~55% débitos fecháveis P0+P1 / ~75% com P2.
9 débitos ficam dependentes (correto — violar reopener seria
shipping prematuro).

**LHCI plan:** Day 0 (pré-sprint) + Day N (pós-sprint) — 5 métricas
× 3 datas em `Docs/sessions/lhci-2026-05-21.md`.

**Próxima ação user:** GO → Batch A dispatch (4 agents: 0.1+0.2+1.6+1.8).

**Batch A status (2026-05-21):**
- [x] **D3 Profile picture render feed reactivity** — fechado em
  [b84d63c] — `events.ts:persistUserMetadata` agora chama
  `invalidateFeed()` após persistir kind 0. Fix do gap residual: feed
  store mantinha snapshot pré-metadata até próximo evento de domínio
  chegar. LOCK_VIA_TEST `tests/feed-author-avatar.test.ts`.
- [x] **D2 LHCI re-measure + delta** — fechado parcial em
  [b84d63c] — `Docs/sessions/lhci-2026-05-21.md` publicado.
  Bundle entry gz 110→63 kB (-43%). LCP/INP/CLS/TBT inconclusivos
  (LHCI tropeçou em EPERM tmpdir cleanup Windows; audits rodaram, JSON
  perdido). CI workflow vai re-medir no PR. Sem regressão por proxy.
- [x] **D4 ActionsFan visibility** — fechado em [b84d63c] —
  container `shadow-lg`→`shadow-2xl` + `ring-1 ring-black/10` pra
  contraste WCAG AA sobre bg claro/foto. LOCK_VIA_TEST estendido em
  `tests/actions-fan-extract-conformance.test.ts` ("D4 visibility
  hardening").
- [x] **D16 dismissRule rate-limit** — fechado em [b84d63c] —
  trailing-edge debounce 250ms em `dismissRule`/`dismissRules` via
  `scheduleDismissFlush` + buffer Set. Floods (XSS/UI bug) coalescem
  em 1 db.get+db.run. API pública inalterada (Promise<void>).
  LOCK_VIA_TEST `tests/dismiss-rule-debounce.test.ts` (6 specs: single
  call, flood dedup, flood multi-IDs, debounce window reset, separação
  por janela, propagação de erro via promise).

---

## Bugs descobertos em re-verificação visual 2026-05-23

- [ ] **Mode badge (Satoshi A2) não renderiza** — `SpreadMap.tsx:746-753`
  tem `setBadgeMode` + AnimatePresence inteiramente correto, MAS:
  (a) `initialModeRef` nunca atualiza → retornar ao mode inicial não
  dispara badge; (b) badge está dentro de MapShell — em network mode
  com empty state ("SUA REDE ESTÁ VAZIA") MapShell pode não montar,
  fazendo badge nunca aparecer mesmo na primeira troca. Verificado em
  localhost: switching global → network não mostrou badge. Fix:
  (1) hoistar badge pra fora do MapShell pro overlay root, (2) deixar
  `initialModeRef` rastrear mode anterior em vez de só o inicial.
  ~20min. P1 (Satoshi feature shipou mas não funciona end-to-end).

- [ ] **GPS state persistente surge "preciso" sem ativação consciente** —
  pref `location_granularity` ficou `precise` após sessão de teste
  visual (re-aberto compose mostrou `📍 GPS` selecionado). Pode ser:
  (a) algum tap acidental durante navegação no LocationCard,
  (b) leftover de session anterior. Já existe item B3 reopener
  registrado — confirmar se essa observação reabre o gap. P2.

- [ ] **P2P aberto sem uso — auditar otimização (discovery idle cost)** —
  user observou 2026-05-23 que algum componente P2P (Fase 6 — WebRTC
  transport / peer discovery) está "aberto sem ser usado" durante uso
  normal. Investigar: `src/lib/transport/webrtc/` — `discovery.ts`,
  `peer.ts`, `boot.ts`, `peerLink.ts`. Hipóteses:
  (a) `startProbe()` ou discovery loop rodando 24/7 mesmo sem peers
      ativos → bandwidth/CPU waste;
  (b) WebRTC `RTCPeerConnection` instances ficam abertas após
      negotiation falhar (memory leak);
  (c) Followers/follow discovery sub iniciada no boot e nunca encerrada;
  (d) DataChannel sem traffic mas keepalive ping continua.
  Fix expected: idle-state detection + close/teardown quando sem
  atividade por N minutos (rehidrata sob demanda). Não quebrar §15
  anti-censura nem §16 disponibilidade — apenas evitar overhead idle.
  Bloqueio: confirmar com Lily se há instrumentação atual de "idle vs
  active" no transport. Marshall/Lily/Satoshi audit dispatch — 2-3h.
  P1.

---

## Pool de tarefas — gap audit Robin 2026-05-23

(Origem: `Docs/sessions/robin-pool-tarefas-gap-audit-2026-05-23.md`.
17 itens novos descobertos em audit AMPLA de 7 dias — docs de sessão,
commits, TODOs em código, sprint plans vs realidade. Top 3 críticos:
L-ID lens tests, AppErrorBoundary custom modal, GlassIconButton purge.)

### Bloqueantes pre-merge lens `identified-only`

- [ ] **L-ID-1 LOCK_VIA_TEST lens copy vocabulário proibido** —
  Barney threat-model 2026-05-23. `tests/lens-copy-conformance.test.ts`
  grep regex (`/verified/i`, `/trusted/i`, `/official/i`, `/genuine/i`,
  `/real\s+user/i`, `/not\s+a\s+bot/i`, `/anti[-\s]?spam/i`,
  `/✓\s*identif/i`, `/selo/i`, `/verificad/i`) em radius 200 chars
  de `identified-only`/`IdentifiedOnly`. ~50 LoC. Bloqueia copy creep
  que destrói §4 em 6 meses. **P1**. Reopener: se feature `identified-only`
  for shipada sem este test = NO-GO retroativo.

- [ ] **L-ID-2 LOCK_VIA_TEST registry sem promoção +
  Onboarding-veto** — `tests/lens-registry-conformance.test.ts`:
  nenhuma strategy com `default: true`/`recommended`/`featured`;
  grep `src/components/Onboarding/**` veta menção a `identified-only`;
  ordem dropdown determinística. ~80 LoC. **P1**. Bloqueante merge.

- [ ] **L-ID-3 Grep guard telemetria-zero em
  `src/lib/lens/**`** — sem `INSERT INTO`, `localStorage.setItem`,
  `analytics.track`. Sem KPI = sem nudge default-on. ~20 LoC (pode
  entrar no L-ID-2). **P1**.

- [ ] **L-ID-4 Warning modal não-dismissable + delay 3s na primeira
  ativação lens** — anti-click-through. ~30 LoC componente. **P2**.

- [ ] **L-ID-5 Composability warning quando 2+ filtros restritivos
  ativos** — banner "pode esconder a maior parte do feed". ~20 LoC.
  **P2**.

- [ ] **L-ID-6 Entry em `manifesto-coverage-matrix-*.md` linkando
  ambos docs Marshall+Barney lens** — rastro permanente pra
  contributors futuros entenderem POR QUE os guards existem. ~10 min
  edit. **P3**.

### Threats UX descobertos (Barney audit 2026-05-23)

- [ ] **B-UX-3 AppErrorBoundary custom inline modal** — P0 threat.
  `AppErrorBoundary.tsx:62` usa `window.confirm` em fluxo destrutivo
  (apaga TUDO local, inclusive nsec). User em estado de erro pode
  perder identidade achando que é "fix bug". Chicken-egg: boundary
  monta acima do provider, não pode importar `dialog.confirm`.
  Solução: inline custom modal pré-provider estilizado igual
  DialogHost. ~30-50 LoC. **P0**. Reopener: não precisa — bug agora.

- [ ] **B-UX-4 Remover microfone de PERM_ITEMS** — P1 threat privacy.
  `SettingsCards.tsx:1226` pede `getUserMedia({audio:true})` pra
  feature "futura" inexistente. Browser concede; Drift não usa.
  Footprint permanente sem benefício, manifesto §28 violação suave.
  Fix: remover item OU `disabled` + tooltip "indisponível — versão
  futura". ~10 LoC. **P1**.

- [ ] **B-UX-6 disablePasskey confirm com `dangerous: true`** —
  P1 threat. `IdentityPanel:650`. Remove camada de segurança mas
  confirm não comunica gravidade. ~3 LoC. **P1**.

### Vocabulário / copy LOCK_VIA_TESTs (Barney audit 2026-05-23)

- [ ] **B-UX-1 LOCK_VIA_TEST "configurações" canônico em strings
  JSX user-facing** — P0 vocab. 5 paths pra Settings com 5 labels
  distintos (config/configurações/Ajustes/Settings/location). Mesma
  família DRIFT/SINK do CLAUDE.md. Whitelist pra: "Ajustes" em
  iOS-guidance contexts (`GpsErrorBanner` etc). ~30 LoC test. **P0**.

- [ ] **B-UX-2 LOCK_VIA_TEST "spread" em strings JSX user-facing** —
  P0 vocab violação CLAUDE.md mapping (SPREAD é spec/código; DRIFT é
  UI). 5 hits hoje: `SpreadMap.tsx:193,196` empty state,
  `TimelineScrubber.tsx:73` aria-label, `SettingsCards.tsx:288,1204,
  1507`. `tests/manifesto-conformance.test.ts` cobre só
  `espalha|enterra`. Whitelist controlada (DriftChip `variant='spread'`
  é prop interno, não copy). ~30 LoC test. **P0**.

### Threats / debt estrutural (Ted audit 2026-05-23)

- [ ] **T-DC-2 GlassIconButton purge sizes `sm`/`md`/`lg` + default
  → `xl`** — P2 WCAG threat estrutural. Sizes < 44px ainda no union
  public (`md` é default!). Trap pra novos contributors violarem
  WCAG 2.5.5. Único caller usa `xl`. No-op runtime, fix
  WCAG-by-default. ~25 LoC. **P2**.

- [ ] **T-DC-3 Substituir comments `ContentSettings` →
  `SettingsCards`** — P3 doc rot. Arquivo `ContentSettings.tsx`
  não existe mais (V9.2c). 7 hits stale em App.tsx + lib/ confundem
  novos agents/devs. ~7 lines edit. **P3**.

- [ ] **T-DC-8 GlassPillButton extend (PostViewer comment+map
  buttons)** — P2 refactor. 2 botões inline em PostViewer (670-735)
  duplicam `glassIconButtonVariantClass('default')` base. Extender
  GlassIconButton com `slots: { badge, ripple }` ou criar
  primitive separado. ~2-3h. **P2**.

- [ ] **T-DC-10 PostViewer.tsx split (1044 LoC → sub-files)** —
  P2 manutenibilidade. Beira "Deus-component". Extrair
  `PostViewer/ActionsBar.tsx`, `QueueOverlay.tsx`. 3-4h. **P2**.
  Bloqueio: não bloquear sprint atual; coordenar com qualquer
  feature em vôo que mexa em PostViewer.

- [ ] **T-DC-11 `tests/primitive-adoption.test.ts` — defesa
  anti-shelf-ware** — P2 structural. Detecta primitive exportado em
  `src/components/UI/` sem caller externo por >30 dias. Defesa
  contra reincidência HintToast/HintModal/DriftCard. ~4h. **P2**.

### Gaps mapas (Satoshi P1 abertos + Ted polish)

- [ ] **S-MAP-2 CARTO tile banner one-time (sovereignty awareness)**
  — P1 sovereignty. Satoshi audit §6.5. Banner one-time (dismissible
  permanent) primeira vez que user abre mapa: "tiles servidos por
  carto.com — seu IP é logado por eles". Reusa LensNudgeBanner.
  Sovereignty pref já existe; user precisa SABER pra usar. ~40 LoC.
  **P1**.

- [ ] **S-MAP-3 Mini-map auto-close hint 30s inactivity** — P1
  anti-persuasion. Satoshi audit §6.1. Após 30s sem interação
  pan/zoom, mostrar hint "toque pra fechar" + animação subtle. Reset
  em pointer events. Mitiga E.1 (persistence persuasiva). ~25 LoC.
  **P1**.

- [ ] **S-MAP-4 CARTO tile cache em service worker
  `runtimeCaching`** — P3 perf. Workbox `CacheFirst + MaxAgeMs(7d)`
  pra `basemaps.cartocdn.com`. 2nd-open de mapa instantâneo. **P3**.

- [ ] **T-MAP-1 Tests puros mapas (4 helpers)** — P2 manifesto §7.
  `isUserSoloSpreader`, `pinColor(pprScore)` (5 branches),
  `buildGlobalNodes(rows)` (dedup + sort), `getMapExplainerCopy
  (context)`. Sem test direto hoje. ~80 LoC. ~30min. **P2**.

- [ ] **T-MAP-2 MapExplainerCard network legend respect
  `lens_show_in_map`** — P3 UX gap. Copy mostra 3 tiers PPR mas
  legend só faz sentido quando flag ON. Quando OFF, mostrar 1 dot
  "DRIFT remoto, default chartreuse". ~30min. **P3**.

- [ ] **T-MAP-3 Pin tap handler** — P3 feature. `pickable: true`
  configurado em socialNodes mas sem `onClick`. Tooltip futuro:
  npub + spread count + link Profile. **P3**.

- [ ] **T-MAP-4 Network mode empty state CTA** — P3 UX polish. Quando
  follows=0, oferecer "ir pro feed global" botão (não só copy).
  ~1h. **P3**.

### NO-GOs preventivos registrados

- [~] **NO-GO `<EmptyStateCard>` primitive** — registrado 2026-05-23.
  4 ad-hocs hoje (HomeEmpty + SpreadMap empty + EndOfFeed + ThreadView
  "sem comments"). Tentação de extrair (regra N=3+). Veto: cada empty
  state tem contexto semântico diferente; primitive forçaria props
  soup. Reopener: ≥6 ad-hocs + pattern visual idêntico.

- [~] **NO-GO `DriftButton` variants `danger`/`danger-prominent`
  purge** — registrado 2026-05-23. 0 callers atuais mas design intent
  (ações destrutivas merecem visual semântico distinto). Manter +
  comment "RESERVED — sem callers atuais; ver Round 11". Reopener:
  se feature destrutiva real (delete identity, reset profile UI)
  for shipada.

- [~] **NO-GO badge `✓`/`verified`/`selo`/`identif` em UI ao lado
  de autores** — registrado 2026-05-23. Marshall §6 veto duro #2 +
  Barney C2/C5 cultural pressure. Apenas copy factual ("perfil
  declarado"). LOCK_VIA_TEST L-ID-1 ENFORCE.

- [~] **NO-GO lens `identified-only` em Onboarding wizard** —
  registrado 2026-05-23. Barney B2. Qualquer menção em
  `src/components/Onboarding/**` (mesmo como exemplo) = NO-GO
  retroativo. LOCK_VIA_TEST L-ID-2 ENFORCE.

- [~] **NO-GO telemetria de adoção lens (local OU remoto)** —
  registrado 2026-05-23. Barney B3. Métrica vira KPI; KPI mata
  default-OFF. LOCK_VIA_TEST L-ID-3 ENFORCE.

### Fechamentos retroativos (descobertos no audit)

- [x] **HintToast + HintModal primitive shelf-ware removed** —
  fechado em [49b2a66] (descoberto retroativo 2026-05-23). 0 callers
  desde DAOP-001 PR3 design-ahead. 210 LoC removidas. Convergência
  Ted §4.2/§4.3 + Barney §3.1 audit 2026-05-23.

- [x] **GpsScopeButton primitive + lazy permission per-post (§28)** —
  fechado em [bf71ab7] + [0fb8c17] + [7f92e7e]. Per-post GPS scope
  decisão (off/país/cidade/GPS) com popover + frase de impacto. Lazy
  permission: navigator.geolocation só solicita quando user opta.
  LocationCard re-frameado como "padrão pra novos posts". 23
  conformance tests. Origem: agent Lily GPS `a1e860`.

### Sprint N+3 follow-ups (7 itens semi-fechados)

(Sprint plan Satoshi `Docs/sessions/satoshi-sprint-n3-plan-2026-05-21.md`
listou 11 fecháveis; Batch A rodou 4. Batches B/C/D nunca
dispatchados explicitamente. Itens abaixo são os pendentes
re-promovidos ao backlog raiz.)

- [ ] **D6 RadioGroupButton cross-component audit + WCAG** — Sprint
  N+3 P0.3 não-shipado. Audit `radio-active-contrast` LOCK_VIA_TEST
  + cross-component grep `/10` `/30` `/50` em radio-groups ad-hoc
  fora de Settings. ~1d. **P2**.

- [ ] **D11 SuaLenteCard polish round 2** — Sprint N+3 P0.4
  não-shipado. 5 pontos confusão flagged 2026-05-17 sessão noite V.
  ~1d. **P2**.

- [ ] **D1 useLensToggle hook (DRY 3 toggles)** — Sprint N+3 P1.5
  não-shipado. JÁ ESTÁ no backlog seção "Lentes pluggable — gaps
  pós-POC" — só reforçar bloqueio: aguarda D11 SuaLenteCard polish.
  (false-positive — não duplicar.)

- [ ] **D7 Audit dialogs antigos (grep `role="dialog"`)** — Sprint
  N+3 P1.7 não-shipado. Marshall + Lily, ~25 hits Ted §7.2 audit
  2026-05-23. Cross-ref FullPageCard/SlideUpOverlay. ~4h. **P2**.

- [ ] **D5 ActionsFan labels PT-BR (always-on first-show)** —
  Sprint N+3 P2.9 não-shipado. Ver detalhe em seção "ActionsFan"
  abaixo. **P2**.

- [ ] **D21 9 conformance it.todo → it()** — Sprint N+3 P2.10
  não-shipado. 6 grep-based + 3 Stage 3. ~6h. **P3**.

- [ ] **D8 EditProfileCard banner → tooltip** — Sprint N+3 P2.11
  não-shipado. ~2h. **P3**.

- [ ] **D9 ComposeOverlay "Prévia do post" preview flow** — Sprint
  N+3 P2.12 não-shipado. JÁ ESTÁ no backlog seção "ComposeOverlay
  — 'Publicar' → 'Prévia do post'". (false-positive — não duplicar.)

---

## UX iniciante — fricções observadas 2026-05-23 (revisão visual user)

(User observou ao testar o app na perspectiva de iniciante. 7 items
descobertos em 1 sessão. Padrão comum: signals visuais sem legenda
acessível imediata + estados sutis demais pra discriminar.)

- [ ] **"DERIVA 0.810" no header não é clicável / sem feedback** —
  novo usuário vai querer saber o que esse número significa. Score
  muda visualmente (vi de 0.000 → 0.810) mas sem explicação on-screen.
  Possíveis fixes: (a) tap abre tooltip/popover com 2-3 linhas "O que
  é DERIVA" + link pro GuideCard, (b) long-press 3s abre MapExplainer-
  style (consistente com pattern recém-shipado). P1.

- [ ] **"463 EV" opaco pra iniciante** — EV = Eventos. Status panel
  explica mas user médio passa direto sem clicar. Possíveis fixes:
  (a) tooltip on hover/long-press, (b) trocar copy "463 EV" → "463
  eventos" (custa horizontal space — header já crowded P3 conhecido),
  (c) primeiro tap abre painel status (já é o behavior — só faltou
  affordance visual indicando que é tappable). P1.

- [ ] **Tab dots (global•, seguindo•, em alta•) sem legenda** —
  fechado em [6eeb2c2] o bug de "dot na ativa" + a11y `aria-label="N
  novos"`. MAS visualmente a diferença laranja vs vermelho é sutil
  e sem onboarding/affordance que dot = novidade. Fixes: (a) primeira
  ocorrência mostra HintChip "○ indica posts novos" (dismissRule),
  (b) hover/long-press tooltip "N novos posts em <tab>". P2.

- [ ] **Botão "◐ Prévia" disabled state muito sutil** — quando
  textarea vazia, botão fica acinzentado mas visualmente parece
  "fraco" não "inativo". User pode clicar sem feedback. Fixes:
  (a) `cursor-not-allowed` + `opacity-50` + `pointer-events-none`,
  (b) tooltip "Escreva algo antes" no disabled state, (c) trocar
  copy disabled pra "✕ Prévia (escreva algo)". P2.

- [ ] **Tela "Modo de Rede" mostra aviso amber "REINICIA app"
  mesmo sem interação** — gera ansiedade desnecessária. Aviso
  deveria aparecer só após user mudar a seleção. Fix: gate
  `showRestartWarning` em `selectedMode !== currentMode`. P1.

- [ ] **Network mode no mapa: mental model fragmentado** —
  header "propagação", nav "MAPA", abas internas POST/GLOBAL/NETWORK
  com comportamentos distintos. User vê 3 nomenclaturas diferentes
  pra "mapa". Convergência com Satoshi (`satoshi-maps-audit`) +
  Ted (`ted-maps-review`) — já capturado parcialmente. Fixes
  possíveis: (a) consolidar naming (escolher "MAPA" como label
  primário em TODAS surfaces), (b) header overlay dinâmico
  "MAPA · este post" / "MAPA · global" / "MAPA · sua rede"
  (sub-header explicativo). P1.

- [ ] **Identidades múltiplas — sem preview do fluxo de criação** —
  submenu existe em Settings → Identidade → "identidades" mas não
  é claro o que acontece ao criar uma segunda. Falta:
  (a) preview dos passos antes de iniciar (1. gera nova nsec, 2.
  backup obrigatório, 3. troca ativa requer reload), (b) warning
  manifesto §3 "dispositivo descartável, identidade não — backup
  ANTES de qualquer ação destrutiva", (c) example empty state com
  call-to-action vs blank screen. P1.

---

## ✅ Fechados — rodada paralela Maps audits + Menu Detalhado (2026-05-22)

Sequência: Satoshi adversarial maps audit + Ted arquitetural review +
maps polish (long-press 3s + TimelineScrubber + GuideCard) + Sprint
N+3 Batch A. Rodada paralela HIMYM, todos pushed.

- [x] **SpreadMap ModeBtn long-press 3s educacional** — fechado em
  [e0b3741]. Long-press 3s em cada ModeBtn (post/global/network)
  revela MapExplainerCard com explicação contextual do mode. Reusa
  `useLongPress` hook + ripple CSS animation (pattern PostViewer).
  Gesture descoberta deferred via help text discreto. Bundled em
  [4eb72a2] junto com hook `useLongPress` extraído + LOCK_VIA_TEST
  `tests/map-explainer-conformance.test.ts`.

- [x] **TimelineScrubber básico (mapa temporal)** — fechado em
  [5433291]. Scrubber UI primitive permite ao user filtrar pontos do
  SpreadMap por janela temporal (slider 1h/6h/24h/7d/all). Defer:
  controle bidirecional drag-handles + persistência em user_prefs
  (separados, P3). MVP shipa range fixo.

- [x] **GuideCard educação user (Menu Detalhado expansão)** — fechado
  em [966d91e]. Card educativo inline em Settings Menu Detalhado
  explicando cada flag granular com exemplo concreto (não só label).
  Reduz fricção pra power-user descobrir efeito de cada toggle.
  Pattern reusável pra outras superfícies Settings.

- [x] **Ted arquitetural maps review** — fechado em [4eb72a2].
  Read-only audit conferiu queries SQL (post ⊂ global, network ⊆
  global), cache invalidation correto, sem leaks cross-mode.
  Arquivo: `Docs/sessions/ted-maps-review-2026-05-21.md`. 3 gaps
  estruturais registrados como items separados abaixo (split
  SpreadMap.tsx, camera persist, legend respect flag).

- [x] **Satoshi adversarial maps audit** — fechado em [a74639d].
  Threat model rodou em SpreadMap.tsx + queries + UI. Arquivo:
  `Docs/sessions/satoshi-maps-audit-2026-05-21.md`. Gaps P1 sendo
  atacados pelo agent Maps polish round 2 em paralelo (commit pending).
  1 P_phase2 doxx preventivo registrado abaixo (Profile map).

### Novos items deferidos da rodada

**Ted maps review:**

- [ ] **TimelineScrubber: sincronização exata com RAF do GlobalModeMap**
  V_2026-05-23 follow-up. Hoje fill bar sincroniza por **timing matching**
  (ambos componentes têm ciclo 10s linear infinite + montam juntos, fase
  coincide naturalmente). Funciona perceptualmente, mas se um remount
  acontecer (re-query data) sem o outro, a fase pode dessincronizar até
  o próximo loop. Solução robusta: migrar GlobalModeMap pra hook
  useMapInstance (igual ao PostModeMap) + extrair RAF state pra hook
  compartilhado que emite `progress (0..1)`; scrubber consome via prop
  controlled (currentTime mapped from progress). Estimativa ~3-4h.
  P3 — só priorizar se user reportar dessincronização visível.

- [ ] **Split SpreadMap.tsx (794 LoC) — fadiga estrutural iminente**
  Ted arquitetural review 2026-05-21
  (`Docs/sessions/ted-maps-review-2026-05-21.md`). Arquivo cresceu
  pra 794 LoC e mistura: layer rendering, mode toggle, long-press
  detector, scrubber, explainer card mount, query orchestration.
  Estimativa Ted: ~2h split em 4 sub-componentes (SpreadMapShell +
  SpreadMapLayers + SpreadMapControls + SpreadMapExplainer), zero
  risco funcional (refactor puro). Sprint dedicada futura. P2.
  Bloqueio: agendar Sprint N+4 ou pulse paralela quando agent maps
  polish round 2 finalizar (evitar conflito).

- [ ] **Camera state persist em `user_prefs.map_camera`** — Ted
  gap UX 2026-05-21. Hoje camera (lng/lat/zoom/bearing/pitch)
  reseta ao trocar mode OU sair/voltar do mapa. User power perde
  contexto. Fix: persistir tuple `{ lng, lat, zoom, bearing, pitch,
  ts }` em UserPrefs com debounce ~500ms, restore on mount.
  Estimativa: 1-2h + LOCK_VIA_TEST schema. P3.

- [ ] **MapShell legend network respect `lens_show_in_map`** — Ted
  polish 2026-05-21. Legend (badge tier moderation per relay)
  hoje aparece sempre em network mode; deveria respeitar flag
  granular `lens_show_in_map` quando user power desligar. Fix
  trivial: prop drilling do flag até MapShell legend render.
  Estimativa: 30min. P3.

**Satoshi maps audit:**

- [ ] **Map novo no Profile — NO-GO preventivo (K=1 doxx amplification)**
  Satoshi adversarial audit 2026-05-21
  (`Docs/sessions/satoshi-maps-audit-2026-05-21.md`). Adicionar
  mapa no Profile (mostrar spreads do user específico geo) seria
  amplificador K=1 doxx — feed-level já protege via aggregation,
  Profile expõe individual. Mesmo com location off-default,
  histórico de quem ativou GPS vira target. Reopener: K-anonymity
  engine (Phase 2 quando DAU > 1000 + threshold aggregation
  garantido). P_phase2.

**Menu Detalhado expansão:**

- [ ] **Sincronizar `Docs/guia-do-usuario.md` com GuideCard content**
  Agent Lily/Robin sugeriu spawn task separada quando shipou
  GuideCard em [966d91e]. Hoje GuideCard tem strings inline; guia
  do usuário PT-BR (Docs/guia-do-usuario.md) não menciona as flags
  granulares do Menu Detalhado. Fix: extrair fonte canônica
  (constante TS exportada OU MD parsing) + atualizar guia com
  seção "Menu Detalhado" + cross-link bidirecional. Estimativa
  ~2h escrita. P2. Bloqueio: nenhum técnico — agendar quando
  user power feedback indicar gap.

---

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

Última atualização: 2026-05-23 (Robin pool de tarefas gap audit — 17 novos + 5 NO-GOs + 2 fechados retroativos)

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

- [x] **Ativar localização — fechado em [36809ef] + [a7ebdc8]**
  Lily audit `Docs/sessions/profile-picture-audit-2026-05-21.md`
  diagnosticou 2 problemas. Fixes shipados:
  - **Layout reflow:** minHeight 88px + sempre renderiza (zero reflow)
  - **Confusão "GPS travando":** nota explicativa "GPS só é solicitado
    ao publicar/driftar — ativar aqui NÃO bloqueia"
  - **B3 reopener (Robin)** [a7ebdc8]: ícone GPS no header passa a
    cinza→colorido após visita ao Mapa sem ativar GPS — mitigado via
    copy "abrir GPS settings" (era "ativar GPS"). Anti-misclick em radio.
  Residual: PermissionsCard pode travar 10s sem feedback se reproduzir
  — gap separado abaixo.

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

- [x] **Profile picture render feed/comments — fechado em [2137243]**
  Lily audit `Docs/sessions/profile-picture-audit-2026-05-21.md`. Fix
  Sprint N+2 P2.11: feed.ts LEFT JOIN users_metadata + SubpostLayout
  header autor + CommentCard + AuthorChip primitive. 14 conformance
  tests. Sprint N+3 P0.1 (D3 no plan Satoshi) confirma feature shipada
  — reopener se regressão visível for reportada.

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

## Sprint N+2 close — pendências derivadas (2026-05-21/22)

(Origem: handoff-2026-05-21-sprint-n2-close.md + revisão visual 9 bugs
B1-B9 + Lily Material Ripple report + audits paralelos.)

### Lentes pluggable — gaps pós-POC

- [ ] **Composição §6 lentes (∪ ∩ −)** — design ready em
  `Docs/lens-pluggable-design.md` §6, defer Sprint N+4 pós feedback
  do POC shipado em [98ce60d]. Reabrir quando: user reportar caso
  concreto onde uma única estratégia não basta, OU N+3 finalizar
  abstrações (useLensToggle 1.5) e abrir capacidade para compor.

- [ ] **Persistência `active_lens` em UserPrefs** — POC shipou volátil
  (lens ativa some no reload). Defer N+3/N+4. Bloqueio: schema bump
  + migration. Reopener: user reportar "perdi minha lente ao recarregar"
  OU lente custom shareable chegar (precisa persistir pra ter sentido).

- [ ] **useLensToggle hook (DRY 3 toggles SuaLenteCard)** — Sprint
  N+3 P1.5 (D1 no plan Satoshi). Estimativa 1d. Bloqueio: aguardar
  P0.4 SuaLenteCard polish round 2 estabilizar antes de extrair.

### Material Ripple primitive — adoção (Phase 1 wiring)

- [ ] **Material Ripple Phase 1 wiring (4 componentes)** — primitive
  shipado em [984aa2d] mas adoção NÃO autorizada. Lily report
  `Docs/sessions/lily-material-ripple-report-2026-05-21.md` lista 4
  superfícies (DriftButton, GlassIconButton xl, Settings rows, modal
  close). Estimativa 4-6h + LOCK_VIA_TEST `material-ripple-adoption`.
  Bloqueio: 3 perguntas Q1/Q2/Q3 abertas pra user — DriftChip md
  default, double-edge coexist, Settings rows full-width vs contained.
  P1.

- [ ] **Material Ripple Q1: DriftChip md default ON/OFF?** — chip 40px
  está no limiar WCAG 44px. Lily recomenda OFF + crescer para 44px.
  Decisão user pendente. Sub-bloqueio do item acima. P2.

- [ ] **Material Ripple Q2: GlassIconButton xl double-edge coexist
  ou hide-border durante wave?** — Lily recomenda A (coexiste, ripple
  z-0 atrás de border). Decisão user pendente. P2.

- [ ] **Material Ripple Q3: Settings rows full-width vs contained
  toggle?** — Lily recomenda A (full-width, scale ~280px). Decisão
  user pendente. P2.

### Revisão visual 9 bugs (B1-B9) — pendências derivadas

(5 commits shipados 2026-05-22: a7ebdc8 + 7ce19d9 + ea491be + 6eeb2c2
+ 94f5b07. Bugs principais fechados; observações residuais ficam.)

- [ ] **B3 reopener: escalar UX deeper se misclick persistir** — mitigação
  shipou copy "abrir GPS settings" em [a7ebdc8]. Robin notou no commit:
  "se persistir, escalar pra UX deeper (confirm dialog OU separar 'ver
  granularidade atual' do CTA 'ativar')". Reopener: user reportar
  novamente que GPS icon mudou cor sem ele querer ativar. P2.

- [x] **B5 DERIVA "—" vs "0.000" — fechado em [7ce19d9]** — decisão
  permanente: header sempre renderiza `formatScore(currentScore ?? 0)`
  = "0.000" uniforme (em-dash removida do hot path). Semântica "score
  zero" consistente entre tabs com/sem post focado. Não reabrir sem
  evidência de confusão.

- [ ] **Image "indisponível" placeholder ocupa ~30% do card** — P1
  polish da revisão visual 2026-05-22. Não-bug crítico mas card fica
  desbalanceado quando imagem falha carregar. Possível fix: reduzir
  altura do placeholder OU usar layout flex que colapsa quando sem
  imagem. Bloqueio: HIMYM Lily decidir tradeoff (preserva consistência
  vertical entre cards vs reduz desperdício visual). P2.

- [ ] **Bootstrap "aguardando" 2-3s na primeira carga** — P2 polish
  observado em revisão visual 2026-05-22. Pode ser preview-only
  (Vercel cold start) OU real (SQLite WASM init + first relay
  connect). Bloqueio: medir LHCI Day 0 (Sprint N+3 P0.2) confirma
  TTFI real antes de investir em fix. Reopener: LHCI mostrar TTFI
  > 3s em mid-range mobile real. P2.

- [ ] **Header crowded em 375px viewport** — P3 polish observado em
  revisão visual 2026-05-22. Já mencionado em sprints anteriores
  (item dispersos). Confirmar com Lily se chegou a entrar em sprint
  passado OU se foi sempre defer. Reopener: user reportar tap em
  ícone errado por overlap. P3.

### Theme / Persistência observada

- [ ] **Theme persist Rosenholz: default fresh boot deveria ser
  Cinder?** — observado durante revisão visual 2026-05-22 que fresh
  boot pode estar em Rosenholz quando default deveria ser Cinder.
  Investigar: `user_prefs.theme` default em schema.sql + boot path
  em bootstrap.ts. Provável não-bug (pref persistida de sessão
  anterior), mas vale confirmar que reset full (clear OPFS + IndexedDB)
  começa em Cinder. Bloqueio: 30min audit Marshall. P3.

### Auditorias residuais (audits paralelos 2026-05-20/21)

- [ ] **Redundância audit — outros 7 OK cenários documentados, mas
  doc-only changes pendentes?** — Satoshi audit
  `Docs/sessions/satoshi-redundancia-audit-2026-05-21.md` listou 10
  cenários. Top 3 closures shipados Sprint N+2 (#1 auto-rebroadcast
  [88d1337], #2 auto-pin IPFS [11ec501], #3 random walk DOC [6c5f768]).
  Outros 7 cenários FUNCIONAIS (multi-relay publish, backup nsec,
  multi-id, NIP-65, SQLite rebuild, probe ciclo) confirmados OK —
  NÃO TOCAR (gold-plating risk). Item registrado pra clarificação:
  estado confirmado, não há ação pendente. Pode fechar como [x] na
  próxima review se user confirmar. P3.

- [ ] **Satoshi 7-algoritmos audit — closures registrados em
  known-limitations.md §5b/§5c — confirmar todos endereçados** —
  audit em [bbf69a0]. §5b NOP POST event fechado em [bf76dda]. §5c
  brigada insider PARCIAL via report decay em [fc306c2]. Validar
  na próxima sessão que nenhum surface residual virou item separado
  perdido. P3.

---



- [ ] **Mais uma rodada LHCI — melhorar métricas Core Web Vitals**
  Adicionado pelo user 2026-05-21. **Status 2026-05-22:** Sprint N+3
  Batch A (D2 LHCI re-measure) rodou parcial — `Docs/sessions/lhci-2026-05-21.md`
  publicado com bundle entry gz 110→63 kB (-43%). LCP/INP/CLS/TBT
  inconclusivos (EPERM tmpdir Windows; CI workflow disparado, await
  Linux run pra resultado limpo). NÃO fechar até CI Linux entregar
  números íntegros. Última rodada LHCI registrada em
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
