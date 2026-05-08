/**
 * Track C.4.2 — overlay sobre PostViewer com card stack swipe-navegável.
 *
 * Spec: `Docs/design-comments.md` §1, §3, §4, §6, §7, §8, §9.
 *
 * Modelo:
 *   - swipe ← / H : prevSibling
 *   - swipe → / L : nextSibling
 *   - swipe ↑ / K : descend (filho)
 *   - swipe ↓ / J : ascend (parent) — no root, fecha ThreadView
 *   - Esc / botão ✕: fecha
 *   - Enter: abre ReplySheet (placeholder até Track Ted)
 *
 * State:
 *   - `cursor` (useState) — efêmero, escopo do viewport
 *   - `tree` via `useThread(postId)` — Zustand store
 *   - `replyOpen` — local
 *   - `coachVisible` — local + usePrefsStore.thread_coach_seen
 *
 * Render lazy: só CommentCard central + peek de 1-2 vizinhos. DOM ~3
 * cards independente do tamanho da tree (design §5.1).
 *
 * A11y: `role="tree"`, ARIA level/posinset/setsize por card,
 * keyboard H/J/K/L + setas + Esc, focus trap, restore focus on close,
 * `prefers-reduced-motion` desabilita translate/scale (mantém fade).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThread } from '../../hooks/useThread'
import { usePrefsStore, setPref } from '../../lib/prefs'
import {
  ascend,
  descend,
  nextSibling,
  prevSibling,
  type ThreadCursor,
} from '../../lib/thread-cursor'
import { siblingPosition } from '../../lib/thread-header'
import { SwipeHandler } from './SwipeHandler'
import { CommentCard } from './CommentCard'
import { ThreadHeader } from './ThreadHeader'

export interface ThreadViewProps {
  postId: string
  onClose: () => void
}

export function ThreadView({ postId, onClose }: ThreadViewProps) {
  const { index, loading } = useThread(postId)
  const coachSeen = usePrefsStore((s) => s.thread_coach_seen)

  // Cursor: começa no primeiro root quando tree disponível
  const [cursor, setCursor] = useState<ThreadCursor | null>(null)
  useEffect(() => {
    if (cursor === null && index.roots.length > 0) {
      setCursor({ path: [index.roots[0]!] })
    }
  }, [index.roots, cursor])

  // Se cursor aponta pra nó que sumiu (race §5.5), trunca pra último válido
  useEffect(() => {
    if (!cursor) return
    let lastValidIdx = -1
    for (let i = 0; i < cursor.path.length; i++) {
      if (index.byId.has(cursor.path[i]!)) lastValidIdx = i
    }
    if (lastValidIdx === cursor.path.length - 1) return // tudo válido
    if (lastValidIdx < 0) {
      // root sumiu — exit
      onClose()
      return
    }
    setCursor({ path: cursor.path.slice(0, lastValidIdx + 1) })
  }, [cursor, index.byId, onClose])

  const [replyOpen, setReplyOpen] = useState(false)
  const [coachVisible, setCoachVisible] = useState(!coachSeen)

  // Snapshot timestamp pra contar "novos durante navegação"
  const openedAt = useMemo(() => Math.floor(Date.now() / 1000), [])

  // Focus management — restaura focus ao trigger button quando fecha
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    containerRef.current?.focus()
    return () => {
      previousFocusRef.current?.focus?.()
    }
  }, [])

  // Coach-mark: dismiss após 3s ou tap
  useEffect(() => {
    if (!coachVisible) return
    const t = setTimeout(() => {
      setCoachVisible(false)
      void setPref('thread_coach_seen', true)
    }, 3000)
    return () => clearTimeout(t)
  }, [coachVisible])

  function dismissCoach() {
    if (!coachVisible) return
    setCoachVisible(false)
    void setPref('thread_coach_seen', true)
  }

  // ─── Cursor ops ────────────────────────────────────────────────────
  function handleNext() {
    if (!cursor) return
    const c = nextSibling(cursor, index, postId)
    if (c) setCursor(c)
  }
  function handlePrev() {
    if (!cursor) return
    const c = prevSibling(cursor, index, postId)
    if (c) setCursor(c)
  }
  function handleDescend() {
    if (!cursor) return
    const c = descend(cursor, index)
    if (c) setCursor(c)
  }
  function handleAscend() {
    if (!cursor) return
    const r = ascend(cursor)
    if (r === 'exit') {
      onClose()
      return
    }
    setCursor(r)
  }

  // ─── Keyboard: Esc + Enter ─────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null
      // Não interferir com inputs (ReplySheet do Ted abre textarea)
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') &&
        e.key !== 'Escape'
      ) {
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (replyOpen) {
          setReplyOpen(false)
          return
        }
        onClose()
      } else if (e.key === 'Enter' && !replyOpen) {
        e.preventDefault()
        setReplyOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, replyOpen])

  // ─── Render ────────────────────────────────────────────────────────
  const currentNode = cursor ? index.byId.get(cursor.path.at(-1)!) : null
  const { position, total } = cursor
    ? siblingPosition(cursor, index)
    : { position: 0, total: 0 }
  const childCount = cursor
    ? (index.childrenOf.get(cursor.path.at(-1)!) ?? []).length
    : 0
  const depth = cursor?.path.length ?? 0

  // Peek shadow cards: existem só se há vizinhos (discoverability §4.1)
  const hasNextSibling =
    cursor && cursor.path.length > 0 && total > 0 && position < total
  const hasPrevSibling = cursor && position > 1
  const hasChild = childCount > 0

  return (
    <motion.div
      ref={containerRef}
      role="tree"
      aria-label="thread de comentários"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col bg-drift-bg/90 backdrop-blur-sm focus:outline-none motion-reduce:backdrop-blur-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
    >
      <ThreadHeader
        cursor={cursor}
        index={index}
        openedAt={openedAt}
        onClose={onClose}
      />

      <div className="relative flex-1 overflow-hidden">
        {/* Empty / loading state */}
        {!loading && index.roots.length === 0 && <EmptyState onReply={() => setReplyOpen(true)} />}
        {loading && index.roots.length === 0 && <LoadingState />}

        {currentNode && (
          <SwipeHandler
            onPrev={hasPrevSibling ? handlePrev : undefined}
            onNext={hasNextSibling ? handleNext : undefined}
            onUp={hasChild ? handleDescend : undefined}
            onDown={handleAscend}
          >
            <div className="relative h-full w-full">
              {/* Peek shadow cards (visual hints) — aria-hidden, skip em
                  reduced-motion (fade only). */}
              {hasNextSibling && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-3 inset-y-3 -z-20 rounded border border-drift-border bg-drift-surface motion-reduce:hidden"
                  style={{
                    transform: 'translateY(14px) scale(0.92)',
                    opacity: 0.18,
                  }}
                />
              )}
              {hasNextSibling && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-3 inset-y-3 -z-10 rounded border border-drift-border bg-drift-surface motion-reduce:hidden"
                  style={{
                    transform: 'translateY(7px) scale(0.96)',
                    opacity: 0.4,
                  }}
                />
              )}
              {hasChild && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-3 inset-y-3 -z-10 rounded border border-drift-accent2/40 bg-drift-surface motion-reduce:hidden"
                  style={{
                    transform: 'translateY(14px) scale(0.92)',
                    opacity: 0.4,
                  }}
                />
              )}

              <AnimatePresence mode="popLayout">
                <motion.div
                  key={currentNode.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                  className="relative h-full w-full"
                >
                  <CommentCard
                    node={currentNode}
                    depth={depth}
                    posInSet={position}
                    setSize={total}
                    childCount={childCount}
                    postId={postId}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </SwipeHandler>
        )}

        {/* FAB Reply */}
        <button
          onClick={() => setReplyOpen(true)}
          className="absolute bottom-5 right-5 z-30 rounded-full border-2 border-drift-accent bg-drift-surface px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent shadow-lg hover:bg-drift-accent/10 focus:outline-none focus:ring-2 focus:ring-drift-accent2"
          aria-label="responder este comentário"
          title="responder (Enter)"
        >
          ↵ responder
        </button>

        {/* Coach-mark first-time */}
        <AnimatePresence>
          {coachVisible && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              onClick={dismissCoach}
              className="absolute inset-0 z-40 flex items-center justify-center bg-drift-bg/80 backdrop-blur-sm"
              role="presentation"
            >
              <CoachContent />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ReplySheet placeholder — Track Ted vai entregar
            <ReplySheet>. Aqui só renderizamos overlay simples pra
            cobrir UX enquanto o componente real chega. */}
        <AnimatePresence>
          {replyOpen && (
            <ReplyPlaceholder
              targetId={cursor?.path.at(-1) ?? null}
              onClose={() => setReplyOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ─── Sub-renders ────────────────────────────────────────────────────

function EmptyState({ onReply }: { onReply: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span className="font-display text-base font-bold uppercase tracking-tag text-drift-muted">
        sem comentários ainda
      </span>
      <span className="font-mono text-[11px] text-drift-muted">
        seja o primeiro a comentar.
      </span>
      <button
        onClick={onReply}
        className="rounded border-2 border-drift-accent px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus:ring-1 focus:ring-drift-accent2"
      >
        ↵ comentar
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="font-mono text-[11px] uppercase tracking-meta text-drift-muted">
        carregando comentários…
      </span>
    </div>
  )
}

function CoachContent() {
  return (
    <div className="flex flex-col gap-5 px-6 text-center">
      <span className="font-display text-base font-bold uppercase tracking-tag text-drift-text">
        navegação por swipe
      </span>
      <ul className="flex flex-col gap-2 font-mono text-[11px] tracking-meta text-drift-muted">
        <li>
          <span className="text-drift-accent">←</span> irmão anterior ·{' '}
          <span className="text-drift-accent">→</span> próximo
        </li>
        <li>
          <span className="text-drift-accent">↑</span> descer pra resposta
        </li>
        <li>
          <span className="text-drift-accent">↓</span> subir / sair
        </li>
      </ul>
      <span className="font-mono text-[10px] text-drift-muted">
        toque pra fechar
      </span>
    </div>
  )
}

/**
 * Placeholder do `<ReplySheet>` — Ted entrega o sheet real em outra
 * task da Track C. Aqui mantemos um overlay mínimo pra que o fluxo
 * (FAB → sheet → Esc/dismiss) seja exercitável.
 */
function ReplyPlaceholder({
  targetId,
  onClose,
}: {
  targetId: string | null
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label="responder comentário"
      className="absolute inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-lg border-t border-drift-border bg-drift-surface px-5 py-5 motion-reduce:transition-none"
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold uppercase tracking-tag text-drift-text">
          responder
        </span>
        <button
          onClick={onClose}
          className="rounded border border-drift-border px-2 py-1 font-mono text-[10px] text-drift-muted hover:border-drift-accent hover:text-drift-accent"
          aria-label="cancelar resposta"
        >
          ✕
        </button>
      </div>
      <p className="font-mono text-[11px] text-drift-muted">
        respondendo a{' '}
        <span className="text-drift-text">
          {targetId ? '…' + targetId.slice(-8) : '—'}
        </span>
      </p>
      <p className="font-mono text-[10px] italic text-drift-muted">
        ReplySheet em construção. UI completa chega em C.4.4.
      </p>
    </motion.div>
  )
}
