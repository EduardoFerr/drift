/**
 * webrtcTransport — transporte P2P direto entre clientes Drift via
 * RTCDataChannel. Fase 6.1a (MVP, mock signaling).
 *
 * Arquitetura:
 *   - Signaling abstrato (`SignalingChannel`) — em 6.1a usa
 *     `webrtc-signaling-mock` (BroadcastChannel same-origin); em 6.1b
 *     plugaremos `webrtc-signaling-nostr` (NIP-44 DM).
 *   - Cada par (this, otherPeer) negocia uma RTCPeerConnection com 1
 *     RTCDataChannel ordered+reliable. Eventos Nostr trafegam como
 *     JSON.stringify(SignedEvent).
 *   - Pipeline de recepção respeita invariante #5 do CLAUDE.md:
 *     parse → shape → KIND CHECK → verify Schnorr → matchFilter →
 *     entrega aos subscribers locais. NÃO chama `onNostrEvent` aqui —
 *     isso é orquestração da camada acima (sync.ts em 6.2).
 *   - Glare prevention via `shouldInitiateOffer` (tie-break lex).
 *
 * Estado é module-scoped (singleton). DEV expõe `window.driftWebRTC`
 * via `main.tsx`. Cleanup robusto via `pagehide` (não `beforeunload` —
 * não é confiável em TWA/Tauri; ver Barney peer review #10).
 *
 * NÃO IMPLEMENTADO em 6.1a (intencional):
 *   - Persistência peer registry (Fase 6.2)
 *   - Health ping/pong real (placeholder retorna lastPingMs do PeerState)
 *   - ICE batching
 *   - Reconnect automático (camada acima resolve, ex.: novo `hello`)
 *
 * Manifesto §12 (multi-transport), §15 (anti-censura), §16
 * (disponibilidade distribuída via WebRTC seed).
 */

import { DRIFT_KIND_SET } from '../../config/constants'
import { verifyDriftEvent } from '../nostr'
import type { SignedEvent } from '../../types/nostr'
import { matchFilter } from './matchFilter'
import { shouldInitiateOffer } from './signaling'
import type {
  SignalingChannel,
  SignalingMessage,
  SignalingUnsubscribe,
} from './signaling'
import { createMockSignalingChannel } from './webrtc-signaling-mock'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from './index'

// ─── Tipos internos ──────────────────────────────────────────────────

export type PeerStatus =
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'failed'

interface PeerState {
  id: string
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  status: PeerStatus
  createdAt: number
  lastPingMs: number | null
  /** Buffer pra publishes antes de dc.readyState === 'open'.
   *  Em transição → failed/closed, RESETAR pra evitar leak (Barney #4). */
  outboundQueue: string[]
}

interface SubscriptionRecord {
  id: string
  filter: Filter
  handlers: SubscribeHandlers
  /** Dedup local FIFO capped a 1000. */
  seenIds: Set<string>
}

// ─── State module-scoped ─────────────────────────────────────────────

const peers = new Map<string, PeerState>()
const subscriptions = new Map<string, SubscriptionRecord>()

let signalingChannel: SignalingChannel | null = null
let signalingUnsub: SignalingUnsubscribe | null = null
let _myPeerId: string | null = null
let pagehideRegistered = false

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]
const SEEN_IDS_CAP = 1000

function myPeerId(): string {
  if (_myPeerId) return _myPeerId
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    _myPeerId = crypto.randomUUID()
  } else {
    _myPeerId = 'webrtc-' + Math.random().toString(36).slice(2, 11)
  }
  return _myPeerId
}

// ─── Lazy boot do signaling ──────────────────────────────────────────

function ensureSignaling(): SignalingChannel {
  if (signalingChannel) return signalingChannel
  const ch = createMockSignalingChannel(myPeerId())
  signalingChannel = ch
  signalingUnsub = ch.onMessage(handleSignalingMessage)
  registerPagehideOnce()
  // Anuncia presença ao boot.
  void ch.send({
    type: 'hello',
    from: ch.peerId,
    ts: Date.now(),
    drift: { capabilities: ['datachannel-v1'] },
  })
  return ch
}

function registerPagehideOnce(): void {
  if (pagehideRegistered) return
  if (typeof window === 'undefined') return
  pagehideRegistered = true
  window.addEventListener('pagehide', () => {
    try {
      signalingChannel?.send({
        type: 'bye',
        from: myPeerId(),
        ts: Date.now(),
      })
    } catch {
      /* noop */
    }
    void closeAll()
  })
}

// ─── Peer lifecycle ──────────────────────────────────────────────────

function getOrCreatePeer(remoteId: string): PeerState {
  const existing = peers.get(remoteId)
  if (existing) return existing

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const peer: PeerState = {
    id: remoteId,
    pc,
    dc: null,
    status: 'connecting',
    createdAt: Date.now(),
    lastPingMs: null,
    outboundQueue: [],
  }
  peers.set(remoteId, peer)

  pc.onicecandidate = (ev) => {
    if (!signalingChannel) return
    void signalingChannel.send({
      type: 'ice',
      from: myPeerId(),
      to: remoteId,
      ts: Date.now(),
      candidate: ev.candidate ? ev.candidate.toJSON() : null,
    })
  }

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState
    if (s === 'connected') {
      // status='open' depende de dc.onopen — não setar aqui.
    } else if (s === 'failed') {
      peer.status = 'failed'
      peer.outboundQueue.length = 0 // Barney #4 — sem leak.
    } else if (s === 'closed' || s === 'disconnected') {
      if (peer.status !== 'failed') peer.status = 'closed'
      peer.outboundQueue.length = 0
    }
  }

  // Side B: receberá o data channel via ondatachannel.
  pc.ondatachannel = (ev) => attachDataChannel(peer, ev.channel)

  return peer
}

function attachDataChannel(peer: PeerState, dc: RTCDataChannel): void {
  peer.dc = dc
  dc.onopen = () => {
    peer.status = 'open'
    // Drain do outbound queue.
    if (peer.outboundQueue.length > 0) {
      const queued = peer.outboundQueue.splice(0, peer.outboundQueue.length)
      for (const raw of queued) {
        try {
          dc.send(raw)
        } catch (err) {
          console.warn('[webrtc] drain send falhou:', err)
        }
      }
    }
  }
  dc.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    handleDataChannelMessage(peer, ev.data)
  }
  dc.onclose = () => {
    if (peer.status !== 'failed') peer.status = 'closed'
    peer.outboundQueue.length = 0
  }
  dc.onerror = () => {
    peer.status = 'failed'
    peer.outboundQueue.length = 0
  }
}

async function initiateOffer(peer: PeerState): Promise<void> {
  // Side A cria o data channel; Side B recebe via ondatachannel.
  const dc = peer.pc.createDataChannel('drift', { ordered: true })
  attachDataChannel(peer, dc)
  const offer = await peer.pc.createOffer()
  await peer.pc.setLocalDescription(offer)
  if (!signalingChannel || !offer.sdp) return
  await signalingChannel.send({
    type: 'offer',
    from: myPeerId(),
    to: peer.id,
    ts: Date.now(),
    sdp: offer.sdp,
  })
}

async function handleRemoteOffer(remoteId: string, sdp: string): Promise<void> {
  const peer = getOrCreatePeer(remoteId)
  await peer.pc.setRemoteDescription({ type: 'offer', sdp })
  const answer = await peer.pc.createAnswer()
  await peer.pc.setLocalDescription(answer)
  if (!signalingChannel || !answer.sdp) return
  await signalingChannel.send({
    type: 'answer',
    from: myPeerId(),
    to: remoteId,
    ts: Date.now(),
    sdp: answer.sdp,
  })
}

async function handleRemoteAnswer(remoteId: string, sdp: string): Promise<void> {
  const peer = peers.get(remoteId)
  if (!peer) return
  await peer.pc.setRemoteDescription({ type: 'answer', sdp })
}

async function handleRemoteIce(
  remoteId: string,
  candidate: RTCIceCandidateInit | null,
): Promise<void> {
  const peer = peers.get(remoteId)
  if (!peer) return
  try {
    if (candidate) {
      await peer.pc.addIceCandidate(candidate)
    } else {
      // null = end-of-candidates. addIceCandidate(null) is valid signal.
      await peer.pc.addIceCandidate()
    }
  } catch (err) {
    console.warn('[webrtc] addIceCandidate falhou:', err)
  }
}

function cleanupPeer(remoteId: string): void {
  const peer = peers.get(remoteId)
  if (!peer) return
  peer.status = 'closing'
  try {
    peer.dc?.close()
  } catch {
    /* noop */
  }
  try {
    peer.pc.close()
  } catch {
    /* noop */
  }
  peer.outboundQueue.length = 0
  peer.status = 'closed'
  peers.delete(remoteId)
}

// ─── Signaling dispatcher ────────────────────────────────────────────

function handleSignalingMessage(msg: SignalingMessage): void {
  const me = myPeerId()
  switch (msg.type) {
    case 'hello': {
      // Cria peer entry preventivamente (mesmo se a gente não inicia).
      getOrCreatePeer(msg.from)
      if (shouldInitiateOffer(me, msg.from)) {
        void initiateOffer(peers.get(msg.from)!)
      }
      return
    }
    case 'offer': {
      if (msg.to !== me) return
      void handleRemoteOffer(msg.from, msg.sdp)
      return
    }
    case 'answer': {
      if (msg.to !== me) return
      void handleRemoteAnswer(msg.from, msg.sdp)
      return
    }
    case 'ice': {
      if (msg.to !== me) return
      void handleRemoteIce(msg.from, msg.candidate)
      return
    }
    case 'bye': {
      cleanupPeer(msg.from)
      return
    }
  }
}

// ─── DataChannel pipeline (invariante #5) ────────────────────────────

function handleDataChannelMessage(peer: PeerState, raw: string): void {
  // 1. Parse defensivo
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[webrtc] malformed JSON from', peer.id)
    return
  }

  // 2. Shape mínimo (guard barato)
  if (!isPlausibleSignedEvent(parsed)) return
  const event = parsed as SignedEvent

  // 2.5. KIND CHECK pré-verify (Barney peer review #1, invariantes #5/#14)
  if (!DRIFT_KIND_SET.has(event.kind)) return

  // 3. Schnorr verify
  if (!verifyDriftEvent(event)) {
    console.warn('[webrtc] sig invalid from', peer.id, event.id?.slice(0, 8))
    return
  }

  // 4. Match + dedup + delivery
  for (const sub of subscriptions.values()) {
    if (sub.seenIds.has(event.id)) continue
    if (!matchFilter(event, sub.filter)) continue
    sub.seenIds.add(event.id)
    if (sub.seenIds.size > SEEN_IDS_CAP) {
      const first = sub.seenIds.values().next().value
      if (first !== undefined) sub.seenIds.delete(first)
    }
    Promise.resolve(sub.handlers.onevent(event)).catch((err) =>
      console.error('[webrtc] onevent handler failed:', err),
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

// ─── Transport API ───────────────────────────────────────────────────

async function publish(event: SignedEvent): Promise<PublishResult> {
  ensureSignaling()
  const raw = JSON.stringify(event)
  const perRelay: PublishResult['perRelay'] = []
  let ok = 0
  let failed = 0

  for (const peer of peers.values()) {
    const url = peer.id // semântica: url = peerId
    if (peer.status === 'failed' || peer.status === 'closed') {
      failed++
      perRelay.push({ url, ok: false, error: `peer ${peer.status}` })
      continue
    }
    if (peer.dc && peer.dc.readyState === 'open') {
      try {
        peer.dc.send(raw)
        ok++
        perRelay.push({ url, ok: true })
      } catch (err) {
        failed++
        perRelay.push({ url, ok: false, error: String(err) })
      }
    } else {
      // Buffer pra drain quando dc abrir.
      peer.outboundQueue.push(raw)
      ok++
      perRelay.push({ url, ok: true, error: 'queued' })
    }
  }
  return { ok, failed, perRelay }
}

function subscribe(filter: Filter, handlers: SubscribeHandlers): Unsubscribe {
  ensureSignaling()
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'sub-' + Math.random().toString(36).slice(2, 11)
  const record: SubscriptionRecord = {
    id,
    filter,
    handlers,
    seenIds: new Set<string>(),
  }
  subscriptions.set(id, record)
  if (subscriptions.size > 50) {
    console.warn(
      '[webrtc] subscriptions.size > 50 — possível leak (Unsubscribe não chamado?)',
    )
  }
  // Sem oneose síncrono: WebRTC não tem "histórico" — peers só repassam
  // tempo real. Chamamos oneose assim mesmo no próximo tick pra sinalizar
  // "fim do flush inicial" (não há histórico aqui).
  if (handlers.oneose) {
    queueMicrotask(() => handlers.oneose?.())
  }
  return () => {
    subscriptions.delete(id)
  }
}

async function health(_timeoutMs?: number): Promise<TransportHealth[]> {
  // Placeholder pra 6.1a — ping/pong real fica em 6.2.
  const out: TransportHealth[] = []
  for (const peer of peers.values()) {
    out.push({
      url: peer.id,
      ok: peer.status === 'open',
      latencyMs: peer.lastPingMs,
    })
  }
  return out
}

export const webrtcTransport: Transport = {
  kind: 'webrtc',
  publish,
  subscribe,
  health,
}

// ─── DEV / teardown helpers ──────────────────────────────────────────

/** Snapshot readonly dos peers — DEV only. */
export function getPeers(): ReadonlyArray<{
  id: string
  status: PeerStatus
  latencyMs: number | null
}> {
  const out: { id: string; status: PeerStatus; latencyMs: number | null }[] = []
  for (const p of peers.values()) {
    out.push({ id: p.id, status: p.status, latencyMs: p.lastPingMs })
  }
  return out
}

/** Cleanup completo — fecha todos os peers, desliga signaling, limpa subs. */
export async function closeAll(): Promise<void> {
  for (const peerId of Array.from(peers.keys())) {
    cleanupPeer(peerId)
  }
  subscriptions.clear()
  if (signalingUnsub) {
    try {
      signalingUnsub()
    } catch {
      /* noop */
    }
    signalingUnsub = null
  }
  if (signalingChannel) {
    try {
      signalingChannel.close()
    } catch {
      /* noop */
    }
    signalingChannel = null
  }
}

/**
 * Conecta proativamente a um peer conhecido (DEV). Em produção, peers
 * se descobrem via `hello` broadcast (mock) ou via Proof of Interest +
 * NIP-44 DM (Fase 6.1b).
 */
export async function connectTo(remotePeerId: string): Promise<void> {
  ensureSignaling()
  if (remotePeerId === myPeerId()) return
  const peer = getOrCreatePeer(remotePeerId)
  if (shouldInitiateOffer(myPeerId(), remotePeerId)) {
    await initiateOffer(peer)
  } else {
    // Fora do tie-break: re-anunciar hello pra forçar o outro a iniciar.
    await signalingChannel?.send({
      type: 'hello',
      from: myPeerId(),
      ts: Date.now(),
      drift: { capabilities: ['datachannel-v1'] },
    })
  }
}

/** Acesso DEV ao peerId local — útil pra debug em 2 abas. */
export function getMyPeerId(): string {
  return myPeerId()
}
