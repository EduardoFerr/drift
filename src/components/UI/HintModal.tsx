/**
 * HintModal — primitive interactive de hint contextual. Source: RFC DAOP-001
 * Phase 1 PR3 (Ted HIMYM analysis 2026-05-17).
 *
 * Filosofia: overlay SlideUpOverlay com conteúdo completo da regra
 * (rule.body). Interrompe flow temporariamente — user fecha (×) ou
 * confirma (CTA primary).
 *
 * Diferença vs HintChip/HintToast:
 *   - HintChip = inline passive (chip discreto, click → opens this).
 *   - HintToast = floating reactive (auto-dismiss).
 *   - **HintModal** = full overlay, interrompe deliberadamente. Usado
 *     pra hints "importantes" (backup nsec, configurar 1º relay etc).
 *
 * Diferença vs OnboardingOverlay: OnboardingOverlay é SEQUÊNCIA de
 * regras + progress bar + skip. HintModal é UMA regra única,
 * dismissível, sem sequence. Caller pode encadear via state se quiser
 * fluxo multi-step.
 *
 * Trigger típico: click em HintChip, ou call programático após detect
 * de capability gap crítico (ex.: user tenta publicar mas hasBackup=false
 * → caller mostra HintModal regra 'identity').
 *
 * Capability gate: respeita appliesIf + dismissedRuleIds. Se já
 * dispensada, modal retorna null mesmo se caller chamar (defesa contra
 * race condition / stale state).
 *
 * Dismiss: × ou backdrop OU CTA "ok, entendi" → persiste dismissedRuleIds.
 * "lembrar depois" → fecha sem persistir (rule volta a aparecer).
 *
 * Manifesto §28: nenhum tracking. Estado puro local.
 */

import { useCapabilitiesStore, dismissRule } from '../../lib/capabilities'
import type { GuidanceRule, GuidanceRuleContext } from '../../lib/guidance'
import { DriftButton } from './DriftButton'
import { SlideUpOverlay } from './SlideUpOverlay'

export interface HintModalProps {
  rule: GuidanceRule
  ctx: GuidanceRuleContext
  /** Callback quando modal fecha (por qualquer motivo). */
  onClose: () => void
  /**
   * Permite "lembrar depois" — fechar SEM persistir dismissedRuleIds.
   * Default true. Quando false, qualquer dismiss persiste.
   */
  allowSnooze?: boolean
}

export function HintModal({
  rule,
  ctx,
  onClose,
  allowSnooze = true,
}: HintModalProps) {
  const caps = useCapabilitiesStore((s) => s.caps)

  // Gate: caps loaded + rule applies + não dispensada.
  // Defesa: se caps mudaram entre mount e render (ex.: outro tab fez
  // backup → hasBackup true), o modal some sozinho.
  if (!caps) return null
  if (rule.appliesIf && !rule.appliesIf(caps)) {
    onClose()
    return null
  }
  if (caps.dismissedRuleIds.has(rule.id)) {
    onClose()
    return null
  }

  function persistAndClose() {
    dismissRule(rule.id).catch((err) => {
      console.warn('[HintModal] dismissRule falhou:', err)
    })
    onClose()
  }

  function snooze() {
    // Não persiste — regra volta a aplicar próxima sessão.
    onClose()
  }

  return (
    <SlideUpOverlay
      onClose={allowSnooze ? snooze : persistAndClose}
      ariaLabel={`hint: ${rule.title}`}
      maxWidth="md"
      padded={false}
    >
      <div className="flex flex-col px-4 py-5">
        <h2 className="mb-3 font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
          {rule.title}
        </h2>
        <div className="space-y-3 text-sm text-drift-text [&_code]:text-[12px] [&_p]:leading-relaxed">
          {rule.body(ctx)}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          {allowSnooze && (
            <DriftButton variant="cancel" size="md" onClick={snooze}>
              lembrar depois
            </DriftButton>
          )}
          <DriftButton variant="primary" size="md" onClick={persistAndClose}>
            ok, entendi
          </DriftButton>
        </div>
      </div>
    </SlideUpOverlay>
  )
}
