/**
 * Tests pra `computeInitialFromExit` — helper puro extraído de
 * `PostViewer.tsx` (EmbeddedWrapper). Manifesto §7 (determinismo) +
 * §16 (funções puras críticas com tests).
 */

import { describe, expect, it } from 'vitest'
import {
  computeInitialFromExit,
  type ExitVariant,
} from '../src/lib/post-viewer-motion'

const EXIT_UP: ExitVariant = { y: '-110%', opacity: 0, scale: 0.95 }
const EXIT_DOWN: ExitVariant = { y: '110%', opacity: 0, scale: 0.95 }
const EXIT_NONE: ExitVariant = { opacity: 0 }

describe('computeInitialFromExit', () => {
  it('exit pra baixo (y=110%, bury) → entry vem de cima (y=-20)', () => {
    const initial = computeInitialFromExit(EXIT_DOWN, false)
    expect(initial).toEqual({ opacity: 0, scale: 0.96, y: -20 })
  })

  it('exit pra cima (y=-110%, spread) → entry vem de baixo (y=+20)', () => {
    const initial = computeInitialFromExit(EXIT_UP, false)
    expect(initial).toEqual({ opacity: 0, scale: 0.96, y: 20 })
  })

  it('exit sem y (none variant, X/ESC) → entry vem de baixo (y=+20)', () => {
    const initial = computeInitialFromExit(EXIT_NONE, false)
    expect(initial).toEqual({ opacity: 0, scale: 0.96, y: 20 })
  })

  it('reduced=true colapsa pra só fade (sem scale/y)', () => {
    const initial = computeInitialFromExit(EXIT_DOWN, true)
    expect(initial).toEqual({ opacity: 0 })
    expect(initial.y).toBeUndefined()
    expect(initial.scale).toBeUndefined()
  })

  it('reduced=true ignora direção do exit (mesma saída pra up/down/none)', () => {
    expect(computeInitialFromExit(EXIT_UP, true)).toEqual({ opacity: 0 })
    expect(computeInitialFromExit(EXIT_DOWN, true)).toEqual({ opacity: 0 })
    expect(computeInitialFromExit(EXIT_NONE, true)).toEqual({ opacity: 0 })
  })

  it('determinístico — chamada repetida retorna mesmo shape', () => {
    const a = computeInitialFromExit(EXIT_DOWN, false)
    const b = computeInitialFromExit(EXIT_DOWN, false)
    expect(a).toEqual(b)
  })
})
