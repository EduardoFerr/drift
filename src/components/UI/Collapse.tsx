/**
 * Collapse — animação suave de expand/collapse usando CSS grid trick.
 *
 * Por que CSS grid e não framer-motion?
 *   - `height: 'auto'` em framer-motion precisa do feature `layout`
 *     (em domMax, ~10 KB extra). Drift carrega só `domAnimation`.
 *   - `grid-template-rows: 0fr → 1fr` é suportado em modern browsers
 *     (Chrome 117+, FF 117+, Safari 17.4+), transitiona suave sem JS,
 *     mantém reflow de siblings (sanfona real, não overlay).
 *   - Custo zero de bundle.
 *
 * Tokens: usa `duration-motion-emphasis` (320ms) + `ease-drift-inout`
 * — match com chevron rotation no SectionHeader. `motion-reduce`
 * desliga a animação pra users com prefers-reduced-motion.
 *
 * Pattern:
 *   <Collapse open={isOpen}>
 *     {content}
 *   </Collapse>
 *
 * O child interno precisa de `min-h-0` (já aplicado) pra grid permitir
 * que o conteúdo seja efetivamente colapsado abaixo do seu tamanho
 * intrínseco.
 */

import type { ReactNode } from 'react'

export function Collapse({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  return (
    <div
      className="grid overflow-hidden transition-all duration-motion-emphasis ease-drift-inout motion-reduce:transition-none"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
      }}
      aria-hidden={!open}
    >
      <div className="min-h-0">{children}</div>
    </div>
  )
}
