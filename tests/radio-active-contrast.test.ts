// RadioGroupButton — active-state contrast LOCK_VIA_TEST (per-caller).
//
// Source: Lily+Marshall HIMYM audit P1.7/D6 (2026-05-26). Complementa
// `radio-group-button-conformance.test.ts`:
//   - O test sibling trava classnames DENTRO do primitive (single source).
//   - ESTE test trava que cada CALLER preserve a visibilidade do active
//     state (sem className override que neutralize accent) e que o
//     primitive continue a satisfazer indicadores WCAG-fortes.
//
// Motivação histórica: pré-fix [45cd93f] o active state era
// `bg-drift-accent/50` (invisível em Velatura). Bug recorrente em
// callers que reimplementavam o pattern. Após extração pra primitive,
// risco se desloca pra (a) caller passar `className` ad-hoc que
// shadowa o accent, (b) primitive ser editado e perder algum dos 3
// indicadores (border, bg, text). LOCK ambos.
//
// WCAG SC 1.4.11 (non-text contrast ≥3:1): active state precisa de
// indicador "forte" — pelo menos UM dos: border-accent, bg-accent,
// text-accent. Não basta gradiente de muted→text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PRIMITIVE = readFileSync(
  'src/components/UI/RadioGroupButton.tsx',
  'utf8',
)
const SETTINGS = readFileSync(
  'src/components/Settings/SettingsCards.tsx',
  'utf8',
)

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Extrai todos os usos `<RadioGroupButton<TypeArg>` de um arquivo
 * com o bloco JSX completo (até o `/>` que fecha o self-close).
 */
function extractCallers(source: string): { typeArg: string; block: string }[] {
  const callers: { typeArg: string; block: string }[] = []
  const re = /<RadioGroupButton<([A-Za-z0-9_]+)>([\s\S]*?)\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    callers.push({ typeArg: m[1]!, block: m[0]! })
  }
  return callers
}

// ── Primitive active state contains ≥1 strong indicator ───────────

describe('RadioGroupButton primitive — active state tem ≥1 indicador WCAG-forte', () => {
  const activeMatch = PRIMITIVE.match(/active\s*\?\s*'([^']+)'/)
  const activeClasses = activeMatch?.[1] ?? ''

  it('primitive expõe bloco condicional active ? ... : ...', () => {
    expect(activeMatch).not.toBeNull()
    expect(activeClasses.length).toBeGreaterThan(0)
  })

  it('contém border-drift-accent (border forte, sem opacity-reducer)', () => {
    // Aceita border-drift-accent OU border-2 — qualquer um basta pra 3:1
    const hasStrongBorder =
      /\bborder-drift-accent\b(?!\/\d)/.test(activeClasses) ||
      /\bborder-2\b/.test(activeClasses)
    expect(hasStrongBorder).toBe(true)
  })

  it('contém bg-drift-accent (com ou sem /15-/30, mas NÃO /5 nem /10)', () => {
    // /15 é o mínimo perceptível validado em Velatura
    const hasBgAccent = /\bbg-drift-accent(\/(15|20|25|30)|\b)/.test(activeClasses)
    expect(hasBgAccent).toBe(true)
    expect(activeClasses).not.toMatch(/\bbg-drift-accent\/(5|10)\b/)
  })

  it('contém text-drift-accent (full saturation, sem /opacity)', () => {
    expect(activeClasses).toMatch(/\btext-drift-accent\b(?!\/\d)/)
  })

  it('NÃO depende só de text-drift-text vs text-drift-muted (gradiente fraco)', () => {
    // Regressão guard: se algum dia alguém remover accent e deixar só
    // a diferença text-drift-text vs text-drift-muted, este test falha.
    const onlyTextGradient =
      /text-drift-text/.test(activeClasses) &&
      !/text-drift-accent/.test(activeClasses) &&
      !/bg-drift-accent/.test(activeClasses) &&
      !/border-drift-accent/.test(activeClasses)
    expect(onlyTextGradient).toBe(false)
  })
})

// ── Per-caller assertions ─────────────────────────────────────────

describe('SettingsCards — callers do RadioGroupButton preservam contraste', () => {
  const callers = extractCallers(SETTINGS)

  it('detecta exatamente 2 callers (Location + NetworkMode)', () => {
    // Quando adicionar 3º caller, atualizar este test + audit cross-component.
    expect(callers.map((c) => c.typeArg).sort()).toEqual([
      'LocationGranularity',
      'NetworkMode',
    ])
  })

  it('LocationCard — não passa className que neutraliza accent', () => {
    const loc = callers.find((c) => c.typeArg === 'LocationGranularity')
    expect(loc).toBeDefined()
    // Caller pode passar className extra, mas NUNCA pra mexer no accent.
    // Strings proibidas em qualquer prop literal do caller:
    expect(loc!.block).not.toMatch(/bg-drift-accent\/(5|10)\b/)
    expect(loc!.block).not.toMatch(/border-drift-accent\/(5|10|50)\b/)
    // ariaLabel obrigatório (screen reader)
    expect(loc!.block).toMatch(/ariaLabel=/)
  })

  it('NetworkModeCard — não passa className que neutraliza accent', () => {
    const net = callers.find((c) => c.typeArg === 'NetworkMode')
    expect(net).toBeDefined()
    expect(net!.block).not.toMatch(/bg-drift-accent\/(5|10)\b/)
    expect(net!.block).not.toMatch(/border-drift-accent\/(5|10|50)\b/)
    expect(net!.block).toMatch(/ariaLabel=/)
  })

  it('TODOS callers passam value + onChange + options + ariaLabel (API completa)', () => {
    for (const c of callers) {
      expect(c.block, `caller ${c.typeArg}`).toMatch(/\bvalue=/)
      expect(c.block, `caller ${c.typeArg}`).toMatch(/\bonChange=/)
      expect(c.block, `caller ${c.typeArg}`).toMatch(/\boptions=/)
      expect(c.block, `caller ${c.typeArg}`).toMatch(/\bariaLabel=/)
    }
  })
})

// ── Focus ring conformance (WCAG 2.4.7) ───────────────────────────

describe('RadioGroupButton — focus indicator é visível (WCAG 2.4.7)', () => {
  it('focus-visible:ring-2 garante anel ≥2px em keyboard nav', () => {
    expect(PRIMITIVE).toMatch(/focus-visible:ring-2\b/)
  })

  it('ring usa cor accent2 (não default browser outline removido sem replacement)', () => {
    // focus:outline-none só é aceitável SE houver focus-visible:ring substituindo
    const hasOutlineNone = /focus:outline-none/.test(PRIMITIVE)
    const hasFocusRing = /focus-visible:ring-drift-accent2\/40/.test(PRIMITIVE)
    if (hasOutlineNone) {
      expect(hasFocusRing).toBe(true)
    }
  })
})

// ── aria-checked dinâmico (não hardcoded) ────────────────────────

describe('RadioGroupButton — aria-checked reflete state, não literal', () => {
  it('aria-checked={active} (bool dinâmico, não "true"/"false" literal)', () => {
    expect(PRIMITIVE).toMatch(/aria-checked=\{active\}/)
    // Guard: se alguém regressar pra string literal, test falha
    expect(PRIMITIVE).not.toMatch(/aria-checked="(true|false)"/)
  })
})
