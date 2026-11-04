# Auditoria algorítmica do Drift — prova e contra-prova

**Data:** 2026-11-03 · **Base auditada:** `07c06f8`

> **Status: todos os achados corrigidos** no mesmo ciclo. A evidência
> executável dos defeitos (`tests/audit/algorithm-audit.test.ts`, com
> testes `[BUG]` que passavam quando o defeito existia) foi substituída
> por **invariantes** em `tests/algorithm-invariants.test.ts`, que
> afirmam o comportamento correto, rodando o pipeline real (SQLite real)
> contra os mesmos ataques. A tabela abaixo liga cada achado à correção e
> ao teste que a trava. O restante do documento preserva a auditoria
> como foi feita (descrição dos defeitos na base `07c06f8`).

## Status das correções

| Achado | Correção | Teste que trava |
|---|---|---|
| M1 post moderado ressuscita | moderação derivada em `ranking.ts` a cada recomputação global — não existe mais `-999` sobrescrevível | invariantes §4 "continua moderado quando chega spread novo" |
| M2 reports < 100 ms apagados | idem (sem recálculo por post) | §4 "reports que chegam junto com o post" |
| S1 backdating | antiguidade = âncora OpenTimestamps verificada no Bitcoin (NIP-03, `ots*.ts`); `created_at` não conta | §3 "backdating NÃO dá antiguidade", §6 |
| S2 lavagem / anel Sybil | engajamento ponderado pelo peso de quem espalhou (ponto fixo global) | §3 "lavagem", "anel mútuo", "confiança FLUI" |
| S3 antiguidade local | âncora é global (bloco Bitcoin) | §3 "dois clientes com históricos diferentes concordam" |
| S4 peso congelado | recomputação global + re-derivação na virada do dia UTC | §3 "peso acompanha o tempo" |
| P1 cursor envenenado | gate `MAX_FUTURE_SKEW_SECONDS` (15 min) + `advanceCursor` clampado + cura no boot | §1 "descartado na entrada", §5 "cursor", "curado no boot" |
| A1/A2 última ação / ordem | upsert LWW em spreads/buries/reports | §2 incl. propriedade com 12 embaralhamentos |
| C1 boost de futuro | `max(0, idade)` na SQL + gate | §1 "+10 min NÃO ganha boost"; `score-decay-parity` com idade negativa |
| M3 brigada barata | pontos de report = peso/50 (chave sem peso = 0) | §4 "brigada de 50 chaves novas" |
| C2 comentários fora do feed | comentários no numerador; sync global de kind 1111 em posts Drift | §1 "comentários … entram na ORDEM do feed" |
| P2 órfãos | busca por id (`orphans.ts`) + busca de provas OTS por autor | §5 "dispara busca do post por id" |
| P3 rebroadcast truncado | categorias com teto próprio, votos e provas primeiro | §5 + `tests/rebroadcast.test.ts` |
| Cascata antimeridiano | distância de longitude pela volta curta | §7 |
| Doc 0.43 / PPR dead-end / Cenário C | `Docs/algoritmos.md` reescrito (§1–3, §5, §8) | — |

Trade-offs novos e abertos: `Docs/known-limitations.md` §5d (partida a
frio do peso), §5e (Tor não verifica âncoras), §5f (convergência exige
mesmo conjunto de eventos), §5g–§5k.

### Revisão pré-merge (2026-11-04)

Três pares de revisão independentes leram o diff antes do merge. A
revisão adversarial provou que a primeira versão das correções ainda
falhava no ponto central: o engajamento contava **uma aresta por post e
sem orçamento**, então uma única âncora de 1 dia num anel de chaves
saturava o anel inteiro em peso 60, e duas chaves assim "lavavam" um
número ilimitado de outras. Os testes de invariante passavam porque só
testavam o anel **sem** âncora. Corrigido e travado por propriedade:

| Achado da revisão | Correção | Teste |
|---|---|---|
| Amplificação de peso (F1) | endosso com orçamento conservado (≤ 0,5 × peso, uma aresta por par) — contração | invariantes §9 "PROPRIEDADE (contração)", "anel de 12 + 1 âncora", "lavagem" |
| Penalidade absorvida (F2) | −15/inatividade depois do teto | §9 "penalidade… morde" |
| Laço de moderação oscila (F4) | iteração monótona `M ← M ∪ F(M)` | §9 "PROPRIEDADE (moderação fechada)" |
| Chaves de peso 0 sobem threshold (F5) | base ativa ponderada | §9 "10k chaves de peso 0" |
| Fila OTS travável / martela exploradores (F3) | ordem justa, backoff + `unresolved`, ≤ 4 attestations, altura plausível, ≤ 3 provas por alvo, teto de pendentes, concorrência 4 | §9 "ordem justa", "mais de 4 attestations", "altura impossível", "backoff", "3 provas" |
| Decay desfaz moderação na virada do dia | meia-vida contra o report mais recente | §9 "decay… não desfaz" |
| Órfãos × eviction em ciclo | busca só na janela de 7 dias; eviction limpa votos alheios órfãos | `tests/cache.test.ts` |
| Tempestade de REQs | teto de 200 por recomputação, LRU, âncoras só de autores/reporters | — |
| Snapshot não transacional | ações lidas antes dos posts | — |
| Docs/UX (PRIVACY, protocol-spec, GuideCard, perfil, toggle) | atualizados | — |

Aberto como follow-up: recomputação no main thread (known-limitations §5i).

### Segunda rodada (2026-11-04)

O revisor adversarial atacou a versão corrigida. A contração resistiu
(não conseguiu passar de 2× a antiguidade ancorada; rede honesta usável:
veteranos com mediana 48, novatos de 2 semanas com 10). Mas os próprios
fixes abriram brechas, e uma de origem sobrou:

| Achado | Correção | Teste (invariantes §10) |
|---|---|---|
| A7 antiguidade grátis e paralela: 1200 chaves de 1 dia moderam | voto ≥ peso 4, report ≥ peso 20 | "1200 chaves…", "10k chaves de 1 semana" |
| A8 laço monótono over-modera | moderação em ordem histórica com penalidade imediata | "spammer já punido…" + contraprova |
| A9 report de peso 0 "envelhece" os antigos (decay) | `latest` só sobre reports elegíveis | "report de peso 0 chegando agora…" |
| A11 3 lixos bloqueiam a âncora da vítima | prova do próprio autor sempre aceita; inválidas fora do teto | "3 provas-lixo…", "inválidas não contam" |
| A12 5000 lixos barram provas honestas | teto por publicador + despejo do pior | "fila lotada…", "20 por publicador" |
| A13 Tor queima tentativas | sem rede nada é tentado; backoff com teto, sem desistência | "modo Tor/offline", "backoff… sem desistência" |
| A14 inválidas crescem sem limite | conteúdo apagado + teto de linhas | "conteúdo apagado" |
| A15 alturas inexistentes martelam exploradores | topo real consultado (≥2 exploradores) | "altura acima do topo real + 6" |
| A16 eviction apaga a penalidade | documentado (known-limitations §5j) | — |

### Terceira rodada (2026-11-04)

A checagem das correções da segunda rodada confirmou A7–A15 no ataque
original, mas achou 4 buracos novos abertos por elas:

| Achado | Correção | Teste (invariantes §10) |
|---|---|---|
| A18 piso de peso contornado por concentração (4700 chaves de 1 dia → concentrador de peso 60) | piso também de antiguidade própria (votar/endossar ≥ 2 sem., denunciar ≥ 8 sem.); abaixo do piso não endossa | "chaves abaixo do piso não endossam", "denunciar exige 8 semanas" |
| A19 ordem histórica escolhida pelo atacante (retrodatar reports) | moderação conservadora sem ordem | "o resultado NÃO depende dos timestamps" + "PROPRIEDADE (moderação sustentada)" |
| A20 re-solução por post moderado (1000 → 18 s) | 3 soluções no total | bench do revisor: 0,35 s |
| A17 orçamento esgotado queimava tentativas das honestas | SKIP sem custo; despejo por publicador; carimbo do evento mais recente | "orçamento… pula SEM gastar tentativa" |
| A22 provas verificadas crescem sem limite | só a melhor por autor guarda conteúdo; teto por publicador pra todas | "só a melhor prova de cada autor" |

Os 12 ataques escritos pelo revisor nas três rodadas falham contra o
código final.

## Método

As funções puras já tinham muitos testes. Por isso esta auditoria testou o **pipeline real**:

```
evento Nostr → onNostrEvent → persist* → recalculateScore → SQLite → SQL do feed
```

O banco é um SQLite de verdade (`node:sqlite` + `src/lib/schema.sql`). Só a verificação de assinatura é mockada.

Cada funcionalidade tem dois tipos de teste:

- **PROVA**: confirma que a promessa de `Docs/algoritmos.md` vale.
- **CONTRA-PROVA**: tenta quebrar essa promessa.

Testes marcados com `[BUG]` **passam quando o defeito existe**. Eles registram o comportamento de hoje. Quando um defeito for corrigido, o teste dele vai falhar e precisa ser invertido.

```bash
npx vitest run tests/audit/algorithm-audit.test.ts
```

Suíte existente na mesma base: 2242 testes passando e 1 falha intermitente (`no-scan-automatico-conformance`). Essa falha passa quando roda sozinha e não tem relação com o algoritmo.

---

## Resumo do veredito

| Funcionalidade | Funciona como prometido? | Pior achado |
|---|---|---|
| Fórmula do score + decay | ✅ dentro do domínio normal | `created_at` no futuro dá boost de até ~89× (C1) |
| "Última ação vale" (§23) | ❌ | Mudar de ideia 2× é ignorado, e o resultado depende da ordem de chegada (A1, A2) |
| Peso / anti-Sybil (§22, §32) | ❌ | Backdating dá antiquity 40 na hora, e uma "lavagem" via 6 chaves dá engagement 60 (S1, S2) |
| Determinismo entre clientes (§7) | ❌ | Antiquity = "primeiro evento visto por este cliente" (S3) |
| Moderação (§26) | ❌ | O `-999` é sobrescrito por qualquer recálculo, então posts moderados voltam (M1, M2) |
| Propagação / sync | ⚠️ | Um evento datado no futuro trava o sync de quem o recebe (P1) |
| Comentários no score (C.5) | ❌ | Não entram na ordenação do feed (C2) |
| Cascata (mapa) | ✅ honesta e determinística | antimeridiano (menor) |
| Trust Lens | ✅ | nenhum defeito no escopo testado |

**Sobre "como o conteúdo se espalha":** no Drift, "espalhar" **não distribui** o conteúdo. Todo cliente assina os 4 kinds Drift em todos os relays (`sync.ts:254`), então todo post tem o mesmo alcance de entrega. Um spread é só um **voto ponderado** que muda a posição do post no feed. Hoje esse voto pode ser forjado barato (S1, S2), aplicado na ordem errada (A1, A2) e calculado de forma diferente em cada cliente (S3, S4). Em termos práticos, o que "viraliza" no Drift é decidido pelo ranking, e o ranking é o componente mais frágil.

---

## Achados (ordem de severidade)

### 🔴 CRÍTICO

**M1. Post moderado volta ao feed com qualquer spread ou bury novo.**
`recalculateScore` grava `score = …` sem condição (`events.ts:1370`). A moderação só roda quando chega um report (`events.ts:756`). Basta um spread depois da moderação para o `-999` sumir.
- Prova: `PROVA: 10 reports … escondem o post`
- Contra-prova: `[BUG] post moderado RESSUSCITA …`
- Correção: o `UPDATE` precisa preservar `-999`, ou o estado de moderação precisa ficar numa coluna própria (por exemplo `moderated INTEGER`) que o recálculo não toca.

**M2. Reports que chegam menos de 100 ms depois do post são apagados.**
`persistPost` agenda um recálculo com debounce de 100 ms (`events.ts:525`). Se os reports chegarem antes desse recálculo, o `-999` é aplicado e depois sobrescrito pelo recálculo. Isso é o caso **normal** no boot/sync, quando o post e seus reports chegam na mesma rajada. Na prática, a moderação reativa raramente se mantém para quem acabou de abrir o app.
- Contra-prova: `[BUG] reports que chegam < 100ms …`
- Correção: a mesma de M1.

**S1. Backdating dá peso máximo de antiguidade na hora.**
`users.created_at` recebe o `created_at` do **primeiro evento visto** (`events.ts:936`). Esse campo é escolhido livremente por quem assina o evento. Uma chave criada hoje que publica um post datado de 1 ano atrás ganha antiquity 40 de imediato. 10 dessas chaves somam 400 pontos de score_base num post.
- Contra-provas: `[BUG] backdating …` e `[BUG] 10 Sybils backdatados = 400 pontos`
- Isso invalida o **Cenário C** de `Docs/algoritmos.md` ("Sybil weight=0").
- Correção: antiquity precisa de uma âncora que não dê para forjar. Opções: (a) ignorar eventos com `created_at` muito anterior ao momento em que este cliente os recebeu, só para efeito de antiquity; (b) usar OpenTimestamps/NIP-03; (c) derivar a idade do primeiro evento confirmado por N relays independentes.

**S2. Lavagem Sybil: 6 chaves novas transformam qualquer identidade em peso 60.**
`spreads_received` é `COUNT(*)` de eventos (`events.ts:1539`). Ele não pondera pelo peso de quem espalhou. 6 chaves recém-criadas espalham o atacante, e o atacante passa a ter peso 60. Num anel de 7 chaves que se espalham entre si, todas ficam com peso 60. Somando backdating (S1), todas ficam com **peso 100**.
- Contra-provas: `[BUG] lavagem Sybil …` e `[BUG] anel mútuo …`
- Correção: `spreadsReceived` deve ser ponderado pelo peso de quem espalhou (ponto fixo ou PageRank global determinístico), ou pelo menos contar só spreaders com peso ≥ X.

**P1. Um evento com data no futuro envenena o cursor de sync.**
`cursor = max(event.created_at)` (`sync.ts:272`) é persistido com `MAX` (`sync.ts:346`). Um único post com `created_at` daqui a 1 ano faz o próximo boot pedir `since = daqui a 1 ano`. Resultado: nenhum evento armazenado chega mais, e o feed fica congelado até o cursor ser limpo. Qualquer pessoa pode disparar isso contra todo cliente que recebe o evento.
- Contra-prova: `[BUG] UM evento com created_at no futuro envenena o cursor …`
- Correção: limitar o cursor com `min(event.created_at, now + tolerância)`, e/ou descartar eventos com `created_at > now + 15min` no gate de schema.

### 🟠 ALTO

**A1. Mudar de ideia uma segunda vez é ignorado (§23).**
`UNIQUE(post_id, spreader_pub)` (`schema.sql:96`) combinado com `INSERT OR IGNORE` (`events.ts:531`) faz a sequência spread → bury → spread manter o spread *antigo*. O resultado continua sendo bury.
- Contra-prova: `[BUG] spread → bury → spread …`

**A2. O mesmo conjunto de eventos gera scores diferentes conforme a ordem de chegada (§7).**
Como A1 guarda o *primeiro* spread que chegou, e não o mais recente, dois clientes com os mesmos eventos discordam (−12 contra +40 no teste).
- Contra-prova: `[BUG] mesmo conjunto de eventos, ordem diferente …`
- Correção (A1 e A2): `ON CONFLICT(post_id, spreader_pub) DO UPDATE SET created_at=excluded.created_at, event_id=…, raw_event=… WHERE excluded.created_at > spreads.created_at`. O mesmo vale para `buries`. Os reports já têm a mesma pendência anotada em `events.ts:788`.

**S3. A antiguidade é local de cada cliente, então o score não é global.**
Um cliente que viu um post antigo do usuário dá antiquity 28 para ele. Outro, cuja janela de sync é de 7 dias (`sync.ts:43`), dá 0,14. O score do mesmo post diverge entre os dois.
- Contra-prova: `[BUG] antiquity = "primeiro evento visto POR ESTE cliente" …`
- Isso contradiz a premissa central do doc: "todos os clientes Drift do mundo convergem".

**C1. `created_at` no futuro próximo gera um boost enorme no feed.**
A SQL do feed (`feed.ts:57`) não limita a idade negativa, embora `decayDivisor` em TS limite. Com +1,9 h, o divisor fica `0,1^1,5 ≈ 0,03`, e o score sai **~89× maior** com o mesmo engajamento. Com mais de +2 h, `pow` de base negativa devolve `NULL` e o post cai para o fim. A paridade TS↔SQL (que `score-decay-parity.test.ts` afirma existir) quebra fora do domínio testado.
- Contra-provas: `[BUG] … FUTURO próximo …` e `[BUG] … > 2h … NaN/NULL`
- Correção: `pow(max(0, (? - p.created_at) / 3600.0) + 2, 1.5)`, mais um teste de paridade com idade negativa.

**M3. Brigada barata.**
O limite mínimo é 5 pontos (`moderation.ts:132`), e para `illegal` é 3 pontos. Com chaves novas (0,5 ponto cada): 10 chaves derrubam qualquer post, ou 6 chaves com `reason=illegal`. Com o anel de S1+S2 (peso 100 → 2,0 pontos), **3 chaves** derrubam qualquer post em redes com menos de 5000 usuários ativos. Cada moderação ainda custa −15 de peso ao autor, o que gera um efeito cascata.
- Contra-provas: `[BUG] 3 Sybils …` e `[BUG] report "illegal" de 6 chaves …`
- O tier de 0,5 para identidades novas está alto demais enquanto S1 e S2 continuarem abertos.

### 🟡 MÉDIO

**C2. Comentários não afetam a ordem do feed.**
`applyCommentsContribution` soma no `score` materializado, mas o feed ordena por `score_base`, que exclui comentários. Além disso, comentários (kind 1111) só são baixados quando alguém abre a thread (`comments.ts:309`), então o `score` difere entre quem abriu e quem não abriu. Esse `score` alimenta o auto-pin viral (`VIRAL_PIN_THRESHOLD`).
- Contra-prova: `[BUG] contribuição de comentários …`
- Decisão necessária: ou comentários entram em `score_base`, ou essa parte da fórmula é removida do código e de `Docs/algoritmos.md` §1.

**S4. O peso fica congelado no último recálculo.**
`score_base` usa o peso de quem espalhou calculado no momento do recálculo. Antiquity que cresce e inatividade que acumula só são refletidas quando chega um evento novo no post. Isso é aceitável como aproximação, mas é outra fonte de divergência entre clientes.
- Contra-prova: `[BUG] peso fica congelado …`

**P2. Espalhar não ressuscita conteúdo antigo.**
Um spread de um post fora da janela de sync (7 dias / `limit 500` por relay) fica órfão. Nenhum código pede o post por `ids`. Se "espalhar = trazer de volta" é a intenção, falta um fetch-on-orphan.
- Contra-prova: `[LIMITE] spread de post fora da janela …`

**P3. O rebroadcast nunca republica spreads e buries de quem tem mais de 200 posts.**
`UNION ALL … LIMIT 200` coloca os posts próprios primeiro (`rebroadcast.ts:95`), e ainda há um timeout de 8 s com intervalo de 50 ms (≈160 envios). Os votos do usuário nunca chegam ao relay novo.
- Contra-prova: `[BUG] rebroadcast trunca …`

### ⚪ MENOR

- **Cascata:** `planarDist` ignora o antimeridiano (`cascade.ts:30`). Fiji→Samoa vira "longe". Isso afeta só o desenho, e os arcos estimados já são marcados como `inferred`.
- **Diferenças entre o doc e o código:**
  - `algoritmos.md` §1 diz 0,43 para 24 h; o certo é 0,377.
  - §5 diz que, num beco sem saída, o PPR "reinicia"; o código faz `break`.
  - O Cenário C ("Sybil weight=0") é falso (S1, S2).
  - O cabeçalho promete convergência global, o que S3, S4 e A2 contradizem.

---

## O que foi provado e está sólido

- A fórmula do score bate com o doc, e o decay acontece na leitura, sem precisar de job periódico.
- Auto-spread e auto-comentário do autor não contam.
- 100 chaves **realmente** novas (sem backdating e sem lavagem) somam 0.
- O limite de moderação funciona quando os reports chegam depois do recálculo: 10 × 0,5 = 5 esconde o post, e 9 × 0,5 = 4,5 não esconde.
- A cascata marca honestamente os arcos estimados e é determinística.
- Trust Lens: `strength=0` dá multiplicador 1,0 exato; o PPR é determinístico com a mesma seed; os valores de influência batem com o doc.

## Prioridade de correção sugerida

1. **M1 + M2:** separar o estado de moderação do score. É uma mudança pequena e de alto impacto.
2. **P1 + C1:** rejeitar ou limitar `created_at` no futuro. Fecha dois vetores com uma regra só.
3. **A1 + A2:** fazer upsert LWW em spreads e buries.
4. **S1 + S2 + S3:** redesenhar a âncora de antiquity e ponderar `spreads_received`. É a parte grande, porque toca a premissa anti-Sybil inteira.
5. **C2, P2, P3:** decidir o produto e depois atualizar o doc.
