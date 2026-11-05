/**
 * ABA CONTÁGIO — E2E (manifesto §24 emendado; Docs/algoritmos.md §9).
 *
 * Dirige o app real (Vite dev + `?dev-seed=lite&as=<nome>`) e confere a aba
 * contra um oráculo INDEPENDENTE escrito em SQL sobre `window.__driftDb` —
 * não reusa `src/lib/contagion.ts`, então um erro de regra no núcleo não se
 * auto-confirma aqui.
 *
 * Seed (src/lib/dev-seed/fixtures.ts): Alice não segue ninguém; Bob segue
 * só Alice e impulsionou o post dela na cascata (vínculo conquistado, 0,8);
 * Carol segue Bob e Frank; Dave segue Carol.
 *
 * Vizinhos (regra E2E 100% + blast radius): as outras abas seguem
 * funcionando e a ordem dentro da aba é a do feed global.
 */

import { test, expect, type Page } from '@playwright/test'
import { setupUser } from './fixtures/users'

const HOUR = 3600

async function sql<R>(page: Page, query: string, params: unknown[] = []): Promise<R[]> {
  return page.evaluate(
    async ({ query, params }) => {
      const w = window as unknown as { __driftDb?: { exec: (s: string, p?: unknown[]) => Promise<unknown[]> } }
      if (!w.__driftDb) throw new Error('window.__driftDb ausente — dev-seed não ativo?')
      return w.__driftDb.exec(query, params)
    },
    { query, params },
  ) as Promise<R[]>
}

async function openTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole('tab', { name: label })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  // a aba carrega via refreshFeed (assíncrono): espera o store marcar loaded
  await page.waitForFunction(async () => {
    const f = await import('/src/lib/feed.ts')
    return f.useFeedStore.getState().loaded === true
  })
}

/** Ids da aba ATIVA, como o app os tem (store real do feed). */
async function tabIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const f = await import('/src/lib/feed.ts')
    return f.useFeedStore.getState().posts.map((p: { id: string }) => p.id)
  })
}

async function viewer(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const id = await import('/src/lib/identity.ts')
    return (await id.getCurrentNpub()) as string
  })
}

async function follows(page: Page, who: string): Promise<string[]> {
  const rows = await sql<{ p: string }>(page, `SELECT following_pub AS p FROM follows WHERE follower_pub = ?`, [who])
  return rows.map((r) => r.p)
}

test.describe('aba Contágio', () => {
  test('1. Alice não segue ninguém: a aba fica vazia e explica por quê', async ({ browser }) => {
    const alice = await setupUser(browser, 'alice')
    try {
      expect(await follows(alice.page, await viewer(alice.page))).toEqual([])
      await openTab(alice.page, 'contágio')
      expect(await tabIds(alice.page)).toEqual([])
      await expect(alice.page.getByText(/Nada chegou pela sua rede ainda/)).toBeVisible()
    } finally {
      await alice.context.close()
    }
  })

  test('2. Bob (segue só Alice, vínculo conquistado): a aba é exatamente o que chegou pela Alice, na ordem do global', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      const me = await viewer(page)
      const fs = await follows(page, me)
      expect(fs, 'Bob segue só a Alice no seed').toHaveLength(1)
      const alice = fs[0]!
      // pré-condição do oráculo: Bob impulsionou algo da Alice (cascata) e não desfez
      const earned = await sql<{ n: number }>(
        page,
        `SELECT COUNT(*) AS n FROM spreads s JOIN posts p ON p.id = s.post_id
          WHERE s.spreader_pub = ? AND p.author_pub = ?
            AND NOT EXISTS (SELECT 1 FROM buries b WHERE b.post_id = s.post_id AND b.burier_pub = s.spreader_pub AND b.created_at > s.created_at)`,
        [me, alice],
      )
      expect(earned[0]!.n, 'Bob tem vínculo conquistado com a Alice').toBeGreaterThan(0)

      await openTab(page, 'contágio')
      const now = Math.floor(Date.now() / 1000)
      // Oráculo: posts recentes da Alice (≤ 72 h) + o que a Alice impulsionou
      // (≤ 48 h, sem SINK posterior dela), menos moderados e os do próprio Bob.
      const expected = await sql<{ id: string }>(
        page,
        `SELECT p.id FROM posts p
          WHERE p.score > -999 AND p.author_pub != ?
            AND ( (p.author_pub = ? AND p.created_at >= ?)
               OR p.id IN (SELECT s.post_id FROM spreads s
                            WHERE s.spreader_pub = ? AND s.created_at >= ?
                              AND NOT EXISTS (SELECT 1 FROM buries b WHERE b.post_id = s.post_id
                                                AND b.burier_pub = s.spreader_pub AND b.created_at >= s.created_at)) )`,
        [me, alice, now - 72 * HOUR, alice, now - 48 * HOUR],
      )
      const ids = await tabIds(page)
      const exp = new Set(expected.map((r) => r.id))
      for (const id of ids) expect(exp.has(id), `post ${id.slice(0, 8)} na aba sem ter vindo da Alice`).toBe(true)
      // a aba carrega no máximo FEED_INITIAL_LIMIT (50) de uma vez
      expect(ids.length, 'faltou post que chegou pela Alice').toBe(Math.min(exp.size, 50))

      // ordem canônica: a mesma ordem relativa do feed global
      const global = await page.evaluate(async () => {
        const f = await import('/src/lib/feed.ts')
        return (await f.getGlobalFeed(2000)).map((p: { id: string }) => p.id)
      })
      expect(ids).toEqual(global.filter((id: string) => ids.includes(id)))
    } finally {
      await bob.context.close()
    }
  })

  test('3. Carol e Dave: todo post da aba chegou pela rede de quem lê', async ({ browser }) => {
    for (const name of ['carol', 'dave']) {
      const s = await setupUser(browser, name)
      try {
        const me = await viewer(s.page)
        const fs = new Set(await follows(s.page, me))
        await openTab(s.page, 'contágio')
        const now = Math.floor(Date.now() / 1000)
        for (const id of await tabIds(s.page)) {
          const [post] = await sql<{ author: string; created_at: number }>(s.page, `SELECT author_pub AS author, created_at FROM posts WHERE id = ?`, [id])
          expect(post!.author, `${name}: post próprio na aba`).not.toBe(me)
          const spreaders = await sql<{ p: string }>(s.page, `SELECT spreader_pub AS p FROM spreads WHERE post_id = ? AND created_at >= ?`, [id, now - 48 * HOUR])
          const viaRede = (fs.has(post!.author) && post!.created_at >= now - 72 * HOUR) || spreaders.some((r) => fs.has(r.p))
          expect(viaRede, `${name}: post ${id.slice(0, 8)} não veio de quem ${name} segue`).toBe(true)
        }
      } finally {
        await s.context.close()
      }
    }
  })

  test('4. SINK pela interface (tecla j) grava a experiência ruim local', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      await openTab(page, 'contágio')
      const ids = await tabIds(page)
      test.skip(ids.length === 0, 'aba do Bob vazia neste boot — sem card para enterrar')
      const first = ids[0]!
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('j')
      await expect
        .poll(async () => (await sql<{ n: number }>(page, `SELECT COUNT(*) AS n FROM contagion_strikes WHERE post_id = ?`, [first]))[0]!.n, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0)
      // nada disto é publicado: experiência ruim é estado local (§28)
      const author = (await sql<{ a: string }>(page, `SELECT author_pub AS a FROM posts WHERE id = ?`, [first]))[0]!.a
      const rows = await sql<{ s: string }>(page, `SELECT subject_pub AS s FROM contagion_strikes WHERE post_id = ?`, [first])
      expect(rows.map((r) => r.s)).toContain(author)
    } finally {
      await bob.context.close()
    }
  })

  test('5. vizinhos: as 4 abas trocam sem quebrar e a global não depende do leitor', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      await openTab(page, 'global')
      const before = await tabIds(page)
      for (const label of ['seguindo', 'em alta', 'contágio', 'global']) await openTab(page, label)
      expect(await tabIds(page), 'trocar de aba não mexe no global').toEqual(before)
    } finally {
      await bob.context.close()
    }
  })
})
