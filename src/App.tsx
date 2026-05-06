import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
import { getMyAction, refreshFeed, useFeedStore } from './lib/feed'
import { FeedTabs } from './components/Feed/FeedTabs'
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
import { MultiTabModal } from './components/UI/MultiTabModal'
import { UpdatePrompt } from './components/UI/UpdatePrompt'
import { NavBar } from './components/UI/NavBar'
import { SlideUpOverlay } from './components/UI/SlideUpOverlay'
import { ModalHeader } from './components/UI/ModalHeader'
import { SpreadMap } from './components/Feed/SpreadMap'
import type {
  DriftIdentity,
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
  const [showDiagnostic, setShowDiagnostic] = useState(false)
  const [showIdentity, setShowIdentity] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Quando o user clica num indicador do Header (📍 location ou 🌐/🧅/🛡
  // network), abre Settings já scrollado pra seção certa. Default null =
  // sem scroll.
  const [settingsScrollTo, setSettingsScrollTo] = useState<'location' | 'network' | null>(null)
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
  // Lista 7 opções (chave/identidades/relays/listas/settings/status/
  // limpar local); cada item roteia pro overlay específico já existente.
  const [showSettingsRoot, setShowSettingsRoot] = useState(false)

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
  const [currentIdx, setCurrentIdx] = useState(0)
  const [exitDir, setExitDir] = useState<'up' | 'down'>('up')
  const { currentPost, nextHomePost } = useMemo(() => {
    if (posts.length === 0) return { currentPost: null, nextHomePost: null }
    const safeIdx = Math.max(0, Math.min(currentIdx, posts.length - 1))
    return {
      currentPost: posts[safeIdx]!,
      nextHomePost: safeIdx + 1 < posts.length ? posts[safeIdx + 1]! : null,
    }
  }, [currentIdx, posts])
  // Quando posts muda significativamente (post atual sumiu — moderado,
  // muted), volta pra index 0 pra não quebrar a navegação.
  useEffect(() => {
    if (posts.length > 0 && currentIdx >= posts.length) {
      setCurrentIdx(Math.max(0, posts.length - 1))
    }
  }, [posts.length, currentIdx])

  // V8: openViewer + advanceViewer (modal viewer queue) deletados —
  // home view embedded substituiu o paradigma. viewerPostId/viewerExitDir
  // ainda existem mas não são setados em lugar nenhum (sempre null/'up'),
  // mantidos pra evitar break em código downstream que ainda referencia
  // (nenhum em V8). Track futura limpa o resíduo.

  /**
   * V8 home stack advance. Avança currentIdx pra próximo post se houver.
   * Fim da fila = no-op de avanço (spread/sink já executaram, só não
   * troca o card visível). UX: card "trava" no último post até novos
   * chegarem via subscribe.
   */
  function advanceHome(dir: 'up' | 'down') {
    setExitDir(dir)
    setCurrentIdx((i) => (i + 1 < posts.length ? i + 1 : i))
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
      // V7: success path fecha o modal. SubpostEditor reseta seus drafts
      // internos no próprio handleSubmit (já era assim antes do V7).
      setShowCreate(false)
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
    <div className="flex h-[100dvh] flex-col font-mono text-sm">
      <HomeHeader
        identity={boot.identity}
        userWeight={userWeight}
        currentScore={currentPost?.score ?? null}
        showDiagnostic={showDiagnostic}
        onToggleDiagnostic={() => setShowDiagnostic((s) => !s)}
        onOpenIdentity={() => setShowIdentity(true)}
        onOpenSwitcher={() => setShowSwitcher(true)}
        onOpenRelays={() => setShowRelays(true)}
        onOpenLists={() => setShowLists(true)}
        onClearLocal={handleClearLocal}
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
      </div>

      <UpdatePrompt />

      {/* Stack — área central que contém o card atual. flex:1 expande
          até a navbar bottom. Card visual = PostViewer embedded.
          2 shadow cards atrás visíveis quando há nextHomePost. */}
      <main className="relative min-h-0 flex-1 overflow-hidden px-4 pt-3 pb-2">
        {posts.length === 0 ? (
          <HomeEmpty tab={useFeedStore.getState().tab} />
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
                    setSettingsScrollTo('location')
                    setShowSettings(true)
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

      {/* V7 — Compose modal (substitui inline always-mounted). */}
      <AnimatePresence>
        {showCreate && (
          <SlideUpOverlay
            onClose={() => setShowCreate(false)}
            ariaLabel="criar post"
            maxWidth="lg"
            backdropDismissible={!publishing}
          >
            <ModalHeader
              title="criar post"
              onClose={() => setShowCreate(false)}
              {...(publishing ? { hideClose: true } : {})}
            />
            <SubpostEditor
              bare
              publishing={publishing}
              capturingLocation={gpsCapturing.has('__publish__')}
              maxSubposts={userWeight.maxSubposts}
              onPublish={handlePublish}
            />
          </SlideUpOverlay>
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
              icon: '🗺',
              label: 'mapa',
              onClick: () => setShowMap(true),
              ariaLabel: 'abrir mapa de propagação',
            },
          ]}
          right={[
            {
              icon: '⚙',
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
              setSettingsScrollTo('location')
              setShowSettings(true)
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
            showDiagnostic={showDiagnostic}
            onSelect={(target) => {
              setShowSettingsRoot(false)
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
                case 'settings':
                  setSettingsScrollTo(null)
                  setShowSettings(true)
                  break
                case 'status':
                  setShowDiagnostic((s) => !s)
                  break
                case 'limpar':
                  void handleClearLocal()
                  break
              }
            }}
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
function HomeHeader({
  identity,
  userWeight,
  currentScore,
  showDiagnostic,
  onToggleDiagnostic,
  onOpenIdentity,
  onOpenSwitcher,
  onOpenRelays,
  onOpenLists,
  onClearLocal,
}: {
  identity: DriftIdentity | null
  userWeight: { weight: number; engagement: number; antiquity: number; maxSubposts: number }
  /** Score do post atualmente visível (manifesto §22). null = feed vazio. */
  currentScore: number | null
  showDiagnostic: boolean
  onToggleDiagnostic: () => void
  onOpenIdentity: () => void
  onOpenSwitcher: () => void
  onOpenRelays: () => void
  onOpenLists: () => void
  onClearLocal: () => void
}) {
  // Suprime "unused" warning — callbacks entram em V10 via long-press.
  void identity
  void userWeight
  void showDiagnostic
  void onToggleDiagnostic
  void onOpenIdentity
  void onOpenSwitcher
  void onOpenRelays
  void onOpenLists
  void onClearLocal

  return (
    <header className="shrink-0 px-5 pt-4">
      <div className="mb-[14px] flex items-center justify-between">
        <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[-0.5px] text-drift-text">
          dri<em className="not-italic text-drift-accent">ft</em>
        </h1>
        <div className="font-mono text-[10px] uppercase tracking-[1.5px] text-drift-muted">
          deriva{' '}
          <b className="font-medium text-drift-accent2">
            {currentScore !== null ? formatScore(currentScore) : '—'}
          </b>
        </div>
      </div>
      <div className="border-b border-drift-border">
        <FeedTabs />
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 22 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-40 flex flex-col bg-drift-bg"
      role="dialog"
      aria-modal="true"
      aria-label="propagação"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-drift-border px-5 py-[15px]">
        <h2 className="font-display text-[19px] font-extrabold text-drift-text">
          propagação
        </h2>
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-[10px] uppercase tracking-[1.5px] text-drift-muted"
            title="eventos recebidos pelo subscribe"
          >
            {events.toLocaleString('pt-BR')} ev
          </span>
          <button
            onClick={onClose}
            className="rounded border border-drift-border px-3 py-[5px] font-mono text-[10px] uppercase tracking-[2px] text-drift-muted transition-colors hover:text-drift-text"
            aria-label="fechar mapa"
          >
            fechar
          </button>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {currentPost ? (
          <SpreadMap
            postId={currentPost.id}
            className="h-full w-full"
            onOpenLocationSettings={onOpenLocationSettings}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-drift-muted">
            sem posts visíveis no momento
          </div>
        )}
      </div>

      <div className="absolute bottom-[18px] left-5 flex gap-[14px]">
        <span className="font-mono text-[9px] uppercase tracking-[2px] text-drift-muted">
          • ativo
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[2px] text-drift-muted">
          • recente
        </span>
      </div>
    </motion.div>
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
  | 'settings'
  | 'status'
  | 'limpar'

function SettingsRoot({
  onClose,
  onSelect,
  showDiagnostic,
}: {
  onClose: () => void
  onSelect: (target: SettingsTarget) => void
  /** Estado atual do toggle status — pra label refletir on/off. */
  showDiagnostic: boolean
}) {
  const items: { target: SettingsTarget; label: string; danger?: boolean; hint: string }[] = [
    { target: 'chave', label: 'chave', hint: 'backup/import nsec' },
    { target: 'identidades', label: 'identidades', hint: 'múltiplas identidades — manifesto §4' },
    { target: 'relays', label: 'relays', hint: 'gerenciar relays + NIP-65' },
    { target: 'listas', label: 'listas', hint: 'pinned, blocked, muted (filtros locais)' },
    { target: 'settings', label: 'settings', hint: 'filtros de conteúdo e privacidade' },
    {
      target: 'status',
      label: showDiagnostic ? 'fechar status' : 'status',
      hint: 'painel de diagnóstico',
    },
    { target: 'limpar', label: 'limpar local', danger: true, hint: 'apaga banco local — destrutivo' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 22 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-40 flex flex-col bg-drift-bg"
      role="dialog"
      aria-modal="true"
      aria-label="configurações"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-drift-border px-5 py-[15px]">
        <h2 className="font-display text-[19px] font-extrabold text-drift-text">
          configurações
        </h2>
        <button
          onClick={onClose}
          className="rounded border border-drift-border px-3 py-[5px] font-mono text-[10px] uppercase tracking-[2px] text-drift-muted transition-colors hover:text-drift-text"
          aria-label="fechar configurações"
        >
          fechar
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-[18px]">
        <ul className="divide-y divide-drift-border">
          {items.map((item) => (
            <li key={item.target}>
              <button
                onClick={() => onSelect(item.target)}
                className={`group flex w-full items-center justify-between py-[14px] text-left transition-colors ${
                  item.danger ? 'text-drift-bury' : 'text-drift-text'
                } hover:opacity-80`}
              >
                <div className="flex flex-col gap-[2px]">
                  <span className="font-mono text-[11px] uppercase tracking-[2px]">
                    {item.label}
                  </span>
                  <span className="font-mono text-[10px] text-drift-muted">
                    {item.hint}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="font-mono text-[10px] tracking-[2px] text-drift-muted transition-colors group-hover:text-drift-accent"
                >
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
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

// `timeAgo` removido em V_pre0 — vive em components/Feed/PostCard.tsx.
// Outros consumidores (PostViewer, LocalListsSettings) têm cópias
// próprias com signatures diferentes (segundos vs ms). Consolidação
// em util compartilhado é trabalho separado (Lily débito).

export default App
