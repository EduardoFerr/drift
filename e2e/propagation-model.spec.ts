/**
 * propagation-model.spec.ts — suite ADVERSARIAL pro bug #3 (mapas não
 * fiéis aos algoritmos). Sprint N+5 Batch B2 (Satoshi).
 *
 * Plano: `Docs/sessions/sprint-n5-e2e-validation-2026-05-29.md`.
 *
 * ─── Hipótese nula (a PROVAR errada, ou confirmar como bug) ──────────
 *
 * "Os arcs do SpreadMap NÃO representam a cascata social
 *  Alice→Bob→Carol→Dave. Eles conectam GEOGRAFIA (local-do-autor-do-post
 *  → local-de-quem-espalhou) em ESTRELA, não a árvore de contaminação
 *  social pela qual o post viajou."
 *
 * Default Satoshi: o bug está presente até prova em contrário. Esta suite
 * NÃO conserta nada — MEDE e ASSERTA o modelo que o código produz HOJE,
 * pra alimentar a deliberação #3b (manter geográfico vs adicionar modo
 * cascata-social). Honestidade radical: se os arcs estiverem certos e o
 * "bug" for percepção do user, a suite diz isso explicitamente.
 *
 * ─── Por que medir na fonte (SQLite) e não na tela (WebGL) ───────────
 *
 * Os arcs vivem em layers deck.gl (LineLayer) renderizados em WebGL —
 * coords não são extraíveis do DOM. Mas o `useSpreadMap` constrói os arcs
 * de forma 1:1 a partir de queries SQL determinísticas contra o SQLite
 * materializado pelo pipeline real (`onNostrEvent`). Rodamos as MESMAS
 * queries (`buildGlobalData`, `buildPostData` em `useSpreadMap.ts`) via
 * `window.__driftDb` (exposto só sob dev-seed) → medimos exatamente o que
 * o usuário vê desenhado, sem fragilidade de introspecção gráfica.
 *
 * Cascata conhecida (fixtures.ts):
 *   P1 = POST de Alice em Brasília (-15.79,-47.88), em TS_BASE.
 *   SPREAD Bob   (+1h) — GPS OFF (geo null)
 *   SPREAD Carol (+2h) — São Paulo (-23.55,-46.63)
 *   SPREAD Dave  (+3h) — Rio de Janeiro (-22.9,-43.17)
 *   follow-graph: Bob→Alice, Carol→Bob, Dave→Carol (cadeia social real).
 *
 * Predição adversarial pré-medição:
 *   - GLOBAL: cada arc da cascata = Alice.local → spreader.local. Logo
 *     Carol = Brasília→SP, Dave = Brasília→Rio → ESTRELA a partir de
 *     Brasília. NUNCA SP→Rio. Não desenha Carol-contaminou-Dave.
 *   - POST de P1: chain linear origin→d0→d1 = Brasília→SP→Rio. Sugere
 *     visualmente que Carol passou pra Dave (SP→Rio), o que é FALSO no
 *     follow-graph (Dave segue Carol, mas ambos espalharam o post da
 *     Alice, não um do outro). Chain enganosa.
 *   - Bob (GPS off) some dos DOIS modos (location IS NOT NULL filtra).
 *     Cascata de 3 elos → no máximo 2 visíveis no mapa.
 */

import { test, expect, type Page } from '@playwright/test'
import { getSeedMeta, waitSeedSettled } from './fixtures/users'
import { CASCADE, NAMED_BY_NAME } from '../src/lib/dev-seed/fixtures'

// ─── Coordenadas conhecidas da cascata (espelham fixtures.ts) ─────────

const ALICE_GEO = NAMED_BY_NAME.alice!.geo! // Brasília
const CAROL_GEO = NAMED_BY_NAME.carol!.geo! // São Paulo
const DAVE_GEO = NAMED_BY_NAME.dave!.geo! // Rio
const BOB_GEO = NAMED_BY_NAME.bob!.geo // null — GPS off

// ─── Tipos do shape que extraímos do browser ─────────────────────────

interface ArcOut {
  from: [number, number] // [lng, lat]
  to: [number, number]
  t: number
  isCurrent?: boolean
  postId?: string
}
interface ProbeResult {
  cascadePostId: string
  /** Linhas brutas da cascata (spreads de P1, com e sem location). */
  cascadeSpreadRows: Array<{
    spreader_pub: string
    created_at: number
    location: string | null
  }>
  /** Arcs do modo POST de P1 (chain linear origin→d0→d1...). */
  postArcs: ArcOut[]
  postOrigin: [number, number] | null
  /** Arcs do modo GLOBAL, FILTRADOS pra só os de P1 (post-origin→spreader). */
  globalArcsForP1: ArcOut[]
  /** Total de arcs global (sanidade — agregado inteiro). */
  globalArcTotal: number
}

const SPREADER = {
  bob: NAMED_BY_NAME.bob!.pub,
  carol: NAMED_BY_NAME.carol!.pub,
  dave: NAMED_BY_NAME.dave!.pub,
} as const

/**
 * Espera o `window.__driftDb` ficar disponível (boot dev-seed terminou de
 * expor a API do SQLite). Falha barulhento se não aparecer — sinal de que
 * o hook E2E em `bootstrap.ts` regrediu.
 */
async function waitForDb(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __driftDb?: unknown }).__driftDb !== 'undefined',
    undefined,
    { timeout: 30_000 },
  )
}

/**
 * Roda no browser as MESMAS queries de `useSpreadMap.ts`
 * (`buildPostData` modo post + `buildGlobalData` modo global) contra o
 * SQLite real, e reconstrói os arcs com a MESMA lógica (chain linear no
 * post; post.location→spread.location no global). Devolve um shape
 * mensurável pros asserts.
 */
async function probePropagation(page: Page, cascadePostId: string): Promise<ProbeResult> {
  return page.evaluate(async (postId: string): Promise<ProbeResult> => {
    interface DbApi {
      exec: <T>(sql: string, params?: unknown[]) => Promise<T[]>
      get: <T>(sql: string, params?: unknown[]) => Promise<T | null>
    }
    interface ArcOutLocal {
      from: [number, number]
      to: [number, number]
      t: number
      isCurrent?: boolean
      postId?: string
    }
    const db = (window as unknown as { __driftDb: DbApi }).__driftDb

    function parseLoc(raw: string | null): { lng: number; lat: number } | null {
      if (!raw) return null
      try {
        const v = JSON.parse(raw) as { lat?: number; lng?: number }
        if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null
        return { lng: v.lng, lat: v.lat }
      } catch {
        return null
      }
    }

    // ── Cascade rows: TODOS os spreads de P1 (com e sem location) ──
    const cascadeSpreadRows = await db.exec<{
      spreader_pub: string
      created_at: number
      location: string | null
    }>(
      `SELECT spreader_pub, created_at, location
       FROM spreads WHERE post_id = ? ORDER BY created_at ASC`,
      [postId],
    )

    // ── POST mode (buildPostData): chain linear origin→d0→d1→... ──
    const postRow = await db.get<{ location: string | null; created_at: number }>(
      `SELECT location, created_at FROM posts WHERE id = ?`,
      [postId],
    )
    const postSpreadRows = await db.exec<{
      created_at: number
      location: string | null
    }>(
      `SELECT created_at, location FROM spreads
       WHERE post_id = ? AND location IS NOT NULL
       ORDER BY created_at ASC`,
      [postId],
    )
    const origin = parseLoc(postRow?.location ?? null)
    const chain: Array<{ pos: [number, number]; ts: number }> = []
    if (origin && postRow?.created_at) chain.push({ pos: [origin.lng, origin.lat], ts: postRow.created_at })
    for (const r of postSpreadRows) {
      const loc = parseLoc(r.location)
      if (loc) chain.push({ pos: [loc.lng, loc.lat], ts: r.created_at })
    }
    const postArcs: ArcOutLocal[] = []
    for (let i = 0; i < chain.length - 1; i++) {
      const next = chain[i + 1]!
      postArcs.push({ from: chain[i]!.pos, to: next.pos, t: 0 })
    }

    // ── GLOBAL mode (buildGlobalData): post.location→spread.location ──
    const globalRows = await db.exec<{
      post_id: string
      from_loc: string
      to_loc: string
    }>(
      `SELECT s.post_id AS post_id, p.location AS from_loc, s.location AS to_loc
       FROM spreads s JOIN posts p ON s.post_id = p.id
       WHERE s.location IS NOT NULL AND p.location IS NOT NULL
       ORDER BY s.created_at ASC LIMIT 2000`,
      [],
    )
    const globalArcsForP1: ArcOutLocal[] = []
    let globalArcTotal = 0
    for (const row of globalRows) {
      const f = parseLoc(row.from_loc)
      const t = parseLoc(row.to_loc)
      if (!f || !t) continue
      globalArcTotal++
      if (row.post_id === postId) {
        globalArcsForP1.push({ from: [f.lng, f.lat], to: [t.lng, t.lat], t: 0, postId: row.post_id })
      }
    }

    return {
      cascadePostId: postId,
      cascadeSpreadRows,
      postArcs,
      postOrigin: origin ? [origin.lng, origin.lat] : null,
      globalArcsForP1,
      globalArcTotal,
    }
  }, cascadePostId)
}

// ─── Helpers de comparação geográfica ────────────────────────────────

const EPS = 0.01
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS
}
function arcMatches(arc: ArcOut, from: [number, number], to: [number, number]): boolean {
  return near(arc.from[0], from[0]) && near(arc.from[1], from[1]) && near(arc.to[0], to[0]) && near(arc.to[1], to[1])
}

// ─── Setup compartilhado: 1 page booted em dev-seed (Alice) ──────────
//
// O modelo de propagação independe de QUEM observa (global é agregado;
// post é por-post). Booto uma única identidade (Alice) com dev-seed pra
// materializar o SQLite com a cascata conhecida e leio via __driftDb.

let page: Page
let cascadePostId: string

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext()
  page = await ctx.newPage()
  // dev-seed=lite: drain em segundos (full = minutos > timeout, drain floor).
  // Preserva a cascata A→B→C→D que esta suite valida.
  await page.goto('/?dev-seed=lite&as=alice')
  await page.getByText('dev seed', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  await waitForDb(page)
  await waitSeedSettled(page) // drain + recalc completos antes de inventariar a cascata

  // cascadePostId vem do hook ground-truth do seed ANCORADO (a timeline é
  // ancorada ao Date.now do boot → id/created_at boot-relativos; não dá pra
  // buscar por timestamp absoluto nem recomputar da forma pura).
  const meta = await getSeedMeta(page)
  cascadePostId = meta.cascadePostId
  const exists = await page.evaluate(async (id: string) => {
    interface DbApi { get: <T>(sql: string, params?: unknown[]) => Promise<T | null> }
    const db = (window as unknown as { __driftDb: DbApi }).__driftDb
    const row = await db.get<{ id: string }>(`SELECT id FROM posts WHERE id = ?`, [id])
    return row?.id ?? null
  }, cascadePostId)
  expect(exists, 'P1 (cascade root) deve existir no SQLite seeded').toBe(cascadePostId)
})

test.afterAll(async () => {
  await page?.context().close()
})

// ─────────────────────────────────────────────────────────────────────
// SPEC 1 — Inventário factual da cascata no banco
// ─────────────────────────────────────────────────────────────────────

test('SPEC1 cascade inventory: 3 spreads existem, mas só 2 têm location (Bob GPS off)', async () => {
  const r = await probePropagation(page, cascadePostId)

  // A cascata social tem 3 elos (Bob, Carol, Dave) — todos no banco.
  expect(r.cascadeSpreadRows.length, '3 spreads de cascata persistidos').toBe(CASCADE.length)
  expect(r.cascadeSpreadRows.length).toBe(3)

  const byPub = new Map(r.cascadeSpreadRows.map((row) => [row.spreader_pub, row]))
  expect(byPub.has(SPREADER.bob), 'Bob espalhou').toBe(true)
  expect(byPub.has(SPREADER.carol), 'Carol espalhou').toBe(true)
  expect(byPub.has(SPREADER.dave), 'Dave espalhou').toBe(true)

  // Bob = GPS off → location NULL. Carol/Dave têm location.
  expect(BOB_GEO, 'fixture: Bob sem geo').toBeNull()
  expect(byPub.get(SPREADER.bob)!.location, 'Bob spread sem location').toBeNull()
  expect(byPub.get(SPREADER.carol)!.location, 'Carol spread com location').not.toBeNull()
  expect(byPub.get(SPREADER.dave)!.location, 'Dave spread com location').not.toBeNull()

  const withLoc = r.cascadeSpreadRows.filter((row) => row.location !== null).length
  // MEDIDA #3: dos 3 elos sociais, só 2 são geo-visíveis. 1/3 da cascata
  // some do mapa por design (location IS NOT NULL). Documentado, não fix.
  expect(withLoc, '2 de 3 elos da cascata são visíveis no mapa').toBe(2)
})

// ─────────────────────────────────────────────────────────────────────
// SPEC 2 — GLOBAL mode: ESTRELA geográfica, não cascata social
// ─────────────────────────────────────────────────────────────────────

test('SPEC2 global model = ESTRELA a partir do autor, NÃO cascata Bob→Carol→Dave', async () => {
  const r = await probePropagation(page, cascadePostId)

  // 2 arcs de P1 no global (Bob filtrado por falta de location).
  expect(r.globalArcsForP1.length, 'P1 global: 2 arcs (Carol, Dave)').toBe(2)

  const aliceLngLat: [number, number] = [ALICE_GEO.lng, ALICE_GEO.lat]
  const carolLngLat: [number, number] = [CAROL_GEO.lng, CAROL_GEO.lat]
  const daveLngLat: [number, number] = [DAVE_GEO.lng, DAVE_GEO.lat]

  // ── Modelo ESTRELA: TODOS os arcs partem do local do AUTOR (Alice/
  //    Brasília). É o que `buildGlobalData` faz: from = posts.location. ──
  for (const arc of r.globalArcsForP1) {
    expect(
      near(arc.from[0], aliceLngLat[0]) && near(arc.from[1], aliceLngLat[1]),
      `arc parte de Brasília (autor), não do spreader anterior — from=${JSON.stringify(arc.from)}`,
    ).toBe(true)
  }

  // Arcs concretos: Brasília→SP (Carol) e Brasília→Rio (Dave).
  expect(
    r.globalArcsForP1.some((a) => arcMatches(a, aliceLngLat, carolLngLat)),
    'existe arc Brasília→São Paulo (Carol)',
  ).toBe(true)
  expect(
    r.globalArcsForP1.some((a) => arcMatches(a, aliceLngLat, daveLngLat)),
    'existe arc Brasília→Rio (Dave)',
  ).toBe(true)

  // ── REFUTAÇÃO da cascata social: NÃO existe arc SP→Rio (Carol→Dave),
  //    que seria o elo da árvore social real (Dave segue Carol). O modelo
  //    geográfico não desenha contaminação spreader→spreader. ──
  expect(
    r.globalArcsForP1.some((a) => arcMatches(a, carolLngLat, daveLngLat)),
    'NÃO existe arc São Paulo→Rio (cascata social Carol→Dave) — modelo é estrela',
  ).toBe(false)

  // Veredito SPEC2: hipótese nula CONFIRMADA pro modo global. Os arcs são
  // geográficos (autor→spreader), formam estrela hub-and-spoke, e NÃO
  // representam a cadeia social Bob→Carol→Dave.
})

// ─────────────────────────────────────────────────────────────────────
// SPEC 3 — POST mode: chain linear ENGANOSA (origin→d0→d1)
// ─────────────────────────────────────────────────────────────────────

test('SPEC3 post model = chain linear Brasília→SP→Rio, sugere Carol→Dave falso', async () => {
  const r = await probePropagation(page, cascadePostId)

  // Origin = Brasília (autor Alice).
  expect(r.postOrigin, 'post origin presente').not.toBeNull()
  expect(near(r.postOrigin![0], ALICE_GEO.lng) && near(r.postOrigin![1], ALICE_GEO.lat), 'origin = Brasília').toBe(true)

  // Chain linear: [Brasília, SP, Rio] → 2 arcs consecutivos.
  // (Bob excluído por GPS off → não entra na chain.)
  expect(r.postArcs.length, 'post chain: 2 arcs (3 pontos)').toBe(2)

  const aliceLngLat: [number, number] = [ALICE_GEO.lng, ALICE_GEO.lat]
  const carolLngLat: [number, number] = [CAROL_GEO.lng, CAROL_GEO.lat]
  const daveLngLat: [number, number] = [DAVE_GEO.lng, DAVE_GEO.lat]

  // Arc 0 = Brasília→SP (origin→primeiro destino). OK, fiel.
  expect(arcMatches(r.postArcs[0]!, aliceLngLat, carolLngLat), 'arc0 = Brasília→SP').toBe(true)

  // Arc 1 = SP→Rio. ESTE é o arc ENGANOSO: liga Carol→Dave por mera
  // adjacência cronológica na chain, sugerindo visualmente que Carol
  // passou o post pra Dave. NA VERDADE ambos espalharam o post da Alice;
  // a chain linear inventa um elo geográfico que não corresponde nem ao
  // follow-graph (Dave→Carol) nem a uma propagação real spreader→spreader.
  expect(
    arcMatches(r.postArcs[1]!, carolLngLat, daveLngLat),
    'arc1 = SP→Rio (chain liga 2º ao 3º destino — elo enganoso)',
  ).toBe(true)

  // Confirmação: o post mode NÃO desenha origin→cada-dest (estrela real
  // do "todo mundo espalhou o post da Alice"). Desenha cadeia sequencial.
  // O fix #3c proposto no plano é exatamente origin→cada-dest.
  // Veredito SPEC3: chain linear confirmada como modelo atual (enganosa).
})

// ─────────────────────────────────────────────────────────────────────
// SPEC 4 — Bob (GPS off) é invisível em AMBOS os modos
// ─────────────────────────────────────────────────────────────────────

test('SPEC4 elo 1 da cascata (Bob, GPS off) some do mapa nos dois modos', async () => {
  const r = await probePropagation(page, cascadePostId)

  // Bob espalhou (elo social #1), mas sem location nenhum arc o representa.
  // Global: 2 arcs (Carol+Dave), nenhum com geo de Bob (Bob não tem geo).
  // Post: chain de 2 arcs, idem.
  expect(r.globalArcsForP1.length, 'global: Bob ausente (2 arcs)').toBe(2)
  expect(r.postArcs.length, 'post: Bob ausente (2 arcs)').toBe(2)

  // O elo SOCIAL Alice→Bob (Bob segue Alice e foi o PRIMEIRO a espalhar)
  // — o gatilho da viralização — é justamente o que o mapa NÃO mostra.
  // Consequência adversarial: mapas privilegiam quem tem GPS ligado,
  // distorcendo a leitura de "por onde o post realmente viajou".
})

// ─────────────────────────────────────────────────────────────────────
// SPEC 5 — Veredito factual consolidado (documenta o modelo medido)
// ─────────────────────────────────────────────────────────────────────

test('SPEC5 veredito: modelo MEDIDO = geográfico estrela (global) + chain linear (post)', async () => {
  const r = await probePropagation(page, cascadePostId)

  const aliceLngLat: [number, number] = [ALICE_GEO.lng, ALICE_GEO.lat]
  const allGlobalFromAuthor = r.globalArcsForP1.every(
    (a) => near(a.from[0], aliceLngLat[0]) && near(a.from[1], aliceLngLat[1]),
  )
  const hasSocialEdgeCarolDave = r.globalArcsForP1.some((a) =>
    arcMatches(a, [CAROL_GEO.lng, CAROL_GEO.lat], [DAVE_GEO.lng, DAVE_GEO.lat]),
  )

  const verdict = {
    cascadeSocialLinks: CASCADE.length, // 3
    geoVisibleLinks: r.cascadeSpreadRows.filter((x) => x.location !== null).length, // 2
    globalArcsForP1: r.globalArcsForP1.length, // 2
    globalAllArcsStartAtAuthor: allGlobalFromAuthor, // true = ESTRELA
    globalDrawsSpreaderToSpreader: hasSocialEdgeCarolDave, // false = NÃO cascata
    postChainArcs: r.postArcs.length, // 2 (chain linear)
    globalArcTotalAggregate: r.globalArcTotal, // sanidade do agregado
  }
  // Imprime o veredito no relatório de teste (visível em --reporter=list).
  // eslint-disable-next-line no-console
  console.log('[PROPAGATION MODEL — MEDIDO]', JSON.stringify(verdict, null, 2))

  // ── HIPÓTESE NULA CONFIRMADA (bug #3 presente): ──
  // 1. Global desenha ESTRELA a partir do autor, não cascata social.
  expect(verdict.globalAllArcsStartAtAuthor, 'global = estrela do autor').toBe(true)
  // 2. Global NÃO desenha o elo social spreader→spreader (Carol→Dave).
  expect(verdict.globalDrawsSpreaderToSpreader, 'global não desenha cascata social').toBe(false)
  // 3. Cascata social de 3 elos perde 1 (Bob GPS off) no mapa.
  expect(verdict.geoVisibleLinks).toBeLessThan(verdict.cascadeSocialLinks)
  // 4. Post mode é chain linear (não estrela origin→cada-dest).
  expect(verdict.postChainArcs).toBe(2)

  // VEREDITO: bug #3 CONFIRMADO. O mapa NÃO é fiel à cascata social
  // Alice→Bob→Carol→Dave. Global = estrela geográfica (autor→spreader);
  // Post = chain linear cronológica (sugere elos spreader→spreader que
  // não existem). Evidência pra deliberação #3b (geográfico vs social)
  // e forcing-function da legenda honesta #5.
})
