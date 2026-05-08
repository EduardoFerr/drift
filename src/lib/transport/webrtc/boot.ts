/**
 * webrtc/boot — signaling boot lazy + dispatcher + pagehide cleanup.
 *
 * Orquestração: decide entre mock signaling (BroadcastChannel) e real
 * (Nostr DM kind 1059 NIP-44) baseado em `VITE_USE_NOSTR_SIGNALING`.
 * Gerencia singleton via promise (evita double-boot em race de
 * `publish/subscribe/connectTo` paralelos).
 *
 * `myPeerId()` resolve da seguinte ordem:
 *   1. signalingChannel.peerId (canônico — UUID em mock, npub em Nostr)
 *   2. _myPeerId cacheado (fallback pré-boot)
 *   3. Gera UUID novo (fallback de fallback — evita undefined)
 *
 * `closeAll` agrega teardown cross-facet: stops timers (health,
 * randomWalk, reconnect), cleanup peers, drops signaling. **Único lugar
 * com visão cross-facet** — Lily 1 + Sprint 6 política de erro.
 */

import { createMockSignalingChannel } from '../webrtc-signaling-mock'
import type { SignalingChannel, SignalingMessage } from '../signaling'
import { shouldInitiateOffer } from '../signaling'
import {
  cleanupPeer,
  getOrCreatePeer,
  handleRemoteAnswer,
  handleRemoteIce,
  handleRemoteOffer,
  initiateOffer,
} from './peer'
import {
  clearSubscriptions,
  getSignalingChannel,
  getSignalingUnsub,
  getMyPeerIdRaw,
  isPagehideRegistered,
  markPagehideRegistered,
  peerIds,
  setSignalingChannel,
  setSignalingUnsub,
  setMyPeerId,
} from './state'
import { startHealthCheckTimer, stopHealthCheckTimer } from './health'
import { _resetReconnectCounter } from './reconnect'
import { clampPeerTimestamp } from '../policy/clockClamp'

/** fix: T3 Date.now() unprotected (Threat audit) — janela de tolerância
 *  pra `msg.ts` em SignalingMessage. Peers em timezones diferentes ou
 *  com clock skew leve (NTP drift) ainda passam; atacante mandando
 *  ts=now+1e9 (clock forge) ou ts antigo (replay) é dropado.
 *
 *  Defense-in-depth: `webrtc-signaling-nostr.ts` já valida shape (`ts`
 *  finite); aqui adicionamos sanity contra valores absurdos. Mock
 *  signaling (BroadcastChannel same-origin) não tem ataque externo,
 *  mas o gate aplica uniformemente pros dois canais. */
const SIGNALING_TS_MAX_FUTURE_SKEW_MS = 5 * 60_000
const SIGNALING_TS_MAX_PAST_SKEW_MS = 24 * 60 * 60_000
// Eager import — Barney 🔴 #2 (regressão pós-split): `closeAll` é
// chamado em `pagehide` listener e precisa ser síncrono o suficiente
// pra rodar antes da aba fechar. Antes era `await import('./discovery')`
// no início, que travava todo o cleanup atrás do dynamic import.
// Direção do lazy invertida: discovery.ts → boot.ts agora usa lazy
// (custo zero: `connectTo`/`performRandomWalk` já são async).
import { startRandomWalkTimer, stopRandomWalkTimer } from './discovery'

/** Retorna `true` se o flag `VITE_USE_NOSTR_SIGNALING === '1'`.
 *  Default off — mock BroadcastChannel same-origin pra dev/PoC. */
export function useNostrSignaling(): boolean {
  return import.meta.env.VITE_USE_NOSTR_SIGNALING === '1'
}

export function myPeerId(): string {
  // Quando signaling está booted, usa peerId canônico do canal (UUID em
  // mock, npub em Nostr). Defesa contra race: se algum caller hipotético
  // chamar antes do `ensureSignalingAsync` completar (improvável — todos
  // os call sites passam por await), retorna UUID temporário do fallback.
  // Após boot, `_myPeerId` é setado pelo próprio `ensureSignalingAsync`
  // pro npub em modo Nostr — então `myPeerId()` continua retornando o
  // mesmo valor pra esse runtime.
  const ch = getSignalingChannel()
  if (ch) return ch.peerId
  const cached = getMyPeerIdRaw()
  if (cached) return cached
  let id: string
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    id = crypto.randomUUID()
  } else {
    id = 'webrtc-' + Math.random().toString(36).slice(2, 11)
  }
  setMyPeerId(id)
  return id
}

/** Promise singleton do boot — evita race quando publish/subscribe/connectTo
 *  são chamados em paralelo durante o boot async (modo Nostr precisa await
 *  identity). */
let signalingBootPromise: Promise<SignalingChannel> | null = null

export async function ensureSignalingAsync(): Promise<SignalingChannel> {
  const existing = getSignalingChannel()
  if (existing) return existing
  if (signalingBootPromise) return signalingBootPromise
  signalingBootPromise = (async (): Promise<SignalingChannel> => {
    if (useNostrSignaling()) {
      const { getOrCreateIdentity, nsecHexToBytes } = await import('../../identity')
      const { wssTransport } = await import('../wss')
      const { nostrSignalingChannel } = await import('../webrtc-signaling-nostr')
      const id = await getOrCreateIdentity()
      // Em modo Nostr, peerId local = npub (lex compare em
      // shouldInitiateOffer continua válido).
      setMyPeerId(id.npub)
      const ch = nostrSignalingChannel({
        myNpub: id.npub,
        myNsecBytes: nsecHexToBytes(id.nsec),
        transport: wssTransport,
      })
      setSignalingChannel(ch)
      setSignalingUnsub(ch.onMessage(handleSignalingMessage))
      registerPagehideOnce()
      startRandomWalkTimer()
      // Fase 6.3-C: health checks ping/pong (15s interval).
      startHealthCheckTimer()
      // Sem hello broadcast em modo Nostr — discovery é PoI-only
      // (caller chama connectTo(peerNpub) sabendo o alvo).
      return ch
    }
    // Mock fallback (default em DEV).
    const ch = createMockSignalingChannel(myPeerId())
    setSignalingChannel(ch)
    setSignalingUnsub(ch.onMessage(handleSignalingMessage))
    registerPagehideOnce()
    startRandomWalkTimer()
    startHealthCheckTimer()
    // Mock: anuncia presença ao boot.
    void ch.send({
      type: 'hello',
      from: ch.peerId,
      ts: Date.now(),
      drift: { capabilities: ['datachannel-v1'] },
    })
    return ch
  })()
  try {
    return await signalingBootPromise
  } catch (err) {
    // Em caso de falha (ex.: identity decrypt explode), descarta a promise
    // pra tentativas futuras poderem re-bootar.
    signalingBootPromise = null
    throw err
  }
}

function registerPagehideOnce(): void {
  if (isPagehideRegistered()) return
  if (typeof window === 'undefined') return
  markPagehideRegistered()
  window.addEventListener('pagehide', () => {
    try {
      getSignalingChannel()?.send({
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

function handleSignalingMessage(msg: SignalingMessage): void {
  // fix: T3 Date.now() unprotected (Threat audit) — clamp peer-supplied
  // `msg.ts` contra janela ±N do relógio local. Atacante forjando
  // ts=now+1e9 ou replay de hello antigo é dropado antes de tocar
  // peer state. Audit §T3 + 2.3 da auditoria 2026-05-08.
  const clamp = clampPeerTimestamp(msg.ts, Date.now(), {
    maxFutureSkewMs: SIGNALING_TS_MAX_FUTURE_SKEW_MS,
    maxPastSkewMs: SIGNALING_TS_MAX_PAST_SKEW_MS,
  })
  if (!clamp.ok) {
    console.warn(
      '[webrtc] signaling msg dropped — clock skew',
      clamp.reason,
      `skew=${clamp.skewMs}ms`,
      'from',
      msg.from.slice(0, 8),
    )
    return
  }
  const me = myPeerId()
  switch (msg.type) {
    case 'hello': {
      // Cria peer entry preventivamente (mesmo se a gente não inicia).
      const peer = getOrCreatePeer(msg.from)
      if (!peer) return // cap atingido — ignora hello
      if (shouldInitiateOffer(me, msg.from)) {
        void initiateOffer(peer)
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

/** Cleanup completo — fecha todos os peers, desliga signaling, limpa subs.
 *  Re-exportado em `webrtc/index.ts`. Único lugar com visão cross-facet
 *  de teardown (Lily 1).
 *
 *  Barney 🔴 #2 (Sprint 4 review): tudo SÍNCRONO antes de qualquer
 *  await. `pagehide` listener (registerPagehideOnce abaixo) faz
 *  `void closeAll()` mas o browser não aguarda Promises pendentes —
 *  aba fecha antes. Pré-fix, `await import('./discovery')` no início
 *  travava todo o cleanup atrás do dynamic import e timers/peers
 *  ficavam vivos até GC. Agora todos os stops são eager. */
export async function closeAll(): Promise<void> {
  // Stops síncronos primeiro — rodam sempre, mesmo se aba fechar
  // imediatamente após o pagehide listener.
  stopRandomWalkTimer()
  // Fase 6.3-C: para health checks. Reconnect timers cancelam via
  // _resetReconnectCounter abaixo (cada peer cleanup zera seu timer).
  stopHealthCheckTimer()
  // Snapshot dos ids antes de iterar (cleanupPeer muta o Map).
  for (const peerId of Array.from(peerIds())) {
    _resetReconnectCounter(peerId)
    cleanupPeer(peerId)
  }
  clearSubscriptions()
  const unsub = getSignalingUnsub()
  if (unsub) {
    try {
      unsub()
    } catch {
      /* noop */
    }
    setSignalingUnsub(null)
  }
  const ch = getSignalingChannel()
  if (ch) {
    try {
      ch.close()
    } catch {
      /* noop */
    }
    setSignalingChannel(null)
  }
  signalingBootPromise = null
}
