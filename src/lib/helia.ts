/**
 * Helia (IPFS browser) — wrapper Drift para distribuição de blobs.
 *
 * Track B (manifesto §16 — disponibilidade distribuída). Esta é a B.1
 * (spike): API mínima pra add/get/pin com persistência em IndexedDB.
 *
 * **CRÍTICO — bundle:** todo este módulo é **lazy-loaded** via dynamic
 * `import()`. Nada de Helia entra no bundle inicial. Consumers fazem:
 *
 *   const { addBlob } = await import('./helia')
 *
 * O cost real (medido em B.1) só é pago quando o user efetivamente
 * upa/baixa um blob via IPFS. Feed simples + relay-only path nunca
 * carregam Helia. Manifesto §16 (compromisso conditional): se o user
 * só lê HTTP, ele não paga o custo de IPFS.
 *
 * **Persistência:** blocos + datastore via IndexedDB
 * (`blockstore-idb`/`datastore-idb`). Pinned blobs sobrevivem reload.
 * Cap de espaço local é configurável em UserPrefs (B.2 — default 500MB,
 * eviction LRU).
 *
 * **Singleton:** uma única instância de Helia é mantida por aba (`getHelia`).
 * Init custa segundos (libp2p handshake, blockstore open) — não dá pra
 * recriar a cada chamada. Init é idempotente (Promise reusada).
 *
 * **Failure mode:** se o init falhar (browser sem WebRTC, COEP/COOP
 * inativos, IndexedDB bloqueado), `getHelia()` rejeita e o caller
 * cai pro fallback HTTP (B.2). Não throw em import — só em uso.
 *
 * **API B.1 (este arquivo):**
 *   - `getHelia()` — promise singleton
 *   - `addBlob(bytes)` — UnixFS add → CID
 *   - `getBlob(cid)` — UnixFS cat → Uint8Array
 *   - `pinBlob(cid)` / `unpinBlob(cid)` / `listPinned()`
 *   - `heliaStats()` — peer count, blocks pinados (B.3 UI)
 *   - `cidFromString(s)` / `cidToString(c)` — helpers de parse
 *
 * **NÃO implementado em B.1 (vai pra B.2):**
 *   - Tag NIP-94 `imeta` no kind 9078
 *   - Auto-pin disparado por SPREAD
 *   - Hash verify SHA-256 antes de aceitar blob (`x` da tag)
 *   - HTTP gateway fallback
 *   - Cap LRU de eviction
 *
 * Refs: `Docs/blob-distribution.md` §4-5; manifesto §16, §17, §28.
 */

import type { Helia } from '@helia/interface'
import type { UnixFS } from '@helia/unixfs'
import type { CID } from 'multiformats/cid'

// ─── Singleton state ─────────────────────────────────────────────────

interface HeliaBundle {
  node: Helia
  fs: UnixFS
}

let heliaPromise: Promise<HeliaBundle> | null = null

/**
 * Idle auto-dispose (Robin/Lily fix 2026-05-08).
 *
 * Problema diagnosticado: libp2p autodial mantém WS connections abertas
 * indefinidamente, gerando ruído de rede contínuo (~1033 reqs/3min no
 * boot reportado pelo user). Mesmo com `use_ipfs=false` evitando
 * inicialização nova, runs antigas permaneciam ativas.
 *
 * Solução: track `lastAccessAt` em CADA chamada que toca o singleton.
 * Watcher checa periodicamente; se o singleton não foi usado em
 * `IDLE_TIMEOUT_MS`, chama `disposeHelia()` automaticamente.
 *
 * Trade-off: timeout curto (5min) é resource-friendly mas re-init custa
 * ~1-3s na próxima chamada (libp2p handshake + IDB open). Aceitável —
 * uploads/downloads de blob são ações deliberadas, não hot path.
 *
 * Manifesto §17 (sem chave mestra): user controla custo de banda;
 * runtime não fica gastando CPU/rede sem propósito explícito.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000 // 5 min
const IDLE_CHECK_INTERVAL_MS = 60_000 // 1 min — granularidade boa o suficiente
let lastAccessAt = 0
let idleWatcher: ReturnType<typeof setInterval> | null = null

function touch(): void {
  lastAccessAt = Date.now()
}

function startIdleWatcher(): void {
  if (idleWatcher) return
  idleWatcher = setInterval(() => {
    if (!heliaPromise) {
      stopIdleWatcher()
      return
    }
    const idleFor = Date.now() - lastAccessAt
    if (idleFor >= IDLE_TIMEOUT_MS) {
      // fire-and-forget; disposeHelia é idempotente e silencia erros internos
      void disposeHelia()
    }
  }, IDLE_CHECK_INTERVAL_MS)
}

function stopIdleWatcher(): void {
  if (!idleWatcher) return
  clearInterval(idleWatcher)
  idleWatcher = null
}

/**
 * Inicializa Helia uma vez por aba. Idempotente — chamadas concorrentes
 * recebem a mesma promise. Caller que pegar a rejection deve assumir
 * fallback HTTP.
 *
 * Custo: ~1-3s no init (libp2p + blockstore IDB open). Por isso é lazy
 * e singleton; não chamar em hot path.
 *
 * Inicia o idle watcher na primeira chamada — auto-dispose após
 * `IDLE_TIMEOUT_MS` sem novo touch.
 */
export function getHelia(): Promise<HeliaBundle> {
  touch()
  if (heliaPromise) return heliaPromise
  heliaPromise = initHelia().catch((err) => {
    // Permite retry após falha — não cacheia rejection permanentemente.
    heliaPromise = null
    stopIdleWatcher()
    throw err
  })
  startIdleWatcher()
  return heliaPromise
}

/**
 * Limpa o singleton — útil em tests, quando user reseta identidade,
 * ou auto-disparado pelo idle watcher após `IDLE_TIMEOUT_MS`.
 *
 * NÃO apaga blocos persistidos (IDB sobrevive); só dropa a referência
 * em memória pra próxima `getHelia()` reabrir.
 *
 * Edge case: chamada in-flight durante dispose. `getHelia()` retornaria
 * a promise antiga (que vai resolver com node já parado). É tolerável
 * porque (a) o consumer chama `addBlob`/`getBlob` etc. logo em seguida,
 * que vão re-touch + re-init via novo `getHelia()` se a promise foi
 * limpa antes; (b) operação no node parado falha graciosamente (caller
 * trata como Helia indisponível, cai pro HTTP fallback).
 */
export async function disposeHelia(): Promise<void> {
  stopIdleWatcher()
  if (connectionCapTimer) {
    clearInterval(connectionCapTimer)
    connectionCapTimer = null
  }
  if (!heliaPromise) return
  console.info('[helia] dispose — idle timeout ou reset')
  const promise = heliaPromise
  heliaPromise = null
  try {
    const { node } = await promise
    await node.stop()
  } catch {
    // ignora — pode estar em estado meio-pronto ou já parado
  }
}

// ─── Init ────────────────────────────────────────────────────────────

const LIBP2P_MAX_CONNECTIONS = 20

interface Libp2pRuntime {
  getPeers(): unknown[]
  getConnections(): { id: string; close(): Promise<void> }[]
  addEventListener(event: string, handler: () => void): void
  status: string
}

type HeliaWithLibp2p = { libp2p?: Libp2pRuntime }

let connectionCapTimer: ReturnType<typeof setInterval> | null = null

function enforceConnectionCap(libp2p: Libp2pRuntime): void {
  if (connectionCapTimer) return
  connectionCapTimer = setInterval(() => {
    const conns = libp2p.getConnections()
    if (conns.length <= LIBP2P_MAX_CONNECTIONS) return
    const excess = conns.slice(LIBP2P_MAX_CONNECTIONS)
    console.info(`[helia] pruning ${excess.length} connections (${conns.length}/${LIBP2P_MAX_CONNECTIONS})`)
    for (const conn of excess) {
      conn.close().catch(() => {})
    }
  }, 10_000)
}

async function initHelia(): Promise<HeliaBundle> {
  // Dynamic imports SEMPRE — garante code-splitting via Vite. Cada chunk
  // vai como `assets/helia-*.js` e só baixa na primeira chamada.
  const [
    { createHelia },
    { unixfs },
    { IDBBlockstore },
    { IDBDatastore },
  ] = await Promise.all([
    import('helia'),
    import('@helia/unixfs'),
    import('blockstore-idb'),
    import('datastore-idb'),
  ])

  const blockstore = new IDBBlockstore('drift-helia-blocks')
  const datastore = new IDBDatastore('drift-helia-datastore')
  await Promise.all([blockstore.open(), datastore.open()])

  console.info('[helia] inicializando node...')

  const node = await createHelia({
    blockstore,
    datastore,
    libp2p: {
      connectionManager: {
        maxConnections: LIBP2P_MAX_CONNECTIONS,
      },
    },
    start: true,
  })

  const libp2p = (node as HeliaWithLibp2p).libp2p
  if (libp2p) enforceConnectionCap(libp2p)
  console.info('[helia] node pronto —', libp2p?.getPeers().length ?? 0, 'peers')

  const fs = unixfs(node)

  return { node, fs }
}

// ─── API pública (B.1) ───────────────────────────────────────────────

/**
 * Adiciona bytes ao Helia local. Retorna CID (pode ser usado no NIP-94
 * `imeta` em B.2).
 *
 * Uso:
 *   const bytes = new Uint8Array(await file.arrayBuffer())
 *   const cid = await addBlob(bytes)
 *   const cidStr = cidToString(cid)  // pra usar em tag
 */
export async function addBlob(bytes: Uint8Array): Promise<CID> {
  const { fs } = await getHelia()
  return fs.addBytes(bytes)
}

/**
 * Recupera bytes pelo CID. Tenta blockstore local primeiro; se não tem,
 * libp2p busca em peers conhecidos.
 *
 * `signal` permite timeout externo — sem ele, Helia espera indefinidamente
 * (trustless gateway pode levar 30s+ pra 504).
 */
export async function getBlob(cid: CID, signal?: AbortSignal): Promise<Uint8Array> {
  const { fs } = await getHelia()
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of fs.cat(cid, { signal })) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

/**
 * Pin blob localmente — sinaliza pro garbage collector do Helia que
 * este CID não pode ser dropado. Idempotente: pinar 2x não duplica.
 *
 * Em B.2, "favoritar = pinar" será disparado pelo handler de SPREAD
 * (kind 9079) em `lib/protocol.ts` ou `lib/events.ts`.
 */
export async function pinBlob(cid: CID): Promise<void> {
  const { node } = await getHelia()
  // Itera o async iterator pra forçar a execução completa.
  for await (const _ of node.pins.add(cid)) {
    // no-op; cada yield é progresso de pin recursivo
    void _
  }
}

/**
 * Remove pin (libera o blob pro GC eventual). Não apaga imediatamente
 * — só remove a marcação. Helia GC roda em demanda; B.2 vai chamar
 * GC manual em eviction LRU.
 */
export async function unpinBlob(cid: CID): Promise<void> {
  const { node } = await getHelia()
  for await (const _ of node.pins.rm(cid)) {
    void _
  }
}

/**
 * Lista todos os CIDs pinados localmente. B.3 UI usa pra mostrar
 * "servindo N blobs". Retorna array (não async iterator) pra facilitar
 * — assume N pequeno (< alguns milhares); revisar se cresce muito.
 */
export async function listPinned(): Promise<CID[]> {
  const { node } = await getHelia()
  const out: CID[] = []
  for await (const pin of node.pins.ls()) {
    out.push(pin.cid)
  }
  return out
}

/**
 * Snapshot de status do Helia local — usado em B.3 UI (Settings panel
 * "servindo N blobs a M peers") e em smoke test.
 *
 * `peerCount` reflete peers libp2p ativos no momento. `pinnedCount`
 * é CIDs distintos pinados. `running` indica se o node está started.
 */
export interface HeliaStats {
  running: boolean
  peerCount: number
  pinnedCount: number
}

export async function heliaStats(): Promise<HeliaStats> {
  const { node } = await getHelia()
  // libp2p é opcional na interface Helia 6.x; guardamos defensivamente.
  const libp2p = (node as HeliaWithLibp2p).libp2p
  const peerCount = libp2p?.getPeers().length ?? 0
  const running = libp2p?.status === 'started'

  let pinnedCount = 0
  for await (const _ of node.pins.ls()) {
    pinnedCount++
    void _
  }

  return { running, peerCount, pinnedCount }
}

// ─── CID helpers ─────────────────────────────────────────────────────

/**
 * Parse de string `bafy...` ou `Qm...` pra CID. Uso típico em B.2 ao
 * receber tag NIP-94 `imeta` com `cid <string>` ou `url ipfs://<string>`.
 *
 * Lazy-load do `multiformats/cid` — não infla bundle inicial.
 */
export async function cidFromString(s: string): Promise<CID> {
  const { CID } = await import('multiformats/cid')
  // Aceita tanto `bafy...` cru quanto `ipfs://bafy...`.
  const stripped = s.startsWith('ipfs://') ? s.slice(7) : s
  return CID.parse(stripped)
}

/**
 * Serializa CID pra string canônica (base32 lowercase em CIDv1, base58
 * em CIDv0). Use `cidToIpfsUrl` quando quiser prefixo `ipfs://`.
 */
export function cidToString(cid: CID): string {
  return cid.toString()
}

export function cidToIpfsUrl(cid: CID): string {
  return `ipfs://${cid.toString()}`
}
