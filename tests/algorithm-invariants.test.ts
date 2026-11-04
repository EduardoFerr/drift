/**
 * INVARIANTES DO ALGORITMO — o que o Drift promete, verificado no
 * pipeline REAL contra ataques.
 *
 * Por que este arquivo existe (auditoria 2026-11-03): a suíte tinha ~2200
 * testes, quase todos conferindo que cada função pura devolve o número da
 * tabela do doc. Nenhum checava as PROPRIEDADES do sistema — mesma rede de
 * eventos → mesmo resultado; Sybil não ganha peso; moderação não se desfaz.
 * Com a especificação errada, os testes só atestavam o erro.
 *
 * Aqui cada teste é uma promessa do manifesto, exercida pela porta de
 * entrada de verdade:
 *   evento Nostr → onNostrEvent → SQLite real (node:sqlite + schema.sql)
 *   → recomputação global (ranking.ts) → SQL do feed
 * Só a assinatura Schnorr é mockada (eventos sintéticos). A âncora OTS é
 * gravada direto em `ots_anchors` (equivalente a uma prova já verificada),
 * exceto na seção 6, que verifica uma prova Bitcoin real.
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
  published: [] as Array<{ relays: string[]; event: { kind: number; id: string } }>,
  subscribed: [] as Array<{ filter: Record<string, unknown>; onevent: (e: unknown) => void }>,
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
  getPrefs: () => ({
    report_decay_enabled: false,
    auto_pin_enabled: false,
    network_mode: 'clearnet',
    ots_stamping_enabled: true,
  }),
}))
vi.mock('../src/lib/transport/orchestrator', () => ({
  orchestrator: {
    subscribe: (filter: Record<string, unknown>, h: { onevent: (e: unknown) => void }) => {
      H.subscribed.push({ filter, onevent: h.onevent })
      return () => {}
    },
  },
}))
vi.mock('../src/lib/transport/wss', () => ({
  pool: {
    publish: async (relays: string[], event: { kind: number; id: string }) => {
      H.published.push({ relays, event })
    },
  },
}))

import { onNostrEvent, recalcAllScores, isAcceptableCreatedAt } from '../src/lib/events'
import { getGlobalFeed } from '../src/lib/feed'
import { calculateScore } from '../src/lib/scoring'
import { inferCascadeTree } from '../src/lib/cascade'
import { viewMultiplier, computePpr } from '../src/lib/trust/ppr'
import { computeInfluence } from '../src/lib/trust/edges'
import { createPprRng } from '../src/lib/trust/rng'
import { advanceCursor } from '../src/lib/sync'
import { verifyPendingProofs } from '../src/lib/ots-anchors'
import { ensureOwnAnchor } from '../src/lib/ots-stamper'
import { __resetOrphansForTest } from '../src/lib/orphans'
import { bytesToBase64, bytesToHex, newOtsFile, parseOtsFile } from '../src/lib/ots'

const ROOT = join(__dirname, '..')
const SCHEMA = readFileSync(join(ROOT, 'src/lib/schema.sql'), 'utf8')

// ─── Fábrica de eventos ─────────────────────────────────────────────
const NOW = 1_790_000_000 // unix s
const HOUR = 3600
const DAY = 86400
/** Pesos são medidos no início do dia UTC (determinismo intradiário). */
const weeksAtEpoch = (anchorSec: number, nowSec = NOW) =>
  (Math.floor(nowSec / DAY) * DAY - anchorSec) / (7 * DAY)
let seq = 0
const hex = (n: number) => n.toString(16).padStart(64, '0')
const pk = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ('a' + h.toString(16)).padEnd(64, 'b')
}
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
const ev = (kind: number, who: string, created_at: number, tags: string[][], content = ''): Ev => ({
  id: hex(++seq),
  pubkey: pk(who),
  kind,
  created_at,
  tags,
  content,
  sig: 'f'.repeat(128),
})
const post = (who: string, t: number) =>
  ev(9078, who, t, [['drift-version', '1']], JSON.stringify({ subposts: [{ text: 'oi' }] }))
const spread = (who: string, postId: string, t: number) => ev(9079, who, t, [['e', postId]])
const bury = (who: string, postId: string, t: number) => ev(9080, who, t, [['e', postId]])
const report = (who: string, postId: string, t: number, reason = 'spam') =>
  ev(9081, who, t, [['e', postId], ['reason', reason]])
const comment = (who: string, root: Ev, t: number) =>
  ev(
    1111,
    who,
    t,
    [
      ['E', root.id, '', root.pubkey],
      ['K', '9078'],
      ['e', root.id, '', root.pubkey],
      ['k', '9078'],
      ['P', root.pubkey],
      ['p', root.pubkey],
      ['drift-version', '1'],
    ],
    'comentário',
  )

const ingest = async (...es: Ev[]) => {
  for (const e of es) await onNostrEvent(e as never)
}
/** Debounce da recomputação + uma passada explícita (serializada). */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 130))
  await recalcAllScores()
}
const row = (id: string) =>
  H.conn!.prepare('SELECT score, score_base, spreads, buries FROM posts WHERE id = ?').get(id) as
    | { score: number; score_base: number; spreads: number; buries: number }
    | undefined
const weightOf = (who: string) =>
  (H.conn!.prepare('SELECT weight FROM users WHERE npub = ?').get(pk(who)) as { weight: number } | undefined)?.weight ?? 0
const feedIds = async (now = NOW) => (await getGlobalFeed(50, now * 1000)).map((p) => p.id)
const feedScore = async (id: string, now = NOW) =>
  (await getGlobalFeed(50, now * 1000)).find((p) => p.id === id)?.score

/**
 * Identidade honesta com idade PROVADA: âncora OTS (equivalente a prova
 * verificada) há `ageDays`, + 1 post recente (pra ela existir e estar ativa).
 */
const veteran = async (who: string, ageDays = 300) => {
  const p = post(who, NOW - DAY)
  await ingest(p)
  H.conn!
    .prepare(
      `INSERT INTO ots_anchors (target_event_id, author_pub, block_height, block_time, proof_event_id)
       VALUES (?, ?, 0, ?, 'test')`,
    )
    .run(p.id, pk(who), NOW - ageDays * DAY)
}

const freshDb = async () => {
  const { DatabaseSync } = await import('node:sqlite')
  H.conn = new DatabaseSync(':memory:') as never
  H.conn!.exec(SCHEMA)
}

/** Snapshot de tudo que o ranking deriva — pra comparar "clientes". */
const snapshot = () => ({
  posts: H.conn!.prepare('SELECT id, score_base, spreads, buries, score = -999 AS mod FROM posts ORDER BY id').all(),
  users: H.conn!.prepare('SELECT npub, weight FROM users ORDER BY npub').all(),
})

beforeEach(async () => {
  await freshDb()
  H.published.length = 0
  H.subscribed.length = 0
  __resetOrphansForTest()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
})
afterEach(() => {
  vi.useRealTimers()
})

// ════════════════════════════════════════════════════════════════════
// 1. SCORE + DECAY + RELÓGIO
// ════════════════════════════════════════════════════════════════════
describe('1. Score canônico, decay e relógio', () => {
  it('spread de identidade com peso provado sobe o post', async () => {
    await veteran('v')
    const a = post('autorA', NOW - HOUR)
    const b = post('autorB', NOW - HOUR)
    await ingest(a, b, spread('v', a.id, NOW))
    await settle()
    expect(row(a.id)!.score_base).toBe(40)
    const ids = await feedIds()
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id))
  })

  it('decay acontece na leitura — 24h depois vale menos sem nenhum write', async () => {
    await veteran('v')
    const a = post('autorA', NOW)
    await ingest(a, spread('v', a.id, NOW))
    await settle()
    expect(await feedScore(a.id, NOW)).toBeCloseTo(40 / Math.pow(2, 1.5), 6)
    expect(await feedScore(a.id, NOW + 24 * HOUR)).toBeCloseTo(40 / Math.pow(26, 1.5), 6)
  })

  it('evento com created_at além de 15 min no futuro é descartado na entrada', async () => {
    const futuro = post('troll', NOW + 2 * HOUR)
    await ingest(futuro)
    await settle()
    expect(row(futuro.id)).toBeUndefined()
    expect(isAcceptableCreatedAt(NOW + 15 * 60, NOW)).toBe(true)
    expect(isAcceptableCreatedAt(NOW + 15 * 60 + 1, NOW)).toBe(false)
  })

  it('post dentro da tolerância (+10 min) NÃO ganha boost: feed = TS (idade clampada em 0)', async () => {
    await veteran('v')
    const honesto = post('autorA', NOW)
    const adiantado = post('autorB', NOW + 10 * 60)
    await ingest(honesto, adiantado, spread('v', honesto.id, NOW), spread('v', adiantado.id, NOW))
    await settle()
    expect(await feedScore(adiantado.id)).toBeCloseTo((await feedScore(honesto.id))!, 9)
    expect(await feedScore(adiantado.id)).toBeCloseTo(
      calculateScore({ spreadWeight: 40, buryWeight: 0, createdAt: NOW + 600, now: NOW }),
      9,
    )
  })

  it('comentários de identidades com peso entram na ORDEM do feed (cap 30)', async () => {
    for (let i = 0; i < 5; i++) await veteran(`c${i}`)
    const comentado = post('autorA', NOW)
    const mudo = post('autorB', NOW)
    await ingest(comentado, mudo)
    for (let i = 0; i < 5; i++) await ingest(comment(`c${i}`, comentado, NOW))
    await settle()
    expect(row(comentado.id)!.score_base).toBe(30)
    const ids = await feedIds()
    expect(ids.indexOf(comentado.id)).toBeLessThan(ids.indexOf(mudo.id))
  })

  it('auto-comentário e comentário de chave sem peso não contam', async () => {
    const p = post('autor', NOW)
    await ingest(p, comment('autor', p, NOW))
    for (let i = 0; i < 20; i++) await ingest(comment(`fresh${i}`, p, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════
// 2. DETERMINISMO — "última ação vale" e independência de ordem (§7, §23)
// ════════════════════════════════════════════════════════════════════
describe('2. Determinismo', () => {
  it('spread → bury → spread conta SPREAD (a última ação)', async () => {
    await veteran('u')
    const p = post('autor', NOW - HOUR)
    await ingest(p, spread('u', p.id, NOW - 50 * 60), bury('u', p.id, NOW - 40 * 60), spread('u', p.id, NOW - 30 * 60))
    await settle()
    expect(row(p.id)!.score_base).toBe(40)
  })

  it('spread → bury conta bury (−0.3 × peso)', async () => {
    await veteran('u')
    const p = post('autor', NOW - HOUR)
    await ingest(p, spread('u', p.id, NOW - 30 * 60), bury('u', p.id, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBeCloseTo(-12, 9)
    expect(row(p.id)!.buries).toBe(1)
  })

  it('as 6 ordens de chegada de (spread, bury, spread) dão o MESMO score', async () => {
    const p = post('autor', NOW - HOUR)
    const acts = [spread('u', p.id, NOW - 50 * 60), bury('u', p.id, NOW - 40 * 60), spread('u', p.id, NOW - 30 * 60)]
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    const results: number[] = []
    for (const perm of perms) {
      await freshDb()
      await veteran('u')
      await ingest(p, ...perm.map((i) => acts[i]!))
      await settle()
      results.push(row(p.id)!.score_base)
    }
    expect(new Set(results)).toEqual(new Set([40]))
  })

  it('PROPRIEDADE: rede aleatória (votos, comentários, reports, âncoras) embaralhada 12× → resultado idêntico', async () => {
    let s = 7
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
    const people = Array.from({ length: 14 }, (_, i) => `p${i}`)
    const anchored = people.slice(0, 8)
    const posts = people.map((who, i) => post(who, NOW - (i + 1) * HOUR))
    const events: Ev[] = [...posts]
    for (let k = 0; k < 120; k++) {
      const who = people[Math.floor(rand() * people.length)]!
      const target = posts[Math.floor(rand() * posts.length)]!
      const t = NOW - Math.floor(rand() * 3 * HOUR)
      const r = rand()
      if (r < 0.5) events.push(spread(who, target.id, t))
      else if (r < 0.75) events.push(bury(who, target.id, t))
      else if (r < 0.92) events.push(comment(who, target, t))
      else events.push(report(who, target.id, t, rand() < 0.5 ? 'spam' : 'illegal'))
    }
    const anchor = () => {
      for (const [i, who] of anchored.entries())
        H.conn!
          .prepare(`INSERT INTO ots_anchors VALUES (?, ?, 0, ?, 'test')`)
          .run(posts[i]!.id, pk(who), NOW - (30 + i * 40) * DAY)
    }

    let reference: unknown = null
    for (let trial = 0; trial < 12; trial++) {
      await freshDb()
      const shuffled = [...events]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
      }
      // Recomputações intermediárias em pontos aleatórios: o resultado
      // final não pode depender do histórico de recálculos.
      // Âncoras chegam em momento diferente em cada "cliente".
      const anchorAt = Math.floor(rand() * shuffled.length)
      for (const [i, e] of shuffled.entries()) {
        if (i === anchorAt) anchor()
        await ingest(e)
        if (rand() < 0.03) await recalcAllScores()
      }
      await settle()
      const snap = snapshot()
      if (reference === null) reference = snap
      else expect(snap).toEqual(reference)
    }
  }, 60_000)
})

// ════════════════════════════════════════════════════════════════════
// 3. ANTI-SYBIL (§22, §32)
// ════════════════════════════════════════════════════════════════════
describe('3. Peso de identidade e Sybil', () => {
  it('100 chaves novas espalhando contribuem 0', async () => {
    const p = post('alvo', NOW)
    await ingest(p)
    for (let i = 0; i < 100; i++) await ingest(spread(`sybil${i}`, p.id, NOW))
    await settle()
    expect(row(p.id)!.spreads).toBe(100)
    expect(row(p.id)!.score_base).toBe(0)
  })

  it('backdating NÃO dá antiguidade: post assinado com data de 1 ano atrás, sem âncora → peso 0', async () => {
    const p = post('alvo', NOW)
    await ingest(p, post('sybil', NOW - 365 * DAY), spread('sybil', p.id, NOW))
    await settle()
    expect(weightOf('sybil')).toBe(0)
    expect(row(p.id)!.score_base).toBe(0)
  })

  it('10 Sybils backdatados somam 0', async () => {
    const p = post('alvo', NOW)
    await ingest(p)
    for (let i = 0; i < 10; i++) await ingest(post(`s${i}`, NOW - 400 * DAY), spread(`s${i}`, p.id, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBe(0)
  })

  it('lavagem: 6 chaves novas espalhando o atacante não lhe dão peso', async () => {
    const atacante = post('atacante', NOW - HOUR)
    await ingest(atacante)
    for (let i = 0; i < 6; i++) await ingest(spread(`fresh${i}`, atacante.id, NOW - HOUR))
    const alvo = post('alvo', NOW)
    await ingest(alvo, spread('atacante', alvo.id, NOW))
    await settle()
    expect(weightOf('atacante')).toBe(0)
    expect(row(alvo.id)!.score_base).toBe(0)
  })

  it('anel mútuo de 7 chaves sem âncora fica todo em peso 0', async () => {
    const N = 7
    const ps = Array.from({ length: N }, (_, i) => post(`ring${i}`, NOW - 2 * HOUR))
    await ingest(...ps)
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) if (i !== j) await ingest(spread(`ring${i}`, ps[j]!.id, NOW - HOUR))
    await settle()
    for (let i = 0; i < N; i++) expect(weightOf(`ring${i}`)).toBe(0)
  })

  it('confiança FLUI de quem tem peso: veterano (40) espalha novato → novato ganha 4 (10 × 40/100)', async () => {
    await veteran('v')
    const novato = post('novato', NOW - HOUR)
    await ingest(novato, spread('v', novato.id, NOW - HOUR))
    await settle()
    expect(weightOf('novato')).toBeCloseTo(4, 9)
  })

  it('antiguidade vem da âncora, não do "primeiro visto": dois clientes com históricos diferentes concordam', async () => {
    const p = post('autor', NOW)
    const velho = post('u', NOW - 200 * DAY)
    const recente = post('u', NOW - DAY)
    const s = spread('u', p.id, NOW)
    const anchorU = () =>
      H.conn!.prepare(`INSERT INTO ots_anchors VALUES (?, ?, 0, ?, 'test')`).run(recente.id, pk('u'), NOW - 100 * DAY)

    await ingest(p, velho, recente, s) // cliente A viu o post antigo
    anchorU()
    await settle()
    const A = row(p.id)!.score_base

    await freshDb()
    await ingest(p, recente, s) // cliente B nunca recebeu o antigo
    anchorU()
    await settle()
    expect(row(p.id)!.score_base).toBe(A)
    expect(A).toBeCloseTo(weeksAtEpoch(NOW - 100 * DAY), 9)
  })

  it('peso acompanha o tempo: virada de dia re-deriva a antiguidade sem evento novo', async () => {
    await veteran('u', 7) // 1 semana
    const p = post('autor', NOW)
    await ingest(p, spread('u', p.id, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBeCloseTo(weeksAtEpoch(NOW - 7 * DAY), 9)
    vi.setSystemTime((NOW + 70 * DAY) * 1000)
    await recalcAllScores()
    expect(row(p.id)!.score_base).toBeCloseTo(weeksAtEpoch(NOW - 7 * DAY, NOW + 70 * DAY), 9)
    expect(row(p.id)!.score_base).toBeGreaterThan(10)
  })
})

// ════════════════════════════════════════════════════════════════════
// 4. MODERAÇÃO (§26) — derivada, não gravada
// ════════════════════════════════════════════════════════════════════
describe('4. Moderação comunitária', () => {
  it('7 veteranos (0.8 pt cada = 5.6 ≥ 5) escondem o post', async () => {
    for (let i = 0; i < 7; i++) await veteran(`r${i}`)
    const p = post('autor', NOW)
    await ingest(p)
    for (let i = 0; i < 7; i++) await ingest(report(`r${i}`, p.id, NOW))
    await settle()
    expect(row(p.id)!.score).toBe(-999)
    expect(await feedIds()).not.toContain(p.id)
  })

  it('6 veteranos (4.8) não bastam', async () => {
    for (let i = 0; i < 6; i++) await veteran(`r${i}`)
    const p = post('autor', NOW)
    await ingest(p)
    for (let i = 0; i < 6; i++) await ingest(report(`r${i}`, p.id, NOW))
    await settle()
    expect(row(p.id)!.score).not.toBe(-999)
  })

  it('brigada de 50 chaves novas (inclusive "illegal") não derruba nada — report de peso 0 vale 0', async () => {
    const p = post('autor', NOW)
    await ingest(p)
    for (let i = 0; i < 50; i++) await ingest(report(`x${i}`, p.id, NOW, 'illegal'))
    await settle()
    expect(row(p.id)!.score).not.toBe(-999)
  })

  it('post moderado CONTINUA moderado quando chega spread novo', async () => {
    for (let i = 0; i < 7; i++) await veteran(`r${i}`)
    await veteran('fã')
    const p = post('autor', NOW)
    await ingest(p)
    for (let i = 0; i < 7; i++) await ingest(report(`r${i}`, p.id, NOW))
    await settle()
    await ingest(spread('fã', p.id, NOW + 60))
    await settle()
    expect(row(p.id)!.score).toBe(-999)
    expect(await feedIds()).not.toContain(p.id)
  })

  it('reports que chegam junto com o post (rajada de boot) moderam do mesmo jeito', async () => {
    for (let i = 0; i < 7; i++) await veteran(`r${i}`)
    const p = post('autor', NOW)
    await ingest(p, ...Array.from({ length: 7 }, (_, i) => report(`r${i}`, p.id, NOW)))
    await settle()
    expect(row(p.id)!.score).toBe(-999)
  })

  it('"illegal" tem threshold 3: 4 veteranos (3.2) bastam', async () => {
    for (let i = 0; i < 4; i++) await veteran(`r${i}`)
    const p = post('autor', NOW)
    await ingest(p, ...Array.from({ length: 4 }, (_, i) => report(`r${i}`, p.id, NOW, 'illegal')))
    await settle()
    expect(row(p.id)!.score).toBe(-999)
  })

  it('post moderado custa −15 de peso ao autor', async () => {
    await veteran('autor')
    for (let i = 0; i < 6; i++) await veteran(`fan${i}`)
    for (let i = 0; i < 7; i++) await veteran(`r${i}`)
    const p1 = post('autor', NOW - HOUR)
    await ingest(p1)
    for (let i = 0; i < 6; i++) await ingest(spread(`fan${i}`, p1.id, NOW - HOUR)) // +6×4 = 24
    await settle()
    const antes = weightOf('autor')
    const p2 = post('autor', NOW)
    await ingest(p2, ...Array.from({ length: 7 }, (_, i) => report(`r${i}`, p2.id, NOW)))
    await settle()
    expect(antes).toBeCloseTo(40 + 24, 6)
    expect(weightOf('autor')).toBeCloseTo(40 + 24 - 15, 6)
  })

  it('brigada de BURY pesada não é confundida com moderação (score ≠ sentinela)', async () => {
    const p = post('autor', NOW - 100 * HOUR)
    await ingest(p)
    for (let i = 0; i < 40; i++) {
      await veteran(`b${i}`)
      await ingest(bury(`b${i}`, p.id, NOW))
    }
    await settle()
    expect(row(p.id)!.score).toBeGreaterThan(-999)
  })

  it('auto-report do autor não conta', async () => {
    await veteran('autor', 400)
    const p = post('autor', NOW)
    await ingest(p, report('autor', p.id, NOW, 'illegal'))
    await settle()
    expect(row(p.id)!.score).not.toBe(-999)
  })
})

// ════════════════════════════════════════════════════════════════════
// 5. PROPAGAÇÃO NA REDE
// ════════════════════════════════════════════════════════════════════
describe('5. Propagação', () => {
  it('assinatura global: kinds Drift + comentários em posts Drift + provas OTS de eventos Drift', async () => {
    const { startSync, stopSync } = await import('../src/lib/sync')
    await startSync()
    const filters = H.subscribed.map((s) => s.filter)
    expect(filters[0]).toMatchObject({ kinds: [9078, 9079, 9080, 9081], limit: 500 })
    expect(filters[1]).toMatchObject({ kinds: [1111], '#K': ['9078'] })
    expect(filters[2]).toMatchObject({ kinds: [1040], '#k': ['9078', '9079', '9080', '9081', '1111'] })
    for (const f of filters) expect(f).not.toHaveProperty('authors')
    await stopSync()
  })

  it('cursor nunca passa do presente (evento do futuro não envenena o sync)', () => {
    expect(advanceCursor(NOW - 10, NOW + 365 * DAY, NOW * 1000)).toBe(NOW)
    expect(advanceCursor(NOW - 10, NOW - 5, NOW * 1000)).toBe(NOW - 5)
    expect(advanceCursor(NOW - 10, Number.NaN, NOW * 1000)).toBe(NOW - 10)
  })

  it('banco com cursor já envenenado é curado no boot', async () => {
    H.conn!.prepare(`INSERT INTO sync_log (relay, namespace, last_since) VALUES ('*', 'global', ?)`).run(NOW + 365 * DAY)
    const { startSync, stopSync } = await import('../src/lib/sync')
    await startSync()
    expect(H.subscribed.at(-3)!.filter.since).toBeLessThanOrEqual(NOW)
    await stopSync()
  })

  it('spread de post que não temos dispara busca do post por id', async () => {
    await veteran('v')
    const orfao = post('autor', NOW - 30 * DAY)
    await ingest(spread('v', orfao.id, NOW))
    await settle()
    const req = H.subscribed.find((s) => Array.isArray(s.filter.ids))
    expect(req?.filter.ids).toContain(orfao.id)
    // Post chega pela busca → entra no ranking com o voto já existente.
    req!.onevent(orfao)
    await new Promise((r) => setTimeout(r, 20))
    await settle()
    expect(row(orfao.id)!.score_base).toBe(40)
  })

  it('autores ativos sem âncora disparam busca das provas OTS publicadas por eles', async () => {
    await ingest(post('semancora', NOW))
    await settle()
    const req = H.subscribed.find((s) => Array.isArray(s.filter.authors))
    expect(req?.filter).toMatchObject({ kinds: [1040] })
    expect(req?.filter.authors).toContain(pk('semancora'))
  })

  it('rebroadcast publica os votos mesmo pra quem tem centenas de posts', async () => {
    const outro = post('outro', NOW - DAY)
    await ingest(outro)
    for (let i = 0; i < 210; i++) await ingest(post('eu', NOW - DAY + i))
    const meuSpread = spread('eu', outro.id, NOW)
    await ingest(meuSpread)
    const { rebroadcastToRelay } = await import('../src/lib/rebroadcast')
    vi.useRealTimers()
    const res = await rebroadcastToRelay('wss://novo', pk('eu'))
    expect(res.sent).toBe(212) // 210 posts + 1 spread + post espalhado
    expect(H.published[0]!.event.id).toBe(meuSpread.id) // votos primeiro
  }, 20_000)
})

// ════════════════════════════════════════════════════════════════════
// 6. OPENTIMESTAMPS (NIP-03) — âncora no Bitcoin
// ════════════════════════════════════════════════════════════════════
describe('6. Âncora OpenTimestamps', () => {
  // Prova REAL do projeto opentimestamps-client: sha256(hello-world.txt)
  // ancorado no bloco Bitcoin 358391 (2015-05-28).
  const proof = new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots')))
  const digestHex = bytesToHex(parseOtsFile(proof).digest)
  const realHeader = async (h: number) => {
    expect(h).toBe(358391)
    return { merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', time: 1432827678 }
  }
  const proofEvent = () => ev(1040, 'qualquer', NOW, [['e', digestHex], ['k', '9078']], bytesToBase64(proof))

  it('prova verificada contra o Bitcoin vira âncora → antiguidade máxima → spread vale 40', async () => {
    await ingest(proofEvent())
    const n = await verifyPendingProofs({ getHeader: realHeader, resolveAuthor: async () => pk('antigo') })
    expect(n).toBe(1)
    expect(H.conn!.prepare('SELECT block_time FROM ots_anchors WHERE author_pub = ?').get(pk('antigo'))).toEqual({
      block_time: 1432827678,
    })
    const p = post('autor', NOW)
    await ingest(p, spread('antigo', p.id, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBe(40)
  })

  it('merkle root que não confere → prova inválida, sem âncora, peso 0', async () => {
    await ingest(proofEvent())
    await verifyPendingProofs({
      getHeader: async () => ({ merkleRoot: '00'.repeat(32), time: 1432827678 }),
      resolveAuthor: async () => pk('antigo'),
    })
    expect(H.conn!.prepare(`SELECT status FROM ots_proofs`).get()).toEqual({ status: 'invalid' })
    expect(H.conn!.prepare('SELECT COUNT(*) n FROM ots_anchors').get()).toEqual({ n: 0 })
  })

  it('prova de OUTRO digest (atacante cola prova alheia no seu evento) não ancora', async () => {
    const e = ev(1040, 'x', NOW, [['e', hex(424242)], ['k', '9078']], bytesToBase64(proof))
    await ingest(e)
    await verifyPendingProofs({ getHeader: realHeader, resolveAuthor: async () => pk('atacante') })
    expect(H.conn!.prepare('SELECT COUNT(*) n FROM ots_anchors').get()).toEqual({ n: 0 })
  })

  it('falha de rede mantém a prova pendente (não confunde "não deu pra checar" com "inválida")', async () => {
    await ingest(proofEvent())
    await verifyPendingProofs({
      getHeader: async () => {
        throw new Error('offline')
      },
      resolveAuthor: async () => pk('antigo'),
    })
    expect(H.conn!.prepare(`SELECT status FROM ots_proofs`).get()).toEqual({ status: 'pending' })
  })

  it('carimbador: carimba o evento mais antigo, espera o Bitcoin, publica kind 1040 só com attestation Bitcoin', async () => {
    const meu = post('eu', NOW - DAY)
    await ingest(meu, post('eu', NOW))
    const published: Array<{ kind: number; tags: string[][]; content: string }> = []
    const pending = newOtsFile(new Uint8Array(32))
    pending.timestamp = { attestations: [{ type: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' }], ops: [] }
    let stampedDigest = ''
    const deps = {
      enabled: true,
      stamp: async (d: Uint8Array) => {
        stampedDigest = bytesToHex(d)
        return { ...pending, digest: d }
      },
      upgrade: async (f: ReturnType<typeof newOtsFile>) => ({ file: f, changed: false }),
      publishProof: async (i: { kind: number; tags: string[][]; content: string }) => {
        published.push(i)
      },
    }
    expect(await ensureOwnAnchor(pk('eu'), deps)).toBe('stamped')
    expect(stampedDigest).toBe(meu.id)
    vi.setSystemTime((NOW + 2 * HOUR) * 1000)
    expect(await ensureOwnAnchor(pk('eu'), deps)).toBe('waiting') // calendário ainda pending
    expect(published).toHaveLength(0)

    vi.setSystemTime((NOW + 4 * HOUR) * 1000)
    const confirmed = { ...deps, upgrade: async (f: ReturnType<typeof newOtsFile>) => ({
      file: { ...f, timestamp: { attestations: [...f.timestamp.attestations, { type: 'bitcoin' as const, height: 900000 }], ops: [] } },
      changed: true,
    }) }
    expect(await ensureOwnAnchor(pk('eu'), confirmed)).toBe('published')
    expect(published[0]!.kind).toBe(1040)
    expect(published[0]!.tags).toEqual([['e', meu.id], ['k', '9078']])
    const leaves = parseOtsFile(Uint8Array.from(Buffer.from(published[0]!.content, 'base64'))).timestamp.attestations
    expect(leaves.every((a) => a.type === 'bitcoin')).toBe(true) // NIP-03: sem pending
  })

  it('carimbador desligado (Tor / pref off) não contata ninguém', async () => {
    await ingest(post('eu', NOW))
    let called = false
    const r = await ensureOwnAnchor(pk('eu'), {
      enabled: false,
      stamp: async () => {
        called = true
        throw new Error('não devia')
      },
    })
    expect(r).toBe('disabled')
    expect(called).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════
// 7. CASCATA (mapa) e 8. TRUST LENS
// ════════════════════════════════════════════════════════════════════
describe('7. Cascata inferida', () => {
  const norm = (t: number) => t
  it('arco origem→spreader é literal, spreader→spreader é inferred', () => {
    const arcs = inferCascadeTree({ lng: 0, lat: 0, ts: 0 }, [
      { lng: 1, lat: 0, ts: 10 },
      { lng: 2, lat: 0, ts: 20 },
    ], norm)
    expect(arcs[0]!.inferred).toBe(false)
    expect(arcs[1]!.inferred).toBe(true)
  })

  it('determinística', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ lng: (i * 37) % 90, lat: (i * 13) % 40, ts: i * 100 }))
    expect(inferCascadeTree(null, nodes, norm)).toEqual(inferCascadeTree(null, nodes, norm))
  })

  it('antimeridiano: Samoa (−179°) liga em Fiji (179°), não num ponto a 39° de distância', () => {
    const arcs = inferCascadeTree({ lng: 179, lat: -17, ts: 0 }, [
      { lng: 140, lat: -17, ts: 50 },
      { lng: -179, lat: -14, ts: 100 },
    ], norm)
    expect(arcs[1]!.from).toEqual([179, -17])
  })
})

describe('8. Trust Lens', () => {
  it('strength 0 → multiplicador 1.0 exato (feed canônico intacto)', () => {
    expect(viewMultiplier({ pprScore: 0.5, mutualSpreadPost: 5, strength: 0 })).toBe(1)
  })

  it('PPR determinístico com mesma seed', () => {
    const graph = new Map([
      ['me', [{ target: 'a', influence: 0.8 }, { target: 'b', influence: 0.2 }]],
      ['a', [{ target: 'c', influence: 0.5 }]],
    ])
    const r1 = computePpr({ graph, source: 'me', rng: createPprRng('me', 1) })
    const r2 = computePpr({ graph, source: 'me', rng: createPprRng('me', 1) })
    expect([...r1]).toEqual([...r2])
  })

  it('FoF vazio σ(-2) ≈ 0.119; follow puro σ(-0.5) ≈ 0.378', () => {
    expect(computeInfluence({ v: 1, follow: 0, mutual_spread: 0, my_spread: 0, my_bury: 0 })).toBeCloseTo(0.119, 3)
    expect(computeInfluence({ v: 1, follow: 1, mutual_spread: 0, my_spread: 0, my_bury: 0 })).toBeCloseTo(0.378, 3)
  })
})
