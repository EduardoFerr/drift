# Trust Lens — Plano consolidado (Phase 1 + 1.5)

**Data:** 2026-05-17
**Status:** Plano ship-ready. Sintetiza deliberação HIMYM 5/5.
**Source artifacts:**
- RFC Ted: `Docs/sessions/trust-lens-ted-rfc-2026-05-17.md`
- Threat review Barney + Schema review Marshall + UX review Lily + Research Robin (deliberation outputs)

---

## 0. TL;DR

**Phase 1** — Lente local pessoal (PPR sobre grafo Nostr) que reordena o feed do user no view-layer. Math limpa, manifesto-compatible (§24 carve-out), zero novos kinds. ~2 semanas.

**Phase 1.5** — Visualização da rede no mapa: nodes verdes (alta confiança) → cinza (zero trust), permitindo user enxergar sua lens em vez de só sentir. ~3-4 dias adicionais.

**Phase 2** (deferido sem urgência) — Integração opcional com Vertex DVM (NIP-90) e/ou NIP-85 Trusted Assertions pra users com graph grande/phone low-end. NIP-32 abandonado como gating — nicho ocupado por NIP-85+DVMs.

---

## 1. Phase 1 — Core Lens

### 1.1 Schema final (Marshall + Lily rename)

```sql
-- Renomeado de trust_edges → lens_edges (Lily — colisão semântica com
-- 'weight' do ProfileModal). Source SEMPRE = active identity (multi-id
-- invariante #15). components JSON versionado pra forward-compat Phase 2.
CREATE TABLE IF NOT EXISTS lens_edges (
  source_npub TEXT NOT NULL,
  target_npub TEXT NOT NULL,
  influence   REAL NOT NULL CHECK (influence >= 0.0 AND influence <= 1.0),
  components  TEXT NOT NULL,         -- JSON {v:1, follow, mutual_spread, my_spread, my_bury, fof_paths}
  updated_at  INTEGER NOT NULL,      -- ms epoch
  PRIMARY KEY (source_npub, target_npub)
);
CREATE INDEX IF NOT EXISTS idx_lens_edges_source_influence
  ON lens_edges(source_npub, influence DESC);
CREATE INDEX IF NOT EXISTS idx_lens_edges_target
  ON lens_edges(target_npub);

-- PPR Monte Carlo cache. Cap 5000 rows/source via LRU eviction.
CREATE TABLE IF NOT EXISTS lens_walks_cache (
  source_npub TEXT NOT NULL,
  target_npub TEXT NOT NULL,
  ppr_score   REAL NOT NULL CHECK (ppr_score >= 0.0 AND ppr_score <= 1.0),
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (source_npub, target_npub)
);
CREATE INDEX IF NOT EXISTS idx_lens_walks_source_computed
  ON lens_walks_cache(source_npub, computed_at);

-- Filter rules predicate DSL (Robin §27 loop fix — sem isso, classifier
-- tags + lens não compõem). User-state, NÃO entra em DOMAIN_TABLES.
CREATE TABLE IF NOT EXISTS lens_filter_rules (
  rule_id    TEXT PRIMARY KEY,        -- UUIDv4
  predicate  TEXT NOT NULL,           -- JSON discriminated union (ver §1.3)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lens_filter_rules_active
  ON lens_filter_rules(active);
```

Adicionar em `user_prefs`:
- `lens_strength` REAL 0-1 (default 0)
- `lens_show_badges` INTEGER 0|1 (default 0)
- `lens_nudge_dismissed` INTEGER 0|1 (default 0)

**DOMAIN_TABLES** (auto-rebuild descarta):
- `lens_edges` ✅ derivável de follows + spreads observados
- `lens_walks_cache` ✅ puro cache de função pura
- `lens_filter_rules` ❌ user-state, preserva igual `blocked`/`muted`

### 1.2 Algorithm (Ted + clarificação user + Robin paper refresh)

**Edge influence formula** (per-edge weight):
```
influence(source → target) = sigmoid(
  w₁ · follow_edge          // 1.5 se segue, 0 senão
+ w₂ · log(1 + min(mutual, 20))  // mutual restrito a vizinhança-de-1; cap 20 (Barney P0.4)
+ w₃ · log(1 + my_spreads)
- w₄ · log(1 + my_buries)
)
```

**Personalized PageRank Monte Carlo** (Ted v2 deliberation 2026-05-17 — `Docs/sessions/trust-lens-L-parameter-ted-2026-05-17.md`):
```
parameters (HARD-CODED em src/lib/trust/constants.ts — não user_prefs):
  K = 1000 walks
  L = 6           // ⌊1/α⌋ par; captura ~62% da massa natural; ~75ms compute
  α = 0.15        // damping; expected walk length = 1/α = 6.67
  seed = hash(source_npub || floor(now / 24h))  // determinism cross-device §7

algorithm:
  for k in 1..K:
    walk = [source]
    for step in 1..L:
      if random() < α: break          // teleport-back termination
      next = sample_neighbor(current, weighted_by_influence)
      walk.append(next)
    for node in walk[1:]:              // exclui source
      visits[node] += 1
  ppr_score(target) = visits[target] / total_visits
```

**Path diversity bonus** (Barney/Alvisi/Viswanath — central, não polish):
```
disjoint_paths(source → target, depth ≤ 3) = count distinct intermediate npubs
diversity_bonus = min(disjoint_paths, 3) / 3   // [0, 1]
final_score = ppr_score × (0.7 + 0.3 × diversity_bonus)
```

**Local rendering score** (view-boundary apenas, NUNCA persisted):
```
β = 0.8 × lens_strength
γ = 0.4 × lens_strength²              // não-linear pra Forte não explodir (Lily)
s_local = s_global × clip(α₀ + β·ppr_score(author) + γ·mutual_spread_post, 0.1, 3.0)
```

Cap intermediary contribution: `M = 0.3` máx por single path (Barney P1.1 mitigation).

### 1.3 Filter Rules DSL (Robin §27 loop fix)

```typescript
type FilterPredicateV1 =
  | { v: 1; kind: 'trust_threshold'; op: 'lt' | 'gte'; value: number; action: Action }
  | { v: 1; kind: 'tag_present'; tag: string; tag_value?: string; action: Action }
  | { v: 1; kind: 'and'; predicates: FilterPredicateV1[]; action: Action }
  | { v: 1; kind: 'or'; predicates: FilterPredicateV1[]; action: Action }
  | { v: 1; kind: 'not'; predicate: FilterPredicateV1; action: Action }

type Action = 'hide' | 'dim' | 'collapse' | 'blur'
```

Exemplo de regra combinada (§27 loop completo):
```json
{
  "v": 1, "kind": "and", "action": "hide",
  "predicates": [
    {"v": 1, "kind": "tag_present", "tag": "content-warning", "tag_value": "nsfw"},
    {"v": 1, "kind": "trust_threshold", "op": "lt", "value": 0.1}
  ]
}
```

Reader rejeita `v !== 1` gracefully (retorna null, não throw).

### 1.4 Architecture (Ted + Marshall worker separation)

```
src/lib/trust-lens/
├── index.ts              // API pública: applyLens, recomputeIfNeeded
├── ppr.ts                // Monte Carlo PPR (pure, testable)
├── edges.ts              // edge influence calc (pure)
├── predicate.ts          // DSL evaluator + type guards
└── trust.worker.ts       // dedicated worker: read-only DB + recompute

src/lib/trust-lens.ts integrates with:
  - lib/follows.ts:onFollowsChanged → recompute trigger
  - lib/events.ts:onNostrEvent SPREAD/BURY → debounced recompute trigger
  - lib/feed.ts:applyContentFilters → applyLens(post, ppr) → s_local
```

`scoring.ts:calculateScore` **permanece intocado**. `posts.score` write-side fechado fora de `scoring.ts` (conformance test).

### 1.5 UX (Lily decisions)

- **Settings → "Sua Lente"** card (acordeão), título PT-BR neutro
- **Slider 0-100%** contínuo, snap stops em 0/50/100 ("Nenhum" / "Moderado" / "Forte")
- **Helper text dinâmico** por faixa (ver Lily report)
- **Toggle secundário**: "Mostrar quando a Lente reordenou um post" (default OFF)
- **Inspector**: chip discreto no canto inferior-direito do post → tap → sheet com 2 frases:
  - "@alice (que você segue) deu drift neste post."
  - "@bob (autor) é seguido por 3 pessoas que você acompanha."
  - Sem score numérico. Sem grafo desenhado.
- **Onboarding banner**: reusa pattern `DiscoverNudgeBanner`. Trigger: ≥10 follows AND identidade ≥7 dias AND `lens_nudge_dismissed = false`
- **Acessibilidade**: slider keyboard + ARIA; chip ≥44px hit; popup focus trap + ESC
- **Sem nudge paternalista** quando user sobe slider pra Forte ("considere experimentar Suave" → NÃO)

### 1.6 Threat fixes (Barney P0 — obrigatórios pré-ship)

| P0 | Fix | Onde |
|---|---|---|
| **P0.1 Storage unbounded** | Edges = follows ∪ FoF-d1 ∪ {autores SPREADei}; TTL 90d em não-follows; cap 50k LRU | `lens-lens/edges.ts:upsertEdge` |
| **P0.2 Filter shape leak** | `sync.ts` subscribe filters **NÃO** dependem de PPR. PPR é estritamente post-fetch. Conformance test grep | `sync.ts` + LOCK_VIA_TEST |
| **P0.3 Lens-flip social eng** | Confirm dialog pra preset change. URL handler `?action=` whitelist (lens preset/follows fora do whitelist). Audit log `user_prefs.lens_audit_log` | `AppearanceCard`-like + URL handler |
| **P0.4 Edge weight gaming** | Mutual restrito a vizinhança-de-1; cap mutual em 20 antes do log | `edges.ts` |
| **P0.5 Inspector path leak** | Path nunca persisted; sem logging de npubs; aria-label genérico; conformance test grep `console.log` sem npub | `Inspector.tsx` + LOCK_VIA_TEST |

### 1.6.5 Princípio capability-based (Ted survey 2026-05-17)

`Docs/sessions/zero-trust-survey-ted-2026-05-17.md` reforça que Trust Lens segue
modelo **capability-based** estilo Tahoe-LAFS: o `npub` ativo é a capability
que define o ponto-de-vista do walk. Nenhuma view escapa dessa restrição —
PPR não tem "view privilegiada" do operador; só viewer + grafo.

**Bandeiras vermelhas confirmadas** (Phase 2/3 não cruzar):
- **NÃO compartilhar PPR scores entre users** (vira EigenTrust, gaming, catedral — viola §22)
- **NÃO usar PPR pra moderation destrutiva** (`score = -999` é prerrogativa §26 reports, não Trust Lens)
- **NÃO importar "trust default list" de servidor central** no cold start (viola §17)

**Phase 3 candidatos** (não Phase 2):
- "View as @other_npub" — debug switch + valor pedagógico
- TOFU-style change alarm (grafo muda 40% em 24h → possível account compromise?)
- Sharing trust hints offline via BLE/sneakernet — careful, flerta com catedral

### 1.7 Conformance tests (Marshall 8 + Ted 9th)

1. **`posts.score` write-side fechado**: grep `UPDATE posts SET score` fora de `scoring.ts:scheduleScoreRecalc` + `moderation.ts:maybeModerate`
2. **`s_local` nunca persisted**: grep `s_local` fora de `trust-lens/*` e `feed.ts`
3. **PPR Monte Carlo determinism**: seed fixo + adjacency list fixo → result bit-exact em 10 runs
4. **Edge influence bounds**: property test 1000 inputs aleatórios → `[0, 1]`
5. **Filter predicate schema valid**: reader rejeita `v !== 1` ou `kind` desconhecido sem throw
6. **`lens_edges` nunca em raw_event nem em kind published**: grep em `protocol.ts` + `nostr.ts`
7. **Vocabulary lock**: JSX strings não usam "Trust"/"score numérico" — só "Sua Lente"/"influência"
8. **Subscribe filter independence** (Barney P0.2): grep `sync.ts` não importa `lens_edges` nem `ppr_score`
9. **PPR locality** (Ted survey): novo `tests/trust-lens-locality.test.ts` falha se função PPR escapa do client — import em `sync.ts`/`protocol.ts`/`nostr.ts`, publish em event tag, etc. LOCK_VIA_TEST §17/§22/§25

### 1.8 Cost

- Bundle: ~8 KB gz (incluindo predicate DSL + path diversity)
- Compute: ~100ms recompute debounced (L=8 vs L=4 era 50ms) em mid-range phone
- Render: ~0.2ms/post (table lookup + multiplier)
- Storage: ~80 KB / 500 follows com FoF-d1 caps

### 1.9 Manifesto check 5/5

| § | Check | Verdict |
|---|---|---|
| §17 sem chave mestra | lens local, sem poder pra ninguém; URL whitelist evita lens-flip | ✅ |
| §22 sem reputação subjetiva no protocolo | canônico `scoring.ts` intocado; multiplicador só no view | ✅ |
| §24 sem afinidade no feed canônico | carve-out explícito "visualização local" | ✅ |
| §25 sem chave mestra disfarçada | sem oracle único; toggle 1-click off; PPR estritamente post-fetch (P0.2) | ✅ |
| §27 auto-classificação | predicate DSL fecha loop classifier-tag → lens-respeita | ✅ |
| §28-30 compat ecossistema | zero novos kinds; só consome NIP-02 + NIP-51 | ✅ |

---

## 2. Phase 1.5 — Visualização da Rede no Mapa

### 2.1 User ask

> "Seria legal ter no mapa mais uma visão que seria de rede, o usuário veria a rede saudável de verde (nós de confiança) e a rede não saudável de cinza (nós de baixa confiança) (zero trust)"

### 2.2 Posicionamento

Drift já tem `SpreadMap.tsx` (MapLibre + Deck.gl ArcLayer + CARTO) pra mostrar geografia da deriva de posts. Adicionar **segunda view** dentro do SpreadMap:

- Tab "Geo" (atual) — propagação geográfica dos posts
- Tab **"Rede"** (novo) — grafo de confiança visualizado

### 2.3 Visualização

**Layout**: force-directed graph (D3-force pra cálculo, canvas/PixiJS pra render — não SVG, performance phone)

**Nodes**: npubs no top-200 do user (sorted por PPR desc + follows diretos)
- Tamanho: log(1 + ppr_score × 100) — proporcional à influência
- Cor: gradiente verde→cinza por PPR
  - PPR alta (≥0.05): `var(--drift-spread)` (verde-foam, varia por tema)
  - PPR baixa (<0.005): `var(--drift-muted)` (cinza, zero-trust)
  - Intermediário: interpolação linear OKLCH
- Label: truncado por default (`@al…`), expand opt-in

**Edges**: follow + mutual_spread
- Espessura: `influence` (formula §1.2)
- Cor: stroke do nó de origem com opacity 0.3

**Interações**:
- Pan/zoom (pinch + drag)
- Tap node → sheet com: npub completo, PPR score, components ("você segue + 3 mutuais + você deu drift 5x"), botão "ver perfil"
- Long-press node → "esconder esse user da lente" (cria filter_rule local)
- Center on me: botão "voltar ao centro" → camera focus em source npub

**Toggle**:
- "Mostrar só follows diretos" (depth 1)
- "Mostrar FoF" (depth 2)
- "Mostrar tudo" (até 200 nodes)

### 2.4 Schema reuso (Marshall)

**Zero novas tabelas.** Consome direto:
- `lens_edges WHERE source = active` → edges
- `lens_walks_cache WHERE source = active` → ppr_score per node
- `follows` table → distinguir follow direto vs FoF

Nova função em `lib/trust-lens.ts`:
```typescript
export function getGraphForVisualization(
  source: string,
  topN: number = 200
): { nodes: GraphNode[]; edges: GraphEdge[] }
```

### 2.5 Threat (Barney — extends inspector P0.5)

**Risco escalado**: visualização inteira do grafo de trust = screenshot leak amplificado vs inspector point-to-point.

Mitigações:
- **Warning banner** primeira vez user abre tab "Rede":
  > "Esta visualização mostra sua rede de confiança pessoal. Se você compartilhar imagem, outros podem ver quem você segue e em quem confia."
- **Default labels truncados** (`@al…`), expand opt-in per-node
- **NÃO publica** screenshot via Drift (não temos share image API; garantir continua não tendo)
- **Conformance test**: grep que código de Rede view não chama `canvas.toDataURL` ou `html2canvas`-like

### 2.6 UX (Lily — extends Phase 1 decisions)

**Naming**: tab simplemente **"Rede"** (não "Network", não "Grafo de Confiança"). Curto, em português.

**Mental model — agência positiva (user feedback 2026-05-17)**:
- Verde = "pessoas próximas da sua rede" (alta PPR via mutuais/follows/spreads)
- Cinza = "pessoas distantes da sua rede" (baixa PPR, fora do alcance)
- **Framing como curadoria, não julgamento**: user pode encontrar nós cinzas que NÃO quer manter na sua lente e remover via long-press → cria `filter_rule`. É **agência sobre a própria lente**, não estigma.
- Gameficação leve sem ser explícita: ver o grafo torna PPR tangível em vez de "algoritmo invisível"; user é incentivado a curar sua rede limpando nós irrelevantes.
- **Evitar copy "saudável/não saudável"** — Lily flagou como judgmental. Mas a INTENÇÃO é agência (poder limpar), não estigma (rotular outros). Resolver via verbo: **"limpar da minha lente"** em vez de "marcar como ruim".

Copy do header:
> Sua Rede
> Os pontos mais verdes são pessoas mais próximas da sua rede. Os mais cinzas estão mais distantes — toque pra ver, segure pra remover da sua lente.

**Empty state**: se PPR cache vazio (lens nunca rodou), botão "Calcular Sua Rede" + spinner durante recompute.

**A11y**: graph visualizations são notoriamente ruins pra screen readers. Adicionar:
- Tabela alternativa ARIA toggle: "ver como lista" → top-N por PPR em tabela texto-only
- Keyboard nav: Tab cicla nodes; Enter abre sheet
- Cor + tamanho (não cor sozinho) codificam PPR — WCAG 1.4.1

### 2.7 Performance

- D3-force standalone (~40 KB gz) + canvas render (~ 0 KB, nativo)
- Alternativa Sigma.js (~50 KB) — descartada, D3-force suffices
- 200 nodes + ~500 edges em canvas 2D: 60fps em mid-range phone
- Lazy chunk: só carrega quando user abre tab "Rede"

### 2.8 Cost

- Bundle: ~45 KB gz (D3-force + render code) lazy
- Compute: layout convergence ~500ms first-render, depois cached
- Render: 60fps target

---

## 2.9 Phase 3 — multi-list curation (user vision 2026-05-17, decisão consolidada)

User propôs Phase 2/3 expansão: multi-list curation com per-list strength sliders + ~~parental control via password lock~~.

### Decisão política registrada (manifesto §17 adendo II 2026-05-17)

**Cliente oficial Drift NÃO embute controle parental nem password lock** (mesmo como "self-binding"). Filho menor é user §17 — Drift NUNCA é usado contra um user.

Casos legítimos de "configuração delegada" são endereçados por primitives existentes:
- **Multi-identity** (§15) + **nsec portável** (§3) — pai importa nsec do filho no client dele, configura lentes/follows/filters, filho usa device dele com mesma nsec
- **Shared device** com identidade única — config aplica pra essa identity no device
- "Se filho descumprir ordem do pai, isso é problema familiar" — fora do escopo técnico

Quem quiser fork "Drift Family" pode — manifesto próprio. Cliente oficial não.

### Phase 3 scope (multi-list mixer, sem lock)

**Naming Lily**: "Lentes" (plural). Phase 1 "Sua Lente" vira "Lente Pessoal" (item da coleção).

| Componente | Veredict |
|---|---|
| **Multi-list mixer 0-100%** | ✅ Phase 3 ship. Pipeline: Trust Lens base + filter_rules locais (hard) + lentes externas additive + conflict resolver (**exclude vence** default) + reports §26 |
| **Source diversity** (NIP-32 / NIP-85 / Vertex / NIP-78 / local) | ✅ Com mitigations: source npub visible; nunca default-ON; cap N=10 ativas; cap 50k rows/lente LRU |
| **Discovery** | Peer-to-peer ONLY — colar npub, escanear QR, sugestões orgânicas via PPR ("lentes ativas entre seus top-PPR"). **Sem marketplace oficial**, sem editorial Drift |
| **Schema** | NIP-51 kind 30000 (Generic List) reusar pra publicação — zero novos kinds (§28-30). Tabelas `lenses` + `lens_subscriptions` (user-state, NÃO em DOMAIN_TABLES). Coluna `lens_id` opcional em `lens_filter_rules` |
| **Conflict resolution UX** | Exclude vence + explicit surface no Inspector ("Lista A queria incluir @x, Lista B excluiu") |
| **Cumulative censorship indicator** | "X% escondido" persistente >10%, warning sutil >30%. Mitigação Barney crítica |
| **Slider snap** | 0/50/100 com labels Nenhuma/Moderada/Forte (consistência Phase 1) |
| **Update lente sem consent** | Não — pull manual ou opt-in auto-pull com diff review notification |
| **Filter rules locais (block/mute)** | Compõem, não substituem — block sempre vence (hard veto) |
| ~~Password lock~~ | ❌ Removido permanentemente do escopo (manifesto §17 adendo II) |

### 6 bandeiras vermelhas Phase 2/3 — NÃO cruzar

1. ~~Password lock parental~~ → **decidido: nem self-binding. Fora.**
2. Trust score público (mesmo NIP-85 opt-in)
3. Default-ON em qualquer lente externa
4. Sync de filter_rules entre devices via Nostr (publica o que esconde = vetor vigilância)
5. Lente pre-fab "anti-CSAM/extremismo" hardcoded com escopo amplo no client default
6. "Stealth mode" lente (ativa sem indicator visible)

Detalhes: `Docs/sessions/trust-lens-multilist-barney-2026-05-17.md` + `trust-lens-multilist-lily-2026-05-17.md`

Robin research ainda rodando — quando completar, integra NIP-51 adoção + Argon2id WASM size (nota: relevância reduzida sem password lock) + anti-centralização patterns Phase 3.

---

## 3. Phase 2 — Vertex DVM / NIP-85 (Robin reframe)

**Reframing crítico**: NIP-32 labeler market **não está emergindo**. NIP-85 Trusted Assertions + Vertex DVM (NIP-90) ocuparam o nicho. Coracle já integra Vertex hoje.

**Phase 2 plano**:
- Settings → Sua Lente → **"Acelerar via Vertex"** toggle (default OFF)
- ON → Drift consulta Vertex DVM endpoint `rank-profiles` (npub do Vertex hardcoded mas substituível)
- Resultado: PPR pré-computado server-side (cost: 0 compute local)
- User aceita: Vertex npub vê quais npubs você quer ranking sobre (privacy trade-off explícito)

**Gate**: queremos Vertex como single point of WoT? §17/§25 — Vertex npub é central. Alternative providers existem mas pequenos. Honest disclosure no toggle.

**Quando**: Phase 1 + 1.5 ship → telemetry de quanto user low-end sofre com compute local → decide Phase 2 timing. Não bloqueante.

---

## 4. Timeline

| Fase | Escopo | Esforço |
|---|---|---|
| **Phase 1** | Core lens: schema, PPR worker, predicate DSL, slider+chip+banner UX, 5 P0 fixes, 8 conformance tests | ~2 semanas |
| **Phase 1.5** | Rede view no SpreadMap: D3-force canvas, threat warning, "próxima/distante" UX | ~3-4 dias adicionais |
| **Phase 2** | Vertex DVM integration opcional | deferred, ~1 semana when triggered |

Phase 1 e 1.5 podem ser commits intercalados num único PR ou PRs separados — recomendação: **PRs separados** pra threat review de Rede view ser independente do core.

---

## 5. Open questions / handoffs pós-plano

- ~~**Ted refinement L= tensão**~~ ✅ **RESOLVIDO 2026-05-17** — Ted v2 deliberation locked L=6 (math: ⌊1/α⌋ par, captura ~62% massa natural, ~75ms compute). Hard-coded em `src/lib/trust/constants.ts`. Detalhes: `Docs/sessions/trust-lens-L-parameter-ted-2026-05-17.md`
- **Marshall predicate DSL**: refinar operators conforme casos de uso reais aparecerem (Phase 2 pode precisar `time_decay`, `relay_subset`).
- **Lily**: copy final pra empty states e Rede view ("@alice deu drift" testar com 3-5 users PT-BR, sugerido Robin).
- **Barney followup**: Alvisi 2013 SoK + Mohaisen 2010 mixing time worth deep read antes de Phase 1 freeze.
- **Robin**: scrape graph-api.iris.to pra ground-truth median follows/diameter Nostr atual antes de PR Phase 1.

---

## 6. Manifesto-conformance summary

✅ Zero novos kinds Nostr
✅ Score canônico intocado
✅ Trust score nunca exposto publicamente
✅ Local-only compute (Phase 2 Vertex é opt-in com disclosure)
✅ Toggle off em 1 clique
✅ Filter rules user-state (preserva em auto-rebuild)
✅ §27 loop fechado via predicate DSL
✅ Subscribe filters não dependem de PPR (Barney P0.2)
✅ Inspector path/Rede view sem persistência (Barney P0.5)

**Ship-ready quando**: P0 Barney aplicados + 8 conformance tests verdes + Lily copy validado.
