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

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border border-purple-500/40 bg-zinc-900/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-100">
            Nova versão do Drift disponível
          </p>
          <p className="mt-1 text-xs text-zinc-400">
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
          className="flex-1 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          Atualizar agora
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500"
        >
          Mais tarde
        </button>
      </div>
    </div>
  )
}
