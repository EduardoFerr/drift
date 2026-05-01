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

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Post, RenderHint, ReportReason } from '../../types/drift'
import { applyContentFilters } from '../../lib/feed'
import { usePrefsStore } from '../../lib/prefs'
import { reportPost } from '../../lib/protocol'
import { pinPost, unpinPost } from '../../lib/cache'
import { block, mute } from '../../lib/moderation-local'
import { follow, unfollow, useFollowsStore } from '../../lib/follows'
import { db } from '../../lib/db'
import { SwipeHandler } from './SwipeHandler'
import { SubpostCarousel } from './SubpostCarousel'
import { ReportModal } from './ReportModal'
import { SpreadMap } from '../Feed/SpreadMap'

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
   * Docs/sessions/conversa-29-04-analise.md §2). User PODE clicar na ação oposta
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
  const [reporting, setReporting] = useState(false)
  const [pinned, setPinned] = useState<boolean | null>(null) // null = loading
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
      alert(`Falha ao denunciar: ${err instanceof Error ? err.message : String(err)}`)
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
    if (
      !confirm(
        `Bloquear este autor?\n\n` +
          `Posts e interações dele somem do SEU feed (manifesto §24 — filtro local).\n` +
          `Não muda o score nem afeta outros users.\n` +
          `Você pode desbloquear depois em Settings → listas.`,
      )
    )
      return
    try {
      await block(post.authorPub)
      onClose()
    } catch (err) {
      alert(`Falha ao bloquear: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleMute() {
    try {
      await mute(post.authorPub)
      onClose()
    } catch (err) {
      alert(`Falha ao silenciar: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleFollowToggle() {
    try {
      if (isFollowing) await unfollow(post.authorPub)
      else await follow(post.authorPub)
    } catch (err) {
      alert(
        `Falha ao ${isFollowing ? 'deixar de seguir' : 'seguir'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  function next() {
    setSubpostIdx((i) => Math.min(i + 1, total - 1))
  }
  function prev() {
    setSubpostIdx((i) => Math.max(i - 1, 0))
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
  // fade out simples.
  const exitVariant = custom ? EXIT_VARIANTS[custom] : EXIT_VARIANTS.none

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={exitVariant}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-50 flex flex-col bg-drift-bg/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-drift-border px-4 py-3 text-[10px] text-slate-500">
        <span>
          {isMine ? 'você' : 'anon'}…{post.authorPub.slice(-8)} ·{' '}
          {timeAgo(post.createdAt)}
          {post.contentWarning && (
            <span
              className="ml-2 rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-300"
              title="aviso de conteúdo declarado pelo autor (manifesto §27)"
            >
              ⚠ {post.contentWarning}
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span title={`spreads ${displaySpreads} · buries ${displayBuries}`}>
            score <span className="text-slate-300">{post.score.toFixed(3)}</span>
          </span>
          <button
            onClick={handleTogglePin}
            disabled={pinned === null}
            className={`rounded border px-2 py-1 ${
              pinned
                ? 'border-yellow-500 text-yellow-300'
                : 'border-drift-border hover:border-yellow-500 hover:text-yellow-300'
            } disabled:opacity-40`}
            title={
              pinned
                ? 'fixado — protegido de eviction (manifesto §16)'
                : 'fixar — protege de eviction local + marca pra re-broadcast'
            }
            aria-label={pinned ? 'Desfixar' : 'Fixar'}
          >
            {pinned ? '📌' : '📍'}
          </button>
          <button
            onClick={() => setShowMap((v) => !v)}
            className={`rounded border px-2 py-1 ${
              showMap
                ? 'border-drift-accent text-drift-accent'
                : 'border-drift-border hover:border-drift-accent hover:text-drift-accent'
            }`}
            title="mapa de espalhamento"
            aria-label="Abrir mapa"
          >
            🗺️
          </button>
          {!isMine && (
            <>
              <button
                onClick={handleFollowToggle}
                className={`rounded border px-2 py-1 ${
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
                {isFollowing ? '✓' : '➕'}
              </button>
              <button
                onClick={handleMute}
                className="rounded border border-drift-border px-2 py-1 hover:border-yellow-500 hover:text-yellow-300"
                title="silenciar autor — só esconde posts dele do meu feed (manifesto §24)"
                aria-label="Silenciar"
              >
                🔇
              </button>
              <button
                onClick={handleBlock}
                className="rounded border border-drift-border px-2 py-1 hover:border-orange-500 hover:text-orange-300"
                title="bloquear autor — esconde posts e interações dele (manifesto §24)"
                aria-label="Bloquear"
              >
                ⊘
              </button>
              <button
                onClick={() => setShowReport(true)}
                className="rounded border border-drift-border px-2 py-1 hover:border-red-500 hover:text-red-400"
                title="denunciar — manifesto §26"
                aria-label="Denunciar"
              >
                ⚠
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded border border-drift-border px-2 py-1 hover:border-drift-accent hover:text-drift-accent"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showMap && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 240, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-drift-border"
          >
            <SpreadMap
              postId={post.id}
              className="h-60 w-full"
              {...(onOpenLocationSettings ? { onOpenLocationSettings } : {})}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conteúdo com gestos */}
      <div className="relative flex-1 p-4">
        <SwipeHandler
          onSpread={pendingAction === null ? onSpread : undefined}
          onBury={pendingAction === null ? onBury : undefined}
          onPrev={total > 1 ? prev : undefined}
          onNext={total > 1 ? next : undefined}
          onTap={!revealed ? () => setRevealed(true) : undefined}
          disableHorizontal={total <= 1}
        >
          <div className="relative h-full w-full bg-drift-surface">
            <div
              className={`h-full w-full transition-[filter] duration-200 ${
                !revealed ? 'pointer-events-none blur-xl' : ''
              }`}
            >
              <SubpostCarousel subposts={post.subposts} index={subpostIdx} />
            </div>

            {!revealed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <span className="text-xs uppercase tracking-widest text-yellow-300">
                  ⚠ {hint.reason ?? 'conteúdo marcado'}
                </span>
                <button
                  onClick={() => setRevealed(true)}
                  className="rounded border border-drift-accent px-4 py-2 text-xs uppercase tracking-widest text-drift-accent hover:bg-drift-accent/10"
                >
                  toque pra revelar
                </button>
                <span className="text-[10px] text-slate-600">
                  você pode mudar isso em settings
                </span>
              </div>
            )}
          </div>
        </SwipeHandler>
      </div>

      {/* Footer com ações + dicas */}
      <div className="flex items-center justify-between border-t border-drift-border px-4 py-3 text-[10px] text-slate-500">
        <div className="flex gap-3">
          <span className="text-drift-spread">↑ {displaySpreads}</span>
          <span className="text-drift-bury">↓ {displayBuries}</span>
          {total > 1 && (
            <span className="text-slate-400">
              {subpostIdx + 1} / {total}
            </span>
          )}
          {queue && queue.total > 1 && (
            <span
              className="text-slate-600"
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
            <span>↑ espalhar · ↓ enterrar{total > 1 && ' · ← → navega'}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSpread}
            disabled={pendingAction !== null}
            className={`rounded border px-2 py-1 disabled:opacity-40 ${
              spreadActive
                ? 'border-drift-spread bg-emerald-900/40 text-emerald-300'
                : 'border-drift-spread/40 text-drift-spread hover:bg-emerald-950/30'
            }`}
            title={
              capturingLocation && pendingAction === 'spread'
                ? 'capturando localização (até 8s)'
                : myAction === 'spread'
                ? 'você espalhou — ↓ pra mudar de opinião'
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
            className={`rounded border px-2 py-1 disabled:opacity-40 ${
              buryActive
                ? 'border-drift-bury bg-red-900/40 text-red-300'
                : 'border-drift-bury/40 text-drift-bury hover:bg-red-950/30'
            }`}
            title={
              myAction === 'bury'
                ? 'você enterrou — ↑ pra mudar de opinião'
                : undefined
            }
            aria-pressed={buryActive}
          >
            {pendingAction === 'bury' ? '…' : '↓'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showReport && (
          <ReportModal
            post={post}
            pending={reporting}
            onSubmit={handleReport}
            onClose={() => setShowReport(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const EXIT_VARIANTS = {
  up: { y: '-110%', opacity: 0, scale: 0.95 },
  down: { y: '110%', opacity: 0, scale: 0.95 },
  none: { opacity: 0 },
} as const

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
