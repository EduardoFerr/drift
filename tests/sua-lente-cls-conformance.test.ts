/**
 * SuaLenteCard CLS conformance — LOCK_VIA_TEST anti-regressão.
 *
 * Origem: Lily UX/perf fix 2026-05-28. Screenshots provaram layout shift
 * (CLS) ao mover o slider de força da lente 0% → >0%: os 3 sub-toggles
 * opt-in (reorder indicator, decay de follows, cor no mapa) estavam
 * gateados por `isActive` (strength > 0), montando/desmontando ao mover
 * o slider e empurrando o conteúdo abaixo. Manifesto perf: CLS < 0.1.
 *
 * Fix (a): toggles SEMPRE no DOM (gateados só pela ESTRATÉGIA via
 * showStrengthControls, nunca pela INTENSIDADE), `disabled` quando a
 * lente está off. Espaço reservado constante = zero CLS.
 *
 * Este LOCK trava o invariante estrutural: os toggles não podem voltar a
 * ser renderizados condicionalmente por `isActive`/`strength`/`local > 0`.
 * Se alguém reintroduzir `isActive && <...Toggle`, o test falha e o revisor
 * vê o alarme de regressão de CLS antes de aprovar.
 *
 * NÃO simplesmente remova o assert se o componente mudar de forma —
 * atualize o pattern mantendo a garantia de que os toggles ficam no DOM.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const CARD = join(ROOT, 'src', 'components', 'Settings', 'SuaLenteCard.tsx')

/** Strip JS/TS comments — comentário explicando a regra não pode trigger
 * falso positivo (ex: o próprio docstring menciona `isActive &&`). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, (_m, prefix) => prefix)
}

describe('LOCK_VIA_TEST — SuaLenteCard sub-toggles sempre no DOM (anti-CLS)', () => {
  const src = stripComments(readFileSync(CARD, 'utf8'))

  it('os 3 sub-toggles NÃO são gateados por isActive (causa de CLS)', () => {
    // Bloqueia render condicional por intensidade da lente. Os tokens
    // proibidos cobrem as variantes plausíveis de reintrodução do gate.
    const forbidden = [
      /isActive\s*&&\s*<\s*ReorderIndicatorToggle/,
      /isActive\s*&&\s*<\s*PprDecayToggle/,
      /isActive\s*&&\s*<\s*MapColorsToggle/,
      /local\s*>\s*0\s*&&\s*<\s*ReorderIndicatorToggle/,
      /strength\s*>\s*0\s*&&\s*<\s*ReorderIndicatorToggle/,
    ]
    const hits = forbidden.filter((re) => re.test(src)).map((re) => re.source)
    expect(
      hits,
      'Sub-toggle gateado por isActive/strength reintroduz CLS ao mover o ' +
        'slider (toggle monta/desmonta 0→>0 → reflow). Mantenha os toggles ' +
        'SEMPRE no DOM com prop `disabled={!isActive}`. Hits:\n' +
        hits.join('\n'),
    ).toEqual([])
  })

  it('cada sub-toggle é renderizado com a prop disabled (espaço reservado)', () => {
    for (const name of [
      'ReorderIndicatorToggle',
      'PprDecayToggle',
      'MapColorsToggle',
    ]) {
      const renderedDisabled = new RegExp(
        `<\\s*${name}\\s+disabled=\\{!isActive\\}`,
      ).test(src)
      expect(
        renderedDisabled,
        `<${name} disabled={!isActive} /> ausente. Os toggles devem ficar ` +
          `sempre montados e apenas DESABILITADOS quando a lente está off, ` +
          `pra manter altura constante (zero CLS).`,
      ).toBe(true)
    }
  })
})
