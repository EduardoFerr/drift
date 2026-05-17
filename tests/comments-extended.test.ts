/**
 * Track C.6.2 + C.6.3 — extended schema/protocol/persist tests.
 *
 * Cobre:
 *   - protocol.commentOnPost emite tag `content-warning` quando passada
 *   - protocol.commentOnPost emite tag(s) `imeta` na ordem do array
 *   - persistCommentRow extrai `content-warning` e inclui no INSERT
 *   - applyContentFiltersComment retorna RenderHint correto
 *   - schema_v=9 marker presente no source
 *
 * Tests rodam em Node, sem browser. Mockam db + nostr-tools sign/verify.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Mocks compartilhados ─────────────────────────────────────────────

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))
vi.mock('../src/lib/nostr', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/nostr')>(
    '../src/lib/nostr',
  )
  return {
    ...actual,
    verifyDriftEvent: vi.fn(() => true),
    // signDriftEvent + publishToRelays não são chamados pelos tests do
    // protocol porque cobrimos via inspection direta de `commentOnPost`
    // input → tags. Mas alguns paths tocam — stub seguros:
    signDriftEvent: vi.fn(async (template) => ({
      ...template,
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: '0'.repeat(128),
      created_at: Math.floor(Date.now() / 1000),
    })),
    publishToRelays: vi.fn(async () => undefined),
  }
})
// 2026-05-16: verify movido pra worker (Ted RFC) — events.ts consome
// verifyEventAsync de verify.ts em vez de verifyDriftEvent de nostr.ts.
vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: vi.fn(async () => true),
}))
vi.mock('../src/lib/scoring', () => ({ calculateScoreNow: vi.fn(() => 0) }))
vi.mock('../src/lib/feed', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/feed')>(
    '../src/lib/feed',
  )
  return { ...actual, invalidateFeed: vi.fn() }
})
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))
vi.mock('../src/lib/weight', () => ({
  calculateUserWeight: vi.fn(async () => ({ weight: 0.5 })),
  calculateWeight: vi.fn(() => 0),
}))
let mockHiddenReason: 'blocked' | 'muted' | null = null
vi.mock('../src/lib/moderation-local', () => ({
  hiddenReason: () => mockHiddenReason,
}))
vi.mock('../src/lib/follows', () => ({
  useFollowsStore: { getState: () => ({ following: new Set<string>() }) },
}))

import { commentOnPost } from '../src/lib/protocol'
import {
  onNostrEvent,
  NIP22_COMMENT_KIND,
} from '../src/lib/events'
import { applyContentFiltersComment } from '../src/lib/feed'
import { DEFAULT_USER_PREFS } from '../src/types/drift'
import { db } from '../src/lib/db'
import { signDriftEvent } from '../src/lib/nostr'
import type { SignedEvent } from '../src/types/nostr'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}
const signMock = signDriftEvent as unknown as ReturnType<typeof vi.fn>

const POST_ID = 'a'.repeat(64)
const POST_AUTHOR = 'b'.repeat(64)
const COMMENTER = 'c'.repeat(64)
const COMMENT_ID = '1'.repeat(64)

beforeEach(() => {
  dbMock.run.mockReset()
  dbMock.exec.mockReset()
  dbMock.get.mockReset()
  dbMock.run.mockResolvedValue(undefined)
  dbMock.exec.mockResolvedValue([])
  dbMock.get.mockResolvedValue(null)
  signMock.mockClear()
  mockHiddenReason = null
})

// ─── C.6.2 — content-warning ──────────────────────────────────────────

describe('commentOnPost — content-warning (C.6.2)', () => {
  it('emite tag content-warning quando contentWarning passado', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
      contentWarning: 'nsfw',
    })
    expect(signMock).toHaveBeenCalledTimes(1)
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    const cw = template.tags.find((t) => t[0] === 'content-warning')
    expect(cw).toEqual(['content-warning', 'nsfw'])
  })

  it('NÃO emite tag content-warning quando ausente', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
    })
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    const cw = template.tags.find((t) => t[0] === 'content-warning')
    expect(cw).toBeUndefined()
  })

  it('aceita string livre (manifesto §27 — autor classifica)', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
      contentWarning: 'gore-extremo',
    })
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    const cw = template.tags.find((t) => t[0] === 'content-warning')
    expect(cw).toEqual(['content-warning', 'gore-extremo'])
  })
})

describe('persistCommentRow — content_warning column (C.6.2)', () => {
  function buildCommentEvent(opts: { contentWarning?: string }): SignedEvent {
    const tags: string[][] = [
      ['E', POST_ID, '', POST_AUTHOR],
      ['K', '9078'],
      ['P', POST_AUTHOR],
      ['e', POST_ID, '', POST_AUTHOR],
      ['k', '9078'],
      ['p', POST_AUTHOR],
      ['drift-version', '1'],
    ]
    if (opts.contentWarning) {
      tags.push(['content-warning', opts.contentWarning])
    }
    return {
      id: COMMENT_ID,
      pubkey: COMMENTER,
      created_at: 1714000000,
      kind: NIP22_COMMENT_KIND,
      tags,
      content: 'oi',
      sig: '0'.repeat(128),
    }
  }

  it('inclui content_warning no INSERT quando tag presente', async () => {
    await onNostrEvent(buildCommentEvent({ contentWarning: 'spoiler' }))
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(1)
    const sql = String(calls[0]![0])
    expect(sql).toContain('content_warning')
    const params = calls[0]![1] as unknown[]
    // content_warning é o último param (após raw_event)
    expect(params[params.length - 1]).toBe('spoiler')
  })

  it('content_warning = null quando tag ausente', async () => {
    await onNostrEvent(buildCommentEvent({}))
    const calls = dbMock.run.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT OR IGNORE INTO comments'),
    )
    expect(calls.length).toBe(1)
    const params = calls[0]![1] as unknown[]
    expect(params[params.length - 1]).toBe(null)
  })
})

// ─── C.6.3 — imeta tags ───────────────────────────────────────────────

describe('commentOnPost — imeta tags (C.6.3)', () => {
  it('emite tag imeta quando blob meta passado', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
      imetas: [
        {
          url: 'https://nostr.build/i/abc.jpg',
          hash: 'e'.repeat(64),
          mime: 'image/jpeg',
          size: 12345,
        },
      ],
    })
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    const imeta = template.tags.find((t) => t[0] === 'imeta')
    expect(imeta).toBeDefined()
    expect(imeta!).toContain('url https://nostr.build/i/abc.jpg')
    expect(imeta!).toContain(`x ${'e'.repeat(64)}`)
    expect(imeta!).toContain('m image/jpeg')
    expect(imeta!).toContain('size 12345')
  })

  it('NÃO emite imeta quando array vazio ou ausente', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
      imetas: [],
    })
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    const imeta = template.tags.find((t) => t[0] === 'imeta')
    expect(imeta).toBeUndefined()
  })

  it('imeta sem url nem cid é silenciosamente puladada (não derruba publish)', async () => {
    await commentOnPost({
      postId: POST_ID,
      postAuthorPub: POST_AUTHOR,
      replyTo: POST_ID,
      replyToKind: '9078',
      replyToAuthorPub: POST_AUTHOR,
      text: 'oi',
      // @ts-expect-error — força meta inválida pra teste de robustez
      imetas: [{ mime: 'image/jpeg' }],
    })
    expect(signMock).toHaveBeenCalledTimes(1) // ainda publicou
    const template = signMock.mock.calls[0]![0] as { tags: string[][] }
    expect(template.tags.find((t) => t[0] === 'imeta')).toBeUndefined()
  })
})

// ─── applyContentFiltersComment ───────────────────────────────────────

describe('applyContentFiltersComment (C.6.2)', () => {
  it('sem content-warning retorna {blur:false, hide:false}', () => {
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: null },
      DEFAULT_USER_PREFS,
    )
    expect(hint).toEqual({ blur: false, hide: false, reason: null })
  })

  it('nsfw com prefs default → blur', () => {
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: 'nsfw' },
      DEFAULT_USER_PREFS,
    )
    expect(hint.blur).toBe(true)
    expect(hint.hide).toBe(false)
    expect(hint.reason).toBe('nsfw')
  })

  it('nsfw com show_nsfw_default=true → sem blur', () => {
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: 'nsfw' },
      { ...DEFAULT_USER_PREFS, show_nsfw_default: true },
    )
    expect(hint.blur).toBe(false)
    expect(hint.hide).toBe(false)
  })

  it('spoiler com hide_spoilers=true (default) → hide', () => {
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: 'spoiler' },
      DEFAULT_USER_PREFS,
    )
    expect(hint.hide).toBe(true)
    expect(hint.reason).toBe('spoiler')
  })

  it('autor bloqueado → hide com modReason "blocked", mesmo sem CW', () => {
    mockHiddenReason = 'blocked'
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: null },
      DEFAULT_USER_PREFS,
    )
    expect(hint.hide).toBe(true)
    expect(hint.modReason).toBe('blocked')
  })

  it('string livre desconhecida → renderiza normal (sem blur/hide)', () => {
    const hint = applyContentFiltersComment(
      { authorPub: POST_AUTHOR, contentWarning: 'gore-extremo' },
      DEFAULT_USER_PREFS,
    )
    expect(hint.blur).toBe(false)
    expect(hint.hide).toBe(false)
  })
})

// ─── Schema migration v9 ──────────────────────────────────────────────

describe('schema migration v9 (C.6.2)', () => {
  it('schema.sql declara coluna content_warning em comments', () => {
    const sql = readFileSync(
      resolve(__dirname, '../src/lib/schema.sql'),
      'utf-8',
    )
    // Match a coluna content_warning dentro do bloco CREATE TABLE comments.
    const commentsBlock = sql.match(
      /CREATE TABLE IF NOT EXISTS comments[\s\S]*?\);/,
    )
    expect(commentsBlock).not.toBeNull()
    expect(commentsBlock![0]).toMatch(/content_warning\s+TEXT/)
  })

  it('db.worker.ts registra migração add_content_warning_to_comments', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/lib/db.worker.ts'),
      'utf-8',
    )
    expect(src).toContain('add_content_warning_to_comments')
    expect(src).toMatch(/ALTER TABLE comments ADD COLUMN content_warning TEXT/)
  })

  it('db.worker.ts marker bumpado em schema_v ≥ 10 (Round Comments Nav Phase A)', () => {
    // schema_v=9: content_warning em comments (Track C.6.2) — coluna ainda
    // alterada idempotente no apply loop.
    // schema_v=10: thread_view_mode em user_prefs (key/value, sem DDL).
    // schema_v=11: Trust Lens Phase 1 (lens_edges/lens_walks_cache/
    // lens_filter_rules) — marker bumpado.
    // Forward-only migrations: validar que marker é >=10 (latest).
    const src = readFileSync(
      resolve(__dirname, '../src/lib/db.worker.ts'),
      'utf-8',
    )
    const match = src.match(/'schema_v',\s*'(\d+)'/)
    expect(match).not.toBeNull()
    const version = parseInt(match![1] ?? '0', 10)
    expect(version).toBeGreaterThanOrEqual(10)
  })
})
