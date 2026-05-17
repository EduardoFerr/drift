/**
 * Theme conformance — LOCK_VIA_TEST pra multi-tema.
 *
 * Garante:
 *  1. Cada `data-theme="X"` em themes.css define TODOS os tokens
 *     obrigatórios (12 base + 4 elevation + 8 gesture + ease-signature).
 *  2. WCAG AA mínimo em todos os pares text/muted/body/accent/spread/bury
 *     vs bg e surface — calculado via fórmula W3C 2.1 (pura, sem fetch).
 *  3. Hierarquia tipográfica (text > body > muted em luminance) preservada
 *     em todos os temas dark; invertida em themes light.
 *  4. Border vs bg ≥ 3.0 (WCAG 1.4.11 UI non-text) — corrige débito
 *     histórico do tema legacy (#2a2a2e era 1.37).
 *
 * Manifesto §22 (ranking puro) + §24 (sem afinidade): tema NUNCA
 * participa de score/weight/feed — separamente, isso é coberto em
 * `scoring.test.ts` (já existente, não importa `lib/theme`).
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const THEMES_CSS = fs.readFileSync(
  path.join(process.cwd(), 'src/styles/themes.css'),
  'utf-8',
)

const REQUIRED_BASE_TOKENS = [
  'drift-bg',
  'drift-surface',
  'drift-border',
  'drift-accent',
  'drift-accent2',
  'drift-text',
  'drift-muted',
  'drift-body',
  'drift-spread',
  'drift-bury',
  'drift-warning',
  'drift-danger',
] as const

const REQUIRED_ELEVATION_TOKENS = [
  'drift-surface-1',
  'drift-surface-2',
  'drift-surface-3',
  'drift-surface-4',
] as const

const REQUIRED_GRADIENT_TOKENS = [
  'gradient-canvas',
  'gradient-accent-soft',
  'gradient-edge',
  'gradient-signature',
  'gradient-hairline',
] as const

const REQUIRED_SHADOW_TOKENS = [
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-glow',
] as const

const REQUIRED_GESTURE_TOKENS = [
  'hover-overlay',
  'active-press',
  'focus-ring',
  'drag-shadow',
  'selected-bg',
  'divider-soft',
  'highlight-flash',
  'scrim-modal',
] as const

const REQUIRED_MOTION_TOKENS = ['ease-signature'] as const

const ALL_REQUIRED = [
  ...REQUIRED_BASE_TOKENS,
  ...REQUIRED_ELEVATION_TOKENS,
  ...REQUIRED_GRADIENT_TOKENS,
  ...REQUIRED_SHADOW_TOKENS,
  ...REQUIRED_GESTURE_TOKENS,
  ...REQUIRED_MOTION_TOKENS,
]

const THEMES = ['cinder', 'rosenholz', 'velatura'] as const

/** Extrai bloco de um tema do themes.css. */
function extractThemeBlock(themeName: string): string {
  // `:root,\n[data-theme='cinder']` ou `[data-theme='X']`
  // Procura desde `[data-theme='X']` até a próxima `}` no nível raiz.
  const re = new RegExp(
    `(?:\\[data-theme=['"]${themeName}['"]\\][^{]*)\\{([\\s\\S]*?)^\\}`,
    'm',
  )
  const m = THEMES_CSS.match(re)
  if (!m) throw new Error(`tema "${themeName}" não encontrado em themes.css`)
  return m[1]!
}

/** Extrai valor de uma variável do bloco. */
function extractVar(block: string, name: string): string | null {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`)
  const m = block.match(re)
  return m ? m[1]!.trim() : null
}

// ─── WCAG contrast (W3C 2.1 formula, pure) ────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length !== 6) throw new Error(`hex inválido: ${hex}`)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(hex1: string, hex2: string): number {
  const L1 = relLuminance(hexToRgb(hex1))
  const L2 = relLuminance(hexToRgb(hex2))
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1]
  return (hi + 0.05) / (lo + 0.05)
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Theme conformance — token presence', () => {
  for (const theme of THEMES) {
    it(`tema "${theme}" define TODOS os ${ALL_REQUIRED.length} tokens obrigatórios`, () => {
      const block = extractThemeBlock(theme)
      const missing: string[] = []
      for (const tok of ALL_REQUIRED) {
        if (!extractVar(block, tok)) missing.push(tok)
      }
      expect(missing, `tema ${theme} faltam tokens: ${missing.join(', ')}`).toEqual([])
    })
  }
})

describe('Theme conformance — hex format', () => {
  for (const theme of THEMES) {
    it(`tema "${theme}" todos os tokens BASE são hex #rrggbb`, () => {
      const block = extractThemeBlock(theme)
      const HEX_RE = /^#[0-9a-f]{6}$/i
      for (const tok of [...REQUIRED_BASE_TOKENS, ...REQUIRED_ELEVATION_TOKENS]) {
        const value = extractVar(block, tok)
        expect(value, `tema ${theme} sem ${tok}`).toBeTruthy()
        expect(value!, `${theme}/${tok}=${value} deve ser hex 6-dig`).toMatch(HEX_RE)
      }
    })
  }
})

describe('Theme conformance — WCAG AA contrast', () => {
  // Pairs obrigatórios — text/muted/body são leitura crítica.
  // Threshold AA: 4.5:1 normal text, 3.0:1 UI non-text.
  const HARD_PAIRS_AA_TEXT = [
    ['drift-text', 'drift-bg', 7.0, 'AAA'], // AAA pra reading content
    ['drift-text', 'drift-surface', 7.0, 'AAA'],
    ['drift-muted', 'drift-surface', 4.5, 'AA'],
    ['drift-body', 'drift-surface', 4.5, 'AA'],
    ['drift-accent', 'drift-bg', 4.5, 'AA'],
    ['drift-accent2', 'drift-bg', 4.5, 'AA'],
    ['drift-spread', 'drift-surface', 4.5, 'AA'],
    ['drift-bury', 'drift-surface', 4.5, 'AA'],
    ['drift-warning', 'drift-surface', 4.5, 'AA'],
    ['drift-danger', 'drift-surface', 4.5, 'AA'],
  ] as const

  const HARD_PAIRS_UI_NON_TEXT = [
    ['drift-border', 'drift-bg', 3.0, 'AA-NT'],
  ] as const

  for (const theme of THEMES) {
    const block = extractThemeBlock(theme)
    const tokens: Record<string, string> = {}
    for (const tok of [...REQUIRED_BASE_TOKENS, ...REQUIRED_ELEVATION_TOKENS]) {
      tokens[tok] = extractVar(block, tok)!
    }

    for (const [fg, bg, min, level] of HARD_PAIRS_AA_TEXT) {
      it(`${theme} · ${fg} vs ${bg} ≥ ${min}:1 (${level})`, () => {
        const ratio = contrastRatio(tokens[fg]!, tokens[bg]!)
        expect(
          ratio,
          `${theme}: ${fg}(${tokens[fg]}) vs ${bg}(${tokens[bg]}) = ${ratio.toFixed(2)}:1 (precisa ≥${min})`,
        ).toBeGreaterThanOrEqual(min)
      })
    }

    for (const [fg, bg, min, level] of HARD_PAIRS_UI_NON_TEXT) {
      it(`${theme} · ${fg} vs ${bg} ≥ ${min}:1 (${level})`, () => {
        const ratio = contrastRatio(tokens[fg]!, tokens[bg]!)
        expect(
          ratio,
          `${theme}: ${fg}(${tokens[fg]}) vs ${bg}(${tokens[bg]}) = ${ratio.toFixed(2)}:1 (precisa ≥${min})`,
        ).toBeGreaterThanOrEqual(min)
      })
    }
  }
})

describe('Theme conformance — type hierarchy luminance', () => {
  // text > body > muted em luminance pra dark; oposto pra light.
  for (const theme of THEMES) {
    it(`${theme} preserva hierarquia text > body > muted (ou inversa pra light)`, () => {
      const block = extractThemeBlock(theme)
      const text = extractVar(block, 'drift-text')!
      const body = extractVar(block, 'drift-body')!
      const muted = extractVar(block, 'drift-muted')!
      const bg = extractVar(block, 'drift-bg')!

      const Ltext = relLuminance(hexToRgb(text))
      const Lbody = relLuminance(hexToRgb(body))
      const Lmuted = relLuminance(hexToRgb(muted))
      const Lbg = relLuminance(hexToRgb(bg))

      const isLight = Lbg > 0.5
      if (isLight) {
        // Light theme: text mais ESCURO que body mais escuro que muted
        expect(Ltext, `${theme} text mais escuro que body`).toBeLessThan(Lbody)
        expect(Lbody, `${theme} body mais escuro que muted`).toBeLessThan(Lmuted)
      } else {
        // Dark theme: text mais CLARO que body mais claro que muted
        expect(Ltext, `${theme} text mais claro que body`).toBeGreaterThan(Lbody)
        expect(Lbody, `${theme} body mais claro que muted`).toBeGreaterThan(Lmuted)
      }
    })
  }
})

describe('Theme conformance — elevation luminance progression', () => {
  for (const theme of THEMES) {
    it(`${theme} elevations seguem progressão monotônica de luminance`, () => {
      const block = extractThemeBlock(theme)
      const bg = relLuminance(hexToRgb(extractVar(block, 'drift-bg')!))
      const s1 = relLuminance(hexToRgb(extractVar(block, 'drift-surface-1')!))
      const s2 = relLuminance(hexToRgb(extractVar(block, 'drift-surface-2')!))
      const s3 = relLuminance(hexToRgb(extractVar(block, 'drift-surface-3')!))
      const s4 = relLuminance(hexToRgb(extractVar(block, 'drift-surface-4')!))

      const isLight = bg > 0.5
      if (isLight) {
        // Light: surfaces sobem em luminance (papel novo é mais claro)
        expect(s1).toBeGreaterThanOrEqual(bg)
        expect(s2).toBeGreaterThanOrEqual(s1)
        expect(s3).toBeGreaterThanOrEqual(s2)
        expect(s4).toBeGreaterThanOrEqual(s3)
      } else {
        // Dark: surfaces sobem em luminance (mais clara = mais elevada)
        expect(s1).toBeGreaterThanOrEqual(bg)
        expect(s2).toBeGreaterThanOrEqual(s1)
        expect(s3).toBeGreaterThanOrEqual(s2)
        expect(s4).toBeGreaterThanOrEqual(s3)
      }
    })
  }
})

describe('LOCK_VIA_TEST — kind 0 não importa lib/theme', () => {
  // Themes são pura UI local — manifesto §22 garante score/weight independem.
  it('scoring.ts não importa lib/theme', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/scoring.ts'), 'utf-8')
    expect(src).not.toMatch(/from ['"][./]+theme['"]/)
    expect(src).not.toMatch(/applyTheme|THEME_IDS|ThemeId/)
  })

  it('weight.ts não importa lib/theme', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/weight.ts'), 'utf-8')
    expect(src).not.toMatch(/from ['"][./]+theme['"]/)
    expect(src).not.toMatch(/applyTheme|THEME_IDS|ThemeId/)
  })

  it('feed.ts não importa lib/theme', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/feed.ts'), 'utf-8')
    expect(src).not.toMatch(/from ['"][./]+theme['"]/)
    expect(src).not.toMatch(/applyTheme|THEME_IDS|ThemeId/)
  })
})
