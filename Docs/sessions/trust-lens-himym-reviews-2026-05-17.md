# Trust Lens — HIMYM 4-persona reviews

**Data:** 2026-05-17
**Status:** Deliberação 5/5 completa (Ted RFC em arquivo separado; 4 revisores aqui).
**Source artifacts:**
- Ted RFC: `Docs/sessions/trust-lens-ted-rfc-2026-05-17.md`
- Plano consolidado: `Docs/plans/trust-lens-phase1-plan.md`

Este doc preserva as 4 reviews persona (Barney/Marshall/Lily/Robin) que entraram na consolidação. Ted's RFC vive separado pq foi o doc inicial; este compila as críticas/refinamentos que o transformaram em plano shippable.

---

## Barney — Threat Model Review

**Veredito:** Ship com modificações P0 obrigatórias. Math do PPR é defensável; entorno (storage, timing, UX flip, inspector) precisa hardening antes do PR.

### P0 (bloqueante)

1. **Storage unbounded em `lens_edges`** [critical] — sem cap/TTL/LRU vira DOS lento via flood de posts (100k sock puppets). Fix: edges = follows ∪ FoF-d1 ∪ {autores que SPREADei}; TTL 90d em não-follows; cap 50k LRU.
2. **Subscribe filter shape leak** [critical] — se PPR influencia quais autores fetch prioritário, relay infere trust graph parcial via timing. Fix: `sync.ts` subscribe filters NÃO dependem de PPR. PPR é estritamente post-fetch. Conformance test grep.
3. **Lens-flip social engineering** [high] — URL handler `?action=` ou popup phishing → muda preset → atacante hides posts críticos. Fix: confirm dialog obrigatório; URL handler whitelist; audit log local.
4. **Edge weight gaming via mutual count** [high] — sock puppets bagunçam neighborhood. Fix: mutual restrito a vizinhança-de-1 (intersection só entre nodes que VOCÊ segue); cap mutual em 20 antes do log.
5. **Inspector path leak** [high] — "você → @alice → @bob" expõe via screenshot/log/aria. Fix: path nunca persisted; sem logging com npubs; aria-label genérico.

### P1 (fix antes de ship mas não bloqueante)

- **Followee compromise sem time-decay nem cap** — cap M=0.3 máx por intermediary path
- **Ring attacks math** — ring de 5 dá ~0.2% PPR; ring de 50 vira problema → path diversity central (≥2 disjoint paths), não polish
- **Cold start prompt timing** — 10 follows + 7 dias reflete gosto do amigo-onboarder por semanas; copy warning
- **Bury weight assimétrico** OK em Phase 1; flag pra Phase 2 mass-bury features

### P2 (céticas)

- "~50ms recompute" precisa benchmark em low-end real (Moto E classe Snapdragon 4xx)
- K=1000 walks dá variance ±3-5% — inspector path pode flutuar entre runs
- `filter_rules.predicate` JSON é interpreted code path — sandbox/whitelist operators
- Damping α=0.15 vs α=0.3 — 0.3 encurta walks, mais focado em vizinhança
- "7 dias ativo" como mensurado? Spec ou Lily vai chutar

### O que Ted acertou

1. **PPR começa em VOCÊ, walks são out-edge** — defesa Sybil real, math correta
2. **`scoring.ts` intocado, multiplicador só no render** — §22/§24 mantidos, arquitetura limpa
3. **NIP-32 deferred Phase 2** — Bluesky Ozone só vingou porque havia operadores; Drift hoje não tem (validado por Robin, ver reframe abaixo)

---

## Marshall — Schema Review

**Veredito:** OK com modificações. Três tabelas additive, zero impacto em domain pipeline. Precisa: (1) seed determinístico explícito em PPR; (2) cap em walks_cache; (3) classificação clara de DOMAIN vs USER-STATE pro auto-rebuild; (4) LOCK_VIA_TEST adicional protegendo `s_local` write-side; (5) discriminated union em predicate com schema versionado.

### Decisões schema

- **JSON vs colunas em `components`**: vence JSON. Drift faz <100 write/s nessa tabela; query path nunca filtra por componente individual; extensibilidade Phase 2 importa. `v` field versiona pra forward-compat.
- **PK source+target**: mantém. Multi-identity (invariante #15) torna source não-redundante. Overhead 32 KB / 500 follows aceitável.
- **CHECK constraints** em `weight`/`ppr_score`: defesa em camada — bounded por sigmoid já, mas Phase 2 pode mudar fórmula.
- **`updated_at` em ms** (consistent com `Date.now()`). Documentar no header.

### DOMAIN_TABLES classification

- `lens_edges` → DOMAIN (rebuilável de follows + spreads)
- `lens_walks_cache` → DOMAIN (puro cache função pura)
- `lens_filter_rules` → **USER-STATE** (preserva igual `blocked`/`muted`/`identities`)

### 8 conformance tests propostos (LOCK_VIA_TEST)

1. `UPDATE posts SET score` fechado fora de `scoring.ts` + `moderation.ts`
2. `s_local` nunca persisted (grep)
3. PPR Monte Carlo determinism (seed fixo → result bit-exact)
4. Edge influence bounds (property test 1000 inputs → [0,1])
5. Filter predicate schema valid (rejeita `v !== 1` sem throw)
6. `lens_edges` nunca em raw_event nem em kind published
7. Vocabulary lock (JSX strings não usam "Trust"/"score numérico")
8. Subscribe filter independence (`sync.ts` não importa lens tables)

### Migration

`schema_v=11` (current=10). Forward-only. Rollback via hotfix esconde UI. Tabelas ficam no banco (storage barato).

### Worker separation

PPR Monte Carlo em `trust.worker.ts` dedicado, NÃO em `db.worker` — single-handle OPFS, long computation bloqueia INSERTs de `onNostrEvent`. Read-only via channel + write final batch.

### Determinism (manifesto §7)

Lens é view local, §7 não aplica strict. Mas cross-device convergence importa: seed = `hash(source_npub + recompute_epoch)`. Mesmo source + mesma janela → mesmo resultado.

---

## Lily — UX Review

**Veredito:** Ship com mudanças significativas em naming, controle e inspector. Math Ted sólida; vocabulário ("Lente de Confiança", "Off/Suave/Forte", trust score) importa modelo mental de produtos que Drift se posicionou contra.

### Decisões UX

| Item | Ted propôs | Lily decide |
|---|---|---|
| **Naming** | "Lente de Confiança" | **"Sua Lente"** (possessivo, curto, sem carga institucional) |
| **Toggle** | 3 botões discretos Off/Suave/Forte | **Slider 0-100% único** com snap em 0/50/100 |
| **Inspector** | Long-press com path "você → @alice → @bob" | **Chip discreto no canto + tap**, sheet com 2 frases humanas |
| **Cold start** | Prompt genérico | **Banner one-time** reusando pattern `DiscoverNudgeBanner` |
| **Default visibility** | Lens invisível ou badges visible | **Invisível**, inspector sempre disponível, "mostrar efeito" opt-in |

### Bomba semântica achada

ProfileModal já mostra **"Peso de Perfil"** (tier público derivado de SPREAD recebido). Trust Lens schema do Ted/Marshall tem `trust_edges.weight` — colisão semântica garantida.

**Rename obrigatório**:
- `trust_edges` → `lens_edges`
- coluna `weight` → `influence`
- **Nunca expor "trust"/"confiança" como score numérico** na UI

### Copy PT-BR proposto

- Card: **Sua Lente** | "Como sua rede influencia o que aparece primeiro pra você."
- Slider: **"Quanto sua rede pesa no feed?"** com helper dinâmico por faixa
- Inspector copy: "@alice (que você segue) deu drift neste post." + "@bob (autor) é seguido por 3 pessoas que você acompanha."
- Banner: "Sua Lente está pronta. Agora que você acompanha algumas pessoas, o Drift pode usar sua rede pra ajustar a ordem do feed — só pra você, no seu aparelho."

### Vocabulary alignment

"@alice deu drift" (não "curtiu" não "espalhou") — alinha com DRIFT/SINK do design system Drift.

### A11y

- Slider keyboard nav (← → Home End), ARIA valuenow/min/max
- Chip ≥44px hit-area, button real
- Popup `role="dialog"`, focus trap, ESC fecha
- Banner `aria-live="polite"` (não assertive)
- Cor em chip Velatura: contrast ratio 4.5:1 contra `bg-drift-surface` (validar)
- Helper text dinâmico precisa `aria-live="polite"`

### Riscos UX flagados

- Colisão semântica Peso/Lente (resolvido via rename)
- Filter bubble auto-imposta — aceitar, sem nudge paternalista
- Cold start silencioso se user dismissar banner — aceitável (Settings descobrível)
- Inspector overlap com swipe gestures — chip stopPropagation no tap, mas não bloquear pan vertical
- "@alice deu drift" precisa user testing (Robin)

---

## Robin — Research Review

**Veredito:** RFC do Ted em chão sólido. Phase 2 gate ("aguardar NIP-32 labeler market") é mais perto do que ele estimou — Vertex DVM + NIP-85 já são plumbing alternativo.

### NIP-32 ecosystem state — embrionário

Survey de adoção:

| Cliente | NIP-32 parser/emit? | Labelers UI? |
|---|---|---|
| Amethyst (Android) | Sim (parser) | Limitado (só self-report) |
| Coracle | Indireto via Vertex DVM (NIP-90) | Custom feeds engine consome DVM |
| Damus, Snort, Primal, Iris | Não confirmado | Não |
| Nos.social | Tagr Bot usa NIP-56 (não NIP-32) | Não |

**Reframing crítico Phase 2**: ecossistema NIP-32 é mais embrionário que Ted assumiu. Amethyst tem parser (parte fácil), UX subscribing inexistente. Mas:

1. **Vertex Lab DVMs** (NIP-90) — 3 endpoints (verify-reputation, recommend-follows, rank-profiles). Coracle integra. PageRank-based. https://vertexlab.io/docs/endpoints/rank-profiles/
2. **NIP-85 Trusted Assertions** (kind 10040) — providers autorizados pelo user; provider publica assertions addressable. Concorrente real do NIP-32 pra trust.
3. **Bluesky Ozone** (fora-Nostr) — 19 labeler slots + 1 hardcoded. Modelo provou UX em escala.

**Phase 2 reframe**: NÃO esperar NIP-32 labeler market emerge — esse market pode nunca emergir. Phase 2 = integração opcional com Vertex DVM (NIP-90) e/ou NIP-85 trusted assertions. **Viável agora, não condicional.**

### Academic refresh

**Confirmações dos papers do RFC**:
- Haveliwala 2002 (Topic-Sensitive PageRank) — relevante, framing correto
- Fogaras 2005 (Monte Carlo PPR) — caveat: pós-2010 (FORA, ForwardPush) mostra Monte Carlo inefficient pra query top-k, mas pra Drift (batch recompute debounced) continua certo
- Mislove Ostra (NSDI 2008) — insight transferível: trust-mediated rate limiting pra reports/spreads de patterns sybil-like
- Viswanath SybilLimit revisit (SIGCOMM 2010) — sybil ≈ off-the-shelf community detection se atacante conhece honest community substructure; path diversity é único mitigante real

**Papers que Ted perdeu**:
1. **Alvisi et al. SoK (IEEE S&P 2013)** — survey definitivo Sybil defense 2006-2013. Crítico pro Barney: community-structure-aware attacks vencem random-walk defenses; hybrid (PPR + diversity + temporal) sobrevivem. https://www.cs.cornell.edu/lorenzo/papers/Alvisi13SoK.pdf
2. **Mohaisen et al. (IMC 2010)** — measuring mixing time. Argumenta fast-mixing assumption de SybilLimit é falsa em graphs reais.
3. **Epasto et al. (2013)** — communities + random walks pra Sybil defense, refinement de SybilRank.

**Implicações duras pra Drift**:
- Damping α=0.15 + L do RFC: válido pra small-world; mas mixing analysis pode informar β/γ tuning
- K=1000 walks: Bahmani et al. (2010) — K=O(1/ε² log n) → 500-follow graph dá ε≈0.07 com 95% conf
- **Path diversity check é central, não Phase 2 polish** — defesa Sybil mora aí

### Real-world Nostr graph data

Honest: NÃO encontrei measurements acadêmicos de diameter/clustering/median follows. Yu et al. 2024 (https://arxiv.org/abs/2402.05709) foca relay availability, não grafo de follows.

**Números confirmados**:
- ~21k users ativos / 3675 DAU em Out/2025 (fraco source)
- ~993k profiles com contact lists (2024)
- iris.to expõe Nostr Social Graph Stats — vale Marshall query direto

**Implicação pra L=4**: por analogy Twitter (diameter ~4.12, median follows ~70), Nostr provavelmente mais esparso. L=4 cobre bulk mas cold start é mais severo. Recommend: instrumentar **graph-cobertura metric** local (X% authors em PPR > threshold; se <30% após 30 dias, fallback).

### §27 ↔ Trust Lens loop — GAP IDENTIFICADO

RFC menciona §27 mas NÃO especifica como `filter_rules.predicate` combina tags content-warning + trust score juntos. **Marshall handoff antes Phase 1 ship**: definir DSL com operators `tag_present`, `tag_value_in`, `author_ppr_lt/gt`, `and/or/not`. Sem isso, classifier loop (autor classifica → leitor filtra) fica decoupled do lens.

### Other personal-algorithm implementations

| Produto | Mecanismo | Lição Drift |
|---|---|---|
| Bluesky custom feeds | Feed generators server-side, marketplace | Hosted = privacy leak; Drift fez certo em local-only |
| Bluesky Ozone | 19 labeler slots + 1 hardcoded; stackable | Slot limit é UX wisdom; Phase 2 cap N=10-20 |
| Scuttlebutt (SSB) | Hop count -1/-2/-3 replication scope | Confirma RFC depth=3; FoF cobre maioria do signal |
| Reddit RES | Client-side custom filtering, user-tags | Modelo trust lens privada sem cloud viável |
| Twitter For You vs Following | Toggle binário | Confirma RFC Off-by-default alinhado §24 |
| Vertex DVM | Servidor computa PageRank, devolve assertions | Phase 2 opt-in mantém local-first como default §17/§25 |
| NIP-85 Trusted Assertions | User authoriza providers em kind 10040 | Plumbing nativo Nostr cleaner que NIP-32 |

### Naming

Search PT-BR não devolveu pattern claro de "filtro pessoal" em produto BR. "Confiança" carrega peso emocional alto. **Reluctantly OK com "Lente"** se onboarding explica é cálculo local, não juízo moral. Lily refinou pra "Sua Lente" — endossado.

### Honest caveats

- Não consegui crawl exaustivo NIP-32 em Damus/Snort/Primal release notes — search inconclusivo
- Não tenho números empíricos Nostr graph; graph-api.iris.to expõe data — vale query direto
- WebFetch arxiv full-text negado — análise Yu 2024 ficou em abstract
- Brazilian apps naming convention research não produziu pattern útil

---

## Síntese cross-persona

Consensus 5/5 sobre **Ship Phase 1 viável** com escopo refinado: **~2 semanas** (não 1 do Ted original).

**Mudanças aceitas no RFC original Ted após reviews**:

1. Schema rename `trust_edges → lens_edges`, `weight → influence` (Lily)
2. Edge weight: mutual restrito a vizinhança-de-1, cap 20 (Barney P0.4)
3. Storage cap: edges = follows ∪ FoF-d1 ∪ {autores SPREADei}; TTL 90d; LRU 50k (Barney P0.1)
4. Subscribe filters em `sync.ts` NÃO dependem de PPR (Barney P0.2)
5. Lens-flip social eng: confirm dialog + URL whitelist + audit log (Barney P0.3)
6. Inspector path nunca persistido + aria-label genérico (Barney P0.5)
7. Path diversity central (Alvisi/Viswanath, Robin) — não Phase 2 polish
8. PPR seed determinístico `hash(source + recompute_epoch)` (Marshall)
9. Worker separado `trust.worker.ts` pra não bloquear `db.worker` (Marshall)
10. Predicate DSL com `and/or/not + tag_present + author_ppr_lt` (Robin §27 fix)
11. UX: "Sua Lente", slider 0-100%, chip + sheet inspector, banner one-time (Lily)
12. Phase 2 reframe: Vertex/NIP-85 (não NIP-32) — viável agora (Robin)
13. L=4 → **L=8** (user feedback subsequente: distance-decay contínuo)
14. β/γ não-linear: `β = 0.8 × strength`, `γ = 0.4 × strength²` (Lily)
15. 8 conformance tests LOCK_VIA_TEST (Marshall)

Plano consolidado: `Docs/plans/trust-lens-phase1-plan.md`
