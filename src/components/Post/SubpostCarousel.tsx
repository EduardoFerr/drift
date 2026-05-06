/**
 * SubpostCarousel — exibe um subpost por vez com paginação por dots.
 * Navegação horizontal vem do `SwipeHandler` pai (← → ou setas de
 * teclado). Posts com 1 subpost não mostram dots (não há o que navegar).
 *
 * V4: rendering do conteúdo delega pra `<SubpostLayout>` — switch
 * exhaustive de 3 templates (portrait/landscape/text) baseado em
 * `subpost.layout`. SubpostCarousel mantém apenas: dispatch animation,
 * paginação visual, fallback empty.
 *
 * V5 polish: substituiu ProgressBar Stories-style por `<DotsIndicator>`
 * primitive (V3.0) — visual alinhado ao mockup v0.7 (`.c-dots`).
 *
 * Decisão de posicionamento: dots vivem ACIMA do SubpostLayout (carrossel
 * level), não DENTRO de cada template. Mockup tem dots em posições
 * diferentes per-layout (portrait: middle border-top/bottom; landscape:
 * absolute bottom overlay; text: top border-bottom). Mover dots pra
 * dentro de cada template exigiria SubpostLayout receber `idx`/`total`,
 * quebrando o contrato V4 ("layout = função pura de Subpost"). Trade-off
 * aceitável: visual ligeiramente diferente do mockup mas mantém pureza
 * arquitetural.
 */

import { motion, AnimatePresence } from 'framer-motion'
import type { Subpost } from '../../types/drift'
import { SubpostLayout } from './SubpostLayout'
import { DotsIndicator } from '../UI/DotsIndicator'

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

  return (
    <div className="flex h-full w-full flex-col">
      {/* DotsIndicator returns null se total ≤ 1 — sem branch local. */}
      <DotsIndicator
        total={subposts.length}
        active={index}
        ariaLabel="paginação de subposts"
      />

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
