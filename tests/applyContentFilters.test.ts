import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks: db (worker), follows (Zustand store), moderation-local (Zustand store).
vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))

let mockHiddenReason: 'blocked' | 'muted' | null = null
vi.mock('../src/lib/moderation-local', () => ({
  hiddenReason: () => mockHiddenReason,
}))

vi.mock('../src/lib/follows', () => ({
  useFollowsStore: { getState: () => ({ following: new Set<string>() }) },
}))

import { applyContentFilters } from '../src/lib/feed'
import { DEFAULT_USER_PREFS, type Post, type UserPrefs } from '../src/types/drift'

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    authorPub: 'a'.repeat(64),
    content: '',
    subposts: [],
    createdAt: 1714000000,
    category: null,
    location: null,
    client: null,
    contentWarning: null,
    score: 0,
    spreads: 0,
    buries: 0,
    ...overrides,
  }
}

const PREFS_DEFAULT: UserPrefs = { ...DEFAULT_USER_PREFS }

describe('applyContentFilters', () => {
  beforeEach(() => {
    mockHiddenReason = null
  })

  it('post sem aviso e sem block → renderiza normal', () => {
    const hint = applyContentFilters(makePost(), PREFS_DEFAULT)
    expect(hint).toEqual({ blur: false, hide: false, reason: null })
  })

  it('autor bloqueado vence tudo (hide total, modReason: blocked)', () => {
    mockHiddenReason = 'blocked'
    const hint = applyContentFilters(
      makePost({ contentWarning: 'nsfw' }),
      PREFS_DEFAULT,
    )
    expect(hint.hide).toBe(true)
    expect(hint.modReason).toBe('blocked')
    expect(hint.reason).toBe(null) // não é content-warning, é mod local
  })

  it('autor silenciado também esconde (modReason: muted)', () => {
    mockHiddenReason = 'muted'
    const hint = applyContentFilters(makePost(), PREFS_DEFAULT)
    expect(hint.hide).toBe(true)
    expect(hint.modReason).toBe('muted')
  })

  describe('NSFW (manifesto §27)', () => {
    it('post nsfw com show_nsfw_default=false → blur', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'nsfw' }),
        { ...PREFS_DEFAULT, show_nsfw_default: false },
      )
      expect(hint).toEqual({ blur: true, hide: false, reason: 'nsfw' })
    })

    it('post nsfw com show_nsfw_default=true → sem blur', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'nsfw' }),
        { ...PREFS_DEFAULT, show_nsfw_default: true },
      )
      expect(hint.blur).toBe(false)
      expect(hint.hide).toBe(false)
    })
  })

  describe('Violence', () => {
    it('post violence segue o mesmo toggle de nsfw (manifesto §27)', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'violence' }),
        { ...PREFS_DEFAULT, show_nsfw_default: false },
      )
      expect(hint).toEqual({ blur: true, hide: false, reason: 'violence' })
    })

    it('violence sem blur quando show_nsfw_default=true', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'violence' }),
        { ...PREFS_DEFAULT, show_nsfw_default: true },
      )
      expect(hint.blur).toBe(false)
    })
  })

  describe('Spoiler', () => {
    it('spoiler com hide_spoilers=true → hide', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'spoiler' }),
        { ...PREFS_DEFAULT, hide_spoilers: true },
      )
      expect(hint).toEqual({ blur: false, hide: true, reason: 'spoiler' })
    })

    it('spoiler com hide_spoilers=false → mostra normal', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'spoiler' }),
        { ...PREFS_DEFAULT, hide_spoilers: false },
      )
      expect(hint.hide).toBe(false)
      expect(hint.blur).toBe(false)
    })
  })

  describe('Ad', () => {
    it('ad com hide_ads=true → hide', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'ad' }),
        { ...PREFS_DEFAULT, hide_ads: true },
      )
      expect(hint).toEqual({ blur: false, hide: true, reason: 'ad' })
    })

    it('ad com hide_ads=false → mostra (default)', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'ad' }),
        { ...PREFS_DEFAULT, hide_ads: false },
      )
      expect(hint.hide).toBe(false)
    })
  })

  describe('warnings desconhecidos', () => {
    it("string livre não-canônica não dispara blur/hide automático", () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: 'política' }),
        PREFS_DEFAULT,
      )
      expect(hint).toEqual({ blur: false, hide: false, reason: null })
    })

    it('string vazia ignorada', () => {
      const hint = applyContentFilters(
        makePost({ contentWarning: '' }),
        PREFS_DEFAULT,
      )
      expect(hint.blur).toBe(false)
    })
  })
})
