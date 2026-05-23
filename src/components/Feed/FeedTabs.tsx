/**
 * FeedTabs — seletor de aba do feed (Global / Seguindo / Em alta).
 *
 * V_pre0 extraiu de App.tsx; V3.2 (reskin) adicionou indicator slide
 * elastic + paleta v0.7. V_2026-05-17 (HIMYM consenso 4/4) remove o
 * botão refresh manual do header — substituído por:
 *   1. tap-on-active-tab → refresh + scroll-to-top + markFeedSeen
 *      (pattern dominante 2026 — Twitter/Bluesky/Threads/Instagram)
 *   2. invalidateFeed() automático debounced 150ms via onNostrEvent
 *   3. dot indicator chartreuse nas tabs como sinal de "tem novo"
 *
 * Rationale arquitetural (Ted): refreshFeed() faz a MESMA query SQLite
 * que invalidateFeed() já dispara — único delta real é markFeedSeen(),
 * agora wired no tap-active-tab.
 */

import { type ReactNode } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'
import { markFeedSeen, refreshFeed, setFeedTab, useFeedStore } from '../../lib/feed'

type FeedTab = 'global' | 'following' | 'trending'

export interface FeedTabsProps {
  /**
   * Callback opcional disparado quando user toca na tab que JÁ está
   * ativa — gesto "voltar pro topo" (Twitter/Bluesky pattern).
   * App.tsx usa pra resetar `idxByTab[tab]` pra 0. Manifesto §24:
   * default é preservar posição por tab; este gesto é opt-in explícito.
   *
   * V_2026-05-17: tap-active-tab agora também faz refresh + markFeedSeen
   * (substitui botão refresh manual removido).
   */
  onActiveTabTap?: () => void
}

export function FeedTabs({ onActiveTabTap }: FeedTabsProps = {}) {
  const tab = useFeedStore((s) => s.tab)
  const unseenByTab = useFeedStore((s) => s.unseenByTab)

  /**
   * Click handler pra cada tab. Se já é ativa, dispara o combo
   * "refresh + clear unseen + scroll-to-top". Senão, troca pra essa tab
   * (setFeedTab já faz refresh internamente).
   */
  function handleTabClick(targetTab: FeedTab) {
    if (targetTab === tab) {
      void refreshFeed()
      markFeedSeen()
      onActiveTabTap?.()
    } else {
      void setFeedTab(targetTab)
    }
  }

  const tabs: { id: FeedTab; label: string }[] = [
    { id: 'global', label: 'global' },
    { id: 'following', label: 'seguindo' },
    { id: 'trending', label: 'em alta' },
  ]
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === tab),
  )

  return (
    <div className="flex items-stretch font-mono text-[12px] uppercase tracking-[2px]">
      <div className="relative flex flex-1 items-stretch" role="tablist" aria-label="feed">
        {tabs.map((t) => (
          <FeedTabBtn
            key={t.id}
            active={tab === t.id}
            // B1 fix (2026-05-22, Marshall): dot só em tab INATIVA com
            // unseen > 0. Tab ativa não mostra dot — ambíguo
            // ("precisa atenção?" vs. "estou aqui mesmo"). Combinado
            // com bumpUnseenCount que incrementa todas as 3 tabs por
            // simplicidade, sem este guard as 3 tabs sempre piscavam
            // dot juntas após qualquer evento.
            unseen={tab === t.id ? 0 : unseenByTab[t.id]}
            onClick={() => handleTabClick(t.id)}
            title={
              tab === t.id
                ? 'tocar de novo: atualizar + voltar ao topo'
                : unseenByTab[t.id] > 0
                ? `${unseenByTab[t.id]} ${unseenByTab[t.id] === 1 ? 'novo' : 'novos'}`
                : undefined
            }
          >
            {t.label}
          </FeedTabBtn>
        ))}
        {/* Indicator único hoisted no container — anima `x` em % via
            `animate` prop (feature `animation` está em `domAnimation`).
            Largura = 1/3 do container das tabs (flex-1 × 3). */}
        <m.span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-px left-0 h-[2px] w-1/3 bg-drift-accent2"
          animate={{ x: `${activeIndex * 100}%` }}
          transition={{
            type: 'spring',
            stiffness: 380,
            damping: 28,
            mass: 0.6,
          }}
        />
      </div>
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
      role="tab"
      // B2 fix (2026-05-22, Marshall WCAG 4.1.2): aria-selected é o
      // estado canônico de tab. aria-pressed preservado por compat
      // com qualquer screen reader que ainda inspecione (não-padrão
      // pra role=tab mas inofensivo). Container tem role=tablist.
      aria-selected={active}
      // B6 fix (2026-05-22, Marshall): focus ring com `ring-inset`
      // (sem offset) evita aparência de "box outline" em volta da
      // tab clicada, que se confundia com indicador de ativa. Único
      // indicador de active-state é o underline animado (m.span no
      // container). Tab "em alta" parecia "ter caixa" porque era
      // a última focada; agora foco e ativa têm visuais distintos.
      className={`relative flex-1 px-2 py-[10px] text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-drift-accent2 ${
        active
          ? 'text-drift-text'
          : 'text-drift-muted hover:text-drift-text'
      }`}
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
    </button>
  )
}

export type { FeedTab }
