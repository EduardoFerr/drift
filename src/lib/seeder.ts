/**
 * seeder — Proof of Interest auto-discovery (Fase 7.1a, manifesto §16).
 *
 * Quando user abre o mapa de um post, conecta a peers WebRTC dos
 * `spreader_pub` desse post. "Espalhar = seedear": quem espalhou um
 * post se compromete a republicá-lo se um par solicitar.
 *
 * Idempotente — peers já conectados são skip. Cap respeita MAX_PEERS.
 * Default off em modo mock (UUID por aba não persiste); ativo em modo
 * Nostr (npub estável).
 */

import { db } from './db'
import { connectTo, getPeers, WEBRTC_LIMITS } from './transport/webrtc'

// dedup: não re-seed mesmo post 2x na sessão
const SEEDED_POSTS = new Set<string>()

interface SpreaderRow {
  spreader_pub: string
}

/**
 * Descobre + conecta a peers que espalharam este post.
 * Best-effort — failures dropam silencioso (já tracked via peerRegistry
 * em outras camadas).
 *
 * @returns número de connectTo disparados (não garante sucesso)
 */
export async function seedFromSpreaders(postId: string): Promise<number> {
  if (SEEDED_POSTS.has(postId)) return 0
  SEEDED_POSTS.add(postId)

  // 1. pega spreaders distintos do SQLite local
  //    ORDER BY RANDOM() (Barney R1): em post viral com >MAX_PEERS spreaders,
  //    sem random escolhemos sempre os "primeiros" da ordem indefinida do
  //    SQLite — viés temporal previsível favorece bots em flash-spread.
  //    Random shuffle a cada chamada distribui quem é candidato.
  const rows = await db.exec<SpreaderRow>(
    `SELECT DISTINCT spreader_pub FROM spreads WHERE post_id = ? ORDER BY RANDOM()`,
    [postId],
  )
  if (rows.length === 0) return 0

  // 2. filtra: já conectados, cap MAX_PEERS available
  //    (auto-pubkey/self-connect: connectTo já no-ops via myPeerId check)
  const connectedIds = new Set(getPeers().map((p) => p.id))
  const candidates = rows
    .map((r) => r.spreader_pub)
    .filter((pub) => !connectedIds.has(pub))

  const slotsAvailable = WEBRTC_LIMITS.MAX_PEERS - connectedIds.size
  const targetSlots = Math.min(candidates.length, slotsAvailable)
  if (targetSlots <= 0) return 0

  // 3. dispara connectTo paralelo. best-effort.
  const toConnect = candidates.slice(0, targetSlots)
  for (const pub of toConnect) {
    void connectTo(pub).catch(() => {
      /* swallow — falhas registradas via peerRegistry no webrtc.ts */
    })
  }
  return toConnect.length
}

/** Test-only: limpa dedup entre tests. */
export function _resetSeederState(): void {
  SEEDED_POSTS.clear()
}
