/**
 * PostViewer — tela cheia de leitura com gestos. Comporta-se como uma
 * **fila estilo Tinder**: ao espalhar (↑) ou enterrar (↓), o caller
 * avança pro próximo post — o componente apenas anima a saída na
 * direção certa e o React desmonta/remonta com `key={post.id}` dentro
 * do `<AnimatePresence>` do parent.
 *
 *   ↑ swipe up    → spread + avança (próximo post desliza pra cima)
 *   ↓ swipe down  → bury   + avança (próximo post desliza pra baixo)
 *   ← →           → navega entre subposts (não avança o post)
 *   ESC ou X      → fecha sem avançar
 *
 * Respeita filtros locais (manifesto §27): posts marcados `nsfw` /
 * `violence` aparecem com blur até o tap explícito do leitor; `spoiler`
 * fica oculto até revelar. Settings local controla o default.
 *
 * O próximo post (`nextPost`) é apenas um hint visual de "tem mais X
 * posts na fila" — não é pré-renderizado por baixo (PostViewer é
 * fullscreen). Como `useFeedStore` mantém todos os posts em memória,
 * a transição React é instantânea — sem fetch, sem flash.
 */

import { lazy, useEffect, useRef, useState } from 'react'
import { LazyBoundary } from '../UI/LazyBoundary'
import { DriftSkeleton } from '../UI/DriftSkeleton'
import {
  MapIcon,
  PinIcon,
  PinOffIcon,
  WarningIcon,
  BanIcon,
  MicOffIcon,
  PlusIcon,
  CheckIcon,
  XIcon,
  ShareIcon,
  ImageIcon,
  MessageCircleIcon,
  MoreVerticalIcon,
} from '../UI/Icons'

/**
 * Renderer compartilhado: converte emoji strings (vindas de actions-fan
 * e ModerationModal item arrays) em SVG icons. actions-fan permanece
 * pure (string), tests não quebram, e UI fica consistente.
 *
 * Emojis não mapeados (📤 share, 🖼 image) renderizam como fallback —
 * actions-fan ainda funciona com Unicode.
 */
function FanIcon({
  icon,
  size = 18,
  strokeWidth,
}: {
  icon: string
  size?: number
  /** Override strokeWidth — usar 2 em ActionsFan pra legibilidade sobre foto. */
  strokeWidth?: number
}) {
  const sw = strokeWidth
  switch (icon) {
    case '📌':
      return <PinIcon size={size} strokeWidth={sw} />
    case '📍':
      return <PinOffIcon size={size} strokeWidth={sw} />
    case '🗺':
    case '🗺️':
      return <MapIcon size={size} strokeWidth={sw} />
    case '⊘':
      return <BanIcon size={size} strokeWidth={sw} />
    case '🔇':
      return <MicOffIcon size={size} strokeWidth={sw} />
    case '➕':
      return <PlusIcon size={size} strokeWidth={sw} />
    case '✓':
      return <CheckIcon size={size} strokeWidth={sw} />
    case '⚠':
      return <WarningIcon size={size} strokeWidth={sw} />
    case '📤':
      return <ShareIcon size={size} strokeWidth={sw} />
    case '🖼':
    case '🖼️':
      return <ImageIcon size={size} strokeWidth={sw} />
    default:
      return <span aria-hidden="true">{icon}</span>
  }
}
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m, AnimatePresence, useReducedMotion } from 'framer-motion'
import { MOTION } from '../../lib/motion'
import {
  DRIFT_CARD_SHADOW_BACK_CLASS,
  DRIFT_CARD_SHADOW_MID_CLASS,
} from '../UI/DriftCard'
import type { Post, RenderHint, ReportReason } from '../../types/drift'
import { dialog } from '../../lib/dialog'
import { applyContentFilters } from '../../lib/feed'
import { usePrefsStore } from '../../lib/prefs'
import { toggleSlim, useViewModeStore } from '../../lib/view-mode'
import { reportPost } from '../../lib/protocol'
import { pinPost, unpinPost } from '../../lib/cache'
import { block, mute } from '../../lib/moderation-local'
import { follow, unfollow, useFollowsStore } from '../../lib/follows'
import { db } from '../../lib/db'
import { timeAgo } from '../../lib/format'
import { SwipeHandler } from './SwipeHandler'
import { SubpostCarousel } from './SubpostCarousel'
// V9.26 — ThreadView lazy. Comments view só monta quando user
// abre o painel; carrega ~30 KB de código (CommentCard + react-virtual
// + thread-cursor) só nessa hora. Tira massa do entry chunk pra
// voltar abaixo do 300 KB hard ceiling (cwv-conformance test).
const ThreadView = lazy(() =>
  import('./ThreadView').then((m) => ({ default: m.ThreadView })),
)
import { useCommentCountsStore } from '../../lib/comment-counts'

// Round CWV-2 — lazy: ReportModal (raríssimo, gesture explícito) e
// SpreadMap (1.1 MB MapLibre + Deck.gl ArcLayer, só ao abrir map toggle).
const ReportModal = lazy(() =>
  import('./ReportModal').then((m) => ({ default: m.ReportModal })),
)
const SpreadMap = lazy(() =>
  import('../Feed/SpreadMap').then((m) => ({ default: m.SpreadMap })),
)
import { GlassIconButton } from '../UI/GlassIconButton'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { DriftChip } from '../UI/DriftChip'
import { LensInspector } from './LensInspector'
// V10.7 — `computeInitialFromExit` removido daqui (lógica inline em
// EmbeddedWrapper.variants.initial). Função pura preservada em
// `lib/post-viewer-motion.ts` por compatibilidade dos testes.
import { buildFanItems, type FanItem } from '../../lib/actions-fan'

/** 'up' = espalhou; 'down' = enterrou. Sai sem direção (X/ESC) = undefined. */
export type QueueExitDir = 'up' | 'down'

export interface QueueContext {
  /** Posição na fila (0-indexed). */
  index: number
  /** Total de posts na fila. */
  total: number
  /** Próximo post — usado pra mostrar "próximo: anon…<id>" como hint. */
  next: Post | null
}

export interface PostViewerProps {
  post: Post
  isMine: boolean
  /** `'spread' | 'bury' | null` — null = nenhuma ação pendente. */
  pendingAction: 'spread' | 'bury' | null
  /**
   * Última ação confirmada do user neste post (lida do SQLite). Usado pra
   * destacar o botão correspondente (semântica "última ação vale" —
   * manifesto §23, Mudança de opinião). User PODE clicar na ação oposta
   * pra reverter; clicar na mesma é no-op silencioso (App.tsx).
   */
  myAction?: 'spread' | 'bury' | null
  /**
   * Captura GPS em curso pra spread/bury deste post. getCurrentLocation
   * pode levar até 8s — UX precisa indicar que não travou.
   */
  capturingLocation?: boolean
  /** Direção de saída (Tinder-like). Recebida via `custom` do AnimatePresence parent. */
  custom?: QueueExitDir
  /** Metadados de fila — opcional pra abrir um post avulso fora de fila. */
  queue?: QueueContext
  /**
   * Callback opcional pra abrir Settings na seção `location`. Repassado
   * ao SpreadMap pra que o estado "GPS off" tenha um CTA acionável —
   * sem isso, user via texto sem caminho de saída.
   */
  onOpenLocationSettings?: () => void
  /**
   * V8 paradigm shift: quando true, PostViewer renderiza como **home view**
   * (não modal). Diferenças:
   *   - Sem `fixed inset-0 z-50` — usa `relative h-full w-full`
   *   - Sem backdrop bg/blur (parent já provê)
   *   - Header bulky de buttons hidden (pin/follow/mute/block/report) —
   *     migram pra menu 3-dots futuro
   *   - Footer com ↑/↓ buttons hidden — swipe é o único input
   *   - X close button hidden — não há "fechar" o home
   *   - Card stack shadow cards ficam visíveis (parent renderiza)
   *
   * Default false mantém retrocompat (modal viewer fora desta sessão).
   */
  embedded?: boolean
  onSpread: () => void
  onBury: () => void
  onClose: () => void
}

export function PostViewer({
  post,
  isMine,
  pendingAction,
  myAction = null,
  capturingLocation = false,
  custom,
  queue,
  onOpenLocationSettings,
  embedded = false,
  onSpread,
  onBury,
  onClose,
}: PostViewerProps) {
  const prefs = usePrefsStore()
  const hint: RenderHint = applyContentFilters(post, prefs)

  // Flag local: leitor pode revelar mesmo se prefs mandam blur/hide.
  // Não mexe em prefs globais — é override por post.
  const [revealed, setRevealed] = useState(!hint.blur && !hint.hide)
  // Sempre que o post muda (já que componente é reutilizado), reset.
  useEffect(() => {
    setRevealed(!hint.blur && !hint.hide)
  }, [post.id, hint.blur, hint.hide])

  const [subpostIdx, setSubpostIdx] = useState(0)
  const [showMap, setShowMap] = useState(false)
  const [showReport, setShowReport] = useState(false)
  // V_2026-05-17 (user pedido): long-press 5s mudou semantics.
  //   - Antes: abria ModerationModal (block/mute/report)
  //   - Agora: alterna modo padrão ⇄ modo slim (chrome hidden, card
  //     ocupa toda a tela)
  // Moderação foi movida pro ActionsFan como item `moderar` (mesmo
  // modal real, só trigger mudou pra menu explícito).
  // Estado local: `pressing` controla render do progress bar feedback.
  const [pressing, setPressing] = useState(false)
  const [moderationOpen, setModerationOpen] = useState(false)
  const pressTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const LONG_PRESS_MS = 5000
  const LONG_PRESS_SLOP_PX = 20
  // Acompanha slim mode pra label do progress bar feedback (mostra
  // "modo slim" quando entrando ou "modo padrão" quando saindo).
  const isSlim = useViewModeStore((s) => s.slim)
  function cancelLongPress() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    pressStartRef.current = null
    setPressing(false)
  }
  function handleCardPointerDown(e: React.PointerEvent) {
    // V10.6 (2026-05-15): opt-out explícito via `data-no-longpress` —
    // dots/⋮/buttons explícitos não devem virar long-press. Imagem
    // lightbox passa pelo gesto (vira slim toggle no novo modelo).
    // Links genéricos (`a`) seguem bailing.
    //
    // V_2026-05-17: removido `if (isMine) return` — slim toggle se
    // aplica também em posts próprios (não há razão semântica pra
    // restringir; era restrição de moderação antiga).
    const target = e.target as Element | null
    if (
      target &&
      target.closest &&
      (target.closest('a') || target.closest('[data-no-longpress]'))
    )
      return
    pressStartRef.current = { x: e.clientX, y: e.clientY }
    setPressing(true)
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      setPressing(false)
      pressStartRef.current = null
      navigator.vibrate?.(50)
      toggleSlim()
    }, LONG_PRESS_MS)
  }
  function handleCardPointerMove(e: React.PointerEvent) {
    if (!pressStartRef.current) return
    const dx = e.clientX - pressStartRef.current.x
    const dy = e.clientY - pressStartRef.current.y
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) cancelLongPress()
  }
  useEffect(() => () => cancelLongPress(), [])
  const [reporting, setReporting] = useState(false)
  const [pinned, setPinned] = useState<boolean | null>(null) // null = loading
  // V11: menu de ações no embedded mode (substitui os 8 botões do
  // header bulky pré-V8). Acionado pelo botão ⋮ no canto top-right
  // do card. Lista pin/map/follow/mute/block/report.
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  // Track C.4.2 — ThreadView overlay (lazy mount, on-demand)
  const [showThread, setShowThread] = useState(false)
  // Track C.6.1 — count prefetch reativo. 0 default; reage a
  // `bumpCommentCount` em events.ts quando comments novos chegam.
  const commentCount = useCommentCountsStore(
    (s) => s.countByPost[post.id] ?? 0,
  )
  const isFollowing = useFollowsStore((s) => s.following.has(post.authorPub))
  const total = post.subposts.length

  // Optimistic UI (manifesto §10 + arquitetura §2.4): contador soma +1
  // imediato quando user clica espalhar/enterrar. Quando o evento real
  // chega via subscribe e atualiza post.spreads/buries, `pendingAction`
  // é limpo pelo useEffect em App.tsx e o display volta ao real
  // (já incluindo o evento confirmado, sem flicker).
  const displaySpreads = post.spreads + (pendingAction === 'spread' ? 1 : 0)
  const displayBuries = post.buries + (pendingAction === 'bury' ? 1 : 0)

  // Estado visual efetivo: pending (em vôo) > myAction (confirmada).
  // "Última ação vale" — botão destacado mostra o que conta no score.
  const effectiveAction: 'spread' | 'bury' | null = pendingAction ?? myAction
  const spreadActive = effectiveAction === 'spread'
  const buryActive = effectiveAction === 'bury'

  // Carrega estado de pin
  useEffect(() => {
    let cancelled = false
    void db
      .get<{ n: number }>(
        `SELECT 1 AS n FROM pinned WHERE post_id = ? LIMIT 1`,
        [post.id],
      )
      .then((row) => {
        if (!cancelled) setPinned(row !== null)
      })
      .catch(() => {
        if (!cancelled) setPinned(false)
      })
    return () => {
      cancelled = true
    }
  }, [post.id])

  async function handleReport(reason: ReportReason) {
    if (reporting) return
    setReporting(true)
    try {
      await reportPost({ postId: post.id, authorPub: post.authorPub, reason })
      setShowReport(false)
    } catch (err) {
      console.error('report failed', err)
      await dialog.alert(
        `Falha ao denunciar: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    } finally {
      setReporting(false)
    }
  }

  async function handleTogglePin() {
    if (pinned === null) return
    const next = !pinned
    setPinned(next)
    try {
      if (next) await pinPost(post.id)
      else await unpinPost(post.id)
    } catch (err) {
      console.error('pin toggle failed', err)
      setPinned(!next) // revert
    }
  }

  async function handleBlock() {
    const ok = await dialog.confirm(
      `Posts e interações deste autor somem do SEU feed (manifesto §24 — filtro local).\nNão muda o score nem afeta outros usuários.\nVocê pode desbloquear depois em Ajustes → listas.`,
      { title: 'bloquear autor', dangerous: true, okLabel: 'bloquear' },
    )
    if (!ok) return
    try {
      await block(post.authorPub)
      onClose()
    } catch (err) {
      await dialog.alert(
        `Falha ao bloquear: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    }
  }

  async function handleMute() {
    try {
      await mute(post.authorPub)
      onClose()
    } catch (err) {
      await dialog.alert(
        `Falha ao silenciar: ${err instanceof Error ? err.message : String(err)}`,
        { title: 'erro' },
      )
    }
  }

  // V9.18 (user pedido 2026-05-14): substituir as opções nativas do
  // browser que foram suprimidas (copiar/baixar/compartilhar imagem)
  // por handlers próprios. Compartilhar post via njump.me — gateway
  // público que resolve nevent1 em qualquer cliente Nostr. Imagem via
  // Web Share API com files (mobile moderno), fallback URL share, e
  // último fallback clipboard.
  async function handleSharePost() {
    try {
      const { neventEncode } = await import('nostr-tools/nip19')
      const { activeWriteRelays } = await import('../../lib/relays')
      const nevent = neventEncode({
        id: post.id,
        author: post.authorPub,
        kind: 9078,
        relays: activeWriteRelays().slice(0, 3),
      })
      // V9.20 (user pedido 2026-05-14): URL volta pro domínio do app
      // com `?p=<nevent>` — quem clicar abre o Drift direto, fora do
      // Drift cai na home (App.tsx consome o param no mount, busca o
      // evento via relay e materializa). Mantém formato nevent pra
      // outros clientes Nostr também conseguirem decodificar.
      const url = `${window.location.origin}/?p=${nevent}`
      const firstText = post.subposts[0]?.text?.slice(0, 100) ?? ''
      if (navigator.share) {
        await navigator.share({ url, title: 'drift', text: firstText })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        await dialog.alert(`Link copiado: ${url}`, { title: 'compartilhar' })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.warn('[share-post] falhou:', err)
    }
  }

  async function handleShareImage() {
    const current = post.subposts[subpostIdx]
    if (!current?.imageUrl) return
    try {
      const res = await fetch(current.imageUrl)
      const blob = await res.blob()
      const ext = (blob.type.split('/')[1] ?? 'jpg').replace('+xml', '')
      const file = new File(
        [blob],
        `drift-${post.id.slice(0, 8)}.${ext}`,
        { type: blob.type },
      )
      const canShareFiles = !!navigator.canShare?.({ files: [file] })
      if (canShareFiles && navigator.share) {
        await navigator.share({ files: [file] })
      } else if (navigator.share) {
        await navigator.share({ url: current.imageUrl })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(current.imageUrl)
        await dialog.alert(`Link da imagem copiado`, { title: 'compartilhar imagem' })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.warn('[share-image] falhou:', err)
    }
  }

  async function handleFollowToggle() {
    try {
      if (isFollowing) await unfollow(post.authorPub)
      else await follow(post.authorPub)
    } catch (err) {
      await dialog.alert(
        `Falha ao ${isFollowing ? 'deixar de seguir' : 'seguir'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { title: 'erro' },
      )
    }
  }

  // V9.9 (user report 2026-05-09: "com 2 subposts passar pro lado não
  // está passando"). Era clamp não-circular: em idx=0 swipe→prev ficava
  // em 0 (sem feedback); em idx=last swipe→next ficava em last. Com 2
  // subposts o user sempre está numa ponta, metade dos swipes parecia
  // morta. Agora circular via modulo — consistente com onTap
  // (tap-to-advance já usava `(i + 1) % total`). Total <= 0 não acontece
  // (SwipeHandler tem disableHorizontal nesse caso, esta func não dispara).
  function next() {
    setSubpostIdx((i) => (i + 1) % total)
  }
  function prev() {
    setSubpostIdx((i) => (i - 1 + total) % total)
  }

  // ESC fecha. (SwipeHandler já cuida das setas, mas registramos ESC
  // só aqui pra evitar fechar acidental num gesto.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Animação direcional Tinder-style. Entrada vem "de baixo" com um
  // discreto scale-up — sensação de "card que estava na pilha subindo
  // pra frente". Saída voa pra cima (espalhou) ou pra baixo (enterrou)
  // conforme `custom` do AnimatePresence parent. Sem `custom` (X/ESC),
  // fade out simples. V10.7 — passamos `custom` direto pros wrappers;
  // EmbeddedWrapper usa variants pra ler o custom MAIS RECENTE no exit
  // (antes era exitVariant estático, congelado em snapshot antiga →
  // direção errada ao alternar swipes).

  // V8 embedded mode: home view, sem fixed-inset / sem role=dialog /
  // sem backdrop. ModalWrapper foi removido em Round 12 (dead code
  // pós-V8). `embedded` prop fica como deprecation no-op até cleanup
  // dedicado das branches `!embedded` em render path.
  const Wrapper = EmbeddedWrapper
  void embedded // silenciar unused — branches !embedded ainda existem.

  return (
    <Wrapper custom={custom}>
      {/* Header bulky com pin/follow/mute/block/report — só em modal mode.
          Em embedded (V8), o header global do app + a tag row dentro do
          card já entregam contexto; ações secundárias migram pra menu
          3-dots futuro. */}
      {!embedded && (
      <div className="flex items-center justify-between border-b border-drift-border px-4 py-3 text-fluid-xs text-drift-muted">
        <span className="font-mono">
          <span className="font-display font-bold uppercase tracking-wider text-drift-text">
            {isMine ? 'você' : 'anon'}…{post.authorPub.slice(-8)}
          </span>
          {' · '}
          {timeAgo(post.createdAt)}
          {post.contentWarning && (
            <DriftChip
              variant="warning"
              size="xs"
              active
              icon="⚠"
              className="ml-2"
              ariaLabel={`aviso de conteúdo: ${post.contentWarning}`}
            >
              {post.contentWarning}
            </DriftChip>
          )}
        </span>
        <div className="flex items-center gap-3 font-mono">
          <span title={`drifts ${displaySpreads} · sinks ${displayBuries}`}>
            <span className="uppercase tracking-widest text-drift-muted">DERIVA</span>{' '}
            <span className="font-medium text-drift-text">{post.score.toFixed(3)}</span>
          </span>
          <button
            onClick={handleTogglePin}
            disabled={pinned === null}
            className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded border px-2 ${
              pinned
                ? 'border-drift-warning text-drift-warning'
                : 'border-drift-border hover:border-drift-warning hover:text-drift-warning'
            } disabled:opacity-40`}
            title={
              pinned
                ? 'fixado — protegido de eviction (manifesto §16)'
                : 'fixar — protege de eviction local + marca pra re-broadcast'
            }
            aria-label={pinned ? 'Desfixar' : 'Fixar'}
          >
            {pinned ? <PinIcon size={16} /> : <PinOffIcon size={16} />}
          </button>
          <button
            onClick={() => setShowMap((v) => !v)}
            className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded border px-2 ${
              showMap
                ? 'border-drift-accent text-drift-accent'
                : 'border-drift-border hover:border-drift-accent hover:text-drift-accent'
            }`}
            title="mapa de deriva"
            aria-label="Abrir mapa"
          >
            <MapIcon size={18} />
          </button>
          {!isMine && (
            <>
              <button
                onClick={handleFollowToggle}
                className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded border px-2 ${
                  isFollowing
                    ? 'border-drift-accent text-drift-accent'
                    : 'border-drift-border hover:border-drift-accent hover:text-drift-accent'
                }`}
                title={
                  isFollowing
                    ? 'deixar de seguir — publica kind 3 atualizado'
                    : 'seguir — alimenta a aba "seguindo" do feed (NIP-02)'
                }
                aria-label={isFollowing ? 'Deixar de seguir' : 'Seguir'}
              >
                {isFollowing ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              </button>
              <button
                onClick={handleMute}
                className="inline-flex h-11 min-w-[44px] items-center justify-center rounded border border-drift-border px-2 hover:border-drift-warning hover:text-drift-warning"
                title="silenciar autor — só esconde posts dele do meu feed (manifesto §24)"
                aria-label="Silenciar"
              >
                <MicOffIcon size={16} />
              </button>
              <button
                onClick={handleBlock}
                className="inline-flex h-11 min-w-[44px] items-center justify-center rounded border border-drift-border px-2 hover:border-drift-danger hover:text-drift-danger"
                title="bloquear autor — esconde posts e interações dele (manifesto §24)"
                aria-label="Bloquear"
              >
                <BanIcon size={16} />
              </button>
              <button
                onClick={() => setShowReport(true)}
                className="inline-flex h-11 min-w-[44px] items-center justify-center rounded border border-drift-border px-2 hover:border-drift-danger hover:text-drift-danger"
                title="denunciar — manifesto §26"
                aria-label="Denunciar"
              >
                <WarningIcon size={16} />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="inline-flex h-11 min-w-[44px] items-center justify-center rounded border border-drift-border px-2 hover:border-drift-accent hover:text-drift-accent"
            aria-label="Fechar"
          >
            <XIcon size={16} />
          </button>
        </div>
      </div>
      )}

      <AnimatePresence>
        {showMap && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 240, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-drift-border"
          >
            <LazyBoundary fallback={<DriftSkeleton variant="image" aspect="16/9" />}>
              <SpreadMap
                postId={post.id}
                className="h-60 w-full"
                {...(onOpenLocationSettings ? { onOpenLocationSettings } : {})}
              />
            </LazyBoundary>
          </m.div>
        )}
      </AnimatePresence>

      {/* Conteúdo com gestos — V3.1 card stack:
          2 shadow cards atrás (próximos da fila) com scale 0.96/0.92,
          translateY 7px/14px, opacity 0.4/0.18. Efeito Tinder de "tem
          mais posts atrás". Aria-hidden — visual puro. */}
      <div
        className="relative flex-1"
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
      >
        {/* V9.16 — long-press progress bar (top edge, 4px, drift-bury).
            Preenche linearmente em 5s. V9.24 — label "moderação" central
            aparece em 600ms (após o user já passou da janela de "tap
            normal") pra dar contexto do que está acontecendo. Sem label,
            o user via uma barra vermelha aparecendo sem motivo aparente
            (bad discoverability). */}
        <AnimatePresence>
          {pressing && (
            <>
              {/* Progress bar 5s — drift-accent2 (neutro, era drift-bury
                  na semântica antiga de moderar). Label aparece em 600ms
                  pós-pressing pra contexto. */}
              <m.div
                className="pointer-events-none absolute inset-x-0 top-0 z-[15] h-1 origin-left bg-drift-accent2"
                initial={{ scaleX: 0, opacity: 0.9 }}
                animate={{ scaleX: 1 }}
                exit={{ opacity: 0, scaleX: 1, transition: { duration: 0.18 } }}
                transition={{ duration: LONG_PRESS_MS / 1000, ease: 'linear' }}
              />
              <m.div
                className="pointer-events-none absolute inset-x-0 top-2 z-[15] flex items-center justify-center"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, delay: 0.6 }}
              >
                <span className="rounded-full border border-drift-accent2/60 bg-drift-bg/85 px-3 py-1 font-mono text-[12px] uppercase tracking-meta text-drift-accent2 backdrop-blur-sm">
                  {isSlim ? 'segure pra sair do slim' : 'segure pra modo slim'}
                </span>
              </m.div>
            </>
          )}
        </AnimatePresence>
        {/* V11 — botão ⋮ menu de ações (embedded mode only).
            Absolute top-right do card area, z-30 pra ficar acima do
            SwipeHandler. onClick stopPropagation pra evitar conflito
            com swipe gesture. Mockup-aligned: ícone discreto, abre
            SlideUpOverlay com lista de ações. */}
        {embedded && (
          <>
            <GlassIconButton
              onClick={(e) => {
                e.stopPropagation()
                setShowActionsMenu((v) => !v)
              }}
              size="xl"
              className="absolute right-4 top-4 z-30"
              aria-label={showActionsMenu ? 'fechar ações' : 'abrir ações'}
              title="ações rápidas"
              // V10.6 — opt-out de long-press (segurar ⋮ não deve virar
              // moderation; ⋮ é ação explícita de abrir fan menu).
              data-no-longpress="true"
            >
              <span aria-hidden="true">
                {showActionsMenu ? (
                  <XIcon size={18} strokeWidth={2} />
                ) : (
                  <MoreVerticalIcon size={18} strokeWidth={2} />
                )}
              </span>
            </GlassIconButton>
            {/* V9.15 (user pedido 2026-05-14): tap em ⋮ expande em fan
                de quick actions. V_2026-05-17: item `moderar` adicionado
                ao fan (era ativado por long-press 5s antes; 5s agora
                alterna modo slim). */}
            <ActionsFan
              visible={showActionsMenu}
              isMine={isMine}
              pinned={pinned}
              isFollowing={isFollowing}
              mapOpen={showMap}
              currentHasImage={!!post.subposts[subpostIdx]?.imageUrl}
              onPinToggle={() => {
                void handleTogglePin()
                setShowActionsMenu(false)
              }}
              onMapToggle={() => {
                setShowMap((v) => !v)
                setShowActionsMenu(false)
              }}
              onFollowToggle={() => {
                void handleFollowToggle()
                setShowActionsMenu(false)
              }}
              onMute={() => {
                void handleMute()
                setShowActionsMenu(false)
              }}
              onSharePost={() => {
                void handleSharePost()
                setShowActionsMenu(false)
              }}
              onShareImage={() => {
                void handleShareImage()
                setShowActionsMenu(false)
              }}
              onOpenModeration={() => {
                setModerationOpen(true)
                setShowActionsMenu(false)
              }}
            />
            {/* Track C.4.2 — trigger pra ThreadView (comments). Round
                CWV-4 a11y 2026-05-09: bumped h-7→h-11 (WCAG 2.5.5 AA
                tap target 44px). min-w mantém pílula expansível pro
                badge de count. */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowThread(true)
              }}
              className="absolute right-[68px] top-4 z-30 flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border border-drift-border bg-drift-surface/80 px-3 text-drift-muted backdrop-blur-sm transition-colors hover:border-drift-accent2 hover:text-drift-accent2 focus:outline-none focus:ring-1 focus:ring-drift-accent2"
              style={{ touchAction: 'manipulation' }}
              aria-label={`abrir comentários${commentCount > 0 ? ` (${commentCount})` : ''}`}
              title="comentários (thread)"
            >
              {/* Round Lily 2026-05-17 (B): emoji 💬 colorido destoava
                  do design system stroke-based. MessageCircleIcon
                  monocromático currentColor herda text-drift-muted +
                  hover text-drift-accent2 do button. */}
              <span aria-hidden="true">
                <MessageCircleIcon size={18} strokeWidth={2} />
              </span>
              {commentCount > 0 && (
                <span className="text-[12px] leading-none font-mono tabular-nums">
                  {commentCount}
                </span>
              )}
            </button>
            {/* Trust Lens inspector chip — bottom-right do card.
                Aparece só quando lens strength > 0 E post foi tocado. */}
            <LensInspector postId={post.id} authorPub={post.authorPub} />
          </>
        )}
        {queue && queue.next && (
          <>
            {/* Shadow stack (Tinder-style fila). Round 4 Fase A: usa
                constants exported de DriftCard primitive (variant
                shadow-stack). Inset-x-4/top-4/bottom-4 preserva margem
                visual do PostViewer (DriftCard helpers usam inset-0
                puro; aqui há margem do header/footer). */}
            <div
              aria-hidden="true"
              className={`${DRIFT_CARD_SHADOW_BACK_CLASS} inset-x-4 top-4 bottom-4 inset-auto`.replace('inset-0', '')}
              style={{ transform: 'translateY(14px) scale(0.92)', opacity: 0.18 }}
            />
            <div
              aria-hidden="true"
              className={`${DRIFT_CARD_SHADOW_MID_CLASS} inset-x-4 top-4 bottom-4 inset-auto`.replace('inset-0', '')}
              style={{ transform: 'translateY(7px) scale(0.96)', opacity: 0.4 }}
            />
          </>
        )}
        <SwipeHandler
          onSpread={pendingAction === null ? onSpread : undefined}
          onBury={pendingAction === null ? onBury : undefined}
          onPrev={total > 1 ? prev : undefined}
          onNext={total > 1 ? next : undefined}
          // V9.13 (user feedback 2026-05-09: "swipe é o que avança, não
          // o click"): onTap não avança mais subpost. Antes ele empilhava
          // duas responsabilidades no mesmo gesto (advance + reveal CW)
          // e disputava com o onClick do Image button (lightbox), criando
          // bugs cruzados em cada tuning de swipe. Agora:
          //   - swipe horizontal → onPrev/onNext (Framer drag)
          //   - tap em segment da Instagram bar → onSelect(idx)
          //   - tap na imagem → double-tap counter abre lightbox
          //   - tap em área neutra com CW blurred → reveal
          // Sem tap-to-advance.
          onTap={
            !revealed
              ? () => setRevealed(true)
              : undefined
          }
          disableHorizontal={total <= 1}
        >
          <div className="relative h-full w-full bg-drift-surface">
            <div
              className={`h-full w-full transition-[filter] duration-200 ${
                !revealed ? 'pointer-events-none blur-xl' : ''
              }`}
            >
              <SubpostCarousel
                subposts={post.subposts}
                index={subpostIdx}
                post={post}
                onSelect={setSubpostIdx}
              />
            </div>

            {!revealed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <span className="text-xs uppercase tracking-widest text-drift-warning">
                  ⚠ {hint.reason ?? 'conteúdo marcado'}
                </span>
                <button
                  onClick={() => setRevealed(true)}
                  className="rounded border border-drift-accent px-4 py-2 text-xs uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
                >
                  toque pra revelar
                </button>
                <span className="text-[12px] text-drift-muted">
                  você pode mudar isso em settings
                </span>
              </div>
            )}
          </div>
        </SwipeHandler>
      </div>

      {/* Footer com ações + dicas — V3.1 paleta v0.7.
          V8: hidden em embedded mode (swipe é o único input no home view). */}
      {!embedded && (
      <div className="flex items-center justify-between border-t border-drift-border px-4 py-3 font-mono text-[12px] text-drift-muted">
        <div className="flex gap-3">
          <span className="text-drift-spread">↑ {displaySpreads}</span>
          <span className="text-drift-bury">↓ {displayBuries}</span>
          {total > 1 && (
            <span className="text-drift-text">
              {subpostIdx + 1} / {total}
            </span>
          )}
          {queue && queue.total > 1 && (
            <span
              className="text-drift-muted"
              title="posição na fila — ↑/↓ avança automaticamente"
            >
              fila {queue.index + 1}/{queue.total}
            </span>
          )}
        </div>
        <div className="hidden gap-3 sm:flex">
          {queue?.next ? (
            <span title="próximo da fila">
              próximo: anon…{queue.next.authorPub.slice(-6)}
            </span>
          ) : (
            <span>↑ DRIFT · ↓ SINK{total > 1 && ' · ← → navega'}</span>
          )}
        </div>
        <div className="flex gap-2">
          {/* Track C.4.2 — comments trigger (modal mode) */}
          <button
            onClick={() => setShowThread(true)}
            className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded border border-drift-border px-2 text-drift-muted hover:border-drift-accent2 hover:text-drift-accent2"
            title="abrir comentários"
            aria-label={`Comentários${commentCount > 0 ? ` (${commentCount})` : ''}`}
          >
            <span aria-hidden="true">
              <MessageCircleIcon size={18} strokeWidth={2} />
            </span>
            {commentCount > 0 && (
              <span className="text-[12px] leading-none font-mono tabular-nums">
                {commentCount}
              </span>
            )}
          </button>
          <button
            onClick={onSpread}
            disabled={pendingAction !== null}
            className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded border px-2 disabled:opacity-40 ${
              spreadActive
                ? 'border-drift-spread bg-drift-spread/15 text-drift-spread'
                : 'border-drift-spread/40 text-drift-spread hover:bg-drift-spread/10'
            }`}
            title={
              capturingLocation && pendingAction === 'spread'
                ? 'capturando localização (até 8s)'
                : myAction === 'spread'
                ? 'você driftou — ↓ pra mudar de opinião'
                : undefined
            }
            aria-pressed={spreadActive}
          >
            {pendingAction === 'spread'
              ? capturingLocation
                ? '📍'
                : '…'
              : '↑'}
          </button>
          <button
            onClick={onBury}
            disabled={pendingAction !== null}
            className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded border px-2 disabled:opacity-40 ${
              buryActive
                ? 'border-drift-bury bg-drift-bury/15 text-drift-bury'
                : 'border-drift-bury/40 text-drift-bury hover:bg-drift-bury/10'
            }`}
            title={
              myAction === 'bury'
                ? 'você sinkou — ↑ pra mudar de opinião'
                : undefined
            }
            aria-pressed={buryActive}
          >
            {pendingAction === 'bury' ? '…' : '↓'}
          </button>
        </div>
      </div>
      )}

      <AnimatePresence>
        {showReport && (
          <LazyBoundary fallback={<DriftSkeleton variant="card" />}>
            <ReportModal
              post={post}
              pending={reporting}
              onSubmit={handleReport}
              onClose={() => setShowReport(false)}
            />
          </LazyBoundary>
        )}
      </AnimatePresence>

      {/* Track C.4.2 — ThreadView overlay (acima de tudo, z-60).
          Lazy mount: só renderiza quando showThread=true. Cleanup ao
          fechar libera subscribe (refcount em comments.ts). */}
      <AnimatePresence>
        {showThread && (
          <LazyBoundary fallback={<DriftSkeleton variant="card" />}>
            <ThreadView
              postId={post.id}
              postAuthorPub={post.authorPub}
              post={post}
              onClose={() => setShowThread(false)}
            />
          </LazyBoundary>
        )}
      </AnimatePresence>

      {/* V9.16 — moderation modal (long-press 5s gate). Block e Report
          são ações sensíveis (filtragem local destrutiva + denúncia
          comunitária). Cada item chama o handler existente, que já tem
          dialog.confirm próprio com explicação. */}
      <AnimatePresence>
        {moderationOpen && !isMine && (
          <ModerationModal
            onClose={() => setModerationOpen(false)}
            onBlock={() => {
              setModerationOpen(false)
              void handleBlock()
            }}
            onReport={() => {
              setModerationOpen(false)
              setShowReport(true)
            }}
          />
        )}
      </AnimatePresence>
    </Wrapper>
  )
}


// ─── ModerationModal ─────────────────────────────────────────────────

/**
 * V9.16 — modal de moderação. Acionado por long-press 5s no card. Lista
 * só 2 itens (Bloquear, Denunciar). Cada um chama o handler que abre o
 * dialog.confirm/ReportModal com explicação + Cancelar/Confirmar — o
 * gate de 5s + o dialog são camadas independentes de fricção contra
 * dispara acidental ou impulsivo.
 */
function ModerationModal({
  onClose,
  onBlock,
  onReport,
}: {
  onClose: () => void
  onBlock: () => void
  onReport: () => void
}) {
  type Item = {
    key: string
    icon: string
    label: string
    hint: string
    onClick: () => void
  }
  const items: Item[] = [
    {
      key: 'block',
      icon: '⊘',
      label: 'bloquear',
      hint: 'esconde posts e interações deste autor do meu feed (manifesto §24)',
      onClick: onBlock,
    },
    {
      key: 'report',
      icon: '⚠',
      label: 'denunciar',
      hint: 'reporta pra moderação comunitária (manifesto §26)',
      onClick: onReport,
    },
  ]
  return (
    <SlideUpOverlay onClose={onClose} ariaLabel="moderação">
      <ModalHeader title="moderação" onClose={onClose} />
      <ul className="-mx-1 divide-y divide-drift-border">
        {items.map((item) => (
          <li key={item.key}>
            <button
              onClick={item.onClick}
              className="group flex w-full items-center gap-3 px-1 py-3 text-left text-drift-bury transition-colors hover:text-drift-danger focus:outline-none focus:ring-1 focus:ring-drift-accent2 focus:ring-offset-2 focus:ring-offset-drift-surface"
              style={{ touchAction: 'manipulation' }}
            >
              <span aria-hidden="true" className="text-[16px] leading-none">
                <FanIcon icon={item.icon} size={16} />
              </span>
              <span className="flex flex-1 flex-col gap-[2px]">
                <span className="font-mono text-[12px] uppercase tracking-[2px]">
                  {item.label}
                </span>
                <span className="font-mono text-[12px] normal-case tracking-normal text-drift-muted">
                  {item.hint}
                </span>
              </span>
              <span aria-hidden="true" className="font-mono text-[12px] text-drift-muted transition-colors group-hover:text-current">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </SlideUpOverlay>
  )
}

// ─── ActionsFan ──────────────────────────────────────────────────────

/**
 * V9.15 — fan vertical de quick actions expandido pelo ⋮. 4 ações:
 * mapa, fixar, seguir, silenciar (last two só quando !isMine). Cada
 * GlassIconButton xl posicionado absolute right-4, com top calculado
 * (60 + i*48) descendo a partir do ⋮. Stagger 40ms na entrada via
 * Framer Motion.
 *
 * Block/Report saíram daqui — long-press 5s ativa modal de moderação
 * (Phase 2). Decisão: ações destrutivas precisam fricção intencional.
 */
function ActionsFan({
  visible,
  isMine,
  pinned,
  isFollowing,
  mapOpen,
  currentHasImage,
  onPinToggle,
  onMapToggle,
  onFollowToggle,
  onMute,
  onSharePost,
  onShareImage,
  onOpenModeration,
}: {
  visible: boolean
  isMine: boolean
  pinned: boolean | null
  isFollowing: boolean
  mapOpen: boolean
  /** Subpost atual tem imagem? Controla render do share-image. */
  currentHasImage: boolean
  onPinToggle: () => void
  onMapToggle: () => void
  onFollowToggle: () => void
  onMute: () => void
  onSharePost: () => void
  onShareImage: () => void
  onOpenModeration: () => void
}) {
  const items: FanItem[] = buildFanItems({
    isMine,
    pinned,
    isFollowing,
    mapOpen,
    currentHasImage,
    handlers: {
      onPinToggle,
      onMapToggle,
      onFollowToggle,
      onMute,
      onSharePost,
      onShareImage,
      onOpenModeration,
    },
  })

  // V11.8 (user feedback 2026-05-17 round 4 — design critique completa):
  // 6 mudanças coordenadas em resposta a:
  //   "contraste + hierarquia visual + affordance" — botões soltos
  //   competiam com vazio, ícones finos morriam em mobile, destrutivo
  //   tinha mesmo peso que neutro.
  //
  // (1) **Container único** envolve TODOS os items neutros: rounded-2xl
  //     glass card (bg-drift-surface/85 + backdrop-blur-md + border
  //     drift-border/60 + shadow). Cria agrupamento, aumenta legibilidade,
  //     melhora percepção de toque.
  //
  // (2) **Ícones mais grossos** — strokeWidth 2.0 (era 1.5 default
  //     Feather), size 22 (era 20). Glyph não morre em mobile.
  //
  // (3) **Contraste alto** — border-drift-accent/55, text-drift-text
  //     (não muted), bg-drift-surface/90. User explicitly: "ícone mais
  //     escuro · borda mais definida".
  //
  // (6) **Destrutivo isolado** — `moderar` (warning ⚠) sai do container
  //     neutro pra render abaixo, com cor semântica drift-bury + sem
  //     glass wrapping. Não compete visualmente com ações neutras.
  //
  // (+) Labels permanentes mantidas (V11.7) — agora INSIDE container
  //     pra alinharem com a borda visual única.
  //
  // (-) #4 active-state-per-action e #5 reduce-visible-to-3 ficam pra
  //     rounds separados (precisam wiring de estado por ação + decisão
  //     UX de qual subset é 'principal').
  //
  // Separação: neutralItems (mostrados no container) vs destructiveItems
  // (renderizados abaixo, sem container). Discriminação por item.key.
  const neutralItems = items.filter((it) => it.key !== 'moderar')
  const destructiveItems = items.filter((it) => it.key === 'moderar')

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          key="fan-container"
          initial={{ opacity: 0, y: -8, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.92 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute right-4 z-30 flex flex-col items-end gap-2"
          style={{ top: `60px` }}
          // BUG-LONGPRESS-FAN fix — opt-out do long-press 5s do card
          // parent. Touch sustentado no fan não deve disparar slim toggle.
          data-no-longpress="true"
        >
          {/* V11.11 (2026-05-17 round 7 — Lily audit inline depois de user
              "está feio"). Mudanças coordenadas:
              (1) MODERAR vira ÚLTIMA ROW do container (separator border-
                  top drift-bury/30). Antes era mini-container separado —
                  parecia afterthought. Agora é uma seção destrutiva
                  dentro do mesmo menu.
              (2) Inner buttons PERDEM border+bg próprio. Container já
                  provê chrome; circle-inside-rectangle era ruído (esp.
                  em Velatura, 3 papéis competindo). Hover ganha bg-
                  drift-accent/10 (era /15) — mais sutil.
              (3) Active state ad-hoc pra mapOpen=true: row inteira
                  ganha bg-drift-accent/8 + text-drift-accent — user vê
                  que o mapa está aberto sem clicar. (#4 critique
                  parcialmente fechado.) */}
          <div
            className="flex flex-col rounded-2xl border border-drift-border bg-drift-surface p-1.5 shadow-lg"
            role="group"
            aria-label="ações do post"
          >
            {neutralItems.map((item, i) => {
              // Active state: por enquanto só mapOpen (icon é '🗺' OR
              // do mapa). buildFanItems já swap icons pra pinned/follow
              // (📌/📍, ✓/➕), então estado visual deles vem do icon.
              // mapOpen não muda icon → adicionamos visual aqui.
              const isActive = item.key === 'mapa' && mapOpen
              return (
                <m.div
                  key={item.key}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.16, delay: i * 0.035, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex items-center justify-end gap-3 rounded-lg px-1 py-0.5 transition-colors ${
                    isActive ? 'bg-drift-accent/10' : ''
                  }`}
                >
                  <span
                    className={`pointer-events-none whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-meta ${
                      isActive ? 'text-drift-accent' : 'text-drift-text'
                    }`}
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                  {/* Inner button SEM border/bg — só hover effect. Container
                      é o chrome. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!item.disabled) item.onClick()
                    }}
                    disabled={item.disabled}
                    aria-label={item.label}
                    title={item.hint}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-drift-accent/10 hover:text-drift-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 disabled:cursor-not-allowed disabled:opacity-40 ${
                      isActive ? 'text-drift-accent' : 'text-drift-text'
                    }`}
                  >
                    <span aria-hidden="true">
                      <FanIcon icon={item.icon} size={22} strokeWidth={2} />
                    </span>
                  </button>
                </m.div>
              )
            })}
            {/* (1) MODERAR INSIDE container — separator border-top drift-
                bury/30 anuncia a seção destrutiva sem precisar de mini-
                container próprio. mt-1.5 + pt-1.5 cria respiro visual. */}
            {destructiveItems.map((item, i) => (
              <m.div
                key={item.key}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.16, delay: 0.035 * (neutralItems.length + i), ease: [0.22, 1, 0.36, 1] }}
                className="mt-1.5 flex items-center justify-end gap-3 border-t border-drift-bury/30 px-1 pt-1.5 pb-0.5"
              >
                <span
                  className="pointer-events-none whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-meta text-drift-bury"
                  aria-hidden="true"
                >
                  {item.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!item.disabled) item.onClick()
                  }}
                  disabled={item.disabled}
                  aria-label={item.label}
                  title={item.hint}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-drift-bury transition-colors hover:bg-drift-bury/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-bury disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">
                    <FanIcon icon={item.icon} size={22} strokeWidth={2} />
                  </span>
                </button>
              </m.div>
            ))}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}

// ─── Wrapper (embedded mode) ─────────────────────────────────────────

interface WrapperProps {
  children: React.ReactNode
  // V10.7 — `custom` (direção da exit-action). Optional porque
  // PostViewerProps.custom também é optional (X/ESC close sem direção).
  // EmbeddedWrapper trata `undefined` como fade simples via variants.
  custom?: QueueExitDir
}

// ModalWrapper removido em [59741c6] (Round 12 2026-05-17): dead code
// pós-V8 home-view transition. Único call site (App.tsx PostViewer)
// passa `embedded` → branch ModalWrapper jamais executou em produção.
// Manter exit branches em render path por enquanto (cleanup separado
// se justificar); o que ia trigger conformance role="dialog" + fixed-
// inset-z-50 fora de allowlist sumiu junto. Allowlist OVERLAY_LEGACY
// ratchet: 2 → 1 entry restante (ThreadView tree exceção).

/**
 * V8 embedded mode: PostViewer como home view (não modal). Sem
 * fixed-inset (parent provê layout flex), sem role=dialog, sem
 * backdrop. Anima exit direcional (Tinder-style "voa pra cima/baixo")
 * quando custom='up'|'down'.
 *
 * V10.7 (user report 2026-05-15: "alternando up/down a animação buga,
 * sai rápido e às vezes na direção contrária"). Causa: `exit` era um
 * OBJETO ESTÁTICO computado em PostViewer render. Quando user alterna
 * direção, o PostViewer antigo já foi renderizado com a direção
 * ANTERIOR — seu exit prop ficou congelado nessa snapshot. Framer usa
 * o exit do snapshot durante exit, mesmo que a direção atual seja
 * outra → card sai pra direção errada. Fix: trocar pra `variants`
 * com funções que recebem `custom`. AnimatePresence passa o `custom`
 * MAIS RECENTE pra essas funções durante exit (mesmo que o motion.div
 * tenha sido renderizado com snapshot antigo). Pattern idêntico ao
 * SubpostCarousel slideVariants.
 */
function EmbeddedWrapper({ children, custom }: WrapperProps) {
  const reduced = useReducedMotion() ?? false
  // V9.6: emphasis 320ms percebido como "saindo muito rápido" pelo
  // user em swipe vertical (spread/bury). swap (500/750ms ease-out-
  // quart) dá sensação papel-no-deck. User feedback 2026-05-09.
  const transition = reduced ? { duration: 0 } : MOTION.swap
  // Variants com fechamento em `reduced`. Funções (não objetos) garantem
  // que Framer chama-as no momento do exit COM o custom da
  // AnimatePresence (não com o que estava congelado na snapshot).
  // V9.23 direção: exit ↑ (spread) → próximo entra de baixo (y=+20);
  // exit ↓ (bury) → próximo entra de cima (y=-20). `none` (X/ESC) só
  // fade. Lógica equivalente a computeInitialFromExit mas inline pra
  // variants pattern (não precisa converter dir → exit obj → initial).
  type Dir = 'up' | 'down' | undefined
  const variants = {
    initial: (c: Dir) => {
      if (reduced) return { opacity: 0 }
      const enterFromAbove = c === 'down' // bury → entry de cima
      return { opacity: 0, scale: 0.96, y: enterFromAbove ? -20 : 20 }
    },
    animate: reduced
      ? { opacity: 1 }
      : { opacity: 1, scale: 1, y: 0 },
    exit: (c: Dir) => {
      if (!c) return { opacity: 0 }
      return c === 'up'
        ? { y: '-110%', opacity: 0, scale: 0.95 }
        : { y: '110%', opacity: 0, scale: 0.95 }
    },
  }
  return (
    <m.div
      custom={custom}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}
      className="relative flex h-full w-full flex-col overflow-hidden"
    >
      {children}
    </m.div>
  )
}

