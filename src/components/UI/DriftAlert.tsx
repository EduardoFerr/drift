/**
 * DriftAlert — primitive de alerta visual (banner/notice/toast).
 *
 * Extraído em [novo commit] 2026-05-17 (Lily HIMYM audit ROI #1):
 * antes existia 3+ implementações ad-hoc do mesmo pattern:
 *   - DiscoverNudgeBanner — toast bottom, variant info (accent2)
 *   - LensNudgeBanner — toast bottom, idem
 *   - EditProfileCard ManifestoNotice — inline, variant warning (amber)
 *   - GpsErrorBanner (subset) — inline warning
 *
 * Variants visuais (alinhadas com tokens do design system):
 *   - `info`     — drift-accent2 border + accent2/5 bg (default destaque)
 *   - `warning`  — drift-warning border + warning/5 bg (atenção UX/manifesto)
 *   - `danger`   — drift-bury border + bury/5 bg (irreversível/destrutivo)
 *
 * Positioning: este primitive renderiza apenas o BLOCO visual. Toast
 * fixed-bottom + AnimatePresence ficam no caller (DiscoverNudgeBanner
 * etc. fazem orchestração de show/hide).
 *
 * A11y:
 *   - variant `warning` / `danger` → `role="alert"` + `aria-live="assertive"`
 *   - variant `info` → `role="status"` + `aria-live="polite"`
 *   - Title renderiza em `<div>` com font-display uppercase (não h2 —
 *     título de alert não é heading semântico)
 *
 * Manifesto §28 (privacidade visível): variant warning é o canal canônico
 * pra avisos de impacto de privacidade ("antes de publicar", "vai sair
 * deste device", etc.).
 */

import type { ReactNode } from 'react'

export type DriftAlertVariant = 'info' | 'warning' | 'danger'

export interface DriftAlertProps {
  variant: DriftAlertVariant
  /** Título uppercase exibido em destaque acima do body. */
  title?: string
  /** Corpo do alerta — pode conter <strong>, links, listas. */
  children?: ReactNode
  /**
   * Slot pra botões CTA (geralmente DriftButton). Renderizado abaixo
   * do body com gap-2.
   */
  actions?: ReactNode
  /** Apêndio opcional pro className do wrapper externo. */
  className?: string
}

/** Mapeia variant pra tokens Tailwind. Pure pra testes. */
export function driftAlertVariantClass(variant: DriftAlertVariant): {
  wrapper: string
  title: string
  body: string
} {
  switch (variant) {
    case 'info':
      return {
        wrapper: 'border border-drift-accent2/30 bg-drift-accent2/5',
        title: 'text-drift-accent2',
        body: 'text-drift-accent2/70',
      }
    case 'warning':
      return {
        wrapper: 'border border-drift-warning/30 bg-drift-warning/5',
        title: 'text-drift-warning',
        body: 'text-drift-warning/70',
      }
    case 'danger':
      return {
        wrapper: 'border border-drift-bury/30 bg-drift-bury/5',
        title: 'text-drift-bury',
        body: 'text-drift-bury/70',
      }
  }
}

export function DriftAlert({
  variant,
  title,
  children,
  actions,
  className = '',
}: DriftAlertProps) {
  const v = driftAlertVariantClass(variant)
  const role = variant === 'info' ? 'status' : 'alert'
  const ariaLive = variant === 'info' ? 'polite' : 'assertive'

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={`rounded-xl px-4 py-3 ${v.wrapper} ${className}`}
    >
      {title && (
        <div
          className={`mb-1 font-display text-[12px] font-bold uppercase tracking-tag ${v.title}`}
        >
          {title}
        </div>
      )}
      {children && (
        <div className={`font-mono text-[11px] leading-relaxed ${v.body}`}>
          {children}
        </div>
      )}
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </div>
  )
}
