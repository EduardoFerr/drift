/**
 * OnboardingOverlay — primeira execução. Aparece UMA vez. Persiste em
 * `user_prefs.onboarding_done` quando o user fecha (skip ou conclui).
 *
 * Steps vêm de `lib/guidance.tsx:ONBOARDING_RULES` (refactor PR1 DAOP-001
 * 2026-05-17). Componente é consumer puro — não hardcoda conteúdo.
 *
 * Filosofia visual: zero animação chamativa, zero CTA exagerado. Drift
 * é um produto sóbrio. Onboarding deve refletir isso — informativo,
 * direto, fácil de pular.
 */

import { useState } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, AnimatePresence } from 'framer-motion'
import { setPref, usePrefsStore } from '../../lib/prefs'
import {
  ONBOARDING_RULES,
  type GuidanceRuleContext,
} from '../../lib/guidance'
import { DriftButton } from '../UI/DriftButton'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'

export interface OnboardingOverlayProps {
  onClose: () => void
  onOpenIdentity: () => void
}

export function OnboardingOverlay({ onClose, onOpenIdentity }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0)

  // Context injetado nas body factories das regras. Adicionar callbacks
  // novos aqui exige extension do GuidanceRuleContext em lib/guidance.ts.
  const ruleContext: GuidanceRuleContext = { onOpenIdentity }

  const currentRule = ONBOARDING_RULES[step]
  const isLast = step === ONBOARDING_RULES.length - 1

  function finish() {
    // Store primeiro (síncrono) → onClose segundo (síncrono) → persist
    // ao SQLite fire-and-forget. Versão anterior (await setPref →
    // onClose) travava quando o worker demorava a responder (OPFS
    // contention, sync pesado no boot).
    usePrefsStore.setState({ onboarding_done: true })
    onClose()
    setPref('onboarding_done', true).catch((err) => {
      console.warn('[OnboardingOverlay] setPref onboarding_done falhou:', err)
    })
  }

  function next() {
    if (isLast) void finish()
    else setStep((s) => s + 1)
  }

  function skip() {
    void finish()
  }

  return (
    <SlideUpOverlay
      onClose={skip}
      ariaLabel="onboarding do drift"
      maxWidth="md"
      // boost=true → z-[60] pra dominar UpdatePrompt z-50. User report
      // 2026-05-09: "Pular/Começar não avança" — antes era z-[60] inline.
      boost
      // backdropDismissible=false: user precisa ação explícita (pular
      // ou completar). Tap acidental no backdrop não deve pular intro.
      backdropDismissible={false}
      padded={false}
    >
      <div className="flex flex-col px-4 py-5">
        {/* Progress bar estilo Stories — itera sobre ONBOARDING_RULES */}
        <div className="mb-4 flex gap-1">
          {ONBOARDING_RULES.map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full ${
                i < step
                  ? 'bg-drift-accent/60'
                  : i === step
                  ? 'bg-drift-accent'
                  : 'bg-drift-border/60'
              }`}
            />
          ))}
        </div>

        {/* CLS fix 2026-05-17 (Lily audit): min-h fixo no container do
            slide impede layout shift entre steps. Steps variam de 3
            linhas a 8+ itens; sem min-h, header/buttons saltavam a
            cada step swap. min-h-[320px] cobre step médio (~6 linhas)
            sem desperdiçar viewport em telas pequenas. */}
        <div className="min-h-[320px]" style={{ contain: 'layout' }}>
          <AnimatePresence mode="wait">
            <m.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              <h2 className="mb-3 font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
                {currentRule?.title}
              </h2>
              <div className="space-y-3 text-sm text-drift-text [&_code]:text-[12px] [&_p]:leading-relaxed">
                {currentRule?.body(ruleContext)}
              </div>
            </m.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <DriftButton variant="cancel" size="md" onClick={skip}>
            pular
          </DriftButton>
          <div className="flex gap-2">
            {step > 0 && (
              <DriftButton
                variant="ghost"
                size="md"
                onClick={() => setStep((s) => s - 1)}
                aria-label="voltar"
              >
                ←
              </DriftButton>
            )}
            <DriftButton variant="primary" size="md" onClick={next}>
              {isLast ? 'começar' : 'próximo →'}
            </DriftButton>
          </div>
        </div>
      </div>
    </SlideUpOverlay>
  )
}
