/**
 * useOptimisticAction — hook genérico pra ações com feedback otimista.
 *
 * Convergente com Lily RFC `2026-05-rfc-motion-perf-polish.md` §4.2.
 *
 * Exposes 3 estados visuais + 1 trigger:
 *   - `pending`: ação em vôo (Promise não resolvida)
 *   - `ok`: brief flash 800ms após resolve com sucesso (visual confirm)
 *   - `error`: capturado, persiste até próxima `fire()` ou reset
 *   - `fire()`: dispara a ação; retorna Promise<void>
 *
 * **Não alimenta o SQLite** — apenas state React local (CLAUDE.md
 * invariante 2). Optimistic é descartado quando o evento real chega via
 * `onNostrEvent` → `invalidateFeed` (caller atualiza props/store).
 *
 * Manifesto §22 (deterministic scoring) preservado: optimistic affecta
 * apenas o feedback visual local; ranking continua função pura do score.
 *
 * Uso:
 *
 *   const spread = useOptimisticAction(() => spreadPost(postId, ...))
 *   <button onClick={spread.fire} disabled={spread.pending}>
 *     {spread.pending ? '…' : '↑'}
 *   </button>
 *   {spread.ok && <span className="animate-pulse">✓</span>}
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface OptimisticAction {
  /** Action em vôo (Promise não resolvida). */
  pending: boolean
  /** Flash de sucesso — true por ~800ms após resolve. */
  ok: boolean
  /** Erro capturado da última fire(). null se sucesso ou sem fire ainda. */
  error: unknown
  /** Dispara a ação. Idempotente quando já pending (no-op). */
  fire: () => Promise<void>
  /** Reset manual de error/ok (caso caller queira). */
  reset: () => void
}

export interface UseOptimisticActionOpts {
  /** Duração do flash `ok` (ms). Default 800ms (RFC §4.2). */
  okFlashMs?: number
  /** Callback após resolve com sucesso (antes do flash terminar). */
  onConfirm?: () => void
  /** Callback após reject. */
  onError?: (e: unknown) => void
}

const DEFAULT_OK_FLASH_MS = 800

export function useOptimisticAction(
  action: () => Promise<unknown>,
  opts: UseOptimisticActionOpts = {},
): OptimisticAction {
  const [pending, setPending] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Cleanup pra timer de flash + flag de unmount.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const reset = useCallback(() => {
    setOk(false)
    setError(null)
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
  }, [])

  const fire = useCallback(async () => {
    if (pending) return
    setPending(true)
    setError(null)
    setOk(false)
    try {
      await action()
      if (!mountedRef.current) return
      setPending(false)
      setOk(true)
      opts.onConfirm?.()
      // Flash dura okFlashMs e depois desliga.
      const ms = opts.okFlashMs ?? DEFAULT_OK_FLASH_MS
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setOk(false)
      }, ms)
    } catch (err) {
      if (!mountedRef.current) return
      setPending(false)
      setError(err)
      opts.onError?.(err)
    }
  }, [action, pending, opts])

  return { pending, ok, error, fire, reset }
}
