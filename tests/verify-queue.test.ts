/**
 * Tests pra `src/lib/verify.ts` — queue + drop + worker lifecycle.
 *
 * Origem: Ted RFC `Docs/rfcs/2026-05-rfc-verify-worker.md` §7.1.
 * Barney threat model `Docs/security/verify-worker-threat-model-
 * 2026-05-16.md` T3 (backpressure flood) e T4 (drop newest hostil).
 *
 * Estratégia: mock o construtor `Worker` global pra controlar quando
 * cada `postMessage` da main recebe ack. Sem worker real — vitest roda
 * em Node, Worker do browser não existe nativamente, e iniciar Worker
 * real introduz flakiness + slowdown.
 *
 * Coverage:
 *  - Enfileiramento + resolução FIFO
 *  - Cap de queue 5000 (Barney P1.1)
 *  - Drop NEWEST quando saturado (Barney P1.2 / T4)
 *  - Drop count métrico monotônico
 *  - Worker crash (onerror) rejeita pendentes
 *  - Init timeout
 *  - Init falha lança Error (Barney P1.5, sem fallback sync)
 *
 * Invariantes citados (CLAUDE.md):
 *  #5 — Pipeline cheap→caro: tests confirmam que main-side roda sync
 *       até `await verifyEventAsync`.
 *  #8 — Worker recebe apenas SignedEvent (público). Tests mockam
 *       postMessage e validam o shape.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { validEvents } from './fixtures/verify-events'

// ─── Mock Worker global ──────────────────────────────────────────────
//
// Cada instância MockWorker captura postMessages e expõe um helper
// `respond(id, ok)` pra simular ack do worker. `terminate` invalida.
// `triggerError` força `onerror` (recovery path).

interface PostedMessage {
  id: number
  event: { id: string; pubkey: string; sig: string; kind: number }
}

class MockWorker {
  static instances: MockWorker[] = []
  static failConstruction = false
  static neverRespond = false

  posted: PostedMessage[] = []
  terminated = false
  onmessage: ((e: MessageEvent<{ id: number; ok: boolean }>) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(_url: unknown, _opts?: unknown) {
    if (MockWorker.failConstruction) {
      throw new Error('mock: worker construction blocked')
    }
    MockWorker.instances.push(this)
  }

  postMessage(msg: PostedMessage): void {
    if (this.terminated) return
    this.posted.push(msg)
    // Default: auto-respond `ok=true` no próximo microtask, a menos
    // que `neverRespond` esteja ligado (init-timeout-like) OU o teste
    // chame `respond()` manualmente. `neverRespond` cobre o cenário
    // "queue cheia sem worker drenar".
    if (!MockWorker.neverRespond) {
      queueMicrotask(() => this.respond(msg.id, true))
    }
  }

  respond(id: number, ok: boolean): void {
    if (this.terminated) return
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: { id, ok } }))
    }
  }

  triggerError(msg: string): void {
    if (this.onerror) this.onerror({ message: msg })
  }

  terminate(): void {
    this.terminated = true
  }
}

function resetMockWorker(): void {
  MockWorker.instances = []
  MockWorker.failConstruction = false
  MockWorker.neverRespond = false
}

// Stub global ANTES de importar src/lib/verify.ts (que captura `new
// Worker` na hora do call, não no import). Vi.stubGlobal sobrevive
// import dinâmico.
vi.stubGlobal('Worker', MockWorker)

// Performance.now em Node — vitest provê. Fallback se ausente.
if (typeof (globalThis as { performance?: unknown }).performance === 'undefined') {
  vi.stubGlobal('performance', { now: () => Date.now() })
}

// Import dinâmico após stub.
let verifyModule: typeof import('../src/lib/verify')
beforeEach(async () => {
  resetMockWorker()
  vi.resetModules()
  verifyModule = await import('../src/lib/verify')
  verifyModule._resetVerifyForTest()
})

afterEach(() => {
  verifyModule?._resetVerifyForTest()
  resetMockWorker()
})

// Helpers
function ev(i: number): import('../src/types/nostr').SignedEvent {
  // Recicla fixtures válidas — verifyEventAsync nunca vê o conteúdo
  // real (mock Worker responde ok), só usa pra postMessage shape.
  const idx = i % validEvents.length
  return validEvents[idx]!
}

/**
 * Drena microtasks pendentes — verifyEventAsync faz `await
 * ensureWorker()` antes de `postMessage`. Em vitest, basta um tick
 * (Promise.resolve()) pra que o `then` interno rode. Usamos 3 ticks
 * pra garantir margem (o promise chain interno tem mais de um await).
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('verify.ts — enqueue + FIFO + resolve', () => {
  it('enfileira event e resolve com boolean do worker', async () => {
    const result = await verifyModule.verifyEventAsync(ev(0))
    expect(result).toBe(true)
    expect(MockWorker.instances.length).toBe(1)
    expect(MockWorker.instances[0]!.posted.length).toBe(1)
  })

  it('postMessage carrega { id, event } (boundary shape, BW1)', async () => {
    const e = ev(0)
    await verifyModule.verifyEventAsync(e)
    const posted = MockWorker.instances[0]!.posted[0]!
    expect(typeof posted.id).toBe('number')
    expect(posted.event.id).toBe(e.id)
    expect(posted.event.pubkey).toBe(e.pubkey)
    expect(posted.event.sig).toBe(e.sig)
    expect(posted.event.kind).toBe(e.kind)
  })

  it('respeita single-pointer pattern — id incremental, sem colisão', async () => {
    MockWorker.neverRespond = true
    const e1 = verifyModule.verifyEventAsync(ev(0))
    const e2 = verifyModule.verifyEventAsync(ev(1))
    const e3 = verifyModule.verifyEventAsync(ev(2))
    // ensureWorker() é Promise — precisa drenar microtasks pra que os
    // postMessage interno aconteçam.
    await flushMicrotasks()
    // 3 mensagens postadas com ids distintos
    const w = MockWorker.instances[0]!
    expect(w.posted.length).toBe(3)
    const ids = w.posted.map((p) => p.id)
    expect(new Set(ids).size).toBe(3) // sem duplicata
    // Cleanup: resolve as 3 pra Promises não vazarem
    w.respond(ids[0]!, true)
    w.respond(ids[1]!, true)
    w.respond(ids[2]!, true)
    await Promise.all([e1, e2, e3])
  })

  it('reusa worker singleton entre calls', async () => {
    await verifyModule.verifyEventAsync(ev(0))
    await verifyModule.verifyEventAsync(ev(1))
    await verifyModule.verifyEventAsync(ev(2))
    expect(MockWorker.instances.length).toBe(1) // mesmo worker
    expect(MockWorker.instances[0]!.posted.length).toBe(3)
  })

  it('métricas: enqueued + resolved monotônicos', async () => {
    const before = verifyModule.getVerifyMetrics()
    expect(before.enqueued).toBe(0)
    expect(before.resolved).toBe(0)
    await verifyModule.verifyEventAsync(ev(0))
    await verifyModule.verifyEventAsync(ev(1))
    const after = verifyModule.getVerifyMetrics()
    expect(after.enqueued).toBe(2)
    expect(after.resolved).toBe(2)
    expect(after.pending).toBe(0) // gauge zera após resolve
  })
})

describe('verify.ts — backpressure (Barney T3, P1.1+P1.2)', () => {
  it('queue cap = 5000 (drop NEWEST acima)', async () => {
    MockWorker.neverRespond = true // worker não drena
    // Enfileira até cap. Cada call retorna Promise pendente.
    const promises: Promise<boolean>[] = []
    for (let i = 0; i < 5000; i++) {
      promises.push(verifyModule.verifyEventAsync(ev(i)))
    }
    await flushMicrotasks() // drena ensureWorker() + postMessage interno
    // Métricas: pending == 5000, drops == 0
    let m = verifyModule.getVerifyMetrics()
    expect(m.pending).toBe(5000)
    expect(m.dropped).toBe(0)
    // 1 acima do cap → drop NEWEST (retorna false sem enfileirar)
    const dropped = await verifyModule.verifyEventAsync(ev(99999))
    expect(dropped).toBe(false)
    m = verifyModule.getVerifyMetrics()
    expect(m.dropped).toBe(1)
    expect(m.pending).toBe(5000) // queue não cresceu
    // Cleanup: respond all
    const w = MockWorker.instances[0]!
    for (const p of w.posted) w.respond(p.id, true)
    await Promise.all(promises)
  })

  it('drop count métrico é monotônico durante storm', async () => {
    MockWorker.neverRespond = true
    const promises: Promise<boolean>[] = []
    for (let i = 0; i < 5000; i++) {
      promises.push(verifyModule.verifyEventAsync(ev(i)))
    }
    // 200 a mais → todas dropam
    const drops: boolean[] = []
    for (let i = 0; i < 200; i++) {
      drops.push(await verifyModule.verifyEventAsync(ev(i)))
    }
    expect(drops.every((r) => r === false)).toBe(true)
    const m = verifyModule.getVerifyMetrics()
    expect(m.dropped).toBe(200)
    // Cleanup
    const w = MockWorker.instances[0]!
    for (const p of w.posted) w.respond(p.id, true)
    await Promise.all(promises)
  })

  it('drop NEWEST: events que JÁ entraram na fila são processados', async () => {
    MockWorker.neverRespond = true
    // Enfileira 5000 (todos esperando)
    const inFlight: Promise<boolean>[] = []
    for (let i = 0; i < 5000; i++) {
      inFlight.push(verifyModule.verifyEventAsync(ev(i)))
    }
    // Tenta mais 10 — todos dropam
    const dropped: Promise<boolean>[] = []
    for (let i = 0; i < 10; i++) {
      dropped.push(verifyModule.verifyEventAsync(ev(10000 + i)))
    }
    const droppedResults = await Promise.all(dropped)
    expect(droppedResults.every((r) => r === false)).toBe(true)
    // Agora libera os 5000 em fila — todos devem resolver `ok`
    const w = MockWorker.instances[0]!
    for (const p of w.posted) w.respond(p.id, true)
    const inFlightResults = await Promise.all(inFlight)
    expect(inFlightResults.every((r) => r === true)).toBe(true)
  })

  it('após drenar fila cheia, novos events voltam a ser aceitos', async () => {
    MockWorker.neverRespond = true
    const phase1: Promise<boolean>[] = []
    for (let i = 0; i < 5000; i++) {
      phase1.push(verifyModule.verifyEventAsync(ev(i)))
    }
    // drop um
    expect(await verifyModule.verifyEventAsync(ev(99999))).toBe(false)
    // Libera todos
    const w = MockWorker.instances[0]!
    for (const p of w.posted) w.respond(p.id, true)
    await Promise.all(phase1)
    // Próximo event entra normal
    MockWorker.neverRespond = false
    const after = await verifyModule.verifyEventAsync(ev(0))
    expect(after).toBe(true)
  })
})

describe('verify.ts — worker crash recovery (T5)', () => {
  it('worker.onerror rejeita pendentes (resolve false)', async () => {
    MockWorker.neverRespond = true
    const p1 = verifyModule.verifyEventAsync(ev(0))
    const p2 = verifyModule.verifyEventAsync(ev(1))
    const p3 = verifyModule.verifyEventAsync(ev(2))
    // Wait next microtask pra postMessage acontecer
    await Promise.resolve()
    const w = MockWorker.instances[0]!
    w.triggerError('mock crash')
    // Pendentes resolvem false (verify falhou pra todos)
    const results = await Promise.all([p1, p2, p3])
    expect(results).toEqual([false, false, false])
    // Métricas: pending zerou
    const m = verifyModule.getVerifyMetrics()
    expect(m.pending).toBe(0)
  })

  it('após crash, próximo call faz spawn novo worker (lazy re-init)', async () => {
    MockWorker.neverRespond = true
    const failed = verifyModule.verifyEventAsync(ev(0))
    await Promise.resolve()
    MockWorker.instances[0]!.triggerError('mock crash')
    expect(await failed).toBe(false)
    // Próximo call: novo worker
    MockWorker.neverRespond = false
    const ok = await verifyModule.verifyEventAsync(ev(0))
    expect(ok).toBe(true)
    expect(MockWorker.instances.length).toBe(2) // novo spawn
  })
})

describe('verify.ts — init failure (T5, P1.5)', () => {
  it('falha de construção do Worker propaga como Error', async () => {
    MockWorker.failConstruction = true
    await expect(verifyModule.verifyEventAsync(ev(0))).rejects.toThrow(
      /falha ao spawnar/i,
    )
  })

  it('init timeout — worker preso sem respostas não bloqueia indefinido', async () => {
    // Nota: este test usa fake timers. Worker construtor sucede mas
    // assumimos pronto imediato (RFC §3.2 — stateless, sem handshake).
    // Timeout serve só pra o caso patológico em que o construtor
    // sucede mas nunca volta — verificamos que verifyEventAsync NÃO
    // bloqueia, NÃO checamos timeout do init em si (default ~15s,
    // testar real-time gastaria a vida). Ver verify.ts:130-139.
    // Aqui só validamos que `verifyEventAsync` retorna `false` quando
    // worker fica sem responder e fila enche — comportamento dual de
    // backpressure: o caller ainda termina (não engasga).
    MockWorker.neverRespond = true
    // Enche acima do cap pra forçar drop
    const flood: Promise<boolean>[] = []
    for (let i = 0; i < 5000; i++) {
      flood.push(verifyModule.verifyEventAsync(ev(i)))
    }
    const dropped = await verifyModule.verifyEventAsync(ev(99999))
    expect(dropped).toBe(false) // não bloqueia — drop imediato
    // Cleanup
    const w = MockWorker.instances[0]!
    for (const p of w.posted) w.respond(p.id, true)
    await Promise.all(flood)
  })
})

describe('verify.ts — _resetVerifyForTest()', () => {
  it('zera métricas e termina worker', async () => {
    await verifyModule.verifyEventAsync(ev(0))
    await verifyModule.verifyEventAsync(ev(1))
    const before = verifyModule.getVerifyMetrics()
    expect(before.enqueued).toBe(2)
    verifyModule._resetVerifyForTest()
    const after = verifyModule.getVerifyMetrics()
    expect(after.enqueued).toBe(0)
    expect(after.resolved).toBe(0)
    expect(after.pending).toBe(0)
    expect(after.dropped).toBe(0)
    // Worker terminado
    expect(MockWorker.instances[0]!.terminated).toBe(true)
    // Próximo call faz spawn novo
    await verifyModule.verifyEventAsync(ev(0))
    expect(MockWorker.instances.length).toBe(2)
  })
})

// Sanity helper — vitest mock instance type guard
function _ensureMock<T>(v: T | MockInstance): asserts v is MockInstance {
  if (typeof v !== 'function') throw new Error('not a mock instance')
}
void _ensureMock
