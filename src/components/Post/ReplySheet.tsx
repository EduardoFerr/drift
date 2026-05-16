/**
 * ReplySheet — bottom sheet pra publicar reply (kind 1111 NIP-22).
 *
 * Track C.4.4 (Ted). Acionada pelo FAB "↵ responder" em ThreadView
 * (Lily, C.4.2-3). Renderizada como overlay separado fora do card
 * stack — gestos do ThreadView (swipe up/down) NÃO conflitam com
 * input/keyboard da sheet (Barney HIGH #6 design-comments §10).
 *
 * Spec: design-comments.md §10 (Reply form).
 *
 * Comportamento:
 *  - Sheet sobe de baixo (translateY 100% → 0) com framer-motion;
 *    backdrop drift-bg/60 backdrop-blur fica atrás (toca pra fechar).
 *  - Drag-down dismiss (>= DRAG_DISMISS_THRESHOLD_PX) via pointer
 *    events nativos + RAF spring-back (mesmo pattern do SwipeHandler
 *    V10 — sem `drag` feature do framer-motion, permite LazyMotion
 *    carregar só `domAnimation`).
 *  - Esc fecha; Cmd/Ctrl+Enter publica.
 *  - prefers-reduced-motion: desabilita translate, mantém fade.
 *  - role="dialog" aria-modal="true"; focus na textarea on open;
 *    restaura focus pro último elemento ativo on close.
 *  - Trap simples de focus dentro da sheet via key handler em Tab.
 *
 * Publish flow:
 *  1. User digita → click "publicar"
 *  2. Disable input + show "publicando…"
 *  3. Chama `protocol.commentOnPost({...})`
 *  4. Sucesso: limpa textarea, chama `onPublished?()`, `onClose()`
 *  5. Erro: mostra inline error + permite retry (não fecha)
 *
 * Padrão arquitetural (Ted): cliente NÃO escreve em SQLite. O evento
 * volta pelo subscribe ativo e onNostrEvent persiste (invariante #1).
 * `onPublished` callback existe pra Lily fazer otimistic UI / dismiss
 * de coach mark / refresh, NÃO pra side-effect em domínio.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
// `m` é o primitive leve do framer-motion (LazyMotion). Features via main.tsx.
// NB: removemos `drag={'y'}` daqui (último consumer do feature `drag`
// no app — agora LazyMotion carrega só `domAnimation`). Bottom-sheet
// drag-down-to-dismiss agora usa pointer events nativos + RAF spring,
// mesmo pattern do SwipeHandler V10.
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import * as nip19 from 'nostr-tools/nip19'
import {
  commentOnPost,
  COMMENT_MAX_CHARS,
  COMMENT_IMAGE_ONLY_PLACEHOLDER,
} from '../../lib/protocol'
import { uploadBlob, BlobError } from '../../lib/blobs'
import { UploadError } from '../../lib/upload'
import type { BlobMeta } from '../../lib/nip94'
import { CONTENT_WARNING_VALUES, type ContentWarning } from '../../types/drift'
import { Image } from '../UI/Image'

// ─── Helper puro (testável) ───────────────────────────────────────────

export interface ValidateCommentResult {
  ok: boolean
  /** Texto trimado pronto pra publish (só presente quando ok=true). */
  trimmed?: string
  /** Razão pra ok=false. Strings estáveis pra UI lookup. */
  reason?: 'empty' | 'whitespace' | 'too-long'
}

/**
 * Valida content de comment ANTES de chamar commentOnPost. Função pura
 * pra ser testável sem montar React + protocol mock.
 *
 *  - empty       → string vazia
 *  - whitespace  → só whitespace (após trim fica vazio)
 *  - too-long    → trimmed > COMMENT_MAX_CHARS
 *
 * Trim é aplicado: comentário "  oi  " vira "oi". Cap aplica em
 * cima do trim (consistente com `commentOnPost` que rejeita > cap).
 */
export function validateCommentText(raw: string): ValidateCommentResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'whitespace' }
  if (trimmed.length > COMMENT_MAX_CHARS) return { ok: false, reason: 'too-long' }
  return { ok: true, trimmed }
}

// ─── UX-3 helper (testável) ──────────────────────────────────────────

/**
 * Snapshot do destinatário do reply. Capturado ao **abrir** a sheet
 * (open false→true) e mantido até o **fechamento**, mesmo que o cursor
 * pai mude live (ex: comment moderado → cursor truncate; navegação
 * acidental do user). UX-3 (Robin audit 2026-05-08).
 */
export interface ReplyTargetSnapshot {
  replyTo: string
  replyToKind: number
  replyToAuthorPub: string
}

/**
 * Resolve qual target o `commentOnPost` vai usar.
 *
 * Regra (UX-3): se o snapshot existe (sheet está aberta com captura),
 * usa o snapshot. Senão (sheet fechada / nunca abriu / falha defensiva)
 * cai pros props live.
 *
 * Pura, sem React, sem effects. Test cobre o invariante: snapshot
 * vence sobre live mesmo quando os 3 campos divergem completamente.
 */
export function resolveReplyTarget(
  snapshot: ReplyTargetSnapshot | null,
  live: ReplyTargetSnapshot,
): ReplyTargetSnapshot {
  return snapshot ?? live
}

// ─── Component ────────────────────────────────────────────────────────

export interface ReplySheetProps {
  /** Post root (kind 9078) — passa pra commentOnPost.postId */
  postId: string
  /** Author do post root (P tag NIP-22). */
  postAuthorPub: string
  /** Direct parent (= postId se top-level reply, = comment.id se aninhado) */
  replyTo: string
  /** Kind do parent direto: 9078 (post) ou 1111 (comment). */
  replyToKind: number
  /** Author do parent direto (p tag NIP-22). */
  replyToAuthorPub: string
  /** Aberto/fechado. Lily controla via state local em ThreadView. */
  open: boolean
  onClose: () => void
  /** Callback após publish bem-sucedido. */
  onPublished?: () => void
}

function shortNpub(pubHex: string): string {
  try {
    const npub = nip19.npubEncode(pubHex)
    // npub1abc...xyz (8+5 chars, comum no ecossistema Nostr)
    return `${npub.slice(0, 12)}…${npub.slice(-5)}`
  } catch {
    return pubHex.slice(0, 8) + '…' + pubHex.slice(-4)
  }
}

const HEADER_ID = 'drift-reply-sheet-header'

/** Threshold pra drag-down dismissar sheet — design-comments.md §10. */
const DRAG_DISMISS_THRESHOLD_PX = 80

/** Elastic factor: y_visual = y_raw * 0.4 quando y_raw > 0 (replica
 *  `dragElastic={{ top: 0, bottom: 0.4 }}` da versão framer-drag). */
const DRAG_ELASTIC_BOTTOM = 0.4

// Spring tuning casa com SwipeHandler V10 (manter feel consistente
// entre swipes do PostViewer e dismiss da ReplySheet).
const SPRING_STIFFNESS = 500
const SPRING_DAMPING = 38
const SPRING_REST_VELOCITY = 0.5 // px/s
const SPRING_REST_DELTA = 0.5 // px

export function ReplySheet({
  postId,
  postAuthorPub,
  replyTo,
  replyToKind,
  replyToAuthorPub,
  open,
  onClose,
  onPublished,
}: ReplySheetProps) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // C.6.2 — content-warning escolhido pelo autor (manifesto §27).
  const [contentWarning, setContentWarning] = useState<ContentWarning | null>(null)
  // C.6.3 — upload state. Cap convencional: 1 imagem por comment.
  const [blobMeta, setBlobMeta] = useState<BlobMeta | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // polish: RS-P3 alt input (Track C P1) — descrição opcional pra
  // imagem. Injetada no imeta NIP-94 antes de commentOnPost.
  const [imageAlt, setImageAlt] = useState('')

  // UX-3 (Robin audit 2026-05-08) — snapshot do destinatário capturado
  // ao abrir. Defesa contra mudança silenciosa do cursor pai durante
  // typing (comment moderado → cursor truncate; navegação acidental).
  // Sem isso, user que digitou 200 chars de reply pra @alice pode
  // descobrir, ao publicar, que respondeu pro parent de @alice.
  // Reset → null toda vez que sheet fecha (open=false).
  // State (não ref) pq o header "para X" precisa re-renderizar quando
  // o snapshot é capturado.
  const [targetSnapshot, setTargetSnapshot] =
    useState<ReplyTargetSnapshot | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const reducedMotion = useReducedMotion()
  // fix: RS-B2 upload leak (Track C debt) — flag pra ignorar setState de
  // upload depois que sheet fechou/desmontou. Sem isso, React loga
  // "state update on unmounted" + leak curto.
  const mountedRef = useRef(true)
  // Tracks whether sheet is currently open — uploads completing after
  // close são silenciosamente descartados.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Reset state quando reabre (evita flash do estado anterior).
  // UX-3 (Robin audit) — captura snapshot dos targets ao abrir; limpa
  // ao fechar. Effect roda em ambas transitions (open=true e open=false)
  // pra manter a invariante "sheet fechada = snapshot null".
  useEffect(() => {
    if (open) {
      setText('')
      setError(null)
      setPending(false)
      setContentWarning(null)
      setBlobMeta(null)
      setUploading(false)
      setUploadError(null)
      setImageAlt('')
      // UX-3: snapshot agora. Lê props NOW e congela; doPublish + header
      // usam isso até o close. NB: deps do useEffect são só [open], então
      // mudanças nos props não disparam re-snapshot (intencional).
      setTargetSnapshot({
        replyTo,
        replyToKind,
        replyToAuthorPub,
      })
      // Captura elemento ativo no momento do open pra restaurar on close.
      restoreFocusRef.current =
        (typeof document !== 'undefined' && (document.activeElement as HTMLElement)) || null
    } else {
      // UX-3: limpa snapshot pra próximo abrir capturar fresh.
      setTargetSnapshot(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // C.6.3 — handler de upload. Mesmo pattern de ComposeOverlay.handleFile.
  // fix: RS-B2 upload leak (Track C debt) — abort se sheet fechar /
  // componente desmontar durante o async (mountedRef + openRef).
  const handleFile = useCallback(async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const meta = await uploadBlob(file)
      if (!mountedRef.current || !openRef.current) return
      setBlobMeta(meta)
    } catch (err) {
      if (!mountedRef.current || !openRef.current) return
      const msg =
        err instanceof UploadError
          ? `upload falhou: ${err.message}`
          : err instanceof BlobError
            ? `upload falhou: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
      setUploadError(msg)
      setBlobMeta(null)
    } finally {
      if (mountedRef.current && openRef.current) setUploading(false)
    }
  }, [])

  const clearImage = useCallback(() => {
    setBlobMeta(null)
    setUploadError(null)
    setImageAlt('')
  }, [])

  // Focus na textarea on open + restaura on close.
  useEffect(() => {
    if (open) {
      // requestAnimationFrame pra dar tempo da sheet montar antes de focar.
      const id = requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
      return () => cancelAnimationFrame(id)
    } else {
      const prev = restoreFocusRef.current
      if (prev && typeof prev.focus === 'function') {
        // Tenta restaurar focus; ignora se elemento foi desmontado.
        try {
          prev.focus()
        } catch {
          /* noop */
        }
      }
    }
  }, [open])

  const doPublish = useCallback(async () => {
    if (pending || uploading) return
    // Permite reply só-imagem (validation só falha se texto + imagem
    // ambos vazios). Quando texto vazio mas blob presente, usamos
    // COMMENT_IMAGE_ONLY_PLACEHOLDER (NIP-22 não exige content
    // específico, mas Drift schema check exige non-empty).
    const validated = validateCommentText(text)
    let publishText = ''
    if (validated.ok) {
      publishText = validated.trimmed!
    } else if (blobMeta && (validated.reason === 'empty' || validated.reason === 'whitespace')) {
      publishText = COMMENT_IMAGE_ONLY_PLACEHOLDER
    } else {
      if (validated.reason === 'empty' || validated.reason === 'whitespace') {
        setError('escreve algo antes de publicar')
      } else if (validated.reason === 'too-long') {
        setError(`máximo ${COMMENT_MAX_CHARS} caracteres`)
      }
      return
    }
    setPending(true)
    setError(null)
    try {
      // polish: RS-P3 alt input (Track C P1) — merge alt do user no
      // BlobMeta antes de publicar (NIP-94 alt tag).
      const finalImeta = blobMeta
        ? { ...blobMeta, ...(imageAlt.trim() ? { alt: imageAlt.trim() } : {}) }
        : null
      // UX-3 (Robin audit) — usa snapshot capturado ao open. Se snapshot
      // é null (defesa: open=true mas effect ainda não rodou), cai pros
      // props live. resolveReplyTarget é puro + testado.
      const target = resolveReplyTarget(targetSnapshot, {
        replyTo,
        replyToKind,
        replyToAuthorPub,
      })
      await commentOnPost({
        postId,
        postAuthorPub,
        replyTo: target.replyTo,
        replyToKind: String(target.replyToKind),
        replyToAuthorPub: target.replyToAuthorPub,
        text: publishText,
        contentWarning: contentWarning ?? undefined,
        imetas: finalImeta ? [finalImeta] : undefined,
      })
      setText('')
      setContentWarning(null)
      setBlobMeta(null)
      setImageAlt('')
      onPublished?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro publicando'
      setError(msg)
    } finally {
      setPending(false)
    }
  }, [
    pending,
    uploading,
    text,
    postId,
    postAuthorPub,
    replyTo,
    replyToKind,
    replyToAuthorPub,
    targetSnapshot,
    contentWarning,
    blobMeta,
    imageAlt,
    onClose,
    onPublished,
  ])

  // Esc fecha; Cmd/Ctrl+Enter publica. Listener no document level só
  // enquanto open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (pending) return
        e.preventDefault()
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void doPublish()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending, onClose, doPublish])

  // Focus trap simples: Tab/Shift+Tab restritos ao container da sheet.
  function handleTrapKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const root = sheetRef.current
    if (!root) return
    const focusables = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const charCount = text.trim().length
  const overLimit = charCount > COMMENT_MAX_CHARS
  // Pode publicar se: tem texto válido OU tem imagem (e não está em upload/pending).
  const canPublish = !pending && !uploading && !overLimit && (charCount > 0 || !!blobMeta)

  // Animação: bottom-sheet (y 100% → 0). Reduced motion: só fade.
  const sheetInitial = reducedMotion ? { opacity: 0 } : { y: '100%', opacity: 0 }
  const sheetAnimate = reducedMotion ? { opacity: 1 } : { y: 0, opacity: 1 }
  const sheetExit = reducedMotion ? { opacity: 0 } : { y: '100%', opacity: 0 }

  // ── Drag-down-to-dismiss (pointer events nativos) ──────────────────
  // Refs em vez de state pra não re-renderizar por sample. Aplicamos
  // transform direto no DOM durante o drag; ao spring-back, limpamos
  // `el.style.transform` pra deixar o `animate={y:0}` do framer voltar
  // a vigorar (sem conflito). reducedMotion desabilita drag (mesma
  // semântica de `drag={false}` da versão framer).
  const dragYRef = useRef(0)
  const activePointerRef = useRef<number | null>(null)
  const startYRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  function applyDragTransform(y: number) {
    const el = sheetRef.current
    if (!el) return
    el.style.transform = `translate3d(0, ${y}px, 0)`
  }

  function clearDragTransform() {
    const el = sheetRef.current
    if (!el) return
    // String vazia devolve controle pro `animate` do framer-motion
    // (que mantém y=0). Sem isso, nosso inline style sobrescreveria
    // o exit animation pra y=100%.
    el.style.transform = ''
  }

  function cancelDragRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  function springBackDrag() {
    cancelDragRaf()
    if (reducedMotion) {
      dragYRef.current = 0
      clearDragTransform()
      return
    }
    let last = performance.now()
    let vy = 0
    const step = (now: number) => {
      const dt = Math.min(0.064, (now - last) / 1000)
      last = now
      const ay = -SPRING_STIFFNESS * dragYRef.current - SPRING_DAMPING * vy
      vy += ay * dt
      dragYRef.current += vy * dt
      applyDragTransform(dragYRef.current)
      const settled =
        Math.abs(dragYRef.current) < SPRING_REST_DELTA &&
        Math.abs(vy) < SPRING_REST_VELOCITY
      if (settled) {
        dragYRef.current = 0
        clearDragTransform()
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function handleSheetPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotion) return
    if (e.button !== undefined && e.button !== 0) return
    if (activePointerRef.current !== null) return
    // Não inicia drag se pointer veio de input/textarea/button/etc. —
    // esses children precisam dos próprios pointer events (focus, click,
    // scroll de textarea, etc.). Sheet só "puxa" pela área do header
    // ou margens.
    const target = e.target as HTMLElement | null
    if (
      target &&
      target.closest(
        'textarea, input, button, select, a, [role="button"], [role="radio"], [contenteditable="true"]',
      )
    ) {
      return
    }
    cancelDragRaf()
    activePointerRef.current = e.pointerId
    startYRef.current = e.clientY
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function handleSheetPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    const dy = e.clientY - startYRef.current
    // Elastic: só permite arrasto pra baixo (y > 0). y < 0 = hard wall
    // (= `top: 0` da versão framer). Visual y = raw * 0.4 (replica
    // dragElastic.bottom = 0.4).
    const yVisual = dy > 0 ? dy * DRAG_ELASTIC_BOTTOM : 0
    dragYRef.current = yVisual
    applyDragTransform(yVisual)
  }

  function handleSheetPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    // Decisão usa y visual (replica `info.offset.y` da versão framer-drag,
    // que também respeitava o elastic 0.4). Pending bloqueia dismiss
    // (mesma regra: `info.offset.y > X && !pending`).
    if (dragYRef.current > DRAG_DISMISS_THRESHOLD_PX && !pending) {
      // Dismiss: deixa framer-motion fazer o exit anim. Limpamos transform
      // pra não conflitar com `exit={{ y: '100%' }}`.
      dragYRef.current = 0
      clearDragTransform()
      onClose()
      return
    }
    springBackDrag()
  }

  function handleSheetPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    springBackDrag()
  }

  // Cleanup: cancela RAF em andamento no unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-drift-bg/60 backdrop-blur-sm"
          onClick={() => {
            if (!pending) onClose()
          }}
        >
          <m.div
            ref={sheetRef}
            initial={sheetInitial}
            animate={sheetAnimate}
            exit={sheetExit}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            // Drag pra baixo dismissa via pointer events nativos (handlers
            // abaixo). Elastic 0.4 + threshold 80px + spring back replicam
            // bit-a-bit a versão framer-drag anterior.
            className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-b-0 border-drift-border bg-drift-surface touch-pan-y"
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerCancel}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleTrapKey}
            role="dialog"
            aria-modal="true"
            aria-labelledby={HEADER_ID}
          >
            {/* Drag handle visual */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full bg-drift-border" aria-hidden="true" />
            </div>

            {/* Header */}
            <header className="flex items-start justify-between gap-3 px-4 pb-3">
              <div className="min-w-0 flex-1">
                <h2
                  id={HEADER_ID}
                  className="font-display text-xs font-bold uppercase tracking-[0.2em] text-drift-accent"
                >
                  responder
                </h2>
                <p className="mt-1 truncate font-mono text-[12px] text-drift-muted">
                  para {shortNpub(
                    /* UX-3: header reflete o snapshot, não o cursor live.
                       Mantém consistência com o destinatário que vai ser
                       usado no doPublish. */
                    (targetSnapshot ?? {
                      replyTo,
                      replyToKind,
                      replyToAuthorPub,
                    }).replyToAuthorPub,
                  )}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={pending}
                className="shrink-0 rounded border border-drift-border px-2 py-1 text-[12px] text-drift-muted transition-colors hover:border-drift-accent hover:text-drift-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 disabled:opacity-40"
                aria-label="fechar"
                aria-keyshortcuts="Escape"
              >
                ✕
              </button>
            </header>

            {/* Body */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  if (error) setError(null)
                }}
                disabled={pending}
                placeholder="sua resposta…"
                rows={4}
                aria-label="texto da resposta"
                aria-invalid={overLimit || !!error}
                className="min-h-[6rem] w-full resize-y rounded border border-drift-border bg-drift-bg p-2 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent2 focus:outline-none disabled:opacity-60"
              />

              {/* C.6.3 — image upload (cap 1 imagem por comment). */}
              <ReplyImagePicker
                blobMeta={blobMeta}
                uploading={uploading}
                uploadError={uploadError}
                disabled={pending}
                onFile={handleFile}
                onClear={clearImage}
                imageAlt={imageAlt}
                onAltChange={setImageAlt}
              />

              {/* C.6.2 — content warning chips (manifesto §27). */}
              <div
                className="mt-1 border-t border-drift-border pt-2"
                role="radiogroup"
                aria-label="aviso de conteúdo (opcional)"
              >
                <div
                  className="mb-1 font-mono text-[12px] uppercase tracking-[2px] text-drift-muted"
                  title="manifesto §27 — autor declara, leitor filtra"
                >
                  marcar conteúdo (opcional)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CONTENT_WARNING_VALUES.map((cw) => {
                    const active = contentWarning === cw
                    return (
                      <button
                        key={cw}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={pending}
                        onClick={() => setContentWarning(active ? null : cw)}
                        className={`rounded-sm border-[1.5px] px-2.5 py-1 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 disabled:opacity-40 ${
                          active
                            ? 'border-drift-warning bg-drift-warning/15 text-drift-warning'
                            : 'border-drift-border text-drift-muted hover:border-drift-text hover:text-drift-text'
                        }`}
                      >
                        {active ? '✓ ' : ''}
                        {cw}
                      </button>
                    )
                  })}
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded border border-drift-bury/60 bg-drift-bury/10 px-2 py-1 text-[12px] text-drift-bury"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-drift-border bg-drift-bg/40 px-4 py-3">
              <span
                className={`font-mono text-[12px] ${
                  overLimit ? 'text-drift-bury' : 'text-drift-muted'
                }`}
                aria-live={overLimit ? 'assertive' : 'off'}
                aria-label={`${charCount} de ${COMMENT_MAX_CHARS} caracteres`}
              >
                {charCount}/{COMMENT_MAX_CHARS}
              </span>
              {/* polish: RS-P1 shortcut hint (Track C P1) — torna ⌘↵ visível
                  na UI; antes só estava em comentário de código. */}
              <div className="flex items-center gap-2">
                <span
                  className="hidden font-mono text-[12px] uppercase tracking-meta text-drift-muted sm:inline"
                  aria-hidden="true"
                >
                  ⌘↵
                </span>
                <button
                  onClick={doPublish}
                  disabled={!canPublish}
                  className="rounded bg-drift-accent px-4 py-1.5 text-[12px] font-semibold uppercase tracking-widest text-drift-bg transition-opacity hover:opacity-90 focus:outline-none focus:ring-1 focus:ring-drift-accent2 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  title="publicar (⌘/Ctrl + Enter)"
                >
                  {pending ? 'publicando…' : 'publicar'}
                </button>
              </div>
            </footer>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  )
}

// ─── ReplyImagePicker (C.6.3) ─────────────────────────────────────────

function ReplyImagePicker({
  blobMeta,
  uploading,
  uploadError,
  disabled,
  onFile,
  onClear,
  imageAlt,
  onAltChange,
}: {
  blobMeta: BlobMeta | null
  uploading: boolean
  uploadError: string | null
  disabled: boolean
  onFile: (f: File) => void
  onClear: () => void
  /** polish: RS-P3 alt input (Track C P1) — descrição opcional. */
  imageAlt: string
  onAltChange: (v: string) => void
}) {
  // Preview quando blob carregado; senão drop area.
  if (blobMeta) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="relative h-[110px] w-full overflow-hidden rounded border border-drift-border">
          <Image
            src={blobMeta.url ?? ''}
            meta={blobMeta}
            className="h-full w-full object-cover"
            aspect="auto"
            fit="cover"
          />
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="absolute right-1 top-1 rounded border border-drift-border bg-drift-bg/80 px-2 py-0.5 font-mono text-[12px] uppercase tracking-meta text-drift-muted hover:text-drift-bury focus:outline-none focus:ring-1 focus:ring-drift-accent2 disabled:opacity-40"
            aria-label="remover imagem"
          >
            remover
          </button>
        </div>
        {/* polish: RS-P3 alt input (Track C P1) — a11y; opcional, NIP-94 alt. */}
        <input
          type="text"
          value={imageAlt}
          onChange={(e) => onAltChange(e.target.value)}
          disabled={disabled}
          maxLength={280}
          placeholder="descrição da imagem (alt) — opcional"
          aria-label="descrição da imagem para acessibilidade"
          className="w-full rounded border border-drift-border bg-drift-bg px-2 py-1 font-mono text-[12px] text-drift-text placeholder:text-drift-muted/60 focus:border-drift-accent2 focus:outline-none disabled:opacity-60"
        />
      </div>
    )
  }
  return (
    <label
      className={`relative flex h-[70px] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded border-[1.5px] border-dashed transition-colors ${
        uploading
          ? 'border-drift-border opacity-60'
          : 'border-drift-border hover:border-drift-accent'
      }`}
    >
      <span aria-hidden="true" className="text-[18px] opacity-40">
        🖼
      </span>
      <span className="font-mono text-[12px] uppercase tracking-meta text-drift-muted">
        {uploading ? 'fazendo upload…' : 'anexar imagem (opcional)'}
      </span>
      {uploadError && (
        <span
          className="px-2 text-center font-mono text-[12px] text-drift-bury"
          title={uploadError}
        >
          {uploadError}
        </span>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading || disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </label>
  )
}

