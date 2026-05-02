/**
 * Manifesto conformance test — invariantes de pureza, determinismo,
 * e config consistente com claims públicas.
 *
 * Persona: Barney (peer review crítico) — sessão 2026-05-02.
 * Companion doc: `Docs/sessions/barney-code-hardening-2026-05-02.md`.
 *
 * **Premissa:** vários invariantes do CLAUDE.md são "função pura X não
 * deve usar Date.now()" ou "constante Y deve permanecer N". Tests de
 * output (existentes em `tests/scoring.test.ts` etc.) NÃO pegam
 * regressões silenciosas onde o resultado fica próximo mas o
 * determinismo cross-cliente quebra. Aqui fazemos asserts ESTÁTICOS
 * sobre o source: pureza por construção, não por resultado.
 *
 * Marshall (Cenário C — facilitação): essas são as invariantes que o
 * cliente "não decide nada por trás". Quebra silenciosa = perda de
 * defesa "cliente é browser determinístico, não plataforma editorial".
 *
 * **TODO humano:**
 * - Decidir entre `registerType: 'autoUpdate'` (atual) ou `'prompt'`
 *   (recomendação Barney). Se manter autoUpdate, garantir hash
 *   publicado em release notes (ver doc Barney §d).
 * - Adicionar CSP no `vercel.json` (atualmente ausente).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/**
 * Extrai o corpo de uma função top-level por nome. Heurística simples
 * baseada em colchetes balanceados — funciona pra estilo do codebase
 * Drift (funções `export function NAME(...): ... { ... }`). NÃO funciona
 * pra arrow functions one-liner sem block.
 */
function extractFunctionBody(source: string, name: string): string | null {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`, 'm')
  const m = source.match(re)
  if (!m || m.index === undefined) return null
  // Encontra primeiro `{` após a assinatura
  let i = m.index
  while (i < source.length && source[i] !== '{') i++
  if (i >= source.length) return null
  let depth = 0
  const start = i
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

/** Strip comments — best-effort regex (não cobre todos os edge cases
 * de strings com `//`/`/*`, mas suficiente para asserts de pureza). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('Manifesto §7 / CLAUDE.md #3: funções puras críticas não usam relógio implícito', () => {
  it('calculateScore (scoring.ts) não usa Date.now / performance.now / Math.random', () => {
    const src = readFileSync(join(SRC, 'lib', 'scoring.ts'), 'utf8')
    const body = extractFunctionBody(src, 'calculateScore')
    expect(body, 'calculateScore body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    expect(stripped, 'calculateScore must not call Date.now()').not.toMatch(/\bDate\.now\b/)
    expect(stripped, 'calculateScore must not call performance.now()').not.toMatch(/performance\.now/)
    expect(stripped, 'calculateScore must not call Math.random()').not.toMatch(/Math\.random/)
    expect(stripped, 'calculateScore must not construct new Date()').not.toMatch(/new\s+Date\b/)
  })

  it('calculateWeight (weight.ts) não usa Date.now / performance.now / Math.random', () => {
    const src = readFileSync(join(SRC, 'lib', 'weight.ts'), 'utf8')
    const body = extractFunctionBody(src, 'calculateWeight')
    expect(body, 'calculateWeight body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    expect(stripped).not.toMatch(/\bDate\.now\b/)
    expect(stripped).not.toMatch(/performance\.now/)
    expect(stripped).not.toMatch(/Math\.random/)
    expect(stripped).not.toMatch(/new\s+Date\b/)
  })

  it('applyContentFilters (feed.ts) é puro — não consulta db/relógio/random', () => {
    const src = readFileSync(join(SRC, 'lib', 'feed.ts'), 'utf8')
    const body = extractFunctionBody(src, 'applyContentFilters')
    expect(body, 'applyContentFilters body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    expect(stripped).not.toMatch(/\bDate\.now\b/)
    expect(stripped).not.toMatch(/performance\.now/)
    expect(stripped).not.toMatch(/Math\.random/)
    // Não deve ler do db diretamente — input é (post, prefs)
    expect(stripped, 'applyContentFilters must not call db.exec/get/run').not.toMatch(/\bdb\.(exec|get|run)\b/)
  })

  it('selectLatestActionByUser (events.ts) é puro', () => {
    const src = readFileSync(join(SRC, 'lib', 'events.ts'), 'utf8')
    const body = extractFunctionBody(src, 'selectLatestActionByUser')
    expect(body, 'selectLatestActionByUser body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    expect(stripped).not.toMatch(/\bDate\.now\b/)
    expect(stripped).not.toMatch(/performance\.now/)
    expect(stripped).not.toMatch(/Math\.random/)
    expect(stripped).not.toMatch(/\bdb\.(exec|get|run)\b/)
  })

  it('getReportThreshold e getReportWeight (moderation.ts) são puros', () => {
    const src = readFileSync(join(SRC, 'lib', 'moderation.ts'), 'utf8')
    for (const name of ['getReportThreshold', 'getReportWeight']) {
      const body = extractFunctionBody(src, name)
      expect(body, `${name} body not extracted`).toBeTruthy()
      const stripped = stripComments(body!)
      expect(stripped, `${name} must not call Date.now()`).not.toMatch(/\bDate\.now\b/)
      expect(stripped, `${name} must not call db`).not.toMatch(/\bdb\.(exec|get|run)\b/)
      expect(stripped, `${name} must not call Math.random`).not.toMatch(/Math\.random/)
    }
  })
})

describe('Manifesto §23: "Bury não pune"', () => {
  it('ENGAGEMENT_POINTS.POST_BURIED === 0 (autor não é penalizado por bury)', () => {
    const src = readFileSync(join(SRC, 'config', 'constants.ts'), 'utf8')
    const stripped = stripComments(src)
    // Pega a linha literal POST_BURIED: <num>
    const m = stripped.match(/POST_BURIED\s*:\s*(-?\d+(?:\.\d+)?)/)
    expect(m, 'POST_BURIED constant not found in config/constants.ts').toBeTruthy()
    expect(Number(m![1]), 'POST_BURIED must be 0 — manifesto §23 (bury não pune)').toBe(0)
  })
})

describe('Manifesto §26: threshold de moderação tem default razoável', () => {
  // Status atual: threshold é 100% derivado de `activeUsers` (network
  // state) em getReportThreshold. NÃO é override-able por user hoje.
  // Marshall §26 v2.2 não exige override, mas Barney recomenda como
  // hardening. Marcamos como `it.todo` pra reminder.
  it('threshold combinado de spam é >= 5 (piso) mesmo com base ativa zero', () => {
    // Importação direta — getReportThreshold já é puro e testado.
    // Esse teste duplica `tests/moderation.test.ts` parcialmente —
    // intencional: queremos que a invariante apareça também no
    // bundle de "manifesto conformance" pra ficar visível em audit.
    // Re-import via require pra isolar do mock-db do moderation.test.ts.
    // Reaproveita o test setup existente.
    // Porém: import dinâmico daria conflito de mock. Em vez de
    // importar, fazemos asserção textual sobre `getReportThreshold`:
    const src = readFileSync(join(SRC, 'lib', 'moderation.ts'), 'utf8')
    const body = extractFunctionBody(src, 'getReportThreshold')
    expect(body).toBeTruthy()
    // Garante que o piso 5 está literalmente presente (Math.max(5, ...))
    expect(body!).toMatch(/Math\.max\s*\(\s*5\s*,/)
  })

  it.todo(
    'threshold tem override opcional via UserPrefs (hardening Barney — não obrigatório por manifesto, mas recomendado)',
  )
})

describe('CLAUDE.md invariante #14: compatibilidade NIP-01 — ranges de kind corretos', () => {
  it('todos os DRIFT_KIND estão na faixa NIP-01 regular (1..9999)', () => {
    const src = readFileSync(join(SRC, 'config', 'constants.ts'), 'utf8')
    const blockMatch = src.match(/export\s+const\s+DRIFT_KIND\s*=\s*\{([^}]+)\}/m)
    expect(blockMatch).toBeTruthy()
    const block = blockMatch![1]
    for (const m of block.matchAll(/:\s*(\d+)/g)) {
      const kind = Number(m[1])
      expect(kind, `kind ${kind} fora da faixa regular NIP-01 (1..9999)`).toBeGreaterThanOrEqual(1)
      expect(kind).toBeLessThanOrEqual(9999)
    }
  })
})

describe('Vercel headers (PRIVACY/SECURITY claims operacionais)', () => {
  it('vercel.json define X-Frame-Options DENY e Referrer-Policy no-referrer', () => {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    expect(vercelJson.headers, 'vercel.json must define headers').toBeTruthy()
    const all = (vercelJson.headers ?? [])
      .filter((h) => h.source === '/(.*)')
      .flatMap((h) => h.headers)
    const map = new Map(all.map((h) => [h.key.toLowerCase(), h.value]))
    expect(map.get('x-frame-options')).toBe('DENY')
    expect(map.get('referrer-policy')).toBe('no-referrer')
    expect(map.get('x-content-type-options')).toBe('nosniff')
    expect(map.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(map.get('cross-origin-embedder-policy')).toBe('require-corp')
  })

  // TODO Barney: vercel.json atualmente NÃO define Content-Security-Policy.
  // Recomendação está no doc `barney-code-hardening-2026-05-02.md` §e.
  // Test marcado como todo pra não bloquear CI até decisão humana.
  it.todo('vercel.json define Content-Security-Policy restritiva')
})

describe('Tauri CSP (cliente nativo Fase 6)', () => {
  it('tauri.conf.json define CSP com frame-ancestors none', () => {
    const tauri = JSON.parse(
      readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as { app?: { security?: { csp?: string } } }
    const csp = tauri.app?.security?.csp ?? ''
    expect(csp).toMatch(/frame-ancestors\s+'none'/)
    expect(csp, 'CSP deve definir worker-src para SQLite WASM worker').toMatch(/worker-src/)
  })

  it('tauri CSP não permite unsafe-eval (somente wasm-unsafe-eval)', () => {
    const tauri = JSON.parse(
      readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as { app?: { security?: { csp?: string } } }
    const csp = tauri.app?.security?.csp ?? ''
    // Permite 'wasm-unsafe-eval' (necessário SQLite WASM); proíbe
    // 'unsafe-eval' isolado (vetor XSS clássico).
    const tokens = csp.split(/\s+/)
    expect(tokens).not.toContain("'unsafe-eval'")
  })
})

describe('Service Worker integrity (Barney §d — chave mestra disfarçada)', () => {
  // Vide doc §d: SW autoUpdate é "chave mestra de facto". Recomendação
  // Barney é mover pra `registerType: 'prompt'` OU manter autoUpdate
  // com hash publicado em release notes + SRI.
  // Test atual: lê vite.config.ts e EXIGE que registerType esteja
  // configurado (qualquer valor). Decisão sobre prompt vs autoUpdate
  // fica como `it.todo`.
  it('vite.config.ts configura registerType explícito do PWA', () => {
    const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(cfg, 'VitePWA registerType deve ser explícito').toMatch(/registerType\s*:\s*['"](?:autoUpdate|prompt)['"]/)
  })

  it.todo(
    'vite.config.ts usa registerType: "prompt" (recomendação Barney) — OU CI publica SHA256 do sw.js em release notes',
  )

  it.todo('Workflow CI valida que SHA256 de dist/sw.js é reproduzível entre builds clean')
})
