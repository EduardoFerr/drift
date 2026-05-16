/**
 * webrtc — barrel + Transport API.
 *
 * Este módulo é o entrypoint público. Mantém os imports antigos
 * (`from '../webrtc'`) válidos via re-exports, sem precisar mudar
 * `bootstrap.ts`, `seeder.ts`, `main.tsx`, ou os 4 specs Vitest do
 * webrtc.
 *
 * Estrutura interna (Sprint 4 do roadmap pós-auditoria, commit
 * `xxxx`):
 * ```
 * webrtc/
 * ├── index.ts        ← este arquivo (Transport API + barrel)
 * ├── types.ts        PeerState, PeerStatus, SubscriptionRecord
 * ├── state.ts        Maps singleton via API tipada
 * ├── config.ts       WEBRTC_LIMITS, prefixos PING, intervalos
 * ├── ice.ts          STUN + _parseTurnServers + getICEServers
 * ├── peer.ts         Lifecycle + factory + injects (test helpers)
 * ├── pipeline.ts     handleDataChannelMessage + schema guard
 * ├── rateLimit.ts    _RATE_LIMIT_CONSTANTS + _consumeRateBudget
 * ├── health.ts       _markPing + _handlePong + _isPeerDegraded
 * ├── reconnect.ts    _RECONNECT_CONSTANTS + backoff + schedule
 * ├── discovery.ts    performRandomWalk + connectTo + getPeers
 * └── boot.ts         ensureSignalingAsync + closeAll + handleSignalingMessage
 * ```
 *
 * Princípios de organização:
 *  1. **Barrel re-exporta TUDO** que era público + test-only do
 *     `webrtc.ts` original. Tests não migram paths. Marshall §4.
 *  2. **Magic-at-distance** (lazy `await import()`) para quebrar
 *     circulares: peer ↔ pipeline (DC message handler), reconnect →
 *     discovery (connectTo no setTimeout).
 *  3. **State único em `state.ts`** — Maps acessados via API tipada.
 *     Lily peer review: nenhum sub-módulo toca o Map cru.
 *
 * Manifesto §12 (multi-transport), §15 (anti-censura, DoS resistance),
 * §16 (disponibilidade distribuída via WebRTC seed), §20 (anti-eclipse
 * via random walk).
 */

import type { SignedEvent } from '../../../types/nostr'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from '../index'
import { _isPeerDegraded } from './health'
import { ensureSignalingAsync, myPeerId } from './boot'
import {
  iterPeers,
  setSubscription,
  deleteSubscription,
  subscriptionCount,
} from './state'
import type { SubscriptionRecord } from './types'
import {
  DEFAULT_SUB_VALIDATOR_CFG,
  validateSubscriptionFilter,
} from '../policy/subValidator'

/** fix: T4 sub maliciosa (Threat audit) — hard cap de subscriptions
 *  simultâneas. Sub validation cobre per-filter; o cap global protege
 *  contra caller que cria N subs sane mas em volume abusivo. Antes
 *  havia só warn em >50 (poluição de log, não defesa). */
const MAX_SIMULTANEOUS_SUBSCRIPTIONS = 64

// ─── Transport API ───────────────────────────────────────────────────

async function publish(event: SignedEvent): Promise<PublishResult> {
  await ensureSignalingAsync()
  const raw = JSON.stringify(event)
  const perRelay: PublishResult['perRelay'] = []
  let ok = 0
  let failed = 0

  for (const peer of iterPeers()) {
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
  // fix: T4 sub maliciosa (Threat audit) — valida filter antes de registrar.
  // Match-all (sem kinds/authors/ids/tags/since/until) causa load
  // amplification: cada evento percorre todas as subs sem trabalho.
  // Filters com authors=[1000] / kinds=[100] também são abusivos.
  // Audit §T4 + 2.3 da auditoria 2026-05-08.
  const validation = validateSubscriptionFilter(filter, DEFAULT_SUB_VALIDATOR_CFG)
  if (!validation.ok) {
    console.warn('[webrtc] subscribe rejected — invalid filter:', validation.reason)
    // EOSE imediato pra não travar caller; onevent nunca dispara.
    if (handlers.oneose) queueMicrotask(() => handlers.oneose?.())
    return () => {
      /* noop */
    }
  }
  // fix: T4 — hard cap simultâneo. Caller passou da cota: drop sub.
  if (subscriptionCount() >= MAX_SIMULTANEOUS_SUBSCRIPTIONS) {
    console.warn(
      '[webrtc] subscribe rejected — cap reached (',
      subscriptionCount(),
      '/',
      MAX_SIMULTANEOUS_SUBSCRIPTIONS,
      ')',
    )
    if (handlers.oneose) queueMicrotask(() => handlers.oneose?.())
    return () => {
      /* noop */
    }
  }

  // Fire-and-forget — boot do signaling pode ser async (modo Nostr).
  // Subscribe shape externa permanece síncrona; falhas async são logadas
  // pelo caller via onevent que nunca dispara, ou pelo console aqui.
  void ensureSignalingAsync().catch((err) =>
    console.error('[webrtc] signaling boot falhou:', err),
  )
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
  setSubscription(record)
  // Sem oneose síncrono: WebRTC não tem "histórico" — peers só repassam
  // tempo real. Chamamos oneose assim mesmo no próximo tick pra sinalizar
  // "fim do flush inicial" (não há histórico aqui).
  if (handlers.oneose) {
    queueMicrotask(() => handlers.oneose?.())
  }
  return () => {
    deleteSubscription(id)
  }
}

async function health(_timeoutMs?: number): Promise<TransportHealth[]> {
  // Fase 6.3-C: lastPingMs agora é RTT real (não placeholder). Peer
  // `degraded` aparece como `ok: false` mas com latência (sinal pra UI
  // mostrar "instável"). Peer `failed`/`closed` aparece sem latência.
  const now = Date.now()
  const out: TransportHealth[] = []
  for (const peer of iterPeers()) {
    let degraded = false
    if (peer.status === 'open') {
      degraded = _isPeerDegraded(peer, now)
      if (degraded && peer.status === 'open') peer.status = 'degraded'
    }
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

/** Acesso DEV ao peerId local — útil pra debug em 2 abas.
 *  Consumido por `main.tsx:16`. */
export function getMyPeerId(): string {
  return myPeerId()
}

// ─── Re-exports públicos (preservam imports `from '../webrtc'`) ──────

export { connectTo, getPeers } from './discovery'
export { closeAll } from './boot'
export { WEBRTC_LIMITS } from './config'
export type { PeerStatus } from './types'

// ─── Discovery mechanisms (Fase 6 — P2P pairing) ────────────────────

export {
  encodePeerLink,
  decodePeerLink,
  buildPeerURL,
  generatePeerQR,
} from './peerLink'
export type { PeerLinkData } from './peerLink'

export {
  discoverFollowsPeers,
  startFollowsDiscovery,
  stopFollowsDiscovery,
} from './followsDiscovery'

export {
  exportBundle,
  importBundle,
  reassembleChunks,
} from './bundle'
export type { BundleExport } from './bundle'

// ─── Re-exports test-only (`_*` prefix) ──────────────────────────────
//
// Marshall §4: barrel re-exporta TODOS os 22 símbolos que webrtc.ts
// original expunha. Tests não migram paths — `from '../src/lib/
// transport/webrtc'` continua resolvendo aqui.

export { _parseTurnServers } from './ice'
export {
  _RECONNECT_CONSTANTS,
  _computeBackoffDelay,
  _resetReconnectCounter,
  _scheduleReconnect,
} from './reconnect'
export { _markPing, _handlePong, _isPeerDegraded } from './health'
export {
  _createPeerStateForTest,
  _getOrCreatePeerForTest,
  _simulateCrossProtoForTest,
} from './peer'
// `_injectPeerForTest` e `_resetPeersForTest` moram em `state.ts`
// (encapsulam o Map). Re-export direto pra preservar API de tests.
export { _injectPeerForTest, _resetPeersForTest } from './state'
export { _RATE_LIMIT_CONSTANTS, consumeRateBudget as _consumeRateBudget } from './rateLimit'
