/**
 * webrtc/state — Maps singleton + state global encapsulado via API tipada.
 *
 * **Princípio**: nenhum sub-módulo (peer/health/discovery/...) acessa os
 * Maps crus. Tudo passa por funções desta camada — assim podemos:
 *  - Adicionar instrumentação (logs, métricas) num único lugar
 *  - Trocar `Map` por `WeakMap` ou store Zustand sem refactor cross-arquivo
 *  - Garantir que test-only `_resetPeersForTest` realmente limpa tudo
 *
 * Lily peer review do Sprint 4 (Ted item state.ts): "Se Ted criar um módulo
 * peer.ts que encapsula o Map atrás de funções, todos os outros módulos
 * consomem via API. Risco: se peer.ts exportar o Map cru, cria-se
 * acoplamento global e qualquer mutação fora não dispara hooks.
 * Recomendo encapsulamento via API, não export do Map."
 */

import type { PeerState, SubscriptionRecord } from './types'
import type { SignalingChannel, SignalingUnsubscribe } from '../signaling'

// ─── Storage privado ─────────────────────────────────────────────────

const peers = new Map<string, PeerState>()
const subscriptions = new Map<string, SubscriptionRecord>()

// Boot/lifecycle singletons. Tocados por `boot.ts` via setters; lidos por
// `peer.ts`/`discovery.ts`/`pipeline.ts` via getters.
let signalingChannel: SignalingChannel | null = null
let signalingUnsub: SignalingUnsubscribe | null = null
let myPeerIdValue: string | null = null
let pagehideRegistered = false

// ─── Peers API ───────────────────────────────────────────────────────

export function getPeer(id: string): PeerState | undefined {
  return peers.get(id)
}

export function setPeer(peer: PeerState): void {
  peers.set(peer.id, peer)
}

export function deletePeer(id: string): boolean {
  return peers.delete(id)
}

export function hasPeer(id: string): boolean {
  return peers.has(id)
}

export function peerCount(): number {
  return peers.size
}

export function iterPeers(): IterableIterator<PeerState> {
  return peers.values()
}

export function peerIds(): IterableIterator<string> {
  return peers.keys()
}

// ─── Subscriptions API ───────────────────────────────────────────────

export function setSubscription(record: SubscriptionRecord): void {
  subscriptions.set(record.id, record)
}

export function deleteSubscription(id: string): boolean {
  return subscriptions.delete(id)
}

export function clearSubscriptions(): void {
  subscriptions.clear()
}

export function subscriptionCount(): number {
  return subscriptions.size
}

export function iterSubscriptions(): IterableIterator<SubscriptionRecord> {
  return subscriptions.values()
}

// ─── Signaling singleton API ─────────────────────────────────────────

export function getSignalingChannel(): SignalingChannel | null {
  return signalingChannel
}

export function setSignalingChannel(ch: SignalingChannel | null): void {
  signalingChannel = ch
}

export function getSignalingUnsub(): SignalingUnsubscribe | null {
  return signalingUnsub
}

export function setSignalingUnsub(unsub: SignalingUnsubscribe | null): void {
  signalingUnsub = unsub
}

export function getMyPeerIdRaw(): string | null {
  return myPeerIdValue
}

export function setMyPeerId(id: string | null): void {
  myPeerIdValue = id
}

export function isPagehideRegistered(): boolean {
  return pagehideRegistered
}

export function markPagehideRegistered(): void {
  pagehideRegistered = true
}

// ─── Test-only API ───────────────────────────────────────────────────

/** Test-only: limpa o Map de peers entre tests. Re-exportado em
 *  `webrtc/index.ts` como `_resetPeersForTest`. */
export function _resetPeersForTest(): void {
  for (const id of Array.from(peers.keys())) peers.delete(id)
}

/** Test-only: injeta um PeerState no Map de peers (sem RTCPeerConnection
 *  real). Permite testar MAX_PEERS sem precisar abrir 32 PeerConnections.
 *  Re-exportado em `webrtc/index.ts` como `_injectPeerForTest`. */
export function _injectPeerForTest(peer: PeerState): void {
  peers.set(peer.id, peer)
}
