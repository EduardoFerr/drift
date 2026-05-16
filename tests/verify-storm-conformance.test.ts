/**
 * Storm conformance — verify-storm pós-EOSE (boot scenario).
 *
 * Origem: Ted RFC §7.3 + Lily long-task audit §2.5 (rank 2). Pós-boot,
 * 4 relays seed devolvem até 500 events stored cada → cliente recebe
 * ~2000 events em rajada. Verify worker tem que drenar sem regredir
 * INP e sem dropar eventos legítimos abaixo do cap (5000).
 *
 * Cenários:
 *  - 500 events em rajada (storm boot típico) — todos verificam +
 *    persistem em < N ms (N = 2s desktop default vitest).
 *  - 10k events rajada (storm hostil) — queue NUNCA passa 5000;
 *    drop count > 0; nenhum INSERT pra dropados.
 *
 * Mock Worker: cada postMessage responde no próximo microtask via
 * `queueMicrotask`. Sem timer real. Não testa throughput de worker
 * (testado em verify-queue), só pipeline correctness sob carga.
 *
 * Invariantes citados (CLAUDE.md):
 *  #1 — INSERT só após verify ok (mock conta INSERTs)
 *  #5 — Pipeline ordem (cheap antes de await)
 *  #7 — Determinismo: storm idempotente — mesmo conjunto de events,
 *       mesmo resultado.
 *
 * Limitação: 5000-cap drop NEWEST só dispara se rajada > 5000 events
 * num intervalo onde worker ainda não drenou. Como mock responde
 * imediato (microtask), na prática cap nunca acertaria. Forçamos
 * cenário com `neverRespond` controlado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validEvents, ANCHOR_POST } from './fixtures/verify-events'
import type { SignedEvent } from '../src/types/nostr'

// ─── Mock Worker simples (responde imediato via microtask) ──────────

class StormWorker {
  static instances: StormWorker[] = []
  static neverRespond = false
  posted: { id: number }[] = []
  terminated = false
  onmessage: ((e: MessageEvent<{ id: number; ok: boolean }>) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  constructor(_url: unknown, _opts?: unknown) {
    StormWorker.instances.push(this)
  }
  postMessage(msg: { id: number }): void {
    if (this.terminated) return
    this.posted.push(msg)
    if (!StormWorker.neverRespond) {
      queueMicrotask(() => {
        if (this.terminated || !this.onmessage) return
        this.onmessage(
          new MessageEvent('message', { data: { id: msg.id, ok: true } }),
        )
      })
    }
  }
  terminate(): void {
    this.terminated = true
  }
}

vi.stubGlobal('Worker', StormWorker)
if (typeof (globalThis as { performance?: unknown }).performance === 'undefined') {
  vi.stubGlobal('performance', { now: () => Date.now() })
}

// db + collateral mocks (mesmo padrão de events-verify-pipeline)
const { dbRunMock, dbExecMock, dbGetMock } = vi.hoisted(() => ({
  dbRunMock: vi.fn(),
  dbExecMock: vi.fn(),
  dbGetMock: vi.fn(),
}))
vi.mock('../src/lib/db', () => ({
  db: { run: dbRunMock, exec: dbExecMock, get: dbGetMock },
}))
vi.mock('../src/lib/scoring', () => ({
  calculateScoreNow: vi.fn(() => 0),
  applyCommentReceived: vi.fn((a: { currentScore: number }) => a.currentScore),
}))
vi.mock('../src/lib/feed', () => ({
  invalidateFeed: vi.fn(),
  bumpUnseenCount: vi.fn(),
}))
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))
vi.mock('../src/lib/weight', () => ({
  calculateUserWeight: vi.fn(async () => ({ weight: 0.5 })),
  calculateWeight: vi.fn(() => 0),
}))
vi.mock('../src/lib/comment-counts', () => ({
  bumpCommentCount: vi.fn(),
}))
vi.mock('../src/lib/comments', () => ({
  addCommentToStore: vi.fn(),
}))

beforeEach(async () => {
  StormWorker.instances = []
  StormWorker.neverRespond = false
  dbRunMock.mockReset().mockResolvedValue(undefined)
  dbExecMock.mockReset().mockResolvedValue([])
  dbGetMock.mockReset().mockResolvedValue(null)
  vi.resetModules()
})

afterEach(async () => {
  const mod = await import('../src/lib/verify')
  mod._resetVerifyForTest()
})

// Helpers

/**
 * Constrói rajada de N events recidlando o conjunto das 70 fixtures
 * válidas. Pra simular storm > 70, replica events com id mutado mas
 * sig **inalterada** — o pipeline mockado verifyAsync sempre responde
 * ok=true, então não importa que a sig deixe de bater (verify é mock).
 * O teste mede backpressure/queue, não verify crypto.
 */
function buildStorm(n: number): SignedEvent[] {
  const out: SignedEvent[] = []
  // Preferimos SPREAD events (todos têm `e` válido apontando pro anchor
  // post.id) — schema check passa, vai pro verify, depois persist.
  const spreads = validEvents.filter((e) => e.kind === 9079)
  for (let i = 0; i < n; i++) {
    const base = spreads[i % spreads.length]!
    // Mutate id pra dedup-set não rejeitar. Não afeta o pipeline porque
    // mock não verifica sig — apenas precisa preservar shape válido.
    out.push({ ...base, id: `${'b'.repeat(63)}${(i % 16).toString(16)}` })
  }
  return out
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('verify-storm — 500 events boot típico', () => {
  it('500 events em rajada: todos verificam + persistem (boot scenario)', async () => {
    const { onNostrEvent } = await import('../src/lib/events')
    const storm = buildStorm(500)
    const start = performance.now()
    // Disparar TODOS em paralelo (rajada) — onNostrEvent retorna
    // Promise<void>. Promise.all aguarda tudo.
    await Promise.all(storm.map((e) => onNostrEvent(e)))
    const elapsed = performance.now() - start
    // Como mock Worker responde imediato (microtask), 500 events
    // resolvem em <2s mesmo em CI lento.
    expect(elapsed).toBeLessThan(2000)
    // Esperamos 500 INSERTs em spreads
    const spreadInserts = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(spreadInserts.length).toBe(500)
  })

  it('idempotência: storm com event dup roda sem crash', async () => {
    const { onNostrEvent } = await import('../src/lib/events')
    const oneEvent = validEvents.find((e) => e.kind === 9079)!
    // 100× o mesmo event — `INSERT OR IGNORE` cobre dedup no SQLite real,
    // aqui só validamos que pipeline não throw.
    await Promise.all(
      Array.from({ length: 100 }, () => onNostrEvent(oneEvent)),
    )
    // 100 INSERTs no mock (INSERT OR IGNORE não-fata em mock — gravam
    // todos; SQLite real é que faria o dedup). Confirma só
    // throughput/no-throw.
    const spreadInserts = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(spreadInserts.length).toBe(100)
  })

  it('500 events: todos passam pelo verify worker (boundary não pula)', async () => {
    const { onNostrEvent } = await import('../src/lib/events')
    const storm = buildStorm(500)
    await Promise.all(storm.map((e) => onNostrEvent(e)))
    // Worker spawnou e processou todos
    expect(StormWorker.instances.length).toBe(1)
    expect(StormWorker.instances[0]!.posted.length).toBe(500)
  })
})

describe('verify-storm — 10k events rajada hostil (cap + drops)', () => {
  it('queue NUNCA excede 5000 mesmo em rajada de 10k', async () => {
    // Worker NÃO drena durante a fase 1 — forçamos cap a saturar
    StormWorker.neverRespond = true
    const { verifyEventAsync, getVerifyMetrics } = await import(
      '../src/lib/verify'
    )
    const storm = buildStorm(10_000)
    // Dispara todos. Os primeiros 5000 ficam pending; os outros 5000
    // resolvem `false` imediato (drop). Não `await` — pendentes nunca
    // resolveriam (worker preso).
    const pendingPromises: Promise<boolean>[] = []
    const dropResults: Promise<boolean>[] = []
    for (let i = 0; i < storm.length; i++) {
      const p = verifyEventAsync(storm[i]!)
      if (i < 5000) {
        pendingPromises.push(p)
      } else {
        dropResults.push(p)
      }
    }
    // Drena microtasks pra ensureWorker() resolver e postMessages
    // serem despachados pro mock.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const metrics = getVerifyMetrics()
    expect(metrics.pending).toBe(5000)
    expect(metrics.dropped).toBe(5000)

    // Drops resolveram imediato — Promise.all delas é instantâneo.
    const droppedVerdicts = await Promise.all(dropResults)
    expect(droppedVerdicts.length).toBe(5000)
    expect(droppedVerdicts.every((v) => v === false)).toBe(true)

    // Worker recebeu até 5000 postMessages
    expect(StormWorker.instances[0]!.posted.length).toBe(5000)

    // Cleanup: libera pendentes pra evitar Promise leak
    StormWorker.neverRespond = false
    const w = StormWorker.instances[0]!
    for (const p of w.posted) {
      if (w.onmessage) {
        w.onmessage(new MessageEvent('message', { data: { id: p.id, ok: true } }))
      }
    }
    await Promise.all(pendingPromises)
  })

  it('drop count métrico > 0 quando rajada > 5000', async () => {
    StormWorker.neverRespond = true
    const { verifyEventAsync, getVerifyMetrics } = await import(
      '../src/lib/verify'
    )
    const storm = buildStorm(6000)
    const pendingPromises: Promise<boolean>[] = []
    const dropPromises: Promise<boolean>[] = []
    for (let i = 0; i < storm.length; i++) {
      const p = verifyEventAsync(storm[i]!)
      if (i < 5000) pendingPromises.push(p)
      else dropPromises.push(p)
    }
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const m = getVerifyMetrics()
    expect(m.dropped).toBe(1000)
    const drops = await Promise.all(dropPromises)
    expect(drops.length).toBe(1000)
    expect(drops.every((v) => v === false)).toBe(true)
    // Cleanup
    StormWorker.neverRespond = false
    const w = StormWorker.instances[0]!
    for (const p of w.posted) {
      if (w.onmessage) {
        w.onmessage(new MessageEvent('message', { data: { id: p.id, ok: true } }))
      }
    }
    await Promise.all(pendingPromises)
  })

  it('dropped events NÃO chegam ao persist (inv #1)', async () => {
    // QUEUE_CAP é 5000 em prod, mas o invariante "dropados não
    // persistem" é o mesmo em qualquer escala. Aqui usamos 5200
    // (≈ cap + 200) pra disparar o drop NEWEST sem precisar resolver
    // 5000+ Promises em paralelo (lento sob CI saturado).
    StormWorker.neverRespond = true
    const { onNostrEvent } = await import('../src/lib/events')
    const storm = buildStorm(5200)
    const inFlight = storm.map((e) => onNostrEvent(e))
    // Drena microtasks pra pipeline progredir
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Ainda nenhum INSERT — verify pendente pros 5000, false pros
    // 200. Persist só roda quando verify resolve true.
    const inserts0 = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(inserts0.length).toBe(0)
    // Libera worker — pendentes resolvem e persistem
    StormWorker.neverRespond = false
    const w = StormWorker.instances[0]!
    for (const p of w.posted) {
      if (w.onmessage) {
        w.onmessage(new MessageEvent('message', { data: { id: p.id, ok: true } }))
      }
    }
    // Aguarda todos os onNostrEvent terminarem. Os 200 dropados
    // resolveram cedo (verify retornou false). Os 5000 pending agora
    // resolvem ok=true e persistem.
    await Promise.all(inFlight)
    // 5000 inserts (os 200 dropados nunca chegaram ao persist)
    const insertsFinal = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(insertsFinal.length).toBe(5000)
  }, 30000)
})

describe('verify-storm — sanity checks no anchor fixture', () => {
  it('ANCHOR_POST.id é hex 64 (consumido por SPREAD/BURY/REPORT)', () => {
    expect(ANCHOR_POST.id).toMatch(/^[0-9a-f]{64}$/)
  })
})
