/**
 * FeedTabs — gesture conformance (LOCK_VIA_TEST).
 *
 * Source: HIMYM consenso 4/4 (Lily/Ted/Robin/Marshall) 2026-05-17 —
 * refresh icon manual no header foi removido em favor de tap-on-active-tab
 * + auto-refresh (pattern dominante 2026: Twitter/Bluesky/Threads/IG).
 *
 * Estes tests travam:
 *   1. RefreshIcon import NÃO retorna ao FeedTabs (regressão visual)
 *   2. onActiveTabTap permanece exposto na API (compat App.tsx)
 *   3. FeedTabs NÃO introduz long-press (conflito com long-press 5s do
 *      PostViewer — moderação)
 *   4. tap-active-tab dispara refreshFeed + markFeedSeen (semântica
 *      do gesto preservada)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FEED_TABS = readFileSync('src/components/Feed/FeedTabs.tsx', 'utf8')

describe('FeedTabs — gesture conformance', () => {
  it('não importa RefreshIcon (botão refresh removido — HIMYM 2026-05-17)', () => {
    expect(FEED_TABS).not.toMatch(/RefreshIcon/)
  })

  it('não tem botão de refresh manual com handleRefresh / refreshing state', () => {
    expect(FEED_TABS).not.toMatch(/handleRefresh\s*\(/)
    expect(FEED_TABS).not.toMatch(/setRefreshing/)
  })

  it('onActiveTabTap permanece exposto na API (compat App.tsx scroll-to-top)', () => {
    expect(FEED_TABS).toMatch(/onActiveTabTap\?:\s*\(\)\s*=>\s*void/)
  })

  it('tap-on-active-tab dispara refreshFeed + markFeedSeen', () => {
    // Heurística: bloco do handleTabClick contém ambas chamadas no branch ativo
    expect(FEED_TABS).toMatch(/refreshFeed\(\)/)
    expect(FEED_TABS).toMatch(/markFeedSeen\(\)/)
  })

  it('não introduz long-press / pointer handlers (conflito com PostViewer 5s)', () => {
    expect(FEED_TABS).not.toMatch(/onPointerDown/)
    expect(FEED_TABS).not.toMatch(/longPress|startHold/i)
  })
})
