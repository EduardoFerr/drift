// Feed queue cap + snapshot timestamp — LOCK_VIA_TEST.
//
// Source: Lily Tinder-audit 2026-05-21 (Docs/sessions/
// lily-tinder-audit-2026-05-21.md). Items 2 + 3 shipados nesta sprint.
//
// Item 2: Zustand `useFeedStore.posts` cap explícito (FEED_QUEUE_CAP)
//   defende mobile low-end contra OOM. SQLite eviction (cache.ts) é
//   outra camada — este test trava a camada Zustand.
//
// Item 3: snapshotTs rastreia momento da última refreshFeed. UI badge
//   mostra age quando >FEED_SNAPSHOT_STALE_MS pra resolver user
//   feedback 2026-05-08 (atualizar vs voltar ao topo eram opacos).
//
// Strategy: source-grep conformance (DB-backed tests exigem SQLite
// WASM init em Vitest Node, defer).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  FEED_INITIAL_LIMIT,
  FEED_QUEUE_CAP,
  FEED_SNAPSHOT_STALE_MS,
} from '../src/config/constants'

const FEED = readFileSync('src/lib/feed.ts', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

describe('Feed queue cap (Lily Item 2 — OOM defense)', () => {
  it('FEED_QUEUE_CAP >= FEED_INITIAL_LIMIT (invariante)', () => {
    expect(FEED_QUEUE_CAP).toBeGreaterThanOrEqual(FEED_INITIAL_LIMIT)
  })

  it('FEED_QUEUE_CAP é numero finito positivo', () => {
    expect(FEED_QUEUE_CAP).toBeGreaterThan(0)
    expect(Number.isFinite(FEED_QUEUE_CAP)).toBe(true)
  })

  it('feed.ts:refreshFeed aplica truncate quando rawPosts.length > FEED_QUEUE_CAP', () => {
    // Pattern: posts > CAP ? slice(0, CAP) : posts
    expect(FEED).toMatch(/rawPosts\.length\s*>\s*FEED_QUEUE_CAP/)
    expect(FEED).toMatch(/\.slice\(0,\s*FEED_QUEUE_CAP\)/)
  })

  it('feed.ts importa FEED_QUEUE_CAP de config/constants', () => {
    expect(FEED).toMatch(
      /import\s*\{[^}]*FEED_QUEUE_CAP[^}]*\}\s*from\s*['"]\.\.\/config\/constants['"]/,
    )
  })
})

describe('Feed snapshot timestamp (Lily Item 3 — UX transparency)', () => {
  it('FEED_SNAPSHOT_STALE_MS está entre 1min e 1h (sweet spot UX)', () => {
    expect(FEED_SNAPSHOT_STALE_MS).toBeGreaterThanOrEqual(60_000)
    expect(FEED_SNAPSHOT_STALE_MS).toBeLessThanOrEqual(60 * 60_000)
  })

  it('FeedStore interface declara snapshotTs: number | null', () => {
    expect(FEED).toMatch(/snapshotTs:\s*number\s*\|\s*null/)
  })

  it('refreshFeed seta snapshotTs: Date.now() no setState', () => {
    // Bloco do setState pós-query deve incluir snapshotTs: Date.now()
    expect(FEED).toMatch(/snapshotTs:\s*Date\.now\(\)/)
  })

  it('initial state tem snapshotTs: null (não-shipado-ainda semantics)', () => {
    expect(FEED).toMatch(/snapshotTs:\s*null/)
  })

  it('App.tsx renderiza FeedSnapshotAgeBadge no EndOfFeed', () => {
    expect(APP).toMatch(/<FeedSnapshotAgeBadge\s*\/>/)
    expect(APP).toMatch(/function FeedSnapshotAgeBadge/)
  })

  it('FeedSnapshotAgeBadge gating via FEED_SNAPSHOT_STALE_MS (não hard-coded)', () => {
    // Pattern: if (ageMs < FEED_SNAPSHOT_STALE_MS) return null
    expect(APP).toMatch(/ageMs\s*<\s*FEED_SNAPSHOT_STALE_MS/)
    // Badge oculto antes do primeiro refresh
    expect(APP).toMatch(/snapshotTs === null/)
  })
})
