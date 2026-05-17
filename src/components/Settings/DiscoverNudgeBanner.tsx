/**
 * DiscoverNudgeBanner — toast/banner one-time avisando user que ele pode
 * descobrir relays alternativos.
 *
 * Fase A relay moderation (E6 da deliberação HIMYM 2026-05-17, Lily UX).
 *
 * Trigger:
 *   - Identidade existe + tem >7 dias (proxy: identity.createdAt)
 *   - user_prefs.discover_nudge_dismissed === false
 *
 * Comportamento:
 *   - Renderiza UMA VEZ (dismiss permanente)
 *   - CTA "descobrir" → abre DiscoverRelaysCard via pushLayer
 *   - CTA "depois" → setPref('discover_nudge_dismissed', true), banner some
 *
 * Manifesto §17 adendo: user comum não é empurrado pro Discovery durante
 * onboarding. Banner aparece depois que user tem context de "como o app
 * funciona" — 7 dias é heurística honesta.
 *
 * Posição: bottom toast (igual UpdatePrompt). z-index abaixo de modais.
 */

import { useEffect, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useBootStore } from '../../lib/bootstrap'
import { setPref, usePrefsStore } from '../../lib/prefs'
import { pushLayer } from '../../lib/layer-stack'
import { DriftButton } from '../UI/DriftButton'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function DiscoverNudgeBanner() {
  const identity = useBootStore((s) => s.identity)
  const dismissed = usePrefsStore((s) => s.discover_nudge_dismissed)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!identity || dismissed) {
      setShow(false)
      return
    }
    const ageMs = Date.now() - identity.createdAt
    setShow(ageMs > SEVEN_DAYS_MS)
  }, [identity, dismissed])

  async function handleDismiss() {
    setShow(false)
    await setPref('discover_nudge_dismissed', true)
  }

  async function handleOpen() {
    await setPref('discover_nudge_dismissed', true)
    setShow(false)
    const { DiscoverRelaysCard } = await import('./DiscoverRelaysCard')
    pushLayer({ id: 'discover-relays-nudge', component: DiscoverRelaysCard })
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
                Descubra outros relays
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-drift-muted/50">
                Drift conecta a múltiplos servidores. Você pode escolher relays
                neutros, moderados, livres ou .onion — cada um com política
                visível.
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
              descobrir
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
