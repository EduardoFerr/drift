/**
 * Verificação das provas OpenTimestamps (NIP-03) recebidas → âncoras de
 * antiguidade (`ots_anchors`), consumidas por `ranking.ts`.
 *
 * Fluxo: `events.ts` persiste cada kind 1040 em `ots_proofs` como
 * 'pending' e chama `scheduleOtsVerification`. Aqui, fora do caminho
 * quente:
 *   1. resolve o AUTOR do evento carimbado (local; senão busca o evento
 *      por id na rede e verifica a assinatura Schnorr);
 *   2. confere a prova contra o header do bloco Bitcoin (≥2 exploradores
 *      concordando, cache em `btc_headers`);
 *   3. grava a âncora (o bloco mais ANTIGO vence) e agenda recomputação.
 *
 * Exceção autorizada ao invariante #1 (única porta de escrita = events.ts),
 * na mesma categoria da moderação/ranking: `ots_anchors` não é evento da
 * rede, é o RESULTADO derivado de verificar um. A prova crua só entra por
 * `onNostrEvent`.
 *
 * Falhas transitórias (rede, explorador fora) mantêm 'pending' com
 * `checked_at` — nova tentativa depois de `RETRY_MS`. Prova que não
 * confere com o Bitcoin vira 'invalid' e nunca mais é processada.
 *
 * Privacidade (§28): consultar exploradores revela IP + altura de bloco.
 * Em `network_mode` ≠ clearnet nada é consultado (a prova fica pendente);
 * a âncora daquela identidade simplesmente não conta neste cliente.
 */

import { db } from './db'
import { orchestrator } from './transport/orchestrator'
import { verifyEventAsync } from './verify'
import { base64ToBytes, hexToBytes, parseOtsFile } from './ots'
import { fetchBitcoinBlockHeader, verifyOtsBitcoin } from './ots-client'
import type { SignedEvent } from '../types/nostr'

const BATCH = 50
const RETRY_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const DEBOUNCE_MS = 500

interface ProofRow {
  proof_event_id: string
  target_event_id: string
  proof_b64: string
}

type HeaderLookup = (height: number) => Promise<{ merkleRoot: string; time: number }>

export interface VerifyOptions {
  nowMs?: number
  /** Injeção pra teste. Default: cache SQLite + `fetchBitcoinBlockHeader`. */
  getHeader?: HeaderLookup
  /** Injeção pra teste. Default: local + busca por id na rede. */
  resolveAuthor?: (eventId: string) => Promise<string | null>
  /** Default: `network_mode === 'clearnet'`. */
  networkAllowed?: boolean
}

let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<number> | null = null

export function scheduleOtsVerification(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void verifyPendingProofs().catch((err) => console.warn('[ots] verificação falhou:', err))
  }, DEBOUNCE_MS)
}

/**
 * Processa até `BATCH` provas pendentes. Retorna quantas âncoras novas
 * (ou mais antigas) foram gravadas. Serializado.
 */
export async function verifyPendingProofs(opts: VerifyOptions = {}): Promise<number> {
  if (running) return running
  running = run(opts).finally(() => {
    running = null
  })
  return running
}

async function run(opts: VerifyOptions): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now()
  const networkAllowed = opts.networkAllowed ?? (await isClearnet())
  const getHeader = opts.getHeader ?? (networkAllowed ? cachedHeader : offlineHeader)
  const resolveAuthor = opts.resolveAuthor ?? ((id: string) => resolveEventAuthor(id, networkAllowed))

  const rows = await db.exec<ProofRow>(
    `SELECT proof_event_id, target_event_id, proof_b64 FROM ots_proofs
     WHERE status = 'pending' AND (checked_at IS NULL OR checked_at < ?)
     ORDER BY proof_event_id LIMIT ?`,
    [nowMs - RETRY_MS, BATCH],
  )

  let anchored = 0
  for (const row of rows) {
    const author = await resolveAuthor(row.target_event_id)
    if (!author) {
      await markChecked(row.proof_event_id, nowMs)
      continue
    }

    let result: { height: number; time: number } | null
    try {
      const file = parseOtsFile(base64ToBytes(row.proof_b64))
      result = await verifyOtsBitcoin(file, hexToBytes(row.target_event_id), { getHeader })
    } catch (err) {
      // Parse inválido é definitivo; erro de rede é transitório.
      if (err instanceof Error && err.name === 'OtsParseError') {
        await markStatus(row.proof_event_id, 'invalid', nowMs)
      } else {
        await markChecked(row.proof_event_id, nowMs)
      }
      continue
    }
    if (!result) {
      await markStatus(row.proof_event_id, 'invalid', nowMs)
      continue
    }

    await db.run(
      `INSERT INTO ots_anchors (target_event_id, author_pub, block_height, block_time, proof_event_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(target_event_id) DO UPDATE SET
         block_height   = excluded.block_height,
         block_time     = excluded.block_time,
         proof_event_id = excluded.proof_event_id
       WHERE excluded.block_time < ots_anchors.block_time`,
      [row.target_event_id, author, result.height, result.time, row.proof_event_id],
    )
    await markStatus(row.proof_event_id, 'verified', nowMs)
    anchored++
  }

  if (anchored > 0) {
    const { recalcAllScores } = await import('./events')
    await recalcAllScores()
  }
  return anchored
}

async function markChecked(proofId: string, nowMs: number): Promise<void> {
  await db.run(`UPDATE ots_proofs SET checked_at = ? WHERE proof_event_id = ?`, [nowMs, proofId])
}

async function markStatus(proofId: string, status: 'verified' | 'invalid', nowMs: number): Promise<void> {
  await db.run(`UPDATE ots_proofs SET status = ?, checked_at = ? WHERE proof_event_id = ?`, [
    status,
    nowMs,
    proofId,
  ])
}

async function isClearnet(): Promise<boolean> {
  const { getPrefs } = await import('./prefs')
  return (getPrefs().network_mode ?? 'clearnet') === 'clearnet'
}

const offlineHeader: HeaderLookup = async () => {
  throw new Error('rede desabilitada pra OTS (network_mode ≠ clearnet)')
}

/** Header com cache em `btc_headers` — Bitcoin não reescreve blocos enterrados. */
const cachedHeader: HeaderLookup = async (height) => {
  const hit = await db.get<{ merkle_root: string; time: number }>(
    `SELECT merkle_root, time FROM btc_headers WHERE height = ?`,
    [height],
  )
  if (hit) return { merkleRoot: hit.merkle_root, time: hit.time }
  const header = await fetchBitcoinBlockHeader(height)
  await db.run(`INSERT OR IGNORE INTO btc_headers (height, merkle_root, time) VALUES (?, ?, ?)`, [
    height,
    header.merkleRoot,
    header.time,
  ])
  return header
}

/**
 * Autor do evento carimbado. Primeiro nas tabelas locais (já verificadas
 * por `onNostrEvent`); senão pede o evento por id e verifica a assinatura
 * aqui mesmo — necessário porque spreads/buries guardam só a ação MAIS
 * RECENTE (LWW), então o evento carimbado pode ser uma ação antiga que
 * não está mais em tabela nenhuma.
 */
async function resolveEventAuthor(eventId: string, networkAllowed: boolean): Promise<string | null> {
  const local = await db.get<{ author: string }>(
    `SELECT author_pub AS author FROM posts WHERE id = ?
     UNION ALL SELECT spreader_pub FROM spreads WHERE event_id = ?
     UNION ALL SELECT burier_pub FROM buries WHERE event_id = ?
     UNION ALL SELECT author_pub FROM comments WHERE id = ?
     LIMIT 1`,
    [eventId, eventId, eventId, eventId],
  )
  if (local) return local.author
  if (!networkAllowed) return null
  return fetchAuthorById(eventId)
}

function fetchAuthorById(eventId: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    let unsubscribe: (() => void) | null = null
    const finish = (v: string | null) => {
      if (done) return
      done = true
      unsubscribe?.()
      resolve(v)
    }
    unsubscribe = orchestrator.subscribe(
      { ids: [eventId] },
      {
        onevent: (event: SignedEvent) => {
          if (event.id !== eventId) return
          void verifyEventAsync(event).then((ok) => {
            if (ok) finish(event.pubkey)
          })
        },
        oneose: () => setTimeout(() => finish(null), 1_000),
      },
    )
    if (done) unsubscribe?.()
    setTimeout(() => finish(null), FETCH_TIMEOUT_MS)
  })
}
