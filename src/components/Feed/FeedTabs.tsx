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
import { markFeedSeen, refreshFeed, setFeedTab, useFeedStore } from '../../lib/feed'

type FeedTab = 'global' | 'following' | 'trending'

export interface FeedTabsProps {
  /**
   * Callback opcional disparado quando user toca na tab que JÁ está
   * ativa — gesto "voltar pro topo" (Twitter/Bluesky pattern).
   * App.tsx usa pra resetar `idxByTab[tab]` pra 0. Manifesto §24:
   * default é preservar posição por tab; este gesto é opt-in explícito.
   */
  onActiveTabTap?: () => void
}

export function FeedTabs({ onActiveTabTap }: FeedTabsProps = {}) {
  const tab = useFeedStore((s) => s.tab)
  const unseenByTab = useFeedStore((s) => s.unseenByTab)
  const [refreshing, setRefreshing] = useState(false)
  const unseenCount = unseenByTab[tab]

  // User feedback 2026-05-08: ter botão pra refresh manual além do
  // automático via invalidateFeed (debounced 150ms quando relay
  // entrega evento). Útil pra confirmar visualmente que feed atualiza.
  // Refresh manual também limpa contador "+N novos" da tab atual via
  // markFeedSeen — auto-invalidate NÃO limpa (preserva acúmulo idle).
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshFeed()
      markFeedSeen()
    } finally {
      // Pequeno delay pra animação ser perceptível mesmo em refresh fast
      setTimeout(() => setRefreshing(false), 400)
    }
  }

  /**
   * Click handler pra cada tab. Se já é ativa, dispara `onActiveTabTap`
   * (volta pro topo via App.tsx). Senão, troca pra essa tab.
   */
  function handleTabClick(targetTab: FeedTab) {
    if (targetTab === tab) {
      onActiveTabTap?.()
    } else {
      void setFeedTab(targetTab)
    }
  }

  // V9.3c — flex-1 + text-center (mockup .tab pattern). Cada tab ocupa
  // 1/3 da largura da row, texto centralizado. Antes: gap-1 + px-2
  // (inline width baseado no texto, alinhamento à esquerda).
  // User feedback 2026-05-08: "para cada aba" — indicador de unseen
  // visível em CADA tab (não só na ativa via botão ↻). Permite user
  // saber que Following/Trending tem novo sem switchar pra confirmar.
  const tabs: { id: FeedTab; label: string }[] = [
    { id: 'global', label: 'global' },
    { id: 'following', label: 'seguindo' },
    { id: 'trending', label: 'trending' },
  ]

  return (
    <div className="flex items-stretch font-mono text-[10px] uppercase tracking-[2px]">
      {tabs.map((t) => (
        <FeedTabBtn
          key={t.id}
          active={tab === t.id}
          unseen={unseenByTab[t.id]}
          onClick={() => handleTabClick(t.id)}
          title={
            tab === t.id
              ? 'voltar ao topo'
              : unseenByTab[t.id] > 0
              ? `${unseenByTab[t.id]} ${unseenByTab[t.id] === 1 ? 'novo' : 'novos'}`
              : undefined
          }
        >
          {t.label}
        </FeedTabBtn>
      ))}
      <button
        onClick={() => void handleRefresh()}
        disabled={refreshing}
        title={
          unseenCount > 0
            ? `${unseenCount} ${unseenCount === 1 ? 'post novo' : 'posts novos'} — atualizar`
            : 'atualizar feed'
        }
        aria-label="atualizar feed"
        className="relative flex shrink-0 items-center justify-center px-3 text-drift-muted transition-colors hover:text-drift-text disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-1 focus-visible:ring-offset-drift-bg"
      >
        <span
          className={`text-[14px] ${refreshing ? 'animate-spin' : ''} ${
            unseenCount > 0 ? 'text-drift-accent' : ''
          }`}
          style={{
            display: 'inline-block',
            transformOrigin: 'center',
          }}
        >
          ↻
        </span>
        {unseenCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-drift-accent px-1 text-center text-[8px] font-bold leading-[14px] text-drift-bg"
          >
            {unseenCount > 99 ? '99+' : unseenCount}
          </span>
        )}
      </button>
    </div>
  )
}

function FeedTabBtn({
  active,
  unseen = 0,
  onClick,
  children,
  title,
}: {
  active: boolean
  /** Count de posts novos na tab (qualquer tab — ativa ou não). */
  unseen?: number
  onClick: () => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative flex-1 px-2 py-[10px] text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-1 focus-visible:ring-offset-drift-bg ${
        active
          ? 'text-drift-text'
          : 'text-drift-muted hover:text-drift-text'
      }`}
      aria-pressed={active}
    >
      <span className="relative inline-block">
        {children}
        {/* Dot indicator pra unseen — visível em qualquer tab que tenha
            novo (ativa ou não). Posicionado top-right do label sem
            empurrar layout. Cor chartreuse pra contrastar com muted/text. */}
        {unseen > 0 && (
          <span
            aria-hidden="true"
            aria-label={`${unseen} ${unseen === 1 ? 'novo' : 'novos'}`}
            className="absolute -right-2 -top-1 h-[6px] w-[6px] rounded-full bg-drift-accent"
          />
        )}
      </span>
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
