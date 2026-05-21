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

### 1. Sybil edge-refresh bypassa PPR decay temporal (GAP-1)

- **Issue:** `temporalDecay()` em `recomputeLens()` usa `lens_edges.updated_at`
  como age proxy. Mas `updated_at` é refresh-on-write (upsertEdge atualiza
  a cada follow/spread/bury). Atacante que controla N identidades Sybil
  pode "re-seguir" ou "re-driftar" posts antigos pra resetar timestamps
  → decay = 1.0, edge volta a pesar como se fosse novo.
- **Risk:** MEDIUM. Sybil ring com >10 identidades coordenadas pode
  bypassar decay deliberadamente. User isolado (sem multi-conta) não
  reproduz o ataque.
- **Mitigation:** Documentado inline em `src/lib/trust-lens.ts` (KNOWN
  LIMITATION comment em `recomputeLens`). `lens_ppr_decay_enabled`
  default OFF — users sem feature ligada não são afetados.
- **Fix correto:** Schema bump adicionando `created_at INTEGER NOT NULL`
  imutável em `lens_edges`. Decay usa `max(age_since_created,
  age_since_updated)` (conservative).
- **Reopener:** (a) Telemetria local mostrar adoption rate de
  `lens_ppr_decay_enabled` > 20%, OR (b) Sybil attack report concreto,
  OR (c) início de Phase 2 Web-of-Trust audit. Backlog: "Lens edges:
  column created_at imutável".

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
