# Modelo dos 3 mapas — deliberação Satoshi+HIMYM (2026-05-30)

Decisão de design convergida após deliberação (privacidade × honestidade ×
WoT emergente). Toca manifesto §22/§24/§25/§28 + invariante #11.

## Premissa que trava tudo
Evento SPREAD (kind 9079) carrega `[e=post, p=autor, location?]`. **NUNCA "via
quem"**. Logo a transmissão real (quem-viu-de-quem) NÃO existe nos dados —
registrá-la (tag `via`) vazaria o grafo de atenção → deanon. O protocolo
deliberadamente não captura caminho de transmissão (privacy-correct).

## Os 3 modos (distintos)

| Modo | Modelo | Lente? |
|---|---|---|
| **global** | estrela geográfica agregada (origem do post → spreader). Verdade canônica, compartilhada entre clientes. | ❌ nunca |
| **post** | **cascata viral HONESTA**: árvore estimada por tempo+proximidade (`lib/cascade.ts`). origem→spreader = LITERAL; spreader→spreader = `inferred` (tracejado + rótulo §28 "rota estimada"). | ❌ nunca |
| **network** | MINHA WoT emergente (PPR local) + sinais mecânicos pra podar a rede (pontes K=1, cluster isolado, filtro-hit). | ✅ só aqui |

## Princípios fixados
- **Lente só no network** (§24): canônico (global/post) nunca personalizado.
  `s_local` nunca persiste em `posts.score`, nunca vai pro Nostr (invariante #11).
- **Cascata = estimativa rotulada** (§28): nunca afirma transmissão registrada.
  A "sensação de infecção" vem do eixo TEMPORAL (scrubber), não de elos falsos.
- **WoT emergente, observador-relativo** (§17/§25): não existe "a rede decidiu".
  PPR brota da topologia pública vista do MEU nó. Tua lente ≠ minha lente →
  sem verdade global = sem chave-mestra. Anti-Sybil de graça (Sybil sem aresta
  de entrada da minha rede confiável → PPR ~0).
- **Saúde da rede = MECÂNICA, não moral** (§22/§25): "PPR baixo na sua lente",
  "ponte K=1", "cluster isolado" — descritivo, EU decido podar. NUNCA rótulo
  "saudável/tóxico" na pessoa (= reputação subjetiva / chave-mestra). NO-GO.

## NO-GOs registrados
- tag `via` (cadeia de transmissão registrada) → vaza grafo de atenção.
- rótulo moral "saudável/tóxico" em pessoa → reputação §22 + chave-mestra §25.
- lente no global/post → feed canônico personalizado §24.

## Fonte da aresta WoT (decisão 2026-05-30, "3 e 1")

Pergunta: o que define a aresta source→target da MINHA lente?
- **NIP-02 follows** = topologia pública, barata, dá FORMA ao grafo (PPR tem
  estrutura, pontes podem existir). Sybil-limitado: PPR do MEU nó exige caminho
  de entrada do meu conjunto confiável.
- **Interação (meus spreads)** = preferência revelada, mais cara de forjar, mas
  NÃO cria alcance novo — só reponderra. `lens_edges`/`computeInfluence` foi
  DESENHADO pra isso mas nunca foi cabeado.
- **Decisão = HÍBRIDO**: follows = base topológica (influence=1), interação =
  refinamento ponderado que tem PRECEDÊNCIA. Pontes dependem da PROFUNDIDADE do
  follow-graph, não da interação.

## Gap crítico descoberto + corrigido (2026-05-30)
`recomputeLens` / `recordEdge` / `upsertEdge` **não tinham NENHUM caller** →
`lens_edges` ficava vazio pra sempre → `pprScores` vazio → cores PPR (2a) E
pontes NUNCA acendiam no app real. Era o verdadeiro "gap da legenda".
**Fix**: `bootstrap.ts:startLensAutoRecompute` recomputa no boot + on
follows-change (debounced, fire-and-forget); `recomputeLens` cai pro grafo de
follows (NIP-02, influence=1) quando `lens_edges` vazio. MCP-validado:
cache PPR de grace acende com scores reais.

## Implementação (fases)
- ✅ **Fase 1**: post → árvore honesta (`lib/cascade.ts` + arcos `inferred`
  tracejados + rótulo §28). `tests/cascade.test.ts` (6) + `propagation-model.spec` (5/5).
- ✅ **Fase 2a**: lente gateada SÓ no network (`lensShowInMap = pref && mode==='network'`).
- ✅ **Fase 2b**: `lib/wot.ts:findBridges` (ponte K=1 = cut-vertex source-rooted,
  blastCount). Ring mecânico no network map (cor accent2, NUNCA verde/vermelho —
  sem semântica moral). Legenda + explainer copy mecânica ("única via até N
  pessoas", "não é juízo de valor"). Pipeline da lente CABEADO (boot+follows
  trigger, fallback follows-graph). Seed aprofundado (carol→frank→heidi cauda
  exclusiva → carol = ponte blast=2 na lente de grace). Locks: `tests/wot.test.ts`
  (12) + `map-explainer-conformance` (anti-rótulo-moral) + `network-map.spec` #5
  (lente acende). MCP: ring renderiza em São Paulo (grace), global/post sem ring (§24).
- ⏳ **Fase 2b+ (futuro)**: cluster isolado + filtro-hit; `recordEdge` on-spread
  (interação ponderada live, hoje só fallback follows); recompute em worker thread.
