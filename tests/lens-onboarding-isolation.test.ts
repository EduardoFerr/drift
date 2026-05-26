/**
 * Lens "identified-only" — JAMAIS exposed em Onboarding flow.
 * LOCK_VIA_TEST estrutural (Sprint N+4, Marshall).
 *
 * Origem: Barney cenário C6 "onboarding push" (risco 20). Threat: wizard
 * de boas-vindas sugere "ative lente de perfis identificados pra evitar
 * spam" → maioria silenciosa aceita default sugerido → cliente vira de
 * facto "identificado por default" sem nunca ter mudado settings → §4
 * (anonimato preservado) erodido sem alarme.
 *
 * Por que LOCK estrutural ANTES da feature existir?
 * - Passa vacuously enquanto não houver referência em `src/components/
 *   Onboarding/`.
 * - No DIA em que alguém adiciona step de onboarding mencionando a lente,
 *   test quebra → PR não merga sem revisar a decisão.
 * - Distinção crucial: Settings > Sua Lente PODE listar identified-only
 *   (opt-in consciente). Onboarding NÃO (nudge → pseudo-default).
 *
 * O que o test PROÍBE em Onboarding:
 * - Identifier `identified-only` / `identifiedOnly` / `LensIdentified`
 * - Strings i18n: `só identificados`, `apenas identificados`,
 *   `only identified`
 * - Regex `lens.*identified` (cobre formas indiretas: "trust lens for
 *   identified accounts", "filter for identified profiles", etc)
 *
 * Manifesto refs:
 *  - §4 anonimato preservado (onboarding NÃO empurra hierarquia)
 *  - §17 sem chave mestra (cliente NÃO recomenda lente "oficial")
 *  - §22 sem reputação subjetiva
 *
 * Refs:
 *  - Docs/sessions/barney-lens-identified-threat-2026-05-23.md C6
 *  - Docs/sessions/marshall-lens-identified-check-2026-05-23.md
 *  - Análogo: tests/manifesto-conformance.test.ts (LOCK_VIA_TEST §17)
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const ONBOARDING_DIR = join(ROOT, 'src', 'components', 'Onboarding')

/** Lista .tsx/.ts em Onboarding (recursivo — futureproof p/ subpastas). */
function listOnboardingFiles(): string[] {
  if (!existsSync(ONBOARDING_DIR)) return []
  const out: string[] = []
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      ) {
        out.push(full)
      }
    }
  }
  walk(ONBOARDING_DIR)
  return out
}

/** Patterns proibidos em Onboarding files. */
const FORBIDDEN_PATTERNS: { name: string; re: RegExp; reason: string }[] = [
  {
    name: 'identifier identified-only / identifiedOnly / LensIdentified*',
    re: /\b(?:identified-only|identifiedOnly|LensIdentified[A-Za-z]*)\b/,
    reason:
      'Identifier de lente "identified-only" detectado em Onboarding. ' +
      'Lente é opt-in consciente em Settings — NUNCA exposta em wizard ' +
      'que vira "default sugerido" pra maioria silenciosa.',
  },
  {
    name: 'PT-BR "só/apenas identificados"',
    re: /\b(?:s[óo]|apenas)\s+identificad[oa]s?\b/i,
    reason:
      'Copy PT-BR sugerindo lente identified-only. §4 anonimato: onboarding ' +
      'NÃO empurra hierarquia entre perfis identificados/anônimos.',
  },
  {
    name: 'EN "only identified"',
    re: /\bonly\s+identified\b/i,
    reason:
      'Copy EN sugerindo lente identified-only. Mesma proibição: lente é ' +
      'opt-in em Settings, não nudge em onboarding.',
  },
  {
    name: 'regex lens.*identified (forma indireta)',
    re: /\blens(?:e)?\b[^.\n]{0,80}\bidentified\b/i,
    reason:
      'Menção de "lens/lente" + "identified" no mesmo trecho. Cobre formas ' +
      'indiretas tipo "trust lens for identified accounts". §17 cliente NÃO ' +
      'recomenda lente — user escolhe.',
  },
]

interface Offender {
  file: string
  line: number
  pattern: string
  text: string
  reason: string
}

describe('LOCK_VIA_TEST L-ID-3 — lens "identified-only" JAMAIS em Onboarding', () => {
  it('Onboarding/ NÃO contém identifiers nem copy que sugiram lens identified-only', () => {
    const files = listOnboardingFiles()
    const offenders: Offender[] = []

    for (const file of files) {
      // NÃO strip comments — mesmo comentário em código de Onboarding pode
      // virar copy via i18n key amanhã, OU revelar intenção do dev de
      // adicionar a feature ali. Conservador: pega comments também.
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const { name, re, reason } of FORBIDDEN_PATTERNS) {
          if (re.test(lines[i])) {
            offenders.push({
              file: file.replace(ROOT, '').replace(/\\/g, '/'),
              line: i + 1,
              pattern: name,
              text: lines[i].trim().slice(0, 160),
              reason,
            })
          }
        }
      }
    }

    expect(
      offenders,
      `Referência a lens "identified-only" detectada em src/components/Onboarding/. ` +
        `Manifesto §4 (anonimato preservado), §17 (sem chave mestra), §22 (sem ` +
        `reputação). Barney threat C6 (risco 20): onboarding push → maioria ` +
        `silenciosa aceita → cliente vira "identificado por default" sem alarme.\n\n` +
        `Lente identified-only é opt-in CONSCIENTE em Settings > Sua Lente. ` +
        `Onboarding apresenta DRIFT/SINK/follow/navegação básica — NÃO recomenda ` +
        `lente. LOCK L-ID-3.\n\nHits:\n` +
        offenders
          .map(
            (o) =>
              `  ${o.file}:${o.line} [${o.pattern}]: ${o.text}\n` +
              `    motivo: ${o.reason}`,
          )
          .join('\n\n'),
    ).toEqual([])
  })

  // Sanity: helper de fato leu o diretório (caso pasta tenha sido movida
  // ou test rode em CI sem checkout). Se Onboarding/ existir, deve ter
  // ≥ 1 arquivo (OnboardingOverlay.tsx já existe).
  it('sanity — Onboarding/ existe e tem ao menos 1 arquivo, ou test passa vacuously', () => {
    if (!existsSync(ONBOARDING_DIR)) {
      // Sem pasta → feature inteira não existe → vacuously ok.
      return
    }
    const files = listOnboardingFiles()
    expect(
      files.length,
      'Onboarding/ existe mas vazio — helper quebrou ou repo está corrompido',
    ).toBeGreaterThan(0)
  })

  // Sanity: garante que regex adversarial sintética é pega — caso contrário
  // os patterns poderiam estar quebrados e o test acima passar trivialmente.
  it('sanity — patterns reconhecem string adversarial sintética', () => {
    const cases = [
      '<p>Ative a lente de só identificados pra evitar spam</p>',
      "setActiveLens('identified-only') // recommended in onboarding",
      'Filter your feed: only identified accounts',
      'const x = LensIdentifiedOnly',
      'Ative o trust lens for identified users',
    ]
    for (const adversarial of cases) {
      const matched = FORBIDDEN_PATTERNS.some((p) => p.re.test(adversarial))
      expect(
        matched,
        `sanity falhou — pattern não pegou: "${adversarial}"`,
      ).toBe(true)
    }
  })
})
