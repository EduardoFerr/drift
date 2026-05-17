/**
 * SectionHeader — header de seção do design system Drift.
 *
 * Antes: 6 cópias inline em SettingsCards/RelaySettings/ProfileModal/
 * ReportModal/AppearanceCard/SuaLenteCard com classes Tailwind quase
 * idênticas. Atomic-lite extract (Ted HIMYM 2026-05-17) — sem renomear
 * UI/ pra atoms/, só DRY nas duplicações maduras.
 *
 * 2 modos:
 *   - Static: passa apenas `title` (sem handlers). Renderiza `<div>`
 *     simples — usado em cards single-section (AppearanceCard,
 *     SuaLenteCard, ReportModal).
 *   - Accordion: passa `title` + `expanded` + `onToggle`. Renderiza
 *     `<button>` com ChevronDownIcon que rotaciona — usado em cards
 *     multi-section (RelaySettings, ProfileModal, SettingsCards modes
 *     accordion).
 *
 * A11y: button mode tem `aria-expanded`, chevron com `aria-hidden`.
 */

import { ChevronDownIcon } from './Icons'

export interface SectionHeaderProps {
  title: string
  /**
   * Quando definidos juntos, renderiza como accordion `<button>` com
   * chevron rotativo. Quando ambos undefined, renderiza `<div>` static.
   */
  expanded?: boolean
  onToggle?: () => void
}

export function SectionHeader({ title, expanded, onToggle }: SectionHeaderProps) {
  if (!onToggle) {
    return (
      <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5">
        <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
          {title}
        </span>
      </div>
    )
  }
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3 rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5 text-left transition-colors"
    >
      <span className="flex-1 font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
        {title}
      </span>
      <span
        aria-hidden="true"
        className={`shrink-0 text-drift-muted/40 transition-transform duration-motion-emphasis ease-drift-inout ${
          expanded ? 'rotate-180' : ''
        }`}
      >
        <ChevronDownIcon size={16} />
      </span>
    </button>
  )
}
