import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { OPTIMISTIC_TIMEOUT_MS, CLIENT_VERSION } from './config/constants'
import { db } from './lib/db'
import {
  getCurrentLocation,
  getLastFailureReason,
  warmUpGpsLocation,
  type GeolocationFailureReason,
} from './lib/geolocation'
import { restartSync, useSyncStore } from './lib/sync'
import { createPost, spreadPost, buryPost } from './lib/protocol'
import { getMyAction, markFeedSeen, refreshFeed, useFeedStore } from './lib/feed'
import { FeedTabs, type FeedTab } from './components/Feed/FeedTabs'
import {
  startBoot,
  useBootStore,
  type BootState,
} from './lib/bootstrap'
import { getPrefs, usePrefsStore } from './lib/prefs'
import { useUserWeight } from './hooks/useUserWeight'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { IdentityPanel } from './components/Identity/IdentityPanel'
import { IdentitySwitcher } from './components/Identity/IdentitySwitcher'
import { PostViewer } from './components/Post/PostViewer'
import { ComposeOverlay } from './components/Create/ComposeOverlay'
import {
  FiltersCard,
  LocationCard,
  MapViewCard,
  NetworkModeCard,
  BlobsCard,
  DiagnosticCard,
} from './components/Settings/SettingsCards'
import { RelaySettings } from './components/Settings/RelaySettings'
import { LocalListsSettings } from './components/Settings/LocalListsSettings'
import { OnboardingOverlay } from './components/Onboarding/OnboardingOverlay'
import { ProfileModal } from './components/Profile/ProfileModal'
import { GpsErrorBanner } from './components/UI/GpsErrorBanner'
import { MultiTabModal } from './components/UI/MultiTabModal'
import { UpdatePrompt } from './components/UI/UpdatePrompt'
import { DialogHost } from './components/UI/DialogHost'
import { dialog } from './lib/dialog'
import { NavBar } from './components/UI/NavBar'
import { FullPageOverlay } from './components/UI/FullPageOverlay'
import {
  MapIcon,
  SlidersIcon,
  UserIcon,
  WarningIcon,
} from './components/UI/Icons'
import { SpreadMap } from './components/Feed/SpreadMap'
import type {
  DriftIdentity,
  LocationGranularity,
  Post,
  Subpost,
  ContentWarning,
} from './types/drift'

function App() {
  const boot = useBootStore()
  const posts = useFeedStore((s) => s.posts)
  const feedLoaded = useFeedStore((s) => s.loaded)
  const userWeight = useUserWeight(boot.identity?.npub ?? null)
  const installPrompt = useInstallPrompt()

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
  // V9.2e/V10a: showDiagnostic state legacy removido — substituído
  // por showStatusCard (card próprio acionado via SettingsRoot ou
  // status indicator do HomeHeader).
  const [showIdentity, setShowIdentity] = useState(false)
  const [showRelays, setShowRelays] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showLists, setShowLists] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  // V7 structural: SubpostEditor migrou de always-mounted no top do feed
  // pra modal acionado pelo botão `+` central da NavBar (mockup v0.7).
  // Default false; PWA shortcut `?action=compose` abre direto.
  const [showCreate, setShowCreate] = useState(false)
  // V8: mapa global de propagação (acionado pelo MAPA da NavBar).
  // Overlay fullscreen separado — agrega eventos de todos os posts.
  const [showMap, setShowMap] = useState(false)
  // V8: SettingsRoot menu consolidador (acionado pelo CONFIG da NavBar).
  // V9.2c: 11 opções organizadas em 4 grupos.
  // V9.2d: cada opção abre seu próprio card focado (em vez de routar
  // pra ContentSettings overlay grande). 5 cards novos (Filters/
  // Location/MapView/NetworkMode/Diagnostic) substituem o "settings"
  // monolítico — UX mais limpa, menos overflow.
  const [showSettingsRoot, setShowSettingsRoot] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showLocation, setShowLocation] = useState(false)
  const [showMapView, setShowMapView] = useState(false)
  const [showNetworkMode, setShowNetworkMode] = useState(false)
  const [showBlobsCard, setShowBlobsCard] = useState(false)
  const [showDiagnosticCard, setShowDiagnosticCard] = useState(false)
  // V9.2e: status agora é card próprio (não mais toggle inline no home).
  const [showStatusCard, setShowStatusCard] = useState(false)
  // V9.2e: sobre = versão do cliente + manifesto link.
  const [showAboutCard, setShowAboutCard] = useState(false)

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
    if (!onboardingDone) setShowOnboarding(true)
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
    const params = new URLSearchParams(window.location.search)
    const action = params.get('action')
    if (action === 'compose') {
      // V7: SubpostEditor agora é modal (não always-mounted). Abre direto
      // — focus do textarea acontece via autoFocus no SubpostBlock primeiro.
      setShowCreate(true)
    } else if (action === 'settings') {
      setShowSettingsRoot(true)
    }
    if (action) {
      const url = new URL(window.location.href)
      url.searchParams.delete('action')
      window.history.replaceState({}, '', url.toString())
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

  // V8 home stack — currentIdx + currentPost + nextHomePost.
  // Default 0 (post mais recente). Ao chegar no fim da fila, mantém
  // último post e swipe ↑/↓ vira no-op de avanço (mas spread/sink
  // continuam funcionando). useMemo evita findIndex desnecessário.
  const [exitDir, setExitDir] = useState<'up' | 'down'>('up')
  // Subscreve `tab` pra que cada tab tenha sua sequência independente —
  // user feedback 2026-05-08: "Global/Seguindo/Trending cada um deveria
  // ter sua própria sequência". `idxByTab` persiste posição por tab;
  // trocar e voltar mantém onde parou. Manifesto §24 — feeds são views
  // distintas, navegação é local de cada view.
  const feedTab = useFeedStore((s) => s.tab)
  const [idxByTab, setIdxByTab] = useState<Record<FeedTab, number>>({
    global: 0,
    following: 0,
    trending: 0,
  })
  const currentIdx = idxByTab[feedTab]
  const setCurrentIdx = useCallback(
    (updater: number | ((i: number) => number)) => {
      setIdxByTab((prev) => {
        const cur = prev[feedTab]
        const next = typeof updater === 'function' ? updater(cur) : updater
        return { ...prev, [feedTab]: next }
      })
    },
    [feedTab],
  )
  // Range válido pra navegação: [0..posts.length]. posts.length é o
  // sentinel "fim do feed" — renderiza EndOfFeed em vez de PostViewer.
  // User feedback 2026-05-08: card "trava" no último post sem feedback;
  // permitir avançar pra fim explícito comunica "fim, recarregue".
  const atEnd = posts.length > 0 && currentIdx >= posts.length
  const { currentPost, nextHomePost } = useMemo(() => {
    if (posts.length === 0 || atEnd) return { currentPost: null, nextHomePost: null }
    const safeIdx = Math.max(0, Math.min(currentIdx, posts.length - 1))
    return {
      currentPost: posts[safeIdx]!,
      nextHomePost: safeIdx + 1 < posts.length ? posts[safeIdx + 1]! : null,
    }
  }, [currentIdx, posts, atEnd])
  // Clamp do idx do tab ATUAL se posts mudou (moderação, refresh) e
  // posição fica out-of-bounds. Não toca outros tabs.
  //
  // CRÍTICO: só dispara quando feedLoaded === true. Durante transição
  // de tab (setFeedTab → store loaded=false → refreshFeed async →
  // store loaded=true), posts contém RESIDUAL da tab anterior. Se
  // user volta pra Global no idx=5 mas posts ainda é [] do Seguindo
  // vazio, sem este guard o clamp pisotearia idxByTab.global = 0.
  // User feedback 2026-05-08: "ir pra tab vazia força outras tabs ao
  // topo".
  useEffect(() => {
    if (!feedLoaded) return
    if (currentIdx > posts.length) {
      setCurrentIdx(Math.max(0, posts.length))
    }
  }, [posts.length, currentIdx, setCurrentIdx, feedLoaded])

  // V8: openViewer + advanceViewer (modal viewer queue) deletados —
  // home view embedded substituiu o paradigma. viewerPostId/viewerExitDir
  // ainda existem mas não são setados em lugar nenhum (sempre null/'up'),
  // mantidos pra evitar break em código downstream que ainda referencia
  // (nenhum em V8). Track futura limpa o resíduo.

  /**
   * V8 home stack advance. Avança currentIdx pra próximo post.
   * Última posição válida = `posts.length` (sentinel "fim do feed",
   * renderiza EndOfFeed em vez de travar no último post). User
   * feedback 2026-05-08: travar gera ambiguidade ("acabou? travou?").
   */
  function advanceHome(dir: 'up' | 'down') {
    setExitDir(dir)
    setCurrentIdx((i) => Math.min(i + 1, posts.length))
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
    // ficando absurdo. NavBar e FullPageOverlay têm seus próprios
    // max-w-md mx-auto pra ficarem alinhados com o app centrado.
    // User feedback 2026-05-08.
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col border-drift-border font-mono text-sm sm:border-x">
      <HomeHeader
        identity={boot.identity}
        userWeight={userWeight}
        currentScore={currentPost?.score ?? null}
        locationGranularity={locationGranularity}
        onOpenLocation={() => setShowLocation(true)}
        onOpenNetworkMode={() => setShowNetworkMode(true)}
        onOpenStatus={() => setShowStatusCard(true)}
        onOpenIdentity={() => setShowIdentity(true)}
        onOpenProfile={() => setShowProfile(true)}
        onActiveTabTap={() => setCurrentIdx(0)}
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
          )
        })()}

        {/* V9.2e: DiagnosticPanel não renderiza mais inline aqui —
            agora é card próprio (StatusCard) acionado via SettingsRoot. */}

        {installPrompt.available && (
          <InstallBanner
            kind={installPrompt.kind}
            onInstall={async () => {
              await installPrompt.install()
            }}
            onDismiss={() => installPrompt.setDismissed(true)}
          />
        )}
      </div>

      <UpdatePrompt />
      <DialogHost />

      {/* Stack — área central que contém o card atual. flex:1 expande
          até a navbar bottom. Card visual = PostViewer embedded.
          2 shadow cards atrás visíveis quando há nextHomePost. */}
      {/* Stack — área central que contém o card atual. flex:1 expande
          até a navbar bottom. NavBar é fixed (z-30, h-68px no primitive
          + padding); aplicamos pb-[88px] aqui (68 navbar + 20 folga)
          pra evitar cards renderizarem POR TRÁS da navbar fixed.
          Hidden navbar não importa — pb-[88px] preserva consistência. */}
      <main className="relative min-h-0 flex-1 overflow-hidden px-4 pt-3 pb-[88px]">
        {posts.length === 0 ? (
          <HomeEmpty tab={useFeedStore.getState().tab} />
        ) : atEnd ? (
          <EndOfFeed
            tab={feedTab}
            onBack={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            onJumpToTop={() => setCurrentIdx(0)}
          />
        ) : currentPost ? (
          <>
            {/* Shadow cards atrás (mockup .card-shadow). */}
            {nextHomePost && (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-4 top-3 bottom-2 rounded border border-drift-border bg-drift-surface"
                  style={{ transform: 'translateY(14px) scale(0.92)', opacity: 0.18 }}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-4 top-3 bottom-2 rounded border border-drift-border bg-drift-surface"
                  style={{ transform: 'translateY(7px) scale(0.96)', opacity: 0.4 }}
                />
              </>
            )}
            <div className="relative h-full w-full overflow-hidden rounded border border-drift-border bg-drift-surface">
              <AnimatePresence mode="wait" custom={exitDir}>
                <PostViewer
                  key={currentPost.id}
                  embedded
                  custom={exitDir}
                  post={currentPost}
                  isMine={currentPost.authorPub === boot.identity?.npub}
                  pendingAction={pending[currentPost.id] ?? null}
                  myAction={myActions[currentPost.id] ?? null}
                  capturingLocation={gpsCapturing.has(currentPost.id)}
                  queue={{
                    index: currentIdx,
                    total: posts.length,
                    next: nextHomePost,
                  }}
                  onOpenLocationSettings={() => {
                    setShowLocation(true)
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
                    /* embedded — no-op */
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
          <ComposeOverlay
            publishing={publishing}
            capturingLocation={gpsCapturing.has('__publish__')}
            maxSubposts={userWeight.maxSubposts}
            onClose={() => setShowCreate(false)}
            onPublish={handlePublish}
          />
        )}
      </AnimatePresence>

      {/* V8 — NavBar fixed bottom com plus central (mockup v0.7).
          3 slots: [MAPA, +(compose), CONFIG]. Mapa abre overlay
          fullscreen mostrando propagação dos posts (eventos rede); +
          abre compose page; CONFIG abre Settings tabbed (sub-overlays
          futuro V10).
          Hidden quando showCreate ou showMap em vôo (não competir com
          modais fullscreen). */}
      {!showCreate && !showMap && (
        <NavBar
          left={[
            {
              icon: <MapIcon size={18} />,
              label: 'mapa',
              onClick: () => setShowMap(true),
              ariaLabel: 'abrir mapa de propagação',
            },
          ]}
          right={[
            {
              icon: <SlidersIcon size={18} />,
              label: 'config',
              onClick: () => setShowSettingsRoot(true),
              ariaLabel: 'abrir settings',
            },
          ]}
          onCompose={() => setShowCreate(true)}
          composeAriaLabel="criar post"
        />
      )}

      {/* V8: modal viewer overlay deletado — home view embedded
          substituiu o paradigma "tap to open". */}

      {/* V8 — Mapa overlay (acionado pelo MAPA da NavBar). Mostra a
          propagação do post atualmente visível + contador de eventos
          rede no header. Mockup v0.7: header "propagação" + FECHAR. */}
      <AnimatePresence>
        {showMap && (
          <MapOverlay
            currentPost={currentPost}
            onClose={() => setShowMap(false)}
            onOpenLocationSettings={() => {
              setShowMap(false)
              setShowLocation(true)
            }}
          />
        )}
      </AnimatePresence>

      {/* V8 — SettingsRoot menu (acionado pelo CONFIG da NavBar). Lista
          7 opções consolidando o que estava no header legado. Cada item
          fecha o root e abre o overlay específico. */}
      <AnimatePresence>
        {showSettingsRoot && (
          <SettingsRoot
            onClose={() => setShowSettingsRoot(false)}
            escDismissible={
              !showFilters &&
              !showLocation &&
              !showMapView &&
              !showNetworkMode &&
              !showBlobsCard &&
              !showDiagnosticCard &&
              !showStatusCard &&
              !showAboutCard &&
              !showIdentity &&
              !showSwitcher &&
              !showRelays &&
              !showLists
            }
            onSelect={(target) => {
              // V9.2e — UX: NÃO fechar SettingsRoot ao abrir sub-card.
              // Sub-cards renderizam ON TOP (z-40 + DOM order) do root;
              // ao fechar o sub-card, user volta naturalmente pra lista
              // de configurações, sem hop brusco pro home view. Apenas
              // ações destrutivas (limpar local) fecham o root via
              // reload da página.
              switch (target) {
                case 'chave':
                  setShowIdentity(true)
                  break
                case 'identidades':
                  setShowSwitcher(true)
                  break
                case 'relays':
                  setShowRelays(true)
                  break
                case 'listas':
                  setShowLists(true)
                  break
                case 'filtros':
                  setShowFilters(true)
                  break
                case 'location':
                  setShowLocation(true)
                  break
                case 'mapa':
                  setShowMapView(true)
                  break
                case 'rede':
                  setShowNetworkMode(true)
                  break
                case 'blobs':
                  setShowBlobsCard(true)
                  break
                case 'diagnostico':
                  setShowDiagnosticCard(true)
                  break
                case 'status':
                  setShowStatusCard(true)
                  break
                case 'sobre':
                  setShowAboutCard(true)
                  break
                case 'limpar':
                  void handleClearLocal()
                  break
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* V9.2d — cards focados (substituem routing pra ContentSettings
          monolítica). Cada um abre como FullPageOverlay próprio. */}
      <AnimatePresence>
        {showFilters && <FiltersCard onClose={() => setShowFilters(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showLocation && <LocationCard onClose={() => setShowLocation(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showMapView && <MapViewCard onClose={() => setShowMapView(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showNetworkMode && (
          <NetworkModeCard onClose={() => setShowNetworkMode(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showBlobsCard && (
          <BlobsCard onClose={() => setShowBlobsCard(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showDiagnosticCard && (
          <DiagnosticCard onClose={() => setShowDiagnosticCard(false)} />
        )}
      </AnimatePresence>

      {/* V9.2e — Status card (substitui inline DiagnosticPanel). */}
      <AnimatePresence>
        {showStatusCard && (
          <FullPageOverlay
            onClose={() => setShowStatusCard(false)}
            title="status"
            ariaLabel="painel de diagnóstico"
          >
            <div className="p-5">
              <DiagnosticPanel boot={boot} />
            </div>
          </FullPageOverlay>
        )}
      </AnimatePresence>

      {/* V9.2e — Sobre card (versão + manifesto link). */}
      <AnimatePresence>
        {showAboutCard && (
          <FullPageOverlay
            onClose={() => setShowAboutCard(false)}
            title="sobre"
            ariaLabel="sobre o cliente Drift"
          >
            <div className="space-y-4 p-5 font-mono">
              <div className="rounded border border-drift-border bg-drift-bg/50 p-4">
                <div className="text-[10px] uppercase tracking-[2px] text-drift-muted">
                  versão do cliente
                </div>
                <div className="mt-1 font-display text-[20px] font-extrabold text-drift-text">
                  {CLIENT_VERSION}
                </div>
                <div className="mt-2 text-[10px] leading-relaxed text-drift-muted">
                  cliente oficial Drift (
                  <code className="text-drift-text">drift-official</code>) —
                  vocab user-facing DRIFT/SINK/DERIVA · vocab spec SPREAD/
                  BURY (kinds 9079/9080).
                </div>
              </div>
              <a
                href="https://github.com/anthropics/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded border border-drift-border bg-drift-bg/30 p-4 text-[11px] leading-relaxed text-drift-text transition-colors hover:border-drift-accent hover:text-drift-accent"
              >
                manifesto + arquitetura ↗
                <div className="mt-1 text-[10px] text-drift-muted">
                  34 princípios públicos. Compromissos vinculantes.
                </div>
              </a>
              <p className="text-[10px] leading-relaxed text-drift-muted">
                Drift é decentralized social network sobre Nostr.
                Eventos imutáveis assinados, score determinístico,
                sem afinidade no feed (manifesto §22), sem chave mestra
                (§17). Cliente PWA + Tauri opcional. Identidade portável
                via nsec1.
              </p>
            </div>
          </FullPageOverlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRelays && (
          <RelaySettings onClose={() => setShowRelays(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSwitcher && (
          <IdentitySwitcher
            onClose={() => setShowSwitcher(false)}
            onRequestExport={() => {
              setShowSwitcher(false)
              setShowIdentity(true)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLists && (
          <LocalListsSettings onClose={() => setShowLists(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfile && boot.identity && (
          <ProfileModal
            identity={boot.identity}
            onClose={() => setShowProfile(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showOnboarding && (
          <OnboardingOverlay
            onClose={() => setShowOnboarding(false)}
            onOpenIdentity={() => {
              setShowOnboarding(false)
              setShowIdentity(true)
            }}
          />
        )}
      </AnimatePresence>

      {showIdentity && boot.identity && (
        <IdentityPanel
          identity={boot.identity}
          onClose={() => setShowIdentity(false)}
        />
      )}
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
}: {
  onOpenStatus: () => void
  onOpenProfile: () => void
}) {
  const events = useSyncStore((s) => s.eventsReceived)
  const active = useSyncStore((s) => s.active)
  const degradedCount = useBootStore((s) => s.degradedReasons.length)

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

      {/* Degraded badge — reserva espaço sempre (invisible) pra não
          causar layout shift quando aparece. Sinal forte de atenção. */}
      <button
        onClick={onOpenStatus}
        className={`text-amber-300 transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 ${
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
        aria-label="painel de status"
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
  void onOpenLocation
  void onOpenNetworkMode

  return (
    <header className="shrink-0 px-5 pt-4">
      <div className="mb-[14px] flex items-center justify-between gap-3">
        <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[-0.5px] text-drift-text">
          dri<em className="not-italic text-drift-accent">ft</em>
        </h1>
        <div className="flex items-center gap-3">
          <StatusIndicators
            onOpenStatus={onOpenStatus}
            onOpenProfile={onOpenProfile}
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
    </header>
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

function HomeEmpty({ tab }: { tab: 'global' | 'following' | 'trending' }) {
  const msg =
    tab === 'following'
      ? 'Você não segue ninguém ainda. Toque ➕ pra criar seu primeiro post — depois siga autores ao abrir os posts deles.'
      : tab === 'trending'
      ? 'Nada em alta nas últimas 24h. Driftar um post recente vai puxar ele pro trending.'
      : 'Nenhum post no feed ainda. Toque ➕ pra publicar o primeiro — ele vai dar a volta pelos relays e voltar.'
  return (
    <div className="flex h-full items-center justify-center px-8">
      <p className="max-w-prose text-center font-mono text-[11px] leading-relaxed text-drift-muted">
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
    tab === 'following' ? 'seguindo' : tab === 'trending' ? 'trending' : 'global'
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
        <p className="max-w-prose font-mono text-[11px] leading-relaxed text-slate-400">
          Posts novos chegam continuamente via relays. Atualize pra
          checar agora, ou volte pro topo pra reler o feed atual —
          manifesto §6 (verdade por eventos).
        </p>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded bg-drift-accent px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-meta text-drift-bg transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg"
          >
            {refreshing ? '⟳ verificando…' : '↻ atualizar feed'}
          </button>
          <button
            onClick={onJumpToTop}
            className="rounded border border-drift-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-meta text-slate-400 transition-colors hover:border-drift-text hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
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
  onOpenLocationSettings,
}: {
  currentPost: Post | null
  onClose: () => void
  onOpenLocationSettings: () => void
}) {
  const events = useSyncStore((s) => s.eventsReceived)
  const [mapMode, setMapMode] = useState<'post' | 'global'>('post')

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
    <FullPageOverlay
      onClose={onClose}
      title="propagação"
      headerRight={headerRight}
      ariaLabel="mapa de propagação"
    >
      <div className="relative h-full w-full">
        <SpreadMap
          postId={postId}
          mode={mapMode}
          onModeChange={setMapMode}
          className="h-full w-full"
          onOpenLocationSettings={onOpenLocationSettings}
          {...(currentPost ? { currentPostId: currentPost.id } : {})}
        />
      </div>
    </FullPageOverlay>
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
  | 'blobs'
  | 'diagnostico'
  | 'status'
  | 'sobre'
  | 'limpar'

function SettingsRoot({
  onClose,
  onSelect,
  escDismissible = true,
}: {
  onClose: () => void
  onSelect: (target: SettingsTarget) => void
  /**
   * V9.2e — quando um sub-card está aberto sobre o root, root NÃO
   * deve responder ao ESC (sub-card é o topmost; senão ESC fecha
   * ambos). App.tsx passa false quando algum sub-card está aberto.
   */
  escDismissible?: boolean
}) {
  // V9: agrupado por categoria visual (mockup s-row pattern). Identidade
  // primeiro pq é o caminho mais comum; Sistema (status/limpar) por
  // último porque diagnostic + destrutivo. Cada categoria tem header
  // muted small caps. Mantém UX previsível: idioma do label + hint
  // explicativo + chevron à direita.
  // V9.2c — cada seção da ContentSettings também aparece como entry
  // direto no menu inicial (não nested). Click → scroll-to-section
  // em ContentSettings (rota direta sem buscar na overlay grande).
  const groups: {
    title: string
    items: {
      target: SettingsTarget
      label: string
      danger?: boolean
      hint: string
    }[]
  }[] = [
    {
      title: 'identidade',
      items: [
        { target: 'chave', label: 'chave', hint: 'backup/import nsec' },
        {
          target: 'identidades',
          label: 'identidades',
          hint: 'múltiplas identidades — manifesto §4',
        },
      ],
    },
    {
      title: 'rede',
      items: [
        {
          target: 'relays',
          label: 'relays',
          hint: 'gerenciar relays + NIP-65',
        },
        {
          target: 'rede',
          label: 'modo de rede',
          hint: 'clearnet / tor / onion-only — manifesto §15',
        },
      ],
    },
    {
      title: 'conteúdo',
      items: [
        {
          target: 'filtros',
          label: 'filtros',
          hint: 'NSFW / spoilers / anúncios',
        },
        {
          target: 'location',
          label: 'location',
          hint: 'granularidade nos meus posts — §28',
        },
        {
          target: 'mapa',
          label: 'mapa de spread',
          hint: 'enquadramento fechado / aberto',
        },
        {
          target: 'listas',
          label: 'listas',
          hint: 'pinned, blocked, muted (filtros locais)',
        },
      ],
    },
    {
      title: 'sistema',
      items: [
        {
          target: 'status',
          label: 'status',
          hint: 'painel de diagnóstico em tempo real',
        },
        {
          target: 'blobs',
          label: 'blobs (ipfs)',
          hint: 'servindo blobs a peers — manifesto §16',
        },
        {
          target: 'diagnostico',
          label: 'redefinir cache',
          hint: 'reconstrói banco local sem apagar identidade',
        },
        {
          target: 'sobre',
          label: `versão ${CLIENT_VERSION}`,
          hint: 'cliente Drift, manifesto + licença',
        },
        {
          target: 'limpar',
          label: 'limpar local',
          danger: true,
          hint: 'apaga banco local — destrutivo',
        },
      ],
    },
  ]

  return (
    <FullPageOverlay
      onClose={onClose}
      title="configurações"
      ariaLabel="configurações"
      escDismissible={escDismissible}
    >
      <div className="px-5 py-[18px]">
        {groups.map((group, gi) => (
          <section
            key={group.title}
            className={gi > 0 ? 'mt-[28px]' : ''}
            aria-labelledby={`settings-group-${gi}`}
          >
            <h3
              id={`settings-group-${gi}`}
              className="mb-2 font-mono text-[9px] uppercase tracking-tag text-drift-muted"
            >
              {group.title}
            </h3>
            <ul className="divide-y divide-drift-border border-y border-drift-border">
              {group.items.map((item) => (
                <li key={item.target}>
                  <button
                    onClick={() => onSelect(item.target)}
                    className={`group flex w-full items-center justify-between gap-3 px-1 py-[14px] text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg ${
                      item.danger
                        ? 'text-drift-bury hover:text-[#ff6b6b]'
                        : 'text-drift-text hover:text-drift-accent'
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-[2px]">
                      <span className="font-mono text-[11px] uppercase tracking-[2px]">
                        {item.label}
                      </span>
                      <span className="truncate font-mono text-[10px] normal-case tracking-normal text-drift-muted">
                        {item.hint}
                      </span>
                    </div>
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-mono text-[12px] text-drift-muted transition-colors group-hover:text-current"
                    >
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {/* Padding bottom defensivo pra não cortar último item em
            viewports curtos (anti-overflow V9.3). */}
        <div className="h-6" aria-hidden="true" />
      </div>
    </FullPageOverlay>
  )
}

// ─── Install Banner ──────────────────────────────────────────────────

function InstallBanner({
  kind,
  onInstall,
  onDismiss,
}: {
  kind: 'native' | 'ios-safari' | 'unavailable'
  onInstall: () => void
  onDismiss: () => void
}) {
  const [showIosHelp, setShowIosHelp] = useState(false)

  if (kind === 'ios-safari') {
    return (
      <div className="mb-4 rounded border border-drift-accent/30 bg-drift-accent/5 p-3">
        <div className="flex items-center gap-3">
          <span className="text-base">📥</span>
          <div className="flex-1 text-[11px]">
            <div className="text-slate-200">instalar Drift no iOS</div>
            <div className="text-[10px] text-drift-muted">
              Safari não tem botão de instalar — segue o passo a passo.
            </div>
          </div>
          <button
            onClick={() => setShowIosHelp((v) => !v)}
            className="rounded border border-drift-accent px-3 py-1 text-[10px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
          >
            {showIosHelp ? 'fechar' : 'como'}
          </button>
          <button
            onClick={onDismiss}
            className="text-drift-muted hover:text-drift-text"
            aria-label="dispensar"
            title="dispensar"
          >
            ✕
          </button>
        </div>
        {showIosHelp && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[11px] text-slate-300">
            <li>
              Toque no botão <strong>Compartilhar</strong> (ícone de quadrado
              com seta apontando pra cima) na barra do Safari
            </li>
            <li>
              Role e toque em{' '}
              <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>
            </li>
            <li>Confirme em &ldquo;Adicionar&rdquo;</li>
            <li>
              Drift aparece na tela inicial como app — abre fullscreen, sem
              barra do Safari
            </li>
          </ol>
        )}
      </div>
    )
  }

  // kind === 'native' (Chrome Android, Edge, desktop Chrome com prompt
  // disponível). 'unavailable' nem chega aqui — banner é gated por
  // `available` em useInstallPrompt.
  return (
    <div className="mb-4 flex items-center gap-3 rounded border border-drift-accent/30 bg-drift-accent/5 p-3">
      <span className="text-base">📥</span>
      <div className="flex-1 text-[11px]">
        <div className="text-slate-200">instalar Drift como app</div>
        <div className="text-[10px] text-drift-muted">
          PWA — instala sem app store. Manifesto §1 (existência autônoma).
        </div>
      </div>
      <button
        onClick={onInstall}
        className="rounded border border-drift-accent px-3 py-1 text-[10px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
      >
        instalar
      </button>
      <button
        onClick={onDismiss}
        className="text-drift-muted hover:text-drift-text"
        aria-label="dispensar"
        title="dispensar"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Bootstrap view ─────────────────────────────────────────────────

function BootView({ state }: { state: BootState }) {
  return (
    <main className="min-h-full p-6 font-mono text-sm sm:p-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10">
          <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[-0.5px] text-drift-text">
            dri<em className="not-italic text-drift-accent">ft</em>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-widest text-slate-400">
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
              : 'COOP/COEP inativos · SharedArrayBuffer indisponível'
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
        />

        {state.step === 'error' && state.error && (
          <div className="mt-6 rounded border border-red-900/60 bg-red-950/20 p-4 text-red-300">
            <div className="mb-2 text-xs uppercase tracking-widest">erro</div>
            <pre className="whitespace-pre-wrap break-words text-xs">{state.error}</pre>
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
    <div className="space-y-4">
      <p className="font-mono text-[11px] leading-relaxed text-slate-400">
        Estado do cliente em tempo real. Use os botões abaixo se UI parecer
        stale ou eventos pararem de chegar.
      </p>

      <div className="space-y-2 rounded border border-drift-border bg-drift-surface p-4 font-mono text-[11px]">
        <Row label="storage" value={storageLabel} />
        <Row
          label="sync"
          value={`${sync.active ? '● ativo' : '○ inativo'} · cursor ${sync.cursor}`}
          valueClass={sync.active ? 'text-drift-spread' : 'text-slate-400'}
        />
        <Row label="eventos recebidos" value={String(sync.eventsReceived)} />
        <Row label="relays ok" value={`${relaysOk}/${relaysTotal}`} />
        {sync.rebuildsInProgress.length > 0 && (
          <Row
            label="rebuild em andamento"
            value={String(sync.rebuildsInProgress.length)}
            valueClass="text-yellow-400"
          />
        )}
      </div>

      {/* Botões de diagnóstico — pra forçar resync quando subscribe morre
          silenciosamente, ou refresh manual quando suspeita de UI stale. */}
      <div className="flex gap-2">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex-1 rounded border border-drift-border px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-slate-400 transition-colors hover:border-drift-accent hover:text-drift-accent disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          title="re-query SQLite e atualiza o feed local — útil se UI parece stale"
        >
          {refreshing ? '…' : '↻ atualizar feed'}
        </button>
        <button
          onClick={handleResync}
          disabled={resyncing}
          className="flex-1 rounded border border-drift-border px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-slate-400 transition-colors hover:border-drift-accent hover:text-drift-accent disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          title="re-subscrever em todos os relays do zero — útil se eventos pararam de chegar"
        >
          {resyncing ? '…' : '↻ re-subscribe'}
        </button>
      </div>

      {/* Ring buffer de últimos eventos recebidos — diagnóstico de
          sincronização entre devices. Se cliente A publica spread e
          cliente B não vê na lista aqui, o problema é propagação
          (relay/network) e não rendering. */}
      {sync.recent.length > 0 && (
        <details className="rounded border border-drift-border bg-drift-surface p-3">
          <summary className="cursor-pointer font-mono text-[11px] text-slate-400 hover:text-drift-text">
            últimos eventos ({sync.recent.length})
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto font-mono text-[10px]">
            {sync.recent.map((e, i) => (
              <div key={`${e.id}-${i}`} className="flex gap-2 py-0.5">
                <span className="text-slate-500">
                  {new Date(e.receivedAt).toLocaleTimeString()}
                </span>
                <span className={kindColor(e.kind)}>{kindLabel(e.kind)}</span>
                <span className="text-slate-500">{e.id.slice(0, 8)}</span>
                {e.ref && (
                  <span className="truncate text-slate-500">
                    → {e.ref.slice(0, 12)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="overflow-hidden rounded border border-drift-border bg-drift-surface p-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-meta text-slate-400">
          minha npub
        </div>
        {/* whitespace-pre-wrap necessário porque <pre> tem white-space:
            pre por default e ignora break-all sozinho. */}
        <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-drift-text">
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
      <span className="text-[10px] uppercase tracking-meta text-slate-400">
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
}: {
  label: string
  state: CheckState
  detail: string
}) {
  const dot =
    state === 'pending' ? '◌' : state === 'ok' ? '✓' : state === 'partial' ? '◐' : state === 'fail' ? '✗' : '·'
  const color =
    state === 'pending'
      ? 'text-yellow-400'
      : state === 'ok'
      ? 'text-emerald-400'
      : state === 'partial'
      ? 'text-yellow-400'
      : state === 'fail'
      ? 'text-red-400'
      : 'text-drift-muted'
  return (
    <div className="mb-3 rounded border border-drift-border bg-drift-surface p-4">
      <div className="mb-2 flex items-center gap-3">
        <span className={`text-base ${color}`}>{dot}</span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</span>
      </div>
      <pre className="ml-6 whitespace-pre-wrap break-all text-xs text-slate-400">{detail}</pre>
    </div>
  )
}

// `timeAgo` removido em V_pre0 — vive em components/Feed/PostCard.tsx.
// Outros consumidores (PostViewer, LocalListsSettings) têm cópias
// próprias com signatures diferentes (segundos vs ms). Consolidação
// em util compartilhado é trabalho separado (Lily débito).

export default App
