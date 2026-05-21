import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { OPTIMISTIC_TIMEOUT_MS, CLIENT_VERSION, FEED_SNAPSHOT_STALE_MS } from './config/constants'
import { db } from './lib/db'
import {
  getCurrentLocation,
  getLastFailureReason,
  warmUpGpsLocation,
  type GeolocationFailureReason,
} from './lib/geolocation'
import { rebuildIdentityHistory, restartSync, useSyncStore } from './lib/sync'
import { parseDeepLinkSearch, cleanDeepLinkParams } from './lib/deep-link'
import { createPost, spreadPost, buryPost } from './lib/protocol'
import { getMyAction, markFeedSeen, refreshFeed, useFeedStore } from './lib/feed'
import {
  advanceCursor,
  exitAtEnd,
  initialAnchor,
  resolveCursorIdx,
  setCursorByIndex,
  type FeedCursor,
} from './lib/feed-cursor'
import { FeedTabs, type FeedTab } from './components/Feed/FeedTabs'
import {
  startBoot,
  useBootStore,
  type BootState,
} from './lib/bootstrap'
import { getPrefs, usePrefsStore } from './lib/prefs'
import { useUserWeight } from './hooks/useUserWeight'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { exitSlim, useViewModeStore } from './lib/view-mode'
import { PostViewer } from './components/Post/PostViewer'
// V10.10 — GpsErrorBanner lazy (Lighthouse unused-js audit). Banner só
// renderiza quando getCurrentLocation falha durante spread/bury. Boot
// não precisa do componente em memória. Economia: ~9 KB raw / ~2 KB gz
// no entry chunk.
const GpsErrorBanner = lazy(() =>
  import('./components/UI/GpsErrorBanner').then((m) => ({
    default: m.GpsErrorBanner,
  })),
)
import { MultiTabModal } from './components/UI/MultiTabModal'
// V10.11 — UpdatePrompt + DialogHost lazy (Lighthouse unused-js audit).
// UpdatePrompt só renderiza quando virtual:pwa-register sinaliza nova
// versão (raríssimo). DialogHost é singleton portal — só renderiza
// dentro de Suspense ao primeiro `dialog.show()`. Economia conjunta:
// ~9 KB raw / ~3 KB gz no entry chunk.
const UpdatePrompt = lazy(() =>
  import('./components/UI/UpdatePrompt').then((m) => ({
    default: m.UpdatePrompt,
  })),
)
const DialogHost = lazy(() =>
  import('./components/UI/DialogHost').then((m) => ({
    default: m.DialogHost,
  })),
)
const LensNudgeBanner = lazy(() =>
  import('./components/Settings/LensNudgeBanner').then((m) => ({
    default: m.LensNudgeBanner,
  })),
)
const DiscoverNudgeBanner = lazy(() =>
  import('./components/Settings/DiscoverNudgeBanner').then((m) => ({
    default: m.DiscoverNudgeBanner,
  })),
)
import { dialog } from './lib/dialog'
import { pushLayer, popLayer, hasLayer } from './lib/layer-stack'
import { NavBar } from './components/UI/NavBar'
import { HintChip } from './components/UI/HintChip'
import { getHintRule } from './lib/guidance'
import { FullPageCard } from './components/UI/FullPageCard'
import { SlideUpOverlay } from './components/UI/SlideUpOverlay'
import { ModalHeader } from './components/UI/ModalHeader'
import { DriftButton } from './components/UI/DriftButton'
import { LayerRenderer } from './components/UI/LayerRenderer'
import { LazyBoundary } from './components/UI/LazyBoundary'
import { Collapse } from './components/UI/Collapse'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { DriftSkeleton } from './components/UI/DriftSkeleton'

// Round CWV-2 §3.2 — Lazy boundaries pra todos os modal/overlay roots
// que NÃO entram no first paint do feed. Reduz entry chunk em ~86 KB
// (Ted RFC §2.1 estimate). Cada um vira chunk próprio com hash dedicado;
// LazyBoundary (Suspense + ErrorBoundary) trata fetch failure.
//
// SettingsCards exporta 6 componentes — `lazy()` precisa default export
// shape, então wrapping individual via `.then(m => ({ default: m.X }))`.
const FiltersCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.FiltersCard })),
)
const LocationCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.LocationCard })),
)
const MapViewCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.MapViewCard })),
)
const NetworkModeCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.NetworkModeCard })),
)
const BlobsCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.BlobsCard })),
)
const PeersCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.PeersCard })),
)
const DiagnosticCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.DiagnosticCard })),
)
const PermissionsCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.PermissionsCard })),
)
const SovereigntyCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.SovereigntyCard })),
)
const MenuDetailCard = lazy(() =>
  import('./components/Settings/SettingsCards').then((m) => ({ default: m.MenuDetailCard })),
)
const AppearanceCard = lazy(() =>
  import('./components/Settings/AppearanceCard').then((m) => ({ default: m.AppearanceCard })),
)
const SuaLenteCard = lazy(() =>
  import('./components/Settings/SuaLenteCard').then((m) => ({ default: m.SuaLenteCard })),
)
const RelaySettings = lazy(() =>
  import('./components/Settings/RelaySettings').then((m) => ({ default: m.RelaySettings })),
)
const LocalListsSettings = lazy(() =>
  import('./components/Settings/LocalListsSettings').then((m) => ({
    default: m.LocalListsSettings,
  })),
)
const OnboardingOverlay = lazy(() =>
  import('./components/Onboarding/OnboardingOverlay').then((m) => ({
    default: m.OnboardingOverlay,
  })),
)
const ProfileModal = lazy(() =>
  import('./components/Profile/ProfileModal').then((m) => ({ default: m.ProfileModal })),
)
const IdentityPanel = lazy(() =>
  import('./components/Identity/IdentityPanel').then((m) => ({ default: m.IdentityPanel })),
)
const IdentitySwitcher = lazy(() =>
  import('./components/Identity/IdentitySwitcher').then((m) => ({
    default: m.IdentitySwitcher,
  })),
)
const ComposeOverlay = lazy(() =>
  import('./components/Create/ComposeOverlay').then((m) => ({ default: m.ComposeOverlay })),
)
import {
  MapIcon,
  SlidersIcon,
  UserIcon,
  WarningIcon,
  KeyIcon,
  UsersIcon,
  ServerIcon,
  GlobeIcon,
  PinIcon,
  ListIcon,
  ActivityIcon,
  BoxIcon,
  RefreshIcon,
  InfoIcon,
  TrashIcon,
  DownloadIcon,
  OnionIcon,
  ShieldIcon,
  PinOffIcon,
  LinkIcon,
  ChevronDownIcon,
  PaletteIcon,
  EyeIcon,
} from './components/UI/Icons'
// SpreadMap pull MapLibre GL (1.1 MB) + Deck.gl ArcLayer (467 KB) —
// só carrega quando user abre overlay de mapa. Ver MapOverlay abaixo.
const SpreadMap = lazy(() =>
  import('./components/Feed/SpreadMap').then((m) => ({ default: m.SpreadMap })),
)
// Type-only re-export pra type ser tree-shaken sem trigger lazy chunk
import type { SpreadMapMode } from './hooks/useSpreadMap'
import type {
  DriftIdentity,
  LocationGranularity,
  Post,
  Subpost,
  ContentWarning,
} from './types/drift'

async function handleClearLocal() {
  const ok = await dialog.confirm(
    'Apagar TODOS os posts/spreads/buries locais? (identidade preservada)',
    { title: 'limpar local', dangerous: true, okLabel: 'apagar' },
  )
  if (!ok) return
  await db.run(`DELETE FROM posts`)
  await db.run(`DELETE FROM spreads`)
  await db.run(`DELETE FROM buries`)
  await db.run(`DELETE FROM reports`)
  await db.run(`DELETE FROM sync_log`)
  location.reload()
}

function StatusCardLayer({ onClose }: { onClose: () => void }) {
  const boot = useBootStore()
  return (
    <FullPageCard onClose={onClose} title="status" ariaLabel="painel de diagnóstico">
      <div className="px-4 py-5">
        <DiagnosticPanel boot={boot} />
      </div>
    </FullPageCard>
  )
}

function AboutCardLayer({ onClose }: { onClose: () => void }) {
  // Accordion mutually exclusive (abrir um fecha outros).
  // Versão sempre visível (não-collapsible) — info essencial no topo.
  // 4 seções colapsáveis: manifesto, protocolo, atualizar versão, limpar cache.
  // Default aberto: manifesto (índice 0).
  const [openSection, setOpenSection] = useState<number | null>(0)
  const toggle = (i: number) => setOpenSection((prev) => (prev === i ? null : i))

  return (
    <FullPageCard onClose={onClose} title="sobre" ariaLabel="sobre o cliente Drift">
      <div className="space-y-3 px-4 py-5 font-mono">
        {/* Versão sempre visível — info-card sem accordion */}
        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/50 px-5 py-4">
          <div className="text-[10px] uppercase tracking-tag text-drift-muted/50">
            versão do cliente
          </div>
          <div className="mt-1 font-display text-[22px] font-extrabold text-drift-text">
            {CLIENT_VERSION}
          </div>
          <div className="mt-2 text-[10px] text-drift-muted/40">
            cliente oficial <code className="text-drift-text/80">drift-official</code>
          </div>
        </div>

        {/* MANIFESTO */}
        <AboutSectionHeader
          title="manifesto"
          expanded={openSection === 0}
          onToggle={() => toggle(0)}
        />
        <Collapse open={openSection === 0}>
          <div className="space-y-3">
            <p className="px-1 font-mono text-[10px] text-drift-muted/60">
              drift é descentralizado sobre nostr. 34 princípios públicos definem o que o cliente pode e não pode fazer.
            </p>
            <div className="space-y-2 pl-3">
              <div className="space-y-2 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5">
                <ManifestoLine n="§17" text="sem chave mestra — fundador não controla conteúdo" />
                <ManifestoLine n="§22" text="sem afinidade no feed — ranking é função pura" />
                <ManifestoLine n="§15" text="anti-censura por país — Tor + WebRTC" />
                <ManifestoLine n="§16" text="disponibilidade distribuída — IPFS, sneakernet, BLE" />
                <ManifestoLine n="§25" text="sem scanner automático — opt-in vence" />
                <ManifestoLine n="§28" text="privacidade pelo mínimo — location off-default" />
              </div>
              <a
                href="https://github.com/EduardoFerr/drift/blob/main/Docs/manifesto.md"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl bg-drift-accent2 px-4 py-3 text-center font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85"
              >
                ler manifesto completo ↗
              </a>
            </div>
          </div>
        </Collapse>

        {/* PROTOCOLO */}
        <AboutSectionHeader
          title="protocolo"
          expanded={openSection === 1}
          onToggle={() => toggle(1)}
        />
        <Collapse open={openSection === 1}>
          <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/60">
            eventos imutáveis assinados (kinds 9078–9081). score determinístico. identidade portável via nsec1. PWA + tauri opcional.
          </p>
        </Collapse>

        {/* ATUALIZAR VERSÃO */}
        <AboutSectionHeader
          title="atualizar versão"
          expanded={openSection === 2}
          onToggle={() => toggle(2)}
        />
        <Collapse open={openSection === 2}>
          <div className="space-y-3">
            <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/60">
              se você dispensou o aviso de nova versão, pode aplicar a atualização aqui. fixes de segurança e novas features ficam pendentes até reload do service worker (manifesto §17 — sem update silencioso).
            </p>
            <div className="pl-3">
              <UpdateVersionButton />
            </div>
          </div>
        </Collapse>

        {/* LIMPAR CACHE */}
        <AboutSectionHeader
          title="limpar cache"
          expanded={openSection === 3}
          onToggle={() => toggle(3)}
        />
        <Collapse open={openSection === 3}>
          <div className="space-y-3">
            <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/60">
              se algum painel ficou preso em 'erro ao carregar', limpa todos os caches do service worker e recarrega. mais agressivo que atualizar versão.
            </p>
            <div className="pl-3">
              <ClearCacheButton />
            </div>
          </div>
        </Collapse>
      </div>
    </FullPageCard>
  )
}

/** Section header local pra AboutCardLayer — accordion mode. */
function AboutSectionHeader({
  title,
  expanded,
  onToggle,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
}) {
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

/**
 * R33 — botão "atualizar versão" pra aplicar SW novo pendente.
 *
 * Reusa o mesmo fluxo do `UpdatePrompt` (`virtual:pwa-register/react`):
 * `updateServiceWorker(true)` faz skipWaiting do SW waiting + reload.
 * Útil quando user dispensou o banner "Mais tarde" e quer aplicar
 * depois. Manifesto §17 — sem update silencioso, consent explícito.
 *
 * Se NÃO há SW waiting, dispara `registration.update()` pra forçar
 * check do servidor. Se ainda não há, dá feedback "você está na
 * versão mais recente".
 */
function UpdateVersionButton() {
  // BUG FIX 2026-05-17 (user report): botão "atualizar" frequentemente
  // "não fazia nada" visualmente — user precisava F5 manual sem feedback.
  // Causa: confiávamos que `updateServiceWorker(true)` faz reload sozinho,
  // mas em vários cenários (SW state estranho, Chromium buffer, PWA
  // installed mode) o reload falha silenciosamente. Agora:
  //   1. Feedback visual em CADA fase (checking/applying/reloading/latest)
  //   2. Reload explícito como fallback se SW não disparar em 1.5s
  //   3. Status persistido até reload (busy=true bloqueia segunda ação)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'applying' | 'reloading' | 'latest'
  >('idle')
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() {
      // SW não suportado neste contexto — botão fica disabled
    },
  })

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      if (needRefresh) {
        // SW novo já está waiting → aplicar imediatamente
        setStatus('applying')
        // Fire-and-forget — não espera (pode pendurar se SW não responder)
        void updateServiceWorker(true)
        // Curto delay pra SW processar SKIP_WAITING + activate
        await new Promise((r) => setTimeout(r, 800))
        // Fallback explícito: força reload mesmo se updateServiceWorker
        // não tiver disparado (Chromium PWA installed mode bug recorrente).
        // Status visível antes do reload em si.
        setStatus('reloading')
        await new Promise((r) => setTimeout(r, 200))
        window.location.reload()
        // Código abaixo não executa (reload em curso)
        return
      }
      // Força check no servidor
      setStatus('checking')
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) await reg.update()
      // Espera 2s pro hook detectar mudança (registra waiting SW)
      await new Promise((r) => setTimeout(r, 2000))
      // Se needRefresh continua false após update(), está na última versão
      setStatus('latest')
      setTimeout(() => setStatus('idle'), 3000)
    } finally {
      setBusy(false)
    }
  }

  const label =
    status === 'applying'
      ? 'aplicando…'
      : status === 'reloading'
      ? '⟳ recarregando…'
      : status === 'checking'
      ? 'verificando…'
      : busy
      ? 'aplicando…'
      : needRefresh
      ? '↻ aplicar nova versão'
      : status === 'latest'
      ? '✓ versão mais recente'
      : '↻ verificar atualizações'

  return (
    <button
      onClick={() => void handleClick()}
      disabled={busy}
      // aria-live anuncia mudanças de status pra screen readers
      aria-live="polite"
      className={`w-full rounded-xl px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
        needRefresh || status === 'reloading'
          ? 'bg-drift-accent2 text-drift-bg hover:bg-drift-accent2/85'
          : status === 'checking' || status === 'applying'
          ? 'bg-drift-accent2/30 text-drift-text'
          : 'border border-drift-border/30 bg-drift-surface/30 text-drift-muted/70 hover:text-drift-text'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * Botão "limpar cache" — cache nuke agressivo (unregister SW + caches).
 * Reusa `clearServiceWorkerAndReload` exportado de LazyBoundary. Mais
 * destrutivo que `UpdateVersionButton`: força recovery do estado mas
 * perde tudo que estava em cache (chunks, blobs IPFS pinados não, esses
 * vivem em IndexedDB separado).
 */
function ClearCacheButton() {
  const [busy, setBusy] = useState(false)
  async function handleClick() {
    if (busy) return
    setBusy(true)
    const { clearServiceWorkerAndReload } = await import('./components/UI/LazyBoundary')
    await clearServiceWorkerAndReload()
  }
  return (
    <button
      onClick={() => void handleClick()}
      disabled={busy}
      className="w-full rounded-xl border border-drift-warning/20 bg-drift-warning/5 px-4 py-3 font-mono text-[12px] uppercase tracking-meta text-drift-warning transition-colors hover:bg-drift-warning/10 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-warning/30"
    >
      {busy ? 'limpando…' : '↻ limpar cache e recarregar'}
    </button>
  )
}

function ManifestoLine({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-3 font-mono text-[11px]">
      <span className="shrink-0 text-drift-accent">{n}</span>
      <span className="text-drift-muted/60">{text}</span>
    </div>
  )
}

/**
 * Slim mode hint — chip discreto que aparece ao entrar em slim mode.
 * Explica gesto pra sair (segure 5s) + oferece X explícito.
 * Auto-dismiss 4s OU dismiss manual via X. Em re-entradas no slim
 * (toggle off/on), aparece de novo (state efêmero, sem persist).
 */
function SlimModeHint() {
  const slim = useViewModeStore((s) => s.slim)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!slim) {
      setVisible(false)
      return
    }
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(t)
  }, [slim])

  return (
    <AnimatePresence>
      {slim && visible && (
        <m.div
          role="status"
          aria-live="polite"
          // V13 (2026-05-18 user feedback round 2): bottom ainda 'mal
          // posicionado' + bg 'transparente nada bom'. Nova abordagem:
          //   - Posição: top-4 LEFT-4 (era bottom-6 center). Botões header
          //     do PostViewer ficam em right-4 top-4 — left-4 está LIVRE.
          //     Centered competia com layout do card; left ancora ao
          //     header global do app, leitura clara.
          //   - bg: drift-surface SÓLIDO (era drift-bg/90 translúcido).
          //     Solid = visibilidade garantida em todos os 3 temas sobre
          //     qualquer conteúdo. Border accent2 full opacity (era /40).
          //   - Removido backdrop-blur (sólido dispensa).
          //   - Transition: y: -10 → 0 (vem do topo, alinhado com origem
          //     top-left).
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed left-4 top-4 z-40 flex items-center gap-2 rounded-full border border-drift-accent2 bg-drift-surface px-4 py-2 shadow-lg"
        >
          <span className="font-mono text-[11px] uppercase tracking-meta text-drift-accent2">
            modo slim · segure 5s pra sair
          </span>
          <button
            onClick={() => exitSlim()}
            aria-label="sair do modo slim"
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-drift-muted transition-colors hover:bg-drift-surface/60 hover:text-drift-text focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </m.div>
      )}
    </AnimatePresence>
  )
}

function App() {
  const boot = useBootStore()
  const allPosts = useFeedStore((s) => s.posts)
  // SINK session hide (Satoshi devsec fix 2026-05-20):
  // Posts que o user afundou (↓) nesta sessão são escondidos do stack
  // ATÉ a próxima reload. Pré-fix o post sumia do view atual via
  // advanceCursor mas reaparecia em jump-to-top/EndOfFeed.onBack
  // (porque continuava no `posts` array). Promessa do guia-do-usuario:
  // "Você não precisa ver de novo." — agora cumprida.
  //
  // Por que session-only (não persisted): bury já é evento Nostr 9080
  // público — SoT canônico está nos relays + SQLite. Estado "já vi e
  // afundei agora" é puramente UI ephemera; persistir seria schema
  // bump sem ganho real (refresh é "reset" intencional do user).
  // Manifesto §28 (privacy mínima) — sem dado novo gravado.
  const [sessionBuriedIds, setSessionBuriedIds] = useState<Set<string>>(
    () => new Set(),
  )
  const posts = useMemo(
    () => allPosts.filter((p) => !sessionBuriedIds.has(p.id)),
    [allPosts, sessionBuriedIds],
  )
  const feedLoaded = useFeedStore((s) => s.loaded)
  const userWeight = useUserWeight(boot.identity?.npub ?? null)
  const installPrompt = useInstallPrompt()
  // Slim mode (2026-05-17): toggled via long-press 5s no PostViewer.
  // Esconde NavBar bottom + HomeHeader top, card ocupa toda viewport.
  const slimMode = useViewModeStore((s) => s.slim)

  // V10b — install vira modal. Auto-abre 1x quando disponível (ainda
  // não dismissed nem instalado). User dispensa via X ou via botão
  // "instalar"; reaparece via item dedicado em SettingsRoot.
  const installAutoOpenedRef = useRef(false)

  const onboardingDone = usePrefsStore((s) => s.onboarding_done)
  const locationGranularity = usePrefsStore((s) => s.location_granularity)

  const [publishing, setPublishing] = useState(false)
  const [pending, setPending] = useState<Record<string, 'spread' | 'bury'>>({})
  // Última ação confirmada do user atual por post — semântica "última ação
  // vale" (manifesto §23 — Mudança de opinião). Populado a partir do SQLite
  // sempre que `posts` ou identity mudam. UI usa pra:
  //   1. Destacar o botão correspondente (verde forte / vermelho forte)
  //   2. No-op silencioso se user clicar na ação que já fez (evita duplicar
  //      eventos no banco e nos relays)
  // Não impede ação oposta — user PODE mudar de opinião; scoring atualizado
  // (src/lib/scoring.ts) só considera a última ação líquida.
  const [myActions, setMyActions] = useState<Record<string, 'spread' | 'bury' | null>>({})
  // GPS capture pode demorar até 8s (timeout de getCurrentLocation). Sem
  // feedback, parece travado. Trackeamos quais postIds estão capturando
  // pra UI mostrar "📍 capturando…" ao lado do ↑/↓ pendente. Set ao invés
  // de Record porque é só um boolean por id. publishing usa o mesmo
  // mecanismo via key especial '__publish__' (não colide com event.id hex).
  const [gpsCapturing, setGpsCapturing] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (installPrompt.available && !installAutoOpenedRef.current) {
      installAutoOpenedRef.current = true
      pushLayer({ id: 'install', component: InstallModal })
    }
  }, [installPrompt.available])
  // V9.20 / V10.9 — post linkado via `?p=<nevent>`. Compartilhamento
  // (share menu → URL ?p=) faz user chegar nesse post como CARD ATUAL
  // do home view (V8 embedded UX). Antes (V9.20-V10.8) renderizava em
  // modal mode V7 sobre o feed — visualmente parecia "outro app".
  // V10.9: deepLinkedPost passa a OVERLAYAR o cursor do feed em
  // `currentPost`, com mesma UX (swipe, ⋮, fan, long-press, slide).
  // Quando user swipa (spread/bury), overlay é limpo e cursor do feed
  // continua intocado. Se o post já está no feed, dedup repositioning
  // cursor em vez de overlay (ver effect de boot).
  const [deepLinkedPost, setDeepLinkedPost] = useState<Post | null>(null)

  // Banner de erro GPS (Lily 29-04): user habilita location_granularity
  // mas browser bloqueia silenciosamente. Trackeamos timestamp da última
  // falha + motivo. Banner visível se < 60s, não-dismissed, granularity
  // ativo. sessionStorage persiste dismiss durante a sessão sem poluir
  // localStorage (some quando aba fecha).
  const [gpsFailedAt, setGpsFailedAt] = useState<number | null>(null)
  const [gpsFailReason, setGpsFailReason] =
    useState<Exclude<GeolocationFailureReason, null> | null>(null)
  const [gpsBannerDismissed, setGpsBannerDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem('drift:gps-banner-dismissed') === '1'
  })
  // Tick force-refresh do banner pra ele sumir após 60s sem precisar de
  // outro evento. setInterval barato; pode pausar quando banner não está
  // visível, mas custo é desprezível.
  const [, setBannerTick] = useState(0)
  useEffect(() => {
    if (gpsFailedAt === null) return
    const id = setInterval(() => setBannerTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [gpsFailedAt])

  // Viewer-as-queue (Tinder-like): rastreamos o postId visível no viewer.
  // Ao espalhar/enterrar, avançamos pro próximo post da fila com animação
  // direcional. `viewerExitDir` informa pro PostViewer pra qual lado
  // animar a saída (up = espalhou, down = enterrou).
  // V8: modal viewer (viewerPostId/viewerExitDir) removido — home view
  // embedded substituiu o paradigma "tap to open" + "queue como modal".

  // Onboarding aparece se ainda não foi feito. `loadPrefs` em bootstrap
  // garante que o prefs store já reflete o estado real do SQLite quando
  // o boot fica ready.
  useEffect(() => {
    if (boot.step !== 'ready') return
    if (!onboardingDone) pushLayer({
      id: 'onboarding',
      component: OnboardingOverlay,
      dismiss: [],
      props: {
        onOpenIdentity: () => {
          popLayer({ id: 'onboarding' })
          pushLayer({ id: 'identity', component: IdentityPanel })
        },
      },
    })
  }, [boot.step, onboardingDone])

  // Bootstrap: dispara o boot (idempotente). useBootStore re-renderiza
  // automaticamente em cada transição.
  useEffect(() => {
    void startBoot()
  }, [])

  // PWA shortcuts: manifest declara `/?action=compose` e `/?action=settings`
  // (long-press no ícone do app). Lemos o param no mount e abrimos o estado
  // certo, depois limpamos a URL pra não disparar de novo num refresh.
  useEffect(() => {
    if (boot.step !== 'ready') return
    // V9.29 — parsing puro extraído pra lib/deep-link.ts (testes
    // em tests/deep-link.test.ts).
    const parsed = parseDeepLinkSearch(window.location.search)
    if (parsed.action === 'compose') {
      setShowCreate(true)
    } else if (parsed.action === 'settings') {
      pushLayer({ id: 'settings', component: SettingsRoot })
    }
    // V9.20 / V10.9 — deep link `?p=<nevent>` gerado pelo share post.
    // Fluxo:
    //   1. parseDeepLinkSearch já decodificou pra eventId hex.
    //   2. Tenta SELECT local primeiro (getPostById) — instantâneo se
    //      já está no SQLite (re-share, mesma sessão).
    //   3. Senão, busca o evento via pool.get(relays, {ids:[id]}),
    //      passa por onNostrEvent que persiste no SQLite.
    //   4. Re-tenta getPostById → setDeepLinkedPost OU reposiciona
    //      cursor se o post já está no feed atual (V10.9 dedup —
    //      evita render duplicado overlay + feed item).
    if (parsed.postEventId) {
      const eventId = parsed.postEventId
      void (async () => {
        try {
          const { getPostById } = await import('./lib/feed')
          let post = await getPostById(eventId)
          if (!post) {
            const { pool } = await import('./lib/nostr')
            const { activeReadRelays } = await import('./lib/relays')
            const { onNostrEvent } = await import('./lib/events')
            const relays = [...new Set([...parsed.relayHints, ...activeReadRelays()])]
            const ev = await pool.get(relays, { ids: [eventId] })
            if (ev) {
              await onNostrEvent(ev)
              post = await getPostById(eventId)
            }
          }
          if (post) {
            // V10.9 dedup: snapshot atual do feed pode já conter o post
            // (re-share na mesma sessão, ou autor é alguém que o user
            // segue). Reposicionar cursor evita overlay+feed showing
            // PostX duas vezes. Quando ainda não está no feed (caso
            // mais comum — link de stranger), overlay fica.
            const snapshot = useFeedStore.getState().posts
            const alreadyInFeed = snapshot.some((p) => p.id === post.id)
            if (alreadyInFeed) {
              setCursorByTab((prev) => ({
                ...prev,
                [feedTab]: { postId: post.id, atEnd: false },
              }))
            } else {
              setDeepLinkedPost(post)
            }
          } else console.warn('[deep-link] evento não encontrado:', eventId)
        } catch (err) {
          console.warn('[deep-link] falha ao resolver ?p=', err)
        }
      })()
    }
    if (parsed.peerLink) {
      const peer = parsed.peerLink
      if (boot.identity && peer.npubHex === boot.identity.npub) {
        console.info('[peer-link] link é do próprio user — ignorando')
      } else {
        void import('./components/UI/PeerInterstitial').then(({ PeerInterstitial }) => {
          pushLayer({
            id: 'peer-interstitial',
            component: () => (
              <PeerInterstitial
                npubHex={peer.npubHex}
                relayHints={peer.relayHints}
                onConfirm={() => {
                  popLayer({ id: 'peer-interstitial' })
                  void import('./lib/transport/webrtc').then(({ connectTo }) => {
                    void connectTo(peer.npubHex).catch((err: unknown) => {
                      console.warn('[peer-link] connectTo falhou:', err)
                    })
                  })
                }}
                onCancel={() => popLayer({ id: 'peer-interstitial' })}
              />
            ),
          })
        })
      }
    }
    if (parsed.action || parsed.postEventId || parsed.peerLink) {
      cleanDeepLinkParams()
    }
  }, [boot.step])

  // Carregamento inicial do feed quando boot fica ready. A partir daí,
  // onNostrEvent chama invalidateFeed() automaticamente — sem poll.
  useEffect(() => {
    if (boot.step !== 'ready' || feedLoaded) return
    void refreshFeed()
  }, [boot.step, feedLoaded])

  // Warm-up GPS no idle: quando boot ready + user já optou por location +
  // permissão JÁ concedida → dispara fix em background pra próxima
  // chamada de spread/publish pegar cache fresco em ~50ms ao invés de
  // 1-3s de GPS lock. NÃO dispara se permission === 'prompt' (evita
  // prompt aparecer no boot — UX ruim, manifesto §28).
  useEffect(() => {
    if (boot.step !== 'ready') return
    if (locationGranularity === 'off') return
    if (typeof navigator === 'undefined' || !navigator.permissions) return
    let cancelled = false
    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return
        if (status.state === 'granted') {
          warmUpGpsLocation(locationGranularity)
        }
      })
      .catch(() => {
        // Safari < 16 não suporta permissions.query pra geolocation.
        // Sem warm-up nesse caso — fallback é o cold path normal.
      })
    return () => {
      cancelled = true
    }
  }, [boot.step, locationGranularity])

  // Limpa pending quando a ação real chega no SQLite. Reage a mudanças
  // no array de posts (que vem da feed store, atualizada por
  // invalidateFeed em onNostrEvent).
  useEffect(() => {
    if (Object.keys(pending).length === 0 || !boot.identity) return
    const npub = boot.identity.npub

    let cancelled = false
    ;(async () => {
      const next: Record<string, 'spread' | 'bury'> = {}
      for (const [postId, action] of Object.entries(pending)) {
        const my = await getMyAction(postId, npub)
        if (my !== action) next[postId] = action
      }
      if (
        !cancelled &&
        Object.keys(next).length !== Object.keys(pending).length
      ) {
        setPending(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [posts, pending, boot.identity])

  // Popula `myActions` a cada mudança no feed/identity. Batch de N queries
  // (uma por post) é aceitável até ~100 posts; se virar gargalo, dá pra
  // mover pra view SQL única (LEFT JOIN spreads/buries por author atual).
  // Nota: queries são serializadas no worker — em prática 50 queries leves
  // levam <30ms. Sem early exit aqui pois posts podem ter sumido (moderação)
  // e é importante limpar entradas stale.
  useEffect(() => {
    if (!boot.identity) return
    const npub = boot.identity.npub
    let cancelled = false
    ;(async () => {
      const next: Record<string, 'spread' | 'bury' | null> = {}
      for (const post of posts) {
        next[post.id] = await getMyAction(post.id, npub)
      }
      if (cancelled) return
      setMyActions(next)
    })()
    return () => {
      cancelled = true
    }
  }, [posts, boot.identity])

  // V8 paradigm shift: home view = embedded card stack (não lista
  // vertical). currentIdx aponta pro post atualmente exibido (não há
  // mais "viewer modal"). Auto-skip de posts hidden por filtro local.
  // Quando posts muda (entrada nova chega via subscribe), index 0
  // = post mais recente; usuário decide quando avançar via swipe.
  //
  // V8: viewer modal e queue legada deletados completamente.

  // V8 home stack — cursor por ID + currentPost + nextHomePost.
  //
  // V11 (bug 2026-05-08 "swipe pula 2 posts"): rastreamos o post pelo
  // ID em vez de índice. `posts` é re-ordenado em tempo real quando
  // `invalidateFeed()` dispara — score recalc, evento novo, moderação.
  // Trackear índice numérico → swipe + re-sort no mesmo tick fazia o
  // user pular 2 posts (idx avançava pra slot que já era outro post).
  // Trackear ID elimina a race: o post atual é estável até o user
  // explicitamente avançar; quando avança, calculamos o ID do PRÓXIMO
  // baseado num SNAPSHOT do array no momento do swipe.
  //
  // Estado por tab: `cursor.postId === null` = estado inicial (UI
  // renderiza posts[0]); `cursor.atEnd === true` = passou do último,
  // renderiza EndOfFeed. Lógica pura em src/lib/feed-cursor.ts pra
  // facilitar testes em Node sem React/DOM.
  const [exitDir, setExitDir] = useState<'up' | 'down'>('up')
  // Subscreve `tab` pra que cada tab tenha sua sequência independente —
  // user feedback 2026-05-08: "Global/Seguindo/Trending cada um deveria
  // ter sua própria sequência". `cursorByTab` persiste posição por tab;
  // trocar e voltar mantém onde parou. Manifesto §24 — feeds são views
  // distintas, navegação é local de cada view.
  const feedTab = useFeedStore((s) => s.tab)
  const [cursorByTab, setCursorByTab] = useState<Record<FeedTab, FeedCursor>>({
    global: { postId: null, atEnd: false },
    following: { postId: null, atEnd: false },
    trending: { postId: null, atEnd: false },
  })
  // Último idx válido por tab — usado pra snap quando o post atual
  // some do feed (ex: moderação atinge threshold, score = -999 esconde).
  // Sem isso, `findIndex(id) === -1` deixaria o user em limbo. Snap pro
  // último idx conhecido (clampado contra posts.length atual) é o
  // comportamento mínimo coerente: mantém posição relativa, nunca
  // empurra pro topo nem pro fim.
  const lastKnownIdxByTabRef = useRef<Record<FeedTab, number>>({
    global: 0,
    following: 0,
    trending: 0,
  })

  const cursor = cursorByTab[feedTab]
  const atEnd = cursor.atEnd && posts.length > 0
  // Deriva idx atual do cursor (postId-aware, com snap pra lastKnown
  // se o post sumiu). Lógica em feed-cursor.ts:resolveCursorIdx.
  const currentIdx = useMemo(
    () => resolveCursorIdx(cursor, posts, lastKnownIdxByTabRef.current[feedTab]),
    [cursor, posts, feedTab],
  )

  // Track lastKnown idx sempre que tivermos um idx válido (não atEnd,
  // não array vazio). Stale-safe: ref não causa re-render, só mantém
  // "memória" pra próximo snap.
  useEffect(() => {
    if (posts.length === 0 || atEnd) return
    lastKnownIdxByTabRef.current = {
      ...lastKnownIdxByTabRef.current,
      [feedTab]: currentIdx,
    }
  }, [currentIdx, posts.length, atEnd, feedTab])

  const { currentPost, nextHomePost } = useMemo(() => {
    // V10.9 deep-link overlay: quando user chega via ?p=<nevent>, o post
    // compartilhado vira o card atual do home view. Shadow cards atrás
    // mostram o que era o card atual do feed normal — depois do swipe,
    // o user "entra" no feed dele a partir dali.
    if (deepLinkedPost) {
      const safeIdx = Math.max(0, Math.min(currentIdx, posts.length - 1))
      return {
        currentPost: deepLinkedPost,
        nextHomePost: posts.length > 0 && !atEnd ? posts[safeIdx]! : null,
      }
    }
    if (posts.length === 0 || atEnd) return { currentPost: null, nextHomePost: null }
    const safeIdx = Math.max(0, Math.min(currentIdx, posts.length - 1))
    return {
      currentPost: posts[safeIdx]!,
      nextHomePost: safeIdx + 1 < posts.length ? posts[safeIdx + 1]! : null,
    }
  }, [currentIdx, posts, atEnd, deepLinkedPost])
  // Inicialização lazy — quando posts carrega pela primeira vez E o
  // user ainda não tem post selecionado naquela tab, ancora em posts[0].
  // Ancorar em ID (em vez de deixar `null` permanente) é importante:
  // assim que novos posts chegarem, o user permanece no post que estava
  // vendo — o "topo" não se desloca embaixo dele.
  //
  // CRÍTICO: só dispara quando feedLoaded === true. Durante transição
  // de tab (setFeedTab → store loaded=false → refreshFeed async →
  // store loaded=true), posts contém RESIDUAL da tab anterior. Sem
  // esse guard, ancoraríamos a nova tab no post errado.
  // User feedback 2026-05-08: "ir pra tab vazia força outras tabs ao topo".
  useEffect(() => {
    if (!feedLoaded) return
    if (posts.length === 0) return
    const next = initialAnchor(cursor, posts)
    if (next === null) return
    setCursorByTab((prev) => ({ ...prev, [feedTab]: next }))
  }, [posts, feedLoaded, feedTab, cursor])

  /** Helper: navega pro post de índice `targetIdx`. API compat pra
   *  call sites que ainda raciocinam em termos de índice
   *  (jumpToTop, onActiveTabTap). Snapshot da feed store no momento
   *  do call — não depende de re-render. */
  const setPostByIndex = useCallback(
    (targetIdx: number) => {
      const snapshot = useFeedStore.getState().posts
      setCursorByTab((prev) => ({
        ...prev,
        [feedTab]: setCursorByIndex(prev[feedTab], snapshot, targetIdx),
      }))
    },
    [feedTab],
  )

  // V8: openViewer + advanceViewer (modal viewer queue) deletados —
  // home view embedded substituiu o paradigma. viewerPostId/viewerExitDir
  // ainda existem mas não são setados em lugar nenhum (sempre null/'up'),
  // mantidos pra evitar break em código downstream que ainda referencia
  // (nenhum em V8). Track futura limpa o resíduo.

  /**
   * V8 home stack advance. Avança pro próximo post.
   *
   * V11: snapshot do array atual no momento do swipe — `advanceCursor`
   * (lib/feed-cursor.ts) decide o ID do próximo ANTES que
   * `invalidateFeed()` (score recalc do spread que acabou de publicar)
   * re-ordene `posts`. Isso elimina o bug "swipe pula 2 posts" (race
   * UI state vs feed re-sort).
   *
   * Última posição válida = `cursor.atEnd` (sentinel "fim do feed",
   * renderiza EndOfFeed em vez de travar no último post). User
   * feedback 2026-05-08: travar gera ambiguidade ("acabou? travou?").
   */
  function advanceHome(dir: 'up' | 'down') {
    setExitDir(dir)
    // V10.9: deep-link overlay tem cursor próprio. Swipe SÓ limpa o
    // overlay — cursor do feed permanece onde estava (no shadow card).
    // Próximo render mostra posts[currentIdx] naturalmente.
    if (deepLinkedPost) {
      setDeepLinkedPost(null)
      return
    }
    const snapshot = posts
    const idxAtSwipe = currentIdx
    setCursorByTab((prev) => ({
      ...prev,
      [feedTab]: advanceCursor(prev[feedTab], snapshot, idxAtSwipe),
    }))
  }

  // Ações ──────────────────────────────────────────────────────────────

  async function handlePublish(input: {
    subposts: Subpost[]
    contentWarning: ContentWarning | null
    imetas: import('./lib/nip94').BlobMeta[]
  }) {
    if (publishing || input.subposts.length === 0) return
    setPublishing(true)
    const granularity = getPrefs().location_granularity
    const willCapture = granularity !== 'off'
    if (willCapture) setGpsCapturing((s) => new Set(s).add('__publish__'))
    try {
      // Captura location se o user habilitou em settings (default: off).
      // Manifesto §28 — opt-in granular. getCurrentLocation respeita a
      // granularidade declarada (country/city/precise) e arredonda lat/lng.
      const location = await getCurrentLocation(granularity)
      if (willCapture)
        setGpsCapturing((s) => {
          const n = new Set(s)
          n.delete('__publish__')
          return n
        })

      // Diagnóstico (Lily peer review 29-04): se user habilitou GPS mas
      // captura falhou, log explícito ajuda debug via DevTools. Causas
      // comuns já logadas em geolocation.ts (PERMISSION_DENIED, TIMEOUT,
      // POSITION_UNAVAILABLE). Aqui adiciona contexto da action.
      if (willCapture && !location) {
        console.warn(
          `[publish] location_granularity='${granularity}' mas getCurrentLocation retornou null — ` +
            'post publicado SEM location. Ver warnings de [geolocation] acima pra motivo.',
        )
        const reason = getLastFailureReason()
        if (reason) {
          setGpsFailedAt(Date.now())
          setGpsFailReason(reason)
        }
      } else if (willCapture && location) {
        // Sucesso na captura — limpa state pra banner sumir.
        setGpsFailedAt(null)
        setGpsFailReason(null)
      }

      // Sem `postId` — protocol.ts gera o evento e o `event.id` resultante
      // é o identificador canônico do post. NIP-01: kind 9078 é regular
      // event, sem `d` tag. UUID local violava o formato hex 64 quando
      // referenciado por SPREAD/BURY/REPORT (tag `e`).
      await createPost({
        subposts: input.subposts,
        ...(input.contentWarning ? { contentWarning: input.contentWarning } : {}),
        ...(location ? { location } : {}),
        // Track B.2: tags `imeta` NIP-94 com hash + url + cid (best-effort).
        // Posts só-texto não passam imetas (array vazio é omitido).
        ...(input.imetas.length > 0 ? { imetas: input.imetas } : {}),
      })
      // V7: success path fecha o modal. SubpostEditor reseta seus drafts
      // internos no próprio handleSubmit (já era assim antes do V7).
      setShowCreate(false)
    } catch (err) {
      console.error('publish failed', err)
      await dialog.alert(
        `Falha ao publicar: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    } finally {
      setPublishing(false)
      // Garante limpeza mesmo se getCurrentLocation throw (não deveria —
      // ela retorna null em erro — mas defensivo).
      setGpsCapturing((s) => {
        if (!s.has('__publish__')) return s
        const n = new Set(s)
        n.delete('__publish__')
        return n
      })
    }
  }

  async function handleSpread(post: Post) {
    if (pending[post.id]) return
    // No-op silencioso se user já espalhou este post — evita duplicar
    // evento no SQLite/relays. "Última ação vale" não significa permitir
    // ação idêntica repetida. Pra reverter, user clica ↓ (ação oposta).
    if (myActions[post.id] === 'spread') return
    setPending((p) => ({ ...p, [post.id]: 'spread' }))

    // Timeout de safety: se o evento não voltar pelo subscribe em 15s
    // (alguns relays não echoam pro publisher; rede ruim; etc.), limpa
    // o pending pra UI não ficar com optimistic +1 eterno. Manifesto §10:
    // "optimistic state nunca persiste no SQLite" — e também não pode
    // mentir indefinidamente.
    const safetyTimeout = setTimeout(() => {
      setPending((p) => {
        if (p[post.id] !== 'spread') return p
        console.warn(
          `[spread] post ${post.id.slice(0, 8)}… não confirmou em ${OPTIMISTIC_TIMEOUT_MS / 1000}s — descartando optimistic`,
        )
        const { [post.id]: _omit, ...rest } = p
        return rest
      })
    }, OPTIMISTIC_TIMEOUT_MS)

    const granularity = getPrefs().location_granularity
    const willCapture = granularity !== 'off'
    if (willCapture) setGpsCapturing((s) => new Set(s).add(post.id))

    try {
      // Location opt-in — mesma regra de createPost (manifesto §28).
      // Spread propaga geograficamente: arcos no mapa só aparecem com
      // location nos spreads (origem do arc = primeiro spread, destino =
      // cada subsequente). Ver useSpreadMap.ts.
      const location = await getCurrentLocation(granularity)
      if (willCapture)
        setGpsCapturing((s) => {
          const n = new Set(s)
          n.delete(post.id)
          return n
        })

      // Diagnóstico (Lily peer review 29-04): user reportou "GPS não pega"
      // sem feedback. Log explícito ajuda debug — motivo da falha já vem
      // de geolocation.ts (PERMISSION_DENIED / TIMEOUT / POSITION_UNAVAILABLE).
      if (willCapture && !location) {
        console.warn(
          `[spread] location_granularity='${granularity}' mas getCurrentLocation retornou null — ` +
            'spread publicado SEM location (mapa não vai mostrar arco daqui). ' +
            'Ver warnings de [geolocation] acima pra motivo.',
        )
        const reason = getLastFailureReason()
        if (reason) {
          setGpsFailedAt(Date.now())
          setGpsFailReason(reason)
        }
      } else if (willCapture && location) {
        setGpsFailedAt(null)
        setGpsFailReason(null)
      }

      await spreadPost({
        postId: post.id,
        authorPub: post.authorPub,
        ...(location ? { location } : {}),
      })
    } catch (err) {
      clearTimeout(safetyTimeout)
      console.error('spread failed', err)
      setPending((p) => {
        const { [post.id]: _omit, ...rest } = p
        return rest
      })
      setGpsCapturing((s) => {
        if (!s.has(post.id)) return s
        const n = new Set(s)
        n.delete(post.id)
        return n
      })
    }
  }

  async function handleBury(post: Post) {
    if (pending[post.id]) return
    // No-op silencioso se user já enterrou — ver handleSpread.
    if (myActions[post.id] === 'bury') return
    setPending((p) => ({ ...p, [post.id]: 'bury' }))
    // SINK session hide — adiciona ao set local IMEDIATAMENTE pra que o
    // próximo render do feed filtre o post fora. advanceCursor abaixo
    // (em advanceHome('down')) move pro próximo; sessionBuriedIds garante
    // que ele NÃO reapareça em jump-to-top / EndOfFeed.onBack até reload.
    // Aplica mesmo se buryPost() falhar — bury é "intenção visível" do
    // user; recuperar a opinião exige swipe ↑ explícito.
    setSessionBuriedIds((prev) => {
      const next = new Set(prev)
      next.add(post.id)
      return next
    })

    const safetyTimeout = setTimeout(() => {
      setPending((p) => {
        if (p[post.id] !== 'bury') return p
        console.warn(
          `[bury] post ${post.id.slice(0, 8)}… não confirmou em ${OPTIMISTIC_TIMEOUT_MS / 1000}s — descartando optimistic`,
        )
        const { [post.id]: _omit, ...rest } = p
        return rest
      })
    }, OPTIMISTIC_TIMEOUT_MS)

    try {
      await buryPost({ postId: post.id })
    } catch (err) {
      clearTimeout(safetyTimeout)
      console.error('bury failed', err)
      setPending((p) => {
        const { [post.id]: _omit, ...rest } = p
        return rest
      })
    }
  }

  // Render ─────────────────────────────────────────────────────────────

  if (boot.step === 'error' && boot.error === 'MULTI_TAB_CONFLICT') {
    return <MultiTabModal />
  }

  if (boot.step !== 'ready') {
    return <BootView state={boot} />
  }

  // V8 paradigm shift: layout vertical h-screen flex column.
  // [Header (logo + DERIVA + tabs)] [Stack flex-1] [NavBar fixo bottom]
  // Stack mostra 1 card por vez (PostViewer embedded), navegação via swipe.
  return (
    // Drift é mobile-first PWA. Em telas largas (>448px), o app cap-eia
    // em max-w-md e centra. Sem isso, o card stack estica até 1920px+
    // ficando absurdo. NavBar e FullPageCard têm seus próprios
    // max-w-md mx-auto pra ficarem alinhados com o app centrado.
    // User feedback 2026-05-08.
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col border-drift-border font-mono text-sm sm:border-x">
      <HomeHeader
        identity={boot.identity}
        userWeight={userWeight}
        currentScore={currentPost?.score ?? null}
        locationGranularity={locationGranularity}
        onOpenLocation={() => pushLayer({ id: 'location', component: LocationCard })}
        onOpenNetworkMode={() => pushLayer({ id: 'network', component: NetworkModeCard })}
        onOpenStatus={() => pushLayer({ id: 'status', component: StatusCardLayer })}
        onOpenIdentity={() => {
          if (!boot.identity) return
          pushLayer({
            id: 'identity',
            component: IdentityPanel,
            props: { identity: boot.identity },
          })
        }}
        onOpenProfile={() => {
          if (!boot.identity) return
          pushLayer({
            id: 'profile',
            component: ProfileModal,
            props: { identity: boot.identity },
          })
        }}
        onActiveTabTap={() => setPostByIndex(0)}
      />

      {/* Banners empilhados acima do stack. Layout flex-shrink-0 garante
          que stack pega o resto do espaço. */}
      <div className="shrink-0 px-4">
        {(() => {
          if (locationGranularity === 'off') return null
          if (gpsBannerDismissed) return null
          if (gpsFailedAt === null || gpsFailReason === null) return null
          if (Date.now() - gpsFailedAt > 60_000) return null
          return (
            <LazyBoundary fallback={null}>
              <GpsErrorBanner
                reason={gpsFailReason}
                onDismiss={() => {
                  setGpsBannerDismissed(true)
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.setItem(
                      'drift:gps-banner-dismissed',
                      '1',
                    )
                  }
                }}
              />
            </LazyBoundary>
          )
        })()}

        {/* V9.2e: DiagnosticPanel não renderiza mais inline aqui —
            agora é card próprio (StatusCard) acionado via SettingsRoot. */}

        {/* InstallBanner inline removido — agora vira modal/dialog
            (auto-abre 1x via showInstallModal) e item dedicado em
            SettingsRoot quando ainda instalável. */}
      </div>

      <LazyBoundary fallback={null}>
        <UpdatePrompt />
      </LazyBoundary>
      <LazyBoundary fallback={null}>
        <DialogHost />
      </LazyBoundary>
      <LazyBoundary fallback={null}>
        <DiscoverNudgeBanner />
      </LazyBoundary>
      <LazyBoundary fallback={null}>
        <LensNudgeBanner />
      </LazyBoundary>

      {/* Slim mode hint — chip discreto top-center quando slim ativo,
          explica gesto pra sair. fade in 300ms, auto-dismiss 4s.
          Mostra exit button (X) caso user não queira esperar 5s. */}
      <SlimModeHint />


      <LayerRenderer />

      {/* Stack — área central que contém o card atual. flex:1 expande
          até a navbar bottom. Card visual = PostViewer embedded.
          2 shadow cards atrás visíveis quando há nextHomePost. */}
      {/* Stack — área central que contém o card atual. flex:1 expande
          até a navbar bottom. NavBar é fixed (z-30, h-68px no primitive
          + padding); aplicamos pb-[88px] aqui (68 navbar + 20 folga)
          pra evitar cards renderizarem POR TRÁS da navbar fixed.
          Slim mode (2026-05-17): zera padding bottom + top + horizontal
          pra card ocupar TODA viewport. Transição animada via Tailwind
          `transition-[padding]` + duration matching spring (≈300ms). */}
      <main
        className={`relative min-h-0 flex-1 overflow-hidden transition-[padding] duration-300 ease-out ${
          slimMode ? 'p-0' : 'px-4 pt-3 pb-[88px]'
        }`}
      >
        {posts.length === 0 ? (
          // Barney+Robin Hyp #2 fix 2026-05-20: durante first-load, posts=[]
          // E feedLoaded=false simultaneamente. Sem este branch, mostrava
          // "nenhum post" mesmo carregando — UX parecia bugada ('app travou
          // sem mostrar nada'). DriftSkeleton card-shaped comunica
          // "carregando" enquanto sync inicial roda. Feed vazio REAL
          // (sem posts após boot ready) cai no HomeEmpty.
          !feedLoaded ? (
            <div className="h-full">
              <DriftSkeleton variant="card" />
            </div>
          ) : (
            <HomeEmpty tab={useFeedStore.getState().tab} />
          )
        ) : atEnd ? (
          <EndOfFeed
            tab={feedTab}
            onBack={() => {
              // V11: voltar do EndOfFeed → último post visto. ID já
              // está preservado no cursor (o "último" no momento que
              // entrou em atEnd). Se aquele post sumiu, o memo
              // currentIdx faz snap pro nearest. exitAtEnd só desliga
              // a flag atEnd preservando postId.
              setCursorByTab((prev) => ({
                ...prev,
                [feedTab]: exitAtEnd(prev[feedTab]),
              }))
            }}
            onJumpToTop={() => setPostByIndex(0)}
          />
        ) : currentPost ? (
          <>
            {/* Shadow stack legacy removido 2026-05-17 — `inset-x-4 top-3
                bottom-2` colidia com `<main>` padding `px-4 pt-3 pb-[88px]`
                (duplo recuo) + sem -z-index pra ficar atrás + main
                `overflow-hidden` cortava translateY. PostViewer já mostra
                "fila X/N" + "próximo: anon…XXX" textualmente via prop
                `queue` (PostViewer.tsx:778-790). Shadow visual era
                redundante. Pra restaurar pattern Tinder-like correto:
                seguir DRIFT_CARD_SHADOW_BACK_CLASS em UI/DriftCard.tsx. */}
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-drift-border/40 bg-drift-surface">
              <AnimatePresence mode="wait" custom={exitDir}>
                <PostViewer
                  key={currentPost.id}
                  custom={exitDir}
                  post={currentPost}
                  isMine={currentPost.authorPub === boot.identity?.npub}
                  pendingAction={pending[currentPost.id] ?? null}
                  queue={{
                    index: currentIdx,
                    total: posts.length,
                    next: nextHomePost,
                  }}
                  onOpenLocationSettings={() => {
                    pushLayer({ id: 'location', component: LocationCard })
                  }}
                  onSpread={() => {
                    handleSpread(currentPost)
                    advanceHome('up')
                  }}
                  onBury={() => {
                    handleBury(currentPost)
                    advanceHome('down')
                  }}
                  onClose={() => {
                    /* home view — não há "fechar" (modal removido em V8) */
                  }}
                />
              </AnimatePresence>
            </div>
          </>
        ) : null}
      </main>

      {/* V9 — Compose overlay full-page (substitui o modal V7).
          Mockup v0.7: header "novo drift" + CANCELAR, csub dots
          numerados, layout chips, drop area condicional, footer btn-del
          + DRIFT ↑. */}
      <AnimatePresence>
        {showCreate && (
          <LazyBoundary fallback={<DriftSkeleton variant="card" />}>
            <ComposeOverlay
              publishing={publishing}
              capturingLocation={gpsCapturing.has('__publish__')}
              maxSubposts={userWeight.maxSubposts}
              onClose={() => setShowCreate(false)}
              onPublish={handlePublish}
            />
          </LazyBoundary>
        )}
      </AnimatePresence>

      {/* V8 — NavBar fixed bottom com plus central (mockup v0.7).
          3 slots: [MAPA, +(compose), CONFIG]. Mapa abre overlay
          fullscreen mostrando propagação dos posts (eventos rede); +
          abre compose page; CONFIG abre Settings tabbed (sub-overlays
          futuro V10).
          Hidden quando showCreate ou showMap em vôo (não competir com
          modais fullscreen). */}
      {!showCreate && !hasLayer('map') && (
        <NavBar
          left={[
            {
              icon: <MapIcon size={18} />,
              label: 'mapa',
              onClick: () => pushLayer({ id: 'map', component: MapOverlay, props: { currentPost } }),
              ariaLabel: 'abrir mapa de propagação',
            },
          ]}
          right={[
            {
              icon: <SlidersIcon size={18} />,
              label: 'config',
              onClick: () => pushLayer({ id: 'settings', component: SettingsRoot }),
              ariaLabel: 'abrir config',
            },
          ]}
          onCompose={() => setShowCreate(true)}
          composeAriaLabel="criar post"
          slim={slimMode}
        />
      )}

      {/* V8: modal viewer overlay deletado — home view embedded
          substituiu o paradigma "tap to open". */}

      {/* V10.9 — deep-link modal removido. Post compartilhado agora
          renderiza como `currentPost` do home view (overlay sobre o
          cursor do feed) usando o mesmo PostViewer embedded. Spread/
          bury limpam o overlay e o feed continua a partir do cursor
          intocado. Lógica vive em `currentPost` useMemo + advanceHome
          gate em deepLinkedPost. */}

      {/* Overlays managed by LayerStack — see <LayerRenderer /> above */}
    </div>
  )
}

// ─── HomeHeader (V8) ─────────────────────────────────────────────────

/**
 * V8 home header — alinhado ao mockup v0.7. Layout:
 *
 *   [dri<em>ft</em>]                    deriva 3.241
 *   ─────────────────────────────────────────────
 *   GLOBAL          SEGUINDO          TRENDING
 *
 * - Logo Syne 800 25px com "ft" em chartreuse italic
 * - DERIVA stat = events count via syncStore (proxy de "atividade da rede")
 * - FeedTabs com indicator slide elastic (V3.2)
 *
 * NOTA: O Header pré-V8 tinha 8 botões (chave/identidades/relays/listas/
 * settings/status/limpar local + indicators 📍🌐). Esses migram pra
 * NavBar [⚙ CONFIG] em V8.5; até consolidação completa em V10 (Settings
 * tabbed sub-overlays), as ações ficam acessíveis via long-press menu
 * futuro OU via SettingsRoot existente (acionado pelo CONFIG da NavBar).
 *
 * Props ainda recebidos (identity/onOpenIdentity/etc) preservados pra
 * futuras integrações — long-press do logo abre IdentityPanel, etc.
 * Em V8, esses callbacks NÃO são consumidos — apenas tipados.
 */
/**
 * V10a — StatusIndicators. Restaura os indicadores de status que viviam
 * no Header pré-V8 (📍 location, 🌐/🧅/🛡 network mode, ● events count).
 *
 * Layout compacto inline na linha do logo. Cada ícone é botão clicável:
 *   - 📍 → LocationCard (granularidade GPS)
 *   - 🌐/🧅/🛡 → NetworkModeCard (clearnet/tor/onion-only)
 *   - ● <N> ev → StatusCard (DiagnosticPanel)
 *
 * Estado visual:
 *   - location off (default privacidade) = ícone muted; ativa = âmbar
 *   - network = ícone reflete modo atual; PWA não-Tauri com tor → muted
 *   - events count = atualiza em tempo real do syncStore
 *   - active dot = verde quando subscribe ativo, cinza quando offline
 *
 * Manifesto §28 (privacidade visível) + §15 (anti-censura auditável)
 * exige que user veja o estado real da rede a qualquer momento. Esses
 * indicadores garantem isso sem precisar abrir Settings.
 */
function StatusIndicators({
  onOpenStatus,
  onOpenProfile,
  onOpenNetworkMode,
  onOpenLocation,
}: {
  onOpenStatus: () => void
  onOpenProfile: () => void
  onOpenNetworkMode: () => void
  onOpenLocation: () => void
}) {
  const events = useSyncStore((s) => s.eventsReceived)
  const active = useSyncStore((s) => s.active)
  const degradedCount = useBootStore((s) => s.degradedReasons.length)
  const networkMode = usePrefsStore((s) => s.network_mode)
  const locationGranularity = usePrefsStore((s) => s.location_granularity)

  // Network icon reflete modo ativo (clearnet/tor/onion-only).
  // Manifesto §15 — anti-censura auditável (user vê transporte ativo).
  const NetIcon =
    networkMode === 'tor'
      ? OnionIcon
      : networkMode === 'onion-only'
      ? ShieldIcon
      : GlobeIcon
  const netLabel =
    networkMode === 'tor'
      ? 'rede: tor'
      : networkMode === 'onion-only'
      ? 'rede: onion-only'
      : 'rede: clearnet'

  // GPS icon reflete granularidade (off = riscado).
  // Manifesto §28 — privacidade visível.
  const gpsOff = locationGranularity === 'off'
  const GpsIcon = gpsOff ? PinOffIcon : PinIcon
  const gpsLabel = gpsOff
    ? 'gps: desativado'
    : `gps: ${locationGranularity}`

  return (
    <div className="flex items-center gap-[10px] text-[12px] leading-none">
      {/* Profile indicator */}
      <button
        onClick={onOpenProfile}
        className="text-drift-muted transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
        title="perfil"
        aria-label="abrir perfil"
      >
        <UserIcon size={14} />
      </button>

      {/* Network indicator — abre NetworkModeCard. Cor reflete status:
          clearnet muted, tor/onion-only chartreuse pra destacar
          transporte protegido. Manifesto §15. */}
      <button
        onClick={onOpenNetworkMode}
        className={`transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
          networkMode === 'clearnet' ? 'text-drift-muted' : 'text-drift-accent'
        }`}
        title={netLabel}
        aria-label={`${netLabel} — abrir modo de rede`}
      >
        <NetIcon size={14} />
      </button>

      {/* GPS indicator — abre LocationCard. Riscado quando off
          (default privacidade). Manifesto §28. */}
      <button
        onClick={onOpenLocation}
        className={`transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
          gpsOff ? 'text-drift-muted' : 'text-drift-accent'
        }`}
        title={gpsLabel}
        aria-label={`${gpsLabel} — abrir granularidade de gps`}
      >
        <GpsIcon size={14} />
      </button>

      {/* Degraded badge — reserva espaço sempre (invisible) pra não
          causar layout shift quando aparece. Sinal forte de atenção. */}
      <button
        onClick={onOpenStatus}
        className={`text-drift-warning transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
          degradedCount > 0 ? 'visible' : 'invisible pointer-events-none'
        }`}
        title={`Modo degradado — ${degradedCount} feature${degradedCount > 1 ? 's' : ''} indisponível${degradedCount > 1 ? 'is' : ''}`}
        aria-label="modo degradado"
        aria-hidden={degradedCount === 0}
      >
        <WarningIcon size={14} />
      </button>

      {/* Events counter — abre StatusCard. */}
      <button
        onClick={onOpenStatus}
        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[1px] text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
        title={`${events} eventos recebidos · subscribe ${active ? 'ativo' : 'offline'}`}
        // WCAG 2.5.3 — aria-label inclui o número visível "ev" pra
        // bater com o texto que voice control users veem.
        aria-label={`${events} ev — abrir painel de status`}
      >
        <span
          className={active ? 'text-drift-spread' : 'text-drift-muted'}
          aria-hidden="true"
        >
          ●
        </span>
        <span className="inline-block w-[52px]">{events > 9999 ? '9999+' : events} ev</span>
      </button>
    </div>
  )
}

function HomeHeader({
  identity,
  userWeight,
  currentScore,
  locationGranularity,
  onOpenLocation,
  onOpenNetworkMode,
  onOpenStatus,
  onOpenIdentity,
  onOpenProfile,
  onActiveTabTap,
}: {
  identity: DriftIdentity | null
  userWeight: { weight: number; engagement: number; antiquity: number; maxSubposts: number }
  /** Score do post atualmente visível (manifesto §22). null = feed vazio. */
  currentScore: number | null
  locationGranularity: LocationGranularity
  onOpenLocation: () => void
  onOpenNetworkMode: () => void
  onOpenStatus: () => void
  onOpenIdentity: () => void
  onOpenProfile: () => void
  /** Tap-on-active-tab handler (Twitter/Bluesky pattern, scroll-to-top). */
  onActiveTabTap?: () => void
}) {
  // Suprime "unused" warning — callbacks reservados pra long-press
  // futuro (V11+ avatar/logo abrirá IdentityPanel via gesture).
  void identity
  void userWeight
  void onOpenIdentity
  void locationGranularity

  // Slim mode: header inteiro (logo + status + FeedTabs) some via slide-up.
  // Mesma animação coordenada com NavBar (slim no view-mode store).
  const slim = useViewModeStore((s) => s.slim)
  return (
    <m.header
      className="shrink-0 px-5 pt-4"
      animate={{ y: slim ? '-110%' : '0%', opacity: slim ? 0 : 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.8 }}
      aria-hidden={slim || undefined}
      // @ts-expect-error -- inert é HTML attribute valid mas React 18 não tipa
      inert={slim ? '' : undefined}
      style={{
        // Slim: header sai do layout flow (position: fixed-like) pra card
        // expandir realmente. Sem isso, header `shrink-0` mantém o slot
        // mesmo quando off-screen — card não cresce.
        ...(slim ? { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' } : {}),
      }}
    >
      <div className="mb-[14px] flex items-center justify-between gap-3">
        <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[-0.5px] text-drift-text">
          dri<em className="not-italic text-drift-accent">ft</em>
        </h1>
        <div className="flex items-center gap-3">
          <StatusIndicators
            onOpenStatus={onOpenStatus}
            onOpenProfile={onOpenProfile}
            onOpenNetworkMode={onOpenNetworkMode}
            onOpenLocation={onOpenLocation}
          />
          <div className="font-mono text-[10px] uppercase tracking-meta text-drift-muted">
            deriva{' '}
            <b className="inline-block w-[44px] font-medium text-drift-accent2">
              {currentScore !== null ? formatScore(currentScore) : '—'}
            </b>
          </div>
        </div>
      </div>
      <div className="border-b border-drift-border">
        <FeedTabs {...(onActiveTabTap ? { onActiveTabTap } : {})} />
      </div>
    </m.header>
  )
}

/**
 * Format do score determinístico (manifesto §22) pra exibição no header.
 * `post.score` é float arbitrário; o mockup mostra "3.241" — formato com
 * separador de milhar PT-BR pra inteiros, 3 decimais pra fracionários.
 */
function formatScore(score: number): string {
  if (Math.abs(score) >= 1000) return Math.round(score).toLocaleString('pt-BR')
  return score.toFixed(3)
}

// ─── HomeEmpty (V8) ──────────────────────────────────────────────────

/**
 * FeedSnapshotAgeBadge — mostra "atualizado há X" no EndOfFeed quando
 * snapshot está stale (>FEED_SNAPSHOT_STALE_MS). Lily Tinder-audit
 * 2026-05-21 (Item 3). Manifesto §28: local-only, zero export.
 *
 * Re-renderiza por minuto via tick interno pra mostrar age crescente
 * sem precisar re-fetch global. Cleanup em unmount.
 */
function FeedSnapshotAgeBadge() {
  const snapshotTs = useFeedStore((s) => s.snapshotTs)
  const [, force] = useState(0)
  useEffect(() => {
    if (snapshotTs === null) return
    const interval = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(interval)
  }, [snapshotTs])
  if (snapshotTs === null) return null
  const ageMs = Date.now() - snapshotTs
  if (ageMs < FEED_SNAPSHOT_STALE_MS) return null
  const ageMin = Math.floor(ageMs / 60_000)
  const label =
    ageMin < 60
      ? `${ageMin} min`
      : ageMin < 1440
      ? `${Math.floor(ageMin / 60)}h ${ageMin % 60}min`
      : `${Math.floor(ageMin / 1440)}d`
  return (
    <div
      className="font-mono text-[10px] uppercase tracking-meta text-drift-warning/70"
      title="snapshot do feed; toque ↻ atualizar pra refresh"
      aria-live="polite"
    >
      ⏱ feed atualizado há {label}
    </div>
  )
}

function HomeEmpty({ tab }: { tab: 'global' | 'following' | 'trending' }) {
  const msg =
    tab === 'following'
      ? 'Você não segue ninguém ainda. Toque ➕ pra criar seu primeiro post — depois siga autores ao abrir os posts deles.'
      : tab === 'trending'
      ? 'Nada em alta nas últimas 24h. Driftar um post recente vai puxar ele pro trending.'
      : 'Nenhum post no feed ainda. Toque ➕ pra publicar o primeiro — ele vai dar a volta pelos relays e voltar.'
  return (
    <div className="flex h-full items-center justify-center px-8">
      <p className="max-w-prose text-center font-mono text-[12px] leading-relaxed text-drift-muted">
        {msg}
      </p>
    </div>
  )
}

// ─── EndOfFeed (V8.1) ────────────────────────────────────────────────

/**
 * Card sentinel quando user passa do último post da fila atual.
 *
 * User feedback 2026-05-08: travar no último post sem feedback gera
 * ambiguidade — "acabou? travou? bug?". Permitir avançar pra um card
 * de "fim" comunica explicitamente o estado, oferece ações (atualizar,
 * voltar pro topo, voltar 1).
 *
 * Visual: mesmo container de card que PostViewer (border + bg
 * drift-surface) pra continuidade visual, mas com layout centrado e
 * sem swipe handlers — só botões.
 */
function EndOfFeed({
  tab,
  onBack,
  onJumpToTop,
}: {
  tab: 'global' | 'following' | 'trending'
  /** Voltar 1 post (o último que o user viu). */
  onBack: () => void
  /** Jump explícito pra idx=0 (instant, sem network). */
  onJumpToTop: () => void
}) {
  const tabLabel =
    tab === 'following' ? 'seguindo' : tab === 'trending' ? 'em alta' : 'global'
  const [refreshing, setRefreshing] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  /**
   * Atualizar feed: re-query SQLite + mark seen + decide o que fazer
   * com o idx baseado em CRESCIMENTO da fila.
   * - Posts novos chegaram (length cresceu) → jump pra topo (user vê
   *   o conteúdo novo)
   * - Sem mudança → STAY no EndOfFeed + msg "nada de novo no momento"
   *   (user feedback 2026-05-08: "atualizar e voltar pro topo tinham
   *   o mesmo efeito" — agora se diferenciam por comportamento)
   */
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setStatusMsg(null)
    const oldLength = useFeedStore.getState().posts.length
    try {
      await refreshFeed()
      markFeedSeen()
      const newLength = useFeedStore.getState().posts.length
      if (newLength > oldLength) {
        const delta = newLength - oldLength
        onJumpToTop()
        setStatusMsg(
          `${delta} ${delta === 1 ? 'post novo' : 'posts novos'}`,
        )
      } else {
        setStatusMsg('nada de novo no momento')
      }
    } finally {
      setTimeout(() => setRefreshing(false), 400)
      setTimeout(() => setStatusMsg(null), 3500)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-drift-border bg-drift-surface">
      <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-tag text-drift-muted">
          fim do feed · {tabLabel}
        </div>
        <h2 className="font-display text-xl font-bold leading-title tracking-title text-drift-text">
          Você viu tudo por aqui.
        </h2>
        <p className="max-w-prose font-mono text-[12px] leading-relaxed text-drift-muted">
          Posts novos chegam continuamente via relays. Atualize pra
          checar agora, ou volte pro topo pra reler o feed atual —
          manifesto §6 (verdade por eventos).
        </p>
        {/* Lily Tinder-audit 2026-05-21 (Item 3): mostra age do snapshot
            quando >10min. Resolve user feedback 2026-05-08 ("atualizar
            vs voltar ao topo são diferentes") tornando age visível. */}
        <FeedSnapshotAgeBadge />
        {/* DAOP Phase 2 PR3 (2026-05-20) — hint contextual ambient.
            HintChip auto-gates via capabilities (hasFirstPost &&
            !hasBackup) e some quando user faz backup OU dispensa. */}
        {(() => {
          const backupRule = getHintRule('backup-after-post')
          if (!backupRule) return null
          return (
            <HintChip
              rule={backupRule}
              label="⚠ faça backup do nsec"
              onActivate={() =>
                pushLayer({ id: 'identity', component: IdentityPanel })
              }
            />
          )
        })()}
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded bg-drift-accent px-4 py-2.5 font-mono text-[12px] font-bold uppercase tracking-meta text-drift-bg transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg"
          >
            {refreshing ? '⟳ verificando…' : '↻ atualizar feed'}
          </button>
          <button
            onClick={onJumpToTop}
            className="rounded border border-drift-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted transition-colors hover:border-drift-text hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          >
            ↑ voltar pro topo
          </button>
          <button
            onClick={onBack}
            className="font-mono text-[10px] uppercase tracking-meta text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          >
            ← voltar 1 post
          </button>
        </div>
        {/* Feedback inline pós-refresh — diferencia visualmente
            "atualizar" de "voltar pro topo" mesmo quando posts
            não mudou. h-4 fixo evita layout shift. */}
        <div
          className="h-4 font-mono text-[10px] tracking-meta text-drift-accent2"
          aria-live="polite"
        >
          {statusMsg ?? ''}
        </div>
      </div>
    </div>
  )
}

// ─── MapOverlay (V8) ─────────────────────────────────────────────────

/**
 * V8 — overlay fullscreen de propagação. Acionado pela NavBar [MAPA].
 *
 * Mockup v0.7 (.overlay #map-overlay): header "propagação" + FECHAR,
 * map svg fullscreen, legend bottom "• ATIVO • RECENTE", events count
 * em algum canto.
 *
 * Implementação: usa SpreadMap existente do post atualmente visível
 * (proxy de "global" — agregação real de eventos cross-post fica pra
 * track futura). Events count vem do syncStore (contador de eventos
 * recebidos via subscribe nos relays — manifesto §6).
 */
function MapOverlay({
  currentPost,
  onClose,
}: {
  currentPost?: Post | null
  onClose: () => void
}) {
  const events = useSyncStore((s) => s.eventsReceived)
  const [mapMode, setMapMode] = useState<SpreadMapMode>('post')

  const headerRight = (
    <div className="flex items-center gap-3">
      <span
        className="font-mono text-[10px] uppercase tracking-meta text-drift-muted"
        title="eventos recebidos pelo subscribe"
      >
        {events.toLocaleString('pt-BR')} ev
      </span>
      <button
        onClick={onClose}
        className="rounded border border-drift-border px-3 py-[5px] font-mono text-[10px] uppercase tracking-[2px] text-drift-muted transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
        aria-label="fechar mapa"
      >
        fechar
      </button>
    </div>
  )

  const postId = mapMode === 'post' ? (currentPost?.id ?? null) : null

  return (
    <FullPageCard
      onClose={onClose}
      title="propagação"
      headerRight={headerRight}
      ariaLabel="mapa de propagação"
    >
      <div className="relative h-full w-full">
        <LazyBoundary fallback={<DriftSkeleton variant="image" aspect="16/9" />}>
          <SpreadMap
            postId={postId}
            mode={mapMode}
            onModeChange={setMapMode}
            className="h-full w-full"
            onOpenLocationSettings={() => {
              popLayer({ id: 'map' })
              pushLayer({ id: 'location', component: LocationCard })
            }}
            {...(currentPost ? { currentPostId: currentPost.id } : {})}
          />
        </LazyBoundary>
      </div>
    </FullPageCard>
  )
}

// ─── SettingsRoot (V8) ───────────────────────────────────────────────

/**
 * V8 — menu consolidador de configurações. Acionado pelo CONFIG da
 * NavBar, substitui os 7 botões soltos do header legado:
 *   chave (IdentityPanel) · identidades (IdentitySwitcher) ·
 *   relays (RelaySettings) · listas (LocalListsSettings) ·
 *   settings (ContentSettings) · status (toggle DiagnosticPanel) ·
 *   limpar local (handleClearLocal — destrutivo, confirma 2x)
 *
 * Cada item é um botão s-row; click fecha o root e abre o overlay
 * específico via onSelect. Pattern alinhado ao mockup v0.7 (.s-row).
 *
 * Track futura V10: virar tabbed sub-overlays (Identidade / Rede /
 * Conteúdo / Localização / Sobre) com toggles inline (mockup .toggle).
 * V8 entrega o intermediário simples — lista de routing, sem inline
 * state, ainda valioso pra desempenado o header.
 */
type SettingsTarget =
  | 'chave'
  | 'identidades'
  | 'relays'
  | 'listas'
  | 'filtros'
  | 'location'
  | 'mapa'
  | 'rede'
  | 'peers'
  | 'blobs'
  | 'diagnostico'
  | 'status'
  | 'sobre'
  | 'permissoes'
  | 'aparencia'
  | 'sua-lente'
  | 'soberania'
  | 'menu-detalhado'
  | 'instalar'
  | 'limpar'

function SettingsRoot({ onClose }: { onClose: () => void }) {
  const installPromptLocal = useInstallPrompt()
  const identity = useBootStore((s) => s.identity)
  const [expanded, setExpanded] = useState<number | null>(0)
  function toggleSection(i: number) {
    setExpanded((prev) => (prev === i ? null : i))
  }

  function handleSettingsSelect(target: SettingsTarget) {
    const p = 'settings'
    switch (target) {
      case 'chave':
        if (!identity) return
        pushLayer({
          id: 'identity',
          component: IdentityPanel,
          parent: p,
          props: { identity },
        })
        break
      case 'identidades':
        pushLayer({
          id: 'switcher', component: IdentitySwitcher, parent: p,
          props: {
            onRequestExport: () => {
              if (!identity) return
              popLayer({ id: 'switcher' })
              pushLayer({
                id: 'identity',
                component: IdentityPanel,
                parent: p,
                props: { identity },
              })
            },
          },
        })
        break
      case 'relays':
        pushLayer({ id: 'relays', component: RelaySettings, parent: p })
        break
      case 'listas':
        pushLayer({ id: 'lists', component: LocalListsSettings, parent: p })
        break
      case 'filtros':
        pushLayer({ id: 'filters', component: FiltersCard, parent: p })
        break
      case 'location':
        pushLayer({ id: 'location', component: LocationCard, parent: p })
        break
      case 'mapa':
        pushLayer({ id: 'mapview', component: MapViewCard, parent: p })
        break
      case 'rede':
        pushLayer({ id: 'network', component: NetworkModeCard, parent: p })
        break
      case 'peers':
        pushLayer({ id: 'peers', component: PeersCard, parent: p })
        break
      case 'blobs':
        pushLayer({ id: 'blobs', component: BlobsCard, parent: p })
        break
      case 'permissoes':
        pushLayer({ id: 'permissions', component: PermissionsCard, parent: p })
        break
      case 'aparencia':
        pushLayer({ id: 'appearance', component: AppearanceCard, parent: p })
        break
      case 'sua-lente':
        pushLayer({ id: 'sua-lente', component: SuaLenteCard, parent: p })
        break
      case 'diagnostico':
        pushLayer({ id: 'diagnostic', component: DiagnosticCard, parent: p })
        break
      case 'soberania':
        pushLayer({ id: 'sovereignty', component: SovereigntyCard, parent: p })
        break
      case 'menu-detalhado':
        pushLayer({ id: 'menu-detail', component: MenuDetailCard, parent: p })
        break
      case 'status':
        pushLayer({ id: 'status', component: StatusCardLayer, parent: p })
        break
      case 'sobre':
        pushLayer({ id: 'about', component: AboutCardLayer, parent: p })
        break
      case 'instalar':
        installPromptLocal.setDismissed(false)
        pushLayer({ id: 'install', component: InstallModal, parent: p })
        break
      case 'limpar':
        void handleClearLocal()
        break
    }
  }

  // V9: agrupado por categoria visual (mockup s-row pattern). Identidade
  // primeiro pq é o caminho mais comum; Sistema (status/limpar) por
  // último porque diagnostic + destrutivo. Cada categoria tem header
  // muted small caps. Mantém UX previsível: idioma do label + hint
  // explicativo + chevron à direita.
  // V9.2c — cada seção da ContentSettings também aparece como entry
  // direto no menu inicial (não nested). Click → scroll-to-section
  // em ContentSettings (rota direta sem buscar na overlay grande).
  type SettingsGroup = {
    title: string
    groupIcon: (props: { size?: number; className?: string }) => ReactElement
    danger?: boolean
    items: {
      target: SettingsTarget
      label: string
      danger?: boolean
      hint: string
      icon: (props: { size?: number; className?: string }) => ReactElement
    }[]
  }

  const groups: SettingsGroup[] = [
    {
      title: 'identidade',
      groupIcon: KeyIcon,
      items: [
        {
          target: 'chave',
          label: 'chave',
          hint: 'backup/import nsec',
          icon: KeyIcon,
        },
        {
          target: 'identidades',
          label: 'identidades',
          hint: 'múltiplas identidades',
          icon: UsersIcon,
        },
      ],
    },
    {
      title: 'rede',
      groupIcon: ServerIcon,
      items: [
        {
          target: 'relays',
          label: 'relays',
          hint: 'gerenciar relays + NIP-65',
          icon: ServerIcon,
        },
        {
          target: 'rede',
          label: 'modo de rede',
          hint: 'clearnet / tor / onion-only',
          icon: GlobeIcon,
        },
        {
          target: 'peers',
          label: 'peers P2P',
          hint: 'QR, link direto, bundle offline',
          icon: LinkIcon,
        },
      ],
    },
    {
      title: 'conteúdo',
      groupIcon: SlidersIcon,
      items: [
        {
          target: 'sua-lente',
          label: 'sua lente',
          hint: 'reordenamento local — feed na sua perspectiva',
          icon: EyeIcon,
        },
        {
          target: 'filtros',
          label: 'filtros',
          hint: 'NSFW / spoilers / anúncios',
          icon: SlidersIcon,
        },
        {
          target: 'location',
          label: 'location',
          hint: 'granularidade nos meus posts',
          icon: PinIcon,
        },
        {
          target: 'mapa',
          label: 'mapa de spread',
          hint: 'enquadramento fechado / aberto',
          icon: MapIcon,
        },
        {
          target: 'listas',
          label: 'listas',
          hint: 'pinned, blocked, muted',
          icon: ListIcon,
        },
        {
          target: 'menu-detalhado',
          label: 'menu detalhado',
          hint: 'detalhes, manifesto, como funciona, algoritmo',
          icon: SlidersIcon,
        },
      ],
    },
    {
      title: 'sistema',
      groupIcon: ShieldIcon,
      items: [
        {
          target: 'permissoes',
          label: 'permissões',
          hint: 'GPS / câmera / áudio',
          icon: ShieldIcon,
        },
        {
          target: 'aparencia',
          label: 'aparência',
          hint: 'tema visual — cinder / rosenholz / velatura',
          icon: PaletteIcon,
        },
        {
          target: 'status',
          label: 'status',
          hint: 'diagnóstico em tempo real',
          icon: ActivityIcon,
        },
        {
          target: 'blobs',
          label: 'blobs (ipfs)',
          hint: 'servindo blobs a peers',
          icon: BoxIcon,
        },
        {
          target: 'soberania',
          label: 'soberania',
          hint: 'endpoints próprios — upload, mapa, moderação',
          icon: ServerIcon,
        },
        {
          target: 'diagnostico',
          label: 'redefinir cache',
          hint: 'reconstrói banco local',
          icon: RefreshIcon,
        },
        {
          target: 'sobre',
          label: `versão ${CLIENT_VERSION}`,
          hint: 'manifesto + licença',
          icon: InfoIcon,
        },
        ...(installPromptLocal.available
          ? [
              {
                target: 'instalar' as SettingsTarget,
                label: 'instalar app',
                hint: 'PWA na tela inicial',
                icon: DownloadIcon,
              },
            ]
          : []),
      ],
    },
    {
      title: 'limpar local',
      groupIcon: TrashIcon,
      danger: true,
      items: [
        {
          target: 'limpar',
          label: 'apagar dados locais',
          danger: true,
          hint: 'remove banco SQLite — identidade preservada',
          icon: TrashIcon,
        },
      ],
    },
  ]

  // Phase 6 (2026-05-19 user pivot): toggle binário removido. User
  // controla DENSIDADE DE INFO via 4 flags granulares em 'menu
  // detalhado' (CONTEÚDO group). Menu items TODOS visíveis sempre.
  return (
    <FullPageCard
      onClose={onClose}
      title="configurações"
      ariaLabel="configurações"
    >
      <div className="space-y-3 px-4 py-5">
        {groups.map((group, gi) => {
          const isOpen = expanded === gi
          const GroupIcon = group.groupIcon
          return (
            <section key={group.title} aria-labelledby={`settings-group-${gi}`}>
              <button
                id={`settings-group-${gi}`}
                onClick={() => toggleSection(gi)}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-colors ${
                  group.danger
                    ? 'border-drift-danger/20 bg-drift-danger/5'
                    : 'border-drift-border/40 bg-drift-surface/50'
                }`}
              >
                <span className={`shrink-0 ${group.danger ? 'text-drift-danger' : 'text-drift-accent'}`}>
                  <GroupIcon size={18} />
                </span>
                <span
                  className={`flex-1 font-display text-[14px] font-bold uppercase tracking-tag ${
                    group.danger ? 'text-drift-danger' : 'text-drift-accent'
                  }`}
                >
                  {group.title}
                </span>
                <span
                  className={`shrink-0 transition-transform duration-motion-emphasis ease-drift-inout ${isOpen ? 'rotate-180' : ''} ${
                    group.danger ? 'text-drift-danger/40' : 'text-drift-muted/40'
                  }`}
                >
                  <ChevronDownIcon size={16} />
                </span>
              </button>

              <Collapse open={isOpen}>
                <div className="mt-1.5 space-y-1.5 pl-3">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.target}
                        onClick={() => handleSettingsSelect(item.target)}
                        tabIndex={isOpen ? 0 : -1}
                        className={`group flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                          item.danger
                            ? 'border-drift-danger/15 bg-drift-danger/5 hover:border-drift-danger/30'
                            : 'border-drift-border/30 bg-drift-surface/30 hover:border-drift-accent2/25'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`shrink-0 ${item.danger ? 'text-drift-danger/60' : 'text-drift-accent2/70'}`}
                        >
                          <Icon size={16} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={`font-mono text-[13px] ${
                              item.danger ? 'text-drift-danger' : 'text-drift-text'
                            }`}
                          >
                            {item.label}
                          </span>
                          <span
                            className={`truncate font-mono text-[10px] ${
                              item.danger ? 'text-drift-danger/30' : 'text-drift-muted/40'
                            }`}
                          >
                            {item.hint}
                          </span>
                        </div>
                        <span
                          aria-hidden="true"
                          className={`shrink-0 text-[14px] ${
                            item.danger ? 'text-drift-danger/25' : 'text-drift-muted/20'
                          }`}
                        >
                          ›
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Collapse>
            </section>
          )
        })}

        <p className="px-2 pt-2 font-mono text-[10px] leading-relaxed text-drift-muted/60">
          algumas alterações podem exigir reinicialização do app.
        </p>
      </div>
    </FullPageCard>
  )
}

// ─── Install Banner ──────────────────────────────────────────────────

function InstallModal({ onClose }: { onClose: () => void }) {
  const ip = useInstallPrompt()
  const kind = ip.kind === 'unavailable' ? 'ios-safari' : ip.kind
  const [showIosHelp, setShowIosHelp] = useState(kind === 'ios-safari')

  return (
    <SlideUpOverlay onClose={onClose} maxWidth="sm" ariaLabel="instalar Drift">
      <ModalHeader
        title="instalar Drift"
        subtitle={
          kind === 'ios-safari'
            ? 'Safari iOS não tem botão de instalar — segue o passo a passo abaixo.'
            : 'PWA — instala sem app store. Manifesto §1 (existência autônoma).'
        }
        onClose={onClose}
      />

      {kind === 'ios-safari' ? (
        <>
          {showIosHelp && (
            <ol className="mb-4 list-decimal space-y-2 pl-5 text-[12px] text-drift-text">
              <li>
                Toque no botão <strong>Compartilhar</strong> (quadrado com
                seta) na barra do Safari
              </li>
              <li>
                Role e toque em{' '}
                <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>
              </li>
              <li>Confirme em &ldquo;Adicionar&rdquo;</li>
              <li>
                Drift aparece na tela inicial — abre fullscreen, sem barra
                do Safari
              </li>
            </ol>
          )}
          {!showIosHelp && (
            <DriftButton
              variant="ghost"
              size="lg"
              onClick={() => setShowIosHelp(true)}
              className="mb-3 w-full"
            >
              como instalar
            </DriftButton>
          )}
        </>
      ) : (
        <DriftButton
          variant="primary"
          size="lg"
          onClick={async () => {
            await ip.install()
            onClose()
          }}
          className="mb-3 inline-flex w-full items-center justify-center gap-2"
        >
          <DownloadIcon size={16} />
          instalar agora
        </DriftButton>
      )}

      <DriftButton
        variant="cancel"
        size="md"
        onClick={() => {
          ip.setDismissed(true)
          onClose()
        }}
        className="w-full"
      >
        não mostrar de novo
      </DriftButton>
    </SlideUpOverlay>
  )
}

// ─── Bootstrap view ─────────────────────────────────────────────────

function BootView({ state }: { state: BootState }) {
  // User feedback 2026-05-09: bootstrap errors precisam de recovery
  // actions inline. Cada Check ganha botão discreto na própria etapa
  // que falhou — usuário comum encontra mitigação no contexto.
  const reloadPage = () => window.location.reload()

  /**
   * Force-update path: bootstrap interrompido frequentemente é causado
   * por **service worker stale** — o SW serve `index.html` em cache que
   * referencia um chunk JS antigo (e.g. `passkey-B2ccoolv.js`) que sumiu
   * após deploy novo no Vercel. Reload simples só re-instala o mesmo
   * HTML cacheado, loop infinito.
   *
   * Solução: desregistrar TODOS os SWs + apagar todos os Cache Storage
   * antes do reload. Próximo load pega o `index.html` fresh do server
   * com os hashes atuais.
   *
   * Best-effort: cada operação falha silenciosamente; pior caso o user
   * cai no reload normal sem cleanup (= comportamento atual quebrado,
   * mas pelo menos não trava).
   */
  const forceUpdateAndReload = async () => {
    try {
      // 1. Unregister TODOS os service workers no scope atual.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
      }
    } catch {
      /* SW unregister best-effort */
    }
    try {
      // 2. Apaga TODOS os Cache Storage (Workbox precaches, runtime caches).
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))
      }
    } catch {
      /* Cache delete best-effort */
    }
    // 3. Reload com query bust pra forçar bypass de qualquer HTTP cache
    //    intermediário que ainda esteja servindo HTML stale.
    const url = new URL(window.location.href)
    url.searchParams.set('_drift_force_reload', String(Date.now()))
    window.location.replace(url.toString())
  }

  const clearLocalAndReload = async () => {
    try {
      // Limpa OPFS storage (sqlite-wasm) + IndexedDB (master key) +
      // localStorage. Identity é recriada no próximo boot — backup
      // export antes é responsabilidade do user (warning no UI).
      const ok = await dialog.confirm(
        'isso vai apagar todos os dados locais (cache de posts, feed, configurações). identidade nsec será regenerada — exporta antes se quiser preservar. continuar?',
        { title: 'limpar local + recarregar', dangerous: true, okLabel: 'limpar' },
      )
      if (!ok) return
      try {
        // OPFS root.remove() — não-tipado em todos os browsers; cast pra
        // any pra contornar lib.dom.d.ts incompleta. Best-effort.
        const root = await navigator.storage?.getDirectory?.()
        if (root) {
          // Itera entries e apaga tudo (mais portável que root.remove inexistente).
          // @ts-expect-error: FileSystemDirectoryHandle async iteration é nova
          for await (const [name] of root.entries()) {
            try {
              await root.removeEntry(name, { recursive: true })
            } catch {
              /* ignore individual entry failures */
            }
          }
        }
      } catch {
        /* OPFS clean best-effort */
      }
      try {
        const dbs = await indexedDB.databases?.()
        for (const d of dbs ?? []) if (d.name) indexedDB.deleteDatabase(d.name)
      } catch {
        /* IDB clean best-effort */
      }
      try {
        localStorage.clear()
      } catch {
        /* localStorage clean best-effort */
      }
      // Crítico: clearLocal sem unregister SW + clear caches deixa o
      // SW servindo `index.html` cacheado → loop bootstrap error.
      // forceUpdateAndReload já faz reload (com query bust), não chama
      // window.location.reload() depois.
      await forceUpdateAndReload()
    } catch (err) {
      console.error('clearLocalAndReload falhou:', err)
      await forceUpdateAndReload()
    }
  }

  return (
    <main className="min-h-full p-6 font-mono text-sm sm:p-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10">
          <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[-0.5px] text-drift-text">
            dri<em className="not-italic text-drift-accent">ft</em>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-widest text-drift-muted">
            Bootstrap · {state.step}
          </p>
        </header>

        <Check
          label="cross-origin isolation"
          state={state.isolated === null ? 'pending' : state.isolated ? 'ok' : 'fail'}
          detail={
            state.isolated === null
              ? 'verificando…'
              : state.isolated
              ? 'COOP/COEP ativos · OPFS disponível'
              : 'COOP/COEP inativos · recarregue a página ou tente em outro navegador'
          }
          action={
            state.isolated === false
              ? {
                  label: '↻ recarregar',
                  onClick: reloadPage,
                  title: 'recarrega a página — COOP/COEP costumam vir em segundo load',
                }
              : undefined
          }
        />
        <Check
          label="sqlite wasm"
          state={
            state.storage === null
              ? state.step === 'db'
                ? 'pending'
                : 'idle'
              : state.storage === 'memory'
              ? 'partial'
              : 'ok'
          }
          detail={
            state.storage === null
              ? state.step === 'db'
                ? 'inicializando worker…'
                : 'aguardando'
              : state.storage === 'opfs'
              ? 'storage: OPFS (persistente)'
              : state.storage === 'kvvfs'
              ? 'storage: localStorage (~5MB · Safari < 17 ou contexto sem OPFS)'
              : 'storage: memória — banco NÃO persiste após reload'
          }
          action={
            state.storage === 'memory'
              ? {
                  label: '↻ recarregar',
                  onClick: reloadPage,
                  title: 'tenta abrir OPFS de novo — modo memória é fallback temporário',
                }
              : undefined
          }
        />
        <Check
          label="identidade nostr"
          state={state.identity ? 'ok' : state.step === 'identity' ? 'pending' : 'idle'}
          detail={
            state.identity
              ? `${state.identity.npubBech32}\ncriada: ${new Date(state.identity.createdAt).toLocaleString()}`
              : state.step === 'identity'
              ? 'gerando ou carregando…'
              : 'aguardando'
          }
        />
        <Check
          label="sync nostr → sqlite"
          state={
            ['relays', 'ready'].includes(state.step)
              ? 'ok'
              : state.step === 'sync'
              ? 'pending'
              : 'idle'
          }
          detail={
            ['relays', 'ready'].includes(state.step)
              ? 'subscribe ativo'
              : state.step === 'sync'
              ? 'iniciando…'
              : 'aguardando'
          }
        />
        <Check
          label="relays nostr"
          state={
            state.relays
              ? state.relays.every((r) => r.ok)
                ? 'ok'
                : state.relays.some((r) => r.ok)
                ? 'partial'
                : 'fail'
              : state.step === 'relays'
              ? 'pending'
              : 'idle'
          }
          detail={
            state.relays
              ? state.relays
                  .map(
                    (r) =>
                      `${r.ok ? '✓' : '✗'} ${r.url}${
                        r.latencyMs !== null ? `  ${r.latencyMs}ms` : ''
                      }`,
                  )
                  .join('\n')
              : state.step === 'relays'
              ? 'verificando…'
              : 'aguardando'
          }
          action={
            state.relays && !state.relays.every((r) => r.ok)
              ? {
                  label: '↻ tentar de novo',
                  onClick: reloadPage,
                  title: 'recarrega — relays podem estar passageiramente offline',
                }
              : undefined
          }
        />

        {state.step === 'error' && state.error && (
          <div className="mt-6 rounded-lg border border-drift-bury/60 bg-drift-bury/10 p-5 text-drift-bury">
            <div className="mb-1 text-[12px] font-bold uppercase tracking-widest">
              erro · bootstrap interrompido
            </div>
            <p className="mb-3 text-[12px] text-drift-muted">
              Erro na etapa{' '}
              <span className="font-bold text-drift-bury">
                {
                  ({
                    idle: '0/5 · inicialização',
                    isolation: '1/5 · cross-origin isolation',
                    db: '2/5 · sqlite wasm',
                    identity: '3/5 · identidade nostr',
                    sync: '4/5 · sync nostr',
                    relays: '5/5 · relays nostr',
                    ready: '—',
                    error: '—',
                  } as Record<string, string>)[state.error === 'MULTI_TAB_CONFLICT' ? 'db' : (
                    // Infer failed step: last step before error. The error string
                    // itself doesn't encode the step, but we can approximate from
                    // the check states visible above.
                    state.isolated === false ? 'isolation'
                    : state.storage === null ? 'db'
                    : !state.identity ? 'identity'
                    : !state.relays ? 'sync'
                    : 'relays'
                  )]
                }
              </span>
            </p>
            <pre className="mb-4 whitespace-pre-wrap break-words rounded border border-drift-border bg-drift-bg/60 p-3 text-[12px] text-drift-muted">
              {state.error}
            </pre>

            {/* Primary CTA: limpar local — most likely to fix persistent errors */}
            <div className="mb-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => void clearLocalAndReload()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-drift-bury bg-drift-bury/15 px-4 py-3 font-mono text-[13px] font-bold uppercase tracking-[2px] text-drift-bury transition-colors hover:bg-drift-bury/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-bury"
                title="apaga OPFS + IndexedDB + localStorage e recarrega — destrói dados locais"
              >
                <span className="text-base">🗑️</span>
                limpar local + recarregar
              </button>
              <p className="text-center text-[12px] leading-relaxed text-drift-muted">
                Remove o cache local (posts, feed, configurações).
                <br />
                Sua identidade sera preservada se ja foi exportada.
              </p>
            </div>

            {/* Secondary CTA: força atualização (SW unregister + caches
                clear + reload). Em estado de erro, reload simples
                geralmente não resolve — SW continua servindo HTML stale
                que referencia chunks JS antigos (deploy novo Vercel
                quebrou cache). forceUpdateAndReload mata o SW + caches
                antes do reload. */}
            <div className="flex flex-col items-center gap-2 border-t border-drift-border pt-4">
              <button
                type="button"
                onClick={() => void forceUpdateAndReload()}
                className="rounded border border-drift-accent/60 bg-drift-bg/40 px-4 py-2 font-mono text-[12px] uppercase tracking-[2px] text-drift-accent transition-colors hover:border-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
                title="desregistra service worker + limpa caches + recarrega — resolve deploy stale"
              >
                ↻ forçar atualização
              </button>
              <p className="text-[12px] text-drift-muted">
                Desregistra service worker + limpa caches.
                <br />
                Útil quando deploy novo quebrou o cache antigo.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

// ─── Diagnostic panel ───────────────────────────────────────────────

function DiagnosticPanel({ boot }: { boot: BootState }) {
  const sync = useSyncStore()
  const [resyncing, setResyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const npub = boot.identity?.npub ?? null
  const historyRebuilding = npub ? sync.rebuildsInProgress.includes(npub) : false

  async function handleResync() {
    if (resyncing) return
    setResyncing(true)
    try {
      await restartSync()
    } finally {
      setResyncing(false)
    }
  }

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshFeed()
    } finally {
      setRefreshing(false)
    }
  }

  // V9.10b (user pergunta 2026-05-09 sobre cliente 0.2-0.4): startSync
  // só pede últimos 7 dias; este botão chama rebuildIdentityHistory que
  // busca SEM cap temporal (authors=[npub]). Histórico do user own.
  async function handleFetchHistory() {
    if (!npub || historyRebuilding) return
    try {
      await rebuildIdentityHistory(npub)
    } catch (err) {
      console.error('[diag] rebuildIdentityHistory failed:', err)
    }
  }

  // V14.1 — restruturado pra match do padrão visual de outros submenus
  // (BlobsCard, FiltersCard): paragrafo descritivo + bloco bordered de
  // pares label/value com contraste WCAG AA, botões consistent.
  // Antes: tudo `text-drift-muted` (#4a4a46) sobre `bg-drift-surface`
  // (#15151a) — contraste 2:1, ilegível.
  const storageLabel =
    boot.storage === 'opfs'
      ? 'OPFS'
      : boot.storage === 'kvvfs'
      ? 'localStorage'
      : boot.storage === 'memory'
      ? 'memória (não persiste)'
      : '?'
  const relaysOk = boot.relays?.filter((r) => r.ok).length ?? '?'
  const relaysTotal = boot.relays?.length ?? '?'
  return (
    <div className="space-y-3">
      <p className="px-1 font-mono text-[10px] text-drift-muted/60">
        estado em tempo real. use os botões se UI parecer stale.
      </p>

      <div className="space-y-2.5 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3.5 font-mono text-[12px]">
        <Row label="storage" value={storageLabel} />
        <Row
          label="sync"
          value={`${sync.active ? '● ativo' : '○ inativo'} · cursor ${sync.cursor}`}
          valueClass={sync.active ? 'text-drift-spread' : 'text-drift-muted'}
        />
        <Row label="eventos recebidos" value={String(sync.eventsReceived)} />
        <Row label="relays ok" value={`${relaysOk}/${relaysTotal}`} />
        {sync.rebuildsInProgress.length > 0 && (
          <Row
            label="rebuild em andamento"
            value={String(sync.rebuildsInProgress.length)}
            valueClass="text-drift-warning"
          />
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 font-mono text-[11px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          title="re-query SQLite e atualiza o feed local"
        >
          {refreshing ? '…' : '↻ feed'}
        </button>
        <button
          onClick={handleResync}
          disabled={resyncing}
          className="flex-1 rounded-xl border border-drift-border/30 bg-drift-surface/30 px-3 py-2.5 font-mono text-[11px] uppercase tracking-meta text-drift-muted/70 transition-colors hover:border-drift-accent2/30 hover:text-drift-accent2 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          title="re-subscrever em todos os relays do zero"
        >
          {resyncing ? '…' : '↻ re-subscribe'}
        </button>
      </div>

      <button
        onClick={handleFetchHistory}
        disabled={historyRebuilding || !npub}
        className="w-full rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
        title="busca TODOS os eventos do meu nsec nos relays (sem janela de 7d)"
      >
        {historyRebuilding ? 'buscando histórico…' : '↻ buscar histórico completo'}
      </button>

      {sync.recent.length > 0 && (
        <details className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-meta text-drift-muted/70 hover:text-drift-text">
            últimos eventos ({sync.recent.length})
          </summary>
          <div className="mt-3 max-h-48 overflow-y-auto font-mono text-[10px]">
            {sync.recent.map((e, i) => (
              <div key={`${e.id}-${i}`} className="flex gap-2 py-0.5">
                <span className="text-drift-muted/40">
                  {new Date(e.receivedAt).toLocaleTimeString()}
                </span>
                <span className={kindColor(e.kind)}>{kindLabel(e.kind)}</span>
                <span className="text-drift-muted/60">{e.id.slice(0, 8)}</span>
                {e.ref && (
                  <span className="truncate text-drift-muted/40">
                    → {e.ref.slice(0, 12)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="rounded-xl border border-drift-border/30 bg-drift-surface/30 px-4 py-3">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
          minha npub
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-drift-text/80">
          {boot.identity?.npubBech32}
        </pre>
      </div>
    </div>
  )
}

/**
 * Linha label/value reusável dentro de cards de status (DiagnosticPanel,
 * BlobsCard, etc.). Padrão visual: label em DM Mono uppercase tracking
 * wide muted, valor à direita em cor de destaque.
 */
function Row({
  label,
  value,
  valueClass = 'text-drift-text',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-meta text-drift-muted">
        {label}
      </span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

function kindLabel(kind: number): string {
  switch (kind) {
    case 9078: return 'POST'
    case 9079: return 'SPRD'
    case 9080: return 'BURY'
    case 9081: return 'RPRT'
    default: return `K${kind}`
  }
}

function kindColor(kind: number): string {
  switch (kind) {
    case 9078: return 'text-drift-accent'
    case 9079: return 'text-drift-spread'
    case 9080: return 'text-drift-bury'
    case 9081: return 'text-yellow-400'
    default: return 'text-drift-muted'
  }
}

// ─── Helpers de UI ──────────────────────────────────────────────────

type CheckState = 'idle' | 'pending' | 'ok' | 'fail' | 'partial'

function Check({
  label,
  state,
  detail,
  action,
}: {
  label: string
  state: CheckState
  detail: string
  /**
   * User feedback 2026-05-09: "em casos de erro do bootstrap, devemos
   * apresentar botões de ações para mitigar o erro e retomar". Cada
   * Check renderiza botão discreto na própria etapa quando state=fail
   * ou partial — user encontra mitigação no contexto, não precisa
   * navegar até DiagnosticPanel.
   */
  action?: {
    label: string
    onClick: () => void
    title?: string
  }
}) {
  const dot =
    state === 'pending' ? '◌' : state === 'ok' ? '✓' : state === 'partial' ? '◐' : state === 'fail' ? '✗' : '·'
  const color =
    state === 'pending'
      ? 'text-yellow-400'
      : state === 'ok'
      ? 'text-drift-spread'
      : state === 'partial'
      ? 'text-yellow-400'
      : state === 'fail'
      ? 'text-drift-bury'
      : 'text-drift-muted'
  return (
    <div className="mb-3 rounded border border-drift-border bg-drift-surface p-4">
      <div className="mb-2 flex items-center gap-3">
        <span className={`text-base ${color}`}>{dot}</span>
        <span className="text-[12px] uppercase tracking-[0.2em] text-drift-muted">{label}</span>
      </div>
      <pre className="ml-6 whitespace-pre-wrap break-all text-xs text-drift-muted">{detail}</pre>
      {action && (state === 'fail' || state === 'partial') && (
        <div className="ml-6 mt-3">
          <button
            type="button"
            onClick={action.onClick}
            title={action.title}
            className="rounded border border-drift-accent/60 bg-drift-bg/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[2px] text-drift-accent transition-colors hover:border-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

// `timeAgo` removido em V_pre0 — vive em components/Feed/PostCard.tsx.
// Outros consumidores (PostViewer, LocalListsSettings) têm cópias
// próprias com signatures diferentes (segundos vs ms). Consolidação
// em util compartilhado é trabalho separado (Lily débito).

export default App
