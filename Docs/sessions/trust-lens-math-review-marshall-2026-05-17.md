# Trust Lens — math review Stage 1 (Marshall)

**Data:** 2026-05-17
**Persona:** Marshall (rigor matemático, schema, conformance)
**Trigger:** Stage 1 do workflow 3-stage solicitado pelo user — math review pós-scaffolding commit `bfa1647`
**Status:** 7 bugs + 7 issues escondidos identificados. Aguarda Stage 2 (Robin empirical/relatoria) e Stage 3 (HIMYM 5/5 deliberação final).

## Veredict math

**Math passa com correções P0 obrigatórias.** Nenhum erro estrutural — todos corrigíveis ajustando constantes ou texto. ~3 horas de patches em `constants.ts` + comment blocks + 1 file novo (`rng.ts`) + 12 conformance tests adicionais.

## Bugs encontrados (ship-block: 1, 2, 4, 5)

### BUG-1 (CRÍTICO conformance) — "Captura ~62% da massa" duplamente errada

`constants.ts:13` + `plan.md:91` + `Ted v2 doc:15`:
- "L=6 captura ~62% da massa natural com α=0.15"
- "P(reach hop 6) = 0.85^6 = 0.377"

**Math correta**: ambos descrevem `(1-α)^L = 0.3771`. Coincidência: P(walk não terminou via damping antes do hop L) = massa truncada de PPR. Texto Ted sugere que damping "compensa" os 37.7% perdidos — **errado, esses 37.7% JÁ incorporam o damping**. Reescrever comment:

```typescript
//   - L=6: cap em walk length. Com α=0.15, massa truncada = (1−α)^L = 0.377
//          (≈38% perdido pela cauda). Restante 62.3% é massa retida nos
//          primeiros L hops via geometric damping. E[K_realized] ≈ 5.67.
```

### BUG-2 (CRÍTICO, número publicado errado) — "K=1000 → ε≈0.07"

`constants.ts:14`: "ε≈0.07 com 95% conf (Bahmani 2010)".

Math correta:
- **Hoeffding marginal** (per-target): K=1000 → ε = √(ln(40)/2000) = **0.043** ✓ (melhor que 0.07)
- **Bahmani uniform** (simultâneo sobre log n targets): K=1000 → ε = √(log(50k)/1000) = **0.104** ✗ (pior que 0.07)

Nenhum dá 0.07. Trocar pra:

```typescript
//   - K=1000: ε_marginal ≤ 0.043 (Hoeffding 95%, per-target).
//             ε_uniform ≤ 0.104 (Bahmani 2010, simultâneo em
//             O(log n)=11 top targets, n=50k). Banda aceitável
//             pra ordering local; revisar K em Phase 2 se uniform
//             ε importa pra UX.
```

PPR scores em K=1000 são confiáveis pros **top ~10-20 targets** (que dominam reordering). Long tail tem variance maior do que anunciado.

### BUG-3 (numérico) — "E[walk length] = 1/α = 6.67"

`constants.ts:12` + `Ted v2 doc:13`.

Math correta: o algoritmo do plano (damping check ANTES do hop) define K ∈ {0, 1, ..., L} com `P(K=k) = α·(1−α)^k` (geometric 0-indexed).
- E[K] **untruncated** = (1−α)/α = 0.85/0.15 = **5.67 hops**
- Não 6.67 (que é geometric 1-indexed convention)
- Com truncação em L=6: E[K_truncated] ≈ **5.79**

L=6 = E[K]+1 (1 hop de headroom), não floor(1/α). Trocar comment:

```typescript
//   - L=6: cobre E[K_realized] = (1−α)/α = 5.67 + 1 hop de headroom.
```

### BUG-4 (lógica anti-Sybil) — Stranger σ(0)=0.5 propaga em PPR sem sinal real

`constants.ts:50-56` + `plan.md:79-85`.

Edge "FoF sem dados reais" → input sigmoid = 0 → influence = 0.5. Direct follow only → σ(1.5) = 0.818. Razão pull entre eles: **só 1.64x**. PPR walk vai distribuir peso quase-uniforme entre follows legítimos e FoFs vazios.

**Fix**: adicionar bias negativo base:

```typescript
W_BIAS: -1.5,  // estranger → σ(-1.5) = 0.182 (peso modesto, ainda contribui)
```

Range semântico fica:
- FoF vazio: 0.18 (modesto)
- Follow neutro: 0.50
- Follow forte (5 mutuais): 0.86
- Bury 1x: 0.07

**Impacto sem fix**: cold start com 1 follow + 100 FoF vazios → PPR converge quase-uniforme. Anti-Sybil enfraquecido.

### BUG-5 (CRÍTICO numérico) — BETA_MAX=0.8 é placebo

`constants.ts:72`.

PPR scores em prática (sum=1.0 sobre todos targets):
- Top-1: 0.05-0.15
- Top-10: 0.01-0.05
- Median: <0.01

Multiplier com strength=1, BETA_MAX=0.8:
- Top author (ppr=0.10): 1.0 + 0.08 = **1.08** (+8% boost — quase imperceptível)
- Median (ppr=0.01): 1.008 (invisível)

Compare GAMMA com mutual_spread_post=1:
- gamma_term = 0.4 → **maior que BETA mesmo em alto PPR**

**GAMMA domina BETA na prática**. Slider "Forte" só "sente forte" com mutual_spread, não PPR. Signal PPR desperdiçado.

**Fix sugerido (opção B Marshall)**:

```typescript
// Log-transform PPR pra escala perceptual (PPR é power-law)
ppr_normalized = log(1 + 100·ppr) / log(101)
// → top author ppr=0.10 → 0.49
// → median ppr=0.01 → 0.13
// com BETA_MAX = 1.5 → top author boost = 0.74 (visível)
```

Sem log-transform, BETA é placebo.

### BUG-6 (numérico) — strength² deixa "Moderado" inerte

`constants.ts:73`: `GAMMA_MAX · strength²`.

- strength=0.5 (slider "Moderado") → γ_efetivo = 0.4 × 0.25 = **0.1**
- strength=1.0 ("Forte") → 0.4

Slider em 50% entrega 25% do γ máximo. **Conflito com expectativa visual**.

**Fix**: linear (`strength`) ou mid-quadratic (`strength·(1+strength)/2` que dá 0.375 em 0.5 e 1.0 em 1.0).

### BUG-7 (numerical stability) — log(1 + my_spreads) sem guard

Edge case `my_spreads < 0` (rowid migration bug, validation gap) → log(1+negativo) → NaN/-∞ → sigmoid(NaN) → influência inválida.

**Fix em `edges.ts:upsertEdge`**:
```typescript
const my_spreads = Math.max(0, Math.floor(rawCount))
const my_buries = Math.max(0, Math.floor(rawCount))
```

## Parameters tabela completa

| Param | Atual | Veredict |
|---|---|---|
| α | 0.15 | OK — P(hop 3)=0.61, entrega FoFoF |
| L | 6 | OK com texto corrigido (BUG-1, BUG-3) |
| K | 1000 | OK se aceitar ε_uniform=0.10; **K=2200** se quer 0.07 |
| W_FOLLOW | 1.5 | OK |
| W_MUTUAL | 1.0 | OK com cap |
| W_MY_SPREAD | 1.2 | OK |
| W_MY_BURY | 1.5 | **Considerar 1.8-2.0** (bury é ação mais forte que follow) |
| MUTUAL_CAP | 20 | OK anti-Sybil |
| **W_BIAS** | **ausente** | **ADICIONAR -1.5** (BUG-4) |
| ALPHA_VIEW | 1.0 | OK |
| **BETA_MAX** | **0.8** | **CRÍTICO: subir pra 5.0+ ou log-transform PPR** (BUG-5) |
| GAMMA_MAX | 0.4 | OK se mantiver BETA reescalonado |
| strength² | quadratic | **Mudar pra linear** (BUG-6) |
| S_LOCAL_MAX/MIN | 3.0/0.1 | OK |
| MAX_EDGES_PER_SOURCE | 50k | OK (~13MB peak) |
| MAX_WALKS_PER_SOURCE | 5k | OK |
| EVENTS_THRESHOLD | 50 | OK |
| DEBOUNCE_MS | 200 | OK |
| diversity bonus | 0.7+0.3·b | OK |
| diversity depth | ≤3 | OK |

## Determinism gaps

**GAP-1**: Hash function não especificado. Sugestão concreta:

```typescript
// src/lib/trust/rng.ts
function hashStringSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createPprRng(sourceNpub: string, nowMs: number): () => number {
  const window = Math.floor(nowMs / (24 * 3600_000))
  const seed = hashStringSeed(`${sourceNpub}|${window}`)
  return mulberry32(seed)
}
```

Conformance test #3 valida bit-exact 10 runs.

**GAP-2** Window boundary 23:59 vs 00:01: aceitável, documentar UI.

## Issues escondidos críticos

### ISSUE-6 (CRÍTICO) — Cold start NaN

Identidade nova com 0 follows:
- PPR walks param em step 1 (sem vizinhos)
- totalVisits = 0
- ppr_score = 0/0 → **NaN** propaga pra multiplier → feed quebra silenciosamente

**Fix obrigatório em `ppr.ts`**:
```typescript
const totalVisits = sum(visits)
if (totalVisits === 0) return new Map()  // empty PPR, no scores
```

### ISSUE-1 — Path diversity dobra recompute

BFS depth-3 per target × 5k targets ≈ 50ms. Total recompute = PPR 75ms + diversity 50ms = **125ms** (plan dizia 100ms). Atualizar plan §1.8.

### ISSUE-3 — sample_neighbor com weights=0 trava walk

Implementação inocente sem fallback. Adicionar: se total < ε, restart (jump to source).

### ISSUE-4 — Cumulative censorship math operacional ausente

Plan §2.9 diz "X% escondido >10%" sem definir como calcular. Proposta:
```
hidden_pct = count(posts WHERE rule.action='hide' OR s_local < 0.5)
           / count(posts in feed window)
```
Indicar definição na UI.

### ISSUE-5 — components JSON sem CHECK enforcement

`schema.sql:343`: `components TEXT NOT NULL` aceita JSON malformado. Conformance test validar 100% das rows produzidas por upsertEdge parseiam pra `LensEdgeComponentsV1`.

### ISSUE-7 — walk[1:] em walk de 1 elemento

15% dos walks param no step 1 via damping. K_efetivo ~ 850. ε_real é pior do que K=1000 sugere. Conformance test #4 deve usar K_efetivo.

## Conformance tests adicionais (12 novos)

Em `tests/trust-lens-math.test.ts` (file novo):

1. influence ∈ [0,1] property test (1000 inputs aleatórios)
2. influence monotônica em follow
3. influence monotônica decrescente em my_bury
4. seed determinismo: 10 runs bit-exact
5. ppr_score sum ≤ 1.0 + tolerance ε
6. PPR estável em adjacency vazia (cold start) → empty Map, no NaN
7. PPR não overflow K=1000 L=6 alta densidade
8. NaN guard: upsertEdge rejeita components inválidos
9. view multiplier nunca produz s_local < S_LOCAL_MIN
10. Strength=0 → multiplier === 1.0 bit-exact
11. seed boundary cross-device same window → bit-exact
12. diversity_bonus ∈ [0.7, 1.0]

## Handoff Stage 2 Marshall sugere

**Robin (research/empirical)** — porque:
1. BUG-2 (ε precision) exige Robin scrape grafo Nostr real pra ground-truth n (50k edges você cita — Robin pode validar via graph-api.iris.to)
2. BUG-5 (BETA placebo) é falsificável: Robin pode rodar PPR sintético em adjacency real, medir distribuição empírica top-N
3. ISSUE-1 (path diversity 50ms) Robin pode validar via simulação

**Não Barney** stage 2 — BUGs 1-7 são math/numerical, não threat. Volta pra Barney depois de Robin trazer dados empíricos.

**Não Lily** — UX não é afetado por correções matemáticas. Só revisitar se BETA subir e mudar sensação do slider.

**Não Ted** — Ted v2 lock foi em cima de 0.07 errado. Pode querer re-deliberate, mas só após dados empíricos confirmarem.
