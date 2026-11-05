/**
 * ABA CONTÁGIO — propriedades (Docs/algoritmos.md §9, manifesto §24 emendado).
 *
 * Parte 1 exerce o núcleo puro (`computeContagion`) com cenários aleatórios
 * e adversariais; cada teste é uma promessa, não um número de tabela.
 * Parte 2 passa pela porta de entrada de verdade:
 *   evento Nostr → onNostrEvent → SQLite real (node:sqlite + schema.sql)
 *   → contagion-data → SQL do feed
 * Só a assinatura e a identidade do leitor são mockadas.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const H = vi.hoisted(() => ({
  conn: null as null | {
    prepare: (sql: string) => {
      all: (...p: unknown[]) => unknown[]
      get: (...p: unknown[]) => unknown
      run: (...p: unknown[]) => unknown
    }
    exec: (sql: string) => void
  },
  viewer: '' as string,
}))

vi.mock('../src/lib/db', () => {
  const norm = (p?: unknown[]) =>
    (p ?? []).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))
  const c = () => H.conn!
  return {
    db: {
      exec: async (sql: string, params?: unknown[]) => c().prepare(sql).all(...norm(params)),
      get: async (sql: string, params?: unknown[]) => c().prepare(sql).get(...norm(params)) ?? undefined,
      run: async (sql: string, params?: unknown[]) => {
        c().prepare(sql).run(...norm(params))
      },
      batch: async (ops: Array<{ sql: string; params?: unknown[] }>) => {
        for (const o of ops) c().prepare(o.sql).run(...norm(o.params))
      },
    },
  }
})
vi.mock('../src/lib/verify', () => ({ verifyEventAsync: async () => true, verifyEvent: () => true }))
vi.mock('../src/lib/prefs', async (orig) => ({
  ...(await orig<object>()),
  getPrefs: () => ({ report_decay_enabled: false, auto_pin_enabled: false, network_mode: 'clearnet', ots_stamping_enabled: false }),
}))
vi.mock('../src/lib/transport/orchestrator', () => ({ orchestrator: { subscribe: () => () => {} } }))
vi.mock('../src/lib/transport/wss', () => ({ pool: { publish: async () => {} } }))
vi.mock('../src/lib/identity', async (orig) => ({
  ...(await orig<object>()),
  getCurrentNpub: async () => H.viewer,
}))

import { CONTAGION, computeContagion, tieOf, type ContagionAction, type ContagionInput, type ContagionVerdict } from '../src/lib/contagion'
import { clearContagionMemory, loadContagionInput, recordReportedVia } from '../src/lib/contagion-data'
import { onNostrEvent, recalcAllScores } from '../src/lib/events'
import { getContagionFeed, getGlobalFeed, getMyAction, refreshFeed, setFeedTab, useFeedStore } from '../src/lib/feed'
import { useFollowsStore } from '../src/lib/follows'
import { __resetOrphansForTest } from '../src/lib/orphans'

const NOW = 1_790_000_000
const HOUR = 3600
const DAY = 86400

// ════════════════════════════════════════════════════════════════════
// Parte 1 — núcleo puro
// ════════════════════════════════════════════════════════════════════

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}
function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
const base = (over: Partial<ContagionInput> = {}): ContagionInput => ({
  viewer: 'eu',
  nowSec: NOW,
  follows: new Set(),
  earned: new Map(),
  strikes: new Map(),
  actions: [],
  reports: [],
  posts: [],
  ...over,
})
const spreadBy = (actor: string, postId: string, createdAt = NOW - HOUR): ContagionAction => ({ postId, actor, kind: 'spread', createdAt })
const buryBy = (actor: string, postId: string, createdAt = NOW - HOUR): ContagionAction => ({ postId, actor, kind: 'bury', createdAt })
const canon = (m: Map<string, ContagionVerdict>) => JSON.stringify([...m.values()].sort((a, b) => (a.postId < b.postId ? -1 : 1)))

/** Cenário aleatório: contatos com vínculos variados, posts e ações. */
function scenario(seed: number): ContagionInput {
  const r = rng(seed)
  const people = Array.from({ length: 30 }, (_, i) => `p${i}`)
  const follows = new Set(people.filter(() => r() < 0.7))
  const earned = new Map(people.filter(() => r() < 0.4).map((p) => [p, 1 + Math.floor(r() * 3)] as const))
  const strikes = new Map(people.filter(() => r() < 0.15).map((p) => [p, 1 + Math.floor(r() * 2)] as const))
  const posts = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, author: r() < 0.1 ? 'eu' : people[Math.floor(r() * people.length)]!, createdAt: NOW - Math.floor(r() * 5 * DAY) }))
  const actions: ContagionAction[] = []
  for (let k = 0; k < 150; k++) {
    actions.push({ postId: posts[Math.floor(r() * posts.length)]!.id, actor: r() < 0.05 ? 'eu' : people[Math.floor(r() * people.length)]!, kind: r() < 0.75 ? 'spread' : 'bury', createdAt: NOW - Math.floor(r() * 3 * DAY) })
  }
  const reports = Array.from({ length: 20 }, () => ({ postId: posts[Math.floor(r() * posts.length)]!.id, reporter: people[Math.floor(r() * people.length)]!, createdAt: NOW - Math.floor(r() * 20 * DAY) }))
  return base({ follows, earned, strikes, posts, actions, reports })
}

describe('Contágio — propriedades do núcleo', () => {
  it('fazenda: contas que o leitor só segue nunca passam o limiar, por mais que sejam', () => {
    for (const n of [1, 2, 3, 10, 100, 2000]) {
      const farm = Array.from({ length: n }, (_, i) => `f${i}`)
      const v = computeContagion(
        base({ follows: new Set(farm), posts: [{ id: 'spam', author: 'dono', createdAt: NOW - HOUR }], actions: farm.map((f) => spreadBy(f, 'spam')) }),
      ).get('spam')!
      expect(v.weak, `${n} contas`).toBe(Math.min(n * CONTAGION.TIE_FOLLOW, CONTAGION.WEAK_CAP))
      expect(v.pass, `${n} contas só seguidas`).toBe(false)
    }
  })

  it('um vínculo conquistado basta; um follow sozinho não', () => {
    const posts = [{ id: 'p', author: 'autor', createdAt: NOW - HOUR }]
    const earned = computeContagion(base({ follows: new Set(['ana']), earned: new Map([['ana', 1]]), posts, actions: [spreadBy('ana', 'p')] })).get('p')!
    expect(earned.score).toBe(CONTAGION.TIE_EARNED)
    expect(earned.pass).toBe(true)
    const follow = computeContagion(base({ follows: new Set(['bia']), posts, actions: [spreadBy('bia', 'p')] })).get('p')!
    expect(follow.pass).toBe(false)
  })

  it('a ordem de chegada não muda nenhum veredicto (nem "quem trouxe")', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const inp = scenario(seed)
      const ref = canon(computeContagion(inp))
      const r = rng(seed * 7919)
      for (let k = 0; k < 10; k++) {
        const shuffled = { ...inp, actions: shuffle(inp.actions, r), reports: shuffle(inp.reports, r), posts: shuffle(inp.posts, r) }
        expect(canon(computeContagion(shuffled))).toBe(ref)
      }
    }
  })

  it('impulsionar nunca tira um post do feed (monotonia)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const inp = scenario(seed)
      const before = computeContagion(inp)
      const r = rng(seed * 31)
      const contacts = [...inp.follows]
      for (let k = 0; k < 15; k++) {
        const extra = spreadBy(contacts[Math.floor(r() * contacts.length)]!, inp.posts[Math.floor(r() * inp.posts.length)]!.id, NOW)
        const after = computeContagion({ ...inp, actions: [...inp.actions, extra] })
        for (const [id, v] of before) if (v.pass) expect(after.get(id)?.pass, `post ${id} saiu após DRIFT`).toBe(true)
      }
    }
  })

  it('vacina: SINK dos contatos tira o que chegou (e até post direto)', () => {
    const follows = new Set(['ana', 'caio', 'dora'])
    const earned = new Map([['ana', 1], ['caio', 1], ['dora', 1]])
    const posts = [{ id: 'p', author: 'autor', createdAt: NOW - HOUR }, { id: 'd', author: 'ana', createdAt: NOW - HOUR }]
    const vac = computeContagion(base({ follows, earned, posts, actions: [spreadBy('ana', 'p'), buryBy('caio', 'p')] })).get('p')!
    expect(vac.pass).toBe(false)
    const direct = computeContagion(base({ follows, earned, posts, actions: [buryBy('caio', 'd'), buryBy('dora', 'd')] })).get('d')!
    expect(direct.direct).toBe(true)
    expect(direct.pass).toBe(false)
  })

  it('quarentena: denúncias de contatos somando 1,0 escondem, mesmo post direto (com um vínculo forte)', () => {
    const follows = new Set(['ana', 'bia', 'dora'])
    const earned = new Map([['dora', 1]])
    const posts = [{ id: 'd', author: 'ana', createdAt: NOW - HOUR }]
    const one = computeContagion(base({ follows, earned, posts, reports: [{ postId: 'd', reporter: 'bia', createdAt: NOW - DAY }] })).get('d')!
    expect(one.pass).toBe(true)
    const two = computeContagion(base({ follows, earned, posts, reports: [{ postId: 'd', reporter: 'bia', createdAt: NOW - DAY }, { postId: 'd', reporter: 'dora', createdAt: NOW - DAY }] })).get('d')!
    expect(two.quarantine).toBe(CONTAGION.TIE_EARNED + CONTAGION.TIE_FOLLOW)
    expect(two.pass).toBe(false)
  })

  it('difamação: contas só seguidas, quantas forem, nunca escondem nem vacinam além de 0,5', () => {
    for (const n of [2, 3, 10, 100, 2000]) {
      const farm = Array.from({ length: n }, (_, i) => `f${i}`)
      const follows = new Set(['ana', 'autor', ...farm])
      const earned = new Map([['ana', 1]])
      const posts = [{ id: 'p', author: 'x', createdAt: NOW - HOUR }, { id: 'd', author: 'autor', createdAt: NOW - HOUR }]
      const v = computeContagion(base({
        follows, earned, posts,
        actions: [spreadBy('ana', 'p'), ...farm.map((f) => buryBy(f, 'p')), ...farm.map((f) => buryBy(f, 'd'))],
        reports: farm.map((f) => ({ postId: 'p', reporter: f, createdAt: NOW - HOUR })),
      }))
      expect(v.get('p')!.vaccine, `${n} contas`).toBe(CONTAGION.WEAK_CAP)
      expect(v.get('p')!.quarantine, `${n} contas`).toBe(CONTAGION.WEAK_CAP)
      expect(v.get('p')!.pass, `${n} contas só seguidas escondem o que a Ana trouxe`).toBe(true)
      expect(v.get('d')!.pass, `${n} contas só seguidas escondem post direto`).toBe(true)
    }
  })

  it('post direto não tem "quem trouxe": quem impulsionou não leva culpa nem aparece na pílula', () => {
    const v = computeContagion(base({
      follows: new Set(['autor', 'ana']), earned: new Map([['ana', 1]]),
      posts: [{ id: 'd', author: 'autor', createdAt: NOW - HOUR }],
      actions: [spreadBy('ana', 'd')],
    })).get('d')!
    expect(v.direct).toBe(true)
    expect(v.via).toBeNull()
    expect(v.viaAll).toEqual([])
  })

  it('empatados no maior vínculo dividem a culpa (escolher a chave não escapa)', () => {
    const v = computeContagion(base({
      follows: new Set(['00', 'ff', 'mm']), earned: new Map([['00', 1], ['ff', 1]]),
      posts: [{ id: 'p', author: 'x', createdAt: NOW - HOUR }],
      actions: [spreadBy('ff', 'p'), spreadBy('00', 'p'), spreadBy('mm', 'p')],
    })).get('p')!
    expect(v.viaAll).toEqual(['00', 'ff'])
  })

  it('a vacina vale enquanto o post pode entrar: republicar o DRIFT depois de 48 h não fura', () => {
    const follows = new Set(['ana', 'bia', 'caio'])
    const earned = new Map([['ana', 1], ['bia', 1], ['caio', 1]])
    const posts = [{ id: 'p', author: 'x', createdAt: NOW - 60 * HOUR }]
    // Caio e Bia enterraram há 58 h; Ana impulsionou de novo agora
    const v = computeContagion(base({ follows, earned, posts, actions: [buryBy('caio', 'p', NOW - 58 * HOUR), buryBy('bia', 'p', NOW - 58 * HOUR), spreadBy('ana', 'p', NOW)] })).get('p')!
    expect(v.vaccine).toBe(16)
    expect(v.pass).toBe(false)
  })

  it('janelas: DRIFT de mais de 48 h, post de mais de 72 h e denúncia de mais de 14 dias não contam', () => {
    const follows = new Set(['ana', 'bia', 'cris'])
    const earned = new Map([['ana', 1]])
    const old = computeContagion(base({ follows, earned, posts: [{ id: 'p', author: 'x', createdAt: NOW - DAY }], actions: [spreadBy('ana', 'p', NOW - 49 * HOUR)] })).get('p')
    expect(old?.pass ?? false).toBe(false)
    const stale = computeContagion(base({ follows, posts: [{ id: 'd', author: 'ana', createdAt: NOW - 73 * HOUR }] })).get('d')
    expect(stale?.pass ?? false).toBe(false)
    const oldReports = computeContagion(base({
      follows,
      posts: [{ id: 'd', author: 'ana', createdAt: NOW - HOUR }],
      reports: [{ postId: 'd', reporter: 'bia', createdAt: NOW - 15 * DAY }, { postId: 'd', reporter: 'cris', createdAt: NOW - 15 * DAY }],
    })).get('d')!
    expect(oldReports.pass).toBe(true)
  })

  it('vale a ação mais recente de cada pessoa; no empate exato, o SINK', () => {
    const follows = new Set(['ana'])
    const earned = new Map([['ana', 1]])
    const posts = [{ id: 'p', author: 'x', createdAt: NOW - DAY }]
    const regret = computeContagion(base({ follows, earned, posts, actions: [spreadBy('ana', 'p', NOW - 3 * HOUR), buryBy('ana', 'p', NOW - HOUR)] })).get('p')!
    expect(regret.pass).toBe(false)
    const changed = computeContagion(base({ follows, earned, posts, actions: [buryBy('ana', 'p', NOW - 3 * HOUR), spreadBy('ana', 'p', NOW - HOUR)] })).get('p')!
    expect(changed.pass).toBe(true)
    const tie = computeContagion(base({ follows, earned, posts, actions: [spreadBy('ana', 'p', NOW - HOUR), buryBy('ana', 'p', NOW - HOUR)] })).get('p')!
    expect(tie.pass).toBe(false)
  })

  it('duas experiências ruins zeram o vínculo: a pessoa não traz nem publica mais na aba', () => {
    const follows = new Set(['ana'])
    const earned = new Map([['ana', 1]])
    expect(tieOf('ana', follows, earned, new Map([['ana', 1]]))).toBe(CONTAGION.TIE_EARNED - CONTAGION.STRIKE_PENALTY)
    const zero = new Map([['ana', 2]])
    expect(tieOf('ana', follows, earned, zero)).toBe(0)
    const v = computeContagion(base({
      follows, earned, strikes: zero,
      posts: [{ id: 'p', author: 'x', createdAt: NOW - HOUR }, { id: 'd', author: 'ana', createdAt: NOW - HOUR }],
      actions: [spreadBy('ana', 'p')],
    }))
    expect(v.get('p')?.pass ?? false).toBe(false)
    expect(v.get('d')?.pass ?? false).toBe(false)
  })

  it('o leitor nunca vê os próprios posts pela aba, e as próprias ações não contam', () => {
    const v = computeContagion(base({
      follows: new Set(['eu', 'ana']), earned: new Map([['eu', 5], ['ana', 1]]),
      posts: [{ id: 'meu', author: 'eu', createdAt: NOW - HOUR }, { id: 'p', author: 'x', createdAt: NOW - HOUR }],
      actions: [spreadBy('ana', 'meu'), spreadBy('eu', 'p')],
    }))
    expect(v.get('meu')).toBeUndefined()
    expect(v.get('p')?.pass ?? false).toBe(false)
  })

  it('quem o leitor não segue não pesa, mesmo que ele já o tenha impulsionado', () => {
    expect(tieOf('ana', new Set(), new Map([['ana', 9]]), new Map())).toBe(0)
  })

  it('SINK ou denúncia de um contato nunca acrescentam um post à aba', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const inp = scenario(seed)
      const before = computeContagion(inp)
      const r = rng(seed * 101)
      const contacts = [...inp.follows]
      for (let k = 0; k < 15; k++) {
        const who = contacts[Math.floor(r() * contacts.length)]!
        const pid = inp.posts[Math.floor(r() * inp.posts.length)]!.id
        for (const v of [
          { ...inp, actions: [...inp.actions, buryBy(who, pid, NOW)] },
          { ...inp, reports: [...inp.reports, { postId: pid, reporter: who, createdAt: NOW }] },
        ]) {
          for (const [id, verdict] of computeContagion(v)) {
            if (verdict.pass) expect(before.get(id)?.pass, `post ${id} entrou depois de SINK/denúncia`).toBe(true)
          }
        }
      }
    }
  })

  it('experiência ruim com X só acrescenta post que o próprio X tinha vacinado ou denunciado', () => {
    // Por desenho: confiar menos em X também pesa menos o SINK e a denúncia de X.
    for (let seed = 1; seed <= 20; seed++) {
      const inp = scenario(seed)
      const before = computeContagion(inp)
      for (const who of inp.follows) {
        const after = computeContagion({ ...inp, strikes: new Map([...inp.strikes, [who, (inp.strikes.get(who) ?? 0) + 1]]) })
        const judged = new Set([...inp.actions.filter((a) => a.actor === who && a.kind === 'bury').map((a) => a.postId), ...inp.reports.filter((x) => x.reporter === who).map((x) => x.postId)])
        for (const [id, verdict] of after) {
          if (verdict.pass && !before.get(id)?.pass) expect(judged.has(id), `post ${id} entrou sem ${who} ter vacinado/denunciado`).toBe(true)
        }
      }
    }
  })

  it('vínculo conquistado com uma experiência ruim cai para fraco (0,3) e entra no teto', () => {
    const follows = new Set(['ana', 'bia'])
    const earned = new Map([['ana', 1]])
    const strikes = new Map([['ana', 1]])
    expect(tieOf('ana', follows, earned, strikes)).toBe(3)
    const v = computeContagion(base({ follows, earned, strikes, posts: [{ id: 'p', author: 'x', createdAt: NOW - HOUR }], actions: [spreadBy('ana', 'p'), spreadBy('bia', 'p')] })).get('p')!
    expect(v.strong).toBe(0)
    expect(v.weak).toBe(CONTAGION.WEAK_CAP)
    expect(v.pass).toBe(false)
  })

  it('a ação do próprio autor no próprio post não conta (nem DRIFT nem SINK)', () => {
    const follows = new Set(['ana'])
    const earned = new Map([['ana', 1]])
    const old = computeContagion(base({ follows, earned, posts: [{ id: 'd', author: 'ana', createdAt: NOW - 80 * HOUR }], actions: [spreadBy('ana', 'd')] })).get('d')
    expect(old?.pass ?? false, 'republicar o DRIFT não mantém post velho').toBe(false)
    const own = computeContagion(base({ follows, earned, posts: [{ id: 'd', author: 'ana', createdAt: NOW - HOUR }], actions: [buryBy('ana', 'd')] })).get('d')!
    expect(own.vaccine).toBe(0)
  })

  it('post com mais de 4 dias não entra pelo contágio (igual à simulação)', () => {
    const follows = new Set(['ana'])
    const earned = new Map([['ana', 1]])
    const v = computeContagion(base({ follows, earned, posts: [{ id: 'p', author: 'x', createdAt: NOW - 97 * HOUR }], actions: [spreadBy('ana', 'p')] })).get('p')!
    expect(v.score).toBe(CONTAGION.TIE_EARNED)
    expect(v.pass).toBe(false)
  })

  it('"quem trouxe" é o maior vínculo, com desempate pela chave', () => {
    const v = computeContagion(base({
      follows: new Set(['b', 'a', 'c']), earned: new Map([['a', 1], ['b', 1]]),
      posts: [{ id: 'p', author: 'x', createdAt: NOW - HOUR }],
      actions: [spreadBy('c', 'p'), spreadBy('b', 'p'), spreadBy('a', 'p')],
    })).get('p')!
    expect(v.via).toBe('a')
    expect(v.contributors.map((c) => c.pub)).toEqual(['a', 'b', 'c'])
  })
})

// ════════════════════════════════════════════════════════════════════
// Parte 2 — pipeline real (evento → SQLite → aba)
// ════════════════════════════════════════════════════════════════════

const SCHEMA = readFileSync(join(__dirname, '..', 'src/lib/schema.sql'), 'utf8')
let seq = 0
const hex = (n: number) => n.toString(16).padStart(64, '0')
const pk = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ('a' + h.toString(16)).padEnd(64, 'b')
}
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
const ev = (kind: number, who: string, t: number, tags: string[][], content = ''): Ev => ({ id: hex(++seq), pubkey: pk(who), kind, created_at: t, tags, content, sig: 'f'.repeat(128) })
const post = (who: string, t: number) => ev(9078, who, t, [['drift-version', '1']], JSON.stringify({ subposts: [{ text: 'oi' }] }))
const spread = (who: string, p: Ev, t = NOW - HOUR) => ev(9079, who, t, [['e', p.id], ['p', p.pubkey]])
const bury = (who: string, p: Ev, t = NOW - HOUR) => ev(9080, who, t, [['e', p.id]])
const report = (who: string, p: Ev, t = NOW - HOUR) => ev(9081, who, t, [['e', p.id], ['reason', 'spam']])
const ingest = async (...es: Ev[]) => {
  for (const e of es) await onNostrEvent(e as never)
  await new Promise((r) => setTimeout(r, 130))
  await recalcAllScores()
}
const tab = async () => (await getContagionFeed(50, NOW * 1000)).map((p) => p.id)
const follow = (...names: string[]) => useFollowsStore.setState({ following: new Set(names.map(pk)) } as never)

describe('Contágio — pipeline real', () => {
  beforeEach(async () => {
    const { DatabaseSync } = await import('node:sqlite')
    H.conn = new DatabaseSync(':memory:') as never
    H.conn!.exec(SCHEMA)
    H.viewer = pk('eu')
    __resetOrphansForTest()
    clearContagionMemory()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
    follow()
  })

  it('sem follows a aba fica vazia', async () => {
    const p = post('x', NOW - HOUR)
    await ingest(p, spread('ana', p))
    follow()
    expect(await tab()).toEqual([])
  })

  it('chega pelo vínculo conquistado; não chega por dois follows; post direto entra', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const x = post('autorX', NOW - 5 * HOUR)
    const y = post('autorY', NOW - 5 * HOUR)
    const daBia = post('bia', NOW - 2 * HOUR)
    // o leitor já impulsionou algo da Ana → vínculo conquistado (0,8)
    await ingest(antigo, x, y, daBia, spread('eu', antigo, NOW - 9 * DAY), spread('ana', x), spread('bia', y), spread('cris', y))
    follow('ana', 'bia', 'cris')
    const ids = await tab()
    expect(ids).toContain(x.id)
    expect(ids, 'Bia + Cris só seguidas somam 0,5').not.toContain(y.id)
    expect(ids, 'post recente de quem o leitor segue').toContain(daBia.id)
  })

  it('quarentena: Dora (0,8) e Bia (0,5) denunciam o que a Ana trouxe; Bia e Cris (0,5 + 0,5) sozinhas não escondem', async () => {
    const daAna = post('ana', NOW - 10 * DAY)
    const daDora = post('dora', NOW - 10 * DAY)
    const z = post('autorZ', NOW - 5 * HOUR)
    const y = post('autorY', NOW - 5 * HOUR)
    await ingest(daAna, daDora, z, y, spread('eu', daAna, NOW - 9 * DAY), spread('eu', daDora, NOW - 9 * DAY),
      spread('ana', z), report('dora', z), report('bia', z),
      spread('ana', y), report('bia', y), report('cris', y), bury('bia', y), bury('cris', y))
    follow('ana', 'dora', 'bia', 'cris')
    const ids = await tab()
    expect(ids).not.toContain(z.id)
    expect(ids, 'difamação por contas só seguidas').toContain(y.id)
  })

  it('a ordem da aba é a canônica: mesma ordem relativa do feed global', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const ps = Array.from({ length: 6 }, (_, i) => post(`autor${i}`, NOW - (i + 1) * HOUR))
    await ingest(antigo, ...ps, spread('eu', antigo, NOW - 9 * DAY), ...ps.map((p) => spread('ana', p)), spread('bia', ps[4]!), spread('bia', ps[1]!))
    follow('ana', 'bia')
    const aba = await tab()
    const global = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id).filter((id) => aba.includes(id))
    expect(aba).toEqual(global)
  })

  /** Linhas locais "quem trouxe" do leitor contra `subject`. */
  const viaCount = (viewer: string, subject: string) =>
    (H.conn!.prepare(`SELECT COUNT(DISTINCT post_id) AS n FROM contagion_bad_experiences WHERE viewer_pub = ? AND subject_pub = ?`).get(pk(viewer), pk(subject)) as { n: number }).n
  /** Experiências ruins que o leitor tem com `who`, como a aba as lê. */
  const strikesOf = async (who: string, viewer = 'eu') =>
    (await loadContagionInput(pk(viewer), new Set(), NOW)).strikes.get(pk(who)) ?? 0
  /** Denúncia feita na aba: o PostViewer publica e registra quem trouxe;
   *  a denúncia publicada volta pelo relay (eco) e entra pelo pipeline. */
  const reportInTab = async (p: Ev) => {
    await recordReportedVia(p.id)
    await ingest(report('eu', p, NOW - 30 * 60))
  }

  it('denúncia feita na aba baixa o vínculo com quem trouxe e com o autor', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p1 = post('w1', NOW - 6 * HOUR)
    const p2 = post('w2', NOW - 6 * HOUR)
    const p3 = post('w3', NOW - 6 * HOUR)
    await ingest(antigo, p1, p2, p3, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p1), spread('ana', p2), spread('ana', p3))
    follow('ana')
    expect(await tab()).toEqual(expect.arrayContaining([p1.id, p2.id, p3.id]))
    await reportInTab(p1)
    await reportInTab(p2)
    expect(viaCount('eu', 'ana')).toBe(2)
    expect(viaCount('eu', 'w1'), 'o autor não é gravado: sai da denúncia publicada').toBe(0)
    expect(await strikesOf('w1')).toBe(1)
    expect(await strikesOf('ana')).toBe(2)
    // vínculo da Ana: 0,8 − 2 × 0,5 → 0 — nada mais chega por ela
    expect(await tab()).not.toContain(p3.id)
  })

  it('SINK do leitor é gosto: não pune o autor nem quem trouxe (§23)', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const deW = post('w', NOW - 3 * HOUR)
    const deW2 = post('w', NOW - 2 * HOUR)
    const ps = Array.from({ length: 3 }, (_, i) => post(`x${i}`, NOW - 6 * HOUR))
    await ingest(antigo, deW, deW2, ...ps, spread('eu', antigo, NOW - 9 * DAY), ...ps.map((p) => spread('ana', p)))
    follow('ana', 'w')
    expect(await tab()).toEqual(expect.arrayContaining([ps[2]!.id, deW2.id]))
    // o leitor enterra dois posts que a Ana trouxe e um do autor W que segue
    await ingest(bury('eu', ps[0]!, NOW - 30 * 60), bury('eu', ps[1]!, NOW - 30 * 60), bury('eu', deW, NOW - 30 * 60))
    expect(viaCount('eu', 'ana')).toBe(0)
    expect(await strikesOf('ana')).toBe(0)
    expect(await strikesOf('w')).toBe(0)
    const ids = await tab()
    expect(ids, 'a Ana continua trazendo').toContain(ps[2]!.id)
    expect(ids, 'o post novo do autor enterrado continua entrando direto').toContain(deW2.id)
  })

  it('denúncia fora da aba pune só o autor; quem trouxe só perde vínculo com o "chegou por" à vista', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p = post('w', NOW - 6 * HOUR)
    await ingest(antigo, p, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p))
    follow('ana')
    await tab()
    // feita no global: o PostViewer não registra quem trouxe (arrivedVia null)
    await ingest(report('eu', p, NOW - 30 * 60))
    expect(viaCount('eu', 'ana')).toBe(0)
    expect(await strikesOf('ana')).toBe(0)
    expect(await strikesOf('w')).toBe(1)
    expect(await tab(), 'a Ana segue trazendo').toContain(p.id)
  })

  it('o mesmo post conta uma vez: denunciar de novo não dobra a experiência ruim', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p = post('w', NOW - 6 * HOUR)
    await ingest(antigo, p, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p))
    follow('ana')
    await tab()
    await reportInTab(p)
    await reportInTab(p)
    expect(await strikesOf('ana')).toBe(1)
    expect(await strikesOf('w')).toBe(1)
  })

  it('experiências ruins são de cada identidade: trocar de identidade não as herda', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p = post('w', NOW - 6 * HOUR)
    await ingest(antigo, p, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p))
    follow('ana')
    await tab()
    await reportInTab(p)
    H.viewer = pk('outra')
    expect(viaCount('outra', 'ana')).toBe(0)
    expect(await strikesOf('ana', 'outra')).toBe(0)
    expect(await strikesOf('w', 'outra')).toBe(0)
    H.viewer = pk('eu')
  })

  it('o registro de quem trouxe só mexe na aba: o feed global continua igual para todos (§24)', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const ps = Array.from({ length: 5 }, (_, i) => post(`w${i}`, NOW - (i + 2) * HOUR))
    await ingest(antigo, ...ps, spread('eu', antigo, NOW - 9 * DAY), ...ps.map((p) => spread('ana', p)))
    follow('ana')
    const before = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    await tab()
    // só a parte local (o efeito da denúncia publicada no global é o §26 de sempre)
    for (const p of ps) await recordReportedVia(p.id)
    expect(await tab(), 'a aba do leitor mudou').toEqual([])
    expect((await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)).toEqual(before)
  })

  it('quem o leitor bloqueou não traz, não vacina e não denuncia (só silenciar mantém as interações)', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const x = post('autorX', NOW - 5 * HOUR)
    await ingest(antigo, x, spread('eu', antigo, NOW - 9 * DAY), spread('ana', x))
    follow('ana')
    expect(await tab()).toContain(x.id)
    H.conn!.prepare(`INSERT INTO blocked (npub, blocked_at) VALUES (?, ?)`).run(pk('ana'), NOW)
    expect(await tab(), 'bloqueada continua trazendo').not.toContain(x.id)
  })

  it('empate exato entre DRIFT e SINK do leitor: não há vínculo conquistado', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const x = post('autorX', NOW - 5 * HOUR)
    await ingest(antigo, x, spread('eu', antigo, NOW - 9 * DAY), bury('eu', antigo, NOW - 9 * DAY), spread('ana', x))
    follow('ana')
    expect(await tab()).not.toContain(x.id)
  })

  it('getMyAction devolve a ação mais recente (o desfazer depende disto)', async () => {
    const a = post('x', NOW - DAY)
    const b = post('y', NOW - DAY)
    const c = post('z', NOW - DAY)
    await ingest(a, b, c, spread('eu', a, NOW - 3 * HOUR), bury('eu', a, NOW - 2 * HOUR), bury('eu', b, NOW - 3 * HOUR), spread('eu', b, NOW - 2 * HOUR), spread('eu', c, NOW - HOUR), bury('eu', c, NOW - HOUR))
    expect(await getMyAction(a.id, pk('eu'))).toBe('bury')
    expect(await getMyAction(b.id, pk('eu'))).toBe('spread')
    expect(await getMyAction(c.id, pk('eu')), 'empate: o SINK').toBe('bury')
  })

  it('trocar de aba no meio de uma atualização nunca mostra posts da aba anterior', async () => {
    // achado do E2E: o refresh em voo da aba global terminava depois da troca
    // e gravava os posts dela com loaded = true sob o rótulo "contágio"
    const ps = Array.from({ length: 4 }, (_, i) => post(`w${i}`, NOW - (i + 2) * HOUR))
    await ingest(...ps)
    follow() // sem follows: a aba Contágio tem de estar vazia
    useFeedStore.setState({ tab: 'global', loaded: false, posts: [] } as never)
    const vistos: { tab: string; n: number }[] = []
    const unsub = useFeedStore.subscribe((s) => { if (s.loaded) vistos.push({ tab: s.tab, n: s.posts.length }) })
    const emVoo = refreshFeed()
    const troca = setFeedTab('contagio')
    await Promise.all([emVoo, troca])
    for (let i = 0; i < 50 && !(useFeedStore.getState().loaded && useFeedStore.getState().tab === 'contagio'); i++) await new Promise((r) => setTimeout(r, 5))
    unsub()
    expect(useFeedStore.getState().tab).toBe('contagio')
    expect(useFeedStore.getState().loaded).toBe(true)
    expect(vistos.filter((v) => v.tab === 'contagio' && v.n > 0), 'aba Contágio exibiu posts do global').toEqual([])
    useFeedStore.setState({ tab: 'global' } as never)
  })

  it('o leitor que enterrou depois de impulsionar perde o vínculo conquistado', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const x = post('autorX', NOW - 5 * HOUR)
    await ingest(antigo, x, spread('eu', antigo, NOW - 9 * DAY), bury('eu', antigo, NOW - 8 * DAY), spread('ana', x))
    follow('ana')
    expect(await tab(), 'Ana voltou a ser só seguida (0,5)').not.toContain(x.id)
  })
})
