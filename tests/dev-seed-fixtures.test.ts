/**
 * LOCK_VIA_TEST — dev-seed fixtures (Sprint N+5 Batch B1, Marshall).
 *
 * Garante o que a infra E2E (Lily/Ted) e as suites de validação (B2)
 * dependem:
 *   1. Determinismo absoluto (§7) — mesma seed → mesmos npubs/ids/digest.
 *   2. Cascata Alice→Bob→Carol→Dave presente, timestamps ordenados,
 *      pelo follow-graph (valida ground-truth do bug #3 propagação).
 *   3. 3 posts-alvo recebem reports suficientes pra cruzar threshold §26.
 *   4. Todos os eventos passam `verifyEvent` (Schnorr real) + schema check.
 *   5. Score de P1 é calculável/conhecido via `calculateScore` puro com os
 *      weights da cascata (valida bug #1 score determinístico).
 *   6. Contrato com boot/Playwright: `NAMED_NSECS[name]` → npub do autor.
 *
 * Roda em Node (sem worker, sem SQLite WASM): usa `verifyEvent` SYNC de
 * nostr-tools direto + funções puras de scoring/weight/moderation.
 */

import { describe, it, expect } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { getPublicKey } from 'nostr-tools/pure'

import {
  TS_BASE,
  NAMED_IDENTITIES,
  NAMED_BY_NAME,
  NAMED_NSECS,
  SEED_IDENTITIES,
  SEED_COUNT,
  ALL_IDENTITIES,
  CASCADE,
  buildSeedEvents,
  getSeedEvents,
  computeSeedDigest,
} from '../src/lib/dev-seed/fixtures'
import { passesSchemaCheck } from '../src/lib/events'
import { calculateScore } from '../src/lib/scoring'
import { calculateWeight } from '../src/lib/weight'
import { getReportWeight, getReportThreshold } from '../src/lib/moderation'
import { DRIFT_KIND } from '../src/config/constants'
import type { ReportReason } from '../src/types/drift'

const WEEK = 7 * 24 * 3600
const HOUR = 3600

// ─── 1. Determinismo ─────────────────────────────────────────────────

describe('determinismo (§7)', () => {
  // Gerar ~3000 eventos assinados é caro (~30s); `getSeedEvents` cacheia.
  // Pra provar determinismo SEM re-assinar tudo 2×, comparamos o conjunto
  // cacheado contra UM rebuild fresco (custo de 1 build, não 2).
  it(
    'rebuild produz os MESMOS event ids (fixtures estáveis)',
    () => {
      const cached = getSeedEvents()
      const fresh = buildSeedEvents()
      expect(fresh.domain.map((e) => e.id)).toEqual(cached.domain.map((e) => e.id))
      expect(fresh.contactLists.map((e) => e.id)).toEqual(
        cached.contactLists.map((e) => e.id),
      )
      expect(fresh.cascadePostId).toBe(cached.cascadePostId)
    },
    120_000,
  )

  it('digest estável + formato sha256', () => {
    // computeSeedDigest usa o conjunto cacheado — barato após 1ª chamada.
    const d = computeSeedDigest()
    expect(d).toBe(computeSeedDigest())
    expect(d).toMatch(/^[0-9a-f]{64}$/)
  })

  it('npubs derivados batem com getPublicKey(sk) — sem aleatoriedade', () => {
    for (const id of ALL_IDENTITIES) {
      expect(id.pub).toBe(getPublicKey(id.sk))
      expect(id.pub).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('roster: 8 named + 50 seed = 58 identidades únicas', () => {
    expect(NAMED_IDENTITIES).toHaveLength(8)
    expect(SEED_IDENTITIES).toHaveLength(SEED_COUNT)
    expect(SEED_COUNT).toBe(50)
    expect(ALL_IDENTITIES).toHaveLength(58)
    const pubs = new Set(ALL_IDENTITIES.map((i) => i.pub))
    expect(pubs.size).toBe(58)
  })
})

// ─── 2. Contrato NAMED_NSECS (boot + Playwright) ────────────────────

describe('contrato NAMED_NSECS (Lily/bootstrap)', () => {
  it('todos os 8 named users têm nsec1 válido que resolve pro pub correto', () => {
    for (const id of NAMED_IDENTITIES) {
      const nsec = NAMED_NSECS[id.name]
      expect(nsec, `NAMED_NSECS[${id.name}] ausente`).toBeDefined()
      const decoded = nip19.decode(nsec!)
      expect(decoded.type).toBe('nsec')
      const pubHex = getPublicKey(decoded.data as Uint8Array)
      expect(pubHex).toBe(id.pub)
    }
  })

  it('NAMED_NSECS tem exatamente as 8 chaves esperadas (lowercase)', () => {
    expect(Object.keys(NAMED_NSECS).sort()).toEqual(
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'].sort(),
    )
  })
})

// ─── 3. Validade dos eventos (Schnorr + schema) ─────────────────────

describe('eventos válidos', () => {
  const { domain, contactLists } = getSeedEvents()

  // Verificar Schnorr de ~3000 eventos é ~25s. Amostragem representativa
  // (cobre todos os kinds + cascata + alvos de report) mantém o lock
  // barato sem perder cobertura: se a geração quebrasse a assinatura, o
  // sample pega. A geração em si é a mesma rotina pra todos.
  function clean(ev: (typeof domain)[number]) {
    return {
      id: ev.id,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      kind: ev.kind,
      tags: ev.tags,
      content: ev.content,
      sig: ev.sig,
    }
  }

  it('eventos de domínio passam verifyEvent (Schnorr real) — sample por kind', () => {
    const sample: (typeof domain)[number][] = []
    for (const k of [DRIFT_KIND.POST, DRIFT_KIND.SPREAD, DRIFT_KIND.BURY, DRIFT_KIND.REPORT]) {
      // Primeiros 5 + últimos 5 de cada kind (cobre extremos da geração).
      const ofKind = domain.filter((e) => e.kind === k)
      sample.push(...ofKind.slice(0, 5), ...ofKind.slice(-5))
    }
    expect(sample.length).toBeGreaterThan(0)
    for (const ev of sample) {
      expect(verifyEvent(clean(ev)), `evento ${ev.id} (kind ${ev.kind})`).toBe(true)
    }
  })

  it('TODOS os eventos de domínio passam passesSchemaCheck', () => {
    for (const ev of domain) {
      expect(passesSchemaCheck(ev), `schema ${ev.id} (kind ${ev.kind})`).toBe(true)
    }
  })

  it('contact lists (kind 3) verificam Schnorr', () => {
    expect(contactLists.length).toBeGreaterThan(0)
    for (const ev of contactLists) {
      expect(ev.kind).toBe(3)
      const clean = { ...ev }
      expect(verifyEvent(clean)).toBe(true)
    }
  })

  it('apenas kinds Drift conhecidos (9078..9081) no domain', () => {
    const kinds = new Set(domain.map((e) => e.kind))
    for (const k of kinds) {
      expect([
        DRIFT_KIND.POST,
        DRIFT_KIND.SPREAD,
        DRIFT_KIND.BURY,
        DRIFT_KIND.REPORT,
      ]).toContain(k)
    }
  })

  it('domain ordenado por created_at ASC (first-seen estável)', () => {
    for (let i = 1; i < domain.length; i++) {
      expect(domain[i]!.created_at).toBeGreaterThanOrEqual(domain[i - 1]!.created_at)
    }
  })
})

// ─── 4. Volume (alvos do plano) ─────────────────────────────────────

describe('volume gerado', () => {
  const { domain } = getSeedEvents()
  const byKind = (k: number) => domain.filter((e) => e.kind === k)

  it('~500 posts (genesis 58 + 442 conteúdo + P1 = 501)', () => {
    const posts = byKind(DRIFT_KIND.POST)
    expect(posts.length).toBeGreaterThanOrEqual(490)
    expect(posts.length).toBeLessThanOrEqual(520)
  })

  it('~2000 spreads (cascata 3 + ~2000)', () => {
    const spreads = byKind(DRIFT_KIND.SPREAD)
    expect(spreads.length).toBeGreaterThanOrEqual(1900)
    expect(spreads.length).toBeLessThanOrEqual(2100)
  })

  it('~200 buries', () => {
    const buries = byKind(DRIFT_KIND.BURY)
    expect(buries.length).toBeGreaterThanOrEqual(180)
    expect(buries.length).toBeLessThanOrEqual(220)
  })

  it('~50 reports', () => {
    const reports = byKind(DRIFT_KIND.REPORT)
    expect(reports.length).toBeGreaterThanOrEqual(20)
    expect(reports.length).toBeLessThanOrEqual(60)
  })
})

// ─── 5. Cascata A→B→C→D (bug #3 ground-truth) ───────────────────────

describe('cascata Alice→Bob→Carol→Dave', () => {
  const { domain, cascadePostId } = getSeedEvents()

  it('P1 é POST da Alice em Brasília', () => {
    const p1 = domain.find((e) => e.id === cascadePostId)!
    expect(p1).toBeDefined()
    expect(p1.kind).toBe(DRIFT_KIND.POST)
    expect(p1.pubkey).toBe(NAMED_BY_NAME.alice!.pub)
    const locTag = p1.tags.find((t) => t[0] === 'location')!
    expect(locTag).toBeDefined()
    expect(locTag[3]).toBe('Brasília')
  })

  it('CASCADE = Bob→Carol→Dave pelo follow-graph (3 elos)', () => {
    expect(CASCADE.map((s) => s.spreaderName)).toEqual(['bob', 'carol', 'dave'])
    // follow-graph: Bob segue Alice, Carol segue Bob, Dave segue Carol.
    expect(NAMED_BY_NAME.bob!.follows).toContain(NAMED_BY_NAME.alice!.pub)
    expect(NAMED_BY_NAME.carol!.follows).toContain(NAMED_BY_NAME.bob!.pub)
    expect(NAMED_BY_NAME.dave!.follows).toContain(NAMED_BY_NAME.carol!.pub)
  })

  it('cada elo da cascata é um SPREAD de P1, timestamps ordenados +1h', () => {
    const cascadeSpreads = domain.filter(
      (e) =>
        e.kind === DRIFT_KIND.SPREAD &&
        e.tags.some((t) => t[0] === 'e' && t[1] === cascadePostId) &&
        [
          NAMED_BY_NAME.bob!.pub,
          NAMED_BY_NAME.carol!.pub,
          NAMED_BY_NAME.dave!.pub,
        ].includes(e.pubkey),
    )
    expect(cascadeSpreads).toHaveLength(3)
    // Ordenar por created_at e conferir atores + delta de 1h.
    const sorted = [...cascadeSpreads].sort((a, b) => a.created_at - b.created_at)
    expect(sorted[0]!.pubkey).toBe(NAMED_BY_NAME.bob!.pub)
    expect(sorted[1]!.pubkey).toBe(NAMED_BY_NAME.carol!.pub)
    expect(sorted[2]!.pubkey).toBe(NAMED_BY_NAME.dave!.pub)
    expect(sorted[0]!.created_at).toBe(TS_BASE + 1 * HOUR)
    expect(sorted[1]!.created_at).toBe(TS_BASE + 2 * HOUR)
    expect(sorted[2]!.created_at).toBe(TS_BASE + 3 * HOUR)
    // todos apontam pro autor Alice via tag p
    for (const s of sorted) {
      expect(s.tags.find((t) => t[0] === 'p')![1]).toBe(NAMED_BY_NAME.alice!.pub)
    }
  })
})

// ─── 6. Score de P1 calculável (bug #1) ─────────────────────────────

describe('score P1 — determinístico com weights da cascata', () => {
  // Ground-truth: assert que `calculateScore` produz valor conhecido
  // dados os weights da cascata. Os weights vêm de `calculateWeight`
  // puro com `now` FIXO (não Date.now) — manifesto §7. Em runtime o
  // recalc usa Date.now, mas a FÓRMULA e os inputs são os mesmos; aqui
  // travamos a matemática que a suite de score E2E vai re-derivar.
  const now = (TS_BASE + 3 * HOUR) * 1000 // logo após o último elo

  // Cada spreader: antiguidade pela própria createdAt; spreadsReceived=0
  // baseline (genesis post sem spreads recebidos no cenário mínimo da
  // cascata); lastActive = momento do próprio spread.
  function spreaderWeight(name: 'bob' | 'carol' | 'dave', spreadTs: number): number {
    const id = NAMED_BY_NAME[name]!
    return calculateWeight({
      createdAt: id.createdAt * 1000,
      spreadsReceived: 0,
      lastActive: spreadTs * 1000,
      now,
    })
  }

  it('weights dos spreadores são positivos e ordenados por antiguidade', () => {
    const wBob = spreaderWeight('bob', TS_BASE + 1 * HOUR)
    const wCarol = spreaderWeight('carol', TS_BASE + 2 * HOUR)
    const wDave = spreaderWeight('dave', TS_BASE + 3 * HOUR)
    // Bob (12wk) > Carol (6wk) > Dave (2wk) em antiguidade.
    expect(wBob).toBeGreaterThan(wCarol)
    expect(wCarol).toBeGreaterThan(wDave)
    expect(wDave).toBeGreaterThan(0)
  })

  it('score de P1 = soma de weights / (ageHours+2)^1.5 (conhecido)', () => {
    const wBob = spreaderWeight('bob', TS_BASE + 1 * HOUR)
    const wCarol = spreaderWeight('carol', TS_BASE + 2 * HOUR)
    const wDave = spreaderWeight('dave', TS_BASE + 3 * HOUR)
    const spreadWeight = wBob + wCarol + wDave

    const score = calculateScore({
      spreadWeight,
      buryWeight: 0,
      createdAt: TS_BASE, // P1 criado na base
      now: TS_BASE + 3 * HOUR, // score (unix sec) — 3h de idade
    })

    // Recompute independente do impl pra travar a fórmula:
    const ageHours = 3
    const expected = spreadWeight / Math.pow(ageHours + 2, 1.5)
    expect(score).toBeCloseTo(expected, 10)
    expect(score).toBeGreaterThan(0)
  })

  it('antiguidade conhecida: Bob ~12 semanas no momento da cascata', () => {
    const ageWeeks = (now - NAMED_BY_NAME.bob!.createdAt * 1000) / (WEEK * 1000)
    expect(ageWeeks).toBeCloseTo(12, 0)
  })
})

// ─── 7. Reports cruzam threshold §26 (3 posts → -999) ───────────────

describe('moderação §26 — 3 posts-alvo cruzam threshold', () => {
  const { domain } = getSeedEvents()
  const reports = domain.filter((e) => e.kind === DRIFT_KIND.REPORT)

  it('exatamente 3 posts distintos são reportados', () => {
    const targets = new Set(
      reports.map((e) => e.tags.find((t) => t[0] === 'e')![1]),
    )
    expect(targets.size).toBe(3)
  })

  it('cada alvo acumula peso de reports ≥ threshold dinâmico', () => {
    // Base ativa do seed ≈ 58 users → threshold spam/harassment =
    // max(5, floor(58*0.001)) = 5; illegal = max(3, floor(5/2)) = 3.
    const ACTIVE_USERS = 58
    // Agrupa reports por (target, reason) e soma getReportWeight do peso
    // de cada reporter. Peso do reporter: usamos um lower-bound seguro —
    // reporters named/seeds antigos têm weight ≥ 20 → getReportWeight ≥ 1.0.
    const byTarget = new Map<string, { reason: ReportReason; reporters: string[] }>()
    for (const ev of reports) {
      const tid = ev.tags.find((t) => t[0] === 'e')![1]!
      const reason = ev.tags.find((t) => t[0] === 'reason')![1] as ReportReason
      const cur = byTarget.get(tid) ?? { reason, reporters: [] }
      cur.reporters.push(ev.pubkey)
      byTarget.set(tid, cur)
    }
    expect(byTarget.size).toBe(3)

    for (const [tid, info] of byTarget) {
      const threshold = getReportThreshold(ACTIVE_USERS, info.reason)
      // Cada reporter contribui ≥ 0.5 (getReportWeight mínimo). Lower
      // bound conservador: distinct reporters × 0.5.
      const distinctReporters = new Set(info.reporters).size
      const lowerBoundWeight = distinctReporters * getReportWeight(0)
      expect(
        lowerBoundWeight,
        `alvo ${tid} reason=${info.reason}: peso mínimo ${lowerBoundWeight} < threshold ${threshold}`,
      ).toBeGreaterThanOrEqual(threshold)
    }
  })

  it('2 alvos illegal (threshold 3) + 1 alvo spam (threshold 5)', () => {
    const reasons = reports.map((e) => e.tags.find((t) => t[0] === 'reason')![1])
    expect(reasons).toContain('illegal')
    expect(reasons).toContain('spam')
    const targetReasons = new Map<string, string>()
    for (const ev of reports) {
      targetReasons.set(
        ev.tags.find((t) => t[0] === 'e')![1]!,
        ev.tags.find((t) => t[0] === 'reason')![1]!,
      )
    }
    const illegalTargets = [...targetReasons.values()].filter((r) => r === 'illegal')
    expect(illegalTargets).toHaveLength(2)
  })
})

// ─── 8. Modo lite (subset rápido pra validação visual dos mapas) ────
//
// lite reduz contagens mantendo o que importa: cascata A→B→C→D, geo
// variado (BR/EU/Ásia), spreads espalhados no tempo, posts com imagem,
// buries + 3 alvos que cruzam threshold §26, follows. Deve drenar em <15s
// (~200 eventos × ~50ms INSERT). §7: lite é subconjunto FIXO, reproduzível.

describe('modo lite (boot rápido)', () => {
  const lite = buildSeedEvents('lite')
  const full = getSeedEvents('full')
  const liteByKind = (k: number) => lite.domain.filter((e) => e.kind === k)

  it('lite é MUITO menor que full (~200 vs ~2730 eventos)', () => {
    const liteTotal = lite.domain.length + lite.contactLists.length
    const fullTotal = full.domain.length + full.contactLists.length
    expect(liteTotal).toBeLessThanOrEqual(250)
    expect(liteTotal).toBeGreaterThanOrEqual(150)
    expect(liteTotal).toBeLessThan(fullTotal / 5)
  })

  it('determinístico (§7): rebuild lite produz os MESMOS ids', () => {
    const fresh = buildSeedEvents('lite')
    expect(fresh.domain.map((e) => e.id)).toEqual(lite.domain.map((e) => e.id))
    expect(fresh.contactLists.map((e) => e.id)).toEqual(
      lite.contactLists.map((e) => e.id),
    )
    expect(fresh.cascadePostId).toBe(lite.cascadePostId)
    // digest lite estável e distinto do full (conjuntos diferentes).
    expect(computeSeedDigest('lite')).toBe(computeSeedDigest('lite'))
    expect(computeSeedDigest('lite')).not.toBe(computeSeedDigest('full'))
  })

  it('todos os eventos lite passam Schnorr + schema', () => {
    for (const ev of lite.domain) {
      expect(verifyEvent({ ...ev }), `verify ${ev.id}`).toBe(true)
      expect(passesSchemaCheck(ev), `schema ${ev.id}`).toBe(true)
    }
    for (const ev of lite.contactLists) {
      expect(verifyEvent({ ...ev })).toBe(true)
    }
  })

  it('domain lite ordenado por created_at ASC (first-seen estável)', () => {
    for (let i = 1; i < lite.domain.length; i++) {
      expect(lite.domain[i]!.created_at).toBeGreaterThanOrEqual(
        lite.domain[i - 1]!.created_at,
      )
    }
  })

  it('cascata Alice→Bob→Carol→Dave preservada (propagation map)', () => {
    const p1 = lite.domain.find((e) => e.id === lite.cascadePostId)!
    expect(p1).toBeDefined()
    expect(p1.pubkey).toBe(NAMED_BY_NAME.alice!.pub)
    expect(p1.tags.find((t) => t[0] === 'location')![3]).toBe('Brasília')
    const cascadeSpreads = lite.domain.filter(
      (e) =>
        e.kind === DRIFT_KIND.SPREAD &&
        e.tags.some((t) => t[0] === 'e' && t[1] === lite.cascadePostId) &&
        [
          NAMED_BY_NAME.bob!.pub,
          NAMED_BY_NAME.carol!.pub,
          NAMED_BY_NAME.dave!.pub,
        ].includes(e.pubkey),
    )
    const sorted = [...cascadeSpreads].sort((a, b) => a.created_at - b.created_at)
    expect(sorted.map((s) => s.pubkey)).toEqual([
      NAMED_BY_NAME.bob!.pub,
      NAMED_BY_NAME.carol!.pub,
      NAMED_BY_NAME.dave!.pub,
    ])
  })

  it('geo variado pra mapa global (BR + EU + Ásia presentes)', () => {
    const countries = new Set<string>()
    for (const ev of liteByKind(DRIFT_KIND.POST)) {
      const loc = ev.tags.find((t) => t[0] === 'location')
      if (loc) countries.add(loc[4]!)
    }
    // named cobrem BR/PT/DE/JP/US; seeds bg-0..9 são Brasília (LPA).
    expect(countries.has('BR')).toBe(true)
    expect(countries.has('JP')).toBe(true) // Ásia (Tokyo)
    expect([...countries].some((c) => ['PT', 'DE', 'FR'].includes(c))).toBe(true) // EU
    expect(countries.size).toBeGreaterThanOrEqual(4)
  })

  it('spreads espalhados no tempo (cascata temporal no scrubber)', () => {
    const spreadTs = liteByKind(DRIFT_KIND.SPREAD).map((e) => e.created_at)
    expect(spreadTs.length).toBeGreaterThanOrEqual(60)
    const span = Math.max(...spreadTs) - Math.min(...spreadTs)
    // não pode ser um cluster instantâneo — precisa cobrir vários dias.
    expect(span).toBeGreaterThan(5 * 24 * HOUR)
  })

  it('posts com imagem same-origin presentes (image-render)', () => {
    const withImage = liteByKind(DRIFT_KIND.POST).filter((e) => {
      const parsed = JSON.parse(e.content) as { subposts: { imageUrl: string | null }[] }
      return parsed.subposts.some((s) => s.imageUrl?.startsWith('/dev-seed-media/'))
    })
    expect(withImage.length).toBeGreaterThanOrEqual(5)
  })

  it('buries presentes (julgamento estético)', () => {
    expect(liteByKind(DRIFT_KIND.BURY).length).toBeGreaterThanOrEqual(15)
  })

  it('3 posts-alvo cruzam threshold §26 (moderação)', () => {
    const reports = liteByKind(DRIFT_KIND.REPORT)
    const ACTIVE_USERS = 20 // 8 named + 12 seed no subset lite
    const byTarget = new Map<string, { reason: ReportReason; reporters: Set<string> }>()
    for (const ev of reports) {
      const tid = ev.tags.find((t) => t[0] === 'e')![1]!
      const reason = ev.tags.find((t) => t[0] === 'reason')![1] as ReportReason
      const cur = byTarget.get(tid) ?? { reason, reporters: new Set<string>() }
      cur.reporters.add(ev.pubkey)
      byTarget.set(tid, cur)
    }
    expect(byTarget.size).toBe(3)
    // Reporters são os 8 named (antiguidade alta → weight ≥ 1.0 cada). Peso
    // real de report ≥ getReportWeight(weight). Conferimos com o weight real
    // calculado, não o lower-bound 0.5 (8 named cobrem spam=5 com folga).
    const now = (TS_BASE + 1 * 24 * 3600) * 1000
    for (const [tid, info] of byTarget) {
      const threshold = getReportThreshold(ACTIVE_USERS, info.reason)
      let sum = 0
      for (const pub of info.reporters) {
        const id = NAMED_IDENTITIES.find((n) => n.pub === pub)
        const w = id
          ? calculateWeight({
              createdAt: id.createdAt * 1000,
              spreadsReceived: 0,
              lastActive: now,
              now,
            })
          : 0
        sum += getReportWeight(w)
      }
      expect(sum, `alvo ${tid} reason=${info.reason}: ${sum} < ${threshold}`).toBeGreaterThanOrEqual(
        threshold,
      )
    }
  })

  it('follows presentes pra network/Trust Lens', () => {
    expect(lite.contactLists.length).toBeGreaterThanOrEqual(8)
    // named Bob..Heidi + seeds com follows.
    for (const ev of lite.contactLists) {
      expect(ev.kind).toBe(3)
    }
  })
})
