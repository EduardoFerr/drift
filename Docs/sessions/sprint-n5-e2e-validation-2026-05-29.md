# Sprint N+5 — E2E Multi-User Validation + 3 Bugs

**Origem:** sessão 2026-05-26→29. User reportou 3 bugs (score, toasts, mapas). Validação ad-hoc Playwright (Phase A) confirmou 2, identificou raiz do 3º. Phase B (seed + E2E multi-user) é o validador dos bugs profundos restantes.

---

## Contexto — o que aconteceu nesta sessão

### Bugs reportados pelo user
1. **Score problemático** — contagem de DERIVA estranha
2. **Toasts inúteis** — excesso de hints adicionados "pensando que ajudava"
3. **Mapas não fiéis aos algoritmos** — linhas não representam propagação real

### Phase A (validação ad-hoc Playwright) — FEITA
- **#2 toasts** → ✅ FIXADO (`ddc79c6`): matou chip "○ POSTS NOVOS" permanente, fix InstallDrift iOS-em-Chromium (`isIosSafariUA`), removeu CARTO HintChip. Colisão CARTO×ModeToggle resolvida junto.
- **#1 score** → não validável estático (sem db hook, sem weights conhecidos). → Phase B.
- **#3 mapas** → raiz identificada via captura de frames (2 sequências):
  - Scrubber DESSINCRONIZADO dos arcs (loops independentes mesma duração — `c8503b2` "perceptual sync")
  - Zoom jump = só fit-bounds inicial (minor)
  - **Modelo de propagação suspeito:** arcs = geográfico (post-origin→spreader, hub-spoke) NÃO cascata social (A→B→C pelo follow-graph). User intuição: "não forma rede". → Phase B valida com cascata conhecida.

### Decisão estratégica (deliberada com user)
- A→B sequência: Phase A barata primeiro (feito), Phase B depois (evidência-driven)
- Phase B valida **score (#1) E propagação (#3)** com ground-truth conhecido
- MSW sozinho = pouco ROI (Drift é WSS+SQLite, não HTTP). Híbrido: seed SQLite core + mocks para externals.
- Playwright via MCP (já integrado) — multi-context = ≥N usuários reais isolados.

---

## Sprint N+5 — escopo

### Roster de usuários (revisado — 8 named + 50 seed)

**Named (Playwright BrowserContext — dirigem interação, custam caro): 8**

| User | Perfil | Subsistema validado |
|---|---|---|
| Alice | Publisher GPS(cidade)+IPFS, origem cascata | Origin posts, Helia pin self |
| Bob | Anon, segue Alice, GPS off | Engager (drift/sink/report), cascata elo 1 |
| Carol | NIP-05 verified, segue Bob, GPS precise | Cascata elo 2, Trust Lens PPR |
| Dave | Heavy spreader P2P-only, segue Carol | Cascata elo 3, WebRTC pure datachannel |
| Erin | Peer relay router | Multi-hop propagation, §16 |
| Frank | Offline→online cycler | Sync catchup, rebroadcast oportunista |
| Grace | Helia full node — pin viral | IPFS pin auto + content retrieval |
| Heidi | Helia consumer — retrieves CIDs | IPFS gateway fallback, §16 redundância |

Cascata profunda Alice→Bob→Carol→Dave (4 elos) valida árvore de propagação. Erin/Frank/Grace/Heidi cobrem transport + IPFS.

**Seed identities (SQLite fixtures — background, baratas): ~50**
- 500 posts (geo-spread Brasil/EU/Ásia, content-warning mix, subposts)
- 2000 spreads (distribuição pareto — 5% posts pegam 80%)
- 200 buries (concentrado ~20 posts → valida threshold §26)
- 50 reports (3 posts atingem threshold → score=-999)
- follows largos (Trust Lens PPR não-trivial)
- created_at espalhado 4 semanas (temporal decay)

**Total: 8 named + 50 seed = 58 identidades.**

### Mocks necessários (5)

| Subsistema | Estratégia |
|---|---|
| Nostr relay | In-memory event bus shared entre contexts (mocked SimplePool) |
| WebRTC signaling | Nostr DM kind 1059 via mesmo relay mock |
| STUN/ICE | Loopback localhost candidates |
| Helia/IPFS | Mocked content-addressed Map<CID,Blob> shared + delay realista |
| CARTO tiles + nostr.build | Placeholder + stub URL (file em-memory Map) |

### Determinismo
Timestamps fixos via fixture constants (base `1716000000`). Manifesto §7 + `Date.now()` proibido em puras. **[user confirmou? PENDENTE]**

---

## Batches

### Batch B1 — Infra (3 agents paralelos, build)

| Agent | Constrói | ⏱ | 🔢 |
|---|---|:---:|:---:|
| Marshall | Seed schema — 58 fixtures que passam `onNostrEvent` pipeline. Cascata conhecida + weights conhecidos + geo conhecido | ~1.5h | ~150K |
| Lily | Boot wire `?dev-seed=1` + Playwright multi-context fixture (`setupUser(name)`) + badge "DEV SEED" header | ~1.5h | ~120K |
| Ted | Helia + WebRTC mock (driftHelia/driftWebRTC hooks já existem) + playwright.config.ts multi-context | ~2h | ~150K |

**Total build: ~2h paralelo · ~420K.**

### Batch B2 — Suites de validação (após B1, paralelo)

| Suite | Valida bug | ⏱ | 🔢 |
|---|---|:---:|:---:|
| `e2e/score-fidelity.spec.ts` | #1 — render DERIVA vs `calculateScore` puro (weights conhecidos) | ~45min | ~70K |
| `e2e/propagation-model.spec.ts` | #3 — arcs vs cascata esperada (Alice→Bob→Carol→Dave). Geográfico vs social? | ~1h | ~100K |
| `e2e/p2p-helia.spec.ts` | P2P multi-peer + Helia pin redundância (§15/§16) | ~1h | ~100K |
| `e2e/smoke-multi-user.spec.ts` | Alice publish → Bob/Carol/Dave veem no feed; 8 contexts boot | ~45min | ~70K |

**Total suites: ~1h paralelo (4 agents) · ~340K.**

### Batch B3 — Fixes guiados por evidência (após B2 revelar)

Depende do que as suites acharem. Candidatos conhecidos:
- **#3a** Scrubber sync — `arcs.filter(a => a.created_at <= scrubberTime)` data-gate (Lily deferiu como P3 em `8f79feb`)
- **#3b** Modelo propagação — DECISÃO: manter geográfico OU adicionar modo cascata-social? (precisa deliberação Ted+Satoshi: §28 vaza follow-graph?)
- **#3c** Post-mode chain linear enganoso (`d0→d1→d2`) → corrigir pra origin→cada-dest
- **#1** Score fix se suite achar divergência render vs cálculo
- **Zoom settle** minor (fit-bounds 1x no mount)

---

## Estimativa total

| Batch | ⏱ paralelo | 🔢 |
|---|:---:|:---:|
| B1 infra | ~2h | ~420K |
| B2 suites | ~1h | ~340K |
| B3 fixes | depende evidência | ~200-400K |
| **Total** | **~4-5h wall-clock** | **~1M-1.2M tokens** |

ROI: destrava #1+#3 (bugs profundos) + infra E2E permanente (previne regressão futura) + valida P2P/Helia (nunca testados end-to-end).

---

## Decisões — RESOLVIDAS 2026-05-29

1. ✅ **Roster:** 8 named + 50 seed CONFIRMADO. ("ainda não cobriu tudo, mas vamos em frente e incrementando")
2. ✅ **Timestamps:** base `1716000000` determinístico, nsec derivado de seed string.
3. ✅ **B1 dispatched** — 3 agents paralelos (Marshall seed / Lily boot+playwright / Ted helia+webrtc mock).
4. ⏳ **Modelo propagação (#3b):** deixar B2 suite `propagation-model.spec.ts` revelar PRIMEIRO (evidência antes de deliberar geográfico-vs-social). Deliberação Ted+Satoshi só DEPOIS da suite mostrar o que arcs realmente desenham vs cascata conhecida A→B→C→D.

## Status execução

| Batch | Status | Agents |
|---|---|---|
| B1 infra | 🔄 EM VÔO | Marshall `adc2856` · Lily `a587a20` · Ted `acbbe53` |
| B2 suites | ⏳ após B1 | score-fidelity, propagation-model, p2p-helia, smoke |
| B3 fixes | ⏳ evidence-driven | scrubber sync, #3b modelo, score, zoom settle |

## Incremento (escopo cresce conforme aparece — user 2026-05-29)
Plano NÃO é fechado. Coberturas a adicionar conforme B2 revelar:
- Score edge cases (bury>spread, última-ação-vale §23, comment contribution)
- Moderação §26 multi-reporter threshold dinâmico
- Trust Lens PPR reordenamento local com follow-graph conhecido
- Multi-identidade switch (§4) sem vazar pipeline
- Eviction §16 (não remove spreads do user)
- Rebroadcast oportunista em addRelay

---

## Já fechado nesta sessão (referência)

- Sprint N+4 Batch A: mode badge, 3 L-ID LOCKs, LHCI (billing-blocked), 5 baseline audit
- Cleanup 5 baseline failures → 0 reds (`d89e901`+`7e11589`+`61f2e94`+`5ca5c66`)
- Sprint N+4 Batch B: RadioGroupButton WCAG, CARTO+minimap hints, dialogs audit, NSFW spike (CONDITIONAL GO)
- Fix #2 toasts (`ddc79c6`)
- Memory consolidada (merged HIMYM deliberate, +dispatch_metrics)

## Bloqueios externos
- **GitHub Actions billing** — bloqueia LHCI Day N + 7 outros workflows. User precisa destravar payment/spending limit.
