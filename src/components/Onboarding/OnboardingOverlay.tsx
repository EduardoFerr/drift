/**
 * OnboardingOverlay — primeira execução. Aparece UMA vez. Persiste em
 * `user_prefs.onboarding_done` quando o user fecha (skip ou conclui).
 *
 * 5 telas curtas:
 *   1. Boas-vindas + ideia central (Drift = comportamento humano > algoritmo)
 *   2. Os swipes (↑ espalha, ↓ enterra, ← → carousel)
 *   3. Identidade (nsec1 portável; backup é sua responsabilidade)
 *   4. Location é opcional (manifesto §28 — opt-in, default off)
 *   5. Filosofia (anti-censura, sem chave mestra, sem scan automático)
 *
 * Filosofia visual: zero animação chamativa, zero CTA exagerado. Drift
 * é um produto sóbrio. Onboarding deve refletir isso — informativo,
 * direto, fácil de pular.
 */

import { useState } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, AnimatePresence } from 'framer-motion'
import { setPref } from '../../lib/prefs'

export interface OnboardingOverlayProps {
  onClose: () => void
  onOpenIdentity: () => void
}

interface Step {
  title: string
  body: React.ReactNode
}

export function OnboardingOverlay({ onClose, onOpenIdentity }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0)

  const steps: Step[] = [
    {
      title: 'bem-vindo ao drift',
      body: (
        <>
          <p>
            Drift é uma rede social descentralizada onde o conteúdo deriva pelo{' '}
            <span className="text-drift-accent">comportamento humano</span> — não por algoritmo.
          </p>
          <p>
            Sem servidor central, sem feed personalizado, sem bolha. Posts imutáveis, identidade portável.
          </p>
          <p className="text-drift-muted">
            Sem censura — nem pelo fundador.
          </p>
        </>
      ),
    },
    {
      title: 'os 3 swipes',
      body: (
        <>
          <ul className="space-y-2">
            <li>
              <span className="text-drift-spread">↑</span> swipe pra cima ·{' '}
              <span className="text-drift-text">DRIFT (drifta o post)</span>
              <span className="ml-1 text-drift-muted">(empurra a deriva)</span>
            </li>
            <li>
              <span className="text-drift-bury">↓</span> swipe pra baixo ·{' '}
              <span className="text-drift-text">SINK (afunda o post)</span>
              <span className="ml-1 text-drift-muted">(reduz, não pune o autor)</span>
            </li>
            <li>
              <span className="text-drift-accent">← →</span> swipe horizontal ·{' '}
              <span className="text-drift-text">navega subposts</span>
            </li>
          </ul>
          <p className="text-drift-muted">
            Sem like, sem follow obrigatório. O score é determinístico — todos veem a mesma ordem.
          </p>
        </>
      ),
    },
    {
      title: 'sua identidade é uma chave',
      body: (
        <>
          <p>
            Nada de email ou telefone. Sua identidade é uma chave criptográfica (
            <code className="text-drift-accent">nsec1…</code>) gerada localmente.
          </p>
          <p>
            <span className="text-drift-warning">⚠</span> Faz backup. Se perder o nsec, perdeu a identidade. Se trocar de
            celular, é só importar o nsec — todo o histórico volta dos relays.
          </p>
          <button
            onClick={onOpenIdentity}
            className="mt-1 rounded border border-drift-accent px-3 py-1 text-xs text-drift-accent hover:bg-drift-accent/10"
          >
            abrir backup agora →
          </button>
        </>
      ),
    },
    {
      title: '📍 location é opcional',
      body: (
        <>
          <p>
            Se ativar em <code>Settings → location</code>, seus spreads aparecem no
            mapa de outros posts. Default é <span className="text-drift-text">off</span>{' '}
            por privacidade (manifesto §28).
          </p>
          <p className="text-drift-muted">
            Pode ativar depois — granularidade é sua (country, city ou precise).
          </p>
        </>
      ),
    },
    {
      title: 'algumas regras duras',
      body: (
        <>
          <ul className="space-y-2">
            <li>
              <span className="text-drift-spread">✓</span> Posts são <span className="text-drift-text">imutáveis</span>.
              Nem o fundador apaga.
            </li>
            <li>
              <span className="text-drift-spread">✓</span> Cliente oficial NÃO escaneia conteúdo automaticamente.
            </li>
            <li>
              <span className="text-drift-spread">✓</span> Auto-classificação (NSFW, spoiler) é{' '}
              <span className="text-drift-text">do autor</span>; filtros são{' '}
              <span className="text-drift-text">do leitor</span>.
            </li>
            <li>
              <span className="text-drift-spread">✓</span> Conteúdo problemático é moderado pela comunidade via reports
              + threshold dinâmico.
            </li>
          </ul>
          <p className="text-drift-muted">
            Detalhes completos em <code>Docs/manifesto.md</code>.
          </p>
        </>
      ),
    },
  ]

  const currentStep = steps[step]
  const isLast = step === steps.length - 1

  async function finish() {
    // try/catch defensivo (user report 2026-05-09 "Pular/Começar não
    // avança"): se setPref falhar (lock SQLite, OPFS contention,
    // migration in-flight), o await rejeita e onClose NUNCA roda →
    // user clica de novo no mesmo botão e nada acontece. Catch garante
    // que o overlay fecha mesmo nesse cenário; pior caso o user vê
    // onboarding em próxima boot.
    try {
      await setPref('onboarding_done', true)
    } catch (err) {
      console.warn('[OnboardingOverlay] setPref onboarding_done falhou:', err)
    }
    onClose()
  }

  function next() {
    if (isLast) void finish()
    else setStep((s) => s + 1)
  }

  function skip() {
    void finish()
  }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      // z-[60] pra dominar TODAS as outras overlays (UpdatePrompt
      // z-50, SlideUp z-40, NavBar z-30). User report 2026-05-09:
      // "Pular/Começar não avança" — o UpdatePrompt fixed bottom z-50
      // cobria a região dos botões do onboarding, absorvendo todos
      // os clicks. First-run + SW prompt simultâneo = bloqueio.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-drift-bg/95 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="onboarding do drift"
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded border border-drift-border bg-drift-surface p-5">
        {/* Progress bar estilo Stories */}
        <div className="mb-4 flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full ${
                i < step
                  ? 'bg-drift-accent/60'
                  : i === step
                  ? 'bg-drift-accent'
                  : 'bg-drift-border'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <m.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
          >
            <h2 className="mb-3 text-xs uppercase tracking-[0.2em] text-drift-accent">
              {currentStep?.title}
            </h2>
            <div className="space-y-3 text-sm text-drift-text [&_code]:text-[11px] [&_p]:leading-relaxed">
              {currentStep?.body}
            </div>
          </m.div>
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={skip}
            className="text-[10px] uppercase tracking-widest text-drift-muted hover:text-drift-muted"
          >
            pular
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded border border-drift-border px-3 py-1 text-xs uppercase tracking-widest text-drift-muted hover:border-drift-accent hover:text-drift-accent"
              >
                ←
              </button>
            )}
            <button
              onClick={next}
              className="rounded border border-drift-accent px-3 py-1 text-xs uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
            >
              {isLast ? 'começar' : 'próximo →'}
            </button>
          </div>
        </div>
      </div>
    </m.div>
  )
}
