/**
 * Motion tokens (Lily RFC `2026-05-rfc-motion-perf-polish.md` §1.1
 * + Ted RFC §4.1 §2.3). Source-of-truth para Framer Motion.
 *
 * Framer Motion (`transition={...}`) não consome tokens Tailwind do
 * `tailwind.config.js`. Esta const espelha as durations + easings em
 * shape JS. Marshall pode adicionar paridade test (Round 5).
 *
 * 6 tokens canônicos:
 *   - micro    (120ms) — hover, chip flash, focus ring, button press
 *   - fast     (180ms) — small modal/badge, chip enter, toast appear
 *   - base     (240ms) — overlay enter/exit (FullPage, SlideUp)
 *   - emphasis (320ms) — card stack transition (modal enter)
 *   - card     (360ms) — post create reveal, mode change list↔cards
 *   - swap     (750ms) — vertical post swap (spread/bury "fly out"
 *                        feel). User feedback 2026-05-09: 500ms ainda
 *                        ficava rápido na saída — bumpa pra 750ms.
 *                        Curva ease-out-quart (0.22, 1, 0.36, 1)
 *                        entrega decel longa, sensação de papel sendo
 *                        empurrado pra fora do deck.
 *
 * 3 easings:
 *   - drift-out    (ease-out canônico) — exits, fades
 *   - drift-inout  (overlay enter/exit, drag-snap)
 *   - drift-spring (card emphasis, slight overshoot feel)
 *
 * Determinismo (manifesto §7): nenhum `Math.random` / `Date.now`
 * implícito; durations + easings declarativos. Reduced motion via
 * `useMotionPreset()` em `motion-variants.ts`.
 */

export const MOTION = {
  micro:    { duration: 0.12, ease: [0.0, 0.0, 0.2, 1] as const },
  fast:     { duration: 0.18, ease: [0.0, 0.0, 0.2, 1] as const },
  base:     { duration: 0.24, ease: [0.4, 0.0, 0.2, 1] as const },
  emphasis: { duration: 0.32, ease: [0.32, 0.72, 0, 1] as const },
  card:     { duration: 0.36, ease: [0.32, 0.72, 0, 1] as const },
  swap:     { duration: 0.75, ease: [0.22, 1, 0.36, 1] as const },
} as const

