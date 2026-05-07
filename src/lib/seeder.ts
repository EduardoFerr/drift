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
 *
 * ─── Track B.4 — DEFERRED ────────────────────────────────────────────
 *
 * Integração `seeder` ↔ Helia (libp2p provider hints) está adiada.
 * Plano original (RFC blob-distribution.md §10 B.4): quando seeder
 * descobre peer com `spreader_pub` X, sinalizar pra Helia/libp2p que
 * "peer X provavelmente tem os CIDs do post Y" — `libp2p.peerStore.add`
 * + provider routing. Reduziria latency de fetch via gateway público.
 *
 * Bloqueador técnico: Drift roda **2 stacks libp2p paralelos** — o
 * WebRTC custom (`lib/transport/webrtc/`) e o que vem dentro do Helia.
 * Bridging exige dial de um peer pelo outro, ou compartilhamento de
 * peerStore — engenharia real, não polish trivial. RFC §10 confirma
 * "B.4 é polish, não bloqueia cumprimento de §16".
 *
 * Trigger pra reabrir B.4: medições mostrarem latency mediana de fetch
 * via gateway > 2s para CIDs que peers Drift conhecidos têm pinados.
 */

import { db } from './db'
import { isBlacklisted } from './peerRegistry'
import { connectTo, getPeers, WEBRTC_LIMITS } from './transport/webrtc'

/**
 * Cap de dedup (Barney R4): sessões longas (~horas) abrindo dezenas de
 * mapas distintos crescem o Set sem teto. 256 posts cobre uso humano
 * realista; quando estoura, FIFO drop do mais antigo (re-seed permitido
 * pra esses, custo: idempotente — connectTo no-op em peers já abertos).
 */
const SEEDED_POSTS_CAP = 256
const SEEDED_POSTS = new Set<string>()

function markSeeded(postId: string): void {
  if (SEEDED_POSTS.size >= SEEDED_POSTS_CAP) {
    // FIFO: Set preserva ordem de inserção; .values().next() devolve o 1º.
    const oldest = SEEDED_POSTS.values().next().value
    if (oldest !== undefined) SEEDED_POSTS.delete(oldest)
  }
  SEEDED_POSTS.add(postId)
}

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
  markSeeded(postId)

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

  // 2. filtra: já conectados + blacklisted (Barney R2 — peers punidos por
  //    cross-protocol abuse não devem queimar slot de MAX_PEERS).
  //    (auto-pubkey/self-connect: connectTo já no-ops via myPeerId check)
  const connectedIds = new Set(getPeers().map((p) => p.id))
  const preFilter = rows
    .map((r) => r.spreader_pub)
    .filter((pub) => !connectedIds.has(pub))

  // Checa blacklist em paralelo — N candidatos, N SELECTs pequenos. Em
  // post típico (≤32 spreaders), latência é ~ms. Mantém ordem original
  // pra preservar o random shuffle do SQL.
  const blacklistFlags = await Promise.all(preFilter.map(isBlacklisted))
  const candidates = preFilter.filter((_, i) => !blacklistFlags[i])

  const slotsAvailable = WEBRTC_LIMITS.MAX_PEERS - connectedIds.size
  const targetSlots = Math.min(candidates.length, slotsAvailable)
  if (targetSlots <= 0) return 0

  // 3. dispara connectTo paralelo. best-effort.
  const toConnect = candidates.slice(0, targetSlots)
  for (const pub of toConnect) {
    void connectTo(pub).catch(() => {
      /* swallow — falhas registradas via peerRegistry no webrtc/peer.ts */
    })
  }
  return toConnect.length
}

/** Test-only: limpa dedup entre tests. */
export function _resetSeederState(): void {
  SEEDED_POSTS.clear()
}
