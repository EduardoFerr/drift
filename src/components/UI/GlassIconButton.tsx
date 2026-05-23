/**
 * GlassIconButton — primitive de botão circular icon-only com efeito
 * "double-edge layer" (glass / frosted).
 *
 * Origem: o botão ⋮ de actions menu no PostViewer embedded mode (V11)
 * estabeleceu o pattern visual:
 *   - `rounded-full` aspect 1:1
 *   - `border border-drift-border` neutro default
 *   - `bg-drift-surface/80 backdrop-blur-sm` glass sobre conteúdo
 *   - `hover:border-drift-accent hover:text-drift-accent` (chartreuse)
 *   - `focus:ring-1 focus:ring-drift-accent2` (mint)
 *
 * Quando focused + hover acontecem juntos, **a border chartreuse fica
 * adjacente ao ring mint** — duas linhas paralelas em cores diferentes
 * que dão sensação de profundidade ("double-edge layer"). Foi isso
 * que o user identificou como "efeito legal" e pediu pra propagar.
 *
 * Uso típico — overlay sobre content (foto, card, mapa, post body):
 *
 *   <GlassIconButton
 *     onClick={() => setShowMenu(true)}
 *     aria-label="abrir menu"
 *     className="absolute right-6 top-6 z-30"
 *   >
 *     <span aria-hidden="true">⋮</span>
 *   </GlassIconButton>
 *
 * **Não use** pra botões com text label (DRIFT ↑, FECHAR…) — aí é
 * `<DriftButton>`. Não use em flat lists (settings menu, etc.) — o
 * efeito glass pressupõe overlay sobre algo.
 *
 * Sizes:
 *   - `xl` → h-11 w-11, ícone text-[18px] (WCAG 2.5.5 AA — tap target 44px)
 *
 * Histórico: `sm` (h-6 w-6, visual-only), `md` (h-7 w-7) e `lg` (h-8 w-8)
 * existiram como legacy pre-WCAG 2.5.5 e foram removidas em 2026-05-23
 * (Ted+Barney audit 2026-05-23 §2.2 — WCAG threat: trap pra novos
 * contributors adotarem tap target sub-44px). Único caller já passava
 * `xl`; default mudou pra `xl`.
 *
 * Variants:
 *   - `default`     → hover chartreuse (drift-accent)
 *   - `destructive` → hover bury red (drift-bury), pra ações tipo
 *                     close/dismiss em contextos onde o close é
 *                     descartar conteúdo do user (ex.: remover imagem
 *                     já enviada). Em contextos onde close é apenas
 *                     "fechar overlay" (ProfileModal, etc.), use
 *                     `default` — fechar não é destrutivo.
 *
 * Accessibility:
 *   - `aria-label` é required (TS strict) — icon-only button precisa.
 *   - Composição: filho é só o ícone (caller passa `<span>⋮</span>`,
 *     `<XIcon/>`, etc.). Aria-hidden no ícone fica por conta do caller
 *     pra evitar redundância vs aria-label.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type GlassIconButtonVariant = 'default' | 'destructive'
export type GlassIconButtonSize = 'xl'

export interface GlassIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-label'> {
  /** Tamanho — default `xl` (WCAG 2.5.5 AA 44px tap target). */
  size?: GlassIconButtonSize
  /** Variante visual — default `default`. */
  variant?: GlassIconButtonVariant
  /**
   * **Required** — icon-only button precisa de label acessível.
   * TS-enforced (sem default; sem `?`).
   */
  'aria-label': string
  /**
   * Tipo HTML — default `button` pra evitar submit acidental.
   */
  type?: 'button' | 'submit' | 'reset'
  /** Ícone ou conteúdo curto (1 char/glyph esperado). */
  children: ReactNode
  /**
   * Adicional className apendado — útil pra positioning
   * (`absolute right-6 top-6 z-30`). Não sobrescreve variant/size.
   */
  className?: string
}

/**
 * Mapeia variant pra classes Tailwind. Função pura — testável sem React.
 */
export function glassIconButtonVariantClass(
  variant: GlassIconButtonVariant,
): string {
  switch (variant) {
    case 'default':
      // Hover: chartreuse (drift-accent). Match PostViewer ⋮ original.
      return 'border border-drift-border bg-drift-surface/80 text-drift-muted backdrop-blur-sm hover:border-drift-accent hover:text-drift-accent'
    case 'destructive':
      // Hover: bury red. Pra contextos onde o click destrói conteúdo
      // do user (ex.: remover imagem que ele já fez upload).
      return 'border border-drift-border bg-drift-surface/80 text-drift-muted backdrop-blur-sm hover:border-drift-bury hover:text-drift-bury'
  }
}

/**
 * Mapeia size pra classes Tailwind. Inclui dimensões + tamanho do ícone.
 * Função pura.
 */
export function glassIconButtonSizeClass(size: GlassIconButtonSize): string {
  switch (size) {
    case 'xl':
      // WCAG 2.5.5 AA — touch target 44×44 mínimo. Único size suportado
      // desde 2026-05-23 (Ted+Barney audit §2.2 — legacy sm/md/lg removidos
      // pra evitar trap WCAG em novos call-sites).
      return 'h-11 w-11 text-[18px]'
  }
}

/**
 * Classes base aplicadas em todas variants/sizes. Inclui shape circular,
 * flex centering, transition, focus ring (parte mint do double-edge),
 * disabled state.
 */
export const GLASS_ICON_BUTTON_BASE_CLASS =
  'flex shrink-0 items-center justify-center rounded-full leading-none transition-colors focus:outline-none focus:ring-1 focus:ring-drift-accent2 disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Compõe className final — pure helper pra testes e reuso.
 */
export function glassIconButtonClassName(
  variant: GlassIconButtonVariant = 'default',
  size: GlassIconButtonSize = 'xl',
  extra?: string,
): string {
  const parts = [
    GLASS_ICON_BUTTON_BASE_CLASS,
    glassIconButtonSizeClass(size),
    glassIconButtonVariantClass(variant),
  ]
  if (extra) parts.push(extra)
  return parts.join(' ')
}

export function GlassIconButton({
  size = 'xl',
  variant = 'default',
  type = 'button',
  children,
  className,
  ...rest
}: GlassIconButtonProps) {
  return (
    <button
      {...rest}
      // eslint-disable-next-line react/button-has-type -- type literal narrowed acima
      type={type}
      className={glassIconButtonClassName(variant, size, className)}
    >
      {children}
    </button>
  )
}
