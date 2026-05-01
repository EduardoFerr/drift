/**
 * Tests pro orchestrator (Fase 6.2-D, manifesto §12).
 *
 * Cobre:
 *  - publish broadcast (todos os transportes recebem)
 *  - subscribe fan-out + dedup cross-transport (mesmo event.id de 2
 *    transportes → onevent 1×)
 *  - health concat com prefixo
 *  - registry vazio (no-op gracioso)
 *  - unsubscribe (todos os transportes param)
 *  - oneose: primeiro conta
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  orchestrator,
  registerTransport,
  _resetRegistry,
} from '../src/lib/transport/orchestrator'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from '../src/lib/transport'
import type { SignedEvent } from '../src/types/nostr'

// ─── Fakes ───────────────────────────────────────────────────────────

interface FakeTransport extends Transport {
  published: SignedEvent[]
  subs: Array<{ filter: Filter; handlers: SubscribeHandlers; active: boolean }>
  /** Helper: simula relay entregando evento aos subs ativos. */
  deliver(event: SignedEvent): void
  /** Helper: dispara EOSE em todos os subs. */
  eose(): void
}

function fakeTransport(kind: 'wss' | 'webrtc' | 'tor' | 'bundle' = 'wss'): FakeTransport {
  const published: SignedEvent[] = []
  const subs: FakeTransport['subs'] = []
  return {
    kind,
    publish: vi.fn(async (event: SignedEvent): Promise<PublishResult> => {
      published.push(event)
      return {
        ok: 1,
        failed: 0,
        perRelay: [{ url: `${kind}-fake-1`, ok: true }],
      }
    }),
    subscribe: vi.fn((filter: Filter, handlers: SubscribeHandlers): Unsubscribe => {
      const sub = { filter, handlers, active: true }
      subs.push(sub)
      return () => {
        sub.active = false
      }
    }),
    health: vi.fn(
      async (): Promise<TransportHealth[]> => [
        { url: `${kind}-fake-1`, ok: true, latencyMs: 42 },
      ],
    ),
    published,
    subs,
    deliver(event) {
      for (const s of subs) {
        if (s.active) void s.handlers.onevent(event)
      }
    },
    eose() {
      for (const s of subs) {
        if (s.active && s.handlers.oneose) s.handlers.oneose()
      }
    },
  }
}

function fakeEvent(id: string): SignedEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 9078,
    tags: [],
    content: '{}',
    sig: 'b'.repeat(128),
  }
}

afterEach(() => {
  _resetRegistry()
})

// ─── publish ─────────────────────────────────────────────────────────

describe('orchestrator.publish', () => {
  it('com 0 transports registrados → ok=0, failed=0', async () => {
    const result = await orchestrator.publish(fakeEvent('e1'))
    expect(result).toEqual({ ok: 0, failed: 0, perRelay: [] })
  })

  it('com 1 transport → broadcast e agrega resultado', async () => {
    const t = fakeTransport('wss')
    registerTransport(t)
    const result = await orchestrator.publish(fakeEvent('e1'))
    expect(t.publish).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('com 2 transports → ambos recebem o evento', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const ev = fakeEvent('e1')
    const result = await orchestrator.publish(ev)

    expect(wss.published).toEqual([ev])
    expect(webrtc.published).toEqual([ev])
    expect(result.ok).toBe(2) // 1 de cada
    expect(result.perRelay).toHaveLength(2)
  })

  it('publish que rejeita não faz crash do orchestrator', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    webrtc.publish = vi.fn(async () => {
      throw new Error('relay down')
    })
    registerTransport(wss)
    registerTransport(webrtc)

    const result = await orchestrator.publish(fakeEvent('e1'))
    // wss ok=1, webrtc failed=1
    expect(result.ok).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.perRelay.some((r) => r.error?.includes('relay down'))).toBe(true)
  })
})

// ─── subscribe ───────────────────────────────────────────────────────

describe('orchestrator.subscribe', () => {
  it('com 0 transports → no-op + oneose imediato', async () => {
    const onevent = vi.fn()
    const oneose = vi.fn()
    orchestrator.subscribe({ kinds: [9078] }, { onevent, oneose })
    await new Promise((r) => setTimeout(r, 10))
    expect(onevent).not.toHaveBeenCalled()
    expect(oneose).toHaveBeenCalledTimes(1)
  })

  it('fan-out: registra subscription em cada transport', () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    orchestrator.subscribe({ kinds: [9078] }, { onevent: vi.fn() })
    expect(wss.subs).toHaveLength(1)
    expect(webrtc.subs).toHaveLength(1)
  })

  it('dedup cross-transport: mesmo event.id de 2 transports → onevent 1×', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const onevent = vi.fn()
    orchestrator.subscribe({ kinds: [9078] }, { onevent })

    const ev = fakeEvent('shared-id')
    wss.deliver(ev)
    webrtc.deliver(ev)
    await new Promise((r) => setTimeout(r, 10))

    expect(onevent).toHaveBeenCalledTimes(1)
    expect(onevent).toHaveBeenCalledWith(ev)
  })

  it('eventos distintos passam por dedup individualmente', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const onevent = vi.fn()
    orchestrator.subscribe({ kinds: [9078] }, { onevent })

    wss.deliver(fakeEvent('a'))
    webrtc.deliver(fakeEvent('b'))
    wss.deliver(fakeEvent('c'))
    await new Promise((r) => setTimeout(r, 10))

    expect(onevent).toHaveBeenCalledTimes(3)
  })

  it('oneose: primeiro EOSE conta, demais ignorados', () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const oneose = vi.fn()
    orchestrator.subscribe({ kinds: [9078] }, { onevent: vi.fn(), oneose })

    wss.eose()
    webrtc.eose()
    expect(oneose).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe: para subscriptions em todos os transports', () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const unsub = orchestrator.subscribe({ kinds: [9078] }, { onevent: vi.fn() })
    expect(wss.subs[0]?.active).toBe(true)
    expect(webrtc.subs[0]?.active).toBe(true)

    unsub()
    expect(wss.subs[0]?.active).toBe(false)
    expect(webrtc.subs[0]?.active).toBe(false)
  })
})

// ─── health ──────────────────────────────────────────────────────────

describe('orchestrator.health', () => {
  it('com 0 transports → []', async () => {
    expect(await orchestrator.health()).toEqual([])
  })

  it('concat com prefixo por kind', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    registerTransport(wss)
    registerTransport(webrtc)

    const out = await orchestrator.health()
    expect(out).toHaveLength(2)
    expect(out[0]?.url).toMatch(/^wss:/)
    expect(out[1]?.url).toMatch(/^webrtc:/)
  })

  it('health falhando em 1 transport não derruba os outros', async () => {
    const wss = fakeTransport('wss')
    const webrtc = fakeTransport('webrtc')
    webrtc.health = vi.fn(async () => {
      throw new Error('webrtc dead')
    })
    registerTransport(wss)
    registerTransport(webrtc)

    const out = await orchestrator.health()
    expect(out.some((h) => h.url.startsWith('wss:'))).toBe(true)
    expect(out.some((h) => h.url.startsWith('webrtc:') && !h.ok)).toBe(true)
  })
})

// ─── registerTransport ───────────────────────────────────────────────

describe('registerTransport', () => {
  it('é idempotente: re-register substitui em vez de duplicar', async () => {
    const wss = fakeTransport('wss')
    registerTransport(wss)
    registerTransport(wss) // mesma instância — substitui

    await orchestrator.publish(fakeEvent('e1'))
    expect(wss.publish).toHaveBeenCalledTimes(1) // não 2×
  })
})
