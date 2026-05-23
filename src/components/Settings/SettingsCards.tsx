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
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'
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
import { RefreshIcon } from '../UI/Icons'
import { SettingExplainer } from '../UI/SettingExplainer'
import { AccordionGroup } from '../UI/AccordionGroup'
import { RadioGroupButton } from '../UI/RadioGroupButton'
// Collapse + SectionHeader removidos (refactor 2026-05-18): após todos
// os cards adotarem SettingExplainer, accordion não é mais usado.

// ─── Helpers ────────────────────────────────────────────────────
//
// useAccordion removido (refactor 2026-05-18): após todos os cards
// adotarem SettingExplainer, accordion não é mais usado. Cards são
// always-visible com hierarquia clara via SettingExplainer's anatomy
// (label + description + impact + meta).

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
        {/* Phase 4 Ted 2026-05-18: AccordionGroup 1-aberto-por-vez,
            consistente com SettingsRoot. defaultOpen='first' = NSFW
            abre por default (mais comum). User clica outros pra
            expandir, primeiro fecha. */}
        <AccordionGroup defaultOpen="first">
        <SettingExplainer
          accordionId="filters-nsfw"
          label="conteúdo adulto e violência"
          description="Posts publicados com aviso de 'NSFW' ou 'violência' aparecem com a imagem borrada por default. Você toca pra revelar caso queira ver."
          impact="Se você ativar este toggle, esses posts aparecem normais (sem blur) direto no feed. Útil pra quem quer ver tudo sem etapa extra; ruim pra ler o feed em público."
          defaultExplained="Off. Quem marca conteúdo como adulto é o autor — você só decide se quer ver de cara ou após toque."
          reversible
        >
          <Toggle
            label="mostrar sem borrar"
            hint="quando off, imagens marcadas viram blur até toque"
            value={prefs.show_nsfw_default}
            onChange={(v) => setPref('show_nsfw_default', v)}
          />
        </SettingExplainer>

        <SettingExplainer
          accordionId="filters-spoilers"
          label="spoilers de filme/livro/série"
          description="Autores podem marcar posts como spoiler. Quando isto está ativo, esses posts ficam totalmente ocultos no feed até você decidir abrir."
          impact="Quando ligado, você não vê spoilers acidentalmente passando pelo feed. Posts marcados aparecem como card 'spoiler' clicável."
          defaultExplained="On. Maioria das pessoas prefere descobrir o final por conta própria."
          reversible
        >
          <Toggle
            label="esconder spoilers do feed"
            hint="quando on, posts marcados aparecem como card clicável"
            value={prefs.hide_spoilers}
            onChange={(v) => setPref('hide_spoilers', v)}
          />
        </SettingExplainer>

        <SettingExplainer
          accordionId="filters-ads"
          label="anúncios de divulgação"
          description="Drift não tem ads pagos. Mas autores podem marcar voluntariamente seus próprios posts como 'divulgação' (lançamento de produto, etc.). Você decide se quer ver."
          impact="Quando ligado, posts auto-marcados como divulgação ficam fora do feed. Não afeta posts não-marcados."
          defaultExplained="On. Mantém o feed mais focado em conteúdo orgânico."
          reversible
        >
          <Toggle
            label="esconder divulgações"
            hint="quando on, posts marcados como ad não aparecem"
            value={prefs.hide_ads}
            onChange={(v) => setPref('hide_ads', v)}
          />
        </SettingExplainer>
        </AccordionGroup>
      </div>
    </FullPageCard>
  )
}

// ─── LocationCard ────────────────────────────────────────────────

export function LocationCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  const current = GRANULARITY_OPTIONS.find(
    (o) => o.value === prefs.location_granularity,
  )
  return (
    <FullPageCard onClose={onClose} title="localização" ariaLabel="padrão de localização pra novos posts">
      <div className="space-y-3 px-4 py-5">
        {/* Refactor 2026-05-23 (manifesto §28 — privacy mínima por inércia
            eliminada): este card antes era "vaza sempre que ligado".
            Agora é só o DEFAULT pré-selecionado quando user abre o
            ComposeOverlay; o botão no header do compose permite override
            per-post sem mexer aqui. Pref name mantido (location_granularity)
            pra compat de SQLite; semântica re-framada na UI. */}
        <SettingExplainer
          label="padrão pra novos posts"
          description="Este valor é PRÉ-SELECIONADO toda vez que você abre o compose. Não vaza automaticamente — você ainda decide por post no botão de localização ao lado do CANCELAR."
          impact="Mexer aqui só muda o ponto de partida. Você sempre pode trocar per-post no compose (ou deixar off uma vez sem alterar este default). Quanto mais preciso o default, mais fácil esquecer e vazar acidentalmente."
          defaultExplained="Off. Compose abre sempre com GPS desligado; user precisa optar consciente por post."
          reversible
          reference="manifesto §28 — privacidade pelo mínimo"
        >
          <RadioGroupButton<LocationGranularity>
            ariaLabel="granularidade"
            columns={4}
            value={prefs.location_granularity}
            onChange={(v) => void setPref('location_granularity', v)}
            options={GRANULARITY_OPTIONS}
          />
          {/* Lily audit 2026-05-21 fix — layout fix: minHeight no
              container do summary pra evitar reflow visível quando
              user troca granularity. Antes: div crescia/encolhia
              abruptamente (hint text varia 50→160 chars). Agora:
              sempre renderiza com minHeight estável; texto muda
              suavemente. Adicional: nota explicativa pra "precise"
              esclarecendo que GPS só dispara ao publicar/driftar
              (não trava a UI ativando). */}
          <div
            className="mt-3 min-h-[88px] rounded-xl border border-drift-border/40 bg-drift-surface/40 px-4 py-3 font-mono text-[11px] leading-relaxed text-drift-body"
            aria-live="polite"
          >
            {current ? (
              <>
                <span className="font-bold text-drift-text">{current.label}</span>
                {' — '}
                {current.hint}
                {current.value === 'precise' && (
                  <span className="mt-2 block text-drift-muted">
                    💡 GPS só é solicitado quando você confirma no compose
                    (não aqui). Este card NÃO ativa nada sozinho — só
                    define o que vem pré-selecionado no botão do compose.
                  </span>
                )}
              </>
            ) : (
              <span className="text-drift-muted">
                escolha uma granularidade acima
              </span>
            )}
          </div>
        </SettingExplainer>
      </div>
    </FullPageCard>
  )
}

// ─── MapViewCard ─────────────────────────────────────────────────

export function MapViewCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  // Segmented control com pill animada (motion.div layoutId) — pattern
  // Lily recomendou em 2026-05-17 audit. Antes: text-color-only change
  // não comunicava estado ativo. Agora: pill chartreuse desliza entre
  // opções, mesmo padrão FeedTabs indicator.
  const activeIndex = MAP_VIEW_OPTIONS.findIndex((o) => o.value === prefs.map_view)
  return (
    <FullPageCard onClose={onClose} title="mapa de DRIFT" ariaLabel="enquadramento do mapa">
      <div className="space-y-3 px-4 py-5">
        <SettingExplainer
          label="enquadramento padrão do mapa"
          description="Quando você abre o mapa de um post pra ver de onde ele veio, ele pode começar focado na região onde aconteceu, ou mostrando o globo inteiro."
          impact="'Fechado' mostra a região com atividade primeiro — mais útil pra entender o contexto local. 'Aberto' mostra o globo inteiro — mais útil pra ver distribuição global. Você pode dar zoom in/out depois nos dois casos."
          defaultExplained="Fechado. Maioria dos posts tem atividade local; abrir já fechado economiza o zoom-in inicial."
          reversible
        >
          <div
            className="relative inline-flex w-full rounded-2xl border border-drift-border/40 bg-drift-surface/50 p-1"
            role="radiogroup"
            aria-label="enquadramento"
          >
            {/* Pill animada — desliza entre opções */}
            <m.span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-drift-accent2/20 border border-drift-accent2/40"
              style={{ width: `calc(${100 / MAP_VIEW_OPTIONS.length}% - 4px)` }}
              animate={{ x: `${activeIndex * 100}%` }}
              transition={{ type: 'spring', stiffness: 380, damping: 28, mass: 0.6 }}
            />
            {MAP_VIEW_OPTIONS.map((opt) => {
              const active = prefs.map_view === opt.value
              return (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => void setPref('map_view', opt.value)}
                  className={`relative z-10 flex-1 rounded-xl px-3 py-3 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    active
                      ? 'text-drift-accent2'
                      : 'text-drift-muted hover:text-drift-text'
                  }`}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </SettingExplainer>
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
        {/* Refactor 2026-05-18: setting-explainer com warning destrutivo
            (reload exigido), defaults justificados, impacto observável
            por opção. Jargão técnico ('scaffold em PWA. tor real: build
            Tauri --features arti') traduzido pra plain language. */}
        <SettingExplainer
          label="como o app se conecta"
          description="O Drift se conecta a servidores Nostr (chamados relays) pra trocar posts com outras pessoas. Aqui você escolhe o caminho que esses dados tomam."
          impact="Internet normal (clearnet) é o padrão — funciona em qualquer dispositivo. Tor esconde seu IP, ótimo pra contornar bloqueios regionais, mas exige o app desktop. Em PWA navegador, escolher Tor NÃO faz nada — seu IP continua exposto."
          defaultExplained="Internet normal. Funciona universalmente; mudar pra Tor é decisão consciente de privacidade adicional."
          warning="Mudar este setting REINICIA o app pra aplicar. Você vai perder qualquer ação não-publicada."
          reversible
          reference="manifesto §15 — anti-censura por país"
        >
          <div className="space-y-3">
            <RadioGroupButton<NetworkMode>
              ariaLabel="modo de rede"
              columns={3}
              value={prefs.network_mode}
              onChange={(v) => void changeMode(v)}
              options={NETWORK_MODE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.label,
                hint: tauriRuntime ? opt.hintTauri : opt.hintBrowser,
                disabled: opt.requiresTauri && !tauriRuntime,
              }))}
            />

            {torSelectedInPwa && (
              <Alert
                tone="error"
                title={`modo ${prefs.network_mode === 'tor' ? 'tor' : 'onion-only'} em PWA — IP vaza`}
              >
                PWA browser não roteia via Tor. Conexão continua <strong>clearnet</strong>.
              </Alert>
            )}
            {torConfiguredButBootError && (
              <Alert tone="error" title="tor configurado mas boot falhou">
                Modo <code>{prefs.network_mode}</code> ativo mas boot não completou. Volte pra clearnet.
              </Alert>
            )}
            {torDegradedReason && (
              <Alert tone="warn" title="tor não conectou — modo degradado">
                {torDegradedReason.code === 'TOR_FEATURE_OFF'
                  ? 'Build sem feature arti. '
                  : 'Bootstrap Tor falhou. '}
                Tráfego em clearnet.
              </Alert>
            )}
            {!onionAvailable && (
              <Alert tone="error" title="onion-only sem relay .onion disponível">
                Nenhum relay habilitado tem alias .onion. App isolado.
              </Alert>
            )}
          </div>
        </SettingExplainer>
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
        <SettingExplainer
          label="distribuir imagens via IPFS"
          description="Quando ligado, seu dispositivo participa de uma rede P2P (IPFS via Helia) servindo cópias de imagens que você baixou pra outros usuários. Reduz dependência de servidor central."
          impact="Custo: banda extra (uns MB/min enquanto rede ativa), uso de RAM moderado, conexões libp2p mantidas abertas. Benefício: melhor disponibilidade quando servidor central cai, manifesto §16 (disponibilidade distribuída). Ligar mostra estatísticas (peers, blobs servidos). Desligar termina conexões mas não apaga blobs já baixados."
          defaultExplained="Desligado. IPFS consome recursos contínuos — ligue se você quer participar ativamente da rede ou se notou imagens lentas via HTTP."
          reversible
          level="advanced"
          reference="manifesto §16 — disponibilidade distribuída"
        >
          <Toggle
            label="ligar IPFS"
            hint="quando on, sua banda ajuda a distribuir imagens da rede"
            value={useIpfs}
            onChange={(v) => void handleToggleIpfs(v)}
          />

          {!useIpfs && (
            <div className="mt-3 rounded-xl border border-drift-border/40 bg-drift-surface/40 px-4 py-3 font-mono text-[11px] text-drift-body">
              IPFS desligado. Imagens carregam normalmente via HTTP (servidor central).
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
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 text-[12px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                >
                  <RefreshIcon size={14} /> atualizar
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
        </SettingExplainer>
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
  // useAccordion removido (refactor 2026-05-18): 4 SettingExplainer cards
  // always-visible. Power-user card; scroll é aceitável.
  const identity = useBootStore((s) => s.identity)
  const prefs = usePrefsStore()
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [npubCopied, setNpubCopied] = useState(false)
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

  async function handleCopyNpub() {
    if (!identity?.npubBech32 || !navigator.clipboard) return
    await navigator.clipboard.writeText(identity.npubBech32)
    setNpubCopied(true)
    setTimeout(() => setNpubCopied(false), 2000)
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
        <AccordionGroup defaultOpen="first">
        {/* ── 1. Meu QR / Link ──────────────────────────────────── */}
        <SettingExplainer
          accordionId="peers-qr"
          label="meu QR / link de perfil"
          description="Seu QR e link compartilham sua identidade pública (npub) com outros usuários do Drift. Quem escaneia ou abre o link consegue te seguir."
          impact="Compartilhar não revela seu nsec (chave privada). Só revela sua identidade pública — a mesma que aparece quando você posta. Útil pra conectar offline (impressão, mostrar tela) ou via apps que aceitam links (chat, email)."
          defaultExplained="Sempre disponível. QR e link são gerados localmente da sua npub — sem servidor central."
          reversible
          reference="manifesto §3 — identidade portável"
        >
          <div className="space-y-2">
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
                  <button
                    onClick={() => void handleCopyNpub()}
                    disabled={!identity?.npubBech32}
                    aria-label="copiar npub"
                    title={identity?.npubBech32 ?? ''}
                    className="group flex items-center gap-2 rounded-lg border border-drift-border/30 bg-drift-surface/40 px-2.5 py-1.5 font-mono text-[10px] text-drift-muted/60 transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                  >
                    <span className="break-all">
                      {identity?.npubBech32
                        ? identity.npubBech32.slice(0, 20) + '…' + identity.npubBech32.slice(-8)
                        : ''}
                    </span>
                    <span aria-hidden="true" className="shrink-0">
                      {npubCopied ? '✓' : '⎘'}
                    </span>
                  </button>
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
        </SettingExplainer>

        {/* ── 2. Conectar (scan + paste) ─────────────────────────── */}
        <SettingExplainer
          accordionId="peers-connect"
          label="conectar com outro usuário"
          description="Escaneie o QR de alguém ou cole a npub/nprofile pra estabelecer conexão P2P direta. Bypassa relays — fala direto com o peer."
          impact="Conexão direta significa que seu IP fica visível pro peer (não tem proxy/relay no meio). Bom pra trocar posts/eventos rápido com peers conhecidos. Ruim pra conectar com desconhecidos — expõe sua localização de rede."
          defaultExplained="Manual — você decide com quem conectar. P2P direto é opt-in (manifesto §15 anti-censura por país, §28 privacidade)."
          warning="Conexão direta expõe seu IP pro peer escolhido. Não use com desconhecidos."
          reversible
          level="advanced"
          reference="manifesto §15, §28"
        >
          <div className="space-y-2">
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
                className="w-full rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:border-drift-accent2/40 focus:outline-none focus:ring-1 focus:ring-drift-accent2/20"
              />
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
        </SettingExplainer>

        {/* ── 3. Bundle offline ──────────────────────────────────── */}
        <SettingExplainer
          accordionId="peers-bundle"
          label="bundle offline (sneakernet)"
          description="Exporta seus posts (kind 9078), drifts (9079), sinks (9080) e reports (9081) num arquivo .json. Você passa pra outra pessoa via USB, airdrop, email ou qualquer canal — ela importa e os eventos materializam no banco local dela."
          impact="Os eventos são re-distribuídos via canal não-Nostr (offline ou bloqueado). Útil em regiões com internet censurada (manifesto §15). Quem recebe vê seus posts como se viessem dos relays normais (são imutáveis e assinados). Eventos antigos não são re-publicados se a outra pessoa já os tem."
          defaultExplained="Manual. Sneakernet (passar via mídia física) é fallback pra anti-censura, não fluxo principal."
          reversible
          level="advanced"
          reference="manifesto §15, §16 — disponibilidade distribuída"
        >
          <div className="space-y-2">
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
        </SettingExplainer>

        {/* ── 4. Auto-discovery (NIP-02) ─────────────────────────── */}
        <SettingExplainer
          accordionId="peers-auto"
          label="auto-conectar com quem você segue"
          description="Quando ligado, o app tenta abrir conexões P2P diretas com cada pessoa que você segue. Acelera sync de posts deles."
          impact="Acelera o feed (posts deles chegam direto, sem passar por relay). Custa banda contínua (mantém N conexões abertas). E expõe seu IP pra TODOS que você segue — eles podem ver de onde você se conecta."
          defaultExplained="Desligado. Manifesto §28: privacidade pelo mínimo. Auto-conectar viola isso por default — só ligue se confia em todos que segue."
          warning="Quem você segue passa a ver seu IP. Não ligue se segue contas anônimas/desconhecidas."
          reversible
          level="advanced"
          reference="manifesto §28 — privacidade pelo mínimo"
        >
          <Toggle
            label="ligar auto-discovery via NIP-02"
            hint="conecta P2P direto com cada pessoa que você segue"
            value={prefs.p2p_auto_follows}
            onChange={(v) => void setPref('p2p_auto_follows', v)}
          />
        </SettingExplainer>
        </AccordionGroup>
      </div>
    </FullPageCard>
  )
}

// ─── DiagnosticCard ──────────────────────────────────────────────

export function DiagnosticCard({ onClose }: CardProps) {
  // useAccordion removido (refactor 2026-05-18): SettingExplainer cards
  // já têm hierarquia visual própria + always-visible meta. Accordion
  // era pra reduzir clutter; primitive resolve com layout claro.
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
        <AccordionGroup defaultOpen="first">
        <SettingExplainer
          accordionId="diag-fetch-history"
          label="buscar histórico antigo"
          description="O app só sincroniza posts dos últimos 7 dias por default ao iniciar. Se você usa o mesmo nsec há mais tempo, posts antigos podem estar fora dessa janela. Este botão força uma busca completa."
          impact="O app consulta todos os relays atuais buscando QUALQUER post seu (kind 9078) sem limite de data. Pode demorar minutos em rede lenta. Posts encontrados materializam no SQLite local."
          defaultExplained="Não roda automático — só quando você pede. A janela inicial de 7 dias cobre 90% dos casos sem custo de banda."
          reversible
          level="advanced"
          reference="manifesto §3 — identidade portável"
        >
          <button
            onClick={handleFetchHistory}
            disabled={historyRebuilding || !npub}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {historyRebuilding ? (
              'reconstruindo…'
            ) : (
              <>
                <RefreshIcon size={14} /> buscar histórico
              </>
            )}
          </button>
        </SettingExplainer>

        <SettingExplainer
          accordionId="diag-rebuild"
          label="redefinir cache local"
          description="Apaga todos os posts, drifts (kind 9079), sinks (kind 9080) e reports do banco local. Identidade (nsec) e preferências ficam intactas. O app re-sincroniza tudo dos relays na próxima vez que abrir."
          impact="Útil quando o app fica em estado estranho após atualização ou banco corrompeu. Você não perde nada permanentemente — os relays guardam os eventos imutáveis. Pode levar alguns segundos pra re-sincronizar."
          defaultExplained="Action manual — só roda quando você pede. Cache normal não precisa de redefinição."
          warning="Mudança no banco local. Identidade preservada, mas o app vai recarregar e re-sincronizar do zero."
          reversible
          level="advanced"
        >
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-drift-warning/40 bg-drift-warning/10 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/20 disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/40"
          >
            {rebuilding ? (
              'reconstruindo…'
            ) : (
              <>
                <RefreshIcon size={14} /> redefinir cache local
              </>
            )}
          </button>
        </SettingExplainer>
        </AccordionGroup>
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
        <SettingExplainer
          label="o que o app pode acessar"
          description="O navegador controla acesso a GPS, câmera e microfone. O Drift NÃO usa nada disso automaticamente — só quando você opta por uma feature específica (ex: anexar localização no post)."
          impact="Conceder permissão NÃO ativa nada — só dá ao app o direito de pedir se você usar a feature relacionada. Negar bloqueia a feature inteira (ex: posts sem location). Você pode revogar a qualquer momento nas configurações do navegador."
          defaultExplained="Tudo em 'não solicitado'. Drift só pede quando você ativa a feature correspondente (manifesto §28 — privacidade pelo mínimo)."
          reversible
          reference="manifesto §28 — privacidade pelo mínimo"
        >
          <div className="space-y-2">
            {PERM_ITEMS.map((item) => {
              const s = perms[item.key]
              const { text, color } = stateLabel(s)
              const canRequest = s === 'prompt'
              const isRequesting = requesting === item.key

              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3.5 rounded-xl border border-drift-border/40 bg-drift-surface/40 px-4 py-3.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[13px] text-drift-text">{item.label}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-drift-body/85">
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
                    <span className="shrink-0 font-mono text-[10px] text-drift-muted">
                      libere no navegador
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </SettingExplainer>
      </div>
    </FullPageCard>
  )
}

// ─── SovereigntyCard ────────────────────────────────────────────
//
// Sovereignty / power-user: UI pra 3 endpoints customizáveis shipped em
// [f8db723] (Marshall NEEDS-FIX A/B/C 2026-05-17). Antes só editáveis
// via SQLite direto. Card próprio (não dentro de NetworkMode/MapView)
// porque mistura semânticas heterogêneas (upload + tiles + moderação)
// que dividem único princípio: "rotear seu cliente pra infra própria".
//
// Manifesto §17 (sem chave mestra): user pode trocar nostr.build →
// Blossom self-hosted (não dá nostr.build poder sobre conteúdo);
// trocar CARTO tiles → OSM próprio (não dá CARTO seu IP); ajustar
// threshold dinâmico (não confia no default do cliente). Cada campo
// independente — empty/0 cai no default seguro.
//
// UX:
//   - Inputs livres com hint do default
//   - Validação client-side mínima (https://, {x}{y}{z}, integer ≥1);
//     setPref filtra mais (em prefs.ts) — defense in depth
//   - "limpar" botão por campo restaura default
//   - aviso §28 no header: "fica neste dispositivo. nada sai daqui."

interface SovereigntyFieldProps {
  label: string
  hint: string
  placeholder: string
  value: string
  onCommit: (v: string) => void
  inputMode?: 'text' | 'numeric' | 'url'
}

function SovereigntyField({
  label,
  hint,
  placeholder,
  value,
  onCommit,
  inputMode = 'text',
}: SovereigntyFieldProps) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  const dirty = local !== value
  return (
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] uppercase tracking-meta text-drift-muted">
        {label}
      </label>
      <p className="font-mono text-[10px] text-drift-muted/40 leading-relaxed">
        {hint}
      </p>
      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode={inputMode}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-lg border border-drift-border/40 bg-drift-surface/30 px-3 py-2 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onCommit(local.trim())}
          disabled={!dirty}
          className="shrink-0 rounded-lg border border-drift-accent/40 bg-drift-accent/10 px-3 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent transition-colors hover:bg-drift-accent/20 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent/40"
        >
          salvar
        </button>
        <button
          type="button"
          onClick={() => {
            setLocal('')
            onCommit('')
          }}
          disabled={value === ''}
          className="shrink-0 rounded-lg border border-drift-border/40 bg-drift-surface/30 px-3 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          aria-label={`restaurar default de ${label}`}
        >
          limpar
        </button>
      </div>
    </div>
  )
}

export function SovereigntyCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()

  function commitUpload(v: string) {
    void setPref('upload_endpoint', v || undefined)
  }
  function commitTile(v: string) {
    void setPref('map_tile_url_template', v || undefined)
  }
  function commitThreshold(v: string) {
    const n = Number.parseInt(v, 10)
    void setPref('report_threshold_override', Number.isFinite(n) && n >= 1 ? n : undefined)
  }

  return (
    <FullPageCard
      onClose={onClose}
      title="soberania"
      ariaLabel="endpoints customizáveis"
    >
      <div className="space-y-3 px-4 py-5">
        <AccordionGroup defaultOpen="first">
        <SettingExplainer
          accordionId="sov-upload"
          label="onde upload de imagens vai parar"
          description="Quando você anexa foto a um post, o arquivo é enviado pra um servidor externo (não é Nostr — Nostr só guarda o link). Aqui você escolhe qual servidor recebe."
          impact="O default (nostr.build) é gratuito mas conhece seu IP e o conteúdo. Trocar pra Blossom self-hosted, hospedagem própria ou IPFS gateway tira esse conhecimento da nostr.build. URL completa (https://) ou vazio pra usar o default."
          defaultExplained="nostr.build — gratuito, sem cadastro, aceita usuários anônimos. Bom enough pra MVP, troque se quer mais isolamento."
          reversible
          level="advanced"
          reference="manifesto §17 — sem chave mestra"
        >
          <SovereigntyField
            label="endpoint de upload"
            hint="URL completa do servidor que aceita upload"
            placeholder="https://blossom.exemplo.com/upload"
            value={prefs.upload_endpoint ?? ''}
            inputMode="url"
            onCommit={commitUpload}
          />
        </SettingExplainer>

        <SettingExplainer
          accordionId="sov-tile"
          label="tile server do mapa"
          description="O mapa de spread mostra de onde os posts vieram usando tiles (imagens quadradas) servidas por um provedor externo. Esse provedor sabe quando e onde você consultou o mapa."
          impact="Default CARTO loga seu IP a cada tile carregado — útil pra análise deles. Trocar pra OSM público, mirror Tor ou self-hosted tira esse rastreio. URL precisa template XYZ com {x}, {y}, {z}."
          defaultExplained="CARTO Voyager — gratuito, sem cadastro, tiles bonitos. Privacy custo: cada pan/zoom vai pra eles."
          reversible
          level="advanced"
        >
          <SovereigntyField
            label="tile template XYZ"
            hint="URL com {x}/{y}/{z} placeholders"
            placeholder="https://tiles.exemplo.com/{z}/{x}/{y}.png"
            value={prefs.map_tile_url_template ?? ''}
            inputMode="url"
            onCommit={commitTile}
          />
        </SettingExplainer>

        <SettingExplainer
          accordionId="sov-threshold"
          label="quantos reports pra esconder um post"
          description="Quando muitos usuários reportam o mesmo post, o app esconde ele do feed local (não apaga — só esconde). Esse número é dinâmico por padrão (ajusta com volume da rede). Você pode forçar um valor fixo."
          impact="Threshold baixo (ex: 3) = mais posts somem do feed cedo (sensível a abusos coordenados). Threshold alto (ex: 50) = posts ficam por mais tempo (resiste a campanha de reports). Empty/0 = volta pro algoritmo dinâmico."
          defaultExplained="Dinâmico — calculado com base em volume médio de reports na rede + threshold mínimo configurado em config/constants. Funciona bem na maioria dos casos."
          reversible
          level="advanced"
          reference="manifesto §26 — moderação comunitária"
        >
          <SovereigntyField
            label="threshold fixo"
            hint="integer ≥ 1 OU vazio pra dinâmico"
            placeholder="(dinâmico)"
            value={
              prefs.report_threshold_override && prefs.report_threshold_override > 0
                ? String(prefs.report_threshold_override)
                : ''
            }
            inputMode="numeric"
            onCommit={commitThreshold}
          />
        </SettingExplainer>
        </AccordionGroup>
      </div>
    </FullPageCard>
  )
}

// ─── MenuDetailCard ────────────────────────────────────────────────
//
// Phase 6 (2026-05-19 user pivot): substitui binário 'show_advanced_
// settings' por 4 flags granulares. User decide POR CATEGORIA que tipo
// de detalhe vê em todas as settings explainers do app.

export function MenuDetailCard({ onClose }: CardProps) {
  const prefs = usePrefsStore()
  return (
    <FullPageCard
      onClose={onClose}
      title="menu detalhado"
      ariaLabel="quanto detalhe mostrar nas configurações"
    >
      <div className="space-y-3 px-4 py-5">
        <p className="font-mono text-[12px] leading-relaxed text-drift-body">
          Cada setting do Drift pode mostrar mais ou menos contexto.
          Aqui você decide POR CATEGORIA que tipos de detalhe quer ver
          em todas as outras configurações. Mexer aqui não muda
          comportamento — só o que aparece na tela.
        </p>

        <AccordionGroup defaultOpen="first">
          <SettingExplainer
            accordionId="menu-detail-details"
            label="detalhes (impacto / default / reversível)"
            description="Cada setting pode mostrar 3 linhas extras: o IMPACTO observável quando você muda, o DEFAULT (e por que é o que é) e se a mudança é REVERSÍVEL."
            impact="Quando on, settings explicam mais. Quando off, você vê só descrição + controle (visual mais limpo, útil pra quem já conhece o app)."
            defaultExplained="On por default — info essencial pra entender o que cada setting faz antes de mudar."
            reversible
          >
            <Toggle
              label="mostrar detalhes"
              hint="impacto + default + reversível em cada setting"
              value={prefs.menu_detail_show_details}
              onChange={(v) => setPref('menu_detail_show_details', v)}
            />
          </SettingExplainer>

          <SettingExplainer
            accordionId="menu-detail-manifesto"
            label="referências do manifesto"
            description="Algumas settings linkam pro manifesto do Drift (§17, §28, etc.) — explicação política/normativa do POR QUÊ aquela funcionalidade existe."
            impact="Quando on, link 'Referência: manifesto §X' aparece no rodapé das settings que têm. Quando off, settings ficam livres de jargão normativo."
            defaultExplained="Off por default — jargão pra quem quer fundo histórico/político. Curiosos podem ligar."
            reversible
          >
            <Toggle
              label="mostrar referências"
              hint="links pro manifesto quando uma setting tem um"
              value={prefs.menu_detail_show_manifesto}
              onChange={(v) => setPref('menu_detail_show_manifesto', v)}
            />
          </SettingExplainer>

          <SettingExplainer
            accordionId="menu-detail-how-it-works"
            label="como funciona"
            description="Sections de 'como funciona' em settings complexas (ex: Sua Lente). Explica o sistema por trás, não só o controle visível."
            impact="Quando on, accordion 'como funciona' fica EXPANDIDO por default. Quando off, fica colapsado — user expande manualmente se quiser."
            defaultExplained="Off por default — maioria dos users não precisa do internals; expandem quando curiosos."
            reversible
          >
            <Toggle
              label="expandir 'como funciona'"
              hint="abre as seções de explicação por default"
              value={prefs.menu_detail_show_how_it_works}
              onChange={(v) => setPref('menu_detail_show_how_it_works', v)}
            />
          </SettingExplainer>

          <SettingExplainer
            accordionId="menu-detail-algorithm"
            label="detalhes de algoritmo"
            description="Parágrafos que mencionam algoritmos por nome (Personalized PageRank, thresholds dinâmicos, decay temporal, etc.) — info técnica pra entender o cálculo."
            impact="Quando on, settings com explicação algorítmica mostram o nome + parâmetros. Quando off, dizem só o efeito ('prioriza quem você segue' em vez de 'PageRank com α=0.85')."
            defaultExplained="Off por default — só entusiastas/devs precisam dos nomes. Quem quer entender O QUE muda já tem 'detalhes' (impacto)."
            reversible
          >
            <Toggle
              label="mostrar nomes de algoritmos"
              hint="PageRank, thresholds, decays — info técnica"
              value={prefs.menu_detail_show_algorithm}
              onChange={(v) => setPref('menu_detail_show_algorithm', v)}
            />
          </SettingExplainer>

          <SettingExplainer
            accordionId="menu-detail-action-labels"
            label="texto ao lado dos ícones (menu ⋮)"
            description="Quando você abre o menu de ações de um post (⋮ no canto superior), aparece uma lista vertical de ícones (compartilhar, mapa, fixar, seguir, etc.) com um texto à esquerda explicando cada um."
            impact="Quando on (default), labels aparecem à esquerda dos ícones — ajuda quem ainda está aprendendo o que cada ícone faz. Quando off, só ícones aparecem (view mais limpa, útil pra quem já decorou)."
            defaultExplained="On por default — discoverability vence economia visual pra novice user."
            reversible
          >
            <Toggle
              label="mostrar texto dos ícones"
              hint="labels à esquerda de cada ação no menu ⋮"
              value={prefs.menu_detail_show_action_labels}
              onChange={(v) => setPref('menu_detail_show_action_labels', v)}
            />
          </SettingExplainer>
        </AccordionGroup>
      </div>
    </FullPageCard>
  )
}
