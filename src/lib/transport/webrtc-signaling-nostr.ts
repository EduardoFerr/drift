/**
 * webrtc-signaling-nostr — SignalingChannel implementação via Nostr DM
 * cifrado (NIP-44 v2 + kind 1059 wrap minimal).
 *
 * Substitui o BroadcastChannel mock de 6.1a — peers em redes diferentes
 * se descobrem usando relays Nostr existentes como rendezvous, sem
 * inventar diretório paralelo (manifesto §14, invariante #14 do CLAUDE.md).
 *
 * **Discovery (PoI-only)**: caller chama `transport.connectTo(peerNpub)`
 * sabendo o npub do alvo via SQLite local (ex: `spreader_pub` de spreads
 * conhecidos). Sem hello broadcast — quem inicia já conhece o alvo
 * (manifesto §16). `hello` e `bye` são silenciosamente droppados em
 * `send` — Nostr não tem broadcast e bye é detectado via `dc.onclose`.
 *
 * Defesas (manifesto §15, threats em Docs/webrtc-threats.md):
 *  - Anti-spoof: `msg.from` (interno cifrado) deve === `event.pubkey`
 *    (público assinado). Mismatch = drop. Cobre T-005 (impersonation).
 *  - Replay window 60s + LRU dedup por event.id (TTL 5min) — cobre T-012.
 *  - Rate limit per-sender (token bucket 10 msgs/60s) — cobre T-006.
 *  - Drop silencioso em decrypt fail / JSON malformado / shape inválido —
 *    manifesto §11 (eventos inválidos são ruído, não exceção).
 */

import { encryptDM, decryptDM, signDriftEvent } from '../nostr'
import type {
  SignalingChannel,
  SignalingHandler,
  SignalingMessage,
  SignalingUnsubscribe,
} from './signaling'
import type { Filter, Transport } from './index'
import type { SignedEvent } from '../../types/nostr'

const SIGNALING_KIND = 1059
const REPLAY_WINDOW_MS = 60_000
const DEDUP_TTL_MS = 5 * 60_000
const RATE_LIMIT_PER_SENDER = 10
const RATE_WINDOW_MS = 60_000
/** Limite máximo da LRU de event.id pra evitar growth ilimitado. */
const DEDUP_MAX_ENTRIES = 5_000

export interface NostrSignalingOpts {
  /** npub hex (64 chars) deste peer — usado em filtro `#p` e como `from`. */
  myNpub: string
  /** nsec bytes (32) — pra cifrar/decifrar e assinar. NUNCA logar. */
  myNsecBytes: Uint8Array
  /** Transport que vai publicar/subscrever os eventos kind 1059. */
  transport: Transport
  /** Override `signDriftEvent` pra testes; produção usa default. */
  signEvent?: (input: {
    kind: number
    tags: string[][]
    content: string
  }) => Promise<SignedEvent>
  /** Override `Date.now` pra testes determinísticos. */
  now?: () => number
}

/**
 * Cria um SignalingChannel que tunela mensagens via Nostr DM kind 1059
 * cifrado NIP-44.
 */
export function nostrSignalingChannel(opts: NostrSignalingOpts): SignalingChannel {
  const myNpub = opts.myNpub
  const sign = opts.signEvent ?? signDriftEvent
  const now = opts.now ?? Date.now

  const handlers = new Set<SignalingHandler>()
  // LRU dedup: event.id → timestamp ms de inserção (pra prune via TTL).
  const seenEventIds = new Map<string, number>()
  // Rate limit per-sender: pubkey → array de timestamps ms (janela 60s).
  const rateBuckets = new Map<string, number[]>()
  let closed = false

  const filter: Filter = {
    kinds: [SIGNALING_KIND],
    '#p': [myNpub],
    since: Math.floor(now() / 1000) - Math.floor(REPLAY_WINDOW_MS / 1000),
  }

  const unsub = opts.transport.subscribe(filter, {
    onevent: (event: SignedEvent) => {
      if (closed) return
      handleEvent(event)
    },
    oneose: () => {
      /* noop — não temos boot semantics aqui */
    },
  })

  function handleEvent(event: SignedEvent): void {
    const tNow = now()

    // 1. Replay window — eventos muito antigos OU futuros são suspeitos.
    const eventTsMs = event.created_at * 1000
    if (Math.abs(tNow - eventTsMs) > REPLAY_WINDOW_MS) return

    // 2. Dedup por event.id (LRU + TTL).
    pruneDedup(tNow)
    if (seenEventIds.has(event.id)) return
    seenEventIds.set(event.id, tNow)
    // Cap de segurança caso TTL não tenha podado o suficiente.
    if (seenEventIds.size > DEDUP_MAX_ENTRIES) {
      const firstKey = seenEventIds.keys().next().value
      if (firstKey !== undefined) seenEventIds.delete(firstKey)
    }

    // 3. Rate limit per-sender pubkey.
    if (!checkRateLimit(event.pubkey, tNow)) return

    // 4. Decrypt — fail = drop silencioso.
    let plaintext: string
    try {
      plaintext = decryptDM(event.content, event.pubkey, opts.myNsecBytes)
    } catch {
      return
    }

    // 5. Parse JSON.
    let parsed: unknown
    try {
      parsed = JSON.parse(plaintext)
    } catch {
      return
    }

    // 6. Validate shape.
    if (!isValidSignalingMessage(parsed)) return
    const msg = parsed

    // 7. Anti-spoof: `from` interno deve casar com `pubkey` do evento.
    if (msg.from !== event.pubkey) return

    // 8. Dispatch.
    for (const h of handlers) {
      try {
        h(msg)
      } catch (err) {
        console.error('[nostr-signaling] handler threw:', err)
      }
    }
  }

  function pruneDedup(tNow: number): void {
    // Remove entries fora do TTL. Map mantém ordem de inserção, então
    // entries mais antigas vêm primeiro — break cedo quando achar viva.
    for (const [id, ts] of seenEventIds) {
      if (tNow - ts > DEDUP_TTL_MS) {
        seenEventIds.delete(id)
      } else {
        break
      }
    }
  }

  function checkRateLimit(pubkey: string, tNow: number): boolean {
    const bucket = rateBuckets.get(pubkey) ?? []
    // Prune timestamps fora da janela.
    const fresh = bucket.filter((ts) => tNow - ts < RATE_WINDOW_MS)
    if (fresh.length >= RATE_LIMIT_PER_SENDER) {
      // Persiste bucket pruned mesmo bloqueando — economiza re-prune
      // na próxima call.
      rateBuckets.set(pubkey, fresh)
      return false
    }
    fresh.push(tNow)
    rateBuckets.set(pubkey, fresh)
    return true
  }

  return {
    peerId: myNpub,

    async send(msg: SignalingMessage): Promise<void> {
      if (closed) return

      // Nostr não tem broadcast — `hello` não existe (PoI-only) e `bye`
      // é detectado via dc.onclose. Drop silencioso pra ambos.
      if (msg.type === 'hello' || msg.type === 'bye') return

      // Sanity: from deve ser nosso npub (não confiar no caller).
      if (msg.from !== myNpub) {
        msg = { ...msg, from: myNpub }
      }

      // offer/answer/ice exigem `to`.
      const to = msg.to
      if (typeof to !== 'string' || to.length === 0) return

      let ciphertext: string
      try {
        ciphertext = encryptDM(JSON.stringify(msg), to, opts.myNsecBytes)
      } catch (err) {
        console.error('[nostr-signaling] encrypt failed:', err)
        return
      }

      const event = await sign({
        kind: SIGNALING_KIND,
        tags: [['p', to]],
        content: ciphertext,
      })

      try {
        await opts.transport.publish(event)
      } catch (err) {
        console.error('[nostr-signaling] publish failed:', err)
      }
    },

    onMessage(handler: SignalingHandler): SignalingUnsubscribe {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },

    close(): void {
      if (closed) return
      closed = true
      handlers.clear()
      seenEventIds.clear()
      rateBuckets.clear()
      try {
        unsub()
      } catch {
        /* noop — transport pode já estar fechado */
      }
    },
  }
}

/**
 * Valida shape mínimo de SignalingMessage. Mesmas regras do mock —
 * defesa em profundidade contra payloads malformados após decrypt.
 */
function isValidSignalingMessage(x: unknown): x is SignalingMessage {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  if (typeof m.from !== 'string' || m.from.length === 0) return false
  if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return false
  if (typeof m.type !== 'string') return false
  switch (m.type) {
    case 'hello':
      return (
        typeof m.drift === 'object' &&
        m.drift !== null &&
        Array.isArray((m.drift as { capabilities?: unknown }).capabilities)
      )
    case 'offer':
    case 'answer':
      return typeof m.to === 'string' && typeof m.sdp === 'string'
    case 'ice':
      return (
        typeof m.to === 'string' &&
        (m.candidate === null || typeof m.candidate === 'object')
      )
    case 'bye':
      return true
    default:
      return false
  }
}
