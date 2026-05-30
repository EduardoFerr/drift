# Known Limitations — Drift

Índice de limitações conhecidas (gaps deliberadamente deferred, attack
vectors documentados sem fix imediato, simplificações de Phase 1 que
serão revisitadas). Cada item tem:

- **Issue** — descrição precisa
- **Risk** — quem é afetado + severity
- **Mitigation** — defesa atual (mesmo que parcial)
- **Reopener** — condição que dispara fix

Mantenha esta lista **honesta**: não suprimir achados de Satoshi/Barney
audits só por feio. Defer documentado > silence.

---

## Trust Lens

### 1. ~~Sybil edge-refresh bypassa PPR decay temporal (GAP-1)~~ ✅ FECHADO

- **Status:** FECHADO 2026-05-20 via Gap B fix.
- **Issue original:** `temporalDecay()` usava `updated_at` (refresh-on-write).
  Sybil que re-segue/re-drifta resetava timestamps → decay = 1.0.
- **Fix shipado:**
  - Schema: `lens_edges.created_at INTEGER` nullable adicionado via
    migration additive em `db.worker.ts:applyMigrations`
  - Backfill conservative: rows pré-migration recebem `created_at =
    updated_at` (pior caso aceito; trava após 1 write)
  - Writers (`trust-lens.ts:upsertLensEdge` + `trust/edges.ts:upsertEdge`):
    `created_at` no INSERT columns mas NÃO no `DO UPDATE SET` — imutável
    após primeiro INSERT por construção SQL
  - Reader (`recomputeLens`): SELECT inclui `created_at`, decay usa
    `row.created_at ?? row.updated_at` (COALESCE defensivo)
  - 4 conformance tests source-grep (`#28-#31` em `trust-lens-math.test.ts`)
- **Surface residual:**
  - Grace window 1-write em rows pré-migration: edge antigo com backfill
    `created_at = updated_at` ainda pode ser "burlado" 1 vez até próximo
    refresh, depois trava
  - DB-backed integration tests (real upsert + sleep + re-read) defer
    porque exigem SQLite WASM init em Vitest Node — conformance source-
    grep cobre o pattern
- **TODO restante FECHADO 2026-05-21:** refactor DRY shipado —
  `upsertLensEdge` em trust-lens.ts virou thin wrapper que delega
  `upsertEdge` em trust/edges.ts. Single source of truth pro SQL.
  Conformance test #29 atualizado pra travar o pattern (1 SQL site).

### 2. HINT_RULES + GuidanceRule.body — JSX injection vector futuro (DAOP Phase 2+)

- **Issue:** `body: (ctx) => ReactNode` permite JSX arbitrário do caller.
  Hoje hardcoded no repo (versionado, auditável). Se Phase 2 DAOP carregar
  hints remotos (RFC futura), factory pattern abre XSS via JSX inject.
- **Risk:** LOW hoje (regras vivem no repo). MEDIUM em Phase 2 remoto.
- **Mitigation:** Hardcoded em `src/lib/guidance.tsx`; LOCK_VIA_TEST
  `guidance-rules-conformance.test.ts` trava as 5 ONBOARDING_RULES + 1
  HINT_RULES atual.
- **Fix correto:** Se Phase 2 remoto: CSP nonce + DOM sanitizer +
  schema validation server-side (mas isso violaria §17 "sem chave mestra
  na guidance"). Conclusão provável: NUNCA fazer remote DAOP.
- **Reopener:** RFC pra hints dinâmicos / remotos surgir.

### 3. Cluster detection (LPA) defer Phase 2 (GAP-CLUSTER)

- **Issue:** Trust Lens não detecta clusters de Sybil rings via Label
  Propagation Algorithm (LPA). Custo O(V·E) por iteração + sem dados
  reais pra calibrar threshold de cluster_density.
- **Risk:** LOW hoje (base small). MEDIUM se atacante explorar.
- **Mitigation:** PPR já tem path diversity scoring + W_BIAS=-2.0
  (anti-Sybil em cold-start hostile). Defesa em camada.
- **Reopener:** DAU > 1000 + grafo médio > 100 follows/user, OR
  FORA/Vertex telemetry indicar discovery gap.

### 4. PR-4c worker thread defer

- **Issue:** PPR recompute roda em main thread (~75ms median mid-range
  phone).
- **Risk:** LOW. Abaixo do RAIL 100ms threshold.
- **Mitigation:** debounced + run apenas em triggers (follow change,
  50 events, 24h TTL).
- **Reopener:** Telemetria local p95 > 200ms OR user report de UI
  stutter.

### 4b. Lente alimentada SÓ por follows (interação não cabeada) — Fase 2b

- **Issue:** o builder de aresta por interação (`recordEdge` on-spread,
  `lens_edges` interação-ponderado) **não tem caller** ainda. Até
  2026-05-30 NADA chamava `recomputeLens` → a lente ficava dormente
  (pprScores vazio, cores/pontes nunca apareciam). Corrigido cabeando
  `bootstrap.ts:startLensAutoRecompute` (boot + on follows-change) com
  `recomputeLens` caindo pro **grafo de follows (NIP-02, influence=1)**
  quando `lens_edges` está vazio.
- **Status:** PARCIAL. A lente acende (follows-graph), mas é HÍBRIDO só na
  teoria — a metade de interação (spreads ponderando influence) ainda não
  popula `lens_edges`. Hoje toda aresta vale 1.
- **Risk:** LOW. Follows-graph já dá topologia válida + Sybil-resistência
  (PPR do meu nó). Falta só o refinamento de peso por preferência revelada.
- **Mitigation:** decisão de fonte registrada (HÍBRIDO) em
  `Docs/sessions/map-model-deliberation-2026-05-30.md`; fallback follows
  documentado no código. Pontes (`wot.ts:findBridges`) dependem da
  PROFUNDIDADE do follow-graph, não da interação — já funcionam.
- **Reopener:** quando wirar `recordEdge` no ingest de SPREAD próprio
  (interação ponderada live) — vira increment "Fase 2b+".

---

## Weight / Score

### 5b. Event NOP pode resetar contador de inactivity (PARCIALMENTE FECHADO)

- **Issue original:** `users.last_active` atualizado em qualquer evento
  assinado. Vetor: POST kind 9078 com `{subposts:[]}` passava no
  schema validation e disparava `updateUserActivity`.
- **Status atual (pós-Satoshi devsec fix 2026-05-20):**
  `validatePostShape` em `events.ts` agora REJEITA POST com
  `subposts.length === 0`. Evento NOP nem chega ao pipeline persist.
  Defesa em camada no schema gate. Cliente Drift oficial NUNCA cria
  POST sem subposts; atacante que tenta é bloqueado.
- **Surface restante:**
  - SPREAD/BURY/REPORT exigem tag `e` válida (hex64) — atacante
    precisa referenciar post real existente
  - COMMENT (kind 1111) exige tags `e`+`E` válidas + content não-vazio
    (já validado em parser)
  - Kind 0 (profile) e kind 3 (follows) NÃO chamam updateUserActivity
- **Risk pós-fix:** ~ZERO via NOP. Vetor remanescente exige criar
  evento referenciando post real (SPREAD/BURY/REPORT) — custo do
  atacante sobe pra "publicar conteúdo real OU repetir auto-spread"
  (que já não passa porque IGNORE INTO + idempotência).
- **Reopener:** Padrão de attack diferente surgir (ex: atacante usa
  spreads recíprocos em ring), OR weight tier 🌱→⭐ permanente em
  identidades óbvias.

### 5c. Brigada de moderadores insider — PARCIALMENTE FECHADO

- **Status:** PARCIALMENTE FECHADO 2026-05-21 (Barney devsec
  time-window decay).
- **Issue original:** 5 veteranos (weight≥75, 2pts cada) coordenados
  atingem threshold em comunidade média (~10k users → threshold 10pts)
  sem precisar Sybil farming.
- **Mitigation parcial shipada:**
  - Função pura `calculateEffectiveReportWeight(reportWeight, ageMs,
    halfLifeMs)` em `moderation.ts`
  - Pref `UserPrefs.report_decay_enabled` (default OFF — opt-in até
    telemetria validar). Quando ON, `aggregateReports` aplica decay
    48h half-life sobre cada report
  - `maybeModerate` lê pref + passa opts → reports antigos pesam menos
  - 8 conformance tests novos em `tests/moderation.test.ts`
- **Surface residual (documentada nos próprios tests):**
  - **Brigada flash <1h:** decay 48h não pega (5 reports/1h = peso
    ~9.93/10.0). Test "brigada flash 1h" documenta como esperado.
  - **Consenso lento >120h:** legítimo sofre (5 reports/120h = peso
    ~5.47, exige ~2× mais reports pra moderar). Trade-off aceito.
- **Fix completo requer:** GAP-CLUSTER (cluster detection nos
  reporters) — Phase 2. Trust Lens diversity bonus combinado com decay
  fecha o gap em ambas direções.
- **Reopener:** Caso documentado de brigada coordenada real OR shipping
  de GAP-CLUSTER detection.

---

## Anti-spam

### 6. Content-hash dedup — pesquisado, NO-GO atual

- **Issue:** sem mecanismo de "mesmo content = sinaliza dup". User
  poderia argumentar: "spam é copy-paste em flood; hashear content
  como NIP-94 faz com imagens seria defesa natural."
- **Status:** **NO-GO atual** após deliberação Satoshi + Ted
  (2026-05-21). Decisão registrada em
  `Docs/sessions/content-hash-dedup-deliberation-2026-05-21.md`.
- **Razões NO-GO:**
  - **Evasão custo zero:** atacante muda 1 char (espaço, emoji,
    homoglyph cirílico) → hash diferente. Não eleva tax.
  - **Redundante:** Sybil novo já tem `weight=0` → spread vale 0 →
    posts invisíveis no feed canônico. Defesa atual paga o custo.
  - **Falsos positivos:** cenário breaking news (32 pessoas postando
    "Grêmio 3x2") penaliza 31 por acaso.
  - **§17 risco:** UI agrupando clones esconde post legítimo de quem
    postou depois → quase-censura.
  - **Slope:** hash → fingerprinting → similarity matching → filtro
    centralizado.
- **Defesas atuais que já funcionam:**
  - `weight=0` pra Sybil novo (invisibilidade automática)
  - max 1 subpost pra `weight<20` (tax em volume)
  - Threshold dinâmico de moderação (tax em coordenação)
- **Plano arquitetural pronto (Ted Opção B)** se reabrir: coluna
  `posts.content_hash`, função pura `hashPostContent(subposts)` em
  `lib/protocol.ts`, opt-in via `UserPrefs.dedup_enabled` default OFF,
  penalty em `calculateScore`, never-hide-own-post (Satoshi mitigation).
- **Reopener:**
  - Evidência concreta de spam que NÃO foi resolvido por `weight=0`
    (ex: identidades veteranas farmadas postando flood coordenado)
  - OR designs futuros de moderação precisarem de hash como primitivo
    (ex: agrupar reports por content-hash em vez de post-id)
  - Suspicion geral NÃO basta — exige attack pattern documentado.

---

## DAOP / Capabilities

### 5. dismissRule sem rate limit

- **Issue:** `capabilities.ts:dismissRule(id)` grava em `user_prefs`
  sem throttle. Atacante via XSS bug pode spam-dismiss em loop.
- **Risk:** LOW. RULE_ID_PATTERN filter + Set dedup limitam overflow;
  bag CSV cresce O(rule count distinct) ~50 max.
- **Mitigation:** `serializeDismissedBag` filtra IDs inválidos no
  write. `RULE_ID_PATTERN` rejeita malformed.
- **Fix correto:** Debounce em UI handlers OR pref `dismiss_rate_limit`.
- **Reopener:** XSS vuln descoberta no app, OR user report de bag
  corrupted.

---

## Image / Blobs

### 6. Image fallback `<img src>` sem hash verify (legacy posts)

- **Issue:** Posts pré-NIP-94 ou sem `meta` field no subpost caem no
  `src` direto sem SHA-256 verify. Hash defense só ativa quando
  `meta.hash` presente.
- **Risk:** LOW. Atacante precisa controlar relay + tags do post pra
  injetar URL diferente — modelo de ameaça similar a NIP-01 padrão.
- **Mitigation:** `fetchBlobUrl(meta)` verifica hash quando presente;
  fallback é último recurso.
- **Reopener:** Quando posts pré-NIP-94 ficarem residuais (< 1% do
  feed), considerar hard-fail em vez de fallback.

---

## Mapas

### 7. K-anonymity ausente em SpreadMap (K=1 doxx residual)

- **Issue:** mapa de post mostra pin único quando user é o ÚNICO com
  GPS no spread. Em cidade pequena, community knowledge identifica o
  spreader (ex: "era só Pedro naquela favela que viu este post").
- **Risk:** HIGH em small towns (pop <50k). Manifesto §28 vaza
  empiricamente — opt-in default OFF é mitigação parcial mas user
  pode habilitar GPS sem entender o risk.
- **Mitigation atual (parcial, shipada 2026-05-21):**
  - Helper puro `isUserSoloSpreader(data, activeNpub): boolean` em
    `src/hooks/useSpreadMap.ts`
  - Component `SoloSpreaderWarning` overlay top-right do mapa em
    modo `post`. Copy: "📍 você é o único com GPS aqui — sua
    localização é identificável..."
  - Trigger automático quando `data.totalSpreads === 1 &&
    firstSpread.spreaderPub === activeNpub`
  - Dismissal session-only (rebornece em outro post K=1)
  - Educa user organicamente — não esconde o pin do mapa (manifesto
    §17: cliente não decide unilateralmente)
- **Fix completo (Phase 2):** K-anonymity engine. Opções:
  - **Suppression:** mapa não renderiza se K < 3 → trade-off coverage
  - **Aggregation:** bucket regional 50km quando K < 3 → trade-off
    fidelidade
- **Reopener:** DAU > 1000 + telemetria empírica de K distribuição
  OR user report concreto de doxx em small-town community.
- **Doc canônico:** `Docs/threat-model-maps.md` §K=1-DOXX.

---

## Distribuição

### 7. Tauri binary distribution não shipped

- **Issue:** Manifesto §15 (anti-censura por país) + §17 (sem chave
  mestra na distribuição) + §21 (anonimato) dependem de cliente nativo
  Tauri com Tor embedded. PWA browser não cobre Tor.
- **Risk:** MEDIUM. Users que precisam Tor (jornalistas, dissidentes)
  não têm acesso ao Drift hoje.
- **Mitigation:** Roadmap explícito (Fase 6 + Fase 7); F-Droid
  manifest planejado; TWA Android antecipado via Bubblewrap.
- **Reopener:** É o trabalho ativo — não fechável até Fase 6/7
  shipparem.

---

---

## Anti-eclipse / Discovery

### 8. Random walk pós-CONNECTED entry não shipado

- **Issue:** `src/lib/probe.ts` roda probe periódico 30min pra
  detectar relay malicioso (silent-drop, fork, eclipse setup) — isso
  está shipado. Mas **random walk ATIVO pós-CONNECTED** — amostragem
  contínua de peers conhecidos após entrada na rede, conforme
  manifesto §20 — não foi entregue no transporte WebRTC. Hoje, uma
  vez `CONNECTED`, o cliente confia no conjunto de peers descoberto
  via bootstrap + nostr signaling, sem re-amostragem agressiva.
- **Risk:** MEDIUM. Eclipse attack via relay coordinator (atacante
  controla todos os relays iniciais que o cliente conhece) só tem
  defesa em camada via probe periódico — não há descoberta contínua
  de paths alternativos pós-entry. Em país com poucos relays
  acessíveis (cenário §15), isso aproxima MEDIUM-HIGH.
- **Mitigation atual:**
  - **Probe periódico 30min** (`startProbe()` em bootstrap) detecta
    silent-drop e fork comparando estado entre relays redundantes
  - **Path diversity scoring** em `src/lib/transport/webrtc/peerScore.ts`
    avalia peer por quantos caminhos independentes levam a ele —
    mitiga influência desproporcional de um operador
  - **Multi-relay publish** (sempre ≥2 relays paralelos, manifesto
    §14) reduz custo do atacante a coordenar TODOS os relays
    descobertos
  - **Cluster detection** em peer registry (`webrtc/discovery.ts`):
    se >70% dos peers vêm da mesma origem inferida, cliente entra
    em estado `ISOLATED` — mas isso é check de ENTRY, não contínuo
- **Fix correto:** Random walk com path diversity quando WebRTC
  P2P discovery shipar completo em Fase 6.4. Amostragem aleatória
  de peers conhecidos a cada N minutos, com weight inverso à
  path diversity já estabelecida (peers de origem under-represented
  são preferidos). Função pura calculável + testável.
- **Reopener:** Fase 6.4 WebRTC P2P transport completo (PeersCard
  UI shipped + bootstrap UX validado em campo) OR telemetria
  local mostrando eclipse attempt real (ex: probe detecta fork
  recorrente em ambiente específico de user).
- **Doc canônico:** `Docs/webrtc-6.4-plan.md` §random-walk;
  manifesto §20.

---

*Última atualização: 2026-05-21 (criado em pair-review Lily + Barney+Satoshi;
§8 random walk adicionada por Robin Sprint N+2).
Reabrir requer condição explícita do "Reopener" — não suspicion geral.*
