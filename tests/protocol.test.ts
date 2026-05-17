/**
 * Tests for src/lib/protocol.ts — Drift event creation (kinds 9078-9081 + NIP-22 1111).
 *
 * protocol.ts calls signDriftEvent (signs with nsec) and publishToRelays
 * (pushes to relays). Both are mocked — we test the event SHAPE, not
 * signing or network. The contract under test:
 *
 *  - Each function produces the correct kind number
 *  - Tags are properly structured per Drift spec (CLAUDE.md §Os 4 kinds)
 *  - POST content is valid JSON with subposts array
 *  - SPREAD/BURY/REPORT have correct e/p tags
 *  - drift-version tag is present on POST
 *  - location tag format is correct when provided
 *  - content-warning tag propagates
 *  - commentOnPost validation (empty text, max chars)
 *  - NIP-22 tag structure (E/K/P root + e/k/p parent)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────

// Capture the event passed to signDriftEvent so we can inspect kind/tags/content
// without needing real crypto.
let lastSignInput: { kind: number; tags: string[][]; content: string } | null = null
// Captura TODOS os signs do call atual — pra reportPost (dual emit
// kind 9081 + kind 1984 NIP-56) e qualquer outro flow que assine N>1.
const allSignInputs: Array<{ kind: number; tags: string[][]; content: string }> = []

vi.mock('../src/lib/nostr', () => ({
  signDriftEvent: vi.fn(async (input: { kind: number; tags: string[][]; content: string }) => {
    lastSignInput = input
    allSignInputs.push(input)
    return {
      id: '0'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 1714000000,
      kind: input.kind,
      tags: input.tags,
      content: input.content,
      sig: 'f'.repeat(128),
    }
  }),
  publishToRelays: vi.fn(async () => ({ ok: true, failures: [] })),
}))

beforeEach(() => {
  lastSignInput = null
  allSignInputs.length = 0
})

/** Helper pra encontrar o sign de kind específico no batch. */
function findSignByKind(kind: number) {
  return allSignInputs.find((s) => s.kind === kind)
}

// nip94 buildImetaTag is a pure function — let the real impl through
// (no side effects, already tested in nip94.test.ts).

import {
  createPost,
  spreadPost,
  buryPost,
  reportPost,
  commentOnPost,
  COMMENT_MAX_CHARS,
  COMMENT_IMAGE_ONLY_PLACEHOLDER,
} from '../src/lib/protocol'
import { DRIFT_KIND, DRIFT_VERSION, CLIENT_ID } from '../src/config/constants'
import type { GeoPoint } from '../src/types/drift'

// ─── Helpers ────────────────────────────────────────────────────────────

const HEX64 = 'a'.repeat(64)
const HEX64_B = 'b'.repeat(64)

const SAMPLE_LOCATION: GeoPoint = {
  lat: -23.5505,
  lng: -46.6333,
  city: 'Sao Paulo',
  country: 'BR',
}

function findTag(tags: string[][], name: string): string[] | undefined {
  return tags.find((t) => t[0] === name)
}

function findAllTags(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name)
}

// ─── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  lastSignInput = null
  vi.clearAllMocks()
})

describe('createPost (kind 9078)', () => {
  it('produces kind 9078 (DRIFT_KIND.POST)', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hello', imageUrl: null, order: 0 }],
    })
    expect(lastSignInput!.kind).toBe(DRIFT_KIND.POST)
    expect(lastSignInput!.kind).toBe(9078)
  })

  it('includes drift-version tag', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hello', imageUrl: null, order: 0 }],
    })
    const tag = findTag(lastSignInput!.tags, 'drift-version')
    expect(tag).toBeDefined()
    expect(tag![1]).toBe(DRIFT_VERSION)
  })

  it('includes client tag', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
    })
    const tag = findTag(lastSignInput!.tags, 'client')
    expect(tag).toBeDefined()
    expect(tag![1]).toBe(CLIENT_ID)
  })

  it('content is valid JSON with subposts array', async () => {
    const subposts = [
      { id: 's1', type: 'text' as const, text: 'first', imageUrl: null, order: 0 },
      { id: 's2', type: 'image' as const, text: null, imageUrl: 'https://nostr.build/i/x.jpg', order: 1 },
    ]
    await createPost({ subposts })
    const parsed = JSON.parse(lastSignInput!.content)
    expect(parsed).toHaveProperty('subposts')
    expect(Array.isArray(parsed.subposts)).toBe(true)
    expect(parsed.subposts).toHaveLength(2)
    expect(parsed.subposts[0].text).toBe('first')
    expect(parsed.subposts[1].imageUrl).toBe('https://nostr.build/i/x.jpg')
  })

  it('normalizes layout in subposts (undefined becomes default)', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
    })
    const parsed = JSON.parse(lastSignInput!.content)
    // normalizeLayout maps undefined → 'portrait' (DEFAULT_LAYOUT)
    expect(parsed.subposts[0].layout).toBe('portrait')
  })

  it('preserves explicit layout values', async () => {
    await createPost({
      subposts: [
        { id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0, layout: 'landscape' },
        { id: '2', type: 'text', text: 'ho', imageUrl: null, order: 1, layout: 'text' },
      ],
    })
    const parsed = JSON.parse(lastSignInput!.content)
    expect(parsed.subposts[0].layout).toBe('landscape')
    expect(parsed.subposts[1].layout).toBe('text')
  })

  it('includes category tag when provided', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
      category: 'tech',
    })
    const tag = findTag(lastSignInput!.tags, 'category')
    expect(tag).toEqual(['category', 'tech'])
  })

  it('omits category tag when not provided', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
    })
    expect(findTag(lastSignInput!.tags, 'category')).toBeUndefined()
  })

  it('includes content-warning tag when provided (manifesto §27)', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
      contentWarning: 'nsfw',
    })
    const tag = findTag(lastSignInput!.tags, 'content-warning')
    expect(tag).toEqual(['content-warning', 'nsfw'])
  })

  it('accepts free-form content-warning string', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
      contentWarning: 'custom-warning',
    })
    const tag = findTag(lastSignInput!.tags, 'content-warning')
    expect(tag).toEqual(['content-warning', 'custom-warning'])
  })

  it('includes location tag when provided', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
      location: SAMPLE_LOCATION,
    })
    const tag = findTag(lastSignInput!.tags, 'location')
    expect(tag).toBeDefined()
    expect(tag![0]).toBe('location')
    expect(tag![1]).toBe(String(SAMPLE_LOCATION.lat))
    expect(tag![2]).toBe(String(SAMPLE_LOCATION.lng))
    expect(tag![3]).toBe('Sao Paulo')
    expect(tag![4]).toBe('BR')
  })

  it('omits location tag when not provided', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
    })
    expect(findTag(lastSignInput!.tags, 'location')).toBeUndefined()
  })

  it('includes imeta tags when blobs provided (NIP-94 Track B.2)', async () => {
    await createPost({
      subposts: [{ id: '1', type: 'image', text: null, imageUrl: 'https://nostr.build/i/x.jpg', order: 0 }],
      imetas: [{ url: 'https://nostr.build/i/x.jpg', mime: 'image/jpeg' }],
    })
    const imetaTags = findAllTags(lastSignInput!.tags, 'imeta')
    expect(imetaTags).toHaveLength(1)
    expect(imetaTags[0]).toContain('url https://nostr.build/i/x.jpg')
    expect(imetaTags[0]).toContain('m image/jpeg')
  })

  it('skips malformed imeta without breaking (warns)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
      // BlobMeta without url or cid — buildImetaTag throws
      imetas: [{ hash: 'abc', mime: 'image/png' } as never],
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[protocol]'),
      expect.any(Error),
    )
    // Event still created (no imeta tags)
    expect(findAllTags(lastSignInput!.tags, 'imeta')).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('returns a SignedEvent-shaped object', async () => {
    const result = await createPost({
      subposts: [{ id: '1', type: 'text', text: 'hi', imageUrl: null, order: 0 }],
    })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('pubkey')
    expect(result).toHaveProperty('kind', 9078)
    expect(result).toHaveProperty('sig')
    expect(result).toHaveProperty('created_at')
    expect(result).toHaveProperty('tags')
    expect(result).toHaveProperty('content')
  })

  it('is deterministic given same input (tags order stable)', async () => {
    const input = {
      subposts: [{ id: '1', type: 'text' as const, text: 'hi', imageUrl: null, order: 0 }],
      category: 'art',
      contentWarning: 'nsfw' as const,
    }
    await createPost(input)
    const tags1 = [...lastSignInput!.tags]
    const content1 = lastSignInput!.content

    await createPost(input)
    const tags2 = [...lastSignInput!.tags]
    const content2 = lastSignInput!.content

    expect(tags1).toEqual(tags2)
    expect(content1).toBe(content2)
  })
})

describe('spreadPost (kind 9079)', () => {
  it('produces kind 9079 (DRIFT_KIND.SPREAD)', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    expect(lastSignInput!.kind).toBe(DRIFT_KIND.SPREAD)
    expect(lastSignInput!.kind).toBe(9079)
  })

  it('has e tag with postId (event reference NIP-01)', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    const eTag = findTag(lastSignInput!.tags, 'e')
    expect(eTag).toEqual(['e', HEX64])
  })

  it('has p tag with authorPub (pubkey reference NIP-01)', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    const pTag = findTag(lastSignInput!.tags, 'p')
    expect(pTag).toEqual(['p', HEX64_B])
  })

  it('content is empty string', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    expect(lastSignInput!.content).toBe('')
  })

  it('includes location tag when provided', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B, location: SAMPLE_LOCATION })
    const tag = findTag(lastSignInput!.tags, 'location')
    expect(tag).toBeDefined()
    expect(tag![1]).toBe(String(SAMPLE_LOCATION.lat))
  })

  it('omits location tag when not provided', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    expect(findTag(lastSignInput!.tags, 'location')).toBeUndefined()
  })

  it('does NOT include drift-version tag (spec: spread is minimal)', async () => {
    await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    expect(findTag(lastSignInput!.tags, 'drift-version')).toBeUndefined()
  })

  it('returns a SignedEvent with kind 9079', async () => {
    const result = await spreadPost({ postId: HEX64, authorPub: HEX64_B })
    expect(result.kind).toBe(9079)
  })
})

describe('buryPost (kind 9080)', () => {
  it('produces kind 9080 (DRIFT_KIND.BURY)', async () => {
    await buryPost({ postId: HEX64 })
    expect(lastSignInput!.kind).toBe(DRIFT_KIND.BURY)
    expect(lastSignInput!.kind).toBe(9080)
  })

  it('has e tag with postId', async () => {
    await buryPost({ postId: HEX64 })
    const eTag = findTag(lastSignInput!.tags, 'e')
    expect(eTag).toEqual(['e', HEX64])
  })

  it('does NOT have p tag (bury is silent — no author notification)', async () => {
    await buryPost({ postId: HEX64 })
    expect(findTag(lastSignInput!.tags, 'p')).toBeUndefined()
  })

  it('content is empty string', async () => {
    await buryPost({ postId: HEX64 })
    expect(lastSignInput!.content).toBe('')
  })

  it('has exactly one tag (just e)', async () => {
    await buryPost({ postId: HEX64 })
    expect(lastSignInput!.tags).toHaveLength(1)
  })

  it('does NOT include drift-version tag', async () => {
    await buryPost({ postId: HEX64 })
    expect(findTag(lastSignInput!.tags, 'drift-version')).toBeUndefined()
  })

  it('does NOT include location tag (bury has no location)', async () => {
    await buryPost({ postId: HEX64 })
    expect(findTag(lastSignInput!.tags, 'location')).toBeUndefined()
  })
})

describe('reportPost (dual emit kind 9081 Drift + kind 1984 NIP-56)', () => {
  it('produces kind 9081 (DRIFT_KIND.REPORT) — primário', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'spam' })
    const e9081 = findSignByKind(DRIFT_KIND.REPORT)
    expect(e9081).toBeDefined()
    expect(e9081!.kind).toBe(9081)
  })

  it('produces kind 1984 (NIP-56) — compat ecossistema', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'spam' })
    const e1984 = findSignByKind(1984)
    expect(e1984).toBeDefined()
    expect(e1984!.kind).toBe(1984)
  })

  it('kind 9081 tem e tag com postId', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'illegal' })
    const e9081 = findSignByKind(9081)!
    const eTag = findTag(e9081.tags, 'e')
    expect(eTag).toEqual(['e', HEX64])
  })

  it('kind 9081 tem p tag com authorPub', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'harassment' })
    const e9081 = findSignByKind(9081)!
    const pTag = findTag(e9081.tags, 'p')
    expect(pTag).toEqual(['p', HEX64_B])
  })

  it('kind 9081 tem reason tag com Drift reason', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'spam' })
    const e9081 = findSignByKind(9081)!
    const tag = findTag(e9081.tags, 'reason')
    expect(tag).toEqual(['reason', 'spam'])
  })

  it('content vazio em ambos os kinds', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'spam' })
    expect(findSignByKind(9081)!.content).toBe('')
    expect(findSignByKind(1984)!.content).toBe('')
  })

  it('mapeia ReportReason → NIP-56 report_type (illegal/spam/other)', async () => {
    const mapping: Record<string, string> = {
      illegal: 'illegal',
      spam: 'spam',
      harassment: 'other', // NIP-56 sem canônico
    }
    for (const reason of ['illegal', 'spam', 'harassment'] as const) {
      allSignInputs.length = 0
      await reportPost({ postId: HEX64, authorPub: HEX64_B, reason })
      const e1984 = findSignByKind(1984)!
      const eTag = e1984.tags.find((t) => t[0] === 'e')!
      // NIP-56: report_type no index [3] de e/p tag
      expect(eTag[3]).toBe(mapping[reason])
    }
  })

  it('kind 1984 tem drift-version tag (anti-weaponization cross-client)', async () => {
    await reportPost({ postId: HEX64, authorPub: HEX64_B, reason: 'spam' })
    const e1984 = findSignByKind(1984)!
    const dv = findTag(e1984.tags, 'drift-version')
    expect(dv).toBeDefined()
  })
})

describe('commentOnPost (kind 1111 NIP-22)', () => {
  const baseInput = {
    postId: HEX64,
    postAuthorPub: HEX64_B,
    replyTo: HEX64,
    replyToKind: '9078',
    replyToAuthorPub: HEX64_B,
    text: 'nice post!',
  }

  it('produces kind 1111', async () => {
    await commentOnPost(baseInput)
    expect(lastSignInput!.kind).toBe(1111)
  })

  it('content is the text body', async () => {
    await commentOnPost({ ...baseInput, text: 'hello world' })
    expect(lastSignInput!.content).toBe('hello world')
  })

  it('has NIP-22 root markers (uppercase E/K/P)', async () => {
    await commentOnPost(baseInput)
    const E = findTag(lastSignInput!.tags, 'E')
    const K = findTag(lastSignInput!.tags, 'K')
    const P = findTag(lastSignInput!.tags, 'P')
    expect(E).toBeDefined()
    expect(E![1]).toBe(HEX64)
    expect(E![3]).toBe(HEX64_B) // author hint
    expect(K![1]).toBe('9078')
    expect(P![1]).toBe(HEX64_B)
  })

  it('has NIP-22 parent markers (lowercase e/k/p)', async () => {
    await commentOnPost(baseInput)
    const e = findTag(lastSignInput!.tags, 'e')
    const k = findTag(lastSignInput!.tags, 'k')
    const p = findTag(lastSignInput!.tags, 'p')
    expect(e![1]).toBe(HEX64)
    expect(k![1]).toBe('9078')
    expect(p![1]).toBe(HEX64_B)
  })

  it('includes drift-version and client tags', async () => {
    await commentOnPost(baseInput)
    expect(findTag(lastSignInput!.tags, 'drift-version')![1]).toBe(DRIFT_VERSION)
    expect(findTag(lastSignInput!.tags, 'client')![1]).toBe(CLIENT_ID)
  })

  it('includes content-warning tag when provided', async () => {
    await commentOnPost({ ...baseInput, contentWarning: 'nsfw' })
    const tag = findTag(lastSignInput!.tags, 'content-warning')
    expect(tag).toEqual(['content-warning', 'nsfw'])
  })

  it('throws on empty text', async () => {
    await expect(commentOnPost({ ...baseInput, text: '' })).rejects.toThrow(/text vazio/)
  })

  it(`throws when text exceeds ${COMMENT_MAX_CHARS} chars`, async () => {
    const longText = 'x'.repeat(COMMENT_MAX_CHARS + 1)
    await expect(commentOnPost({ ...baseInput, text: longText })).rejects.toThrow(
      new RegExp(`excede ${COMMENT_MAX_CHARS}`),
    )
  })

  it(`accepts text at exactly ${COMMENT_MAX_CHARS} chars`, async () => {
    const exactText = 'x'.repeat(COMMENT_MAX_CHARS)
    await expect(commentOnPost({ ...baseInput, text: exactText })).resolves.toBeDefined()
  })

  it('COMMENT_IMAGE_ONLY_PLACEHOLDER is accepted as valid text', async () => {
    await expect(
      commentOnPost({ ...baseInput, text: COMMENT_IMAGE_ONLY_PLACEHOLDER }),
    ).resolves.toBeDefined()
  })

  it('nested reply uses different parent markers than root', async () => {
    const parentCommentId = 'c'.repeat(64)
    await commentOnPost({
      ...baseInput,
      replyTo: parentCommentId,
      replyToKind: '1111',
      replyToAuthorPub: 'd'.repeat(64),
    })
    // Root markers still point to original post
    expect(findTag(lastSignInput!.tags, 'E')![1]).toBe(HEX64)
    expect(findTag(lastSignInput!.tags, 'K')![1]).toBe('9078')
    // Parent markers point to the comment being replied to
    expect(findTag(lastSignInput!.tags, 'e')![1]).toBe(parentCommentId)
    expect(findTag(lastSignInput!.tags, 'k')![1]).toBe('1111')
    expect(findTag(lastSignInput!.tags, 'p')![1]).toBe('d'.repeat(64))
  })

  it('includes imeta tags for attached blobs (C.6.3)', async () => {
    await commentOnPost({
      ...baseInput,
      imetas: [{ url: 'https://nostr.build/i/reply.jpg', mime: 'image/jpeg' }],
    })
    const imetaTags = findAllTags(lastSignInput!.tags, 'imeta')
    expect(imetaTags).toHaveLength(1)
    expect(imetaTags[0]).toContain('url https://nostr.build/i/reply.jpg')
  })
})

describe('kind number conformance with DRIFT_KIND constants', () => {
  it('POST = 9078', () => expect(DRIFT_KIND.POST).toBe(9078))
  it('SPREAD = 9079', () => expect(DRIFT_KIND.SPREAD).toBe(9079))
  it('BURY = 9080', () => expect(DRIFT_KIND.BURY).toBe(9080))
  it('REPORT = 9081', () => expect(DRIFT_KIND.REPORT).toBe(9081))

  it('all kinds are in the regular event range (1-9999)', () => {
    for (const kind of Object.values(DRIFT_KIND)) {
      expect(kind).toBeGreaterThanOrEqual(1)
      expect(kind).toBeLessThanOrEqual(9999)
    }
  })
})
