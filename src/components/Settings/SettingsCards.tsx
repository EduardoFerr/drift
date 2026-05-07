/**
 * SettingsCards — V9.2d. Cada seção da ContentSettings vira sua
 * própria overlay focada (FullPageOverlay). User feedback: "cada nova
 * opção nas configurações deveria abrir o seu card exclusivo".
 *
 * Antes: SettingsRoot routava tudo pra ContentSettings (overlay grande
 * com scroll-to-anchor). Acessível mas overcrowded.
 * Agora: cada item do menu abre uma card específica:
 *
 *   FiltersCard       — toggles NSFW/spoilers/ads
 *   LocationCard      — granularidade (off/país/cidade/GPS)
 *   MapViewCard       — fechado/aberto
 *   NetworkModeCard   — clearnet/tor/onion-only + warnings de PWA/Tor
 *   BlobsCard         — Track B (IPFS/Helia status: peers + pinned)
 *   DiagnosticCard    — redefinir cache local
 *
 * Toggle/Picker helpers compartilhados entre as cards. Consomem direto
 * `setPref` da prefs store — sem callback drilling.
 *
 * Manifesto §27 (filtros locais opt-in) + §28 (privacidade pelo mínimo,
 * location off-default) + §15 (Tor anti-censura).
 *
 * ContentSettings legacy permanece (track futura limpa) pra retrocompat
 * dos indicadores 📍🌐 do header pré-V8.
 */

import { useEffect, useState } from 'react'
import { setPref, usePrefsStore } from '../../lib/prefs'
import { dialog } from '../../lib/dialog'
import { db } from '../../lib/db'
import { useBootStore } from '../../lib/bootstrap'
import { useRelaysStore } from '../../lib/relays'
import { isTauri } from '../../lib/runtime'
import { SEED_RELAY_CONFIGS } from '../../config/relays'
import type {
  LocationGranularity,
  MapView,
  NetworkMode,
} from '../../types/drift'
import { FullPageOverlay } from '../UI/FullPageOverlay'

// ─── Pickers/Toggle (locais ao módulo, mas reusáveis externamente
// se exportar). Estilo idêntico ao ContentSettings legacy pra UX
// continuity. ─────────────────────────────────────────────────────

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className="flex w-full items-start justify-between gap-3 rounded border border-drift-border px-4 py-3 text-left transition-colors hover:border-drift-accent/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[12px] text-drift-text">{label}</div>
        <div className="mt-0.5 font-mono text-[10px] leading-relaxed text-drift-muted">
          {hint}
        </div>
      </div>
      <div
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          value
            ? 'border-drift-accent bg-drift-accent/20'
            : 'border-drift-border bg-drift-bg'
        }`}
        aria-hidden="true"
      >
        <div
          className={`h-4 w-4 rounded-full transition-transform ${
            value
              ? 'translate-x-4 bg-drift-accent'
              : 'translate-x-0.5 bg-drift-muted'
          }`}
        />
      </div>
    </button>
  )
}

const GRANULARITY_OPTIONS: { value: LocationGranularity; label: string; hint: string }[] = [
  { value: 'off', label: 'off', hint: 'sem location (recomendado)' },
  { value: 'country', label: 'país', hint: '~111km (1° de precisão)' },
  { value: 'city', label: 'cidade', hint: '~11km (área metropolitana)' },
  { value: 'precise', label: 'GPS', hint: '~1m (identifica quarteirão — cuidado)' },
]

const MAP_VIEW_OPTIONS: { value: MapView; label: string; hint: string }[] = [
  { value: 'fit-bounds', label: 'fechado', hint: 'foca na região (origem + drifters)' },
  { value: 'open', label: 'aberto', hint: 'globo inteiro, zoom baixo' },
]

const NETWORK_MODE_OPTIONS: {
  value: NetworkMode
  label: string
  hintTauri: string
  hintBrowser: string
  requiresTauri: boolean
}[] = [
  {
    value: 'clearnet',
    label: '🌐 clearnet',
    hintTauri: 'WSS direto pros relays públicos (default)',
    hintBrowser: 'WSS direto pros relays públicos (default)',
    requiresTauri: false,
  },
  {
    value: 'tor',
    label: '🧅 tor',
    hintTauri: 'WSS via SOCKS5 local (arti) — IP não vaza pro relay',
    hintBrowser: 'Tor exige cliente desktop (Tauri)',
    requiresTauri: true,
  },
  {
    value: 'onion-only',
    label: '🛡 onion-only',
    hintTauri: 'só conecta a relays .onion — modo paranoia máximo',
    hintBrowser: 'onion-only exige cliente desktop (Tauri)',
    requiresTauri: true,
  },
]

interface CardProps {
  onClose: () => void
}

// ─── FiltersCard ─────────────────────────────────────────────────

export function FiltersCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageOverlay onClose={onClose} title="filtros" ariaLabel="filtros de conteúdo">
      <div className="space-y-3 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Manifesto §27 — autor declara via tag <code>content-warning</code>;
          aqui você decide o que faz com cada categoria. Nada sai deste
          dispositivo.
        </p>
        <Toggle
          label="mostrar NSFW / violência sem blur"
          hint="default OFF — posts marcados aparecem com blur até toque"
          value={prefs.show_nsfw_default}
          onChange={(v) => setPref('show_nsfw_default', v)}
        />
        <Toggle
          label="esconder spoilers até clicar"
          hint="default ON — posts marcados como spoiler ficam ocultos no feed"
          value={prefs.hide_spoilers}
          onChange={(v) => setPref('hide_spoilers', v)}
        />
        <Toggle
          label="esconder anúncios"
          hint="posts marcados como ad pelo autor não aparecem no feed"
          value={prefs.hide_ads}
          onChange={(v) => setPref('hide_ads', v)}
        />
      </div>
    </FullPageOverlay>
  )
}

// ─── LocationCard ────────────────────────────────────────────────

export function LocationCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageOverlay onClose={onClose} title="location nos meus posts" ariaLabel="granularidade de location">
      <div className="space-y-4 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Manifesto §28 — default <code>off</code>. Cidade pequena +
          opinião política = identificável. Ative só se entender o
          tradeoff.
        </p>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="radiogroup"
          aria-label="granularidade"
        >
          {GRANULARITY_OPTIONS.map((opt) => {
            const active = prefs.location_granularity === opt.value
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => void setPref('location_granularity', opt.value)}
                className={`rounded border px-2 py-3 font-mono text-[11px] uppercase tracking-[1.5px] transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg ${
                  active
                    ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                    : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
                }`}
                title={opt.hint}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {/* Detalhe do valor selecionado — explica o que vai pra rede. */}
        <div className="rounded border border-drift-border bg-drift-bg/50 p-3 font-mono text-[10px] leading-relaxed text-drift-muted">
          <span className="text-drift-text">
            {GRANULARITY_OPTIONS.find((o) => o.value === prefs.location_granularity)?.label}
          </span>
          {' — '}
          {GRANULARITY_OPTIONS.find((o) => o.value === prefs.location_granularity)?.hint}
        </div>
      </div>
    </FullPageOverlay>
  )
}

// ─── MapViewCard ─────────────────────────────────────────────────

export function MapViewCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageOverlay onClose={onClose} title="mapa de spread" ariaLabel="enquadramento do mapa">
      <div className="space-y-4 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Como o mapa enquadra os pontos do post. <code>fechado</code>{' '}
          foca na região onde houve deriva; <code>aberto</code> mostra o
          globo todo (útil pra posts intercontinentais).
        </p>
        <div
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="enquadramento"
        >
          {MAP_VIEW_OPTIONS.map((opt) => {
            const active = prefs.map_view === opt.value
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => void setPref('map_view', opt.value)}
                className={`rounded border px-2 py-3 font-mono text-[11px] uppercase tracking-[1.5px] transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg ${
                  active
                    ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                    : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
                }`}
                title={opt.hint}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </FullPageOverlay>
  )
}

// ─── NetworkModeCard ─────────────────────────────────────────────

export function NetworkModeCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  const relaysList = useRelaysStore((s) => s.list)
  const bootStep = useBootStore((s) => s.step)
  const degradedReasons = useBootStore((s) => s.degradedReasons)
  const tauriRuntime = isTauri()

  // Anti-isolation: onion-only sem nenhum relay com alias .onion.
  const onionAvailable = (() => {
    if (prefs.network_mode !== 'onion-only') return true
    const onionByUrl = new Map<string, string>()
    for (const cfg of SEED_RELAY_CONFIGS) {
      if (cfg.onion) onionByUrl.set(cfg.url, cfg.onion)
    }
    return relaysList.some((r) => r.enabled && onionByUrl.has(r.url))
  })()

  // PWA browser não roteia via Tor — leak silencioso.
  const torSelectedInPwa =
    !tauriRuntime &&
    (prefs.network_mode === 'tor' || prefs.network_mode === 'onion-only')

  // Boot terminou em erro com Tor configurado.
  const torConfiguredButBootError =
    tauriRuntime &&
    (prefs.network_mode === 'tor' || prefs.network_mode === 'onion-only') &&
    bootStep === 'error'

  // Razão Tor-related no degradedReasons (boot ready mas Tor não roda).
  const torDegradedReason = degradedReasons.find(
    (r) => r.code === 'TOR_BOOTSTRAP_FAILED' || r.code === 'TOR_FEATURE_OFF',
  )

  async function changeMode(v: NetworkMode) {
    if (v === prefs.network_mode) return
    const next = v === 'tor' || v === 'onion-only' ? 'Tor' : 'clearnet'
    const ok = await dialog.confirm(
      `Trocar para ${next} exige recarregar a aba para aplicar.`,
      {
        title: 'modo de rede',
        okLabel: 'recarregar',
      },
    )
    if (!ok) return
    await setPref('network_mode', v)
    window.location.reload()
  }

  return (
    <FullPageOverlay onClose={onClose} title="modo de rede" ariaLabel="modo de rede">
      <div className="space-y-4 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Manifesto §15 — em país que bloqueia relays Nostr, Tor
          contorna. Default <code>clearnet</code> (sem overhead).{' '}
          <code>tor</code> rota via SOCKS5 local (latência +500ms-2s;
          exige cliente desktop). <code>onion-only</code> = paranoia
          máxima.
        </p>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="modo de rede"
        >
          {NETWORK_MODE_OPTIONS.map((opt) => {
            const active = prefs.network_mode === opt.value
            const disabled = opt.requiresTauri && !tauriRuntime
            const hint = tauriRuntime ? opt.hintTauri : opt.hintBrowser
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => {
                  if (disabled) return
                  void changeMode(opt.value)
                }}
                disabled={disabled}
                className={`rounded border px-2 py-3 font-mono text-[11px] uppercase tracking-[1.5px] transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg ${
                  active
                    ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                    : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
                } ${disabled ? 'cursor-not-allowed opacity-40 hover:border-drift-border' : ''}`}
                title={hint}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-amber-500/70">
          Status atual: scaffold/stub em PWA. Tor real funciona em build
          Tauri com <code>--features arti</code>. Trocar de modo exige
          reload (limitação do <code>SimplePool</code> global).
        </p>

        {/* Warnings condicionais — alinhados ao ContentSettings legacy. */}
        {torSelectedInPwa && (
          <Alert
            tone="error"
            title={`⚠ modo ${prefs.network_mode === 'tor' ? 'tor' : 'onion-only'} selecionado em PWA — IP do user vaza pros relays`}
          >
            PWA browser não tem como rotear via Tor (webview ignora SOCKS5
            programático). Sua conexão continua <strong>clearnet</strong>{' '}
            apesar do modo escolhido. Pra Tor real: build Tauri desktop
            com <code>cargo tauri build --features arti</code>.
          </Alert>
        )}
        {torConfiguredButBootError && (
          <Alert
            tone="error"
            title="⚠ Tor configurado mas boot terminou em erro"
          >
            Modo <code>{prefs.network_mode}</code> ativo mas o boot não
            completou. Verifique o console pra mensagem de erro
            específica. Considere voltar pra <code>clearnet</code> até o
            problema ser diagnosticado.
          </Alert>
        )}
        {torDegradedReason && (
          <Alert
            tone="warn"
            title="⚠ Tor selecionado mas não conectou — modo degradado"
          >
            {torDegradedReason.code === 'TOR_FEATURE_OFF'
              ? 'Build atual não tem feature arti compilada (cargo tauri build --features arti). '
              : 'Bootstrap do daemon Tor falhou. '}
            Tráfego está em clearnet. Detalhes:{' '}
            <code className="break-all">{torDegradedReason.message}</code>.
          </Alert>
        )}
        {!onionAvailable && (
          <Alert
            tone="error"
            title="⚠ onion-only ativo, nenhum relay .onion disponível"
          >
            Nenhum dos seus relays habilitados publica alias{' '}
            <code>.onion</code>. Em <code>onion-only</code>, o app fica
            isolado (feed sem novos eventos, publicação falha). Volte pra{' '}
            <code>tor</code> ou <code>clearnet</code>, ou adicione
            manualmente um relay <code>.onion</code> em settings → relays.
          </Alert>
        )}
      </div>
    </FullPageOverlay>
  )
}

function Alert({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'warn'
  title: string
  children: React.ReactNode
}) {
  const colors =
    tone === 'error'
      ? 'border-red-700/60 bg-red-950/30 text-red-300'
      : 'border-amber-700/60 bg-amber-950/30 text-amber-300'
  const titleColor = tone === 'error' ? 'text-red-200' : 'text-amber-200'
  return (
    <div role="alert" className={`rounded border px-3 py-2 font-mono text-[10px] leading-relaxed ${colors}`}>
      <strong className={`block ${titleColor}`}>{title}</strong>
      <span className="mt-1 block opacity-80">{children}</span>
    </div>
  )
}

// ─── BlobsCard (Track B.3) ────────────────────────────────────────

/**
 * BlobsCard — status do Helia/IPFS local.
 *
 * Track B.3 (manifesto §16 — disponibilidade distribuída): mostra
 * pra que ponto o user está contribuindo. "Servindo N blobs a M peers"
 * dá feedback concreto de "minha cópia está disponível pra outros".
 *
 * Init é lazy: só baixa o ecosystem Helia (~950 KiB) quando o user abre
 * este card. Antes disso, status é "não inicializado". Botão explícito
 * "ligar Helia" — manifesto §17 (sem chave mestra, opt-in vence).
 */
export function BlobsCard({ onClose }: CardProps) {
  type Stats = { running: boolean; peerCount: number; pinnedCount: number }
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const helia = await import('../../lib/helia')
      const s = await helia.heliaStats()
      setStats(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh a cada 5s enquanto o card está aberto E Helia já foi
  // inicializado pelo menos uma vez. Sem isso, peer count fica
  // desatualizado em conexões instáveis. Para quando user fecha.
  useEffect(() => {
    if (!stats) return
    const id = setInterval(() => void refresh(), 5_000)
    return () => clearInterval(id)
  }, [stats])

  return (
    <FullPageOverlay
      onClose={onClose}
      title="distribuição de blobs"
      ariaLabel="status helia ipfs"
    >
      <div className="space-y-4 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Drift hospeda imagens via IPFS (Helia) com fallback HTTP.
          Quando você dá DRIFT em um post, sua cópia local também serve
          aquele blob a outros usuários — manifesto §16 (disponibilidade
          distribuída).
        </p>

        {!stats && !loading && (
          <button
            onClick={() => void refresh()}
            className="w-full rounded border border-drift-accent2 bg-drift-surface px-3 py-3 font-mono text-[11px] uppercase tracking-[1.5px] text-drift-accent2 transition-colors hover:bg-drift-accent2/10 focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
          >
            ⊕ inicializar helia
          </button>
        )}

        {loading && (
          <div className="font-mono text-[11px] text-drift-muted">
            inicializando helia… (~950 KiB no primeiro uso)
          </div>
        )}

        {error && (
          <div className="rounded border border-red-700/60 bg-red-950/20 p-3 font-mono text-[11px] leading-relaxed text-red-300">
            falha: {error}
          </div>
        )}

        {stats && (
          <div className="space-y-2 rounded border border-drift-border bg-drift-surface p-4 font-mono text-[11px]">
            <Row
              label="estado"
              value={stats.running ? '● rodando' : '○ parado'}
              valueClass={stats.running ? 'text-drift-spread' : 'text-drift-muted'}
            />
            <Row
              label="peers conectados"
              value={String(stats.peerCount)}
              valueClass="text-drift-text"
            />
            <Row
              label="blobs servindo"
              value={String(stats.pinnedCount)}
              valueClass="text-drift-text"
            />
            <button
              onClick={() => void refresh()}
              className="mt-2 w-full rounded border border-drift-border px-3 py-2 text-[10px] uppercase tracking-[1.5px] text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus:ring-1 focus:ring-drift-accent2"
            >
              ↻ atualizar
            </button>
          </div>
        )}
      </div>
    </FullPageOverlay>
  )
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-[1.5px] text-drift-muted">
        {label}
      </span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

// ─── DiagnosticCard ──────────────────────────────────────────────

export function DiagnosticCard({ onClose }: CardProps) {
  const [rebuilding, setRebuilding] = useState(false)

  async function handleRebuild() {
    const ok = await dialog.confirm(
      'Identidade (nsec) e preferências serão preservadas. Posts, spreads, buries e reports locais serão apagados — tudo re-sincroniza dos relays automaticamente.\n\nÚtil quando o banco entrou em estado inconsistente após upgrade.',
      {
        title: 'reconstruir banco local',
        dangerous: true,
        okLabel: 'reconstruir',
      },
    )
    if (!ok) return
    setRebuilding(true)
    try {
      await db.rebuildDomainSchema()
      location.reload()
    } catch (err) {
      setRebuilding(false)
      await dialog.alert(
        `Falha ao reconstruir: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    }
  }

  return (
    <FullPageOverlay
      onClose={onClose}
      title="diagnóstico"
      ariaLabel="diagnóstico — redefinir cache"
      escDismissible={!rebuilding}
    >
      <div className="space-y-4 p-5">
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          Se a app travar com erro de schema (ex:{' '}
          <code>no such column</code>), reconstrói o banco local.
          Identidade e preferências preservadas; posts re-sincronizam dos
          relays.
        </p>
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          className="w-full rounded border border-yellow-700/60 bg-yellow-950/20 px-3 py-3 font-mono text-[11px] uppercase tracking-[1.5px] text-yellow-300 transition-colors hover:bg-yellow-950/40 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-bg"
        >
          {rebuilding ? 'reconstruindo…' : '↻ redefinir cache local'}
        </button>
      </div>
    </FullPageOverlay>
  )
}
