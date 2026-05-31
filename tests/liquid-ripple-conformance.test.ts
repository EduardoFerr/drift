// Liquid refraction ripple (useLiquidRipple) — LOCK_VIA_TEST conformance.
//
// Source: user pedido 2026-05-29 "refração líquida REAL no toque".
// Spike GO A-scoped: Docs/sessions/ripple-refraction-spike-2026-05-29.md.
//
// Estes testes são estáticos (leem o source) — não rodam o browser nem
// medem FPS. Travam as INVARIANTES que o spike e o CLAUDE.md exigem:
//   1. Filtro usa feDisplacementMap (refração real de pixels, não overlay)
//   2. reduced-motion faz bypass TOTAL (hook + CSS) — WCAG 2.3.3
//   3. RAF é cancelado na dissipação E no unmount (sem leak; idle zero-JS, §1)
//   4. Filtro é REMOVIDO do elemento pós-animação (não fica ativo ocioso)
//   5. Scoped: o filtro vive no alvo, não na tela inteira
//   6. Física: decay temporal + falloff radial + sin(k·r) presentes
//   7. Sem libs externas (SVG/RAF/DOM built-in)
//   8. Wire em PostViewer (gate por setting, fire no epicentro)
//   9. Pref `liquid_ripple` no schema + default ON + parser

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HOOK = readFileSync('src/hooks/useLiquidRipple.tsx', 'utf8')
const CSS = readFileSync('src/styles/ripple.css', 'utf8')
const VIEWER = readFileSync('src/components/Post/PostViewer.tsx', 'utf8')
const PREFS = readFileSync('src/lib/prefs.ts', 'utf8')
const TYPES = readFileSync('src/types/drift.ts', 'utf8')

describe('useLiquidRipple — API', () => {
  it('exporta useLiquidRipple função', () => {
    expect(HOOK).toMatch(/export function useLiquidRipple/)
  })

  it('exporta tipos de options + result + epicenter', () => {
    expect(HOOK).toMatch(/export interface UseLiquidRippleOptions/)
    expect(HOOK).toMatch(/export interface UseLiquidRippleResult/)
    expect(HOOK).toMatch(/export interface LiquidEpicenter/)
  })

  it('aceita disabled (gate por setting)', () => {
    expect(HOOK).toMatch(/disabled\?:\s*boolean/)
  })

  it('retorna targetRef + fire + enabled', () => {
    expect(HOOK).toMatch(/targetRef:/)
    expect(HOOK).toMatch(/fire:\s*\(/)
    expect(HOOK).toMatch(/enabled:\s*boolean/)
  })
})

describe('refração REAL — feDisplacementMap (não overlay)', () => {
  it('cria filtro com feDisplacementMap + feImage', () => {
    expect(HOOK).toMatch(/feDisplacementMap/)
    expect(HOOK).toMatch(/feImage/)
  })

  it('feDisplacementMap usa in=SourceGraphic + in2=map (distorce children)', () => {
    expect(HOOK).toMatch(/setAttribute\(\s*['"]in['"]\s*,\s*['"]SourceGraphic['"]\s*\)/)
    expect(HOOK).toMatch(/setAttribute\(\s*['"]in2['"]\s*,\s*['"]map['"]\s*\)/)
  })

  it('mapeia canal R→dx e G→dy (offset radial)', () => {
    expect(HOOK).toMatch(/xChannelSelector['"]\s*,\s*['"]R['"]/)
    expect(HOOK).toMatch(/yChannelSelector['"]\s*,\s*['"]G['"]/)
  })

  it('aplica filter: url(#...) no elemento-alvo (scoped, não full-screen)', () => {
    expect(HOOK).toMatch(/el\.style\.filter\s*=\s*`url\(#\$\{filterIdRef\.current\}\)`/)
    // Nunca aplica em document.body / documentElement como alvo de filtro
    expect(HOOK).not.toMatch(/document\.body\.style\.filter/)
    expect(HOOK).not.toMatch(/documentElement\.style\.filter/)
  })
})

describe('física da onda (modelo de gota)', () => {
  it('decay temporal A(t)=e^(−t/τ) presente', () => {
    expect(HOOK).toMatch(/Math\.exp\(\s*-\s*k\s*\/\s*TAU\s*\)/)
    expect(HOOK).toMatch(/const TAU\s*=/)
  })

  it('falloff radial (1−r)^exp presente', () => {
    expect(HOOK).toMatch(/Math\.pow\(\s*1\s*-\s*r\s*,\s*FALLOFF_EXP\s*\)/)
  })

  it('onda senoidal sin(k·r − fase) presente', () => {
    expect(HOOK).toMatch(/Math\.sin\(/)
    expect(HOOK).toMatch(/WAVELENGTH/)
  })

  it('luminância codifica o offset (128 neutro)', () => {
    expect(HOOK).toMatch(/128\s*\+\s*sine/)
  })
})

describe('reduced-motion — bypass total (WCAG 2.3.3)', () => {
  it('hook checa prefers-reduced-motion e faz no-op no fire', () => {
    expect(HOOK).toMatch(/prefers-reduced-motion:\s*reduce/)
    expect(HOOK).toMatch(/if\s*\(prefersReducedMotion\(\)\)\s*return/)
  })

  it('CSS força filter:none sob reduced-motion (defesa em profundidade)', () => {
    const block = CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.liquid-ripple-host\s*\{[\s\S]*?filter:\s*none[\s\S]*?\}/,
    )
    expect(block).not.toBeNull()
  })
})

describe('§1 — RAF cleanup + filtro removido pós-animação', () => {
  it('cancela RAF na dissipação (k>=1) e remove filter', () => {
    expect(HOOK).toMatch(/if\s*\(k\s*>=\s*1\)/)
    // cleanup limpa filter + will-change
    expect(HOOK).toMatch(/el\.style\.filter\s*=\s*''/)
    expect(HOOK).toMatch(/el\.style\.willChange\s*=\s*''/)
  })

  it('cancela RAF no unmount (useEffect cleanup)', () => {
    expect(HOOK).toMatch(/useEffect\(\s*\(\)\s*=>\s*cleanup/)
    expect(HOOK).toMatch(/cancelAnimationFrame/)
  })

  it('refire cancela RAF anterior (sem leak de loops paralelos)', () => {
    expect(HOOK).toMatch(/if\s*\(rafRef\.current\s*!==\s*null\)\s*cancelAnimationFrame/)
  })
})

describe('sem libs externas', () => {
  it('usa apenas requestAnimationFrame + DOM (zero import de lib de animação)', () => {
    expect(HOOK).toMatch(/requestAnimationFrame/)
    // só importa de 'react'
    const imports = [...HOOK.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.every((i) => i === 'react')).toBe(true)
  })
})

describe('wire em PostViewer', () => {
  it('importa e instancia useLiquidRipple', () => {
    expect(VIEWER).toMatch(/import \{ useLiquidRipple \}/)
    expect(VIEWER).toMatch(/const liquid = useLiquidRipple\(/)
  })

  it('gate por setting liquid_ripple (disabled quando OFF)', () => {
    expect(VIEWER).toMatch(/disabled:\s*!prefs\.liquid_ripple/)
  })

  it('dispara liquid.fire no epicentro normalizado do toque', () => {
    expect(VIEWER).toMatch(/liquid\.fire\(\{/)
  })

  it('attacha targetRef + classe liquid-ripple-host no container do card', () => {
    expect(VIEWER).toMatch(/ref=\{liquid\.targetRef/)
    expect(VIEWER).toMatch(/liquid-ripple-host/)
  })
})

describe('pref liquid_ripple — schema + default + parser', () => {
  it('UserPrefs declara liquid_ripple: boolean', () => {
    expect(TYPES).toMatch(/liquid_ripple:\s*boolean/)
  })

  it('DEFAULT_USER_PREFS = liquid_ripple: true (default ON, enhancement)', () => {
    const block = TYPES.match(/DEFAULT_USER_PREFS[\s\S]*?\}/)
    expect(block![0]).toMatch(/liquid_ripple:\s*true/)
  })

  it('prefs.ts parser trata case liquid_ripple', () => {
    expect(PREFS).toMatch(/case 'liquid_ripple':/)
    expect(PREFS).toMatch(/target\.liquid_ripple\s*=\s*value === '1'/)
  })
})

describe('PERF Android (2026-05-31) — slim-toggle não trava celular', () => {
  it('MAP_SIZE reduzido (≤128) — raster do displacement map mais barato', () => {
    const m = HOOK.match(/const MAP_SIZE\s*=\s*(\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(128)
  })

  it('regen do mapa é THROTTLED (MAP_REGEN_MS), desacoplado do scale', () => {
    expect(HOOK).toMatch(/const MAP_REGEN_MS\s*=/)
    // scale anima todo frame; mapa só regenera passado o intervalo
    expect(HOOK).toMatch(/t\s*-\s*lastMapT\s*>=\s*MAP_REGEN_MS/)
  })

  it('coarse-pointer (Android/touch) NÃO regenera mapa no loop (scale-only)', () => {
    expect(HOOK).toMatch(/function isCoarsePointer/)
    expect(HOOK).toMatch(/pointer:\s*coarse/)
    // o regen é gated por !coarse — celular nunca re-decodifica SVG por frame
    expect(HOOK).toMatch(/if\s*\(\s*!coarse\s*&&/)
  })

  it('scale (atributo barato) anima fora do gate de regen do mapa', () => {
    // setAttribute('scale', ...) ocorre antes/independente do bloco de regen
    expect(HOOK).toMatch(/feDisp\.setAttribute\(\s*['"]scale['"]/)
  })
})

describe('não quebra ripples existentes', () => {
  it('long-press ripple-wave intacto', () => {
    expect(CSS).toMatch(/@keyframes ripple-wave/)
  })
  it('material-ripple intacto', () => {
    expect(CSS).toMatch(/@keyframes material-ripple/)
  })
})
