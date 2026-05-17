/**
 * SettingsCards — V9.2d. Cada seção da ContentSettings vira sua
 * própria overlay focada (FullPageCard). User feedback: "cada nova
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

import { useCallback, useEffect, useState } from 'react'
import { setPref, usePrefsStore } from '../../lib/prefs'
import { dialog } from '../../lib/dialog'
import { db } from '../../lib/db'
import { useBootStore } from '../../lib/bootstrap'
import { rebuildIdentityHistory, useSyncStore } from '../../lib/sync'
import { useRelaysStore } from '../../lib/relays'
import { isTauri } from '../../lib/runtime'
import { SEED_RELAY_CONFIGS } from '../../config/relays'
import type {
  LocationGranularity,
  MapView,
  NetworkMode,
} from '../../types/drift'
import { FullPageCard } from '../UI/FullPageCard'
import { Collapse } from '../UI/Collapse'
import { ChevronDownIcon } from '../UI/Icons'

// ─── Accordion helpers ──────────────────────────────────────────

function useAccordion(initial: number | null = 0) {
  const [open, setOpen] = useState<number | null>(initial)
  const toggle = (i: number) => setOpen((prev) => (prev === i ? null : i))
  return { open, toggle }
}

function SectionHeader({
  title,
  expanded,
  onToggle,
}: {
  title: string
  expanded?: boolean
  onToggle?: () => void
}) {
  // Static header (sem accordion) quando não recebe handlers — usado em cards single-section
  if (!onToggle) {
    return (
      <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5">
        <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
          {title}
        </span>
      </div>
    )
  }
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3 rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-3.5 text-left transition-colors"
    >
      <span className="flex-1 font-display text-[14px] font-bold uppercase tracking-tag text-drift-accent">
        {title}
      </span>
      <span
        className={`shrink-0 text-drift-muted/40 transition-transform duration-motion-emphasis ease-drift-inout ${expanded ? 'rotate-180' : ''}`}
      >
        <ChevronDownIcon size={16} />
      </span>
    </button>
  )
}

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
      className="flex w-full items-start justify-between gap-3.5 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5 text-left transition-colors hover:border-drift-accent2/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[13px] text-drift-text">{label}</div>
        <div className="mt-0.5 font-mono text-[10px] text-drift-muted/40">
          {hint}
        </div>
      </div>
      <div
        className={`mt-1 flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value
            ? 'bg-drift-accent/25'
            : 'bg-drift-border/60'
        }`}
        aria-hidden="true"
      >
        <div
          className={`h-5 w-5 rounded-full shadow-sm transition-transform ${
            value
              ? 'translate-x-5 bg-drift-accent'
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
    <FullPageCard onClose={onClose} title="filtros" ariaLabel="filtros de conteúdo">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="visibilidade" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          você decide o que ver. nada sai deste dispositivo.
        </p>
        <div className="space-y-2 pl-3">
          <Toggle
            label="mostrar NSFW / violência sem blur"
            hint="posts marcados aparecem com blur até toque"
            value={prefs.show_nsfw_default}
            onChange={(v) => setPref('show_nsfw_default', v)}
          />
          <Toggle
            label="esconder spoilers até clicar"
            hint="posts marcados como spoiler ficam ocultos no feed"
            value={prefs.hide_spoilers}
            onChange={(v) => setPref('hide_spoilers', v)}
          />
          <Toggle
            label="esconder anúncios"
            hint="posts marcados como ad não aparecem no feed"
            value={prefs.hide_ads}
            onChange={(v) => setPref('hide_ads', v)}
          />
        </div>
      </div>
    </FullPageCard>
  )
}

// ─── LocationCard ────────────────────────────────────────────────

export function LocationCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageCard onClose={onClose} title="location" ariaLabel="granularidade de location">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="granularidade" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          default off. cidade pequena + opinião política = identificável.
        </p>
        <div className="pl-3">
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
                  className={`rounded-xl border px-3 py-3 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    active
                      ? 'border-drift-accent/50 bg-drift-accent/10 text-drift-accent'
                      : 'border-drift-border/30 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/25 hover:text-drift-text'
                  }`}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <div className="mt-2 rounded-xl border border-drift-border/20 bg-drift-surface/20 px-4 py-3 font-mono text-[11px] leading-relaxed text-drift-muted/40">
            <span className="text-drift-text/80">
              {GRANULARITY_OPTIONS.find((o) => o.value === prefs.location_granularity)?.label}
            </span>
            {' — '}
            {GRANULARITY_OPTIONS.find((o) => o.value === prefs.location_granularity)?.hint}
          </div>
        </div>
      </div>
    </FullPageCard>
  )
}

// ─── MapViewCard ─────────────────────────────────────────────────

export function MapViewCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageCard onClose={onClose} title="mapa de spread" ariaLabel="enquadramento do mapa">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="enquadramento" />
        <div className="pl-3">
          <p className="mb-2 font-mono text-[10px] text-drift-muted/30">
            fechado foca na região com atividade. aberto mostra o globo.
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
                  className={`rounded-xl border px-3 py-3 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    active
                      ? 'border-drift-accent/50 bg-drift-accent/10 text-drift-accent'
                      : 'border-drift-border/30 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/25 hover:text-drift-text'
                  }`}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </FullPageCard>
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
    <FullPageCard onClose={onClose} title="modo de rede" ariaLabel="modo de rede">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="transporte" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          default clearnet. tor contorna bloqueios (exige desktop).
        </p>
        <div className="pl-3 space-y-3">
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
                      className={`rounded-xl border px-3 py-3 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                        active
                          ? 'border-drift-accent/50 bg-drift-accent/10 text-drift-accent'
                          : 'border-drift-border/30 bg-drift-surface/30 text-drift-muted hover:border-drift-accent2/25 hover:text-drift-text'
                      } ${disabled ? 'cursor-not-allowed opacity-25 hover:border-drift-border/30' : ''}`}
                      title={hint}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="font-mono text-[10px] text-drift-muted/25">
                scaffold em PWA. tor real: build Tauri com --features arti.
              </p>

              {torSelectedInPwa && (
                <Alert
                  tone="error"
                  title={`modo ${prefs.network_mode === 'tor' ? 'tor' : 'onion-only'} em PWA — IP vaza`}
                >
                  PWA browser não roteia via Tor. Conexão continua <strong>clearnet</strong>.
                </Alert>
              )}
              {torConfiguredButBootError && (
                <Alert
                  tone="error"
                  title="tor configurado mas boot falhou"
                >
                  Modo <code>{prefs.network_mode}</code> ativo mas boot não completou. Volte pra clearnet.
                </Alert>
              )}
              {torDegradedReason && (
                <Alert
                  tone="warn"
                  title="tor não conectou — modo degradado"
                >
                  {torDegradedReason.code === 'TOR_FEATURE_OFF'
                    ? 'Build sem feature arti. '
                    : 'Bootstrap Tor falhou. '}
                  Tráfego em clearnet.
                </Alert>
              )}
              {!onionAvailable && (
                <Alert
                  tone="error"
                  title="onion-only sem relay .onion disponível"
                >
                  Nenhum relay habilitado tem alias .onion. App isolado.
                </Alert>
              )}
        </div>
      </div>
    </FullPageCard>
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
      ? 'border-drift-danger/20 bg-drift-danger/5 text-drift-danger'
      : 'border-drift-warning/20 bg-drift-warning/5 text-drift-warning'
  const titleColor = tone === 'error' ? 'text-drift-danger' : 'text-drift-warning'
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 font-mono text-[11px] leading-relaxed ${colors}`}>
      <strong className={`block text-[12px] ${titleColor}`}>{title}</strong>
      <span className="mt-1 block opacity-50">{children}</span>
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
  const useIpfs = usePrefsStore((s) => s.use_ipfs)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  /**
   * Toggle do use_ipfs pref. Quando user desliga com Helia rodando,
   * disparamos `disposeHelia()` em background — encerra libp2p e
   * elimina o WS chatter imediatamente. Não bloqueia o setPref
   * (UI atualiza sincronamente).
   */
  async function handleToggleIpfs(v: boolean) {
    usePrefsStore.setState({ use_ipfs: v })
    setPref('use_ipfs', v).catch(() => {})
    if (!v && stats?.running) {
      // dispose silencioso — falha não importa, watcher pega depois
      try {
        const helia = await import('../../lib/helia')
        await helia.disposeHelia()
      } catch {
        // ignora
      }
      setStats(null)
    }
  }

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

  /**
   * Desliga Helia explicitamente. User feedback 2026-05-08 (Robin
   * diagnóstico): libp2p autodial mantém WS connections abertas
   * indefinidamente, gerando ruído de rede mesmo quando user não
   * está usando o Drift ativamente. Botão "desligar" dá controle
   * — manifesto §17 (sem chave mestra: opt-in vence).
   *
   * NÃO afeta blobs já pinados localmente (IndexedDB persiste).
   * Próxima vez que user upar/fetcher um blob com cid, Helia
   * re-inicializa (lazy via getHelia singleton).
   */
  async function handleStop() {
    if (stopping) return
    setStopping(true)
    setError(null)
    try {
      const helia = await import('../../lib/helia')
      await helia.disposeHelia()
      setStats(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStopping(false)
    }
  }

  // Auto-fetch stats on mount quando pref está ativa — sem isso,
  // fechar e reabrir o card mostra "inicializar" em vez do estado real.
  useEffect(() => {
    if (useIpfs && !stats && !loading) void refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh a cada 5s enquanto card está aberto E Helia rodando.
  useEffect(() => {
    if (!stats?.running) return
    const id = setInterval(() => void refresh(), 5_000)
    return () => clearInterval(id)
  }, [stats?.running])

  return (
    <FullPageCard
      onClose={onClose}
      title="blobs (ipfs)"
      ariaLabel="status helia ipfs"
    >
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="distribuição" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          imagens via IPFS com fallback HTTP. sua cópia serve blobs a outros.
        </p>

        <div className="space-y-2 pl-3">
          <Toggle
            label="usar IPFS"
            hint="distribuir via libp2p — banda extra, melhor disponibilidade"
            value={useIpfs}
            onChange={(v) => void handleToggleIpfs(v)}
          />

          {!useIpfs && (
            <div className="rounded-xl border border-drift-border/20 bg-drift-surface/20 px-4 py-3 font-mono text-[11px] text-drift-muted/40">
              IPFS desativado. Imagens servidas via HTTP.
            </div>
          )}

          {useIpfs && !stats && !loading && (
            <button
              onClick={() => void refresh()}
              className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              ⊕ inicializar helia
            </button>
          )}

          {useIpfs && loading && (
            <div className="px-1 font-mono text-[11px] text-drift-muted/50">
              inicializando helia…
            </div>
          )}

          {useIpfs && error && (
            <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
              falha: {error}
            </div>
          )}

          {useIpfs && stats && (
            <div className="space-y-3 rounded-xl border border-drift-border/30 bg-drift-surface/30 p-4 font-mono text-[12px]">
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
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void refresh()}
                  className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                >
                  ↻ atualizar
                </button>
                {stats.running && (
                  <button
                    onClick={() => void handleStop()}
                    disabled={stopping}
                    className="flex-1 rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-3 py-2.5 text-[12px] uppercase tracking-meta text-drift-danger transition-colors hover:bg-drift-danger/10 disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-danger/30"
                  >
                    {stopping ? 'desligando…' : '⊗ desligar'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </FullPageCard>
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
      <span className="text-[11px] uppercase tracking-meta text-drift-muted/50">
        {label}
      </span>
      <span className={`text-[12px] ${valueClass}`}>{value}</span>
    </div>
  )
}

// ─── PeersCard (Fase 6 — P2P discovery) ─────────────────────────

/**
 * PeersCard — UI para os 4 mecanismos de discovery P2P.
 *
 * Manifesto §12 (multi-transport), §15 (anti-censura), §16
 * (disponibilidade distribuída), §31.3 (resiliência offline).
 *
 * Seções:
 *  1. Meu QR / Link — exibe QR + copy/share link
 *  2. Conectar — scan QR (camera/foto) + paste nprofile/npub
 *  3. Bundle offline — export + import .json (sneakernet)
 *  4. Auto-discovery — toggle p2p_auto_follows (NIP-02)
 */
export function PeersCard({ onClose }: CardProps) {
  const acc = useAccordion(0)
  const identity = useBootStore((s) => s.identity)
  const prefs = usePrefsStore()
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [peerInput, setPeerInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectOk, setConnectOk] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<string | null>(null)
  // ID estável pra scanFile (html5-qrcode precisa de um element id, mas
  // usa um div oculto — não renderiza nada visível).
  const [scanDivId] = useState(() => 'qr-decode-' + Math.random().toString(36).slice(2, 8))

  useEffect(() => {
    if (!identity) return
    void import('../../lib/transport/webrtc').then(({ generatePeerQR }) => {
      void import('../../lib/relays').then(({ activeWriteRelays }) => {
        const hints = activeWriteRelays().slice(0, 3)
        void generatePeerQR(identity.npub, hints).then(setQrUrl)
      })
    })
  }, [identity])

  async function handleCopyLink() {
    if (!identity) return
    const { buildPeerURL } = await import('../../lib/transport/webrtc')
    const { activeWriteRelays } = await import('../../lib/relays')
    const hints = activeWriteRelays().slice(0, 3)
    const url = buildPeerURL(identity.npub, hints)
    if (typeof navigator.share === 'function') {
      await navigator.share({ url, title: 'drift peer' })
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleConnect() {
    const raw = peerInput.trim()
    if (!raw) return
    setConnecting(true)
    setConnectError(null)
    setConnectOk(false)
    try {
      const { decodePeerLink, connectTo } = await import('../../lib/transport/webrtc')
      const parsed = decodePeerLink(raw)
      if (!parsed) {
        setConnectError('formato invalido — cole um npub1... ou nprofile1...')
        return
      }
      if (identity && parsed.npubHex === identity.npub) {
        setConnectError('esse link é seu — compartilhe com outro peer')
        return
      }
      await connectTo(parsed.npubHex)
      setConnectOk(true)
      setPeerInput('')
      setTimeout(() => setConnectOk(false), 3000)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanError(null)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode(scanDivId)
      const result = await scanner.scanFile(file, false)
      scanner.clear()
      setPeerInput(result)
    } catch {
      setScanError('nenhum QR encontrado na imagem')
    }
    e.target.value = ''
  }

  async function handleExport() {
    if (!identity) return
    setExporting(true)
    setExportResult(null)
    try {
      const { db } = await import('../../lib/db')
      const { exportBundle } = await import('../../lib/transport/webrtc')
      type RawRow = { raw_event: string | null }
      const npub = identity.npub
      const rows = await db.exec<RawRow>(
        `SELECT raw_event FROM posts WHERE author_pub = ? AND raw_event IS NOT NULL
         UNION ALL
         SELECT raw_event FROM spreads WHERE spreader_pub = ? AND raw_event IS NOT NULL
         UNION ALL
         SELECT raw_event FROM buries WHERE burier_pub = ? AND raw_event IS NOT NULL
         LIMIT 500`,
        [npub, npub, npub],
      )
      const seen = new Set<string>()
      const events: import('../../types/nostr').SignedEvent[] = []
      for (const row of rows) {
        if (!row.raw_event) continue
        try {
          const ev = JSON.parse(row.raw_event) as import('../../types/nostr').SignedEvent
          if (!ev.id || seen.has(ev.id)) continue
          seen.add(ev.id)
          events.push(ev)
        } catch { /* malformed */ }
      }
      if (events.length === 0) {
        setExportResult('nenhum evento pra exportar')
        return
      }
      const bundle = exportBundle(events)
      const blob = new Blob([bundle.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `drift-bundle-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setExportResult(`${bundle.eventCount} evento${bundle.eventCount !== 1 ? 's' : ''} exportado${bundle.eventCount !== 1 ? 's' : ''}`)
    } catch (err) {
      setExportResult(`falha: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const { importBundle } = await import('../../lib/transport/webrtc')
      const { onNostrEvent } = await import('../../lib/events')
      const events = await importBundle(text)
      for (const ev of events) {
        onNostrEvent(ev)
      }
      setImportResult(`${events.length} evento${events.length !== 1 ? 's' : ''} importado${events.length !== 1 ? 's' : ''}`)
    } catch (err) {
      setImportResult(`falha: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <FullPageCard onClose={onClose} title="peers P2P" ariaLabel="conexao peer-to-peer">
      <div className="space-y-3 px-4 py-5">

        {/* ── 1. Meu QR / Link ──────────────────────────────────── */}
        <SectionHeader title="meu qr" expanded={acc.open === 0} onToggle={() => acc.toggle(0)} />
        <Collapse open={acc.open === 0}>
          <div className="space-y-2 pl-3">
            <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 p-5">
              {qrUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <img
                    src={qrUrl}
                    alt="QR code do meu perfil"
                    width={200}
                    height={200}
                    className="rounded-lg"
                  />
                  <span className="font-mono text-[10px] text-drift-muted/40 break-all text-center">
                    {identity?.npubBech32
                      ? identity.npubBech32.slice(0, 20) + '…' + identity.npubBech32.slice(-8)
                      : ''}
                  </span>
                </div>
              ) : (
                <div className="font-mono text-[11px] text-drift-muted/40 text-center py-8">
                  gerando QR…
                </div>
              )}
            </div>
            <button
              onClick={() => void handleCopyLink()}
              className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 active:bg-drift-accent2/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
            >
              {copied ? '✓ copiado' : typeof navigator.share === 'function' ? '↗ compartilhar link' : '⎘ copiar link'}
            </button>
          </div>
        </Collapse>

        {/* ── 2. Conectar (scan + paste) ─────────────────────────── */}
        <SectionHeader title="conectar" expanded={acc.open === 1} onToggle={() => acc.toggle(1)} />
        <Collapse open={acc.open === 1}>
          <>
            <p className="px-1 font-mono text-[10px] text-drift-muted/30">
              escaneie o QR de outro usuario ou cole o link.
            </p>
            <div className="space-y-2 pl-3">
              <div id={scanDivId} className="hidden" />
              <div className="flex gap-2">
                <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 focus-within:ring-2 focus-within:ring-drift-accent2/40">
                  ◉ câmera
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => void handleScanFile(e)}
                    className="sr-only"
                  />
                </label>
                <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-accent2/25 hover:text-drift-accent2 focus-within:ring-2 focus-within:ring-drift-accent2/40">
                  ▣ galeria
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handleScanFile(e)}
                    className="sr-only"
                  />
                </label>
              </div>
              {scanError && (
                <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
                  {scanError}
                </div>
              )}

              <input
                type="text"
                value={peerInput}
                onChange={(e) => {
                  setPeerInput(e.target.value)
                  setConnectError(null)
                  setConnectOk(false)
                }}
                placeholder="npub1… ou nprofile1…"
                className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/25 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
              />
              <p className="px-1 font-mono text-[10px] text-drift-warning/40">
                conexão direta — seu IP será visível para este peer
              </p>
              <button
                onClick={() => void handleConnect()}
                disabled={connecting || !peerInput.trim()}
                className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 active:bg-drift-accent2/75 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {connecting ? 'conectando…' : connectOk ? '✓ conectado' : '⊕ conectar'}
              </button>
              {connectError && (
                <div className="rounded-xl border border-drift-danger/20 bg-drift-danger/5 px-4 py-2.5 font-mono text-[11px] text-drift-danger">
                  {connectError}
                </div>
              )}
            </div>
          </>
        </Collapse>

        {/* ── 3. Bundle offline ──────────────────────────────────── */}
        <SectionHeader title="bundle offline" expanded={acc.open === 2} onToggle={() => acc.toggle(2)} />
        <Collapse open={acc.open === 2}>
          <>
            <p className="px-1 font-mono text-[10px] text-drift-muted/30">
              exporte pra .json e passe via USB, airdrop, email.
            </p>
            <div className="space-y-2 pl-3">
              <div className="flex gap-2">
                <button
                  onClick={() => void handleExport()}
                  disabled={exporting || !identity}
                  className="flex-1 rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                >
                  {exporting ? 'exportando…' : '↑ exportar'}
                </button>
                <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-drift-accent2/25 bg-drift-surface/30 px-3 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 transition-colors hover:bg-drift-accent2/10 focus-within:ring-2 focus-within:ring-drift-accent2/40">
                  {importing ? 'importando…' : '↓ importar'}
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void handleImportFile(e)}
                    className="sr-only"
                    disabled={importing}
                  />
                </label>
              </div>
              {exportResult && (
                <div
                  className={`rounded-xl border px-4 py-2.5 font-mono text-[11px] ${
                    exportResult.startsWith('falha') || exportResult.startsWith('nenhum')
                      ? 'border-drift-warning/20 bg-drift-warning/5 text-drift-warning'
                      : 'border-drift-spread/20 bg-drift-spread/5 text-drift-spread'
                  }`}
                >
                  {exportResult}
                </div>
              )}
              {importResult && (
                <div
                  className={`rounded-xl border px-4 py-2.5 font-mono text-[11px] ${
                    importResult.startsWith('falha')
                      ? 'border-drift-danger/20 bg-drift-danger/5 text-drift-danger'
                      : 'border-drift-spread/20 bg-drift-spread/5 text-drift-spread'
                  }`}
                >
                  {importResult}
                </div>
              )}
            </div>
          </>
        </Collapse>

        {/* ── 4. Auto-discovery (NIP-02) ─────────────────────────── */}
        <SectionHeader title="auto-discovery" expanded={acc.open === 3} onToggle={() => acc.toggle(3)} />
        <Collapse open={acc.open === 3}>
          <div className="pl-3">
            <Toggle
              label="conectar com quem voce segue"
              hint="quem voce segue pode ver seu IP. default OFF."
              value={prefs.p2p_auto_follows}
              onChange={(v) => void setPref('p2p_auto_follows', v)}
            />
          </div>
        </Collapse>
      </div>
    </FullPageCard>
  )
}

// ─── DiagnosticCard ──────────────────────────────────────────────

export function DiagnosticCard({ onClose }: CardProps) {
  const acc = useAccordion(0)
  const [rebuilding, setRebuilding] = useState(false)
  const npub = useBootStore((s) => s.identity?.npub) ?? null
  const rebuildsInProgress = useSyncStore((s) => s.rebuildsInProgress)
  const historyRebuilding = npub ? rebuildsInProgress.includes(npub) : false

  // V9.10 (user report 2026-05-09 "cliente novo não está recebendo
  // mensagens do antigo 0.2-0.4"): startSync usa janela de 7d
  // (INITIAL_WINDOW_SECONDS) — eventos antigos do mesmo nsec ficam fora
  // do filter. Trigger explícito de rebuildIdentityHistory puxa TUDO
  // do npub atual (filter authors=[npub], sem since), atravessando
  // qualquer cap temporal. Útil pra migração entre devices/versões.
  async function handleFetchHistory() {
    if (!npub) {
      await dialog.alert('identidade não disponível — boot incompleto', {
        title: 'erro',
      })
      return
    }
    if (historyRebuilding) return
    try {
      await rebuildIdentityHistory(npub)
      await dialog.alert(
        'busca concluída. Eventos antigos do seu nsec foram materializados localmente. Pode ser necessário scrollar/recarregar pra ver no feed.',
        { title: 'histórico reconstruído' },
      )
    } catch (err) {
      await dialog.alert(
        `Falha: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    }
  }

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
    <FullPageCard
      onClose={onClose}
      title="diagnóstico"
      ariaLabel="diagnóstico — redefinir cache"
      escDismissible={!rebuilding}
    >
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="histórico" expanded={acc.open === 0} onToggle={() => acc.toggle(0)} />
        <Collapse open={acc.open === 0}>
          <>
            <p className="px-1 font-mono text-[10px] text-drift-muted/30">
              faltando posts antigos? force a busca completa do seu nsec.
            </p>
            <div className="pl-3">
              <button
                onClick={handleFetchHistory}
                disabled={historyRebuilding || !npub}
                className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              >
                {historyRebuilding ? 'reconstruindo…' : '↻ buscar histórico'}
              </button>
            </div>
          </>
        </Collapse>

        <SectionHeader title="redefinir cache" expanded={acc.open === 1} onToggle={() => acc.toggle(1)} />
        <Collapse open={acc.open === 1}>
          <>
            <p className="px-1 font-mono text-[10px] text-drift-muted/30">
              identidade e preferências preservadas. posts re-sincronizam.
            </p>
            <div className="pl-3">
              <button
                onClick={handleRebuild}
                disabled={rebuilding}
                className="w-full rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/10 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/30"
              >
                {rebuilding ? 'reconstruindo…' : '↻ redefinir cache local'}
              </button>
            </div>
          </>
        </Collapse>
      </div>
    </FullPageCard>
  )
}

// ─── PermissionsCard ────────────────────────────────────────────

type PermissionKey = 'geolocation' | 'camera' | 'microphone'
type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported'

const PERM_ITEMS: {
  key: PermissionKey
  label: string
  hint: string
  requestFn: () => Promise<void>
}[] = [
  {
    key: 'geolocation',
    label: 'GPS / localização',
    hint: 'necessário pra location nos posts e mapa de spread',
    requestFn: () =>
      new Promise<void>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          (err) => reject(new Error(err.message)),
          { timeout: 10000 },
        ),
      ),
  },
  {
    key: 'camera',
    label: 'câmera',
    hint: 'usada pelo scanner QR em peers P2P',
    requestFn: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
    },
  },
  {
    key: 'microphone',
    label: 'áudio / microfone',
    hint: 'reservado — speech e notas de voz (futuro)',
    requestFn: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    },
  },
]

function stateLabel(s: PermState): { text: string; color: string } {
  switch (s) {
    case 'granted':
      return { text: 'permitido', color: 'text-drift-spread' }
    case 'denied':
      return { text: 'bloqueado', color: 'text-drift-danger' }
    case 'prompt':
      return { text: 'não solicitado', color: 'text-drift-muted' }
    case 'unsupported':
      return { text: 'indisponível', color: 'text-drift-muted' }
  }
}

export function PermissionsCard({ onClose }: CardProps) {
  const [perms, setPerms] = useState<Record<PermissionKey, PermState>>({
    geolocation: 'prompt',
    camera: 'prompt',
    microphone: 'prompt',
  })
  const [requesting, setRequesting] = useState<PermissionKey | null>(null)

  const queryAll = useCallback(async () => {
    const next: Record<PermissionKey, PermState> = {
      geolocation: 'prompt',
      camera: 'prompt',
      microphone: 'prompt',
    }
    for (const item of PERM_ITEMS) {
      try {
        const status = await navigator.permissions.query({
          name: item.key as PermissionName,
        })
        next[item.key] = status.state as PermState
      } catch {
        // Safari/iOS não suporta permissions.query pra camera/mic.
        // Se a API nativa existe (getUserMedia / geolocation), mostra
        // como 'prompt' pra que o botão "solicitar" apareça. Caso
        // contrário, marca como 'unsupported'.
        const hasNativeApi =
          item.key === 'geolocation'
            ? !!navigator.geolocation
            : !!navigator.mediaDevices?.getUserMedia
        next[item.key] = hasNativeApi ? 'prompt' : 'unsupported'
      }
    }
    setPerms(next)
  }, [])

  useEffect(() => {
    void queryAll()

    const cleanups: (() => void)[] = []
    for (const item of PERM_ITEMS) {
      void navigator.permissions
        .query({ name: item.key as PermissionName })
        .then((status) => {
          const handler = () => void queryAll()
          status.addEventListener('change', handler)
          cleanups.push(() => status.removeEventListener('change', handler))
        })
        .catch(() => {})
    }
    return () => cleanups.forEach((fn) => fn())
  }, [queryAll])

  async function handleRequest(item: (typeof PERM_ITEMS)[number]) {
    setRequesting(item.key)
    let granted = false
    try {
      await item.requestFn()
      granted = true
    } catch {
      // denied ou erro
    }
    // Tenta queryAll primeiro (Chrome/Firefox atualizam via Permissions API).
    // Se query não suportar esse name (Safari), usa resultado do request.
    await queryAll()
    setPerms((prev) => {
      if (prev[item.key] !== 'prompt' && prev[item.key] !== 'unsupported') return prev
      return { ...prev, [item.key]: granted ? 'granted' : 'denied' }
    })
    setRequesting(null)
  }

  return (
    <FullPageCard onClose={onClose} title="permissões" ariaLabel="permissões do navegador">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="navegador" />
        <p className="px-1 font-mono text-[10px] text-drift-muted/30">
          nenhuma é obrigatória. se bloqueou, libere no navegador.
        </p>

        <div className="space-y-2 pl-3">
          {PERM_ITEMS.map((item) => {
            const s = perms[item.key]
            const { text, color } = stateLabel(s)
            const canRequest = s === 'prompt'
            const isRequesting = requesting === item.key

            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3.5 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-drift-text">{item.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-drift-muted/40">
                    {item.hint}
                  </div>
                  <div className={`mt-1 font-mono text-[10px] font-medium ${color}`}>
                    {text}
                  </div>
                </div>

                {canRequest && (
                  <button
                    onClick={() => void handleRequest(item)}
                    disabled={isRequesting}
                    className="shrink-0 rounded-lg bg-drift-accent2 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                  >
                    {isRequesting ? '…' : 'solicitar'}
                  </button>
                )}

                {s === 'denied' && (
                  <span className="shrink-0 font-mono text-[10px] text-drift-muted/30">
                    libere no navegador
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </FullPageCard>
  )
}
