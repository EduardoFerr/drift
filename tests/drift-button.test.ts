/**
 * Tests pra `<DriftButton>` primitive — convergente com Robin QA #1 §7
 * (Refactor maior: consolidar 4 padrões diferentes de botão secundário).
 *
 * Vitest config = environment node. Não rendeiza React; testa as funções
 * puras que mapeiam variant/size pra Tailwind classNames. Isso cobre:
 *
 * 1. Cada variant produz a paleta esperada (drift-accent vs drift-bury,
 *    primary cheio vs ghost border-only, etc.)
 * 2. Cada size produz padding/text esperados
 * 3. Composição via `driftButtonClassName` inclui base + size + variant
 * 4. Extra className é apendado, não sobrescreve variant styles
 *
 * Não testa motion / DOM render — pura lógica.
 */

import { describe, expect, it } from 'vitest'
import {
  DRIFT_BUTTON_BASE_CLASS,
  driftButtonClassName,
  driftButtonSizeClass,
  driftButtonVariantClass,
  type DriftButtonSize,
  type DriftButtonVariant,
} from '../src/components/UI/DriftButton'

describe('driftButtonVariantClass', () => {
  it('primary uses drift-accent bg + drift-bg text (CTA forte, DRIFT ↑ style)', () => {
    const cls = driftButtonVariantClass('primary')
    expect(cls).toContain('bg-drift-accent')
    expect(cls).toContain('text-drift-bg')
    expect(cls).toContain('hover:opacity-90')
    expect(cls).toContain('disabled:opacity-30')
  })

  it('ghost uses border-drift-accent + text-drift-accent2 (FECHAR / cancel padrão)', () => {
    const cls = driftButtonVariantClass('ghost')
    expect(cls).toContain('border-drift-accent')
    expect(cls).toContain('bg-transparent')
    expect(cls).toContain('text-drift-accent2')
    expect(cls).toContain('hover:bg-drift-accent2/10')
  })

  it('cancel uses border-drift-border + text-drift-muted (cancel discreto)', () => {
    const cls = driftButtonVariantClass('cancel')
    expect(cls).toContain('border-drift-border')
    expect(cls).toContain('bg-transparent')
    expect(cls).toContain('text-drift-muted')
    expect(cls).toContain('hover:text-drift-text')
  })

  it('danger uses drift-bury border + text + transparent bg (limpar local style)', () => {
    const cls = driftButtonVariantClass('danger')
    expect(cls).toContain('border-drift-bury')
    expect(cls).toContain('bg-transparent')
    expect(cls).toContain('text-drift-bury')
    expect(cls).toContain('hover:bg-drift-bury/10')
  })

  it('danger-prominent uses drift-bury bg cheio + drift-bg text (delete alta visibilidade)', () => {
    const cls = driftButtonVariantClass('danger-prominent')
    expect(cls).toContain('bg-drift-bury')
    expect(cls).toContain('text-drift-bg')
    expect(cls).toContain('hover:opacity-90')
    expect(cls).toContain('disabled:opacity-30')
  })

  it('todas as variants distintas produzem strings diferentes (sem cópia acidental)', () => {
    const variants: DriftButtonVariant[] = [
      'primary',
      'ghost',
      'cancel',
      'danger',
      'danger-prominent',
    ]
    const classes = variants.map(driftButtonVariantClass)
    const uniqueCount = new Set(classes).size
    expect(uniqueCount).toBe(variants.length)
  })

  it('primary e danger-prominent NÃO têm border (são bg cheios)', () => {
    expect(driftButtonVariantClass('primary')).not.toContain('border-')
    expect(driftButtonVariantClass('danger-prominent')).not.toContain('border-')
  })

  it('ghost / cancel / danger TÊM border (são outline-style)', () => {
    expect(driftButtonVariantClass('ghost')).toContain('border ')
    expect(driftButtonVariantClass('cancel')).toContain('border ')
    expect(driftButtonVariantClass('danger')).toContain('border ')
  })
})

describe('driftButtonSizeClass', () => {
  it('sm = px-2 py-1 text-[10px], sem uppercase tracking (mini button inline)', () => {
    const cls = driftButtonSizeClass('sm')
    expect(cls).toContain('px-2')
    expect(cls).toContain('py-1')
    expect(cls).toContain('text-[10px]')
    expect(cls).not.toContain('uppercase')
    expect(cls).not.toContain('tracking-')
  })

  it('md = px-3 py-[5px] text-[12px] uppercase tracking-[2px] (default — match FECHAR)', () => {
    const cls = driftButtonSizeClass('md')
    expect(cls).toContain('px-3')
    expect(cls).toContain('py-[5px]')
    // V10.10 (Lighthouse font-size audit): 11px era 29% do texto da page,
    // abaixo do limiar de 12px de legibilidade mobile. Bump pra 12px (1px
    // visual delta) leva legível de 53% pra 83%, passa audit.
    expect(cls).toContain('text-[12px]')
    expect(cls).toContain('uppercase')
    expect(cls).toContain('tracking-[2px]')
  })

  it('lg = px-4 py-2 text-xs uppercase tracking-widest (CTA principal)', () => {
    const cls = driftButtonSizeClass('lg')
    expect(cls).toContain('px-4')
    expect(cls).toContain('py-2')
    expect(cls).toContain('text-xs')
    expect(cls).toContain('uppercase')
    expect(cls).toContain('tracking-widest')
  })

  it('todas as sizes distintas produzem strings diferentes', () => {
    const sizes: DriftButtonSize[] = ['sm', 'md', 'lg']
    const classes = sizes.map(driftButtonSizeClass)
    const uniqueCount = new Set(classes).size
    expect(uniqueCount).toBe(sizes.length)
  })
})

describe('DRIFT_BUTTON_BASE_CLASS', () => {
  it('inclui rounded + transition + focus-visible ring (a11y baseline)', () => {
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('rounded')
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('transition-colors')
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('focus-visible:ring-1')
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('focus-visible:ring-drift-accent2')
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('focus-visible:ring-offset-2')
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('focus-visible:ring-offset-drift-bg')
  })

  it('inclui font-mono — botões DRIFT usam font-mono pra labels', () => {
    expect(DRIFT_BUTTON_BASE_CLASS).toContain('font-mono')
  })
})

describe('driftButtonClassName (composer)', () => {
  it('inclui base + size + variant (default md)', () => {
    const cls = driftButtonClassName('primary')
    expect(cls).toContain(DRIFT_BUTTON_BASE_CLASS)
    expect(cls).toContain(driftButtonSizeClass('md'))
    expect(cls).toContain(driftButtonVariantClass('primary'))
  })

  it('respeita size prop quando passado', () => {
    const cls = driftButtonClassName('ghost', 'lg')
    expect(cls).toContain(driftButtonSizeClass('lg'))
    expect(cls).not.toContain(driftButtonSizeClass('md'))
  })

  it('apenda extra className no final', () => {
    const cls = driftButtonClassName('primary', 'md', 'flex-1 w-full')
    expect(cls).toContain('flex-1')
    expect(cls).toContain('w-full')
    expect(cls).toContain(driftButtonVariantClass('primary'))
  })

  it('extra=undefined não adiciona "undefined" string', () => {
    const cls = driftButtonClassName('primary', 'md', undefined)
    expect(cls).not.toContain('undefined')
  })

  it('extra empty string não muda output', () => {
    const cls = driftButtonClassName('primary', 'md', '')
    // empty string é falsy — não é apendada
    expect(cls).toBe(driftButtonClassName('primary', 'md'))
  })

  it('produz output estável (determinismo — função pura)', () => {
    const a = driftButtonClassName('danger', 'md', 'extra')
    const b = driftButtonClassName('danger', 'md', 'extra')
    expect(a).toBe(b)
  })
})
