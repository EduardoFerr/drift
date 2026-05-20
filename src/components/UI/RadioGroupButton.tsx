/**
 * RadioGroupButton — primitive radio-group em forma de botões.
 *
 * Source: Lily/Marshall HIMYM dispatch 2026-05-20 (PostViewer cleanup
 * sessão). Extrai pattern repetido em LocationCard + NetworkModeCard
 * (Phase 1+2 settings refactor) pra prevenir regressão de contrast em
 * Velatura tema (active state era invisível com `/50` opacity classes
 * antes do fix [45cd93f] que migrou pra `/15 + texto solid accent`).
 *
 * API tipada genérica em `<T extends string>` — preserva type-safety
 * do callsite. `value` + `onChange` formam controlled component pattern
 * canônico React (sem state interno; SoT é o caller).
 *
 * A11y:
 *   - Container: `role="radiogroup"` + `aria-label` (caller passa
 *     contexto semântico)
 *   - Items: `role="radio"` + `aria-checked={active}`
 *   - Disabled items: `disabled` attr + `aria-disabled` implícito
 *   - Focus ring: `focus-visible:ring-2 ring-drift-accent2/40`
 *
 * Active state (Velatura-safe — manifesto §28 acessibilidade):
 *   - border `drift-accent` (full opacity)
 *   - bg `drift-accent/15` (sutil mas perceptível em todos 3 temas)
 *   - text `drift-accent` (full saturation)
 *   - WCAG 3:1 contrast vs idle state em Cinder/Rosenholz/Velatura
 *
 * Anti-regression: LOCK_VIA_TEST `radio-group-button-conformance.test.ts`
 * trava classnames + role + aria-checked shape.
 */

import type { ReactNode } from 'react'

export interface RadioOption<T extends string> {
  /** Valor canônico (mapeia pra UserPrefs / state). */
  value: T
  /** Label visível no botão (geralmente uppercase mono). */
  label: ReactNode
  /** Tooltip (`title` HTML attr) — explicação curta. */
  hint?: string
  /** Quando true, item fica cinza e não clicável. */
  disabled?: boolean
}

export interface RadioGroupButtonProps<T extends string> {
  options: readonly RadioOption<T>[]
  value: T
  onChange: (next: T) => void
  /** Label semântico do grupo (lido por screen reader). */
  ariaLabel: string
  /**
   * Layout grid columns. Default 'auto' (CSS auto-fit min 80px).
   * Use número específico (ex 3, 4) quando quiser layout previsível.
   */
  columns?: 2 | 3 | 4 | 'auto'
  /** className opcional aplicado ao container `<div role="radiogroup">`. */
  className?: string
}

const COLUMN_CLASS: Record<NonNullable<RadioGroupButtonProps<string>['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  auto: 'grid-cols-[repeat(auto-fit,minmax(80px,1fr))]',
}

export function RadioGroupButton<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns = 'auto',
  className = '',
}: RadioGroupButtonProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid gap-2 ${COLUMN_CLASS[columns]} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value
        const disabled = opt.disabled === true
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (disabled) return
              if (!active) onChange(opt.value)
            }}
            disabled={disabled}
            title={opt.hint}
            className={`rounded-xl border px-3 py-3 font-mono text-[12px] uppercase tracking-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
              active
                ? 'border-drift-accent bg-drift-accent/15 text-drift-accent'
                : 'border-drift-border/50 bg-drift-surface/40 text-drift-muted hover:border-drift-accent2 hover:text-drift-text'
            } ${
              disabled
                ? 'cursor-not-allowed opacity-30 hover:border-drift-border/50'
                : ''
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
