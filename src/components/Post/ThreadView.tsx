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

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useThread } from '../../hooks/useThread'
import { loadThread } from '../../lib/comments'
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
import { ReplySheet } from './ReplySheet'
import type { Post } from '../../types/drift'

export interface ThreadViewProps {
  postId: string
  /** Author do post root (P tag NIP-22). Repassa pra ReplySheet. */
  postAuthorPub: string
  /**
   * TX-5 (Ted UX spike 2026-05-08) — post root completo. Quando passado,
   * ThreadHeader exibe o título legível em vez do hex críptico do path.
   * Opcional pra retrocompat com callers que ainda não migraram.
   */
  post?: Post
  onClose: () => void
}

export function ThreadView({ postId, postAuthorPub, post, onClose }: ThreadViewProps) {
  const { index, loading } = useThread(postId)
  const coachSeen = usePrefsStore((s) => s.thread_coach_seen)
  const reducedMotion = useReducedMotion()

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
  // UX-9 (Robin audit 2026-05-08) — modo de abertura da ReplySheet:
  //   'cursor'   → reply ao comment do cursor atual (FAB ↵ default)
  //   'topLevel' → comment top-level no post (botão "+ no post" header,
  //                ou EmptyState se thread vazia)
  // Lido pelo IIFE de render do ReplySheet pra decidir replyTo/Kind/Pub.
  const [replyMode, setReplyMode] = useState<'cursor' | 'topLevel'>('cursor')
  const [coachVisible, setCoachVisible] = useState(!coachSeen)
  // polish: TV-P1 swipe-down feedback (Track C P1) — shake breve antes
  // de exit quando user faz swipe ↓ no root, em vez de close abrupto.
  const [exitShake, setExitShake] = useState(false)

  // Snapshot timestamp pra contar "novos durante navegação"
  // fix: TH-B1 dead UI (Track C debt) — openedAt agora é state pra refresh
  // resetar a baseline quando user clica "+N novos" no header.
  const [openedAt, setOpenedAt] = useState(() => Math.floor(Date.now() / 1000))

  // fix: TH-B1 dead UI (Track C debt) — handler real do badge "+N novos".
  // Re-carrega snapshot do thread + reseta baseline de "novos".
  const handleRefreshNew = () => {
    void loadThread(postId)
    setOpenedAt(Math.floor(Date.now() / 1000))
  }

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

  // UX-9 (Robin audit) — helpers de abertura da sheet. ReplySheet faz
  // snapshot dos targets ao open=true→x (UX-3, defesa contra mudança
  // silenciosa do cursor durante typing).
  function openReplyToCursor() {
    setReplyMode('cursor')
    setReplyOpen(true)
  }
  function openReplyTopLevel() {
    setReplyMode('topLevel')
    setReplyOpen(true)
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
      // polish: TV-P1 swipe-down feedback (Track C P1) — micro-shake
      // confirma que ↓ no root vai fechar, em vez de exit abrupto.
      if (reducedMotion) {
        onClose()
        return
      }
      setExitShake(true)
      setTimeout(() => onClose(), 220)
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
        if (coachVisible) {
          dismissCoach()
          return
        }
        onClose()
      } else if (e.key === 'Enter' && !replyOpen) {
        e.preventDefault()
        openReplyToCursor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, replyOpen, coachVisible])

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
      // TX-2 (Ted UX spike §2) — ThreadView NÃO usa FullPageCard porque
      // tem semantics próprios (role=tree, swipe handler, peek shadows,
      // bg semi-transparent + backdrop-blur). Mas precisa do mesmo cap
      // visual max-w-md mx-auto pra não vazar edge-to-edge em viewport
      // > 448px (mockup mobile-first). sm:border-x espelha FullPageCard.
      className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col border-drift-border bg-drift-bg/90 backdrop-blur-sm focus:outline-none motion-reduce:backdrop-blur-none sm:border-x"
      initial={{ opacity: 0 }}
      // polish: TV-P1 swipe-down feedback (Track C P1) — shake quando
      // exitShake=true antes de onClose dispara fade-out final.
      animate={
        exitShake && !reducedMotion
          ? { opacity: 1, y: [0, 6, -3, 4, 0] }
          : { opacity: 1 }
      }
      exit={{ opacity: 0 }}
      transition={{ duration: exitShake ? 0.22 : 0.28, ease: [0.32, 0.72, 0, 1] }}
    >
      <ThreadHeader
        cursor={cursor}
        index={index}
        openedAt={openedAt}
        onClose={onClose}
        onRefreshNew={handleRefreshNew}
        // UX fix 2026-05-08: thread vazia → EmptyState já provê CTA único
        // ("↵ comentar"). Esconder "+ no post" header pra não duplicar.
        onNewTopLevelComment={
          index.roots.length > 0 ? openReplyTopLevel : undefined
        }
        post={post}
      />

      <div className="relative flex-1 overflow-hidden">
        {/* Empty / loading state */}
        {!loading && index.roots.length === 0 && (
          <EmptyState onReply={openReplyTopLevel} />
        )}
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
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                  animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
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
                    // UX-5 (Robin audit) — sinaliza "chegou desde a abertura"
                    // (ou último refresh). openedAt avança quando user clica
                    // "+N novos", então o border-left some no próximo render.
                    isNew={currentNode.created_at >= openedAt}
                    // UX-11 (Robin audit) — tap no footer "↳ N respostas"
                    // dispara descend; mantém swipe ↑ como gesture primário.
                    onDescend={hasChild ? handleDescend : undefined}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </SwipeHandler>
        )}

        {/* FAB Reply — sempre responde ao cursor atual (UX-9: top-level
            agora tem botão dedicado no header).
            UX fix 2026-05-08: thread vazia esconde FAB. EmptyState já
            tem CTA "↵ comentar"; senão user vê 3 botões fazendo a mesma
            coisa (top-level comment). */}
        {currentNode && (
          <button
            onClick={openReplyToCursor}
            className="absolute bottom-5 right-5 z-30 rounded-full border-2 border-drift-accent bg-drift-surface px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent shadow-lg hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            aria-label="responder este comentário"
            aria-keyshortcuts="Enter"
            title="responder (Enter)"
          >
            ↵ responder
          </button>
        )}

        {/* Coach-mark first-time.
            UX fix 2026-05-08: era `absolute inset-0 z-40` SEM
            `pointer-events-none` → bloqueava swipe + tap-to-reveal por
            3s (timer). User feedback: "só consigo swipe pelo header,
            resto do card não permite". Agora overlay decorativo (passa
            eventos) + botão dedicado pra dismiss. Touch em qualquer
            lugar dispara dismissCoach via window listener. */}
        <AnimatePresence>
          {coachVisible && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-drift-bg/60 backdrop-blur-sm motion-reduce:backdrop-blur-none"
              role="status"
              aria-live="polite"
              aria-label="dica de navegação por swipe"
            >
              <button
                onClick={dismissCoach}
                aria-label="fechar dica"
                className="pointer-events-auto rounded border border-drift-accent/40 bg-drift-surface/90 px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
              >
                <CoachContent />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ReplySheet (Track C.4.4 Ted). Substitui ReplyPlaceholder
            quando user toca FAB ↵. Reply targetId default = current
            comment (cursor.path.at(-1)); top-level = postId.
            UX-9 (Robin audit) — replyMode 'topLevel' força target = post
            mesmo que cursor esteja em algum nó.
            UX-3 (Robin audit) — ReplySheet faz snapshot interno desses
            props ao abrir; mudanças de cursor durante typing não trocam
            o destinatário silenciosamente. */}
        {(() => {
          const currentNodeId = cursor?.path.at(-1) ?? null
          const currentNodeForReply = currentNodeId ? index.byId.get(currentNodeId) : null
          // Resolve target conforme modo:
          //   'topLevel' → sempre o post
          //   'cursor'   → comment atual (ou post se tree vazia)
          const useTopLevel = replyMode === 'topLevel' || !currentNodeForReply
          const replyTo = useTopLevel ? postId : currentNodeId!
          const replyToKind = useTopLevel ? 9078 : 1111
          const replyToAuthorPub = useTopLevel
            ? postAuthorPub
            : currentNodeForReply.author_pub
          return (
            <ReplySheet
              postId={postId}
              postAuthorPub={postAuthorPub}
              replyTo={replyTo}
              replyToKind={replyToKind}
              replyToAuthorPub={replyToAuthorPub}
              open={replyOpen}
              onClose={() => {
                setReplyOpen(false)
                // UX-9: reset modo pra default 'cursor' no próximo abrir,
                // a menos que call site explicite o contrário.
                setReplyMode('cursor')
              }}
            />
          )
        })()}
      </div>
    </motion.div>
  )
}

// ─── Sub-renders ────────────────────────────────────────────────────

function EmptyState({ onReply }: { onReply: () => void }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 text-center"
      role="status"
      aria-live="polite"
    >
      <span className="font-display text-base font-bold uppercase tracking-tag text-drift-muted">
        sem comentários ainda
      </span>
      <span className="font-mono text-[11px] text-drift-muted">
        seja o primeiro a comentar.
      </span>
      <button
        onClick={onReply}
        className="rounded border-2 border-drift-accent px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
      >
        ↵ comentar
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
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
