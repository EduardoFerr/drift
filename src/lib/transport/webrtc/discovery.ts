/**
 * webrtc/discovery — random walk anti-eclipse + connectTo + getPeers.
 *
 * Random walk (manifesto §20): conecta com peers conhecidos do
 * `peerRegistry` pra reduzir probabilidade de captura local. 25% dos
 * slots vão pra peers aleatórios (corrosão estatística contra clusters
 * de bots); 75% vão pros scored top.
 *
 * Só faz sentido em **modo Nostr** — peer.id é npub estável. Em modo
 * mock, peer.id é UUID por aba (não persiste); registry acumula entries
 * inertes que nunca conectam, gerando ruído. Por isso gating early.
 *
 * `connectTo` é o entrypoint discovery ativo (PoI seeder, DEV bridge).
 * Usado por `seeder.ts:seedFromSpreaders`, `main.tsx` DEV, e pelo
 * timer de reconnect (lazy dynamic import em `reconnect.ts`).
 */

import { shouldInitiateOffer } from '../signaling'
import { getKnownPeers } from '../../peerRegistry'
import { sampleWithoutReplacement, scorePeer } from '../../peerScore'
import {
  RANDOM_WALK_INTERVAL_MS,
  RANDOM_WALK_RANDOM_RATIO,
  RANDOM_WALK_TARGET,
  WEBRTC_LIMITS,
} from './config'
// Sprint 4 + Barney 🔴 #2: direção do lazy invertida pra que `boot.ts`
// possa importar `start/stopRandomWalkTimer` EAGER (essencial pro
// cleanup síncrono em pagehide). Aqui usamos `await import('./boot')`
// dentro de funções já async — custo zero perceptível.
import { getOrCreatePeer, initiateOffer } from './peer'
import { iterPeers, peerCount, peerIds } from './state'
import type { PeerState, PeerStatus } from './types'

let randomWalkTimer: ReturnType<typeof setInterval> | null = null

/**
 * Dispatch random walk (manifesto §20). Skip se hard cap atingido ou
 * em modo mock. Não bloqueia se `connectTo` falhar — best-effort.
 */
export async function performRandomWalk(): Promise<void> {
  // Gating: só roda em modo Nostr (peer.id = npub). Em mock, peer.id é
  // UUID que não persiste — registry vira lixo e connectTo a UUIDs antigos
  // sempre falha. Skip silencioso, não-erro.
  const { useNostrSignaling } = await import('./boot')
  if (!useNostrSignaling()) return

  // Skip se hard cap atingido.
  if (peerCount() >= WEBRTC_LIMITS.MAX_PEERS) return

  let known
  try {
    known = await getKnownPeers({ excludeBlacklisted: true, limit: 200 })
  } catch (err) {
    console.warn('[webrtc] random walk: getKnownPeers falhou', err)
    return
  }

  // Exclude peers já conectados (não reconecta a quem já está aí).
  const connectedIds = new Set<string>(peerIds())
  const pool = known.filter((p) => !connectedIds.has(p.npub))
  if (pool.length === 0) return

  const slotsAvailable = WEBRTC_LIMITS.MAX_PEERS - peerCount()
  const targetSlots = Math.min(RANDOM_WALK_TARGET, slotsAvailable)
  const randomCount = Math.ceil(targetSlots * RANDOM_WALK_RANDOM_RATIO)
  const scoredCount = targetSlots - randomCount

  // Random slots — Fisher-Yates sample sem reposição.
  const random = sampleWithoutReplacement(pool, randomCount)
  const remaining = pool.filter((p) => !random.includes(p))

  // Scored slots — calcula score, ordena desc, top N.
  const now = Date.now()
  const currentlyConnected: Parameters<typeof scorePeer>[0]['currentlyConnected'] = []
  const scored = remaining
    .map((p) => ({ p, s: scorePeer({ candidate: p, currentlyConnected, now }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, scoredCount)
    .map((x) => x.p)

  const candidates = [...random, ...scored]
  if (candidates.length === 0) return

  console.info(
    '[webrtc] random walk:',
    candidates.length,
    `candidates (${random.length} random + ${scored.length} scored)`,
  )

  // Dispatch connectTo em paralelo. Best-effort — não awaitamos sucesso.
  // Cada connectTo já trata cap/duplicate internamente via getOrCreatePeer.
  for (const cand of candidates) {
    void connectTo(cand.npub).catch(() => {
      /* swallow — failure já é registrado via registryFailure */
    })
  }
}

export function startRandomWalkTimer(): void {
  if (randomWalkTimer) return
  // Trigger inicial on-boot + intervalo 30min.
  void performRandomWalk()
  randomWalkTimer = setInterval(() => {
    void performRandomWalk()
  }, RANDOM_WALK_INTERVAL_MS)
}

export function stopRandomWalkTimer(): void {
  if (randomWalkTimer) {
    clearInterval(randomWalkTimer)
    randomWalkTimer = null
  }
}

/**
 * Conecta proativamente a um peer conhecido (DEV / PoI seeder). Em
 * produção, peers se descobrem via `hello` broadcast (mock) ou via
 * Proof of Interest + NIP-44 DM (Fase 6.1b).
 */
export async function connectTo(remotePeerId: string): Promise<void> {
  const { ensureSignalingAsync, myPeerId } = await import('./boot')
  const ch = await ensureSignalingAsync()
  if (remotePeerId === myPeerId()) return
  // Type narrowing: getOrCreatePeer retorna PeerState | null
  const peer: PeerState | null = getOrCreatePeer(remotePeerId)
  if (!peer) {
    console.warn('[webrtc] connectTo rejected — peer cap reached')
    return
  }
  if (shouldInitiateOffer(myPeerId(), remotePeerId)) {
    await initiateOffer(peer)
  } else {
    // Fora do tie-break: re-anunciar hello pra forçar o outro a iniciar.
    // Em modo Nostr, hello é silenciosamente droppado pelo channel —
    // discovery PoI-only depende do peer remoto também chamar connectTo.
    await ch.send({
      type: 'hello',
      from: myPeerId(),
      ts: Date.now(),
      drift: { capabilities: ['datachannel-v1'] },
    })
  }
}

/** Snapshot readonly dos peers — DEV only. Re-exportado em
 *  `webrtc/index.ts` como `getPeers`. Consumido por `seeder.ts:15`,
 *  `main.tsx:13`. */
export function getPeers(): ReadonlyArray<{
  id: string
  status: PeerStatus
  latencyMs: number | null
}> {
  const out: { id: string; status: PeerStatus; latencyMs: number | null }[] = []
  for (const p of iterPeers()) {
    out.push({ id: p.id, status: p.status, latencyMs: p.lastPingMs })
  }
  return out
}
