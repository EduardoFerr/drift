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
 * Falhas transitórias (rede, explorador fora, autor não encontrado)
 * mantêm 'pending' com backoff exponencial (10 min × 2^tentativas); após
 * `MAX_ATTEMPTS` viram 'unresolved' e saem da fila. Prova malformada, com
 * attestations demais, altura impossível ou que não confere com o
 * Bitcoin vira 'invalid' e nunca mais é processada.
 *
 * Privacidade (§28): consultar exploradores revela IP + altura de bloco.
 * Em `network_mode` ≠ clearnet nada é consultado (a prova fica pendente);
 * a âncora daquela identidade simplesmente não conta neste cliente.
 */

import { db } from './db'
import { orchestrator } from './transport/orchestrator'
import { verifyEventAsync } from './verify'
import { base64ToBytes, collectLeaves, hexToBytes, parseOtsFile } from './ots'
import { fetchBitcoinBlockHeader, fetchBitcoinTipHeight, verifyOtsBitcoin } from './ots-client'
import type { SignedEvent } from '../types/nostr'

const BATCH = 50
/** Passadas por execução: drena a fila sem esperar o tick horário. */
const MAX_PASSES = 20
/** Verificações simultâneas (rede: busca de autor e headers). */
const CONCURRENCY = 4
/** Primeira re-tentativa após 10 min; dobra a cada falha… */
const RETRY_BASE_MS = 10 * 60 * 1000
/**
 * …até ~10,7 h (2^6). Sem desistência definitiva: uma queda longa de
 * explorador, ou um período em Tor, não pode matar provas honestas pra
 * sempre (revisão A13). O lixo que nunca resolve é contido pelos tetos
 * de admissão e pelo despejo em `events.ts:persistOtsAttestation`.
 */
const MAX_BACKOFF_SHIFT = 6
/** Buscas de autor na REDE por execução (as locais não contam). */
const MAX_NETWORK_AUTHOR_LOOKUPS = 25
/**
 * Uma prova honesta tem 1 attestation Bitcoin (às vezes 2-3, de
 * calendários diferentes). Centenas de alturas numa prova de 16 KB era
 * a alavanca pra martelar os exploradores (revisão F3).
 */
const MAX_BTC_ATTESTATIONS = 4
const DEBOUNCE_MS = 500
/** Busca do evento carimbado por id na rede. */
const FETCH_TIMEOUT_MS = 10_000

interface ProofRow {
  proof_event_id: string
  target_event_id: string
  proof_b64: string
  attempts: number
}

/** Alturas acima do topo + margem não existem (revisão A15). */
const TIP_MARGIN = 6

type HeaderLookup = (height: number) => Promise<{ merkleRoot: string; time: number }>
const SKIP = Symbol('skip')
type AuthorResolver = (eventId: string) => Promise<string | null | typeof SKIP>

export interface VerifyOptions {
  nowMs?: number
  /** Injeção pra teste. Default: cache SQLite + `fetchBitcoinBlockHeader`. */
  getHeader?: HeaderLookup
  /** Injeção pra teste. Default: local + busca por id na rede. */
  resolveAuthor?: (eventId: string) => Promise<string | null>
  /** Default: `network_mode === 'clearnet'`. */
  networkAllowed?: boolean
  /** Injeção pra teste. Default: topo consultado nos exploradores (cache 30 min). */
  getTipHeight?: () => Promise<number>
  /** Injeção pra teste. Default: busca o evento por id na rede e verifica a assinatura. */
  fetchAuthor?: (eventId: string) => Promise<string | null>
  /** Default: MAX_NETWORK_AUTHOR_LOOKUPS por execução. */
  networkLookupBudget?: number
}

let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<number> | null = null
let rerun = false

export function scheduleOtsVerification(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void verifyPendingProofs().catch((err) => console.warn('[ots] verificação falhou:', err))
  }, DEBOUNCE_MS)
}

/**
 * Teto de altura usado só quando o topo real não pôde ser consultado:
 * blocos de ~10 min desde o gênesis × 1,08. A cadeia real roda ~4-5% à
 * frente do relógio nominal (dificuldade ajusta com atraso), então o fator
 * é o mínimo seguro. Antes era ×1,2 — ~200k alturas inexistentes passavam,
 * davam 404 e voltavam pra fila (revisão A15).
 */
export function maxPlausibleHeight(nowMs: number): number {
  const GENESIS_SEC = 1_231_006_505
  return Math.ceil(((nowMs / 1000 - GENESIS_SEC) / 600) * 1.08)
}

let tipCache: { height: number; at: number } | null = null
const TIP_TTL_MS = 30 * 60 * 1000

async function cachedTipHeight(nowMs: number): Promise<number> {
  if (tipCache && nowMs - tipCache.at < TIP_TTL_MS) return tipCache.height
  try {
    const height = await fetchBitcoinTipHeight()
    tipCache = { height, at: nowMs }
    return height
  } catch {
    return maxPlausibleHeight(nowMs)
  }
}

/**
 * Processa a fila de provas pendentes (até `MAX_PASSES × BATCH` por
 * execução). Retorna quantas âncoras novas (ou mais antigas) foram
 * gravadas. Serializado; um pedido durante a execução não se perde.
 */
export async function verifyPendingProofs(opts: VerifyOptions = {}): Promise<number> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    let total = 0
    try {
      do {
        rerun = false
        total += await run(opts)
      } while (rerun)
    } finally {
      running = null
    }
    return total
  })()
  return running
}

async function run(opts: VerifyOptions): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now()
  const networkAllowed = opts.networkAllowed ?? (await isClearnet())
  // Sem rede (Tor/onion) não há como verificar — e tentar só queimaria as
  // tentativas das provas (revisão A13). Fica tudo pendente pra quando
  // voltar a clearnet. (Testes injetam getHeader/resolveAuthor.)
  if (!networkAllowed && !opts.getHeader) return 0
  const getHeader = opts.getHeader ?? cachedHeader
  let networkLookups = 0
  // Orçamento de buscas na rede esgotado → SKIP (a linha fica intocada, sem
  // gastar tentativa). Antes devolvia null e a prova honesta levava
  // `attempts++` sem ter sido tentada — 25 lixos por execução empurravam
  // as honestas pro fim da fila e pro despejo (revisão A17).
  const resolveAuthor: AuthorResolver =
    opts.resolveAuthor ??
    (async (id: string) => {
      const local = await resolveLocalAuthor(id)
      if (local || !networkAllowed) return local
      if (networkLookups >= (opts.networkLookupBudget ?? MAX_NETWORK_AUTHOR_LOOKUPS)) return SKIP
      networkLookups++
      return (opts.fetchAuthor ?? fetchAuthorById)(id)
    })
  // Com getHeader injetado (teste/offline) e sem getTipHeight, usa só a
  // estimativa — nunca sai pra rede por conta própria.
  const tip = await (opts.getTipHeight ??
    (opts.getHeader ? async () => maxPlausibleHeight(nowMs) : () => cachedTipHeight(nowMs)))()
  const heightCap = tip + TIP_MARGIN

  let anchored = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Ordem justa: prova publicada pelo PRÓPRIO autor do evento primeiro
    // (o caso normal do Drift, e o que um atacante não consegue forjar),
    // depois menos tentativas, depois a mais antiga sem checagem. Antes
    // era `ORDER BY proof_event_id` — quem minerasse ids começando com
    // 000 ocupava o lote pra sempre (revisão F3); o desempate final é a
    // ordem de CHEGADA (rowid), não o id moível (rodada 4). Elegível = nunca
    // checada, ou backoff exponencial (com teto) vencido.
    const rows = await db.exec<ProofRow>(
      `SELECT proof_event_id, target_event_id, proof_b64, attempts FROM ots_proofs
       WHERE status = 'pending'
         AND (checked_at IS NULL OR checked_at < ? - (? << MIN(attempts, ?)))
       ORDER BY self_proof DESC, attempts ASC, checked_at IS NOT NULL, checked_at ASC, rowid ASC
       LIMIT ?`,
      [nowMs, RETRY_BASE_MS, MAX_BACKOFF_SHIFT, BATCH],
    )
    if (rows.length === 0) break

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const results = await Promise.all(
        rows.slice(i, i + CONCURRENCY).map((row) => verifyOne(row, nowMs, heightCap, getHeader, resolveAuthor)),
      )
      for (const ok of results) if (ok) anchored++
    }
    if (rows.length < BATCH) break
  }

  if (anchored > 0) {
    const { recalcAllScores } = await import('./events')
    await recalcAllScores()
  }
  return anchored
}

/** true se gravou âncora. Nunca lança. */
async function verifyOne(
  row: ProofRow,
  nowMs: number,
  heightCap: number,
  getHeader: HeaderLookup,
  resolveAuthor: AuthorResolver,
): Promise<boolean> {
  let file
  try {
    file = parseOtsFile(base64ToBytes(row.proof_b64))
    const leaves = await collectLeaves(file)
    const heights = new Set<number>()
    for (const l of leaves) if (l.attestation.type === 'bitcoin') heights.add(l.attestation.height)
    if (heights.size === 0 || heights.size > MAX_BTC_ATTESTATIONS || [...heights].some((h) => h > heightCap)) {
      await markStatus(row.proof_event_id, 'invalid', nowMs)
      return false
    }
  } catch {
    // Prova malformada é definitiva.
    await markStatus(row.proof_event_id, 'invalid', nowMs)
    return false
  }

  // Bitcoin ANTES do autor: prova que não confere morre aqui com 1 header
  // por altura (cacheado em btc_headers), sem gastar busca de autor na rede.
  let result: { height: number; time: number } | null
  try {
    result = await verifyOtsBitcoin(file, hexToBytes(row.target_event_id), { getHeader })
  } catch {
    await markFailed(row, nowMs) // rede/explorador: transitório
    return false
  }
  if (!result) {
    await markStatus(row.proof_event_id, 'invalid', nowMs)
    return false
  }

  let author: string | null | typeof SKIP
  try {
    author = await resolveAuthor(row.target_event_id)
  } catch {
    author = null
  }
  if (author === SKIP) return false // fica pra próxima execução, sem custo
  if (!author) {
    await markFailed(row, nowMs)
    return false
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
  // Só a MELHOR prova (bloco mais antigo) de cada autor guarda conteúdo —
  // é a que o rebroadcast republica. As demais verificadas viram só linha
  // (revisão A22: K eventos próprios × K provas cresciam a tabela).
  await db.run(
    `UPDATE ots_proofs SET proof_b64 = '', raw_event = ''
     WHERE status = 'verified' AND proof_event_id IN (
       SELECT proof_event_id FROM ots_anchors WHERE author_pub = ?
         AND target_event_id != (
           SELECT target_event_id FROM ots_anchors WHERE author_pub = ?
           ORDER BY block_time ASC, target_event_id ASC LIMIT 1))`,
    [author, author],
  )
  return true
}

/** Falha transitória: +1 tentativa (backoff com teto, sem desistência). */
async function markFailed(row: ProofRow, nowMs: number): Promise<void> {
  await db.run(`UPDATE ots_proofs SET attempts = attempts + 1, checked_at = ? WHERE proof_event_id = ?`, [
    nowMs,
    row.proof_event_id,
  ])
}

async function markStatus(proofId: string, status: 'verified' | 'invalid', nowMs: number): Promise<void> {
  // Inválida: apaga o conteúdo (até 16 KB) e mantém só a linha pra dedup —
  // lixo malformado não pode crescer a tabela em bytes (revisão A14).
  await db.run(
    status === 'invalid'
      ? `UPDATE ots_proofs SET status = ?, checked_at = ?, proof_b64 = '', raw_event = '' WHERE proof_event_id = ?`
      : `UPDATE ots_proofs SET status = ?, checked_at = ? WHERE proof_event_id = ?`,
    [status, nowMs, proofId],
  )
}

async function isClearnet(): Promise<boolean> {
  const { getPrefs } = await import('./prefs')
  return (getPrefs().network_mode ?? 'clearnet') === 'clearnet'
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
/**
 * Autor do evento carimbado nas tabelas locais (já verificadas por
 * `onNostrEvent`). Exportada pra `events.ts` decidir se a prova é do
 * próprio autor. `null` se o evento não está em tabela nenhuma — spreads e
 * buries guardam só a ação MAIS RECENTE (LWW), então uma ação antiga pode
 * ter que ser buscada na rede (`fetchAuthorById`).
 */
export async function resolveLocalAuthor(eventId: string): Promise<string | null> {
  const local = await db.get<{ author: string }>(
    `SELECT author_pub AS author FROM posts WHERE id = ?
     UNION ALL SELECT spreader_pub FROM spreads WHERE event_id = ?
     UNION ALL SELECT burier_pub FROM buries WHERE event_id = ?
     UNION ALL SELECT author_pub FROM comments WHERE id = ?
     LIMIT 1`,
    [eventId, eventId, eventId, eventId],
  )
  return local?.author ?? null
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
