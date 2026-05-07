/**
 * Track C.1 — testes de persistência de comments NIP-22 (kind 1111).
 *
 * Cobre:
 *  - Parser puro (`parseNip22Comment`): tags E/K/P/e/k/p NIP-22
 *  - Schema check (`passesNip22SchemaCheck`): drift-version, root kind
 *    9078, content cap 1000 chars
 *  - Sanity check (Barney HIGH #1): top-level reply onde `e[1] !== E[1]`
 *    é REJEITADO (atacante anexa reply cross-post pra free-ride visib.)
 *  - Idempotência: INSERT OR IGNORE — mesmo evento N relays não
 *    duplica
 *  - Pipeline: kind 1111 com schema inválido NÃO chega ao INSERT
 *
 * Tests rodam em Node, não browser. Mockam db + verifyDriftEvent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))
vi.mock('../src/lib/nostr', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/nostr')>(
    '../src/lib/nostr',
  )
  return { ...actual, verifyDriftEvent: vi.fn(() => true) }
})
vi.mock('../src/lib/scoring', () => ({ calculateScoreNow: vi.fn(() => 0) }))
vi.mock('../src/lib/feed', () => ({ invalidateFeed: vi.fn() }))
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))
vi.mock('../src/lib/weight', () => ({
  calculateUserWeight: vi.fn(async () => ({ weight: 0.5 })),
  calculateWeight: vi.fn(() => 0),
}))

import {
  onNostrEvent,
  parseNip22Comment,
  passesNip22SchemaCheck,
  passesSchemaCheck,
  NIP22_COMMENT_KIND,
  COMMENT_MAX_CHARS,
} from '../src/lib/events'
import { db } from '../src/lib/db'
import type { SignedEvent } from '../src/types/nostr'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

const POST_ID = 'a'.repeat(64)
const POST_AUTHOR = 'b'.repeat(64)
const COMMENTER = 'c'.repeat(64)
const OTHER_POST = 'd'.repeat(64)
const OTHER_AUTHOR = 'e'.repeat(64)
const PARENT_COMMENT = 'f'.repeat(64)
const COMMENT_ID = '1'.repeat(64)

function buildCommentEvent(opts: {
  id?: string
  rootId?: string
  rootKind?: string
  rootPub?: string
  parentId?: string
  parentKind?: string
  parentPub?: string
  driftVersion?: string | null
  content?: string
  pubkey?: string
}): SignedEvent {
  const tags: string[][] = []
  tags.push(['E', opts.rootId ?? POST_ID, '', opts.rootPub ?? POST_AUTHOR])
  tags.push(['K', opts.rootKind ?? '9078'])
  tags.push(['P', opts.rootPub ?? POST_AUTHOR])
  tags.push(['e', opts.parentId ?? POST_ID, '', opts.parentPub ?? POST_AUTHOR])
  tags.push(['k', opts.parentKind ?? '9078'])
  tags.push(['p', opts.parentPub ?? POST_AUTHOR])
  if (opts.driftVersion !== null) {
    tags.push(['drift-version', opts.driftVersion ?? '1'])
  }
  return {
    id: opts.id ?? COMMENT_ID,
    pubkey: opts.pubkey ?? COMMENTER,
    created_at: 1714000000,
    kind: NIP22_COMMENT_KIND,
    tags,
    content: opts.content ?? 'Olá, mundo',
    sig: '0'.repeat(128),
  }
}

beforeEach(() => {
  dbMock.run.mockReset()
  dbMock.exec.mockReset()
  dbMock.get.mockReset()
  dbMock.run.mockResolvedValue(undefined)
  dbMock.exec.mockResolvedValue([])
  dbMock.get.mockResolvedValue(null)
})

describe('parseNip22Comment (puro)', () => {
  it('parseia tags E/K/P/e/k/p válidas', () => {
    const ev = buildCommentEvent({})
    const parsed = parseNip22Comment(ev)
    expect(parsed).not.toBeNull()
    expect(parsed!.rootEventId).toBe(POST_ID)
    expect(parsed!.rootKind).toBe('9078')
    expect(parsed!.rootPubkey).toBe(POST_AUTHOR)
    expect(parsed!.parentEventId).toBe(POST_ID)
    expect(parsed!.parentKind).toBe('9078')
    expect(parsed!.parentPubkey).toBe(POST_AUTHOR)
  })

  it('null se faltar tag E (root)', () => {
    const ev = buildCommentEvent({})
    ev.tags = ev.tags.filter((t) => t[0] !== 'E')
    expect(parseNip22Comment(ev)).toBeNull()
  })

  it('null se faltar tag e minúscula (parent direto)', () => {
    const ev = buildCommentEvent({})
    ev.tags = ev.tags.filter((t) => t[0] !== 'e')
    expect(parseNip22Comment(ev)).toBeNull()
  })

  it('null se rootEventId não é hex 64', () => {
    const ev = buildCommentEvent({ rootId: 'not-hex' })
    expect(parseNip22Comment(ev)).toBeNull()
  })

  it('null se parentPubkey não é hex 64', () => {
    const ev = buildCommentEvent({ parentPub: 'short' })
    expect(parseNip22Comment(ev)).toBeNull()
  })

  it('reply nested — parent kind 1111 e parent id distinto do root', () => {
    const ev = buildCommentEvent({
      parentId: PARENT_COMMENT,
      parentKind: '1111',
      parentPub: COMMENTER,
    })
    const parsed = parseNip22Comment(ev)
    expect(parsed).not.toBeNull()
    expect(parsed!.rootEventId).toBe(POST_ID)
    expect(parsed!.parentEventId).toBe(PARENT_COMMENT)
    expect(parsed!.parentKind).toBe('1111')
  })
})

describe('passesNip22SchemaCheck', () => {
  it('aceita comment válido', () => {
    expect(passesNip22SchemaCheck(buildCommentEvent({}))).toBe(true)
  })

  it('rejeita sem drift-version', () => {
    const ev = buildCommentEvent({ driftVersion: null })
    expect(passesNip22SchemaCheck(ev)).toBe(false)
  })

  it('rejeita content vazio', () => {
    const ev = buildCommentEvent({ content: '' })
    expect(passesNip22SchemaCheck(ev)).toBe(false)
  })

  it('rejeita content > COMMENT_MAX_CHARS', () => {
    const ev = buildCommentEvent({ content: 'x'.repeat(COMMENT_MAX_CHARS + 1) })
    expect(passesNip22SchemaCheck(ev)).toBe(false)
  })

  it('aceita content exatamente no cap', () => {
    const ev = buildCommentEvent({ content: 'x'.repeat(COMMENT_MAX_CHARS) })
    expect(passesNip22SchemaCheck(ev)).toBe(true)
  })

  it('rejeita rootKind != 9078 (Drift só aceita comment em post Drift)', () => {
    const ev = buildCommentEvent({ rootKind: '1' }) // kind 1 = note Nostr clássica
    expect(passesNip22SchemaCheck(ev)).toBe(false)
  })

  it('passesSchemaCheck (entry point) também aceita kind 1111 válido', () => {
    expect(passesSchemaCheck(buildCommentEvent({}))).toBe(true)
  })
})

describe('persistCommentRow via onNostrEvent (sanity check)', () => {
  it('persiste comment top-level válido (E[1] === e[1])', async () => {
    const ev = buildCommentEvent({})
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(1)
    const params = calls[0]![1] as unknown[]
    expect(params[0]).toBe(COMMENT_ID) // id
    expect(params[1]).toBe(POST_ID) // post_id
    expect(params[2]).toBe(POST_ID) // reply_to (top-level)
    expect(params[3]).toBe(COMMENTER) // author_pub
    expect(params[4]).toBe('Olá, mundo') // content
  })

  it('REJEITA top-level reply onde e[1] !== E[1] (Barney HIGH #1)', async () => {
    // Atacante: declara root como POST_ID mas anexa o `e` direct parent
    // a OTHER_POST. Sem sanity check, free-ride visibilidade.
    const ev = buildCommentEvent({
      rootId: POST_ID,
      parentId: OTHER_POST,
      parentKind: '9078', // top-level → exige equal
      parentPub: OTHER_AUTHOR,
    })
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(0) // silently dropped
  })

  it('REJEITA top-level reply onde p[1] !== P[1] (atacante mente author do parent)', async () => {
    const ev = buildCommentEvent({
      parentKind: '9078',
      parentPub: OTHER_AUTHOR, // P diz POST_AUTHOR mas p diz OTHER_AUTHOR
    })
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(0)
  })

  it('aceita reply nested (parent kind=1111) mesmo se parent_id != root', async () => {
    // Reply a outro comment é válido — parentId é o id do comment-pai,
    // não bate com root. Manifesto §16 (compromisso disponibilidade):
    // parent pode ainda não ter chegado; buildThread trata.
    const ev = buildCommentEvent({
      parentId: PARENT_COMMENT,
      parentKind: '1111',
      parentPub: COMMENTER,
    })
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(1)
    const params = calls[0]![1] as unknown[]
    expect(params[1]).toBe(POST_ID) // post_id (root)
    expect(params[2]).toBe(PARENT_COMMENT) // reply_to (parent direto)
  })

  it('idempotência: INSERT OR IGNORE — query usa OR IGNORE (relay duplicado não duplica row)', async () => {
    const ev = buildCommentEvent({})
    await onNostrEvent(ev)
    await onNostrEvent(ev) // mesmo evento via outro relay
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(2) // 2 chamadas ao db
    // Mas SQL é IGNORE — segundo INSERT é no-op real. Garante a forma:
    for (const call of calls) {
      expect(String(call[0])).toMatch(/INSERT OR IGNORE INTO comments/)
    }
  })

  it('schema inválido NÃO chega no INSERT (drift-version ausente)', async () => {
    const ev = buildCommentEvent({ driftVersion: null })
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(0)
  })

  it('content > cap rejeitado antes do INSERT', async () => {
    const ev = buildCommentEvent({ content: 'x'.repeat(COMMENT_MAX_CHARS + 1) })
    await onNostrEvent(ev)
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(0)
  })
})
