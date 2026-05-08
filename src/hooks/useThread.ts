/**
 * Track C.3 — hook React pra consumir thread de comments de um post.
 *
 * Lifecycle:
 *  - mount: `loadThread(postId)` (read SQLite cache) +
 *           `subscribeComments(postId)` (live REQ via orchestrator).
 *  - unmount: release subscribe (refcount -1; quando zera, REQ fecha).
 *  - postId muda: cleanup velho, mount novo.
 *
 * Reactividade: usa `useThreadStore` selectors granulares — re-render
 * só quando o entry deste postId muda. Sem poll (CLAUDE.md invariante
 * #10).
 *
 * Expõe `forest` (top-level CommentNode[] com replies aninhadas) +
 * `index` (lookup O(1) pras cursor ops em UI swipe) + `loading` (true
 * enquanto a primeira query SQLite está em flight).
 */

import { useEffect } from 'react'
import {
  loadThread,
  subscribeComments,
  useThreadStore,
} from '../lib/comments'
import { buildThreadIndex } from '../lib/comments'
import type { CommentNode, ThreadIndex } from '../lib/thread-cursor'

const EMPTY_FOREST: CommentNode[] = []
const EMPTY_INDEX: ThreadIndex = buildThreadIndex(EMPTY_FOREST)

export interface UseThreadResult {
  forest: CommentNode[]
  index: ThreadIndex
  loading: boolean
}

export function useThread(postId: string | null): UseThreadResult {
  // Selector granular — depende apenas do entry deste postId E da
  // generation (pra forçar invalidate quando addCommentToStore mexe).
  const entry = useThreadStore((s) =>
    postId ? s.threads.get(postId) : undefined,
  )
  // Lê generation pra subscribar invalidations (zustand trata
  // shallow-eq; se generation muda, re-render).
  useThreadStore((s) => s.generation)

  useEffect(() => {
    if (!postId) return
    let cancelled = false

    // Live subscribe (refcounted — N consumers compartilham 1 REQ).
    const release = subscribeComments(postId)

    // Read inicial do SQLite cache.
    loadThread(postId).catch((err) => {
      if (!cancelled) {
        console.error('[useThread] loadThread failed:', err)
      }
    })

    return () => {
      cancelled = true
      release()
    }
  }, [postId])

  if (!postId || !entry) {
    return { forest: EMPTY_FOREST, index: EMPTY_INDEX, loading: !!postId }
  }
  return {
    forest: entry.forest,
    index: entry.index,
    loading: entry.loading,
  }
}
