/**
 * PPR exato da Lente — `computePprExact` (Docs/algoritmos.md §5).
 *
 * Por que existe: o PPR por sorteio (`computePpr`, Monte Carlo com semente
 * do dia) dá números diferentes para a mesma rede conforme a ORDEM em que a
 * lista de quem você segue saiu do banco e conforme o DIA da conta. Ligado
 * ao feed, isso virava ordem diferente em dois aparelhos com os mesmos
 * eventos (manifesto §7). A versão exata calcula a média do mesmo passeio
 * — sem sorteio, sem relógio, sem depender da ordem de chegada.
 *
 * Cada teste nomeia a quebra que pega; os valores esperados são calculados
 * à mão (frações exatas), não pela função testada.
 */

import { describe, it, expect } from 'vitest'
import { computePpr, computePprExact, type AdjacencyList } from '../src/lib/trust/ppr'
import { createPprRng } from '../src/lib/trust/rng'

const ALPHA = 0.15

function graphOf(edges: Array<[string, string, number]>): AdjacencyList {
  const g: AdjacencyList = new Map()
  for (const [s, t, w] of edges) {
    const list = g.get(s) ?? []
    list.push({ target: t, influence: w })
    g.set(s, list)
  }
  return g
}

/** Mesmo grafo, listas e chaves em outra ordem (como outro aparelho leria do banco). */
function shuffled(g: AdjacencyList, seed: number): AdjacencyList {
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  const keys = [...g.keys()].sort(() => rnd() - 0.5)
  const out: AdjacencyList = new Map()
  for (const k of keys) out.set(k, [...g.get(k)!].sort(() => rnd() - 0.5))
  return out
}

describe('computePprExact — valores calculados à mão', () => {
  it('estrela de 1 salto (a rede de produção: você → quem você segue): todos iguais, 1/n', () => {
    // quebra: contar visita ao próprio leitor, ou repartir a massa de forma desigual
    const g = graphOf([['eu', 'a', 1], ['eu', 'b', 1], ['eu', 'c', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    expect([...ppr.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(ppr.get('a')).toBe(ppr.get('b'))
    expect(ppr.get('b')).toBe(ppr.get('c'))
    expect(ppr.get('a')!).toBeCloseTo(1 / 3, 12)
  })

  it('cadeia eu → A → B com 2 passos: A = 20/37, B = 17/37', () => {
    // passo 0: 0,85 chega a A; passo 1: 0,85 × 0,85 = 0,7225 chega a B.
    // total 1,5725 → A = 0,85/1,5725 = 20/37, B = 0,7225/1,5725 = 17/37.
    // quebra: não descontar a parada (α) a cada passo, ou normalizar errado
    const g = graphOf([['eu', 'A', 1], ['A', 'B', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 2, alpha: ALPHA })
    expect(ppr.get('A')!).toBeCloseTo(20 / 37, 12)
    expect(ppr.get('B')!).toBeCloseTo(17 / 37, 12)
  })

  it('a influência reparte o passo: peso 3 contra 1 → 3/4 e 1/4', () => {
    // quebra: ignorar a influência (sortear uniforme)
    const g = graphOf([['eu', 'A', 3], ['eu', 'B', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 1, alpha: ALPHA })
    expect(ppr.get('A')!).toBeCloseTo(0.75, 12)
    expect(ppr.get('B')!).toBeCloseTo(0.25, 12)
  })

  it('beco sem saída volta ao leitor sem contar visita (como o passeio do app)', () => {
    // eu → A (A não segue ninguém), eu → B → C. Com L = 3:
    //  passo 0: A 0,425, B 0,425
    //  passo 1: massa em A (0,36125) volta ao leitor; B → C: C 0,36125
    //  passo 2: do leitor (0,3070625) A e B ganham 0,15353125 cada; C é beco → volta
    // A = 0,57853125, B = 0,57853125, C = 0,36125 → total 1,5183125
    // quebra: contar o retorno como visita, ou encerrar o passeio no beco
    const g = graphOf([['eu', 'A', 1], ['eu', 'B', 1], ['B', 'C', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 3, alpha: ALPHA })
    const total = 0.57853125 * 2 + 0.36125
    expect(ppr.get('A')!).toBeCloseTo(0.57853125 / total, 12)
    expect(ppr.get('B')!).toBeCloseTo(0.57853125 / total, 12)
    expect(ppr.get('C')!).toBeCloseTo(0.36125 / total, 12)
  })
})

describe('computePprExact — propriedades', () => {
  it('sem saída nenhuma (cold start) → vazio; influência toda zero → vazio', () => {
    // quebra: dividir 0/0 (NaN) em vez de devolver vazio
    expect(computePprExact({ source: 'eu', graph: new Map(), L: 6, alpha: ALPHA }).size).toBe(0)
    const zero = graphOf([['eu', 'a', 0], ['eu', 'b', 0]])
    expect(computePprExact({ source: 'eu', graph: zero, L: 6, alpha: ALPHA }).size).toBe(0)
  })

  it('soma 1 e cada valor em (0, 1]', () => {
    const g = graphOf([['eu', 'a', 1], ['eu', 'b', 2], ['a', 'c', 1], ['b', 'c', 1], ['c', 'd', 1], ['d', 'a', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    let sum = 0
    for (const v of ppr.values()) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
      sum += v
    }
    expect(sum).toBeCloseTo(1, 12)
  })

  it('a ordem de chegada não muda NADA: mesma rede em 50 ordens → valores idênticos bit a bit', () => {
    // quebra: somar na ordem em que as arestas chegaram (ponto flutuante não é associativo)
    const edges: Array<[string, string, number]> = []
    const names = 'abcdefghijklmnop'.split('')
    for (let i = 0; i < names.length; i++) {
      edges.push(['eu', names[i]!, 0.1 + (i % 5) * 0.37])
      edges.push([names[i]!, names[(i * 7 + 3) % names.length]!, 0.3 + (i % 3) * 0.21])
      edges.push([names[i]!, names[(i * 5 + 1) % names.length]!, 0.9])
    }
    const g = graphOf(edges)
    const ref = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    for (let seed = 1; seed <= 50; seed++) {
      const other = computePprExact({ source: 'eu', graph: shuffled(g, seed), L: 6, alpha: ALPHA })
      expect(other.size).toBe(ref.size)
      for (const [k, v] of ref) expect(Object.is(other.get(k), v)).toBe(true)
    }
  })

  it('não depende do relógio: o Monte Carlo do app muda de um dia pro outro, o exato não', () => {
    // contraprova da motivação: a semente do sorteio é pessoa + dia
    const g = graphOf([['eu', 'a', 1], ['eu', 'b', 1], ['eu', 'c', 1], ['eu', 'd', 1], ['eu', 'e', 1]])
    const day = 24 * 3600 * 1000
    const mc1 = computePpr({ source: 'eu', graph: g, rng: createPprRng('eu', 10 * day) })
    const mc2 = computePpr({ source: 'eu', graph: g, rng: createPprRng('eu', 11 * day) })
    expect([...mc1.values()]).not.toEqual([...mc2.values()])
    const ex = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    for (const v of ex.values()) expect(v).toBeCloseTo(0.2, 12)
  })

  it('é a média do mesmo passeio do app: com muitos sorteios o Monte Carlo converge pro exato', () => {
    // quebra: o exato modelar outro passeio (outra regra de parada, de beco ou de visita)
    const g = graphOf([['eu', 'a', 1], ['eu', 'b', 3], ['a', 'c', 1], ['b', 'c', 2], ['b', 'eu', 1], ['c', 'd', 1]])
    const ex = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    const mc = computePpr({ source: 'eu', graph: g, rng: createPprRng('eu', 0), K: 200_000, L: 6, alpha: ALPHA })
    for (const [k, v] of ex) expect(Math.abs((mc.get(k) ?? 0) - v)).toBeLessThan(0.006)
    expect(mc.size).toBe(ex.size)
  })

  it('contas falsas sem caminho a partir de você não recebem nada, por mais que se sigam', () => {
    // quebra: espalhar massa por todos os nós do grafo, não só os alcançáveis
    const edges: Array<[string, string, number]> = [['eu', 'amiga', 1], ['amiga', 'eu', 1]]
    for (let i = 0; i < 200; i++) for (let j = 1; j <= 5; j++) edges.push([`f${i}`, `f${(i + j) % 200}`, 1])
    const ppr = computePprExact({ source: 'eu', graph: graphOf(edges), L: 6, alpha: ALPHA })
    expect([...ppr.keys()]).toEqual(['amiga'])
  })

  it('o próprio leitor nunca recebe proximidade, mesmo com arestas de volta', () => {
    const g = graphOf([['eu', 'a', 1], ['a', 'eu', 1], ['a', 'b', 1], ['b', 'eu', 1]])
    const ppr = computePprExact({ source: 'eu', graph: g, L: 6, alpha: ALPHA })
    expect(ppr.has('eu')).toBe(false)
  })
})
