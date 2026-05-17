# Trust Lens — Zero-Trust em NÓS vs CLUSTERS (Ted)

**Data:** 2026-05-17
**Persona:** Ted (arquitetura, math, padrões)
**Escopo:** Síntese arquitetural a partir do WoT deep dive do Barney
(`Docs/sessions/trust-lens-wot-deep-dive-barney-2026-05-17.md`) e do meu
próprio survey zero-trust (`Docs/sessions/zero-trust-survey-ted-2026-05-17.md`).
Foco: como zero-trust se aplica em **dois níveis distintos** — nó
individual (npub) vs cluster coordenado — e onde Phase 1 trata os dois
como a mesma coisa.

---

## Veredito

Drift Phase 1 trata **nó e cluster como se fossem o mesmo objeto** —
PPR opera sobre um grafo dirigido npub→npub, sem nenhuma noção de
"grupo coordenado". Sock puppets e usuários honestos entram no mesmo
pipeline com a mesma forma. Isto é zero-trust honesto em **nível de
nó** (W_BIAS=-2.0 em `constants.ts:81`, sigmoid, path diversity cap
M=0.3) — e **omissão estrutural** em nível de cluster.

Compensações parciais existem: path diversity (`plan §1.2:117-124`) é
defesa anti-Sybil-anel implícita. Não é cluster detection — é "esta
edge atravessa quantos pontos disjuntos?". Funciona contra sock-puppet
chains lineares; não funciona contra **anel denso pequeno** (Sybil
ring signature clássico, Yu 2008).

**Recomendação:**

- Phase 1.5 = telemetria local de **clustering coefficient** dos top-N
  por PPR. Custo desprezível. Decide se Phase 2 precisa de detection
  ativa.
- Phase 2 = label propagation cluster detection + edge penalty em
  membros de cluster suspeito. Custo aceitável em mobile.
- Phase 3 = modularidade Louvain só se telemetria Phase 1.5 mostrar
  clusters > 5% da vizinhança PPR média.

Não é ship-block de Phase 1. É gap nomeado a fechar antes de Phase 2
Vertex DVM — porque DVM amplifica qualquer falha de detecção (mais
massa propagada por hop). Math abaixo.

---

## Decomposição zero-trust: NÓ vs CLUSTER

### Layer NÓ (npub individual)

**Definição:** cada npub começa em desconfiança e ganha influência via
comportamento observável **por mim** (o viewer). Não há trust
herdada de "rede" ou "lista oficial".

**Math em Drift atual** (`constants.ts:80-87`):

```
influence = sigmoid(
  W_BIAS                              // -2.0 anti-Sybil base
+ W_FOLLOW · follow_edge              // 1.5 se eu sigo, 0 caso contrário
+ W_MUTUAL · log(1+min(mutual, 20))   // mutual com vizinhança-de-1
+ W_MY_SPREAD · log(1+my_spreads)     // observação direta minha
− W_MY_BURY · log(1+my_buries)        // observação direta minha
)
```

`W_BIAS=-2.0` força σ(0)=0.119 pra FoF vazio (Stage 3 deliberação
locked esse valor). Razão direct:FoF ≈ 7x. **Cada npub novo entra em
0.119 de influência, não em 0.5 neutro.** Isto é zero-trust em nó
correto e bem fundamentado.

**Gap:** nenhum no nível de nó individual. Implementação é canônica.

### Layer CLUSTER (grupo coordenado detectável)

**Definição:** subgrafo de npubs com **alta densidade interna** e
**baixa densidade externa** (modularidade Q > 0.3 típico). Pode ser
legítimo (comunidade real) ou adversarial (sock puppet ring,
brigading squad). **Sem detecção, ambos parecem nó individual N vezes.**

**Math em Drift atual:**

```
[ vazio — Drift não computa nenhuma métrica de cluster ]
```

**Gap (estrutural):**

1. Nenhuma estatística agregada por cluster
2. Path diversity protege contra **chain attacks** (A→B→C→...→Z em
   linha), mas não contra **clique attacks** (A,B,C,D,E todos
   se-spreading mutuamente formando anel denso)
3. Aggregate cap por target (`Cenário E` Barney) é proxy primitivo de
   cluster awareness mas é per-edge, não per-grupo
4. Score `s_local` de **um único autor** considera caminhos pra ele,
   nunca a topologia local do bairro dele

**Por que importa especificamente em Drift:**

Nostr follow é zero-cost. SybilGuard/SybilLimit assumptions ("limited
attack edges", "fast-mixing graph") quebram completamente (zero-trust
survey §1.4). 50 sock puppets seguindo-se mutuamente custam 0 e
geram um cluster com clustering coefficient ≈ 1 — invisível pra PPR
puro porque PPR só vê edges individuais.

---

## Cluster detection algoritmos — pick

| Algoritmo | Complexity | Mobile-feasible | Precisão Sybil | Recomendação |
|---|---|---|---|---|
| **Louvain** | O(n log n) modularidade | Marginal (n>1k pesado) | Alta (Q > 0.3) | Phase 3 só se telemetria pedir |
| **Leiden** (Louvain refinado) | O(n log n) | Marginal | Alta + conectividade garantida | Phase 3 |
| **Label propagation (LPA)** | O(n+m) por iter, ~5 iter | ✅ Excelente | Média (estocástico, depende de seed) | **Phase 2 pick** |
| **Local clustering coefficient** | O(d²) per nó, top-N | ✅ Trivial em top-N | Baixa per-nó / Boa em agregado | **Phase 1.5 telemetria** |
| **Modularity-based motif counting** | O(n·d²) | Mid (top-N only) | Alta pra anéis | Phase 2 complemento de LPA |
| **SybilRank** (random-walk-based) | O(n log n) | ✅ Já temos PPR | Média | Reaproveita walks PPR — **bonus pick** |

**Justificativa do pick (Phase 2 = LPA, Phase 1.5 = clustering coef):**

- LPA é determinístico se sementeado com `hash(source || epoch)` (já
  fazemos isso pro PPR — `constants.ts` semente diária)
- Custo ~5-10ms em grafo de 500 nós (median Nostr power-user)
- Já produz `cluster_id` por nó — input direto pro edge penalty
- Clustering coefficient é métrica **gratuita** durante BFS depth-3 já
  rodando pro path diversity (`plan §1.2:117-124`). Reusa walk pra
  contar triângulos no caminho. **Phase 1.5 não custa nada novo.**

**Trade-off precisão vs false-positive:**

- LPA com threshold Q>0.3 marca ~5% dos nós em grafo Nostr esparso
  (estimativa Robin scrape pendente — `plan §5`)
- False-positive típico: comunidade legítima (devs Rust, tradutores
  PT-BR) parece cluster. Por isso edge penalty ≠ exclusão. Multiplica
  influence por 0.6-0.8, não zera.
- False-negative típico: ring com edge externa pra hub (Cenário E
  whaling combinado com Cenário B): hub puxa ring pra "comunidade
  ampla". Cluster modularidade cai. Mitigação: combinar com aggregate
  cap por target (`Cenário E` Barney) — proteção em camadas.

---

## Math da cluster detection no PPR pipeline

**Onde integra (3 pontos possíveis, ordem de invasividade crescente):**

### Opção A — Edge weight penalty (recomendado)

```
influence_with_cluster = influence · cluster_penalty(target)

cluster_penalty(target) = 1.0                            se cluster_id(target) = null
                        = 1.0                            se |cluster| ≤ 3
                        = max(0.5, 1.0 - 0.05·(|cluster| - 3))  caso contrário
                        cap em 0.5 (nunca zera — manifesto §17)
```

Aplica em `edges.ts:upsertEdge` antes do clip [0,1]. Cluster grande
(>13 membros densos) → multiplier 0.5. Não exclui — degrada.

Compatível com determinismo: cluster_id é função pura de adjacency +
seed. Conformance test #3 (PPR determinism) continua passando se
incluir cluster_id no estado serializado.

### Opção B — Walk-level reject

```
em sample_neighbor:
  if same_cluster(walk[0], candidate) AND walk_len > 2:
    skip candidate
```

Mais invasivo: muda algoritmo de walk. Quebra Hoeffding bounds porque
distribuição não é mais clean random walk. **Rejeitado.**

### Opção C — UI warning only

```
inspector chip extra: "@x está num cluster detectado (12 nós com
densidade 0.8)"
```

Não muda math. Defesa só passiva. Útil **em adição** a A, não
substituto. Lily handoff.

**Pick: A + C combinados.** Math defendida + transparência ao user.

### Modularidade local — formula concreta

Pra cada candidato a cluster identificado por LPA:

```
Q_local(C) = (Σ_{(i,j) ∈ E, i,j ∈ C} A_ij - (k_i · k_j) / (2m)) / (2m)
```

Onde A é adjacency, k_i é grau de i, m é total de edges no subgrafo
considerado (top-200 PPR + edges entre). Threshold Q_local > 0.3 marca
cluster como "denso suspeito" pro penalty.

Custo: O(|C|²) por candidato. Top-200 → max 40k operações por user
hour. Mobile-trivial.

---

## Mapping Barney's 5 cenários por nó/cluster

| Cenário | Nível primário | Defesa atual | Defesa adicional sugerida |
|---|---|---|---|
| **A — Famous npub hijacked (SIM swap)** | **NÓ** | Nenhuma (gap) | TOFU alarm (Phase 2, Barney handoff) — detecta divergência de comportamento do nó individual |
| **B — Coordinated political campaign (50 puppets, 6 meses)** | **CLUSTER** | Path diversity (parcial — só protege contra chains) | **Cluster detection + edge penalty** (proposta acima). Cenário B é o caso paradigmático que motiva todo este doc |
| **C — Mass-mute brigading (1000 users mutam X)** | **CLUSTER (anti-victim)** | PPR per-viewer protege direct viewers | Self-isolation alarm (Lily) + side-channel detecção: meu PPR pra @X caiu sem eu mutar = sinal |
| **D — State actor "lente oficial"** | **CLUSTER de listas** (não de npubs) | Refusal de gov-attested + disclosure (Phase 3 plan §2.9) | Adicional: lista importada com >N membros marcados como cluster por LPA → flag UI |
| **E — Whaling: hub-npub compromised** | **NÓ que amplifica topology cluster-like** | Aggregate cap M=0.3 + P_MAX=0.2 (proposta Barney) | Combinar com cluster penalty: hub no cluster grande ganha penalty extra (combo whaling+brigading) |

**Insight cross-cenário:** Cenário B + Cenário E combinados são o
worst-case. Sock-puppet cluster ELEGE hub comprometido como ponte pra
mainstream. Path diversity sozinho falha porque os paths atravessam
hub legítimo. **Aggregate cap + cluster penalty em camadas** é a
defesa que cobre ambos.

---

## GAPS por nó/cluster

Reorganizando os 8 GAPs de Barney + adicionando GAP-CLUSTER nomeado:

### Nível NÓ (5 gaps)

- **GAP-1 — Trust decay temporal** — edge influence é cumulativa por
  par (source, target). Spreads de 2 anos pesam = atuais. Fix: `weight
  *= exp(-(now - last_spread_ts) / τ)`, τ=90d. (Marshall handoff)
- **GAP-2 — Filter rule não propaga pra edge** — `filter_rule.action='hide'`
  veta render, mas walks continuam passando por target. Walks
  amplificam transitivos via nó "morto". Fix: `edge.influence_out = 0`
  se hide rule active. (Lily handoff)
- **GAP-3 — Transitive trust semântica** — PPR L=6 implica trust
  transitiva Carla→Bia→Ana. Plano não documenta se desejado. Decisão
  arquitetural: **sim, por isso α=0.15 decay forte**. Documentar em
  Plan §1.6.5 explícito.
- **GAP-5 — Explicit attestation primitive** — não há "anchor follow"
  com peso extra. Sugestão Barney: 3-5 npubs designados com boost.
  Risco: vira PGP UX-failure. Defer Phase 3.
- **GAP-6 — Cross-context contamination** — @x dev confiável + dev
  político radical mistura num número. Reframe Phase 3 multi-list
  como "contextos" (Robin handoff).

### Nível CLUSTER (3 gaps, 2 novos nomeados aqui)

- **GAP-CLUSTER-DETECT** (novo, este doc) — Drift PPR não detecta
  clusters coordenados. Cenário B Barney mencionou mas não nomeou
  como GAP. **Phase 2 fix via LPA + edge penalty.**
- **GAP-CLUSTER-VISIBILITY** (extensão de GAP-5 Barney "reverse Sybil"
  sem detect) — vítima de brigading não tem ferramenta pra ver
  cluster contra ela. UI warning + side-channel signal Phase 2.
- **GAP-4 — Cross-device transfer** — cache PPR não migra com nsec.
  Cluster awareness piora isso: re-detectar cluster do zero em device
  novo. Mitigação: snapshot encrypted opcional (Barney sugeriu,
  privacy concern). Phase 6 Tauri.

### Nível META (mantidos como Barney listou)

- **GAP-7 — Cache encryption at-rest** — `lens_walks_cache` em claro.
  Tauri attacker extrai grafo. Phase 6.
- **GAP-8 — Conformance test #9 insuficiente** — grep mais agressivo
  contra emit npub+score. Marshall já planejou.

---

## Recomendação Phase 1.5 vs Phase 2

### Phase 1.5 — Telemetria + clustering coefficient passive

**Ship junto com Rede view no SpreadMap** (`plan §2`). Aproveita o BFS
depth-3 já rodando pra path diversity:

1. **Reusa o BFS:** ao calcular `disjoint_paths(source, target, 3)`,
   conta triângulos no caminho. Custo marginal: ~0ms.
2. **Métrica local por nó top-N:**
   `clustering_coef(v) = 2·triangles(v) / (deg(v)·(deg(v)-1))`
3. **Telemetria local-only (não publicada):**
   - `clustering_coef_p50`, `_p95` dos top-100 PPR
   - `triangle_density` agregado
   - Histograma persistido em `user_prefs.lens_telemetry` (JSON)
4. **Decisão Phase 2:** se `clustering_coef_p95 > 0.6` em >20% dos
   users em 4 semanas, escalonar Phase 2.

**Ship plan Phase 1.5:**

- PR-7 (após PR-6 Rede view): adiciona função pura
  `localClusteringCoefficient(adj, topN)` em
  `src/lib/trust-lens/cluster.ts`
- ~30 LOC + 5 testes property-based
- Zero impacto math PPR (só telemetria observacional)
- Inspector mostra "comunidade ativa: X% das pessoas perto deste post
  se conhecem" — opt-in toggle em `lens_show_badges`

### Phase 2 — LPA + edge penalty (active defense)

**Trigger:** telemetria Phase 1.5 OU primeiro relato concreto de
Cenário B (community-reported brigading).

**Componentes:**

1. **`cluster.ts:labelPropagation(adj, seed) → Map<npub, clusterId>`**
   - Determinístico via seed = `hash(source || floor(now / 24h))`
     (mesmo padrão PPR)
   - Max 10 iterações
   - Cluster id estável entre janelas se grafo mudou <20%
2. **Schema patch:** adicionar `cluster_id` coluna nullable em
   `lens_edges` + index `idx_lens_edges_cluster`. Não vira `DOMAIN_TABLES`
   diff porque é derivado.
3. **Edge penalty integration em `edges.ts`:**

   ```typescript
   const penalty = clusterPenalty(target, clusterStats)
   influence = clip01(sigmoid(...components) * penalty)
   ```

4. **Conformance tests novos:**
   - #25: cluster_id determinismo (seed fixo + adj fixo → result
     bit-exact)
   - #26: penalty bounded [0.5, 1.0]
   - #27: cluster detection nunca propaga via Nostr (grep)
5. **UI Inspector chip extra:** "Este autor faz parte de um cluster
   denso de 14 pessoas detectado pela sua lente." (Lily copy)

**Cost:** ~50ms compute marginal por recompute (LPA + Q_local
top-200). Total recompute target sobe de 125ms (Stage 3) pra ~175ms.
Aceitável em mid-range phone. Debounced 200ms já cobre.

### O que NÃO entra (Phase 3+ ou nunca)

- Louvain/Leiden full — overkill pro tamanho de vizinhança Nostr
- Publicar cluster IDs via Nostr — viola §17, §22, §25
- Compartilhar cluster signatures entre users — vira EigenTrust
  catedral (zero-trust survey §6.3 bandeira vermelha)
- Banir conteúdo de cluster automaticamente — penalty é o limite

---

## Handoff

- **Marshall** — schema patch Phase 2: coluna `cluster_id` em
  `lens_edges` (nullable, sem migração necessária Phase 1 — adicionar
  só quando Phase 2 disparar). Property test: LPA determinismo com
  seed.
- **Barney** — threat re-review específico:
  - Cenário B com 50 puppets + LPA proposta: false-negative aceitável?
  - Aggregate cap + cluster penalty combinados criam under-protection
    em algum edge case?
  - Cenário D state-actor lista publicada: detecção LPA aplicada às
    listas importadas (não só ao grafo Drift) faz sentido?
- **Lily** — UX cluster warning:
  - Copy do Inspector chip ("cluster denso" sem soar como acusação)
  - Default OFF ou ON pro toggle clustering badge?
  - Tutorial banner Phase 1.5 quando user vê primeiro cluster
- **Robin** — empirical:
  - Mixing time Nostr real (precisamos do scrape graph-api.iris.to)
  - Clustering coefficient esperado em comunidades legítimas (devs,
    artists, jornalistas) pra calibrar threshold Q
  - Baseline cluster size de comunidades reais — distinguir do floor
    Sybil

---

## Notas de implementação cross-doc

- `constants.ts:81` (`W_BIAS: -2.0`) — base anti-Sybil em **nó** está
  certa, não mexer. Este doc adiciona camada cluster **em cima**.
- `plan §1.2:117-124` (path diversity) — defesa parcial cluster
  (chains). Manter. LPA adiciona defesa anti-anel.
- `plan §2.9` (Phase 3 multi-list) — cluster detection aplica também
  às listas importadas como cluster de **listas**, não só npubs.
  Considerar quando Phase 3 começar.
- CLAUDE.md invariante #11 — `s_local` carve-out já registrado.
  Cluster penalty cai sob mesmo carve-out (view-layer, nunca
  persisted no `posts.score` canônico).

---

*Documento de sessão — síntese arquitetural não-vinculante. Persona
Ted. Math fundamentado em zero-trust survey + WoT deep dive Barney +
math Stage 3 HIMYM. Próximo passo: review por Barney antes de Phase
1.5 PR-7.*
