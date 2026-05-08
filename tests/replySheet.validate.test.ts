/**
 * Tests pra `validateCommentText` — helper puro de ReplySheet (Track C.4.4).
 *
 * Cobre os 4 cenários que governam habilitação do botão "publicar":
 *   - empty       → ok=false reason=empty
 *   - whitespace  → ok=false reason=whitespace
 *   - too-long    → ok=false reason=too-long (após trim)
 *   - happy-path  → ok=true trimmed
 *
 * UI inteira de ReplySheet (framer-motion + DOM) NÃO é coberta — Vitest
 * roda em Node sem JSDOM React-friendly aqui. Smoke manual no dev server.
 */

import { describe, it, expect } from 'vitest'
import { validateCommentText } from '../src/components/Post/ReplySheet'
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
