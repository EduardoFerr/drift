/**
 * blobs.ts — orquestrador de blobs Drift (Track B.2).
 *
 * Camada acima de `helia.ts` (IPFS) + `upload.ts` (HTTP nostr.build) +
 * gateways HTTP de fallback. Responsável por:
 *
 *   1. **Upload**: file → SHA-256 + HTTP url + (best-effort) Helia CID
 *      → `BlobMeta` pronto pra virar tag NIP-94 `imeta`.
 *   2. **Fetch**: `BlobMeta` → bytes verificados (hash check obrigatório
 *      quando `meta.hash` presente) → object URL pro `<img>` consumir.
 *   3. **Pin**: bulk pin de CIDs vindos de imeta tags (chamado pelo
 *      handler de SPREAD em events.ts — manifesto §16, "favorito =
 *      mirror automático").
 *
 * **Order of fetch attempts** (RFC §5.2):
 *   a. Cache de object URL (sync hit)
 *   b. Helia local (`cid` presente) — disco local + libp2p
 *   c. HTTP `url` direto (rápido, mas SPOF)
 *   d. Gateway IPFS público (`cid` presente, fallback HTTP)
 *   e. Throw — sem fonte
 *
 * **Hash verify:** se `meta.hash` presente, qualquer rota acima retorna
 * bytes que **devem** bater com o hash. Mismatch → rejeita o blob,
 * NÃO armazena, retorna pra próxima fonte. Isso impede gateway/host
 * malicioso de servir conteúdo trocado (manifesto §17).
 *
 * **Lazy de Helia:** este módulo importa `./helia` estaticamente, mas
 * `helia.ts` é todo dynamic-import internamente. Significa que
 * `blobs.ts` no bundle inicial é leve (~3-5kB), e Helia só é puxado
 * quando uma função que precisa dele é chamada.
 *
 * **Object URL leak:** caller de `fetchBlobUrl` deve eventualmente
 * chamar `URL.revokeObjectURL` (ou usar `releaseBlobUrl` daqui).
 * Cache aqui mantém refs vivas — se o user navegou pra fora, libere.
 *
 * Ref: Docs/blob-distribution.md.
 */

import imageCompression from 'browser-image-compression'
import { uploadImage, UploadError } from './upload'
import { sha256Hex, type BlobMeta } from './nip94'
import {
  DEFAULT_IPFS_GATEWAYS,
  gatewayUrl,
  type IpfsGateway,
} from '../config/gateways'
import { getPrefs } from './prefs'

/**
 * IPFS pref gate. Quando `use_ipfs=false` (default desde 2026-05),
 * paths Helia (add local + fetch via libp2p) são pulados — economia
 * de banda + sem libp2p WS chatter (manifesto §17 opt-in vence §16
 * disponibilidade distribuída quando user escolheu).
 *
 * Gateway HTTP IPFS continua disponível mesmo com `use_ipfs=false`
 * — é só HTTP request, sem custo contínuo. Permite ler `cid` de
 * outros users sem rodar libp2p local.
 */
function ipfsEnabled(): boolean {
  return getPrefs().use_ipfs === true
}

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Resultado de upload — sempre tem `hash` (calculado local) e ao menos
 * `url` (HTTP fallback). `cid` pode estar ausente se Helia falhou —
 * post ainda é publicável, só não tem path IPFS dedicado.
 */
export interface UploadedBlob extends BlobMeta {
  url: string
  hash: string
  size: number
  mime: string
}

export interface UploadOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export interface FetchOptions {
  signal?: AbortSignal
  /** Lista customizada de gateways. Default: DEFAULT_IPFS_GATEWAYS. */
  gateways?: IpfsGateway[]
}

export class BlobError extends Error {
  constructor(
    message: string,
    public readonly cause:
      | 'no-source'
      | 'all-sources-failed'
      | 'hash-mismatch'
      | 'aborted',
  ) {
    super(message)
    this.name = 'BlobError'
  }
}

// ─── Cache ───────────────────────────────────────────────────────────

/**
 * Cache de object URL por chave (`cid` se houver, senão `url`). Evita
 * re-fetch + re-blob() em re-render. Vida da entrada = vida da aba —
 * URLs locais ficam até `releaseBlobUrl(meta)` ou navegação.
 */
const objectUrlCache = new Map<string, string>()

function cacheKey(meta: BlobMeta): string {
  return meta.cid ?? meta.url ?? ''
}

/**
 * Libera o object URL associado a `meta` (se houver). Caller deve
 * chamar quando o componente que consome a URL desmontar — evita leak
 * em SPA com navegação intensa.
 */
export function releaseBlobUrl(meta: BlobMeta): void {
  const k = cacheKey(meta)
  const url = objectUrlCache.get(k)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrlCache.delete(k)
  }
}

/** Limpa todo o cache — útil em troca de identidade ou hard reset. */
export function clearBlobUrlCache(): void {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url)
  objectUrlCache.clear()
}

// ─── Upload ──────────────────────────────────────────────────────────

const COMPRESSION_OPTIONS = {
  maxSizeMB: 2,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  preserveExif: false, // privacidade — manifesto §28
}

/**
 * Faz upload de um blob.
 *
 * Sequência:
 *   1. Comprime localmente (manifesto §28: EXIF strip).
 *   2. Calcula SHA-256 do byte comprimido (`x` da tag imeta).
 *   3. **Em paralelo:**
 *      - HTTP upload (`upload.ts` → nostr.build) — confirmação primária.
 *      - Helia local add (best-effort) — gera CID, falha não bloqueia.
 *   4. Espera HTTP terminar (precisa pra publicar). Se Helia já tem CID
 *      no Promise.allSettled, inclui no resultado.
 *   5. Retorna `UploadedBlob` com `url` + `hash` + `size` + `mime` +
 *      opcionalmente `cid`.
 *
 * **Trade-off vs RFC §5.5** ("2 confirmações"): a RFC pede esperar
 * Helia advertise antes de publicar. Aqui simplificamos pra MVP: HTTP
 * = canal primário. Helia é mirror gratuito best-effort. Endurecemos
 * em B.3+ se medições mostrarem readers vendo "imagem quebrada"
 * frequente.
 *
 * @throws BlobError se HTTP falhar (post não pode publicar sem url).
 */
export async function uploadBlob(
  file: File | Blob,
  options: UploadOptions = {},
): Promise<UploadedBlob> {
  // GIFs preservam animação (sem recomprimir); resto cai na pipeline.
  const compressed = await prepareForUpload(file, options.signal)

  const bytes = new Uint8Array(await compressed.arrayBuffer())
  const hash = await sha256Hex(bytes)
  const size = bytes.byteLength
  const mime = compressed.type || 'application/octet-stream'

  // Paralelismo: HTTP é blocker, Helia é optional.
  // Quando `use_ipfs=false` (default), pulamos `tryHeliaAdd` — sem custo
  // de inicializar libp2p só pra add um blob que ninguém vai servir local.
  const httpPromise = uploadImage(compressed, options)
  const heliaPromise = ipfsEnabled() ? tryHeliaAdd(bytes) : Promise.resolve(undefined)

  const [urlResult, cidResult] = await Promise.allSettled([
    httpPromise,
    heliaPromise,
  ])

  if (urlResult.status === 'rejected') {
    // Wrap pra preservar a UploadError original
    const e = urlResult.reason
    throw e instanceof UploadError ? e : new BlobError(String(e), 'all-sources-failed')
  }

  const url = urlResult.value
  const cid = cidResult.status === 'fulfilled' ? cidResult.value : undefined

  return { url, cid, hash, size, mime }
}

async function prepareForUpload(file: File | Blob, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw new BlobError('upload cancelado', 'aborted')
  if (file.type === 'image/gif') return file
  if (!file.type.startsWith('image/')) return file
  try {
    return await imageCompression(file as File, COMPRESSION_OPTIONS)
  } catch (err) {
    console.warn('[blobs] compressão falhou, enviando original:', err)
    return file
  }
}

/**
 * Tenta adicionar bytes ao Helia local. Retorna CID string ou undefined
 * em qualquer falha — chamador trata Helia como mirror best-effort,
 * nunca como blocker.
 */
async function tryHeliaAdd(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const helia = await import('./helia')
    const cid = await helia.addBlob(bytes)
    return helia.cidToString(cid)
  } catch (err) {
    // Helia indisponível (browser sem WebRTC, IDB bloqueado, etc.)
    // → degradação graciosa: post ainda publica, sem CID.
    console.warn('[blobs] Helia add falhou, prosseguindo só com HTTP:', err)
    return undefined
  }
}

// ─── Fetch ───────────────────────────────────────────────────────────

/**
 * Recupera bytes de um blob seguindo a ordem Helia → HTTP → gateway.
 * Verifica `hash` se presente — qualquer rota que retornar mismatch é
 * rejeitada e cai pra próxima.
 *
 * @throws BlobError se todas as rotas falharem ou hash mismatch
 *   ininterrupto.
 */
export async function fetchBlob(
  meta: BlobMeta,
  options: FetchOptions = {},
): Promise<Uint8Array> {
  if (!meta.url && !meta.cid) {
    throw new BlobError('meta sem url nem cid', 'no-source')
  }

  const errors: string[] = []

  // 1. Helia local primeiro (se tem cid E user habilitou IPFS).
  // `use_ipfs=false` (default) pula o path libp2p — economia de banda
  // contínua. Gateway IPFS HTTP (passo 3) ainda é tentado, então
  // CIDs continuam acessíveis sem rodar Helia local.
  if (meta.cid && ipfsEnabled()) {
    try {
      const bytes = await fetchViaHelia(meta.cid, options.signal)
      if (await checkHash(bytes, meta.hash)) return bytes
      errors.push('helia: hash mismatch')
    } catch (err) {
      errors.push(`helia: ${describe(err)}`)
    }
  }

  // 2. HTTP url direto
  if (meta.url) {
    try {
      const bytes = await fetchViaHttp(meta.url, options.signal)
      if (await checkHash(bytes, meta.hash)) return bytes
      errors.push('http: hash mismatch')
    } catch (err) {
      errors.push(`http: ${describe(err)}`)
    }
  }

  // 3. Gateway IPFS público (se tem cid)
  if (meta.cid) {
    const gateways = options.gateways ?? DEFAULT_IPFS_GATEWAYS
    for (const g of gateways) {
      try {
        const url = gatewayUrl(g, meta.cid)
        const bytes = await fetchViaHttp(url, options.signal, g.timeoutMs)
        if (await checkHash(bytes, meta.hash)) return bytes
        errors.push(`${g.name}: hash mismatch`)
      } catch (err) {
        errors.push(`${g.name}: ${describe(err)}`)
      }
    }
  }

  throw new BlobError(
    `nenhuma rota retornou bytes válidos (${errors.join('; ')})`,
    'all-sources-failed',
  )
}

/**
 * Versão de conveniência: retorna object URL pronta pra `<img src=...>`.
 * Cacheia internamente — re-chamadas com a mesma `meta` retornam a
 * mesma URL (síncrono no hit).
 *
 * Caller deve `releaseBlobUrl(meta)` quando não precisa mais (no
 * unmount do componente, p.ex.).
 */
export async function fetchBlobUrl(
  meta: BlobMeta,
  options: FetchOptions = {},
): Promise<string> {
  const k = cacheKey(meta)
  const cached = objectUrlCache.get(k)
  if (cached) return cached

  const bytes = await fetchBlob(meta, options)
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: meta.mime ?? 'application/octet-stream',
  })
  const url = URL.createObjectURL(blob)
  objectUrlCache.set(k, url)
  return url
}

async function fetchViaHelia(cid: string, signal?: AbortSignal): Promise<Uint8Array> {
  const helia = await import('./helia')
  const cidObj = await helia.cidFromString(cid)
  if (signal?.aborted) throw new BlobError('cancelado', 'aborted')
  return helia.getBlob(cidObj)
}

async function fetchViaHttp(
  url: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<Uint8Array> {
  // ipfs:// não é fetchable nativamente; redireciona pro primeiro gateway.
  // (Caller raramente passa ipfs:// aqui — é defesa em profundidade.)
  let httpUrl = url
  if (url.startsWith('ipfs://')) {
    const first = DEFAULT_IPFS_GATEWAYS[0]
    if (!first) throw new Error('sem gateway IPFS disponível pra fallback')
    httpUrl = gatewayUrl(first, url.slice(7))
  }

  const ctrl = new AbortController()
  const onUserAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onUserAbort, { once: true })
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null

  try {
    const res = await fetch(httpUrl, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onUserAbort)
  }
}

async function checkHash(bytes: Uint8Array, expected: string | undefined): Promise<boolean> {
  if (!expected) return true // Sem hash declarado → confia (compat retro com posts pré-RFC)
  const got = await sha256Hex(bytes)
  return got === expected.toLowerCase()
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// ─── Pin (favorite = mirror) ─────────────────────────────────────────

/**
 * Pina os CIDs de uma lista de BlobMetas no Helia local. Best-effort —
 * itens sem `cid` são pulados; falhas individuais loggam mas não
 * propagam (caller é o handler de SPREAD, não pode falhar publicação
 * por causa de pin).
 *
 * Idempotente: pinar 2x o mesmo CID é no-op (Helia trata).
 */
export async function pinBlobsFromMeta(metas: BlobMeta[]): Promise<void> {
  // Pin exige Helia rodando — pula quando user optou por não usar IPFS.
  // Manifesto §17 (opt-in vence): "favorite = mirror" só é compromisso
  // quando user explicitamente quer participar da malha.
  if (!ipfsEnabled()) return
  const cids = metas.map((m) => m.cid).filter((c): c is string => Boolean(c))
  if (cids.length === 0) return

  let helia: typeof import('./helia')
  try {
    helia = await import('./helia')
  } catch (err) {
    console.warn('[blobs] Helia indisponível pra pin (degraded):', err)
    return
  }

  for (const cidStr of cids) {
    try {
      const cidObj = await helia.cidFromString(cidStr)
      await helia.pinBlob(cidObj)
    } catch (err) {
      console.warn(`[blobs] pin falhou pra ${cidStr}:`, err)
      // continua próximo — pin é opt-in, não obrigatório
    }
  }
}
