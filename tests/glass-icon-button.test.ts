/**
 * Tests pra `<GlassIconButton>` primitive — pattern "double-edge layer"
 * (border chartreuse + ring mint = duas linhas paralelas) propagado a
 * partir do botão ⋮ original do PostViewer (V11 actions menu).
 *
 * Vitest config = environment node. Não rendeiza React; testa as funções
 * puras que mapeiam variant/size pra Tailwind classNames.
 */

import { describe, expect, it } from 'vitest'
import {
  GLASS_ICON_BUTTON_BASE_CLASS,
  glassIconButtonClassName,
  glassIconButtonSizeClass,
  glassIconButtonVariantClass,
  type GlassIconButtonSize,
  type GlassIconButtonVariant,
} from '../src/components/UI/GlassIconButton'

describe('glassIconButtonVariantClass', () => {
  it('default usa drift-border + bg-drift-surface/80 + backdrop-blur (glass) + hover chartreuse', () => {
    const cls = glassIconButtonVariantClass('default')
    // Glass core (frosted layer)
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain('bg-drift-surface/80')
    expect(cls).toContain('backdrop-blur-sm')
    expect(cls).toContain('text-drift-muted')
    // Hover: chartreuse (drift-accent) — primeira linha do double-edge
    expect(cls).toContain('hover:border-drift-accent')
    expect(cls).toContain('hover:text-drift-accent')
  })

  it('destructive mantém glass base mas hover muda pra drift-bury', () => {
    const cls = glassIconButtonVariantClass('destructive')
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain('bg-drift-surface/80')
    expect(cls).toContain('backdrop-blur-sm')
    expect(cls).toContain('hover:border-drift-bury')
    expect(cls).toContain('hover:text-drift-bury')
    // não usa hover accent — ações destrutivas têm sua própria cor
    expect(cls).not.toContain('hover:border-drift-accent')
    expect(cls).not.toContain('hover:text-drift-accent')
  })

  it('todas as variants distintas produzem strings diferentes', () => {
    const variants: GlassIconButtonVariant[] = ['default', 'destructive']
    const classes = variants.map(glassIconButtonVariantClass)
    const uniqueCount = new Set(classes).size
    expect(uniqueCount).toBe(variants.length)
  })
})

describe('glassIconButtonSizeClass', () => {
  it('sm = h-6 w-6 com ícone text-[12px]', () => {
    const cls = glassIconButtonSizeClass('sm')
    expect(cls).toContain('h-6')
    expect(cls).toContain('w-6')
    expect(cls).toContain('text-[12px]')
  })

  it('md = h-7 w-7 com ícone text-[14px] (default — match PostViewer ⋮)', () => {
    const cls = glassIconButtonSizeClass('md')
    expect(cls).toContain('h-7')
    expect(cls).toContain('w-7')
    expect(cls).toContain('text-[14px]')
  })

  it('lg = h-8 w-8 com ícone text-[16px]', () => {
    const cls = glassIconButtonSizeClass('lg')
    expect(cls).toContain('h-8')
    expect(cls).toContain('w-8')
    expect(cls).toContain('text-[16px]')
  })

  it('xl = h-11 w-11 com ícone text-[18px] (WCAG 2.5.5 AA — 44×44 tap target)', () => {
    const cls = glassIconButtonSizeClass('xl')
    expect(cls).toContain('h-11')
    expect(cls).toContain('w-11')
    expect(cls).toContain('text-[18px]')
  })

  it('todas as sizes distintas produzem strings diferentes', () => {
    const sizes: GlassIconButtonSize[] = ['sm', 'md', 'lg', 'xl']
    const classes = sizes.map(glassIconButtonSizeClass)
    const uniqueCount = new Set(classes).size
    expect(uniqueCount).toBe(sizes.length)
  })

  it('size H = W (aspect 1:1, círculo regular)', () => {
    // h-N e w-N com mesmo N — aspect ratio garantido pra rounded-full.
    const sizes: GlassIconButtonSize[] = ['sm', 'md', 'lg', 'xl']
    const expected: Record<GlassIconButtonSize, [string, string]> = {
      sm: ['h-6', 'w-6'],
      md: ['h-7', 'w-7'],
      lg: ['h-8', 'w-8'],
      xl: ['h-11', 'w-11'],
    }
    for (const s of sizes) {
      const cls = glassIconButtonSizeClass(s)
      expect(cls).toContain(expected[s][0])
      expect(cls).toContain(expected[s][1])
    }
  })
})

describe('GLASS_ICON_BUTTON_BASE_CLASS', () => {
  it('inclui rounded-full (shape circular — defining trait do glass icon)', () => {
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('rounded-full')
  })

  it('inclui flex items-center justify-center (centra o ícone)', () => {
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('flex')
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('items-center')
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('justify-center')
  })

  it('inclui focus:ring-1 + focus:ring-drift-accent2 (mint — segunda linha do double-edge)', () => {
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('focus:ring-1')
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('focus:ring-drift-accent2')
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('focus:outline-none')
  })

  it('inclui transition-colors (smooth hover/focus)', () => {
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('transition-colors')
  })

  it('inclui disabled state (opacity + cursor)', () => {
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('disabled:cursor-not-allowed')
    expect(GLASS_ICON_BUTTON_BASE_CLASS).toContain('disabled:opacity-40')
  })

  it('NÃO inclui dimensões fixas (size class fornece h/w)', () => {
    // Anti-regression: se alguém move h-7 w-7 pro base, sm/lg quebram.
    expect(GLASS_ICON_BUTTON_BASE_CLASS).not.toMatch(/\bh-\d/)
    expect(GLASS_ICON_BUTTON_BASE_CLASS).not.toMatch(/\bw-\d/)
  })
})

describe('glassIconButtonClassName (composer)', () => {
  it('default: inclui base + size md + variant default', () => {
    const cls = glassIconButtonClassName()
    expect(cls).toContain(GLASS_ICON_BUTTON_BASE_CLASS)
    expect(cls).toContain(glassIconButtonSizeClass('md'))
    expect(cls).toContain(glassIconButtonVariantClass('default'))
  })

  it('respeita variant prop quando passado', () => {
    const cls = glassIconButtonClassName('destructive')
    expect(cls).toContain(glassIconButtonVariantClass('destructive'))
    expect(cls).not.toContain(glassIconButtonVariantClass('default'))
  })

  it('respeita size prop quando passado', () => {
    const cls = glassIconButtonClassName('default', 'lg')
    expect(cls).toContain(glassIconButtonSizeClass('lg'))
    expect(cls).not.toContain(glassIconButtonSizeClass('md'))
  })

  it('apenda extra className (positioning) no final', () => {
    const cls = glassIconButtonClassName(
      'default',
      'md',
      'absolute right-6 top-6 z-30',
    )
    expect(cls).toContain('absolute')
    expect(cls).toContain('right-6')
    expect(cls).toContain('top-6')
    expect(cls).toContain('z-30')
    expect(cls).toContain(glassIconButtonVariantClass('default'))
  })

  it('extra=undefined não adiciona "undefined" string', () => {
    const cls = glassIconButtonClassName('default', 'md', undefined)
    expect(cls).not.toContain('undefined')
  })

  it('extra empty string não muda output', () => {
    const cls = glassIconButtonClassName('default', 'md', '')
    expect(cls).toBe(glassIconButtonClassName('default', 'md'))
  })

  it('produz output estável (determinismo — função pura)', () => {
    const a = glassIconButtonClassName('destructive', 'lg', 'absolute top-2')
    const b = glassIconButtonClassName('destructive', 'lg', 'absolute top-2')
    expect(a).toBe(b)
  })

  it('replica o pattern original do PostViewer ⋮ (smoke test do pattern)', () => {
    // Composição equivalente ao botão hardcoded em PostViewer.tsx:427
    // (com positioning extra). Os tokens críticos do "glass" devem estar
    // todos presentes — defesa contra regressão silenciosa.
    const cls = glassIconButtonClassName(
      'default',
      'md',
      'absolute right-6 top-6 z-30',
    )
    const requiredTokens = [
      'rounded-full',
      'border-drift-border',
      'bg-drift-surface/80',
      'backdrop-blur-sm',
      'text-drift-muted',
      'hover:border-drift-accent',
      'hover:text-drift-accent',
      'focus:ring-1',
      'focus:ring-drift-accent2',
      'h-7',
      'w-7',
    ]
    for (const token of requiredTokens) {
      expect(cls).toContain(token)
    }
  })
})
