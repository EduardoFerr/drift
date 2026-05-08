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
  CROSS_PROTO_VIOLATION_CAP,
  CROSS_PROTO_VIOLATION_THRESHOLD,
  CROSS_PROTO_VIOLATION_WINDOW_MS,
  ICE_CONNECT_TIMEOUT_MS,
  RATE_BURST,
  WEBRTC_LIMITS,
} from './config'
import { recordViolation } from '../policy/violationWindow'
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
    crossProtoViolations: [], // fix: T1 cross-proto window (Threat audit)
    pendingPings: [], // fix: T2 ping/pong 1:1 (Threat audit)
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
    // fix: B1 — qualquer transição out-of-disconnected (connected, failed,
    // closed) cancela o grace timer pendente. Sem isso, oscilações
    // disconnected↔connected empilham N setTimeouts cujos guards (status,
    // hasPeer) não cobrem o caso de N callbacks chamando _scheduleReconnect
    // em sequência rápida — counter avança N vezes, atinge cap=5 prematuro.
    // Audit: Docs/sessions/webrtc-architecture-audit-2026-05-08.md §B1.
    if (s !== 'disconnected' && peer.disconnectGraceTimer) {
      clearTimeout(peer.disconnectGraceTimer)
      peer.disconnectGraceTimer = null
    }
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
        // fix: B1 — guard contra empilhar grace timers em oscilação rápida.
        // Se já existe um timer pendente, mantém ele (não substitui — o
        // primeiro disconnected ainda é o relevante). Audit §B1.
        if (peer.disconnectGraceTimer) return
        peer.disconnectGraceTimer = setTimeout(() => {
          peer.disconnectGraceTimer = null
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
  // fix: B3 — armazena handle pra cancelar em cleanupPeer e liberar
  // a referência ao PeerState antigo (RTCPeerConnection já fechada +
  // outboundQueue) antes do GC natural ao fim dos 30s. Em sessão longa
  // com churn de peers (random walk a cada 30min), evita acumular
  // 8×30s = 240s de timers vivos. Audit §B3.
  peer.iceConnectTimer = setTimeout(() => {
    peer.iceConnectTimer = null
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
  // fix: B1 / B3 — cancelar timers pendentes pra liberar referências
  // ao PeerState antes do GC natural. Audit §B1 / §B3.
  if (peer.disconnectGraceTimer) {
    clearTimeout(peer.disconnectGraceTimer)
    peer.disconnectGraceTimer = null
  }
  if (peer.iceConnectTimer) {
    clearTimeout(peer.iceConnectTimer)
    peer.iceConnectTimer = null
  }
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

// ─── Cross-proto violation recording (T1 — Threat audit, M3 dedup) ──

/**
 * fix: T1 cross-proto window (Threat audit) — função canônica chamada
 * pelo pipeline.ts (porta runtime real) e por `_simulateCrossProtoForTest`
 * (porta Vitest). Antes do fix, lógica duplicava em 2 lugares (M3 do
 * audit) com semântica monotônica — atacante paciente burlava threshold.
 *
 * Comportamento:
 *  - Push timestamp em `peer.crossProtoViolations[]`, prune fora da janela,
 *    cap em CROSS_PROTO_VIOLATION_CAP (defesa contra spammer extremo).
 *  - Counter monotônico `crossProtoCount` segue incrementando — telemetria
 *    histórica (peerScore/peerRegistry consomem).
 *  - Se violações em janela ≥ THRESHOLD: peer.status='failed', cleanup +
 *    blacklist persistido (TTL 1h).
 */
export function recordCrossProtoViolation(peer: PeerState, now: number): void {
  if (peer.status === 'failed' || peer.status === 'closed') return
  peer.crossProtoCount = (peer.crossProtoCount ?? 0) + 1
  // Garante array existe mesmo em PeerStates legacy criados antes do fix.
  if (!Array.isArray(peer.crossProtoViolations)) {
    peer.crossProtoViolations = []
  }
  // S2 refactor (Ted/Barney audit 2026-05-08): delega push/cap/prune/threshold
  // pra util pura compartilhada `transport/policy/violationWindow`.
  const { count, tripped } = recordViolation(peer.crossProtoViolations, now, {
    windowMs: CROSS_PROTO_VIOLATION_WINDOW_MS,
    cap: CROSS_PROTO_VIOLATION_CAP,
    threshold: CROSS_PROTO_VIOLATION_THRESHOLD,
  })
  if (tripped) {
    console.warn(
      '[webrtc] cross-proto threshold (',
      count,
      'in window) — blacklist',
      peer.id.slice(0, 8),
    )
    peer.status = 'failed'
    cleanupPeer(peer.id)
    void registryBlacklist(peer.id, WEBRTC_LIMITS.BLACKLIST_TTL_MS).catch(() => {
      /* swallow — blacklist em memória já protegeu; persist é bonus */
    })
  }
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
    crossProtoViolations: [], // fix: T1 cross-proto window (Threat audit)
    pendingPings: [], // fix: T2 ping/pong 1:1 (Threat audit)
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
export function _simulateCrossProtoForTest(peer: PeerState, now?: number): void {
  // fix: T1 cross-proto window (Threat audit) — delega pro helper canônico.
  // M3 do audit: dedup pipeline.ts ↔ _simulate. Default `now=Date.now()`
  // preserva chamadas legadas sem timeline sintética.
  recordCrossProtoViolation(peer, now ?? Date.now())
}
