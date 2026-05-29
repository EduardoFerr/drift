/**
 * mock-helia — substituto E2E do wrapper Helia (`src/lib/helia.ts`).
 *
 * Sprint N+5 Batch B1 (Ted). Helia real exige libp2p + IndexedDB +
 * handshake (~1-3s init, ~950 KB de chunk). Em E2E multi-user isso é
 * caro, não-determinístico (autodial, peer discovery), e não funciona
 * headless de forma confiável. Este mock entrega a MESMA API pública
 * (`driftHelia` hook) sobre um `Map<cidString, Uint8Array>` content-
 * addressed compartilhado entre contexts via BroadcastChannel.
 *
 * **Content-addressing real (não fake):** o CID é derivado do conteúdo
 * (SHA-256 dos bytes → multihash 0x12 → CIDv1 raw codec 0x55). Bytes
 * iguais ⇒ CID igual em qualquer context (manifesto §7 determinismo +
 * §28 verificabilidade). Não usamos a lib `multiformats` (peso) — o CID
 * é montado à mão em base32 sobre o digest SHA-256 do WebCrypto.
 *
 * **Cross-context sharing (§16 — disponibilidade distribuída):** o store
 * é replicado entre abas/contexts via BroadcastChannel `drift-mock-helia`.
 * Quando Grace faz `pinBlob(cid)`, o blob é anunciado no canal; Heidi
 * (outra aba) recebe e popula seu store local. `getBlob(cid)` que não
 * acha localmente faz um request no canal e aguarda resposta (com
 * timeout) — emula "buscar em peers" do Helia real. Valida o cenário
 * do plano: Grace pina → Alice offline → Heidi retrieves via mesh.
 *
 * **Delay realista:** add/get/pin têm um atraso simulado pequeno
 * (`MOCK_LATENCY_MS`) pra não esconder races que apareceriam com I/O
 * real. Determinístico (fixo, não aleatório).
 *
 * **API espelhada de `helia.ts`** (mesmas assinaturas que `main.tsx`
 * expõe em `window.driftHelia`):
 *   addBlob, getBlob, pinBlob, unpinBlob, listPinned, heliaStats,
 *   cidFromString, cidToString, smokeTest.
 *
 * CID type: usamos `string` no mock (não a classe `CID` de
 * `multiformats`) pra evitar puxar a dep pesada. `cidFromString`
 * /`cidToString` viram identidade-com-validação. O hook em `main.tsx`
 * trata CID como opaco, então isso é transparente pro caller E2E.
 */

// ─── Tipos ───────────────────────────────────────────────────────────

/** No mock, CID é a string canônica (base32 CIDv1). */
export type MockCID = string

export interface MockHeliaStats {
  running: boolean
  peerCount: number
  pinnedCount: number
}

// ─── Estado local (por context) ──────────────────────────────────────

/** Store content-addressed: cidString → bytes. Compartilhado via BC. */
const blobs = new Map<MockCID, Uint8Array>()
/** CIDs pinados localmente (sobrevivem a unpin de outros). */
const pinned = new Set<MockCID>()

/** Atraso fixo (ms) pra emular I/O sem esconder races. */
const MOCK_LATENCY_MS = 5
/** Timeout do "fetch via mesh" antes de desistir (emula gateway 504). */
const MESH_FETCH_TIMEOUT_MS = 1000

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// ─── Cross-context mesh via BroadcastChannel ─────────────────────────

const CHANNEL_NAME = 'drift-mock-helia'

/** Mensagens trocadas na malha mock. */
type MeshMessage =
  | { type: 'announce'; cid: MockCID; bytes: number[] }
  | { type: 'request'; cid: MockCID; nonce: string }
  | { type: 'respond'; cid: MockCID; bytes: number[]; nonce: string }

let channel: BroadcastChannel | null = null
/** Requests em voo aguardando resposta da malha: nonce → resolver. */
const pendingFetches = new Map<MockCID, (bytes: Uint8Array) => void>()

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as MeshMessage
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'announce': {
        // Outro context pinou/adicionou um blob — replica localmente
        // pra que `getBlob` local resolva sem round-trip.
        if (!blobs.has(msg.cid)) {
          blobs.set(msg.cid, Uint8Array.from(msg.bytes))
        }
        return
      }
      case 'request': {
        // Peer pediu um CID que talvez tenhamos. Responde se temos.
        const have = blobs.get(msg.cid)
        if (have) {
          channel?.postMessage({
            type: 'respond',
            cid: msg.cid,
            bytes: Array.from(have),
            nonce: msg.nonce,
          } satisfies MeshMessage)
        }
        return
      }
      case 'respond': {
        const resolver = pendingFetches.get(msg.cid)
        if (resolver) {
          pendingFetches.delete(msg.cid)
          const bytes = Uint8Array.from(msg.bytes)
          blobs.set(msg.cid, bytes)
          resolver(bytes)
        }
        return
      }
    }
  }
  return channel
}

/** Anuncia um blob pra malha (chamado em add + pin). */
function announce(cid: MockCID, bytes: Uint8Array): void {
  ensureChannel()?.postMessage({
    type: 'announce',
    cid,
    bytes: Array.from(bytes),
  } satisfies MeshMessage)
}

/**
 * Pede um CID ausente à malha. Resolve com os bytes se algum peer
 * responder dentro de `MESH_FETCH_TIMEOUT_MS`; rejeita no timeout
 * (emula "blob não disponível em nenhum peer" → caller cai pro HTTP
 * fallback no código real).
 */
function fetchFromMesh(cid: MockCID): Promise<Uint8Array> {
  const ch = ensureChannel()
  return new Promise<Uint8Array>((resolve, reject) => {
    if (!ch) {
      reject(new Error(`[mock-helia] blob ${cid.slice(0, 12)}… indisponível (sem canal)`))
      return
    }
    const nonce = Math.random().toString(36).slice(2)
    pendingFetches.set(cid, resolve)
    ch.postMessage({ type: 'request', cid, nonce } satisfies MeshMessage)
    setTimeout(() => {
      if (pendingFetches.has(cid)) {
        pendingFetches.delete(cid)
        reject(new Error(`[mock-helia] blob ${cid.slice(0, 12)}… timeout na malha`))
      }
    }, MESH_FETCH_TIMEOUT_MS)
  })
}

// ─── CID derivation (SHA-256 → multihash → CIDv1 raw → base32) ────────

/**
 * Deriva um CIDv1 (raw codec 0x55, sha2-256 0x12) determinístico dos
 * bytes. Mesmos bytes ⇒ mesmo CID em qualquer context. Implementação
 * à mão (sem `multiformats`) pra não inflar o gate de mock.
 */
async function cidFromBytes(bytes: Uint8Array): Promise<MockCID> {
  // Copia pra um ArrayBuffer "puro" — `crypto.subtle.digest` rejeita
  // views apoiadas em SharedArrayBuffer (lib.dom narrowing). Drift roda
  // com crossOriginIsolated, então qualquer Uint8Array pode estar sobre
  // SAB; a cópia garante o tipo aceito.
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ab))
  // multihash = <fn-code 0x12><length 0x20><digest>
  const multihash = new Uint8Array(2 + digest.length)
  multihash[0] = 0x12
  multihash[1] = digest.length
  multihash.set(digest, 2)
  // CIDv1 = <version 0x01><codec 0x55 raw><multihash>
  const cidBytes = new Uint8Array(2 + multihash.length)
  cidBytes[0] = 0x01
  cidBytes[1] = 0x55
  cidBytes.set(multihash, 2)
  // base32 lowercase com prefixo multibase 'b' (RFC4648 sem padding).
  return 'b' + base32Encode(cidBytes)
}

/** base32 RFC4648 lowercase sem padding — alfabeto multibase 'b'. */
function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }
  if (bits > 0) {
    out += alphabet.charAt((value << (5 - bits)) & 31)
  }
  return out
}

// ─── API pública (espelha helia.ts) ──────────────────────────────────

export async function addBlob(bytes: Uint8Array): Promise<MockCID> {
  await delay(MOCK_LATENCY_MS)
  const cid = await cidFromBytes(bytes)
  blobs.set(cid, bytes)
  return cid
}

export async function getBlob(cid: MockCID, signal?: AbortSignal): Promise<Uint8Array> {
  await delay(MOCK_LATENCY_MS)
  if (signal?.aborted) throw new Error('[mock-helia] getBlob abortado')
  const local = blobs.get(cid)
  if (local) return local
  // Não temos localmente — busca na malha (Grace pinou, Heidi retrieves).
  return fetchFromMesh(cid)
}

export async function pinBlob(cid: MockCID): Promise<void> {
  await delay(MOCK_LATENCY_MS)
  pinned.add(cid)
  // Pin sinaliza "estou servindo este blob" — anuncia pra malha pra que
  // outros contexts possam retrieve mesmo se o autor sumir (§16).
  const bytes = blobs.get(cid)
  if (bytes) announce(cid, bytes)
}

export async function unpinBlob(cid: MockCID): Promise<void> {
  await delay(MOCK_LATENCY_MS)
  pinned.delete(cid)
}

export async function listPinned(): Promise<MockCID[]> {
  return Array.from(pinned)
}

export async function heliaStats(): Promise<MockHeliaStats> {
  return {
    running: true,
    // peerCount: nº de outros contexts que respondem na malha não é
    // observável sem handshake; reportamos 1 quando o canal existe
    // (há malha) pra UI mostrar "conectado". Determinístico.
    peerCount: ensureChannel() ? 1 : 0,
    pinnedCount: pinned.size,
  }
}

/** No mock CID já é string — valida prefixo e devolve. */
export async function cidFromString(s: string): Promise<MockCID> {
  const stripped = s.startsWith('ipfs://') ? s.slice(7) : s
  if (stripped.length === 0) throw new Error('[mock-helia] CID vazio')
  return stripped
}

export function cidToString(cid: MockCID): string {
  return cid
}

export function cidToIpfsUrl(cid: MockCID): string {
  return `ipfs://${cid}`
}

/** Smoke test round-trip — espelha o de `main.tsx`. */
export async function smokeTest(): Promise<{
  ok: boolean
  cid: string
  bytes: number
  stats: MockHeliaStats
}> {
  const bytes = new TextEncoder().encode('hello drift mock ' + 'deterministic')
  const cid = await addBlob(bytes)
  await pinBlob(cid)
  const out = await getBlob(cid)
  const stats = await heliaStats()
  const ok =
    bytes.byteLength === out.byteLength && bytes.every((b, i) => b === out[i])
  return { ok, cid: cidToString(cid), bytes: bytes.byteLength, stats }
}

/** Reset do estado local — pra isolamento entre specs E2E. */
export function _resetMockHelia(): void {
  blobs.clear()
  pinned.clear()
  pendingFetches.clear()
}
