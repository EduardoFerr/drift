/**
 * Track C.4.2 — overlay sobre PostViewer com lista threaded de comentários.
 *
 * Spec: `Docs/design-comments.md` §1, §3, §4, §6, §7, §8, §9.
 *
 * Round Comments Nav Redesign — Phase A finalizada em 2026-05-17
 * (cards-mode legacy removido a pedido do user — sessão noite V).
 *
 *  - List-mode é o único modo agora. Alinha com Reddit/HN/Bluesky/
 *    Mastodon (RFC §2.9 prior art, §10 Q3 cohort C).
 *  - Manifesto §22 score determinístico INALTERADO — sem sort
 *    selector; ordem from buildThread (created_at ASC, id ASC).
 *  - Manifesto §27 CW per-comment preservado.
 *  - Manifesto §28 privacy — sem read receipts, sem view counts.
 *
 *  Phase B (próximo): collapse persistido em user_prefs.
 *  Phase C: jump-to-parent pill, breadcrumb expand on focus.
 *  Phase D: a11y deep dive (live regions, screen reader nav).
 *
 * Modelo:
 *   - scroll vertical nativo (virtualizado @tanstack/react-virtual)
 *   - tap em comment → ReplySheet com snapshot do target (UX-3 fix)
 *   - [-]/[+] toggle collapse subtree (state efêmero por sessão)
 *   - Esc fecha
 *
 * State:
 *   - `focusedId` (useState) — comment com foco atual
 *   - `collapsedSet` (useState) — collapse/expand efêmero
 *   - `tree` via `useThread(postId)` — Zustand store
 *   - `replyOpen` — local
 *
 * A11y: `role="tree"`, ARIA level/posinset/setsize por card, focus trap,
 * restore focus on close, `prefers-reduced-motion` desabilita scale.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
import { m } from 'framer-motion'
import { useThread } from '../../hooks/useThread'
import { loadThread } from '../../lib/comments'
import {
  type CommentNode,
  type ThreadCursor,
  type ThreadIndex,
} from '../../lib/thread-cursor'
import { flattenForList } from '../../lib/thread-list'
import { useVirtualizer } from '@tanstack/react-virtual'
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

  // List-mode state efêmero (Phase B: persistir em user_prefs).
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
  //   'cursor'   → reply ao comment focado atualmente
  //   'topLevel' → comment top-level no post (botão "+ no post" header,
  //                ou EmptyState se thread vazia)
  // Lido pelo IIFE de render do ReplySheet pra decidir replyTo/Kind/Pub.
  const [replyMode, setReplyMode] = useState<'cursor' | 'topLevel'>('cursor')

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

  // UX-9 (Robin audit) — helpers de abertura da sheet. ReplySheet faz
  // snapshot dos targets ao open=true→x (UX-3, defesa contra mudança
  // silenciosa durante typing).
  function openReplyToCursor() {
    setReplyMode('cursor')
    setReplyOpen(true)
  }
  function openReplyTopLevel() {
    setReplyMode('topLevel')
    setReplyOpen(true)
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
      } else if (e.key === 'Enter' && !replyOpen && focusedId) {
        e.preventDefault()
        openReplyToCursor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, replyOpen, focusedId])

  return (
    <m.div
      ref={containerRef}
      role="tree"
      aria-label="thread de comentários"
      tabIndex={-1}
      // TX-2 (Ted UX spike §2) — ThreadView NÃO usa FullPageCard porque
      // tem semantics próprios (role=tree). Mas precisa do mesmo cap visual
      // max-w-md mx-auto pra não vazar edge-to-edge em viewport > 448px
      // (mockup mobile-first). sm:border-x espelha FullPageCard.
      //
      // Bug B7/B9 fix (2026-05-22): bg-drift-bg/90 + backdrop-blur-sm
      // vazava o conteúdo subjacente (SpreadMap, PostViewer, bottom-nav)
      // tanto pelos pixels translúcidos quanto pelo blur que filtrava
      // (mas não escondia) a UI debaixo — causando texto washed-out no
      // bottom e mapa visível atrás do empty state. Trocado por bg-drift-bg
      // opaco, alinhando com FullPageCard / SettingsCards (mesma família
      // de modal full-page que cobre 100% do viewport).
      // design-system: ok reason=role-tree-not-fullpage-card
      className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col border-drift-border bg-drift-bg focus:outline-none sm:border-x"
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

        {/* List-mode (modo único desde 2026-05-17). */}
        {index.roots.length > 0 && (
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

        {/* ReplySheet (Track C.4.4 Ted). Reply targetId default = comment
            focado (cursor.path.at(-1)); top-level = postId.
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
    </m.div>
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
      <span className="font-mono text-[12px] text-drift-muted">
        seja o primeiro a comentar.
      </span>
      <button
        onClick={onReply}
        className="rounded-xl bg-drift-accent2 px-5 py-3.5 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
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

