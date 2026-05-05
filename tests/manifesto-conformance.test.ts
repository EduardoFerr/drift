/**
 * Manifesto conformance test — invariantes de pureza, determinismo,
 * e config consistente com claims públicas.
 *
 * Origem: revisão adversarial 2026-05-02.
 * Claims testadas: manifesto §7 (determinismo), §22 (score puro),
 * §23 (bury não pune), §17 (CSP/headers como prova de "sem chave
 * mestra disfarçada via deploy").
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
 * **Decisões aplicadas (histórico):**
 * - 2026-05-02: CSP restritiva em `vercel.json` (Barney gap #2).
 * - 2026-05-03: `registerType: 'prompt'` em `vite.config.ts` +
 *   `UpdatePrompt.tsx` mediando consentimento (Barney gap #1).
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

  it('vercel.json define Content-Security-Policy restritiva', () => {
    // Promovido de it.todo após decisão de adicionar CSP (sessão 2026-05-02).
    // Espelha o test do Tauri (linhas seguintes) — paridade de modelo de
    // segurança entre runtimes PWA/Vercel e Tauri/WebView.
    const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    const all = (vercelJson.headers ?? [])
      .filter((h) => h.source === '/(.*)')
      .flatMap((h) => h.headers)
    const csp = all.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value ?? ''
    expect(csp, 'CSP must be defined for /(.*)').toBeTruthy()
    expect(csp, "CSP deve ter frame-ancestors 'none' (defesa em profundidade vs X-Frame-Options)").toMatch(
      /frame-ancestors\s+'none'/,
    )
    expect(csp, 'CSP deve definir worker-src (SQLite WASM worker)').toMatch(/worker-src/)
    expect(csp, "CSP deve definir object-src 'none' (bloqueia plugins legados)").toMatch(/object-src\s+'none'/)
    expect(csp, "CSP deve definir base-uri 'self' (bloqueia base injection)").toMatch(/base-uri\s+'self'/)
    // Permitir 'wasm-unsafe-eval' (necessário pra SQLite WASM); proibir 'unsafe-eval' cru.
    const tokens = csp.split(/\s+/)
    expect(tokens, "CSP não pode conter 'unsafe-eval' (somente 'wasm-unsafe-eval' é permitido)").not.toContain(
      "'unsafe-eval'",
    )
  })
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

  it('vite.config.ts usa registerType: "prompt" (manifesto §17 — sem update silencioso)', () => {
    // Promovido de it.todo após decisão de adotar 'prompt' (sessão 2026-05-03).
    // Implementação: src/components/UI/UpdatePrompt.tsx via useRegisterSW
    // hook do virtual:pwa-register/react. Banner pede consentimento;
    // user decide se atualiza. Manifesto §17 (sem chave mestra disfarçada
    // via deploy comprometido).
    const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(cfg, "registerType deve ser 'prompt' pra fechar gap autoUpdate (Barney §d)").toMatch(
      /registerType\s*:\s*['"]prompt['"]/,
    )
  })

  it.todo('Workflow CI valida que SHA256 de dist/sw.js é reproduzível entre builds clean')
})

// ─── HIMYM Round 2 (2026-05-02) — extensões propostas por Marshall ───
// Origem: peer review HIMYM round 2 sobre auditoria de Docs/. Marshall
// identificou 3 superfícies de drift entre fonte canônica e docs/configs
// satélites. Cada teste fixa invariante específico — falha = drift novo.

describe('Stack pin sqlite-wasm cross-doc (Marshall LOCK_VIA_TEST)', () => {
  // Fonte canônica: package.json devDependencies/dependencies pin.
  // Replicado em CLAUDE.md (stack section) e README.md (stack section).
  // Drift = upgrade silencioso onde docs ficam stale.
  it('versão de @sqlite.org/sqlite-wasm em package.json bate com CLAUDE.md e README.md', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const pinnedVersion =
      pkg.dependencies?.['@sqlite.org/sqlite-wasm'] ?? pkg.devDependencies?.['@sqlite.org/sqlite-wasm']
    expect(pinnedVersion, 'package.json deve pinnar @sqlite.org/sqlite-wasm').toBeTruthy()
    // Pin exato (sem `^`/`~`) — manifesto §17 quer build determinístico.
    expect(pinnedVersion!, 'sqlite-wasm precisa pin exato (sem ^/~)').toMatch(/^[\d.]+(?:-[\w.]+)?$/)

    const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    const readmeMd = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(
      claudeMd,
      `CLAUDE.md deve mencionar a versão pinada (${pinnedVersion}) — drift entre package.json e CLAUDE.md`,
    ).toContain(pinnedVersion!)
    expect(
      readmeMd,
      `README.md deve mencionar a versão pinada (${pinnedVersion}) — drift entre package.json e README.md`,
    ).toContain(pinnedVersion!)
  })
})

describe('Schema kind 9078 tag `d` presente em fachadas públicas (Marshall risco #1)', () => {
  // Spec canônica: protocol-spec.md exige tag `d` obrigatória no kind 9078
  // (NIP-33-style addressable param). README.md e CLAUDE.md são entry
  // points públicos — implementador externo lê ambos primeiro. Se
  // omitirem `d`, evento criado é inválido.
  it('README.md tabela de kinds inclui tag `d` no row 9078', () => {
    const readmeMd = readFileSync(join(ROOT, 'README.md'), 'utf8')
    // Encontra linha da tabela com 9078
    const row9078 = readmeMd.split('\n').find((l) => l.includes('9078') && l.includes('|'))
    expect(row9078, 'README.md deve ter linha de tabela com 9078').toBeTruthy()
    expect(
      row9078!,
      'row 9078 do README.md deve listar tag `d` (obrigatória, parametrizada per protocol-spec.md)',
    ).toMatch(/\bd\b/)
  })

  it('CLAUDE.md menciona tag `d` no contexto de POST/9078', () => {
    const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    // Procura por tabela ou bloco que referencie 9078 + d
    const has9078 = claudeMd.includes('9078')
    expect(has9078, 'CLAUDE.md deve referenciar kind 9078').toBe(true)
    // Heurística: na seção de kinds, tag `d` deve aparecer próxima.
    // CLAUDE.md tem "tags: [d, drift-version, client, ...]" no bloco kinds.
    expect(claudeMd, 'CLAUDE.md deve mencionar tag `d` no contexto de kinds').toMatch(/\bd,\s*drift-version/)
  })
})

describe('Vocabulary UI guard (V0 redesign — Marshall LOCK_VIA_TEST)', () => {
  // Drift mantém separação léxica entre camada UI (DRIFT/SINK/DERIVA)
  // e camada protocolo (SPREAD/BURY). Strings PT antigas como
  // 'espalhar'/'enterrar' foram migradas em V0 (commit subsequente);
  // este teste garante que NÃO reaparecem em UI nova. Detalhes em
  // CLAUDE.md "Vocabulary mapping" + Docs/design-system.md §1.
  //
  // Heurística: scan src/**/*.tsx por matches em strings (entre aspas
  // ou JSX text). Strip comments primeiro (matches em comments OK pra
  // contexto histórico).

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/.*$/gm, '$1')
  }

  function findFiles(dir: string): string[] {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const out: string[] = []
    function walk(d: string): void {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full)
        } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
          out.push(full)
        }
      }
    }
    walk(dir)
    return out
  }

  it('zero "espalha\\|enterra" em strings/JSX de src/**/*.tsx (UI vocab antigo migrado)', () => {
    const tsxFiles = findFiles(join(ROOT, 'src'))
    const offenders: { file: string; line: number; text: string }[] = []
    const pattern = /(?:>[^<]*|['"`][^'"`]*)\b(?:espalha|enterra)\w*\b/i

    for (const file of tsxFiles) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          offenders.push({
            file: file.replace(ROOT, '').replace(/\\/g, '/'),
            line: i + 1,
            text: lines[i].trim().slice(0, 100),
          })
        }
      }
    }

    expect(
      offenders,
      `Vocab UI antigo detectado em strings JSX. UI deve usar DRIFT/SINK/DERIVA. ` +
        `Comentários OK; strings/JSX text não. Hits:\n${offenders
          .map((o) => `  ${o.file}:${o.line}: ${o.text}`)
          .join('\n')}`,
    ).toEqual([])
  })

  it('protocol-spec.md preserva associação 9079↔SPREAD e 9080↔BURY', () => {
    const spec = readFileSync(join(ROOT, 'Docs', 'protocol-spec.md'), 'utf8')
    expect(spec, 'spec deve associar 9079 a SPREAD em alguma seção').toMatch(/9079[^]{0,100}SPREAD/)
    expect(spec, 'spec deve associar 9080 a BURY em alguma seção').toMatch(/9080[^]{0,100}BURY/)
  })
})

describe('Theme color paridade 5-way (V1 redesign — Marshall LOCK_VIA_TEST)', () => {
  // Paleta hex aparece em 5 fontes de verdade. Sem teste, próxima
  // mudança de paleta esquece 1-2 e drifta silenciosamente. Espelha
  // problema CSP que já foi resolvido. Source canônico: tailwind.config.js
  // `theme.extend.colors.drift.bg`. Outras 4 fontes devem replicar.
  it('theme_color/background_color batem entre tailwind, index.css, vite, index.html, tauri', () => {
    // 1. Tailwind config (canônico)
    const tailwindCfg = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8')
    const tailwindBgMatch = tailwindCfg.match(/drift:\s*\{[^}]*\bbg:\s*['"]([^'"]+)['"]/s)
    expect(tailwindBgMatch, 'tailwind.config.js deve definir drift.bg').toBeTruthy()
    const canonicalBg = tailwindBgMatch![1].toLowerCase()

    // 2. index.css :root --drift-bg
    const indexCss = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8')
    const cssVarMatch = indexCss.match(/--drift-bg:\s*([^;]+);/)
    expect(cssVarMatch, 'src/index.css deve definir --drift-bg em :root').toBeTruthy()
    expect(cssVarMatch![1].trim().toLowerCase(), 'src/index.css --drift-bg deve bater com tailwind').toBe(canonicalBg)

    // 3. vite.config.ts manifest theme_color + background_color
    const viteCfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    const themeColorMatch = viteCfg.match(/theme_color:\s*['"]([^'"]+)['"]/)
    const bgColorMatch = viteCfg.match(/background_color:\s*['"]([^'"]+)['"]/)
    expect(themeColorMatch, 'vite.config.ts deve definir theme_color').toBeTruthy()
    expect(bgColorMatch, 'vite.config.ts deve definir background_color').toBeTruthy()
    expect(themeColorMatch![1].toLowerCase(), 'vite theme_color deve bater com tailwind drift.bg').toBe(canonicalBg)
    expect(bgColorMatch![1].toLowerCase(), 'vite background_color deve bater com tailwind drift.bg').toBe(canonicalBg)

    // 4. index.html <meta name="theme-color">
    const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const metaThemeMatch = indexHtml.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/)
    expect(metaThemeMatch, 'index.html deve ter <meta name="theme-color">').toBeTruthy()
    expect(metaThemeMatch![1].toLowerCase(), 'index.html theme-color deve bater com tailwind drift.bg').toBe(
      canonicalBg,
    )

    // 5. tauri.conf.json window backgroundColor
    const tauriConf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
      app?: { windows?: Array<{ backgroundColor?: string }> }
    }
    const tauriBg = tauriConf.app?.windows?.[0]?.backgroundColor
    expect(tauriBg, 'tauri.conf.json deve ter app.windows[0].backgroundColor').toBeTruthy()
    expect(tauriBg!.toLowerCase(), 'tauri backgroundColor deve bater com tailwind drift.bg').toBe(canonicalBg)
  })
})

describe('CSP paridade Tauri ↔ Vercel (Marshall risco #3)', () => {
  // Marshall apontou que vercel.json CSP tem `font-src`, `manifest-src`,
  // `form-action` que tauri.conf.json não tem. Paridade chave-a-chave
  // garante que mudança em um runtime é replicada no outro — modelo de
  // segurança consistente cross-runtime.
  function parseCspDirectives(csp: string): Map<string, string[]> {
    const map = new Map<string, string[]>()
    for (const directive of csp.split(';').map((d) => d.trim()).filter(Boolean)) {
      const [name, ...sources] = directive.split(/\s+/)
      map.set(name, sources)
    }
    return map
  }

  function loadVercelCsp(): string {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    const all = (vercelJson.headers ?? [])
      .filter((h) => h.source === '/(.*)')
      .flatMap((h) => h.headers)
    return all.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value ?? ''
  }

  function loadTauriCsp(): string {
    const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
      app?: { security?: { csp?: string } }
    }
    return tauri.app?.security?.csp ?? ''
  }

  // Diretivas que DEVEM existir em ambos runtimes — modelo de segurança
  // não pode divergir nestes pontos. Whitelist de divergência aceita
  // só onde semantica do runtime é genuinamente diferente.
  const REQUIRED_PARITY = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'connect-src',
    'worker-src',
    'frame-ancestors',
  ]

  it('vercel + tauri têm as mesmas diretivas core de CSP', () => {
    const vercelDirectives = parseCspDirectives(loadVercelCsp())
    const tauriDirectives = parseCspDirectives(loadTauriCsp())
    for (const directive of REQUIRED_PARITY) {
      expect(
        vercelDirectives.has(directive),
        `vercel.json CSP deve definir ${directive}`,
      ).toBe(true)
      expect(
        tauriDirectives.has(directive),
        `tauri.conf.json CSP deve definir ${directive} (paridade com vercel)`,
      ).toBe(true)
    }
  })

  it('vercel CSP define diretivas extras de browser (font-src, manifest-src, form-action, base-uri, object-src)', () => {
    // Estas só fazem sentido em browser context — Tauri WebView não
    // serve manifest, fonts vêm bundled, etc. Whitelist legítima de
    // divergência. Mas vercel deve ter todas pra não regredir.
    const vercelDirectives = parseCspDirectives(loadVercelCsp())
    const browserOnly = ['font-src', 'manifest-src', 'form-action', 'base-uri', 'object-src']
    for (const directive of browserOnly) {
      expect(
        vercelDirectives.has(directive),
        `vercel.json CSP deve ter ${directive} (browser hardening específico)`,
      ).toBe(true)
    }
  })

  it("nenhum dos CSPs permite 'unsafe-eval' cru (só 'wasm-unsafe-eval' aceito)", () => {
    const vercelTokens = loadVercelCsp().split(/\s+/)
    const tauriTokens = loadTauriCsp().split(/\s+/)
    expect(vercelTokens, "vercel CSP não pode conter 'unsafe-eval'").not.toContain("'unsafe-eval'")
    expect(tauriTokens, "tauri CSP não pode conter 'unsafe-eval'").not.toContain("'unsafe-eval'")
  })
})
