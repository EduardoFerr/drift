// DriftAlert API lock conformance — LOCK_VIA_TEST.
//
// Source: DriftAlert primitive shipped em [7cf4ec0] 2026-05-17 (Marshall
// HIMYM audit Tier 1 #4). API formal: variants info/warning/danger.
// Callers NÃO podem passar strings ad-hoc. Adicionar variant nova
// exige update do whitelist no test — força revisão consciente.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED_VARIANTS = new Set(['info', 'warning', 'danger'])
const PRIMITIVE_FILE = 'src/components/UI/DriftAlert.tsx'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full.replace(/\\/g, '/'))
  }
  return acc
}

describe('DriftAlert API — variant whitelist + export shape', () => {
  it('primitive exporta DriftAlertVariant com tipos esperados', () => {
    const primitive = readFileSync(PRIMITIVE_FILE, 'utf8')
    expect(primitive).toMatch(/export\s+type\s+DriftAlertVariant/)
    // Cada variant esperada está no type union
    for (const variant of ALLOWED_VARIANTS) {
      expect(
        primitive,
        `DriftAlertVariant não inclui '${variant}' — atualize ALLOWED_VARIANTS no test ou adicione no primitive`,
      ).toMatch(new RegExp(`'${variant}'`))
    }
  })

  it('primitive exporta driftAlertVariantClass com todos variants no switch', () => {
    const primitive = readFileSync(PRIMITIVE_FILE, 'utf8')
    expect(primitive).toMatch(/export\s+function\s+driftAlertVariantClass/)
    // Cada variant tem case
    for (const variant of ALLOWED_VARIANTS) {
      expect(
        primitive,
        `driftAlertVariantClass não trata '${variant}' — sem case`,
      ).toMatch(new RegExp(`case\\s+'${variant}'`))
    }
  })

  it('callers só usam variants do whitelist (sem strings ad-hoc)', () => {
    const violations: string[] = []
    // Regex: <DriftAlert ... variant="X"> ou variant={'X'} — string literal
    // (variant via prop dinâmica = OK, validation runtime)
    const re = /<DriftAlert[^>]*\bvariant=(?:["']([^"']+)["']|\{['"]([^'"]+)['"]\})/g
    for (const file of walk('src/components')) {
      if (file === PRIMITIVE_FILE) continue
      const content = readFileSync(file, 'utf8')
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      let m: RegExpExecArray | null
      while ((m = re.exec(stripped)) !== null) {
        const variant = m[1] ?? m[2]
        if (variant && !ALLOWED_VARIANTS.has(variant)) {
          violations.push(`${file} — variant="${variant}" não está em ${[...ALLOWED_VARIANTS].join('|')}`)
        }
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: usar variant do whitelist ou adicionar nova variant ao primitive + ALLOWED_VARIANTS no test.`,
    ).toEqual([])
  })
})
