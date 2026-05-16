/**
 * Bundle transport — offline sneakernet (manifesto §15, §16, §31.3).
 *
 * Cobertura:
 *  - exportBundle com eventos válidos → JSON + qrParts
 *  - exportBundle vazio → envelope mínimo
 *  - exportBundle respeita MAX_BUNDLE_EVENTS cap
 *  - importBundle com eventos Schnorr-válidos → retorna verificados
 *  - importBundle com assinatura inválida → dropa silenciosamente
 *  - importBundle com JSON inválido → array vazio
 *  - importBundle com versão futura → array vazio
 *  - reassembleChunks reordena e junta chunks
 *  - reassembleChunks com chunk faltando → null
 *  - roundtrip export → import preserva eventos
 */

import { describe, expect, it, vi } from 'vitest'
import {
  exportBundle,
  importBundle,
  reassembleChunks,
} from '../src/lib/transport/webrtc/bundle'

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn((event: { sig: string }) => {
    return event.sig !== 'invalid'
  }),
}))

function makeFakeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 9078,
    created_at: 1700000000,
    content: '{}',
    tags: [],
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('exportBundle', () => {
  it('exporta envelope válido com eventos', () => {
    const events = [makeFakeEvent()]
    const result = exportBundle(events as any)
    expect(result.eventCount).toBe(1)
    expect(result.json).toContain('"v":1')
    expect(result.json).toContain('"events"')
    expect(result.qrParts.length).toBeGreaterThan(0)
  })

  it('exporta envelope vazio quando sem eventos', () => {
    const result = exportBundle([])
    expect(result.eventCount).toBe(0)
    expect(result.qrParts).toEqual([])
  })

  it('limita a MAX_BUNDLE_EVENTS (500)', () => {
    const events = Array.from({ length: 600 }, (_, i) =>
      makeFakeEvent({ id: i.toString(16).padStart(64, '0') }),
    )
    const result = exportBundle(events as any)
    expect(result.eventCount).toBe(500)
  })

  it('produz múltiplos QR chunks pra bundles grandes', () => {
    const bigContent = 'x'.repeat(500)
    const events = Array.from({ length: 20 }, (_, i) =>
      makeFakeEvent({ id: i.toString(16).padStart(64, '0'), content: bigContent }),
    )
    const result = exportBundle(events as any)
    if (result.json.length > 1800) {
      expect(result.qrParts.length).toBeGreaterThan(1)
      expect(result.qrParts[0]).toMatch(/^DRIFT:1\//)
    }
  })
})

describe('importBundle', () => {
  it('importa eventos com assinatura válida', async () => {
    const events = [makeFakeEvent()]
    const { json } = exportBundle(events as any)
    const result = await importBundle(json)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a'.repeat(64))
  })

  it('dropa eventos com assinatura inválida', async () => {
    const events = [makeFakeEvent({ sig: 'invalid' })]
    const { json } = exportBundle(events as any)
    const result = await importBundle(json)
    expect(result).toHaveLength(0)
  })

  it('retorna array vazio pra JSON inválido', async () => {
    const result = await importBundle('not json at all')
    expect(result).toEqual([])
  })

  it('retorna array vazio pra versão futura', async () => {
    const result = await importBundle('{"v":99,"events":[],"exportedAt":0}')
    expect(result).toEqual([])
  })

  it('retorna array vazio pra estrutura inválida', async () => {
    const result = await importBundle('{"v":1,"events":"not-array"}')
    expect(result).toEqual([])
  })

  it('dropa entradas que não são eventos plausíveis', async () => {
    const json = JSON.stringify({
      v: 1,
      events: [makeFakeEvent(), { garbage: true }, null, 42],
      exportedAt: 0,
    })
    const result = await importBundle(json)
    expect(result).toHaveLength(1)
  })
})

describe('reassembleChunks', () => {
  it('retorna string direta quando 1 chunk sem prefixo DRIFT', () => {
    const result = reassembleChunks(['{"v":1,"events":[]}'])
    expect(result).toBe('{"v":1,"events":[]}')
  })

  it('reordena e junta chunks DRIFT:N/M:...', () => {
    const chunks = [
      'DRIFT:2/3:world',
      'DRIFT:1/3:hello',
      'DRIFT:3/3:!',
    ]
    expect(reassembleChunks(chunks)).toBe('helloworld!')
  })

  it('retorna null quando faltam chunks', () => {
    const chunks = ['DRIFT:1/3:hello', 'DRIFT:3/3:!']
    expect(reassembleChunks(chunks)).toBeNull()
  })

  it('retorna null quando totais inconsistentes', () => {
    const chunks = ['DRIFT:1/2:hello', 'DRIFT:2/3:!']
    expect(reassembleChunks(chunks)).toBeNull()
  })

  it('retorna null pra array vazio', () => {
    expect(reassembleChunks([])).toBeNull()
  })
})

describe('roundtrip', () => {
  it('export → reassemble → import preserva eventos', async () => {
    const events = [
      makeFakeEvent({ id: '1'.repeat(64) }),
      makeFakeEvent({ id: '2'.repeat(64) }),
    ]
    const { qrParts } = exportBundle(events as any)
    const json = reassembleChunks(qrParts)
    expect(json).not.toBeNull()
    const imported = await importBundle(json!)
    expect(imported).toHaveLength(2)
    expect(imported[0].id).toBe('1'.repeat(64))
    expect(imported[1].id).toBe('2'.repeat(64))
  })
})
