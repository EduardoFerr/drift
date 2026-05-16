/**
 * webrtc/followsDiscovery — NIP-02 auto-discovery P2P.
 *
 * Manifesto §16 (disponibilidade distribuída) + §28 (privacidade).
 *
 * Quando habilitado (`p2p_auto_follows = true`), conecta via WebRTC
 * com follows que estão online. OPT-IN por decisão HIMYM (Barney):
 *
 *   1. Follow graph vaza via timing correlation no signaling
 *   2. IP vaza pra cada follow via ICE candidates
 *   3. Follows comprometidos facilitam eclipse
 *
 * Default OFF. Toggle em Settings com warning explícito.
 *
 * Constraints (Marshall conformance + Barney security):
 *   - 50% MAX_PEERS cap: follows NÃO dominam todos os slots
 *     (anti-eclipse §20 — random walk precisa de espaço)
 *   - Stagger connects: 800ms entre cada tentativa (não flood
 *     signaling channel com N DMs simultâneos)
 *   - Skip already-connected: não reconecta a quem já está
 *   - Run once on boot + once per hour (não hot path)
 */

import { useFollowsStore } from '../../follows'
import { getPrefs } from '../../prefs'
import { WEBRTC_LIMITS } from './config'
import { peerCount, peerIds } from './state'

const FOLLOWS_CAP_RATIO = 0.5
const STAGGER_MS = 800
const FOLLOWS_DISCOVERY_INTERVAL_MS = 60 * 60 * 1000

let followsTimer: ReturnType<typeof setInterval> | null = null

export async function discoverFollowsPeers(): Promise<void> {
  if (!getPrefs().p2p_auto_follows) return

  const { useNostrSignaling } = await import('./boot')
  if (!useNostrSignaling()) return

  const following = useFollowsStore.getState().following
  if (following.size === 0) return

  const connectedIds = new Set<string>(peerIds())
  const maxFollowSlots = Math.floor(WEBRTC_LIMITS.MAX_PEERS * FOLLOWS_CAP_RATIO)
  const slotsAvailable = maxFollowSlots - countFollowsConnected(connectedIds, following)

  if (slotsAvailable <= 0) return

  const candidates = Array.from(following)
    .filter((npub) => !connectedIds.has(npub))
    .slice(0, slotsAvailable)

  if (candidates.length === 0) return

  console.info(`[webrtc] follows discovery: ${candidates.length} candidates (${following.size} follows, ${slotsAvailable} slots)`)

  const { connectTo } = await import('./discovery')

  for (let i = 0; i < candidates.length; i++) {
    if (peerCount() >= WEBRTC_LIMITS.MAX_PEERS) break
    void connectTo(candidates[i]!).catch(() => {})
    if (i < candidates.length - 1) {
      await sleep(STAGGER_MS)
    }
  }
}

export function startFollowsDiscovery(): void {
  if (followsTimer) return
  if (!getPrefs().p2p_auto_follows) return

  void discoverFollowsPeers()
  followsTimer = setInterval(() => {
    void discoverFollowsPeers()
  }, FOLLOWS_DISCOVERY_INTERVAL_MS)
}

export function stopFollowsDiscovery(): void {
  if (followsTimer) {
    clearInterval(followsTimer)
    followsTimer = null
  }
}

function countFollowsConnected(connectedIds: Set<string>, following: Set<string>): number {
  let count = 0
  for (const id of connectedIds) {
    if (following.has(id)) count++
  }
  return count
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
