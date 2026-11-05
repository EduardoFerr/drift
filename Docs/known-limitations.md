# Known Limitations — Drift

Índice de limitações conhecidas (gaps deliberadamente deferred, attack
vectors documentados sem fix imediato, simplificações de Phase 1 que
serão revisitadas). Cada item tem:

- **Issue** — descrição precisa
- **Risk** — quem é afetado + severity
- **Mitigation** — defesa atual (mesmo que parcial)
- **Reopener** — condição que dispara fix

Mantenha esta lista **honesta**: não suprimir achados de Satoshi/Barney
audits só por feio. Defer documentado > silence.

---

## Trust Lens

### 1. ~~Sybil edge-refresh bypassa PPR decay temporal (GAP-1)~~ ✅ FECHADO

- **Status:** FECHADO 2026-05-20 via Gap B fix.
- **Issue original:** `temporalDecay()` usava `updated_at` (refresh-on-write).
  Sybil que re-segue/re-drifta resetava timestamps → decay = 1.0.
- **Fix shipado:**
  - Schema: `lens_edges.created_at INTEGER` nullable adicionado via
    migration additive em `db.worker.ts:applyMigrations`
  - Backfill conservative: rows pré-migration recebem `created_at =
    updated_at` (pior caso aceito; trava após 1 write)
  - Writers (`trust-lens.ts:upsertLensEdge` + `trust/edges.ts:upsertEdge`):
    `created_at` no INSERT columns mas NÃO no `DO UPDATE SET` — imutável
    após primeiro INSERT por construção SQL
  - Reader (`recomputeLens`): SELECT inclui `created_at`, decay usa
    `row.created_at ?? row.updated_at` (COALESCE defensivo)
  - 4 conformance tests source-grep (`#28-#31` em `trust-lens-math.test.ts`)
- **Surface residual:**
  - Grace window 1-write em rows pré-migration: edge antigo com backfill
    `created_at = updated_at` ainda pode ser "burlado" 1 vez até próximo
    refresh, depois trava
  - DB-backed integration tests (real upsert + sleep + re-read) defer
    porque exigem SQLite WASM init em Vitest Node — conformance source-
    grep cobre o pattern
- **TODO restante FECHADO 2026-05-21:** refactor DRY shipado —
  `upsertLensEdge` em trust-lens.ts virou thin wrapper que delega
  `upsertEdge` em trust/edges.ts. Single source of truth pro SQL.
  Conformance test #29 atualizado pra travar o pattern (1 SQL site).

### 2. HINT_RULES + GuidanceRule.body — JSX injection vector futuro (DAOP Phase 2+)

- **Issue:** `body: (ctx) => ReactNode` permite JSX arbitrário do caller.
  Hoje hardcoded no repo (versionado, auditável). Se Phase 2 DAOP carregar
  hints remotos (RFC futura), factory pattern abre XSS via JSX inject.
- **Risk:** LOW hoje (regras vivem no repo). MEDIUM em Phase 2 remoto.
- **Mitigation:** Hardcoded em `src/lib/guidance.tsx`; LOCK_VIA_TEST
  `guidance-rules-conformance.test.ts` trava as 5 ONBOARDING_RULES + 1
  HINT_RULES atual.
- **Fix correto:** Se Phase 2 remoto: CSP nonce + DOM sanitizer +
  schema validation server-side (mas isso violaria §17 "sem chave mestra
  na guidance"). Conclusão provável: NUNCA fazer remote DAOP.
- **Reopener:** RFC pra hints dinâmicos / remotos surgir.

### 3. Cluster detection (LPA) defer Phase 2 (GAP-CLUSTER)

- **Issue:** Trust Lens não detecta clusters de Sybil rings via Label
  Propagation Algorithm (LPA). Custo O(V·E) por iteração + sem dados
  reais pra calibrar threshold de cluster_density.
- **Risk:** LOW hoje (base small). MEDIUM se atacante explorar.
- **Mitigation:** PPR já tem path diversity scoring + W_BIAS=-2.0
  (anti-Sybil em cold-start hostile). Defesa em camada.
- **Reopener:** DAU > 1000 + grafo médio > 100 follows/user, OR
  FORA/Vertex telemetry indicar discovery gap.

### 4. PR-4c worker thread defer

- **Issue:** PPR recompute roda em main thread (~75ms median mid-range
  phone).
- **Risk:** LOW. Abaixo do RAIL 100ms threshold.
- **Mitigation:** debounced + run apenas em triggers (follow change,
  50 events, 24h TTL).
- **Reopener:** Telemetria local p95 > 200ms OR user report de UI
  stutter.

### 4b. Lente alimentada SÓ por follows (interação não cabeada) — Fase 2b

- **Issue:** o builder de aresta por interação (`recordEdge` on-spread,
  `lens_edges` interação-ponderado) **não tem caller** ainda. Até
  2026-05-30 NADA chamava `recomputeLens` → a lente ficava dormente
  (pprScores vazio, cores/pontes nunca apareciam). Corrigido cabeando
  `bootstrap.ts:startLensAutoRecompute` (boot + on follows-change) com
  `recomputeLens` caindo pro **grafo de follows (NIP-02, influence=1)**
  quando `lens_edges` está vazio.
- **Status:** PARCIAL. A lente acende (follows-graph), mas é HÍBRIDO só na
  teoria — a metade de interação (spreads ponderando influence) ainda não
  popula `lens_edges`. Hoje toda aresta vale 1.
- **Risk:** LOW. Follows-graph já dá topologia válida + Sybil-resistência
  (PPR do meu nó). Falta só o refinamento de peso por preferência revelada.
- **Mitigation:** decisão de fonte registrada (HÍBRIDO) em
  `nota interna`; fallback follows
  documentado no código. Pontes (`wot.ts:findBridges`) dependem da
  PROFUNDIDADE do follow-graph, não da interação — já funcionam.
- **Reopener:** quando wirar `recordEdge` no ingest de SPREAD próprio
  (interação ponderada live) — vira increment "Fase 2b+".

---

## Weight / Score

### 5b. Event NOP pode resetar contador de inactivity (PARCIALMENTE FECHADO)

- **Issue original:** `users.last_active` atualizado em qualquer evento
  assinado. Vetor: POST kind 9078 com `{subposts:[]}` passava no
  schema validation e disparava `updateUserActivity`.
- **Status atual (pós-Satoshi devsec fix 2026-05-20):**
  `validatePostShape` em `events.ts` agora REJEITA POST com
  `subposts.length === 0`. Evento NOP nem chega ao pipeline persist.
  Defesa em camada no schema gate. Cliente Drift oficial NUNCA cria
  POST sem subposts; atacante que tenta é bloqueado.
- **Surface restante:**
  - SPREAD/BURY/REPORT exigem tag `e` válida (hex64) — atacante
    precisa referenciar post real existente
  - COMMENT (kind 1111) exige tags `e`+`E` válidas + content não-vazio
    (já validado em parser)
  - Kind 0 (profile) e kind 3 (follows) NÃO chamam updateUserActivity
- **Risk pós-fix:** ~ZERO via NOP. Vetor remanescente exige criar
  evento referenciando post real (SPREAD/BURY/REPORT) — custo do
  atacante sobe pra "publicar conteúdo real OU repetir auto-spread"
  (que já não passa porque IGNORE INTO + idempotência).
- **Reopener:** Padrão de attack diferente surgir (ex: atacante usa
  spreads recíprocos em ring), OR weight tier 🌱→⭐ permanente em
  identidades óbvias.

### 5c. Brigada de moderadores insider — PARCIALMENTE FECHADO

- **Status:** PARCIALMENTE FECHADO 2026-05-21 (Barney devsec
  time-window decay).
- **Issue original:** 5 veteranos (weight≥75, 2pts cada) coordenados
  atingem threshold em comunidade média (~10k users → threshold 10pts)
  sem precisar Sybil farming.
- **Mitigation parcial shipada:**
  - Função pura `calculateEffectiveReportWeight(reportWeight, ageMs,
    halfLifeMs)` em `moderation.ts`
  - Pref `UserPrefs.report_decay_enabled` (default OFF — opt-in até
    telemetria validar). Quando ON, `aggregateReports` aplica decay
    48h half-life sobre cada report
  - O motor de ranking (`ranking.ts`) lê a pref via recomputação global
    → reports antigos pesam menos
  - 8 conformance tests novos em `tests/moderation.test.ts`
- **Surface residual (documentada nos próprios tests):**
  - **Brigada flash <1h:** decay 48h não pega (5 reports/1h = peso
    ~9.93/10.0). Test "brigada flash 1h" documenta como esperado.
  - **Consenso lento >120h:** legítimo sofre (5 reports/120h = peso
    ~5.47, exige ~2× mais reports pra moderar). Trade-off aceito.
- **Fix completo requer:** GAP-CLUSTER (cluster detection nos
  reporters) — Phase 2. Trust Lens diversity bonus combinado com decay
  fecha o gap em ambas direções.
- **Reopener:** Caso documentado de brigada coordenada real OR shipping
  de GAP-CLUSTER detection.

---

### 5d. Partida a frio do peso (âncora OpenTimestamps)

- **Status:** ABERTO por design (auditoria 2026-11-03).
- **O que é:** desde que a antiguidade passou a vir de prova
  OpenTimestamps verificada no Bitcoin (antes: `created_at` forjável),
  toda identidade começa com antiguidade 0 até carimbar — inclusive as
  que já existiam, porque idade passada não carimbada não é provável.
  O engajamento é ponderado pelo peso de quem espalhou, então numa rede
  onde ninguém tem peso, ninguém ganha peso por spread.
- **Consequências:**
  - nas primeiras semanas após o deploy, scores ficam baixos e
    próximos entre si (o ranking é dominado pelo decay temporal);
  - moderação exige reporters com **peso ≥ 20 e ≥ 8 semanas de âncora**.
    Simulação da revisão (2000 usuários ancorados no deploy, cada um
    espalhando 10 autores): ninguém reporta até a semana 8; 193 na
    semana 8; 944 na 10; 1600 na 12 (7 reporters medianos bastam pra
    `illegal`); 1973 na 16. Ou seja, **a moderação comunitária fica
    desligada por ~10–12 semanas após o deploy**. Filtros locais
    (bloquear/silenciar) continuam valendo o tempo todo.
  - votos (DRIFT/SINK/comentário) só contam a partir de peso 4 com 2
    semanas de âncora: na simulação, ninguém vota até a semana 4 (scores
    todos 0) e todos votam na 6. **O feed fica ordenado só por recência
    nas primeiras ~4–6 semanas.**
- **Por que aceito:** qualquer atalho (piso de peso, antiguidade pelo
  `created_at`, report de peso 0 valer algo) reabre Sybil gratuito —
  10 chaves derrubavam qualquer post, 6 chaves davam peso 60.
- **Reopener:** proposta de semente de confiança que não seja chave
  mestra (§17) — ex.: lista de âncoras publicada e assinada por N
  operadores independentes, opt-in por cliente.

### 5e. Âncoras não verificadas em modo Tor

- **Status:** ABERTO.
- **O que é:** verificar uma prova OTS exige consultar exploradores
  Bitcoin (clearnet). Com `network_mode ≠ clearnet` o cliente não
  consulta, as provas ficam pendentes e as identidades correspondentes
  têm antiguidade 0 **neste cliente** — o ranking dele diverge do de
  clientes clearnet.
- **Reopener:** explorador acessível via Tor/onion, ou headers Bitcoin
  embarcados/sincronizados por P2P.

### 5g. Endpoints OpenTimestamps fixos no código

- **Status:** ABERTO.
- **O que é:** calendários (`ots-client.ts:DEFAULT_CALENDARS`) e
  exploradores Bitcoin (`DEFAULT_EXPLORERS`) não são configuráveis em
  UserPrefs, ao contrário de upload e tiles (padrão "endpoints de
  soberania"). Desligar o carimbo ou usar Tor evita os calendários; os
  exploradores são evitados só em Tor.
- **Reopener:** pedido de self-host de calendário/explorador, ou
  `ots_calendars`/`btc_explorers` em UserPrefs.

### 5h. Pré-envelhecimento de chaves é barato e paralelo

- **Status:** ABERTO por design (inerente a antiguidade como time-lock).
- **O que é:** hoje alguém gera N chaves, assina 1 evento de cada (sem
  publicar) e carimba todos numa única raiz OTS. Antiguidade custa
  TEMPO, não custo por identidade. Os mínimos de elegibilidade (voto ≥ 4,
  report ≥ 20) convertem "muitas chaves × 1 dia" em "cada chave × semanas
  reais": antes, 1200 chaves de 1 dia moderavam qualquer post `illegal`.
  Medido na revisão (rodada 4): o ataque mais barato hoje são 3
  "concentradores" com ~8,6 semanas de âncora, cada um endossado por ~100
  chaves de ~4,3 semanas — ~300 chaves e **~9 semanas de preparação**
  (paralelizável) pra moderar um post de veterano em rede pequena.
- **Mitigação existente:** o orçamento conservado (`ranking.ts`) impede
  que essas chaves gerem peso umas para as outras além de 2× a soma das
  antiguidades; a base ativa ponderada faz cada uma também elevar o
  threshold. A defesa contra 1M chaves pacientes é a soma delas ser
  pública e auditável no Bitcoin (todas carimbadas na mesma raiz).
- **Reopener:** custo por identidade que não seja PoW (§33) nem chave
  mestra (§17) — ex.: carimbo exigindo prova de liquidez Lightning.

### 5i. Recomputação global roda no main thread

- **Status:** ABERTO — follow-up (revisão pré-merge, Ted #5 / Satoshi F6a).
- **O que é:** `recalcAllScores` carrega todas as tabelas e roda
  `computeRanking` na thread principal, com debounce de 100 ms e teto de
  5 s sob tráfego contínuo. Medido no Node (desktop): ~0,9 s com 20k
  usuários e 200k spreads em cadeia adversarial; ~100–300 ms em 10k posts
  e 50–200k spreads. Celular: 3–5× mais lento.
- **Reopener:** mover `computeRanking` (puro) para o db worker — também
  elimina o clone das linhas entre threads.

### 5j. Moderação derivada pode deixar de valer

- **Status:** ABERTO por design.
- **O que é:** a moderação é recalculada do conjunto de reports com os
  pesos ATUAIS, de forma conservadora (só modera o que resiste às
  penalidades de todos os candidatos). Em ataque simétrico — dois lados
  se denunciando — nenhum dos dois é moderado. Provado na revisão: o
  spammer x e 2 cúmplices (8+ semanas) denunciam um post Q do reporter
  honesto h; h e outros denunciam o spam S de x; no pior caso x e h são
  penalizados juntos e **S e Q escapam**. Custo: poder de report ≥
  threshold sobre um post de cada reporter-alvo. Não funciona contra
  reporters que valem só pela antiguidade (o −15 sai do engajamento): a
  comunidade neutraliza com reporters veteranos.
- **Eviction apaga a penalidade:** posts moderados (−999) são os primeiros
  a sair do cache local (`cache.ts` ordena por score). Sem o post, os
  reports dele deixam de contar e o −15 do autor some NESTE cliente. Um
  flood de ~10k posts acelera. Reopener: materializar contagem de posts
  moderados por autor, ou não despejar moderados antes de N dias.
- **Além disso:** Se os reporters perderem peso (inatividade, moderação dos
  próprios posts) ou a base ativa crescer e subir o threshold, um post
  moderado pode voltar ao feed. Com `report_decay_enabled` a meia-vida é
  medida contra o report mais recente, então a passagem do tempo sozinha
  não desfaz.
- **Reopener:** decisão de produto de tornar moderação "pegajosa"
  (ex.: uma vez moderado, só desfaz por evento explícito).

### 5k. Limites numéricos do motor

- **Status:** ABERTO (aceitável).
- **O que é:** o ponto fixo de pesos para em 200 iterações ou tolerância
  relativa 1e-9 (a contração converge em ~35); o laço monótono de
  moderação para em ≤ nº de posts reportados rodadas. Ambos são
  determinísticos. Comentários com `score = -999` são excluídos do
  ranking, mas nada grava esse valor hoje (moderação de comentário não
  existe).

### 5f. Convergência exige o mesmo conjunto de eventos

- **Status:** ABERTO (limite de arquitetura, não bug).
- **O que é:** o motor garante mesmo resultado pra mesmo conjunto de
  eventos, em qualquer ordem. Clientes com conjuntos DIFERENTES (relays
  diferentes, janela de sync de 7d, `limit 500` por relay) ainda podem
  divergir. Mitigações shipadas: busca de post órfão por id, busca de
  provas OTS por autor, rebroadcast com votos primeiro.
- **Reopener:** paginação de histórico por `until` (TODO em `sync.ts`)
  ou relays de arquivo dedicados.

### 5l. Aba Contágio — o que a Fase 1 ainda não cobre

- **Status:** ABERTO (fases 2–3 planejadas; `BACKLOG.md` "Contágio").
- **O que é:** a Fase 1 (`Docs/algoritmos.md` §9) usa só o que o app já
  tem: follows do leitor, o que ele impulsionou e o que ele denunciou.
  Ficam de fora, com efeito medido na simulação
  (`Docs/spec-revisao-contagio.md`, rodadas `fase1__*`):
  - **Isca:** contas falsas que postam conteúdo bom conquistam o vínculo
    de 0,8 com quem as impulsiona e depois trazem spam. Na Fase 1, 2,9%
    das pessoas veem ataque, com picos de 11% e mais de 5% em metade dos
    dias simulados; o lockstep da Fase 2 leva a 0,2%. A simulação anterior
    (1,4%) supunha que o leitor corta o vínculo que trouxe spam em 40% das
    vezes; o app não tem esse gesto (BACKLOG "Deixar de seguir quem
    trouxe"; com ele, 1,8%). Punir também no SINK baixaria a isca para
    1,4%, mas com 10% de SINK por gosto derruba o alcance honesto de 29%
    para 5% e deixa 30% dos feeds quase vazios (spec §4.6). **Os 2,9%
    supõem denúncia em 35% dos spams vistos**: com 10%, a isca vai a 12,4%;
    com 5%, a 22,3% (revisão em par, Satoshi). O gesto privado de cortar
    quem trouxe é a alavanca de maior retorno e é condição para a aba virar
    padrão.
  - **Funil do Global:** a fazenda domina o feed global; quem segue e dá
    DRIFT numa isca lá cria, por escolha própria, o vínculo de 0,8 que traz
    spam na aba. Aproximação: 0,5%–2% de DRIFT em isca por dia ativo → isca
    de 7,7% a 20,4%. Exigir DRIFT em 2 dias não compensa (−7 pontos de
    alcance).
  - **Fazenda postando spam pelas próprias contas:** conta de isca que já
    vale 0,8 posta spam direto (o caminho direto só exige vínculo > 0) —
    6,5% na simulação; as rodadas publicadas supõem que a fazenda só
    impulsiona o spam do dono.
  - **Culpa trocada:** o atacante posta algo bom, um contato honesto dá
    DRIFT, e depois troca mídia sem hash, nome ou avatar por abuso; quem
    denunciar na aba pune o contato honesto (1–3% dos vínculos honestos em
    24 semanas). Defesa futura: só mídia verificada na aba e uma lista
    local "quem perdeu vínculo por denúncia sua" com "perdoar" (o atacante
    não consegue disparar o perdão).
  - **Difamação com vínculo forte:** uma conta de isca (0,8) + uma só
    seguida (0,5) somam 1,3 e põem qualquer post em quarentena, inclusive
    post direto de amigo, sem o leitor ver. Pequeno hoje (0,5% dos
    leitores); a métrica certa é "posts honestos escondidos", não "% que vê
    ataque".
  - **Vínculos invisíveis e sem volta:** o leitor não vê os vínculos nem as
    experiências ruins registradas, e uma denúncia por engano não se desfaz
    (quem ele só segue some da aba de vez). Reopener: tela "seus vínculos"
    (BACKLOG "Por que vi isto").
  - **Alcance:** o post mais viral chega a ~38% pela aba (29% com 10% de
    SINK por gosto; 82–92% com encontros físicos e o mapa da área, Fases
    2–3).
  - **Engenharia social em escala:** gente real enganada cria vínculo
    forte de verdade com o atacante; nenhuma regra de grafo separa isso
    de influência real. Contido pela denúncia, que baixa o vínculo com o
    autor e com quem trouxe (0,1% veem ataque, pico 9%).
  - **Quem trouxe fica em cada aparelho:** a experiência ruim com o autor
    é gravada no aparelho e também sai das denúncias do leitor que o sync
    trouxe (com o alvo da tag `p`); num aparelho novo, contam só essas. A
    com quem trouxe só existe no aparelho onde a denúncia foi feita na aba.
  - **Denúncia offline:** o envio aos relays não é confirmado (bug à parte
    em `transport/wss.ts`); a denúncia feita sem rede pune localmente o
    autor e quem trouxe, mas não sai do aparelho.
  - **Inundação no sync:** o sync pede os eventos recentes da rede com
    limite por assinatura; quem publica em volume pode empurrar para fora
    da janela as ações dos contatos, e a aba fica com menos entradas
    (BACKLOG "Assinatura própria para as ações dos contatos").
  - **Moderação global vale na aba:** post com `score = −999` (§26) some
    de todas as abas, inclusive desta; uma brigada que modere post
    honesto também o tira da aba Contágio (ver §5c).
  - **Bolha ideológica:** a simulação mediu abertura entre cidades (igual
    à do feed global), não diversidade de opinião — o simulador não tem
    opiniões.
  - **Janela de sync:** o vínculo conquistado usa os DRIFTs do leitor que
    estão no SQLite local; um dispositivo novo só "lembra" o que o sync de
    7 dias trouxe (`sync.ts`), então começa com vínculos de 0,5.
  - **Eclipse:** quem usa 1–2 relays controlados pelo atacante perde a
    vacina e a quarentena dos contatos (o atacante só omite). O ataque
    fica contido (0,0%), mas o alcance honesto cai para 27% na Fase 1
    (38% sem eclipse; ~25 pontos no modelo completo). A defesa é de produto: piso de
    diversidade de relays (≥ 6 relays de ≥ 3 operadores).
- **Reopener:** Fase 2 (lockstep, aval, período de experiência; contágio
  como padrão) e Fase 3 (mapa da área e encontros físicos), cada uma
  simulada antes de entrar.

## Anti-spam

### 6. Content-hash dedup — pesquisado, NO-GO atual

- **Issue:** sem mecanismo de "mesmo content = sinaliza dup". User
  poderia argumentar: "spam é copy-paste em flood; hashear content
  como NIP-94 faz com imagens seria defesa natural."
- **Status:** **NO-GO atual** após deliberação Satoshi + Ted
  (2026-05-21). Decisão registrada em
  `nota interna`.
- **Razões NO-GO:**
  - **Evasão custo zero:** atacante muda 1 char (espaço, emoji,
    homoglyph cirílico) → hash diferente. Não eleva tax.
  - **Redundante:** Sybil novo já tem `weight=0` → spread vale 0 →
    posts invisíveis no feed canônico. Defesa atual paga o custo.
  - **Falsos positivos:** cenário breaking news (32 pessoas postando
    "Grêmio 3x2") penaliza 31 por acaso.
  - **§17 risco:** UI agrupando clones esconde post legítimo de quem
    postou depois → quase-censura.
  - **Slope:** hash → fingerprinting → similarity matching → filtro
    centralizado.
- **Defesas atuais que já funcionam:**
  - `weight=0` pra Sybil novo (invisibilidade automática)
  - max 1 subpost pra `weight<20` (tax em volume)
  - Threshold dinâmico de moderação (tax em coordenação)
- **Plano arquitetural pronto (Ted Opção B)** se reabrir: coluna
  `posts.content_hash`, função pura `hashPostContent(subposts)` em
  `lib/protocol.ts`, opt-in via `UserPrefs.dedup_enabled` default OFF,
  penalty em `calculateScore`, never-hide-own-post (Satoshi mitigation).
- **Reopener:**
  - Evidência concreta de spam que NÃO foi resolvido por `weight=0`
    (ex: identidades veteranas farmadas postando flood coordenado)
  - OR designs futuros de moderação precisarem de hash como primitivo
    (ex: agrupar reports por content-hash em vez de post-id)
  - Suspicion geral NÃO basta — exige attack pattern documentado.

---

## DAOP / Capabilities

### 5. dismissRule sem rate limit

- **Issue:** `capabilities.ts:dismissRule(id)` grava em `user_prefs`
  sem throttle. Atacante via XSS bug pode spam-dismiss em loop.
- **Risk:** LOW. RULE_ID_PATTERN filter + Set dedup limitam overflow;
  bag CSV cresce O(rule count distinct) ~50 max.
- **Mitigation:** `serializeDismissedBag` filtra IDs inválidos no
  write. `RULE_ID_PATTERN` rejeita malformed.
- **Fix correto:** Debounce em UI handlers OR pref `dismiss_rate_limit`.
- **Reopener:** XSS vuln descoberta no app, OR user report de bag
  corrupted.

---

## Image / Blobs

### 6. Image fallback `<img src>` sem hash verify (legacy posts)

- **Issue:** Posts pré-NIP-94 ou sem `meta` field no subpost caem no
  `src` direto sem SHA-256 verify. Hash defense só ativa quando
  `meta.hash` presente.
- **Risk:** LOW. Atacante precisa controlar relay + tags do post pra
  injetar URL diferente — modelo de ameaça similar a NIP-01 padrão.
- **Mitigation:** `fetchBlobUrl(meta)` verifica hash quando presente;
  fallback é último recurso.
- **Reopener:** Quando posts pré-NIP-94 ficarem residuais (< 1% do
  feed), considerar hard-fail em vez de fallback.

---

## Mapas

### 7. K-anonymity ausente em SpreadMap (K=1 doxx residual)

- **Issue:** mapa de post mostra pin único quando user é o ÚNICO com
  GPS no spread. Em cidade pequena, community knowledge identifica o
  spreader (ex: "era só Pedro naquela favela que viu este post").
- **Risk:** HIGH em small towns (pop <50k). Manifesto §28 vaza
  empiricamente — opt-in default OFF é mitigação parcial mas user
  pode habilitar GPS sem entender o risk.
- **Mitigation atual (parcial, shipada 2026-05-21):**
  - Helper puro `isUserSoloSpreader(data, activeNpub): boolean` em
    `src/hooks/useSpreadMap.ts`
  - Component `SoloSpreaderWarning` overlay top-right do mapa em
    modo `post`. Copy: "📍 você é o único com GPS aqui — sua
    localização é identificável..."
  - Trigger automático quando `data.totalSpreads === 1 &&
    firstSpread.spreaderPub === activeNpub`
  - Dismissal session-only (rebornece em outro post K=1)
  - Educa user organicamente — não esconde o pin do mapa (manifesto
    §17: cliente não decide unilateralmente)
- **Fix completo (Phase 2):** K-anonymity engine. Opções:
  - **Suppression:** mapa não renderiza se K < 3 → trade-off coverage
  - **Aggregation:** bucket regional 50km quando K < 3 → trade-off
    fidelidade
- **Reopener:** DAU > 1000 + telemetria empírica de K distribuição
  OR user report concreto de doxx em small-town community.
- **Doc canônico:** `Docs/threat-model-maps.md` §K=1-DOXX.

---

## Distribuição

### 7. Tauri binary distribution não shipped

- **Issue:** Manifesto §15 (anti-censura por país) + §17 (sem chave
  mestra na distribuição) + §21 (anonimato) dependem de cliente nativo
  Tauri com Tor embedded. PWA browser não cobre Tor.
- **Risk:** MEDIUM. Users que precisam Tor (jornalistas, dissidentes)
  não têm acesso ao Drift hoje.
- **Mitigation:** Roadmap explícito (Fase 6 + Fase 7); F-Droid
  manifest planejado; TWA Android antecipado via Bubblewrap.
- **Reopener:** É o trabalho ativo — não fechável até Fase 6/7
  shipparem.

### 9. Multi-identidade da mesma sessão é correlacionável no fio (WSS)

- **Issue:** O per-post identity picker (manifesto §4, `lib/identity.ts:
  signWithNpub` + `ComposeOverlay`) deixa o user assinar um post com uma
  identidade ≠ ativa sem trocar a sessão. Mas postar **várias identidades
  da MESMA sessão** é **ligável por um observador de rede** (operador de
  relay, ISP, MITM): mesmo IP de origem, mesmo conjunto de relays
  (read/write), mesmas conexões WebSocket persistentes, e timing apertado
  (dois posts de "personas distintas" minutos um do outro, da mesma
  origem). O picker escolhe a CHAVE que assina — não esconde a ORIGEM da
  conexão.
- **Risk:** MEDIUM-HIGH pra quem depende do picker pra compartimentalizar
  personas adversariais (jornalista/fonte, dissidente). O picker pode
  induzir falsa sensação de separação ("estou postando como outra pessoa")
  que o transporte não entrega. Vender essa segurança falsa seria pior que
  o limite em si (manifesto §28 honestidade).
- **Inerência:** Limitação **do transporte WSS** (WebSocket clearnet
  direto), não do picker nem da camada de assinatura. Não é corrigível no
  cliente atual — assinar com chave diferente não muda o circuito de rede.
- **Mitigation atual:**
  - **Disclaimer honesto one-time** no `ComposeOverlay`: quando o user
    escolhe uma identidade ≠ ativa pela primeira vez, aparece nota
    dismissível citando IP/relays/horário + Tor na Fase 6. Persiste o
    dismiss em `user_prefs.multi_id_correlation_notice_dismissed`.
    LOCK_VIA_TEST `compose-identity-picker-conformance.test.ts`.
  - **Guia do usuário** documenta o limite + recomenda sessões/devices/
    redes separados pra separação real hoje.
  - O picker NÃO bloqueia publicação (informativo); o hard-confirm
    GPS×identidade que já existe cobre o caso pior (deanon cruzado por
    localização).
- **Fix correto:** **Fase 6** — cliente nativo Tauri com Tor embedded
  (arti), cada identidade saindo por **circuito Tor isolado** (stream
  isolation por persona). Isso quebra a correlação por IP + mistura o
  timing. WebRTC P2P + multi-transport complementam. Mesmo dependente
  de §15/§21 (item 7).
- **Reopener:** Fase 6 Tor transport shipado com stream-isolation
  per-identity validado, OR design de "perfil de rede por identidade"
  (relay set distinto por persona) que reduza a correlação já no PWA
  (paliativo parcial — não fecha IP/timing).
- **Doc canônico:** manifesto §4 + §21 + §28; invariante #15;
  spec do picker.

---

---

## Anti-eclipse / Discovery

### 8. Random walk pós-CONNECTED entry não shipado

- **Issue:** `src/lib/probe.ts` roda probe periódico 30min pra
  detectar relay malicioso (silent-drop, fork, eclipse setup) — isso
  está shipado. Mas **random walk ATIVO pós-CONNECTED** — amostragem
  contínua de peers conhecidos após entrada na rede, conforme
  manifesto §20 — não foi entregue no transporte WebRTC. Hoje, uma
  vez `CONNECTED`, o cliente confia no conjunto de peers descoberto
  via bootstrap + nostr signaling, sem re-amostragem agressiva.
- **Risk:** MEDIUM. Eclipse attack via relay coordinator (atacante
  controla todos os relays iniciais que o cliente conhece) só tem
  defesa em camada via probe periódico — não há descoberta contínua
  de paths alternativos pós-entry. Em país com poucos relays
  acessíveis (cenário §15), isso aproxima MEDIUM-HIGH.
- **Mitigation atual:**
  - **Probe periódico 30min** (`startProbe()` em bootstrap) detecta
    silent-drop e fork comparando estado entre relays redundantes
  - **Path diversity scoring** em `src/lib/transport/webrtc/peerScore.ts`
    avalia peer por quantos caminhos independentes levam a ele —
    mitiga influência desproporcional de um operador
  - **Multi-relay publish** (sempre ≥2 relays paralelos, manifesto
    §14) reduz custo do atacante a coordenar TODOS os relays
    descobertos
  - **Cluster detection** em peer registry (`webrtc/discovery.ts`):
    se >70% dos peers vêm da mesma origem inferida, cliente entra
    em estado `ISOLATED` — mas isso é check de ENTRY, não contínuo
- **Fix correto:** Random walk com path diversity quando WebRTC
  P2P discovery shipar completo em Fase 6.4. Amostragem aleatória
  de peers conhecidos a cada N minutos, com weight inverso à
  path diversity já estabelecida (peers de origem under-represented
  são preferidos). Função pura calculável + testável.
- **Reopener:** Fase 6.4 WebRTC P2P transport completo (PeersCard
  UI shipped + bootstrap UX validado em campo) OR telemetria
  local mostrando eclipse attempt real (ex: probe detecta fork
  recorrente em ambiente específico de user).
- **Doc canônico:** `Docs/webrtc-6.4-plan.md` §random-walk;
  manifesto §20.

---

*Última atualização: 2026-05-21 (criado em pair-review Lily + Barney+Satoshi;
§8 random walk adicionada por Robin Sprint N+2).
Reabrir requer condição explícita do "Reopener" — não suspicion geral.*
