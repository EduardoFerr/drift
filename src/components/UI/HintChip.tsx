/**
 * HintChip — primitive passive de hint contextual. Source: RFC DAOP-001
 * Phase 1 PR3 (Ted HIMYM analysis 2026-05-17).
 *
 * Filosofia: hint NÃO interrompe flow. Renderiza como chip discreto
 * (drift-accent outline) com label curto. Click → callback (caller
 * decide ação — pode abrir um overlay próprio, navegar para settings,
 * ou só marcar como visto).
 *
 * Histórico: era irmão de HintToast (floating auto-dismiss) e HintModal
 * (overlay full), ambos removidos em 2026-05-23 por shelf-ware (zero
 * callers em 6 dias). Se Phase 2 do DAOP precisar dos formatos toast/
 * modal, re-criar a partir do git log com pelo menos 1 caller real.
 *
 * Capability gate: chip só renderiza se rule.appliesIf(caps) === true
 * AND !caps.dismissedRuleIds.has(rule.id). Dismiss explícito (click X)
 * persiste via `dismissRule`.
 *
 * Manifesto §28: zero behavioral tracking. Chip aparece/some baseado
 * em caps SQLite, nunca em analytics.
 */

import { useCapabilitiesStore, dismissRule } from '../../lib/capabilities'
import type { GuidanceRule } from '../../lib/guidance'
import { DriftChip } from './DriftChip'

export interface HintChipProps {
  rule: GuidanceRule
  /** Label curto (default = rule.title). */
  label?: string
  /** Click handler — caller decide ação (abrir overlay, navegar, etc). */
  onActivate?: () => void
  /** Quando true, esconde o X de dismiss (hint sticky até user agir). */
  hideDismiss?: boolean
  className?: string
}

export function HintChip({
  rule,
  label,
  onActivate,
  hideDismiss = false,
  className,
}: HintChipProps) {
  const caps = useCapabilitiesStore((s) => s.caps)

  // Gate: caps loaded + rule applies + não dispensada.
  if (!caps) return null
  if (rule.appliesIf && !rule.appliesIf(caps)) return null
  if (caps.dismissedRuleIds.has(rule.id)) return null

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    dismissRule(rule.id).catch((err) => {
      console.warn('[HintChip] dismissRule falhou:', err)
    })
  }

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <DriftChip
        variant="accent"
        size="sm"
        onClick={onActivate}
        ariaLabel={`hint: ${rule.title}`}
      >
        {label ?? rule.title}
      </DriftChip>
      {!hideDismiss && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={`dispensar hint ${rule.title}`}
          className="text-drift-muted hover:text-drift-text text-[14px] leading-none px-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 rounded-sm"
        >
          ×
        </button>
      )}
    </div>
  )
}
