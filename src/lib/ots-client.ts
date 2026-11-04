/**
 * Cliente de rede OpenTimestamps: carimbar (calendários), atualizar
 * provas pending → Bitcoin, e buscar headers de bloco (exploradores
 * Esplora) para verificar. Toda função recebe `fetch` injetável (default
 * `globalThis.fetch`) — testes rodam sem rede e o app pode rotear por
 * transporte próprio.
 *
 * Postura de confiança:
 *  - Calendários são CONVENIÊNCIA, não autoridade: a prova final é
 *    verificada contra a merkle root de um bloco Bitcoin. Um calendário
 *    malicioso pode no máximo não entregar a prova.
 *  - `upgradeOtsFile` só contacta hosts de uma whitelist. A URI pending
 *    vem de dentro da prova (= de um evento Nostr de terceiro); seguir
 *    URIs arbitrárias seria SSRF/rastreamento grátis para qualquer um
 *    que publique um kind 1040.
 *  - Headers de bloco exigem ≥ 2 exploradores independentes CONCORDANDO.
 *    Um explorador sozinho poderia inventar merkle root e "validar" uma
 *    prova forjada; dois operadores distintos mentindo igual é bem mais
 *    caro. (Validar PoW do header localmente seria o passo seguinte.)
 *  - A lógica de formato/verificação mora em `ots.ts` (puro).
 */

import {
  OtsParseError,
  applyOp,
  bitcoinMsgMatchesMerkleRoot,
  bytesEqual,
  bytesToHex,
  collectLeaves,
  mergeTimestamps,
  mergeUpgradeAsync,
  newOtsFile,
  parseTimestampBytes,
  serializeOtsFile,
  stripPending as stripPendingPure,
  type OtsFile,
  type OtsTimestamp,
} from './ots'

/** Agregadores públicos ("pool") — mesmos defaults do cliente oficial. */
export const DEFAULT_CALENDARS: readonly string[] = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
]

/**
 * Hosts que `upgradeOtsFile` aceita contactar. Os pools respondem com
 * attestations pending apontando para os CALENDÁRIOS reais (não para o
 * pool), por isso a lista inclui ambos. Equivale à whitelist default do
 * cliente python (`*.calendar.opentimestamps.org`, `*.calendar.eternitywall.com`,
 * `*.calendar.catallaxy.com`), só que com hosts exatos — sem curinga.
 */
export const DEFAULT_CALENDAR_WHITELIST: readonly string[] = [
  ...DEFAULT_CALENDARS.map((u) => new URL(u).hostname),
  'alice.btc.calendar.opentimestamps.org',
  'bob.btc.calendar.opentimestamps.org',
  'finney.calendar.eternitywall.com',
  'btc.calendar.catallaxy.com',
]

/** Exploradores com API Esplora (`/block-height/:h`, `/block/:hash`). */
export const DEFAULT_EXPLORERS: readonly string[] = ['https://mempool.space/api', 'https://blockstream.info/api']

const OTS_ACCEPT = 'application/vnd.opentimestamps.v1'
/** python lê no máx. 10000 bytes da resposta do calendário. */
const MAX_CALENDAR_RESPONSE = 10_000
const MAX_EXPLORER_RESPONSE = 64 * 1024
const REQUEST_TIMEOUT_MS = 20_000

type FetchFn = typeof fetch

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > max) throw new Error(`response too large (${buf.length} > ${max})`)
  return buf
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength)
  new Uint8Array(buf).set(b)
  return buf
}

/**
 * Confere que a resposta do calendário, aplicada ao commitment, leva a
 * pelo menos uma attestation pending ou Bitcoin — e que todas as ops são
 * aplicáveis (limites de tamanho). Resposta "vazia" não conta como sucesso.
 */
async function calendarResponseUseful(commitment: Uint8Array, ts: OtsTimestamp): Promise<boolean> {
  const probe: OtsFile = { ...newOtsFile(commitment), timestamp: ts }
  const leaves = await collectLeaves(probe)
  return leaves.some((l) => l.attestation.type === 'pending' || l.attestation.type === 'bitcoin')
}

async function submitToCalendar(
  fetchFn: FetchFn,
  calendar: string,
  commitment: Uint8Array,
): Promise<OtsTimestamp> {
  const res = await fetchFn(`${trimSlash(calendar)}/digest`, {
    method: 'POST',
    headers: { Accept: OTS_ACCEPT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toArrayBuffer(commitment),
    signal: timeoutSignal(),
  })
  if (!res.ok) throw new Error(`calendar ${calendar} answered HTTP ${res.status}`)
  const ts = parseTimestampBytes(await readCapped(res, MAX_CALENDAR_RESPONSE))
  if (!(await calendarResponseUseful(commitment, ts))) {
    throw new Error(`calendar ${calendar} returned a timestamp without attestations`)
  }
  return ts
}

/**
 * Carimba um digest sha256 (no Drift: o id de um evento Nostr). Mesmo
 * fluxo do cliente oficial:
 *   digest → append(nonce 16 bytes) → sha256 = commitment
 *   commitment → POST em cada calendário → merge das respostas
 * O nonce impede que o calendário (público) aprenda o digest — ele só vê
 * sha256(digest ‖ nonce). `opts.nonce` existe para testes determinísticos.
 *
 * Exige ≥ `minCalendars` (default 2) respostas úteis: com um único
 * calendário, se ele sumir antes de ancorar, a prova nunca completa.
 */
export async function stampDigest(
  digest32: Uint8Array,
  opts: {
    calendars?: readonly string[]
    fetch?: FetchFn
    minCalendars?: number
    nonce?: Uint8Array
  } = {},
): Promise<OtsFile> {
  const file = newOtsFile(digest32)
  const calendars = opts.calendars ?? DEFAULT_CALENDARS
  const minCalendars = opts.minCalendars ?? 2
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const nonce = opts.nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(16))
  if (nonce.length !== 16) throw new Error('nonce must be 16 bytes')

  const appendOp = { op: 'append' as const, arg: nonce.slice() }
  const commitment = await applyOp({ op: 'sha256' }, await applyOp(appendOp, file.digest))

  const results = await Promise.allSettled(calendars.map((c) => submitToCalendar(fetchFn, c, commitment)))
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (ok.length < minCalendars) {
    const reasons = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))
    throw new Error(
      `only ${ok.length}/${calendars.length} calendars answered (need ${minCalendars}): ${reasons.join('; ')}`,
    )
  }
  let calendarTs: OtsTimestamp = { attestations: [], ops: [] }
  for (const ts of ok) calendarTs = mergeTimestamps(calendarTs, ts)

  file.timestamp = {
    attestations: [],
    ops: [{ op: appendOp, next: { attestations: [], ops: [{ op: { op: 'sha256' }, next: calendarTs }] } }],
  }
  return file
}

/**
 * Converte a URI pending em URL de upgrade, ou `null` se não for https de
 * um host da whitelist. Sem credenciais, sem porta não-padrão.
 */
function upgradeUrl(uri: string, msg: Uint8Array, whitelist: readonly string[]): string | null {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null
  if (!whitelist.includes(u.hostname)) return null
  return `https://${u.hostname}${trimSlash(u.pathname)}/timestamp/${bytesToHex(msg)}`
}

/**
 * Para cada attestation pending: `GET <uri>/timestamp/<hex(msg)>`.
 * 200 → funde a resposta sob o nó pending; 404 → ainda pending (calendário
 * não ancorou); erro de rede/HTTP/parse → ignorado (tenta de novo depois).
 * URIs fora da whitelist NUNCA são contactadas.
 *
 * `changed` compara a serialização antes/depois — robusto a respostas
 * que não acrescentam nada.
 */
export async function upgradeOtsFile(
  file: OtsFile,
  opts: { fetch?: FetchFn; calendarWhitelist?: readonly string[] } = {},
): Promise<{ file: OtsFile; changed: boolean }> {
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const whitelist = opts.calendarWhitelist ?? DEFAULT_CALENDAR_WHITELIST
  const leaves = await collectLeaves(file)

  const jobs = new Map<string, { url: string; msg: Uint8Array }>()
  for (const { attestation, msg } of leaves) {
    if (attestation.type !== 'pending') continue
    const url = upgradeUrl(attestation.uri, msg, whitelist)
    if (url && !jobs.has(url)) jobs.set(url, { url, msg })
  }

  const responses = await Promise.all(
    [...jobs.values()].map(async ({ url, msg }) => {
      try {
        const res = await fetchFn(url, { headers: { Accept: OTS_ACCEPT }, signal: timeoutSignal() })
        if (!res.ok) return null // 404 = ainda pending; demais = tentar depois
        return { msg, ts: parseTimestampBytes(await readCapped(res, MAX_CALENDAR_RESPONSE)) }
      } catch {
        return null
      }
    }),
  )

  let current = file
  for (const r of responses) {
    if (!r) continue
    try {
      current = await mergeUpgradeAsync(current, r.msg, r.ts)
    } catch (err) {
      if (!(err instanceof OtsParseError)) throw err
    }
  }
  if (current === file) return { file, changed: false }
  // Validação final: o resultado precisa ser serializável e aplicável.
  try {
    const before = serializeOtsFile(file)
    const after = serializeOtsFile(current)
    await collectLeaves(current)
    return bytesEqual(before, after) ? { file, changed: false } : { file: current, changed: true }
  } catch (err) {
    if (err instanceof OtsParseError) return { file, changed: false }
    throw err
  }
}

const HEX64 = /^[0-9a-f]{64}$/

async function headerFromExplorer(
  fetchFn: FetchFn,
  api: string,
  height: number,
): Promise<{ merkleRoot: string; time: number }> {
  const base = trimSlash(api)
  const r1 = await fetchFn(`${base}/block-height/${height}`, { signal: timeoutSignal() })
  if (!r1.ok) throw new Error(`${api}: block-height HTTP ${r1.status}`)
  const hash = new TextDecoder().decode(await readCapped(r1, MAX_EXPLORER_RESPONSE)).trim().toLowerCase()
  if (!HEX64.test(hash)) throw new Error(`${api}: invalid block hash`)
  const r2 = await fetchFn(`${base}/block/${hash}`, { signal: timeoutSignal() })
  if (!r2.ok) throw new Error(`${api}: block HTTP ${r2.status}`)
  const json: unknown = JSON.parse(new TextDecoder().decode(await readCapped(r2, MAX_EXPLORER_RESPONSE)))
  if (typeof json !== 'object' || json === null) throw new Error(`${api}: invalid block JSON`)
  const j = json as Record<string, unknown>
  const merkleRoot = typeof j.merkle_root === 'string' ? j.merkle_root.toLowerCase() : ''
  const time = j.timestamp
  if (!HEX64.test(merkleRoot)) throw new Error(`${api}: invalid merkle_root`)
  if (typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0) {
    throw new Error(`${api}: invalid timestamp`)
  }
  // Esplora devolve id/height; se vierem, precisam bater com o pedido.
  if (j.id !== undefined && String(j.id).toLowerCase() !== hash) throw new Error(`${api}: block id mismatch`)
  if (j.height !== undefined && j.height !== height) throw new Error(`${api}: block height mismatch`)
  return { merkleRoot, time }
}

/**
 * Header (merkle root em hex de EXIBIÇÃO + timestamp unix) do bloco na
 * altura `height`. Consulta todos os exploradores em paralelo; exige ≥ 2
 * respostas e unanimidade entre as que responderam. Divergência → lança
 * (não escolhemos "maioria": divergência indica reorg recente ou mentira,
 * e em ambos os casos o certo é não concluir nada agora).
 */
export async function fetchBitcoinBlockHeader(
  height: number,
  opts: { explorers?: readonly string[]; fetch?: FetchFn } = {},
): Promise<{ merkleRoot: string; time: number }> {
  if (!Number.isSafeInteger(height) || height < 0) throw new Error(`invalid block height ${height}`)
  const explorers = opts.explorers ?? DEFAULT_EXPLORERS
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const results = await Promise.allSettled(explorers.map((e) => headerFromExplorer(fetchFn, e, height)))
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (ok.length < 2) {
    throw new Error(`need >= 2 explorers for block ${height}, got ${ok.length}`)
  }
  const first = ok[0]!
  if (ok.some((h) => h.merkleRoot !== first.merkleRoot || h.time !== first.time)) {
    throw new Error(`explorers disagree on block ${height}`)
  }
  return first
}

/**
 * Verifica uma prova contra Bitcoin. Retorna a attestation Bitcoin válida
 * MAIS ANTIGA (menor `time`; empate → menor altura), ou `null` se:
 *  - o digest do arquivo ≠ `expectedDigest32` (prova de OUTRA coisa);
 *  - a árvore tem op inaplicável (prova malformada);
 *  - nenhuma folha Bitcoin bate com a merkle root do header.
 * Folhas que não batem são ignoradas, não lançam.
 *
 * Erros do `getHeader` (rede, exploradores divergindo): se ao menos uma
 * outra folha validou, devolvemos a melhor válida — no pior caso um
 * horário MAIS RECENTE que o real, direção segura para anti-Sybil
 * (identidade parece mais nova, nunca mais velha). Se nenhuma validou e
 * houve erro, relança: "não consegui verificar agora" ≠ "prova inválida".
 */
export async function verifyOtsBitcoin(
  file: OtsFile,
  expectedDigest32: Uint8Array,
  opts: { getHeader?: (height: number) => Promise<{ merkleRoot: string; time: number }> } = {},
): Promise<{ height: number; time: number } | null> {
  if (file.hashOp !== 'sha256' || !bytesEqual(file.digest, expectedDigest32)) return null
  const getHeader = opts.getHeader ?? ((h: number) => fetchBitcoinBlockHeader(h))

  let leaves
  try {
    leaves = await collectLeaves(file)
  } catch (err) {
    if (err instanceof OtsParseError) return null
    throw err
  }

  const headers = new Map<number, Promise<{ merkleRoot: string; time: number }>>()
  let best: { height: number; time: number } | null = null
  let firstError: unknown = undefined
  for (const { attestation, msg } of leaves) {
    if (attestation.type !== 'bitcoin' || msg.length !== 32) continue
    const h = attestation.height
    if (!headers.has(h)) headers.set(h, getHeader(h))
    let header: { merkleRoot: string; time: number }
    try {
      header = await headers.get(h)!
    } catch (err) {
      firstError ??= err
      continue
    }
    if (!bitcoinMsgMatchesMerkleRoot(msg, header.merkleRoot)) continue
    if (!best || header.time < best.time || (header.time === best.time && h < best.height)) {
      best = { height: h, time: header.time }
    }
  }
  if (best) return best
  if (firstError !== undefined) throw firstError
  return null
}

/** Ver `ots.ts:stripPending` (puro; reexportado aqui pelo contrato da API). */
export function stripPending(file: OtsFile): OtsFile {
  return stripPendingPure(file)
}
