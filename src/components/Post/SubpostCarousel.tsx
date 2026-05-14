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
 * o conteúdo.
 *
 * V9.3 (2026-05-09): rotação leve no card saindo, direção-aware. User
 * pedido "deixa mais realista". Outgoing card rota -direction*4° + slide.
 * Edge cases (outgoing era primeiro/último subpost): sem rotação, só
 * slide. Rationale: no extremo, não há "deck" atrás pra justificar o
 * efeito de flick.
 */

import { useEffect, useRef } from 'react'
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

// Variants pra slide direcional + rotação. `custom` é injetado por
// AnimatePresence a cada exit — usa direction + rotate calculados
// no render mais recente do pai (não os baked no mount do filho).
interface SlideCustom {
  direction: 1 | -1
  rotate: number
}
const slideVariants = {
  enter: (c: SlideCustom) => ({
    opacity: 0,
    x: c.direction * 32,
    rotate: 0,
  }),
  center: { opacity: 1, x: 0, rotate: 0 },
  exit: (c: SlideCustom) => ({
    opacity: 0,
    x: -c.direction * 32,
    rotate: c.rotate,
  }),
}

export function SubpostCarousel({
  subposts,
  index,
  post,
  onSelect,
}: SubpostCarouselProps) {
  const clampedIdx = Math.max(0, Math.min(index, subposts.length - 1))

  // Ref pro idx anterior — usado pra computar direction sem useEffect
  // (queremos o valor no render atual, não no commit). Atualizado em
  // useEffect após render pra estar pronto pra próxima mudança.
  const prevIdxRef = useRef(clampedIdx)
  const direction: 1 | -1 = clampedIdx < prevIdxRef.current ? -1 : 1

  // Outgoing card = aquele com idx === prevIdxRef.current. Se ele era
  // o primeiro (0) ou último (length-1), pula rotação — não há "deck"
  // pra justificar visualmente o flick. User pedido 2026-05-09.
  const fromIdx = prevIdxRef.current
  const fromIsEdge = fromIdx === 0 || fromIdx === subposts.length - 1
  const ROTATE_DEG = 4
  const exitRotate = fromIsEdge ? 0 : -direction * ROTATE_DEG

  useEffect(() => {
    prevIdxRef.current = clampedIdx
  }, [clampedIdx])

  if (subposts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-drift-muted">
        (sem conteúdo)
      </div>
    )
  }

  const current = subposts[clampedIdx]
  const customValue: SlideCustom = { direction, rotate: exitRotate }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Barra Instagram-style no topo do card — absolute pra ficar
          acima do conteúdo (gradient overlay tem z-[2], dots z-[5]).
          Mostra só com 2+ subposts (DotsIndicator retorna null caso 1). */}
      {subposts.length > 1 && (
        <div className="absolute inset-x-0 top-0 z-[5]">
          <DotsIndicator
            variant="segmented"
            total={subposts.length}
            active={clampedIdx}
            {...(onSelect ? { onSelect } : {})}
          />
        </div>
      )}

      <AnimatePresence mode="wait" custom={customValue}>
        <motion.div
          key={current?.id ?? clampedIdx}
          custom={customValue}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
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
