/**
 * axeRunner — wrapper finíssimo sobre `axe-core` pra usar em a11y tests.
 *
 * Por que não `vitest-axe` direto:
 * - `vitest-axe` é fork antigo de `jest-axe`. Funciona, mas a versão 0.1.0
 *   tem peer deps confusas com Vitest 4.x. Chamar `axe-core` direto é
 *   estável e mais explícito.
 *
 * Config padrão:
 * - WCAG 2.1 AA (regras `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`).
 * - Sem regras experimentais (`experimental: false`).
 *
 * Output:
 * - Retorna `AxeResults`. Helper `expectNoViolations` formata violations
 *   pra mensagem de erro legível antes de falhar.
 */
import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { expect } from 'vitest'

const DEFAULT_OPTIONS: RunOptions = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  resultTypes: ['violations'],
}

export async function runAxe(
  container: Element,
  options: RunOptions = DEFAULT_OPTIONS,
): Promise<AxeResults> {
  return axe.run(container, options)
}

/**
 * Formata violations pra erro de test legível.
 */
export function formatViolations(results: AxeResults): string {
  if (results.violations.length === 0) return ''
  return results.violations
    .map((v, i) => {
      const nodes = v.nodes
        .map((n) => `      • ${n.html}\n        ${n.failureSummary ?? ''}`)
        .join('\n')
      return `  ${i + 1}. [${v.id}] ${v.help} (impact: ${v.impact ?? 'n/a'})\n     ${v.helpUrl}\n${nodes}`
    })
    .join('\n\n')
}

/**
 * Helper de assertion: roda axe + falha com mensagem rica se houver
 * violations.
 */
export async function expectNoViolations(
  container: Element,
  options?: RunOptions,
): Promise<void> {
  const results = await runAxe(container, options)
  if (results.violations.length > 0) {
    const msg = `axe-core encontrou ${results.violations.length} violation(s):\n\n${formatViolations(results)}`
    expect.fail(msg)
  }
}
