# Trust Lens — Math Stage 3 HIMYM 5/5 Final Deliberation

**Data:** 2026-05-17
**Status:** ✅ Workflow 3-stage completo. Math review com correções P0 mapeadas, dissents resolvidos. Implementação desbloqueada.

## Veredito

**11/14 firme consensus · 2/14 dissent resolvido por escolha conservadora · 1/14 defer Phase 2.** Sem ship-block insolúvel.

## Resoluções (14 perguntas)

### Ted (arquitetura)
- **Q1 origem 0.07**: folclore não-citável. Trocar pra `ε_marginal=0.043` + `ε_uniform=0.104` (Hoeffding + Bahmani explícito).
- **Q2 FORA Wang 2019**: Phase 2 roadmap. Não drop-in (precisa indices/forward push).
- **Q3 NIP-90 DVM**: consume-only Phase 3 opt-in; **NUNCA publish** (§17 + §22 viola).

### Barney (segurança)
- **Q4 W_BIAS**: **-2.0** (Robin), razão 7x direct:FoF. Lado conservador é erro recuperável; liberal é unrecoverable Sybil promotion.
- **Q5 CHECK constraint**: via conformance test parse (`LensEdgeComponentsV1`), não SQL CHECK (sqlite-wasm + json_extract = perf hit). Migration v12 não justificada Phase 1.
- **Q6 hub-amplification**: threat manageable. Path diversity é defesa real. Telemetria mede `top1_ppr_concentration_p95`; se >0.30, adiciona BETA_TARGET_CAP Phase 2.

### Marshall (math)
- **Q7 fórmula massa**: `1 − (1−α)^(L+1) = 0.6229` retida. Robin tinha razão na convenção. `E[K_realized] ≈ 5.79` (não 6.67).
- **Q8 normalização**: log-transform `log(1 + 100·ppr) / log(101)`, Phase 1. Quantile-rank Phase 2 se regime skew >3x.
- **Q9 Conformance #13 Barabási-Albert**: scope creep Phase 1 aceito (~30 LOC generator + 5 assertion).

### Lily (UX)
- **Q10 slider**: **linear**, sem A/B. Norman heurística. Revisita se Phase 1.5 telemetria mostrar >40% para em Moderado por "não sentir diferença".
- **Q11 cold-start**: `return new Map()` (feed global puro). Uniform sobre follows confunde mental model. Chip "Lente reordenou" simplesmente não aparece em cold-start.
- **Q12 window boundary**: opaque, sem banner. Só reabre se Spearman ρ <0.70 entre janelas adjacentes — proposta seria seed weekly, não banner.

### Robin (research)
- **Q13 scrape nostr.band**: defer Phase 1.5. Telemetria local cobre privacy-preserving.
- **Q14 outreach Vertex Lab**: Phase 2 (4-6 semanas pós-ship).

## Dissents resolvidos

**Conflito 1 — Q4 W_BIAS magnitude**: Marshall -1.5 vs Robin/Barney -2.0. **Resolvido: -2.0** + conformance test sintético cold-start hostile (1 follow + 100 FoF² → razão > 5x obrigatório).

**Conflito 2 — Q8 normalização**: Marshall log vs Robin quantile. **Resolvido: log Phase 1** + telemetria + Phase 2 promove se necessário.

**Tensão filosófica não-resolvida (registrada)**: §24 vs Trust Lens. PPR personalização **é** afinidade local. §24 já tem carve-out implícito (block/mute). Plan §1.6.5 deve documentar explícito + CLAUDE.md invariante #11 nota.

## Plano de ação P0 (ship-block)

1. `constants.ts:11-14` reescrever comment (BUG-1 fórmula, BUG-2 ε, BUG-3 E[K])
2. `constants.ts:50-56` adicionar `W_BIAS: -2.0` em EDGE_WEIGHT
3. `constants.ts:72` `BETA_MAX: 0.8` → `1.5`
4. `constants.ts:73` `strength²` → `strength` linear
5. `ppr.ts` (novo PR-3): log-transform `log(1+100·ppr)/log(101)`
6. `ppr.ts` cold-start guard: `if (totalVisits===0) return new Map()`
7. `ppr.ts` sample_neighbor weights=0 guard: restart pra source
8. `edges.ts` (novo PR-2): NaN guard `Math.max(0, Math.floor(rawCount))`
9. `rng.ts` (novo PR-2): `hashStringSeed` + `mulberry32` + `createPprRng`
10. Plan §1.2: compute target 100ms → 125ms
11. Plan §1.6.5: carve-out §24 explícito
12. CLAUDE.md invariante #11 adendo Trust Lens

## P1 (antes de merge)

13. Conformance #22: adjacency Barabási-Albert n=500, m=3
14. Conformance #23: cold-start hostile razão > 5x
15. Conformance #24: Spearman ρ top-50 entre janelas adjacentes ≥0.85
16. Path diversity cache strategy (invalidação on follow change OR 24h)

## P2 (Phase 2/3 roadmap)

| Item | Phase | Trigger pra promover |
|---|---|---|
| FORA migration | 2 | ε_uniform=0.104 hurting top-N stability |
| Vertex Lab benchmark | 2 | 4-6 semanas pós-ship |
| Quantile-rank normalization | 2 | regime skew >3x cold/maduro |
| NIP-90 DVM consume-only | 3 | demand users com graph grande |
| Scrape nostr.band | 1.5 | telemetria diverge >2x de literatura |
| BETA_TARGET_CAP explicit | 2 | top1_ppr_concentration_p95 > 0.30 |
| Banner window boundary | 2 | Spearman ρ <0.70 (conformance #24 falha) |

## Conformance tests final list (24 total)

Originais 9 (já it.todo): UPDATE posts SET score (#1), s_local nunca persisted (#2), PPR determinism (#3), edge bounds (#4), predicate v=1 (#5), lens_edges off Nostr (#6), vocabulary lock (#7), sync.ts independence (#8), PPR locality (#9).

12 novos Marshall (math invariants) — em `tests/trust-lens-math.test.ts`: bounds property, monotonia follow, monotonia bury, seed determinismo, ppr_sum tolerance, cold-start no NaN, no overflow K=1000 L=6, NaN guard upsertEdge, multiplier ≥ S_LOCAL_MIN, strength=0 bit-exact, seed boundary, diversity_bonus ∈ [0.7, 1.0].

3 novos Stage 3: Barabási-Albert (#22), cold-start hostile razão > 5x (#23), Spearman ρ entre janelas (#24).

## Ordem de PRs sugerida

1. **PR-1** (constants + comments + plan + CLAUDE.md) — zero código novo, review fácil
2. **PR-2** (rng + edges pure functions) — tests 10-13, 17, 20
3. **PR-3** (ppr.ts core + log-transform + cold-start) — tests 14-16, 22-23
4. **PR-4** (predicate + worker + feed integration) — tests 18-19, 21, 24
5. **PR-5** (UI Lily — Sua Lente card + Inspector + banner) — tests 7-9
6. **PR-6** Phase 1.5 telemetria — roadmap items P2 tracking

Cada PR isolado, conformance tests incrementais. PR-1 a PR-5 = Phase 1; PR-6 = Phase 1.5.
