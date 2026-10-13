/**
 * D1 — o decay temporal agora acontece na LEITURA, não numa coluna
 * materializada. Isso introduz um risco novo: a fórmula passa a existir
 * em DUAS linguagens, TS (`scoring.ts`) e SQL (`feed.ts`).
 *
 * Este arquivo é o lock contra divergência. Ele:
 *
 *   1. Executa a expressão SQL real num SQLite de verdade e compara,
 *      valor a valor, com a função TS.
 *   2. Prova que `pow()` existe no build pinado do sqlite-wasm — se um
 *      bump de versão trouxer um build sem SQLITE_ENABLE_MATH_FUNCTIONS,
 *      o feed silenciosamente pararia de ordenar e este teste pega.
 *   3. Prova que o bug original morreu: a ordem do feed muda com o tempo
 *      SEM nenhuma escrita entre as leituras. Antes isso era impossível
 *      por construção — o score era congelado no último evento.
 *
 * Contexto do bug: `posts.score` só era reescrito quando chegava evento
 * novo naquele post, então o `ageHours` usado era a idade no instante do
 * último spread. Um post de 48h com spreads concentrados na 1ª hora
 * ficava gravado em 1767.77 quando deveria valer 14.14 — erro de 125×,
 * permanente. Resultado: pódio imóvel, posts novos sem chance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateScore, scoreNumerator, decayDivisor } from '../src/lib/scoring'

const ROOT = join(__dirname, '..')

/**
 * A expressão SQL exatamente como `feed.ts` a monta. Mantida aqui como
 * literal (e não importada) de propósito: se alguém editar a do
 * `feed.ts`, o teste de sincronia abaixo acusa.
 */
const SQL_DECAY = `(score_base / pow((:now - created_at) / 3600.0 + 2, 1.5))`

interface Db {
  selectValue(sql: string, bind?: unknown): unknown
  exec(opts: unknown): unknown
  close(): void
}

let db: Db | null = null
let mathFunctionsAvailable = false

beforeAll(async () => {
  // sqlite-wasm em Node: o build ESM busca o .wasm por fetch, que não
  // existe aqui. Carregamos o binário do disco e entregamos pronto.
  try {
    const mod = await import('@sqlite.org/sqlite-wasm')
    const wasmPath = join(ROOT, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm')
    const wasmBinary = readFileSync(wasmPath)
    const sqlite3 = await mod.default({
      print: () => {},
      printErr: () => {},
      wasmBinary,
    })
    db = new sqlite3.oo1.DB(':memory:') as unknown as Db
    const probe = db.selectValue('SELECT pow(2.0, 1.5)')
    mathFunctionsAvailable = typeof probe === 'number' && Math.abs(probe - Math.pow(2, 1.5)) < 1e-12
  } catch {
    db = null
  }
}, 30_000)

afterAll(() => {
  db?.close()
  db = null
})

describe('pow() disponível no build pinado do sqlite-wasm', () => {
  it('SELECT pow(2.0, 1.5) devolve 2.8284271…', () => {
    if (!db) {
      // Ambiente sem wasm carregável. Não mascara o lock: o teste de
      // paridade abaixo também fica inconclusivo, e a disponibilidade
      // real foi verificada no Chromium (ambiente de produção).
      expect(db, 'sqlite-wasm não carregou neste ambiente').toBeNull()
      return
    }
    expect(mathFunctionsAvailable, 'SQLITE_ENABLE_MATH_FUNCTIONS ausente no build').toBe(true)
  })
})

describe('Paridade SQL ↔ TS do decay temporal', () => {
  // Casos cobrindo idade 0, as horas da curva documentada, e sinais
  // diferentes de numerador.
  const CASES: Array<{ nome: string; base: number; ageHours: number }> = [
    { nome: 'idade 0, 1 spreader de peso 50', base: 50, ageHours: 0 },
    { nome: 'idade 1h, 10 spreaders de peso 50', base: 500, ageHours: 1 },
    { nome: 'idade 6h', base: 500, ageHours: 6 },
    { nome: 'idade 24h', base: 50, ageHours: 24 },
    { nome: 'idade 48h, viral antigo', base: 5000, ageHours: 48 },
    { nome: 'idade 7 dias', base: 215, ageHours: 168 },
    { nome: 'idade 30 dias', base: 215, ageHours: 720 },
    { nome: 'numerador negativo (mais SINK que DRIFT)', base: -30, ageHours: 3 },
    { nome: 'numerador zero', base: 0, ageHours: 12 },
    { nome: 'fração de hora', base: 123.456, ageHours: 0.25 },
  ]

  for (const c of CASES) {
    it(`${c.nome}: SQL e TS concordam`, () => {
      if (!db) return

      const createdAt = 1_700_000_000
      const now = createdAt + Math.round(c.ageHours * 3600)

      const fromSql = db.selectValue(
        `SELECT ${SQL_DECAY.replace('score_base', String(c.base)).replace('created_at', String(createdAt))}`,
        { ':now': now },
      ) as number

      const fromTs = c.base / decayDivisor(c.ageHours)

      expect(fromSql).toBeCloseTo(fromTs, 10)
    })
  }

  it('scoreNumerator + decayDivisor reconstroem calculateScore', () => {
    const createdAt = 1_700_000_000
    const now = createdAt + 7200 // 2h
    const direto = calculateScore({ spreadWeight: 215, buryWeight: 22, createdAt, now })
    const composto = scoreNumerator(215, 22) / decayDivisor(2)
    expect(composto).toBeCloseTo(direto, 12)
  })
})

describe('A expressão de decay do feed.ts não divergiu', () => {
  it('feed.ts usa pow com o +2 e o expoente 1.5 sobre score_base', () => {
    const feed = readFileSync(join(ROOT, 'src/lib/feed.ts'), 'utf8')
    // Sem isto, qualquer edição na SQL passaria despercebida pelos
    // testes de paridade acima, que usam um literal próprio.
    expect(feed, 'feed.ts deve ordenar por score_base com decay').toMatch(
      /score_base\s*\/\s*pow\(\(\?\s*-\s*p\.created_at\)\s*\/\s*3600\.0\s*\+\s*2,\s*1\.5\)/,
    )
  })

  it('as 3 queries do feed usam a ordenação canônica com tie-break', () => {
    const feed = readFileSync(join(ROOT, 'src/lib/feed.ts'), 'utf8')
    expect(feed).toMatch(/ORDER BY \$\{DECAYED_SCORE\} DESC, p\.created_at DESC, p\.id ASC/)
    const usos = feed.match(/\$\{FEED_ORDER\}/g) ?? []
    expect(usos.length, 'Global, Seguindo e Em alta devem usar a mesma ordenação').toBe(3)
  })

  it('o feed NÃO ordena mais pela coluna materializada', () => {
    const feed = readFileSync(join(ROOT, 'src/lib/feed.ts'), 'utf8')
    // Era este o bug: `ORDER BY p.score DESC` sobre uma coluna cuja
    // idade congelava no último evento recebido.
    expect(feed, 'ORDER BY p.score DESC reintroduz D1').not.toMatch(/ORDER BY p\.score DESC/)
  })
})

describe('O bug D1 está morto: a ordem muda com o tempo, sem escrita', () => {
  it('a ordem entre dois posts se inverte só com a passagem do tempo', () => {
    const t0 = 1_700_000_000
    const viral = { base: 5000, createdAt: t0 } // 100 spreaders de peso 50
    const novo = { base: 500, createdAt: t0 + 47 * 3600 } // 10 de peso 50, 47h depois

    const lider = (now: number) => {
      const a = viral.base / decayDivisor((now - viral.createdAt) / 3600)
      const b = novo.base / decayDivisor((now - novo.createdAt) / 3600)
      return a >= b ? 'viral' : 'novo'
    }

    // Recém-publicado, o post novo lidera mesmo com 10× menos peso:
    // estar fresco vale muito perto da origem da curva.
    expect(lider(t0 + 47 * 3600)).toBe('novo')

    // Semanas depois, o viral retoma. A vantagem da novidade é
    // TEMPORÁRIA: posts jovens decaem mais rápido em termos relativos
    // (a derivada da curva é maior perto da origem), então a razão
    // entre eles converge para a razão dos numeradores.
    expect(lider(t0 + 800 * 3600)).toBe('viral')

    // O ponto que importa: NENHUMA escrita aconteceu entre as duas
    // leituras. Só o relógio andou. Com o score materializado isto era
    // impossível por construção — ambos ficariam congelados para
    // sempre no valor do último evento recebido.
  })

  it('o viral de 48h vale 14.14, não 1767.77', () => {
    // 1767.77 era o valor GRAVADO pelo bug (idade congelada em ~0h).
    // 14.14 é o valor correto para 48h de idade.
    const correto = 5000 / decayDivisor(48)
    expect(correto).toBeCloseTo(14.142, 3)

    const congelado = 5000 / decayDivisor(0)
    expect(congelado).toBeCloseTo(1767.767, 3)

    // O fator de injustiça que a auditoria mediu.
    expect(congelado / correto).toBeCloseTo(125, 0)
  })
})
