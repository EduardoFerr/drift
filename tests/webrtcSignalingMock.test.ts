/**
 * Tests pra webrtc-signaling-mock + signaling helpers.
 *
 * BroadcastChannel existe no jsdom moderno (Vitest 4+ usa happy-dom
 * default ou jsdom recente). Se rodando em ambiente antigo, o módulo
 * cai pra noop channel — esses tests cobrem AMBOS os caminhos.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockSignalingChannel,
} from '../src/lib/transport/webrtc-signaling-mock'
import {
  shouldInitiateOffer,
  type SignalingMessage,
} from '../src/lib/transport/signaling'

describe('shouldInitiateOffer — tie-break determinístico', () => {
  it('peer com id menor inicia offer', () => {
    expect(shouldInitiateOffer('aaa', 'bbb')).toBe(true)
    expect(shouldInitiateOffer('bbb', 'aaa')).toBe(false)
  })

  it('mesmo peer não conecta consigo', () => {
    expect(shouldInitiateOffer('xxx', 'xxx')).toBe(false)
  })

  it('lex compare funciona com hex 64 (futuro npub)', () => {
    const a = '0'.repeat(64)
    const b = 'f'.repeat(64)
    expect(shouldInitiateOffer(a, b)).toBe(true)
    expect(shouldInitiateOffer(b, a)).toBe(false)
  })

  it('determinístico — chamadas repetidas dão mesmo resultado', () => {
    const calls = Array.from({ length: 10 }, () =>
      shouldInitiateOffer('peer-A', 'peer-B'),
    )
    expect(calls.every((v) => v === true)).toBe(true)
  })
})

describe('createMockSignalingChannel', () => {
  // Cleanup defensivo entre tests — BroadcastChannel é global na origin
  const channels: ReturnType<typeof createMockSignalingChannel>[] = []

  afterEach(() => {
    while (channels.length > 0) {
      channels.pop()?.close()
    }
  })

  function makeChannel(peerId?: string): ReturnType<typeof createMockSignalingChannel> {
    const ch = createMockSignalingChannel(peerId)
    channels.push(ch)
    return ch
  }

  describe('shape básico', () => {
    it('retorna objeto com peerId, send, onMessage, close', () => {
      const ch = makeChannel('test-1')
      expect(ch.peerId).toBe('test-1')
      expect(typeof ch.send).toBe('function')
      expect(typeof ch.onMessage).toBe('function')
      expect(typeof ch.close).toBe('function')
    })

    it('peerId default é UUID-like quando omitido', () => {
      const ch = makeChannel()
      expect(typeof ch.peerId).toBe('string')
      expect(ch.peerId.length).toBeGreaterThan(8)
    })

    it('close é idempotente', () => {
      const ch = makeChannel('idempotent')
      ch.close()
      expect(() => ch.close()).not.toThrow()
    })
  })

  describe('onMessage / send entre 2 canais', () => {
    // Skip estes tests se BroadcastChannel não existe no ambiente
    const hasBC = typeof BroadcastChannel !== 'undefined'
    const test = hasBC ? it : it.skip

    test('msg enviada por A chega em B (mesmo realm)', async () => {
      const a = makeChannel('peer-A')
      const b = makeChannel('peer-B')

      const received: SignalingMessage[] = []
      b.onMessage((msg) => received.push(msg))

      const offer: SignalingMessage = {
        type: 'offer',
        from: 'peer-A',
        to: 'peer-B',
        ts: Date.now(),
        sdp: 'fake-sdp',
      }
      await a.send(offer)

      // BroadcastChannel é assíncrono — aguarda microtask
      await new Promise((r) => setTimeout(r, 50))

      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        type: 'offer',
        from: 'peer-A',
        to: 'peer-B',
        sdp: 'fake-sdp',
      })
    })

    test('A não recebe sua própria msg (auto-filter)', async () => {
      const a = makeChannel('peer-self')

      const received: SignalingMessage[] = []
      a.onMessage((msg) => received.push(msg))

      await a.send({
        type: 'hello',
        from: 'peer-self',
        ts: Date.now(),
        drift: { capabilities: ['datachannel-v1'] },
      })

      await new Promise((r) => setTimeout(r, 50))

      // BroadcastChannel não ecoa pro emissor por spec; nosso filtro
      // adicional garante isso mesmo se algum dia mudar.
      expect(received).toHaveLength(0)
    })

    test('handler removido por unsubscribe não recebe mais', async () => {
      const a = makeChannel('a')
      const b = makeChannel('b')

      const received: SignalingMessage[] = []
      const off = b.onMessage((msg) => received.push(msg))

      await a.send({
        type: 'hello',
        from: 'a',
        ts: 1,
        drift: { capabilities: [] },
      })
      await new Promise((r) => setTimeout(r, 30))

      off() // unsubscribe

      await a.send({
        type: 'hello',
        from: 'a',
        ts: 2,
        drift: { capabilities: [] },
      })
      await new Promise((r) => setTimeout(r, 30))

      // Só a primeira msg deve ter chegado
      expect(received).toHaveLength(1)
      expect(received[0]?.ts).toBe(1)
    })

    test('múltiplos handlers recebem a mesma msg', async () => {
      const a = makeChannel('a-multi')
      const b = makeChannel('b-multi')

      const log1: SignalingMessage[] = []
      const log2: SignalingMessage[] = []
      b.onMessage((m) => log1.push(m))
      b.onMessage((m) => log2.push(m))

      await a.send({
        type: 'bye',
        from: 'a-multi',
        ts: 99,
      })
      await new Promise((r) => setTimeout(r, 30))

      expect(log1).toHaveLength(1)
      expect(log2).toHaveLength(1)
      expect(log1[0]?.from).toBe('a-multi')
      expect(log2[0]?.from).toBe('a-multi')
    })

    test('close() para de receber', async () => {
      const a = makeChannel('a-close')
      const b = makeChannel('b-close')

      const received: SignalingMessage[] = []
      b.onMessage((m) => received.push(m))

      b.close()

      await a.send({
        type: 'hello',
        from: 'a-close',
        ts: 1,
        drift: { capabilities: [] },
      })
      await new Promise((r) => setTimeout(r, 30))

      expect(received).toHaveLength(0)
    })

    test('send após close é no-op (não throwa)', async () => {
      const a = makeChannel('a-send-closed')
      a.close()
      await expect(
        a.send({
          type: 'hello',
          from: 'a-send-closed',
          ts: 1,
          drift: { capabilities: [] },
        }),
      ).resolves.toBeUndefined()
    })

    test('msgs malformadas no canal são ignoradas', async () => {
      // Simula debris — outro consumidor da mesma BroadcastChannel
      // postando coisa não-Drift. Mock não deve quebrar.
      if (typeof BroadcastChannel === 'undefined') return

      const a = makeChannel('a-debris')
      const received: SignalingMessage[] = []
      a.onMessage((m) => received.push(m))

      const debris = new BroadcastChannel('drift-webrtc-signaling-mock')
      debris.postMessage({ random: 'object' })
      debris.postMessage('string')
      debris.postMessage(null)
      debris.postMessage({ type: 'unknown', from: 'x', ts: 1 })

      await new Promise((r) => setTimeout(r, 50))
      debris.close()

      expect(received).toHaveLength(0)
    })
  })

  describe('correção defensiva', () => {
    it('send corrige msg.from se diferente do peerId', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const a = makeChannel('correct-id')
      const b = makeChannel('listener')

      const received: SignalingMessage[] = []
      b.onMessage((m) => received.push(m))

      // Caller envia com from errado — mock corrige
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await a.send({
        type: 'hello',
        from: 'WRONG_ID',
        ts: 1,
        drift: { capabilities: [] },
      })
      await new Promise((r) => setTimeout(r, 30))

      expect(received).toHaveLength(1)
      expect(received[0]?.from).toBe('correct-id')
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })
})
