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
- **TODO restante:** refactor `upsertLensEdge` em trust-lens.ts pra
  delegar `upsertEdge` em trust/edges.ts (DRY). Backlog separado.

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

### 5c. Brigada de moderadores insider (5+ veteranos coordenados)

- **Issue:** `getReportThreshold` escala com base ativa (0.1%). Em
  comunidade média (~10k users → threshold 10 pts), 5 identidades
  veteranas (weight ≥75, 2.0 pts cada) coordenadas podem atingir
  threshold e derrubar post legítimo sem Sybil farming.
- **Risk:** MEDIUM. Requer **collusion** real de identidades estabelecidas
  (não Sybil simples). Vetor existe se comunidade tem conflito político
  + faction organizada.
- **Mitigation atual:**
  - `report_threshold_override` em UserPrefs permite power user
    customizar (mas é local, não comunitário)
  - Reports são públicos (kind 9081) — auditoria post-hoc identifica
    brigada
  - Manifesto §17 garante que post **NUNCA é apagado** dos relays —
    cliente alternativo exibe mesmo após score=-999
- **Fix correto:** harder problem — defesa contra collusion organizada
  esbarra em §22 (sem reputação subjetiva). Possibilidades:
  - Time-window decay nos reports (5 reports em 1h vs 1 report/dia)
  - Diversity bonus nos reporters (clusters de coordinators
    detectáveis via Trust Lens GAP-CLUSTER quando shipar)
  - Default-on threshold higher pra reports com cluster overlap
- **Reopener:** Caso documentado de brigada coordenada, OR shipping
  de GAP-CLUSTER detection (Phase 2).

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

*Última atualização: 2026-05-20 (criado em pair-review Lily + Barney+Satoshi).
Reabrir requer condição explícita do "Reopener" — não suspicion geral.*
