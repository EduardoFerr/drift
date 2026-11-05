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
import { clearContagionMemory, forgetBadExperience, recordBadExperience } from '../src/lib/contagion-data'
import { onNostrEvent, recalcAllScores } from '../src/lib/events'
import { getContagionFeed, getGlobalFeed } from '../src/lib/feed'
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

  it('quarentena: denúncias de contatos somando 1,0 escondem, mesmo post direto', () => {
    const follows = new Set(['ana', 'bia', 'cris'])
    const posts = [{ id: 'd', author: 'ana', createdAt: NOW - HOUR }]
    const one = computeContagion(base({ follows, posts, reports: [{ postId: 'd', reporter: 'bia', createdAt: NOW - DAY }] })).get('d')!
    expect(one.pass).toBe(true)
    const two = computeContagion(base({ follows, posts, reports: [{ postId: 'd', reporter: 'bia', createdAt: NOW - DAY }, { postId: 'd', reporter: 'cris', createdAt: NOW - DAY }] })).get('d')!
    expect(two.quarantine).toBe(CONTAGION.QUARANTINE)
    expect(two.pass).toBe(false)
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

  it('quarentena: Bia e Cris (0,5 + 0,5) denunciam o que a Ana trouxe', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const z = post('autorZ', NOW - 5 * HOUR)
    await ingest(antigo, z, spread('eu', antigo, NOW - 9 * DAY), spread('ana', z), report('bia', z), report('cris', z))
    follow('ana', 'bia', 'cris')
    expect(await tab()).not.toContain(z.id)
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

  it('SINK do leitor baixa o vínculo com quem trouxe; desfazer o engano recupera', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p1 = post('w1', NOW - 6 * HOUR)
    const p2 = post('w2', NOW - 6 * HOUR)
    const p3 = post('w3', NOW - 6 * HOUR)
    await ingest(antigo, p1, p2, p3, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p1), spread('ana', p2), spread('ana', p3))
    follow('ana')
    expect(await tab()).toEqual(expect.arrayContaining([p1.id, p2.id, p3.id]))
    // duas experiências ruins com o que a Ana trouxe: vínculo 0,8 → 0
    await recordBadExperience(p1.id, p1.pubkey)
    await recordBadExperience(p2.id, p2.pubkey)
    expect(await tab()).not.toContain(p3.id)
    // o leitor desfaz um dos SINKs (impulsiona p2): sobra uma experiência ruim
    await forgetBadExperience(p2.id)
    const strikes = H.conn!.prepare(`SELECT COUNT(*) AS n FROM contagion_strikes WHERE subject_pub = ?`).get(pk('ana')) as { n: number }
    expect(strikes.n).toBe(1)
  })

  it('denunciar e enterrar o mesmo post conta uma vez só', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const p = post('w', NOW - 6 * HOUR)
    await ingest(antigo, p, spread('eu', antigo, NOW - 9 * DAY), spread('ana', p))
    follow('ana')
    await tab()
    await recordBadExperience(p.id, p.pubkey)
    await recordBadExperience(p.id, p.pubkey)
    const n = H.conn!.prepare(`SELECT COUNT(*) AS n FROM contagion_strikes WHERE subject_pub = ?`).get(pk('ana')) as { n: number }
    expect(n.n).toBe(1)
  })

  it('experiências ruins só mexem na aba: o feed global continua igual para todos (§24)', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const ps = Array.from({ length: 5 }, (_, i) => post(`w${i}`, NOW - (i + 2) * HOUR))
    await ingest(antigo, ...ps, spread('eu', antigo, NOW - 9 * DAY), ...ps.map((p) => spread('ana', p)))
    follow('ana')
    const before = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    await tab()
    for (const p of ps) await recordBadExperience(p.id, p.pubkey)
    expect(await tab(), 'a aba do leitor mudou').toEqual([])
    expect((await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)).toEqual(before)
  })

  it('o leitor que enterrou depois de impulsionar perde o vínculo conquistado', async () => {
    const antigo = post('ana', NOW - 10 * DAY)
    const x = post('autorX', NOW - 5 * HOUR)
    await ingest(antigo, x, spread('eu', antigo, NOW - 9 * DAY), bury('eu', antigo, NOW - 8 * DAY), spread('ana', x))
    follow('ana')
    expect(await tab(), 'Ana voltou a ser só seguida (0,5)').not.toContain(x.id)
  })
})
