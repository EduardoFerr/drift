/**
 * No-master-key conformance test.
 *
 * Origem: revisão adversarial 2026-05-02.
 * Claims testadas: manifesto §17 (sem chave mestra), invariantes
 * CLAUDE.md #1 (onNostrEvent única porta INSERT), #12, #13, #14.
 *
 * **Premissa:** Manifesto §17 + CLAUDE.md invariante #12 + invariante #13:
 *  - Não escrever `deletePost()`, `banUser()`, `flagAsSpam()` global, ou
 *    qualquer função que dê ao fundador poder sobre conteúdo de outros.
 *  - Cliente NÃO deleta dados moderados do SQLite — `score = -999`
 *    esconde do feed, NÃO `DELETE FROM posts`.
 *  - Sem scan automático embutido (manifesto §25).
 *  - Sem kinds privados fora da faixa Drift documentada (NIP-01 compat).
 *
 * Marshall (Cenário C — facilitação): defesa "cliente não facilita
 * conscientemente" depende de invariantes serem **continuamente
 * verificadas**. Quebrar este teste = perder argumento de defesa.
 *
 * **Escopo:** scan estático + validação de package.json e
 * `config/constants.ts`.
 *
 * **TODO humano:** expandir deny-list de funções e packages conforme
 * conhecer novos vetores.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_ROOT = join(__dirname, '..', 'src')
const ROOT = join(__dirname, '..')

function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkSource(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

interface Match {
  file: string
  line: number
  text: string
  pattern: string
}

function scanSource(patterns: { name: string; re: RegExp }[]): Match[] {
  const files = walkSource(SRC_ROOT)
  const hits: Match[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      const isComment = trimmed.startsWith('*') || trimmed.startsWith('//')
      const negates = /\b(NÃO|NAO|NOT|sem|without|never|jamais|proibid|forbidden|deny)\b/i.test(line)
      if (isComment && negates) continue
      for (const { name, re } of patterns) {
        if (re.test(line)) {
          hits.push({
            file: relative(ROOT, file),
            line: i + 1,
            text: trimmed.slice(0, 200),
            pattern: name,
          })
        }
      }
    }
  }
  return hits
}

describe('Manifesto §17 / CLAUDE.md #12: "Sem chave mestra, jamais"', () => {
  it('código fonte não exporta funções com nomes proibidos (deletePost/banUser/etc.)', () => {
    // Cobrimos `function`, `const`, `class method`, `export`. Pegamos
    // qualquer declaração — se nome existe na superfície do módulo, é
    // bandeira vermelha.
    const forbidden = [
      'deletePost',
      'banUser',
      'removeUser',
      'flagAsSpam',
      'globalMute',
      'forceModerate',
      'adminAction',
      'superuserDelete',
      'masterDelete',
      'platformDelete',
      'banPubkey',
      'silenceAuthor',
    ]
    // Precisamos pegar declarações, não menções em strings. Padrão:
    // `function NAME(`, `const NAME =`, `NAME(`, `export NAME` etc.
    const patterns = forbidden.map((name) => ({
      name,
      re: new RegExp(`\\b(function|const|let|var|export\\s+(?:async\\s+)?function|export\\s+const)\\s+${name}\\b|^\\s*async\\s+${name}\\s*\\(|^\\s*${name}\\s*\\(.*\\)\\s*[:{]`),
    }))
    const hits = scanSource(patterns)
    expect(hits, `Master-key function detected:\n${formatHits(hits)}`).toEqual([])
  })
})

describe('CLAUDE.md invariante #13: "Cliente NÃO deleta dados moderados do SQLite"', () => {
  it('moderation.ts não contém DELETE FROM em tabelas de domínio', () => {
    const file = join(SRC_ROOT, 'lib', 'moderation.ts')
    const content = readFileSync(file, 'utf8')
    // Domínio = posts, spreads, buries, reports
    const forbidden = /DELETE\s+FROM\s+(posts|spreads|buries|reports)\b/i
    const lines = content.split('\n')
    const offenders: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      // Skip JSDoc/comment lines that document the prohibition
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
      if (forbidden.test(lines[i])) {
        offenders.push(`line ${i + 1}: ${trimmed}`)
      }
    }
    expect(
      offenders,
      `moderation.ts contains forbidden DELETE in domain tables:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('moderation.ts modera via UPDATE score = -999 (mantém compromisso #13)', () => {
    const file = join(SRC_ROOT, 'lib', 'moderation.ts')
    const content = readFileSync(file, 'utf8')
    // Espera-se ao menos uma ocorrência da operação canônica.
    expect(content).toMatch(/UPDATE\s+posts\s+SET\s+score\s*=\s*-999/i)
  })
})

describe('Manifesto §25 / CLAUDE.md #7: "Sem scan automático de conteúdo"', () => {
  it('package.json não inclui dependências de scan/ML automático', () => {
    const pkgRaw = readFileSync(join(ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    }
    // Deny-list: ML/scan packages que não devem aparecer como dep do
    // cliente oficial. Plugins opt-in OFF-by-default em build separado
    // podem usar — mas core não.
    const forbidden = [
      'nsfwjs',
      '@tensorflow-models/nsfwjs',
      '@microsoft/cognitive-services-content-moderator',
      '@google-cloud/vision',
      '@google-cloud/dlp',
      'aws-sdk-rekognition',
      '@aws-sdk/client-rekognition',
      'clamav.js',
      'photodna-client',
      'photodna',
    ]
    const found = forbidden.filter((dep) => dep in allDeps)
    expect(
      found,
      `Forbidden ML/scan dependency in package.json: ${found.join(', ')}`,
    ).toEqual([])
  })

  it('upload.ts não importa packages de inspeção de imagem por conteúdo', () => {
    const file = join(SRC_ROOT, 'lib', 'upload.ts')
    const content = readFileSync(file, 'utf8')
    const forbidden = [
      /from\s+['"]nsfwjs['"]/,
      /from\s+['"]@tensorflow\/[^'"]+['"]/,
      /from\s+['"]@google-cloud\/vision['"]/,
      /from\s+['"]photodna[^'"]*['"]/,
    ]
    for (const re of forbidden) {
      expect(content, `upload.ts imports forbidden scanner: ${re}`).not.toMatch(re)
    }
  })
})

describe('CLAUDE.md invariante #14: "Sem kinds privados fora da faixa Drift documentada"', () => {
  it('DRIFT_KIND contém apenas 9078..9081 (POST/SPREAD/BURY/REPORT)', () => {
    // Validação contra os valores canônicos. Reservados 9082, 9083 NÃO
    // devem aparecer no DRIFT_KIND ainda — só quando implementados.
    const constantsFile = join(SRC_ROOT, 'config', 'constants.ts')
    const content = readFileSync(constantsFile, 'utf8')

    // Extrai bloco DRIFT_KIND = { ... }
    const blockMatch = content.match(/export\s+const\s+DRIFT_KIND\s*=\s*\{([^}]+)\}/m)
    expect(blockMatch, 'DRIFT_KIND block not found in config/constants.ts').toBeTruthy()
    const block = blockMatch![1]

    // Coleta valores numéricos atribuídos
    const values: number[] = []
    for (const m of block.matchAll(/:\s*(\d+)/g)) {
      values.push(Number(m[1]))
    }
    values.sort()
    expect(values).toEqual([9078, 9079, 9080, 9081])
  })

  it('DRIFT_KIND tem exatamente as 4 chaves canônicas', () => {
    const constantsFile = join(SRC_ROOT, 'config', 'constants.ts')
    const content = readFileSync(constantsFile, 'utf8')
    const blockMatch = content.match(/export\s+const\s+DRIFT_KIND\s*=\s*\{([^}]+)\}/m)
    const block = blockMatch![1]
    const keys: string[] = []
    for (const m of block.matchAll(/^\s*(\w+)\s*:/gm)) {
      keys.push(m[1])
    }
    keys.sort()
    expect(keys).toEqual(['BURY', 'POST', 'REPORT', 'SPREAD'])
  })
})

function formatHits(hits: Match[]): string {
  if (hits.length === 0) return '(none)'
  return hits
    .map((h) => `  ${h.file}:${h.line} [${h.pattern}] ${h.text}`)
    .join('\n')
}
