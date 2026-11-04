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
import { maxPlausibleHeight, verifyPendingProofs } from '../src/lib/ots-anchors'
import { computeRanking, ENDORSE_BUDGET, type RankingInput } from '../src/lib/ranking'
import { getReportThreshold, getReportWeight } from '../src/lib/moderation'
import { ensureOwnAnchor } from '../src/lib/ots-stamper'
import { __resetOrphansForTest } from '../src/lib/orphans'
import { bytesToBase64, bytesToHex, newOtsFile, parseOtsFile, serializeOtsFile } from '../src/lib/ots'

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
// 3. ANTI-SYBIL (§22, §33)
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
    await veteran('u', 35) // 5 semanas (acima do mínimo de voto)
    const p = post('autor', NOW)
    await ingest(p, spread('u', p.id, NOW))
    await settle()
    expect(row(p.id)!.score_base).toBeCloseTo(weeksAtEpoch(NOW - 35 * DAY), 9)
    vi.setSystemTime((NOW + 70 * DAY) * 1000)
    await recalcAllScores()
    expect(row(p.id)!.score_base).toBeCloseTo(weeksAtEpoch(NOW - 35 * DAY, NOW + 70 * DAY), 9)
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

  it('carimbador: carimba o evento mais RECENTE, espera o Bitcoin, publica kind 1040 só com attestation Bitcoin', async () => {
    // Mais recente = o que os outros clientes já têm (sync de 7 dias): lá a
    // prova chega reconhecida como do próprio autor (revisão A17).
    const meu = post('eu', NOW)
    await ingest(post('eu', NOW - DAY), meu)
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

// ════════════════════════════════════════════════════════════════════
// 9. REVISÃO PRÉ-MERGE (2026-11-04) — ataques da revisão viram invariantes
// ════════════════════════════════════════════════════════════════════
//
// A primeira versão deste PR passava em todos os testes acima e ainda
// assim deixava uma única âncora de 1 dia "fabricar" chaves de peso 60
// sem limite (engajamento contado por post, sem orçamento). Os testes
// abaixo travam as PROPRIEDADES que fecham essa classe de ataque, não
// só os cenários específicos.
describe('9. Revisão pré-merge: amplificação, moderação fechada, DoS OTS', () => {
  const DAYS = (n: number) => n * DAY
  const base = (extra: Partial<RankingInput>): RankingInput => ({
    nowMs: NOW * 1000,
    posts: [],
    spreads: [],
    buries: [],
    comments: [],
    reports: [],
    users: [],
    anchors: new Map(),
    ...extra,
  })
  const act = (post_id: string, user_pub: string, i = 0) => ({ post_id, user_pub, created_at: NOW - 60, event_id: `${post_id}:${user_pub}:${i}` })

  it('anel de 12 chaves + 1 âncora de 1,5 dia: peso total do anel ≤ 2× a antiguidade real dele', () => {
    const ring = Array.from({ length: 12 }, (_, i) => `r${i}`)
    const posts = ring.flatMap((a) => Array.from({ length: 20 }, (_, k) => ({ id: `${a}-${k}`, author_pub: a, created_at: NOW - HOUR })))
    const spreads = ring.flatMap((s) => posts.filter((p) => p.author_pub !== s).map((p) => act(p.id, s)))
    const anchors = new Map([['r0', NOW - Math.round(1.5 * DAY)]])
    const out = computeRanking(base({ posts, spreads, anchors }))
    const total = ring.reduce((acc, n) => acc + (out.weights.get(n) ?? 0), 0)
    const seed = [...out.antiquity.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(seed / (1 - ENDORSE_BUDGET) + 1e-9)
    expect(Math.max(...ring.map((n) => out.weights.get(n) ?? 0))).toBeLessThan(1)
  })

  it('PROPRIEDADE (contração): em 40 grafos aleatórios, Σ pesos ≤ Σ antiguidade / (1 − ENDORSE_BUDGET)', () => {
    let seedR = 11
    const rnd = () => ((seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let trial = 0; trial < 40; trial++) {
      const n = 5 + Math.floor(rnd() * 25)
      const people = Array.from({ length: n }, (_, i) => `u${i}`)
      const posts = people.flatMap((a) => Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) => ({ id: `${a}-${k}`, author_pub: a, created_at: NOW - HOUR })))
      const spreads = []
      const comments = []
      for (let e = 0; e < n * 8; e++) {
        const who = people[Math.floor(rnd() * n)]!
        const p = posts[Math.floor(rnd() * posts.length)]!
        if (rnd() < 0.8) spreads.push(act(p.id, who, e))
        else comments.push({ post_id: p.id, author_pub: who, hidden: false })
      }
      const anchors = new Map<string, number>()
      for (const u of people) if (rnd() < 0.3) anchors.set(u, NOW - Math.floor(rnd() * 400) * DAY)
      const out = computeRanking(base({ posts, spreads, comments, anchors }))
      const total = [...out.weights.values()].reduce((a, b) => a + b, 0)
      const seed = [...out.antiquity.values()].reduce((a, b) => a + b, 0)
      expect(total, `trial ${trial}`).toBeLessThanOrEqual(seed / (1 - ENDORSE_BUDGET) + 1e-6)
    }
  })

  it('lavagem: 2 chaves (1 ancorada há 1,5 dia) não fabricam 50 chaves de peso relevante', () => {
    const A = 'A', B = 'B'
    const fresh = Array.from({ length: 50 }, (_, i) => `f${i}`)
    const posts = [A, B, ...fresh].flatMap((a) => Array.from({ length: 20 }, (_, k) => ({ id: `${a}-${k}`, author_pub: a, created_at: NOW - HOUR })))
    const spreads = [
      ...posts.filter((p) => p.author_pub === B).map((p) => act(p.id, A)),
      ...posts.filter((p) => p.author_pub === A).map((p) => act(p.id, B)),
      ...posts.filter((p) => fresh.includes(p.author_pub) && Number(p.id.split('-')[1]) < 10).map((p) => act(p.id, B)),
    ]
    const out = computeRanking(base({ posts, spreads, anchors: new Map([[A, NOW - Math.round(1.5 * DAY)]]) }))
    for (const f of fresh) expect(out.weights.get(f) ?? 0).toBeLessThan(0.05)
  })

  it('confiança de um veterano é DILUÍDA entre quem ele endossa, com teto por aresta', () => {
    const v = 'vet'
    const novatos = Array.from({ length: 20 }, (_, i) => `n${i}`)
    const posts = novatos.map((a) => ({ id: `${a}-0`, author_pub: a, created_at: NOW - HOUR }))
    const spreads = posts.map((p) => act(p.id, v))
    const out = computeRanking(base({ posts, spreads, anchors: new Map([[v, NOW - DAYS(400)]]) }))
    // Orçamento 0.5 × 40 = 20 pontos divididos por 20 → 1 ponto cada (teto da aresta = 4).
    for (const nv of novatos) expect(out.weights.get(nv)).toBeCloseTo(1, 9)
    const one = computeRanking(base({ posts: posts.slice(0, 1), spreads: spreads.slice(0, 1), anchors: new Map([[v, NOW - DAYS(400)]]) }))
    expect(one.weights.get('n0')).toBeCloseTo(4, 9) // 1 só endossado: teto = 10 × 40/100
  })

  it('penalidade de moderação morde mesmo com engajamento saturado (−15 depois do teto)', () => {
    const fans = Array.from({ length: 30 }, (_, i) => `fan${i}`)
    const reps = Array.from({ length: 7 }, (_, i) => `rep${i}`)
    const anchors = new Map<string, number>([['alvo', NOW - DAYS(400)], ...[...fans, ...reps].map((f) => [f, NOW - DAYS(400)] as [string, number])])
    const posts = [{ id: 'bom', author_pub: 'alvo', created_at: NOW - HOUR }, { id: 'ruim', author_pub: 'alvo', created_at: NOW - HOUR }]
    const spreads = fans.map((f) => act('bom', f)) // 30 × 4 = 120 → satura em 60
    const sem = computeRanking(base({ posts, spreads, anchors }))
    const com = computeRanking(base({ posts, spreads, anchors, reports: reps.map((r) => ({ post_id: 'ruim', reporter_pub: r, reason: 'spam', created_at: NOW })) }))
    expect(sem.weights.get('alvo')).toBe(100)
    expect(com.posts.get('ruim')!.moderated).toBe(true)
    expect(com.weights.get('alvo')).toBe(85)
  })

  it('PROPRIEDADE (moderação sustentada): todo post moderado está acima do threshold com os pesos FINAIS', () => {
    // Semântica conservadora (revisões A8/A19): um post só é moderado se
    // resiste às penalidades de todos os candidatos. Logo, com os pesos
    // finais (≥ pior caso), continua acima do threshold. O inverso
    // ("fechada") NÃO é garantido de propósito: em ataque simétrico o
    // motor prefere não moderar.
    let seedR = 5
    const rnd = () => ((seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let trial = 0; trial < 40; trial++) {
      const people = Array.from({ length: 16 }, (_, i) => `p${i}`)
      const posts = people.flatMap((a) => [0, 1].map((k) => ({ id: `${a}-${k}`, author_pub: a, created_at: NOW - HOUR })))
      const spreads = Array.from({ length: 60 }, (_, e) => act(posts[Math.floor(rnd() * posts.length)]!.id, people[Math.floor(rnd() * 16)]!, e))
      const reports = Array.from({ length: 40 }, () => ({
        post_id: posts[Math.floor(rnd() * posts.length)]!.id,
        reporter_pub: people[Math.floor(rnd() * 16)]!,
        reason: (rnd() < 0.5 ? 'spam' : 'illegal') as 'spam' | 'illegal',
        created_at: NOW,
      }))
      const anchors = new Map(people.map((u) => [u, NOW - Math.floor(rnd() * 300) * DAY] as [string, number]))
      const out = computeRanking(base({ posts, spreads, reports, anchors, users: people.map((npub) => ({ npub, last_active: NOW })) }))
      for (const p of posts) {
        const by: Record<string, number> = { spam: 0, illegal: 0, harassment: 0 }
        const seen = new Set<string>()
        for (const r of reports) {
          if (r.post_id !== p.id || r.reporter_pub === p.author_pub || seen.has(r.reporter_pub)) continue
          seen.add(r.reporter_pub) // UNIQUE(post, reporter) no banco
          by[r.reason] +=
            (out.antiquity.get(r.reporter_pub) ?? 0) >= 8 ? getReportWeight(out.weights.get(r.reporter_pub) ?? 0) : 0
        }
        const total = by.spam + by.illegal + by.harassment
        const above =
          by.illegal >= getReportThreshold(out.activeUsers, 'illegal') ||
          by.spam >= getReportThreshold(out.activeUsers, 'spam') ||
          total >= getReportThreshold(out.activeUsers, 'spam')
        if (out.posts.get(p.id)!.moderated) expect(above, `trial ${trial} post ${p.id}`).toBe(true)
      }
    }
  })

  it('10k chaves de peso 0 não sobem o threshold de moderação (base ativa ponderada)', () => {
    const users = Array.from({ length: 10_000 }, (_, i) => ({ npub: `z${i}`, last_active: NOW }))
    const out = computeRanking(base({ users }))
    expect(out.activeUsers).toBe(0)
    expect(getReportThreshold(out.activeUsers, 'spam')).toBe(5)
  })

  it('decay de report (opt-in) não desfaz a moderação na virada do dia', () => {
    const reps = Array.from({ length: 7 }, (_, i) => `rep${i}`)
    const anchors = new Map(reps.map((r) => [r, NOW - DAYS(400)] as [string, number]))
    const input = (nowMs: number) =>
      base({
        nowMs,
        posts: [{ id: 'P', author_pub: 'autor', created_at: NOW - HOUR }],
        reports: reps.map((r, i) => ({ post_id: 'P', reporter_pub: r, reason: 'spam', created_at: NOW - i * 60 })),
        anchors,
        moderation: { reportDecayHalfLifeMs: 48 * 3600 * 1000 },
      })
    expect(computeRanking(input(NOW * 1000)).posts.get('P')!.moderated).toBe(true)
    expect(computeRanking(input((NOW + 3 * DAY) * 1000)).posts.get('P')!.moderated).toBe(true)
  })

  it('brigada de bury pesada num post NOVO não atravessa o sentinela (piso −998)', () => {
    const buriers = Array.from({ length: 300 }, (_, i) => `b${i}`) // 300 × 40 × 0.3 = 3600
    const anchors = new Map(buriers.map((b) => [b, NOW - DAYS(400)] as [string, number]))
    const out = computeRanking(base({
      posts: [{ id: 'P', author_pub: 'autor', created_at: NOW }],
      buries: buriers.map((b) => act('P', b)),
      anchors,
    }))
    const p = out.posts.get('P')!
    expect(p.scoreBase).toBeLessThan(-999 * Math.pow(2, 1.5)) // sem piso, o score cruzaria −999
    expect(p.moderated).toBe(false)
    expect(p.score).toBeGreaterThan(-999)
  })

  it('o scheduler recomputa sozinho (sem chamada explícita) e não perde a rodada', async () => {
    await veteran('v')
    const p = post('autor', NOW)
    await ingest(p, spread('v', p.id, NOW))
    await new Promise((r) => setTimeout(r, 400)) // debounce 100ms + recomputação
    expect(row(p.id)!.score_base).toBe(40)
  })

  // ── Fila de verificação OTS ──────────────────────────────────────
  const realHeaderFor358391 = async (h: number) =>
    h === 358391
      ? { merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', time: 1432827678 }
      : { merkleRoot: '00'.repeat(32), time: 1 }
  const proofOf = (heights: number[]) => {
    const f = newOtsFile(new Uint8Array(32).fill(7))
    f.timestamp = { attestations: heights.map((height) => ({ type: 'bitcoin' as const, height })), ops: [] }
    return bytesToBase64(serializeOtsFile(f))
  }
  const proofEv = (target: string, content: string, id?: string) => {
    const e = ev(1040, 'qualquer', NOW, [['e', target], ['k', '9078']], content)
    if (id) e.id = id
    return e
  }
  const status = (id: string) => (H.conn!.prepare('SELECT status FROM ots_proofs WHERE proof_event_id = ?').get(id) as { status: string } | undefined)?.status

  it('prova com mais de 4 attestations Bitcoin é inválida SEM consultar explorador', async () => {
    const e = proofEv(hex(77), proofOf([800001, 800002, 800003, 800004, 800005]))
    await ingest(e)
    let calls = 0
    await verifyPendingProofs({ getHeader: async () => (calls++, { merkleRoot: '00'.repeat(32), time: 1 }), resolveAuthor: async () => pk('x') })
    expect(status(e.id)).toBe('invalid')
    expect(calls).toBe(0)
  })

  it('altura de bloco impossível (acima do topo plausível) é inválida sem consulta', async () => {
    const e = proofEv(hex(78), proofOf([maxPlausibleHeight(NOW * 1000) + 1]))
    await ingest(e)
    let calls = 0
    await verifyPendingProofs({ getHeader: async () => (calls++, { merkleRoot: '00'.repeat(32), time: 1 }), resolveAuthor: async () => pk('x') })
    expect(status(e.id)).toBe('invalid')
    expect(calls).toBe(0)
  })

  it('falha transitória: backoff exponencial com teto, sem desistência (queda longa não mata prova)', async () => {
    const proof = new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots')))
    const digest = bytesToHex(parseOtsFile(proof).digest)
    const e = proofEv(digest, bytesToBase64(proof))
    await ingest(e)
    let calls = 0
    const down = async () => {
      calls++
      throw new Error('explorador fora')
    }
    let t = NOW * 1000
    await verifyPendingProofs({ nowMs: t, getHeader: down, resolveAuthor: async () => pk('x') })
    await verifyPendingProofs({ nowMs: t + 60_000, getHeader: down, resolveAuthor: async () => pk('x') })
    expect(calls).toBe(1) // dentro do backoff não re-tenta
    for (let i = 0; i < 15; i++) {
      t += 11 * 3600 * 1000 // > teto do backoff (~10,7 h)
      await verifyPendingProofs({ nowMs: t, getHeader: down, resolveAuthor: async () => pk('x') })
    }
    expect(status(e.id)).toBe('pending') // nunca desiste
    // Explorador volta → verifica.
    await verifyPendingProofs({ nowMs: t + 12 * 3600 * 1000, getHeader: realHeaderFor358391, resolveAuthor: async () => pk('x') })
    expect(status(e.id)).toBe('verified')
  })

  it('modo Tor/offline: nenhuma tentativa é queimada', async () => {
    const e = proofEv(hex(81), proofOf([800001]))
    await ingest(e)
    await verifyPendingProofs({ networkAllowed: false })
    expect(H.conn!.prepare('SELECT attempts, checked_at FROM ots_proofs WHERE proof_event_id = ?').get(e.id)).toEqual({ attempts: 0, checked_at: null })
  })

  it('ordem justa: 60 provas-lixo com id "000…" não impedem a prova honesta de ser verificada', async () => {
    for (let i = 0; i < 60; i++) await ingest(proofEv(hex(1000 + i), proofOf([800001]), '000' + hex(1000 + i).slice(3)))
    const proof = new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots')))
    const digest = bytesToHex(parseOtsFile(proof).digest)
    const honest = { ...proofEv(digest, bytesToBase64(proof), 'f'.repeat(64)), pubkey: pk('honesto') }
    await ingest(honest)
    await verifyPendingProofs({
      getHeader: async (h) =>
        h === 358391
          ? { merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', time: 1432827678 }
          : { merkleRoot: '00'.repeat(32), time: 1 },
      resolveAuthor: async (id) => (id === digest ? pk('honesto') : null),
    })
    expect(status(honest.id)).toBe('verified')
  })

  it('no máximo 3 provas guardadas por evento carimbado', async () => {
    const target = hex(80)
    for (let i = 0; i < 5; i++) await ingest(proofEv(target, proofOf([800001 + i])))
    expect(H.conn!.prepare('SELECT COUNT(*) n FROM ots_proofs WHERE target_event_id = ?').get(target)).toEqual({ n: 3 })
  })

  it('só ots-anchors.ts (verificação) e o dev-seed gravam em ots_anchors', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f)
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
      })
    const writers = walk(join(ROOT, 'src'))
      .filter((f) => /INSERT[^`]*INTO\s+ots_anchors|UPDATE\s+ots_anchors/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))
      .sort()
    expect(writers).toEqual(['src/lib/dev-seed/seed.ts', 'src/lib/ots-anchors.ts'])
  })
})

// ════════════════════════════════════════════════════════════════════
// 10. SEGUNDA RODADA DE REVISÃO (2026-11-04) — ataques aos próprios fixes
// ════════════════════════════════════════════════════════════════════
describe('10. Segunda rodada: elegibilidade, moderação histórica, admissão OTS', () => {
  const base = (extra: Partial<RankingInput>): RankingInput => ({
    nowMs: NOW * 1000,
    posts: [],
    spreads: [],
    buries: [],
    comments: [],
    reports: [],
    users: [],
    anchors: new Map(),
    ...extra,
  })
  const act = (post_id: string, user_pub: string, t = NOW - 60) => ({ post_id, user_pub, created_at: t, event_id: `${post_id}:${user_pub}` })
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

  it('A7: 1200 chaves ancoradas há 1 dia não moderam nada (report exige peso ≥ 20)', () => {
    const keys = ids('k', 1200)
    const out = computeRanking(base({
      posts: [{ id: 'P', author_pub: 'vet', created_at: NOW - HOUR }],
      reports: keys.map((k) => ({ post_id: 'P', reporter_pub: k, reason: 'illegal', created_at: NOW })),
      anchors: new Map([['vet', NOW - 300 * DAY], ...keys.map((k) => [k, NOW - DAY] as [string, number])]),
      users: keys.map((npub) => ({ npub, last_active: NOW })),
    }))
    expect(out.posts.get('P')!.moderated).toBe(false)
  })

  it('A7: 10k chaves de 1 semana não movem o score (voto exige peso ≥ 4)', () => {
    const keys = ids('k', 10_000)
    const out = computeRanking(base({
      posts: [{ id: 'P', author_pub: 'a', created_at: NOW - HOUR }],
      spreads: keys.map((k) => act('P', k)),
      anchors: new Map(keys.map((k) => [k, NOW - 7 * DAY] as [string, number])),
    }))
    expect(out.posts.get('P')!.scoreBase).toBe(0)
  })

  // Cenário do A8: o spammer x (peso 100) tem 4 spams denunciados por
  // honestos; depois x + 2 cúmplices denunciam um post honesto Q.
  const a8 = (qFirst: boolean) => {
    const fans = ids('fan', 20)
    const honest = ids('h', 5)
    const accomplices = ['c1', 'c2']
    const anchors = new Map<string, number>(
      ['x', 'autorQ', ...fans, ...honest, ...accomplices].map((n) => [n, NOW - 400 * DAY] as [string, number]),
    )
    const posts = [
      { id: 'xpost', author_pub: 'x', created_at: NOW - DAY },
      ...[1, 2, 3, 4].map((i) => ({ id: `S${i}`, author_pub: 'x', created_at: NOW - DAY })),
      { id: 'Q', author_pub: 'autorQ', created_at: NOW - DAY },
    ]
    const spreads = fans.map((f) => act('xpost', f)) // x: 40 + 60 = 100
    const tSpam = qFirst ? NOW - 100 : NOW - 1000
    const tQ = qFirst ? NOW - 1000 : NOW - 100
    const reports = [
      ...[1, 2, 3, 4].flatMap((i) => honest.map((h) => ({ post_id: `S${i}`, reporter_pub: h, reason: 'illegal' as const, created_at: tSpam }))),
      ...['x', ...accomplices].map((r) => ({ post_id: 'Q', reporter_pub: r, reason: 'illegal' as const, created_at: tQ })),
    ]
    return computeRanking(base({ posts, spreads, reports, anchors }))
  }

  it('A8: spammer já punido NÃO derruba post honesto com peso cheio (penalidade vale antes da denúncia seguinte)', () => {
    const out = a8(false)
    for (const i of [1, 2, 3, 4]) expect(out.posts.get(`S${i}`)!.moderated).toBe(true)
    expect(out.weights.get('x')).toBe(40) // 60 − 4×15 → 0 de engajamento
    expect(out.posts.get('Q')!.moderated).toBe(false) // 0,8 + 2×0,8 = 2,4 < 3
  })

  it('A19: o resultado NÃO depende dos timestamps dos reports (atacante não escolhe a ordem)', () => {
    // Antes, com ordem histórica, retrodatar os reports de x em Q fazia Q
    // ser avaliado antes da punição de x — e moderado.
    const a = a8(false)
    const b = a8(true)
    for (const id of ['S1', 'S2', 'S3', 'S4', 'Q']) expect(b.posts.get(id)!.moderated).toBe(a.posts.get(id)!.moderated)
    expect(b.posts.get('Q')!.moderated).toBe(false)
  })

  it('A18: chaves abaixo do piso não endossam — 4700 chaves de 1 dia não fabricam concentrador', () => {
    const keys = ids('k', 4700)
    const out = computeRanking(base({
      posts: [{ id: 'cpost', author_pub: 'C', created_at: NOW - HOUR }],
      spreads: keys.map((k) => act('cpost', k)),
      anchors: new Map([['C', NOW - DAY], ...keys.map((k) => [k, NOW - DAY] as [string, number])]),
    }))
    expect(out.weights.get('C')!).toBeLessThan(1)
  })

  it('A18: denunciar exige 8 semanas de âncora própria, mesmo com peso alto vindo de endosso', () => {
    const fans = ids('fan', 30)
    const anchors = new Map<string, number>([
      ['novo', NOW - 14 * DAY], // 2 semanas, mas muito endossado → peso ~62
      ...fans.map((f) => [f, NOW - 400 * DAY] as [string, number]),
      ...ids('r', 3).map((r) => [r, NOW - 400 * DAY] as [string, number]),
    ])
    const posts = [{ id: 'np', author_pub: 'novo', created_at: NOW - HOUR }, { id: 'P', author_pub: 'alvo', created_at: NOW - HOUR }]
    const spreads = fans.map((f) => act('np', f))
    // 3 veteranos (0,8) = 2,4 < 3; com 'novo' (peso ~62 → 1,2) daria 3,6.
    const reports = ['novo', 'r0', 'r1', 'r2'].map((r) => ({ post_id: 'P', reporter_pub: r, reason: 'illegal' as const, created_at: NOW }))
    const out = computeRanking(base({ posts, spreads, reports, anchors }))
    expect(out.weights.get('novo')!).toBeGreaterThan(50)
    expect(out.posts.get('P')!.moderated).toBe(false)
  })

  it('A9: com decay ligado, report de peso 0 chegando agora não desfaz moderação antiga', () => {
    const reps = ids('rep', 7)
    const out = computeRanking(base({
      posts: [{ id: 'P', author_pub: 'autor', created_at: NOW - 11 * DAY }],
      reports: [
        ...reps.map((r) => ({ post_id: 'P', reporter_pub: r, reason: 'spam' as const, created_at: NOW - 10 * DAY })),
        { post_id: 'P', reporter_pub: 'nova', reason: 'spam' as const, created_at: NOW },
      ],
      anchors: new Map(reps.map((r) => [r, NOW - 400 * DAY] as [string, number])),
      moderation: { reportDecayHalfLifeMs: 48 * 3600 * 1000 },
    }))
    expect(out.posts.get('P')!.moderated).toBe(true)
  })

  const junk = (target: string, publisher: string, i: number) => ({
    ...ev(1040, publisher, NOW, [['e', target], ['k', '9078']], 'AAAA'),
    id: hex(500_000 + i),
  })
  const stored = (id: string) => H.conn!.prepare('SELECT COUNT(*) n FROM ots_proofs WHERE proof_event_id = ?').get(id) as { n: number }

  it('A11: 3 provas-lixo apontando pro evento da vítima não bloqueiam a prova DELA', async () => {
    const vitimaPost = post('vitima', NOW - HOUR)
    await ingest(vitimaPost)
    for (let i = 0; i < 3; i++) await ingest(junk(vitimaPost.id, 'atacante', i))
    const own = ev(1040, 'vitima', NOW, [['e', vitimaPost.id], ['k', '9078']], 'BBBB')
    await ingest(own)
    expect(stored(own.id).n).toBe(1)
    expect(H.conn!.prepare('SELECT self_proof FROM ots_proofs WHERE proof_event_id = ?').get(own.id)).toEqual({ self_proof: 1 })
  })

  it('A11: provas inválidas não contam no teto por alvo', async () => {
    const target = hex(91)
    for (let i = 0; i < 3; i++) await ingest(junk(target, `atk${i}`, i))
    H.conn!.prepare(`UPDATE ots_proofs SET status = 'invalid' WHERE target_event_id = ?`).run(target)
    const third = ev(1040, 'terceiro', NOW, [['e', target], ['k', '9078']], 'CCCC')
    await ingest(third)
    expect(stored(third.id).n).toBe(1)
  })

  it('A12: fila lotada de lixo despeja o pior em vez de recusar prova nova; prova do autor sempre entra', async () => {
    const ins = H.conn!.prepare(
      `INSERT INTO ots_proofs (proof_event_id, target_event_id, proof_b64, raw_event, publisher_pub, self_proof, status, attempts, checked_at)
       VALUES (?, ?, 'AAAA', '', ?, 0, 'pending', 3, ?)`,
    )
    for (let i = 0; i < 5000; i++) ins.run(hex(900_000 + i), hex(800_000 + i), `lixo${i % 300}`, NOW * 1000)
    const vitimaPost = post('vitima', NOW - HOUR)
    await ingest(vitimaPost)
    const own = ev(1040, 'vitima', NOW, [['e', vitimaPost.id], ['k', '9078']], 'BBBB')
    const third = ev(1040, 'terceiro', NOW, [['e', hex(92)], ['k', '9078']], 'CCCC')
    await ingest(own, third)
    expect(stored(own.id).n).toBe(1)
    expect(stored(third.id).n).toBe(1)
    const pending = H.conn!.prepare(`SELECT COUNT(*) n FROM ots_proofs WHERE status = 'pending'`).get() as { n: number }
    expect(pending.n).toBe(5000)
  })

  it('A12: no máximo 20 provas pendentes por publicador (exceto do próprio autor)', async () => {
    for (let i = 0; i < 30; i++) await ingest(junk(hex(700_000 + i), 'spammer', i))
    expect(H.conn!.prepare(`SELECT COUNT(*) n FROM ots_proofs WHERE publisher_pub = ?`).get(pk('spammer'))).toEqual({ n: 20 })
  })

  it('A14: prova inválida tem o conteúdo apagado (só a linha fica, pra dedup)', async () => {
    const e = junk(hex(93), 'atk', 1)
    await ingest(e)
    await verifyPendingProofs({ getHeader: async () => ({ merkleRoot: '00'.repeat(32), time: 1 }), resolveAuthor: async () => pk('x') })
    expect(H.conn!.prepare('SELECT status, proof_b64, raw_event FROM ots_proofs WHERE proof_event_id = ?').get(e.id)).toEqual({
      status: 'invalid',
      proof_b64: '',
      raw_event: '',
    })
  })

  it('A15: altura acima do topo real + 6 é inválida sem consultar header', async () => {
    const mk = (h: number) => {
      const f = newOtsFile(new Uint8Array(32).fill(9))
      f.timestamp = { attestations: [{ type: 'bitcoin' as const, height: h }], ops: [] }
      return bytesToBase64(serializeOtsFile(f))
    }
    const digest = bytesToHex(new Uint8Array(32).fill(9)) // = digest das provas → só a altura decide
    const above = ev(1040, 'p1', NOW, [['e', digest], ['k', '9078']], mk(900_007))
    const atTip = ev(1040, 'p2', NOW, [['e', digest], ['k', '9078']], mk(900_006))
    await ingest(above, atTip)
    const asked: number[] = []
    await verifyPendingProofs({
      getTipHeight: async () => 900_000,
      getHeader: async (h) => (asked.push(h), { merkleRoot: '00'.repeat(32), time: 1 }),
      resolveAuthor: async () => pk('x'),
    })
    expect(H.conn!.prepare('SELECT status FROM ots_proofs WHERE proof_event_id = ?').get(above.id)).toEqual({ status: 'invalid' })
    expect(asked).toEqual([900_006])
  })

  it('A17: orçamento de buscas na rede esgotado pula a prova SEM gastar tentativa', async () => {
    const proof = new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots')))
    const digest = bytesToHex(parseOtsFile(proof).digest) // alvo NÃO está no banco local
    const e = ev(1040, 'terceiro', NOW, [['e', digest], ['k', '9078']], bytesToBase64(proof))
    await ingest(e)
    let fetched = 0
    const header = async () => ({ merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', time: 1432827678 })
    await verifyPendingProofs({
      networkAllowed: true,
      networkLookupBudget: 0, // orçamento já esgotado
      fetchAuthor: async () => (fetched++, pk('x')),
      getTipHeight: async () => 900_000,
      getHeader: header,
    })
    expect(fetched).toBe(0)
    expect(H.conn!.prepare('SELECT status, attempts, checked_at FROM ots_proofs WHERE proof_event_id = ?').get(e.id)).toEqual({
      status: 'pending',
      attempts: 0,
      checked_at: null,
    })
    // Com orçamento, a mesma prova é verificada.
    await verifyPendingProofs({ networkAllowed: true, fetchAuthor: async () => pk('x'), getTipHeight: async () => 900_000, getHeader: header })
    expect(H.conn!.prepare('SELECT status FROM ots_proofs WHERE proof_event_id = ?').get(e.id)).toEqual({ status: 'verified' })
  })

  it('A22: só a melhor prova de cada autor guarda conteúdo', async () => {
    const proof = new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures/ots/hello-world.txt.ots')))
    const digest = bytesToHex(parseOtsFile(proof).digest)
    // Âncora já existente MAIS ANTIGA pro mesmo autor (outra prova).
    H.conn!.prepare(`INSERT INTO ots_anchors VALUES (?, ?, 1, ?, 'antiga')`).run(hex(96), pk('autorA22'), 1_300_000_000)
    const e = ev(1040, 'qualquer', NOW, [['e', digest], ['k', '9078']], bytesToBase64(proof))
    await ingest(e)
    await verifyPendingProofs({
      getTipHeight: async () => 900_000,
      getHeader: async () => ({ merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', time: 1432827678 }),
      resolveAuthor: async () => pk('autorA22'),
    })
    expect(H.conn!.prepare('SELECT status, proof_b64 FROM ots_proofs WHERE proof_event_id = ?').get(e.id)).toEqual({ status: 'verified', proof_b64: '' })
  })
})
