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

import { motion, AnimatePresence } from 'framer-motion'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdatePrompt() {
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
        setInterval(
          () => {
            void registration.update()
          },
          60 * 60 * 1000,
        )
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

  // V5 polish: toast slide-up bottom com border-left accent + paleta v0.7
  // (drift-surface/border/accent), font-mono, AnimatePresence pra entrada/saída
  // suave em vez de pop in/out direto.
  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded border border-drift-border border-l-[3px] border-l-drift-accent bg-drift-surface p-4 shadow-lg backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 font-mono">
              <p className="text-[12px] font-medium text-drift-text">
                Nova versão do Drift disponível
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-drift-muted">
                Atualização propaga fixes de segurança e features. Você decide
                quando aplicar — manifesto §17 (sem update silencioso).
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void updateServiceWorker(true)
              }}
              className="flex-1 rounded border border-drift-accent bg-drift-accent px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-drift-bg transition hover:bg-drift-accent/90 focus:outline-none focus:ring-2 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-surface"
            >
              Atualizar agora
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="rounded border border-drift-border px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-drift-muted transition hover:border-drift-text hover:text-drift-text focus:outline-none focus:ring-1 focus:ring-drift-accent2"
            >
              Mais tarde
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
