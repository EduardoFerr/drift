/**
 * DriftButton — primitive de botão com variants alinhados ao design system v0.7.
 *
 * Convergente com Robin QA #1 §7 (`design-qa-baseline-2026-05-08.md`):
 * a auditoria revelou ≥4 padrões distintos de "botão secondary" (text-slate
 * legacy, hex hardcoded em `border-red-700`, `text-drift-bury + hover hex`,
 * etc.). Este primitive consolida os padrões em 5 variants × 3 sizes,
 * eliminando deriva visual e dando 1 ponto de controle pra mudanças de
 * design system futuras (v0.8 etc).
 *
 * Variants (semântica):
 *   - `primary`        → CTA forte (DRIFT ↑, publicar, importar). Bg accent
 *                        + text bg invertido (chartreuse cheio sobre dark).
 *   - `ghost`          → Default secondary (FECHAR, ações neutras).
 *                        Border accent + text accent2.
 *   - `cancel`         → Cancelar discreto (CANCELAR no compose, etc.).
 *                        Border drift-border + text drift-muted.
 *   - `danger`         → Ação destrutiva neutra (limpar local, desligar
 *                        helia). Border drift-bury + text drift-bury sem bg.
 *   - `danger-prominent` → Delete/destrutivo de alta visibilidade.
 *                          Bg drift-bury cheio + text drift-bg.
 *
 * Sizes:
 *   - `sm` → mini-buttons inline (px-2 py-1, text-[12px], no tracking)
 *   - `md` → default (px-3 py-[5px], text-[12px], tracking-[2px])
 *   - `lg` → CTA primário (px-4 py-2, text-xs, tracking-widest)
 *
 * Adoção: este primitive existe pra usar gradualmente. Não quebra nada;
 * sites legados podem continuar com classes inline até migração coordenada
 * (sessão paralela). Migração ampla é tracked em design-system v0.8.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type DriftButtonVariant =
  | 'primary'
  | 'ghost'
  | 'cancel'
  | 'danger'
  | 'danger-prominent'

export type DriftButtonSize = 'sm' | 'md' | 'lg'

export interface DriftButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Estilo visual / semântica. */
  variant: DriftButtonVariant
  /** Tamanho (default `md`). */
  size?: DriftButtonSize
  /**
   * Tipo HTML — default `button` pra evitar submit acidental em forms.
   * Use `'submit'` apenas em forms reais.
   */
  type?: 'button' | 'submit' | 'reset'
  children: ReactNode
  /**
   * Adicional className apendado ao final — útil pra `flex-1`,
   * `w-full`, ajustes de layout pelo caller. Não sobrescreve variant
   * styles; só adiciona.
   */
  className?: string
}

/**
 * Mapeia variant pra classes Tailwind. Função pura — testável sem
 * renderizar React. Exported pra uso em tests.
 */
export function driftButtonVariantClass(variant: DriftButtonVariant): string {
  switch (variant) {
    case 'primary':
      // DRIFT ↑ style — chartreuse cheio sobre fundo dark. Hover diminui
      // opacity (consistente com ComposeOverlay actual).
      return 'bg-drift-accent text-drift-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30'
    case 'ghost':
      // FECHAR style — border accent + text accent2 + hover bg accent2/10.
      return 'border border-drift-accent bg-transparent text-drift-accent2 hover:bg-drift-accent2/10 disabled:opacity-40'
    case 'cancel':
      // CANCELAR discreto — border neutra + text muted.
      return 'border border-drift-border bg-transparent text-drift-muted hover:text-drift-text disabled:opacity-40'
    case 'danger':
      // Ação destrutiva neutra — bury border + bury text, sem bg.
      return 'border border-drift-bury bg-transparent text-drift-bury hover:bg-drift-bury/10 disabled:opacity-40'
    case 'danger-prominent':
      // Delete prominente — bury cheio sobre bg.
      return 'bg-drift-bury text-drift-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30'
  }
}

/**
 * Mapeia size pra classes Tailwind. Função pura — testável sem
 * renderizar React.
 */
export function driftButtonSizeClass(size: DriftButtonSize): string {
  switch (size) {
    case 'sm':
      return 'px-2 py-1 text-[12px]'
    case 'md':
      // Default: alinhado ao FECHAR original (.btn-x mockup v0.7).
      return 'px-3 py-[5px] text-[12px] uppercase tracking-[2px]'
    case 'lg':
      return 'px-4 py-2 text-xs uppercase tracking-widest'
  }
}

/**
 * Classes base aplicadas em todas as variants/sizes. Inclui rounded,
 * transition, font, focus-visible ring (a11y).
 */
export const DRIFT_BUTTON_BASE_CLASS =
  'rounded font-mono transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg'

/**
 * Compõe className final — pure helper pra testes.
 */
export function driftButtonClassName(
  variant: DriftButtonVariant,
  size: DriftButtonSize = 'md',
  extra?: string,
): string {
  const parts = [
    DRIFT_BUTTON_BASE_CLASS,
    driftButtonSizeClass(size),
    driftButtonVariantClass(variant),
  ]
  if (extra) parts.push(extra)
  return parts.join(' ')
}

export function DriftButton({
  variant,
  size = 'md',
  type = 'button',
  children,
  className,
  ...rest
}: DriftButtonProps) {
  return (
    <button
      {...rest}
      // eslint-disable-next-line react/button-has-type -- type literal narrowed acima
      type={type}
      className={driftButtonClassName(variant, size, className)}
    >
      {children}
    </button>
  )
}
