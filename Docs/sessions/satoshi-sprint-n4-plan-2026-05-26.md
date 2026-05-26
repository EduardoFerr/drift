# Sprint N+4 — Plan Satoshi "Pós-Megarodada Paralela"

**Dispatched:** 2026-05-26 (sucessor de `satoshi-sprint-n3-plan-2026-05-21.md`)
**Persona:** Satoshi Nakamoto (adversarial deep + game theory + invariantes
descentralização + ship discipline)
**Trigger:** organizar próximas sprints (N+4 + N+5) após ~50 commits
shipados entre 2026-05-21 e 2026-05-26
**Target:** 8-11 dias buffer-tolerant (mesmo shape de N+3, escopo menor)

---

## 1. Honestidade radical

Sprint N+4 atinge **~70% dos débitos fecháveis · ~45% do backlog total** —
o restante é Phase 2+, veto preventivo, ou dependente de decisão user
ainda não tomada (Material Ripple Q1/Q2/Q3, NSFW dispatch).

Megarodada 2026-05-21 → 2026-05-26 foi inesperadamente produtiva:
N+3 fechou só Batch A (4/12 itens), mas a sessão Lily de 2026-05-26
emendou **7 fricções UX iniciante** em 6 commits + bug sweep visual
B1-B9 (5 commits) + maps audits & polish (~14 commits) + duo Marshall
+ Barney lens identified-only + AppErrorBoundary modal P0 + 3 quick
wins P2P idle + 6 closures retroativos (microphone, vocab, etc.).

O efeito colateral: o backlog encolheu mais do que o N+3 plan
previa, mas **8 itens listados em N+3 P0/P1/P2 nunca foram shipados
explicitamente** (D6, D11, D1, D7, D5, D21, D8, D9). N+4 herda esses
+ pendências novas do gap audit Robin + RFC P2P idle.

**Não atinge "zero débito absoluto"** — atinge **"zero débito maduro
pós-megarodada"**. 6 débitos ficam dependentes de condições reopener
explícitas (telemetria, Fase 6 transport, decisão política user).
Isso é correto: violar reopener seria shipping prematuro.

---

## 2. Inventário

### 2.1 Closures retroativas desde N+3 plan (2026-05-21 → 2026-05-26)

Confirma-se via `git log --oneline -40`:

| Item N+3 | Status | Commit | Notas |
|---|:---:|---|---|
| **D3** Profile picture render (P0.1) | ✅ | `2137243` | Confirmado pré-N+3 (Sprint N+2) |
| **D2** LHCI re-measure (P0.2) | 🟡 PARCIAL | `b84d63c` | Bundle gz 110→63 kB (-43%). LCP/INP/CLS/TBT inconclusivos (EPERM tmpdir Windows). CI Linux ainda pendente |
| **D4** ActionsFan visibility (P1.6) | ✅ | `b84d63c` | shadow-2xl + ring-1 ring-black/10 |
| **D16** dismissRule rate-limit (P1.8) | ✅ | `b84d63c` | trailing-edge debounce 250ms + 6 LOCK specs |
| **B-UX-1** "configurações" canônico | ✅ | `debc189` | LOCK_VIA_TEST PT-BR |
| **B-UX-2** "spread" → DRIFT em JSX | ✅ | `7450242` | LOCK_VIA_TEST vocab |
| **B-UX-3** AppErrorBoundary modal P0 | ✅ | `6ebf1ca` | Custom inline modal pré-provider |
| **B-UX-4** microphone perm removido | ✅ | `77a6298` | + stale comments cleanup |
| **B-UX-6** disablePasskey dangerous | ✅ | `893e830` | dangerous:true + warning sem backup |
| **T-DC-2** GlassIconButton purge sizes | ✅ | `27877d9` | Sizes sm/md/lg legacy removed |
| **HintToast + HintModal shelf-ware** | ✅ | `49b2a66` | 210 LoC removidas |
| **CommentCard variant dead branch** | ✅ | `3c8198d` | Limpeza |
| **GpsScopeButton primitive (§28)** | ✅ | `bf71ab7` + `0fb8c17` + `7f92e7e` | Lazy permission per-post |
| **GuideCard educação user** | ✅ | `966d91e` | 5 seções, 17 tópicos, 34 tests |
| **Maps polish round 2** | ✅ | `cd30a12` + `c1a1f6c` + `dac9952` + `c8503b2` | Mode badge + sovereignty nudge + scrubber labels |
| **useMapInstance hook extract** | ✅ | `a507522` | Cleanup pré-split |
| **Lens identified-only dual audit** | ✅ | `48e8f9f` + `2a553e5` | Marshall GO-CONDIÇÕES + Barney GO-COM-EXTRA |
| **P2P idle quick wins (QW1+QW2+QW3)** | ✅ | `075a7f9` | healthTimer guard + lazy signaling + rate-warn cleanup |
| **7 fricções UX iniciante** | ✅ | `1f540db`..`5410893` + `62dc4e8` | DERIVA/EV tooltips, ModeToggle empty, NetworkMode warning gate, etc. |

**Total fechado retroativo: ~19 itens · ~50 commits.**

### 2.2 Items abertos no BACKLOG (catalogados por origem)

#### A. Sprint N+3 deferred (nunca dispatchados explicitamente)

| # | Item | Origem | Est | Prio |
|---|---|---|:---:|:---:|
| A1 | **D6** RadioGroupButton WCAG audit + cross-component | N+3 P0.3 | 1d | P1 |
| A2 | **D11** SuaLenteCard polish round 2 (5 pontos confusão) | N+3 P0.4 | 1d | P2 |
| A3 | **D1** useLensToggle hook (DRY 3 toggles) | N+3 P1.5 | 1d | P2 |
| A4 | **D7** Audit dialogs antigos `role="dialog"` | N+3 P1.7 | 4h | P1 |
| A5 | **D5** ActionsFan labels PT-BR always-on | N+3 P2.9 | 4h | P2 |
| A6 | **D21** 9 conformance it.todo → it() | N+3 P2.10 | 6h | P2 |
| A7 | **D8** EditProfileCard banner → tooltip | N+3 P2.11 | 2h | P3 |
| A8 | **D9** ComposeOverlay "Prévia do post" flow | N+3 P2.12 | 1d | P2 |

#### B. Pool gap audit Robin 2026-05-23 (17 itens; 5 fechados; 12 residuais)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| B1 | **L-ID-1** LOCK_VIA_TEST lens copy vocab proibido (gate identified-only) | 50 LoC | P0 |
| B2 | **L-ID-2** LOCK_VIA_TEST registry sem promoção + Onboarding-veto | 80 LoC | P0 |
| B3 | **L-ID-3** Grep guard telemetria-zero em `src/lib/lens/**` | 20 LoC | P0 |
| B4 | **L-ID-4** Warning modal não-dismissable + delay 3s primeira ativação lens | 30 LoC | P2 |
| B5 | **L-ID-5** Composability warning quando 2+ filtros restritivos | 20 LoC | P2 |
| B6 | **L-ID-6** Entry em manifesto-coverage-matrix linkando docs Marshall+Barney | 10 min | P3 |
| B7 | **T-DC-3** Substituir comments `ContentSettings` → `SettingsCards` | 7 lines | P3 |
| B8 | **T-DC-8** GlassPillButton extend (PostViewer comment+map buttons) | 2-3h | P2 |
| B9 | **T-DC-10** PostViewer.tsx split (1044 LoC) | 3-4h | P2 |
| B10 | **T-DC-11** `tests/primitive-adoption.test.ts` anti-shelf-ware | 4h | P2 |
| B11 | **S-MAP-2** CARTO tile banner one-time (sovereignty awareness) | 40 LoC | P1 |
| B12 | **S-MAP-3** Mini-map auto-close hint 30s inactivity | 25 LoC | P1 |
| B13 | **S-MAP-4** CARTO tile cache em SW runtimeCaching | (W) | P3 |
| B14 | **T-MAP-1** Tests puros mapas (4 helpers) | 80 LoC | P2 |
| B15 | **T-MAP-2** MapExplainerCard network legend respect `lens_show_in_map` | 30 min | P3 |
| B16 | **T-MAP-3** Pin tap handler (tooltip futuro) | (W) | P3 |
| B17 | **T-MAP-4** Network mode empty state CTA | 1h | P3 |

#### C. Audit P2P idle 2026-05-23 (quick wins shipados; RFC fica)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| C1 | **P2P idle-state RFC full (cold→warm→hot)** + 7 LOCK_VIA_TEST M1-M7 + telemetria opt-in default-flip 6.5→6.6 + unificar com helia idleWatcher | 2-3d | P1 |

#### D. Bugs descobertos em re-verificação visual 2026-05-23 (2 abertos)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| D1 | **Mode badge não renderiza** — `initialModeRef` stale ref + MapShell mount-gate em empty state. Fix: hoistar badge pro overlay root + rastrear mode anterior | 20 min | P0 |
| D2 | **GPS state `precise` persistente sem ativação consciente** — pode reabrir B3 reopener. Investigar leftover session vs misclick LocationCard | 30 min audit | P2 |

#### E. NSFW scanner opt-in (Barney research + user GO 2026-05-23)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| E1 | **NSFW scanner Opção A (self-host + SRI + lazy chunk + suggest-tag + LOCK)** | spike 2-3h + impl 4-6h = ~1d | P1 |

Coordenação: Ted está produzindo plano arquitetural NSFW em paralelo
neste momento (`a28b2f6`). Quando Ted entregar, eu incorporo a
recomendação. Default: **P1 se Ted recomendar dispatch imediato;
P2 stretch se Ted recomendar mais spike de investigation**.

#### F. Bugs reportados pendentes (revisão visual B1-B9 residuais)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| F1 | **Image "indisponível" placeholder ocupa ~30% do card** | 1h | P2 |
| F2 | **Bootstrap "aguardando" 2-3s primeira carga** (gate em LHCI) | (gate) | P2 |
| F3 | **Header crowded em 375px viewport** | 1-2h | P3 |
| F4 | **Theme persist Rosenholz: default fresh boot deveria ser Cinder?** | 30 min audit | P3 |
| F5 | **B3 reopener: escalar UX deeper se GPS misclick persistir** | (gate) | P2 |

#### G. Material Ripple Phase 1 wiring (gate em decisão user)

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| G1 | **Material Ripple Phase 1 wiring (4 superfícies)** | 4-6h + LOCK | P2 |
| G2 | Q1 DriftChip md default | (decisão) | gate |
| G3 | Q2 GlassIconButton xl double-edge | (decisão) | gate |
| G4 | Q3 Settings rows full-width | (decisão) | gate |

#### H. Outros — derivados maps audit Ted + Satoshi

| # | Item | Est | Prio |
|---|---|:---:|:---:|
| H1 | **Split SpreadMap.tsx (794 LoC)** | 2h | P2 |
| H2 | **TimelineScrubber sync exato com RAF** | 3-4h | P3 |
| H3 | **Camera state persist `user_prefs.map_camera`** | 1-2h | P3 |
| H4 | **MapShell legend network respect `lens_show_in_map`** | 30 min | P3 |
| H5 | **Sincronizar `Docs/guia-do-usuario.md` com GuideCard** | 2h | P2 |

#### I. RFC + arquitetura pendentes

| # | Item | Origem | Prio |
|---|---|---|:---:|
| I1 | **RFC DAOP-001 Phase 2** | Espera adoção primitives | P3 defer |
| I2 | **DiagnosticCard rebuild incluir P2P/WebRTC/LAN** | User pergunta 2026-05-17 | P3 defer |
| I3 | **Composição §6 lentes (∪ ∩ −)** | Defer pós-feedback POC | P3 defer N+5+ |
| I4 | **Persistência `active_lens` em UserPrefs** | Schema bump | P2 |

#### J. 5 baseline test failures pré-existentes (NÃO regressões)

Defere pra audit separado (não bloqueador):
- `events-dispatch` kind 9078
- `manifesto-conformance` vocab "espalha" em MapExplainerCard
- `no-telemetry` sovereignty override
- `schemaCheck` POST sem tag d
- `trust-lens-conformance` JSX strings "Trust"

**Hipótese inicial:** strings de teste reagindo a mudanças shipadas
em paralelo nas últimas 48h (vocab, lens, GuideCard novos textos).
Não bloquear N+4 — agendar 1h audit dedicado.

### 2.3 Items registrados como NO-GO preventivo (não-fazer é a resposta)

| Item | Razão | Reopener |
|---|---|---|
| **EmptyStateCard primitive** | 4 ad-hocs hoje (HomeEmpty, SpreadMap, EndOfFeed, ThreadView), contextos semânticos divergem | ≥6 ad-hocs + pattern visual idêntico |
| **DriftButton danger/danger-prominent purge** | 0 callers atuais, design intent preservado pra futura feature destrutiva | Delete identity, reset profile UI |
| **Badge ✓/verified/selo/identif ao lado de autores** | Marshall §6 veto duro #2 + Barney C2/C5 cultural pressure | Nunca (LOCK ENFORCE L-ID-1) |
| **Lens `identified-only` em Onboarding** | Barney B2 — anula §22 + §24 retroativamente | Nunca (LOCK ENFORCE L-ID-2) |
| **Telemetria adoção lens (local OU remoto)** | Métrica vira KPI; KPI mata default-OFF | Nunca (LOCK ENFORCE L-ID-3) |
| **Map novo no Profile** | K=1 doxx amplification | DAU > 1000 + K-anon engine Phase 2 |

---

## 3. Sprint shape N+4 (~8-11d buffer-tolerant)

### 3.1 P0 — Must-ship (~3d)

| # | Item | Est | LOCK_VIA_TEST |
|:---:|---|:---:|---|
| 0.1 | **D1** Mode badge fix (hoistar + initialModeRef rastreamento) | 20 min | feature works end-to-end |
| 0.2 | **B1** L-ID-1 LOCK lens copy vocab proibido | 50 LoC | `lens-copy-conformance.test.ts` |
| 0.3 | **B2** L-ID-2 LOCK registry sem promoção + Onboarding-veto | 80 LoC | `lens-registry-conformance.test.ts` |
| 0.4 | **B3** L-ID-3 LOCK telemetria-zero `src/lib/lens/**` | 20 LoC (pode entrar em B2) | (acima) |
| 0.5 | **D2 N+3** LHCI Day N CI Linux re-measure (destravar) | 4-6h (CI gate + write delta) | `lhci-2026-05-26.md` |
| 0.6 | **5 baseline test failures audit** | 1h | (zero todo audit, fix OR defere com reopener concreto) |

**Por que P0:**
- 0.1 — feature shipou mas não funciona; bug regression real
- 0.2/0.3/0.4 — bloqueantes pre-merge feature `identified-only`. Se
  Marshall+Barney aprovaram lens com condições estruturais, lens NÃO
  shipa antes destes LOCKs. Maybe-shipped sem LOCK = NO-GO retroativo
- 0.5 — N+3 P0.2 só fechou parcial (Windows EPERM); CI Linux destravar
  é blocker pra qualquer claim sobre "performance pós-megarodada"
- 0.6 — 5 failures podem mascarar regressões reais novas em PRs futuros

### 3.2 P1 — Deveria caber (~3.25d)

| # | Item | Est | LOCK_VIA_TEST |
|:---:|---|:---:|---|
| 1.7 | **A1** D6 RadioGroupButton WCAG audit + cross-component | 1d | `radio-active-contrast.test.ts` |
| 1.8 | **A4** D7 Audit dialogs antigos `role="dialog"` + cross-ref FullPageCard | 4h | (doc audit; LOCK se gap real) |
| 1.9 | **B11** S-MAP-2 CARTO tile banner sovereignty awareness | 40 LoC | (UX; reusa LensNudgeBanner) |
| 1.10 | **B12** S-MAP-3 mini-map auto-close hint 30s | 25 LoC | (UX) |
| 1.11 | **C1** P2P idle-state RFC full + 7 LOCK M1-M7 + helia idleWatcher unify | 2-3d | M1-M7 (`peer.lastTrafficAt`, ping≠tráfego, etc.) |
| 1.12 | **E1** NSFW Opção A spike + impl (lazy + SRI + suggest-tag + LOCK) | ~1d | `nsfw-scanner-isolation.test.ts` |

**Por que P1:**
- 1.7 / 1.8 — Sprint N+3 deferred com escopo modesto; deveriam ter
  shipado em B/C/D mas nunca dispatchados
- 1.9 / 1.10 — Satoshi maps audit P1 ainda em sovereignty awareness gap
- 1.11 — RFC P2P idle-state já maturado em audit triplo (Marshall +
  Lily + Satoshi) + quick wins shipados; falta dedicar sprint pra
  cold→warm→hot scheme + LOCKs estruturais. **Game-theoretic bonus**:
  hibernate-on-hidden destaca Sybil farms always-on contra população
  real que hibernate → melhora cluster detection passivamente
- 1.12 — User decidiu 2026-05-23 que self-host é única opção compat
  com §17 + §28. Ted está validando arquitetura agora. Se Ted GO,
  P1; se Ted pede mais spike, vira P2 stretch

### 3.3 P2 — Nice-to-have stretch (~3d)

| # | Item | Est |
|:---:|---|:---:|
| 2.13 | **A2** D11 SuaLenteCard polish round 2 | 1d |
| 2.14 | **A3** D1 useLensToggle hook (gate em 2.13) | 1d |
| 2.15 | **A5** D5 ActionsFan labels PT-BR | 4h |
| 2.16 | **A6** D21 9 conformance it.todo → it() | 6h |
| 2.17 | **H1** Split SpreadMap.tsx (794 LoC) — Ted P2 zero-risk | 2h |
| 2.18 | **H5** Sincronizar `Docs/guia-do-usuario.md` com GuideCard | 2h |
| 2.19 | **B4** L-ID-4 Warning modal não-dismissable lens primeira ativação | 30 LoC |
| 2.20 | **B5** L-ID-5 Composability warning 2+ filtros | 20 LoC |
| 2.21 | **D2** GPS state `precise` audit + fix (Mode badge sibling bug) | 30 min audit |

**Por que P2 (não P1):**
- 2.13 — Sprint N+3 P0.4 não-shipado, mas SuaLenteCard já evoluiu
  bastante em rounds anteriores; pontos confusão talvez já mitigados
- 2.14 — gate em 2.13 (não extrair hook antes da UX estabilizar)
- 2.17 — refactor puro Ted P2; zero-risk porém sem urgência

### 3.4 Total estimado + paralelização

**Total estimado:** 9.25d serial (P0 3d + P1 3.25d + P2 3d).
**Paralelização 4 batches de 4 agents:** 5-6d wall-clock.

### Batch A (4 agents paralelos — zero overlap)
- Agent 1 → **0.1** Mode badge fix
- Agent 2 → **0.2** + **0.3** + **0.4** L-ID LOCKs (mesmo arquivo group)
- Agent 3 → **0.5** LHCI Day N CI Linux destravar
- Agent 4 → **0.6** 5 baseline test failures audit + fix

### Batch B (4 agents paralelos — após A)
- Agent 1 → **1.7** RadioGroupButton audit
- Agent 2 → **1.9** CARTO sovereignty banner + **1.10** mini-map hint (mesma feature semântica)
- Agent 3 → **1.8** Audit dialogs antigos
- Agent 4 → **1.12** NSFW spike (gate em Ted)

### Batch C (dedicated — Sprint dentro do Sprint)
- **1.11** P2P idle-state RFC full — escopo grande (2-3d) + 7 LOCK +
  telemetria opt-in. Sequencial sozinho. Coordena com Lily R2
  refactor unificando com helia idleWatcher pattern

### Batch D (P2 stretch — paralelo opcional)
- Agent 1 → **2.13** SuaLenteCard polish → depois **2.14** useLensToggle
- Agent 2 → **2.17** Split SpreadMap + **2.18** sync guia-do-usuario
- Agent 3 → **2.15** ActionsFan labels + **2.19** lens warning modal + **2.20** composability warning
- Agent 4 → **2.16** it.todo → it()

**Throughput:** 5-6d com 4 agents vs 9.25d serial.

---

## 4. Sprint N+5 preview

Se N+4 entregar P0+P1+metade-P2, sobra:

**Top 5 items provisórios N+5:**
1. **G1** Material Ripple Phase 1 wiring (gate: decidir Q1/Q2/Q3)
2. **B8** T-DC-8 GlassPillButton extend (PostViewer dup base)
3. **B9** T-DC-10 PostViewer.tsx split (1044 LoC) — coordenar com features em vôo
4. **B10** T-DC-11 tests/primitive-adoption anti-shelf-ware
5. **B14** T-MAP-1 Tests puros mapas (4 helpers)

**Plus:** P2 não-shipados de N+4, F1/F2/F3 (image placeholder,
bootstrap, header crowded), H2/H3/H4 (TimelineScrubber sync, camera
persist, MapShell flag respect), I4 (persistência active_lens).

**Total provisório N+5:** ~6-8d.

Sprint N+5 fica menor que N+4 — convergência rumo a "zero débito
maduro absoluto" começa a aparecer no horizonte ~Sprint N+6/N+7.
Phase 2+ continua aguardando triggers (DAU > 1000, telemetria, Fase 6).

---

## 5. Veto explícito (game-theoretic NO-GO)

| Item | Razão | Reopener específico |
|---|---|---|
| **D14 (N+3)** Satoshi Lacunas 1/3/4/5 dedicado threat model | Cabe num sprint dedicado de threat modeling com persona Satoshi (não num sprint de débito misturado) | Sprint N+6 ou N+7 com escopo "audit puro" |
| **D17 (N+3)** Image hash hard-fail | Sem telemetria de % legacy, qualquer threshold é chute | Telemetria local opt-in mostrar <1% imagens em legacy |
| **D22 (N+3)** N/2 refill feed | Sem evidência de >100 posts/user, otimização vira aposta | Logs reais mostrarem feed>100 posts/user frequente OR user report de "spinner ao chegar no fim" |
| **D18 (N+3)** K-anonymity engine | DAU >1000 reopener; antes disso threshold aggregation não tem amostra | DAU >1000 + spreaders geo distintos |
| **D19 (N+3)** Tauri binary distribution | Fase 6 separada — sprint de débito ≠ sprint de feature | Fase 6 abertura formal |
| **D20 (N+3)** Random walk pós-CONNECTED | Fase 6.4 transport dep | WebRTC P2P shipado Fase 6 |
| **D15 / I1** RFC DAOP-001 Phase 2 | Espera adoção primitives Phase 1 | HintChip adoção em ≥3 features |
| **D12 (N+3)** PWA SW autoUpdate vs prompt | §17 política — user decide, não Satoshi | User explicitamente pedir flip |
| **I3** Composição §6 lentes (∪ ∩ −) | Defer N+5+ pós feedback POC | User reportar caso concreto onde 1 estratégia não basta |
| **Map novo no Profile** | K=1 doxx amplification | DAU > 1000 + K-anon Phase 2 |
| **EmptyStateCard primitive** | Forçaria props soup | ≥6 ad-hocs + pattern idêntico |
| **B7 T-DC-3** comments stale | P3 doc rot, cosmético, pode aguardar ratchet maior | Sprint de doc cleanup dedicado |
| **B13 / B15 / B16 / B17 / H2 / H3 / H4** P3 maps tail | Polish remoto, sem urgência | Combina com Sprint N+5/N+6 hygiene round |
| **A8 D9 ComposeOverlay "Prévia do post"** | Scope grande (1d) + escopo UX precisa Lily deliberar | Lily HIMYM dedicado decidir PostViewer "preview" mode vs novo component |
| **A7 D8 EditProfileCard banner → tooltip** | P3 pequeno, sem gain alto | Sprint hygiene Phase 1 wave 2 |
| **I2 DiagnosticCard rebuild incluir P2P/WebRTC/LAN** | Arquitetura Fase 6.x | Ted/Marshall HIMYM dedicado decidir multi-transport orchestration |

**Princípio Satoshi:** atacante racional explora vuln MAL-modelada >
vuln NÃO-modelada. Shipping cego = surface area maior. Veto agressivo
é defesa em profundidade. **8 P0+P1 fechados > 22 começados meio-feitos.**

---

## 6. Risco residual pós-N+4

| Cenário | Cobertura |
|---|---|
| P0 garantido (must-ship) | ~30% débitos fecháveis · 100% bloqueadores merge |
| P0+P1 garantido | ~70% débitos fecháveis · ~45% backlog total |
| P0+P1+P2 stretch | ~90% débitos fecháveis · ~65% backlog total |

**Ficam pra futuro:** ~10 débitos em condições reopener explícitas +
Material Ripple gate em decisão user + composição §6 lentes (defer
N+5+) + Phase 2 triggers (DAU/telemetria).

**Surface residual confessada:**
- 5 baseline test failures podem MASCARAR regressão real até 0.6 audit
- LHCI Linux CI ainda pode flagar regressão pós-megarodada (50+ commits)
- Mode badge fix (0.1) é P0 mas se bug é mais fundo que ref-tracking,
  vira escalada de scope
- NSFW Opção A depende de Ted entregar arquitetura; se Ted recomenda
  spike adicional, 1.12 vira P2 stretch (não bloqueia sprint)

---

## 7. LHCI execution plan

### 7.1 Dois pontos no sprint

- **Day 0** (pré-sprint, 2026-05-26): baseline pós ~50 commits desde
  N+3 baseline `lhci-2026-05-21.md`. **Foco**: confirmar que bundle
  gz não regrediu pra além do baseline 63 kB (-43% vs cwv-2026-05-09).
- **Day N** (pós-sprint, ~2026-06-04): delta vs Day 0 + delta vs
  cwv-final-report-2026-05-09 (86/100 baseline).

### 7.2 Métricas + thresholds

| Métrica | OK | Regressão flag |
|---|:---:|:---:|
| LCP | <2.5s mid-range | >2.75s (10%) |
| INP | <200ms | >220ms |
| CLS | <0.1 | >0.11 |
| TBT | <300ms | >330ms |
| Bundle entry | <250KB hard ratchet | qualquer ↑ vs Day 0 |

### 7.3 Foco changes pós últimos 5 dias

- ~14 commits maps polish (CARTO nudge, scrubber, mode badge, useMapInstance hook)
- GuideCard (5 seções, 17 tópicos) — bundle inflation candidate
- GpsScopeButton primitive + popover 4 níveis
- AppErrorBoundary custom modal (sem deps externas)
- HintToast/HintModal remove (-210 LoC bundle gain)
- GlassIconButton size purge (-N LoC)
- 7 fricções UX iniciante shipados (varias mudanças)

### 7.4 Ação se regressão >10%

1. DevTools Performance trace no path regredido
2. Git bisect entre 2026-05-21 e HEAD
3. HIMYM dispatch Ted+Lily se causa não-óbvia
4. Hotfix N+4 se P0 (LCP/INP); doc + ticket N+5 se P2 (CLS/TBT)

### 7.5 Output

`Docs/sessions/lhci-2026-05-26.md` (Day 0) + `lhci-day-n-2026-06-04.md` (Day N):
- Tabela 5 métricas × 4 datas (05-09 baseline, 05-21 N+3 baseline, 05-26 N+4 Day 0, 06-04 N+4 Day N)
- Bundle size breakdown por chunk
- Flag verde/amarela/vermelha por métrica
- Diagnose por regressão (se houver)

**Crítico Day N:** rodar em CI Linux (não Windows local) pra evitar
EPERM tmpdir que invalidou metade dos números de N+3.

---

## 8. Game theory veto (tom Satoshi)

Vetei agressivamente em N+4 — mesma postura de N+3 mas com mais
evidência empírica:

**N+3 vetou 9 itens; N+4 vetou 16+ itens** (incluindo herança de N+3
vetos ainda válidos). Razão estrutural: cada sprint que passa, novos
gaps audit Robin emergem (17 novos em 1 audit), e o backlog cresce
mais rápido que sprints conseguem fechar. **Resistir à tentação** de
"limpar tudo" virtuosamente vira gold-plating sem ROI.

**Defesa em profundidade da própria política de veto:**
- D14 (Satoshi lacunas) — atacante racional explora vuln MAL-modelada
  > NÃO-modelada. Threat-model em sprint misturado vira surface area
  expandida, não reduzida. Cabe em sprint dedicado com persona-driven
  audit + Barney + Marshall conformance.
- D17, D22 — sem dados, otimização vira aposta. Apostas em segurança
  são caras (false-positive: posts legítimos suprimidos por hash collision; false-negative: spammer adapta em 1 commit). Reopener tem critério mensurável.
- D12 — chave-mestra disfarçada §17. Status quo prompt protege user
  mesmo que UX seja pior. Trade-off declarado: §17 forte > UX clean.
- D19 / D20 / Fase 6.x — sprint de débito ≠ sprint de feature.
  Misturar = nenhum dos dois bem feito.
- **EmptyStateCard / DriftButton danger purge / Composição §6 lentes
  / Map no Profile / RFC DAOP-001 Phase 2** — todos têm reopener
  mensurável. NO-GO documentado é resultado tão bom quanto ship; ambos
  param o trabalho meio-feito.

**Princípio operacional Satoshi (ship discipline):** se você tem 22
itens abertos e dispatch todos em paralelo, vai entregar 22 meio-feitos.
Se dispatch 8 P0+P1 com LOCK_VIA_TEST, entrega 8 prontos pra ratchet.
Sprint N+3 provou isso retroativamente: Batch A dispatched (4 itens) +
Batches B/C/D nunca dispatched (8 itens). Os 4 do Batch A shipados;
os 8 dos B/C/D... ainda no backlog 5 dias depois (agora herdados N+4).

**Lição N+3 → N+4:** dispatchar P0 imediato, P1 depende de aprovação
explícita user, P2 só dispatcha se P0+P1 fecharam. Sem **batch
follow-through** = stretch nunca shipa.

---

## 9. Próxima ação (quando user der GO)

**Batch A dispatch — 4 agents paralelos, zero overlap:**

### Agent 1 — Mode badge bug fix (P0.1)
- Files: `src/components/Feed/SpreadMap.tsx` (linhas 746-753 + initialModeRef tracking)
- Output: 1 commit + push
- Estimativa: 20 min (Lily provavelmente mais rápido se já tem contexto do recente sprint maps)
- LOCK: verificar feature funciona end-to-end via preview

### Agent 2 — L-ID LOCKs cluster (P0.2 + 0.3 + 0.4)
- Files: `tests/lens-copy-conformance.test.ts` (novo) + `tests/lens-registry-conformance.test.ts` (novo)
- Output: 2 testes novos + 1 commit + push
- Estimativa: ~3h (150 LoC test code + grep regex bem feito)
- LOCK: bloqueia merge feature `identified-only` se algum dos 3 falhar
- Reopener crítico: SE qualquer um dos 3 LOCKs faltar quando feature for shipada → NO-GO retroativo

### Agent 3 — LHCI Day N CI Linux destravar (P0.5)
- Files: `.github/workflows/lhci.yml` (verificar) + `Docs/sessions/lhci-2026-05-26.md` (novo Day 0 baseline)
- Output: PR LHCI workflow run + doc baseline
- Estimativa: 4-6h (depende de workflow já existir; se não, scaffolding adicional)
- LOCK: CI Linux roda + JSON salvo (não perdido em EPERM)

### Agent 4 — 5 baseline test failures audit (P0.6)
- Files: `tests/events-dispatch.test.ts` + `tests/manifesto-conformance.test.ts` + `tests/no-telemetry.test.ts` + `tests/schemaCheck.test.ts` + `tests/trust-lens-conformance.test.ts`
- Output: relatório curto (`Docs/sessions/baseline-failures-audit-2026-05-26.md`) + fixes onde aplicável + reopener se defere
- Estimativa: 1h audit + 1h fix (se simples)
- LOCK: zero failing tests OR cada falha registrada com reopener específico

### Batch A wall-clock estimado
- Agent 1: 20 min
- Agent 2: ~3h
- Agent 3: 4-6h
- Agent 4: ~2h
- **Total wall-clock paralelo: ~6h** (gated em Agent 3)

### Batch A → Batch B → Batch C decision gate
- Batch B dispatch quando Batch A fechado (4-6h depois)
- Batch C (RFC P2P idle) dispatch quando user explicitamente aprovar
  escopo (2-3d sozinho merece confirmação)
- Batch D (P2 stretch) só se P0+P1 fecharam em ~5d

**Recomendação:** **dispatch Batch A imediato após user dar GO.**
NSFW spike (1.12) **aguardar Ted entregar arquitetura** antes de
dispatch. RFC P2P idle (1.11) **aguardar user confirmar escopo
dedicated** porque consome ~25% do sprint sozinho.

---

## 10. Constraints / contexto operacional

- **Doc-only** este plan — não tocou código
- Manifesto §22 (sem reputação) / §24 (sem afinidade) / §28 (privacy
  local) são premissas inegociáveis
- Coordenação parallel agents:
  - **Lily** (`a01400e`) fix MapOverlay EV + ModeToggle empty —
    *já fechado em paralelo? `62dc4e8` confirma fix MapOverlay EV.*
    ModeToggle empty residual: confirmar.
  - **Barney** (`aa631d7`) coverage audit doc-only — quando entregar,
    integrar em N+4 P1 se relevante
  - **Ted** (`a28b2f6`) NSFW architecture plan doc-only — **gate
    pra item 1.12** (NSFW Opção A spike+impl)
- 1 commit + push pra este doc

---

## 11. Resumo executivo (TL;DR)

- **Sprint N+4 shape:** 6 P0 + 6 P1 + 9 P2 = 21 items (vs 12 em N+3)
- **Total estimado:** 9.25d serial / 5-6d paralelo (4 batches)
- **Veto:** 16+ items com reopener mensurável
- **LHCI Day 0 + Day N** mandatório (CI Linux desta vez)
- **Cobertura:** 70% débitos fecháveis em P0+P1 / 90% com P2 stretch
- **Sprint N+5 provisório:** 5-7 items (~6-8d), shape menor
- **Próxima ação:** Batch A dispatch (4 agents · ~6h wall-clock) +
  aguardar Ted NSFW + aguardar user confirmar escopo P2P RFC

---

*Plan Satoshi 2026-05-26. Sucessor de
`satoshi-sprint-n3-plan-2026-05-21.md`. Sprint começa quando user
aprovar Batch A — ou ajustar prioridades. Honestidade radical:
"zero débito maduro pós-megarodada", não "zero débito absoluto".*
