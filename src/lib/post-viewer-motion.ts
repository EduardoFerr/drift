/**
 * Helpers puros pra animação de entrada do PostViewer (V8 embedded mode).
 *
 * V9.23 (user report 2026-05-14: "após bury perdeu a suavidade na troca
 * de cards"). Entry direction precisa refletir o exitVariant pra que
 * spread (exit ↑) → entry vinda de baixo (y=+20) e bury (exit ↓) →
 * entry vinda de cima (y=-20). Sem direção (none variant) mantém o
 * fallback antigo (y=+20).
 *
 * Função pura, determinística (manifesto §7). Coberta por testes em
 * `tests/post-viewer-motion.test.ts`.
 */

export interface ExitVariant {
  y?: string
  opacity: number
  scale?: number
}

export interface InitialMotion {
  opacity: number
  scale?: number
  y?: number
}

/**
 * Calcula `initial` (Framer Motion) do EmbeddedWrapper a partir do
 * `exitVariant` do post anterior.
 *
 * - `reduced=true` → só fade (sem scale/y), respeita prefers-reduced-motion.
 * - `exitVariant.y === '110%'` (bury, exit pra baixo) → entry vem de cima
 *   (`y === -20`).
 * - Caso contrário (spread `-110%` ou none) → entry vem de baixo
 *   (`y === 20`).
 */
export function computeInitialFromExit(
  exitVariant: ExitVariant,
  reduced: boolean,
): InitialMotion {
  if (reduced) return { opacity: 0 }
  const enterFromAbove = exitVariant.y === '110%'
  return { opacity: 0, scale: 0.96, y: enterFromAbove ? -20 : 20 }
}
