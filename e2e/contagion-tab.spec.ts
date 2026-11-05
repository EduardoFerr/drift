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
 * Experiência ruim = denúncia (o SINK é gosto, §23): a denúncia feita na
 * aba registra quem trouxe; a parte do autor sai da denúncia publicada, que
 * no modo hermético não volta do relay — o teste reproduz esse eco.
 *
 * Vizinhos (regra E2E 100% + blast radius): as outras abas seguem
 * funcionando e a ordem dentro da aba é a do feed global.
 */

import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent } from 'nostr-tools/pure'
import { NAMED_BY_NAME } from '../src/lib/dev-seed/fixtures'
import { setupUser } from './fixtures/users'

const HOUR = 3600

let freshSeq = 0

/**
 * Garante um post que chega ao Bob PELA Alice: Frank (que o Bob não segue)
 * publica um post novo e a Alice dá DRIFT nele — os dois eventos assinados
 * com as chaves do seed e ingeridos pelo pipeline real, como se viessem do
 * relay. O seed sozinho não garante DRIFT recente da Alice: sem isto a
 * pílula e a denúncia na aba ficavam sem cobertura.
 */
async function aliceBringsOne(page: Page): Promise<string> {
  const alice = NAMED_BY_NAME.alice!
  const frank = NAMED_BY_NAME.frank!
  const now = Math.floor(Date.now() / 1000)
  const text = `e2e contágio ${now}-${++freshSeq}`
  const post = finalizeEvent(
    { kind: 9078, created_at: now - 120, tags: [['drift-version', '1'], ['client', 'drift-official']], content: JSON.stringify({ subposts: [{ id: `e2e-${freshSeq}`, type: 'text', text, imageUrl: null, order: 0, layout: 'text' }] }) },
    frank.sk,
  )
  const drift = finalizeEvent({ kind: 9079, created_at: now - 60, tags: [['e', post.id], ['p', post.pubkey]], content: '' }, alice.sk)
  await page.evaluate(async (evs) => {
    const e = await import('/src/lib/events.ts')
    for (const ev of evs) await e.onNostrEvent(ev)
    // evento novo muda scores e reordena o feed (debounce de 100 ms):
    // espera o ranking assentar antes de abrir a aba
    await new Promise((r) => setTimeout(r, 300))
    await e.recalcAllScores()
  }, [post, drift])
  return post.id
}

/**
 * Post do card que está na tela, pelo texto (os do seed são únicos; compara
 * a linha inteira, não substring). Durante a animação de troca o card que
 * sai e o que entra convivem no DOM: espera sobrar um só. null = fim do feed.
 */
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

/**
 * Volta ao topo da aba ativa (toque na aba já selecionada). O toque também
 * dispara um refresh: se ele reordenar o feed logo depois, o cursor — que
 * segue o post pelo id — fica no antigo primeiro. Repete até o card na tela
 * ser o primeiro da lista.
 */
async function goToTop(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.locator('[role="tab"][aria-selected="true"]').click()
    await page.waitForTimeout(600)
    const first = await page.evaluate(async () => (await import('/src/lib/feed.ts')).useFeedStore.getState().posts[0]?.id ?? null)
    if ((await currentCardId(page)) === first) return
  }
  throw new Error('o toque na aba ativa não voltou ao topo')
}

/** Vai ao topo e avança com DRIFT até o card `postId` estar na tela. */
async function goToCard(page: Page, postId: string): Promise<void> {
  await goToTop(page)
  const seen: string[] = []
  for (let i = 0; i < 60; i++) {
    const cur = await currentCardId(page)
    if (cur === postId) return
    seen.push(cur?.slice(0, 6) ?? 'fim')
    expect(cur, `fim do feed antes de chegar em ${postId.slice(0, 8)} (vistos: ${seen.join(' ')})`).not.toBeNull()
    await advance(page, 1)
  }
  const where = await page.evaluate(async (id) => {
    const f = await import('/src/lib/feed.ts')
    const ps = f.useFeedStore.getState().posts.map((p: { id: string }) => p.id)
    return { idx: ps.indexOf(id), n: ps.length, top: ps.slice(0, 3).map((x: string) => x.slice(0, 6)) }
  }, postId)
  throw new Error(`card ${postId.slice(0, 8)} não apareceu (vistos: ${seen.join(' ')}; no store: ${JSON.stringify(where)})`)
}

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

/** `setupUser` já fecha o onboarding; aqui só garante que nada cobre as abas. */
async function dismissOnboarding(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: 'onboarding do drift' })).toHaveCount(0)
}

/** "Quem trouxe" do post na última leitura da aba (o que a pílula mostra). */
/** "Quem trouxe" do post na aba ativa (o que a pílula mostra): todos os empatados. */
async function arrivedViaAll(page: Page, postId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const f = await import('/src/lib/feed.ts')
    const p = f.useFeedStore.getState().posts.find((x: { id: string }) => x.id === id) as { arrivedVia?: string[] } | undefined
    return [...(p?.arrivedVia ?? [])]
  }, postId)
}

async function arrivedVia(page: Page, postId: string): Promise<string | null> {
  return (await arrivedViaAll(page, postId))[0] ?? null
}

/** Registro local "quem trouxe" do que o leitor denunciou na aba. */
async function badRows(page: Page, postId: string): Promise<{ s: string; v: string }[]> {
  return sql(page, `SELECT subject_pub AS s, viewer_pub AS v FROM contagion_bad_experiences WHERE post_id = ?`, [postId])
}

/** Experiências ruins do leitor com `pub`, como a aba as lê (loader real). */
async function strikesOf(page: Page, pub: string): Promise<number> {
  return page.evaluate(async (pub) => {
    const cd = await import('/src/lib/contagion-data.ts')
    const id = await import('/src/lib/identity.ts')
    const me = (await id.getCurrentNpub()) as string
    const input = await cd.loadContagionInput(me, new Set<string>(), Math.floor(Date.now() / 1000))
    return input.strikes.get(pub) ?? 0
  }, pub)
}

async function authorOf(page: Page, postId: string): Promise<string> {
  return (await sql<{ a: string }>(page, `SELECT author_pub AS a FROM posts WHERE id = ?`, [postId]))[0]!.a
}

async function firstText(page: Page, postId: string): Promise<string> {
  const [row] = await sql<{ c: string }>(page, `SELECT content AS c FROM posts WHERE id = ?`, [postId])
  return (JSON.parse(row!.c) as { subposts: { text?: string }[] }).subposts[0]?.text ?? ''
}

/** Avança o card atual com DRIFT (tecla k). No modo hermético nada é publicado. */
async function advance(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const before = await currentCardId(page)
    // o card recém-montado às vezes ainda não ouve o teclado: confirma que
    // trocou antes de seguir, senão aperta de novo (sem pular card)
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('k')
      const changed = await expect.poll(() => currentCardId(page), { timeout: 2_000 }).not.toBe(before).then(() => true, () => false)
      if (changed) break
    }
  }
}

/** Denuncia o card atual pelo caminho do usuário: ⋮ → moderar → denunciar → spam → confirmar. */
/**
 * Denuncia o card atual pelo caminho do usuário: ⋮ → moderar → denunciar →
 * spam → confirmar. Devolve o aviso que o passo de confirmação mostrou
 * ANTES do envio (manifesto §24: nenhum sinal escondido).
 */
async function reportCurrentCard(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'abrir ações' }).first().click()
  await page.getByRole('button', { name: 'moderar' }).click()
  await page.getByRole('dialog', { name: 'moderação' }).getByRole('button', { name: /^denunciar/ }).click()
  const modal = page.getByRole('dialog', { name: 'denunciar post' })
  await modal.getByRole('button', { name: /^spam/ }).click()
  await modal.getByRole('button', { name: 'continuar →' }).click()
  const note = modal.getByTestId('report-contagion-note')
  await expect(note).toBeVisible()
  const text = (await note.textContent()) ?? ''
  await modal.getByRole('button', { name: 'denunciar', exact: true }).click()
  await expect(modal).toHaveCount(0, { timeout: 10_000 })
  return text
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

const TAB_ID: Record<string, string> = { global: 'global', seguindo: 'following', 'em alta': 'trending', 'contágio': 'contagio' }

async function openTab(page: Page, label: string): Promise<void> {
  await dismissOnboarding(page)
  const tab = page.getByRole('tab', { name: label })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  // A aba carrega via refreshFeed (assíncrono). `waitForFunction` com função
  // async não serve: a Promise é truthy e a espera passava na hora, com os
  // posts da aba anterior ainda na store. `page.evaluate` aguarda a Promise.
  await expect
    .poll(() => page.evaluate(async () => {
      const f = await import('/src/lib/feed.ts')
      const s = f.useFeedStore.getState()
      return s.loaded ? s.tab : null
    }), { timeout: 15_000 })
    .toBe(TAB_ID[label])
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
      await expect(alice.page.getByText(/Você ainda não segue ninguém\. Aqui aparecem os posts de quem você segue e o que essas pessoas driftaram/)).toBeVisible()
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

  test('4. SINK pela interface (tecla j) na aba é gosto: não grava experiência ruim com ninguém (§23)', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      // o caso que importa: um post que chegou PELA Alice, com a pílula à vista
      const first = await aliceBringsOne(page)
      await openTab(page, 'contágio')
      await goToCard(page, first)
      const via = await arrivedVia(page, first)
      expect(via, 'o card enterrado chegou pela Alice').not.toBeNull()
      await expect(page.getByTestId('contagion-via').first()).toBeVisible()
      const author = await authorOf(page, first)
      const card = page.getByText(await firstText(page, first), { exact: true })
      await expect(card.first()).toBeVisible()
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('j')
      // sinal positivo de que o SINK rodou: o card enterrado sai da tela
      await expect(card).toHaveCount(0, { timeout: 10_000 })
      await page.waitForTimeout(1_000)
      expect(await badRows(page, first), 'SINK não registra quem trouxe').toEqual([])
      expect(await strikesOf(page, author), 'SINK não pune o autor').toBe(0)
      expect(await strikesOf(page, via!), 'SINK não pune quem trouxe').toBe(0)
    } finally {
      await bob.context.close()
    }
  })

  test('8. denúncia pela interface: avisa antes, pune o autor sempre e quem trouxe só na aba; a aba se atualiza na hora', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      const me = await viewer(page)
      const alice = (await follows(page, me))[0]!
      const target = await aliceBringsOne(page)
      const elsewhere = await aliceBringsOne(page)
      await openTab(page, 'contágio')
      const ids = await tabIds(page)
      expect(ids, 'os posts que a Alice impulsionou chegaram ao Bob').toEqual(expect.arrayContaining([target, elsewhere]))
      expect(await arrivedVia(page, elsewhere)).toBe(alice)

      // 1) fora da aba não há "chegou por": denunciar no global um post que
      //    chegou pela Alice na aba pune só o autor — a regra é o lugar da
      //    denúncia (com a pílula à vista), não o post
      await openTab(page, 'global')
      await goToCard(page, elsewhere)
      await expect(page.getByTestId('contagion-via')).toHaveCount(0)
      const noteGlobal = await reportCurrentCard(page)
      // Bob não segue o Frank: sem follow o vínculo já é zero — o aviso não
      // promete efeito no autor (os posts dele seguem chegando pelos contatos)
      expect(noteGlobal, 'autor não seguido: sem promessa sobre ele').not.toContain('o que vem do autor')
      expect(noteGlobal, 'sem pílula, o aviso não cita ninguém mais').not.toContain('o mesmo vale para')
      const authorElsewhere = await authorOf(page, elsewhere)
      await expect.poll(async () => (await badRows(page, elsewhere)).map((r) => r.s), { timeout: 10_000 }).toEqual([authorElsewhere])
      expect(await strikesOf(page, alice), 'a Alice segue intacta').toBe(0)
      expect(await strikesOf(page, authorElsewhere), 'o autor já perde, sem esperar o relay').toBe(1)

      // 2) na aba, com a pílula à vista, a denúncia avisa e registra quem trouxe
      await openTab(page, 'contágio')
      await goToCard(page, target)
      const via = (await arrivedVia(page, target))!
      const author = await authorOf(page, target)
      expect(via, 'Bob só segue a Alice: é ela quem traz').toBe(alice)
      await expect(page.getByTestId('contagion-via').first()).toBeVisible()

      const noteTab = await reportCurrentCard(page)
      expect(noteTab, 'o aviso cita quem trouxe antes do envio').toContain('que trouxe este post')
      await expect.poll(async () => (await badRows(page, target)).length, { timeout: 10_000 }).toBe(2)
      const rows = await badRows(page, target)
      expect(rows.every((r) => r.v === me), 'o registro é do leitor').toBe(true)
      expect(rows.map((r) => r.s).sort()).toEqual([via, author].sort())
      expect(await strikesOf(page, via)).toBe(1)
      expect(author, 'os dois posts são do Frank').toBe(authorElsewhere)
      expect(await strikesOf(page, author), 'dois posts dele denunciados').toBe(2)

      // a denúncia publicada volta pelo relay: a mesma, conta uma vez só
      await echoReport(page, target, author)
      await page.waitForTimeout(500)
      expect(await strikesOf(page, author)).toBe(2)

      // 3) Alice: 0,8 − 0,5 = 0,3 — o que ela impulsiona deixa de chegar
      //    sozinho, e a aba se atualiza na hora (sem trocar de aba)
      await expect.poll(() => tabIds(page), { timeout: 10_000 }).not.toContain(elsewhere)
      for (const id of await tabIds(page)) expect(await authorOf(page, id), 'só posts diretos da Alice sobram').toBe(alice)
    } finally {
      await bob.context.close()
    }
  })

  test('9. empate: dois contatos de 0,8 trazem o post — a pílula e o aviso mostram os dois, e a denúncia pune exatamente os dois', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      const me = await viewer(page)
      const { alice, frank, heidi, bob: bobId } = NAMED_BY_NAME as Record<string, { pub: string; sk: Uint8Array }>
      const now = Math.floor(Date.now() / 1000)
      const mkPost = (who: { sk: Uint8Array }, text: string, t: number) => finalizeEvent(
        { kind: 9078, created_at: t, tags: [['drift-version', '1'], ['client', 'drift-official']], content: JSON.stringify({ subposts: [{ id: text, type: 'text', text, imageUrl: null, order: 0, layout: 'text' }] }) },
        who.sk,
      )
      const mkDrift = (who: { sk: Uint8Array }, p: { id: string; pubkey: string }, t: number) => finalizeEvent({ kind: 9079, created_at: t, tags: [['e', p.id], ['p', p.pubkey]], content: '' }, who.sk)
      // Bob passa a seguir o Frank e já impulsionou um post dele (0,8);
      // Alice e Frank impulsionam um post da Heidi, que o Bob não segue
      const doFrank = mkPost(frank!, `e2e frank ${now}`, now - 300)
      const alvo = mkPost(heidi!, `e2e empate ${now}`, now - 240)
      const evs = [doFrank, mkDrift(bobId!, doFrank, now - 200), alvo, mkDrift(alice!, alvo, now - 120), mkDrift(frank!, alvo, now - 90)]
      await page.evaluate(async ({ evs, frankPub }) => {
        const e = await import('/src/lib/events.ts')
        const fo = await import('/src/lib/follows.ts')
        for (const ev of evs) await e.onNostrEvent(ev)
        const st = fo.useFollowsStore.getState()
        fo.useFollowsStore.setState({ following: new Set([...(st.following as Set<string>), frankPub]) } as never)
        await new Promise((r) => setTimeout(r, 300))
        await e.recalcAllScores()
      }, { evs, frankPub: frank!.pub })

      await openTab(page, 'contágio')
      expect((await arrivedViaAll(page, alvo.id)).sort(), 'os dois empatados em 0,8').toEqual([alice!.pub, frank!.pub].sort())
      await goToCard(page, alvo.id)
      const pill = page.getByTestId('contagion-via').first()
      await expect(pill).toBeVisible()
      await expect(pill.locator('.sr-only')).toContainText(' e ')

      const note = await reportCurrentCard(page)
      expect(note, 'o aviso cita os dois, no plural').toContain('trouxeram')
      await expect.poll(async () => (await badRows(page, alvo.id)).map((r) => r.s).sort(), { timeout: 10_000 })
        .toEqual([alice!.pub, frank!.pub, heidi!.pub].sort())
      expect((await badRows(page, alvo.id)).every((r) => r.v === me)).toBe(true)
    } finally {
      await bob.context.close()
    }
  })

  test('10. aviso da denúncia: autor que você segue → fala do autor; post direto não cita ninguém mais', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      const alice = (await follows(page, await viewer(page)))[0]!
      await openTab(page, 'contágio')
      // post direto da Alice (seguida): sem pílula, aviso só sobre o autor
      let direto: string | null = null
      for (const id of await tabIds(page)) if ((await authorOf(page, id)) === alice && (await arrivedVia(page, id)) === null) { direto = id; break }
      expect(direto, 'a aba do Bob tem post direto da Alice').not.toBeNull()
      await goToCard(page, direto!)
      await expect(page.getByTestId('contagion-via')).toHaveCount(0)
      const note = await reportCurrentCard(page)
      expect(note).toContain('o que vem do autor passa a chegar menos')
      expect(note).not.toContain('que trouxe este post')
    } finally {
      await bob.context.close()
    }
  })

  test('7. a pílula "chegou por" aparece quando o post veio por alguém e some quando entrou direto', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      await aliceBringsOne(page)
      await openTab(page, 'contágio')
      const ids = await tabIds(page)
      const pill = page.getByTestId('contagion-via')
      const seen = { via: false, direct: false }
      // avança com DRIFT (tecla k) até ver os dois casos; confere o card que
      // está de fato na tela, não um índice (a ordem pode mudar no caminho)
      for (let i = 0; i <= ids.length && !(seen.via && seen.direct); i++) {
        const cur = await currentCardId(page)
        if (cur === null) break
        const via = await arrivedVia(page, cur)
        if (via) {
          await expect(pill.first()).toBeVisible()
          await expect(pill.first()).toContainText('chegou por')
          seen.via = true
        } else {
          await expect(pill).toHaveCount(0)
          seen.direct = true
        }
        await advance(page, 1)
      }
      expect(seen, 'a aba do Bob tem post direto da Alice e post que chegou por ela').toEqual({ via: true, direct: true })
      // fora da aba a pílula nunca aparece
      await openTab(page, 'global')
      await expect(pill).toHaveCount(0)
    } finally {
      await bob.context.close()
    }
  })

  test('6. vínculo zerado: com 2 experiências ruins com a Alice, a aba do Bob esvazia e diz por quê', async ({ browser }) => {
    const bob = await setupUser(browser, 'bob')
    try {
      const page = bob.page
      const alice = (await follows(page, await viewer(page)))[0]!
      // duas denúncias do que a Alice trouxe (vínculo conquistado 0,8 − 2 × 0,5 → 0)
      const me = await viewer(page)
      await page.evaluate(async ({ alice, me }) => {
        const w = window as unknown as { __driftDb: { run: (s: string, p?: unknown[]) => Promise<void> } }
        for (const post of ['e2e-ruim-1', 'e2e-ruim-2'])
          await w.__driftDb.run(`INSERT OR IGNORE INTO contagion_bad_experiences (viewer_pub, subject_pub, post_id, created_at) VALUES (?, ?, ?, ?)`, [me, alice, post, Math.floor(Date.now() / 1000)])
      }, { alice, me })
      await openTab(page, 'contágio')
      expect(await tabIds(page)).toEqual([])
      await expect(page.getByText(/Nada novo chegou pelas pessoas que você segue/)).toBeVisible()
      // o global não depende das escolhas do leitor
      await openTab(page, 'global')
      expect((await tabIds(page)).length).toBeGreaterThan(0)
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
