/**
 * useUserWeight — peso do usuário recalculado quando o feed muda.
 *
 * Por que do feed? Porque qualquer mudança que afeta peso (novo
 * spread/bury/post/report) passa por `onNostrEvent` → `invalidateFeed`
 * → store atualiza. A store do feed serve de "tick" reativo grátis,
 * sem precisar de outro mecanismo.
 *
 * Cálculo é uma query agregada (sub-selects no SQLite) — barato.
 * Mesmo assim, debounced via state local: re-render do feed dispara
 * useEffect, que faz a query, que atualiza state, que re-renderiza.
 */

import { useEffect, useState } from 'react'
import { useFeedStore } from '../lib/feed'
import { calculateUserWeight } from '../lib/weight'

export interface UserWeight {
  weight: number
  engagement: number
  antiquity: number
  maxSubposts: number
}

const ZERO_WEIGHT: UserWeight = {
  weight: 0,
  engagement: 0,
  antiquity: 0,
  maxSubposts: 1,
}

export function useUserWeight(npub: string | null): UserWeight {
  const [state, setState] = useState<UserWeight>(ZERO_WEIGHT)
  // Tick: sempre que o feed muda, recalcula. `posts.length` é selector
  // estável que só muda quando há mudança real no feed (Zustand
  // re-render só se selecionado mudou).
  const tick = useFeedStore((s) => s.posts.length)

  useEffect(() => {
    if (!npub) {
      setState(ZERO_WEIGHT)
      return
    }
    let cancelled = false
    void calculateUserWeight(npub, Date.now())
      .then((result) => {
        if (!cancelled) setState(result)
      })
      .catch((err) => {
        console.error('[useUserWeight] failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [npub, tick])

  return state
}
