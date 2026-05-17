/**
 * UpdatePrompt — banner que pergunta ao user se quer atualizar quando
 * o Service Worker detecta nova versão.
 *
 * Manifesto §17 (sem chave mestra) implica que update silencioso é
 * "chave mestra disfarçada" — quem controla o deploy poderia pushar JS
 * arbitrário sem o user notar. Com `registerType: 'prompt'` em
 * `vite.config.ts`, o SW novo fica em `waiting` até o user concordar.
 * Este banner é o canal de consentimento.
 *
 * Origem: Barney audit 2026-05-02 §d ("SW autoUpdate é chave mestra de
 * facto"). Trade-off aceito: latência maior pra adoção de fix vs
 * defesa-em-profundidade contra ator que comprometa Vercel/CI.
 *
 * UX guidelines:
 *   - Banner só aparece quando `needRefresh === true` (SW novo waiting)
 *   - Botão "Atualizar agora" → `updateServiceWorker(true)` (skipWaiting
 *     + reload)
 *   - Botão "Mais tarde" → `setNeedRefresh(false)` (some até próximo
 *     reload onde o SW novo ainda estará waiting). Não persistimos
 *     "dismissed" — usuário deve ver de novo na próxima sessão.
 *   - Se browser não suporta SW (Tauri WebView dev sem certain flags,
 *     iframes restritos): hook fica silencioso, banner nunca aparece.
 *     Sem ruído no console.
 */

// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, AnimatePresence } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { DriftButton } from './DriftButton'

// Lily memory-leak audit 2026-05-15: timer global, idempotente. Guarda
// fora do componente porque `onRegisteredSW` pode ser chamado mais de uma
// vez em StrictMode dev / HMR (re-mount do componente), e o timer original
// vivia capturado no callback sem `clearInterval` correspondente → 2+
// intervals acumulavam por sessão dev. Em prod o leak era teórico (single
// mount), mas mantemos guard pra robustez. Cleanup no unmount via useEffect
// abaixo cobre o caso de `UpdatePrompt` ser desmontado deliberadamente.
let swUpdateTimer: ReturnType<typeof setInterval> | null = null

export function UpdatePrompt() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Periodic check: a cada 1h consulta o servidor pra ver se há SW
      // novo, mesmo sem reload. PWAs instalados podem ficar dias abertos;
      // sem isso, user não vê update até reabrir a app. 1h é compromisso
      // entre detectar fix de segurança razoavelmente rápido e não
      // hammerar o servidor.
      if (registration && swUrl) {
        // Idempotência: se já há timer ativo (StrictMode re-run, HMR),
        // não cria um segundo — evita N intervals empilhados.
        if (swUpdateTimer) return
        swUpdateTimer = setInterval(
          () => {
            void registration.update()
          },
          60 * 60 * 1000,
        )
        timerRef.current = swUpdateTimer
      }
    },
    onRegisterError(error) {
      // SW pode falhar a registrar em ambientes sem secure context, em
      // iframes restritos, ou em browsers raros sem suporte. Não é fatal
      // — app continua funcionando sem PWA features. Log apenas em DEV.
      if (import.meta.env.DEV) {
        console.warn('[UpdatePrompt] SW register failed:', error)
      }
    },
  })

  // Cleanup do timer no unmount. UpdatePrompt em prática é singleton no
  // root da App, mas se for desmontado (test harness, route swap futuro),
  // libera o interval.
  useEffect(() => {
    return () => {
      const t = timerRef.current
      if (t) {
        clearInterval(t)
        timerRef.current = null
        // Sincroniza guard global pra próximo mount poder re-criar.
        if (swUpdateTimer === t) swUpdateTimer = null
      }
    }
  }, [])

  // V5 polish: toast slide-up bottom com border-left accent + paleta v0.7
  // (drift-surface/border/accent), font-mono, AnimatePresence pra entrada/saída
  // suave em vez de pop in/out direto.
  return (
    <AnimatePresence>
      {needRefresh && (
        <m.div
          role="status"
          aria-live="polite"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-drift-border/40 border-l-[3px] border-l-drift-accent bg-drift-surface/95 px-4 py-3.5 shadow-lg backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 font-mono">
              <p className="text-[12px] font-medium text-drift-text">
                Nova versão do Drift disponível
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-drift-muted/50">
                Atualização propaga fixes de segurança e features. Você decide
                quando aplicar — manifesto §17 (sem update silencioso).
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <DriftButton
              variant="primary"
              size="lg"
              onClick={() => {
                void updateServiceWorker(true)
              }}
              className="flex-1"
            >
              Atualizar agora
            </DriftButton>
            <DriftButton
              variant="cancel"
              size="lg"
              onClick={() => setNeedRefresh(false)}
            >
              Mais tarde
            </DriftButton>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
