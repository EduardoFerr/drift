/**
 * Banner amistoso quando user habilitou location_granularity mas a última
 * tentativa de getCurrentLocation retornou null (Lily 29-04 — user comum
 * não abre DevTools, console.warn não é suficiente).
 *
 * Por que amber e não vermelho:
 *   - Não é falha catastrófica — post foi publicado SEM location, mas foi.
 *   - Vermelho dispara ansiedade desnecessária; amber comunica "atenção,
 *     não bloqueio".
 *
 * Manifesto §28 (privacidade pelo mínimo): banner só aparece se user
 * EXPLICITAMENTE optou por location. Se granularity === 'off', banner
 * nunca aparece — porque não há expectativa frustrada.
 *
 * Browser não permite forçar permissão programaticamente — apenas
 * documentamos os passos por browser no GpsHelpModal.
 */

import { useState } from 'react'
import type { GeolocationFailureReason } from '../../lib/geolocation'

interface GpsErrorBannerProps {
  reason: Exclude<GeolocationFailureReason, null>
  onDismiss: () => void
}

export function GpsErrorBanner({ reason, onDismiss }: GpsErrorBannerProps) {
  const [showHelp, setShowHelp] = useState(false)

  const message =
    reason === 'permission'
      ? 'Location habilitado mas o navegador bloqueou GPS. Verifique permissões.'
      : reason === 'timeout'
      ? 'Location habilitado mas GPS demorou demais pra capturar. Tente de novo.'
      : reason === 'no-api'
      ? 'Location habilitado mas este navegador não expõe geolocation API.'
      : 'Location habilitado mas GPS não capturou. Verifique permissões do navegador.'

  return (
    <>
      {/*
       * V5 polish: border-left 3px drift-bury (mockup v0.7) — visual de
       * alerta sem o vermelho saturado. Mantém amber pra texto pq o
       * padrão "atenção, não bloqueio" continua válido (manifesto §28
       * privacy: post publicou sem location, não é falha catastrófica).
       */}
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded border border-amber-500/30 border-l-[3px] border-l-drift-bury bg-amber-500/5 p-3"
      >
        <span className="text-base" aria-hidden="true">
          📍
        </span>
        <div className="flex-1 font-mono text-[12px]">
          <div className="text-amber-200">{message}</div>
          <div className="text-[12px] text-amber-200/60">
            Post foi publicado sem location.
          </div>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="rounded border border-amber-500/60 px-3 py-1 font-mono text-[12px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/10"
        >
          como ajustar
        </button>
        <button
          onClick={onDismiss}
          className="text-amber-500/60 hover:text-amber-300"
          aria-label="dispensar aviso"
          title="dispensar"
        >
          ✕
        </button>
      </div>
      {showHelp && <GpsHelpModal onClose={() => setShowHelp(false)} />}
    </>
  )
}

// ─── Modal de instruções por browser ─────────────────────────────────

function GpsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded border border-drift-border bg-drift-surface p-5 text-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-widest text-drift-accent">
            Como ajustar GPS
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
            aria-label="fechar"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-[12px] text-slate-400">
          Drift não pode forçar permissão de GPS — só o navegador permite.
          Siga os passos do seu navegador:
        </p>

        <section className="mb-4">
          <h3 className="mb-1 text-[12px] uppercase tracking-widest text-slate-300">
            Chrome / Edge (desktop e Android)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 text-[12px] text-slate-400">
            <li>
              Toque no ícone de <strong>cadeado</strong> (ou ⓘ) à esquerda da
              URL
            </li>
            <li>
              Selecione <strong>&ldquo;Configurações do site&rdquo;</strong>
            </li>
            <li>
              Em <strong>Localização</strong>, escolha{' '}
              <strong>&ldquo;Permitir&rdquo;</strong>
            </li>
            <li>Recarregue a página</li>
          </ol>
        </section>

        <section className="mb-4">
          <h3 className="mb-1 text-[12px] uppercase tracking-widest text-slate-300">
            Firefox
          </h3>
          <ol className="ml-5 list-decimal space-y-1 text-[12px] text-slate-400">
            <li>Clique no ícone de cadeado à esquerda da URL</li>
            <li>
              Em <strong>Permissões</strong>, encontre{' '}
              <strong>Localização</strong>
            </li>
            <li>
              Remova bloqueio (X ao lado) e recarregue — o navegador vai
              perguntar de novo na próxima ação
            </li>
          </ol>
        </section>

        <section className="mb-4">
          <h3 className="mb-1 text-[12px] uppercase tracking-widest text-slate-300">
            Safari (macOS)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 text-[12px] text-slate-400">
            <li>
              Menu <strong>Safari → Preferências → Sites</strong>
            </li>
            <li>
              Selecione <strong>Localização</strong> na lateral
            </li>
            <li>
              Encontre o site Drift e mude pra <strong>Permitir</strong>
            </li>
          </ol>
        </section>

        <section className="mb-4">
          <h3 className="mb-1 text-[12px] uppercase tracking-widest text-slate-300">
            Safari (iOS / iPadOS)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 text-[12px] text-slate-400">
            <li>
              <strong>Ajustes → Safari → Localização</strong> (precisa estar em{' '}
              <em>Perguntar</em> ou <em>Permitir</em>)
            </li>
            <li>
              Sistema: <strong>Ajustes → Privacidade → Serviços de
              Localização</strong> deve estar ativo, e Safari listado
            </li>
            <li>Feche e reabra a aba do Drift</li>
          </ol>
          <p className="mt-2 text-[12px] text-slate-500">
            Nota: iOS Safari não tem permissions API — não dá pra detectar
            estado de antemão. Se permissão foi negada, a única forma de
            reabilitar é via Ajustes do sistema.
          </p>
        </section>

        <div className="mt-4 border-t border-drift-border pt-3 text-[12px] text-slate-500">
          Drift NUNCA envia coordenada precisa por padrão — você escolheu
          a granularidade em Settings (manifesto §28).
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded border border-drift-border px-3 py-2 text-[12px] uppercase tracking-widest text-slate-300 hover:border-drift-accent hover:text-drift-accent"
        >
          fechar
        </button>
      </div>
    </div>
  )
}
