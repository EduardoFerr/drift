/**
 * SubpostCarousel — exibe um subpost por vez com barra de progresso
 * estilo Stories no topo. Navegação horizontal vem do `SwipeHandler`
 * pai (← → ou setas de teclado).
 *
 * Posts com 1 subpost não mostram a barra (não há o que navegar).
 *
 * V4: rendering do conteúdo delega pra `<SubpostLayout>` — registry de
 * 3 templates (portrait/landscape/text) baseado em `subpost.layout`.
 * SubpostCarousel mantém apenas: dispatch animation, progress bar,
 * fallback empty.
 */

import { motion, AnimatePresence } from 'framer-motion'
import type { Subpost } from '../../types/drift'
import { SubpostLayout } from './SubpostLayout'

export interface SubpostCarouselProps {
  subposts: Subpost[]
  /** Index do subpost atual (controlado pelo pai). */
  index: number
}

export function SubpostCarousel({ subposts, index }: SubpostCarouselProps) {
  if (subposts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-600">
        (sem conteúdo)
      </div>
    )
  }

  const current = subposts[Math.max(0, Math.min(index, subposts.length - 1))]
  const showProgress = subposts.length > 1

  return (
    <div className="flex h-full w-full flex-col">
      {showProgress && <ProgressBar total={subposts.length} current={index} />}

      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? index}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            className="h-full w-full"
          >
            {current && <SubpostLayout subpost={current} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function ProgressBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1 px-4 pt-3">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-0.5 flex-1 rounded-full ${
            i < current
              ? 'bg-drift-accent/60'
              : i === current
              ? 'bg-drift-accent'
              : 'bg-drift-border'
          }`}
        />
      ))}
    </div>
  )
}
