# Modelo de contágio do Drift — spec para revisão externa

> **Status (2026-11-05):** Fase 1 implementada (aba "contágio",
> `src/lib/contagion.ts`, `Docs/algoritmos.md` §9; manifesto §24
> emendado) e revisada em par: teto também na vacina e na quarentena,
> só a denúncia pune (§4.6), sem corte automático de vínculo (§4.5), com
> o gesto privado "não trazer mais por X" (§4.8).
> Fases 2–3 planejadas (`BACKLOG.md` "Contágio local").
> Simulação reproduzível em [`simulacao-contagio/`](simulacao-contagio/).
> Este documento existe para que alguém de fora possa refazer as contas,
> discordar delas e apontar o que a simulação não cobre.

## 1. O problema

O Drift ordenava o feed por uma **urna global** — uma votação única, em
que todos os DRIFTs da rede somam no mesmo placar: a soma ponderada dos
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
| Fase 1 v0 | v7 **sem** mapa, sem encontro físico, sem lockstep, aval e experiência | conquistado 0,8 · follow 0,5 |
| **Fase 1 (app)** | Fase 1 v0 + teto também na vacina e na quarentena + só a **denúncia** pune (§4.6) + post direto sem "quem trouxe" + gesto **"não trazer mais por X"** no lugar do corte de vínculo (corta só os DRIFTs de X; as rodadas `fase1__*` supõem que ninguém o usa, §4.8 varia) | idem |

A Fase 1 é o que o app já consegue calcular com os dados que tem: os
follows do próprio leitor, o que ele impulsionou e o que ele denunciou.
Detalhes e exemplo em `Docs/algoritmos.md` §9.

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
  spam: SINK 50%, denúncia 35%, corta o vínculo que trouxe 40% (v1–v7).
  No app, o corte é o gesto "não trazer mais por X", que só tira os
  DRIFTs da pessoa: as rodadas `fase1__*` supõem 0%; a §4.8 varia o uso
  (0/20/40%) e a taxa de denúncia (35/10%).
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
  - *eclipse*: 30% dos clientes só usam relays do atacante, que esconde SINKs e denúncias e descarta metade do que é honesto;
  - *difamação*: a fazenda (seguida de volta por 10%) enterra e denuncia todo post honesto que vê;
  - *SINK de gosto*: cada pessoa enterra 5% ou 10% dos posts honestos que vê (não é ataque: mede o custo de punir no SINK).
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

| Cenário | v6 | **v7** | Fase 1 v0 | **Fase 1 (app)** |
|---|---|---|---|---|
| revezamento | 3,5% · pico 21% | 0,2% · 2% | 0,0% · 2% | 0,0% · 2% |
| paciente | 0,3% · pico 51% | 0,2% · 2% | 0,0% · 2% | 0,0% · 2% |
| visão 30% | 10,5% · pico 29% | 0,2% · 2% | 0,0% · 1% | 0,0% · 2% |
| eclipse 30% | 0,7% · pico 21% | 0,2% · 2% | 0,0% · 1% | 0,0% · 2% (alcance 27%) |
| difamação | — | — | — | 0,0% · 2% |
| isca | 0,2% | 0,2% | 1,4% · pico 7% | **2,9% · pico 11%** |
| enganados + isca | 2,1% · pico 9% | 1,8% · pico 9% | 0,0% · pico 8% | 0,1% · pico 9% |
| alcance honesto sem ataque | 88% | 92% | ~38% | 38% |
| alcance com 10% de SINK de gosto | — | — | 5% | 29% |
| alcance sem mobilidade (com ataques) | 69% | 55% | ~39% | 38% |
| feed vindo de outra cidade, sem ataque | 57% | 58% | 54% | 54% |

A isca dobra da Fase 1 v0 para o app porque a coluna do app supõe que
ninguém corta quem trouxe spam: com corte em 40% das vezes (rodada
`fase1_corte40__isca`), ela fica em 1,8% · pico 9%. O app ganhou esse
gesto como "não trazer mais por X" (§4.8). Sem ele, a isca passa de 5% das
pessoas em metade dos dias simulados: é o ataque que a Fase 1 aceita até
o lockstep da Fase 2.

Para comparar a abertura: no feed da urna global, 72% vem de outra cidade;
no v2, 61%. O contágio é mais local, como foi desenhado ("ver o próximo
primeiro"), sem fechar a pessoa na própria cidade.

O alcance do post mais viral é uma métrica de um post só e varia ±8 pontos
entre seeds; a diferença v6 × v7 sem mobilidade está nesse ruído. O pico
de 2% é o spammer veterano com seus 10 seguidores reais. O teto só
usa os vínculos de quem lê, então revezamento, visão parcial e eclipse não
o afetam. A Fase 1 perde alcance (sem encontros e sem mapa da área) e deixa
a isca passar (sem lockstep); ambos voltam nas Fases 2–3. Ordem
embaralhada: 0 diferenças em 840 feeds em todas as rodadas.

### 4.6 O que vira experiência ruim (decisão de 05/11/2026)

A primeira versão punia (−0,5 no vínculo com o autor e com quem trouxe)
tanto o SINK quanto a denúncia do leitor. A revisão em par apontou o
custo: SINK no Drift é gosto (manifesto §23), e gente comum enterra post
honesto. Três opções, na configuração do app (sem corte de vínculo):

| Cenário | SINK e denúncia punem | **só a denúncia pune** | denúncia + SINK só contra quem trouxe |
|---|---|---|---|
| isca | 1,4% · pico 7% | **2,9% · pico 11%** | 1,3% · pico 8% |
| enganados + isca | 0,0% · pico 7% | 0,1% · pico 9% | 0,1% · pico 9% |
| difamação | 0,0% | 0,0% | 0,0% |
| 10% de SINK de gosto, sem ataque: alcance | **5%** (30% dos feeds quase vazios; 25% dos vínculos honestos zerados) | **29%** (nenhum vínculo zerado) | 8% (9% dos feeds quase vazios) |
| 10% de SINK de gosto + isca: ataque · alcance | 0,5% · 5% | 2,3% · 30% | 0,8% · 7% |

Punir no SINK compra pouca defesa contra a isca e desmonta a rede
honesta: um SINK de gosto num post trazido por alguém já derruba o vínculo
conquistado (0,8 → 0,3) e a pessoa para de trazer posts. Decisão: **só a
denúncia pune**, que é intenção explícita ("isto é spam/abuso"). As
rodadas `decisao_*` (base `fase1_v0`: corte de vínculo em 40% e "quem
trouxe" também em post direto) apontaram o mesmo (isca 1,4% × 1,5%;
alcance com SINK de gosto 5% × 29%). Rodadas `fase1_both__*`,
`fase1_viaSink__*`, `fase1__*` e `decisao_*` da bateria.

### 4.7 Sensibilidade (revisão em par, 05/11/2026)

Rodadas do revisor adversarial sobre a configuração do app (flags novas,
neutras quando desligadas; `isca` reproduz 2,9% · pico 10,6%):

| Suposição mexida | isca |
|---|---|
| denúncia em 35% dos spams vistos (base) | 2,9% |
| denúncia em 10% | 12,4% (13,0% na seed 23) |
| denúncia em 5% | 22,3% |
| 10% de denúncia + SINK punindo | 1,5–1,6% (mas derruba o alcance honesto, §4.6) |
| 10% de denúncia + corte total de quem trouxe em 20% / 40% (tira a pessoa de tudo) | 4,5% / 2,9% |
| 10% de denúncia + gesto do app "não trazer mais" em 20% / 40% (§4.8) | 4,8% / 2,6% |
| seguir e dar DRIFT numa isca do Global em 0,5% / 1% / 2% dos dias ativos | 7,7% / 12,7% / 20,4% |
| contas de isca postando spam direto | 6,5% |
| punição do autor expirando em 30 / 7 dias (enganados + isca) | 6,1% / 9,1% (base 0,1%) |
| seeds 7, 11, 23, 42 | 2,6–2,9% |

O que segura: a seed e o teto de itens do feed. O que mais derruba: a
taxa de denúncia e o funil do Global. A punição do autor que expirava com
a limpeza do cache foi corrigida antes do merge.

### 4.8 O gesto "não trazer mais por X" (05/11/2026)

A sensibilidade (§4.7) mostrou que a defesa contra a isca depende de as
pessoas denunciarem. O app ganhou um gesto privado na pílula ↪: "não
trazer mais por X" faz os DRIFTs de X pararem de trazer post. Os posts
diretos de X, o SINK (vacina) e a denúncia (quarentena) de X continuam
valendo; não pune ninguém e se desfaz em listas locais. Na simulação
(`cutMode: 'bring'`), cada vez que alguém vê spam trazido por um contato,
usa o gesto contra ele com chance c; a denúncia acontece com chance r.
Rodadas `gesto_r{35,10}_c{0,20,40}__*`, média das últimas 6 semanas, %
das pessoas que veem ataque (pico entre parênteses):

| Cenário | r35 · c0 | r35 · c20 | r35 · c40 | r10 · c0 | r10 · c20 | r10 · c40 |
|---|---|---|---|---|---|---|
| isca | 2,9 (11) | 1,8 (9) | 1,6 (8) | 12,4 (19) | **4,8** (12) | 2,6 (11) |
| isca + 10% de SINK de gosto | 2,3 (10) | 1,5 (8) | 1,4 (8) | 11,7 (18) | 3,8 (12) | 2,5 (9) |
| enganados + isca | 0,1 (9) | 0,1 (9) | 0,1 (9) | 2,5 (10) | 2,5 (10) | 2,5 (10) |
| sem ataque: alcance do post mais viral | 38% | 38% | 38% | 38% | 38% | 38% |

Leitura: com denúncia baixa (10%), o gesto usado em 1 de cada 5 spams
trazidos derruba a isca de 12,4% para 4,8%; em 2 de cada 5, para 2,6% —
perto do que a Fase 1 dá com denúncia alta. Sem ataque nada muda (o gesto
só é usado contra spam). Ele **não** pega o caso "enganados": ali o spam
chega direto, porque a pessoa segue o fazendeiro, e só a denúncia (que
zera o vínculo com o autor) ou deixar de seguir resolvem. Os dias de surto
(> 5% das pessoas) caem de 152 para 126 (c20) e 64 (c40) com denúncia em
10%. Ordem embaralhada: 0 diferenças em 840 feeds em todas as rodadas.

## 5. O que esta simulação não prova

- **Grafo sem agrupamento.** Amigos de amigos não se conhecem mais que estranhos; regras por comunidade (avais independentes, teto por grupo) não foram testadas, e a facilidade de conquistar vínculos honestos pode estar subestimada ou superestimada.
- **Sem opiniões.** "Abertura" mede cidades, não ideias. Bolha ideológica não foi medida.
- **Encontros não são forjados.** A fazenda nunca declara encontro com gente real; um encontro falso por GPS não está modelado.
- **Isca escrita por LLM** equivale aqui a isca humana: o custo do atacante pode estar superestimado.
- **Uma seed** nas rodadas finais (as anteriores variaram ±8 pontos de alcance).
- **Cliente real ≠ simulação:** janela de sync de 7 dias, latência, relays com conteúdos diferentes.
- **v7 sem as outras peças não foi testado.** Talvez o teto sozinho baste para parte delas.
- **SINK de gosto uniforme.** Cada pessoa enterra 10% de tudo ao acaso; gosto real se concentra (um assunto, um autor) e pode zerar menos vínculos, ou mais.
- **Taxas de reação fixas.** SINK 50% e denúncia 35% diante de spam são suposições; a defesa contra a isca na Fase 1 depende da denúncia (§4.7) e de quanto as pessoas usam o gesto "não trazer mais" (§4.8) — nenhuma das duas taxas foi medida em gente de verdade.
- **Simulação × app.** Na simulação, "quem trouxe" é um contato só (no app, todos os empatados), o SINK de contato vale 2 dias (no app, 96 h) e o feed medido são os 8 primeiros por pontuação de contágio (no app, tudo o que passa, até 50, na ordem canônica). A simulação não aplica a moderação global (−999), que no app vale também na aba.
- **Contágio isolado do Global.** As rodadas não colocam o feed global e a aba Contágio no mesmo mundo; o funil (§4.7) foi aproximado.

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
node Docs/simulacao-contagio/bateria.cjs 0 1 '^fase1'   # só as rodadas da Fase 1 (app, v0 e variações)
node Docs/simulacao-contagio/bateria.cjs 0 1 '^decisao_' # a decisão de 05/11 com corte de vínculo
node Docs/simulacao-contagio/bateria.cjs 0 1 '^gesto_'   # o gesto "não trazer mais" (§4.8)
```

Determinística: mesma seed, mesmo resultado. As tabelas acima saem das
rodadas `v2..v7`, `fase1_v0`, `fase1*`, `decisao_*`, `gesto_*` e `global`
da bateria.

## 8. Perguntas para quem revisar

1. O teto de 0,5 para vínculos fracos tem um ataque que a simulação não
   pegou? (Ex.: comprar vínculos conquistados em escala com isca de LLM.)
2. A punição permanente da denúncia (autor e quem trouxe) é aceitável
   socialmente? O SINK deixou de punir (§4.6); denúncia por engano não
   tem volta, como a própria denúncia (evento imutável).
3. A emenda ao §24 preserva o espírito anti-bolha? Que métrica de
   diversidade deveríamos medir antes da Fase 2?
4. O que muda com um grafo social realista (agrupado)?
5. Que defesa barata, sem lockstep, fecha a isca na Fase 1? O gesto "não
   trazer mais por X" (§4.8) segura 10% de denúncia em 4,8% se usado em
   20% das vezes — mas quanto gente de verdade vai usá-lo? E o que pega o
   spam direto de quem a pessoa segue sem depender só da denúncia?
