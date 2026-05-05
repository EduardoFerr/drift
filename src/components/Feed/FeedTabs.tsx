/**
 * FeedTabs — seletor de aba do feed (Global / Seguindo / Trending).
 *
 * Extraído de App.tsx em V_pre0 do redesign visual v0.7 (sessão
 * 2026-05-04, HIMYM Round 1 recomendou). Reduz cognitive load do
 * App.tsx (1525+ linhas) e preparas terreno pra V3.2 reskin (tab
 * indicator slide com cubic-bezier elastic).
 *
 * Comportamento idêntico ao inline anterior:
 * - 3 abas: 'global' | 'following' | 'trending'
 * - Click chama `setFeedTab(tab)` da feed store
 * - Active tab tem `border-b-2 border-drift-accent` + cor accent
 * - Inativos: `text-slate-600` com hover pra `text-slate-300`
 *
 * V3.2 (futuro) vai adicionar indicator com slide elastic + ajustar
 * cores pra `drift-text` / `drift-muted` (paleta v0.7).
 */

import type { ReactNode } from 'react'
import { setFeedTab, useFeedStore } from '../../lib/feed'

type FeedTab = 'global' | 'following' | 'trending'

export function FeedTabs() {
  const tab = useFeedStore((s) => s.tab)

  return (
    <div className="flex gap-1 text-[10px] uppercase tracking-widest">
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
      className={`px-2 py-1 transition-colors ${
        active
          ? 'border-b-2 border-drift-accent text-drift-accent'
          : 'border-b-2 border-transparent text-slate-600 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

export type { FeedTab }
