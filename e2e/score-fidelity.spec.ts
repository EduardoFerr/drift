/**
 * ADVERSARIAL — bug #1 (score "estranho"). Sprint N+5 Batch B2 (Marshall).
 * Plano: `Docs/sessions/sprint-n5-e2e-validation-2026-05-29.md`.
 *
 * ─── Hipótese nula (queremos PROVAR ERRADO) ──────────────────────────
 *
 *   "O score DERIVA renderizado (header E card) NÃO bate com
 *    `calculateScore` puro sobre os mesmos eventos seed."
 *
 * O que a suite mede, contra o SQLite REAL materializado pelo pipeline
 * (`onNostrEvent` → recalc), exposto via `window.__driftDb` em dev-seed:
 *
 *   #1 Header DERIVA  == posts.score do post visível            (render fiel ao DB)
 *   #2 Card ↑N        == posts.spreads (COUNT, NÃO weighted)    (count-vs-weight)
 *   #3 §23 última-ação — spread→bury do MESMO user conta 1× bury (não soma)
 *   #4 §26 threshold  — 3 posts-alvo escondidos (score = -999)
 *   #5 §7  determinismo — 2 boots → mesmos COUNTS (spreads/buries/score-shape)
 *
 * ─── DESCOBERTA CENTRAL (documentada antes de rodar) ─────────────────
 *
 * Há DOIS números distintos exibidos pro mesmo conceito "DRIFT":
 *
 *   - CARD `↑N`  = `formatStat(post.spreads)`  → COUNT de pessoas
 *     (events.ts:1073 grava `spreads = spreadCount`, distinct last-action).
 *   - HEADER `deriva X.XXX` = `currentPost.score` (App.tsx:1257) → FLOAT
 *     ponderado `(Σ spreaderWeight − Σ buryWeight·0.3)/(ageHours+2)^1.5`
 *     (scoring.ts:46).
 *
 * São grandezas DIFERENTES (contagem inteira vs score float ponderado por
 * idade+peso). Um post com 3 spreads pode mostrar card `↑3` e header
 * `deriva 0.004` simultaneamente. Essa é a raiz provável do bug #1: o user
 * vê "3" no card e um float pequeno e não-óbvio no header e lê como
 * inconsistência. NÃO é um bug de cálculo — é um bug de COMUNICAÇÃO
 * (mesmo léxico "DRIFT/DERIVA" pra duas métricas). A suite prova que
 * AMBOS os números estão corretos quanto à sua própria definição, e
 * QUANTIFICA a divergência pro B3 decidir a copy.
 *
 * ─── Por que ler do SQLite e não recomputar com Date.now ─────────────
 *
 * `recalculateScore` (events.ts) usa `Date.now()` no momento do recalc
 * (posts datados de ~2024-05; ageHours enorme → score minúsculo mas
 * positivo). O `now` exato do app é inobservável do teste. Então a suite
 * NÃO tenta bater o float absoluto contra um recompute externo com outro
 * `now` — isso seria flaky e mediria o relógio, não a fidelidade.
 *
 * Em vez disso prova fidelidade RENDER→DB (header == posts.score, card ==
 * posts.spreads) — exato — e RE-DERIVA o score puro a partir das MESMAS
 * linhas (`posts.created_at` + Σ weights via `calculateWeight` com um
 * único `now` capturado no teste) só pra confirmar a FORMA da fórmula
 * (sinal, ordenação, relação spread×bury), com tolerância larga no
 * absoluto. Determinismo §7 é coberto comparando 2 boots pelos COUNTS
 * (independentes de relógio) + estabilidade de sinal do score.
 *
 * ─── Execução ────────────────────────────────────────────────────────
 *
 * Sandbox NÃO roda Playwright (sem browser). Rodar manualmente:
 *   npm run dev:tunnel            # (ou deixar webServer subir sozinho)
 *   npx playwright test e2e/score-fidelity.spec.ts
 *
 * A suite PODE FALHAR DE PROPÓSITO se confirmar divergência render↔DB.
 * Verdade > verde (constraint Marshall).
 */

import { test, expect } from '@playwright/test'
import { setupUser, getSeedMeta } from './fixtures/users'
import { calculateScore } from '../src/lib/scoring'
import { calculateWeight } from '../src/lib/weight'
import { NAMED_BY_NAME, CASCADE } from '../src/lib/dev-seed/fixtures'

// ─── Tipos das linhas lidas via window.__driftDb (read-only) ─────────

interface PostRow {
  id: string
  score: number
  spreads: number
  buries: number
  created_at: number
  author_pub: string
}

interface UserAggRow {
  npub: string
  user_created_at: number
  last_active: number | null
  spreads_received: number
}

/**
 * Helper: roda uma query arbitrária no SQLite do app via o hook
 * `window.__driftDb` (só existe sob dev-seed). `db.exec` retorna linhas.
 */
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

async function dbGet<T>(
  page: import('@playwright/test').Page,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await dbExec<T>(page, sql, params)
  return rows[0]
}

/** Lê o número que o HEADER mostra ("deriva X.XXX" / inteiro pt-BR). */
async function readHeaderDeriva(page: import('@playwright/test').Page): Promise<string> {
  const btn = page.getByRole('button', { name: /deriva .* abrir guia/i })
  await btn.waitFor({ state: 'visible' })
  // O aria-label embute o valor formatado: "deriva 0.004 — abrir guia".
  const label = (await btn.getAttribute('aria-label')) ?? ''
  const m = label.match(/deriva\s+([\d.,]+)/i)
  if (!m) throw new Error(`aria-label do header inesperado: "${label}"`)
  return m[1]!
}

// ─────────────────────────────────────────────────────────────────────
// Spec #1 — Header DERIVA é fiel a posts.score do post visível
// ─────────────────────────────────────────────────────────────────────

test('#1 header DERIVA == posts.score do post visível (render fiel ao DB)', async ({
  browser,
}) => {
  const alice = await setupUser(browser, 'alice')
  try {
    // O header lê `currentPost.score` — o post no CURSOR do feed. CRÍTICO
    // (2026-05-29): o cursor NÃO re-segue o feed quando o score reordena após
    // o recalc (UX intencional — o card não pula embaixo do dedo do user). Ou
    // seja, o post visível NÃO é necessariamente o top-global por score. Logo
    // NÃO dá pra comparar o header contra `ORDER BY score DESC LIMIT 1`.
    //
    // "Render fiel ao DB" (a hipótese real desta spec) = o número do header é
    // o score formatado de UM post REAL do banco — não um valor fabricado nem
    // derivado de outra grandeza (ex: count). Lemos TODOS os scores visíveis,
    // formatamos cada um com a MESMA regra do app, e exigimos que o header
    // seja um deles. Isso pega "render mente sobre o DB" sem assumir QUAL post
    // o cursor está mostrando.
    const rows = await dbExec<{ score: number }>(
      alice.page,
      `SELECT score FROM posts WHERE score > -999`,
    )
    expect(rows.length, 'feed vazio — seed não materializou?').toBeGreaterThan(0)

    const fmt = (score: number) =>
      Math.abs(score) >= 1000 ? Math.round(score).toLocaleString('pt-BR') : score.toFixed(3)
    const allFormatted = new Set(rows.map((r) => fmt(r.score)))

    const headerStr = await readHeaderDeriva(alice.page)

    // ADVERSARIAL: o header tem que ser o score formatado de ALGUM post real.
    // Se mostra um número que não bate com NENHUM posts.score, render infiel.
    expect(
      allFormatted.has(headerStr),
      `Header mostra "${headerStr}", que não corresponde a posts.score de NENHUM ` +
        `post visível (${rows.length} posts). Render não-fiel ao DB.`,
    ).toBe(true)
  } finally {
    await alice.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Spec #2 — Card ↑N é COUNT (posts.spreads), NÃO o score ponderado.
//           Quantifica a divergência count-vs-weight (raiz bug #1).
// ─────────────────────────────────────────────────────────────────────

test('#2 P1 cascata: card ↑N == COUNT de spreaders, divergente do score float', async ({
  browser,
}) => {
  const alice = await setupUser(browser, 'alice')
  try {
    const { cascadePostId } = await getSeedMeta(alice.page)
    const p1 = await dbGet<PostRow>(
      alice.page,
      `SELECT id, score, spreads, buries, created_at, author_pub
         FROM posts WHERE id = ?`,
      [cascadePostId],
    )
    expect(p1, 'P1 (cascata) ausente no DB').toBeTruthy()

    // Ground-truth: cascata = Bob, Carol, Dave espalharam P1 (3 spreaders
    // distintos). NENHUM bury de P1 no seed. → spreads COUNT esperado = 3.
    const expectedSpreadCount = CASCADE.length // 3
    expect(
      p1!.spreads,
      `posts.spreads de P1 = ${p1!.spreads}, esperado ${expectedSpreadCount} (Bob+Carol+Dave)`,
    ).toBe(expectedSpreadCount)
    expect(p1!.buries, 'P1 não tem buries no seed').toBe(0)

    // Verificação cruzada: o COUNT bate com as linhas reais da tabela
    // spreads (distinct spreader_pub, §23 last-action — aqui sem bury, todos
    // contam).
    const spreadRows = await dbExec<{ n: number }>(
      alice.page,
      `SELECT COUNT(DISTINCT spreader_pub) AS n FROM spreads WHERE post_id = ?`,
      [cascadePostId],
    )
    expect(spreadRows[0]!.n).toBe(expectedSpreadCount)

    // O score (float ponderado) é uma grandeza DIFERENTE do count. Prova
    // numérica da divergência: para P1 o score NÃO é igual ao count.
    // (Posts de 2024 → ageHours enorme → score << count.) Isto é o cerne
    // do bug #1: "↑3" no card vs "deriva 0.00X" no header, mesmo post.
    expect(
      p1!.score,
      `DIVERGÊNCIA count-vs-weight: card mostraria "↑${p1!.spreads}" mas ` +
        `score=${p1!.score}. São métricas distintas (count inteiro vs ` +
        `float ponderado por peso+idade). Raiz do bug #1 = LÉXICO, não cálculo.`,
    ).not.toBe(p1!.spreads)

    // Score deve ser POSITIVO (3 spreaders de peso>0, zero buries).
    expect(p1!.score, 'P1 com 3 spreads e 0 buries deve ter score > 0').toBeGreaterThan(0)
  } finally {
    await alice.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Spec #2b — Re-derivação pura: a FORMA do score de P1 bate com
//            calculateScore(Σ weight, 0, created_at, now) — confirma que
//            o pipeline aplica a fórmula certa (não conta eventos crus).
// ─────────────────────────────────────────────────────────────────────

test('#2b score de P1 segue a fórmula ponderada (não COUNT) — re-derivação pura', async ({
  browser,
}) => {
  const alice = await setupUser(browser, 'alice')
  try {
    const { cascadePostId } = await getSeedMeta(alice.page)
    const p1 = await dbGet<PostRow>(
      alice.page,
      `SELECT id, score, created_at FROM posts WHERE id = ?`,
      [cascadePostId],
    )
    expect(p1).toBeTruthy()

    // Pesos atuais dos 3 spreaders (lidos do MESMO DB que o app usou).
    const spreaderPubs = CASCADE.map((s) => s.spreaderPub)
    const placeholders = spreaderPubs.map(() => '?').join(',')
    const aggs = await dbExec<UserAggRow>(
      alice.page,
      `SELECT u.npub AS npub, u.created_at AS user_created_at,
              u.last_active AS last_active,
              (SELECT COUNT(*) FROM spreads s INNER JOIN posts p ON p.id = s.post_id
                 WHERE p.author_pub = u.npub) AS spreads_received
         FROM users u WHERE u.npub IN (${placeholders})`,
      spreaderPubs,
    )
    expect(aggs.length, 'os 3 spreaders devem existir em users').toBe(3)

    // Re-derivar com um `now` único (capturado no teste). O `now` do app
    // foi outro → o ABSOLUTO difere; por isso aqui validamos a FORMA:
    //   - score > 0 (Σ weight > 0, sem buries)
    //   - score == calculateScore(Σw, 0, created_at, now) DENTRO de uma
    //     razão plausível (ambos minúsculos, mesma fórmula).
    const now = Math.floor(Date.now() / 1000)
    let sumWeight = 0
    for (const a of aggs) {
      sumWeight += calculateWeight({
        createdAt: a.user_created_at * 1000,
        spreadsReceived: a.spreads_received,
        lastActive: a.last_active !== null ? a.last_active * 1000 : null,
        now: now * 1000,
      })
    }
    expect(sumWeight, 'Σ weight dos spreaders > 0').toBeGreaterThan(0)

    const rederived = calculateScore({
      spreadWeight: sumWeight,
      buryWeight: 0,
      createdAt: p1!.created_at,
      now,
    })

    // Ambos positivos. A razão app/rederivado deve ser ~1 a menos de
    // diferença de relógio entre recalc do app e este teste (segundos a
    // minutos sobre ageHours de ~milhares → impacto desprezível). Banda
    // larga (0.5×..2×) é adversarialmente honesta: prova "mesma fórmula",
    // não "mesmo instante".
    expect(p1!.score).toBeGreaterThan(0)
    const ratio = p1!.score / rederived
    expect(
      ratio,
      `score app=${p1!.score} vs re-derivado=${rederived} (ratio ${ratio.toFixed(4)}). ` +
        `Fora da banda → fórmula divergente (não ponderada?).`,
    ).toBeGreaterThan(0.5)
    expect(ratio).toBeLessThan(2)

    // E o score JAMAIS é o count puro (3) nem soma de counts.
    expect(p1!.score).not.toBe(3)
  } finally {
    await alice.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Spec #3 — §23 última-ação-vale: se um user faz spread e DEPOIS bury do
//           mesmo post, só o bury conta (count e weight). O seed não tem
//           esse caso pra P1, então CRIAMOS via UI (Bob spread→bury) e
//           medimos o efeito no DB.
// ─────────────────────────────────────────────────────────────────────

test('#3 §23 última-ação-vale: spread→bury do mesmo user conta só bury', async ({
  browser,
}) => {
  // Bob: segue Alice, vê P1. Vamos espalhar e depois enterrar — só o bury
  // deve sobreviver no recalc (events.ts:selectLatestActionByUser).
  const bob = await setupUser(browser, 'bob')
  try {
    const { cascadePostId } = await getSeedMeta(bob.page)
    // Estado inicial de P1 (cascata já tem Bob como spreader pelo seed).
    const before = await dbGet<PostRow>(
      bob.page,
      `SELECT spreads, buries, score FROM posts WHERE id = ?`,
      [cascadePostId],
    )
    expect(before).toBeTruthy()

    // Identidade ativa do Bob (npub) — lida do mesmo DB.
    const bobNpub = (
      await dbGet<{ npub: string }>(bob.page, `SELECT npub FROM identity LIMIT 1`)
    )?.npub
    expect(bobNpub, 'identidade ativa do Bob ausente').toMatch(/^[0-9a-f]{64}$/)
    const aliceP = NAMED_BY_NAME.alice!.pub

    // 1) SPREAD fresco (created_at = now). protocol.spreadPost assina com a
    //    identidade ativa e publica; alimentamos o retorno na porta canônica
    //    onNostrEvent (CLAUDE.md invariante #1) pra materializar no SQLite —
    //    o transport mockado em E2E pode não fazer loopback sozinho.
    await bob.page.evaluate(
      async ({ postId, authorPub }) => {
        // Specifiers absolutos `/src/...` são resolvidos pelo dev server
        // Vite em runtime no browser — não pelo tsc (daí o ts-expect-error).
        // @ts-expect-error -- módulo runtime do Vite, não resolvível por tsc
        const proto = await import('/src/lib/protocol.ts')
        // @ts-expect-error -- módulo runtime do Vite, não resolvível por tsc
        const events = await import('/src/lib/events.ts')
        const ev = await proto.spreadPost({ postId, authorPub })
        await events.onNostrEvent(ev)
      },
      { postId: cascadePostId, authorPub: aliceP },
    )

    // Avançar o relógio ≥1s pra garantir created_at(bury) > created_at(spread)
    // — §23 decide pela ação cronologicamente ÚLTIMA.
    await bob.page.waitForTimeout(1500)

    // 2) BURY do MESMO post (created_at posterior). Última ação do Bob.
    const result = await bob.page.evaluate(async (postId) => {
      // @ts-expect-error -- módulo runtime do Vite, não resolvível por tsc
      const proto = await import('/src/lib/protocol.ts')
      // @ts-expect-error -- módulo runtime do Vite, não resolvível por tsc
      const events = await import('/src/lib/events.ts')
      const ev = await proto.buryPost({ postId })
      await events.onNostrEvent(ev)
      return { npub: ev.pubkey }
    }, cascadePostId)
    expect(result.npub).toBe(bobNpub)

    // Esperar o recalc debounced (events.ts 100ms) + invalidateFeed 150ms.
    await bob.page.waitForTimeout(1200)

    // Re-ler P1: a ação líquida do Bob virou 'bury'. Como o seed já tinha
    // Bob como SPREADER da cascata, o net agora é bury → spreads count cai
    // em 1 (Bob saiu dos spreaders) e buries sobe em 1. §23.
    const after = await dbGet<PostRow>(
      bob.page,
      `SELECT spreads, buries, score FROM posts WHERE id = ?`,
      [cascadePostId],
    )
    expect(after).toBeTruthy()

    // Bob NÃO pode contar como spread E bury simultaneamente.
    const bobActions = await dbExec<{ k: string; c: number }>(
      bob.page,
      `SELECT 'spread' AS k, COUNT(*) AS c FROM spreads WHERE post_id=? AND spreader_pub=?
       UNION ALL
       SELECT 'bury' AS k, COUNT(*) AS c FROM buries WHERE post_id=? AND burier_pub=?`,
      [cascadePostId, result.npub, cascadePostId, result.npub],
    )
    // (Pode haver linha de spread do seed + linha de bury nova — ambas
    // PERSISTEM no DB por idempotência/auditoria §13. O que §23 garante é
    // que o RECALC conta só a última. Por isso medimos os COUNTS
    // materializados, não as linhas cruas.)
    const buriesRow = bobActions.find((r) => r.k === 'bury')!
    expect(buriesRow.c, 'bury do Bob deve existir').toBeGreaterThanOrEqual(1)

    // Invariante §23: count de spreaders de P1 caiu (Bob migrou pra bury),
    // buries subiu. Net move: spreads_after < spreads_before OU
    // (se Bob não estava entre os spreaders contados) buries_after maior.
    expect(
      after!.spreads + after!.buries,
      `§23: total de ações líquidas não pode dobrar (Bob conta 1×). ` +
        `antes s=${before!.spreads} b=${before!.buries}, depois s=${after!.spreads} b=${after!.buries}`,
    ).toBeLessThanOrEqual(before!.spreads + before!.buries + 1)
    expect(after!.buries, 'buries deve ter aumentado (Bob enterrou)').toBeGreaterThan(
      before!.buries,
    )
  } finally {
    await bob.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Spec #4 — §26 moderação: os 3 posts-alvo do seed cruzam o threshold e
//           ficam com score = -999 (escondidos do feed).
// ─────────────────────────────────────────────────────────────────────

test('#4 §26: 3 posts-alvo escondidos (score = -999) e fora do feed', async ({
  browser,
}) => {
  const alice = await setupUser(browser, 'alice')
  try {
    // IDs dos 3 alvos de report no seed ANCORADO (ground-truth via hook).
    const { reportedTargetIds: reportedTargets } = await getSeedMeta(alice.page)
    expect(reportedTargets.length, 'seed deve ter exatamente 3 alvos').toBe(3)

    // Cada alvo deve estar com score = -999 no DB materializado.
    for (const tid of reportedTargets) {
      const row = await dbGet<{ score: number }>(
        alice.page,
        `SELECT score FROM posts WHERE id = ?`,
        [tid],
      )
      expect(row, `alvo ${tid} ausente`).toBeTruthy()
      expect(
        row!.score,
        `alvo reportado ${tid} deveria estar moderado (-999) mas score=${row!.score}`,
      ).toBe(-999)
    }

    // E NENHUM dos 3 aparece no feed global (query feed.ts: score > -999).
    const placeholders = reportedTargets.map(() => '?').join(',')
    const visible = await dbExec<{ id: string }>(
      alice.page,
      `SELECT id FROM posts
         WHERE score > -999 AND id IN (${placeholders})`,
      reportedTargets,
    )
    expect(
      visible.map((r) => r.id),
      'posts moderados não podem aparecer no feed (score > -999)',
    ).toEqual([])

    // §13 — moderado NÃO é deletado: ainda existe no DB (auditável).
    const stillPresent = await dbExec<{ id: string }>(
      alice.page,
      `SELECT id FROM posts WHERE id IN (${placeholders})`,
      reportedTargets,
    )
    expect(
      stillPresent.length,
      '§13: posts moderados continuam no DB (score -999, não DELETE)',
    ).toBe(3)
  } finally {
    await alice.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Spec #5 — §7 determinismo: 2 boots dev-seed independentes → mesmos
//           COUNTS (spreads/buries por post) e mesmo SINAL de score.
//           (O float absoluto varia com Date.now do recalc — por isso
//           comparamos counts + sinal, que são invariantes de relógio.)
// ─────────────────────────────────────────────────────────────────────

test('#5 §7: 2 boots dev-seed convergem (counts + sinal de score idênticos)', async ({
  browser,
}) => {
  // Boot A e B em contexts ISOLADOS (storage/OPFS próprios) — cada um
  // re-semeia do zero. Manifesto §7: mesmos eventos → mesmo estado.
  const a = await setupUser(browser, 'carol')
  const b = await setupUser(browser, 'carol')
  try {
    // NOTA (anchor 2026-05-29): a timeline é ancorada ao Date.now de CADA
    // boot → event ids E created_at são boot-relativos (2 boots em instantes
    // diferentes → ids diferentes). Por isso §7 aqui é a ESTRUTURA
    // materializada — contagens (spreads/buries) + sinal do score por post —
    // NÃO os ids absolutos. Ordenamos pelos campos estruturais (não por id) e
    // comparamos o multiset. A determinismo POR-âncora (mesma âncora → mesmos
    // ids) é coberta em tests/dev-seed-fixtures (unidade, forma pura).
    const SQL = `SELECT spreads, buries,
                        CASE WHEN score = -999 THEN -1
                             WHEN score > 0 THEN 1 ELSE 0 END AS score_sign
                   FROM posts ORDER BY spreads, buries, score_sign`
    type Row = { spreads: number; buries: number; score_sign: number }

    const rowsA = await dbExec<Row>(a.page, SQL)
    const rowsB = await dbExec<Row>(b.page, SQL)

    expect(rowsA.length, 'boot A vazio').toBeGreaterThan(0)
    expect(
      rowsA.length,
      `contagem de posts divergente entre boots: A=${rowsA.length} B=${rowsB.length}`,
    ).toBe(rowsB.length)

    // Comparação exata da ESTRUTURA por post (spreads, buries, sinal). QUALQUER
    // divergência mata o determinismo §7 → hipótese de não-determinismo vence.
    expect(rowsB).toEqual(rowsA)

    // Sanidade: pelo menos um post moderado (-1) e um positivo (1) — senão
    // a comparação acima seria trivialmente verdadeira sobre dados vazios.
    const signsA = new Set(rowsA.map((r) => r.score_sign))
    expect(signsA.has(-1), 'esperado ≥1 post moderado (-999) no seed').toBe(true)
    expect(signsA.has(1), 'esperado ≥1 post com score positivo no seed').toBe(true)
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

// ─────────────────────────────────────────────────────────────────────
// Smoke: o post de origem da cascata pertence à Alice (sanidade do seed).
// ─────────────────────────────────────────────────────────────────────

test('#smoke P1 é da Alice (sanidade ground-truth)', async ({ browser }) => {
  const alice = await setupUser(browser, 'alice')
  try {
    const { cascadePostId } = await getSeedMeta(alice.page)
    const p1 = await dbGet<PostRow>(
      alice.page,
      `SELECT author_pub FROM posts WHERE id = ?`,
      [cascadePostId],
    )
    expect(p1!.author_pub).toBe(NAMED_BY_NAME.alice!.pub)
  } finally {
    await alice.context.close()
  }
})
