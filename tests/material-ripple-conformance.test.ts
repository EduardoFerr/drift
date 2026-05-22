// Material Design ripple primitive — LOCK_VIA_TEST conformance.
//
// Source: User pedido 2026-05-21 "sensação de movimento ao toque
// estilo material design". Lily relatório (paralelo) deciderá quais
// componentes adotam. Hook é primitive isolada pra ser plugada onde
// fizer sentido.
//
// Cobre:
//   1. Hook export + signature estável
//   2. CSS keyframe `material-ripple` declarado
//   3. CSS classe `.material-ripple-host` (overflow:hidden + isolate)
//   4. CSS classe `.material-ripple` (animation duration + easing M3)
//   5. prefers-reduced-motion fallback existe
//   6. Hook respect `disabled` opt-out

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HOOK = readFileSync('src/hooks/useMaterialRipple.tsx', 'utf8')
const CSS = readFileSync('src/styles/ripple.css', 'utf8')

describe('useMaterialRipple — hook API', () => {
  it('exporta useMaterialRipple função', () => {
    expect(HOOK).toMatch(/export function useMaterialRipple/)
  })

  it('exporta UseMaterialRippleOptions + UseMaterialRippleResult types', () => {
    expect(HOOK).toMatch(/export interface UseMaterialRippleOptions/)
    expect(HOOK).toMatch(/export interface UseMaterialRippleResult/)
  })

  it('options aceita disabled boolean (opt-out)', () => {
    expect(HOOK).toMatch(/disabled\?:\s*boolean/)
  })

  it('options aceita colorOverride string (custom color)', () => {
    expect(HOOK).toMatch(/colorOverride\?:\s*string/)
  })

  it('retorna rippleHandlers + RippleLayer', () => {
    expect(HOOK).toMatch(/rippleHandlers:\s*\{/)
    expect(HOOK).toMatch(/RippleLayer:\s*\(\)\s*=>/)
  })

  it('handler é onPointerDown (não onClick — captura tap real)', () => {
    expect(HOOK).toMatch(/onPointerDown:/)
  })

  it('calcula maxR via Math.hypot(maior distance ao canto)', () => {
    // M3 spec: diâmetro = 2× distância ao canto mais longe
    expect(HOOK).toMatch(/Math\.hypot/)
    expect(HOOK).toMatch(/Math\.max\(x,\s*rect\.width\s*-\s*x\)/)
  })

  it('wave self-removes via animationend listener (no leak)', () => {
    expect(HOOK).toMatch(/animationend.*wave\.remove/s)
    expect(HOOK).toMatch(/\{\s*once:\s*true\s*\}/)
  })

  it('disabled=true → handler é no-op', () => {
    expect(HOOK).toMatch(/if\s*\(opts\.disabled\)\s*return/)
  })
})

describe('Material ripple CSS — Material Design 3 spec', () => {
  it('@keyframes material-ripple declarado', () => {
    expect(CSS).toMatch(/@keyframes material-ripple/)
  })

  it('keyframe começa em scale(0) + opacity 0.12-0.24 (M3 state layer)', () => {
    const block = CSS.match(/@keyframes material-ripple\s*\{[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/scale\(0\)/)
    // Opacity press default M3 = 0.12 (state layer) — Drift usa 0.24
    // pra tap mais visível (já documentado em comentários)
    expect(block![0]).toMatch(/opacity:\s*0\.(12|24)/)
  })

  it('keyframe termina em scale(1) + opacity 0 (full fade)', () => {
    const block = CSS.match(/@keyframes material-ripple\s*\{[\s\S]*?\n\}/)
    expect(block![0]).toMatch(/scale\(1\)[\s\S]*opacity:\s*0/)
  })

  it('.material-ripple-host tem overflow:hidden + isolate (containment)', () => {
    const block = CSS.match(/\.material-ripple-host\s*\{[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/overflow:\s*hidden/)
    expect(block![0]).toMatch(/isolation:\s*isolate/)
  })

  it('.material-ripple tem animation 550ms (M3 spec) + cubic-bezier standard', () => {
    const block = CSS.match(/\.material-ripple\s*\{[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/animation-duration:\s*550ms/)
    // M3 standard easing: cubic-bezier(0.4, 0, 0.2, 1)
    expect(block![0]).toMatch(/cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/)
  })

  it('.material-ripple usa currentColor (cor herdada do host)', () => {
    const block = CSS.match(/\.material-ripple\s*\{[\s\S]*?\n\}/)
    expect(block![0]).toMatch(/background:\s*currentColor/)
  })

  it('prefers-reduced-motion override existe (WCAG 2.3.3)', () => {
    expect(CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*@keyframes material-ripple/,
    )
  })
})

describe('Material ripple isolation — não conflita com long-press ripple', () => {
  it('long-press @keyframes ripple-wave permanece intacto', () => {
    expect(CSS).toMatch(/@keyframes ripple-wave/)
    expect(CSS).toMatch(/\.ripple-wave\s*\{/)
  })

  it('classes têm prefixos distintos (material-* vs ripple-*)', () => {
    // ripple-wave (long-press) e material-ripple (tap) coexistem
    expect(CSS).toMatch(/\.ripple-wave/)
    expect(CSS).toMatch(/\.material-ripple/)
  })
})
