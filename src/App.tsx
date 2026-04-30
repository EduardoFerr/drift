import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { OPTIMISTIC_TIMEOUT_MS } from './config/constants'
import { db } from './lib/db'
import {
  getCurrentLocation,
  getLastFailureReason,
  warmUpGpsLocation,
  type GeolocationFailureReason,
} from './lib/geolocation'
import { restartSync, useSyncStore } from './lib/sync'
import { createPost, spreadPost, buryPost } from './lib/protocol'
import { applyContentFilters, getMyAction, refreshFeed, setFeedTab, useFeedStore } from './lib/feed'
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
import { SubpostEditor } from './components/Create/SubpostEditor'
import { ContentSettings } from './components/Settings/ContentSettings'
import { RelaySettings } from './components/Settings/RelaySettings'
import { LocalListsSettings } from './components/Settings/LocalListsSettings'
import { OnboardingOverlay } from './components/Onboarding/OnboardingOverlay'
import { ProfileModal } from './components/Profile/ProfileModal'
import { GpsErrorBanner } from './components/UI/GpsErrorBanner'
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
  // vale" (Docs/conversa-29-04-analise.md §2). Populado a partir do SQLite
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
  const [showDiagnostic, setShowDiagnostic] = useState(false)
  const [showIdentity, setShowIdentity] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Quando o user clica no indicador 📍 do Header, abre Settings já
  // scrollado pra seção location_granularity. Default null = sem scroll.
  const [settingsScrollTo, setSettingsScrollTo] = useState<'location' | null>(null)
  const [showRelays, setShowRelays] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showLists, setShowLists] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

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
  const [viewerPostId, setViewerPostId] = useState<string | null>(null)
  const [viewerExitDir, setViewerExitDir] = useState<'up' | 'down'>('up')

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
      // SubpostEditor já está sempre montado no topo do feed —
      // foca o textarea pra UX consistente com "abrir compose".
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[data-subpost-input]',
      )
      textarea?.focus()
    } else if (action === 'settings') {
      setShowSettings(true)
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

  // Resolve o post visível e o próximo da fila. Memoiza pra evitar O(n)
  // findIndex em cada render (feed pode ter centenas de posts).
  // Se o post atual saiu do feed (moderado, etc.), fecha o viewer.
  // Como `useFeedStore` mantém o array em memória, a transição entre
  // posts é instantânea — sem fetch.
  const { viewerIdx, viewerPost, nextPost } = useMemo(() => {
    const idx = viewerPostId ? posts.findIndex((p) => p.id === viewerPostId) : -1
    return {
      viewerIdx: idx,
      viewerPost: idx >= 0 ? posts[idx]! : null,
      nextPost: idx >= 0 && idx + 1 < posts.length ? posts[idx + 1]! : null,
    }
  }, [viewerPostId, posts])
  useEffect(() => {
    if (viewerPostId && !viewerPost) setViewerPostId(null)
  }, [viewerPostId, viewerPost])

  function openViewer(postId: string) {
    setViewerExitDir('up') // entrada inicial sem direção dominante
    setViewerPostId(postId)
  }

  /**
   * Avança pra próximo post da fila com animação direcional.
   * Sem próximo → fecha o viewer (estado "fim do feed" via close).
   */
  function advanceViewer(dir: 'up' | 'down') {
    setViewerExitDir(dir)
    setViewerPostId(nextPost?.id ?? null)
  }

  // Ações ──────────────────────────────────────────────────────────────

  async function handlePublish(input: {
    subposts: Subpost[]
    contentWarning: ContentWarning | null
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
      })
    } catch (err) {
      console.error('publish failed', err)
      alert(`Falha ao publicar: ${err instanceof Error ? err.message : String(err)}`)
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
    if (
      !confirm(
        'Apagar TODOS os posts/spreads/buries locais? (identidade preservada)',
      )
    )
      return
    await db.run(`DELETE FROM posts`)
    await db.run(`DELETE FROM spreads`)
    await db.run(`DELETE FROM buries`)
    await db.run(`DELETE FROM reports`)
    await db.run(`DELETE FROM sync_log`)
    location.reload()
  }

  // Render ─────────────────────────────────────────────────────────────

  if (boot.step !== 'ready') {
    return <BootView state={boot} />
  }

  return (
    <div className="min-h-full p-4 font-mono text-sm sm:p-8">
      <div className="mx-auto max-w-2xl">
        <Header
          identity={boot.identity}
          userWeight={userWeight}
          showDiagnostic={showDiagnostic}
          onToggleDiagnostic={() => setShowDiagnostic((s) => !s)}
          onOpenIdentity={() => setShowIdentity(true)}
          onOpenSwitcher={() => setShowSwitcher(true)}
          onOpenSettings={() => {
            setSettingsScrollTo(null)
            setShowSettings(true)
          }}
          onOpenSettingsLocation={() => {
            setSettingsScrollTo('location')
            setShowSettings(true)
          }}
          locationGranularity={locationGranularity}
          onOpenRelays={() => setShowRelays(true)}
          onOpenLists={() => setShowLists(true)}
          onOpenProfile={() => setShowProfile(true)}
          onClearLocal={handleClearLocal}
        />

        {(() => {
          // Banner GPS: visível só se user optou por location, falhou nos
          // últimos 60s, ainda não dispensou nesta sessão. Wrapped em IIFE
          // pra calcular condição inline sem poluir top-level.
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

        {showDiagnostic && <DiagnosticPanel boot={boot} />}

        {installPrompt.available && (
          <InstallBanner
            kind={installPrompt.kind}
            onInstall={async () => {
              await installPrompt.install()
            }}
            onDismiss={() => installPrompt.setDismissed(true)}
          />
        )}

        <SubpostEditor
          publishing={publishing}
          capturingLocation={gpsCapturing.has('__publish__')}
          maxSubposts={userWeight.maxSubposts}
          onPublish={handlePublish}
        />

        <Feed
          posts={posts}
          identity={boot.identity}
          pending={pending}
          myActions={myActions}
          gpsCapturing={gpsCapturing}
          onSpread={handleSpread}
          onBury={handleBury}
          onSelect={openViewer}
        />
      </div>

      <AnimatePresence custom={viewerExitDir}>
        {viewerPost && (
          <PostViewer
            key={viewerPost.id}
            custom={viewerExitDir}
            post={viewerPost}
            isMine={viewerPost.authorPub === boot.identity?.npub}
            pendingAction={pending[viewerPost.id] ?? null}
            myAction={myActions[viewerPost.id] ?? null}
            capturingLocation={gpsCapturing.has(viewerPost.id)}
            queue={{ index: viewerIdx, total: posts.length, next: nextPost }}
            onSpread={() => {
              handleSpread(viewerPost)
              advanceViewer('up')
            }}
            onBury={() => {
              handleBury(viewerPost)
              advanceViewer('down')
            }}
            onClose={() => setViewerPostId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <ContentSettings
            onClose={() => {
              setShowSettings(false)
              setSettingsScrollTo(null)
            }}
            {...(settingsScrollTo ? { scrollTo: settingsScrollTo } : {})}
          />
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

// ─── Header ──────────────────────────────────────────────────────────

function Header({
  identity,
  userWeight,
  showDiagnostic,
  onToggleDiagnostic,
  onOpenIdentity,
  onOpenSwitcher,
  onOpenSettings,
  onOpenSettingsLocation,
  onOpenRelays,
  onOpenLists,
  onOpenProfile,
  onClearLocal,
  locationGranularity,
}: {
  identity: DriftIdentity | null
  userWeight: { weight: number; engagement: number; antiquity: number; maxSubposts: number }
  showDiagnostic: boolean
  onToggleDiagnostic: () => void
  onOpenIdentity: () => void
  onOpenSwitcher: () => void
  onOpenSettings: () => void
  onOpenSettingsLocation: () => void
  onOpenRelays: () => void
  onOpenLists: () => void
  onOpenProfile: () => void
  onClearLocal: () => void
  locationGranularity: LocationGranularity
}) {
  // Selectors granulares — re-render só quando o campo específico muda.
  const active = useSyncStore((s) => s.active)
  const events = useSyncStore((s) => s.eventsReceived)
  const rebuilding = useSyncStore((s) => s.rebuildsInProgress.length > 0)

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-drift-border pb-4">
      <div>
        <h1 className="text-xl font-bold tracking-[0.25em] text-drift-accent">DRIFT</h1>
        <button
          onClick={onOpenIdentity}
          className="mt-1 text-[10px] text-slate-600 hover:text-slate-300"
          title="abrir backup/import de identidade"
        >
          {identity?.npubBech32.slice(0, 12)}…{identity?.npubBech32.slice(-6)}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        {locationGranularity !== 'off' && (
          <button
            onClick={onOpenSettingsLocation}
            className="text-[12px] leading-none text-amber-300 hover:opacity-80"
            title={`Location declarado: ${locationGranularity}. Cliente vai pedir GPS antes de cada spread.`}
            aria-label={`Location declarado: ${locationGranularity}. Cliente vai pedir GPS antes de cada spread.`}
          >
            📍
          </button>
        )}
        <button
          onClick={onOpenProfile}
          className="rounded hover:opacity-80"
          title="ver perfil"
        >
          <WeightBadge data={userWeight} />
        </button>
        <span title="eventos recebidos pelo subscribe">
          {active ? '●' : '○'} {events} ev
          {rebuilding && <span className="ml-1 text-yellow-400">· rebuild…</span>}
        </span>
        <button
          onClick={onOpenIdentity}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
          title="backup/import nsec"
        >
          chave
        </button>
        <button
          onClick={onOpenSwitcher}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
          title="múltiplas identidades — manifesto §4"
        >
          identidades
        </button>
        <button
          onClick={onOpenRelays}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
          title="gerenciar relays + NIP-65 — manifesto §14"
        >
          relays
        </button>
        <button
          onClick={onOpenLists}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
          title="pinned, blocked, muted (filtros locais)"
        >
          listas
        </button>
        <button
          onClick={onOpenSettings}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
          title="filtros de conteúdo e privacidade"
        >
          settings
        </button>
        <button
          onClick={onToggleDiagnostic}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
        >
          {showDiagnostic ? 'fechar status' : 'status'}
        </button>
        <button
          onClick={onClearLocal}
          className="rounded border border-red-900/60 px-2 py-1 text-red-400/80 hover:bg-red-950/30"
        >
          limpar local
        </button>
      </div>
    </header>
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
            <div className="text-[10px] text-slate-500">
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
            className="text-slate-600 hover:text-slate-400"
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
        <div className="text-[10px] text-slate-500">
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
        className="text-slate-600 hover:text-slate-400"
        aria-label="dispensar"
        title="dispensar"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Weight Badge ────────────────────────────────────────────────────

function WeightBadge({
  data,
}: {
  data: { weight: number; engagement: number; antiquity: number; maxSubposts: number }
}) {
  const tone =
    data.weight < 20
      ? 'text-slate-500'
      : data.weight < 50
      ? 'text-emerald-500'
      : data.weight < 75
      ? 'text-emerald-400'
      : 'text-yellow-300'
  const tooltip =
    `peso ${data.weight.toFixed(1)} = antiguidade ${data.antiquity.toFixed(1)} + engajamento ${data.engagement.toFixed(1)}\n` +
    `max subposts: ${data.maxSubposts}\n` +
    `manifesto §22 — score determinístico, sem reputação subjetiva`
  return (
    <span title={tooltip} className={`tabular-nums ${tone}`}>
      ⚖ {data.weight.toFixed(0)}
    </span>
  )
}

// ─── Feed ────────────────────────────────────────────────────────────

function Feed({
  posts,
  identity,
  pending,
  myActions,
  gpsCapturing,
  onSpread,
  onBury,
  onSelect,
}: {
  posts: Post[]
  identity: DriftIdentity | null
  pending: Record<string, 'spread' | 'bury'>
  myActions: Record<string, 'spread' | 'bury' | null>
  gpsCapturing: Set<string>
  onSpread: (p: Post) => void
  onBury: (p: Post) => void
  onSelect: (postId: string) => void
}) {
  const prefs = usePrefsStore()
  const tab = useFeedStore((s) => s.tab)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-drift-border pb-2">
        <div className="flex gap-1 text-[10px] uppercase tracking-widest">
          <FeedTabBtn active={tab === 'global'} onClick={() => void setFeedTab('global')}>
            global
          </FeedTabBtn>
          <FeedTabBtn active={tab === 'following'} onClick={() => void setFeedTab('following')}>
            seguindo
          </FeedTabBtn>
          <FeedTabBtn active={tab === 'trending'} onClick={() => void setFeedTab('trending')}>
            trending
          </FeedTabBtn>
        </div>
        <span className="text-[10px] text-slate-600">{posts.length}</span>
      </div>

      {posts.length === 0 ? (
        <FeedEmpty tab={tab} />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
          const hint = applyContentFilters(post, prefs)
          if (hint.hide) {
            return (
              <HiddenCard
                key={post.id}
                reason={hint.reason ?? 'oculto'}
                onReveal={() => onSelect(post.id)}
              />
            )
          }
          return (
            <PostCard
              key={post.id}
              post={post}
              isMine={post.authorPub === identity?.npub}
              pending={pending[post.id] ?? null}
              myAction={myActions[post.id] ?? null}
              capturingLocation={gpsCapturing.has(post.id)}
              blurred={hint.blur}
              onOpen={() => onSelect(post.id)}
              onSpread={() => onSpread(post)}
              onBury={() => onBury(post)}
            />
          )
        })}
        </div>
      )}
    </div>
  )
}

function FeedTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 transition-colors ${
        active
          ? 'border-b-2 border-drift-accent text-drift-accent'
          : 'border-b-2 border-transparent text-slate-600 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

function FeedEmpty({ tab }: { tab: 'global' | 'following' | 'trending' }) {
  if (tab === 'following') {
    return (
      <div className="rounded border border-dashed border-drift-border p-8 text-center text-xs text-slate-600">
        Você não segue ninguém ainda.
        <br />
        Abra um post (toque) e use o botão ➕ pra seguir o autor.
      </div>
    )
  }
  if (tab === 'trending') {
    return (
      <div className="rounded border border-dashed border-drift-border p-8 text-center text-xs text-slate-600">
        Nada em alta nas últimas 24h.
        <br />
        Espalhar um post recente vai puxar ele pro trending.
      </div>
    )
  }
  return (
    <div className="rounded border border-dashed border-drift-border p-8 text-center text-xs text-slate-600">
      Nenhum post no feed local ainda.
      <br />
      Publica o primeiro acima — ele vai dar a volta pelos relays e voltar.
    </div>
  )
}

function HiddenCard({
  reason,
  onReveal,
}: {
  reason: string
  onReveal: () => void
}) {
  return (
    <button
      onClick={onReveal}
      className="block w-full rounded border border-dashed border-drift-border bg-drift-surface/40 p-3 text-left text-[11px] text-slate-500 hover:border-drift-accent/40 hover:text-slate-300"
    >
      ⚠ post marcado como <code className="text-yellow-400">{reason}</code> —
      toque pra abrir
    </button>
  )
}

function PostCard({
  post,
  isMine,
  pending,
  myAction,
  capturingLocation,
  blurred,
  onOpen,
  onSpread,
  onBury,
}: {
  post: Post
  isMine: boolean
  pending: 'spread' | 'bury' | null
  /**
   * Última ação do user neste post (lida do SQLite). Usado pra destacar
   * o botão correspondente — semântica "última ação vale". `null` quando
   * o user ainda não interagiu.
   */
  myAction: 'spread' | 'bury' | null
  /** GPS capture em curso pra spread/bury deste post (até 8s). */
  capturingLocation: boolean
  blurred: boolean
  onOpen: () => void
  onSpread: () => void
  onBury: () => void
}) {
  const text = post.subposts[0]?.text ?? '(sem conteúdo de texto)'
  const hasImage = post.subposts.some((s) => s.imageUrl)
  // Optimistic UI (manifesto §10 + arquitetura §2.4): mostra +1 imediato
  // quando o user acaba de espalhar/enterrar. Quando o evento real chega
  // via subscribe, persistSpread/Bury → recalculateScore atualiza
  // post.spreads/buries no banco e `pending` é limpo pelo useEffect que
  // observa getMyAction. Daí o "+1 optimistic" some sem flicker porque
  // post.spreads do banco já incluiu o evento.
  const displaySpreads = post.spreads + (pending === 'spread' ? 1 : 0)
  const displayBuries = post.buries + (pending === 'bury' ? 1 : 0)

  // Estado visual efetivo dos botões: pending (em vôo) toma precedência,
  // depois myAction (confirmada). Botão destacado = última ação do user.
  const effectiveAction: 'spread' | 'bury' | null = pending ?? myAction
  const spreadActive = effectiveAction === 'spread'
  const buryActive = effectiveAction === 'bury'

  return (
    <article className="rounded border border-drift-border bg-drift-surface p-4">
      <div className="mb-2 flex items-center justify-between text-[10px] text-slate-600">
        <span>
          {isMine ? 'você' : 'anon'}…{post.authorPub.slice(-8)} · {timeAgo(post.createdAt)}
          {post.contentWarning && (
            <span
              className="ml-2 rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-300"
              title="aviso declarado pelo autor (manifesto §27)"
            >
              ⚠ {post.contentWarning}
            </span>
          )}
        </span>
        <span title={`spreads ${displaySpreads} · buries ${displayBuries}`}>
          score <span className="text-slate-400">{post.score.toFixed(3)}</span>
        </span>
      </div>

      <button
        onClick={onOpen}
        className="block w-full text-left"
        aria-label="abrir post em tela cheia"
      >
        <div
          className={`transition-[filter] duration-200 ${
            blurred ? 'select-none blur-md' : ''
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-sm text-slate-200">
            {text}
          </p>
          {hasImage && (
            <div className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
              [imagem · toque pra abrir]
            </div>
          )}
        </div>
      </button>

      <div className="mt-3 flex items-center justify-between text-[10px]">
        <div className="flex gap-3 text-slate-500">
          <span className="text-drift-spread">↑ {displaySpreads}</span>
          <span className="text-drift-bury">↓ {displayBuries}</span>
          <button
            onClick={onOpen}
            className="text-slate-500 hover:text-drift-accent"
          >
            abrir →
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSpread}
            disabled={pending !== null}
            className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
              spreadActive
                ? 'border-drift-spread bg-emerald-900/40 text-emerald-300'
                : 'border-drift-spread/40 text-drift-spread hover:bg-emerald-950/30'
            }`}
            title={
              capturingLocation && pending === 'spread'
                ? 'capturando localização (até 8s)'
                : myAction === 'spread'
                ? 'você espalhou — clique ↓ pra mudar de opinião'
                : undefined
            }
            aria-pressed={spreadActive}
          >
            {pending === 'spread'
              ? capturingLocation
                ? '📍 location…'
                : 'enviando…'
              : '↑ espalhar'}
          </button>
          <button
            onClick={onBury}
            disabled={pending !== null}
            className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
              buryActive
                ? 'border-drift-bury bg-red-900/40 text-red-300'
                : 'border-drift-bury/40 text-drift-bury hover:bg-red-950/30'
            }`}
            title={
              myAction === 'bury'
                ? 'você enterrou — clique ↑ pra mudar de opinião'
                : undefined
            }
            aria-pressed={buryActive}
          >
            {pending === 'bury' ? 'enviando…' : '↓ enterrar'}
          </button>
        </div>
      </div>
    </article>
  )
}

// ─── Bootstrap view ─────────────────────────────────────────────────

function BootView({ state }: { state: BootState }) {
  return (
    <div className="min-h-full p-6 font-mono text-sm sm:p-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10">
          <h1 className="text-2xl font-bold tracking-[0.25em] text-drift-accent">DRIFT</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-slate-600">
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
    </div>
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

  return (
    <div className="mb-6 rounded border border-drift-border bg-drift-surface p-3 text-[10px] text-slate-500">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div>
          storage:{' '}
          {boot.storage === 'opfs'
            ? 'OPFS'
            : boot.storage === 'kvvfs'
            ? 'localStorage'
            : boot.storage === 'memory'
            ? 'memória (não persiste)'
            : '?'}
        </div>
        <div>sync: {sync.active ? 'ativo' : 'inativo'} · cursor {sync.cursor}</div>
        <div>eventos recebidos: {sync.eventsReceived}</div>
        <div>
          relays ok: {boot.relays?.filter((r) => r.ok).length ?? '?'}/
          {boot.relays?.length ?? '?'}
        </div>
        {sync.rebuildsInProgress.length > 0 && (
          <div className="col-span-full text-yellow-400">
            rebuild em andamento: {sync.rebuildsInProgress.length}
          </div>
        )}
      </div>

      {/* Botões de diagnóstico — pra forçar resync quando subscribe morre
          silenciosamente, ou refresh manual quando suspeita de UI stale. */}
      <div className="mt-3 flex gap-2 border-t border-drift-border pt-2">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent disabled:opacity-50"
          title="re-query SQLite e atualiza o feed local — útil se UI parece stale"
        >
          {refreshing ? '…' : '↻ atualizar feed'}
        </button>
        <button
          onClick={handleResync}
          disabled={resyncing}
          className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent disabled:opacity-50"
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
        <details className="mt-3 border-t border-drift-border pt-2">
          <summary className="cursor-pointer text-slate-400">
            últimos eventos ({sync.recent.length})
          </summary>
          <div className="mt-1 max-h-48 overflow-y-auto font-mono text-[9px]">
            {sync.recent.map((e, i) => (
              <div key={`${e.id}-${i}`} className="flex gap-2 py-0.5">
                <span className="text-slate-600">
                  {new Date(e.receivedAt).toLocaleTimeString()}
                </span>
                <span className={kindColor(e.kind)}>{kindLabel(e.kind)}</span>
                <span className="text-slate-500">{e.id.slice(0, 8)}</span>
                {e.ref && (
                  <span className="truncate text-slate-600">
                    → {e.ref.slice(0, 12)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <pre className="mt-2 break-all text-[10px] text-slate-600">
        {boot.identity?.npubBech32}
      </pre>
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
    default: return 'text-slate-500'
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
      : 'text-slate-700'
  return (
    <div className="mb-3 rounded border border-drift-border bg-drift-surface p-4">
      <div className="mb-2 flex items-center gap-3">
        <span className={`text-base ${color}`}>{dot}</span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</span>
      </div>
      <pre className="ml-6 whitespace-pre-wrap break-all text-xs text-slate-500">{detail}</pre>
    </div>
  )
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export default App
