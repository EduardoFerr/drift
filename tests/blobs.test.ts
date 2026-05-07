/**
 * Track B.2.b — testes de blobs.ts orquestrador.
 *
 * Cobertura:
 *  - fetchBlob com hash check passa quando hash bate
 *  - fetchBlob com hash mismatch rejeita e cai pra próxima rota
 *  - fetchBlob sem nenhuma rota (no url, no cid) → BlobError no-source
 *  - fetchBlob com todas as rotas falhando → all-sources-failed
 *  - cache de object URL: fetchBlobUrl reusa a mesma URL pra mesma meta
 *  - releaseBlobUrl revoga e limpa cache
 *
 * NÃO testa:
 *  - Path Helia (depende de browser runtime real — smoke test manual)
 *  - uploadBlob (depende de fetch real do nostr.build — out of scope
 *    de Vitest Node)
 *
 * Mock strategy: stubamos `fetch` global pra controlar respostas HTTP
 * + gateway. Helia é "indisponível" (dynamic import resolve sem
 * problema mas as funções rejeitam) — focamos no path HTTP.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Helia — em Node a init real hangueia (libp2p tenta bind de
// sockets que não existem). Testes do orquestrador focam em HTTP +
// gateway path; Helia path é validado manualmente via dev console
// (window.driftHelia.smokeTest()).
vi.mock('../src/lib/helia', () => ({
  addBlob: vi.fn(async () => {
    throw new Error('helia mock — não disponível em test env')
  }),
  getBlob: vi.fn(async () => {
    throw new Error('helia mock — não disponível em test env')
  }),
  pinBlob: vi.fn(async () => {
    throw new Error('helia mock — não disponível em test env')
  }),
  cidFromString: vi.fn(async (s: string) => ({ toString: () => s })),
  cidToString: vi.fn((c: { toString(): string }) => c.toString()),
}))

import {
  fetchBlob,
  fetchBlobUrl,
  releaseBlobUrl,
  clearBlobUrlCache,
  BlobError,
} from '../src/lib/blobs'
import { sha256Hex } from '../src/lib/nip94'

// Polyfill mínimo de URL.createObjectURL/revokeObjectURL pra Vitest Node
const createdUrls = new Set<string>()
beforeEach(() => {
  createdUrls.clear()
  globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
    const u = `blob:mock-${createdUrls.size}-${blob.size}`
    createdUrls.add(u)
    return u
  })
  globalThis.URL.revokeObjectURL = vi.fn((u: string) => {
    createdUrls.delete(u)
  })
})

afterEach(() => {
  clearBlobUrlCache()
  vi.restoreAllMocks()
})

// Helper pra criar mock fetch que retorna bytes
function mockFetch(responses: Record<string, Uint8Array | { status: number }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const r = responses[url]
    if (!r) {
      return new Response(null, { status: 404 })
    }
    if (r instanceof Uint8Array) {
      // Uint8Array pode estar respaldado por SharedArrayBuffer no Node
      // — copia pra ArrayBuffer dedicado pra Response aceitar.
      const buf = new ArrayBuffer(r.byteLength)
      new Uint8Array(buf).set(r)
      return new Response(buf, { status: 200 })
    }
    return new Response(null, { status: r.status })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('fetchBlob', () => {
  it('rejeita meta sem url nem cid (no-source)', async () => {
    await expect(fetchBlob({})).rejects.toThrow(BlobError)
    await expect(fetchBlob({})).rejects.toMatchObject({ cause: 'no-source' })
  })

  it('retorna bytes quando hash bate', async () => {
    const bytes = new TextEncoder().encode('hello drift')
    const hash = await sha256Hex(bytes)
    mockFetch({ 'https://example.test/img.jpg': bytes })

    const out = await fetchBlob({ url: 'https://example.test/img.jpg', hash })
    expect(new TextDecoder().decode(out)).toBe('hello drift')
  })

  it('aceita bytes quando meta sem hash (compat retro pré-RFC)', async () => {
    const bytes = new TextEncoder().encode('legacy post sem imeta')
    mockFetch({ 'https://example.test/img.jpg': bytes })

    const out = await fetchBlob({ url: 'https://example.test/img.jpg' })
    expect(out.byteLength).toBe(bytes.byteLength)
  })

  it('rejeita rota com hash mismatch e propaga erro all-sources-failed', async () => {
    const bytes = new TextEncoder().encode('conteudo trocado pelo gateway')
    mockFetch({ 'https://example.test/img.jpg': bytes })

    // Hash falso — não bate com bytes acima
    const fakeHash =
      'abababababababababababababababababababababababababababababababab'

    await expect(
      fetchBlob({ url: 'https://example.test/img.jpg', hash: fakeHash }),
    ).rejects.toMatchObject({ cause: 'all-sources-failed' })
  })

  it('falha gracioso quando todas as rotas falham', async () => {
    mockFetch({}) // tudo retorna 404

    await expect(
      fetchBlob({ url: 'https://example.test/nope.jpg' }),
    ).rejects.toMatchObject({ cause: 'all-sources-failed' })
  })

  it('tenta gateway IPFS quando url HTTP falha mas cid presente', async () => {
    const bytes = new TextEncoder().encode('via gateway')
    const hash = await sha256Hex(bytes)
    const cid = 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q'

    mockFetch({
      'https://example.test/missing.jpg': { status: 500 },
      [`https://cloudflare-ipfs.com/ipfs/${cid}`]: bytes,
    })

    const out = await fetchBlob({
      url: 'https://example.test/missing.jpg',
      cid,
      hash,
    })
    expect(new TextDecoder().decode(out)).toBe('via gateway')
  })
})

describe('fetchBlobUrl + cache', () => {
  it('cacheia object URL — segunda chamada retorna mesma URL sem refetch', async () => {
    const bytes = new TextEncoder().encode('cached content')
    const hash = await sha256Hex(bytes)
    const fetchMock = mockFetch({ 'https://example.test/c.jpg': bytes })

    const meta = { url: 'https://example.test/c.jpg', hash, mime: 'image/jpeg' }
    const url1 = await fetchBlobUrl(meta)
    const url2 = await fetchBlobUrl(meta)

    expect(url1).toBe(url2)
    expect(fetchMock).toHaveBeenCalledTimes(1) // segundo hit veio do cache
  })

  it('releaseBlobUrl revoga e remove do cache', async () => {
    const bytes = new TextEncoder().encode('revoke me')
    const hash = await sha256Hex(bytes)
    mockFetch({ 'https://example.test/r.jpg': bytes })

    const meta = { url: 'https://example.test/r.jpg', hash }
    const url = await fetchBlobUrl(meta)

    expect(createdUrls.has(url)).toBe(true)
    releaseBlobUrl(meta)
    expect(createdUrls.has(url)).toBe(false)
  })

  it('cache key usa cid quando disponível', async () => {
    const bytes = new TextEncoder().encode('keyed by cid')
    const hash = await sha256Hex(bytes)
    const cid = 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q'
    mockFetch({ 'https://example.test/x.jpg': bytes })

    // Sem helia path real, vai cair pra HTTP — mas a chave de cache é o cid
    const meta1 = { url: 'https://example.test/x.jpg', cid, hash }
    const meta2 = { url: 'https://example.test/different.jpg', cid, hash }
    const url1 = await fetchBlobUrl(meta1)
    const url2 = await fetchBlobUrl(meta2)

    expect(url1).toBe(url2) // mesmo cid → mesmo cache hit
  })
})
