/**
 * mock-webrtc — substituto E2E do transporte WebRTC P2P
 * (`src/lib/transport/webrtc/`).
 *
 * Sprint N+5 Batch B1 (Ted). O transporte real abre RTCPeerConnection
 * com negociação SDP + ICE/STUN. Headless, entre Playwright
 * BrowserContexts, isso é frágil (sem STUN, candidates host-only,
 * negociação não-determinística). Este mock BYPASSA RTCPeerConnection
 * inteiro: peers "se conectam" trocando hello via BroadcastChannel e
 * eventos Nostr trafegam direto pelo canal — sem SDP, sem ICE, sem
 * DataChannel real.
 *
 * **Conforma `Transport`** (mesma interface que `webrtcTransport`):
 * `publish` broadcasta o evento assinado pra malha; cada peer recebe e
 * roda o MESMO pipeline cheap→caro do real (`pipeline.ts`): kind check
 * (DRIFT_KIND_SET) → verify Schnorr → matchFilter → dedup → entrega aos
 * subs. Invariante #5 (ordem do pipeline) e #14 (só kinds Drift)
 * preservadas — o mock troca só o MEIO de transporte, não a validação.
 *
 * **Signaling via BroadcastChannel** (mesma família do
 * `webrtc-signaling-mock.ts` real): peers anunciam `hello` ao bootar e
 * `bye` ao fechar; `getPeers()` reflete quem está vivo na malha.
 * `connectTo()` é no-op resolvido (no mock, todos os peers same-origin
 * já estão "conectados" via canal — não há handshake par-a-par).
 *
 * **Por que não reusar `webrtc-signaling-mock` + peer.ts real:** o
 * gargalo headless é o RTCPeerConnection/DataChannel, não o signaling.
 * Reusar o signaling mas manter as RTCPeerConnection reais reintroduz a
 * fragilidade ICE. Substituímos a camada inteira de transporte de
 * eventos por broadcast direto — determinístico, sem timers de
 * reconnect/health.
 *
 * Valida o cenário do plano: Dave (P2P-only) publica → Erin recebe sem
 * relay WSS. Manifesto §15 (anti-censura via P2P) + §16.
 */

import { DRIFT_KIND_SET } from '../../config/constants'
import type { SignedEvent } from '../../types/nostr'
import { verifyEventAsync } from '../verify'
import { matchFilter } from '../transport/matchFilter'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from '../transport'

// ─── Identidade do peer local ────────────────────────────────────────

let myId: string | null = null

function ensureMyId(): string {
  if (myId) return myId
  myId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'mock-peer-' + Math.random().toString(36).slice(2, 11)
  return myId
}

// ─── Subscriptions locais ────────────────────────────────────────────

interface SubRecord {
  id: string
  filter: Filter
  handlers: SubscribeHandlers
  seenIds: Set<string>
}

const subscriptions = new Map<string, SubRecord>()
const SEEN_IDS_CAP = 5000

// ─── Peers vivos na malha ────────────────────────────────────────────

/** peerId → último `hello`/`heartbeat` (epoch ms). */
const knownPeers = new Map<string, number>()

// ─── Canal cross-context ─────────────────────────────────────────────

const CHANNEL_NAME = 'drift-mock-webrtc'

type MeshMessage =
  | { type: 'hello'; from: string }
  | { type: 'bye'; from: string }
  | { type: 'event'; from: string; event: SignedEvent }

let channel: BroadcastChannel | null = null

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as MeshMessage
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'hello': {
        if (msg.from === ensureMyId()) return
        knownPeers.set(msg.from, Date.now())
        // Responde com nosso próprio hello pra que o recém-chegado nos
        // veja (BroadcastChannel não ecoa pro emissor).
        channel?.postMessage({ type: 'hello', from: ensureMyId() } satisfies MeshMessage)
        return
      }
      case 'bye': {
        knownPeers.delete(msg.from)
        return
      }
      case 'event': {
        if (msg.from === ensureMyId()) return
        void deliverInbound(msg.event)
        return
      }
    }
  }
  return channel
}

/**
 * Pipeline inbound — espelha `webrtc/pipeline.ts` cheap→caro.
 * Invariante #5: kind check (cheap) ANTES de verify Schnorr (caro);
 * #14: só kinds Drift atravessam.
 */
async function deliverInbound(event: SignedEvent): Promise<void> {
  // Shape mínimo (cheap guard).
  if (!isPlausibleSignedEvent(event)) return
  // Kind check pré-verify (cheap).
  if (!DRIFT_KIND_SET.has(event.kind)) return
  // Schnorr verify (caro) — só agora.
  if (!(await verifyEventAsync(event))) return
  // Match + dedup + delivery.
  for (const sub of subscriptions.values()) {
    if (sub.seenIds.has(event.id)) continue
    if (!matchFilter(event, sub.filter)) continue
    sub.seenIds.add(event.id)
    if (sub.seenIds.size > SEEN_IDS_CAP) {
      const first = sub.seenIds.values().next().value
      if (first !== undefined) sub.seenIds.delete(first)
    }
    Promise.resolve(sub.handlers.onevent(event)).catch((err) =>
      console.error('[mock-webrtc] onevent handler failed:', err),
    )
  }
}

function isPlausibleSignedEvent(x: unknown): x is SignedEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    e.id.length === 64 &&
    typeof e.sig === 'string' &&
    e.sig.length === 128 &&
    typeof e.pubkey === 'string' &&
    e.pubkey.length === 64 &&
    typeof e.kind === 'number' &&
    typeof e.created_at === 'number' &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags)
  )
}

// ─── Boot lazy do signaling (anuncia presença) ───────────────────────

let booted = false

function ensureBooted(): void {
  if (booted) return
  const ch = ensureChannel()
  if (!ch) return
  booted = true
  ch.postMessage({ type: 'hello', from: ensureMyId() } satisfies MeshMessage)
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      try {
        ch.postMessage({ type: 'bye', from: ensureMyId() } satisfies MeshMessage)
      } catch {
        /* noop */
      }
    })
  }
}

// ─── Transport API ───────────────────────────────────────────────────

async function publish(event: SignedEvent): Promise<PublishResult> {
  ensureBooted()
  const ch = ensureChannel()
  if (!ch) {
    return { ok: 0, failed: 1, perRelay: [{ url: 'mock-mesh', ok: false, error: 'sem canal' }] }
  }
  ch.postMessage({ type: 'event', from: ensureMyId(), event } satisfies MeshMessage)
  const peers = knownPeers.size
  // perRelay reporta um "endpoint" por peer conhecido (semântica url=peerId
  // do transporte real). Sem peers ainda contamos ok:1 (mesh aceitou).
  const perRelay: PublishResult['perRelay'] =
    peers > 0
      ? Array.from(knownPeers.keys()).map((id) => ({ url: id, ok: true }))
      : [{ url: 'mock-mesh', ok: true }]
  return { ok: Math.max(peers, 1), failed: 0, perRelay }
}

function subscribe(filter: Filter, handlers: SubscribeHandlers): Unsubscribe {
  ensureBooted()
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'sub-' + Math.random().toString(36).slice(2, 11)
  subscriptions.set(id, { id, filter, handlers, seenIds: new Set<string>() })
  // WebRTC não tem histórico — sinaliza fim do flush inicial no próximo tick.
  if (handlers.oneose) queueMicrotask(() => handlers.oneose?.())
  return () => {
    subscriptions.delete(id)
  }
}

async function health(): Promise<TransportHealth[]> {
  ensureBooted()
  const now = Date.now()
  void now
  return Array.from(knownPeers.keys()).map((peerId) => ({
    url: peerId,
    ok: true,
    latencyMs: 1,
  }))
}

export const mockWebrtcTransport: Transport = {
  kind: 'webrtc',
  publish,
  subscribe,
  health,
}

// ─── DEV hooks (espelham webrtc/index.ts) ────────────────────────────

/** Peers vivos na malha — espelha `getPeers()` do real. */
export function getPeers(): { id: string; status: string }[] {
  return Array.from(knownPeers.keys()).map((id) => ({ id, status: 'open' }))
}

/** No mock todos os peers same-origin já estão na malha — no-op. */
export async function connectTo(peerId: string): Promise<void> {
  ensureBooted()
  // Determinístico: marca o alvo como conhecido (caso ainda não tenha
  // mandado hello) e devolve. Sem handshake par-a-par no mock.
  if (peerId && peerId !== ensureMyId()) knownPeers.set(peerId, Date.now())
}

export function closeAll(): void {
  for (const sub of subscriptions.keys()) subscriptions.delete(sub)
  knownPeers.clear()
  const ch = channel
  if (ch) {
    try {
      ch.postMessage({ type: 'bye', from: ensureMyId() } satisfies MeshMessage)
      ch.close()
    } catch {
      /* noop */
    }
    channel = null
  }
  booted = false
}

export function getMyPeerId(): string {
  return ensureMyId()
}

/** Reset total — pra isolamento entre specs E2E. */
export function _resetMockWebrtc(): void {
  closeAll()
  myId = null
}
