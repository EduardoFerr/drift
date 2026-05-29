/**
 * boot-interactivity.spec.ts — Bug #4 adversarial (Sprint N+5 Batch B2, Lily).
 *
 * HIPÓTESE NULA (a derrubar): "os CTAs da NavBar (MAPA / CONFIG / +) NÃO
 * respondem durante a verify-storm do boot; clicks enfileiram e disparam
 * tarde". O dev-seed processa ~3000 eventos pelo pipeline real
 * (kind→schema→verify Schnorr→persist→scheduleScoreRecalc), cada verify
 * ~1ms na main thread → potencial bloqueio.
 *
 * ─── O que esta suite MEDE (e o que descobriu sobre o framing) ───────
 *
 * Lendo o boot (App.tsx:1239): enquanto `boot.step !== 'ready'`, o app
 * renderiza `<BootView>` — a NavBar com os CTAs NEM EXISTE ainda. O badge
 * "DEV SEED" só aparece no HomeHeader (ready). E `seedDatabase()` é
 * AWAITED dentro do boot, ANTES de `ready` (bootstrap.ts). Ou seja: a
 * verify-storm acontece com o BootView na tela, não com os CTAs montados.
 *
 * Portanto a pergunta operacional do bug #4 vira DUPLA:
 *
 *   (A) TEMPO ATÉ INTERATIVIDADE — quanto a storm ATRASA o `ready` (e logo
 *       o primeiro paint dos CTAs)? dev-seed 500 posts vs. sem-seed.
 *   (B) RESPONSIVIDADE PÓS-READY — assim que os CTAs montam, o primeiro
 *       click responde rápido OU a main thread ainda está saturada com
 *       trabalho residual (score-recalc debounced drenando, startSync
 *       agendado via requestIdleCallback, render do feed de 500 posts)?
 *
 * Medimos AMBOS. (A) prova o custo da storm no caminho crítico; (B) é o
 * INP-proxy: latência click→resposta-visual, storm vs idle.
 *
 * Sem assert de "deve ser <500ms" que reprove a suite — o objetivo desta
 * rodada é ESTABELECER A BASELINE PRÉ-FIX (verdade > verde). Os números
 * vão pro console (annotations) pra B3 comparar pós-fix. Assert duro
 * único: o CTA EVENTUALMENTE responde (overlay abre) — se travar de vez,
 * aí sim é red.
 *
 * ─── Marcadores de UI usados ──────────────────────────────────────────
 *   - CTA MAPA:   button[aria-label="abrir mapa de propagação"]
 *   - CTA CONFIG: button[aria-label="abrir config"]
 *   - CTA +:      button[aria-label="criar post"]
 *   - overlay MAPA aberto:   button[aria-label="fechar mapa"]
 *   - overlay CONFIG aberto: FullPageCard de SettingsRoot (heading config)
 *   - overlay + aberto:      textarea do ComposeOverlay (placeholder legenda)
 *   - badge ready: text "dev seed" (só no modo seed); sem seed usamos os CTAs.
 */

import { test, expect, type Page, type Locator } from '@playwright/test'

/** Espera o app ficar `ready` (CTA MAPA montado) e devolve o ms desde nav. */
async function waitInteractive(page: Page): Promise<number> {
  const mapCta = page.getByRole('button', { name: 'abrir mapa de propagação' })
  await mapCta.waitFor({ state: 'visible', timeout: 45_000 })
  // performance.now() no contexto da página, relativo ao navigationStart.
  return page.evaluate(() => Math.round(performance.now()))
}

/**
 * Mede latência click→resposta-visual de um CTA. `openMarker` é o locator
 * que aparece quando o overlay abriu. Retorna ms entre click e marker
 * visível. Fecha o overlay no fim (best-effort) pra não vazar estado.
 */
async function measureCta(
  page: Page,
  ctaLabel: string,
  openMarker: () => Locator,
  closeMarkerLabel?: string,
): Promise<number> {
  const cta = page.getByRole('button', { name: ctaLabel })
  await cta.waitFor({ state: 'visible' })
  const t0 = await page.evaluate(() => performance.now())
  await cta.click()
  await openMarker().waitFor({ state: 'visible', timeout: 20_000 })
  const t1 = await page.evaluate(() => performance.now())
  // Fecha overlay (se houver botão) pra próximo CTA partir limpo.
  if (closeMarkerLabel) {
    await page
      .getByRole('button', { name: closeMarkerLabel })
      .click()
      .catch(() => {})
  }
  return Math.round(t1 - t0)
}

test.describe('boot interactivity — bug #4 baseline (pré-fix)', () => {
  test('1+2. tempo até interatividade: dev-seed (storm 500 posts) vs sem-seed', async ({
    browser,
  }) => {
    // ── Storm: dev-seed processa ~3000 eventos antes do ready ──
    const stormCtx = await browser.newContext()
    const stormPage = await stormCtx.newPage()
    await stormPage.goto('/?dev-seed=1')
    const stormInteractiveMs = await waitInteractive(stormPage)

    // ── Idle: boot normal, sem seed (SQLite vazio/cache) ──
    const idleCtx = await browser.newContext()
    const idlePage = await idleCtx.newPage()
    await idlePage.goto('/')
    const idleInteractiveMs = await waitInteractive(idlePage)

    const delta = stormInteractiveMs - idleInteractiveMs
    const verdict =
      delta > 500
        ? `STORM ATRASA interatividade em ${delta}ms (>500ms) — bug #4 (A) CONFIRMADO no caminho crítico`
        : `storm adiciona ${delta}ms ao ready (<500ms) — caminho crítico tolerável`

    test.info().annotations.push(
      { type: 'boot-interactivity', description: `ready storm=${stormInteractiveMs}ms idle=${idleInteractiveMs}ms Δ=${delta}ms` },
      { type: 'verdict-A', description: verdict },
    )
    // eslint-disable-next-line no-console
    console.log(`[bug#4 A] ready: storm=${stormInteractiveMs}ms idle=${idleInteractiveMs}ms Δ=${delta}ms → ${verdict}`)

    // Assert duro mínimo: AMBOS ficaram interativos (não travou de vez).
    expect(stormInteractiveMs).toBeGreaterThan(0)
    expect(idleInteractiveMs).toBeGreaterThan(0)

    await stormCtx.close()
    await idleCtx.close()
  })

  test('3+4. INP-proxy + 3 CTAs (MAPA/CONFIG/+): latência click→resposta storm vs idle', async ({
    browser,
  }) => {
    async function measureAllCtas(page: Page): Promise<Record<string, number>> {
      // MAPA — overlay abre com botão "fechar mapa". Lazy chunk incluso.
      const mapa = await measureCta(
        page,
        'abrir mapa de propagação',
        () => page.getByRole('button', { name: 'fechar mapa' }),
        'fechar mapa',
      )

      // CONFIG — SettingsRoot renderiza FullPageCard role="dialog"
      // aria-label="configurações"; close button aria-label="fechar
      // configurações" (FullPageCard.tsx). Marcador preciso.
      const config = await measureCta(
        page,
        'abrir config',
        () => page.getByRole('dialog', { name: 'configurações' }),
        'fechar configurações',
      )

      // + (criar post) — ComposeOverlay com textarea. Marcador: o textbox
      // (placeholder "legenda…" ou "novo drift" no título); fecha via
      // botão aria-label="cancelar" (ComposeOverlay headerRight).
      const compose = await measureCta(
        page,
        'criar post',
        () => page.getByRole('textbox').first(),
        'cancelar',
      )

      return { mapa, config, compose }
    }

    // ── STORM ──
    const stormCtx = await browser.newContext()
    const stormPage = await stormCtx.newPage()
    await stormPage.goto('/?dev-seed=1')
    await waitInteractive(stormPage)
    // NÃO esperamos a storm drenar — medimos IMEDIATAMENTE após ready,
    // que é quando o trabalho residual (score-recalc, sync idle, render
    // de 500 posts) mais contende com a main thread. Esse é o INP-proxy.
    const stormCtas = await measureAllCtas(stormPage)

    // ── IDLE ──
    const idleCtx = await browser.newContext()
    const idlePage = await idleCtx.newPage()
    await idlePage.goto('/')
    await waitInteractive(idlePage)
    const idleCtas = await measureAllCtas(idlePage)

    for (const cta of ['mapa', 'config', 'compose'] as const) {
      const s = stormCtas[cta]
      const i = idleCtas[cta]
      const delta = s - i
      const enfileira = delta > 200 || s > 500
      const note = `${cta}: storm=${s}ms idle=${i}ms Δ=${delta}ms ${
        enfileira ? '→ ENFILEIRA (bug #4 sintoma)' : '→ responde ok'
      }`
      test.info().annotations.push({ type: `cta-${cta}`, description: note })
      // eslint-disable-next-line no-console
      console.log(`[bug#4 B] ${note}`)

      // Assert duro mínimo por CTA: respondeu (latência finita > 0). A
      // magnitude é baseline documentada, não critério de reprovação
      // nesta rodada pré-fix.
      expect(s, `CTA ${cta} (storm) deveria responder`).toBeGreaterThan(0)
      expect(i, `CTA ${cta} (idle) deveria responder`).toBeGreaterThan(0)
    }

    // Resumo agregado pro relatório.
    const summary = `BUG#4 baseline pré-fix | ready+CTA medido | storm=${JSON.stringify(
      stormCtas,
    )} idle=${JSON.stringify(idleCtas)}`
    test.info().annotations.push({ type: 'bug4-summary', description: summary })
    // eslint-disable-next-line no-console
    console.log(`[bug#4 SUMMARY] ${summary}`)

    await stormCtx.close()
    await idleCtx.close()
  })
})
