/**
 * Track B opt-in (Lily 2026-05-08) — verifica que `use_ipfs=false` faz
 * `blobs.ts` pular o path Helia em fetch + upload + pin.
 *
 * Default agora é OFF. Manifesto §17 (sem chave mestra: opt-in vence)
 * + alívio do problema de 1033 reqs/3min reportado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const heliaMocks = {
  addBlob: vi.fn(async () => ({ toString: () => 'bafy-mock-cid' })),
  getBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
  pinBlob: vi.fn(async () => {}),
  cidFromString: vi.fn(async (s: string) => ({ toString: () => s })),
  cidToString: vi.fn((c: { toString(): string }) => c.toString()),
}

vi.mock('../src/lib/helia', () => heliaMocks)

// Mock prefs.getPrefs — injetamos use_ipfs por test.
const prefsState = { use_ipfs: false }
vi.mock('../src/lib/prefs', () => ({
  getPrefs: () => prefsState,
}))

// Mock upload — só importa não fazer HTTP real.
vi.mock('../src/lib/upload', () => ({
  uploadImage: vi.fn(async () => 'https://example.test/uploaded.jpg'),
  UploadError: class UploadError extends Error {},
}))

import {
  fetchBlob,
  uploadBlob,
  pinBlobsFromMeta,
  clearBlobUrlCache,
} from '../src/lib/blobs'
import { sha256Hex } from '../src/lib/nip94'

beforeEach(() => {
  prefsState.use_ipfs = false
  for (const m of Object.values(heliaMocks)) {
    if ('mockClear' in m) (m as ReturnType<typeof vi.fn>).mockClear()
  }
  // fetch global stub mínimo — todos os tests aqui usam HTTP path
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
  globalThis.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  clearBlobUrlCache()
  vi.restoreAllMocks()
})

describe('use_ipfs=false (default)', () => {
  it('fetchBlob NÃO chama getBlob via Helia', async () => {
    const bytes = new TextEncoder().encode('http only')
    const hash = await sha256Hex(bytes)
    globalThis.fetch = vi.fn(async () => {
      const buf = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buf).set(bytes)
      return new Response(buf, { status: 200 })
    }) as unknown as typeof fetch

    await fetchBlob({
      url: 'https://example.test/x.jpg',
      cid: 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q',
      hash,
    })

    expect(heliaMocks.getBlob).not.toHaveBeenCalled()
  })

  it('uploadBlob NÃO chama addBlob via Helia (cid undefined no resultado)', async () => {
    const bytes = new TextEncoder().encode('upload sem ipfs')
    const file = new Blob([bytes], { type: 'application/octet-stream' })

    const out = await uploadBlob(file)
    expect(out.url).toBe('https://example.test/uploaded.jpg')
    expect(out.cid).toBeUndefined()
    expect(heliaMocks.addBlob).not.toHaveBeenCalled()
  })

  it('pinBlobsFromMeta é no-op silencioso', async () => {
    await pinBlobsFromMeta([
      { cid: 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q' },
      { cid: 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4r' },
    ])
    expect(heliaMocks.pinBlob).not.toHaveBeenCalled()
  })
})

describe('use_ipfs=true (opt-in)', () => {
  beforeEach(() => {
    prefsState.use_ipfs = true
  })

  it('fetchBlob tenta Helia path quando cid presente', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const hash = await sha256Hex(bytes)
    heliaMocks.getBlob.mockResolvedValueOnce(bytes)

    const out = await fetchBlob({
      cid: 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q',
      hash,
    })
    expect(out).toEqual(bytes)
    expect(heliaMocks.getBlob).toHaveBeenCalledTimes(1)
  })

  it('uploadBlob tenta addBlob via Helia (cid populado no resultado)', async () => {
    const bytes = new TextEncoder().encode('com ipfs')
    const file = new Blob([bytes], { type: 'application/octet-stream' })

    const out = await uploadBlob(file)
    expect(out.cid).toBe('bafy-mock-cid')
    expect(heliaMocks.addBlob).toHaveBeenCalledTimes(1)
  })

  it('pinBlobsFromMeta itera CIDs e chama pinBlob', async () => {
    await pinBlobsFromMeta([
      { cid: 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q' },
    ])
    expect(heliaMocks.pinBlob).toHaveBeenCalledTimes(1)
  })
})
