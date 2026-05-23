# Robin — Pool de tarefas / gap audit amplo (2026-05-23)

**Persona:** Robin (research, curadoria, gaps cross-cutting, docs hygiene)
**Trigger:** user "Veja qual agente está livre para elencar o pool de
tarefas, ele deve ir verificar tudo que não está nos backlog de tarefa".
**Escopo:** auditoria AMPLA META — diferente da hygiene 2026-05-22
(`e34a391`, que cobriu 2 dias), essa cobre 7 dias e olha pra
recomendações **ainda não acionadas** em docs de sessão, commits,
TODOs em código e Sprint plans vs realidade.
**Coordenação:** agents em vôo (Dead UX cleanup `a3a028`, Lily GPS
`a1e860`) tocam `src/**`; este audit toca **só** `BACKLOG.md` + este
doc. Zero overlap.

---

## §1. Sumário executivo

| Métrica | Valor |
|---|---|
| Itens novos adicionados ao BACKLOG | **17** |
| Itens existentes que precisam update (reopener/prio) | **3** |
| Itens já fechados retroativamente (`[x]` faltando) | **2** |
| NO-GOs preventivos a registrar | **5** |
| False-positives validados (já cobertos sob umbrella) | **6** |

**Top 3 críticos imediatos pra dispatch** (após Dead UX cleanup terminar):

1. **Lens copy + registry LOCK_VIA_TEST** (Barney threat-model lens
   identified) — 200 LoC test + 50 LoC UX, bloqueante pro merge da
   feature `identified-only`. P0 antes de qualquer ship da lens.
2. **AppErrorBoundary native `window.confirm` substituir** (Barney UX
   audit §5.1, P0 threat) — user em estado de erro pode perder nsec
   achando que é "fix bug". Chicken-egg do provider tree precisa
   solução custom modal.
3. **GlassIconButton `md`/`lg` sizes purge + default → `xl`** (Ted
   dead-code §2.2, WCAG threat) — sizes < 44px continuam exportadas
   no union public; trap pra novos contributors quebrarem WCAG 2.5.5.

Resto: gap fundiário, primitive shelf-ware, copy mapping
spread→DRIFT, e ~5 polish points de mapas (camera persist, pin click,
tile cache CDN).

---

## §2. Por fonte

### §2.1. Session docs 2026-05-17 → 2026-05-23

#### `barney-dead-ux-audit-2026-05-23.md` (P0 já tracked, 6+ não)

Items NÃO no backlog hoje:

- **B-UX-1 P0**: 5 labels distintos pra Configurações (config/configurações/
  Ajustes/Settings/location) — entry §1.1. Recomendação: LOCK_VIA_TEST
  vocab "configurações" em strings JSX user-facing (mesma família
  DRIFT/SINK).
- **B-UX-2 P0**: "spread" vazando em UI strings — SpreadMap empty
  state, TimelineScrubber aria-label, SettingsCards `mapa de spread`,
  permissions hint. `tests/manifesto-conformance.test.ts` não cobre
  "spread" em strings JSX, só `espalha|enterra`. Gap explícito de
  LOCK_VIA_TEST.
- **B-UX-3 P0 THREAT**: `AppErrorBoundary.tsx:62` usa `window.confirm`
  em fluxo destrutivo (apaga TUDO local, inclusive nsec). Resto do
  app usa `dialog.confirm` custom. Chicken-egg: boundary mounta acima
  do provider tree. Solução: inline custom modal pré-provider.
- **B-UX-4 P1 THREAT**: Permission card pede microfone "reservado —
  futuro" sem uso real. Footprint browser-level concedido sem benefício.
  Manifesto §28 violação suave. Fix: remover `microphone` de
  `PERM_ITEMS` até feature voz existir.
- **B-UX-5 P1**: Dupla porta editar profile (ProfileModal vs
  EditProfileCard) — dois fluxos confusos. Convergência: unificar
  ou tornar entrypoints contextuais explícitos.
- **B-UX-6 P1**: `disablePasskey` sem `dangerous: true` em confirm
  (IdentityPanel:650). Reduz percepção de gravidade de remover
  camada de segurança.
- **B-UX-7 P2**: 79 `title=` tooltip-only em mobile-first app
  (StatusIndicators ícones, NavBar slots). Mobile sem screen reader
  fica mudo. Mitigar via long-press hint OU sub-label visível.
- **B-UX-8 P1**: HomeEmpty "following" tab assume "novo user" mesmo
  quando user já tem 50 posts mas unfollowou todo mundo. Stale phrase.

NO-GO preventivos (Barney §11 heads-up):

- **NO-GO `<EmptyStateCard>` primitive** — 4 ad-hocs (HomeEmpty +
  SpreadMap empty + EndOfFeed + ThreadView "sem comments"). Tentação
  de extrair. Veto: cada empty state tem contexto semântico
  diferente; primitive forçaria props soup. Reabrir se ≥6 ad-hocs +
  pattern visual idêntico.

#### `ted-dead-code-audit-2026-05-23.md` (3 quick-wins shipping, 15 não)

Items NÃO no backlog hoje (após HintToast/HintModal já fechados em
`49b2a66`):

- **T-DC-1 HIGH P1**: `CommentCard` variant='card' render path morto
  (~155 LoC). Único caller usa `variant='list'`. Em vôo? — agent
  Dead UX cleanup `a3a028` provavelmente pega. **Não duplicar**.
- **T-DC-2 HIGH P2**: `GlassIconButton` sizes `sm`/`md`/`lg` (legacy
  pre-WCAG 2.5.5) — 0 callers, único caller usa `xl`. Default ainda
  `md` (linha 133). Purge + default → `xl` torna primitive
  WCAG-by-default. P2 segurança long-term.
- **T-DC-3 MED P2**: comments stale referenciam `ContentSettings`
  (arquivo não existe, virou `SettingsCards` V9.2c). 7 hits em
  App.tsx + lib/. Trivial cleanup mas confunde novos agents/devs.
- **T-DC-4 P3**: PostViewer cleanup comments residuais (~15 LoC,
  refs "[PostViewer cleanup 2026-05-20]"). Reduce 7 inline refs
  pra 1 indicativo no topo.
- **T-DC-5 P3 cleanup**: `themes.css` ~35 CSS vars unused × 3 paletas
  (~100 LoC) + 13 tailwind aliases. Requer sign-off Robin v4
  (designer da curadoria). Veto sem sign-off — vars são intent.
- **T-DC-6 P3 cleanup**: `DriftCard` primitive shelf-ware (218 LoC,
  0 callers, Round 4 Fase A). Lily comment em CommentCard.tsx admite
  "DriftCard genérico não replica layout custom". Ted recomenda
  **PURGE**. Preservar `DRIFT_CARD_BASE_CLASS` como utility class.
- **T-DC-7 P3 cleanup**: `prefs.ts:thread_view_mode` legacy case
  (3 LoC). Pref legacy serialização. Manter por compat com user
  storage ≥jul/2026 (após 6 meses de migração silenciosa).
- **T-DC-8 P2 refactor**: PostViewer comment+map buttons inline
  duplicam `glassIconButtonVariantClass('default')`. Extender
  GlassIconButton com `slots: { badge, ripple }` OU criar
  `GlassPillButton` (com conteúdo extra ao lado do ícone).
- **T-DC-9 P3 refactor**: MultiTabModal raw `<button>` (50-61) deveria
  usar DriftButton. Trivial 3-line diff.
- **T-DC-10 P2 STRUCTURAL**: PostViewer.tsx 1044 LoC ("Deus-component"
  threshold). Extrair `PostViewer/ActionsBar.tsx`, `QueueOverlay.tsx`.
  3-4h. Manutenibilidade + isolamento de side-effects.
- **T-DC-11 P2 STRUCTURAL**: `tests/primitive-adoption.test.ts` —
  LOCK_VIA_TEST que falha se primitive exportado em `src/components/UI/`
  ficar sem caller externo por >30 dias. Defesa contra reincidência
  HintToast/HintModal/DriftCard shelf-ware.

NO-GO preventivos:

- **NO-GO** `DriftButton` variants `danger`/`danger-prominent` purge —
  0 callers mas é design intent (ações destrutivas merecem visual
  semântico distinto). Manter + comment "RESERVED — sem callers atuais;
  ver Round 11".

#### `marshall-lens-identified-check-2026-05-23.md` + `barney-lens-identified-threat-2026-05-23.md`

**Status:** GO-COM-CONDIÇÕES-EXTRA. 3 LOCK_VIA_TESTs bloqueantes pro
merge da lens `identified-only`. NÃO no backlog atual.

- **L-ID-1 P1**: `tests/lens-copy-conformance.test.ts` — vocabulário
  proibido (`verified`/`trusted`/`official`/`genuine`/`real user`/
  `not a bot`/`anti-spam`/`anti-bot`/`✓`/`selo`/`verificad`). ~50 LoC.
  Bloqueia copy creep que mata §4 em 6 meses.
- **L-ID-2 P1**: `tests/lens-registry-conformance.test.ts` — schema
  sem `recommended`/`default: true`/`featured`/`promoted`; grep
  `src/components/Onboarding/**` veta menção a `identified-only`;
  ordem dropdown determinística. ~80 LoC.
- **L-ID-3 P1**: Grep guard contra telemetria de lens em
  `src/lib/lens/**` (sem `INSERT INTO`, `localStorage.setItem`,
  `analytics.track`). ~20 LoC, pode entrar no L-ID-2.
- **L-ID-4 P2**: Warning modal não-dismissable + delay 3s na primeira
  ativação da lens. ~30 LoC componente.
- **L-ID-5 P2**: Composability warning quando 2+ filtros restritivos
  ativos simultaneamente. ~20 LoC.
- **L-ID-6 P3 docs**: Entry em `manifesto-coverage-matrix-*.md`
  linkando ambos docs Marshall+Barney pra rastro permanente.

NO-GO preventivos:

- **NO-GO** badge `✓ identif` / `verified` / `selo` ao lado de
  autores identificados — Marshall §6 veto duro #2.
- **NO-GO** boost de score canônico pra identificados — viola §24
  + LOCK_VIA_TEST #2.
- **NO-GO** default-on em primeiro launch — viola §28 + pressão
  cultural §4.
- **NO-GO** publicação Nostr event "filtro user X ativo" — viola §28.
- **NO-GO** whitelist NIP-05 curada pelo cliente oficial — chave
  mestra disfarçada §17.

#### `satoshi-maps-audit-2026-05-21.md` (5 OPEN não fechados)

P1 OPEN status verificado (alguns já shipados, alguns NÃO):

- **S-MAP-1 P1**: O.P.3 / O.G.5 (bandwagon visual + agregado) —
  parcialmente endereçado (stats deemphasis [cd30a12] + copy
  "tamanho ≠ qualidade" [c1a1f6c]). Resta: `Docs/known-limitations.md`
  entry "mapa como termômetro social — tensão §22" registrar.
- **S-MAP-2 P1**: O.P.6 / E.4 (CARTO CDN tracking). Mitigado parcial
  via `map_tile_url_template` + nudge [c1a1f6c]. Banner one-time
  "tiles servidos por carto.com — IP é logado por eles" NÃO
  shipado. Reusar LensNudgeBanner pattern.
- **S-MAP-3 P1**: E.1 (mini-map auto-close timer 30s sem interação).
  NÃO shipado. Hint "toque pra fechar" + animação subtle. Implementar
  via useEffect + setTimeout reset em pointer events.
- **S-MAP-4 P3**: CARTO tile cache não em service worker
  `runtimeCaching`. 2nd-open lento. Adicionar `basemaps.cartocdn.com`
  com `CacheFirst + MaxAgeMs(7d)`. Workbox config.

#### `ted-maps-review-2026-05-21.md` (5 gaps suggested já listados; 1 mais)

Itens novos não capturados:

- **T-MAP-1 P3 test**: Funções puras críticas sem test direto
  (`isUserSoloSpreader`, `pinColor`, `buildGlobalNodes`,
  `getMapExplainerCopy`). ~30min, ~80 LoC. Manifesto §7 lock.
- **T-MAP-2 P3 UX**: `MapExplainerCard` network legend não respeita
  `lens_show_in_map` — copy mostra 3 tiers PPR mas legend só faz
  sentido quando flag ON. Quando OFF, mostrar 1 dot. ~30min fix.
- **T-MAP-3 P3 UX**: Pin tap não tem handler (`pickable: true` mas
  sem `onClick`). Feature gap; tooltip futuro com npub + spread
  count.
- **T-MAP-4 P3 UX**: Network mode empty state com 0 follows não
  oferece "ir pro feed global" botão. ~1h polish.
- **T-MAP-5 P3 visual**: Modes `global` vs `network` renderizam
  quase idêntico (mesma cor mint). User pode confundir "network
  está quebrada" quando follows < 10. Tint amber sobre mint pra
  modo network signaliza "lente local-only". Opcional.

#### `lily-material-ripple-report-2026-05-21.md` (Phase 1 wiring aguarda)

Já em BACKLOG (4 items: wiring + Q1/Q2/Q3). Status confirmado:
HintToast/HintModal removidos em `49b2a66`; Material Ripple primitive
shipado em `984aa2d`; **Phase 1 wiring ainda não autorizado**. Q1/Q2/Q3
ainda aguardam decisão user.

Sugestão: marcar P1 wiring com **bloqueio explícito**: aguarda user
responder Q1/Q2/Q3 ou auto-deliberate HIMYM (workflow_himym_auto_deliberate).

#### `satoshi-sprint-n3-plan-2026-05-21.md` (11 fecháveis — status)

Status dos 11 fecháveis Sprint N+3 conforme plan:

| # | Item | Status atual |
|---:|---|---|
| 0.1 | D3 Profile picture | ✅ Confirmado (Sprint N+2 `2137243` + N+3 `b84d63c`) |
| 0.2 | D2 LHCI re-measure | 🟡 Parcial (bundle delta OK, LCP/INP/CLS/TBT pending CI Linux) |
| 0.3 | D6 RadioGroupButton audit | ⏳ NÃO shipado — ainda no backlog "Radio-group active state" |
| 0.4 | D11 SuaLenteCard polish round 2 | ⏳ NÃO shipado |
| 1.5 | D1 useLensToggle hook | ⏳ NÃO shipado |
| 1.6 | D4 ActionsFan visibility | ✅ `b84d63c` (shadow-2xl + ring) |
| 1.7 | D7 Audit dialogs antigos | ⏳ NÃO shipado |
| 1.8 | D16 dismissRule debounce | ✅ `b84d63c` |
| 2.9 | D5 ActionsFan labels PT-BR | ⏳ NÃO shipado |
| 2.10 | D21 9 conformance it.todo → it() | ⏳ NÃO shipado |
| 2.11 | D8 EditProfileCard banner → tooltip | ⏳ NÃO shipado |
| 2.12 | D9 ComposeOverlay preview flow | ⏳ NÃO shipado |

**Gap:** 7 dos 11 itens fecháveis Sprint N+3 estão semi-fechados/
abandonados sem registro explícito em BACKLOG. Sprint N+3 NÃO foi
fechada como tal — Batch A rodou (4 items), Batch B/C/D não.

Recomendação: registrar Sprint N+3 como **"parcialmente shipada"**,
mover items Batch B/C/D restantes pra BACKLOG raiz com prio explícita.

#### `lhci-2026-05-21.md`

Já em BACKLOG ("mais uma rodada LHCI"). Status atual marca como 🟡
inconclusive (CI Linux pending). NÃO precisa update — bloqueio
externo (CI run após próximo PR).

---

### §2.2. Commits desde `e34a391` (15 commits)

Items derivados:

- **C-1** `c8503b2` TimelineScrubber autoplay default ON — reverteu
  decisão anterior do `dac9952` (autoplay OFF). User pediu visual
  enchimento da barra. Conflito potencial com Satoshi maps audit §4.2
  guard-rail #1 ("não mostrar contador acumulado em tempo real").
  Status: provavelmente OK (não é contador, é barra de fill visual),
  mas vale re-audit Satoshi confirmar.
- **C-2** `8f79feb` registrou sync exato TimelineScrubber-RAF como
  P3. **Já está no BACKLOG** (item "TimelineScrubber: sincronização
  exata com RAF do GlobalModeMap"). OK.
- **C-3** `390d951` adicionou 7 fricções UX iniciante. **Já está no
  BACKLOG**. OK.
- **C-4** `49b2a66` HintToast + HintModal removidos. Convergir com
  BACKLOG: nada lá menciona ainda, mas é fechamento de débito
  Ted §4.2/§4.3. Adicionar fechado retroativo.
- **C-5** `bf71ab7` + `0fb8c17` + `7f92e7e` GpsScopeButton + lazy
  permission per-post. NÃO no backlog (era trabalho em vôo do Lily
  agent `a1e860`). Após agent fechar, registrar como `[x]` shipado.

---

### §2.3. Código (TODOs / FIXMEs em src/)

Maioria dos hits são "TODOS" como pronome português (TODOS os
posts/spreads/eventos), não TODO inline. Hits reais inline:

- `src/lib/sync.ts:66` — `**TODO** (Fase futura): paginação real via
  filtros sucessivos`. **Fase futura**, NÃO acionar agora. Registrar
  no BACKLOG sob Phase 6/7 cap.
- `src/lib/transport/webrtc/peer.ts:56` — `// TODO 6.2-F: ejection
  inteligente (eject pior peer se candidate score > P50)`. Fase 6.2-F
  scope, **NÃO acionar agora**. Já capturado implicitamente pela fase.

**Conclusão:** zero TODOs órfãos no código. Strict mode + lint 0
warnings + ratchet conformance estão fazendo seu trabalho.

---

### §2.4. User feedback no chat (proxies via docs/copy)

User reportou "barra TimelineScrubber não enchendo" — fechado em
`c8503b2`. Sem outros user reports não capturados.

---

### §2.5. Sprint plans vs realidade

Ver §2.1 satoshi-sprint-n3-plan acima. 7 itens Sprint N+3 abandonados
sem registro.

---

## §3. Top 10 itens críticos pra adicionar

Ordenados por (risco × valor / esforço):

1. **L-ID-1/2/3 Lens copy + registry + telemetria LOCK_VIA_TESTs**
   (~150 LoC test) — bloqueante pro merge `identified-only`. P1.
2. **B-UX-3 AppErrorBoundary custom modal** (~30 LoC) — P0 threat,
   user pode perder nsec. Chicken-egg do provider tree precisa
   resolver.
3. **B-UX-4 Remover microfone de PERM_ITEMS** (~10 LoC) — P1 threat
   privacy, footprint sem benefício.
4. **B-UX-1 LOCK_VIA_TEST "configurações" em strings JSX** (~30 LoC
   test) — P0 vocab. Mesma família DRIFT/SINK.
5. **B-UX-2 LOCK_VIA_TEST "spread" em strings JSX user-facing** (~30
   LoC test, com whitelist controlada) — P0 vocab violação CLAUDE.md.
6. **T-DC-2 GlassIconButton purge sm/md/lg + default xl** (~25 LoC) —
   P2 WCAG threat estrutural.
7. **B-UX-6 disablePasskey + `dangerous: true`** (~3 LoC) — P1 threat
   percepção.
8. **S-MAP-2 CARTO tile banner one-time** (~40 LoC, reusa
   LensNudgeBanner) — P1 sovereignty awareness.
9. **S-MAP-3 Mini-map auto-close hint 30s inactivity** (~25 LoC) —
   P1 anti-persuasion.
10. **T-MAP-1 Test puros: isUserSoloSpreader + pinColor +
    buildGlobalNodes + getMapExplainerCopy** (~80 LoC) — P2 manifesto
    §7 determinismo lock.

---

## §4. Top 5 NO-GOs preventivos pra registrar

1. **NO-GO** `<EmptyStateCard>` primitive — 4 ad-hocs com semântica
   diferente; props soup. Reabrir ≥6 ad-hocs + pattern visual idêntico.
2. **NO-GO** `DriftButton` variants `danger`/`danger-prominent` purge
   — design intent, manter + comment "RESERVED".
3. **NO-GO** badge `✓`/`verified`/`selo`/`identif` em UI ao lado de
   autores — viola Marshall §6 #2 + cria pressão cultural §4 (Barney
   C2/C5).
4. **NO-GO** Map novo no Profile (K=1 doxx individual amplification)
   — Satoshi audit §4.3. Já em BACKLOG. Reforçar.
5. **NO-GO** lens `identified-only` em Onboarding wizard (qualquer
   menção em `src/components/Onboarding/**`) — Barney B2.

---

## §5. Reopener conditions sugeridas pra items já no backlog

- **"Theme persist Rosenholz fresh boot deveria ser Cinder?"** —
  reopener: "30min audit Marshall após próximo refactor de
  bootstrap.ts ou se fresh-install em browser limpo confirmar".
- **"HIMYM flavor curado"** — reopener: "se feature 'easter egg'
  for proposta pra V8+ release notes; senão veto permanente como
  scope creep".
- **"Stroke/border em texto sobre transparência"** — reopener: "só
  aplicar como fallback estético em bg dinâmico (mapa); fix correta
  é elevar alpha do bg conforme regra de 2 camadas Marshall".
- **"Dialogs com design antigo umbrella"** — reopener: "audit
  sistemático grep `role=\"dialog\"` em ~25 hits Ted §7.2 + cross-ref
  com FullPageCard/SlideUpOverlay". Estimativa ~2h Marshall.

---

## §6. False-positives validados (NÃO adicionar)

Items já cobertos sob umbrella OU já fechados sem necessidade de
re-registrar:

1. HintToast/HintModal — já fechados `49b2a66` (item Ted §4.2/§4.3).
   Registrar `[x]` retroativo em BACKLOG.
2. CommentCard variant='card' — em vôo agent Dead UX cleanup `a3a028`.
   NÃO adicionar (zero overlap rule).
3. NavBar.tsx comment "ZERO CONSUMER" stale — em vôo agent Dead UX
   cleanup `a3a028`.
4. SpreadMap empty state "Nenhum spread" — em vôo agent Dead UX
   cleanup `a3a028` (provavelmente).
5. SettingsCards "mapa de spread" — em vôo agent Dead UX cleanup.
6. Camera state persist em `user_prefs.map_camera` — JÁ ESTÁ no
   BACKLOG raiz como "Ted gap UX 2026-05-21".

---

## §7. Próxima ação sugerida

Após Dead UX cleanup (`a3a028`) terminar:

1. **Dispatch L-ID-1/2/3** (lens LOCK_VIA_TESTs) — bloqueante pro
   feature merge `identified-only`. Pode ser 1 PR só ~150 LoC test.
2. **Dispatch B-UX-3** (AppErrorBoundary custom modal) — P0 threat,
   ~30 LoC, isolated.
3. **Pode acumular Batch**: B-UX-4 (microphone remove) + B-UX-6
   (disablePasskey dangerous) + T-DC-2 (GlassIconButton purge) —
   3 quick wins zero-overlap, ~40 LoC total, 1 commit.

LHCI (item já no backlog) continua aguardando CI Linux run automático
após próximo PR.

---

*Robin gap audit 2026-05-23. Doc-only, zero código tocado. Próxima
hygiene esperada após dispatch dos top 3.*
