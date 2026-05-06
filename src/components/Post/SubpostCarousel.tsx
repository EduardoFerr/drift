/**
 * SubpostCarousel — exibe um subpost por vez. Navegação horizontal vem
 * do `SwipeHandler` pai (← → ou setas de teclado).
 *
 * V4: rendering delega pra `<SubpostLayout>` (3 templates baseado em
 * `subpost.layout`).
 *
 * V8: SubpostLayout absorveu o ciclo completo do card — incluindo
 * tag/title/body/meta/dots positioning per-template. SubpostCarousel
 * virou wrapper fino: anima troca entre subposts e passa props.
 *
 * Decisão V8 (revertendo nota V5): dots agora vivem DENTRO de cada
 * SubpostLayout porque o mockup tem posicionamento radicalmente
 * diferente per-template (portrait middle, landscape absolute bottom,
 * text top). Render-of-outside obrigaria positioning hacks. Trade-off:
 * V4 contract "layout = pure de subpost" virou "pure de (subpost,
 * post, idx, total)" — ainda determinístico (§7), só amplia a fronteira.
 */

import { motion, AnimatePresence } from 'framer-motion'
import type { Subpost, Post } from '../../types/drift'
import { SubpostLayout } from './SubpostLayout'

export interface SubpostCarouselProps {
  subposts: Subpost[]
  /** Index do subpost atual (controlado pelo pai). */
  index: number
  /** Post pai — usado pra meta (tag/stats) em CardText. */
  post: Post
}

export function SubpostCarousel({ subposts, index, post }: SubpostCarouselProps) {
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
