/**
 * SubpostCarousel — exibe um subpost por vez. Navegação horizontal vem
 * do `SwipeHandler` pai (← → ou setas de teclado), OU do tap em
 * segmentos da barra Instagram-style no topo (v9.2).
 *
 * V4: rendering delega pra `<SubpostLayout>` (3 templates baseado em
 * `subpost.layout`).
 *
 * V8: SubpostLayout absorveu o ciclo completo do card — incluindo
 * tag/title/body/meta/dots positioning per-template.
 *
 * V9.2 (2026-05-09): dots saem dos SubpostLayouts e voltam pra cá. User
 * pedido: barra estilo Instagram no topo do card, segmentos equidistantes
 * tappáveis. Render único pro carousel inteiro (não por subpost) — evita
 * re-render do bar a cada troca, animation do AnimatePresence só envolve
 * o conteúdo. Decisão V8 (dots dentro do layout) revertida.
 */

import { motion, AnimatePresence } from 'framer-motion'
import type { Subpost, Post } from '../../types/drift'
import { SubpostLayout } from './SubpostLayout'
import { DotsIndicator } from '../UI/DotsIndicator'

export interface SubpostCarouselProps {
  subposts: Subpost[]
  /** Index do subpost atual (controlado pelo pai). */
  index: number
  /** Post pai — usado pra meta (tag/stats) em CardText. */
  post: Post
  /**
   * Quando presente, segmentos da barra Instagram-style viram
   * `<button>` tappáveis — tap em segmento N → onSelect(N). PostViewer
   * passa `setSubpostIdx`. Sem isso, barra é puramente informativa.
   */
  onSelect?: (idx: number) => void
}

export function SubpostCarousel({
  subposts,
  index,
  post,
  onSelect,
}: SubpostCarouselProps) {
  if (subposts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-drift-muted">
        (sem conteúdo)
      </div>
    )
  }

  const clampedIdx = Math.max(0, Math.min(index, subposts.length - 1))
  const current = subposts[clampedIdx]

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Barra Instagram-style no topo do card — absolute pra ficar
          acima do conteúdo (gradient overlay tem z-[2], dots z-[5]).
          Mostra só com 2+ subposts (DotsIndicator retorna null caso 1). */}
      {subposts.length > 1 && (
        <div
          className="absolute inset-x-0 top-0 z-[5]"
          // Garante que o bar não capture nenhum gesto que não seja
          // tap nos segmentos: o wrapper passa drag pra Framer, e cada
          // <button> filho controla seu próprio touch-action: none.
        >
          <DotsIndicator
            variant="segmented"
            total={subposts.length}
            active={clampedIdx}
            {...(onSelect ? { onSelect } : {})}
          />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={current?.id ?? clampedIdx}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
          className="h-full w-full"
        >
          {current && (
            <SubpostLayout
              subpost={current}
              post={post}
              subpostIdx={clampedIdx}
              subpostsTotal={subposts.length}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
