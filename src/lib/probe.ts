/**
 * Probe anti-eclipse — manifesto §20.
 *
 * Relays maliciosos podem mostrar um subconjunto censurado da rede ao
 * cliente, criando uma "bolha falsa". Defesa: a cada N minutos,
 * pegamos K eventos conhecidos do nosso SQLite local e perguntamos a
 * cada relay se ele tem. Relay que esconde sistematicamente eventos
 * conhecidos é flagado como suspeito.
 *
 * **Limites honestos** (manifesto §20):
 *  - Probe NÃO detecta Sybil adaptativo com mimicry (relay malicioso
 *    pode entregar os eventos de probe e esconder os outros).
 *  - É defesa de baseline contra relay maliciosamente passivo, não
 *    contra adversário inteligente. Path diversity (Fase 6, transport
 *    WebRTC) cobre o resto.
 *  - Probe gasta bandwidth — debounce 30min por relay, escolha
 *    aleatória de eventos. Não rodar mais agressivo que isso sem
 *    justificativa concreta.
 */

import { db } from './db'
import { pool } from './transport/wss'
import { activeReadRelays, recordRelayError } from './relays'
import { DRIFT_KIND } from '../config/constants'

const PROBE_INTERVAL_MS = 30 * 60 * 1000 // 30min
/** Quantos eventos conhecidos checamos por probe — pequeno, só um sample. */
const PROBE_SAMPLE_SIZE = 5
/** Timeout por relay durante o probe — pequeno, é só pra ver se entrega. */
const PROBE_TIMEOUT_MS = 4000

// ─── Estado ──────────────────────────────────────────────────────────

interface ProbeResult {
  relay: string
  asked: number
  got: number
  /** Razão da suspeita, se aplicável. */
  flag: 'ok' | 'incomplete' | 'silent' | 'error'
  detail?: string
  at: number
}

const lastResults = new Map<string, ProbeResult>()

export function getProbeResults(): ProbeResult[] {
  return Array.from(lastResults.values())
}

// ─── Execução ────────────────────────────────────────────────────────

let probeTimer: ReturnType<typeof setInterval> | null = null

/**
 * Inicia probe periódico. Idempotente. Chamado em `bootstrap.ts`
 * depois do boot ficar `ready`.
 *
 * Primeira corrida acontece após `PROBE_INTERVAL_MS`, não imediatamente
 * — boot já pesado.
 */
export function startProbe(): void {
  if (probeTimer) return
  probeTimer = setInterval(() => {
    void runProbe().catch((err) => {
      console.error('[probe] falha:', err)
    })
  }, PROBE_INTERVAL_MS)
}

export function stopProbe(): void {
  if (probeTimer) {
    clearInterval(probeTimer)
    probeTimer = null
  }
}

/**
 * Roda 1 ciclo de probe contra cada relay ativo.
 *
 * 1. Sample de PROBE_SAMPLE_SIZE eventos do SQLite (mais espalhados,
 *    não os mais recentes — adversário pode ter visto e cacheado os
 *    novos sem precisar conhecer a rede inteira).
 * 2. Pra cada relay, pergunta `{ ids: [...] }` com timeout.
 * 3. Conta quantos voltaram. Flagueia.
 *
 * @returns Map de relay → resultado.
 */
export async function runProbe(): Promise<Map<string, ProbeResult>> {
  const sampleIds = await pickRandomKnownEventIds(PROBE_SAMPLE_SIZE)
  if (sampleIds.length === 0) {
    // Sem amostra suficiente — primeira boot, banco vazio. Não roda.
    return lastResults
  }

  const relays = activeReadRelays()
  const now = Date.now()

  await Promise.all(
    relays.map(async (relay) => {
      const result = await probeRelay(relay, sampleIds, now)
      lastResults.set(relay, result)
      if (result.flag === 'silent' || result.flag === 'incomplete') {
        void recordRelayError(
          relay,
          `probe ${result.flag}: ${result.got}/${result.asked} eventos conhecidos`,
        )
      }
    }),
  )

  return lastResults
}

async function pickRandomKnownEventIds(n: number): Promise<string[]> {
  // Sample de `posts.id` — que é `event.id` hex 64 (NIP-01).
  // Posts moderados (-999) excluímos pra não disparar probe baseado em
  // evento que o relay legitimamente pode ter recusado.
  const rows = await db.exec<{ id: string }>(
    `SELECT id FROM posts
     WHERE score > -999
     ORDER BY RANDOM()
     LIMIT ?`,
    [n],
  )
  return rows.map((r) => r.id)
}

async function probeRelay(
  relay: string,
  ids: string[],
  startedAt: number,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let resolved = false
    const seen = new Set<string>()

    const finish = (flag: ProbeResult['flag'], detail?: string) => {
      if (resolved) return
      resolved = true
      try {
        sub.close()
      } catch {
        /* noop */
      }
      const result: ProbeResult = {
        relay,
        asked: ids.length,
        got: seen.size,
        flag,
        ...(detail !== undefined ? { detail } : {}),
        at: startedAt,
      }
      resolve(result)
    }

    const sub = pool.subscribeMany(
      [relay],
      {
        // posts.id === event.id (NIP-01). Filtro `ids` é o jeito padrão de
        // perguntar "esses eventos específicos existem aqui?" — não precisa
        // de tag custom, e nostr-tools valida hex 64 antes de mandar.
        ids,
        kinds: [DRIFT_KIND.POST],
      },
      {
        onevent: (event) => {
          if (event.id) seen.add(event.id)
        },
        oneose: () => {
          if (seen.size === 0) finish('silent')
          else if (seen.size < ids.length) finish('incomplete')
          else finish('ok')
        },
      },
    )

    setTimeout(() => {
      if (resolved) return
      // Sem oneose dentro do timeout — relay travou ou está incompleto
      if (seen.size === 0) finish('error', 'timeout sem resposta')
      else if (seen.size < ids.length) finish('incomplete', 'timeout')
      else finish('ok')
    }, PROBE_TIMEOUT_MS)
  })
}
