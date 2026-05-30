/**
 * wot.ts — Web-of-Trust sinais MECÂNICOS sobre a adjacência da MINHA
 * lente (PPR). Camada estrutural acima de `trust/ppr.ts`: enquanto PPR
 * dá "quão perto da minha rede", aqui derivamos topologia podável.
 *
 * Decisão de design: `Docs/sessions/map-model-deliberation-2026-05-30.md`
 * (Fase 2b). Princípio travado — **saúde = MECÂNICA, nunca moral**
 * (manifesto §22 reputação subjetiva + §25 chave-mestra disfarçada).
 * Nunca rotular pessoa "saudável/tóxica". Só descrevemos ESTRUTURA da
 * minha rede vista do MEU nó (observador-relativo, §17/§25):
 *
 *   - **ponte K=1** (este módulo): nó X tal que existem pessoas
 *     alcançáveis SÓ via X. Se eu deixar de seguir X, perco acesso a
 *     elas. Descritivo — EU decido se isso importa. Não é juízo de
 *     valor sobre X.
 *
 * Tudo aqui é função pura/determinística (mesma adjacência → mesma
 * saída). Roda local, nunca persiste fora do device, nunca vai pro
 * Nostr (invariante #11). Manifesto §7 (determinismo).
 *
 * Sinais futuros (Fase 2b increments): cluster isolado, filtro-hit.
 *
 * Conformance: `tests/wot.test.ts`.
 */

import type { AdjacencyList } from './trust/ppr'

// ─── Pure: reachability ────────────────────────────────────────────

/**
 * Conjunto de nós alcançáveis a partir de `source` seguindo out-edges,
 * EXCLUINDO o próprio source. Opcionalmente remove um nó `exclude` do
 * grafo (como se o user deixasse de seguir/atravessar por ele) — usado
 * pra detecção de ponte.
 *
 * BFS iterativo. Self-loops e arestas pro `exclude` são ignoradas.
 */
export function reachableFrom(
  source: string,
  graph: AdjacencyList,
  exclude?: string,
): Set<string> {
  const seen = new Set<string>()
  if (source === exclude) return seen
  const queue: string[] = [source]
  const visited = new Set<string>([source])
  while (queue.length > 0) {
    const node = queue.shift()!
    const edges = graph.get(node) ?? []
    for (const e of edges) {
      const t = e.target
      if (t === source || t === exclude) continue
      if (!visited.has(t)) {
        visited.add(t)
        seen.add(t)
        queue.push(t)
      }
    }
  }
  return seen
}

// ─── Pure: ponte K=1 (cut-vertex source-rooted) ────────────────────

/**
 * Detecta **pontes K=1** na minha rede: nós X cuja remoção desconecta
 * ≥1 pessoa do meu alcance. Formalmente X domina Y quando TODO caminho
 * source→Y passa por X (dominator em grafo de fluxo enraizado em mim).
 *
 * Retorna `Map<X, blastCount>` onde `blastCount` = quantas pessoas eu
 * perderia de vista se parasse de seguir/atravessar X. Só inclui X com
 * blastCount > 0.
 *
 * Mecânica (não moral): "X é única via até N pessoas" é fato estrutural
 * da MINHA topologia. NUNCA "X é importante/confiável" — isso seria
 * reputação (§22) / chave-mestra (§25). A UI deixa EU decidir o que
 * fazer com a info.
 *
 * Custo O(V·(V+E)). Grafo Nostr de follows é esparso (~dezenas de nós),
 * amortizado barato. Determinístico — sem rng, sem clock.
 *
 * Cold-start: grafo vazio ou source sem out-edges → `new Map()`.
 */
export function findBridges(
  source: string,
  graph: AdjacencyList,
): Map<string, number> {
  const bridges = new Map<string, number>()
  const full = reachableFrom(source, graph)
  if (full.size === 0) return bridges

  for (const candidate of full) {
    const withoutCandidate = reachableFrom(source, graph, candidate)
    let blast = 0
    for (const node of full) {
      // node ainda alcançável sem candidate? se não, candidate o dominava.
      // O próprio candidate não conta (ele não some, EU só paro de seguir).
      if (node !== candidate && !withoutCandidate.has(node)) blast++
    }
    if (blast > 0) bridges.set(candidate, blast)
  }
  return bridges
}
