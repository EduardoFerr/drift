/**
 * Conformance — invariant §1 (CLAUDE.md): `onNostrEvent()` é a ÚNICA
 * porta de INSERT em tabelas de domínio (`posts`, `spreads`, `buries`,
 * `reports`).
 *
 * Espelha o test existente para `comments` em
 * `manifesto-conformance.test.ts`, estendendo cobertura para as 4
 * tabelas de domínio enumeradas no CLAUDE.md.
 *
 * UPDATE/DELETE locais autorizados (cache eviction, moderation hide)
 * estão fora de escopo deste teste — somente INSERT é gated.
 *
 * Falha = violação direta de invariant §1. Se a regra mudar, atualizar
 * CLAUDE.md primeiro e este teste depois.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const DOMAIN_TABLES = ['posts', 'spreads', 'buries', 'reports'] as const

describe('CLAUDE.md invariant §1: onNostrEvent é a única porta de INSERT em domínio', () => {
  it.each(DOMAIN_TABLES)(
    'INSERT INTO %s aparece apenas em src/lib/events.ts',
    async (table) => {
      const fg = await import('fast-glob')
      const files = await fg.default('src/**/*.ts', { cwd: ROOT, onlyFiles: true })

      // Match: INSERT [OR IGNORE|OR REPLACE] INTO <table>
      // Case-insensitive, multi-line tolerant (whitespace inclui \n).
      const pattern = new RegExp(
        String.raw`INSERT\s+(?:OR\s+(?:IGNORE|REPLACE)\s+)?INTO\s+${table}\b`,
        'is',
      )

      const offenders: { file: string; line: number; text: string }[] = []

      for (const rel of files) {
        const norm = rel.replace(/\\/g, '/')
        if (norm === 'src/lib/events.ts') continue
        const raw = readFileSync(join(ROOT, rel), 'utf8')
        const stripped = stripComments(raw)
        if (!pattern.test(stripped)) continue
        // Localiza linha pra mensagem de erro (best-effort sobre o source
        // já sem comentários — line numbers podem deslocar levemente vs
        // arquivo original, mas o path basta para o desenvolvedor agir).
        const lines = stripped.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            offenders.push({
              file: norm,
              line: i + 1,
              text: lines[i].trim().slice(0, 120),
            })
          }
        }
        // Cobre o caso multi-line (INSERT em uma linha, INTO em outra):
        // se o pattern bate no source agregado mas não em nenhuma linha,
        // ainda reportamos o arquivo.
        if (!offenders.some((o) => o.file === norm)) {
          offenders.push({ file: norm, line: 0, text: '(multi-line match)' })
        }
      }

      expect(
        offenders,
        `Violação invariant §1 do CLAUDE.md: INSERT em tabela de domínio (${table}) ` +
          `fora de src/lib/events.ts. Apenas onNostrEvent() pode inserir em ` +
          `posts/spreads/buries/reports.\n` +
          offenders.map((o) => `  Arquivo: ${o.file}, linha: ${o.line} — ${o.text}`).join('\n'),
      ).toEqual([])
    },
  )
})
