/**
 * Dev-seed — popula o SQLite local com fixtures determinísticos pra
 * validação E2E multi-user (Sprint N+5). NUNCA roda em produção:
 * `bootstrap.ts` só chama `seedDatabase()` sob `import.meta.env.DEV`
 * E `?dev-seed=1` na URL.
 *
 * Contrato com a camada de boot (Lily) — este módulo expõe:
 *   - `seedDatabase(): Promise<void>` — idempotente, popula via
 *     `onNostrEvent()` (invariante #1: única porta de INSERT em domínio).
 *   - `NAMED_NSECS: Record<string, string>` — nsec1 determinístico dos
 *     8 named users (Alice..Heidi), derivado de seed string fixa. A
 *     fixture Playwright (`e2e/fixtures/users.ts`) importa daqui pra
 *     garantir que `setupUser('alice')` resolva pro MESMO nsec que o
 *     seed gerou. Manifesto §7 (determinismo).
 *
 * ─── Invariante #1 (CLAUDE.md) preservado ───────────────────────────
 *
 * Eventos de domínio (POST/SPREAD/BURY/REPORT) entram EXCLUSIVAMENTE
 * por `onNostrEvent()` — mesma porta que o subscribe real. O seed NÃO
 * faz INSERT direto em `posts/spreads/buries/reports`. O estado
 * materializado fica bit-idêntico ao que a rede produziria com os mesmos
 * eventos (score recalc, moderação §26, weight — tudo via pipeline
 * canônico). Follows (kind 3 NIP-02) entram por `applyContactList` —
 * out-of-band pro ranking (§24), exatamente como `sync.ts` faz.
 */

import { onNostrEvent } from '../events'
import { applyContactList } from '../follows'
import { invalidateFeed } from '../feed'
import { getSeedEvents } from './fixtures'

// Re-export do contrato (fonte única em fixtures.ts). Lily/bootstrap
// importam `NAMED_NSECS` daqui.
export { NAMED_NSECS } from './fixtures'

let seeded = false

/**
 * Popula o banco com o conjunto determinístico de fixtures (8 named +
 * 50 seed; cascata Alice→Bob→Carol→Dave; ~500 posts / ~2000 spreads /
 * ~200 buries / ~50 reports; timestamps base 1716000000).
 *
 * Processa eventos de domínio SEQUENCIALMENTE (ordem por created_at) —
 * preserva first-seen estável de `users.created_at` (antiguidade/peso
 * conhecidos) e evita rajada concorrente no verify worker. Cada evento
 * passa pelo pipeline real: kind → schema → verify Schnorr → persist →
 * scheduleScoreRecalc → invalidateFeed.
 *
 * Guard de sessão: re-chamadas no mesmo runtime são noop (o pipeline já
 * é idempotente via INSERT OR IGNORE, mas evitamos reprocessar ~3000
 * verifies à toa). Idempotente, seguro pra chamar 2× no mesmo boot.
 */
export async function seedDatabase(): Promise<void> {
  if (seeded) return
  seeded = true

  const { domain, contactLists } = getSeedEvents()

  // Contact lists primeiro: follow-graph disponível antes do feed render.
  for (const ev of contactLists) {
    await applyContactList(ev)
  }

  // Domain events em ordem cronológica (first-seen estável).
  for (const ev of domain) {
    await onNostrEvent(ev)
  }

  // Recalc de score é debounced (100ms) por postId em events.ts; janela
  // curta pra drenar antes do invalidateFeed final, garantindo que o feed
  // inicial já reflita scores materializados.
  await new Promise((r) => setTimeout(r, 200))
  invalidateFeed()
}

/** Reset do guard de sessão — útil em tests / re-seed manual. */
export function _resetSeedGuard(): void {
  seeded = false
}
