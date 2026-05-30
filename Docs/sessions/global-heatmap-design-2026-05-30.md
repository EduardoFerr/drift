# Design — global = CALOR (heatmap), post = arcos, network = arcos+lente

Deliberação Satoshi + HIMYM (Ted arquitetura / Marshall conformance) 2026-05-30.
Grounded via MCP (global hoje = leque de arcos do hub → vira teia + K=1 doxx em
full). Sucede `map-model-deliberation-2026-05-30.md`.

## Decisão: 3 mapas, cada um responde 1 pergunta

| modo | viz | pergunta | lente |
|---|---|---|---|
| **post** | ARCOS (cascata honesta `inferCascadeTree`) | "como ISTE post espalhou" | ❌ |
| **global** | **CALOR** (densidade de DRIFTs, recency-cooled, scrubber) | "onde a rede tá quente" | ❌ |
| **network** | ARCOS + lente PPR + pontes K=1 | "minha rede" | ✅ |

### Por que global → calor (não arcos)
- **§28 privacidade:** arco/dot individual a cidade pequena = K=1 doxx
  (known-limitations #7). Calor agrega → esconde o indivíduo.
- **Escala:** full seed (~2730) = teia crua ilegível. Calor escala.
- **Honestidade:** arco origem→spreader agregado cross-post sugere transmissão
  que não existe. Calor = só densidade de atividade, sem aresta implícita.

## Fórmulas (revisadas + travadas por Ted+Marshall)

**Premissa de unidade (Marshall #1):** `posts.created_at` / `spreads.created_at`
são unix **segundos**. `age` e `HALF_LIFE` ficam na MESMA unidade (segundos)
fim-a-fim. Nunca misturar com ms.

**Cursor → tempo real (domínio real, NÃO scrubber):**
```
range      = maxTs − minTs || 1          // segundos; makeNormalizer expõe minTs,range
cursorReal = minTs + cursor·range        // cursor = useTimelineClock currentTime ∈ [0,1]
```

**Peso por evento (densidade recency-cooled):**
```
ageSec = cursorReal − t_i                                  // ≥ 0 pelo gate abaixo
w_i    = (t_i ≤ cursorReal) ? temporalDecay(ageSec, HEAT_HALF_LIFE_S) : 0
HEAT_HALF_LIFE_S = 7·24·3600                               // 7 dias (tempo real)
```
- `temporalDecay(age, hl) = 2^(-age/hl)` ∈ (0,1]. Reuso da fn pura existente.
- **Peso base = 1 por evento** (densidade de contagem). NUNCA score/weight/ppr
  (manifesto §22 anti-bandwagon). Decaído só pelo tempo.
- **Gate explícito** `t_i ≤ cursorReal ? … : 0`: evento futuro contribui 0. NÃO
  confiar no guard `age≤0→1` de temporalDecay (ele devolve 1 = mais quente, errado
  pra futuro).
- Filtrar `w_i > 0` antes de passar pro HeatmapLayer (não agregar pontos mortos).
- Densidade num local = Σ `w_i` co-localizados (GPU, deck.gl HeatmapLayer).
- Normalização: ao max do frame atual (HeatmapLayer auto / colorDomain) — rede
  esparsa não fica toda fria.

### Pergunta "usuário fora há muito tempo, calor exibe?"
**Esfria, não some.** Evento é imutável, NUNCA deletado (§13). Mas o peso decai
com `age` real (half-life 7d): ausente 1 semana → 50%; 2 semanas → 25%. Lê como
"atividade antiga/fria", não viva. Sem regra de "sumir" (seria censura). Scrubber:
brota no `t_i`, esfria conforme cursor avança. Reduced-motion → cursor=1 → acúmulo
full estático (todos os eventos passados no peso decaído máximo).

## Invariantes
- **§7 determinismo:** `buildHeatPoints(events, cursorReal, halfLife)` é PURA —
  mesma entrada → mesma saída. Sem Date.now/performance.now no caminho do peso
  (cursor injetado). GPU SUM é render, não §7 (mesma postura que ArcLayer hoje).
- **§11/§24:** valor de calor NUNCA persiste em `posts.score`, NUNCA vai pro Nostr.
  View-only, mesma classe que `s_local` da lente. Global é canônico/compartilhado
  → calor é só representação, idêntico entre clientes dado mesmo conjunto de eventos.
- **§22:** peso = densidade de contagem, nunca qualidade.

## Arquitetura (Ted)
- **`src/lib/heat.ts`** (NOVO): `buildHeatPoints` pura + tipos. Testável em Node
  (precedente `cascade.ts` — .tsx não importa limpo no Vitest). Hard rule CLAUDE.md §16.
- **`src/lib/decay.ts`** (NOVO): promover `temporalDecay` pra módulo neutro. `ppr.ts`,
  `moderation.ts` (hoje re-implementa 2^(-age/hl)) e `heat.ts` importam daqui. Mata
  duplicação + evita map-viz depender de `trust/`.
- **`HEAT_HALF_LIFE_S`** em `src/config/constants.ts` (perto de `REPORT_DECAY_HALF_LIFE_MS`),
  NÃO em `trust/constants.ts`.
- **Split de componente** em `SpreadMap.tsx`: hoje global+network compartilham
  `GlobalModeMap` (monolito ~350-linha useEffect: init + social-nodes + bridge-rings
  + arcos + renderFrame). Plano:
  1. Extrair hook compartilhado `useClockedOverlay` (map init + clock + renderFrameRef
     dirigido por currentTime + `map.once('load')`) — hoje copiado entre Post/Global.
  2. `GlobalModeMap` → CALOR (dropa ArcLayer/social-nodes/bridge-rings/lens/ppr;
     usa `buildHeatPoints` + HeatmapLayer).
  3. Renomear o monolito de arcos pra `NetworkModeMap` (mantém arcos + social-nodes
     + bridge-rings + lente; já gated `mode==='network'`).
  4. Dispatcher: `global → GlobalModeMap(heat)` / `network → NetworkModeMap(arcs)`.
- **makeNormalizer** (`useSpreadMap.ts`): retornar `{ normalize, minTs, range }` (ou
  `denormalize`) pra heat inverter cursor→cursorReal sem recomputar min/max.
- Clock: `useTimelineClock` mode-agnostic, reuso direto (pause/reduced-motion idem arcos).

## Conformance / testes (Marshall)
- `tests/heat.test.ts`: determinismo §7, monotonicidade no cursor, evento futuro→0,
  gate, degenerate range (single/all-same-ts → render uniforme, sem NaN).
- `tests/spread-map-heat-mode-conformance.test.ts` — §22 lock grep:
  ```
  expect(heatLayerSrc).not.toMatch(/getWeight[\s\S]*?\b(score|calculateScore|spreadCount|pprScore|viewMultiplier|\.weight)\b/)
  expect(heatLayerSrc).toMatch(/getWeight:\s*(1\b|\(d:[^)]*\)\s*=>[\s\S]*?temporalDecay)/)
  ```
- E2E `network-map.spec`/novo: global mode renderiza heat (HeatmapLayer presente),
  sem ArcLayer; network mantém arcos+ring; post mantém arcos.
- MCP (regra dura #3): validar global=calor + vizinhos (post=arcos, network=arcos+lente+ring, feed) ao vivo.

## Docs a atualizar (regra dura #2)
CLAUDE.md (modelo dos 3 mapas), MapExplainerCard copy global (calor=densidade que
esfria), `reference_map_model` memory, este doc.

## Sequência
1. Fechar branch `fix/postmap-arcs` (3 nits review + merge) — base limpa, post=arcos casa.
2. Branch nova `feat/global-heatmap`: decay.ts → heat.ts → constants → split componente
   → explainer copy → testes → MCP.

## NO-GOs
- peso de calor por score/weight (§22). lente no global (§24). deletar evento frio (§13).
- importar `trust/` no map-viz só pra decay (acoplamento ruim — usar `lib/decay.ts`).
