/**
 * webrtc/peer — RTCPeerConnection lifecycle, glare/rollback, cleanup.
 *
 * Núcleo do transport: `getOrCreatePeer`, `attachDataChannel`,
 * `initiateOffer`, `handleRemote{Offer,Answer,Ice}`, `cleanupPeer`.
 * Cada função respeita invariantes de:
 *  - Cap absoluto `MAX_PEERS` (manifesto §15 anti-DoS)
 *  - Glare collision (Barney audit #2): perfect-negotiation com tie-break lex
 *  - ICE timeout (Barney audit #1): zombie peer não vaza RAM
 *  - Outbound queue reset em failed/closed (Barney audit #4): sem leak
 *
 * Test-only helpers (`_createPeerStateForTest`, `_injectPeerForTest`,
 * `_getOrCreatePeerForTest`, `_simulateCrossProtoForTest`) são
 * re-exportados em `webrtc/index.ts`. `_resetPeersForTest` mora em
 * `state.ts` (mais próximo do Map).
 */

import { shouldInitiateOffer } from '../signaling'
import {
  blacklist as registryBlacklist,
  recordFailure as registryFailure,
  recordHandshake as registryHandshake,
} from '../../peerRegistry'
import {
  ICE_CONNECT_TIMEOUT_MS,
  RATE_BURST,
  WEBRTC_LIMITS,
} from './config'
import { getICEServers } from './ice'
import {
  deletePeer,
  getPeer,
  getSignalingChannel,
  hasPeer,
  peerCount,
  setPeer,
} from './state'
import type { PeerState } from './types'
import { _resetReconnectCounter, _scheduleReconnect } from './reconnect'
import { useNostrSignaling, myPeerId } from './boot'

// ─── Lifecycle ───────────────────────────────────────────────────────

export function getOrCreatePeer(remoteId: string): PeerState | null {
  const existing = getPeer(remoteId)
  if (existing) return existing

  // Hard cap MAX_PEERS — Fase 6.2-C (manifesto §15 DoS, §20 anti-eclipse).
  // Em modo Nostr, remoteId === npub, então `peers.has(npub)` (acima) já
  // garante MAX_PEERS_PER_PUBKEY=1. Em modo mock, remoteId é UUID aleatório
  // por aba — sem proteção por pubkey, mas o cap absoluto continua valendo.
  // TODO 6.2-F: ejection inteligente (eject pior peer se candidate score > P50).
  if (peerCount() >= WEBRTC_LIMITS.MAX_PEERS) {
    console.warn(
      '[webrtc] peer cap reached (',
      peerCount(),
      '/',
      WEBRTC_LIMITS.MAX_PEERS,
      ') — rejecting',
      remoteId.slice(0, 8),
    )
    return null
  }

  const pc = new RTCPeerConnection({ iceServers: getICEServers() })
  const peer: PeerState = {
    id: remoteId,
    pc,
    dc: null,
    status: 'connecting',
    createdAt: Date.now(),
    lastPingMs: null,
    lastPingSentAt: null,
    lastPongAt: null,
    outboundQueue: [],
    rateBudget: RATE_BURST,
    lastRefillTs: Date.now(),
    rateViolations: [],
  }
  setPeer(peer)

  pc.onicecandidate = (ev) => {
    const ch = getSignalingChannel()
    if (!ch) return
    void ch.send({
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
      // Fase 6.2 integration: registry pra alimentar scoring futuro.
      void registryFailure(peer.id, 'ice').catch(() => {
        /* swallow */
      })
      // Fase 6.3-B: reconnect com backoff. Só roda em modo Nostr
      // (peer.id estável). Mock UUID seria reconectar a UUID antigo
      // que nunca volta — gating aqui pra função em si ser pura.
      if (useNostrSignaling()) _scheduleReconnect(peer.id)
    } else if (s === 'closed' || s === 'disconnected') {
      if (peer.status !== 'failed') peer.status = 'closed'
      peer.outboundQueue.length = 0
      // Barney R2: WebRTC oscila connected↔disconnected em redes flakey
      // (Wi-Fi handover, 4G→5G). Sem grace period, cap=5 atinge em ~31s
      // de oscilação real. Espera 5s antes de schedulear; se voltou pra
      // connected antes, cancela. Closed = manual close, sem reconnect.
      if (s === 'disconnected' && useNostrSignaling()) {
        setTimeout(() => {
          // Se peer voltou pra connected (status='open'), cancela.
          if (peer.status === 'open') return
          // Se peer foi limpo (cleanupPeer), também não reconectar.
          if (!hasPeer(peer.id)) return
          _scheduleReconnect(peer.id)
        }, 5_000)
      }
    }
  }

  // Side B: receberá o data channel via ondatachannel.
  pc.ondatachannel = (ev) => attachDataChannel(peer, ev.channel)

  // ICE timeout — Barney audit #1 (HIGH). Se ICE não resolver em 30s,
  // peer fica zombie em 'connecting' e vaza RAM. Mata e remove do map.
  setTimeout(() => {
    const current = getPeer(remoteId)
    if (!current || current !== peer) return
    if (peer.status === 'connecting') {
      console.warn('[webrtc] ICE timeout', remoteId.slice(0, 8), '— cleanup zombie')
      peer.status = 'failed'
      cleanupPeer(remoteId)
    }
  }, ICE_CONNECT_TIMEOUT_MS)

  return peer
}

export function attachDataChannel(peer: PeerState, dc: RTCDataChannel): void {
  peer.dc = dc
  dc.onopen = () => {
    peer.status = 'open'
    // Fase 6.3-B: reset reconnect counter em sucesso.
    _resetReconnectCounter(peer.id)
    // Fase 6.2 integration: registra handshake bem-sucedido no peerRegistry
    // pra alimentar scoring (manifesto §20). ASN/country ficam null em
    // 6.2 — preencher exigiria resolver IP local do peer (ICE candidate).
    void registryHandshake(peer.id).catch(() => {
      /* swallow — registry é best-effort, hot path DC não bloqueia */
    })
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
    // Lazy import pra evitar circular peer ↔ pipeline. pipeline.ts
    // chama cleanupPeer (peer.ts) em violação cross-proto — caminho
    // contrário daria ciclo top-level.
    void import('./pipeline').then(({ handleDataChannelMessage }) =>
      handleDataChannelMessage(peer, ev.data),
    )
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

export async function initiateOffer(peer: PeerState): Promise<void> {
  // Side A cria o data channel; Side B recebe via ondatachannel.
  const dc = peer.pc.createDataChannel('drift', { ordered: true })
  attachDataChannel(peer, dc)
  const offer = await peer.pc.createOffer()
  await peer.pc.setLocalDescription(offer)
  const ch = getSignalingChannel()
  if (!ch || !offer.sdp) return
  await ch.send({
    type: 'offer',
    from: myPeerId(),
    to: peer.id,
    ts: Date.now(),
    sdp: offer.sdp,
  })
}

export async function handleRemoteOffer(remoteId: string, sdp: string): Promise<void> {
  const peer = getOrCreatePeer(remoteId)
  if (!peer) return // cap atingido — drop offer silently (caller terá ICE timeout)
  // Glare collision — Barney audit #2 (CRITICAL). Se nosso lado já criou
  // offer (signalingState === 'have-local-offer'), aplicar setRemoteDescription
  // direto explode com DOMException. Padrão "perfect negotiation": o lado
  // não-polite (lex-loser via shouldInitiateOffer) cede, faz rollback e
  // aceita a offer remota. shouldInitiateOffer(me, peer)===true → eu sou
  // o initiator → ignoro a offer dele (ele faz rollback). Caso contrário,
  // se eu já tinha local offer, faço rollback antes de aceitar.
  const me = myPeerId()
  const iAmInitiator = shouldInitiateOffer(me, remoteId)
  const haveLocalOffer = peer.pc.signalingState === 'have-local-offer'
  if (haveLocalOffer && iAmInitiator) {
    // Eu venço o tie-break — ignoro offer dele, ele que faz rollback.
    return
  }
  try {
    if (haveLocalOffer) {
      // Eu perco o tie-break — rollback minha offer e aceita a dele.
      await peer.pc.setLocalDescription({ type: 'rollback' })
    }
    await peer.pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await peer.pc.createAnswer()
    await peer.pc.setLocalDescription(answer)
    const ch = getSignalingChannel()
    if (!ch || !answer.sdp) return
    await ch.send({
      type: 'answer',
      from: me,
      to: remoteId,
      ts: Date.now(),
      sdp: answer.sdp,
    })
  } catch (err) {
    console.warn('[webrtc] handleRemoteOffer falhou', remoteId.slice(0, 8), err)
    peer.status = 'failed'
  }
}

export async function handleRemoteAnswer(remoteId: string, sdp: string): Promise<void> {
  const peer = getPeer(remoteId)
  if (!peer) return
  await peer.pc.setRemoteDescription({ type: 'answer', sdp })
}

export async function handleRemoteIce(
  remoteId: string,
  candidate: RTCIceCandidateInit | null,
): Promise<void> {
  const peer = getPeer(remoteId)
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

export function cleanupPeer(remoteId: string): void {
  const peer = getPeer(remoteId)
  if (!peer) return
  // Barney 🟢 R1 (Sprint 4 review): reset reconnect counter no início
  // de cleanupPeer pra cobrir todos os call sites — antes só `boot.ts:
  // closeAll` resetava antes; em rate-limit kill / cross-proto kill /
  // ICE timeout, o counter ficava inflado pra reconexões futuras
  // (não era leak — Map vive até pagehide — mas semanticamente errado).
  _resetReconnectCounter(remoteId)
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
  deletePeer(remoteId)
}

// ─── Test-only helpers ───────────────────────────────────────────────

/** Test-only: cria um PeerState mínimo sem RTCPeerConnection real.
 *  Usar APENAS em tests Node — em runtime, peers nascem via getOrCreatePeer.
 *  `now0` permite usar timeline sintética (default Date.now()).
 *  Re-exportado em `webrtc/index.ts` como `_createPeerStateForTest`. */
export function _createPeerStateForTest(id: string, now0?: number): PeerState {
  const t = now0 ?? Date.now()
  return {
    id,
    pc: {} as RTCPeerConnection,
    dc: null,
    status: 'connecting',
    createdAt: t,
    lastPingMs: null,
    lastPingSentAt: null,
    lastPongAt: null,
    outboundQueue: [],
    rateBudget: RATE_BURST,
    lastRefillTs: t,
    rateViolations: [],
  }
}

/** Test-only: exposta pra exercitar o cap em getOrCreatePeer.
 *  Em runtime, callers são internos.
 *  Re-exportado em `webrtc/index.ts` como `_getOrCreatePeerForTest`. */
export function _getOrCreatePeerForTest(remoteId: string): PeerState | null {
  return getOrCreatePeer(remoteId)
}

/** Test-only: simula a porta de entrada de eventos cross-proto sem
 *  precisar de RTCDataChannel real. Recebe um SignedEvent-like e
 *  incrementa o contador / kill se threshold.
 *  Re-exportado em `webrtc/index.ts` como `_simulateCrossProtoForTest`.
 *
 *  Aqui mora porque o helper toca `peer.crossProtoCount` + chama
 *  `cleanupPeer` — alinhado com peer lifecycle, não com pipeline.
 *  (Marshall tradeoff: peer.ts ou pipeline.ts; escolhido peer.ts.) */
export function _simulateCrossProtoForTest(peer: PeerState): void {
  peer.crossProtoCount = (peer.crossProtoCount ?? 0) + 1
  if (peer.crossProtoCount >= WEBRTC_LIMITS.CROSS_PROTO_THRESHOLD) {
    peer.status = 'failed'
    cleanupPeer(peer.id)
    // Fase 6.2 integration: persiste blacklist no SQLite pra próxima
    // sessão também rejeitar este npub. TTL 1h (WEBRTC_LIMITS).
    void registryBlacklist(peer.id, WEBRTC_LIMITS.BLACKLIST_TTL_MS).catch(() => {
      /* swallow */
    })
  }
}
