/**
 * Tests pra `<DriftCard>` primitive — Ted RFC §3.1 + Round 4 Fase A.
 *
 * Mesma filosofia dos tests de DriftButton (vitest node, pure helpers).
 * Cobre: variant×size matrix, clickable toggle, shadow-stack constants,
 * className composition, determinismo (pure).
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_CARD_BASE_CLASS,
  DRIFT_CARD_CLICKABLE_CLASS,
  DRIFT_CARD_SHADOW_BACK_CLASS,
  DRIFT_CARD_SHADOW_MID_CLASS,
  driftCardClassName,
  driftCardSizeClass,
  driftCardVariantClass,
  type DriftCardSize,
  type DriftCardVariant,
} from '../src/components/UI/DriftCard'

describe('driftCardVariantClass', () => {
  it('default uses bg-drift-surface + border-drift-border + rounded (PostCard padrão)', () => {
    const cls = driftCardVariantClass('default')
    expect(cls).toContain('bg-drift-surface')
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain('rounded')
    expect(cls).not.toContain('shadow-')
  })

  it('elevated adds shadow on top of default surface (PostViewer card)', () => {
    const cls = driftCardVariantClass('elevated')
    expect(cls).toContain('bg-drift-surface')
    expect(cls).toContain('shadow-[')
    expect(cls).toContain('rounded')
  })

  it('inset uses bg-drift-bg (sub-cards aninhados em FullPageCard)', () => {
    const cls = driftCardVariantClass('inset')
    expect(cls).toContain('bg-drift-bg')
    expect(cls).toContain('border-drift-border')
    expect(cls).not.toContain('bg-drift-surface')
  })

  it('shadow-stack reuses default surface (stack rendering vem por slots)', () => {
    const cls = driftCardVariantClass('shadow-stack')
    expect(cls).toContain('bg-drift-surface')
    expect(cls).toContain('border-drift-border')
  })

  it('todas as variants distintas produzem strings diferentes (sem cópia)', () => {
    const variants: DriftCardVariant[] = [
      'default',
      'elevated',
      'inset',
      'shadow-stack',
    ]
    const classes = variants.map(driftCardVariantClass)
    const uniqueCount = new Set(classes).size
    // shadow-stack === default visualmente; outras 3 são distintas.
    expect(uniqueCount).toBeGreaterThanOrEqual(3)
  })
})

describe('driftCardSizeClass', () => {
  it('sm = px-3 py-2 (CommentCard compacto)', () => {
    const cls = driftCardSizeClass('sm')
    expect(cls).toContain('px-3')
    expect(cls).toContain('py-2')
  })

  it('md = px-4 py-3 (PostCard default)', () => {
    const cls = driftCardSizeClass('md')
    expect(cls).toContain('px-4')
    expect(cls).toContain('py-3')
  })

  it('lg = px-5 py-4 (overlay full-bleed)', () => {
    const cls = driftCardSizeClass('lg')
    expect(cls).toContain('px-5')
    expect(cls).toContain('py-4')
  })

  it('todas as sizes distintas produzem strings diferentes', () => {
    const sizes: DriftCardSize[] = ['sm', 'md', 'lg']
    const classes = sizes.map(driftCardSizeClass)
    expect(new Set(classes).size).toBe(sizes.length)
  })
})

describe('DRIFT_CARD_BASE_CLASS', () => {
  it('inclui relative (anchor pra decoration absolute) + overflow-hidden', () => {
    expect(DRIFT_CARD_BASE_CLASS).toContain('relative')
    expect(DRIFT_CARD_BASE_CLASS).toContain('overflow-hidden')
  })

  it('inclui transition-colors pra hover/focus suave', () => {
    expect(DRIFT_CARD_BASE_CLASS).toContain('transition-colors')
  })
})

describe('DRIFT_CARD_CLICKABLE_CLASS', () => {
  it('inclui cursor-pointer + focus-visible ring (a11y)', () => {
    expect(DRIFT_CARD_CLICKABLE_CLASS).toContain('cursor-pointer')
    expect(DRIFT_CARD_CLICKABLE_CLASS).toContain('focus-visible:ring-2')
    expect(DRIFT_CARD_CLICKABLE_CLASS).toContain('focus-visible:ring-drift-accent2')
  })

  it('inclui hover state sutil (border-drift-accent/40)', () => {
    expect(DRIFT_CARD_CLICKABLE_CLASS).toContain('hover:border-drift-accent')
  })
})

describe('DRIFT_CARD_SHADOW_*_CLASS (shadow-stack)', () => {
  it('back/mid são absolute pointer-events-none (visual puro)', () => {
    expect(DRIFT_CARD_SHADOW_BACK_CLASS).toContain('absolute')
    expect(DRIFT_CARD_SHADOW_BACK_CLASS).toContain('pointer-events-none')
    expect(DRIFT_CARD_SHADOW_MID_CLASS).toContain('absolute')
    expect(DRIFT_CARD_SHADOW_MID_CLASS).toContain('pointer-events-none')
  })

  it('back fica abaixo do mid (z-index ordering)', () => {
    expect(DRIFT_CARD_SHADOW_BACK_CLASS).toContain('-z-20')
    expect(DRIFT_CARD_SHADOW_MID_CLASS).toContain('-z-10')
  })

  it('shadow cards usam mesma surface + border que o card principal', () => {
    expect(DRIFT_CARD_SHADOW_BACK_CLASS).toContain('bg-drift-surface')
    expect(DRIFT_CARD_SHADOW_BACK_CLASS).toContain('border-drift-border')
    expect(DRIFT_CARD_SHADOW_MID_CLASS).toContain('bg-drift-surface')
  })
})

describe('driftCardClassName (composer)', () => {
  it('inclui base + variant + size (default → variant=default size=md)', () => {
    const cls = driftCardClassName()
    expect(cls).toContain(DRIFT_CARD_BASE_CLASS)
    expect(cls).toContain(driftCardVariantClass('default'))
    expect(cls).toContain(driftCardSizeClass('md'))
  })

  it('respeita variant + size props', () => {
    const cls = driftCardClassName('elevated', 'lg')
    expect(cls).toContain(driftCardVariantClass('elevated'))
    expect(cls).toContain(driftCardSizeClass('lg'))
    expect(cls).not.toContain(driftCardSizeClass('md'))
  })

  it('clickable=true adiciona DRIFT_CARD_CLICKABLE_CLASS', () => {
    const cls = driftCardClassName('default', 'md', true)
    expect(cls).toContain(DRIFT_CARD_CLICKABLE_CLASS)
  })

  it('clickable=false não adiciona DRIFT_CARD_CLICKABLE_CLASS', () => {
    const cls = driftCardClassName('default', 'md', false)
    expect(cls).not.toContain('cursor-pointer')
    expect(cls).not.toContain('focus-visible:ring-2')
  })

  it('extra className é apendado no final', () => {
    const cls = driftCardClassName('default', 'md', false, 'h-full w-full')
    expect(cls).toContain('h-full')
    expect(cls).toContain('w-full')
  })

  it('extra=undefined não introduz "undefined" string', () => {
    const cls = driftCardClassName('default', 'md', false, undefined)
    expect(cls).not.toContain('undefined')
  })

  it('output determinístico (pure)', () => {
    const a = driftCardClassName('inset', 'sm', true, 'extra')
    const b = driftCardClassName('inset', 'sm', true, 'extra')
    expect(a).toBe(b)
  })

  it('matrix variant×size produz combinações únicas (sem colisão)', () => {
    const variants: DriftCardVariant[] = ['default', 'elevated', 'inset']
    const sizes: DriftCardSize[] = ['sm', 'md', 'lg']
    const matrix: string[] = []
    for (const v of variants) {
      for (const s of sizes) {
        matrix.push(driftCardClassName(v, s))
      }
    }
    expect(new Set(matrix).size).toBe(matrix.length)
  })
})
