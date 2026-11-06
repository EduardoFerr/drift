/**
 * LENTE NO FEED — propriedades no pipeline REAL (Docs/algoritmos.md §6;
 * manifesto §24).
 *
 *   evento Nostr → onNostrEvent → SQLite real (node:sqlite + schema.sql)
 *   → recomputação global (ranking.ts) → SQL do feed → lente → store
 *
 * Só a assinatura Schnorr é mockada. A lente lê: a força (store), quem o
 * leitor segue (store de follows), bloqueios/silenciados (store local) e os
 * posts que o SQL do feed devolve. Cada teste é uma promessa:
 *   - lente desligada = a ordem de sempre, bit a bit, em todas as abas;
 *   - ligada, só mexe em Global e Em alta; Seguindo e Contágio não mudam;
 *   - mesma entrada → mesma aba, em qualquer ordem de chegada dos eventos e
 *     da lista de quem você segue (dois aparelhos convergem);
 *   - nunca traz post de quem você não segue (contas falsas, por mais que
 *     sejam), nunca ressuscita post escondido pela comunidade (−999), nunca
 *     adianta post que a comunidade afundou;
 *   - nada da lente é gravado no banco.
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

import { onNostrEvent, recalcAllScores } from '../src/lib/events'
import { refreshFeed, useFeedStore, getGlobalFeed, getTrendingFeed, getFollowingFeed, startFeedLensSync } from '../src/lib/feed'
import { useFollowsStore } from '../src/lib/follows'
import { useModLocalStore } from '../src/lib/moderation-local'
import { setLensStrength, __testing as lensTesting } from '../src/lib/trust-lens'
import { initBuiltinLenses } from '../src/lib/lens/init'
import { setActiveLens } from '../src/lib/lens/registry'
import { __resetOrphansForTest } from '../src/lib/orphans'
import type { FeedTab, Post } from '../src/types/drift'

const SCHEMA = readFileSync(join(__dirname, '..', 'src/lib/schema.sql'), 'utf8')
const NOW = 1_790_000_000
const HOUR = 3600
const DAY = 86400

let seq = 0
const hex = (n: number) => n.toString(16).padStart(64, '0')
const pk = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ('a' + h.toString(16)).padEnd(64, 'b')
}
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
const ev = (kind: number, who: string, created_at: number, tags: string[][], content = ''): Ev => ({
  id: hex(++seq), pubkey: pk(who), kind, created_at, tags, content, sig: 'f'.repeat(128),
})
const post = (who: string, t: number) =>
  ev(9078, who, t, [['drift-version', '1']], JSON.stringify({ subposts: [{ id: 's', order: 0, text: `${who} ${t}` }] }))
const spread = (who: string, p: Ev, t: number) => ev(9079, who, t, [['e', p.id], ['p', p.pubkey]])
const bury = (who: string, p: Ev, t: number) => ev(9080, who, t, [['e', p.id], ['p', p.pubkey]])
const report = (who: string, p: Ev, t: number) => ev(9081, who, t, [['e', p.id], ['p', p.pubkey], ['reason', 'spam']])

const VETS = Array.from({ length: 10 }, (_, i) => `vet${i}`)
const FOLLOWED = ['amiga', 'colega']

/**
 * O mundo, sempre o mesmo (eventos gerados uma vez; a ordem de chegada é
 * que varia entre os "aparelhos"):
 *  - 10 veteranos com âncora de 300 dias (votam com peso);
 *  - posts de estranhos com DRIFTs de veteranos (score alto);
 *  - 40 posts de preenchimento sem voto, mais novos (enchem a aba de 50);
 *  - de quem o leitor segue: f0 com 1 DRIFT, f1 velho sem voto (fora da
 *    aba), f2 afundado por veteranos (score < 0), f3 escondido por
 *    denúncia (−999), f4 novo sem voto;
 *  - 30 contas falsas, que se impulsionam entre si (peso 0).
 */
function buildWorld() {
  seq = 0
  const evs: Ev[] = []
  const anchors: Array<{ post: Ev; who: string }> = []
  for (const v of VETS) {
    const p = post(v, NOW - 2 * DAY)
    evs.push(p)
    anchors.push({ post: p, who: v })
  }
  const named: Record<string, Ev> = {}
  for (let i = 0; i < 8; i++) {
    const p = post(`estranho${i}`, NOW - (6 + i) * HOUR)
    evs.push(p)
    for (let k = 0; k < 2 + (i % 5); k++) evs.push(spread(VETS[k]!, p, NOW - (5 + i) * HOUR))
    named[`s${i}`] = p
  }
  for (let i = 0; i < 40; i++) evs.push(post(`enchimento${i}`, NOW - (60 + i) * 60))
  named.f0 = post('amiga', NOW - 3 * HOUR)
  named.f1 = post('colega', NOW - 3 * DAY)
  named.f2 = post('amiga', NOW - 4 * HOUR)
  named.f3 = post('colega', NOW - 5 * HOUR)
  named.f4 = post('colega', NOW - 30 * 60)
  evs.push(named.f0, named.f1, named.f2, named.f3, named.f4)
  evs.push(spread(VETS[0]!, named.f0, NOW - 2 * HOUR))
  for (let k = 0; k < 3; k++) evs.push(bury(VETS[k]!, named.f2, NOW - 3 * HOUR))
  for (const v of VETS) evs.push(report(v, named.f3, NOW - 4 * HOUR))
  const fakes = Array.from({ length: 30 }, (_, i) => `falsa${i}`)
  const fakePosts = fakes.map((f, i) => post(f, NOW - (20 + i) * 60))
  evs.push(...fakePosts)
  fakes.forEach((f, i) => { for (let k = 1; k <= 5; k++) evs.push(spread(f, fakePosts[(i + k) % 30]!, NOW - 10 * 60)) })
  return { evs, anchors, named }
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}
function shuffled<T>(a: readonly T[], seed: number): T[] {
  const r = rng(seed)
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!] }
  return out
}

async function freshDevice(order: 'natural' | number) {
  const { DatabaseSync } = await import('node:sqlite')
  H.conn = new DatabaseSync(':memory:') as never
  H.conn!.exec(SCHEMA)
  __resetOrphansForTest()
  const { evs, anchors, named } = buildWorld()
  for (const { post: p, who } of anchors) {
    H.conn!.prepare(`INSERT INTO ots_anchors (target_event_id, author_pub, block_height, block_time, proof_event_id) VALUES (?, ?, 0, ?, 'test')`)
      .run(p.id, pk(who), NOW - 300 * DAY)
  }
  for (const e of order === 'natural' ? evs : shuffled(evs, order)) await onNostrEvent(e as never)
  await new Promise((r) => setTimeout(r, 130))
  await recalcAllScores()
  return named
}

async function tabIds(tab: FeedTab): Promise<string[]> {
  useFeedStore.setState({ tab, loaded: false })
  await refreshFeed()
  return useFeedStore.getState().posts.map((p) => p.id)
}
async function tabPosts(tab: FeedTab): Promise<Post[]> {
  useFeedStore.setState({ tab, loaded: false })
  await refreshFeed()
  return useFeedStore.getState().posts
}

const follow = (names: string[]) => useFollowsStore.setState({ following: new Set(names.map(pk)) })

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  H.viewer = pk('eu')
  lensTesting.resetStore()
  initBuiltinLenses()
  setActiveLens('ppr-trust')
  setLensStrength(0)
  follow(FOLLOWED)
  useModLocalStore.setState({ blocked: new Set(), muted: new Set() })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('lente desligada = a ordem de sempre', () => {
  it('força 0: Global e Em alta são exatamente o SQL canônico', async () => {
    await freshDevice('natural')
    expect(await tabIds('global')).toEqual((await getGlobalFeed(50, NOW * 1000)).map((p) => p.id))
    expect(await tabIds('trending')).toEqual((await getTrendingFeed(50, NOW * 1000)).map((p) => p.id))
  })

  it('ligada sem seguir ninguém: igual à de sempre', async () => {
    await freshDevice('natural')
    follow([])
    setLensStrength(1)
    expect(await tabIds('global')).toEqual((await getGlobalFeed(50, NOW * 1000)).map((p) => p.id))
  })
})

describe('ligada', () => {
  it('só mexe em Global e Em alta: Seguindo e Contágio ficam iguais', async () => {
    await freshDevice('natural')
    const off = { following: await tabIds('following'), contagio: await tabIds('contagio') }
    setLensStrength(1)
    expect(await tabIds('following')).toEqual(off.following)
    expect(await tabIds('contagio')).toEqual(off.contagio)
    expect(off.following).toEqual((await getFollowingFeed(50, NOW * 1000)).map((p) => p.id))
  })

  it('100%: os posts de quem você segue vêm primeiro — inclusive o que estava fora dos 50', async () => {
    const n = await freshDevice('natural')
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    expect(canon).not.toContain(n.f1!.id) // fora da aba sem a lente
    setLensStrength(1)
    const ids = await tabIds('global')
    expect(ids.length).toBe(canon.length)
    // f0 (1 DRIFT), f4 (novo, sem voto), f1 (velho, sem voto) — na ordem de sempre
    expect(ids.slice(0, 3)).toEqual([n.f0!.id, n.f4!.id, n.f1!.id])
  })

  it('nunca adianta post afundado pela comunidade nem ressuscita o escondido por denúncia', async () => {
    const n = await freshDevice('natural')
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    setLensStrength(1)
    const posts = await tabPosts('global')
    const ids = posts.map((p) => p.id)
    expect(ids).not.toContain(n.f3!.id) // −999: some de tudo
    const at = ids.indexOf(n.f2!.id)
    if (at >= 0) {
      expect(at).toBeGreaterThanOrEqual(canon.indexOf(n.f2!.id))
      expect(posts[at]!.lensLift).toBeUndefined()
    }
  })

  it('contas falsas que você não segue nunca sobem, por mais que se impulsionem', async () => {
    await freshDevice('natural')
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    setLensStrength(1)
    const posts = await tabPosts('global')
    const followed = new Set(FOLLOWED.map(pk))
    for (const [i, p] of posts.entries()) {
      if (!followed.has(p.authorPub)) {
        // de quem você não segue: só pode estar na aba de sempre, e nunca mais acima
        expect(p.lensLift).toBeUndefined()
        expect(canon).toContain(p.id)
        expect(i).toBeGreaterThanOrEqual(canon.indexOf(p.id))
      }
    }
  })

  it('"subiu": cada post adiantado diz de onde veio, e só os de quem você segue', async () => {
    const n = await freshDevice('natural')
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    setLensStrength(1)
    const posts = await tabPosts('global')
    const f1 = posts.find((p) => p.id === n.f1!.id)!
    expect(f1.lensLift).toEqual({ from: null, to: posts.indexOf(f1) })
    for (const p of posts) {
      if (!p.lensLift) continue
      expect(FOLLOWED.map(pk)).toContain(p.authorPub)
      const was = canon.indexOf(p.id)
      expect(p.lensLift.from).toBe(was >= 0 ? was : null)
      expect(p.lensLift.to).toBe(posts.indexOf(p))
      expect(p.lensLift.to).toBeLessThan(was >= 0 ? was : Infinity)
    }
  })

  it('quem você bloqueou ou silenciou não ganha lugar da lente', async () => {
    const n = await freshDevice('natural')
    useModLocalStore.setState({ blocked: new Set([pk('colega')]), muted: new Set([pk('amiga')]) })
    setLensStrength(1)
    const posts = await tabPosts('global')
    expect(posts.some((p) => p.lensLift)).toBe(false)
    expect(posts.map((p) => p.id)).not.toContain(n.f1!.id)
  })

  it('denunciar alguém tira a pessoa da sua lente (o mesmo vínculo da aba Contágio)', async () => {
    // quebra: a lente usar a lista crua de quem você segue, ignorando a sua denúncia
    const n = await freshDevice('natural')
    await onNostrEvent(report('eu', n.f4!, NOW - 10 * 60) as never)
    setLensStrength(1)
    const posts = await tabPosts('global')
    const lifted = posts.filter((p) => p.lensLift).map((p) => p.authorPub)
    expect(lifted).toContain(pk('amiga'))
    expect(lifted).not.toContain(pk('colega'))
    expect(posts.map((p) => p.id)).not.toContain(n.f1!.id) // velho, de fora da aba: só a lente o traria
  })

  it('uma denúncia basta: quem você já impulsionou também sai da sua lente', async () => {
    // quebra: usar `tie > 0` (8 − 5 = 3 deixaria a pessoa na lente até a 2ª denúncia)
    const n = await freshDevice('natural')
    await onNostrEvent(spread('eu', n.f0!, NOW - 20 * 60) as never) // vínculo conquistado com a amiga
    await onNostrEvent(report('eu', n.f2!, NOW - 10 * 60) as never) // e uma denúncia de outro post dela
    setLensStrength(1)
    const posts = await tabPosts('global')
    const lifted = posts.filter((p) => p.lensLift).map((p) => p.authorPub)
    expect(lifted).not.toContain(pk('amiga'))
    expect(lifted).toContain(pk('colega'))
  })

  it('a lente só adianta posts de até 7 dias: post velho de quem você segue fica no lugar dele', async () => {
    // quebra: no Global, um post antigo com 1 voto (score > 0) passar à frente
    // de todo post novo sem voto e subir pela lente
    const n = await freshDevice('natural')
    const old = post('amiga', NOW - 10 * DAY)
    await onNostrEvent(old as never)
    await onNostrEvent(spread(VETS[1]!, old, NOW - 10 * DAY + HOUR) as never)
    await new Promise((r) => setTimeout(r, 130))
    await recalcAllScores()
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    setLensStrength(1)
    const posts = await tabPosts('global')
    const at = posts.findIndex((p) => p.id === old.id)
    if (at >= 0) {
      expect(posts[at]!.lensLift).toBeUndefined()
      expect(at).toBeGreaterThanOrEqual(canon.indexOf(old.id))
    }
    expect(posts.find((p) => p.id === n.f0!.id)?.lensLift).toBeDefined()
  })

  it('se a leitura da sua rede falhar, a aba sai na ordem de sempre (a lente nunca derruba o feed)', async () => {
    // quebra: um erro na lente (SQL, arquivo do motor que sumiu depois de um
    // deploy) virar "falha ao carregar" na aba Global
    await freshDevice('natural')
    const canon = (await getGlobalFeed(50, NOW * 1000)).map((p) => p.id)
    H.conn!.exec('DROP TABLE contagion_bad_experiences')
    setLensStrength(1)
    useFeedStore.setState({ tab: 'global', loaded: false, failed: false })
    await refreshFeed()
    const s = useFeedStore.getState()
    expect(s.failed).toBe(false)
    expect(s.posts.map((p) => p.id)).toEqual(canon)
  })

  it('a lente cronológica: os mesmos posts da aba, do mais novo pro mais velho', async () => {
    await freshDevice('natural')
    const canon = await getGlobalFeed(50, NOW * 1000)
    setActiveLens('chronological')
    const posts = await tabPosts('global')
    expect(new Set(posts.map((p) => p.id))).toEqual(new Set(canon.map((p) => p.id)))
    for (let i = 1; i < posts.length; i++) expect(posts[i]!.createdAt).toBeLessThanOrEqual(posts[i - 1]!.createdAt)
  })
})

describe('determinismo e nada gravado', () => {
  it('a mesma rede de eventos, chegando em 6 ordens diferentes, dá a mesma aba com a lente em 50% e 100%', async () => {
    const result: string[][] = []
    for (const order of ['natural', 7, 13, 21, 34, 55] as const) {
      setLensStrength(0)
      await freshDevice(order)
      setLensStrength(0.5)
      const half = await tabIds('global')
      setLensStrength(1)
      result.push([...half, '|', ...(await tabIds('global')), '|', ...(await tabIds('trending'))])
    }
    for (const r of result) expect(r).toEqual(result[0])
  })

  it('a lista de quem você segue em outra ordem não muda nada', async () => {
    await freshDevice('natural')
    setLensStrength(0.5)
    useFollowsStore.setState({ following: new Set([pk('amiga'), pk('colega')]) })
    const a = await tabIds('global')
    useFollowsStore.setState({ following: new Set([pk('colega'), pk('amiga')]) })
    expect(await tabIds('global')).toEqual(a)
  })

  it('aplicar a lente não grava nada: o banco fica idêntico', async () => {
    await freshDevice('natural')
    const dump = () => JSON.stringify(['posts', 'users', 'spreads', 'buries', 'reports', 'user_prefs'].map((t) =>
      H.conn!.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()))
    const before = dump()
    for (const k of [0.25, 0.5, 1]) {
      setLensStrength(k)
      await tabIds('global')
      await tabIds('trending')
    }
    expect(dump()).toBe(before)
  })
})

describe('reação a mudanças', () => {
  it('mexer na força, em quem você segue ou na lente ativa refaz a aba sozinho', async () => {
    // só o Date é falso: os timers (debounce do feed) são reais
    await freshDevice('natural')
    const stop = startFeedLensSync()
    try {
      useFeedStore.setState({ tab: 'global', loaded: false })
      await refreshFeed()
      const off = useFeedStore.getState().posts.map((p) => p.id)
      setLensStrength(1)
      await new Promise((r) => setTimeout(r, 400))
      const on = useFeedStore.getState().posts.map((p) => p.id)
      expect(on).not.toEqual(off)
      follow([])
      await new Promise((r) => setTimeout(r, 400))
      expect(useFeedStore.getState().posts.map((p) => p.id)).toEqual(off)
      follow(FOLLOWED)
      setActiveLens('chronological')
      await new Promise((r) => setTimeout(r, 400))
      const chrono = useFeedStore.getState().posts
      for (let i = 1; i < chrono.length; i++) expect(chrono[i]!.createdAt).toBeLessThanOrEqual(chrono[i - 1]!.createdAt)
    } finally {
      stop()
    }
  })
})
