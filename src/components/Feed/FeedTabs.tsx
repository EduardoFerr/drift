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

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { setFeedTab, useFeedStore } from '../../lib/feed'

type FeedTab = 'global' | 'following' | 'trending'

export function FeedTabs() {
  const tab = useFeedStore((s) => s.tab)

  return (
    <div className="flex gap-1 font-mono text-[10px] uppercase tracking-widest">
      <FeedTabBtn active={tab === 'global'} onClick={() => void setFeedTab('global')}>
        global
      </FeedTabBtn>
      <FeedTabBtn active={tab === 'following'} onClick={() => void setFeedTab('following')}>
        seguindo
      </FeedTabBtn>
      <FeedTabBtn active={tab === 'trending'} onClick={() => void setFeedTab('trending')}>
        trending
      </FeedTabBtn>
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
      className={`relative px-2 py-1 transition-colors ${
        active
          ? 'font-medium text-drift-text'
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
