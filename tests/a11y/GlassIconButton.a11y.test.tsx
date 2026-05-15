/**
 * a11y test — `<GlassIconButton>` primitive.
 *
 * Icon-only buttons são um dos maiores fontes de violations em apps —
 * `aria-label` obrigatório, ícone com `aria-hidden`, tap target ≥44px
 * (WCAG 2.5.5) na size `xl`.
 *
 * Não valida tap target via axe-core (axe ainda não cobre 2.5.5
 * confiavelmente em jsdom — feito por LH/manual). Cobre o resto.
 */
import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  GlassIconButton,
  type GlassIconButtonVariant,
  type GlassIconButtonSize,
} from '../../src/components/UI/GlassIconButton'
import { expectNoViolations } from './axeRunner'

const VARIANTS: GlassIconButtonVariant[] = ['default', 'destructive']
const SIZES: GlassIconButtonSize[] = ['sm', 'md', 'lg', 'xl']

describe('GlassIconButton — a11y', () => {
  for (const variant of VARIANTS) {
    for (const size of SIZES) {
      it(`variant=${variant} size=${size}`, async () => {
        const { container } = render(
          <GlassIconButton variant={variant} size={size} aria-label="abrir menu">
            <span aria-hidden="true">⋮</span>
          </GlassIconButton>,
        )
        await expectNoViolations(container)
      })
    }
  }

  it('disabled state', async () => {
    const { container } = render(
      <GlassIconButton aria-label="fechar" disabled>
        <span aria-hidden="true">✕</span>
      </GlassIconButton>,
    )
    await expectNoViolations(container)
  })
})
