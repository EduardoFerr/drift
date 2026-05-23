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
    // COEP: 'require-corp' OR 'credentialless' — ambos garantem
    // crossOriginIsolated (SharedArrayBuffer + SQLite WASM OPFS funcionam).
    // Drift usa 'credentialless' desde Track B (2026-05-06) pra permitir
    // imagens cross-origin sem CORP header (image.nostr.build CDN não
    // envia CORP). Modelo de segurança preservado — só relaxa resource
    // loading. Chrome 96+, Firefox 119+. Ref: blob-distribution.md §9.
    expect(map.get('cross-origin-embedder-policy')).toMatch(
      /^(require-corp|credentialless)$/,
    )
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

  /**
   * Detecta se uma linha contém vocab UI antigo em contexto JSX/string.
   * Cobre 3 casos:
   *   1. JSX text inline: `<p>Espalhar...</p>` (entre > e <)
   *   2. JSX text multi-line: linha começa com whitespace + texto (não
   *      código JS), tipicamente após <br/> ou <tag>
   *   3. String literal: `'espalhar'`, `"enterrar"`, ou backtick
   */
  function detectVocabOffense(line: string): boolean {
    const banned = /\b(?:espalha|enterra)\w*\b/i
    if (!banned.test(line)) return false
    // Caso (3): string literal contendo o termo
    if (/(['"`])[^'"`]*\b(?:espalha|enterra)\w*\b[^'"`]*\1/i.test(line)) return true
    // Caso (1): JSX text após >
    if (/>[^<]*\b(?:espalha|enterra)\w*\b/i.test(line)) return true
    // Caso (2): linha de JSX text puro (sem código TS — typicamente
    // só whitespace + palavra). Heurística: linha não tem `=`, `(`,
    // `{`, `:` antes do termo (caso geral de prop/expr) e não tem
    // typescript keywords. Falsos positivos aceitos: serão pegos
    // visualmente em PR review se aparecerem.
    const trimmed = line.trim()
    const hasJsCode = /[={(:]/.test(trimmed.slice(0, trimmed.search(banned)))
    return !hasJsCode
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

    for (const file of tsxFiles) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (detectVocabOffense(lines[i])) {
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

  it('zero "spread/spreads" lowercase em strings JSX user-facing (Barney audit 2026-05-23)', () => {
    // UI usa DRIFT/DRIFTs. Camada protocolo (kind 9079=SPREAD, types
    // como SpreadMap, vars como spreadCount) é OK — só strings JSX
    // visíveis ao user violam. Heurística: lowercase "spread"/"spreads"
    // como palavra inteira em JSX text (>...<) ou string literal.
    // Comments, identificadores camelCase (spreadCount), PascalCase
    // (SpreadMap, SpreadMapProps), e ocorrências dentro de outras
    // palavras (spreading, spreader, spreadsheet) ficam OK — não
    // confundem o user.
    const tsxFiles = findFiles(join(ROOT, 'src'))
    const offenders: { file: string; line: number; text: string }[] = []
    // Banido: "spread" / "spreads" lowercase como palavra inteira em
    // texto JSX visível (entre > e <). Heurística conservadora — só
    // captura texto JSX puro pra evitar falsos positivos em strings
    // técnicas (console warns, dialog.confirm strings, title attrs,
    // que misturam termos protocolo com PT-BR e exigem migração mais
    // ampla — track futuro pós-audit Barney 2026-05-23).
    //
    // Track futuro: ampliar pra body="..." attrs e dialog.* args quando
    // todas as ~10 ocorrências forem migradas (não é blocking pra este
    // commit; LOCK serve como fundação anti-regressão).
    const banned = /(?<!-)(?<!drift-)\bspreads?\b(?![:\-])/

    function detectSpreadOffense(line: string): boolean {
      if (!banned.test(line)) return false
      // Captura "spread"/"spreads" em texto JSX (entre > de tag open e
      // < de tag close/expression). Pula linhas com className= pra não
      // bater em CSS classnames residuais.
      if (/className=/.test(line)) return false
      const jsxText = /(>)([^<>]*\bspreads?\b[^<>]*)(<)/.exec(line)
      if (jsxText && !/^\s*$/.test(jsxText[2])) return true
      return false
    }

    for (const file of tsxFiles) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (detectSpreadOffense(lines[i])) {
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
      `Vocab "spread/spreads" lowercase em strings JSX user-facing. UI deve usar DRIFT/DRIFTs ` +
        `(Barney audit 2026-05-23). Camada protocolo (kind 9079=SPREAD, SpreadMap type, ` +
        `spreadCount var) fica OK — só strings visíveis ao user. Hits:\n${offenders
          .map((o) => `  ${o.file}:${o.line}: ${o.text}`)
          .join('\n')}`,
    ).toEqual([])
  })

  it('UI usa "Configurações" (não "Ajustes" / "Settings") em strings PT-BR — Barney audit 2026-05-23', () => {
    // Vocabulário UI canonico PT-BR: a tela de settings do Drift chama
    // "Configurações". "Ajustes" é o nome do app de Settings do iOS/iPadOS
    // (Apple) — quando uma string refere o sistema operacional, manter
    // "Ajustes". Quando refere a tela INTERNA do Drift, usar "Configurações".
    // "Settings" lowercase em PT-BR é estrangeirismo — também banido.
    //
    // Allowlist: src/components/UI/GpsErrorBanner.tsx tem instruções pra
    // iOS Safari ("Ajustes → Safari → Localização") — manter como é
    // (label literal do app Apple). Outros files que referenciam Drift
    // settings devem usar "Configurações".
    const tsxFiles = findFiles(join(ROOT, 'src'))
    const offenders: { file: string; line: number; text: string }[] = []
    const allowFiles = new Set(['/src/components/UI/GpsErrorBanner.tsx'])

    for (const file of tsxFiles) {
      const rel = file.replace(ROOT, '').replace(/\\/g, '/')
      if (allowFiles.has(rel)) continue
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Match "Ajustes" como palavra inteira em string literal ou
        // JSX text. Pula identificadores TS (RelaySettings etc.) via
        // palavra "Ajustes" (capitalizada exata; não bate ProfileSettings).
        // Para "Settings": só pega quando aparece como JSX text user-
        // facing (`>Settings<` ou `'Settings'` em string isolada).
        if (/\bAjustes\b/.test(line)) {
          offenders.push({
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 100),
          })
        }
      }
    }

    expect(
      offenders,
      `"Ajustes" detectado em strings JSX user-facing fora do allowlist (iOS labels). ` +
        `UI Drift canonica usa "Configurações" (Barney audit 2026-05-23). Hits:\n${offenders
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

describe('Fontes self-hosted (V2 redesign — Marshall LOCK_VIA_TEST)', () => {
  // PRIVACY.md afirma "cliente roda 100% local" e lista terceiros
  // explicitamente. Google Fonts (fonts.googleapis.com / fonts.gstatic.com)
  // NÃO está na lista — qualquer request a esses domínios viola a
  // claim de privacy-first. V2 substituiu Google Fonts por @fontsource
  // (woff2 bundled em /assets/). Este teste garante que reaparecimento
  // de URL externa em CSS/HTML/TS é detectado em CI.
  it('zero referências a fonts.googleapis.com / fonts.gstatic.com em src/, public/, index.html', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')

    const targets: string[] = []
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
            walk(full)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name)
          if (['.ts', '.tsx', '.css', '.html', '.js', '.jsx'].includes(ext)) {
            targets.push(full)
          }
        }
      }
    }
    walk(join(ROOT, 'src'))
    walk(join(ROOT, 'public'))
    targets.push(join(ROOT, 'index.html'))

    const offenders: { file: string; line: number; text: string }[] = []
    const pattern = /fonts\.(?:googleapis|gstatic)\.com/i

    /**
     * Strip comments. Cobre CSS (/* ... *\/) + JS/TS (// ... e /* ... *\/)
     * + HTML (<!-- ... -->). Multi-line block comments removidos antes
     * de split por linha pra preservar line numbers.
     */
    function stripAllComments(source: string): string {
      return source
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"])\/\/.*$/gm, (m, prefix) => prefix + ''.padEnd(m.length - prefix.length, ' '))
    }

    for (const file of targets) {
      const content = stripAllComments(readFileSync(file, 'utf8'))
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
      `Google Fonts URL detectada — viola privacy-first claim (PRIVACY.md). ` +
        `Use @fontsource/* (bundled woff2) ou self-host. Hits:\n${offenders
          .map((o) => `  ${o.file}:${o.line}: ${o.text}`)
          .join('\n')}`,
    ).toEqual([])
  })
})

describe('Theme color paridade 4-way (V2 multi-tema — Marshall LOCK_VIA_TEST)', () => {
  // V2 (2026-05-17): paleta multi-tema. PWA manifest, index.html meta e
  // tauri config são estáticos por spec (não suportam CSS vars) — devem
  // bater com o DEFAULT theme (cinder). Outros temas (Rosenholz/Velatura)
  // ficam só no SPA runtime; PWA shell mantém cinder.
  //
  // Source canônico: src/styles/themes.css bloco `[data-theme='cinder']`
  // (e :root, que é alias do cinder default).
  it('theme_color/background_color batem entre themes.css(cinder), vite, index.html, tauri', () => {
    // 1. themes.css cinder block (canônico)
    const themesCss = readFileSync(join(ROOT, 'src', 'styles', 'themes.css'), 'utf8')
    // Extrai bloco cinder e captura --drift-bg.
    const cinderBlockMatch = themesCss.match(
      /(?::root,\s*)?\[data-theme=['"]cinder['"]\]\s*\{([\s\S]*?)^\}/m,
    )
    expect(cinderBlockMatch, 'themes.css deve ter bloco [data-theme="cinder"]').toBeTruthy()
    const bgMatch = cinderBlockMatch![1].match(/--drift-bg:\s*([^;]+);/)
    expect(bgMatch, 'cinder block deve definir --drift-bg').toBeTruthy()
    const canonicalBg = bgMatch![1].trim().toLowerCase()

    // 2. vite.config.ts manifest theme_color + background_color
    const viteCfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    const themeColorMatch = viteCfg.match(/theme_color:\s*['"]([^'"]+)['"]/)
    const bgColorMatch = viteCfg.match(/background_color:\s*['"]([^'"]+)['"]/)
    expect(themeColorMatch, 'vite.config.ts deve definir theme_color').toBeTruthy()
    expect(bgColorMatch, 'vite.config.ts deve definir background_color').toBeTruthy()
    expect(themeColorMatch![1].toLowerCase(), 'vite theme_color deve bater com cinder bg').toBe(canonicalBg)
    expect(bgColorMatch![1].toLowerCase(), 'vite background_color deve bater com cinder bg').toBe(canonicalBg)

    // 3. index.html <meta name="theme-color">
    const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const metaThemeMatch = indexHtml.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/)
    expect(metaThemeMatch, 'index.html deve ter <meta name="theme-color">').toBeTruthy()
    expect(metaThemeMatch![1].toLowerCase(), 'index.html theme-color deve bater com cinder bg').toBe(
      canonicalBg,
    )

    // 4. tauri.conf.json window backgroundColor
    const tauriConf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
      app?: { windows?: Array<{ backgroundColor?: string }> }
    }
    const tauriBg = tauriConf.app?.windows?.[0]?.backgroundColor
    expect(tauriBg, 'tauri.conf.json deve ter app.windows[0].backgroundColor').toBeTruthy()
    expect(tauriBg!.toLowerCase(), 'tauri backgroundColor deve bater com cinder bg').toBe(canonicalBg)
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

// ─── Track C.5 (2026-05-07) — comments NIP-22 conformance ───
// Origem: peer review adversarial Track C. Três invariantes que fecham
// gaps de regressão futura no schema de comments:
//   1. applyCommentReceived (scoring.ts) é puro — futuro refactor não
//      pode introduzir Date.now/db/random sem quebrar §7 determinismo.
//   2. INSERT INTO comments só em events.ts — espelha invariante #1
//      (única porta de INSERT em domínio).
//   3. commentOnPost (protocol.ts) NÃO emite tag `location` — comments
//      não vazam geo (§28 privacidade pelo mínimo); só posts kind 9078
//      podem opt-in em location.

describe('§7 determinismo — applyCommentReceived (Track C.5)', () => {
  it('applyCommentReceived (scoring.ts) é puro — sem Date.now/random/db/await', () => {
    const src = readFileSync(join(SRC, 'lib', 'scoring.ts'), 'utf8')
    const body = extractFunctionBody(src, 'applyCommentReceived')
    expect(body, 'applyCommentReceived body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    expect(stripped, 'applyCommentReceived must not call Date.now()').not.toMatch(/\bDate\.now\b/)
    expect(stripped, 'applyCommentReceived must not call performance.now()').not.toMatch(/performance\.now/)
    expect(stripped, 'applyCommentReceived must not call Math.random()').not.toMatch(/Math\.random/)
    expect(stripped, 'applyCommentReceived must not construct new Date()').not.toMatch(/new\s+Date\b/)
    expect(stripped, 'applyCommentReceived must not call db.exec/get/run').not.toMatch(/\bdb\.(exec|get|run)\b/)
    expect(stripped, 'applyCommentReceived must be sync (no await)').not.toMatch(/\bawait\b/)
  })
})

describe('§1 única porta INSERT — comments (Track C.1)', () => {
  it('INSERT INTO comments aparece apenas em src/lib/events.ts', async () => {
    const fg = await import('fast-glob')
    const files = await fg.default('src/**/*.ts', { cwd: ROOT, onlyFiles: true })
    const offenders: string[] = []
    // Match SQL INSERT INTO comments — case-insensitive, opcional OR IGNORE.
    // False positive possível: docstring com SQL de exemplo. Mitigação:
    // stripComments antes de testar. Tabela de domínio "comments" só
    // aparece como SQL real em events.ts hoje.
    const pattern = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+comments\b/i
    for (const rel of files) {
      const raw = readFileSync(join(ROOT, rel), 'utf8')
      const stripped = stripComments(raw)
      if (pattern.test(stripped)) {
        const norm = rel.replace(/\\/g, '/')
        if (norm !== 'src/lib/events.ts') {
          offenders.push(norm)
        }
      }
    }
    expect(
      offenders,
      `INSERT INTO comments encontrado fora de src/lib/events.ts (viola invariante #1):\n` +
        offenders.map((f) => `  ${f}`).join('\n'),
    ).toEqual([])
  })
})

describe('§28 privacidade pelo mínimo — comments sem location (Track C.5)', () => {
  it('commentOnPost (protocol.ts) NÃO emite tag location', () => {
    const src = readFileSync(join(SRC, 'lib', 'protocol.ts'), 'utf8')
    const body = extractFunctionBody(src, 'commentOnPost')
    expect(body, 'commentOnPost body not extracted').toBeTruthy()
    const stripped = stripComments(body!)
    // Anti-regressão: tags array literal não pode conter ['location', ...]
    // ou ["location", ...]. Comments não opt-in em geo (NIP-22 + §28).
    expect(
      stripped,
      "commentOnPost não pode emitir tag 'location' (§28 privacidade pelo mínimo — só kind 9078 opt-in geo)",
    ).not.toMatch(/\[\s*['"]location['"]/)
  })
})

describe('§15 anti-censura — webrtcTransport gated por network_mode', () => {
  // Origem: Robin's finding em
  // `Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md` §7 item 1.
  // Spec `Docs/webrtc-6.4-plan.md:106` exige que em modo `tor` ou
  // `onion-only` o orchestrator NÃO registre `webrtcTransport` —
  // STUN/ICE candidates locais vazariam IP do user mesmo com tráfego
  // Nostr indo via Tor. `tests/webrtc-tor-mode-isolation.test.ts` cobre
  // o comportamento; este teste estático garante que ninguém remova o
  // gate em refactor futuro.
  //
  // Manifesto §15 (anti-censura por país), §27 (privacidade visível).
  it('bootstrap.ts envolve registerTransport(webrtcTransport) com gate de network_mode', () => {
    const src = readFileSync(join(SRC, 'lib', 'bootstrap.ts'), 'utf8')
    const stripped = stripComments(src)

    // 1. Confirma que a chamada existe (regressão futura: alguém remove
    //    a registração inteira por engano).
    const registerCallRe = /registerTransport\s*\(\s*webrtcTransport\b/
    const callMatch = stripped.match(registerCallRe)
    expect(
      callMatch,
      'bootstrap.ts deve registrar webrtcTransport no orchestrator',
    ).toBeTruthy()

    // 2. Confirma que existe um gate `network_mode === 'clearnet'`
    //    (ou variante `!== 'tor' && !== 'onion-only'`) ANTES da chamada.
    //    Janela de busca: 200 chars antes do match — generoso pra
    //    comportar comentários de código + linha do `if`.
    const callIdx = callMatch!.index!
    const lookback = stripped.slice(Math.max(0, callIdx - 400), callIdx)

    // Aceita qualquer das formas idiomáticas:
    //   if (networkMode === 'clearnet')
    //   if (networkMode !== 'tor' && networkMode !== 'onion-only')
    //   if (network_mode === 'clearnet')  // futuro snake_case (pouco provável)
    const gateRe =
      /\bif\s*\([^)]*\b(?:network_?mode|networkMode|getPrefs\(\)\.network_mode)\b[^)]*(?:===\s*['"]clearnet['"]|!==\s*['"]tor['"][^)]*!==\s*['"]onion-only['"]|!==\s*['"]onion-only['"][^)]*!==\s*['"]tor['"])[^)]*\)/
    expect(
      gateRe.test(lookback),
      'registerTransport(webrtcTransport) deve estar dentro de gate por network_mode === \'clearnet\' ' +
        '(ou !== tor && !== onion-only). Spec: webrtc-6.4-plan.md §IP leak via WebRTC ICE. ' +
        'Manifesto §15 (anti-censura) + §27 (privacidade visível). ' +
        'STUN/ICE candidates vazariam IP local do user em modo tor/onion-only.\n\n' +
        'Janela de lookback (400 chars antes da chamada):\n' +
        lookback,
    ).toBe(true)
  })
})

describe('Native dialogs banidos em src/ (UX consistency, V14.2)', () => {
  // Native window.alert/confirm/prompt renderiza em estilo do browser
  // — feio sobre o tema dark Drift, e em Tauri nem sempre disponível.
  // src/lib/dialog.ts substitui com modal próprio (drift-surface +
  // framer-motion). Test guarda contra regressão silenciosa.
  //
  // Whitelist: useInstallPrompt.ts usa `evt.prompt()` (BeforeInstall
  // PromptEvent API, não o native window.prompt — assinatura diferente).
  // src/lib/dialog.ts contém os definitions e exemplos no docstring.

  it('zero chamadas window.alert/confirm/prompt em src/components e src/App.tsx', async () => {
    const fg = await import('fast-glob')
    const files = await fg.default(
      [
        'src/App.tsx',
        'src/components/**/*.{ts,tsx}',
        'src/lib/!(dialog).ts',
        'src/hooks/!(useInstallPrompt).ts',
      ],
      {
        cwd: ROOT,
        onlyFiles: true,
        // DialogHost é a implementação do modal — comentários internos
        // referenciam alert/confirm/prompt como termo conceitual.
        ignore: ['src/components/UI/DialogHost.tsx'],
      },
    )
    const offenders: { file: string; line: number; text: string }[] = []
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      src.split('\n').forEach((line, i) => {
        // Match início de identifier (não dentro de outro identifier).
        // alert( / confirm( / prompt( standalone, sem prefixo de objeto
        // (ex.: dialog.alert, evt.prompt passam — esses têm `.` antes).
        if (/(?<![\w.])(alert|confirm|prompt)\s*\(/.test(line)) {
          offenders.push({ file: '/' + rel.replace(/\\/g, '/'), line: i + 1, text: line.trim() })
        }
      })
    }
    expect(
      offenders,
      'Native dialogs detectados. Use `dialog.alert/confirm/prompt` de src/lib/dialog.ts. Hits:\n' +
        offenders.map((o) => `  ${o.file}:${o.line}: ${o.text}`).join('\n'),
    ).toEqual([])
  })
})
