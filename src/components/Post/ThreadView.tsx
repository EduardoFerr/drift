/**
 * Track C.4.2 — overlay sobre PostViewer com card stack swipe-navegável.
 *
 * Spec: `Docs/design-comments.md` §1, §3, §4, §6, §7, §8, §9.
 *
 * Round Comments Nav Redesign — Phase A
 * (RFC `Docs/rfcs/2026-05-rfc-comments-navigation-redesign.md`)
 * --------------------------------------------------------------
 *  - Default novo: **list-mode** (scrollable threaded list). Alinha
 *    com Reddit/HN/Bluesky/Mastodon — UX familiar pra newcomer
 *    (RFC §2.9 prior art, §10 Q3 cohort C).
 *  - Card-stack swipe-driven preservado como **opt-in** via toggle
 *    no ThreadHeader (`☰`/`⊞`). Manifesto §28 (privacy default —
 *    user agency sobre experiência).
 *  - A11y: keyboard nav J/K (prev/next comment) preservado em ambos
 *    modos. List-mode adiciona scroll nativo + tap-to-reply.
 *  - Manifesto §22 score determinístico INALTERADO — sem sort
 *    selector; ordem from buildThread (created_at ASC, id ASC).
 *  - Manifesto §27 CW per-comment preservado em ambos modos.
 *  - Manifesto §28 privacy — sem read receipts, sem view counts.
 *
 *  Phase B (próximo sprint): virtualized list (`@tanstack/react-virtual`)
 *  + collapse persistido em user_prefs.comments_expanded_threads.
 *  Phase C: jump-to-parent pill, breadcrumb expand on focus.
 *  Phase D: a11y deep dive (live regions, screen reader nav).
 *
 * Modelo (cards-mode legacy):
 *   - swipe ← / H : prevSibling
 *   - swipe → / L : nextSibling
 *   - swipe ↑ / K : descend (filho)
 *   - swipe ↓ / J : ascend (parent) — no root, fecha ThreadView
 *   - Esc / botão ✕: fecha
 *   - Enter: abre ReplySheet
 *
 * Modelo (list-mode novo):
 *   - scroll vertical nativo
 *   - tap em comment → ReplySheet com snapshot do target (UX-3 fix)
 *   - [-]/[+] toggle collapse subtree (state efêmero por sessão)
 *   - J/K keyboard mantém prev/next no flat order
 *   - Esc fecha
 *   - swipe DESLIGADO em list-mode (vertical scroll é nativo)
 *
 * State:
 *   - `cursor` (useState) — usado em cards-mode
 *   - `focusedId` (useState) — usado em list-mode (Phase A: shared
 *      com `cursor.path.at(-1)` na transição entre modos)
 *   - `expandedSet` (useState) — list-mode collapse/expand efêmero
 *   - `tree` via `useThread(postId)` — Zustand store
 *   - `replyOpen` — local
 *   - `coachVisible` — local + usePrefsStore.thread_coach_seen
 *
 * Render lazy: cards-mode mantém CommentCard central + peek (DOM ~3).
 * List-mode (Phase A) renderiza forest flatten — non-virtualized.
 * Virtualization é Phase B (>200 comments => jank em low-end).
 *
 * A11y: `role="tree"`, ARIA level/posinset/setsize por card,
 * keyboard H/J/K/L + setas + Esc, focus trap, restore focus on close,
 * `prefers-reduced-motion` desabilita translate/scale (mantém fade).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useThread } from '../../hooks/useThread'
import { loadThread } from '../../lib/comments'
import { usePrefsStore, setPref } from '../../lib/prefs'
import {
  ascend,
  descend,
  nextSibling,
  prevSibling,
  type CommentNode,
  type ThreadCursor,
  type ThreadIndex,
} from '../../lib/thread-cursor'
import { flattenForList } from '../../lib/thread-list'
import { useVirtualizer } from '@tanstack/react-virtual'
import { siblingPosition } from '../../lib/thread-header'
import { SwipeHandler } from './SwipeHandler'
import { CommentCard } from './CommentCard'
import { ThreadHeader } from './ThreadHeader'
import { ReplySheet } from './ReplySheet'
import { DriftSkeleton } from '../UI/DriftSkeleton'
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
  const { forest, index, loading } = useThread(postId)
  const coachSeen = usePrefsStore((s) => s.thread_coach_seen)
  // Phase A — view mode pref (default 'list', RFC §10 Q3 cohort C).
  const viewMode = usePrefsStore((s) => s.thread_view_mode)
  const reducedMotion = useReducedMotion()

  // Phase A — list-mode state efêmero (Phase B: persistir em user_prefs).
  // expandedSet armazena IDs COLAPSADOS (não os expandidos) — default
  // expanded é a opção mais user-friendly. ID na set = subtree colapsado.
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => new Set())
  // focusedId em list-mode: tap selectiona pra ARIA + ReplySheet target.
  const [focusedId, setFocusedId] = useState<string | null>(null)

  function toggleCollapsed(id: string): void {
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }


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

  // Phase A — toggle list⇄cards. Preserva foco entre modos:
  //   list → cards: focusedId vira cursor.path[único nó]. Cap simples
  //                 (Phase A) — reconstrução exata do parent-chain é
  //                 melhoria Phase B; aqui o user pode navegar normal.
  //   cards → list: cursor.path.at(-1) vira focusedId.
  function toggleViewMode(): void {
    const nextMode = viewMode === 'list' ? 'cards' : 'list'
    if (nextMode === 'cards' && focusedId && index.byId.has(focusedId)) {
      setCursor({ path: [focusedId] })
    } else if (nextMode === 'list' && cursor) {
      setFocusedId(cursor.path.at(-1) ?? null)
    }
    void setPref('thread_view_mode', nextMode)
  }

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
        // Phase A — toggle list⇄cards (RFC §5 mockup).
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
      />

      <div className="relative flex-1 overflow-hidden">
        {/* Empty / loading state */}
        {!loading && index.roots.length === 0 && (
          <EmptyState onReply={openReplyTopLevel} />
        )}
        {loading && index.roots.length === 0 && <LoadingState />}

        {/* Phase A — list-mode (default novo, RFC §10 Q3 cohort C). */}
        {viewMode === 'list' && index.roots.length > 0 && (
          <ListModeBody
            forest={forest}
            index={index}
            postId={postId}
            collapsedSet={collapsedSet}
            onToggleCollapsed={toggleCollapsed}
            focusedId={focusedId}
            onFocus={(id) => setFocusedId(id)}
            onTapReply={(id) => {
              setFocusedId(id)
              setReplyMode('cursor')
              // Sincroniza cursor pra ReplySheet pegar o ID certo via IIFE.
              setCursor({ path: [id] })
              setReplyOpen(true)
            }}
            openedAt={openedAt}
          />
        )}

        {/* Cards-mode (legacy opt-in) — render swipe-stack original. */}
        {viewMode === 'cards' && currentNode && (
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
            coisa (top-level comment).
            Round 4 Fase B (B5): wrapped em motion.button com hover
            scale 1.05 + tap scale 0.95. Pulse sutil na primeira render
            (chama atenção pro affordance) — tokenizado motion-fast.
            Reduced motion: pulse some, scale colapsa. */}
        {/* FAB ↵ — só em cards-mode. List-mode tem reply inline em cada
            comment (tap-to-reply UX-3 snapshot). */}
        {viewMode === 'cards' && currentNode && (
          <motion.button
            initial={{ scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.18, ease: [0.0, 0.0, 0.2, 1] }}
            onClick={openReplyToCursor}
            className="absolute bottom-5 right-5 z-30 rounded-full border-2 border-drift-accent bg-drift-surface px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent shadow-lg hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 motion-reduce:!scale-100"
            aria-label="responder este comentário"
            aria-keyshortcuts="Enter"
            title="responder (Enter)"
          >
            ↵ responder
          </motion.button>
        )}

        {/* Coach-mark first-time.
            UX fix 2026-05-08: era `absolute inset-0 z-40` SEM
            `pointer-events-none` → bloqueava swipe + tap-to-reveal por
            3s (timer). User feedback: "só consigo swipe pelo header,
            resto do card não permite". Agora overlay decorativo (passa
            eventos) + botão dedicado pra dismiss. Touch em qualquer
            lugar dispara dismissCoach via window listener. */}
        {/* Coach mark — só em cards-mode (ensina swipe ↑↓←→).
            List-mode é familiar (Reddit-style scrollable threaded) e
            não precisa coach. RFC §9.6 risco mitigado. */}
        <AnimatePresence>
          {viewMode === 'cards' && coachVisible && (
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

interface ListModeBodyProps {
  forest: CommentNode[]
  index: ThreadIndex
  postId: string
  collapsedSet: Set<string>
  onToggleCollapsed: (id: string) => void
  focusedId: string | null
  onFocus: (id: string) => void
  onTapReply: (id: string) => void
  openedAt: number
}

/**
 * Phase A — ThreadView body em list-mode (RFC §4.1, §5 mockup).
 *
 * Render flatten do forest (DFS preorder, collapsedSet skipa subtree).
 * Cada CommentCard variant='list' com indent + thread line + tap-reply.
 * Phase A: non-virtualized — render full list, simples. Phase B troca
 * por @tanstack/react-virtual quando metric de jank em low-end aparecer.
 */
function ListModeBody({
  forest,
  index: _index,
  postId,
  collapsedSet,
  onToggleCollapsed,
  focusedId,
  onFocus,
  onTapReply,
  openedAt,
}: ListModeBodyProps) {
  const flat = useMemo(
    () => flattenForList(forest, collapsedSet),
    [forest, collapsedSet],
  )

  // V9.22 (Phase B) — virtualização via @tanstack/react-virtual. Threads
  // grandes (até COMMENTS_LOAD_CAP=200 entries) renderizavam todos os
  // CommentCards = ~10k px de DOM + 200 React fibers. Agora só renderiza
  // window visible + overscan 5. estimateSize 56px (média list-variant);
  // measureElement habilitado pra heights dinâmicos quando body é longo.
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 5,
    getItemKey: (i) => flat[i]?.node.id ?? i,
  })

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label="lista de comentários"
      className="h-full w-full overflow-y-auto px-2 pb-12 pt-2"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = flat[virtualRow.index]
          if (!entry) return null
          return (
            <div
              key={entry.node.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              role="listitem"
              onFocus={() => onFocus(entry.node.id)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <CommentCard
                variant="list"
                node={entry.node}
                depth={entry.depth}
                posInSet={entry.posInSet}
                setSize={entry.setSize}
                childCount={entry.childCount}
                postId={postId}
                isNew={entry.node.created_at >= openedAt}
                isFocused={focusedId === entry.node.id}
                isExpanded={!collapsedSet.has(entry.node.id)}
                onToggleExpand={
                  entry.childCount > 0
                    ? () => onToggleCollapsed(entry.node.id)
                    : undefined
                }
                onTap={() => onTapReply(entry.node.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
  // Round 4 Fase C (REC-2 / UX-14): substitui o texto puro "carregando
  // comentários…" por DriftSkeleton variant=card×3 — perceived
  // performance + alinhamento visual com o que a thread vai mostrar.
  // Aria preservado via primitive (role="status").
  return (
    <div className="flex h-full flex-col gap-3 px-4 py-6">
      <DriftSkeleton variant="card" count={3} />
      <span className="sr-only">carregando comentários</span>
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
