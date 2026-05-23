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
  // 2026-05-23 (Ted+Barney audit §2.2): sizes legacy `sm`/`md`/`lg`
  // removidas — eram pre-WCAG 2.5.5 e funcionavam como trap pra novos
  // contributors adotarem tap target sub-44px. Único size suportado
  // agora é `xl` (44×44).
  it('xl = h-11 w-11 com ícone text-[18px] (WCAG 2.5.5 AA — 44×44 tap target)', () => {
    const cls = glassIconButtonSizeClass('xl')
    expect(cls).toContain('h-11')
    expect(cls).toContain('w-11')
    expect(cls).toContain('text-[18px]')
  })

  it('size H = W (aspect 1:1, círculo regular)', () => {
    // h-N e w-N com mesmo N — aspect ratio garantido pra rounded-full.
    const sizes: GlassIconButtonSize[] = ['xl']
    const expected: Record<GlassIconButtonSize, [string, string]> = {
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
  it('default: inclui base + size xl + variant default (WCAG-by-default)', () => {
    const cls = glassIconButtonClassName()
    expect(cls).toContain(GLASS_ICON_BUTTON_BASE_CLASS)
    expect(cls).toContain(glassIconButtonSizeClass('xl'))
    expect(cls).toContain(glassIconButtonVariantClass('default'))
  })

  it('respeita variant prop quando passado', () => {
    const cls = glassIconButtonClassName('destructive')
    expect(cls).toContain(glassIconButtonVariantClass('destructive'))
    expect(cls).not.toContain(glassIconButtonVariantClass('default'))
  })

  it('apenda extra className (positioning) no final', () => {
    const cls = glassIconButtonClassName(
      'default',
      'xl',
      'absolute right-6 top-6 z-30',
    )
    expect(cls).toContain('absolute')
    expect(cls).toContain('right-6')
    expect(cls).toContain('top-6')
    expect(cls).toContain('z-30')
    expect(cls).toContain(glassIconButtonVariantClass('default'))
  })

  it('extra=undefined não adiciona "undefined" string', () => {
    const cls = glassIconButtonClassName('default', 'xl', undefined)
    expect(cls).not.toContain('undefined')
  })

  it('extra empty string não muda output', () => {
    const cls = glassIconButtonClassName('default', 'xl', '')
    expect(cls).toBe(glassIconButtonClassName('default', 'xl'))
  })

  it('produz output estável (determinismo — função pura)', () => {
    const a = glassIconButtonClassName('destructive', 'xl', 'absolute top-2')
    const b = glassIconButtonClassName('destructive', 'xl', 'absolute top-2')
    expect(a).toBe(b)
  })

  it('replica o pattern do PostViewer ⋮ (smoke test do glass effect)', () => {
    // Os tokens críticos do "glass" devem estar todos presentes —
    // defesa contra regressão silenciosa em refactor futuro.
    const cls = glassIconButtonClassName(
      'default',
      'xl',
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
      'h-11',
      'w-11',
    ]
    for (const token of requiredTokens) {
      expect(cls).toContain(token)
    }
  })

  it('WCAG anti-regressão: bundle nunca contém sub-44px sizes legacy', () => {
    // Trap pra futuro: se alguém re-introduzir `sm`/`md`/`lg`, este
    // teste falha. Ted+Barney audit 2026-05-23 §2.2 (WCAG threat).
    const cls = glassIconButtonClassName()
    expect(cls, 'glass icon button default não pode ser sub-44px (h-11 w-11 = 44px)').toContain('h-11')
    expect(cls).not.toMatch(/\bh-[678]\b/)
    expect(cls).not.toMatch(/\bw-[678]\b/)
  })
})
