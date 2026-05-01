/**
 * Tests pra webrtc-signaling-nostr — SignalingChannel via Nostr DM
 * cifrado (NIP-44 v2 + kind 1059).
 *
 * Fakes:
 *  - `fakeRelay()` — bus compartilhado entre fake transports. Quando
 *    Alice.transport.publish(ev) é chamado, todos os subscribers de
 *    todos os transports conectados ao mesmo relay recebem (filter já
 *    avaliado por matchFilter mínimo inline).
 *  - `fakeTransport(relay)` — implementa Transport com publish que
 *    encaminha pro relay e subscribe que registra handler.
 *
 * Cobertura: round-trip cifrado, drops (decrypt fail, anti-spoof,
 * replay window, dedup, rate limit), send semantics (bye/hello drop,
 * sanitize from), close().
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  nostrSignalingChannel,
  type NostrSignalingOpts,
} from '../src/lib/transport/webrtc-signaling-nostr'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from '../src/lib/transport'
import type {
  AnswerMsg,
  IceMsg,
  OfferMsg,
  SignalingMessage,
} from '../src/lib/transport/signaling'
import { encryptDM } from '../src/lib/nostr'

// ─── Fakes ───────────────────────────────────────────────────────────

interface Subscription {
  filter: Filter
  handlers: SubscribeHandlers
  active: boolean
}

interface FakeRelay {
  subs: Subscription[]
  deliver(event: NostrEvent): void
}

function fakeRelay(): FakeRelay {
  const subs: Subscription[] = []
  return {
    subs,
    deliver(event: NostrEvent): void {
      for (const s of subs) {
        if (!s.active) continue
        if (matches(s.filter, event)) {
          // Async-ish — match comportamento real (microtask).
          Promise.resolve().then(() => {
            if (s.active) s.handlers.onevent(event)
          })
        }
      }
    },
  }
}

function matches(filter: Filter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.since && event.created_at < filter.since) return false
  // Tag filters: '#p', '#e' etc.
  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#') || key.length !== 2) continue
    const tagName = key[1]
    const expected = (filter as Record<string, unknown>)[key] as string[]
    const eventTagValues = event.tags
      .filter((t) => t[0] === tagName)
      .map((t) => t[1])
    const intersect = expected.some((v) => eventTagValues.includes(v))
    if (!intersect) return false
  }
  return true
}

function fakeTransport(relay: FakeRelay): Transport & {
  published: NostrEvent[]
  subs: Subscription[]
} {
  const published: NostrEvent[] = []
  const localSubs: Subscription[] = []

  const t: Transport & { published: NostrEvent[]; subs: Subscription[] } = {
    kind: 'wss',
    publish: vi.fn(async (event: NostrEvent): Promise<PublishResult> => {
      published.push(event)
      relay.deliver(event)
      return { ok: 1, failed: 0, perRelay: [{ url: 'fake', ok: true }] }
    }),
    subscribe: vi.fn((filter: Filter, handlers: SubscribeHandlers): Unsubscribe => {
      const sub: Subscription = { filter, handlers, active: true }
      relay.subs.push(sub)
      localSubs.push(sub)
      return () => {
        sub.active = false
      }
    }),
    health: vi.fn(
      async (): Promise<TransportHealth[]> => [
        { url: 'fake', ok: true, latencyMs: 0 },
      ],
    ),
    published,
    subs: localSubs,
  }
  return t
}

// ─── Identity helpers ────────────────────────────────────────────────

function pair(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  return { sk, pk }
}

/** Sign helper que assina com chave dada (substitui signDriftEvent global). */
function makeSigner(sk: Uint8Array): NostrSignalingOpts['signEvent'] {
  return async (input) => {
    return finalizeEvent(
      {
        kind: input.kind,
        tags: input.tags,
        content: input.content,
        created_at: Math.floor(Date.now() / 1000),
      },
      sk,
    )
  }
}

// Pequeno yield pra propagar microtasks do fake relay.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('nostrSignalingChannel — round-trip cifrado', () => {
  const channels: Array<ReturnType<typeof nostrSignalingChannel>> = []

  afterEach(() => {
    while (channels.length) channels.pop()?.close()
  })

  it('Alice envia OfferMsg e Bob recebe decifrado', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)
    const tB = fakeTransport(relay)

    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chA, chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    const offer: OfferMsg = {
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      ts: Date.now(),
      sdp: 'v=0\r\nfake-sdp',
    }
    await chA.send(offer)
    await flush()

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      sdp: 'v=0\r\nfake-sdp',
    })
    // Verifica que o evento publicado é kind 1059 e tem #p tag.
    expect(tA.published).toHaveLength(1)
    expect(tA.published[0].kind).toBe(1059)
    expect(tA.published[0].tags).toContainEqual(['p', bob.pk])
  })

  it('AnswerMsg e múltiplos IceMsgs viram eventos separados', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)
    const tB = fakeTransport(relay)

    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chA, chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    const answer: AnswerMsg = {
      type: 'answer',
      from: alice.pk,
      to: bob.pk,
      ts: Date.now(),
      sdp: 'answer-sdp',
    }
    await chA.send(answer)

    for (let i = 0; i < 3; i++) {
      const ice: IceMsg = {
        type: 'ice',
        from: alice.pk,
        to: bob.pk,
        ts: Date.now(),
        candidate: { candidate: `cand-${i}`, sdpMLineIndex: 0, sdpMid: '0' },
      }
      await chA.send(ice)
    }
    await flush()

    expect(tA.published).toHaveLength(4) // 1 answer + 3 ice
    expect(received).toHaveLength(4)
    expect(received[0].type).toBe('answer')
    expect(received.slice(1).every((m) => m.type === 'ice')).toBe(true)
  })
})

describe('nostrSignalingChannel — drops defensivos', () => {
  const channels: Array<ReturnType<typeof nostrSignalingChannel>> = []

  afterEach(() => {
    while (channels.length) channels.pop()?.close()
  })

  it('drop em decrypt fail (Charlie cifra pra Bob, payload chega em outro)', async () => {
    // Construímos manualmente um evento cifrado pra Bob mas assinado por
    // Charlie e tentamos entregar a Bob. Bob consegue decifrar (cifrado
    // pra ele de fato) — então testamos de outro ângulo: payload cifrado
    // pra OUTRA pessoa que não Bob → decryptDM falha.
    const alice = pair()
    const bob = pair()
    const charlie = pair()
    const relay = fakeRelay()
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    // Alice cifra mensagem pra Charlie (não Bob), mas tag '#p' aponta
    // pra Bob — relay entrega, mas Bob falha em decifrar.
    const ct = encryptDM(
      JSON.stringify({
        type: 'offer',
        from: alice.pk,
        to: bob.pk,
        ts: Date.now(),
        sdp: 'x',
      }),
      charlie.pk,
      alice.sk,
    )
    const ev = finalizeEvent(
      {
        kind: 1059,
        tags: [['p', bob.pk]],
        content: ct,
        created_at: Math.floor(Date.now() / 1000),
      },
      alice.sk,
    )
    relay.deliver(ev)
    await flush()

    expect(received).toHaveLength(0)
  })

  it('drop em anti-spoof: msg.from interno !== event.pubkey', async () => {
    const alice = pair()
    const bob = pair()
    const eve = pair() // atacante
    const relay = fakeRelay()
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    // Eve cifra msg pra Bob mas claim ser Alice no `from` interno.
    const spoofMsg = {
      type: 'offer',
      from: alice.pk, // <-- spoof
      to: bob.pk,
      ts: Date.now(),
      sdp: 'malicious',
    }
    const ct = encryptDM(JSON.stringify(spoofMsg), bob.pk, eve.sk)
    const ev = finalizeEvent(
      {
        kind: 1059,
        tags: [['p', bob.pk]],
        content: ct,
        created_at: Math.floor(Date.now() / 1000),
      },
      eve.sk,
    )
    relay.deliver(ev)
    await flush()

    // Bob decifra OK mas detecta from mismatch e dropa.
    expect(received).toHaveLength(0)
  })

  it('drop em replay window (event 2min atrás)', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    const oldTs = Math.floor(Date.now() / 1000) - 120 // 2 min atrás
    const msg: OfferMsg = {
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      ts: oldTs * 1000,
      sdp: 'old',
    }
    const ct = encryptDM(JSON.stringify(msg), bob.pk, alice.sk)
    const ev = finalizeEvent(
      {
        kind: 1059,
        tags: [['p', bob.pk]],
        content: ct,
        created_at: oldTs,
      },
      alice.sk,
    )
    relay.deliver(ev)
    await flush()

    expect(received).toHaveLength(0)
  })

  it('dedup por event.id — mesmo evento entregue 2× = handler chamado 1×', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    const msg: OfferMsg = {
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      ts: Date.now(),
      sdp: 'dup',
    }
    const ct = encryptDM(JSON.stringify(msg), bob.pk, alice.sk)
    const ev = finalizeEvent(
      {
        kind: 1059,
        tags: [['p', bob.pk]],
        content: ct,
        created_at: Math.floor(Date.now() / 1000),
      },
      alice.sk,
    )
    relay.deliver(ev)
    relay.deliver(ev) // duplicado
    await flush()

    expect(received).toHaveLength(1)
  })

  it('rate limit per-sender: 11 msgs em <60s → 10 dispatch, 11ª drop', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    for (let i = 0; i < 11; i++) {
      const msg: OfferMsg = {
        type: 'offer',
        from: alice.pk,
        to: bob.pk,
        ts: Date.now(),
        sdp: `n${i}`,
      }
      const ct = encryptDM(JSON.stringify(msg), bob.pk, alice.sk)
      const ev = finalizeEvent(
        {
          kind: 1059,
          tags: [['p', bob.pk]],
          content: ct,
          // varia created_at em ms-level pra evitar dedup colidir por id;
          // criamos 11 eventos distintos.
          created_at: Math.floor(Date.now() / 1000),
        },
        alice.sk,
      )
      // garantir id distinto: tweak content já gera id diferente (sdp varia)
      relay.deliver(ev)
    }
    await flush()

    expect(received).toHaveLength(10)
  })
})

describe('nostrSignalingChannel — send semantics', () => {
  const channels: Array<ReturnType<typeof nostrSignalingChannel>> = []

  afterEach(() => {
    while (channels.length) channels.pop()?.close()
  })

  it("send drop silencioso em type='bye' e type='hello'", async () => {
    const alice = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)

    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    channels.push(chA)

    await chA.send({ type: 'bye', from: alice.pk, ts: Date.now() })
    await chA.send({
      type: 'hello',
      from: alice.pk,
      ts: Date.now(),
      drift: { capabilities: ['datachannel-v1'] },
    })

    expect(tA.publish).not.toHaveBeenCalled()
    expect(tA.published).toHaveLength(0)
  })

  it('send sanitiza msg.from se diferente do myNpub', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)
    const tB = fakeTransport(relay)

    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })
    channels.push(chA, chB)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    // Caller passa from errado (ex: bug em camada acima).
    await chA.send({
      type: 'offer',
      from: 'wrong_npub_value',
      to: bob.pk,
      ts: Date.now(),
      sdp: 's',
    })
    await flush()

    expect(received).toHaveLength(1)
    // Channel sobrescreveu com myNpub real → anti-spoof passou na ponta B.
    expect(received[0].from).toBe(alice.pk)
  })

  it('send após close é no-op', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)

    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })

    chA.close()
    await chA.send({
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      ts: Date.now(),
      sdp: 's',
    })

    expect(tA.publish).not.toHaveBeenCalled()
  })
})

describe('nostrSignalingChannel — lifecycle', () => {
  it('close() chama unsub do transport.subscribe e limpa handlers', async () => {
    const alice = pair()
    const bob = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)
    const tB = fakeTransport(relay)

    const chB = nostrSignalingChannel({
      myNpub: bob.pk,
      myNsecBytes: bob.sk,
      transport: tB,
      signEvent: makeSigner(bob.sk),
    })

    expect(tB.subs).toHaveLength(1)
    expect(tB.subs[0].active).toBe(true)

    const received: SignalingMessage[] = []
    chB.onMessage((m) => received.push(m))

    chB.close()
    expect(tB.subs[0].active).toBe(false)

    // Após close: novos eventos entregues pelo relay são ignorados —
    // sub.active=false bloqueia no fakeRelay; canal interno tb tem
    // closed=true como defesa em profundidade.
    const chA = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    await chA.send({
      type: 'offer',
      from: alice.pk,
      to: bob.pk,
      ts: Date.now(),
      sdp: 'late',
    })
    await flush()

    expect(received).toHaveLength(0)
    chA.close()
  })

  it('close() é idempotente', () => {
    const alice = pair()
    const relay = fakeRelay()
    const tA = fakeTransport(relay)
    const ch = nostrSignalingChannel({
      myNpub: alice.pk,
      myNsecBytes: alice.sk,
      transport: tA,
      signEvent: makeSigner(alice.sk),
    })
    ch.close()
    expect(() => ch.close()).not.toThrow()
  })
})
