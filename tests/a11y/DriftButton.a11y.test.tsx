/**
 * a11y test — `<DriftButton>` primitive.
 *
 * Cobre todas as 5 variants × 3 sizes em estado enabled + disabled.
 * Foca em:
 * - role=button correto
 * - accessible name
 * - aria-disabled / disabled coerentes
 * - color-contrast (axe testa contraste real do CSS computado, mas em
 *   jsdom o computed style é limitado — o run é principalmente role/ARIA)
 */
import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { DriftButton, type DriftButtonVariant, type DriftButtonSize } from '../../src/components/UI/DriftButton'
import { expectNoViolations } from './axeRunner'

const VARIANTS: DriftButtonVariant[] = ['primary', 'ghost', 'cancel', 'danger', 'danger-prominent']
const SIZES: DriftButtonSize[] = ['sm', 'md', 'lg']

describe('DriftButton — a11y', () => {
  for (const variant of VARIANTS) {
    for (const size of SIZES) {
      it(`variant=${variant} size=${size} (enabled) sem violations`, async () => {
        const { container } = render(
          <DriftButton variant={variant} size={size}>
            Ação
          </DriftButton>,
        )
        await expectNoViolations(container)
      })

      it(`variant=${variant} size=${size} (disabled) sem violations`, async () => {
        const { container } = render(
          <DriftButton variant={variant} size={size} disabled>
            Ação
          </DriftButton>,
        )
        await expectNoViolations(container)
      })
    }
  }

  it('aceita aria-label customizado em icon-only', async () => {
    const { container } = render(
      <DriftButton variant="primary" aria-label="publicar post">
        <span aria-hidden="true">↑</span>
      </DriftButton>,
    )
    await expectNoViolations(container)
  })
})
