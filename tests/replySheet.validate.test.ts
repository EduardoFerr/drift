/**
 * Tests pra helpers puros de ReplySheet (Track C.4.4 + UX-3 audit Robin).
 *
 * `validateCommentText` — 4 cenários que governam o botão "publicar":
 *   - empty       → ok=false reason=empty
 *   - whitespace  → ok=false reason=whitespace
 *   - too-long    → ok=false reason=too-long (após trim)
 *   - happy-path  → ok=true trimmed
 *
 * `resolveReplyTarget` — UX-3 (Robin audit 2026-05-08):
 *   - snapshot vence sobre live (defesa contra cursor mudar mid-typing)
 *   - null snapshot cai pros props live (compat / defesa pré-effect)
 *
 * UI inteira de ReplySheet (framer-motion + DOM) NÃO é coberta — Vitest
 * roda em Node sem JSDOM React-friendly aqui. Smoke manual no dev server.
 */

import { describe, it, expect } from 'vitest'
import {
  validateCommentText,
  resolveReplyTarget,
  type ReplyTargetSnapshot,
} from '../src/components/Post/ReplySheet'
import { COMMENT_MAX_CHARS } from '../src/lib/protocol'

describe('validateCommentText', () => {
  it('rejeita string vazia', () => {
    const r = validateCommentText('')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
  })

  it('rejeita só whitespace', () => {
    const r = validateCommentText('   \n\t  ')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('whitespace')
  })

  it('aceita texto válido e retorna trimmed', () => {
    const r = validateCommentText('  oi mundo  ')
    expect(r.ok).toBe(true)
    expect(r.trimmed).toBe('oi mundo')
  })

  it('rejeita texto > COMMENT_MAX_CHARS após trim', () => {
    const longText = 'a'.repeat(COMMENT_MAX_CHARS + 1)
    const r = validateCommentText(longText)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too-long')
  })

  it('aceita exatamente COMMENT_MAX_CHARS chars', () => {
    const r = validateCommentText('a'.repeat(COMMENT_MAX_CHARS))
    expect(r.ok).toBe(true)
    expect(r.trimmed?.length).toBe(COMMENT_MAX_CHARS)
  })
})

// ─── UX-3 (Robin audit 2026-05-08) — replyTarget snapshot ──────────────

describe('resolveReplyTarget — UX-3 snapshot vence sobre live', () => {
  const X = 'x'.repeat(64) // alvo capturado ao open
  const Y = 'y'.repeat(64) // alvo "live" (cursor mudou silenciosamente)
  const PUB_X = 'a'.repeat(64)
  const PUB_Y = 'b'.repeat(64)

  it('snapshot null → cai pros props live (defesa pré-effect)', () => {
    const live: ReplyTargetSnapshot = {
      replyTo: Y,
      replyToKind: 1111,
      replyToAuthorPub: PUB_Y,
    }
    const r = resolveReplyTarget(null, live)
    expect(r).toEqual(live)
  })

  it('snapshot presente → snapshot vence mesmo com live divergente em todos os campos', () => {
    // Cenário UX-3: user abre sheet com cursor em comment X (kind 1111,
    // autor PUB_X). Durante typing, cursor truncate pra Y (kind 1111
    // diferente, autor diferente). doPublish DEVE usar X.
    const snapshot: ReplyTargetSnapshot = {
      replyTo: X,
      replyToKind: 1111,
      replyToAuthorPub: PUB_X,
    }
    const live: ReplyTargetSnapshot = {
      replyTo: Y,
      replyToKind: 1111,
      replyToAuthorPub: PUB_Y,
    }
    const r = resolveReplyTarget(snapshot, live)
    expect(r.replyTo).toBe(X)
    expect(r.replyToAuthorPub).toBe(PUB_X)
    expect(r.replyToKind).toBe(1111)
  })

  it('snapshot vence quando cursor truncate de comment (1111) pra post (9078)', () => {
    // Caso real: user respondendo @alice (1111). Mod hide chega → cursor
    // truncate; ThreadView passa novos props (post root, kind 9078).
    // Sheet ainda deve publicar pra @alice, NÃO virar top-level.
    const snapshot: ReplyTargetSnapshot = {
      replyTo: X,
      replyToKind: 1111,
      replyToAuthorPub: PUB_X,
    }
    const live: ReplyTargetSnapshot = {
      replyTo: Y, // post root
      replyToKind: 9078,
      replyToAuthorPub: PUB_Y, // post author
    }
    const r = resolveReplyTarget(snapshot, live)
    expect(r.replyTo).toBe(X)
    expect(r.replyToKind).toBe(1111)
    expect(r.replyToAuthorPub).toBe(PUB_X)
  })

  it('é referencialmente puro — não muta inputs', () => {
    const snapshot: ReplyTargetSnapshot = {
      replyTo: X,
      replyToKind: 1111,
      replyToAuthorPub: PUB_X,
    }
    const snapshotCopy = { ...snapshot }
    const live: ReplyTargetSnapshot = {
      replyTo: Y,
      replyToKind: 9078,
      replyToAuthorPub: PUB_Y,
    }
    const liveCopy = { ...live }
    resolveReplyTarget(snapshot, live)
    expect(snapshot).toEqual(snapshotCopy)
    expect(live).toEqual(liveCopy)
  })
})
