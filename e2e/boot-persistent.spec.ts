/**
 * Boot com OPFS em disco (perfil persistente) — regressão de 2026-11-05.
 *
 * Os outros specs usam contexto efêmero, em que o OPFS fica em memória e
 * cada transação é instantânea. Num navegador de verdade cada transação
 * cria, sincroniza e apaga o journal em disco (~100 ms no Windows): com o
 * schema em transações avulsas e a reconstrução de domínio rodando à toa
 * em banco novo, o primeiro boot passava de 15 s, o prazo do init matava o
 * worker no meio e o próximo boot refazia tudo (laço; o user viu
 * SQLITE_IOERR). Aqui o perfil é persistente para o OPFS ir ao disco.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'

const URL = 'http://localhost:5173/?dev-seed=lite'

async function persistent(dir: string): Promise<{ ctx: BrowserContext; page: Page; logs: string[] }> {
  const ctx = await chromium.launchPersistentContext(dir, { headless: true })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  return { ctx, page, logs }
}

async function bootResult(page: Page): Promise<'ok' | string> {
  await page.waitForFunction(
    () =>
      (!!(window as unknown as { __driftSeedMeta?: { drained?: boolean } }).__driftSeedMeta?.drained &&
        !!(window as unknown as { __driftDb?: unknown }).__driftDb) ||
      /BOOTSTRAP INTERROMPIDO|já está aberto em outra aba/i.test(document.body.innerText),
    null,
    { timeout: 90_000 },
  )
  const text = await page.evaluate(() => document.body.innerText)
  return /BOOTSTRAP INTERROMPIDO|já está aberto em outra aba/i.test(text) ? text.slice(0, 400) : 'ok'
}

async function exec<T>(page: Page, sql: string): Promise<T[]> {
  return page.evaluate(
    (q) => (window as unknown as { __driftDb: { exec: (s: string) => Promise<unknown[]> } }).__driftDb.exec(q),
    sql,
  ) as Promise<T[]>
}

test.describe('boot com OPFS em disco', () => {
  test.setTimeout(180_000)

  test('1. primeiro acesso: o SQLite abre em poucos segundos, sem reconstrução à toa', async ({}, info) => {
    const { ctx, page, logs } = await persistent(info.outputPath('perfil'))
    try {
      const t0 = Date.now()
      let schemaAt = 0
      page.on('console', (m) => {
        if (!schemaAt && m.text().includes('schema aplicado com sucesso')) schemaAt = Date.now() - t0
      })
      await page.goto(URL)
      expect(await bootResult(page)).toBe('ok')
      expect(schemaAt, 'schema aplicado').toBeGreaterThan(0)
      // Antes: 5–8 s só no schema, mais 8–10 s de reconstrução. Folga larga
      // para máquina lenta de CI; o que importa é ficar longe do prazo.
      expect(schemaAt, 'schema bem abaixo do prazo do init').toBeLessThan(10_000)
      expect(logs.some((l) => l.includes('nada a converter')), 'banco novo não reconstrói').toBe(true)
      expect(logs.some((l) => l.includes('reconstruindo schema de domínio')), 'sem rebuild').toBe(false)
    } finally {
      await ctx.close()
    }
  })

  test('2. atualização: banco no schema anterior ganha tabelas, índices e coluna novos', async ({}, info) => {
    const { ctx, page } = await persistent(info.outputPath('perfil'))
    try {
      await page.goto(URL)
      expect(await bootResult(page)).toBe('ok')
      // rebaixa para o schema de main (09b98f2)
      await page.evaluate(async () => {
        const db = (window as unknown as { __driftDb: { run: (s: string) => Promise<void> } }).__driftDb
        for (const sql of [
          'DROP TABLE IF EXISTS contagion_no_bring',
          'DROP TABLE IF EXISTS contagion_bad_experiences',
          'DROP INDEX IF EXISTS idx_spreads_spreader',
          'DROP INDEX IF EXISTS idx_buries_burier',
          'DROP INDEX IF EXISTS idx_reports_reporter',
          'ALTER TABLE reports DROP COLUMN target_pub',
        ]) await db.run(sql)
      })
      await page.reload()
      expect(await bootResult(page)).toBe('ok')
      const objs = await exec<{ name: string }>(
        page,
        `SELECT name FROM sqlite_master WHERE name IN ('contagion_no_bring','contagion_bad_experiences',
           'idx_spreads_spreader','idx_buries_burier','idx_reports_reporter') ORDER BY name`,
      )
      expect(objs.map((o) => o.name)).toEqual([
        'contagion_bad_experiences',
        'contagion_no_bring',
        'idx_buries_burier',
        'idx_reports_reporter',
        'idx_spreads_spreader',
      ])
      const col = await exec<{ name: string }>(page, `SELECT name FROM pragma_table_info('reports') WHERE name = 'target_pub'`)
      expect(col).toHaveLength(1)
      // os dados de antes continuam lá (atualização não apaga nada)
      const [{ n }] = await exec<{ n: number }>(page, 'SELECT COUNT(*) AS n FROM posts')
      expect(n).toBeGreaterThan(0)
    } finally {
      await ctx.close()
    }
  })

  // smoke: com o schema em ~0,1 s, a recarga quase sempre cai depois dele;
  // o caso de matar no meio de trabalho pesado é o teste 5
  test('3. recarregar no meio do boot não trava o próximo', async ({}, info) => {
    const { ctx, page } = await persistent(info.outputPath('perfil'))
    try {
      const opened = page.waitForEvent('console', { predicate: (m) => m.text().includes('banco aberto'), timeout: 60_000 })
      await page.goto(URL)
      await opened
      await page.reload() // mata o worker com o schema em andamento
      expect(await bootResult(page)).toBe('ok')
    } finally {
      await ctx.close()
    }
  })

  test('5. banco grande: índice novo um por um, com progresso; recarregar no meio não volta à estaca zero', async ({}, info) => {
    // revisão Barney+Satoshi: com o schema todo numa transação e o worker
    // morto no prazo, celular lento com banco grande entraria em laço
    const { ctx, page, logs } = await persistent(info.outputPath('perfil'))
    try {
      await page.goto(URL)
      expect(await bootResult(page)).toBe('ok')
      await page.evaluate(async () => {
        const db = (window as unknown as { __driftDb: { run: (s: string) => Promise<void> } }).__driftDb
        await db.run(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 150000)
          INSERT OR IGNORE INTO spreads(post_id, spreader_pub, created_at, event_id, raw_event)
          SELECT printf('p%06d', x % 20000), printf('%064x', x), 1790000000 + x, printf('s%010d', x),
                 printf('{"id":"s%010d","pad":"%s"}', x, hex(randomblob(120))) FROM c`)
        for (const ix of ['idx_spreads_spreader', 'idx_buries_burier', 'idx_reports_reporter']) await db.run(`DROP INDEX IF EXISTS ${ix}`)
      })
      // atualização: o boot cria os índices que faltam, um por um, com log
      const creating = page.waitForEvent('console', {
        predicate: (m) => m.text().includes('criando índice idx_spreads_spreader'),
        timeout: 60_000,
      })
      await page.reload()
      await creating
      await page.reload() // mata o worker no meio do trabalho pesado
      expect(await bootResult(page)).toBe('ok')
      const ixs = await exec<{ name: string }>(
        page,
        `SELECT name FROM sqlite_master WHERE type = 'index'
           AND name IN ('idx_spreads_spreader','idx_buries_burier','idx_reports_reporter') ORDER BY name`,
      )
      expect(ixs.map((i) => i.name)).toEqual(['idx_buries_burier', 'idx_reports_reporter', 'idx_spreads_spreader'])
      const [{ n }] = await exec<{ n: number }>(page, 'SELECT COUNT(*) AS n FROM spreads')
      expect(n, 'nada se perdeu com a recarga no meio').toBeGreaterThanOrEqual(150_000)
      expect(logs.some((l) => /IOERR|disk I\/O|sem dar sinal|levou mais de/.test(l)), 'sem erro de E/S nem prazo').toBe(false)
    } finally {
      await ctx.close()
    }
  })

  test('4. vizinho: segunda aba no mesmo perfil abre normalmente', async ({}, info) => {
    const { ctx, page } = await persistent(info.outputPath('perfil'))
    try {
      await page.goto(URL)
      expect(await bootResult(page)).toBe('ok')
      const second = await ctx.newPage()
      await second.goto(URL)
      expect(await bootResult(second)).toBe('ok')
    } finally {
      await ctx.close()
    }
  })
})
