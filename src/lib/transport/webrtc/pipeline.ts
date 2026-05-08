/**
 * webrtc/pipeline — DataChannel inbound (invariante #5 do CLAUDE.md).
 *
 * Pipeline cheap → caro:
 *   1. Rate limit (token bucket)               → cheap
 *   2. Health ping/pong fast path              → cheap, prefix match
 *   3. JSON.parse + shape guard                → cheap
 *   4. Kind check (DRIFT_KIND_SET) + cross-proto threshold → cheap
 *   5. Schnorr verify                          → caro (~1ms)
 *   6. matchFilter + dedup + delivery aos subs → barato
 *
 * NÃO chama `onNostrEvent` aqui — orquestração da camada acima
 * (sync.ts/orchestrator). Entrega via `subscriptions` Map gerenciado
 * em `webrtc/state.ts`.
 *
 * `isPlausibleSignedEvent` é guard barato (shape only, não verify
 * Schnorr). Evita gastar CPU em frames malformados antes do verify
 * caro.
 */

import { DRIFT_KIND_SET } from '../../../config/constants'
import { verifyDriftEvent } from '../../nostr'
import type { SignedEvent } from '../../../types/nostr'
import { matchFilter } from '../matchFilter'
import { PING_PREFIX, PONG_PREFIX, SEEN_IDS_CAP } from './config'
import { _handlePong } from './health'
import { recordCrossProtoViolation } from './peer'
import { consumeRateBudget } from './rateLimit'
import { iterSubscriptions } from './state'
import type { PeerState } from './types'

export function handleDataChannelMessage(peer: PeerState, raw: string): void {
  // Barney 🔴 #1 (Sprint 4 review): defesa em profundidade contra
  // pong/frame chegando depois que peer foi marcado failed/closed
  // (cleanupPeer pode ter rodado entre `dc.onmessage` disparar e este
  // handler ser invocado via lazy import). consumeRateBudget já cobre
  // o caso pra ramo geral, mas o pong fast-path abaixo (linhas 50-54)
  // está ANTES do consumeRateBudget — sem este guard, pong de peer
  // killed ainda chama _handlePong + atualiza lastPingMs num peer que
  // vai sumir do Map em microtasks.
  if (peer.status === 'failed' || peer.status === 'closed') return

  // 0. Rate limit cheap-first (Barney #3) — antes mesmo do JSON.parse.
  //    Invariante #5 preservada: continua cheap → caro.
  if (!consumeRateBudget(peer, Date.now())) return

  // 0.5. Health ping/pong (Fase 6.3-C). Strings curtas com prefixo
  //      identificável; não passam por verify Schnorr (não são eventos
  //      Nostr). Tratamento isolado pra não poluir filtros.
  if (raw.startsWith(PING_PREFIX)) {
    const ts = raw.slice(PING_PREFIX.length)
    try {
      peer.dc?.send(`${PONG_PREFIX}${ts}`)
    } catch {
      /* dc fechou */
    }
    return
  }
  if (raw.startsWith(PONG_PREFIX)) {
    const ts = Number(raw.slice(PONG_PREFIX.length))
    if (Number.isFinite(ts)) _handlePong(peer, ts, Date.now())
    return
  }

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
  if (!DRIFT_KIND_SET.has(event.kind)) {
    // fix: T1 cross-proto window (Threat audit) — janela deslizante
    // substitui counter monotônico. Bot tentando empurrar kinds
    // não-Drift (e.g., kind:1, 30023) ainda é killed, mas atacante
    // paciente que distribui violações ao longo de >24h não acumula
    // pra threshold. M3 (audit): kill canônico vive em peer.ts —
    // pipeline.ts e _simulateCrossProtoForTest chamam o mesmo helper.
    recordCrossProtoViolation(peer, Date.now())
    return
  }

  // 3. Schnorr verify
  if (!verifyDriftEvent(event)) {
    console.warn('[webrtc] sig invalid from', peer.id, event.id?.slice(0, 8))
    return
  }

  // 4. Match + dedup + delivery
  for (const sub of iterSubscriptions()) {
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
