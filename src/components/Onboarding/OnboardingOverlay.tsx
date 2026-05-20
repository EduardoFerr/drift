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

import { useEffect, useMemo, useState } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, AnimatePresence } from 'framer-motion'
import { setPref, usePrefsStore } from '../../lib/prefs'
import {
  ONBOARDING_RULES,
  filterApplicableRules,
  type GuidanceRuleContext,
} from '../../lib/guidance'
import { dismissRules, useCapabilitiesStore } from '../../lib/capabilities'
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

  // PR2 DAOP-001 (2026-05-17): filtra regras por capabilities. User que
  // já fez backup do nsec pula 'identity'. Snapshot é estável dentro do
  // overlay (caps capturado no mount via useMemo) — mudar mid-flow seria
  // jarring (steps somem). Se loaded=false (race no boot), fallback é
  // mostrar lista inteira (paridade PR1).
  const caps = useCapabilitiesStore((s) => s.caps)
  const applicableRules = useMemo(
    () => filterApplicableRules(ONBOARDING_RULES, caps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const currentRule = applicableRules[step]
  const isLast = step === applicableRules.length - 1

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
    // PR2: marca regras mostradas como dispensadas. Permite PR3 (hints
    // contextuais) re-mostrar regras NÃO incluídas no onboarding atual
    // (ex.: user que pulou backup vê hint contextual depois).
    dismissRules(applicableRules.map((r) => r.id)).catch((err) => {
      console.warn('[OnboardingOverlay] dismissRules falhou:', err)
    })
  }

  function next() {
    if (isLast) void finish()
    else setStep((s) => s + 1)
  }

  function skip() {
    void finish()
  }

  // Barney+Robin fix 2026-05-18: se TODAS as regras foram filtradas via
  // appliesIf (user já fez tudo: backup + post + drift + follow), o
  // overlay renderizava VAZIO (currentRule=undefined → title/body
  // ausentes), trancando UI atrás de backdropDismissible=false. Auto-
  // finish + null render escapa do limbo.
  useEffect(() => {
    if (applicableRules.length === 0) {
      void finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (applicableRules.length === 0) return null

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
          {applicableRules.map((_, i) => (
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
