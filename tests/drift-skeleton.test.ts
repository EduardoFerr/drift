/**
 * Tests pra `<DriftSkeleton>` primitive — Ted RFC §3.5 + Lily RFC §3.2
 * + Robin REC-2. Pure helpers (vitest node).
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_SKELETON_BASE_CLASS,
  DRIFT_SKELETON_BLOCK_CLASS,
  driftSkeletonAnimationClass,
  driftSkeletonVariantClass,
  type DriftSkeletonAnimation,
  type DriftSkeletonVariant,
} from '../src/components/UI/DriftSkeleton'

describe('driftSkeletonAnimationClass', () => {
  it('shimmer / pulse incluem motion-reduce:animate-none (a11y)', () => {
    expect(driftSkeletonAnimationClass('shimmer')).toContain('motion-reduce:animate-none')
    expect(driftSkeletonAnimationClass('pulse')).toContain('motion-reduce:animate-none')
  })

  it('static não tem animação (vazia)', () => {
    expect(driftSkeletonAnimationClass('static')).toBe('')
  })

  it('shimmer e pulse usam animate-pulse (Tailwind built-in)', () => {
    // shimmer é fallback friendly — usa pulse até CSS keyframe shimmer
    // ser definido em index.css.
    expect(driftSkeletonAnimationClass('shimmer')).toContain('animate-pulse')
    expect(driftSkeletonAnimationClass('pulse')).toContain('animate-pulse')
  })

  it('todas as animations definidas', () => {
    const anims: DriftSkeletonAnimation[] = ['shimmer', 'pulse', 'static']
    for (const a of anims) {
      expect(typeof driftSkeletonAnimationClass(a)).toBe('string')
    }
  })
})

describe('driftSkeletonVariantClass', () => {
  it('text usa block color + h-3 (linha fina)', () => {
    const cls = driftSkeletonVariantClass('text')
    expect(cls).toContain('h-3')
    expect(cls).toContain(DRIFT_SKELETON_BLOCK_CLASS)
  })

  it('card usa gradient + border-drift-border', () => {
    const cls = driftSkeletonVariantClass('card')
    expect(cls).toContain('rounded')
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain(DRIFT_SKELETON_BASE_CLASS)
  })

  it('avatar usa rounded-full h-8 w-8', () => {
    const cls = driftSkeletonVariantClass('avatar')
    expect(cls).toContain('rounded-full')
    expect(cls).toContain('h-8')
    expect(cls).toContain('w-8')
  })

  it('image usa overflow-hidden rounded + gradient', () => {
    const cls = driftSkeletonVariantClass('image')
    expect(cls).toContain('overflow-hidden')
    expect(cls).toContain('rounded')
    expect(cls).toContain(DRIFT_SKELETON_BASE_CLASS)
  })

  it('todas as variants distintas', () => {
    const variants: DriftSkeletonVariant[] = ['text', 'card', 'avatar', 'image']
    const classes = variants.map(driftSkeletonVariantClass)
    expect(new Set(classes).size).toBe(variants.length)
  })
})

describe('DRIFT_SKELETON_BASE_CLASS / BLOCK_CLASS', () => {
  it('base usa gradient drift-surface → drift-bg (alinhado a Image.tsx)', () => {
    expect(DRIFT_SKELETON_BASE_CLASS).toContain('bg-gradient-to-br')
    expect(DRIFT_SKELETON_BASE_CLASS).toContain('from-drift-surface')
    expect(DRIFT_SKELETON_BASE_CLASS).toContain('to-drift-bg')
  })

  it('block usa drift-border @40% (sutil, sem gradient)', () => {
    expect(DRIFT_SKELETON_BLOCK_CLASS).toContain('drift-border/40')
  })
})
