/**
 * Track B.2.a — testes do NIP-94 imeta build/parse e SHA-256 hex.
 *
 * Cobertura:
 *  - Round-trip BlobMeta → tag → BlobMeta preserva todos os campos
 *  - Compat com NIP-94 puro (só `url` + `x`) sem extension `cid`
 *  - Drift extension `cid` é parseável
 *  - Múltiplas tags `imeta` no mesmo evento → listadas em ordem
 *  - Validações: rejeita tag sem url/cid, rejeita valor com espaço
 *  - Tolerância: chaves desconhecidas são ignoradas
 *  - SHA-256 hex bate com test vector conhecido
 */

import { describe, expect, it } from 'vitest'
import {
  buildImetaTag,
  parseImetaTag,
  parseImetaTags,
  sha256Hex,
  type BlobMeta,
} from '../src/lib/nip94'
import type { Event as NostrEvent } from 'nostr-tools'

const SAMPLE_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const SAMPLE_CID = 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q'
const SAMPLE_URL = 'https://nostr.build/i/abc.jpg'

describe('buildImetaTag', () => {
  it('monta tag NIP-94 completa', () => {
    const meta: BlobMeta = {
      url: SAMPLE_URL,
      hash: SAMPLE_HASH,
      mime: 'image/jpeg',
      size: 245678,
      dim: '1920x1080',
    }
    const tag = buildImetaTag(meta)
    expect(tag[0]).toBe('imeta')
    expect(tag).toContain(`url ${SAMPLE_URL}`)
    expect(tag).toContain(`x ${SAMPLE_HASH}`)
    expect(tag).toContain('m image/jpeg')
    expect(tag).toContain('size 245678')
    expect(tag).toContain('dim 1920x1080')
  })

  it('inclui Drift extension cid quando presente', () => {
    const tag = buildImetaTag({ cid: SAMPLE_CID, hash: SAMPLE_HASH, url: SAMPLE_URL })
    expect(tag).toContain(`cid ${SAMPLE_CID}`)
  })

  it('aceita só cid (sem url) — IPFS-only path', () => {
    const tag = buildImetaTag({ cid: SAMPLE_CID, hash: SAMPLE_HASH })
    expect(tag[0]).toBe('imeta')
    expect(tag).toContain(`cid ${SAMPLE_CID}`)
    // Não tem url string — confirma com .find
    expect(tag.find((t) => t.startsWith('url '))).toBeUndefined()
  })

  it('rejeita tag sem url nem cid', () => {
    expect(() => buildImetaTag({ hash: SAMPLE_HASH, mime: 'image/jpeg' })).toThrow(
      /url ou cid/,
    )
  })

  it('rejeita valor com espaço (wire format NIP-94)', () => {
    expect(() => buildImetaTag({ url: SAMPLE_URL, alt: 'tem espaço aqui' })).toThrow(
      /não pode conter espaço/,
    )
  })

  it('omite campos undefined', () => {
    const tag = buildImetaTag({ url: SAMPLE_URL })
    expect(tag).toEqual(['imeta', `url ${SAMPLE_URL}`])
  })
})

describe('parseImetaTag', () => {
  it('parseia tag NIP-94 puro (só url + x)', () => {
    const tag = ['imeta', `url ${SAMPLE_URL}`, `x ${SAMPLE_HASH}`]
    const meta = parseImetaTag(tag)
    expect(meta).toEqual({ url: SAMPLE_URL, hash: SAMPLE_HASH })
  })

  it('parseia tag completa com Drift extension cid', () => {
    const tag = [
      'imeta',
      `url ${SAMPLE_URL}`,
      `x ${SAMPLE_HASH}`,
      'm image/jpeg',
      'size 245678',
      'dim 1920x1080',
      `cid ${SAMPLE_CID}`,
    ]
    const meta = parseImetaTag(tag)
    expect(meta).toEqual({
      url: SAMPLE_URL,
      hash: SAMPLE_HASH,
      mime: 'image/jpeg',
      size: 245678,
      dim: '1920x1080',
      cid: SAMPLE_CID,
    })
  })

  it('retorna null se nome da tag não é imeta', () => {
    expect(parseImetaTag(['e', 'event-id'])).toBeNull()
    expect(parseImetaTag(['p', 'pubkey'])).toBeNull()
  })

  it('retorna null se imeta não tem url nem cid', () => {
    expect(parseImetaTag(['imeta', `x ${SAMPLE_HASH}`, 'm image/jpeg'])).toBeNull()
  })

  it('ignora chaves desconhecidas (forward-compat NIP-94)', () => {
    const tag = [
      'imeta',
      `url ${SAMPLE_URL}`,
      `x ${SAMPLE_HASH}`,
      'thumb https://thumb.example/abc.jpg',
      'fallback https://mirror.example/abc.jpg',
      'futureKey someValue',
    ]
    const meta = parseImetaTag(tag)
    // url + hash extraídos; chaves não conhecidas ignoradas
    expect(meta).toEqual({ url: SAMPLE_URL, hash: SAMPLE_HASH })
  })

  it('normaliza hash pra lowercase', () => {
    const upper = SAMPLE_HASH.toUpperCase()
    const tag = ['imeta', `url ${SAMPLE_URL}`, `x ${upper}`]
    const meta = parseImetaTag(tag)
    expect(meta?.hash).toBe(SAMPLE_HASH)
  })

  it('rejeita size não-numérico (mantém undefined)', () => {
    const tag = ['imeta', `url ${SAMPLE_URL}`, 'size not-a-number']
    const meta = parseImetaTag(tag)
    expect(meta?.size).toBeUndefined()
  })

  it('round-trip: build → parse preserva campos', () => {
    const original: BlobMeta = {
      url: SAMPLE_URL,
      cid: SAMPLE_CID,
      hash: SAMPLE_HASH,
      mime: 'image/png',
      size: 12345,
      dim: '800x600',
      blurhash: 'L6PZfSjE.AyE_3t7t7R**0o#DgR4',
    }
    const tag = buildImetaTag(original)
    const parsed = parseImetaTag(tag)
    expect(parsed).toEqual(original)
  })
})

describe('parseImetaTags', () => {
  it('extrai múltiplas imeta na ordem do evento', () => {
    const event: NostrEvent = {
      id: 'x',
      pubkey: 'x',
      sig: 'x',
      created_at: 0,
      kind: 9078,
      content: '',
      tags: [
        ['d', 'post-1'],
        ['imeta', `url ${SAMPLE_URL}`, `x ${SAMPLE_HASH}`],
        ['imeta', `cid ${SAMPLE_CID}`, `x ${SAMPLE_HASH}`],
        ['p', 'pubkey'],
      ],
    }
    const metas = parseImetaTags(event)
    expect(metas).toHaveLength(2)
    expect(metas[0].url).toBe(SAMPLE_URL)
    expect(metas[1].cid).toBe(SAMPLE_CID)
  })

  it('retorna array vazio quando não há imeta', () => {
    const event: NostrEvent = {
      id: 'x',
      pubkey: 'x',
      sig: 'x',
      created_at: 0,
      kind: 9078,
      content: '',
      tags: [['d', 'post-1']],
    }
    expect(parseImetaTags(event)).toEqual([])
  })

  it('pula imeta inválidas sem afetar as válidas', () => {
    const event: NostrEvent = {
      id: 'x',
      pubkey: 'x',
      sig: 'x',
      created_at: 0,
      kind: 9078,
      content: '',
      tags: [
        ['imeta', `x ${SAMPLE_HASH}`], // inválida — sem url/cid
        ['imeta', `url ${SAMPLE_URL}`],
      ],
    }
    const metas = parseImetaTags(event)
    expect(metas).toHaveLength(1)
    expect(metas[0].url).toBe(SAMPLE_URL)
  })
})

describe('sha256Hex', () => {
  // Test vector NIST: SHA-256 de string vazia
  it('hash de string vazia bate com NIST vector', async () => {
    const empty = new Uint8Array(0)
    expect(await sha256Hex(empty)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  // Test vector NIST: SHA-256("abc")
  it('hash de "abc" bate com NIST vector', async () => {
    const abc = new TextEncoder().encode('abc')
    expect(await sha256Hex(abc)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('retorna 64 chars hex lowercase', async () => {
    const data = new TextEncoder().encode('drift')
    const hex = await sha256Hex(data)
    expect(hex).toHaveLength(64)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('round-trip: hash de bytes recortados é igual ao mesmo conteúdo standalone', async () => {
    // TypedArray view sobre buffer maior — confirma que bytesToHex usa view, não buffer
    const big = new Uint8Array(100)
    for (let i = 0; i < 100; i++) big[i] = i
    const view = big.subarray(10, 30) // bytes 10..29
    const standalone = new Uint8Array(view) // copy
    expect(await sha256Hex(view)).toBe(await sha256Hex(standalone))
  })
})
