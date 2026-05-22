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
  XIcon,
  MessageCircleIcon,
  MoreVerticalIcon,
} from '../UI/Icons'
// FanIcon co-exportado de ActionsFan — usado aqui só pelo ModerationModal
// (que ainda vive inline em PostViewer). Quando ModerationModal sair daqui
// também, este import pode ir junto.
import ActionsFan, { FanIcon } from './ActionsFan'
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
import { LensInspector } from './LensInspector'
// V10.7 — `computeInitialFromExit` removido daqui (lógica inline em
// EmbeddedWrapper.variants.initial). Função pura preservada em
// `lib/post-viewer-motion.ts` por compatibilidade dos testes.

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
  onSpread: () => void
  onBury: () => void
  onClose: () => void
}

export function PostViewer({
  post,
  isMine,
  pendingAction,
  custom,
  queue,
  onOpenLocationSettings,
  onSpread,
  onBury,
  onClose,
}: PostViewerProps) {
  const prefs = usePrefsStore()
  const hint: RenderHint = applyContentFilters(post, prefs)
  // V12 (2026-05-18): respeitar prefers-reduced-motion no map sanfona
  // animation. WCAG 2.3.3 — animation maior que 5s ou parallax/clipPath
  // complex precisa fallback. Hook retorna boolean | null (null = sem
  // preference detectada → trata como false).
  const reducedMotion = useReducedMotion() ?? false

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
  // V_2026-05-21 (user pedido): 5s → 3s + ripple animation CSS a partir
  // do toque, substituindo o progress bar linear + label.
  // Moderação foi movida pro ActionsFan como item `moderar` (mesmo
  // modal real, só trigger mudou pra menu explícito).
  // Estado local: `pressing` + `pressOrigin` (ponto do toque pra
  // posicionar o ripple radial).
  const [pressing, setPressing] = useState(false)
  const [pressOrigin, setPressOrigin] = useState<{ x: number; y: number } | null>(null)
  const [moderationOpen, setModerationOpen] = useState(false)
  const pressTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const LONG_PRESS_MS = 3000
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
    setPressOrigin(null)
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
    // V_2026-05-21 (user pedido): captura coord relativo ao card pra
    // posicionar ripple radial no ponto exato do toque. currentTarget
    // é o elemento que ouve o evento (o card wrapper) — bounding rect
    // permite normalizar clientX/Y → offset local.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPressOrigin({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setPressing(true)
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      setPressing(false)
      setPressOrigin(null)
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

  // [cleanup 2026-05-20] Removidas variáveis displaySpreads/displayBuries
  // /spreadActive/buryActive — eram usadas apenas pelo footer/header
  // pré-V8 (branch !embedded) já deletado. ActionsFan/SubpostCarousel
  // consomem post.spreads/buries direto. effectiveAction reduzido se
  // necessidade reaparecer.

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
  // pós-V8); branches `!embedded` deletadas em [cleanup 2026-05-20]
  // junto com a `embedded` prop em si (sempre era true).
  const Wrapper = EmbeddedWrapper

  return (
    <Wrapper custom={custom}>
      {/* Header bulky pré-V8 (modal mode com pin/follow/mute/block/report)
          removido em [PostViewer cleanup 2026-05-20] — branch !embedded
          era dead code desde V8 (todos call sites passam embedded=true).
          Ações secundárias migraram pro ActionsFan (menu ⋮). */}

      {/* Mapa de spread render removido daqui (V12 2026-05-18) — antes
          era strip horizontal de 240px ABOVE conteúdo (50/50 split). Agora
          é absolute inset-0 INSIDE o card-area abaixo, tomando 100% do
          espaço quando aberto (user pedido: 'ao clicar no mapa seja
          100%'). */}

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
        {/* Mapa de spread como FULL overlay (V12 2026-05-18) — absolute
            inset-0 cobre 100% do card-area. z-20 fica ABAIXO dos botões
            do header (z-30) → user pode fechar o mapa pelo mesmo botão
            mapa que abriu. Fade + scale-up sutil na entrada. */}
        {/* V13 (2026-05-18 user feedback "muito rapido e nada suave"):
            durations bumpadas + easing Material emphasized (mais smooth
            que expo-out) + stagger interno aumentado.
              - Open: 480ms (era 320ms) — cubic-bezier(0.2, 0, 0, 1)
                Material emphasized = curve gentle, settle suave
              - Close: 360ms (era 220ms) — cubic-bezier(0.4, 0, 0.6, 0.2)
                ease-in-out-quart smooth (era expo-in abrupto)
              - Inner content: delay 140ms (era 80ms) + 360ms duration —
                assenta com folga DEPOIS do clip terminar (~480-140=340ms
                de visibilidade do clip antes do content fade-in)
              - Reduced motion fallback inalterado (crossfade 200ms) */}
        <AnimatePresence>
          {showMap && (
            <m.div
              initial={
                reducedMotion
                  ? { opacity: 0 }
                  : { clipPath: 'inset(0 0 100% 0)', opacity: 1 }
              }
              animate={
                reducedMotion
                  ? { opacity: 1 }
                  : { clipPath: 'inset(0 0 0% 0)', opacity: 1 }
              }
              exit={
                reducedMotion
                  ? { opacity: 0, transition: { duration: 0.2 } }
                  : {
                      clipPath: 'inset(0 0 100% 0)',
                      transition: { duration: 0.36, ease: [0.4, 0, 0.6, 0.2] },
                    }
              }
              transition={{
                duration: reducedMotion ? 0.2 : 0.48,
                ease: reducedMotion ? 'linear' : [0.2, 0, 0, 1],
              }}
              className="absolute inset-0 z-20 overflow-hidden rounded-2xl bg-drift-bg"
              style={{ willChange: 'clip-path' }}
              data-no-longpress="true"
            >
              <m.div
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                transition={{
                  duration: reducedMotion ? 0 : 0.36,
                  delay: reducedMotion ? 0 : 0.14,
                  ease: [0.2, 0, 0, 1],
                }}
                className="h-full w-full"
              >
                <LazyBoundary fallback={<DriftSkeleton variant="image" aspect="1/1" />}>
                  <SpreadMap
                    postId={post.id}
                    className="h-full w-full"
                    {...(onOpenLocationSettings ? { onOpenLocationSettings } : {})}
                  />
                </LazyBoundary>
              </m.div>
            </m.div>
          )}
        </AnimatePresence>
        {/* V_2026-05-21 (user pedido): long-press feedback agora é
            **ripple radial CSS** a partir do ponto exato do toque,
            substituindo progress bar linear + label. 3 ondas concêntricas
            com delays 0/1/2s — usuário SENTE o tempo passar via expansão
            visível, sem leitura de texto. 5s → 3s reduzido (user pedido
            redução tactil).

            Matemática: cada onda expande de 0 → max(card width, height)
            em LONG_PRESS_MS, com fade-out simultâneo. Position fixa em
            pressOrigin (coord relativo ao card). Multiple waves com
            delays staggered dão sensação de respiração.

            Pure CSS (sem framer-motion overhead) — keyframes inline via
            style prop pra animation-duration parametrizada dinamicamente. */}
        {pressing && pressOrigin && (
          <div
            className="pointer-events-none absolute inset-0 z-[15] overflow-hidden"
            aria-hidden="true"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="ripple-wave"
                style={{
                  left: pressOrigin.x,
                  top: pressOrigin.y,
                  animationDuration: `${LONG_PRESS_MS}ms`,
                  animationDelay: `${i * 0.4}s`,
                }}
              />
            ))}
          </div>
        )}
        {/* Screen reader announcement — fora do visual layer pra zero
            interferência com a animação. user com SR ouve "alternando
            modo slim" quando pressing começa; visual user vê só ondas. */}
        {pressing && (
          <span className="sr-only" aria-live="polite">
            {isSlim ? 'soltando para sair do modo slim' : 'soltando para entrar no modo slim'}
          </span>
        )}
        {/* V11 — botões do header (⋮ ações + 💬 comments + 🗺 mapa).
            Absolute top-right do card area, z-30 pra ficar acima do
            SwipeHandler. onClick stopPropagation pra evitar conflito
            com swipe gesture.
            [PostViewer cleanup 2026-05-20] — wrap `{embedded && ...}`
            removido; embedded sempre true, render incondicional. */}
        <>
            <GlassIconButton
              onClick={(e) => {
                e.stopPropagation()
                setShowActionsMenu((v) => !v)
              }}
              size="xl"
              className="absolute right-4 top-4 z-30 shadow-drift-md"
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
              currentHasImage={!!post.subposts[subpostIdx]?.imageUrl}
              onPinToggle={() => {
                void handleTogglePin()
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
              className="absolute right-[68px] top-4 z-30 flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border border-drift-border bg-drift-surface/80 px-3 text-drift-muted shadow-drift-md backdrop-blur-sm transition-colors hover:border-drift-accent2 hover:text-drift-accent2 focus:outline-none focus:ring-1 focus:ring-drift-accent2"
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
            {/* Mapa de spread — V12 (user pedido 2026-05-18): mapa virou
                first-class no header (antes era item do ActionsFan). Visu-
                alização geográfica é descoberta primária, não secundária.
                Active state: showMap=true → border-drift-accent + text-
                drift-accent (visual diff sem ambiguidade). Posição:
                right-[132px] = right-4 (16) + 44 (⋮) + 8 (gap) + 44
                (comment) + 8 (gap) ≈ 120... bump pra 132 = 12px gap
                visual entre os 3 botões. */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMap((v) => !v)
              }}
              className={`absolute right-[132px] top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border bg-drift-surface/80 shadow-drift-md backdrop-blur-sm transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 ${
                showMap
                  ? 'border-drift-accent text-drift-accent'
                  : 'border-drift-border text-drift-muted hover:border-drift-accent hover:text-drift-accent'
              }`}
              style={{ touchAction: 'manipulation' }}
              aria-label={showMap ? 'fechar mapa de spread' : 'abrir mapa de spread'}
              aria-pressed={showMap}
              title="mapa de spread (geografia de quem drift-ou)"
              data-no-longpress="true"
            >
              <span aria-hidden="true">
                <MapIcon size={18} strokeWidth={2} />
              </span>
            </button>
            {/* Trust Lens inspector chip — bottom-right do card.
                Aparece só quando lens strength > 0 E post foi tocado. */}
            <LensInspector postId={post.id} authorPub={post.authorPub} />
        </>
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

      {/* Footer pré-V8 (modal mode com botões ↑/↓ + comments + counts)
          removido em [PostViewer cleanup 2026-05-20] — branch !embedded
          era dead code desde V8 (swipe é único input no home view;
          ActionsFan cobre comments + ações secundárias). */}

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
//
// Extraído pra `./ActionsFan` em Sprint N+2 P1.5. Conformance test:
// `tests/actions-fan-extract-conformance.test.ts`.

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

