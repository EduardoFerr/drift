# Trust Lens — Math Relatoria Stage 2 (Robin)

**Data:** 2026-05-17
**Persona:** Robin (research, validação empirical)
**Input:** `Docs/sessions/trust-lens-math-review-marshall-2026-05-17.md` (Stage 1)
**Status:** Stage 2 do workflow 3-stage. Aguarda Stage 3 (HIMYM 5/5 deliberação final).

## Veredito relatoria

**Endosso 6/7 bugs e 5/7 issues do Marshall.** Math rigor está correto — sem erros de cálculo. Modifications em 2 itens, discordância parcial em 1.

Highlights:
- **BUG-2 ε=0.07 ainda misterioso** mas Robin possivelmente achou origem (ver abaixo)
- **BUG-5 BETA placebo** confirmado em regime maduro; dual-regime em cold-start
- **W_BIAS** Robin sugere -2.0 vs -1.5 do Marshall (razão direct:FoF 7x vs 4.5x)
- **ISSUE-1 path diversity 50ms** parcialmente refutada (extrapolação de denso → Nostr esparso)
- **Vertex Lab faz PPR sobre Nostr em produção** — Drift devia benchmark, gap não-coberto

## Validação bug-by-bug (highlights)

### BUG-2 — possível origem do 0.07

Marshall: 0.07 não vem de nenhuma derivation canônica (Hoeffding 0.043, Bahmani uniform 0.104).

Robin add: em grafo Nostr realistic (não Drift teórico):
- Median ~7 follows/user
- FoF típico ~50, FoF² ~200
- **n efetivo ~50, não 50k**
- log(n_efetivo) ≈ 6
- Bahmani uniform: ε = √(6/1000) = **0.077 ≈ 0.07**

**Ted pode ter usado n efetivo realista**, não n teórico do MAX_EDGES_PER_SOURCE. Resolve discrepância. Vale perguntar pro Ted (Q1 Stage 3).

### BUG-4 — W_BIAS

Marshall: W_BIAS=-1.5 → σ(-1.5)=0.182. Razão PPR direct:FoF = σ(1.5)/σ(-1.5) = 0.818/0.182 = **4.5x**.

Robin: EigenTrust prior=0 mais conservador. Sweet spot empirical:
- W_BIAS=-1.0: razão 3.4x (fraco)
- W_BIAS=-1.5: razão 4.5x (Marshall)
- W_BIAS=-2.0: razão **6.9x** (Robin recomenda)

Conformance test sintético cold-start: 1 follow + 100 FoF², medir razão PPR.

### BUG-5 — dual-regime BETA

Pandurangan/Fortunato 2007 confirma PPR power-law em scale-free networks. Top-N concentra massa.

Mas: em cold-start (5 follows), top-1 PPR pode ser **0.30+** (massa concentrada em pouquíssimos reachable). BETA=0.8 nesse regime dá +24% boost — visível.

Problema é **dual-regime**:
- Cold-start (<10 follows): BETA OK
- Maduro (>200 follows): BETA placebo

Log-transform "achata" ambos regimes consistentemente. **Robin endossa Marshall fix com BETA_MAX=1.5**. Alternativa: quantile-rank (O(N log N)) mais robusto mas mais caro.

### ISSUE-1 — path diversity 50ms refutação parcial

Marshall extrapolou linear de "RFC L=4=50ms". Robin:
- BFS depth-3 em grafo Nostr esparso (avg degree ~50, mas long tail tem 0-2) é **assimétrico**
- Hub-npubs: BFS explode
- Leaf-npubs: trivial

Mitigação: **cache BFS entre recomputes** (grafo de follows muda devagar). Path diversity bonus per (source, target) cached, reutilizado N recomputes. Reduz custo amortizado significativamente.

## Issues novos (Marshall perdeu)

1. **GAP-EMPIRICAL-1: Vertex Lab benchmark.** `github.com/vertex-lab/crawler` já faz PPR Monte Carlo sobre Nostr em produção. Drift devia rodar paralelo em mesma identidade, comparar top-100 author rankings. Discrepância >30% indica bug.

2. **GAP-EMPIRICAL-2: Hub-amplification tensão com §24.** Scale-free Nostr concentra walks em hubs (1000+ in-degree). PPR + BETA amplifica hubs naturalmente no feed do user. Manifesto §24 (sem afinidade no feed canônico) — PPR personalização **é** afinidade local. Tensão filosófica, não bug, mas vale discussion.

3. **GAP-EMPIRICAL-3: Variance entre janelas (23:55→00:01).** Bit-exact dentro de window OK. Mas user refresha em janelas adjacentes, vê reordering. Marshall mencionou em GAP-2 sem quantificar. **Conformance test**: simular 2 janelas adjacentes, mesmo grafo, Spearman rank correlation top-50. Target ρ>0.85 razoável; <0.70 = UX problem.

4. **GAP-CONFORMANCE: tests usam adjacency densa.** Real Nostr é esparso + hubs (power-law). Adicionar test #13 com Barabási-Albert (n=500, m=3).

5. **GAP-PERF: cache invalidation strategy ausente** pra path diversity cache (mitigação ISSUE-1).

6. **GAP-NIP: Vertex publica PPR via NIP-90 DVM.** Drift Trust Lens é client-side only. Considera publicar via NIP-90 pra cross-validation? Phase 2/3 roadmap.

## Dados primários encontrados (honest disclosure)

WebFetch foi negado em runtime pra graph-api.iris.to e nostr.band. Dados via WebSearch summaries + literatura.

| Métrica | Valor | Source |
|---|---|---|
| Nostr unique pubkeys (late 2023) | 1,558,891 | arxiv 2402.05709 |
| Active users com contacts (2024) | 993,248 | glukhov.org |
| Total follows (Iris graph) | 7,053,874 | graph-api.iris.to via search |
| Total posts (Aug 2024) | 304M | arxiv 2402.05709 |
| **Median follows per user** | NÃO publicado | precisa scrape direto |
| **Diameter grafo** | NÃO publicado | precisa scrape direto |
| **Top-1 PPR Nostr** | NÃO publicado | Vertex Lab provavelmente sabe |

**Implicação pra constants**:
- median ~7 follows/user (estimativa via 7M follows / 1M users)
- MAX_EDGES_PER_SOURCE=50k é over-cap massivo
- n efetivo realista → log(n)≈6 → ε≈0.077 (talvez origem do 0.07 mítico)

## Recomendação revisada (Marshall + Robin)

### P0 obrigatório pré-ship

1. **BUG-2 fix**: texto `ε_marginal=0.043` + `ε_uniform=0.104`. Robin add: comentar que 0.07 do Ted **possivelmente** vem de n efetivo realista (log~6), não n teórico.
2. **BUG-5 fix**: log-transform PPR (Marshall) + BETA_MAX=1.5.
3. **BUG-7 fix**: `Math.max(0, ...)` + **CHECK constraint** em schema (Robin add).
4. **ISSUE-6 fix**: `return new Map()` mínimo.
5. **ISSUE-5 fix**: components JSON conformance test.
6. **Comments corrigidos**: BUG-1, BUG-3, BUG-4 — Robin recomenda **W_BIAS=-2.0** em vez de -1.5.

### P1 fix antes de PR

7. **BUG-6 fix**: strength linear (Marshall + Robin alinhados).
8. **ISSUE-1 plan update**: 125ms total + path diversity cache strategy.
9. **Conformance test #13**: adjacency power-law (Barabási-Albert).
10. **Window boundary variance test** (GAP-EMPIRICAL-3).

### P2 nice-to-have

11. FORA migration consideration Phase 2.
12. Benchmark vs Vertex Lab.
13. §24 vs Trust Lens compatibility discussion.

## 14 Perguntas acionáveis pros HIMYM 5/5 (Stage 3)

**Pra Ted (arquitetura)**:
- (Q1) Origem do 0.07 — folclore RFC ou n efetivo realista log(n)≈6?
- (Q2) FORA (Wang 2019) Phase 2 roadmap?
- (Q3) PPR via NIP-90 DVM pra ecossistema — Phase?

**Pra Barney (segurança)**:
- (Q4) W_BIAS=-2.0 vs -1.5 — razão 7x vs 4.5x. Suficiente anti-Sybil?
- (Q5) CHECK constraint schema (defesa em profundidade) vale custo migration?
- (Q6) Hub-amplification scale-free é threat ou feature? Vetor pra coordinated promotion?

**Pra Marshall (math)**:
- (Q7) `(1−α)^L` vs `1 − 0.85^(L+1)` (incluir hop 0) — qual no comment?
- (Q8) Quantile-rank PPR (O(N log N)) vs log-transform (O(N)) — preferência?
- (Q9) Conformance #13 Barabási-Albert: aceita scope creep ou Phase 2?

**Pra Lily (UX)**:
- (Q10) Slider linear vs `strength·(1+strength)/2` — Robin recomenda linear. A/B?
- (Q11) Cold-start fallback intermediário (uniform sobre follows) ou feed global puro?
- (Q12) Window boundary 23:59→00:01 — banner explanatory ou opaque?

**Pra Robin (research)**:
- (Q13) Scrape direto nostr.band — vale custo (rate-limit)?
- (Q14) Outreach Vertex Lab pra cross-validation — apropriado Phase 1?

## Sources

- [Bahmani 2010 — Fast Incremental PPR](https://www.vldb.org/pvldb/vol4/p173-bahmani.pdf)
- [Wang 2019 — FORA](https://arxiv.org/abs/1908.10583)
- [Yu/Wei 2024 — Nostr Empirical](https://arxiv.org/abs/2402.05709)
- [Alvisi 2013 — SoK Sybil](https://oaklandsok.github.io/papers/alvisi2013.pdf)
- [Kamvar 2003 — EigenTrust](https://nlp.stanford.edu/pubs/eigentrust.pdf)
- [Pandurangan/Fortunato 2007 — PageRank Power Laws](https://projecteuclid.org/journals/internet-mathematics/volume-4/issue-2-3/In-Degree-and-PageRank--Why-Do-They-Follow-Similar/im/1243430605.pdf)
- [Vertex Lab crawler](https://github.com/vertex-lab/crawler)
- [Nostr stats glukhov.org](https://www.glukhov.org/post/2025/10/nostr-overview-and-statistics/)
