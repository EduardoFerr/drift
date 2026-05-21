# Drift — Algoritmos (explicado com exemplos e simulações)

> Documento didático cobrindo todas as funções matemáticas centrais do
> Drift. Cada algoritmo tem: **conceito → fórmula → exemplo passo-a-passo
> → simulação multi-cenário → edge cases → manifesto reference.**
>
> Determinismo é princípio do manifesto (§7) — todas as funções aqui
> são **puras**, sem `Date.now()` implícito (caller passa `now`). Mesmo
> input → mesma saída → todos os clientes Drift do mundo convergem.
>
> Fontes canônicas no código (source-of-truth):
> - `src/lib/scoring.ts` — score canônico de post
> - `src/lib/weight.ts` — peso de identidade
> - `src/lib/moderation.ts` — threshold dinâmico
> - `src/lib/trust/{ppr,edges,constants}.ts` — Trust Lens
>
> Quando este doc divergir do código, **o código vence**. Atualizar
> este doc após mudar fórmulas (LOCK_VIA_TEST trava conformance, mas
> a explicação aqui é manual).

---

## Índice

1. [Score canônico de post](#1-score-canônico-de-post)
2. [Peso de identidade (weight)](#2-peso-de-identidade-weight)
3. [Threshold dinâmico de moderação](#3-threshold-dinâmico-de-moderação)
4. [Trust Lens — Edge influence](#4-trust-lens--edge-influence)
5. [Trust Lens — Personalized PageRank (PPR)](#5-trust-lens--personalized-pagerank-ppr)
6. [Trust Lens — View multiplier (s_local)](#6-trust-lens--view-multiplier-s_local)
7. [Trust Lens — Temporal decay (GAP-1, opt-in)](#7-trust-lens--temporal-decay-gap-1-opt-in)
8. [Cenários integrados (fim-a-fim)](#8-cenários-integrados-fim-a-fim)

---

## 1. Score canônico de post

**Onde:** `src/lib/scoring.ts:calculateScore`
**Manifesto:** §7 (determinismo), §22 (score não-subjetivo), §24 (sem
afinidade no feed canônico)

### Conceito

O score é o número que ordena o feed canônico. **Igual pra todos os
clientes Drift no mundo** — sem personalização. Combina engajamento
ponderado (peso dos spreaders/buriers) com decaimento temporal (posts
ficam relevantes por horas, não minutos).

### Fórmula

```
ageHours      = max(0, (now - createdAt) / 3600)
netEngagement = spreadWeight − buryWeight × 0.3
score         = netEngagement / (ageHours + 2)^1.5
```

Onde:
- `spreadWeight` = SOMA dos `weight` dos spreaders cuja ação líquida é
  `spread` (não count — peso!)
- `buryWeight`   = SOMA dos `weight` dos buriers cuja ação líquida é
  `bury`
- Multiplicador `0.3` em bury: enterro é julgamento estético, não
  punição. Reduz menos do que espalhar puxa.
- `+2` em ageHours: evita divisão explosiva nos primeiros minutos
- Expoente `1.5`: decay suave (vale por horas, não minutos)

### Exemplo passo-a-passo

**Cenário:** post recém-criado (1h de idade), 1 spreader peso 50, 0 buries.

```
spreadWeight   = 50
buryWeight     = 0
ageHours       = 1
netEngagement  = 50 − 0 × 0.3 = 50
score          = 50 / (1 + 2)^1.5
               = 50 / 5.196
               = 9.62
```

### Simulação multi-cenário

| Idade | spreadWeight | buryWeight | netEngagement | score | Comentário |
|---:|---:|---:|---:|---:|---|
| 0h  |  50 |   0 |  50.0 | **17.68** | Recém-saído, 1 spreader peso 50 |
| 1h  |  50 |   0 |  50.0 |  9.62 | Mesma identidade, 1h depois |
| 6h  |  50 |   0 |  50.0 |  2.21 | 6h depois |
| 24h |  50 |   0 |  50.0 |  0.43 | 1 dia depois |
| 0h  |   0 |   0 |   0.0 |  0.00 | Sem engajamento |
| 0h  | 500 |   0 | 500.0 | **176.78** | 10 spreaders peso 50 |
| 0h  | 100 | 100 |  70.0 | 24.75 | 1 spread peso 100, 1 bury peso 100 — bury vale 0.3 |
| 0h  |   0 | 100 | −30.0 | **−10.61** | Só buries → score negativo |
| 6h  |  10 |   0 |  10.0 |  0.44 | Sybil novo (weight≈10) tem impacto mínimo |
| 6h  | 100 |   0 | 100.0 |  4.42 | Identidade estabelecida (weight=100) |

### Por que SOMA de pesos, não COUNT

**Defesa anti-Sybil** (manifesto §22, mudança 2026-04-29):
- ANTES: `score = COUNT(spreads) / ...` → 1000 Sybils auto-spreading
  inflacionavam scores
- AGORA: `score = SUM(spreader.weight) / ...` → 1000 Sybils com
  weight≈0 contribuem ≈0

### Edge cases tratados

- `now < createdAt` (clock skew) → `ageHours = 0` (não exploda)
- spreader spreda DEPOIS dá bury no MESMO post → conta só o bury
  ("última ação vale", manifesto §23 — mudança de opinião não pune
  retroativamente). Implementado em `events.ts:recalculateScore`.

### Contribuição de comentários (Track C.5)

```
delta = min(weightedCommenters, COMMENTS_SCORE_CAP) × COMMENT_RECEIVED
newScore = currentScore + delta
```

Self-comments NÃO contam (Barney HIGH #3). Atualiza retroativamente
quando weight do commenter muda — trade-off aceito pra evitar snapshot
temporal complexo (manifesto §7 preservado).

---

## 2. Peso de identidade (weight)

**Onde:** `src/lib/weight.ts:calculateWeight`
**Manifesto:** §22 (score não-subjetivo), §32 (anti-Sybil sem prova
de identidade)

### Conceito

Cada identidade Drift tem um número 0..100 (`weight`) baseado em
**eventos públicos verificáveis** — não em "reputação subjetiva".
Funciona como multiplicador nos algoritmos (score, threshold de
moderação, max-subposts, lens edge influence).

### Fórmula

```
weight     = antiquity + engagement
antiquity  = clamp(0, 40, weeksSinceCreation)
engagement = clamp(0, 60,
               spreadsReceived × 10
             + commentsReceived × 1
             − reportsConfirmed × 15
             − inactivityDays × 1
             )
```

Cap total: **100** (40 antiquity + 60 engagement).

### Exemplo passo-a-passo

**Cenário:** identidade criada há 8 semanas, 4 spreads recebidos,
0 reports, ativa hoje.

```
antiquity   = min(40, 8) = 8
engagement  = 4 × 10 + 0 − 0 × 15 − 0 = 40
              → clamped a min(60, 40) = 40
weight      = 8 + 40 = 48
```

### Simulação multi-cenário

| Semanas | spreads | reports | dias inativo | antiquity | engagement | weight | tier |
|---:|---:|---:|---:|---:|---:|---:|---|
|  0 |   0 | 0 |   0 |  0 |   0 |  **0** | — (fresh) |
|  1 |   1 | 0 |   0 |  1 |  10 | **11** | — (<20) |
|  2 |   2 | 0 |   0 |  2 |  20 | **22** | 🌱 new |
|  8 |   4 | 0 |   0 |  8 |  40 | **48** | ⭐ active |
| 12 |   6 | 0 |   0 | 12 |  60 | **72** | 🏆 established (engagement cap atingido) |
| 40 |  10 | 0 |   0 | 40 |  60 | **100** | 🏆 (antiquity cap atingido) |
| 40 |  10 | 1 |   0 | 40 | 45 | **85** | 🏆 (1 report = −15 pts) |
| 40 |  10 | 2 |   0 | 40 | 30 | **70** | 🏆 (2 reports = −30 pts) |
| 40 |  10 | 4 |   0 | 40 |   0 | **40** | ⭐ (4 reports zeram engagement) |
| 40 |  10 | 0 |  90 | 40 |   0 | **40** | ⭐ (90d inativo zera engagement) |

### Tabela de max subposts (anti-spam mecânico)

```
weight <20 → 1 subpost
weight <40 → 2
weight <55 → 4
weight <70 → 6
weight <85 → 7
weight ≥85 → 8 (MAX)
```

**Por quê:** identidade fresca (weight=0) só pode publicar 1 subpost.
Sybil que cria 1000 identidades → cada uma só publica 1. Pra publicar
8 subposts numa POST precisa de identidade estabelecida (custa tempo
real + spreads recebidos — não dá pra fingir).

### Por que esses pontos especificamente

- `SPREAD = +10` vs `REPORT_CONFIRMED = −15`: 1.5 spreads são neutralizados
  por 1 report passado no threshold. Reports comunitários têm peso real.
- `COMMENT = +1`: pequeno para evitar farming via comentários vazios
- `DAILY_INACTIVE = −1`: 60 dias sem atividade zera o engagement
  (antiquity preservada — fica visível que é identidade antiga, mas
  não mais "rei do feed")
- `BURY = 0`: bury NÃO penaliza o autor (manifesto §23)

---

## 3. Threshold dinâmico de moderação

**Onde:** `src/lib/moderation.ts:getReportThreshold`
**Manifesto:** §26 (moderação comunitária reativa), §17 (sem chave mestra)

### Conceito

Quantos reports são necessários pra esconder um post (`score = -999`)?
Depende do tamanho da base ativa — comunidades grandes precisam mais
reports; comunidades pequenas precisam menos. Evita brigada de
poucos usuários derrubando posts em rede pequena.

### Fórmula

```
threshold      = max(5, floor(0.1% × activeUsers))
threshold_illegal = max(3, floor(threshold / 2))
```

`activeUsers` = identidades com `last_active` nos últimos 30 dias
(`countActiveUsers`).

### Peso do reporter (anti-Sybil)

Cada report contribui com pontos baseados no peso do reporter:

| reporterWeight | report contribui com |
|---:|---:|
| < 20 | 0.5 pts |
| < 50 | 1.0 pts |
| < 75 | 1.5 pts |
| ≥ 75 | 2.0 pts |

### Exemplo passo-a-passo

**Cenário:** base ativa = 1000 usuários, reason = `spam`.

```
threshold = max(5, floor(1000 × 0.001)) = max(5, 1) = 5 pontos
```

Pra esconder um post:
- 10 reports de identidades novas (peso<20, 0.5 cada) = 5.0 pts → atinge!
- 5 reports de identidades estabelecidas (peso<50, 1.0 cada) = 5.0 pts → atinge!
- 3 reports de veteranos (peso≥75, 2.0 cada) = 6.0 pts → atinge!

### Simulação multi-cenário

| Base ativa | reason | threshold | Cenário pra atingir |
|---:|---|---:|---|
|    100 | spam    | 5 | 10 novos OU 5 ativos OU 3 veteranos |
|    100 | illegal | 3 | 6 novos OU 3 ativos OU 2 veteranos |
|  1.000 | spam    | 5 | (idem — base baixa) |
| 10.000 | spam    | 10 | 20 novos OU 10 ativos OU 5 veteranos |
| 100.000 | spam   | 100 | 100 ativos coordenados |
| 100.000 | illegal | 50 | 50 ativos OU 25 veteranos |
| 1.000.000 | spam | 1000 | 1000 ativos — quase impossível brigada Sybil |

### Override do power user

`UserPrefs.report_threshold_override` permite customizar (Marshall
NEEDS-FIX C). Útil pra debug, comunidades fechadas. Default
undefined = dynamic calc.

### Por que não fundador apaga

§17 (sem chave mestra): mesmo conteúdo claramente ilegal **não é
apagado** — só `score=-999` (esconde do feed). User pode exportar,
auditar, cliente alternativo exibe. **§13 do CLAUDE.md**: cliente NÃO
deleta dados moderados do SQLite.

---

## 4. Trust Lens — Edge influence

**Onde:** `src/lib/trust/edges.ts:computeInfluence`
**Manifesto:** §24 (carve-out view-layer), §28 (privacy mínima)

### Conceito

Quanta "influência" um edge no grafo de confiança tem? Sigmoid de uma
soma ponderada de evidências (follow, mutual spread, my spread, my bury).
Output `(0, 1)`.

### Fórmula

```
x = W_BIAS                                    // -2.0 anti-Sybil base
  + W_FOLLOW · follow                         // +1.5 se segue
  + W_MUTUAL · log(1 + min(mutual, MUTUAL_CAP))  // +1.0 × log
  + W_MY_SPREAD · log(1 + my_spreads)         // +1.2 × log
  − W_MY_BURY · log(1 + my_buries)            // −1.5 × log
influence = σ(x) = 1 / (1 + e^-x)
```

Constantes (`trust/constants.ts:EDGE_WEIGHT`):

| Coef | Valor | Significado |
|---|---:|---|
| W_BIAS | −2.0 | Anti-Sybil base (FoF vazio σ(-2)=0.119) |
| W_FOLLOW | +1.5 | Follow forte |
| W_MUTUAL | +1.0 | Mutual spread (com cap 20) |
| W_MY_SPREAD | +1.2 | Eu spread autor X → confio mais |
| W_MY_BURY | −1.5 | Eu bury autor X → confio menos |
| MUTUAL_CAP | 20 | Anti-sock-puppet flooding |

### Exemplo passo-a-passo

**Cenário A — FoF vazio (relação só por amigos-de-amigos):**

```
follow=0, mutual=0, my_spread=0, my_bury=0
x = -2.0 + 0 + 0 + 0 − 0 = -2.0
influence = σ(-2.0) = 0.119
```

**Cenário B — Follow puro (sigo X mas nunca interagi):**

```
follow=1, mutual=0, my_spread=0, my_bury=0
x = -2.0 + 1.5 + 0 + 0 − 0 = -0.5
influence = σ(-0.5) = 0.378
```

**Cenário C — Follow + 3 spreads meus em posts de X:**

```
follow=1, mutual=0, my_spread=3, my_bury=0
x = -2.0 + 1.5 + 0 + 1.2 × log(4) − 0
  = -2.0 + 1.5 + 1.664
  = 1.164
influence = σ(1.164) = 0.762
```

### Simulação multi-cenário

| follow | mutual | my_spread | my_bury | x | influence |
|:---:|---:|---:|---:|---:|---:|
| 0 | 0 |  0 |  0 | -2.00 | 0.119 |
| 0 | 5 |  0 |  0 | -0.21 | 0.448 |
| 1 | 0 |  0 |  0 | -0.50 | 0.378 |
| 1 | 0 |  3 |  0 |  1.16 | 0.762 |
| 1 | 5 |  3 |  0 |  2.95 | 0.951 |
| 1 | 20 |  3 |  0 |  3.21 | 0.961 |
| 1 | 50 |  3 |  0 |  3.21 | 0.961 (cap 20 ativou) |
| 1 | 0 |  0 |  3 | -2.58 | 0.071 |
| 0 | 0 |  0 |  3 | -4.08 | 0.017 |

### Razão direct:FoF ≈ 7×

Stage 3 HIMYM consensus (`Docs/sessions/trust-lens-math-stage3-himym-2026-05-17.md`):

```
σ(0.5)  / σ(-2.0) = 0.622 / 0.119 = 5.2×    (follow puro vs FoF vazio)
σ(1.16) / σ(-2.0) = 0.762 / 0.119 = 6.4×    (follow + 3 spreads)
```

**Por quê:** sem `W_BIAS=-2.0`, FoF vazio teria `σ(0)=0.5` —
competiria 1.6× com follow legítimo. Com bias, FoF vazio
quase-zerado preserva massa PPR em vizinhança real.

---

## 5. Trust Lens — Personalized PageRank (PPR)

**Onde:** `src/lib/trust/ppr.ts:computePpr`
**Manifesto:** §24 (view-layer carve-out), §28 (local-only)

### Conceito

Monte Carlo random walk a partir do `source` (sua identidade). Conta
quantas vezes cada outro nó é visitado em K walks. Mais visitas =
"mais próximo" no grafo de confiança = boost no view multiplier.

### Algoritmo

```
for k in 1..K:
  walk = [source]
  for step in 1..L:
    if rng() < α: break                 // teleport-back (damping)
    next = sampleNeighborByInfluence(current)
    if next is null: restart from source   // dead-end → restart
    walk.append(next)
  for node in walk[1:]:                  // exclui source
    visits[node] += 1
if totalVisits == 0: return empty Map    // cold-start guard
for target in visits: ppr[target] = visits[target] / totalVisits
```

Parâmetros (`trust/constants.ts:PPR_PARAMS`):

| Param | Valor | Significado |
|---|---:|---|
| K | 1000 | Walks per recompute (variance trade-off) |
| L | 6 | Max walk depth |
| α | 0.15 | Damping (clássico PageRank Brin/Page 1998) |

**Massa retida** = 1 − (1−α)^(L+1) = 1 − 0.85^7 ≈ **0.679** (32% cauda
truncada — aceitável).

### Sample weighted neighbor

```
total = SUM(edges[].influence)
if total ≤ 0: return null
pick = rng() × total
cumulative = 0
for e in edges:
  cumulative += e.influence
  if cumulative ≥ pick: return e
```

Probabilidade de pegar edge X ∝ `influence_X / total`. Inputs zerados
(weights=0, atacante poisoning) retornam `null` → walker restart.

### Exemplo passo-a-passo (mini-grafo)

**Grafo:**

```
source → A (influence 0.8)
source → B (influence 0.4)
source → C (influence 0.1)
A → D (influence 0.7)
B → D (influence 0.3)
D → E (influence 0.5)
```

**Walk 1** (K=1 de exemplo, K real=1000):
1. step=0: at `source`. rng()=0.5 < α=0.15? NO. Sample neighbor: total=1.3,
   pick=0.5×1.3=0.65. Cumulative A=0.8 ≥ 0.65 → escolhe A.
2. step=1: at A. rng()=0.2 < α=0.15? NO. Sample: só D (0.7) → escolhe D.
3. step=2: at D. rng()=0.1 < α=0.15? YES → teleport back, break.
4. visits = {A:1, D:1}. totalVisits=2.

**ppr final (K=1000):**

| target | visits (aprox) | ppr_score |
|---|---:|---:|
| A | ~400 | ~0.40 |
| B | ~200 | ~0.20 |
| C | ~30 | ~0.03 |
| D | ~250 | ~0.25 |
| E | ~120 | ~0.12 |

(Números ilustrativos — Monte Carlo + path diversity afetam.)

### Cold-start guard

Se `totalVisits === 0` (source sem out-edges, OU todos walks
terminaram com damping em step 0), retorna `new Map()` vazio.
`getPprForAuthor()` retorna 0 → multiplier 1.0 → feed canônico
inalterado. **Lens off naturalmente quando não tem grafo.**

### Log-transform pós-PPR

PPR scores na prática são power-law (top-1 ≈ 0.05-0.15, median ≈
0.001). Log-transform achata pra escala perceptual:

```
normalized = log(1 + 100·ppr) / log(101)   // ∈ [0, 1]
```

| ppr | normalized |
|---:|---:|
| 0.001 | 0.022 |
| 0.010 | 0.150 |
| 0.050 | 0.388 |
| 0.100 | 0.520 |
| 0.500 | 0.852 |
| 1.000 | 1.000 |

Sem essa normalização, `BETA · ppr_raw` contribuía 1-8% no multiplier
(placebo). Marshall BUG-5 fix em Stage 3.

### Path diversity (defesa Alvisi/Viswanath)

```
disjoint_paths(source, target, depth≤3) ∈ {0, 1, 2, 3}
diversity_coeff = 0.7 + 0.3 × min(paths, 3)/3 ∈ [0.7, 1.0]
final_score = ppr_score × diversity_coeff
```

Target alcançado por 1 intermediário só (1 path) fica dim (×0.7).
≥3 paths disjoint → bonus full (×1.0).

| paths | coeff |
|---:|---:|
| 0 | 0.70 |
| 1 | 0.80 |
| 2 | 0.90 |
| 3+ | 1.00 |

---

## 6. Trust Lens — View multiplier (s_local)

**Onde:** `src/lib/trust/ppr.ts:viewMultiplier`
**Manifesto:** §24 (s_local NUNCA persisted, NUNCA shared)

### Conceito

A função que **finaliza** a lente: multiplier aplicado em
`s_global` no render path do feed pra obter `s_local`. **VIVE NO
RENDER**, nunca toca SQLite.

### Fórmula

```
ppr_normalized = log(1 + 100·ppr_score) / log(101)
mutual = max(0, mutual_spread_post)
strength = clamp(0, 1, slider_value / 100)
raw = ALPHA_VIEW
    + BETA_MAX  × strength × ppr_normalized
    + GAMMA_MAX × strength × mutual
multiplier = clamp(S_LOCAL_MIN, S_LOCAL_MAX, raw)
s_local = s_global × multiplier
```

Constantes (`VIEW_MULTIPLIER`):

| Param | Valor |
|---|---:|
| ALPHA_VIEW | 1.0 |
| BETA_MAX | 1.5 |
| GAMMA_MAX | 0.4 |
| S_LOCAL_MIN | 0.1 |
| S_LOCAL_MAX | 3.0 |

### strength=0 → multiplier=1.0 bit-exact

Quando slider em 0%:
```
raw = 1.0 + 1.5 × 0 × ... + 0.4 × 0 × ... = 1.0
multiplier = clamp(0.1, 3.0, 1.0) = 1.0
s_local = s_global × 1.0 = s_global
```

**Lens OFF preserva feed canônico bit-exact.** Conformance test #19.

### Simulação multi-cenário (strength=100%, slider em "máximo")

| ppr | normalized | mutual | raw | multiplier | s_global=10 → s_local |
|---:|---:|---:|---:|---:|---:|
| 0.000 | 0.000 | 0 | 1.00 | 1.00 | 10.0 (sem boost) |
| 0.001 | 0.022 | 0 | 1.03 | 1.03 | 10.3 |
| 0.010 | 0.150 | 0 | 1.22 | 1.22 | 12.2 |
| 0.050 | 0.388 | 0 | 1.58 | 1.58 | 15.8 |
| 0.100 | 0.520 | 0 | 1.78 | 1.78 | 17.8 |
| 0.500 | 0.852 | 0 | 2.28 | 2.28 | 22.8 |
| 1.000 | 1.000 | 0 | 2.50 | 2.50 | 25.0 |
| 0.100 | 0.520 | 1 | 2.18 | 2.18 | 21.8 (mutual ajuda) |
| 0.100 | 0.520 | 5 | 3.78 | **3.00** (cap) | 30.0 |

### Simulação strength variável (ppr=0.05, mutual=0)

| strength | boost | multiplier | s_local |
|---:|---:|---:|---:|
| 0%   | 0%   | 1.00 | 10.0 |
| 25%  | 14.6% | 1.15 | 11.5 |
| 50%  | 29.1% | 1.29 | 12.9 |
| 75%  | 43.7% | 1.44 | 14.4 |
| 100% | 58.2% | 1.58 | 15.8 |

**Linear (BUG-6 fix):** Marshall removeu `strength²` porque slider
visual é perceptualmente linear (Norman heurística). 50% = metade do
boost máximo, não 25%.

### O que NUNCA pode acontecer (LOCK_VIA_TEST)

1. `s_local` ser escrito em `posts.score` (manifesto §24 broken)
2. `s_local` ser shared via Nostr event
3. `lens_strength > 0` afetar feed quando user nunca abriu Settings
4. `strength=0` produzir multiplier ≠ 1.0

---

## 7. Trust Lens — Temporal decay (GAP-1, opt-in)

**Onde:** `src/lib/trust/ppr.ts:temporalDecay`
**Shipped:** 2026-05-20 [`2de0fc0`]
**Gating:** `UserPrefs.lens_ppr_decay_enabled` (default `false`)

### Conceito

Edge antigo (sem atividade ≥30d) pesa menos no walk PPR. Aplicado
**opt-in** — defaults preservam math bit-exact pra users existentes.

### Fórmula

```
decay(age_ms, half_life_ms) = 2^(-age / half_life)
                            = exp(-ln(2) · age / half_life)
```

Range: `(0, 1]`. `age ≤ 0 → 1.0`. `age → ∞ → 0+`.

`HALF_LIFE_MS = 30 dias` (Lily polish — casa com ciclo típico de
atenção em redes sociais).

### Onde é aplicado

`recomputeLens()` em `trust-lens.ts`:

```typescript
const decayEnabled = usePrefsStore.getState().lens_ppr_decay_enabled
for (const row of edgesFromSQL) {
  let influence = row.influence
  if (decayEnabled && row.updated_at > 0) {
    const ageMs = recomputeNow - row.updated_at
    influence *= temporalDecay(ageMs, PPR_DECAY.HALF_LIFE_MS)
  }
  adjacency.push({ target: row.target_npub, influence })
}
```

`lens_edges.influence` no SQLite **PERMANECE bit-exact** — só o walk
vê a influência decaída.

### Simulação multi-cenário

| idade do edge | decay | influence (orig=0.5) → decaída |
|---:|---:|---:|
|   0 dias |  1.000 | 0.500 |
|   7 dias |  0.851 | 0.426 |
|  15 dias |  0.707 | 0.354 |
|  30 dias |  0.500 | 0.250 |
|  60 dias |  0.250 | 0.125 |
|  90 dias |  0.125 | 0.063 |
| 180 dias |  0.016 | 0.008 |
| 365 dias |  0.000² | quase zero |

(²) `decay(365d, 30d) ≈ 2^-12 ≈ 2.4e-4` — vivo mas insignificante.

### KNOWN LIMITATION (Satoshi audit)

`updated_at` é refresh-on-write (`upsertEdge` atualiza a cada
follow/spread/bury). Sybil ring que "renova edges" (re-segue,
re-drifta posts antigos) reseta timestamps → decay = 1.0.

**Defesa correta:** schema bump adicionando `lens_edges.created_at`
**imutável** + decay usando `max(age_since_created, age_since_updated)`.

**Deferred Phase 2** — sem telemetria de attack real, schema bump
prematuro. Documentado em `Docs/known-limitations.md` §1.

---

## 8. Cenários integrados (fim-a-fim)

### Cenário A — Post canônico recém-publicado

**Setup:**
- Autor: identidade nova (criada há 1 semana, weight=11)
- Post: 0h de idade, 1 spreader (peso 50), 0 buries
- Lens: OFF (strength=0)

**Pipeline:**
1. `weight(autor) = antiquity(1w)=1 + engagement(0)=0 = 1`
   → autor publica até 1 subpost (cap iniciante)
2. `score = (50 − 0) / (0+2)^1.5 = 17.68` (canônico)
3. `s_local = 17.68 × 1.0 = 17.68` (lens off, bit-exact)

User vê o post no feed com `DERIVA 17.68`.

### Cenário B — Post moderado pela comunidade

**Setup:**
- Post controverso, 24h de idade
- 20 spreaders (peso médio 30), 10 buries (peso médio 40)
- 4 reports `spam` de identidades estabelecidas (peso 50, +1.0 pts cada)
- Base ativa: 1000 users
- Threshold spam: `max(5, floor(0.001×1000)) = 5 pts`

**Pipeline:**
1. `spreadWeight = 20 × 30 = 600`
2. `buryWeight = 10 × 40 = 400`
3. `netEngagement = 600 − 400×0.3 = 480`
4. `score = 480 / (24+2)^1.5 = 480 / 132.6 = 3.62`
5. **Reports:** 4 × 1.0 = 4.0 pts < threshold 5 → não modera ainda
6. 6º report (1.0 pts) → total 6.0 ≥ 5 → `score := -999`, post some
   do feed default.

### Cenário C — Sybil ring tenta gamificar

**Setup:**
- Atacante cria 100 identidades novas (cada uma weight=0)
- Auto-spread em post próprio (autor também weight=0)

**Pipeline:**
1. `spreadWeight = 100 × 0 = 0`
2. `score = 0 / ... = 0` → post não sobe no feed
3. **Defesa funcionou:** SOMA de pesos (não count) neutraliza Sybil
   sem nenhuma chave mestra
4. Identidades novas precisam de tempo real (1 ponto/semana) +
   spreads recebidos (não auto-spreads) pra ganhar weight

### Cenário D — User power liga Trust Lens

**Setup:**
- Slider em 75%, lens estável (PPR já computado)
- Autor X: PPR score 0.05 (top da rede do user), mutual=2
- Post de X: `s_global = 5.0`

**Pipeline:**
1. `ppr_normalized = log(1 + 100×0.05) / log(101) = 0.388`
2. `raw = 1.0 + 1.5×0.75×0.388 + 0.4×0.75×2 = 1.0 + 0.437 + 0.600 = 2.037`
3. `multiplier = clamp(0.1, 3.0, 2.037) = 2.037`
4. `s_local = 5.0 × 2.037 = 10.18`

Post de X aparece **2× mais alto** no feed local do user. Outros users
(que NÃO seguem X) veem `s_global=5.0` puro — feed canônico preservado
(§24).

### Cenário E — User liga decay temporal (GAP-1)

**Setup do Cenário D**, agora com `lens_ppr_decay_enabled = true`. Edge
do autor X foi `updated_at` há 45 dias (user parou de driftar X).

**Pipeline:**
1. `decay(45d, 30d) = 2^(-1.5) = 0.354`
2. `influence_decayed = 0.378 × 0.354 = 0.134` (visto pelo walker; SQLite
   permanece 0.378)
3. PPR walk redistribui visitas — X recebe menos massa
4. Suponha `ppr_score(X)` caia de 0.05 → 0.02
5. `ppr_normalized = log(1+2)/log(101) = 0.238`
6. `raw = 1.0 + 1.5×0.75×0.238 + 0.4×0.75×2 = 1.0 + 0.268 + 0.600 = 1.868`
7. `s_local = 5.0 × 1.868 = 9.34` (vs 10.18 sem decay)

Post de X ainda aparece boostado, mas menos — refletindo que user
"esqueceu" X.

---

## Apêndice — invariantes que NUNCA podem quebrar (LOCK_VIA_TEST)

| Invariante | Arquivo | Manifesto |
|---|---|---|
| `calculateScore` é determinístico (mesmo input → mesmo output) | `tests/scoring.test.ts` | §7 |
| `calculateWeight` é função pura (sem `Date.now()`) | `tests/weight.test.ts` | §7, §22 |
| `getReportThreshold` é função pura | `tests/moderation.test.ts` | §7, §26 |
| `s_local` NUNCA escrito em `posts.score` | `tests/trust-lens-conformance.test.ts` #2 | §24 |
| `strength=0` → `multiplier=1.0` bit-exact | `tests/trust-lens-math.test.ts` #19 | §24 |
| `computeInfluence` ∈ (0, 1) bounds | `tests/trust-lens-math.test.ts` #10 | §22 |
| `temporalDecay` ∈ (0, 1] + monotonic | `tests/trust-lens-math.test.ts` #22-#27 | §7 |
| Feed canônico inalterado pra users sem lens habilitada | `tests/feed.test.ts` | §24 |

---

*Última atualização: 2026-05-20. Source-of-truth está no código —
quando este doc divergir, código vence. Reportar dessincronia via
issue ou pair-review HIMYM.*
