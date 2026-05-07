/**
 * NIP-94 — File Metadata (https://github.com/nostr-protocol/nips/blob/master/94.md).
 *
 * Drift usa a tag `imeta` do NIP-94 **dentro** de eventos kind 9078
 * (POST), não emite kind 1063 standalone. Cada subpost com mídia gera
 * uma tag `imeta`; reader processa em ordem (RFC blob-distribution.md
 * §3.5.3).
 *
 * **Wire format** (NIP-94):
 *
 *   ["imeta",
 *    "url https://nostr.build/i/abc.jpg",
 *    "x e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *    "m image/jpeg",
 *    "size 245678",
 *    "dim 1920x1080"]
 *
 * Cada elemento (após "imeta") é `"<key> <value>"` separado por espaço
 * único. Valores não podem conter espaço — limitação NIP-94. Usar
 * codificação hex/base64/URL onde necessário.
 *
 * **Drift extensions sobre NIP-94** (RFC §3.5):
 *   - `cid <bafy...>`: CID IPFS Helia, codec=raw + sha2-256 (RFC §3.5.1).
 *     Não é NIP-94 puro mas é sub-conjunto válido — clientes não-Drift
 *     ignoram a key desconhecida.
 *
 * **Múltiplas tags `imeta` com mesmo `x`** (hash) representam o mesmo
 * blob disponível em múltiplas formas (HTTP url + IPFS cid). Reader
 * escolhe a primeira que conseguir resolver. Compat NIP-94 mantida —
 * cada tag standalone funciona com clientes que só leem `url`.
 *
 * **Hash verify obrigatório:** se `x` (SHA-256) está presente, fetcher
 * deve verificar o hash do byte recebido contra `x` antes de exibir.
 * Sem verify, gateway IPFS público vira chave mestra (manifesto §17,
 * RFC §5.2).
 */

import type { Event as NostrEvent } from 'nostr-tools'

/** Metadado de blob extraído de uma tag `imeta` ou montado pra emitir uma. */
export interface BlobMeta {
  /** URL HTTP(S) ou `ipfs://<cid>`. Pelo menos `url` ou `cid` deve existir. */
  url?: string
  /** CID IPFS (string canônica `bafy...` ou `Qm...`). Drift extension. */
  cid?: string
  /** SHA-256 hex do blob (32 bytes → 64 chars hex). Obrigatório p/ verify. */
  hash?: string
  /** MIME type ex.: `image/jpeg`, `image/png`. */
  mime?: string
  /** Tamanho em bytes. */
  size?: number
  /** Dimensões `WIDTHxHEIGHT` ex.: `1920x1080`. */
  dim?: string
  /** Texto alt (acessibilidade). NIP-94 `alt`. */
  alt?: string
  /** Blurhash placeholder. NIP-94 `blurhash`. */
  blurhash?: string
}

// ─── Build ───────────────────────────────────────────────────────────

/**
 * Constrói uma tag `imeta` (string[]) a partir de um BlobMeta.
 *
 * Ordem dos elementos:
 *   1. literal "imeta"
 *   2. `url <...>` — primeiro slot, mais importante (NIP-94 pure)
 *   3. `x <hash>` — verify primário
 *   4. `m <mime>` `size <n>` `dim <WxH>` `alt <...>` `blurhash <...>`
 *   5. `cid <...>` — Drift extension, último (clientes não-Drift ignoram)
 *
 * Valores com espaço **lançam** — wire format NIP-94 não suporta. Caller
 * pode normalizar antes (ex.: alt longo → quebra em alt + summary).
 *
 * @throws Error se nenhum `url` nem `cid` está presente (tag inútil).
 * @throws Error se algum valor contém espaço.
 */
export function buildImetaTag(meta: BlobMeta): string[] {
  if (!meta.url && !meta.cid) {
    throw new Error('imeta tag precisa de url ou cid')
  }

  const parts: string[] = ['imeta']

  // Ordem fixa pra parsing determinístico em readers que assumam.
  if (meta.url) parts.push(kv('url', meta.url))
  if (meta.hash) parts.push(kv('x', meta.hash))
  if (meta.mime) parts.push(kv('m', meta.mime))
  if (meta.size !== undefined) parts.push(kv('size', String(meta.size)))
  if (meta.dim) parts.push(kv('dim', meta.dim))
  if (meta.alt) parts.push(kv('alt', meta.alt))
  if (meta.blurhash) parts.push(kv('blurhash', meta.blurhash))
  if (meta.cid) parts.push(kv('cid', meta.cid))

  return parts
}

function kv(key: string, value: string): string {
  if (value.includes(' ')) {
    throw new Error(
      `imeta value pra "${key}" não pode conter espaço (NIP-94 wire format): "${value}"`,
    )
  }
  return `${key} ${value}`
}

// ─── Parse ───────────────────────────────────────────────────────────

/**
 * Parseia uma tag `imeta` (string[]) pra BlobMeta. Retorna null se a
 * tag não é uma imeta válida (nome diferente ou sem `url`/`cid`).
 *
 * **Tolerante a chaves desconhecidas** — NIP-94 pode crescer; ignoramos
 * keys que não reconhecemos (`thumb`, `image`, `summary`, etc.) sem
 * falhar. Tag inteiramente sem keys conhecidas → null.
 */
export function parseImetaTag(tag: string[]): BlobMeta | null {
  if (tag[0] !== 'imeta') return null

  const meta: BlobMeta = {}

  for (let i = 1; i < tag.length; i++) {
    const entry = tag[i]
    if (typeof entry !== 'string') continue

    // Split no PRIMEIRO espaço; valor não pode ter espaço, mas
    // string.split(' ', 2) joga o resto fora — usa indexOf.
    const sp = entry.indexOf(' ')
    if (sp <= 0) continue

    const key = entry.slice(0, sp)
    const value = entry.slice(sp + 1)
    if (!value) continue

    switch (key) {
      case 'url':
        meta.url = value
        break
      case 'x':
        meta.hash = value.toLowerCase()
        break
      case 'm':
        meta.mime = value
        break
      case 'size': {
        const n = Number(value)
        if (Number.isFinite(n) && n >= 0) meta.size = n
        break
      }
      case 'dim':
        meta.dim = value
        break
      case 'alt':
        meta.alt = value
        break
      case 'blurhash':
        meta.blurhash = value
        break
      case 'cid':
        meta.cid = value
        break
      // chaves desconhecidas: ignora silenciosamente (forward-compat)
    }
  }

  if (!meta.url && !meta.cid) return null
  return meta
}

/**
 * Lista todos os `BlobMeta` do evento, na ordem em que aparecem nas
 * tags. Tags `imeta` mal-formadas são silenciosamente puladas.
 *
 * Convenção Drift (RFC §3.5.3): tags `imeta` aparecem na mesma ordem
 * dos `subposts[i].imageUrl/media` no `content` JSON. Reader vincula
 * sequencialmente.
 */
export function parseImetaTags(event: NostrEvent): BlobMeta[] {
  const out: BlobMeta[] = []
  for (const tag of event.tags) {
    const meta = parseImetaTag(tag)
    if (meta) out.push(meta)
  }
  return out
}

// ─── Hash helper ─────────────────────────────────────────────────────

/**
 * SHA-256 hex (lowercase, 64 chars) de bytes. Usa `crypto.subtle.digest`
 * — disponível em browsers + Node 20+. Necessário em 2 paths:
 *
 *  1. **Antes do upload**: cliente calcula hash do blob e inclui como
 *     `x` na tag imeta. Outros clientes verificam.
 *  2. **Após fetch**: cliente calcula hash do blob baixado e compara
 *     com `x` da tag. Mismatch → rejeita (RFC §5.2, manifesto §17).
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // crypto.subtle.digest exige BufferSource. bytes.buffer pode ser
  // SharedArrayBuffer em certos contextos (worker SAB-enabled) — TS
  // recusa esse tipo. Copiamos pra ArrayBuffer dedicado pra normalizar.
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return bytesToHex(new Uint8Array(hash))
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return s
}
