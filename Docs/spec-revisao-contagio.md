# Modelo de contágio do Drift — spec para revisão externa

> **Status (2026-11-05):** Fase 1 implementada (aba "contágio",
> `src/lib/contagion.ts`, `Docs/algoritmos.md` §9; manifesto §24
> emendado). Fases 2–3 planejadas (`BACKLOG.md` "Contágio local").
> Simulação reproduzível em [`simulacao-contagio/`](simulacao-contagio/).
> Este documento existe para que alguém de fora possa refazer as contas,
> discordar delas e apontar o que a simulação não cobre.

## 1. O problema

O Drift ordenava o feed por uma **urna global**: a soma ponderada dos
DRIFTs de todo mundo, igual para todos os clientes (manifesto §24
original), com peso por antiguidade ancorada no Bitcoin (OpenTimestamps).
A primeira simulação mostrou que isso não resiste a quem tem paciência:

- uma fazenda de 2.000 contas, envelhecidas em paralelo, entrou no feed de
  **100%** das pessoas assim que maturou;
- uma brigada de 300 contas moderou **22 de 22** posts honestos que atacou,
  para todo mundo ao mesmo tempo.

Não é falha de calibração; é estrutural. Douceur (2002): sem autoridade
central, criar identidades é barato. Cheng & Friedman (2005): nenhuma
reputação **simétrica** (igual para todos) resiste a contas falsas; as
**assimétricas**, calculadas a partir de quem olha, podem resistir.

A alternativa testada: **contágio local**. Um post chega a você pelas
pessoas com quem você tem vínculo, como um vírus passa de contato em
contato. Não há urna para comprar: há vínculos a conquistar, um de cada vez.

## 2. Regras

Comum a todas as versões: um post entra no feed de quem lê quando
contatos deram DRIFT nele nas últimas 48 h e a soma da força dos vínculos
passa de **0,8**; SINK dos contatos subtrai (vacina); denúncias dos
contatos somando 1,0 escondem (quarentena); a pessoa pode cortar o vínculo
que trouxe spam; posts recentes de quem ela segue entram direto. Pesos em
décimos inteiros (a soma não depende da ordem).

| Versão | O que muda | Força do vínculo |
|---|---|---|
| v1 | mapa da cidade mostra 3 itens de autores a 2 saltos + 1 de desconhecido | encontro 1,0 · follow mútuo 0,8 · follow 0,5 |
| v2 | "conhecido" no mapa exige ser seguido por ≥ 3 contatos | idem |
| v3 | sem o item de desconhecido; mútuo só vale 0,8 com encontro físico | encontro 1,0 · mútuo+encontro 0,8 · follow 0,5 |
| v4 | mútuo também vale 0,8 com DRIFT recíproco em ≥ 2 dias | idem + reciprocidade |
| v5 | vínculo vale 0,8 se **você** já impulsionou algo que a pessoa escreveu | encontro 1,0 · conquistado 0,8 · follow 0,5 |
| v6 | v5 + **aval** (mapa: "conhecido" exige 3 contatos que encontraram ou impulsionaram a pessoa) + **lockstep** (DRIFT de conta com histórico de 30 dias ≥ 40% igual ao de outra vale menos, zero a partir de 80% ou de 15 impulsos idênticos) + **SINK baixa o vínculo** (−0,5 por experiência ruim, permanente) + **período de experiência** (conta com < 5 DRIFTs vale metade) | v5 |
| v7 | v6 + **teto para vínculos fracos**: contatos com vínculo ≤ 0,5 somam no máximo 0,5 por post | v5 |
| **Fase 1 (app)** | v7 **sem** mapa, sem encontro físico, sem lockstep, aval e experiência | conquistado 0,8 · follow 0,5 |

A Fase 1 é o que o app já consegue calcular com os dados que tem: os
follows do próprio leitor, o que ele impulsionou e o que ele enterrou ou
denunciou. Detalhes e exemplo em `Docs/algoritmos.md` §9.

## 3. O mundo simulado

- **Pessoas:** 6 cidades com 250, 300, 350, 400, 450 e 500 habitantes
  (2.250). A, B e C ficam a 20–40 km entre si, D e E a 80–150 km, F a
  ~800 km. 20% entram no dia 0 e o resto até a semana 6.
- **Mobilidade:** 25% trabalham ou estudam em outra cidade e vão e voltam
  nos dias úteis, encontrando 5 colegas fixos; viagens médias (~6% por
  semana) e longas (~3% por semana, quase sempre para F) duram 2–5 dias.
  Encontro físico cria vínculo de 1,0 por 30 dias.
- **Grafo:** cada pessoa segue ~6 pessoas da própria cidade e 1–2 de
  outras; metade é retribuída. **Não há agrupamento de amigos de amigos**
  (ver §5).
- **Comportamento:** abre o app em 30–90% dos dias, posta em ~10% deles,
  dá DRIFT em 1–2 itens do feed (80% de chance se for honesto). Diante de
  spam: SINK 50%, denúncia 35%, corta o vínculo que trouxe 40%.
- **Atacantes (todos ao mesmo tempo):** fazenda de 2.000 contas que dá
  DRIFT diário no spam do dono e, no contágio, declara uma cidade
  aleatória por dia; brigada de 3 concentradores + 300 contas denunciando
  toda semana o post honesto mais visto; spammer veterano que se comporta
  3 semanas e depois posta spam diário para 10 seguidores reais.
- **Ataques adaptados:**
  - *follow-back*: cada conta da fazenda segue 20 pessoas e 3% ou 10% seguem de volta;
  - *enganados*: 10% das pessoas seguem o dono;
  - *isca*: contas postam conteúdo bom;
  - *enganados + isca*: o dono posta conteúdo bom metade dos dias;
  - *camuflagem*: cada conta impulsiona 2 posts honestos por dia;
  - *revezamento*: cada spam é impulsionado por 1/3 da fazenda;
  - *paciente*: contas criadas no dia 0, camufladas, atacando no dia 28;
  - *visão 30%*: cada cliente vê 30% dos DRIFTs de terceiros (pior caso, por evento);
  - *eclipse*: 30% dos clientes só usam relays do atacante, que esconde SINKs e denúncias e descarta metade do que é honesto.
- **Métricas (média das últimas 6 semanas):**
  - % de pessoas com ataque no feed;
  - pico em qualquer momento;
  - dias com mais de 5%;
  - alcance acumulado do post honesto mais viral da semana;
  - fração do feed vinda de outra cidade (abertura);
  - feeds quase vazios;
  - diferenças com a ordem de chegada embaralhada (40 feeds a cada 4 quadros).

## 4. Resultados

### 4.1 Urna global × contágio (seed 7)

| Modelo | vê ataque | posts honestos escondidos pela brigada |
|---|---|---|
| urna global (motor real) | **100%** | **22 de 22** |
| contágio v1 | 49% (furo: autor a 2 saltos no mapa) | 0 |
| contágio v2 | 4% | 0 |

### 4.2 Isolar cidades sem mobilidade

| Sem mobilidade | vê ataque | alcance | feed de outra cidade |
|---|---|---|---|
| v2 | 6,3% | 58% | 37% |
| v3 (encontro exigido) | 1,7% | **27%** | 20% |
| v4 (reciprocidade) | 1,3% | **28%** | 21% |
| v5 (vínculo conquistado) | 2,0% | 51% | 36% |

Exigir encontro físico para o vínculo forte isola quem não circula (o
defeito que Viswanath et al., 2010, descrevem para defesas por grafo). O
vínculo conquistado pelo próprio leitor resolve sem isolar.

### 4.3 Defesas da literatura (v5 + uma peça por vez)

| Ataque | v5 | +aval | +lockstep (só proporção) | +SINK→vínculo | v6 (todas, com 15 idênticos) |
|---|---|---|---|---|---|
| follow-back 10% | 15,2% | 16,3% | 1,6% | 9,4% | 0,3% |
| isca | 4,5% | 3,9% | 1,3% | 3,0% | 0,2% |
| 10% enganados | 22,4% | 5,0% | 20,3% | **28,6%** | 0,8% |
| enganados + isca | 27,1% | 20,1% | 27,1% | 29,4% | 2,1% |
| camuflagem | 14,6% | 14,3% | **15,7%** | 9,6% | 0,3% |

Duas surpresas:
- **Só o SINK baixando o vínculo piora os enganados.** Quem é enganado para de ver o spam e de enterrá-lo, e os vizinhos perdem a vacina: as exposições pelo mapa vão de 524 para 701.
- **A camuflagem derrota o lockstep por proporção**, como o FRAUDAR (KDD 2016) prevê. Contar impulsos idênticos resolve: 99,9% da fazenda é reconhecida, com no máximo 0,14% de honestos rebaixados.

### 4.4 Limites do v6 e o que foi descartado

| Teste | Resultado |
|---|---|
| visão 30% (pior caso, por evento) | follow-back 10,5%, camuflagem 5,7% |
| visão 30% realista (contatos inteiros, outras contas tudo-ou-nada) | 0,2% |
| revezamento (1/3 por spam) | 3,5% (v5: 4,7%) |
| fazenda paciente | 0,3% de média, **pico de 51%** por 12 dias |
| punição que expira em 30 dias | enganados + isca **20,1%** (era 2,1%) → descartado |
| limiar de 8 impulsos idênticos | surto 12 → 6 dias, mas −20 pontos de alcance → descartado |
| limiares escalados pela fração vista | ataque 0%, alcance honesto 27–32% → descartado |
| labelers 2-de-3 (1 malicioso), visão 30% | 0,0%, sem custo |
| disjuntor por idade da conta | pico da fazenda apressada 46% → 19%; não pega a paciente |
| eclipse 30% | ataque contido (0,7%), mas alcance honesto ~88% → 61–66% |
| erro honesto 5% com punição permanente | nenhum vínculo honesto emudecido |

### 4.5 v7 (teto para vínculos fracos) e a Fase 1

| Cenário | v6 | **v7** | **Fase 1 (app)** |
|---|---|---|---|
| revezamento | 3,5% · pico 21% | 0,2% · 2% | 0,0% · 2% |
| paciente | 0,3% · pico 51% | 0,2% · 2% | 0,0% · 2% |
| visão 30% | 10,5% · pico 29% | 0,2% · 2% | 0,0% · 1% |
| eclipse 30% | 0,7% · pico 21% | 0,2% · 2% | 0,0% · 1% |
| isca | 0,2% | 0,2% | **1,4% · pico 7%** |
| enganados + isca | 2,1% · pico 9% | 1,8% · pico 9% | 0,0% · pico 8% |
| alcance honesto sem ataque | 88% | 92% | ~38% |
| alcance sem mobilidade (com ataques) | 69% | 55% | ~39% |

O alcance do post mais viral é uma métrica de um post só e varia ±8 pontos
entre seeds; a diferença v6 × v7 sem mobilidade está nesse ruído. O pico
de 2% é o spammer veterano com seus 10 seguidores reais. O teto só
usa os vínculos de quem lê, então revezamento, visão parcial e eclipse não
o afetam. A Fase 1 perde alcance (sem encontros e sem mapa da área) e deixa
a isca passar (sem lockstep); ambos voltam nas Fases 2–3. Ordem
embaralhada: 0 diferenças em 840 feeds em todas as rodadas.

## 5. O que esta simulação não prova

- **Grafo sem agrupamento.** Amigos de amigos não se conhecem mais que estranhos; regras por comunidade (avais independentes, teto por grupo) não foram testadas, e a facilidade de conquistar vínculos honestos pode estar subestimada ou superestimada.
- **Sem opiniões.** "Abertura" mede cidades, não ideias. Bolha ideológica não foi medida.
- **Encontros não são forjados.** A fazenda nunca declara encontro com gente real; um encontro falso por GPS não está modelado.
- **Isca escrita por LLM** equivale aqui a isca humana: o custo do atacante pode estar superestimado.
- **Uma seed** nas rodadas finais (as anteriores variaram ±8 pontos de alcance).
- **Cliente real ≠ simulação:** janela de sync de 7 dias, latência, relays com conteúdos diferentes.
- **v7 sem as outras peças não foi testado.** Talvez o teto sozinho baste para parte delas.

## 6. Literatura usada

Cheng & Friedman 2005; Douceur 2002; Viswanath et al. SIGCOMM 2010;
Íntegro NDSS 2015; FoolsGold 2018; FLTrust NDSS 2021; SynchroTrap CCS
2014; CopyCatch WWW 2013; LockInfer KAIS 2016; FRAUDAR KDD 2016; Ostra
NSDI 2008; DSybil IEEE S&P 2009; SumUp NSDI 2009; SybilLimit; TrustGuard
WWW 2005; Jøsang & Ismail 2002; Centola & Macy 2007; Centola, Science
2010; Heilman et al., USENIX Security 2015 (eclipse); análise empírica do
Nostr (arXiv 2402.05709); Pathak & Spezzano, ECIR 2024; Community Notes
(Slaughter et al. 2025); Laurie & Clayton, WEIS 2004. Links na página da
simulação e em `Docs/algoritmos.md` §9.

## 7. Como reproduzir

```bash
node Docs/simulacao-contagio/build-engine.mjs        # empacota src/lib/ranking.ts (motor real)
node Docs/simulacao-contagio/bateria.cjs 0 4 &       # rode os workers 0..3 em paralelo
node Docs/simulacao-contagio/bateria.cjs resumo      # tabela das rodadas prontas
node Docs/simulacao-contagio/bateria.cjs 0 1 fase1   # só as rodadas da Fase 1
```

Determinística: mesma seed, mesmo resultado. As tabelas acima saem das
rodadas `v2..v7`, `fase1` e `global` da bateria.

## 8. Perguntas para quem revisar

1. O teto de 0,5 para vínculos fracos tem um ataque que a simulação não
   pegou? (Ex.: comprar vínculos conquistados em escala com isca de LLM.)
2. A punição permanente do SINK é aceitável socialmente? A simulação não
   mostrou fragmentação com 5% de erro honesto, mas o grafo é sintético.
3. A emenda ao §24 preserva o espírito anti-bolha? Que métrica de
   diversidade deveríamos medir antes da Fase 2?
4. O que muda com um grafo social realista (agrupado)?
