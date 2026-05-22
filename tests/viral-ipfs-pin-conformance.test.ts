/**
 * Conformance test — auto-pin IPFS em posts virais.
 *
 * Satoshi audit redundância 2026-05-21 flagou gap: `helia.ts:246-249`
 * tinha API B.1 (`pinBlob/addBlob/getBlob`) 100% funcional, mas
 * auto-pin B.2 ficou defer — posts virais não eram pinados
 * automaticamente. Manifesto §16 (disponibilidade distribuída)
 * prometia isso mas não ativava sozinho.
 *
 * Fix:
 *  - `VIRAL_PIN_THRESHOLD` em config/constants.ts (default 50)
 *  - `auto_pin_enabled` em UserPrefs (default OFF — Satoshi mitigation
 *    pra storage cap IPFS 500MB)
 *  - Hook em `events.ts:recalculateScore` dispara `pinBlob(cid)`
 *    fire-and-forget pra cada blob do post quando score > threshold
 *    E pref habilitada
 *
 * Estes tests são source-grep — não executam o código, só validam que
 * o LOCK estrutural está no lugar. Conformance lock contra regressão.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONSTANTS_PATH = resolve(__dirname, '../src/config/constants.ts')
const DRIFT_TYPES_PATH = resolve(__dirname, '../src/types/drift.ts')
const PREFS_PATH = resolve(__dirname, '../src/lib/prefs.ts')
const EVENTS_PATH = resolve(__dirname, '../src/lib/events.ts')

const CONSTANTS_SRC = readFileSync(CONSTANTS_PATH, 'utf8')
const DRIFT_TYPES_SRC = readFileSync(DRIFT_TYPES_PATH, 'utf8')
const PREFS_SRC = readFileSync(PREFS_PATH, 'utf8')
const EVENTS_SRC = readFileSync(EVENTS_PATH, 'utf8')

describe('viral IPFS auto-pin (Satoshi audit 2026-05-21)', () => {
  describe('config/constants.ts', () => {
    it('exporta VIRAL_PIN_THRESHOLD', () => {
      expect(CONSTANTS_SRC).toMatch(/export\s+const\s+VIRAL_PIN_THRESHOLD\s*=/)
    })

    it('VIRAL_PIN_THRESHOLD é número positivo conservador (≥10)', () => {
      // Regex pra extrair valor do literal.
      const m = CONSTANTS_SRC.match(/export\s+const\s+VIRAL_PIN_THRESHOLD\s*=\s*(\d+)/)
      expect(m).not.toBeNull()
      const value = Number(m![1])
      expect(value).toBeGreaterThanOrEqual(10)
    })

    it('comentário Satoshi audit 2026-05-21 está presente', () => {
      expect(CONSTANTS_SRC).toMatch(/Satoshi audit[\s\S]*2026-05-21/)
    })
  })

  describe('types/drift.ts', () => {
    it('UserPrefs declara auto_pin_enabled: boolean', () => {
      expect(DRIFT_TYPES_SRC).toMatch(/auto_pin_enabled\s*:\s*boolean/)
    })

    it('DEFAULT_USER_PREFS tem auto_pin_enabled: false (Satoshi mitigation)', () => {
      // Opt-in default OFF protege user contra storage cap IPFS encher.
      expect(DRIFT_TYPES_SRC).toMatch(/auto_pin_enabled\s*:\s*false/)
    })
  })

  describe('lib/prefs.ts', () => {
    it('applyRow tem case "auto_pin_enabled" (deserialize do SQLite)', () => {
      expect(PREFS_SRC).toMatch(/case\s+['"]auto_pin_enabled['"]\s*:/)
    })

    it('case parseia value === "1" como boolean', () => {
      const block = PREFS_SRC.match(
        /case\s+['"]auto_pin_enabled['"]\s*:[\s\S]*?return/,
      )
      expect(block).not.toBeNull()
      expect(block![0]).toMatch(/target\.auto_pin_enabled\s*=\s*value\s*===\s*['"]1['"]/)
    })
  })

  describe('lib/events.ts hook', () => {
    it('importa VIRAL_PIN_THRESHOLD de config/constants', () => {
      expect(EVENTS_SRC).toMatch(
        /import\s*\{[^}]*VIRAL_PIN_THRESHOLD[^}]*\}\s*from\s*['"]\.\.\/config\/constants['"]/,
      )
    })

    it('recalculateScore dispara maybeAutoPinViralBlobs fire-and-forget', () => {
      // void prefix garante que falha não bloqueia o recalc.
      expect(EVENTS_SRC).toMatch(/void\s+maybeAutoPinViralBlobs\s*\(/)
    })

    it('maybeAutoPinViralBlobs gate-ia por VIRAL_PIN_THRESHOLD', () => {
      // Comparação contra threshold — só dispara quando score cruza.
      expect(EVENTS_SRC).toMatch(/score\s*<=?\s*VIRAL_PIN_THRESHOLD|VIRAL_PIN_THRESHOLD\s*<\s*score/)
    })

    it('maybeAutoPinViralBlobs checa pref auto_pin_enabled (opt-in default OFF)', () => {
      expect(EVENTS_SRC).toMatch(/auto_pin_enabled/)
      // Negação ou positive check — ambos aceitos.
      expect(EVENTS_SRC).toMatch(/getPrefs\(\)\.auto_pin_enabled|!\s*getPrefs\(\)\.auto_pin_enabled/)
    })

    it('lazy import de ./helia (evita dep cycle + bundle bloat)', () => {
      // import('./helia') dinâmico — Helia fica fora do bundle inicial.
      expect(EVENTS_SRC).toMatch(/import\(['"]\.\/helia['"]\)/)
    })

    it('lazy import de ./prefs no hook (evita cycle events ← prefs)', () => {
      expect(EVENTS_SRC).toMatch(/import\(['"]\.\/prefs['"]\)/)
    })

    it('chama pinBlob (API B.1 já existente em helia.ts)', () => {
      expect(EVENTS_SRC).toMatch(/pinBlob\s*\(/)
    })

    it('error handler envolve o hook (try/catch ou .catch — fire-and-forget seguro)', () => {
      // Sem catch, UnhandledPromiseRejection mata a app.
      const hasTryCatch = /async function maybeAutoPinViralBlobs[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/.test(
        EVENTS_SRC,
      )
      expect(hasTryCatch).toBe(true)
    })

    it('comentário Satoshi audit 2026-05-21 presente como rastro do fix', () => {
      expect(EVENTS_SRC).toMatch(/Satoshi audit[\s\S]*2026-05-21/)
    })
  })
})
