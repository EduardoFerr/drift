/**
 * HintToast — primitive reactive de hint contextual. Source: RFC DAOP-001
 * Phase 1 PR3 (Ted HIMYM analysis 2026-05-17).
 *
 * Filosofia: floating toast bottom, AUTO-DISMISS após timer (default
 * 8s) OU click. Dispensa explícita persiste em capabilities (não volta
 * a aparecer naquele device).
 *
 * Diferença vs HintChip/HintModal:
 *   - HintChip = inline passive (sempre visível enquanto aplica).
 *   - **HintToast** = floating reactive, auto-some.
 *   - HintModal = overlay full, interrompe.
 *
 * Trigger típico: capability gap detectado após ação do user (postou
 * primeira vez sem follow → toast "considere seguir alguém pra ver feed").
 * Caller controla quando montar — primitive só cuida do display + dismiss.
 *
 * A11y:
 *   - DriftAlert variant 'info' (role=status/aria-live=polite) — non-intrusive
 *   - Botão dismiss explícito (×) sempre presente
 *
 * Manifesto §28: nenhum tracking de impressão/dismissal além do bag
 * dismissedRuleIds local.
 */

import { useEffect, useRef } from 'react'
import { useCapabilitiesStore, dismissRule } from '../../lib/capabilities'
import type { GuidanceRule, GuidanceRuleContext } from '../../lib/guidance'
import { DriftAlert } from './DriftAlert'
import { DriftButton } from './DriftButton'

export interface HintToastProps {
  rule: GuidanceRule
  ctx: GuidanceRuleContext
  /** Auto-dismiss em ms. Default 8000. 0 = sem auto-dismiss. */
  durationMs?: number
  /** Callback após dismiss (programa ou user). */
  onDismiss?: () => void
}

export function HintToast({
  rule,
  ctx,
  durationMs = 8000,
  onDismiss,
}: HintToastProps) {
  const caps = useCapabilitiesStore((s) => s.caps)
  const dismissedRef = useRef(false)

  useEffect(() => {
    if (durationMs <= 0) return
    const id = window.setTimeout(() => {
      if (dismissedRef.current) return
      dismissedRef.current = true
      onDismiss?.()
    }, durationMs)
    return () => window.clearTimeout(id)
  }, [durationMs, onDismiss])

  // Gate: caps loaded + rule applies + não dispensada.
  if (!caps) return null
  if (rule.appliesIf && !rule.appliesIf(caps)) return null
  if (caps.dismissedRuleIds.has(rule.id)) return null

  function handleDismiss() {
    if (dismissedRef.current) return
    dismissedRef.current = true
    dismissRule(rule.id).catch((err) => {
      console.warn('[HintToast] dismissRule falhou:', err)
    })
    onDismiss?.()
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 w-[calc(100vw-32px)] max-w-md -translate-x-1/2"
      style={{ pointerEvents: 'auto' }}
    >
      <DriftAlert
        variant="info"
        title={rule.title}
        actions={
          <DriftButton
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            aria-label={`dispensar hint ${rule.title}`}
          >
            ok, entendi
          </DriftButton>
        }
      >
        {rule.body(ctx)}
      </DriftAlert>
    </div>
  )
}
