/**
 * Tests pra `<DriftChip>` primitive — Ted RFC §3.3 + Round 4 Fase C.
 * Pure helpers (vitest node, sem React render).
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_CHIP_BASE_CLASS,
  driftChipClassName,
  driftChipSizeClass,
  driftChipVariantClass,
  type DriftChipSize,
  type DriftChipVariant,
} from '../src/components/UI/DriftChip'

describe('driftChipVariantClass', () => {
  it('neutral inactive uses drift-border + drift-muted', () => {
    const cls = driftChipVariantClass('neutral', false)
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain('text-drift-muted')
  })

  it('warning uses drift-warning token (high contrast over dark bg)', () => {
    const cls = driftChipVariantClass('warning', false)
    expect(cls).toContain('drift-warning')
    expect(cls).toContain('text-drift-warning')
  })

  it('spoiler is warning + dashed border', () => {
    const cls = driftChipVariantClass('spoiler', false)
    expect(cls).toContain('border-dashed')
    expect(cls).toContain('drift-warning')
  })

  it('spread/bury use role-locked tokens (drift-spread / drift-bury)', () => {
    expect(driftChipVariantClass('spread', false)).toContain('drift-spread')
    expect(driftChipVariantClass('bury', false)).toContain('drift-bury')
  })

  it('active state toggles fill bg (variant color @12-15% opacity)', () => {
    const inactive = driftChipVariantClass('accent', false)
    const active = driftChipVariantClass('accent', true)
    expect(active).not.toBe(inactive)
    expect(active).toContain('bg-drift-accent/12')
  })

  it('todas as variants distintas produzem strings diferentes', () => {
    const variants: DriftChipVariant[] = [
      'neutral', 'accent', 'accent2', 'spread', 'bury', 'warning', 'spoiler',
    ]
    const classes = variants.map((v) => driftChipVariantClass(v, false))
    const uniqueCount = new Set(classes).size
    expect(uniqueCount).toBe(variants.length)
  })
})

describe('driftChipSizeClass', () => {
  it('xs/sm/md scale up px+py+text', () => {
    expect(driftChipSizeClass('xs')).toContain('px-1.5')
    expect(driftChipSizeClass('sm')).toContain('px-2')
    expect(driftChipSizeClass('md')).toContain('px-3')
  })

  it('todas as sizes distintas', () => {
    const sizes: DriftChipSize[] = ['xs', 'sm', 'md']
    const classes = sizes.map(driftChipSizeClass)
    expect(new Set(classes).size).toBe(sizes.length)
  })

  it('todas têm tracking-meta (uppercase chip pattern)', () => {
    expect(driftChipSizeClass('xs')).toContain('tracking-meta')
    expect(driftChipSizeClass('sm')).toContain('tracking-meta')
    expect(driftChipSizeClass('md')).toContain('tracking-meta')
  })
})

describe('DRIFT_CHIP_BASE_CLASS', () => {
  it('inclui rounded + uppercase + font-mono', () => {
    expect(DRIFT_CHIP_BASE_CLASS).toContain('rounded')
    expect(DRIFT_CHIP_BASE_CLASS).toContain('uppercase')
    expect(DRIFT_CHIP_BASE_CLASS).toContain('font-mono')
  })

  it('inclui focus-visible ring (a11y)', () => {
    expect(DRIFT_CHIP_BASE_CLASS).toContain('focus-visible:ring-1')
    expect(DRIFT_CHIP_BASE_CLASS).toContain('focus-visible:ring-drift-accent2')
  })
})

describe('driftChipClassName (composer)', () => {
  it('default = neutral + sm + inactive', () => {
    const cls = driftChipClassName()
    expect(cls).toContain(DRIFT_CHIP_BASE_CLASS)
    expect(cls).toContain(driftChipSizeClass('sm'))
    expect(cls).toContain(driftChipVariantClass('neutral', false))
  })

  it('respeita variant + size + active', () => {
    const cls = driftChipClassName('warning', 'xs', true)
    expect(cls).toContain(driftChipVariantClass('warning', true))
    expect(cls).toContain(driftChipSizeClass('xs'))
  })

  it('extra className apendado', () => {
    const cls = driftChipClassName('neutral', 'sm', false, 'ml-2')
    expect(cls).toContain('ml-2')
  })

  it('determinístico (pure)', () => {
    const a = driftChipClassName('warning', 'xs', true, 'extra')
    const b = driftChipClassName('warning', 'xs', true, 'extra')
    expect(a).toBe(b)
  })
})
