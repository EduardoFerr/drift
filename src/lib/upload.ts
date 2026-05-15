/**
 * Upload de imagem em hospedagem pública gratuita (nostr.build).
 *
 * IMPORTANTE — manifesto §25 v2.2 (Sem Scan Automático Obrigatório):
 * cliente oficial padrão NÃO escaneia o conteúdo da imagem antes do
 * upload. Sem PhotoDNA, sem nsfwjs, sem ML embutido por default.
 * Auto-classificação é responsabilidade voluntária do autor via tag
 * `content-warning` no kind 9078 (manifesto §27). Plugins opt-in
 * OFF-by-default podem hookar nesta camada em fases futuras, mas não
 * são parte do MVP.
 *
 * Pré-processamento (compressão local, sem inspeção de conteúdo):
 *  - Foto de celular hoje pode ter 5-15MB. nostr.build aceita até ~25MB
 *    mas demora muito; bateria do user agradece se mandamos 1-2MB.
 *  - `browser-image-compression` redimensiona pra 1920px no maior lado
 *    e recomprime JPEG quality 0.8 antes do upload. EXIF é descartado
 *    (privacidade — manifesto §28: lat/lng/timestamp no EXIF é
 *    deanonymization vector).
 *  - GIF não é recomprimido (perderia animação) — vai como veio.
 *
 * Resiliência (skill distributed-systems/resilience-retry-backoff):
 *  - Exponential backoff com **full jitter** (não fixed delay): 3
 *    tentativas, base 2s, teto 10s. Evita thundering herd se nostr.build
 *    fica indisponível e N clientes Drift retryam ao mesmo tempo.
 *  - **Classificação de erro** antes de retry: 408/429/5xx retry,
 *    400/401/403/422 fail-fast (skill error-classification).
 *  - Exposed AbortSignal pra UI cancelar upload em andamento.
 *
 * Lifecycle simples:
 *
 *   const url = await uploadImage(file, { onProgress })
 *
 * Em caso de erro depois de 3 tentativas, throw — chamador exibe.
 */

import imageCompression from 'browser-image-compression'
import { finalizeEvent } from 'nostr-tools/pure'
import type { EventTemplate } from 'nostr-tools'
import { getOrCreateIdentity, nsecHexToBytes } from './identity'

const NOSTR_BUILD_ENDPOINT = 'https://nostr.build/api/v2/upload/files'

/**
 * Constrói header `Authorization: Nostr <base64>` exigido por nostr.build
 * (NIP-98). O endpoint `/api/v2/upload/files` rejeita 401 sem isso desde
 * meados de 2025 — antes era anônimo. Token é um kind 27235 assinado
 * com a identidade ativa, com tags `u <url>` + `method <METHOD>` +
 * `created_at` (servidor valida ±60s).
 *
 * Fail soft: se identity não existe (boot incompleto) ou sign falha,
 * retorna null — caller continua sem header e cai no 401 normal,
 * que UI já trata.
 */
async function buildNip98Header(url: string, method: string): Promise<string | null> {
  try {
    const identity = await getOrCreateIdentity()
    const nsecBytes = nsecHexToBytes(identity.nsec)
    const sign = (template: EventTemplate) => finalizeEvent(template, nsecBytes)
    // V9.34b — lazy import do submódulo direto (não do barrel) pra
    // adiar nip98 + impedir que o barrel inteiro venha junto. Upload
    // só dispara quando user escolhe imagem no compose, momento fora
    // do critical path do first paint.
    const { getToken } = await import('nostr-tools/nip98')
    // includeAuthorizationScheme=true → retorna string já com "Nostr "
    return await getToken(url, method, sign, true)
  } catch (err) {
    console.warn('[upload] NIP-98 token build falhou:', err)
    return null
  }
}

const COMPRESSION_OPTIONS = {
  maxSizeMB: 2,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  // EXIF strip é o default em browser-image-compression — explícito aqui
  // para deixar a intenção clara (manifesto §28 — privacidade).
  preserveExif: false,
}
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 2_000
const MAX_DELAY_MS = 10_000

/** Status codes HTTP que justificam retry (transitórios). */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

/** Status codes que NÃO devem ser retentados (permanentes). */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 405, 410, 413, 415, 422])

export interface UploadOptions {
  /** Cancelar o upload em andamento. */
  signal?: AbortSignal
  /** Callback de progresso de byte (0..1). Opcional. */
  onProgress?: (fraction: number) => void
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly cause: 'network' | 'http' | 'invalid-response' | 'aborted' | 'unknown',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

/**
 * Faz upload de uma imagem pro nostr.build.
 *
 * Retorna a URL absoluta da imagem hospedada, pronta pra ser referenciada
 * em um Subpost (`type: 'image'` ou `'text+image'`).
 *
 * @param file - Imagem a fazer upload (browser File / Blob).
 * @param options - Opções de cancelamento e progresso.
 * @returns URL absoluta da imagem hospedada.
 * @throws {UploadError} Após 3 tentativas falharem, ou erro permanente
 *   (4xx exceto 408/429), ou cancelamento explícito.
 *
 * @example
 * ```typescript
 * const url = await uploadImage(file)
 * const subpost: Subpost = {
 *   id: crypto.randomUUID(),
 *   type: 'image',
 *   text: null,
 *   imageUrl: url,
 *   order: 0,
 * }
 * ```
 */
export async function uploadImage(
  file: File | Blob,
  options: UploadOptions = {},
): Promise<string> {
  const prepared = await prepareForUpload(file, options.signal)

  let lastError: UploadError | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (options.signal?.aborted) {
      throw new UploadError('Upload cancelado', 'aborted')
    }

    try {
      return await uploadOnce(prepared, options)
    } catch (err) {
      const upErr = toUploadError(err)
      lastError = upErr

      // Cancelamento sempre falha imediatamente — não é problema do servidor.
      if (upErr.cause === 'aborted') throw upErr

      // Classificação explícita do erro (skill error-classification):
      // - 4xx permanente → fail-fast, não adianta retentar
      // - 408/429/5xx → retryable conhecido
      // - Erro de rede sem status → assumimos retryable (timeout/conn reset)
      // - Outros 4xx não-retryable conhecidos → fail-fast
      if (upErr.status !== undefined) {
        if (NON_RETRYABLE_STATUS.has(upErr.status)) throw upErr
        if (!RETRYABLE_STATUS.has(upErr.status)) {
          // Status fora dos dois conjuntos → trata como permanente por segurança.
          // Ex: 418, 451 — não esperados, melhor falhar visivelmente que retentar.
          throw upErr
        }
      }

      // Última tentativa — desiste.
      if (attempt === MAX_ATTEMPTS) throw upErr

      // Aguarda com full jitter antes de retentar.
      const baseDelay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
      const jittered = Math.random() * baseDelay
      await sleep(jittered, options.signal)
    }
  }

  // Inalcançável — o loop sempre retorna ou throw. Defensivo.
  throw lastError ?? new UploadError('Falha desconhecida no upload', 'unknown')
}

// ─── Implementação privada ───────────────────────────────────────────

/**
 * Comprime/redimensiona se necessário antes do upload. GIF passa intacto
 * (preserva animação). Falha de compressão NÃO bloqueia upload — manda
 * o original (compressão é otimização, não correção).
 */
async function prepareForUpload(file: File | Blob, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw new UploadError('Upload cancelado', 'aborted')

  // GIFs perdem animação se reprocessados; deixa passar.
  if (file.type === 'image/gif') return file

  // Não-imagens não devem chegar aqui (UI filtra), mas se chegarem,
  // pula compressão e deixa o servidor decidir.
  if (!file.type.startsWith('image/')) return file

  try {
    return await imageCompression(file as File, COMPRESSION_OPTIONS)
  } catch (err) {
    // Log mas não falha — compressão é nice-to-have.
    console.warn('[upload] compressão falhou, enviando original:', err)
    return file
  }
}

async function uploadOnce(
  file: Blob,
  options: UploadOptions,
): Promise<string> {
  const form = new FormData()
  form.append('fileToUpload', file)

  const res = await fetchWithProgress(NOSTR_BUILD_ENDPOINT, form, options)

  if (!res.ok) {
    throw new UploadError(
      `nostr.build retornou HTTP ${res.status}`,
      'http',
      res.status,
    )
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new UploadError('Resposta do nostr.build não é JSON válido', 'invalid-response')
  }

  const url = extractUrl(body)
  if (!url) {
    throw new UploadError(
      'Resposta do nostr.build não contém URL da imagem',
      'invalid-response',
    )
  }
  return url
}

/**
 * fetch() não suporta progresso de upload nativamente em browsers ainda
 * (ReadableStream em uplink é experimental). Fallback: usa fetch sem
 * progresso. Quando `onProgress` é passado, ainda assim damos um único
 * tick em 1.0 quando termina — UI já mostra "concluído" em vez de
 * pendurar em 0%.
 */
async function fetchWithProgress(
  url: string,
  body: FormData,
  options: UploadOptions,
): Promise<Response> {
  try {
    // NIP-98 auth header — exigido pelo nostr.build /api/v2/upload/files.
    // Sem isso, server retorna 401 fail-fast (não-retryable).
    const authHeader = await buildNip98Header(url, 'POST')
    const headers: Record<string, string> = {}
    if (authHeader) headers['Authorization'] = authHeader

    const res = await fetch(url, {
      method: 'POST',
      body,
      headers,
      signal: options.signal,
    })
    options.onProgress?.(1)
    return res
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new UploadError('Upload cancelado', 'aborted')
    }
    // TypeError em fetch === falha de rede (DNS, conexão, CORS bloqueado etc.)
    throw new UploadError(
      err instanceof Error ? err.message : String(err),
      'network',
    )
  }
}

function extractUrl(body: unknown): string | null {
  // nostr.build v2 responde { status, message, data: [{ url, ... }, ...] }
  if (typeof body !== 'object' || body === null) return null
  const b = body as { data?: unknown }
  if (!Array.isArray(b.data) || b.data.length === 0) return null
  const first = b.data[0] as { url?: unknown }
  return typeof first.url === 'string' ? first.url : null
}

function toUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err
  if (err instanceof Error) return new UploadError(err.message, 'unknown')
  return new UploadError(String(err), 'unknown')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError('Upload cancelado', 'aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new UploadError('Upload cancelado', 'aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

