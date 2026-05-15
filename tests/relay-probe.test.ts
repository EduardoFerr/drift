/**
 * Tests para `relay-probe.ts` — HTTPS pre-probe NIP-11.
 *
 * Cobrem:
 *  - wsToHttp converte schemes corretamente
 *  - probe retorna reachable=true em fetch ok (com e sem JSON)
 *  - probe parsea NIP-11 quando content-type indica JSON
 *  - probe fallback no-cors quando CORS falha
 *  - probe retorna reachable=false em ambos os modes rejeitarem
 *  - cache evita re-fetch dentro do TTL
 *  - erros silenciados (não vazam pra console.error nativo)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  wsToHttp,
  probeRelayReachable,
  PROBE_CACHE_TTL_MS,
  _resetProbeCacheForTests,
  _probeCacheSize,
} from '../src/lib/relay-probe'

beforeEach(() => {
  _resetProbeCacheForTests()
})

describe('wsToHttp', () => {
  it('wss → https', () => {
    expect(wsToHttp('wss://relay.example')).toBe('https://relay.example')
    expect(wsToHttp('wss://relay.example/path?x=1')).toBe('https://relay.example/path?x=1')
  })
  it('ws → http (dev)', () => {
    expect(wsToHttp('ws://localhost:7777')).toBe('http://localhost:7777')
  })
  it('outros schemes ficam unchanged', () => {
    expect(wsToHttp('https://x.example')).toBe('https://x.example')
  })
})

function mkResponse(opts: {
  ok?: boolean
  status?: number
  contentType?: string
  json?: unknown
} = {}): Response {
  const headers = new Headers()
  if (opts.contentType) headers.set('content-type', opts.contentType)
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    json: async () => opts.json,
  } as unknown as Response
}

describe('probeRelayReachable — caminho feliz', () => {
  it('retorna reachable=true em 200 + JSON NIP-11', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      mkResponse({
        contentType: 'application/nostr+json',
        json: { name: 'TestRelay', software: 'test', version: '0.1.0', description: 'd' },
      }),
    )
    const r = await probeRelayReachable('wss://relay.test', 1000, () => 1000, fakeFetch)
    expect(r.reachable).toBe(true)
    expect(r.nip11).toEqual({
      name: 'TestRelay',
      software: 'test',
      version: '0.1.0',
      description: 'd',
      raw: expect.any(Object),
    })
    // Verifica que o header Accept foi passado
    const init = fakeFetch.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>).Accept).toBe('application/nostr+json')
  })

  it('reachable=true mas nip11=null quando content-type não é JSON', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      mkResponse({ contentType: 'text/html', json: {} }),
    )
    const r = await probeRelayReachable('wss://relay.test', 1000, () => 1000, fakeFetch)
    expect(r.reachable).toBe(true)
    expect(r.nip11).toBeNull()
  })

  it('reachable=true mas nip11=null em 4xx (server vivo, sem NIP-11)', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      mkResponse({ ok: false, status: 404 }),
    )
    const r = await probeRelayReachable('wss://relay.test', 1000, () => 1000, fakeFetch)
    expect(r.reachable).toBe(true)
    expect(r.nip11).toBeNull()
  })

  it('latencyMs é calculado via now() deltas', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(mkResponse())
    let t = 100
    const now = () => {
      const v = t
      t += 50
      return v
    }
    const r = await probeRelayReachable('wss://relay.test', 1000, now, fakeFetch)
    // start = 100, after fetch = 150. 150 - 100 = 50.
    expect(r.latencyMs).toBe(50)
  })
})

describe('probeRelayReachable — fallback no-cors', () => {
  it('quando cors falha mas no-cors resolve, reachable=true', async () => {
    const fakeFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('CORS error'))
      .mockResolvedValueOnce(mkResponse())

    const r = await probeRelayReachable('wss://relay.test', 1000, () => 1000, fakeFetch)
    expect(r.reachable).toBe(true)
    expect(r.nip11).toBeNull()
    // Segunda call deve ter mode: 'no-cors'
    const secondInit = fakeFetch.mock.calls[1]![1] as RequestInit
    expect(secondInit.mode).toBe('no-cors')
  })
})

describe('probeRelayReachable — falhas silenciadas', () => {
  it('reachable=false quando ambos modes rejeitam', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new TypeError('net'))
    const r = await probeRelayReachable('wss://dead.test', 1000, () => 1000, fakeFetch)
    expect(r.reachable).toBe(false)
    expect(r.latencyMs).toBeNull()
    expect(r.nip11).toBeNull()
  })

  it('rejeições NÃO escapam como exceções (não disparam console.error nativo)', async () => {
    // Confirma que probe sempre resolve a Promise, nunca rejeita —
    // garantia central pra silenciar o console.error nativo do browser.
    const fakeFetch = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      probeRelayReachable('wss://x', 1000, () => 1000, fakeFetch),
    ).resolves.toBeDefined()
  })
})

describe('cache TTL', () => {
  it('hit dentro do TTL não chama fetch de novo', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(mkResponse())
    const now = vi.fn(() => 1000)
    await probeRelayReachable('wss://relay.test', 1000, now, fakeFetch)
    await probeRelayReachable('wss://relay.test', 1000, now, fakeFetch)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('miss após expirar TTL re-fetcha', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(mkResponse())
    let t = 1000
    const now = () => t
    await probeRelayReachable('wss://relay.test', 1000, now, fakeFetch)
    t += PROBE_CACHE_TTL_MS + 1
    await probeRelayReachable('wss://relay.test', 1000, now, fakeFetch)
    expect(fakeFetch).toHaveBeenCalledTimes(2)
  })

  it('URLs distintas têm entradas separadas', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(mkResponse())
    const now = () => 1000
    await probeRelayReachable('wss://a.test', 1000, now, fakeFetch)
    await probeRelayReachable('wss://b.test', 1000, now, fakeFetch)
    expect(_probeCacheSize()).toBe(2)
  })
})
