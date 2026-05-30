// LOCK_VIA_TEST — cascata viral honesta (post mode). Deliberação
// Satoshi+HIMYM 2026-05-30. Ver src/lib/cascade.ts.
//
// Garante: árvore (não cadeia linear), pai = predecessor mais próximo
// tempo+geo, origem→spreader LITERAL (inferred=false), spreader→spreader
// ESTIMADO (inferred=true), determinismo §7.

import { describe, it, expect } from 'vitest'
import { inferCascadeTree, type CascadeNode } from '../src/lib/cascade'

const idNorm = (ts: number) => ts // normalize identidade pros testes

describe('inferCascadeTree — árvore viral honesta', () => {
  it('vazio → sem arcos', () => {
    expect(inferCascadeTree(null, [], idNorm)).toEqual([])
  })

  it('origem→1º spreader é LITERAL (inferred=false)', () => {
    const origin: CascadeNode = { lng: 0, lat: 0, ts: 0 }
    const nodes: CascadeNode[] = [{ lng: 1, lat: 0, ts: 10 }]
    const arcs = inferCascadeTree(origin, nodes, idNorm)
    expect(arcs).toHaveLength(1)
    expect(arcs[0]!.inferred).toBe(false) // post→spreader = o evento diz isso
    expect(arcs[0]!.from).toEqual([0, 0])
    expect(arcs[0]!.to).toEqual([1, 0])
  })

  it('spreader→spreader é ESTIMADO (inferred=true)', () => {
    // origem longe; 2 spreaders MUITO próximos entre si e recentes → o 2º
    // liga ao 1º (mais perto+recente que a origem), não à origem.
    const origin: CascadeNode = { lng: 0, lat: 0, ts: 0 }
    const nodes: CascadeNode[] = [
      { lng: 50, lat: 50, ts: 100 }, // A — longe da origem
      { lng: 50.1, lat: 50.1, ts: 101 }, // B — colado em A, logo depois
    ]
    const arcs = inferCascadeTree(origin, nodes, idNorm)
    expect(arcs).toHaveLength(2)
    const arcB = arcs.find((a) => a.to[0] === 50.1)!
    // B liga em A (50,50), não na origem (0,0)
    expect(arcB.from).toEqual([50, 50])
    expect(arcB.inferred).toBe(true) // spreader→spreader = estimado
  })

  it('NÃO é cadeia linear: nó pode ligar à origem, não ao anterior imediato', () => {
    // 2 spreaders distantes entre si, ambos perto da origem → ambos ligam à
    // origem (estrela), não A→B (cadeia). Prova que não força linear.
    const origin: CascadeNode = { lng: 0, lat: 0, ts: 0 }
    const nodes: CascadeNode[] = [
      { lng: 1, lat: 0, ts: 10 }, // A perto da origem
      { lng: -1, lat: 0, ts: 20 }, // B perto da origem, longe de A
    ]
    const arcs = inferCascadeTree(origin, nodes, idNorm)
    const arcB = arcs.find((a) => a.to[0] === -1)!
    expect(arcB.from).toEqual([0, 0]) // B→origem, NÃO B→A (cadeia)
    expect(arcB.inferred).toBe(false)
  })

  it('sem origem (autor GPS off): 1º spread é raiz (sem arco de entrada)', () => {
    const nodes: CascadeNode[] = [
      { lng: 5, lat: 5, ts: 10 },
      { lng: 5.1, lat: 5, ts: 20 },
    ]
    const arcs = inferCascadeTree(null, nodes, idNorm)
    expect(arcs).toHaveLength(1) // só o 2º nó ganha arco (1º é raiz)
    expect(arcs[0]!.inferred).toBe(true) // spreader→spreader
  })

  it('determinístico §7: mesma entrada → mesma árvore', () => {
    const origin: CascadeNode = { lng: 0, lat: 0, ts: 0 }
    const nodes: CascadeNode[] = [
      { lng: 1, lat: 1, ts: 10 },
      { lng: 2, lat: 1, ts: 15 },
      { lng: 1.1, lat: 1.1, ts: 12 },
    ]
    const a = inferCascadeTree(origin, nodes, idNorm)
    const b = inferCascadeTree(origin, nodes, idNorm)
    expect(b).toEqual(a)
  })
})
