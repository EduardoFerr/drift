/**
 * LENTE NO FEED — E2E (manifesto §24; Docs/algoritmos.md §6).
 *
 * Dirige o app real (Vite dev + `?dev-seed=lite&as=<nome>`) e confere a
 * ordem das abas contra um ORÁCULO escrito aqui, a partir da regra
 * publicada (não importa `src/lib/lens/order.ts`): a lente adianta posts
 * de quem o leitor segue sem nenhuma experiência ruim com ele (uma denúncia
 * basta; calculado aqui em SQL), de até 7 dias, com score ≥ 0, no máximo 2
 * por pessoa (os de mais pontos); com força k, entre os primeiros p+1
 * lugares, pelo menos ⌊(p+1)·k/100⌋ são desses, na ordem de sempre; nunca
 * rebaixa um deles; a aba mantém o tamanho.
 *
 * A aba "de sempre" vem do SQL canônico do app (`getGlobalFeed` /
 * `getTrendingFeed`, travados por outros testes); a lente é o que se testa.
 *
 * Vizinhos (regra E2E 100% + raio de impacto): Seguindo e Contágio não
 * mudam com a lente ligada; a folha "chegou por" segue funcionando; a
 * escolha sobrevive a recarregar e a fechar o navegador (perfil
 * persistente — o boot foi tocado); a lente não grava nada no banco.
 *
 * Seed (src/lib/dev-seed/fixtures.ts): Carol segue Bob e Frank; Bob segue
 * só a Alice e já impulsionou um post dela (vínculo conquistado).
 */

import { test, expect, chromium, type Page } from '@playwright/test'
import { finalizeEvent } from 'nostr-tools/pure'
import { NAMED_BY_NAME } from '../src/lib/dev-seed/fixtures'
import { setupUser, waitSeedSettled } from './fixtures/users'

type Tab = 'global' | 'trending' | 'following' | 'contagio'
const TAB_LABEL: Record<Tab, string> = { global: 'global', trending: 'em alta', following: 'seguindo', contagio: 'contágio' }
const WIN = 50

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

async function viewer(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const id = await import('/src/lib/identity.ts')
    return (await id.getCurrentNpub()) as string
  })
}

/** Troca de aba pela UI e espera a store carregar a aba nova. */
async function openTab(page: Page, tab: Tab): Promise<void> {
  const el = page.getByRole('tab', { name: TAB_LABEL[tab] })
  await el.click()
  await expect(el).toHaveAttribute('aria-selected', 'true')
  await expect
    .poll(() => page.evaluate(async () => {
      const f = await import('/src/lib/feed.ts')
      const s = f.useFeedStore.getState()
      return s.loaded ? s.tab : null
    }), { timeout: 15_000 })
    .toBe(tab)
}

/** A aba como o app a tem (store real do feed). */
async function storePosts(page: Page): Promise<{ id: string; authorPub: string; createdAt: number; lensLift?: { from: number | null; to: number } }[]> {
  return page.evaluate(async () => {
    const f = await import('/src/lib/feed.ts')
    return f.useFeedStore.getState().posts.map((p: { id: string; authorPub: string; createdAt: number; lensLift?: { from: number | null; to: number } }) =>
      ({ id: p.id, authorPub: p.authorPub, createdAt: p.createdAt, lensLift: p.lensLift }))
  })
}
const tabIds = async (page: Page) => (await storePosts(page)).map((p) => p.id)

/** "Sua rede" pela regra pública (Docs/algoritmos.md §6), em SQL próprio:
 *  quem o leitor segue, sem ele, sem bloqueados e silenciados, e sem
 *  nenhuma experiência ruim (denúncia dele, ou quem trouxe na aba Contágio
 *  um post que ele denunciou). */
async function networkOf(page: Page, me: string): Promise<Set<string>> {
  const rows = await sql<{ p: string; earned: number; strikes: number }>(
    page,
    `SELECT f.following_pub AS p,
            (SELECT COUNT(*) FROM spreads s JOIN posts q ON q.id = s.post_id
              WHERE s.spreader_pub = ?1 AND q.author_pub = f.following_pub
                AND NOT EXISTS (SELECT 1 FROM buries b WHERE b.post_id = s.post_id
                                  AND b.burier_pub = s.spreader_pub AND b.created_at >= s.created_at)) AS earned,
            (SELECT COUNT(DISTINCT post_id) FROM (
               SELECT r.post_id AS post_id FROM reports r LEFT JOIN posts q ON q.id = r.post_id
                WHERE r.reporter_pub = ?1 AND COALESCE(q.author_pub, r.target_pub) = f.following_pub
               UNION
               SELECT post_id FROM contagion_bad_experiences WHERE viewer_pub = ?1 AND subject_pub = f.following_pub)) AS strikes
       FROM follows f
      WHERE f.follower_pub = ?1 AND f.following_pub != ?1
        AND f.following_pub NOT IN (SELECT npub FROM blocked)
        AND f.following_pub NOT IN (SELECT npub FROM muted)`,
    [me],
  )
  return new Set(rows.filter((r) => r.strikes === 0).map((r) => r.p))
}

/** Oráculo: a aba que a regra publicada manda mostrar com força k. */
async function oracle(page: Page, tab: 'global' | 'trending', k: number): Promise<string[]> {
  const { all, nowSec } = await page.evaluate(async (tab) => {
    const f = await import('/src/lib/feed.ts')
    const now = Date.now()
    const ps = tab === 'global' ? await f.getGlobalFeed(5000, now) : await f.getTrendingFeed(5000, now)
    return { nowSec: Math.floor(now / 1000), all: ps.map((p: { id: string; authorPub: string; score: number; createdAt: number }) => ({ id: p.id, a: p.authorPub, s: p.score, t: p.createdAt })) }
  }, tab)
  const tabList = all.slice(0, WIN)
  if (k === 0) return tabList.map((p) => p.id)
  const rede = await networkOf(page, await viewer(page))
  const inTab = new Map(tabList.map((p, i) => [p.id, i]))
  // escolhidos, pela regra publicada: posts da sua rede de até 7 dias, não
  // afundados, no máximo 2 por pessoa (os de mais pontos) — e SÓ ENTÃO os 50
  // primeiros (o limite da aba). A lista toda já vem na ordem canônica.
  const perAuthor = new Map<string, number>()
  const net = all
    .filter((p) => rede.has(p.a) && p.t >= nowSec - 7 * 86_400 && p.s >= 0)
    .filter((p) => { const n = perAuthor.get(p.a) ?? 0; perAuthor.set(p.a, n + 1); return n < 2 })
    .slice(0, WIN)
  const netIds = new Set(net.map((p) => p.id))
  const rest = tabList.filter((p) => !netIds.has(p.id))
  // Escrito como contagem (não como o laço do app): até o lugar p, quantos
  // escolhidos devem estar na tela? Pelo menos a cota ⌊(p+1)·k/100⌋, pelo
  // menos os escolhidos que já estavam na aba até p (nunca rebaixa), e todos
  // os que faltam quando o resto acaba. Nunca mais do que existem.
  const chosenInTabUpTo = (p: number) => net.filter((x) => (inTab.get(x.id) ?? Infinity) <= p).length
  const out: string[] = []
  let usedNet = 0
  let usedRest = 0
  for (let p = 0; p < tabList.length; p++) {
    const want = Math.min(net.length, Math.max(Math.floor(((p + 1) * k) / 100), chosenInTabUpTo(p)))
    const takeNet = usedNet < want || usedRest >= rest.length
    out.push(takeNet ? net[usedNet++]!.id : rest[usedRest++]!.id)
  }
  return out
}

/** A aba ativa bate com o oráculo (o relógio anda: confere de novo se mudar). */
async function expectTabMatchesOracle(page: Page, tab: 'global' | 'trending', k: number): Promise<void> {
  await expect
    .poll(async () => {
      await page.evaluate(async () => (await import('/src/lib/feed.ts')).refreshFeed())
      const got = await tabIds(page)
      const want = await oracle(page, tab, k)
      return JSON.stringify(got) === JSON.stringify(want) ? 'igual' : `app ${got.slice(0, 6).map((x) => x.slice(0, 6))} ≠ regra ${want.slice(0, 6).map((x) => x.slice(0, 6))}`
    }, { timeout: 20_000 })
    .toBe('igual')
}

/** Config → conteúdo → sua lente. */
async function openLensCard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'abrir config' }).click({ timeout: 10_000 })
  await page.locator('[id^="settings-group-"]', { hasText: 'conteúdo' }).click({ timeout: 10_000 })
  await page.getByRole('button', { name: /^sua lente/ }).click({ timeout: 10_000 })
  await expect(page.getByRole('dialog', { name: /sua lente/ })).toBeVisible()
}

/** Fecha as camadas de configuração (Esc) até as abas voltarem a receber toque. */
async function closeLayers(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if ((await page.getByRole('dialog').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Força pela tela (bolinhas 0/50/100), com o rótulo que o usuário lê. */
async function setStrengthViaUi(page: Page, pct: 0 | 50 | 100): Promise<void> {
  await openLensCard(page)
  await page.getByRole('button', { name: `ajustar pra ${pct}%` }).click()
  const label = { 0: 'desligada — a ordem de todo mundo', 50: '1 em cada 2 cards é de quem você segue', 100: 'primeiro, todos de quem você segue' }[pct]
  await expect(page.getByTestId('lens-label')).toHaveText(label)
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/trust-lens.ts')).useLensStore.getState().strength)).toBe(pct / 100)
  await closeLayers(page)
}

/** Post do card na tela, pelo texto (como o spec do contágio). null = fim. */
async function currentCardId(page: Page): Promise<string | null> {
  for (let tries = 0; tries < 40; tries++) {
    const present = await page.evaluate(async () => {
      const f = await import('/src/lib/feed.ts')
      const lines = new Set(document.body.innerText.split('\n').map((s) => s.trim()))
      return f.useFeedStore.getState().posts
        .filter((p: { subposts: { text?: string }[] }) => { const t = p.subposts[0]?.text; return !!t && lines.has(t) })
        .map((p: { id: string }) => p.id)
    })
    if (present.length <= 1) return present[0] ?? null
    await page.waitForTimeout(100)
  }
  throw new Error('dois cards na tela por mais de 4 s')
}

async function goToTop(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.locator('[role="tab"][aria-selected="true"]').click()
    await page.waitForTimeout(600)
    const first = (await tabIds(page))[0] ?? null
    if ((await currentCardId(page)) === first) return
  }
  throw new Error('o toque na aba ativa não voltou ao topo')
}

async function reportCurrentCard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'abrir ações' }).first().click()
  await page.getByRole('button', { name: 'moderar' }).click()
  await page.getByRole('dialog', { name: 'moderação' }).getByRole('button', { name: /^denunciar/ }).click()
  const modal = page.getByRole('dialog', { name: 'denunciar post' })
  await modal.getByRole('button', { name: /^spam/ }).click()
  await modal.getByRole('button', { name: 'continuar →' }).click()
  await modal.getByRole('button', { name: 'denunciar', exact: true }).click()
  await expect(modal).toHaveCount(0, { timeout: 10_000 })
}

/** Eco do relay: no modo hermético a denúncia publicada não volta sozinha. */
async function echoReport(page: Page, postId: string, author: string): Promise<void> {
  await page.evaluate(async ({ postId, author }) => {
    const n = await import('/src/lib/nostr.ts')
    const e = await import('/src/lib/events.ts')
    const ev = await n.signDriftEvent({ kind: 9081, tags: [['e', postId], ['p', author], ['reason', 'spam']], content: '' })
    await e.onNostrEvent(ev)
  }, { postId, author })
}

let freshSeq = 0
/** Frank publica um post novo e a Alice dá DRIFT nele (chaves do seed,
 *  pipeline real): o post chega ao Bob pela Alice, com a pílula. */
async function aliceBringsOne(page: Page): Promise<string> {
  const alice = NAMED_BY_NAME.alice!
  const frank = NAMED_BY_NAME.frank!
  const now = Math.floor(Date.now() / 1000)
  const text = `e2e lente ${now}-${++freshSeq}`
  const post = finalizeEvent(
    { kind: 9078, created_at: now - 120, tags: [['drift-version', '1'], ['client', 'drift-official']], content: JSON.stringify({ subposts: [{ id: `l-${freshSeq}`, type: 'text', text, imageUrl: null, order: 0, layout: 'text' }] }) },
    frank.sk,
  )
  const drift = finalizeEvent({ kind: 9079, created_at: now - 60, tags: [['e', post.id], ['p', post.pubkey]], content: '' }, alice.sk)
  await page.evaluate(async (evs) => {
    const e = await import('/src/lib/events.ts')
    for (const ev of evs) await e.onNostrEvent(ev)
    await new Promise((r) => setTimeout(r, 300))
    await e.recalcAllScores()
  }, [post, drift])
  return post.id
}

test.describe('lente no feed', () => {
  // o primeiro boot compila o app no Vite (frio): folga para todos
  test.describe.configure({ timeout: 150_000 })

  test('1. desligada: Global e Em alta na ordem de sempre; a tela diz isso', async ({ browser }) => {
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      expect((await networkOf(page, await viewer(page))).size, 'Carol tem rede no seed').toBeGreaterThan(0)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 0)
      await openTab(page, 'trending')
      await expectTabMatchesOracle(page, 'trending', 0)
      expect((await storePosts(page)).some((p) => p.lensLift), 'desligada não marca nada').toBe(false)
      await openLensCard(page)
      await expect(page.getByTestId('lens-label')).toHaveText('desligada — a ordem de todo mundo')
      await expect(page.getByTestId('lens-helper')).toContainText('A ordem de sempre')
      await closeLayers(page)
    } finally {
      await carol.context.close()
    }
  })

  test('2. 50% pela tela: um card sim, um não de quem você segue; Seguindo e Contágio não mudam', async ({ browser }) => {
    test.setTimeout(120_000)
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      await openTab(page, 'following')
      const following = await tabIds(page)
      await openTab(page, 'contagio')
      const contagio = await tabIds(page)

      await setStrengthViaUi(page, 50)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 50)
      const posts = await storePosts(page)
      const rede = await networkOf(page, await viewer(page))
      // a regra na tela: o 2º card é da rede (se houver posts dela na aba)
      if (posts.some((p) => rede.has(p.authorPub))) expect(rede.has(posts[1]!.authorPub) || rede.has(posts[0]!.authorPub)).toBe(true)
      await openTab(page, 'trending')
      await expectTabMatchesOracle(page, 'trending', 50)

      await openTab(page, 'following')
      expect(await tabIds(page), 'seguindo não muda com a lente').toEqual(following)
      await openTab(page, 'contagio')
      expect(await tabIds(page), 'contágio não muda com a lente').toEqual(contagio)
    } finally {
      await carol.context.close()
    }
  })

  test('3. 100%: primeiro a sua rede; o chip "lente" diz por que o post subiu', async ({ browser }) => {
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      await setStrengthViaUi(page, 100)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 100)
      const posts = await storePosts(page)
      const rede = await networkOf(page, await viewer(page))
      const firstOther = posts.findIndex((p) => !rede.has(p.authorPub))
      if (firstOther > 0) expect(posts.slice(firstOther).some((p) => rede.has(p.authorPub) && p.lensLift)).toBe(false)
      for (const p of posts) if (p.lensLift) expect(rede.has(p.authorPub), 'só quem você segue sobe').toBe(true)

      const lifted = posts[0]?.lensLift ? posts[0] : null
      test.skip(!lifted, 'o primeiro post da rede já era o 1º do global neste seed')
      await goToTop(page)
      expect(await currentCardId(page)).toBe(lifted!.id)
      const chip = page.getByTestId('lens-chip').first()
      await expect(chip).toBeVisible()
      await chip.click()
      const sheet = page.getByTestId('lens-sheet')
      await expect(sheet).toContainText('Você segue')
      await expect(sheet).toContainText('Com a sua lente em 100%')
      await expect(sheet).toContainText(lifted!.lensLift!.from === null ? 'estava fora dos primeiros da aba' : `estaria em ${lifted!.lensLift!.from + 1}º`)
      await page.keyboard.press('Escape')
    } finally {
      await carol.context.close()
    }
  })

  test('4. denunciar quem a lente trouxe tira a pessoa da sua rede', async ({ browser }) => {
    test.setTimeout(120_000)
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      await setStrengthViaUi(page, 100)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 100)
      const top = (await storePosts(page))[0]!
      test.skip(!top.lensLift, 'sem post adiantado no topo neste seed')
      await goToTop(page)
      expect(await currentCardId(page)).toBe(top.id)
      await reportCurrentCard(page)
      await echoReport(page, top.id, top.authorPub)
      expect((await networkOf(page, await viewer(page))).has(top.authorPub), 'o oráculo também tira').toBe(false)
      await expectTabMatchesOracle(page, 'global', 100)
      for (const p of await storePosts(page)) if (p.authorPub === top.authorPub) expect(p.lensLift).toBeUndefined()
    } finally {
      await carol.context.close()
    }
  })

  test('5. cronológica pela tela: os mesmos posts, do mais novo pro mais velho; a escolha volta ao recarregar', async ({ browser }) => {
    test.setTimeout(150_000)
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      await openTab(page, 'global')
      await openLensCard(page)
      await page.getByRole('combobox', { name: 'qual lente' }).selectOption('chronological')
      await expect(page.getByRole('slider', { name: 'força da lente' })).toHaveCount(0)
      await closeLayers(page)
      const check = async () => {
        await openTab(page, 'global')
        await expect.poll(async () => {
          await page.evaluate(async () => (await import('/src/lib/feed.ts')).refreshFeed())
          // a aba de sempre agora (o seed se reancora a cada boot: ids novos depois de recarregar)
          const canon = new Set(await oracle(page, 'global', 0))
          const ps = await storePosts(page)
          const unsorted = ps.findIndex((p, i) => i > 0 && p.createdAt > ps[i - 1]!.createdAt)
          const extra = ps.filter((p) => !canon.has(p.id)).map((p) => p.id.slice(0, 6))
          if (unsorted >= 0) return `fora de ordem no ${unsorted}º`
          if (ps.length !== canon.size) return `tamanho ${ps.length} ≠ ${canon.size}`
          return extra.length ? `fora da aba: ${extra}` : 'ok'
        }, { timeout: 20_000 }).toBe('ok')
      }
      await check()
      await page.reload()
      await waitSeedSettled(page)
      await page.getByRole('dialog', { name: 'onboarding do drift' }).getByRole('button', { name: 'pular' }).click({ timeout: 3_000 }).catch(() => {})
      expect(await page.evaluate(async () => (await import('/src/lib/lens/registry.ts')).useLensRegistryStore.getState().activeId)).toBe('chronological')
      await check()
    } finally {
      await carol.context.close()
    }
  })

  test('6. com a lente ligada, a folha "chegou por" da aba Contágio continua igual', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      await setStrengthViaUi(page, 100)
      const target = await aliceBringsOne(page)
      await openTab(page, 'contagio')
      expect(await tabIds(page)).toContain(target)
      const lensOff = await page.evaluate(async () => {
        const f = await import('/src/lib/feed.ts')
        return (await f.getContagionFeed(50)).map((p: { id: string }) => p.id)
      })
      expect(await tabIds(page), 'contágio é o SQL da aba, sem lente').toEqual(lensOff)
      await goToTop(page)
      for (let i = 0; i < 60 && (await currentCardId(page)) !== target; i++) {
        await page.locator('body').click({ position: { x: 5, y: 5 } })
        await page.keyboard.press('k')
        await page.waitForTimeout(250)
      }
      expect(await currentCardId(page)).toBe(target)
      await page.getByTestId('contagion-via').first().getByRole('button').click()
      const sheet = page.getByRole('dialog', { name: 'chegou por' })
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('button', { name: /^não trazer mais por/ })).toBeVisible()
      await sheet.getByRole('button', { name: 'fechar' }).click({ timeout: 10_000 })
      await expect(sheet).toHaveCount(0)
      expect(await tabIds(page), 'a folha não mexe na aba').toContain(target)
    } finally {
      await bob.context.close()
    }
  })

  test('7. a lente não grava nada: ligar, mexer e desligar deixa o banco igual', async ({ browser }) => {
    const carol = await setupUser(browser, 'carol')
    try {
      const page = carol.page
      const dump = async () => JSON.stringify(await Promise.all(['posts', 'users', 'spreads', 'buries', 'reports', 'follows'].map((t) =>
        sql(page, `SELECT * FROM ${t} ORDER BY 1, 2`))))
      await openTab(page, 'global')
      const before = await dump()
      for (const k of [50, 100, 0] as const) {
        await setStrengthViaUi(page, k)
        await openTab(page, 'global')
        await openTab(page, 'trending')
      }
      expect(await dump()).toBe(before)
    } finally {
      await carol.context.close()
    }
  })

  test('8. perfil persistente: força e lente sobrevivem a fechar o navegador, e o boot segue de pé', async ({}, info) => {
    test.setTimeout(240_000)
    const base = (info.project.use.baseURL ?? 'http://localhost:5173').replace(/\/$/, '')
    const dir = info.outputPath('perfil')
    const open = async () => {
      const ctx = await chromium.launchPersistentContext(dir, { headless: true })
      const page = ctx.pages()[0] ?? (await ctx.newPage())
      await page.goto(`${base}/?dev-seed=lite&as=carol`)
      await waitSeedSettled(page)
      await page.getByRole('dialog', { name: 'onboarding do drift' }).getByRole('button', { name: 'pular' }).click({ timeout: 3_000 }).catch(() => {})
      return { ctx, page }
    }
    let { ctx, page } = await open()
    try {
      await setStrengthViaUi(page, 50)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 50)
    } finally {
      await ctx.close()
    }
    ;({ ctx, page } = await open())
    try {
      expect(await page.evaluate(async () => (await import('/src/lib/trust-lens.ts')).useLensStore.getState().strength)).toBe(0.5)
      await openTab(page, 'global')
      await expectTabMatchesOracle(page, 'global', 50)
      await openLensCard(page)
      await expect(page.getByTestId('lens-label')).toHaveText('1 em cada 2 cards é de quem você segue')
    } finally {
      await ctx.close()
    }
  })
})
