/**
 * ContentSettings — preferências locais do leitor.
 *
 * Manifesto §27 (filtros locais opt-in) + §28 (privacidade pelo mínimo,
 * location off-default) + §17 (auto-classificação voluntária).
 *
 * Tudo aqui é local. Nenhuma pref sai do device. Nenhuma pref vira
 * evento Nostr.
 */

import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { setPref, usePrefsStore } from '../../lib/prefs'
import { db } from '../../lib/db'
import { useBootStore } from '../../lib/bootstrap'
import { useRelaysStore } from '../../lib/relays'
import { isTauri } from '../../lib/runtime'
import { SEED_RELAY_CONFIGS } from '../../config/relays'
import type { LocationGranularity, MapView, NetworkMode } from '../../types/drift'

export interface ContentSettingsProps {
  onClose: () => void
  /**
   * Ancora opcional pra scroll-to-section ao montar. Reconhece:
   *   - 'location' — vem do indicador 📍 no Header
   *   - 'network'  — vem do indicador 🌐/🧅/🛡️ no Header
   */
  scrollTo?: 'location' | 'network'
}

export function ContentSettings({ onClose, scrollTo }: ContentSettingsProps) {
  const prefs = usePrefsStore()
  const relaysList = useRelaysStore((s) => s.list)
  const bootStep = useBootStore((s) => s.step)
  const degradedReasons = useBootStore((s) => s.degradedReasons)
  const [rebuilding, setRebuilding] = useState(false)
  const locationSectionRef = useRef<HTMLDivElement | null>(null)
  const networkSectionRef = useRef<HTMLDivElement | null>(null)

  const tauriRuntime = isTauri()

  // Banner R6 (original): em `onion-only` sem nenhum relay com alias `.onion`
  // disponível, `activeRelays()` retorna lista vazia → app fica isolado
  // silenciosamente. Avisa o user na própria UI antes que ele descubra
  // pelo "feed parou de carregar". Manifesto §15 (anti-censura precisa
  // ser auditável) + transparência sobre limites do scaffold atual.
  const onionAvailable = (() => {
    if (prefs.network_mode !== 'onion-only') return true
    const onionByUrl = new Map<string, string>()
    for (const cfg of SEED_RELAY_CONFIGS) {
      if (cfg.onion) onionByUrl.set(cfg.url, cfg.onion)
    }
    // Considera relays habilitados pelo user que tenham alias onion conhecido.
    // (Fase 6.4: relays user-added clearnet-only — coluna `onion` em
    // `relays_user` chega na migration v8.)
    return relaysList.some((r) => r.enabled && onionByUrl.has(r.url))
  })()

  // Sprint 2 (privacidade leak): detecta "user em PWA selecionou tor/
  // onion-only via console (gate UI bypassed)". Em PWA, Tor é técnicamente
  // impossível — sem essa transparência, user pode achar que está em Tor
  // e estar em clearnet (manifesto §15: anti-censura PRECISA ser
  // auditável pelo user).
  const torSelectedInPwa =
    !tauriRuntime &&
    (prefs.network_mode === 'tor' || prefs.network_mode === 'onion-only')

  // Sprint 2: boot terminou em erro fatal com modo Tor selecionado.
  const torConfiguredButBootError =
    tauriRuntime &&
    (prefs.network_mode === 'tor' || prefs.network_mode === 'onion-only') &&
    bootStep === 'error'

  // Sprint 6: razão Tor-related entre as degradedReasons da BootState
  // (sinal direto, não mais heurístico). Cobre: feature arti OFF,
  // bootstrap arti falhou, listener falhou, etc. Boot terminou 'ready'
  // mas Tor não está rodando — user precisa saber.
  const torDegradedReason = degradedReasons.find(
    (r) => r.code === 'TOR_BOOTSTRAP_FAILED' || r.code === 'TOR_FEATURE_OFF',
  )

  // Scroll-to-section quando aberto via indicador GPS / rede no Header.
  useEffect(() => {
    if (scrollTo === 'location' && locationSectionRef.current) {
      locationSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (scrollTo === 'network' && networkSectionRef.current) {
      networkSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [scrollTo])

  async function handleRebuild() {
    if (
      !confirm(
        'Reconstruir banco local?\n\n' +
          '• Sua identidade (nsec) será preservada\n' +
          '• Suas preferências serão preservadas\n' +
          '• Posts, spreads, buries e reports locais serão apagados\n' +
          '• Tudo será re-sincronizado dos relays automaticamente\n\n' +
          'Útil quando o banco entrou em estado inconsistente após upgrade.',
      )
    ) {
      return
    }
    setRebuilding(true)
    try {
      await db.rebuildDomainSchema()
      location.reload()
    } catch (err) {
      setRebuilding(false)
      alert(
        `Falha ao reconstruir: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-drift-bg/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        className="w-full max-w-md rounded border border-drift-border bg-drift-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.2em] text-drift-accent">
            settings · conteúdo
          </h2>
          <button
            onClick={onClose}
            className="rounded border border-drift-border px-2 py-1 text-[10px] hover:border-drift-accent hover:text-drift-accent"
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        <p className="mb-5 text-[11px] leading-relaxed text-slate-500">
          Preferências locais. Manifesto §27 — autor declara via tag{' '}
          <code className="text-slate-400">content-warning</code>; aqui você
          decide o que faz com cada categoria. Nada sai deste dispositivo.
        </p>

        <section className="space-y-4">
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

          <div ref={locationSectionRef} className="border-t border-drift-border pt-4">
            <div className="mb-2 text-[11px] text-slate-300">
              location nos meus posts
            </div>
            <div className="mb-2 text-[10px] leading-relaxed text-slate-500">
              Manifesto §28 — default <code>off</code>. Cidade pequena +
              opinião política = identificável. Ative só se entender o
              tradeoff.
            </div>
            <LocationGranularityPicker
              value={prefs.location_granularity}
              onChange={(v) => setPref('location_granularity', v)}
            />
          </div>

          <div className="border-t border-drift-border pt-4">
            <div className="mb-2 text-[11px] text-slate-300">mapa de spread</div>
            <div className="mb-2 text-[10px] leading-relaxed text-slate-500">
              Como o mapa enquadra os pontos do post. <code>fechado</code>{' '}
              foca na região onde houve espalhamento; <code>aberto</code>{' '}
              mostra o globo todo (útil pra posts intercontinentais).
            </div>
            <MapViewPicker
              value={prefs.map_view}
              onChange={(v) => setPref('map_view', v)}
            />
          </div>

          <div ref={networkSectionRef} className="border-t border-drift-border pt-4">
            <div className="mb-2 text-[11px] text-slate-300">modo de rede</div>
            <div className="mb-2 text-[10px] leading-relaxed text-slate-500">
              Manifesto §15 — em país que bloqueia relays Nostr, Tor
              contorna. Default <code>clearnet</code> (sem overhead).{' '}
              <code>tor</code> rota via SOCKS5 local (latência +500ms-2s;
              exige cliente desktop). <code>onion-only</code> = paranoia
              máxima.
            </div>
            <NetworkModePicker
              value={prefs.network_mode}
              onChange={async (v) => {
                if (v === prefs.network_mode) return
                // Sprint 2: trocar network_mode em runtime NÃO reseta o
                // SimplePool global do nostr-tools (que pode ter sido
                // monkey-patched com TorWebSocket no boot). Sem reload,
                // user pensa que está em Tor mas continua em clearnet —
                // privacidade leak silenciosa. Manifesto §15 exige UX
                // que comunique o estado real. Forçamos confirm + reload.
                const next = v === 'tor' || v === 'onion-only' ? 'Tor' : 'clearnet'
                const ok = window.confirm(
                  `Trocar para ${next} exige recarregar a aba para aplicar.\n\n` +
                    'Recarregar agora? (cancelar = manter modo atual)',
                )
                if (!ok) return
                await setPref('network_mode', v)
                window.location.reload()
              }}
              isTauri={isTauri()}
            />
            <p className="mt-2 text-[10px] text-amber-500/70">
              Status atual: scaffold/stub em PWA. Tor real funciona em build
              Tauri com <code>--features arti</code>. Trocar de modo exige
              reload (limitação do <code>SimplePool</code> global).
            </p>
            {torSelectedInPwa && (
              <div
                role="alert"
                className="mt-3 rounded border border-red-700/60 bg-red-950/30 px-3 py-2 text-[10px] leading-relaxed text-red-300"
              >
                <strong className="block text-red-200">
                  ⚠ modo {prefs.network_mode === 'tor' ? 'tor' : 'onion-only'}{' '}
                  selecionado em PWA — IP do user vaza pros relays
                </strong>
                <span className="mt-1 block text-red-300/80">
                  PWA browser não tem como rotear via Tor (webview ignora
                  SOCKS5 programático). Sua conexão continua{' '}
                  <strong>clearnet</strong> apesar do modo escolhido — o
                  IP é visível pros relays. Pra Tor de verdade: build
                  Tauri desktop com <code>cargo tauri build --features
                  arti</code>. Volte pra <code>clearnet</code> aqui ou
                  abra o cliente nativo.
                </span>
              </div>
            )}
            {torConfiguredButBootError && (
              <div
                role="alert"
                className="mt-3 rounded border border-red-700/60 bg-red-950/30 px-3 py-2 text-[10px] leading-relaxed text-red-300"
              >
                <strong className="block text-red-200">
                  ⚠ Tor configurado mas boot terminou em erro
                </strong>
                <span className="mt-1 block text-red-300/80">
                  Modo <code>{prefs.network_mode}</code> ativo mas o boot
                  não completou. Verifique o console pra mensagem de erro
                  específica. Considere voltar pra <code>clearnet</code>{' '}
                  até o problema ser diagnosticado, OU recarregar pra
                  retry.
                </span>
              </div>
            )}
            {torDegradedReason && (
              <div
                role="alert"
                className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-[10px] leading-relaxed text-amber-300"
              >
                <strong className="block text-amber-200">
                  ⚠ Tor selecionado mas não conectou — modo degradado
                </strong>
                <span className="mt-1 block text-amber-300/80">
                  {torDegradedReason.code === 'TOR_FEATURE_OFF'
                    ? 'Build atual não tem feature arti compilada (cargo tauri build --features arti). '
                    : 'Bootstrap do daemon Tor falhou. '}
                  Tráfego está em clearnet. Detalhes técnicos:{' '}
                  <code className="break-all">
                    {torDegradedReason.message}
                  </code>
                  . Volte pra <code>clearnet</code> ou recarregue pra retry.
                </span>
              </div>
            )}
            {!onionAvailable && (
              <div
                role="alert"
                className="mt-3 rounded border border-red-700/60 bg-red-950/30 px-3 py-2 text-[10px] leading-relaxed text-red-300"
              >
                <strong className="block text-red-200">
                  ⚠ onion-only ativo, nenhum relay <code>.onion</code>{' '}
                  disponível
                </strong>
                <span className="mt-1 block text-red-300/80">
                  Nenhum dos seus relays habilitados publica alias{' '}
                  <code>.onion</code>. Em modo <code>onion-only</code>, o app
                  vai ficar isolado (feed sem novos eventos, publicação falha).
                  Volte pra <code>tor</code> ou <code>clearnet</code>, ou
                  adicione manualmente um relay <code>.onion</code> em
                  Settings → relays.
                </span>
              </div>
            )}
          </div>

          <div className="border-t border-drift-border pt-4">
            <div className="mb-2 text-[11px] text-slate-300">
              diagnóstico
            </div>
            <div className="mb-3 text-[10px] leading-relaxed text-slate-500">
              Se a app travar com erro de schema (ex: <code>no such column</code>),
              reconstrói o banco local. Identidade e preferências preservadas;
              posts re-sincronizam dos relays.
            </div>
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="w-full rounded border border-yellow-700/60 bg-yellow-950/20 px-3 py-2 text-[11px] text-yellow-300 hover:bg-yellow-950/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rebuilding ? 'reconstruindo…' : '↻ redefinir cache local'}
            </button>
          </div>
        </section>
      </motion.div>
    </motion.div>
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
      className="flex w-full items-start justify-between gap-3 rounded border border-drift-border px-3 py-2 text-left hover:border-drift-accent/40"
    >
      <div className="flex-1">
        <div className="text-[12px] text-slate-200">{label}</div>
        <div className="mt-0.5 text-[10px] text-slate-600">{hint}</div>
      </div>
      <div
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          value
            ? 'border-drift-accent bg-drift-accent/20'
            : 'border-drift-border bg-drift-bg'
        }`}
      >
        <div
          className={`h-4 w-4 rounded-full transition-transform ${
            value
              ? 'translate-x-4 bg-drift-accent'
              : 'translate-x-0.5 bg-slate-600'
          }`}
        />
      </div>
    </button>
  )
}

// Hints descrevem o que VAI pra rede (transparência manifesto §28).
// Implementação real em `lib/geolocation.ts` apenas ARREDONDA lat/lng —
// não faz reverse geocoding. `GeoPoint.city`/`country` ficam vazios.
// Esta é uma escolha consciente: reverse geocoding exigiria lib de
// ~500KB ou serviço externo (manifesto §17 — sem deps proprietárias
// críticas). User decide a granularidade pelo arredondamento.
const GRANULARITY_OPTIONS: { value: LocationGranularity; label: string; hint: string }[] =
  [
    { value: 'off', label: 'off', hint: 'sem location (recomendado)' },
    {
      value: 'country',
      label: 'país',
      hint: 'lat/lng arredondado ~111km (1° de precisão)',
    },
    {
      value: 'city',
      label: 'cidade',
      hint: 'lat/lng arredondado ~11km (área metropolitana)',
    },
    {
      value: 'precise',
      label: 'GPS',
      hint: 'lat/lng exato ~1m (cuidado — identifica quarteirão)',
    },
  ]

const MAP_VIEW_OPTIONS: { value: MapView; label: string; hint: string }[] = [
  {
    value: 'fit-bounds',
    label: 'fechado',
    hint: 'foca na região (origem + espalhadores)',
  },
  {
    value: 'open',
    label: 'aberto',
    hint: 'globo inteiro, zoom baixo',
  },
]

function MapViewPicker({
  value,
  onChange,
}: {
  value: MapView
  onChange: (v: MapView) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {MAP_VIEW_OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded border px-2 py-2 text-[11px] transition-colors ${
              active
                ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                : 'border-drift-border text-slate-500 hover:border-drift-accent/40'
            }`}
            title={opt.hint}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Network mode (Fase 6.4). Em PWA browser, `tor` e `onion-only` ficam
// disabled — clearnet é a única opção até o cliente nativo Tauri shippar
// com `arti` embutido. Hint na tooltip explica o motivo.
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

function NetworkModePicker({
  value,
  onChange,
  isTauri,
}: {
  value: NetworkMode
  onChange: (v: NetworkMode) => void
  isTauri: boolean
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {NETWORK_MODE_OPTIONS.map((opt) => {
        const active = value === opt.value
        const disabled = opt.requiresTauri && !isTauri
        const hint = isTauri ? opt.hintTauri : opt.hintBrowser
        return (
          <button
            key={opt.value}
            onClick={() => {
              if (disabled) return
              onChange(opt.value)
            }}
            disabled={disabled}
            className={`rounded border px-2 py-2 text-[11px] transition-colors ${
              active
                ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                : 'border-drift-border text-slate-500 hover:border-drift-accent/40'
            } ${disabled ? 'cursor-not-allowed opacity-40 hover:border-drift-border' : ''}`}
            title={hint}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function LocationGranularityPicker({
  value,
  onChange,
}: {
  value: LocationGranularity
  onChange: (v: LocationGranularity) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {GRANULARITY_OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded border px-2 py-2 text-[11px] transition-colors ${
              active
                ? 'border-drift-accent bg-drift-accent/10 text-drift-accent'
                : 'border-drift-border text-slate-500 hover:border-drift-accent/40'
            }`}
            title={opt.hint}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
