# Drift — Algoritmos (explicado com exemplos e simulações)

> Documento didático cobrindo todas as funções matemáticas centrais do
> Drift. Cada algoritmo tem: **conceito → fórmula → exemplo passo-a-passo
> → simulação multi-cenário → edge cases → manifesto reference.**
>
> Determinismo é princípio do manifesto (§7) — todas as funções aqui
> são **puras**, sem `Date.now()` implícito (caller passa `now`). Mesmo
> conjunto de eventos + mesmo dia UTC → mesma saída, independente da
> ordem de chegada → clientes com os mesmos eventos convergem.
> As propriedades (não só os números) são travadas por
> `tests/algorithm-invariants.test.ts`, que roda o pipeline real contra
> ataques e embaralha a ordem dos eventos.
>
> Fontes canônicas no código (source-of-truth):
> - `src/lib/ranking.ts` — motor global: pesos, scores e moderação a
>   partir do conjunto de eventos (auditoria 2026-11-03)
> - `src/lib/scoring.ts` — fórmula do score + decay
> - `src/lib/weight.ts` — fórmula do peso de identidade
> - `src/lib/moderation.ts` — threshold dinâmico e pontos de report
> - `src/lib/ots.ts`, `ots-client.ts`, `ots-anchors.ts`, `ots-stamper.ts`
>   — âncora de antiguidade OpenTimestamps/Bitcoin (NIP-03)
> - `src/lib/trust/{ppr,edges,constants}.ts` — Trust Lens
> - `src/lib/contagion.ts` (+ `contagion-data.ts`) — contágio local da
>   aba Contágio (§9; manifesto §24 emendado em 2026-11-05)
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
9. [Contágio local — aba Contágio (Fase 1)](#9-contágio-local--aba-contágio-fase-1)

---

## 1. Score canônico de post

**Onde:** `src/lib/ranking.ts:computeRanking` (numerador) +
`src/lib/feed.ts:DECAYED_SCORE` (decay na leitura) +
`src/lib/scoring.ts` (fórmula pura)
**Manifesto:** §7 (determinismo), §22 (score não-subjetivo), §24 (sem
afinidade no feed canônico)

### Conceito

O score é o número que ordena o feed canônico. **Igual pra todos os
clientes Drift que têm o mesmo conjunto de eventos** — sem
personalização. Combina engajamento ponderado (peso de quem espalhou,
enterrou e comentou) com decaimento temporal (posts ficam relevantes
por horas, não minutos).

### Fórmula

```
ageHours      = max(0, (now - createdAt) / 3600)
commentWeight = min(Σ weight(commenters distintos), COMMENTS_SCORE_CAP=30)
score_base    = spreadWeight − buryWeight × 0.3 + commentWeight × 1
score         = score_base / (ageHours + 2)^1.5
```

Onde:
- `spreadWeight` = SOMA dos `weight` de quem tem ação líquida `spread`
  (não count — peso!). O autor não conta. **Só contam votos (spread,
  bury, comentário) de quem tem peso ≥ 4 E ≥ 2 semanas de âncora própria**
  (`VOTE_MIN_WEIGHT`, `VOTE_MIN_ANTIQUITY_WEEKS`): antiguidade custa tempo,
  não custo por chave, então sem esse mínimo 10k chaves de 1 semana
  somavam 10k pontos. Os mesmos mínimos valem pra ENDOSSAR (dar
  engajamento) — senão milhares de chaves de 1 dia concentravam peso 60
  numa só.
- `buryWeight`   = SOMA dos `weight` de quem tem ação líquida `bury`
- `commentWeight` = SOMA dos `weight` dos commenters distintos (autor e
  comentários moderados fora), com cap 30. Entra no NUMERADOR e
  portanto na ordem do feed.
- Multiplicador `0.3` em bury: enterro é julgamento estético, não
  punição. Reduz menos do que espalhar puxa.
- `+2` em ageHours: evita divisão explosiva nos primeiros minutos
- Expoente `1.5`: decay suave (vale por horas, não minutos)

`score_base` é materializado em `posts.score_base` e só muda quando o
conjunto de eventos ou os pesos mudam. O divisor é aplicado **na
leitura** (`feed.ts`), então o tempo passa sem nenhum job reescrevendo
a tabela.

### Relógio

- `max(0, idade)` existe na SQL **e** no TS — paridade travada em
  `tests/score-decay-parity.test.ts`, inclusive com idade negativa.
- Eventos com `created_at` mais de 15 min no futuro
  (`MAX_FUTURE_SKEW_SECONDS`) são descartados na entrada
  (`events.ts:isAcceptableCreatedAt`). Antes, +1h54 dava boost de ~89×
  e +2h virava `NULL` na SQL.

### Exemplo passo-a-passo

**Cenário:** post recém-criado (1h de idade), 1 spreader peso 50, 0 buries.

```
spreadWeight   = 50
buryWeight     = 0
ageHours       = 1
score_base     = 50 − 0 × 0.3 = 50
score          = 50 / (1 + 2)^1.5
               = 50 / 5.196
               = 9.62
```

### Simulação multi-cenário

| Idade | spreadWeight | buryWeight | score_base | score | Comentário |
|---:|---:|---:|---:|---:|---|
| 0h  |  50 |   0 |  50.0 | **17.68** | Recém-saído, 1 spreader peso 50 |
| 1h  |  50 |   0 |  50.0 |  9.62 | Mesma identidade, 1h depois |
| 6h  |  50 |   0 |  50.0 |  2.21 | 6h depois |
| 24h |  50 |   0 |  50.0 |  0.38 | 1 dia depois |
| 0h  |   0 |   0 |   0.0 |  0.00 | Sem engajamento |
| 0h  | 500 |   0 | 500.0 | **176.78** | 10 spreaders peso 50 |
| 0h  | 100 | 100 |  70.0 | 24.75 | 1 spread peso 100, 1 bury peso 100 — bury vale 0.3 |
| 0h  |   0 | 100 | −30.0 | **−10.61** | Só buries → score negativo |
| 6h  |   0 |   0 |   0.0 |  0.00 | 100 chaves sem âncora espalhando (peso 0 cada) |
| 6h  | 100 |   0 | 100.0 |  4.42 | Identidade estabelecida (weight=100) |

### "Última ação vale" (§23)

Cada (post, user) contribui só com a ação **mais recente** entre spread
e bury. `spreads` e `buries` são upsert LWW por `(post_id, user)` —
guardam o evento de maior `created_at` (empate: menor `event_id`).
Antes era `INSERT OR IGNORE`, que guardava o PRIMEIRO a chegar:
spread→bury→spread contava bury, e a ordem de chegada mudava o score.
`selectLatestActionByUser` (ranking.ts) desempata `created_at` igual por
kind (`bury` vence) e depois `event_id`.

---

## 2. Peso de identidade (weight)

**Onde:** `src/lib/ranking.ts:computeRanking` (motor global) usando as
funções puras de `src/lib/weight.ts`; materializado em `users.weight`
**Manifesto:** §22 (score não-subjetivo), §33 (anti-spam pela mecânica social)

### Conceito

Cada identidade tem um número 0..100 (`weight`) derivado de **eventos
públicos verificáveis**. Multiplica tudo: score, pontos de report, max
de subposts, lens.

Chave Nostr custa zero. Então o peso só pode vir de algo que **não se
fabrica de graça**:

1. **Tempo provado no Bitcoin** (antiguidade, via OpenTimestamps), ou
2. **Spread de quem já tem peso** (engajamento ponderado).

### Fórmula

```
epoch      = início do dia UTC de "agora"   (pesos mudam 1×/dia)
antiquity  = clamp(0, 40, semanas entre a âncora OTS e epoch)   // 0 sem âncora
endosso(s → a) = min( teto_aresta × weight(s)/100 ,  0.5 × weight(s) × fatia(s → a) )
                 teto_aresta = 10 se s deu DRIFT em algum post de a, senão 1 se só comentou
                 fatia(s → a) = peso da aresta (1 ou 0.1) / Σ pesos das arestas de s
positivo   = clamp(0, 60, Σ_s endosso(s → a))
engagement = max(0, positivo − 15 × posts próprios moderados − 1 × dias inativo)
weight     = antiquity + engagement          (≤ 40 + 60 = 100)
```

Pontos-chave:
- **Uma aresta por par** (s, a), não por post: espalhar 20 posts do mesmo
  autor endossa uma vez só.
- **Orçamento conservado:** cada identidade distribui no máximo
  `0.5 × o próprio peso` entre todos os autores que endossa. Um veterano
  que endossa 1 pessoa dá até 10 × peso/100 a ela; se endossa 20, cada
  uma recebe 1/20 do orçamento.
- **Penalidades depois do teto:** moderação e inatividade descontam do
  engajamento já saturado, então sempre mordem.

`weight` aparece dos dois lados: é o **menor ponto fixo ≥ antiquity**,
obtido por iteração de Jacobi a partir de `w₀ = antiquity`. Como cada
identidade repassa no máximo metade do próprio peso, o operador é uma
**contração**: o peso total de QUALQUER grupo de identidades fica
limitado a `antiguidade_total / (1 − 0.5) = 2 ×` o tempo real ancorado
que o grupo tem. Converge geometricamente; somas em ordem fixa de pubkey
→ mesmo número em qualquer cliente.

**Por que o orçamento:** a primeira versão deste motor contava 1 aresta
por post e sem orçamento. A revisão pré-merge (2026-11-04) mostrou que
uma única âncora de 1 dia num anel de chaves saturava o anel inteiro em
peso 60, e duas chaves assim "lavavam" um número ilimitado de outras. O
teste `PROPRIEDADE (contração)` em `tests/algorithm-invariants.test.ts`
trava a garantia em grafos aleatórios.

### Âncora de antiguidade (OpenTimestamps, NIP-03)

O `created_at` de um evento Nostr é escolhido por quem assina. Antes a
antiguidade era "semanas desde o primeiro evento que ESTE cliente viu"
— uma chave criada hoje assinava um post datado de 1 ano atrás e ganhava
antiguidade 40 na hora, e dois clientes com históricos diferentes
calculavam pesos diferentes.

Agora:
- O cliente carimba o evento mais antigo da identidade ativa em
  calendários OpenTimestamps públicos (`ots-stamper.ts`), que agregam
  milhares de hashes numa transação Bitcoin. Quando o bloco confirma,
  publica a prova como **kind 1040** (NIP-03).
- Cada cliente verifica a prova contra o header do bloco (≥2
  exploradores concordando; cache em `btc_headers`) e grava
  `ots_anchors` (`ots-anchors.ts`).
- `antiquity` conta a partir do **bloco mais antigo** que prova um
  evento daquela chave. Ninguém carimba no passado; todo cliente vê o
  mesmo bloco.

Identidade sem âncora tem `antiquity = 0` — mas ainda pode ganhar peso
pelo engajamento de quem já tem.

### Exemplo passo-a-passo

**Cenário:** âncora há 8 semanas; 4 spreads recebidos de identidades de
peso 100; 0 reports; ativa hoje.

```
antiquity   = 8
engagement  = 10 × (4 × 100/100) = 40
weight      = 8 + 40 = 48
```

Se os 4 spreads viessem de chaves sem âncora e sem engajamento (peso 0):
`engagement = 0`, `weight = 8`.

### Simulação multi-cenário

| Âncora | spreads recebidos de | reports | dias inativo | antiquity | engagement | weight |
|---|---|---:|---:|---:|---:|---:|
| nenhuma | — | 0 | 0 | 0 | 0 | **0** |
| nenhuma | 100 chaves sem peso | 0 | 0 | 0 | 0 | **0** (Sybil não lava) |
| nenhuma | 1 veterano (peso 40) | 0 | 0 | 0 | 4 | **4** (confiança flui) |
| nenhuma | 1 veterano (peso 40) que endossa 20 pessoas | 0 | 0 | 0 | 1 | **1** (orçamento 20 ÷ 20) |
| 2 sem | 2 de peso 100 | 0 | 0 | 2 | 20 | **22** |
| 8 sem | 4 de peso 100 | 0 | 0 | 8 | 40 | **48** |
| 40 sem | 10 de peso 100 | 0 | 0 | 40 | 60 | **100** |
| 40 sem | 10 de peso 100 | 1 | 0 | 40 | 45 | **85** (60 − 15: penalidade depois do teto) |
| 40 sem | 6 de peso 40 | 1 | 0 | 40 | 9 | **49** (24 − 15) |
| 40 sem | 10 de peso 100 | 0 | 90 | 40 | 0 | **40** (60 − 90 → 0) |

(Linhas com "de peso X" assumem que cada spreader endossa só esta
identidade; quem endossa k identidades dá a cada uma no máximo
`0.5 × peso / k`.)

### Tabela de max subposts (anti-spam mecânico)

```
weight <20 → 1 subpost
weight <40 → 2
weight <55 → 4
weight <70 → 6
weight <85 → 7
weight ≥85 → 8 (MAX)
```

### Por que esses pontos especificamente

- `SPREAD = +10 × peso/100`: um veterano (100) dá +10; uma chave sem peso
  dá 0. Antes eram +10 fixos por evento — 6 chaves recém-criadas davam
  peso 60 a qualquer um.
- `REPORT_CONFIRMED = −15` por post próprio moderado
- `COMMENT = +1 × peso/100`: pequeno para evitar farming
- `DAILY_INACTIVE = −1`: 60 dias sem atividade zera o engajamento
- `BURY = 0`: bury NÃO penaliza o autor (manifesto §23)

---

## 3. Threshold dinâmico de moderação

**Onde:** `src/lib/ranking.ts` (decisão, derivada a cada recomputação)
+ `src/lib/moderation.ts` (funções puras)
**Manifesto:** §26 (moderação comunitária reativa), §17 (sem chave mestra)

### Conceito

Quantos pontos de report escondem um post? Depende do tamanho da base
ativa. A moderação é **derivada**: a cada recomputação, o motor decide
"moderado ou não" a partir do conjunto de reports e dos pesos atuais.
Antes ela era um `UPDATE posts SET score = -999` disparado por report,
que o recálculo de score seguinte apagava (qualquer spread novo, ou o
próprio recálculo atrasado do post na rajada de boot, ressuscitava o
post).

### Fórmula

```
threshold         = max(5, floor(0.1% × activeUsers))
threshold_illegal = max(3, floor(threshold / 2))
pontos(report)    = weight ≥ 20 E antiguidade ≥ 8 semanas ? min(2, weight / 50) : 0
```

Os mínimos (`REPORT_MIN_WEIGHT`, `REPORT_MIN_ANTIQUITY_WEEKS`) existem
porque a soma é linear em chaves: sem eles, 1200 chaves ancoradas há 1 dia
moderavam qualquer post `illegal` numa rede pequena; só com o mínimo de
peso, "concentradores" endossados por milhares de chaves de 1 dia ainda
chegavam a peso 60. Cada reporter precisa de 8 semanas reais próprias.

`activeUsers` = **base ativa ponderada**: Σ `min(1, peso/20)` das
identidades com `last_active` nos 30 dias antes de `epoch`. Chave de peso
0 não conta — senão 10k chaves descartáveis dobravam o threshold e
protegiam spam (revisão pré-merge, F5). Auto-report do autor não conta.
Report é upsert LWW por (post, reporter).

### Peso do reporter (anti-Sybil)

| reporterWeight (com ≥ 8 semanas de âncora) | report contribui com |
|---:|---:|
| < 20 | 0.0 pts |
|  20 | 0.4 pts |
|  25 | 0.5 pts |
|  50 | 1.0 pts |
|  75 | 1.5 pts |
| 100 | 2.0 pts |

Antes havia piso de 0.5 pt pra peso < 20: 10 chaves recém-criadas
derrubavam qualquer post (6 com `illegal`). Chave sem peso agora vale 0.

### Exemplo passo-a-passo

**Cenário:** base ativa = 1000 usuários, reason = `spam`.

```
threshold = max(5, floor(1000 × 0.001)) = 5 pontos
```

Pra esconder um post:
- 50 chaves sem âncora = 0 pts → não atinge
- 7 identidades com 40 semanas de âncora (peso 40 → 0.8 cada) = 5.6 → atinge
- 3 veteranos de peso 100 (2.0 cada) = 6.0 → atinge

### Simulação multi-cenário

| Base ativa | reason | threshold | Cenário pra atingir |
|---:|---|---:|---|
|    100 | spam    | 5 | 3 veteranos (100) OU 5 de peso 50 |
|    100 | illegal | 3 | 2 veteranos (100) OU 4 de peso 40 |
| 10.000 | spam    | 10 | 5 veteranos OU 10 de peso 50 |
| 100.000 | spam   | 100 | 50 veteranos coordenados |

### Interação peso ↔ moderação

Pontos de report dependem de pesos; pesos dependem da moderação (−15
por post moderado). Não existe ponto fixo garantido (mais moderação →
menos peso → menos moderação). O motor decide de forma **conservadora e
sem ordem**:

1. `C` = candidatos: posts acima do threshold com os pesos sem
   penalidade nenhuma;
2. pesos de pior caso: aplica as penalidades de TODOS os candidatos;
3. modera só os candidatos que continuam acima do threshold com esses
   pesos de pior caso.

Cada reporter é avaliado no pior caso pra ele, então um spammer com posts
denunciados denuncia com o peso já reduzido. Como não há ordem, não há
timestamp pra manipular (retrodatar reports não muda nada). Em ataque
simétrico — dois lados se denunciando — o resultado é "ninguém
moderado": o motor erra pra menos moderação, nunca pra moderar o
honesto. Custo: 3 soluções de peso por recomputação.

Histórico: versões anteriores oscilavam (podiam não moderar nada),
decidiam tudo sem penalidade (spammer punido seguia derrubando posts) ou
seguiam a ordem dos timestamps (o atacante escolhia a ordem).

### Overrides locais

`UserPrefs.report_threshold_override` e `report_decay_enabled` (meia-vida
48h nos pontos, medida contra o report MAIS RECENTE do post — denúncias
espalhadas no tempo pesam menos, mas a moderação não se desfaz sozinha
com a passagem dos dias) continuam valendo — soberania local, entram como
parâmetros do motor.

### Por que não fundador apaga

§17 (sem chave mestra): mesmo conteúdo claramente ilegal **não é
apagado** — só `score=-999` (esconde do feed). User pode exportar,
auditar, cliente alternativo exibe. **invariante #13**: cliente NÃO
deleta dados moderados do SQLite. Post não moderado nunca recebe score
≤ −999 (piso em −998), então brigada de bury não se confunde com
moderação.

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

Stage 3 HIMYM consensus (`nota interna`):

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
    if next is null: break                 // dead-end → encerra o walk
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
(weights=0, atacante poisoning) retornam `null` → o walk termina.

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

### Sybil edge-refresh defense (shipped 2026-05-20)

Defesa anti-Sybil via `lens_edges.created_at` **imutável**:

- `created_at INTEGER` adicionado em schema (migration additive)
- Writers incluem `created_at = now` no primeiro INSERT, mas **NÃO** no
  `DO UPDATE SET` — imutável por construção SQL
- Reader (`recomputeLens`) usa `row.created_at ?? row.updated_at`
  (COALESCE defensivo pra rows pré-migration)
- `lens_edges.influence` no SQLite permanece bit-exact — só o walk vê
  o ajuste

**Por que `created_at` em vez de `updated_at`:** Sybil que re-segue/re-
drifta atualizava `updated_at` → resetava decay. `created_at` imutável
após primeiro INSERT trava esse vetor. 4 conformance tests
(`tests/trust-lens-math.test.ts` #28-#31) travam o pattern.

---

## 8. Cenários integrados (fim-a-fim)

### Cenário A — Post canônico recém-publicado

**Setup:**
- Autor: identidade com âncora OTS de 1 semana (weight ≈ 1)
- Post: 0h de idade, 1 spreader (peso 50), 0 buries
- Lens: OFF (strength=0)

**Pipeline:**
1. `weight(autor) = antiquity(1 sem)=1 + engagement(0) = 1`
   → autor publica até 1 subpost (cap iniciante)
2. `score_base = 50`, `score = 50 / (0+2)^1.5 = 17.68` (canônico)
3. `s_local = 17.68 × 1.0 = 17.68` (lens off, bit-exact)

### Cenário B — Post moderado pela comunidade

**Setup:**
- Post controverso, 24h de idade
- 20 spreaders (peso médio 30), 10 buries (peso médio 40)
- 4 reports `spam` de identidades de peso 50 (1.0 pt cada)
- Base ativa: 1000 users → threshold spam = 5 pts

**Pipeline:**
1. `score_base = 600 − 400×0.3 = 480`
2. `score = 480 / (24+2)^1.5 = 3.62`
3. **Reports:** 4 × 1.0 = 4.0 pts < 5 → não modera
4. 5º report de peso 50 → 5.0 ≥ 5 → moderado; `score = -999`, some do
   feed default. Spreads posteriores **não** desfazem (moderação é
   derivada do conjunto de reports a cada recomputação).

### Cenário C — Sybil ring tenta gamificar

**Setup:**
- Atacante cria 100 chaves novas e assina posts com `created_at` de 1
  ano atrás (backdating)
- Todas se espalham mutuamente e espalham o post-alvo

**Pipeline:**
1. Nenhuma tem âncora OTS → `antiquity = 0` (o `created_at` forjado não
   conta)
2. Engajamento ponderado: `10 × Σ 0/100 = 0` → ponto fixo em 0 pra todas
3. `spreadWeight = 100 × 0 = 0` → post não sobe; reports delas valem 0
4. **Custo real pro atacante:** carimbar as chaves e **esperar** — cada
   semana de antiguidade custa uma semana de verdade, provada no
   Bitcoin; ou convencer identidades com peso a espalhá-lo

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

## 9. Contágio local — aba Contágio (Fase 1)

### Conceito

As abas Global, Seguindo e Em alta mostram a mesma ordem para todo mundo.
A aba **Contágio** mostra o que chegou ao leitor **pelas pessoas que ele
segue**, como um vírus que passa de contato em contato: um post entra
quando contatos deram DRIFT nele e a soma da força desses vínculos
passa de 0,8. As regras são públicas e determinísticas; só as
**entradas** são do leitor (quem ele segue, o que ele já impulsionou, o
que ele enterrou ou denunciou). A **ordem** dentro da aba continua a
canônica (§1). Manifesto §24, emendado em 2026-11-05.

Por que existe: numa ordem global igual para todos, uma fazenda de
contas paciente compra o topo de todo mundo de uma vez. A simulação
(`Docs/simulacao-contagio/`, `Docs/spec-revisao-contagio.md`) mostrou a
fazenda de 2.000 contas no feed de 100% das pessoas no modelo global e
abaixo de 0,3% no contágio local. É o resultado de Cheng & Friedman
(2005): nenhuma reputação simétrica resiste a contas falsas; as
assimétricas, calculadas a partir de quem olha, podem resistir.

### Fórmula (décimos inteiros — a soma não depende da ordem)

```
tie(u) = 0                                   se o leitor não segue u
       = max(0, base(u) − 5 × ruins(u))      senão
base(u) = 8   se o leitor já impulsionou algo que u escreveu (ação líquida)
        = 5   se só segue
ruins(u) = posts distintos que o leitor enterrou/denunciou e que eram de u
           ou chegaram por u (permanente)

Para cada post p (nunca os do próprio leitor), usando a AÇÃO MAIS RECENTE
de cada contato em p (no empate exato, o SINK):
  forte(p)      = Σ tie(u)  contatos com DRIFT em p nas últimas 48 h e tie(u) > 5
  fraco(p)      = min(Σ tie(u) dos com tie(u) ≤ 5, 5)      ← teto: 0,5
  vacina(p)     = Σ tie(u)  contatos com SINK em p nas últimas 48 h
  quarentena(p) = Σ tie(u)  contatos que denunciaram p nos últimos 14 dias
  direto(p)     = autor seguido com tie > 0 e post com até 72 h

p entra ⇔ quarentena(p) < 10
        ∧ 10·direto(p) + forte(p) + fraco(p) − vacina(p) > 0
        ∧ (direto(p) ∨ forte(p) + fraco(p) ≥ 8)
```

O **teto para vínculos fracos** é a peça central: contas que o leitor só
segue somam no máximo 0,5 por post, então nunca passam o limiar sozinhas,
por mais que sejam, revezem, camuflem o histórico ou se escondam atrás de
relays. Ele só usa os vínculos do próprio leitor: não depende de dado
global.

### Exemplo

Bia segue Ana (já impulsionou um post dela → 0,8), Caio e Duda (só segue
→ 0,5 cada).

| Post | O que aconteceu | Conta | Entra? |
|---|---|---|---|
| X | Ana deu DRIFT há 3 h | forte 8 | sim |
| Y | Caio e Duda deram DRIFT | fraco min(10, 5) = 5 | não |
| Z | Ana deu DRIFT; Caio e Duda denunciaram | quarentena 5 + 5 = 10 | não |
| W | Post de Caio de ontem; Ana deu SINK | direto: 10 − 8 = 2 > 0 | sim |
| V | Ana deu DRIFT; Bia já enterrou 2 posts que vieram pela Ana | tie(Ana) = 8 − 10 → 0 | não |

### Simulação (2.250 pessoas, 6 cidades, 24 semanas, fazenda de 2.000 contas)

| Ataque | % que vê ataque, Fase 1 | Modelo completo (Fases 2–3) |
|---|---|---|
| fazenda com follow-back 10% | 0,0% | 0,3% |
| fazenda camuflada / revezando / paciente | 0,0% | 0,2% |
| eclipse (30% dos clientes em relays do atacante) | 0,0% | 0,2% |
| enganados (10%) + isca do fazendeiro | 0,0% (pico 8%) | 1,8% |
| contas da fazenda postando isca (conteúdo bom) | **1,4%** (pico 7%) | 0,2% |

Ordem de chegada embaralhada: 0 diferenças em 840 feeds por rodada. Custo
da Fase 1: o post mais viral alcança ~38% das pessoas pela aba (o modelo
completo, com encontros físicos e o mapa da área, chega a 82–92%). A aba
é opcional e as outras continuam lá.

### Edge cases

- Sem follows → aba vazia, com convite a seguir (não há fallback global).
- Desfazer um SINK (impulsionar o post de novo) apaga a experiência ruim
  **daquele** post: corrigir engano, não esquecer com o tempo — o atacante
  não tem como provocar isso no lugar do leitor.
- Enterrar e denunciar o mesmo post contam uma vez (uma linha por pessoa e
  post em `contagion_strikes`).
- Experiências ruins são permanentes: na simulação, deixá-las expirar em
  30 dias fez "enganados + isca" voltar de 2,1% para 20,1% (TrustGuard,
  WWW 2005, descreve o ataque de quem oscila).
- "Quem trouxe" é inferido na hora a partir dos vínculos do leitor e fica
  em memória: nada de proveniência é publicado (`cascade.ts`, §28).
- A moderação comunitária global (§3) continua valendo: post com
  `score = −999` não aparece em aba nenhuma.

### Manifesto

§24 (emendado), §7 (determinismo: mesmas entradas, mesmo feed), §28
(tudo local, nada publicado), §26 (moderação global preservada).

---

## Apêndice — invariantes que NUNCA podem quebrar (LOCK_VIA_TEST)

| Invariante | Arquivo | Manifesto |
|---|---|---|
| Mesmo conjunto de eventos em qualquer ordem → mesmos scores/pesos/moderação | `tests/algorithm-invariants.test.ts` §2 | §7 |
| Chave sem âncora OTS não gera peso (backdating, lavagem, anel) | `tests/algorithm-invariants.test.ts` §3 | §22, §33 |
| Moderação não se desfaz com spread novo nem com rajada de boot | `tests/algorithm-invariants.test.ts` §4 | §26 |
| Prova OTS só ancora se conferir com header Bitcoin | `tests/algorithm-invariants.test.ts` §6, `tests/ots.test.ts` | §22 |
| `calculateScore` é determinístico (mesmo input → mesmo output) | `tests/scoring.test.ts` | §7 |
| `calculateWeight` é função pura (sem `Date.now()`) | `tests/weight.test.ts` | §7, §22 |
| `getReportThreshold` é função pura | `tests/moderation.test.ts` | §7, §26 |
| `s_local` NUNCA escrito em `posts.score` | `tests/trust-lens-conformance.test.ts` #2 | §24 |
| `strength=0` → `multiplier=1.0` bit-exact | `tests/trust-lens-math.test.ts` #19 | §24 |
| `computeInfluence` ∈ (0, 1) bounds | `tests/trust-lens-math.test.ts` #10 | §22 |
| `temporalDecay` ∈ (0, 1] + monotonic | `tests/trust-lens-math.test.ts` #22-#27 | §7 |
| Feed canônico inalterado pra users sem lens habilitada | `tests/feed.test.ts` | §24 |
| Contas só seguidas nunca passam o limiar da aba Contágio, por mais que sejam | `tests/contagion.test.ts` | §24, §22 |
| Aba Contágio: mesma entrada em qualquer ordem → mesmos veredictos e mesmo "quem trouxe" | `tests/contagion.test.ts` | §7 |
| Impulsionar nunca tira um post da aba Contágio (monotonia) | `tests/contagion.test.ts` | §7 |
| As 4 abas usam a mesma ordenação canônica (`FEED_ORDER`) | `tests/score-decay-parity.test.ts`, `tests/scoring-pipeline-conformance.test.ts` | §8, §24 |
| Experiências ruins do leitor só mexem na aba dele; o global não muda | `tests/contagion.test.ts` | §24 |

---

*Última atualização: 2026-11-05 (§9 — contágio local, aba Contágio,
Fase 1; manifesto §24 emendado). Anterior: 2026-11-03 (auditoria do
algoritmo — motor global, âncora OpenTimestamps, moderação derivada). Source-of-truth está no código —
quando este doc divergir, código vence. Reportar dessincronia via
issue ou pair-review HIMYM.*
