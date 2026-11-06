/**
 * Lente — a mistura (`mixNetwork`, src/lib/lens/order.ts; Docs/algoritmos.md §6).
 *
 * Com a lente em k%, a aba é refeita lugar a lugar: k de cada 100 lugares
 * vão para posts de quem você segue (na ordem de sempre); os outros, para o
 * resto. A lente só adianta posts "escolhidos": de quem você segue, score
 * ≥ 0 e no máximo 2 por pessoa (os de mais pontos). Travas: um post
 * escolhido nunca fica abaixo do lugar que tinha; a aba mantém o tamanho.
 * Força 0 = a aba de sempre, bit a bit.
 *
 * Testes de PROPRIEDADE (o que a regra promete em qualquer entrada), com
 * entradas sorteadas e embaralhadas, mais alguns casos montados à mão.
 */

import { describe, it, expect } from 'vitest'
import { mixNetwork, canonicalCompare, LENS_MAX_PER_AUTHOR, type LensPost } from '../src/lib/lens/order'

function mk(id: string, score: number, createdAt: number, authorPub: string): LensPost {
  return { id, score, createdAt, authorPub }
}

/** gerador determinístico (LCG) — testes reprodutíveis */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

function shuffle<T>(arr: readonly T[], r: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Mundo sorteado: 120 posts de 30 autores; você segue 6 (que postam
 *  bastante — o teto por pessoa entra em jogo). A aba = os 50 primeiros na
 *  ordem canônica; a rede = todos os posts dos 6. */
function world(seed: number) {
  const r = rng(seed)
  const authors = Array.from({ length: 30 }, (_, i) => `a${i}`)
  const follows = new Set(authors.slice(0, 6))
  const all: LensPost[] = []
  for (let i = 0; i < 120; i++) {
    const roll = r()
    // scores com empates, zeros e negativos de propósito
    const score = roll < 0.25 ? 0 : roll < 0.35 ? -Math.floor(r() * 5) : Math.floor(r() * 40) / 4
    const author = r() < 0.4 ? authors[Math.floor(r() * 6)]! : authors[Math.floor(r() * 30)]!
    all.push(mk(`p${String(i).padStart(3, '0')}`, score, 1_000_000 + Math.floor(r() * 50) * 60, author))
  }
  const canon = [...all].sort(canonicalCompare)
  const tab = canon.slice(0, 50)
  const network = canon.filter((p) => follows.has(p.authorPub))
  return { tab, network, follows, canon }
}

/** Os escolhidos pela regra publicada, calculados aqui (não pela função
 *  testada): score ≥ 0, até 2 por pessoa, os de mais pontos. */
function chosen(network: readonly LensPost[]): Set<string> {
  const per = new Map<string, number>()
  const out = new Set<string>()
  for (const p of [...network].sort(canonicalCompare)) {
    if (!(p.score >= 0)) continue
    const n = per.get(p.authorPub) ?? 0
    if (n >= 2) continue
    per.set(p.authorPub, n + 1)
    out.add(p.id)
  }
  return out
}

const ids = (ps: readonly LensPost[]) => ps.map((p) => p.id)

describe('mixNetwork — força 0 e casos de borda', () => {
  it('força 0 devolve a aba de sempre, os mesmos objetos na mesma ordem', () => {
    // quebra: aplicar qualquer reordenação com a lente desligada
    for (let seed = 1; seed <= 20; seed++) {
      const { tab, network } = world(seed)
      const out = mixNetwork({ tab, network, strengthPct: 0 })
      expect(out.posts.length).toBe(tab.length)
      out.posts.forEach((p, i) => expect(p).toBe(tab[i]))
      expect(out.lifted.size).toBe(0)
    }
  })

  it('sem ninguém da sua rede, qualquer força devolve a aba de sempre', () => {
    const { tab } = world(3)
    for (const k of [1, 25, 50, 100]) expect(ids(mixNetwork({ tab, network: [], strengthPct: k }).posts)).toEqual(ids(tab))
  })

  it('aba vazia → vazia; força fora de 0..100 é limitada', () => {
    expect(mixNetwork({ tab: [], network: [], strengthPct: 50 }).posts).toEqual([])
    const { tab, network } = world(4)
    expect(ids(mixNetwork({ tab, network, strengthPct: 250 }).posts)).toEqual(ids(mixNetwork({ tab, network, strengthPct: 100 }).posts))
    expect(ids(mixNetwork({ tab, network, strengthPct: -5 }).posts)).toEqual(ids(tab))
  })

  it('o teto publicado é 2 posts por pessoa', () => {
    expect(LENS_MAX_PER_AUTHOR).toBe(2)
  })
})

describe('mixNetwork — casos montados à mão', () => {
  // aba: m1..m4 (de quem você não segue), depois s1 (segue); rede: s1, s2 (fora da aba)
  const m = [mk('m1', 9, 10, 'x'), mk('m2', 8, 10, 'x'), mk('m3', 7, 10, 'y'), mk('m4', 6, 10, 'y')]
  const s1 = mk('s1', 5, 10, 'amiga'), s2 = mk('s2', 1, 10, 'amiga')
  const tab = [...m, s1]
  const network = [s1, s2]

  it('50%: um lugar sim, um não — a rede entra no 2º e no 4º', () => {
    expect(ids(mixNetwork({ tab, network, strengthPct: 50 }).posts)).toEqual(['m1', 's1', 'm2', 's2', 'm3'])
  })

  it('100%: primeiro toda a sua rede, na ordem de sempre; a aba mantém 5 posts', () => {
    expect(ids(mixNetwork({ tab, network, strengthPct: 100 }).posts)).toEqual(['s1', 's2', 'm1', 'm2', 'm3'])
  })

  it('"subiu": de onde veio cada post da rede (null = estava fora da aba)', () => {
    const { lifted } = mixNetwork({ tab, network, strengthPct: 100 })
    expect(lifted.get('s1')).toEqual({ from: 4, to: 0 })
    expect(lifted.get('s2')).toEqual({ from: null, to: 1 })
    expect(lifted.has('m1')).toBe(false)
  })

  it('post da sua rede afundado pela comunidade (score < 0) não ganha prioridade', () => {
    const sunk = mk('s3', -2, 10, 'amiga')
    const out = mixNetwork({ tab: [...m, sunk], network: [sunk], strengthPct: 100 })
    expect(ids(out.posts)).toEqual(['m1', 'm2', 'm3', 'm4', 's3'])
    expect(out.lifted.size).toBe(0)
  })

  it('a lente nunca rebaixa um escolhido: o que já estava em 1º continua em 1º com 10%', () => {
    const top = mk('s0', 99, 10, 'amiga')
    const out = mixNetwork({ tab: [top, ...m], network: [top], strengthPct: 10 })
    expect(out.posts[0]!.id).toBe('s0')
  })

  it('quem posta muito: no máximo 2 posts por pessoa ganham prioridade (os de mais pontos)', () => {
    // quebra: uma conta seguida que posta 6 vezes tomar todos os lugares da rede
    const flood = [5, 4, 3, 2, 1, 0].map((s, i) => mk(`f${i}`, s, 10 + i, 'inunda'))
    const friend = mk('a1', 1, 10, 'amiga')
    const out = mixNetwork({ tab: m, network: [...flood, friend], strengthPct: 100 })
    expect(ids(out.posts)).toEqual(['f0', 'f1', 'a1', 'm1'])
    expect([...out.lifted.keys()].sort()).toEqual(['a1', 'f0', 'f1'])
  })

  it('leituras inconsistentes (um evento chegou entre as duas consultas) não rebaixam', () => {
    // a aba leu s1 em 3º; na leitura da rede, um post de fora (o1) ganhou voto e
    // passou à frente de s1 na ordem — mesmo assim s1 não pode cair abaixo do 3º
    const t = [mk('m1', 9, 10, 'x'), mk('m2', 8, 10, 'x'), mk('m3', 7, 10, 'y'), mk('s1', 6, 10, 'amiga'), mk('m4', 5, 10, 'y')]
    const net = [mk('s1', 6.5, 10, 'amiga'), mk('o1', 50, 10, 'colega')]
    const out = mixNetwork({ tab: t, network: net, strengthPct: 10 })
    const at = ids(out.posts).indexOf('s1')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThanOrEqual(3)
    expect(out.posts.length).toBe(t.length)
  })
})

describe('mixNetwork — propriedades em 200 mundos sorteados', () => {
  const K = [1, 10, 25, 33, 50, 67, 75, 90, 100]

  it('determinismo: a mesma entrada em qualquer ordem de chegada dá a mesma aba', { timeout: 60_000 }, () => {
    // quebra: depender da ordem em que a aba ou a rede chegaram do banco
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const r = rng(seed * 31)
      for (const k of [25, 50, 100]) {
        const a = ids(mixNetwork({ tab, network, strengthPct: k }).posts)
        const b = ids(mixNetwork({ tab: shuffle(tab, r), network: shuffle(network, r), strengthPct: k }).posts)
        expect(b).toEqual(a)
      }
    }
  })

  it('o tamanho da aba não muda e nenhum post aparece duas vezes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      for (const k of K) {
        const out = mixNetwork({ tab, network, strengthPct: k }).posts
        expect(out.length).toBe(tab.length)
        expect(new Set(ids(out)).size).toBe(out.length)
      }
    }
  })

  it('no máximo 2 adiantados por pessoa; só entra post da aba ou escolhido; quem sai é o fim da aba', { timeout: 60_000 }, () => {
    // quebra: a lente trazer post de quem você não segue, passar do teto ou tirar o topo da aba
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const pick = chosen(network)
      const tabIdx = new Map(tab.map((p, i) => [p.id, i]))
      for (const k of K) {
        const { posts: out, lifted } = mixNetwork({ tab, network, strengthPct: k })
        const per = new Map<string, number>()
        for (const id of lifted.keys()) {
          expect(pick.has(id)).toBe(true)
          const a = out.find((p) => p.id === id)!.authorPub
          per.set(a, (per.get(a) ?? 0) + 1)
        }
        for (const n of per.values()) expect(n).toBeLessThanOrEqual(LENS_MAX_PER_AUTHOR)
        for (const p of out) if (!tabIdx.has(p.id)) expect(pick.has(p.id)).toBe(true)
        const outIds = new Set(ids(out))
        const dropped = tab.filter((p) => !outIds.has(p.id))
        const lastKept = Math.max(-1, ...tab.filter((p) => outIds.has(p.id) && !pick.has(p.id)).map((p) => tabIdx.get(p.id)!))
        for (const d of dropped) {
          expect(pick.has(d.id)).toBe(false)
          expect(tabIdx.get(d.id)!).toBeGreaterThan(lastKept)
        }
      }
    }
  })

  it('um escolhido nunca fica abaixo do lugar que tinha, e mais força nunca o põe mais abaixo', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const pick = chosen(network)
      const tabIdx = new Map(tab.map((p, i) => [p.id, i]))
      let prev: Map<string, number> | null = null
      for (const k of K) {
        const out = mixNetwork({ tab, network, strengthPct: k }).posts
        const pos = new Map(out.map((p, i) => [p.id, i]))
        for (const id of pick) {
          const at = pos.get(id)
          const was = tabIdx.get(id)
          if (was !== undefined) expect(at !== undefined && at <= was).toBe(true)
          if (prev && prev.has(id)) expect(at !== undefined && at <= prev.get(id)!).toBe(true)
        }
        prev = pos
      }
    }
  })

  it('cada grupo mantém a ordem de sempre: os escolhidos entre si, o resto entre si', { timeout: 60_000 }, () => {
    // quebra: a lente embaralhar posts dentro do mesmo grupo
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const pick = chosen(network)
      const canonIdx = new Map([...tab, ...network].sort(canonicalCompare).map((p, i) => [p.id, i]))
      for (const k of K) {
        const out = mixNetwork({ tab, network, strengthPct: k }).posts
        for (const group of [out.filter((p) => pick.has(p.id)), out.filter((p) => !pick.has(p.id))]) {
          for (let i = 1; i < group.length; i++) expect(canonIdx.get(group[i]!.id)!).toBeGreaterThan(canonIdx.get(group[i - 1]!.id)!)
        }
      }
    }
  })

  it('com 100%, enquanto houver escolhido, ele vem antes de qualquer outro', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const pick = chosen(network)
      const out = mixNetwork({ tab, network, strengthPct: 100 }).posts
      const firstOther = out.findIndex((p) => !pick.has(p.id))
      if (firstOther >= 0) expect(out.slice(firstOther).some((p) => pick.has(p.id))).toBe(false)
    }
  })

  it('k de cada 100 lugares: nos primeiros 20, pelo menos ⌊20·k/100⌋ são escolhidos (se houver)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tab, network } = world(seed)
      const pick = chosen(network)
      for (const k of K) {
        const out = mixNetwork({ tab, network, strengthPct: k }).posts.slice(0, 20)
        const n = out.filter((p) => pick.has(p.id)).length
        expect(n).toBeGreaterThanOrEqual(Math.min(pick.size, Math.floor((20 * k) / 100)))
      }
    }
  })

  it('score inválido (NaN) conta como o mais baixo e nunca ganha prioridade', () => {
    const bad = mk('nan', Number.NaN, 10, 'amiga')
    const ok = mk('ok', 1, 10, 'x')
    const out = mixNetwork({ tab: [ok, bad], network: [bad], strengthPct: 100 })
    expect(ids(out.posts)).toEqual(['ok', 'nan'])
  })
})
