// Feed — no manual refresh button conformance — LOCK_VIA_TEST.
//
// Source: refresh icon manual removido em [253fe48] 2026-05-17.
// HIMYM consenso 4/4 (Lily/Ted/Robin/Marshall): substituído por
// tap-on-active-tab + auto-refresh invalidateFeed (padrão 2026:
// Twitter/Bluesky/Threads/Instagram).
//
// Marshall HIMYM audit 2026-05-17: "LOCK enquanto fresh" — refactor
// recente sem test deixa janela pra regressão silenciosa.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full.replace(/\\/g, '/'))
  }
  return acc
}

describe('Feed — sem botão de refresh manual (post-[253fe48])', () => {
  it('Feed/*.tsx não importa RefreshIcon nem renderiza handleRefresh', () => {
    const violations: string[] = []
    for (const file of walk('src/components/Feed')) {
      const content = readFileSync(file, 'utf8')
      // Strip comments
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/RefreshIcon/.test(stripped)) {
        violations.push(`${file}: RefreshIcon importado`)
      }
      if (/handleRefresh\s*\(/.test(stripped)) {
        violations.push(`${file}: handleRefresh function presente`)
      }
      if (/setRefreshing/.test(stripped)) {
        violations.push(`${file}: setRefreshing state presente`)
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: tap-active-tab + auto-refresh já cobrem (padrão Twitter/Bluesky/Threads 2026).`,
    ).toEqual([])
  })

  it('FeedTabs.tsx mantém onActiveTabTap exposto (compat App.tsx scroll-to-top)', () => {
    const feedTabs = readFileSync('src/components/Feed/FeedTabs.tsx', 'utf8')
    expect(feedTabs).toMatch(/onActiveTabTap\?:\s*\(\)\s*=>\s*void/)
  })

  it('tap-on-active-tab dispara refreshFeed + markFeedSeen (combo Twitter/Threads)', () => {
    const feedTabs = readFileSync('src/components/Feed/FeedTabs.tsx', 'utf8')
    expect(feedTabs).toMatch(/refreshFeed\(\)/)
    expect(feedTabs).toMatch(/markFeedSeen\(\)/)
  })
})
