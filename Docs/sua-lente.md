# Sua Lente

**O que é, o que faz, o que nunca vai fazer.**

*Última atualização: 2026-05-17 (pós deliberação HIMYM 5/5 — math locked)*

---

## Sua Lente em 30 segundos

Sua Lente é uma forma de **reordenar o feed pra você**, usando como
ingrediente quem você segue, quem deu DRIFT em quê, e quem você
silenciosamente atestou via suas próprias ações. Ela não cria um feed
diferente do mundo — ela pega o mesmo feed global do Drift e empurra
pra cima os posts que provavelmente conversam mais com a sua rede.

A Lente é **só sua**. Ela é calculada no seu dispositivo, vive no seu
dispositivo, nunca é publicada em lugar nenhum. Ninguém consegue ver
como ela enxerga o mundo, e ela também não vê o mundo de ninguém —
ela não é "score público", "reputação", nem "ranking compartilhado".

Você liga ou desliga em **um clique**. O slider vai de 0% (Lente
desligada, feed cru) até 100% (Lente influencia bastante a ordem do
que você vê). Em qualquer momento, você volta pro feed cru sem
perder nada.

---

## Conceito visual: como sua rede te encontra

Imagina sua rede como uma teia de luz.

No centro tem **você**. Saindo de você existem fios — cada pessoa
que você segue é um fio direto. Cada um deles, por sua vez, segue
outras pessoas — esses são fios indiretos. Quando você dá DRIFT em
um post, é como acender uma pequena luz no fio que liga você ao autor.
Quando você dá SINK, é como apagar.

Sua Lente é o nome que damos pra **direção e intensidade dessa luz**
chegando até você. Quanto mais fios passam por uma pessoa até chegar
nela, quanto mais brilhantes esses fios estão, mais "próxima" da sua
rede ela é — e os posts dela ganham um empurrãozinho pra cima quando
a Lente está ativa.

Isso é diferente de um algoritmo de feed tradicional. Não tem um
servidor central decidindo o que você quer ver baseado em
comportamento agregado. Não tem treino de modelo nem perfilamento.
A Lente é uma operação matemática simples rodando localmente, com
ingredientes que **você mesma criou** — seus follows, seus DRIFTs,
seus SINKs.

E mais importante: a sua Lente **não vê a Lente de mais ninguém**.
Cada user de Drift tem a sua, e elas não conversam entre si.

---

## Os 5 ingredientes que importam

A Lente combina cinco sinais pra decidir o quanto cada pessoa da rede
"conta" pra você. Cada um tem um peso específico — calibrado pra
dificultar que conta nova ou bot empurre influência sem ter atividade
real.

### 1. Anti-Sybil base (W_BIAS = -2.0)

**O que é:** uma "desconfiança padrão" embutida na fórmula. Toda
pessoa começa com peso negativo até que sinal real apareça (você
segue, vocês têm mútuos, você deu DRIFT).

**Como afeta:** alguém que você não conhece, sem mútuos, sem nada,
praticamente não aparece destacada na sua Lente — mesmo que tenha
muitos seguidores. Já alguém que você segue **e** com quem você tem
3-4 mútuos sobe bem.

**Por que faz sentido:** evita "Sybil attack" — quando um atacante cria
100 contas fake pra tentar inflar a influência de uma. Sem o peso base
negativo, conta nova começaria contando metade do peso de uma conta
que você segue de verdade. Com o peso negativo, a razão fica em torno
de **7 vezes** a favor da pessoa que você segue diretamente. Trust se
constrói com sinal real, não com volume.

### 2. Follow direto (W_FOLLOW = 1.5)

**O que é:** o fato de você seguir alguém é o sinal mais forte de
"essa pessoa existe pra mim na rede".

**Como afeta:** seguir alguém é o atalho mais direto pra essa pessoa
contar na sua Lente. Sem ainda ter dado DRIFT em nada dela, só pelo
follow, ela já tem presença.

**Por que faz sentido:** follow é uma declaração explícita e custosa
— você fez o gesto. É a melhor evidência de relevância.

### 3. Mútuos (W_MUTUAL = 1.0, capped em 20)

**O que é:** quantas pessoas em comum vocês têm. Se você e a Alice
seguem 5 pessoas comuns, o peso dela na sua Lente sobe um pouco.

**Como afeta:** mútuos atuam como reforço de contexto — não é só
"você segue alguém aleatório", é "vocês compartilham vizinhança". Mas
mútuos têm **limite de 20**: do 21º em diante, mais mútuos não contam
mais.

**Por que faz sentido:** se mútuos contassem indefinidamente, alguém
poderia criar um cluster de 100 contas fake todas seguindo umas às
outras pra simular vizinhança rica. O cap em 20 quebra essa estratégia
— passou disso, é provavelmente flood. Vinte é mais do que suficiente
pra capturar "rede compartilhada legítima".

### 4. Seus DRIFTs (W_MY_SPREAD = 1.2)

**O que é:** cada vez que você dá DRIFT em um post, você está
silenciosamente atestando "isso vale". A Lente nota.

**Como afeta:** depois de dar DRIFT em 5 posts da Alice, ela
acumula peso. Da próxima vez que aparecer um post dela, a Lente sabe
que você tem interesse demonstrado.

**Por que faz sentido:** DRIFT é a unidade de aprovação do Drift. Ele
já é público (vai pra rede como kind 9079), mas o que a Lente faz
com ele é estritamente privado — é só você lendo seus próprios
gestos pra ordenar o feed melhor pra você mesma. Não é "Alice tem N
DRIFTs no mundo" — é "Alice tem N DRIFTs **meus**".

### 5. Seus SINKs (W_MY_BURY = 1.5)

**O que é:** o oposto. Cada vez que você dá SINK em um post, você
está dizendo silenciosamente "isso não vale". A Lente também nota.

**Como afeta:** SINKs **reduzem** o peso do autor na sua Lente. Note
que o peso do SINK (1.5) é um pouco maior em valor absoluto que o do
DRIFT (1.2) — "negativo grita mais alto que positivo", um padrão
intencional pra dar mais agência pro user filtrar ruído.

**Por que faz sentido:** sem o SINK contando, a Lente seria
otimista demais — qualquer DRIFT empurraria pra cima, mas nenhum
SINK puxaria pra baixo. Você ficaria refém de ações antigas. Com
SINK contando, você pode **descalibrar** a Lente conscientemente —
"esse autor não tá mais pra mim".

---

> **Resumo da fórmula (sem entrar em matemática):**
>
> Pra cada pessoa que aparece na sua rede, a Lente calcula um peso
> entre 0 e 1, combinando os 5 ingredientes acima através de uma
> função suave (sigmoide). Esse peso é depois usado pra propagar
> "luz" pela teia da rede até chegar até você.

---

## O slider 0-100% — o que cada posição significa

O slider da Lente é **linear**. Em 50%, você sente metade do efeito
máximo. Em 100%, efeito completo. Nada de curvas exóticas que te
deixam confusa sobre por que mover de 30 pra 50 não fez nada.

### 0% — Lente desligada

> "Esta lente não afeta seu feed."

Você está vendo o feed Drift cru — o score global de cada post, sem
nenhuma personalização local. Mesmo que sua Lente esteja calculada
nos bastidores (e está, sempre que o app tem o que processar), ela
não influencia ordem alguma. É o feed-cidadão: igual pra todo
mundo.

### 1-49% — Lente leve

> "Esta lente influencia levemente seu feed."

Posts de pessoas próximas da sua rede começam a subir, mas
suavemente. Você ainda vai ver bastante coisa "de fora" — outros
clusters, posts virais sem mútuos com você, conteúdo que ficou
trending por mérito próprio. É um bom ponto pra "ver o mundo, mas
com um leve fio puxando pra perto".

### 50-79% — Lente moderada

> "Esta lente reorganiza claramente seu feed."

Aqui a Lente fica visível. Posts de pessoas próximas — quem você
segue, quem tem mútuos contigo, quem você já deu DRIFT antes — sobem
de forma marcada. Você ainda recebe sinais de fora, mas eles
competem em desvantagem.

Esse é o ponto que muita gente vai gostar de calibrar pra ficar.

### 80-100% — Lente forte

> "Esta lente domina seu feed — posts fora dela quase não aparecem."

Em 100%, o boost por proximidade é máximo (multiplicador capped em
3x sobre o score global, com piso 0.1x). Você vai ver quase
exclusivamente conteúdo próximo da sua rede. Pode ser útil em
momentos de saturação — "só quero ver minhas pessoas hoje". Mas
note: a Lente em 100% **não é uma bolha completa**. Ela ainda
respeita o score global como base — um post fortíssimo de fora
ainda pode aparecer.

> **Você nunca perde nada por mover o slider.** A qualquer
> momento, volte pra 0% e o feed cru reaparece intacto. A Lente
> não esconde permanentemente posts — ela só reordena.

---

## A distância importa (mas decai naturalmente)

A Lente enxerga a rede até alguns níveis de distância:

- **Direct follow** (você → Alice): sinal mais forte
- **Friend-of-friend** (você → Alice → Bob): sinal moderado
- **FoFoF** (você → Alice → Bob → Carla): sinal fraco
- **Mais longe**: ruído, praticamente zero contribuição

Isso não é um corte rígido. É um **decaimento natural** — a cada
passo na teia, o sinal vai ficando mais difuso. A Lente calcula uma
caminhada aleatória sobre a rede partindo de você; quanto mais longe
um nó, menos provável que a caminhada chegue até lá. A razão entre
follow direto e FoF fica em torno de **7 vezes** (você direto pesa 7x
mais que conhecido-de-conhecido).

Os matemáticos chamam isso de **Personalized PageRank**. É a mesma
família de algoritmo que o Google usou pra ranquear páginas web,
mas aqui personalizado partindo de **você** em vez de "todo mundo".

---

## Por que existe um limite (anti-Sybil)

Sybil attack é o nome técnico pra "atacante cria múltiplas identidades
falsas pra inflar influência". É um problema real em qualquer rede
descentralizada, e foi um dos primeiros desafios que tivemos que
endereçar pra Lente não virar manipulável.

Algumas defesas que estão na fórmula:

### Conta nova começa baixa

Por causa do `W_BIAS = -2.0`, uma identidade sem follow seu e sem
mútuos começa com peso **muito baixo** na sua Lente. Não importa
quantas outras contas falsas a seguem — sem ponte pra **você**, ela
quase não aparece. Isso quebra o ataque clássico de "criar 100 bots
seguindo uns aos outros pra fingir vizinhança".

### Mútuos têm teto (20)

Mesmo que uma conta consiga simular vizinhança rica (100 contas
falsas todas seguindo umas às outras), o cap de mútuos em 20 quer
dizer que do 21º em diante o atacante não ganha mais nada. Vinte
mútuos legítimos é mais que suficiente pra qualquer rede orgânica.

### A caminhada é aleatória, não greedy

A Lente não escolhe sempre o caminho mais pesado — ela faz uma
caminhada aleatória ponderada. Isso significa que um atacante que
construiu uma "rota dourada" entre ele e você não consegue forçar a
Lente a sempre usar essa rota. A aleatoriedade dilui esforços de
manipulação dirigida.

### Diversidade de caminhos conta

Se 3 amigos seus diferentes te conectam a uma mesma pessoa, isso
vale mais do que se 1 amigo te conectar por 3 rotas diferentes. A
Lente mede **diversidade de caminhos** — quantos intermediários
distintos existem. Isso protege contra o caso "uma única pessoa
intermediária consegue influenciar muita coisa" (o "hub problem").

### Caminhadas são limitadas em profundidade

A Lente vê até ~6 graus de separação, mas o sinal já decaiu tanto
que pessoas tão distantes mal contam. Não é uma vigilância de rede
global — é uma vizinhança natural ao seu redor.

---

## E se eu quiser tirar alguém da Lente?

Independente do slider global, você pode **remover alguém específico
da sua Lente** sem mexer no resto. No mapa da Rede (Phase 1.5), um
long-press sobre o nó da pessoa abre opção "limpar da minha lente".
Em qualquer post no feed, o inspector da Lente também oferece isso.

Mecanicamente, isso cria uma **regra de filtro local** (`filter_rule`)
que vive na sua tabela `lens_filter_rules` do SQLite. A regra é uma
expressão composta — pode ser simples ("esconder posts de @x") ou
combinada com tags ("esconder posts marcados `content-warning: nsfw`
de autores com baixa proximidade"). É o que o manifesto §27 chama de
"auto-classificação voluntária com filtros locais".

Importante:
- **Não muta seu grafo de follows.** Você continua seguindo @x —
  só não vê os posts dela na sua Lente. Outras pessoas continuam
  vendo normalmente.
- **Não publica nada.** A regra fica no seu dispositivo, igual ao
  resto da Lente.
- **Você pode desfazer.** A regra é gerenciável em Settings → Sua
  Lente → "Regras locais".
- **Não dá poder a ninguém.** É só sua decisão sobre o que sua
  Lente prioriza, exatamente como mute/block já funcionam hoje em
  outras camadas locais.

Há um ajuste técnico em curso (GAP-2 da auditoria Barney 2026-05-17):
em Phase 1 a regra "limpar da lente" funciona como filtro de
renderização, mas as walks PPR ainda passam pela pessoa removida e
distribuem influência transitiva. Phase 1.5 vai propagar a regra pra
edge influence (`influence_out = 0` se hide rule active), fechando o
loop completo. Por enquanto, o efeito visual é o que você espera —
a pessoa some da sua Lente — mas a defesa é parcial até o patch.

---

## O que sua Lente NÃO faz

Esta lista é mais importante que tudo que vem antes dela. Sua Lente
é uma **ferramenta de visualização local** — não é nada além disso.

- **Não vai pra rede.** Os pesos calculados nunca são publicados em
  nenhum kind Nostr, nunca aparecem em evento assinado, nunca são
  enviados pra relay. Vivem só no SQLite do seu dispositivo.

- **Não esconde posts permanentemente.** A Lente só reordena. Mover
  o slider pra 0% restaura o feed cru imediatamente. Nenhum post é
  apagado do banco local.

- **Não é juízo moral.** Peso baixo na sua Lente não significa que
  a pessoa é "ruim" ou "tóxica". Significa apenas que ela está
  longe da sua rede atual. Pode ser uma pessoa excelente que você
  ainda não conhece.

- **Não é mostrada pra ninguém.** Não tem como outro user de Drift
  saber quem tem peso alto ou baixo na sua Lente. Não existe API
  pra exportar isso. Screenshot do mapa da rede (Phase 1.5) é o
  único caminho — e o app avisa antes que isso compartilha dados
  sensíveis.

- **Não é um "trust score" público.** Drift conscientemente não
  publica peso de confiança entre users como evento. Isso seria
  catedral (manifesto §22). Sua Lente é a oposição direta dessa
  ideia: **score privado, do user, pro user**.

- **Não escolhe pra outros.** Não existe versão "global" da sua
  Lente que outros users consomem. Cada user de Drift calcula a
  Lente dele a partir do **ponto de vista dele mesmo**. Não tem
  Lente "do Drift" — só lentes individuais.

- **Não escaneia conteúdo.** A Lente não olha o que está escrito no
  post pra decidir peso. Só olha grafo da rede (follows, DRIFTs,
  SINKs entre identidades). Texto, imagem, link — tudo invisível
  pra ela.

- **Não personaliza o feed canônico.** O `score` global de cada post
  (manifesto §22, calculado pela função pura `calculateScore`) é
  **idêntico** em todos os clientes Drift. A Lente só multiplica
  esse score localmente no momento da renderização — nada disso é
  persistido. Outro user, mesmo post, vê o score canônico íntegro.

---

## Manifesto — onde a Lente se encaixa

A Lente foi desenhada pra respeitar três princípios do manifesto
que poderiam, à primeira vista, parecer incompatíveis com ela.

### §17 — Sem chave mestra

> "Se eu quero uma rede livre de censura, eu também devo ser
> incapaz de censurá-la."

A Lente não dá poder pra ninguém. Não tem operador. Não tem
servidor. Não tem fundador escolhendo curadoria. Cada user calcula a
própria, ninguém pode mexer na de outro. Não é vetor de chave
mestra disfarçada (manifesto §25) — porque não existe oracle único
que possa ser comprometido. O ponto de vista é sempre **o npub
ativo** do user; a Lente é uma "capability" da identidade do user
(no sentido capability-based de segurança).

### §22 — Sem reputação subjetiva no protocolo

> "Score é determinístico, não opinião."

O score canônico de cada post (calculado por `calculateScore`) é
**puro**: mesma entrada, mesma saída, em qualquer cliente Drift.
Esse score nunca é tocado pela Lente. A Lente só atua **depois**
que o score canônico já existe — multiplicando localmente, na hora
de renderizar, sem nunca salvar o resultado. O manifesto fala que
não existe reputação subjetiva **no protocolo**. A Lente é
estritamente local — não é protocolo, é apresentação. (Esta
tensão filosófica foi debatida na deliberação HIMYM 5/5 e
registrada com carve-out explícito no plano da fase 1.)

### §24 — Sem afinidade no feed canônico

> "Ranking é função pura de score."

Idem: o feed canônico (o que vai pra rede como ordem global) é
intocado. A Lente atua só no view-boundary do render. O mesmo
princípio que já permite block/mute serem "camada de visualização
local, não de ranking" se aplica aqui. Você bloqueando alguém não
muda o score público dela pra ninguém — só esconde da sua tela. A
Lente segue o mesmo padrão, apenas com mais nuance (reordena em vez
de esconder por completo).

---

## E quando eu trocar de identidade ou device?

A Lente roda em cima da **identidade ativa**. Se você troca de
identidade no Drift (manifesto §15, multi-identidade), a Lente é
**recalculada do zero** pro ponto de vista da nova identidade. Tudo
que tava no banco da identidade anterior continua lá — você só
trocou de "óculos".

Se você muda de dispositivo (export nsec → import noutro device), o
banco local começa vazio. A Lente vai se reconstruir conforme os
eventos forem chegando dos relays. Pode demorar alguns minutos pra
sentir a Lente "preencher" — é normal.

A primeira vez que você usa a Lente, antes de ter histórico de
DRIFTs e SINKs próprio, a Lente trabalha com o que tem (basicamente
seus follows). Conforme você usa o app, vai ficando mais refinada.

---

## Para devs

*A partir daqui entra matemática. Se você quer auditar a Lente,
contribuir, ou apenas tem curiosidade técnica, segue o resumo
formal. Pra todo o resto, o que está acima é suficiente.*

### Algoritmo: Personalized PageRank Monte Carlo

A Lente implementa
[Personalized PageRank](https://en.wikipedia.org/wiki/PageRank#Personalized_PageRank)
via random walks Monte Carlo. Parâmetros hard-coded em
`src/lib/trust/constants.ts`:

```ts
PPR_PARAMS = {
  L: 6,        // cap em edges traversed por walk
  K: 1000,     // walks por recompute
  ALPHA: 0.15, // damping (restart probability)
}
```

**Por que L=6**: damping check antes do hop, distribuição geométrica
0-indexed. `P(K=k) = α·(1−α)^k`. Massa retida = `1 − (1−α)^(L+1) =
0.679`. Ou seja, L=6 captura ~68% da massa "natural" do walk; ~32%
é truncado. `E[K_realized] ≈ 5.79`. Headroom de 1 hop além da
expectativa. Compute target: ~75ms em mid-range phone.

**Por que K=1000**: variance trade-off.
- Hoeffding (per-target, 95% conf): `ε_marginal ≤ √(ln(40)/2K) =
  0.043`
- Bahmani uniform (simultâneo): `ε_uniform ≤ √(log n / K)`
- Pra n efetivo Nostr realista (~50, log≈6): `ε_uniform ≤ 0.077`
- Pra n teórico 50k (log=10.8): `ε_uniform ≤ 0.104`

Banda aceitável pra ordering local. Revisar K em Phase 2 se
telemetria mostrar `top1_ppr_concentration_p95 > 0.30`.

**Por que α=0.15**: damping clássico Brin/Page 1998. Convenção
algorítmica do Drift (damping check ANTES do hop, geometric 0-indexed):
`E[K_untruncated] = (1−α)/α ≈ 5.67`, truncado em L=6 dá `E[K_realized]
≈ 5.79`. `P(reach hop 3) = 0.85^3 = 0.61`. Decay natural por
distância — defesa anti-Sybil real é path diversity, não α agressivo.

### Edge influence formula

```
influence(source → target) = sigmoid(
    W_BIAS                                      // -2.0, anti-Sybil base
  + W_FOLLOW   · follow_edge                    // 1.5 if source follows target
  + W_MUTUAL   · log(1 + min(mutual, 20))       // 1.0, cap MUTUAL_CAP=20
  + W_MY_SPREAD · log(1 + my_spreads)           // 1.2
  − W_MY_BURY  · log(1 + my_buries)             // 1.5
)
```

**W_BIAS=-2.0** (Stage 3 HIMYM, Marshall BUG-4 + Robin/Barney call):
sem bias, FoF vazio teria `σ(0)=0.5` — competiria 1.6x com follow
legítimo `σ(1.5)=0.818`, propagando massa PPR em estranger. Com
`W_BIAS=-2.0`: FoF vazio `σ(-2)=0.119`, follow puro `σ(-0.5)=0.378`,
follow+spread `σ(-0.5+1.79)=0.78`. Razão direct:FoF ≈ 7x.

### View-layer multiplier

```ts
ppr_normalized = log(1 + 100·ppr_score) / log(101)   // [0, 1]
s_local = s_global × clip(
  1.0 + 1.5 · strength · ppr_normalized                // BETA_MAX=1.5
      + 0.4 · strength · mutual_spread_post,           // GAMMA_MAX=0.4
  0.1, 3.0                                              // S_LOCAL_MIN, S_LOCAL_MAX
)
```

**Log-transform** (Marshall BUG-5 fix): PPR scores em prática são
power-law (top-1 ≈ 0.05-0.15, median ≈ 0.001). Sem normalização,
`BETA · ppr_raw` contribuiria 1-8% no multiplier — placebo.
Log-transform achata: top ppr=0.10 → normalized=0.49; median
ppr=0.01 → 0.13. Com BETA_MAX=1.5: top author boost = 0.74
(visível). Quantile-rank defer Phase 2 se telemetria mostrar regime
skew > 3x.

**Linear strength** (BUG-6 fix): slider linear matchea perceptual
(Norman heurística). `strength²` fazia Moderado (50%) = 25% do
Forte, conflitando com expectativa visual.

### Defesas anti-Sybil real

- **Path diversity bonus** (Alvisi/Viswanath SoK 2013):
  ```
  diversity_bonus = min(disjoint_paths(source→target, depth≤3), 3) / 3
  final_score = ppr_score × (0.7 + 0.3 × diversity_bonus)
  ```
  Cap intermediary contribution: `M = 0.3` máx por single path.

- **Cluster detection**: baixo mixing-time + alta densidade interna →
  flag candidato (Phase 2 telemetria).

- **Mandatory random walk**: sample_neighbor weighted_by_influence,
  não greedy. Atacante não consegue forçar "rota dourada".

- **W_BIAS=-2.0**: garante razão direct:FoF ≥ 7x mesmo em cold-start
  hostile.

### Locality (invariante Stage 3 #9)

`tests/trust-lens-locality.test.ts` falha se função PPR escapa do
client:
- Import em `sync.ts` / `protocol.ts` / `nostr.ts` → fail
- Publicar `ppr_score` em event tag → fail
- Persistir `s_local` em `posts.score` → fail

LOCK_VIA_TEST cobre §17, §22, §25.

### Conformance tests (24 total)

Originais 9: `posts.score` write-side fechado, `s_local` nunca
persisted, PPR Monte Carlo determinism, edge influence bounds, predicate
schema valid, `lens_edges` off Nostr, vocabulary lock, subscribe filter
independence, PPR locality.

12 Marshall (math invariants em `tests/trust-lens-math.test.ts`):
bounds property, monotonia follow, monotonia bury, seed determinismo,
ppr_sum tolerance, cold-start no NaN, no overflow K=1000 L=6, NaN guard
upsertEdge, multiplier ≥ S_LOCAL_MIN, strength=0 bit-exact, seed
boundary, diversity_bonus ∈ [0.7, 1.0].

3 Stage 3: Barabási-Albert (#22), cold-start hostile razão > 5x
(#23), Spearman ρ entre janelas adjacentes ≥ 0.85 (#24).

### Parâmetros sujeitos a revisão Phase 1.5

Estes podem ser ajustados via telemetria (sem virar `user_prefs` —
PPR precisa ser determinístico cross-device, manifesto §7):

| Parâmetro | Trigger pra ajustar |
|---|---|
| `K=1000` | Se `ε_uniform > 0.10` impacta UX top-N |
| `BETA_MAX=1.5` | Se `top1_ppr_concentration_p95 > 0.30` |
| Normalização log → quantile-rank | Se regime skew > 3x cold/maduro |
| Banner window boundary | Se Spearman ρ < 0.70 entre janelas |

Override via build flag (Phase 2), nunca runtime setting do user.

### Source-of-truth

- Constants: `src/lib/trust/constants.ts`
- Plano consolidado: `Docs/plans/trust-lens-phase1-plan.md`
- Deliberação HIMYM 5/5: `Docs/sessions/trust-lens-math-stage3-himym-2026-05-17.md`
- Math review Stage 1 (Marshall): `Docs/sessions/trust-lens-math-marshall-2026-05-17.md`
- Survey arquitetural: `Docs/sessions/zero-trust-survey-ted-2026-05-17.md`
- UX decisions: `Docs/sessions/trust-lens-multilist-lily-2026-05-17.md`

---

## Em uma frase

Sua Lente é uma forma de **ver a rede do seu jeito** sem que ninguém
mais — nem o Drift, nem outro user, nem operador algum — veja como
você está vendo. É privada por design, opcional por princípio,
auditável por código aberto, e descartável a qualquer momento via
slider em 0%.

Você sempre fica no controle. Sempre. Esse é o ponto.
