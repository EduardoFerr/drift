/**
 * FeedTabs — seletor de aba do feed (Global / Seguindo / Trending).
 *
 * V_pre0 extraiu de App.tsx; V3.2 (este reskin) adiciona indicator
 * slide elastic + paleta v0.7:
 * - Active: text-drift-text font-medium em font-mono uppercase tracking-widest
 * - Inativos: text-drift-muted hover→text-drift-text
 * - Indicator: motion.div com layoutId="feed-tab-indicator" — Framer
 *   anima entre tabs com cubic-bezier(0.34, 1.56, 0.64, 1) 280ms
 *   (overshoot elástico, sensação tactile/spring).
 *
 * `layoutId` compartilhado faz Framer reusar o mesmo elemento DOM e
 * animar position/size — não há re-render flicker.
 */

import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { refreshFeed, setFeedTab, useFeedStore } from '../../lib/feed'

type FeedTab = 'global' | 'following' | 'trending'

export function FeedTabs() {
  const tab = useFeedStore((s) => s.tab)
  const [refreshing, setRefreshing] = useState(false)

  // User feedback 2026-05-08: ter botão pra refresh manual além do
  // automático via invalidateFeed (debounced 150ms quando relay
  // entrega evento). Útil pra confirmar visualmente que feed atualiza.
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshFeed()
    } finally {
      // Pequeno delay pra animação ser perceptível mesmo em refresh fast
      setTimeout(() => setRefreshing(false), 400)
    }
  }

  // V9.3c — flex-1 + text-center (mockup .tab pattern). Cada tab ocupa
  // 1/3 da largura da row, texto centralizado. Antes: gap-1 + px-2
  // (inline width baseado no texto, alinhamento à esquerda).
  return (
    <div className="flex items-stretch font-mono text-[10px] uppercase tracking-[2px]">
      <FeedTabBtn active={tab === 'global'} onClick={() => void setFeedTab('global')}>
        global
      </FeedTabBtn>
      <FeedTabBtn active={tab === 'following'} onClick={() => void setFeedTab('following')}>
        seguindo
      </FeedTabBtn>
      <FeedTabBtn active={tab === 'trending'} onClick={() => void setFeedTab('trending')}>
        trending
      </FeedTabBtn>
      <button
        onClick={() => void handleRefresh()}
        disabled={refreshing}
        title="atualizar feed"
        aria-label="atualizar feed"
        className="flex shrink-0 items-center justify-center px-3 text-drift-muted transition-colors hover:text-drift-text disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-1 focus-visible:ring-offset-drift-bg"
      >
        <span
          className={`text-[14px] ${refreshing ? 'animate-spin' : ''}`}
          style={{
            display: 'inline-block',
            transformOrigin: 'center',
          }}
        >
          ↻
        </span>
      </button>
    </div>
  )
}

function FeedTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 px-2 py-[10px] text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-1 focus-visible:ring-offset-drift-bg ${
        active
          ? 'text-drift-text'
          : 'text-drift-muted hover:text-drift-text'
      }`}
      aria-pressed={active}
    >
      {children}
      {active && (
        <motion.span
          layoutId="feed-tab-indicator"
          className="absolute inset-x-0 -bottom-px h-[2px] bg-drift-accent"
          transition={{
            type: 'spring',
            stiffness: 380,
            damping: 28,
            mass: 0.6,
          }}
        />
      )}
    </button>
  )
}

export type { FeedTab }
