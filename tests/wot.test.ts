// LOCK_VIA_TEST — sinais WoT mecânicos (network mode, Fase 2b).
// Deliberação Satoshi+HIMYM 2026-05-30. Ver src/lib/wot.ts.
//
// Garante: ponte K=1 = cut-vertex source-rooted (blastCount = pessoas
// perdidas se parar de seguir X), reachability correta, determinismo §7,
// cold-start safe. NUNCA juízo moral — só estrutura (§22/§25).

import { describe, it, expect } from 'vitest'
import { reachableFrom, findBridges } from '../src/lib/wot'
import type { AdjacencyList, PprEdge } from '../src/lib/trust/ppr'

function g(edges: Record<string, string[]>): AdjacencyList {
  const m: AdjacencyList = new Map()
  for (const [src, tgts] of Object.entries(edges)) {
    m.set(src, tgts.map((target): PprEdge => ({ target, influence: 1 })))
  }
  return m
}

describe('reachableFrom', () => {
  it('grafo vazio → set vazio', () => {
    expect(reachableFrom('me', new Map()).size).toBe(0)
  })

  it('exclui o próprio source do resultado', () => {
    const adj = g({ me: ['a'], a: ['me'] })
    const r = reachableFrom('me', adj)
    expect(r.has('me')).toBe(false)
    expect(r.has('a')).toBe(true)
  })

  it('alcança transitivamente', () => {
    const adj = g({ me: ['a'], a: ['b'], b: ['c'] })
    expect([...reachableFrom('me', adj)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('exclude remove nó e o que só ele alcançava', () => {
    const adj = g({ me: ['a'], a: ['b'] })
    const r = reachableFrom('me', adj, 'a')
    expect(r.has('a')).toBe(false)
    expect(r.has('b')).toBe(false) // b só via a
  })
})

describe('findBridges — ponte K=1', () => {
  it('cold-start: grafo vazio → Map vazio', () => {
    expect(findBridges('me', new Map()).size).toBe(0)
  })

  it('source sem out-edges → Map vazio', () => {
    expect(findBridges('me', g({ a: ['b'] })).size).toBe(0)
  })

  it('cadeia me→a→b: a é ponte com blast=1 (perde b)', () => {
    const adj = g({ me: ['a'], a: ['b'] })
    const bridges = findBridges('me', adj)
    expect(bridges.get('a')).toBe(1) // sem a, perco b
    expect(bridges.has('b')).toBe(false) // b é folha, não domina ninguém
  })

  it('a domina cluster: blast = tamanho do cluster a jusante', () => {
    // me→a; a→{b,c}; c→d. Sem a, perco b,c,d → blast 3.
    const adj = g({ me: ['a'], a: ['b', 'c'], c: ['d'] })
    const bridges = findBridges('me', adj)
    expect(bridges.get('a')).toBe(3)
    expect(bridges.get('c')).toBe(1) // sem c, perco só d
    expect(bridges.has('b')).toBe(false)
  })

  it('caminho redundante anula ponte (K≥2)', () => {
    // me→a→x e me→b→x: nem a nem b é única via até x.
    const adj = g({ me: ['a', 'b'], a: ['x'], b: ['x'] })
    const bridges = findBridges('me', adj)
    expect(bridges.has('a')).toBe(false)
    expect(bridges.has('b')).toBe(false)
    expect(bridges.has('x')).toBe(false)
  })

  it('follow direto sem dependentes não é ponte', () => {
    const adj = g({ me: ['a', 'b'] })
    expect(findBridges('me', adj).size).toBe(0)
  })

  it('determinístico — mesma adjacência → mesma saída', () => {
    const adj = g({ me: ['a'], a: ['b', 'c'], c: ['d'] })
    const r1 = [...findBridges('me', adj).entries()].sort()
    const r2 = [...findBridges('me', adj).entries()].sort()
    expect(r1).toEqual(r2)
  })

  it('ignora self-loop e ciclo sem travar', () => {
    const adj = g({ me: ['a'], a: ['a', 'b'], b: ['me'] })
    const bridges = findBridges('me', adj)
    expect(bridges.get('a')).toBe(1) // sem a, perco b
  })
})
