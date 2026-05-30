/**
 * EVIDÊNCIA — mapa NETWORK funciona (user 2026-05-30: "quero evidências de
 * que o mapa network funciona"). Sprint N+6.
 *
 * O mapa network (useSpreadMap mode='network') mostra SÓ os spreads de quem
 * o user ativo SEGUE (NIP-02), filtrados geograficamente. Manifesto §24: é
 * lente local — recorte do agregado global pela lista de follows, NÃO um
 * ranking personalizado. A query canônica (useSpreadMap.ts):
 *
 *   SELECT ... FROM spreads s JOIN posts p ON s.post_id = p.id
 *   WHERE s.location IS NOT NULL AND p.location IS NOT NULL
 *     AND s.spreader_pub IN (SELECT following_pub FROM follows WHERE follower_pub = ?)
 *
 * Boota `grace` (segue alice/bob/carol no seed). Roda a query REAL contra o
 * SQLite materializado e prova:
 *   1. follows de grace = exatamente {alice, bob, carol} (contact list NIP-02
 *      aplicada no boot).
 *   2. TODO spreader no resultado network ∈ follows de grace (filtro §24).
 *   3. network ⊊ global — é subconjunto ESTRITO (existem spreads de
 *      não-seguidos que o global mostra e o network esconde).
 *   4. NEGATIVO: dave (NÃO seguido por grace) tem spreads com geo no global,
 *      mas ZERO no network de grace.
 *
 * Sandbox NÃO roda Playwright. Manual:
 *   npx playwright test e2e/network-map.spec.ts
 */

import { test, expect } from '@playwright/test'
import { setupUser, waitSeedSettled } from './fixtures/users'
import { NAMED_BY_NAME } from '../src/lib/dev-seed/fixtures'

interface ArcRow {
  post_id: string
  spreader_pub: string
}

async function dbExec<T>(
  page: import('@playwright/test').Page,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return page.evaluate(
    async ({ sql, params }) => {
      const w = window as unknown as {
        __driftDb?: { exec: <R>(sql: string, params?: unknown[]) => Promise<R[]> }
      }
      if (!w.__driftDb) throw new Error('window.__driftDb ausente — dev-seed não ativo?')
      return w.__driftDb.exec(sql, params)
    },
    { sql, params },
  ) as Promise<T[]>
}

// Query NETWORK canônica (espelha useSpreadMap.ts fetchNetworkSpreadMap).
const NETWORK_SQL = `
  SELECT s.post_id AS post_id, s.spreader_pub AS spreader_pub
  FROM spreads s
  JOIN posts p ON s.post_id = p.id
  WHERE s.location IS NOT NULL
    AND p.location IS NOT NULL
    AND s.spreader_pub IN (
      SELECT following_pub FROM follows WHERE follower_pub = ?
    )
  ORDER BY s.created_at ASC
  LIMIT 2000`

// Query GLOBAL (mesma agregação SEM o filtro de follows).
const GLOBAL_SQL = `
  SELECT s.post_id AS post_id, s.spreader_pub AS spreader_pub
  FROM spreads s
  JOIN posts p ON s.post_id = p.id
  WHERE s.location IS NOT NULL AND p.location IS NOT NULL
  ORDER BY s.created_at ASC
  LIMIT 2000`

const ALICE = NAMED_BY_NAME.alice!.pub
const BOB = NAMED_BY_NAME.bob!.pub
const CAROL = NAMED_BY_NAME.carol!.pub
const DAVE = NAMED_BY_NAME.dave!.pub

test.describe('mapa NETWORK — filtro §24 por follows (evidência)', () => {
  test('1. follows de grace = {alice, bob, carol} (contact list NIP-02 aplicada)', async ({
    browser,
  }) => {
    const grace = await setupUser(browser, 'grace')
    try {
      await waitSeedSettled(grace.page)
      const rows = await dbExec<{ following_pub: string }>(
        grace.page,
        `SELECT following_pub FROM follows WHERE follower_pub = ?`,
        [NAMED_BY_NAME.grace!.pub],
      )
      const got = new Set(rows.map((r) => r.following_pub))
      expect(got.has(ALICE), 'grace segue alice').toBe(true)
      expect(got.has(BOB), 'grace segue bob').toBe(true)
      expect(got.has(CAROL), 'grace segue carol').toBe(true)
      expect(got.has(DAVE), 'grace NÃO segue dave').toBe(false)
    } finally {
      await grace.context.close()
    }
  })

  test('2. TODO spreader no network ∈ follows de grace + não-vazio', async ({ browser }) => {
    const grace = await setupUser(browser, 'grace')
    try {
      await waitSeedSettled(grace.page)
      const net = await dbExec<ArcRow>(grace.page, NETWORK_SQL, [NAMED_BY_NAME.grace!.pub])
      // Não-vazio: alice/carol (geo on) espalharam posts com geo → grace vê.
      expect(net.length, 'network de grace deve ter ≥1 arco').toBeGreaterThan(0)
      // Filtro §24: NENHUM spreader fora dos follows de grace.
      const allowed = new Set([ALICE, BOB, CAROL])
      const leaked = net.filter((r) => !allowed.has(r.spreader_pub))
      expect(
        leaked.map((r) => r.spreader_pub.slice(0, 8)),
        'spreaders no network que NÃO são seguidos por grace (vazamento §24)',
      ).toEqual([])
    } finally {
      await grace.context.close()
    }
  })

  test('3. network ⊊ global — subconjunto ESTRITO (filtro realmente restringe)', async ({
    browser,
  }) => {
    const grace = await setupUser(browser, 'grace')
    try {
      await waitSeedSettled(grace.page)
      const net = await dbExec<ArcRow>(grace.page, NETWORK_SQL, [NAMED_BY_NAME.grace!.pub])
      const global = await dbExec<ArcRow>(grace.page, GLOBAL_SQL)
      // global tem MAIS arcos (há spreads de não-seguidos) → network restringe.
      expect(
        net.length,
        `network (${net.length}) deve ser < global (${global.length}) — senão o filtro não restringe`,
      ).toBeLessThan(global.length)
      // E network ⊆ global: todo spreader do network também aparece no global.
      const globalSpreaders = new Set(global.map((r) => r.spreader_pub))
      for (const r of net) {
        expect(globalSpreaders.has(r.spreader_pub)).toBe(true)
      }
    } finally {
      await grace.context.close()
    }
  })

  test('4. NEGATIVO: dave (não seguido) aparece no global, some do network de grace', async ({
    browser,
  }) => {
    const grace = await setupUser(browser, 'grace')
    try {
      await waitSeedSettled(grace.page)
      const global = await dbExec<ArcRow>(grace.page, GLOBAL_SQL)
      const net = await dbExec<ArcRow>(grace.page, NETWORK_SQL, [NAMED_BY_NAME.grace!.pub])
      const daveInGlobal = global.some((r) => r.spreader_pub === DAVE)
      const daveInNet = net.some((r) => r.spreader_pub === DAVE)
      // dave (geo on, Rio) espalha com geo → está no global agregado.
      expect(daveInGlobal, 'dave deve ter spreads com geo no global').toBe(true)
      // mas grace não segue dave → some do network dela.
      expect(daveInNet, 'dave NÃO pode aparecer no network de grace (§24)').toBe(false)
    } finally {
      await grace.context.close()
    }
  })
})
