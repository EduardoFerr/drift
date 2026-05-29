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

import { onNostrEvent, recalcAllScores } from '../events'
import { applyContactList } from '../follows'
import { invalidateFeed } from '../feed'
import { BOOT_BATCH_SIZE, drainInBatches } from '../scheduler'
import { buildSeedEvents, type SeedMode } from './fixtures'

// Re-export do contrato (fonte única em fixtures.ts). Lily/bootstrap
// importam `NAMED_NSECS` daqui.
export { NAMED_NSECS } from './fixtures'

let seeded = false

/**
 * Popula o banco com o conjunto determinístico de fixtures.
 *
 *  - `mode='full'` (default, `?dev-seed=1`): 8 named + 50 seed; cascata
 *    Alice→Bob→Carol→Dave; ~500 posts / ~2000 spreads / ~200 buries /
 *    ~50 reports (~2730 eventos); drena em minutos. Timestamps base
 *    1716000000.
 *  - `mode='lite'` (`?dev-seed=lite`): subconjunto fixo (~200 eventos) —
 *    boot em <15s pra validação visual rápida dos 3 mapas. Preserva a
 *    cascata, geo variado (BR/EU/Ásia), spreads espalhados no tempo,
 *    posts com imagem, buries + 3 alvos que cruzam threshold §26, follows.
 *
 * Processa eventos de domínio SEQUENCIALMENTE (ordem por created_at) —
 * preserva first-seen estável de `users.created_at` (antiguidade/peso
 * conhecidos). Cada evento passa pelo pipeline real: kind → schema →
 * persist (verify Schnorr SKIPADO no seed — ver abaixo).
 *
 * Performance (Ted+Lily 2026-05-28 → Ted+Marshall 2026-05-29):
 *
 *  1. `deferSideEffects: true` — o persist (INSERT, invariante #1) roda
 *     normal, mas os side-effects pós-persist (`scheduleScoreRecalc` +
 *     `invalidateFeed`) são SUPRIMIDOS. Sem isso, ~2730 eventos disparavam
 *     ~500 timers de recalc avulsos (1 por post) + invalidate thrash. O
 *     score é materializado UMA vez no fim via `recalcAllScores()` + 1
 *     `invalidateFeed()`.
 *
 *  2. `skipVerify: true` — pula o verify Schnorr, o passo CARO do
 *     pipeline. Mesmo após o defer (1), o drain ainda travava em ~13min
 *     (~3.4 ev/s): o custo dominante não era recalc, era o postMessage
 *     round-trip SERIALIZADO ao `verify.worker` (~20ms/evento × 2730).
 *     Os fixtures são SELF-SIGNED (`finalizeEvent` em fixtures.ts) —
 *     verificar Schnorr de evento que nós mesmos assinamos é desperdício
 *     puro. DEV-gate duro no `onNostrEvent`: em prod skipVerify é ignorado
 *     (verify sempre roda); sync real da rede NUNCA passa a flag.
 *     Invariante #5 protege contra eventos UNTRUSTED — seed DEV é trusted.
 *
 * Resultado: drain vira só kind/schema check + INSERT (~13min → poucos
 * segundos). Determinismo §7 intacto: nem verify nem o ponto de recalc
 * tocam os dados persistidos — scoring é agregação idempotente do estado,
 * bulk no fim = mesmo resultado que recalc por evento com verify.
 *
 * Guard de sessão: re-chamadas no mesmo runtime são noop (o pipeline já
 * é idempotente via INSERT OR IGNORE, mas evitamos reprocessar ~3000
 * verifies à toa). Idempotente, seguro pra chamar 2× no mesmo boot.
 */
export async function seedDatabase(
  mode: SeedMode = 'full',
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (seeded) return
  seeded = true

  // Âncora de tempo (anti-staleness): re-baseia a timeline do seed pra que o
  // evento mais novo caia ~agora. Sem isso, TS_BASE (~mai/2024) congelado faz
  // todo post envelhecer com o relógio real → ages de ~745d + score 0.000 +
  // feed morto. `Date.now()` aqui é legítimo: seed.ts é a camada DEV de
  // ingestão (já impura — chama onNostrEvent); fixtures.ts continua §7-puro
  // (os LOCKs chamam buildSeedEvents() sem âncora). Trade-off conhecido: o
  // conjunto ancorado re-assina a cada boot (não cacheável por timestamp),
  // mas lite assina em ~2s. Determinismo cross-run NÃO é exigido pro seed
  // ao vivo — só pros LOCK_VIA_TEST (que usam a forma pura).
  const nowAnchorSec = Math.floor(Date.now() / 1000)
  const { domain, contactLists } = buildSeedEvents(mode, nowAnchorSec)

  // Contact lists primeiro: follow-graph disponível antes do feed render.
  for (const ev of contactLists) {
    await applyContactList(ev)
  }

  // Domain events em ordem cronológica (first-seen estável). Processados
  // em batches com yield ao main thread entre eles (bug #4): ~3000 eventos
  // num `for` apertado bloqueavam o boot ~2s, atrasando `step:'ready'` e o
  // primeiro paint dos CTAs. drainInBatches preserva a ORDEM (first-seen
  // estável) e o pipeline cheap→caro de cada evento (invariante #5) — o
  // yield acontece só no boundary entre batches. §7 intacto: INSERT OR
  // IGNORE + scoring puro → score final idêntico independente do
  // espaçamento temporal.
  //
  // `onProgress` (opcional) reporta done/total pra BootView mostrar
  // progresso honesto durante o catch-up em vez de uma tela morta.
  const total = domain.length
  let done = 0
  onProgress?.(0, total)
  await drainInBatches(domain, async (ev) => {
    await onNostrEvent(ev, { deferSideEffects: true, skipVerify: true })
    done++
    // Reporta no boundary do batch (a cada BOOT_BATCH_SIZE) ou no fim, pra
    // não floodar a store Zustand com ~3000 setStates.
    if (done % BOOT_BATCH_SIZE === 0 || done === total) onProgress?.(done, total)
  })

  // Side-effects adiados: materializa TODOS os scores de uma vez (recalc
  // bulk + moderação §26 na ordem correta) e dispara 1 invalidateFeed.
  // Substitui o antigo `setTimeout(200)` + N timers de recalc avulsos —
  // determinismo §7 idêntico, drain ~26× mais rápido.
  await recalcAllScores()
  invalidateFeed()
}

/** Reset do guard de sessão — útil em tests / re-seed manual. */
export function _resetSeedGuard(): void {
  seeded = false
}
