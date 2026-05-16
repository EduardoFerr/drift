/**
 * Tests de integração — pipeline `onNostrEvent` com `verifyEventAsync`.
 *
 * Origem: Ted RFC `Docs/rfcs/2026-05-rfc-verify-worker.md` §7.2,
 * Barney threat model T1 (race main↔worker) — `Docs/security/
 * verify-worker-threat-model-2026-05-16.md`.
 *
 * Cobertura:
 *  - Cheap checks (kind + schema) rodam SYNC antes do `await
 *    verifyEventAsync` — invariante #5 do CLAUDE.md.
 *  - Event com kind fora do DRIFT_KIND_SET nunca chega ao verify worker.
 *  - Event com sig inválida NÃO é persistido (INSERT bloqueado).
 *  - Event com sig válida é persistido após verify ok.
 *  - Ordem preservada entre events concorrentes (T1 race coberto:
 *    persist nunca acontece antes do ack correto do verify).
 *
 * Mocka `verifyEventAsync` — não roda worker real (testado isoladamente
 * em `verify-queue.test.ts`). Foco aqui: pipeline correctness.
 *
 * Invariantes citados (CLAUDE.md):
 *  #1 — INSERT só após verify ok (verifica via db.run mock count)
 *  #5 — Pipeline cheap→caro: verifica que verify NÃO é chamado pra
 *       kinds fora do DRIFT_KIND_SET ou schemas inválidos.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  validEvents,
  invalidSchemaEvents,
} from './fixtures/verify-events'

// ─── Mocks ──────────────────────────────────────────────────────────

const { dbRunMock, dbExecMock, dbGetMock, verifyAsyncMock } = vi.hoisted(() => ({
  dbRunMock: vi.fn(),
  dbExecMock: vi.fn(),
  dbGetMock: vi.fn(),
  verifyAsyncMock: vi.fn<(e: unknown) => Promise<boolean>>(),
}))

vi.mock('../src/lib/db', () => ({
  db: { run: dbRunMock, exec: dbExecMock, get: dbGetMock },
}))

vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: verifyAsyncMock,
}))

vi.mock('../src/lib/scoring', () => ({
  calculateScoreNow: vi.fn(() => 0),
  applyCommentReceived: vi.fn((args: { currentScore: number }) => args.currentScore),
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

import { onNostrEvent } from '../src/lib/events'
import { DRIFT_KIND } from '../src/config/constants'
import type { SignedEvent } from '../src/types/nostr'

beforeEach(() => {
  dbRunMock.mockReset().mockResolvedValue(undefined)
  dbExecMock.mockReset().mockResolvedValue([])
  dbGetMock.mockReset().mockResolvedValue(null)
  verifyAsyncMock.mockReset().mockResolvedValue(true)
})

function insertCount(): number {
  return dbRunMock.mock.calls.filter((c) =>
    /INSERT(?:\s+OR\s+IGNORE)?\s+INTO/i.test(String(c[0])),
  ).length
}

// Pega só os events POST/SPREAD/BURY/REPORT das fixtures válidas
// (todas têm schema válido e sig válida).
const validPosts = validEvents.filter((e) => e.kind === DRIFT_KIND.POST)
const validSpreads = validEvents.filter((e) => e.kind === DRIFT_KIND.SPREAD)

describe('pipeline — cheap checks rodam SYNC antes do await verifyEventAsync (inv #5)', () => {
  it('kind desconhecido (kind 1) NÃO chama verifyEventAsync', async () => {
    // invalidSchemaEvents contém events kind 1 (Nostr note classic)
    const kind1 = invalidSchemaEvents.find((e) => e.kind === 1)!
    await onNostrEvent(kind1)
    expect(verifyAsyncMock).not.toHaveBeenCalled()
    expect(insertCount()).toBe(0)
  })

  it('kind 30078 (NIP-78, fora do DRIFT_KIND_SET) NÃO chama verifyEventAsync', async () => {
    const kind30078 = invalidSchemaEvents.find((e) => e.kind === 30078)!
    await onNostrEvent(kind30078)
    expect(verifyAsyncMock).not.toHaveBeenCalled()
    expect(insertCount()).toBe(0)
  })

  it('POST sem drift-version (schema inválido) NÃO chama verifyEventAsync', async () => {
    // 2 events nas fixtures schema-invalidas têm kind POST sem drift-version
    const postMissingVersion = invalidSchemaEvents.find(
      (e) =>
        e.kind === DRIFT_KIND.POST &&
        !e.tags.some((t) => t[0] === 'drift-version'),
    )!
    expect(postMissingVersion).toBeDefined()
    await onNostrEvent(postMissingVersion)
    expect(verifyAsyncMock).not.toHaveBeenCalled()
    expect(insertCount()).toBe(0)
  })

  it('SPREAD sem tag e (schema inválido) NÃO chama verifyEventAsync', async () => {
    const spreadMissingE = invalidSchemaEvents.find(
      (e) =>
        e.kind === DRIFT_KIND.SPREAD &&
        !e.tags.some((t) => t[0] === 'e'),
    )!
    expect(spreadMissingE).toBeDefined()
    await onNostrEvent(spreadMissingE)
    expect(verifyAsyncMock).not.toHaveBeenCalled()
    expect(insertCount()).toBe(0)
  })

  it('REPORT sem reason (schema inválido) NÃO chama verifyEventAsync', async () => {
    const reportMissingReason = invalidSchemaEvents.find(
      (e) =>
        e.kind === DRIFT_KIND.REPORT &&
        !e.tags.some((t) => t[0] === 'reason'),
    )!
    expect(reportMissingReason).toBeDefined()
    await onNostrEvent(reportMissingReason)
    expect(verifyAsyncMock).not.toHaveBeenCalled()
    expect(insertCount()).toBe(0)
  })
})

describe('pipeline — sig inválida NÃO persiste (inv #1)', () => {
  it('verifyEventAsync resolve false → nenhum INSERT', async () => {
    verifyAsyncMock.mockResolvedValue(false)
    await onNostrEvent(validPosts[0]!)
    expect(verifyAsyncMock).toHaveBeenCalledTimes(1)
    expect(insertCount()).toBe(0)
  })

  it('rajada de events com verify=false: zero INSERTs', async () => {
    verifyAsyncMock.mockResolvedValue(false)
    for (const e of validSpreads.slice(0, 10)) {
      await onNostrEvent(e)
    }
    expect(verifyAsyncMock).toHaveBeenCalledTimes(10)
    expect(insertCount()).toBe(0)
  })
})

describe('pipeline — sig válida persiste (happy path)', () => {
  it('POST kind 9078 + verify ok → INSERT INTO posts', async () => {
    const post = validPosts[0]!
    await onNostrEvent(post)
    expect(verifyAsyncMock).toHaveBeenCalledTimes(1)
    expect(verifyAsyncMock).toHaveBeenCalledWith(post)
    expect(
      dbRunMock.mock.calls.filter((c) =>
        /INSERT OR IGNORE INTO posts\b/i.test(String(c[0])),
      ).length,
    ).toBe(1)
  })

  it('SPREAD kind 9079 + verify ok → INSERT INTO spreads', async () => {
    const sp = validSpreads[0]!
    await onNostrEvent(sp)
    expect(
      dbRunMock.mock.calls.filter((c) =>
        /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
      ).length,
    ).toBe(1)
  })

  it('todos 70 events válidos das fixtures passam o pipeline com 0 rejeições', async () => {
    for (const e of validEvents) {
      await onNostrEvent(e)
    }
    // Cada event valido devia ter sido verificado uma vez
    expect(verifyAsyncMock).toHaveBeenCalledTimes(validEvents.length)
    // Cada event gera 1 INSERT na tabela própria (POST/SPREAD/BURY/REPORT)
    // — mais updates secundários (users) que não contam aqui.
    expect(insertCount()).toBeGreaterThanOrEqual(validEvents.length)
  })
})

describe('pipeline — race T1 (Barney): persist só após ack verify', () => {
  it('persist é chamado APENAS após verifyEventAsync resolver true', async () => {
    let resolveVerify: ((v: boolean) => void) | null = null
    verifyAsyncMock.mockImplementation(() => {
      return new Promise<boolean>((res) => {
        resolveVerify = res
      })
    })

    const post = validPosts[0]!
    const p = onNostrEvent(post)

    // Antes do verify resolver, NÃO há INSERT
    // (precisa drenar microtasks pra captarmos o estado pré-resolve)
    await Promise.resolve()
    await Promise.resolve()
    expect(insertCount()).toBe(0)

    // Resolve verify ok — só agora persist deve disparar
    resolveVerify!(true)
    await p
    expect(insertCount()).toBeGreaterThanOrEqual(1)
  })

  it('events concorrentes: cada um espera SEU OWN verify ack', async () => {
    // Cada chamada a verifyAsyncMock retorna Promise distinta —
    // mantemos referência dos resolvers pra controlar ordem.
    const resolvers: ((v: boolean) => void)[] = []
    verifyAsyncMock.mockImplementation(() => {
      return new Promise<boolean>((res) => resolvers.push(res))
    })

    const evA = validSpreads[0]!
    const evB = validSpreads[1]!
    const evC = validSpreads[2]!
    const pA = onNostrEvent(evA)
    const pB = onNostrEvent(evB)
    const pC = onNostrEvent(evC)

    // 3 verifies pendentes
    await Promise.resolve()
    await Promise.resolve()
    expect(resolvers.length).toBe(3)
    expect(insertCount()).toBe(0) // nenhum persistiu ainda

    // Resolve B primeiro (fora de ordem proposital) — só evB deve
    // persistir, A e C continuam pendentes.
    resolvers[1]!(true)
    await Promise.resolve()
    await Promise.resolve()
    const insertsAfterB = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(insertsAfterB.length).toBe(1)
    // Confirma que é o evB (o INSERT inclui event_id como column)
    expect(JSON.stringify(insertsAfterB[0]![1])).toContain(evB.id)

    // Resolve A e C, ambos persistem
    resolvers[0]!(true)
    resolvers[2]!(true)
    await pA
    await pB
    await pC
    const insertsFinal = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(insertsFinal.length).toBe(3)
  })

  it('verify false em meio à rajada: só os ok persistem', async () => {
    const verdicts = [true, false, true, false, true]
    let i = 0
    verifyAsyncMock.mockImplementation(async () => verdicts[i++]!)
    for (const e of validSpreads.slice(0, 5)) {
      await onNostrEvent(e)
    }
    const spreadInserts = dbRunMock.mock.calls.filter((c) =>
      /INSERT OR IGNORE INTO spreads\b/i.test(String(c[0])),
    )
    expect(spreadInserts.length).toBe(3) // só true → persiste
  })
})

describe('pipeline — boundary shape (inv #8: SignedEvent público, sem nsec)', () => {
  it('verifyEventAsync recebe APENAS SignedEvent (sem campos privados)', async () => {
    const post = validPosts[0]!
    await onNostrEvent(post)
    const arg = verifyAsyncMock.mock.calls[0]![0] as SignedEvent
    // SignedEvent shape: id, pubkey, created_at, kind, tags, content, sig
    expect(Object.keys(arg).sort()).toEqual(
      ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'].sort(),
    )
    // Nenhuma chave private/secret
    expect((arg as Record<string, unknown>).nsec).toBeUndefined()
    expect((arg as Record<string, unknown>).privateKey).toBeUndefined()
  })
})
