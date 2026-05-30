/**
 * Cascata viral HONESTA (post mode) — 2026-05-30, deliberação Satoshi+HIMYM.
 *
 * PROBLEMA: o post-mode desenhava cadeia linear (origem→d0→d1→d2 por ordem
 * temporal), implicando que d0 transmitiu pra d1 — transmissão que NÃO existe
 * nos eventos. Um SPREAD (kind 9079) só referencia o POST (`e`), nunca "vi
 * através de quem". Registrar a fonte vazaria o grafo de atenção (deanon) —
 * por isso o protocolo deliberadamente não captura caminho de transmissão.
 *
 * SOLUÇÃO: árvore de cascata ESTIMADA por proximidade (tempo + geo), usando
 * SÓ dado já público (spreads + geo opt-in + timestamps). Cada spread liga ao
 * predecessor mais provável. Honestidade §28:
 *   - arco origem→spreader = LITERAL (o spread referencia o post; não inferred)
 *   - arco spreader→spreader = `inferred:true` → render tracejado + rótulo
 *     "rota estimada — Drift não registra de quem cada um viu".
 *
 * Pura + determinística (§7): mesma entrada → mesma árvore. Tie-break estável.
 */

import type { PropagationArc } from '../types/drift'

export interface CascadeNode {
  lng: number
  lat: number
  /** unix seconds. */
  ts: number
}

/** Distância planar simples (lng/lat) — só pra COMPARAR proximidade relativa. */
function planarDist(a: CascadeNode, b: CascadeNode): number {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat)
}

/**
 * Infere a árvore de cascata. `origin` = geo do post (raiz) ou null (autor
 * sem geo → raiz = 1º spread, sem arco de entrada). `nodes` = spreads
 * localizados em ordem cronológica ASC. `normalize` = tempo→[0,1] do render.
 *
 * Heurística do pai: entre os pontos ANTERIORES (ts ≤ ts do filho), escolhe o
 * de menor custo combinado `0.5·ΔtempoNorm + 0.5·distNorm`. Tie-break: o mais
 * antigo (menor índice). Virais "pegam" de quem está perto + recente → árvore
 * ramifica como contágio real, mas cada aresta spreader→spreader é marcada
 * estimada (nunca afirma transmissão registrada).
 */
export function inferCascadeTree(
  origin: CascadeNode | null,
  nodes: CascadeNode[],
  normalize: (ts: number) => number,
): PropagationArc[] {
  if (nodes.length === 0) return []

  // points em ordem temporal: origem (mais antiga) primeiro, depois spreads ASC.
  const points: { node: CascadeNode; isOrigin: boolean }[] = []
  if (origin) points.push({ node: origin, isOrigin: true })
  for (const n of nodes) points.push({ node: n, isOrigin: false })

  const tsAll = points.map((p) => p.node.ts)
  const tSpan = Math.max(1, Math.max(...tsAll) - Math.min(...tsAll))
  let maxD = 1e-9
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = planarDist(points[i]!.node, points[j]!.node)
      if (d > maxD) maxD = d
    }
  }

  const arcs: PropagationArc[] = []
  for (let i = 0; i < points.length; i++) {
    const child = points[i]!
    if (child.isOrigin) continue // raiz não tem pai

    let best = -1
    let bestCost = Infinity
    for (let j = 0; j < i; j++) {
      const parent = points[j]!
      if (parent.node.ts > child.node.ts) continue // só predecessores temporais
      const tGap = (child.node.ts - parent.node.ts) / tSpan // ≥ 0
      const dNorm = planarDist(child.node, parent.node) / maxD
      const cost = 0.5 * tGap + 0.5 * dNorm
      if (cost < bestCost - 1e-12) {
        bestCost = cost
        best = j
      }
    }

    if (best < 0) continue // 1º nó sem origem → é a raiz (sem arco)

    const parent = points[best]!
    arcs.push({
      from: [parent.node.lng, parent.node.lat],
      to: [child.node.lng, child.node.lat],
      t: normalize(child.node.ts),
      // origem→spreader = literal (evento diz isso); spreader→spreader = estimado.
      inferred: !parent.isOrigin,
    })
  }
  return arcs
}
