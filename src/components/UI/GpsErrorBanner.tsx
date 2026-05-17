/**
 * Banner amistoso quando user habilitou location_granularity mas a última
 * tentativa de getCurrentLocation retornou null (Lily 29-04 — user comum
 * não abre DevTools, console.warn não é suficiente).
 *
 * Por que warning e não danger:
 *   - Não é falha catastrófica — post foi publicado SEM location, mas foi.
 *   - Danger dispara ansiedade desnecessária; warning comunica "atenção,
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
import { FullPageCard } from './FullPageCard'
import { DriftButton } from './DriftButton'

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
       * V5 polish: border-left 3px drift-warning (mockup v0.7) — visual de
       * alerta sem o vermelho saturado. Mantém warning pra texto pq o
       * padrão "atenção, não bloqueio" continua válido (manifesto §28
       * privacy: post publicou sem location, não é falha catastrófica).
       */}
      {/* design-system: ok reason=layout-horizontal-icon-leading-aguarda-DriftAlert-extension */}
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded-xl border border-drift-warning/20 border-l-[3px] border-l-drift-warning bg-drift-warning/5 px-4 py-3"
      >
        <span className="text-base" aria-hidden="true">
          📍
        </span>
        <div className="flex-1 font-mono text-[12px]">
          <div className="text-drift-warning">{message}</div>
          <div className="text-[11px] text-drift-muted/50">
            Post foi publicado sem location.
          </div>
        </div>
        <DriftButton
          variant="ghost"
          size="sm"
          onClick={() => setShowHelp(true)}
        >
          como ajustar
        </DriftButton>
        <button
          onClick={onDismiss}
          className="text-drift-muted/50 hover:text-drift-warning transition-colors"
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
    <FullPageCard
      onClose={onClose}
      title="como ajustar GPS"
      ariaLabel="como ajustar permissão de GPS"
      clickOutToClose
    >
      <div className="space-y-4 px-4 py-5 text-[12px]">
        <p className="font-mono text-[12px] text-drift-muted/50">
          Drift não pode forçar permissão de GPS — só o navegador permite.
          Siga os passos do seu navegador:
        </p>

        <section className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
          <h3 className="mb-2 font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent">
            Chrome / Edge (desktop e Android)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 font-mono text-[12px] text-drift-muted/50">
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

        <section className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
          <h3 className="mb-2 font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent">
            Firefox
          </h3>
          <ol className="ml-5 list-decimal space-y-1 font-mono text-[12px] text-drift-muted/50">
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

        <section className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
          <h3 className="mb-2 font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent">
            Safari (macOS)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 font-mono text-[12px] text-drift-muted/50">
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

        <section className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
          <h3 className="mb-2 font-display text-[12px] font-bold uppercase tracking-tag text-drift-accent">
            Safari (iOS / iPadOS)
          </h3>
          <ol className="ml-5 list-decimal space-y-1 font-mono text-[12px] text-drift-muted/50">
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
          <p className="mt-2 font-mono text-[11px] text-drift-muted/40">
            Nota: iOS Safari não tem permissions API — não dá pra detectar
            estado de antemão. Se permissão foi negada, a única forma de
            reabilitar é via Ajustes do sistema.
          </p>
        </section>

        <div className="rounded-xl border border-drift-border/20 bg-drift-surface/20 px-4 py-3 font-mono text-[11px] text-drift-muted/40">
          Drift NUNCA envia coordenada precisa por padrão — você escolheu
          a granularidade em Ajustes (manifesto §28).
        </div>
      </div>
    </FullPageCard>
  )
}
