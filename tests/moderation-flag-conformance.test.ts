/**
 * D4 — "moderado" deixa de ser codificado como `score = -999`.
 *
 * O defeito não era um valor errado, era um TIPO errado. Usar um número
 * como flag significa que qualquer valor que por acaso caia naquela
 * faixa vira censura:
 *
 *   - Com `buryWeight >= 9419` (≈95 pessoas de peso máximo, ou ≈157 de
 *     peso 60) um post LEGÍTIMO atravessava o sentinela e sumia do feed
 *     exatamente como se tivesse sido reportado, contornando todo o
 *     threshold dinâmico do §26. Censura por brigada, sem report.
 *   - `cache.ts` evicta por `score ASC`, então essas vítimas eram as
 *     PRIMEIRAS a serem apagadas do disco — o oposto do invariante #13.
 *   - Violava §23: enterrar deve fazer o post DESCER por gravidade, não
 *     sumir abruptamente ao cruzar uma linha arbitrária.
 *
 * Agora `posts.moderated` e `comments.moderated` são flags explícitas e
 * o score voltou a ser só ranking, livre pra ser tão negativo quanto os
 * buries mandarem.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateScore } from '../src/lib/scoring'
import { MODERATED_SCORE } from '../src/config/constants'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Remove comentários pra que as asserções olhem só código executável. */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')
}

describe('O alcance do defeito era real', () => {
  it('95 buriers de peso máximo bastavam pra atravessar o sentinela', () => {
    // Ataque: nenhum spread, só buries de peso 100, post recém-publicado.
    const score = calculateScore({
      spreadWeight: 0,
      buryWeight: 95 * 100,
      createdAt: 0,
      now: 0,
    })
    expect(score).toBeLessThan(MODERATED_SCORE)
    // Era isso que o filtro antigo (`score > -999`) escondia do feed.
    expect(score > MODERATED_SCORE).toBe(false)
  })

  it('o score segue livre pra ser muito negativo — e isso é correto', () => {
    // §23: enterrar faz descer, não sumir. Nenhum piso artificial.
    const afundado = calculateScore({
      spreadWeight: 0,
      buryWeight: 50_000,
      createdAt: 0,
      now: 0,
    })
    expect(afundado).toBeLessThan(-5000)
    expect(Number.isFinite(afundado)).toBe(true)
  })
})

describe('Moderação escreve flag, não score', () => {
  it('moderation.ts faz UPDATE posts SET moderated = 1', () => {
    expect(read('src/lib/moderation.ts')).toMatch(/UPDATE\s+posts\s+SET\s+moderated\s*=\s*1/i)
  })

  it('nenhum arquivo de produção volta a escrever -999 no score', () => {
    for (const f of ['src/lib/moderation.ts', 'src/lib/events.ts', 'src/lib/feed.ts']) {
      expect(codeOnly(read(f)), `${f} escreve -999 no score`).not.toMatch(
        /SET\s+score\s*=\s*-999/i,
      )
    }
  })
})

describe('Toda leitura filtra pela flag, nunca pelo score', () => {
  const LEITORES: Array<[string, number]> = [
    ['src/lib/feed.ts', 3], // global, seguindo, em alta
    ['src/lib/probe.ts', 1],
    ['src/lib/comment-counts.ts', 2],
  ]

  for (const [arquivo, esperado] of LEITORES) {
    it(`${arquivo} usa moderated = 0 (${esperado}x)`, () => {
      const code = codeOnly(read(arquivo))
      const usos = code.match(/moderated\s*=\s*0/g) ?? []
      expect(usos.length, `esperava ${esperado} filtros por flag`).toBe(esperado)
      // O filtro antigo não pode sobreviver em lugar nenhum: ele é o
      // canal de censura.
      expect(code, 'filtro por score reintroduz a censura por brigada').not.toMatch(
        /score\s*>\s*-999/,
      )
    })
  }

  it('reports_confirmed conta a flag, não a igualdade com -999', () => {
    for (const f of ['src/lib/weight.ts', 'src/lib/events.ts']) {
      const code = codeOnly(read(f))
      expect(code, `${f} deve contar moderated = 1`).toMatch(/moderated\s*=\s*1/)
      expect(code, `${f} ainda compara score com -999`).not.toMatch(/score\s*=\s*-999/)
    }
  })

  it('buildThread filtra pela flag', () => {
    expect(codeOnly(read('src/lib/comments.ts'))).toMatch(/filter\(\(r\) => !r\.moderated\)/)
  })
})

describe('Migração preserva o estado dos já moderados', () => {
  it('a coluna nova tem backfill a partir do sentinela antigo', () => {
    const worker = read('src/lib/db.worker.ts')
    // Igualdade exata, nao `<=`: `moderation.ts` sempre gravava o literal
    // -999. Quem esta abaixo disso chegou la por acumulo de bury, e marcar
    // essa vitima como moderada perpetuaria justamente a censura que o D4
    // existe pra desfazer.
    expect(worker).toMatch(/UPDATE posts SET moderated = 1 WHERE score = -999/)
    expect(worker).toMatch(/UPDATE comments SET moderated = 1 WHERE score = -999/)
  })

  it('o backfill só roda quando o ALTER acontece', () => {
    const worker = read('src/lib/db.worker.ts')
    // Um backfill re-executado em boot subsequente poderia sobrescrever
    // estado legítimo posterior (ex.: post des-moderado manualmente).
    const bloco = worker.match(/db\.exec\(m\.sql\)[\s\S]{0,800}?catch/)
    expect(bloco, 'executor de migração não encontrado').toBeTruthy()
    expect(bloco![0], 'backfill deve estar dentro do branch do ALTER').toMatch(
      /if \(m\.backfill\)/,
    )
  })

  it('ambas as tabelas declaram a coluna com default seguro', () => {
    const schema = read('src/lib/schema.sql')
    const decls = schema.match(/moderated\s+INTEGER NOT NULL DEFAULT 0/g) ?? []
    expect(decls.length, 'posts e comments devem declarar moderated').toBe(2)
  })
})
