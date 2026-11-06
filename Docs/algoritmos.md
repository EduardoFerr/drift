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
> - `src/lib/trust/{ppr,edges,constants}.ts` — proximidade (PPR) e
>   arestas da lente; hoje colorem o mapa da sua rede (§4, §5)
> - `src/lib/lens/order.ts` (+ `lens/strategies/*`, `feed.ts:withLens`) —
>   a lente no feed, abas Global e Em alta (§6; ligada em 2026-11-06)
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
6. [Lente no feed — a mistura](#6-lente-no-feed--a-mistura)
7. [Trust Lens — Temporal decay (GAP-1, sem efeito hoje)](#7-trust-lens--temporal-decay-gap-1-sem-efeito-hoje)
8. [Cenários integrados (fim-a-fim)](#8-cenários-integrados-fim-a-fim)
9. [Contágio local — aba Contágio (Fase 1)](#9-contágio-local--aba-contágio-fase-1)

---

## 1. Score canônico de post

**Onde:** `src/lib/ranking.ts:computeRanking` (numerador) +
`src/lib/feed.ts:DECAYED_SCORE` (decay na leitura) +
`src/lib/scoring.ts` (fórmula pura)
**Manifesto:** §7 (determinismo), §22 (score não-subjetivo), §24 (ordem
igual nas abas; a lente, opcional, é a exceção — §6)

### Conceito

O score é o número que ordena o feed canônico. **Igual pra todos os
clientes Drift que têm o mesmo conjunto de eventos** — sem
personalização. Combina engajamento ponderado (peso de quem espalhou,
enterrou e comentou) com decaimento temporal (posts ficam relevantes
por horas, não minutos). O score nunca muda por pessoa; quem liga a lente
(§6) muda só a ordem que o próprio aparelho mostra nas abas Global e Em
alta.

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

**Onde:** `src/lib/trust/ppr.ts:computePprExact` (o app) e
`computePpr` (o mesmo passeio por sorteio, referência dos testes)
**Manifesto:** §7 (determinismo), §28 (local-only)
**Uso hoje:** cores do mapa da sua rede e pontes. A ORDEM do feed não usa
PPR (§6): na produção o grafo é só você → quem você segue, e o PPR dá o
mesmo valor (1/n) a todo mundo que você segue.

### Conceito

Passeio aleatório a partir do `source` (sua identidade): quanto mais o
passeio passa por alguém, mais "perto" essa pessoa está no grafo. O app
calcula a **média exata** desse passeio, passo a passo
(`computePprExact`, desde 2026-11-06): sem sorteio, sem relógio, com soma
em ordem fixa — mesma rede, mesmos números em qualquer aparelho e em
qualquer dia. Antes era Monte Carlo com semente pessoa + dia e a rede lida
do banco sem ORDER BY: dois aparelhos podiam discordar e o valor mudava à
meia-noite (UTC). Teste: `tests/trust-lens-ppr-exact.test.ts` (valores à
mão, 50 ordens de chegada bit a bit, convergência do Monte Carlo para o
exato).

### Algoritmo (o passeio)

```
for k in 1..K:
  current = source
  for step in 1..L:
    if rng() < α: break                  // para (damping)
    next = sampleNeighborByInfluence(current)
    if next is null: current = source; continue   // beco: volta ao leitor, sem visita
    current = next
    if current != source: visits[current] += 1
if totalVisits == 0: return empty Map    // cold-start guard
for target in visits: ppr[target] = visits[target] / totalVisits
```

O exato faz a mesma conta com a massa de probabilidade em vez de K
sorteios: a cada passo, a massa de cada nó para com α, o resto vai aos
vizinhos na proporção da influência (beco → volta ao leitor), e a massa
que chega a um nó (≠ leitor) soma visitas.

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
`getPprForAuthor()` retorna 0 → o mapa usa a cor padrão. (A lente do feed
não lê PPR — §6.)

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

## 6. Lente no feed — a mistura

**Onde:** `src/lib/lens/order.ts:mixNetwork` (a regra) +
`src/lib/lens/strategies/ppr-trust.ts` (a lente "quem você segue
primeiro") + `src/lib/feed.ts:withLens` (só Global e Em alta) +
`src/lib/contagion-data.ts:lensNetworkAuthors` ("sua rede")
**Manifesto:** §24 (algoritmo público, entradas suas — a lente é a
exceção explícita à ordem igual nas abas Global e Em alta), §7
(determinismo), §28 (nada gravado nem publicado)
**Simulação:** `Docs/simulacao-lente/` (página "Drift: lente no feed")

### Conceito

A lente é opcional e começa desligada. Ligada, ela põe posts de **quem você
segue** entre os primeiros das abas **Global** e **Em alta**: com força k
(0 a 100), k de cada 100 lugares da aba vão para posts da sua rede, na
ordem de sempre (§1); os outros lugares, para o resto, também na ordem de
sempre. Com 50, um card sim, um não; com 100, primeiro os posts da sua
rede. De cada pessoa entram no máximo 2 posts (os de mais pontos, de até 7
dias). Seguindo e Contágio não mudam: as duas já são feitas da sua rede.

Ela roda no aparelho a cada leitura do feed. Nada é gravado em `posts`,
nada é publicado; desligada, a aba volta à ordem de todo mundo.

### "Sua rede"

Quem você segue, sem você mesmo, sem bloqueados e sem silenciados, e sem
nenhuma experiência ruim com a pessoa: **uma denúncia basta**. Usa o
vínculo da aba Contágio (§9) com corte mais alto — `tie(u) ≥ 5` (o valor
de "você segue") em vez de `> 0`. Uma denúncia sua de um post dela, ou um
post que você denunciou e que chegou por ela na aba Contágio, tira 5; nem
quem você já impulsionou (8) fica: 8 − 5 = 3 < 5. Na aba Contágio a mesma
pessoa ainda pode trazer posts com vínculo 3; na lente, não.

Só quem você segue diretamente conta. O app guarda a sua lista de quem você
segue (NIP-02), não a dos seus contatos; o PPR (§5) nesse grafo de um
salto dá o mesmo valor a todo mundo que você segue, então a ordem não usa
PPR. Amigos de amigos só entram quando o app tiver a lista deles **e** uma
defesa contra contas falsas seguidas por um contato
(`Docs/known-limitations.md`).

### Regra

```
aba   = os N primeiros na ordem canônica (§1; N = 50)
rede  = posts da sua rede de até 7 dias (Em alta: as 24 h da aba), com
        score ≥ 0, mesmo relógio da aba, no máximo 2 por pessoa (os 2
        primeiros dela na ordem canônica) e, só depois do teto, os N
        primeiros na ordem canônica — podem estar fora da aba. (O teto vem
        antes do limite N no SQL: senão quem posta sem parar ocuparia as N
        linhas.) Ordem dentro de `rede`: primeiro os que já estão na aba,
        na ordem da aba; depois os de fora, na ordem canônica. Post lido
        nas duas consultas vale como está na aba.
resto = posts da aba que não estão em `rede`, na ordem canônica

para p = 0, 1, …, (tamanho da aba − 1):
  cota(p) = ⌊(p + 1) · k / 100⌋
  se ainda há post em `rede` e
       (posts da rede já postos < cota(p)            ← a cota
        ou o lugar que o próximo da rede tinha na aba ≤ p   ← nunca rebaixa
        ou `resto` acabou):
     lugar p ← próximo de `rede`
  senão:
     lugar p ← próximo de `resto`
```

Com k = 0 a função devolve a aba como veio. Só inteiros e comparações: não
há número novo de ponto flutuante, então a ordem é a mesma em qualquer
motor JavaScript.

### Exemplo

A aba tem m1, m2, m3, m4 (de quem você não segue) e, em 5º, s1 (de quem você
segue). Fora da aba há s2, também de quem você segue.

| força | resultado | o que aconteceu |
|---:|---|---|
| 0 | m1 m2 m3 m4 s1 | a ordem de sempre |
| 50 | m1 **s1** m2 **s2** m3 | um sim, um não; s2 entrou, m4 saiu (o fim da aba) |
| 100 | **s1 s2** m1 m2 m3 | primeiro a sua rede |
| 10 | m1 m2 m3 m4 s1 | a cota ainda não chegou (1 a cada 10) |

Se s1 já estivesse em 1º, continuaria em 1º com qualquer força (a lente
nunca rebaixa). Se s1 tivesse score −2 (afundado), ficaria em 5º. Se a
mesma pessoa tivesse s1, s2 e s3, só os 2 de mais pontos subiriam; o
terceiro fica onde a ordem de sempre o põe.

**Por que o teto e a janela.** Sem eles, uma conta seguida que posta 50
vezes por dia ocupa toda a cota da lente (inundação), e post velho da sua
rede ganha lugar de post novo. Com 2 por pessoa e 7 dias, inundar não rende
mais que postar 2 vezes.

### Simulação (2.250 pessoas, 6 cidades, 24 semanas; e uma rede de 225)

Mundo da simulação do contágio, motor real de ranking, desempate do app.
Para cada pessoa, os 8 primeiros da aba. "Mistura" é a função do app
(`mixNetwork`), empacotada e chamada pela simulação. Média das últimas 6
semanas:

| | sem lente | mistura 50 | mistura 100 |
|---|---:|---:|---:|
| dos 8, de quem a pessoa segue (rede grande) | {{sem.comum.fromF}}% | {{sem.M50.fromF}}% | {{sem.M100.fromF}}% |
| idem, rede pequena (225 pessoas) | {{peq.comum.fromF}}% | {{peq.M50.fromF}}% | {{peq.M100.fromF}}% |
| dos 8, vindos de outra cidade | {{sem.comum.poro}}% | {{sem.M50.poro}}% | {{sem.M100.poro}}% |
| pessoas que veem o post honesto de mais pontos | {{sem.comum.reach}}% | {{sem.M50.reach}}% | {{sem.M100.reach}}% |
| fazenda de 2.000 contas: pessoas que veem o spam | {{faz.comum.atk}}% | {{faz.M50.atk}}% | {{faz.M100.atk}}% |
| contas falsas seguidas de volta: veem spam de quem seguem | {{syb.comum.sybF}}% | {{syb.M50.sybF}}% | {{syb.M100.sybF}}% |
| idem, com as pessoas reagindo ao próprio feed (denunciam → sai da rede) | — | {{sybF50.M50.sybF}}% | {{sybF100.M100.sybF}}% |
| idem, aba Seguindo (referência: lá o post de quem você segue sempre aparece) | {{syb.SEG.sybF}}% | | |
| mundo frio (quase ninguém impulsiona): dos 8, de quem a pessoa segue | {{frio.comum.fromF}}% | {{frio.M50.fromF}}% | {{frio.M100.fromF}}% |
| conta seguida que posta sem parar (inundação): dos 8, dela | {{inu.comum.sybF}}% | {{inu.M50.sybF}}% | {{inu.M100.sybF}}% |
| idem, aba Seguindo (referência) | {{inu.SEG.sybF}}% | | |
| post-isca impulsionado por fazenda: pessoas que veem | {{isca.comum.atk}}% | {{isca.M50.atk}}% | {{isca.M100.atk}}% |

Leitura: a mistura entrega o que a tela promete; não chega a 100% porque
cada pessoa segue uns 12 perfis e nem todos postam toda semana. O preço é
um feed mais fechado (mais da própria cidade) e, em 100%, o post mais
pontuado chega a menos gente. A lente **não** é defesa contra fazenda: os
posts da sua rede empurram o spam para baixo em parte das pessoas, mas a
defesa é a aba Contágio (§9). Quem segue de volta uma conta falsa passa a
ver o spam dela no alto — como já via na aba Seguindo — até denunciar: aí a
conta sai da sua rede. Na inundação, o teto de 2 por pessoa deixa a conta
que posta sem parar no mesmo patamar da aba Seguindo. Determinismo: entrada
embaralhada, mesmo feed em todas as amostras.

O que a simulação **não** cobre: o mundo dela é mais quente que o Drift de
hoje (mais votos), todo mundo posta no mesmo ritmo, não há contas-ímã
seguidas por milhares, e "reagindo ao próprio feed" supõe que todas as
pessoas usam a lente na mesma força. Os números são ordem de grandeza, não
previsão.

### Por que não a fórmula de antes (multiplicador)

Até 06/11/2026 esta seção descrevia `s_local = s_global × clip(1 + 1,5·k·
log(1 + 100·ppr)/log(101) + 0,4·k·mútuos, 0,1, 3,0)`, e nenhuma parte do
app a aplicava (o PR-4b, de 17/05, foi reduzido "sem tocar feed.ts"; o
PR-5 entregou só a tela). Ligada como estava escrita, na simulação:

- **não fazia nada:** na rede grande, {{sem.A100.fromF}}% dos 8 primeiros
  de quem a pessoa segue (sem lente: {{sem.comum.fromF}}%). Post sem voto
  tem score 0, e 0 × 2,5 = 0 — no Drift de hoje, quase todo post;
- **score negativo de quem você segue descia mais** (× 2,5 empurra para
  baixo);
- **ficava mais fraca quanto mais gente você segue:** o PPR de cada um é
  1/n;
- **não era determinística:** o PPR por sorteio usa semente pessoa + dia e
  a lista lida do banco sem ORDER BY — dois aparelhos com os mesmos eventos
  podiam ver ordens diferentes, e ela mudava sozinha à meia-noite (UTC);
- **só reordenava os 50 da aba:** posts da sua rede raramente estão lá.

O multiplicador consertado (proximidade exata, sinal certo) ficou em
{{sem.B100.fromF}}%; "cada post da sua rede passa à frente de até força ×
50" ficou em {{sem.R100.fromF}}% (rede pequena: {{peq.R100.fromF}}%).

### O que aparece na tela

- Card adiantado pela lente: chip **lente** no canto (com "destacar o que a
  lente adiantou" ligado, preenchido e com ↑). Toque: "Você segue …; com a
  sua lente em k%, k de cada 100 cards…; sem a lente, este post estaria em
  Xº; com ela, está em Yº" (ou "estava fora dos primeiros da aba").
  `Post.lensLift = { from, to }`, só em memória.
- Tela "sua lente": a força em palavras ("1 em cada 2 cards é de quem você
  segue"), a regra inteira em "como funciona".

### Edge cases

- Sem ninguém na sua rede → a aba de sempre, com qualquer força.
- Seus próprios posts nunca sobem (você não está na sua rede).
- Post escondido pela comunidade (score = −999) não aparece em aba nenhuma,
  com ou sem lente.
- A lente cronológica (a outra do app): os mesmos posts da aba, do mais novo
  para o mais velho; também só em Global e Em alta.
- Força e lente escolhida ficam em `user_prefs` (`lens_strength`,
  `active_lens`), só neste aparelho.
- Mexer na força, trocar de lente, seguir/deixar de seguir, bloquear ou
  silenciar refaz a aba (debounce de 150 ms, `startFeedLensSync`).
- A leitura usa um relógio só: a aba e os posts da sua rede são pontuados no
  mesmo instante.
- Dois aparelhos seus podem mostrar ordens diferentes se a lista de quem
  você segue, os bloqueios ou as denúncias ainda não chegaram aos dois — a
  lente usa o que este aparelho tem.
- Se ler os posts da sua rede falhar, a aba sai na ordem de sempre (a lente
  nunca derruba o feed).

### O que NUNCA pode acontecer (LOCK_VIA_TEST)

1. Força 0 mudar a ordem de qualquer aba (`tests/lens-order.test.ts`,
   `tests/lens-feed-pipeline.test.ts`)
2. A lente trazer post de quem não é da sua rede, rebaixar post que ela
   escolheu, trazer mais de 2 posts da mesma pessoa ou post com mais de 7
   dias (`tests/lens-order.test.ts`, `tests/lens-feed-pipeline.test.ts`)
2b. Quem você denunciou uma vez continuar na sua rede, ou uma conta seguida
   que posta sem parar tirar os outros da lente
   (`tests/lens-feed-pipeline.test.ts`)
3. Seguindo ou Contágio mudarem com a lente ligada
   (`tests/lens-feed-pipeline.test.ts`, `e2e/lens-feed.spec.ts`)
4. A ordem depender da ordem de chegada dos eventos ou da lista de quem você
   segue (`tests/lens-feed-pipeline.test.ts`)
5. A lente gravar qualquer coisa no banco (dump igual antes e depois)
6. Post com −999 aparecer

---

## 7. Trust Lens — Temporal decay (GAP-1, sem efeito hoje)

**Onde:** `src/lib/trust/ppr.ts:temporalDecay`
**Shipped:** 2026-05-20 [`2de0fc0`]
**Gating:** `UserPrefs.lens_ppr_decay_enabled` (default `false`)

> **Estado em 2026-11-06:** sem efeito. O decaimento só age em
> `lens_edges` (arestas por interação), que o app nunca preenche — o PPR
> cai no grafo de follows, e a lista NIP-02 não guarda desde quando você
> segue cada pessoa. O toggle "esquecer follows antigos" saiu da tela "sua
> lente" (prometia algo que não acontecia). O código fica para quando as
> arestas por interação forem ligadas (`Docs/known-limitations.md` §4b).

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
- Lente: desligada (força 0)

**Pipeline:**
1. `weight(autor) = antiquity(1 sem)=1 + engagement(0) = 1`
   → autor publica até 1 subpost (cap iniciante)
2. `score_base = 50`, `score = 50 / (0+2)^1.5 = 17.68` (canônico)
3. Lente desligada: a aba sai do SQL exatamente na ordem canônica.

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

### Cenário D — Bia liga a lente em 50%

**Setup:**
- Bia segue Ana e Caio; nunca denunciou nenhum dos dois
- A aba Global tem 50 posts; o primeiro post da Ana está em 12º, sem voto
  (score 0); um post do Caio de ontem está fora dos 50
- Força 50

**Pipeline:**
1. `rede` = posts da Ana e do Caio com score ≥ 0 que passam no filtro da
   Global, na ordem canônica: Ana (12º), Caio (fora)
2. Lugar 0: cota ⌊1·50/100⌋ = 0 → 1º da aba de sempre
3. Lugar 1: cota ⌊2·50/100⌋ = 1 > 0 postos → o post da Ana
4. Lugar 2: cota 1, já posto 1 → 2º da aba de sempre
5. Lugar 3: cota 2 > 1 → o post do Caio (entra; o 50º sai)
6. Daí em diante só o resto, na ordem de sempre

Na tela da Bia: o post da Ana em 2º com o chip "lente" ("sem a lente,
estaria em 12º"). Para quem não ligou a lente — ou não segue a Ana — nada
muda (§24).

### Cenário E — Bia denuncia um spam do Caio

**Setup do Cenário D**, e a Bia denuncia um post do Caio.

**Pipeline:**
1. `tie(Caio) = 5 − 5 × 1 = 0` → o Caio sai da "sua rede" (a mesma regra
   da aba Contágio, §9)
2. Na próxima leitura, os posts dele voltam ao lugar de sempre (ou somem
   da aba, se estavam fora dos 50)
3. A denúncia não se desfaz (é evento publicado e a experiência ruim é
   permanente, §9). Se depois a Bia impulsionar um post escrito pelo Caio,
   o vínculo vira `8 − 5 = 3 > 0` e ele volta à sua rede; com duas
   denúncias (`8 − 10`), não volta. Os posts dele continuam na aba Seguindo.

---

## 9. Contágio local — aba Contágio (Fase 1)

### Conceito

Todas as abas usam a mesma ordem (§1; a lente, se o leitor a ligar, muda a
ordem só de Global e Em alta — §6). Global e Em alta mostram os mesmos
posts para todo mundo; Seguindo filtra pelos follows de quem lê. A aba
**Contágio** mostra o que chegou ao leitor **pelas pessoas que ele
segue**, como um vírus que passa de contato em contato: um post entra
quando contatos deram DRIFT nele e a soma da força desses vínculos
chega a 0,8. As regras são públicas e determinísticas; só as
**entradas** são do leitor (quem ele segue, o que ele já impulsionou, o
que ele denunciou, quem ele bloqueou, de quem ele não quer mais receber
recomendações). A **ordem** dentro da aba continua a canônica (§1).
Manifesto §24, emendado em 2026-11-05.

Por que existe: numa ordem global igual para todos, uma fazenda de
contas paciente compra o topo de todo mundo de uma vez. A simulação
(`Docs/simulacao-contagio/`, `Docs/spec-revisao-contagio.md`) mostrou a
fazenda de 2.000 contas no feed de 100% das pessoas no modelo global e
abaixo de 0,3% no contágio local. É o resultado de Cheng & Friedman
(2005): nenhuma reputação simétrica resiste a contas falsas; as
assimétricas, calculadas a partir de quem olha, podem resistir.

### Fórmula (décimos inteiros — a soma não depende da ordem)

```
tie(u) = 0                                   se o leitor não segue u ou o bloqueou
       = max(0, base(u) − 5 × ruins(u))      senão
base(u) = 8   se o leitor já impulsionou algo que u escreveu (ação líquida)
        = 5   se só segue
ruins(u) = posts distintos que o leitor DENUNCIOU e que eram de u, ou que
           chegaram por u e foram denunciados na aba (permanente)

Σ⁺(S) = Σ tie(u) dos u em S com tie(u) > 5  +  min(Σ tie(u) dos com tie(u) ≤ 5, 5)
        ← teto: os vínculos fracos (≤ 0,5) somam no máximo 0,5

Para cada post p (nunca os do próprio leitor), usando a AÇÃO MAIS RECENTE
de cada contato em p (no empate exato, o SINK) e ignorando a ação do
próprio autor em p:
  traz(p)       = Σ⁺(contatos com DRIFT em p nas últimas 48 h,
                     menos os marcados "não trazer mais")
  vacina(p)     = Σ⁺(contatos com SINK em p nas últimas 96 h)
  quarentena(p) = Σ⁺(contatos que denunciaram p nos últimos 14 dias)
                  ← na vacina e na quarentena, os marcados "não trazer mais"
                    entram na parte dos fracos (teto 5), seja qual for o vínculo
  direto(p)     = autor seguido com tie > 0 e post com até 72 h

p entra ⇔ quarentena(p) < 10
        ∧ 10·direto(p) + traz(p) − vacina(p) > 0
        ∧ (direto(p) ∨ (idade(p) ≤ 4 dias ∧ traz(p) ≥ 8))
```

O **teto para vínculos fracos** é a peça central: contas que o leitor só
segue somam no máximo 0,5 por post, então nunca passam o limiar sozinhas,
por mais que sejam, revezem, camuflem o histórico ou se escondam atrás de
relays. Ele vale do mesmo jeito na vacina e na quarentena: contas só
seguidas também não escondem nada sozinhas (difamação). Só usa os
vínculos do próprio leitor: não depende de dado global.

**Experiência ruim é a denúncia.** O SINK do leitor é gosto (manifesto
§23): vacina o post para quem o segue e tira o post da tela dele, mas
não pune ninguém. Cada denúncia feita no aparelho grava a experiência
ruim com o autor (em qualquer aba) e, se feita na aba Contágio, com cada
contato que a pílula "↪ chegou por" mostrava quando a denúncia foi aberta
(`contagion_bad_experiences`, local). Denúncias do leitor vindas de outro
aparelho também contam contra o autor, pela tabela `reports` (com o alvo
da tag `p` quando o post não está no cache); o cache não apaga posts que
o leitor denunciou.

**Gesto "não trazer mais por X".** Tocar na pílula "↪ chegou por" abre a
folha "chegou por", com um botão por pessoa. O gesto corta as
recomendações de X: os DRIFTs dele param de trazer post, e o SINK (vacina)
e a denúncia (quarentena) dele passam a pesar como os de quem o leitor só
segue — sozinho, X não esconde nada. Os posts que X escreve continuam
entrando direto. Não pune ninguém (o vínculo não muda), não é publicado
(tabela local `contagion_no_bring`) e se desfaz na própria folha
("desfazer") ou em config → conteúdo → listas → não trazem. É o jeito de
dizer "esse contato me traz lixo" sem denunciar post honesto e sem deixar
de seguir em público.

Por que o SINK e a denúncia de X também caem: na primeira versão eles
continuavam com o vínculo inteiro. Uma conta de isca cortada — e por isso
nunca mais denunciada, porque o leitor deixa de ver o spam dela — ficava
com 0,8 para sempre e podia esconder post honesto: sozinha, a vacina dela
anula o que chegou por um vínculo forte; com qualquer conta só seguida, a
quarentena passa de 10 (revisão em par de 05/11/2026; tabela abaixo).

### Exemplo

Bia segue Ana (já impulsionou um post dela → 0,8), Caio e Duda (só segue
→ 0,5 cada).

| Post | O que aconteceu | Conta | Entra? |
|---|---|---|---|
| X | Ana deu DRIFT há 3 h | traz 8 | sim, "↪ chegou por Ana" |
| Y | Caio e Duda deram DRIFT | traz min(5 + 5, 5) = 5 | não |
| Z | Ana deu DRIFT; Caio e Duda denunciaram | quarentena min(5 + 5, 5) = 5 < 10 | sim (fracos não escondem) |
| Q | Post de Duda de ontem; Ana e Caio denunciaram | quarentena 8 + 5 = 13 | não |
| W | Post de Caio de ontem; Ana deu SINK | direto: 10 − 8 = 2 > 0 | sim, sem pílula |
| V | Ana deu DRIFT; Bia já denunciou 2 posts que vieram pela Ana | tie(Ana) = 8 − 10 → 0 | não |
| S | Ana deu DRIFT; Bia já deu SINK em 5 posts da Ana | tie(Ana) = 8 (SINK não pune) | sim |
| N | Ana deu DRIFT; Bia marcou "não trazer mais por Ana" | traz 0 | não (posts da própria Ana continuam entrando) |
| M | Post de Caio de ontem; Ana, marcada "não trazer mais", deu SINK e denunciou | vacina e quarentena min(8, 5) = 5: 10 − 5 = 5 > 0 e 5 < 10 | sim (marcada, a Ana sozinha não esconde) |

### Simulação (2.250 pessoas, 6 cidades, 24 semanas, fazenda de 2.000 contas)

| Ataque | % que vê ataque, Fase 1 (app) | Modelo completo (v7, Fases 2–3) |
|---|---|---|
| fazenda com follow-back 10% | 0,0% | 0,3% |
| fazenda camuflada / revezando / paciente | 0,0% | 0,2% |
| eclipse (30% dos clientes em relays do atacante) | 0,0% | 0,2% |
| difamação (a fazenda enterra e denuncia post honesto) | 0,0% | — |
| enganados (10%) + isca do fazendeiro | 0,1% (pico 9%) | 1,8% |
| contas da fazenda postando isca (conteúdo bom) | **2,9%** (pico 11%) | 0,2% |

Rodadas `fase1__*` da bateria: a configuração do app sem ninguém usar o
gesto "não trazer mais" (limite conservador). Ordem de chegada
embaralhada: 0 diferenças em 840 feeds por rodada. Custo da Fase 1: o post mais viral alcança ~38%
das pessoas pela aba (29% com 10% de SINK por gosto; 27% sob eclipse); o
modelo completo, com encontros físicos e o mapa da área, chega a 82–92%.
A isca é o que mais passa: acima de 5% das pessoas em metade dos dias da
simulação, até o lockstep da Fase 2. **Ela depende de quanto as pessoas
denunciam**: a simulação supõe denúncia em 35% dos spams vistos; com 10%,
a isca vai a 12,4%; com 5%, a 22,3% (revisão em par, 05/11/2026). A
aba é opcional e as outras continuam lá.

**O gesto "não trazer mais por X" na simulação** (rodadas `gesto_r*_c*`:
r = % dos spams vistos que a pessoa denuncia; c = % das vezes que ela
usa o gesto contra quem trouxe o spam). Média das últimas 6 semanas, %
das pessoas que veem ataque:

| Ataque | denúncia 35% · sem gesto / 20% / 40% | denúncia 10% · sem gesto / 20% / 40% |
|---|---|---|
| isca (contas da fazenda postando conteúdo bom) | 2,9 / 1,8 / 1,6 | 12,4 / **4,8** / 2,6 |
| isca + 10% enterrando por gosto | 2,3 / 1,5 / 1,4 | 11,7 / 3,8 / 2,5 |
| enganados (10%) + isca | 0,1 / 0,1 / 0,1 | 2,5 / 2,5 / 2,5 |
| sem ataque (alcance do post mais viral) | 37,8 / 37,8 / 37,8 | 37,8 / 37,8 / 37,8 |
| isca que difama — leitores com post honesto escondido, **regra do app** (cortado pesa como fraco) | 0,5 / 0,4 / 0,2 | 2,7 / **0,4** / 0,2 |
| isca que difama — idem, **primeira versão** (cortado seguia com o vínculo inteiro) | 0,5 / 12,3 / 18,3 | 2,7 / **26,9** / 31,1 |

O gesto segura a isca mesmo quando quase ninguém denuncia. Sem ataque,
nada muda — mas a simulação só usa o gesto contra spam: quem corta um
contato por gosto deixa de receber o que ele traria, como ao deixar de
seguir. Ele **não ajuda** quando o spam vem direto de alguém que a pessoa
segue (os enganados seguem o fazendeiro): ali, só denunciar ou deixar de
seguir. A última linha é o porquê da regra: com o vínculo inteiro, a isca
cortada escondia post honesto de até 31% dos leitores e deixava 7,6% das
abas quase vazias (rodadas `gesto_forte_*`).

Onde a simulação difere do app: na simulação, "quem trouxe" é um contato
só (no app, todos os empatados), o SINK de contato vale 2 dias (no app,
96 h) e o feed medido são os 8 primeiros por pontuação de contágio (no
app, tudo o que passa, até 50, na ordem canônica). A simulação também não
aplica a moderação global (−999): uma brigada que esconda post honesto no
Global esconde na aba Contágio também.

### Edge cases

- Sem follows → aba vazia, com convite a seguir (não há fallback global).
- Por que o SINK não pune: na simulação, com cada pessoa enterrando 10%
  dos posts honestos por gosto, punir no SINK zerava 25% dos vínculos
  honestos e derrubava o alcance de 29% para 5%. O preço é a isca passar
  mais (2,9% × 1,4% das pessoas). Detalhes em
  `Docs/spec-revisao-contagio.md` §4.6.
- Denunciar o mesmo post de novo conta uma vez (uma experiência ruim por
  pessoa e post).
- "Quem trouxe" = os contatos de maior vínculo que deram DRIFT. Com
  empate, cada um leva −0,5 inteiro (ninguém escapa escolhendo a própria
  chave), e a pílula mostra todos ("Ana, Bia +1"). A denúncia pune
  exatamente os que a pílula mostrava quando foi aberta, mesmo que a aba
  recalcule no meio.
- Post direto não tem "quem trouxe": veio pelo follow no autor (nem
  pílula, nem culpa de terceiros).
- Experiências ruins são permanentes: na simulação, deixá-las expirar em
  30 dias fez "enganados + isca" voltar de 2,1% para 20,1% (TrustGuard,
  WWW 2005, descreve o ataque de quem oscila). A denúncia também é evento
  imutável (§6).
- "Quem trouxe" é inferido na hora a partir dos vínculos do leitor: nada
  de proveniência é publicado (`cascade.ts`, §28). O registro de quem
  trouxe o que o leitor denunciou fica em cada aparelho. A parte do autor
  sobrevive à limpeza do cache; num aparelho novo, contam as denúncias
  que o sync trouxe.
- Ação do próprio autor no próprio post não conta (como no ranking
  canônico): republicar o DRIFT não mantém um post velho na aba.
- Bloquear tira a pessoa da conta (não traz, não vacina, não denuncia);
  silenciar só esconde os posts dela; "não trazer mais" tira os DRIFTs
  dela e põe o SINK e a denúncia dela no balde dos fracos (os posts dela
  continuam entrando direto).
- O marcado "não trazer mais" nunca traz post nem vira "quem trouxe" e,
  sozinho, não esconde nada; marcar só muda posts em que ele agiu — e pode
  devolver à aba um post que só ele tinha vacinado. Não mexe no vínculo
  (não é experiência ruim) e vale por identidade: trocar de identidade no
  aparelho não leva a lista junto.
- A folha "chegou por", a lista "não trazem" e o aviso da denúncia mostram
  o nome com o começo e o fim da chave (1a2b3c4d…5e6f7a8b, 64 bits): copiar
  o nome de um amigo é fácil, copiar também a chave é inviável (só o fim,
  6 caracteres, sairia em minutos numa CPU comum).
- A aba só se atualiza quando a folha "chegou por" fecha, mesmo que chegue
  evento do relay com ela aberta (`holdFeed` em `feed.ts`): atualizar antes
  tiraria o post, e a folha junto, no meio da ação.
- SINK de contato vale 96 h, enquanto o post ainda pode entrar; senão o
  atacante republicaria o DRIFT depois que a vacina expirasse.
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
| A lente nunca grava nada no banco (dump igual antes e depois) | `tests/lens-feed-pipeline.test.ts`, `tests/trust-lens-conformance.test.ts` #2 | §24, §28 |
| Lente com força 0 = a ordem de sempre, bit a bit, em todas as abas | `tests/lens-order.test.ts`, `tests/lens-feed-pipeline.test.ts` | §24 |
| Lente: só Global e Em alta; Seguindo e Contágio não mudam | `tests/lens-feed-pipeline.test.ts`, `e2e/lens-feed.spec.ts` | §24 |
| Lente: nunca traz post de fora da sua rede, nunca rebaixa post da sua rede, não adianta post afundado nem ressuscita −999 | `tests/lens-order.test.ts`, `tests/lens-feed-pipeline.test.ts` | §24, §26 |
| Lente: mesma entrada em qualquer ordem de chegada → mesma aba; mais força nunca põe post da rede mais abaixo | `tests/lens-order.test.ts`, `tests/lens-feed-pipeline.test.ts` | §7 |
| Lente: quem você denunciou sai da sua rede (o mesmo vínculo da aba Contágio) | `tests/lens-feed-pipeline.test.ts` | §24 |
| PPR exato: mesma rede em qualquer ordem → mesmos números, bit a bit; sem relógio | `tests/trust-lens-ppr-exact.test.ts` | §7 |
| `computeInfluence` ∈ (0, 1) bounds | `tests/trust-lens-math.test.ts` #10 | §22 |
| `temporalDecay` ∈ (0, 1] + monotonic | `tests/trust-lens-math.test.ts` #22-#27 | §7 |
| Contas só seguidas nunca passam o limiar da aba Contágio, por mais que sejam | `tests/contagion.test.ts` | §24, §22 |
| Aba Contágio: mesma entrada em qualquer ordem → mesmos veredictos e mesmo "quem trouxe" | `tests/contagion.test.ts` | §7 |
| Impulsionar nunca tira um post da aba Contágio (monotonia) | `tests/contagion.test.ts` | §7 |
| As 4 abas (e os candidatos da lente) saem do SQL na mesma ordenação canônica (`FEED_ORDER`) | `tests/score-decay-parity.test.ts`, `tests/scoring-pipeline-conformance.test.ts` | §8, §24 |
| Experiências ruins do leitor só mexem na aba dele; o global não muda | `tests/contagion.test.ts` | §24 |
| Contas só seguidas não escondem nada sozinhas (teto também na vacina e na quarentena) | `tests/contagion.test.ts` | §24, §26 |
| "Não trazer mais por X": X nunca traz nem vira "quem trouxe"; sozinho, não esconde nada; marcar só muda posts em que X agiu | `tests/contagion.test.ts` | §24 |
| SINK do leitor não pune ninguém na aba Contágio | `tests/contagion.test.ts`, `e2e/contagion-tab.spec.ts` | §23 |
| Denúncia fora da aba nunca pune quem trouxe | `e2e/contagion-tab.spec.ts` | §24 |

---

*Última atualização: 2026-11-06 (§6 — a lente ligada ao feed: a mistura,
só em Global e Em alta, "sua rede" = vínculo da aba Contágio; §5 — PPR
exato; §7 — decaimento sem efeito hoje). Anterior: 2026-11-05 (§9 —
contágio local, aba Contágio, Fase 1; manifesto §24 emendado; revisão em
par: teto simétrico, só a denúncia pune, "↪ chegou por"). Antes: 2026-11-03 (auditoria do
algoritmo — motor global, âncora OpenTimestamps, moderação derivada). Source-of-truth está no código —
quando este doc divergir, código vence. Reportar dessincronia via
issue ou pair-review HIMYM.*
