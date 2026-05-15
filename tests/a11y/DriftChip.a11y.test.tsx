/**
 * a11y test — `<DriftChip>` primitive.
 *
 * Cobre 7 variants × 3 sizes em modes:
 * - render como `<span>` (sem onClick)
 * - render como `<button aria-pressed>` (com onClick)
 *
 * Verifica: aria-pressed semantics, accessible name (via children
 * ou ariaLabel), focus ring (estrutural via class — axe valida
 * focus-visible no DOM se aplicável).
 */
import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { DriftChip, type DriftChipVariant, type DriftChipSize } from '../../src/components/UI/DriftChip'
import { expectNoViolations } from './axeRunner'

const VARIANTS: DriftChipVariant[] = [
  'neutral',
  'accent',
  'accent2',
  'spread',
  'bury',
  'warning',
  'spoiler',
]
const SIZES: DriftChipSize[] = ['xs', 'sm', 'md']

describe('DriftChip — a11y', () => {
  for (const variant of VARIANTS) {
    for (const size of SIZES) {
      it(`variant=${variant} size=${size} span (passive)`, async () => {
        const { container } = render(
          <DriftChip variant={variant} size={size}>
            categoria
          </DriftChip>,
        )
        await expectNoViolations(container)
      })

      it(`variant=${variant} size=${size} button (pressable, active=false)`, async () => {
        const { container } = render(
          <DriftChip
            variant={variant}
            size={size}
            onClick={() => {}}
            ariaLabel="filtrar por categoria"
          >
            categoria
          </DriftChip>,
        )
        await expectNoViolations(container)
      })

      it(`variant=${variant} size=${size} button (pressable, active=true)`, async () => {
        const { container } = render(
          <DriftChip
            variant={variant}
            size={size}
            active
            onClick={() => {}}
            ariaLabel="filtrar por categoria"
          >
            categoria
          </DriftChip>,
        )
        await expectNoViolations(container)
      })
    }
  }
})
