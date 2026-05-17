/**
 * LensNudgeBanner — toast/banner one-time apresentando a Trust Lens.
 *
 * Trust Lens Phase 1 (plan §1.5 Lily onboarding). Reusa pattern do
 * DiscoverNudgeBanner: aparece como bottom toast acima da navbar, ZÁ
 * permanente após dismiss.
 *
 * Trigger (AND):
 *   - Identidade existe + tem >7 dias (proxy: identity.createdAt)
 *   - Following ≥ 10 (grafo grande o suficiente pra lens fazer sentido)
 *   - lens_nudge_dismissed === false
 *   - lens strength === 0 (não sugerir pra quem já experimentou)
 *
 * CTA:
 *   - "experimentar" → abre SuaLenteCard via pushLayer
 *   - "depois" → setPref('lens_nudge_dismissed', true)
 *
 * Manifesto §17 (sem chave mestra disfarçada): banner NUNCA empurra
 * preset específico, NUNCA sugere "Forte é melhor". Só convida pra
 * abrir o card e o user decide. Banner com lens strength = 0 atual
 * (slider parado) é visualmente honesto.
 */

import { useEffect, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useBootStore } from '../../lib/bootstrap'
import { setPref, usePrefsStore } from '../../lib/prefs'
import { useFollowsStore } from '../../lib/follows'
import { useLensStore } from '../../lib/trust-lens'
import { pushLayer } from '../../lib/layer-stack'
import { DriftButton } from '../UI/DriftButton'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MIN_FOLLOWS = 10

export function LensNudgeBanner() {
  const identity = useBootStore((s) => s.identity)
  const dismissed = usePrefsStore((s) => s.lens_nudge_dismissed)
  const followsCount = useFollowsStore((s) => s.following.size)
  const lensStrength = useLensStore((s) => s.strength)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!identity || dismissed || lensStrength > 0) {
      setShow(false)
      return
    }
    if (followsCount < MIN_FOLLOWS) {
      setShow(false)
      return
    }
    const ageMs = Date.now() - identity.createdAt
    setShow(ageMs > SEVEN_DAYS_MS)
  }, [identity, dismissed, followsCount, lensStrength])

  async function handleDismiss() {
    setShow(false)
    await setPref('lens_nudge_dismissed', true)
  }

  async function handleOpen() {
    await setPref('lens_nudge_dismissed', true)
    setShow(false)
    const { SuaLenteCard } = await import('./SuaLenteCard')
    pushLayer({ id: 'sua-lente-nudge', component: SuaLenteCard })
  }

  return (
    <AnimatePresence>
      {show && (
        <m.div
          role="status"
          aria-live="polite"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-[88px] left-4 right-4 z-40 mx-auto max-w-md rounded-2xl border border-drift-border/40 border-l-[3px] border-l-drift-accent2 bg-drift-surface/95 px-4 py-3.5 shadow-drift-lg backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 font-mono">
              <p className="text-[12px] font-medium text-drift-text">
                Conheça sua Lente
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-drift-muted/50">
                Você pode reordenar o feed localmente, priorizando pessoas
                próximas da sua rede. Nada sai do seu dispositivo, nada
                muda pros outros.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <DriftButton
              variant="primary"
              size="lg"
              onClick={() => void handleOpen()}
              className="flex-1"
            >
              experimentar
            </DriftButton>
            <DriftButton
              variant="cancel"
              size="lg"
              onClick={() => void handleDismiss()}
            >
              depois
            </DriftButton>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
