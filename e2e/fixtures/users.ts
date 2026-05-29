/**
 * Multi-context user fixture (Sprint N+5 E2E multi-user validation).
 *
 * Cada "named user" (Alice..Heidi) roda num `BrowserContext` Playwright
 * ISOLADO — próprio storage, OPFS, IndexedDB, cookies. Isso simula N
 * usuários reais em devices distintos, condição pra validar cascata de
 * propagação (#3), score (#1) e P2P/Helia entre peers.
 *
 * Cada context navega com `?dev-seed=1&as=<name>`:
 *   - `dev-seed=1` → `bootstrap.ts` popula o SQLite com fixtures
 *     determinísticos (só DEV; guard duro contra produção).
 *   - `as=<name>` → o boot assume a identidade determinística do user
 *     via `setIdentityFromNsec(NAMED_NSECS[name])`. Mesmo nsec que o
 *     seed (Marshall) gerou → npub bate em todas as camadas. §7.
 *
 * Coordenação: `NAMED_NSECS` vem de `src/lib/dev-seed/seed.ts` (Marshall).
 * Importamos a fonte única — não duplicamos chaves aqui — pra garantir
 * que `setupUser('alice')` resolva pro MESMO nsec do seed.
 *
 * NÃO edita `playwright.config.ts` (Ted) — este fixture só consome o
 * `baseURL` e o browser configurados lá.
 */

import type { Browser, BrowserContext, Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { NAMED_NSECS } from '../../src/lib/dev-seed/seed'

/** Os 8 named users dirigidos por Playwright (roster Sprint N+5). */
export const NAMED_USERS = [
  'alice',
  'bob',
  'carol',
  'dave',
  'erin',
  'frank',
  'grace',
  'heidi',
] as const

export type NamedUser = (typeof NAMED_USERS)[number]

/** Resultado de `setupUser`: tudo que um teste precisa pra dirigir o user. */
export interface UserSession {
  /** Context isolado (storage/OPFS/IndexedDB próprios). Fechar no teardown. */
  context: BrowserContext
  /** Página já navegada + booted com dev-seed + identidade do user. */
  page: Page
  /** Nome canônico (lowercase). */
  name: NamedUser
  /** nsec1 determinístico do user (do seed do Marshall). */
  nsec: string
  /** npub1 derivado do nsec — pra asserts de autoria/cascata nos testes. */
  npub: string
}

/**
 * Deriva o npub1 (bech32) a partir do nsec1 do user. Determinístico —
 * mesma entrada, mesma saída (§7). Lança se o nsec for inválido pra
 * falhar cedo e barulhento no setup do teste (não silenciar).
 */
function npubFromNsec(nsec1: string): string {
  const decoded = nip19.decode(nsec1)
  if (decoded.type !== 'nsec') {
    throw new Error(`nsec inválido em NAMED_NSECS: tipo ${decoded.type}`)
  }
  const pubHex = getPublicKey(decoded.data as Uint8Array)
  return nip19.npubEncode(pubHex)
}

/**
 * Cria um BrowserContext isolado pra um named user, navega pro app em
 * modo dev-seed assumindo a identidade do user, e espera o boot ficar
 * pronto (badge "DEV SEED" visível = `devSeedActive` confirmado).
 *
 * @param browser  Browser do worker Playwright (`browser` fixture).
 * @param name     Named user (Alice..Heidi), case-insensitive.
 * @returns        Sessão pronta pra dirigir — lembrar de `context.close()`.
 *
 * @example
 *   const alice = await setupUser(browser, 'alice')
 *   await alice.page.getByRole('button', { name: /drift/i }).click()
 *   await alice.context.close()
 */
export async function setupUser(browser: Browser, name: string): Promise<UserSession> {
  const canonical = name.toLowerCase() as NamedUser
  if (!NAMED_USERS.includes(canonical)) {
    throw new Error(
      `setupUser: "${name}" não é named user. Válidos: ${NAMED_USERS.join(', ')}`,
    )
  }

  const nsec = NAMED_NSECS[canonical]
  if (!nsec) {
    throw new Error(
      `setupUser: NAMED_NSECS["${canonical}"] vazio — Marshall ainda não ` +
        'preencheu os fixtures do seed (src/lib/dev-seed/seed.ts).',
    )
  }
  const npub = npubFromNsec(nsec)

  // Context isolado: storageState default (vazio) garante OPFS/IndexedDB
  // limpos por user. Sem compartilhamento de estado entre named users.
  const context = await browser.newContext()
  const page = await context.newPage()

  // baseURL vem de playwright.config.ts (Ted). Path relativo + query.
  // dev-seed=lite (~200 eventos) em vez de =1 (~2730): o drain floor do
  // INSERT serializado faz full levar minutos (> timeout 45s) → boot nunca
  // fica interativo no E2E. lite drena em segundos e PRESERVA tudo que as
  // suites de validação asseram: cascata A→B→C→D, 3 alvos §26, geo BR/EU/JP,
  // ≥1 post moderado + ≥1 positivo, follows. Batch-INSERT (backlog) é o fix
  // de raiz que libera full no E2E.
  await page.goto(`/?dev-seed=lite&as=${canonical}`)

  // Boot ready = badge "DEV SEED" no header (devSeedActive=true). Espera
  // explícita evita race entre navegação e materialização do SQLite.
  await page.getByText('dev seed', { exact: true }).waitFor({ state: 'visible' })

  // CRÍTICO: o badge aparece no INÍCIO do seed; o fix de bug #4 deixa a UI
  // interativa DURANTE o drain (batches com yield). Os asserts leem o SQLite
  // → precisam do seed ASSENTADO: drain completo + recalcAllScores +
  // invalidateFeed. Sem isto, contagens/scores variam por boot (race).
  await waitSeedSettled(page)

  return { context, page, name: canonical, nsec, npub }
}

/**
 * Espera o dev-seed ASSENTAR completamente: drain de todos os eventos +
 * recalcAllScores + invalidateFeed. Sinal robusto = COUNT(*) de posts ESTÁVEL
 * entre leituras consecutivas (drain terminou de inserir) + um buffer pro
 * recalc/feed-resort que rodam logo após o drain. Sem depender de elemento da
 * UI (a UI fica interativa antes do drain terminar — bug #4 fix).
 */
export async function waitSeedSettled(page: Page): Promise<void> {
  // Sinal DETERMINÍSTICO de fim do seed: seed.ts marca
  // `window.__driftSeedMeta.drained = true` SÓ após drain + recalcAllScores +
  // invalidateFeed. Contagem de posts engana — o drain rende entre batches
  // (yield) e um stall >1s faz leituras iguais parecerem "estável" no meio do
  // caminho (causa de 63 vs 61 entre boots). Esperar a flag elimina o race.
  await page.waitForFunction(
    () =>
      (window as unknown as { __driftSeedMeta?: { drained?: boolean } }).__driftSeedMeta
        ?.drained === true,
    undefined,
    { timeout: 60_000 },
  )
  // Buffer curto pro feed store re-ordenar por score após o invalidateFeed.
  await page.waitForTimeout(300)
}

/**
 * Ground-truth do seed ATUAL (ancorado), publicado por `seed.ts` em
 * `window.__driftSeedMeta`. Como a timeline é ancorada ao Date.now do boot,
 * os event ids variam por boot — as suites leem os ids REAIS daqui em vez de
 * recomputá-los da forma pura (`getSeedEvents()`, ids não-ancorados). §7: a
 * forma pura segue determinística pros LOCK_VIA_TEST; este hook é só o mapa
 * ground-truth do que foi ingerido neste boot.
 */
export interface SeedMeta {
  cascadePostId: string
  reportedTargetIds: string[]
  anchorSec: number
  mode: string
}

export async function getSeedMeta(page: Page): Promise<SeedMeta> {
  await page.waitForFunction(
    () => (window as unknown as { __driftSeedMeta?: unknown }).__driftSeedMeta != null,
    undefined,
    { timeout: 30_000 },
  )
  return page.evaluate(
    () => (window as unknown as { __driftSeedMeta: SeedMeta }).__driftSeedMeta,
  )
}

/**
 * Atalho pra subir os 8 named users de uma vez (boot de cenário completo).
 * Cada um em context isolado. Retorna mapa indexado por nome.
 *
 * @example
 *   const users = await setupAllUsers(browser)
 *   await users.alice.page....
 *   for (const u of Object.values(users)) await u.context.close()
 */
export async function setupAllUsers(
  browser: Browser,
): Promise<Record<NamedUser, UserSession>> {
  const sessions = await Promise.all(
    NAMED_USERS.map((name) => setupUser(browser, name)),
  )
  const map = {} as Record<NamedUser, UserSession>
  for (const s of sessions) map[s.name] = s
  return map
}
