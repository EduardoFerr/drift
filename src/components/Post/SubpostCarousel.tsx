/**
 * SubpostCarousel — exibe um subpost por vez com barra de progresso
 * estilo Stories no topo. Navegação horizontal vem do `SwipeHandler`
 * pai (← → ou setas de teclado).
 *
 * Posts com 1 subpost não mostram a barra (não há o que navegar).
 *
 * Renderiza o conteúdo do subpost atual:
 *   - text          → texto preservando \n
 *   - image         → <img>
 *   - text+image    → image em cima, text em baixo
 */

import { motion, AnimatePresence } from 'framer-motion'
import type { Subpost } from '../../types/drift'
import { Image } from '../UI/Image'

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

      <div className="relative flex-1 overflow-hidden p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? index}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            className="flex h-full flex-col items-center justify-center"
          >
            {current && <SubpostBody subpost={current} />}
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
              : 'bg-slate-700/60'
          }`}
        />
      ))}
    </div>
  )
}

function SubpostBody({ subpost }: { subpost: Subpost }) {
  if (subpost.type === 'image' && subpost.imageUrl) {
    return (
      <Image
        src={subpost.imageUrl}
        className="max-h-full max-w-full rounded"
        aspect="auto"
      />
    )
  }
  if (subpost.type === 'text+image' && subpost.imageUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <Image
          src={subpost.imageUrl}
          className="max-h-[60vh] w-full max-w-full rounded"
          aspect="auto"
        />
        {subpost.text && (
          <p className="max-w-prose whitespace-pre-wrap text-center text-sm text-slate-200">
            {subpost.text}
          </p>
        )}
      </div>
    )
  }
  // type === 'text' (ou fallback)
  return (
    <p className="max-w-prose whitespace-pre-wrap text-center text-base leading-relaxed text-slate-100">
      {subpost.text ?? '(sem conteúdo de texto)'}
    </p>
  )
}
