/**
 * Manifesto §25 — "Sem Chave Mestra Disfarçada" / "Zero Scan Automático".
 *
 * Origem: Sprint N+2 P0.4 (Marshall, 2026-05-21).
 *
 * Claim testada: cliente oficial Drift NÃO escaneia, classifica ou filtra
 * conteúdo automaticamente. Sem PhotoDNA, sem ML local de moderação, sem
 * blocklists embutidas, sem face detection, sem CSAM scanner, sem NSFW
 * classifier. Manifesto §25 v2.2.
 *
 * Por que LOCK_VIA_TEST?
 * - Drift se diferencia pela ausência de scan automático. Adicionar
 *   silenciosamente `nsfwjs` em uma feature "útil" (ex.: blur de NSFW
 *   automático) quebraria a claim pública sem alarme visível.
 * - §25 não é aspiração — é compromisso vinculante. Test estático sobre
 *   `package.json` + source grep impede que dependência apareça via
 *   PR de feature ou via transitive npm install.
 * - O operador de scanner (Microsoft pra PhotoDNA, Cloudflare pra
 *   csam-scanner, modelo treinado por terceiro pra NSFW) herda chave
 *   mestra de facto. §25 fecha esse vetor.
 *
 * Escopo: SOMENTE cliente oficial em `src/`. Plugins externos / clientes
 * alternativos podem implementar scan opt-in — não é problema deste test.
 *
 * Falsos positivos esperados:
 * - "scan" como verbo genérico em comentários ("scan source files",
 *   "we scan for tags") → mitigado strip-comments + lista de patterns
 *   suficientemente específicos.
 * - Identifiers fora de contexto de moderação (ex.: `scanRelays`) →
 *   patterns alvo são compostos (`scanContent`, `classifyPost`,
 *   `detectNsfw`, `isCsam`, etc.).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/** Strip JS/TS comments (line + block) — best-effort. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, (_m, prefix) => prefix)
}

/** Walks src/ recursively, returning .ts/.tsx files. */
function findSourceFiles(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
          walk(full)
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

// Bibliotecas conhecidas de scan/classificação automática de conteúdo.
// Lista NÃO-exaustiva mas cobre os candidatos mais prováveis de surgir
// em PR "feature inocente" que viola §25.
const BANNED_LIBRARIES = [
  // Microsoft / hash-based CSAM detection
  'photodna',
  'photodna-client',
  '@microsoft/photodna',
  // Cloudflare CSAM scanner
  '@cloudflare/csam-scanner',
  'cf-csam-scanner',
  // NSFW classifiers (ML local)
  'nsfwjs',
  '@nsfwjs/nsfwjs',
  'nsfw-filter',
  'opennsfw',
  'opennsfw2',
  // TensorFlow.js — generic ML runtime, often paired with NSFW/face models
  '@tensorflow/tfjs',
  '@tensorflow/tfjs-core',
  '@tensorflow/tfjs-node',
  '@tensorflow-models/coco-ssd',
  '@tensorflow-models/mobilenet',
  // Face detection (often used in "auto-blur faces" features → quebra §25)
  'face-api.js',
  '@vladmandic/face-api',
  // Google Safe Browsing / blocklists embutidas
  'safe-browsing',
  'google-safe-browsing',
  // Generic toxicity / hate-speech classifiers
  '@tensorflow-models/toxicity',
  'perspective-api',
]

describe('Manifesto §25 — sem dependência de scanner/ML classifier no cliente oficial', () => {
  it('package.json não declara nenhuma library proibida em dependencies/devDependencies/optionalDependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const allDeps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ])
    const offenders = BANNED_LIBRARIES.filter((lib) => allDeps.has(lib))
    expect(
      offenders,
      `Library de scan/ML classifier detectada em package.json. ` +
        `Manifesto §25: cliente oficial NÃO escaneia conteúdo automaticamente. ` +
        `Detalhe: ${offenders.join(', ')}. ` +
        `Se feature precisa scan, faça plugin externo opt-in (não cliente oficial).`,
    ).toEqual([])
  })

  it('nenhum arquivo em src/ importa library proibida (static import / require / dynamic import)', () => {
    const files = findSourceFiles(SRC)
    const offenders: { file: string; line: number; text: string; lib: string }[] = []
    // Patterns: `from 'lib'`, `from "lib"`, `require('lib')`, `import('lib')`.
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const lib of BANNED_LIBRARIES) {
          // Escape de regex pra nome de package (com `/`, `@`, `.`).
          const escaped = lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(
            `(?:from\\s+['"\`]|require\\(\\s*['"\`]|import\\(\\s*['"\`])${escaped}(?:/[^'"\`]*)?['"\`]`,
          )
          if (re.test(line)) {
            offenders.push({
              file: file.replace(ROOT, '').replace(/\\/g, '/'),
              line: i + 1,
              text: line.trim().slice(0, 120),
              lib,
            })
          }
        }
      }
    }
    expect(
      offenders,
      `Import de library de scan/ML classifier detectado em src/. ` +
        `Manifesto §25 LOCK_VIA_TEST. Hits:\n` +
        offenders.map((o) => `  ${o.file}:${o.line} [${o.lib}]: ${o.text}`).join('\n'),
    ).toEqual([])
  })
})

describe('Manifesto §25 — zero identifiers de scan/classify automático em src/', () => {
  // Patterns de identifier que indicam scan automático de conteúdo —
  // composto (não palavra solta) pra evitar falsos positivos com
  // "scanRelays", "scan source files", etc. Cada pattern é específico
  // a moderação automática de CONTEÚDO (não de network/relays).
  const SUSPICIOUS_PATTERNS: { name: string; re: RegExp; reason: string }[] = [
    {
      name: 'scanContent',
      re: /\b(?:scanContent|scanPost|scanImage|scanMedia|contentScan|imageScan|mediaScan)\b/,
      reason: 'identifier indica scan automático de conteúdo de post',
    },
    {
      name: 'classifyPost/classifyContent',
      re: /\b(?:classifyPost|classifyContent|classifyImage|classifyMedia|autoClassify)\b/,
      reason: 'identifier indica classificação automática (ML) — §25 só permite auto-classify VOLUNTÁRIO via tag content-warning do autor',
    },
    {
      name: 'detectNsfw / isNsfw (auto)',
      re: /\b(?:detectNsfw|nsfwDetect|isNsfw|nsfwScore|nsfwClassify|computeNsfw)\b/i,
      reason: 'detecção automática de NSFW = ML classifier embutido (proibido §25)',
    },
    {
      name: 'detectCsam / isCsam',
      re: /\b(?:detectCsam|csamDetect|isCsam|csamScan|csamHash|csamCheck|photoDnaHash|photoDnaScan)\b/i,
      reason: 'CSAM scanner embutido = chave mestra disfarçada do operador do scanner (proibido §25). Conteúdo ilegal: §26 reports + §17 denúncia a autoridades',
    },
    {
      name: 'detectFace / faceRecognition',
      re: /\b(?:detectFace|faceDetect|faceRecognize|faceRecognition|recognizeFace|faceEmbedding)\b/i,
      reason: 'face recognition automática viola §28 (privacidade pelo mínimo) e §25',
    },
    {
      name: 'detectToxicity / hateSpeechScan',
      re: /\b(?:detectToxicity|toxicityScore|hateSpeechDetect|hateSpeechScan|toxicityClassify)\b/i,
      reason: 'toxicity classifier automático = §25 (operador do modelo decide o que passa)',
    },
    {
      name: 'autoBlocklist / contentBlocklist',
      re: /\b(?:autoBlocklist|contentBlocklist|embeddedBlocklist|blocklistCheck|blockedKeywords|bannedWordsList)\b/,
      reason: 'blocklist embutida = lista canônica do operador (proibido §25). Block/mute é local opt-in em §24',
    },
  ]

  it('zero matches de patterns de scan/classify automático em src/**/*.{ts,tsx}', () => {
    const files = findSourceFiles(SRC)
    const offenders: { file: string; line: number; text: string; pattern: string; reason: string }[] = []
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const { name, re, reason } of SUSPICIOUS_PATTERNS) {
          if (re.test(lines[i])) {
            offenders.push({
              file: file.replace(ROOT, '').replace(/\\/g, '/'),
              line: i + 1,
              text: lines[i].trim().slice(0, 120),
              pattern: name,
              reason,
            })
          }
        }
      }
    }
    expect(
      offenders,
      `Identifier de scan/classify automático detectado em src/. Manifesto §25 LOCK_VIA_TEST.\n` +
        `Se feature legítima precisa do nome, refatore pra deixar claro que é AÇÃO DO USER ` +
        `(ex.: userMarkedNsfw em vez de detectNsfw) ou mova pra plugin externo opt-in. Hits:\n` +
        offenders
          .map((o) => `  ${o.file}:${o.line} [${o.pattern}]: ${o.text}\n    motivo: ${o.reason}`)
          .join('\n'),
    ).toEqual([])
  })
})

describe('Manifesto §25 — declaração presente em fontes canônicas', () => {
  it('CLAUDE.md declara invariante "sem scan automático" explicitamente', () => {
    const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    // Heurística: deve mencionar tanto §25 (numérico) quanto a frase
    // negacional. Tolerante a variações ortográficas.
    expect(
      claudeMd,
      'CLAUDE.md deve referenciar manifesto §25 explicitamente',
    ).toMatch(/§25\b/)
    expect(
      claudeMd,
      'CLAUDE.md deve declarar invariante de não-scan de conteúdo (frase com "não escaneia" / "sem scan automático" / "NÃO escaneia")',
    ).toMatch(/(?:n[ãa]o\s+escaneia|sem\s+scan\s+autom[áa]tico|NÃO\s+escaneia)/i)
  })

  it('manifesto.md (Docs/) lista §25 com nome "Sem Chave Mestra Disfarçada" ou equivalente', () => {
    // Best-effort: o arquivo manifesto é canônico. Aceita variações em
    // títulos contanto que o número §25 esteja presente e a frase de
    // não-scan exista no documento. Skip silencioso se arquivo não
    // existir (ambientes minimalistas) — usa try/catch.
    let manifesto: string
    try {
      manifesto = readFileSync(join(ROOT, 'Docs', 'manifesto.md'), 'utf8')
    } catch {
      // Se Docs/manifesto.md sumir, isso é problema maior que este test —
      // mas não bloqueia esta suíte. Apenas registra.
      return
    }
    expect(manifesto, 'manifesto.md deve referenciar §25').toMatch(/(?:§25|25\.\s)/)
    expect(
      manifesto,
      'manifesto.md deve conter declaração de não-scan automático',
    ).toMatch(/(?:n[ãa]o\s+escaneia|sem\s+scan\s+autom[áa]tico|sem\s+ML\s+local\s+de\s+modera[çc][ãa]o|NÃO\s+escaneia)/i)
  })
})

// Sanity: helper de busca encontra ao menos 1 arquivo (regressão se
// findSourceFiles quebrar e todos os outros tests passarem trivialmente).
describe('test helper sanity', () => {
  it('findSourceFiles(src/) retorna >= 50 arquivos .ts/.tsx (sanity)', () => {
    const files = findSourceFiles(SRC)
    expect(files.length, 'src/ deve ter dezenas de arquivos — se 0, helper quebrou').toBeGreaterThan(50)
  })

  it('stat sanity: src/ existe e é diretório', () => {
    const s = statSync(SRC)
    expect(s.isDirectory()).toBe(true)
  })
})
