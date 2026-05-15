/**
 * Relay health tracker — degradação adaptativa de relays flaky.
 *
 * Problema: a seed list pode ter um relay temporariamente fora do ar
 * (ex: `wss://relay.damus.io` retornando 502). Sem rastreamento de
 * saúde, cada boot tenta o relay, falha visivelmente no console, e
 * polui logs / penaliza Lighthouse Best Practices. Pior: o cliente
 * insiste em pedir eventos a um relay que não responde, atrasando
 * o fetch da seed real.
 *
 * Solução: contador de falhas consecutivas. Após N=3 falhas seguidas,
 * marca o relay como **demoted** por T=15min (backoff exponencial:
 * 15 → 30 → 60min, cap em 1h). Durante demotion, `activeReadRelays()`
 * e `activeWriteRelays()` filtram o relay. Probe periódico
 * (`probe.ts`) pode reabilitar antes do timeout se o relay responder
 * a um sample de eventos.
 *
 * **Threat model (manifesto §20 anti-eclipse):**
 *
 *  - Health é **local por device**. Nenhum sinal é compartilhado entre
 *    clientes. Atacante que derruba 1 relay popular não consegue
 *    "demotar globalmente" — só envenena o estado local do cliente que
 *    fala com aquele relay. Outros clientes formam opinião própria.
 *
 *  - Relay malicioso que sempre responde mas filtra eventos (Sybil
 *    adaptativo) NÃO é detectado por este módulo — falha consecutiva
 *    aqui significa "não conecta" ou "deu erro de protocolo". O probe
 *    em `probe.ts` é a defesa complementar: checa **round-trip de REQ**
 *    com sample de eventos conhecidos, não só `open` de WebSocket.
 *    Relay que abre WSS mas devolve subset filtrado vira `silent`/
 *    `incomplete` no probe, e isso conta como falha (registrado via
 *    `recordRelayError` → este módulo incrementa fails).
 *
 *  - **Anti-eclipse residual**: filtrar relays demoted poderia, no
 *    pior caso, deixar o cliente com 0 relays ativos (todos demoted
 *    simultaneamente). `activeReadRelays`/`activeWriteRelays` em
 *    `relays.ts` garantem fallback — ver `filterDemoted` abaixo, que
 *    SEMPRE preserva pelo menos 1 relay mesmo demoted (priorizando o
 *    de menor `demotedUntil`). Manifesto §20: cliente nunca pode ficar
 *    isolado por self-config.
 *
 * Estado vive em **memória + SQLite** (colunas `consecutive_fails`,
 * `demoted_until` em `relays_user`). Memória é hot-path; SQLite é
 * durabilidade entre boots. Sync acontece no read path (lazy load) e
 * write path (cada record... call).
 *
 * Funções abaixo são **puras** (sem `Date.now()` implícito) pra ser
 * testáveis. Manifesto §7 (determinismo) — mesmo input, mesma saída.
 */

/** Após N falhas consecutivas, relay vira demoted. */
export const DEMOTE_THRESHOLD = 3

/** Backoff inicial (15min) — janela curta o suficiente pra recuperar de blip. */
export const DEMOTE_BASE_MS = 15 * 60 * 1000

/** Cap do backoff (1h) — relay morto fica out por 1h max antes de retry. */
export const DEMOTE_CAP_MS = 60 * 60 * 1000

/** Estado in-memory de um relay. Mirror do que vive em `relays_user`. */
export interface RelayHealth {
  url: string
  /** Falhas consecutivas. Reset pra 0 em sucesso. */
  consecutiveFails: number
  /** Última falha (ms epoch); null se nunca falhou desde boot. */
  lastFailureAt: number | null
  /** Último sucesso (ms epoch); null se nunca teve sucesso. */
  lastSuccessAt: number | null
  /** Demoted até este ms epoch. 0 = não demoted. */
  demotedUntil: number
}

export type RelayStatus = 'online' | 'demoted' | 'unknown'

/**
 * Calcula o backoff pra N-ésima demotion consecutiva.
 *
 * fails=3 → 15min (base)
 * fails=4 → 30min
 * fails=5 → 60min (cap)
 * fails=6+ → 60min (cap)
 *
 * Pura: independe de relógio. Usada no apply de `recordFailure`.
 */
export function backoffMs(consecutiveFails: number): number {
  if (consecutiveFails < DEMOTE_THRESHOLD) return 0
  const exponent = consecutiveFails - DEMOTE_THRESHOLD
  const ms = DEMOTE_BASE_MS * Math.pow(2, exponent)
  return Math.min(ms, DEMOTE_CAP_MS)
}

/**
 * Aplica um sucesso ao state. Reset de fails e demote.
 *
 * Pura — devolve novo state, não muta.
 */
export function applySuccess(prev: RelayHealth, now: number): RelayHealth {
  return {
    ...prev,
    consecutiveFails: 0,
    lastSuccessAt: now,
    demotedUntil: 0,
  }
}

/**
 * Aplica uma falha ao state. Incrementa fails e calcula novo
 * `demotedUntil` se cruzou o threshold.
 *
 * Pura — devolve novo state, não muta.
 */
export function applyFailure(prev: RelayHealth, now: number): RelayHealth {
  const consecutiveFails = prev.consecutiveFails + 1
  const backoff = backoffMs(consecutiveFails)
  const demotedUntil = backoff > 0 ? now + backoff : prev.demotedUntil
  return {
    ...prev,
    consecutiveFails,
    lastFailureAt: now,
    demotedUntil,
  }
}

/**
 * `true` se o relay está demoted no instante `now`.
 * Pura.
 */
export function isDemoted(state: RelayHealth, now: number): boolean {
  return state.demotedUntil > now
}

/** Status legível pra UI/tests. Pura. */
export function statusOf(state: RelayHealth, now: number): RelayStatus {
  if (isDemoted(state, now)) return 'demoted'
  if (state.lastSuccessAt !== null) return 'online'
  return 'unknown'
}

/**
 * Filtra `urls` removendo as demoted no instante `now`.
 *
 * **Garantia anti-eclipse**: se TODAS as urls estão demoted, devolve
 * pelo menos 1 (a com menor `demotedUntil` — vai re-tentar mais cedo).
 * Manifesto §20 — cliente nunca pode ficar isolado por self-config.
 *
 * `getHealth(url)` retorna `null` pra urls sem state conhecido — tratadas
 * como online (unknown ≠ demoted).
 *
 * Pura.
 */
export function filterDemoted(
  urls: readonly string[],
  getHealth: (url: string) => RelayHealth | null,
  now: number,
): string[] {
  if (urls.length === 0) return []
  const live: string[] = []
  const demoted: { url: string; until: number }[] = []
  for (const url of urls) {
    const h = getHealth(url)
    if (h && isDemoted(h, now)) {
      demoted.push({ url, until: h.demotedUntil })
    } else {
      live.push(url)
    }
  }
  if (live.length > 0) return live
  // Tudo demoted — devolve o que vai re-tentar mais cedo. Sem isso, o
  // cliente ficaria isolado de toda a rede em caso de falha em massa
  // (e.g., outage de CDN regional afetando todos os relays seed).
  demoted.sort((a, b) => a.until - b.until)
  return [demoted[0]!.url]
}

// ─── Store in-memory ─────────────────────────────────────────────────

const memory = new Map<string, RelayHealth>()

function blankState(url: string): RelayHealth {
  return {
    url,
    consecutiveFails: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    demotedUntil: 0,
  }
}

/** Snapshot do state de um relay. `null` se nunca foi tocado. */
export function getHealth(url: string): RelayHealth | null {
  return memory.get(url) ?? null
}

/** Snapshot de todos os states. Cópia rasa — pode iterar livre. */
export function allHealth(): RelayHealth[] {
  return Array.from(memory.values())
}

/**
 * Hidrata o state in-memory a partir de rows do banco. Chamado uma vez
 * no boot por `relays.ts:loadRelays`.
 */
export function hydrateHealth(
  rows: ReadonlyArray<{
    url: string
    consecutive_fails: number | null
    demoted_until: number | null
    last_ok_at: number | null
    last_err_at: number | null
  }>,
): void {
  memory.clear()
  for (const r of rows) {
    memory.set(r.url, {
      url: r.url,
      consecutiveFails: r.consecutive_fails ?? 0,
      demotedUntil: r.demoted_until ?? 0,
      lastSuccessAt: r.last_ok_at,
      lastFailureAt: r.last_err_at,
    })
  }
}

/**
 * Registra sucesso. Retorna novo state pra caller persistir.
 *
 * Side-effect: muta `memory`. Persistência fica a cargo do caller
 * (em `relays.ts` → `recordRelayOk` faz UPDATE no banco).
 */
export function noteSuccess(url: string, now: number): RelayHealth {
  const prev = memory.get(url) ?? blankState(url)
  const next = applySuccess(prev, now)
  memory.set(url, next)
  return next
}

/**
 * Registra falha. Retorna novo state pra caller persistir.
 */
export function noteFailure(url: string, now: number): RelayHealth {
  const prev = memory.get(url) ?? blankState(url)
  const next = applyFailure(prev, now)
  memory.set(url, next)
  return next
}

/**
 * Reset manual — usado por probe quando relay volta a responder. Trata
 * como sucesso explicito.
 */
export function clearDemotion(url: string, now: number): RelayHealth {
  return noteSuccess(url, now)
}

/** **Test-only**: limpa state in-memory. Não usar em runtime. */
export function _resetHealthForTests(): void {
  memory.clear()
}
