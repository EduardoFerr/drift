/**
 * Peer scoring + path diversity (Fase 6.2-B).
 *
 * Funções puras (manifesto §7). Não tocam SQLite, não usam Date.now()
 * implícito — `now` sempre vem por parâmetro.
 *
 * Manifesto §11 (sem afinidade): nenhum input vem de "afinidade de
 * conteúdo" — só topologia/confiabilidade.
 *
 * Manifesto §20 (anti-eclipse): diversity bonus + Shannon entropy
 * sobre distribuição de ASNs entre peers conectados.
 */

// NOTE: quando `peerRegistry.ts` (Fase 6.2-A, Marshall) mergear, troca
// a declaração local abaixo por `import type { KnownPeer } from './peerRegistry'`.
// Tipo é estrutural — match por shape, não por nominal.
export interface KnownPeer {
  npub: string
  lastSeen: number
  connCount: number
  failCount: number
  latencyMs: number | null
  asn: number | null
  country: string | null
  blacklistedUntil: number
  crossProtoCount: number
}

export interface ScoreInputs {
  candidate: KnownPeer
  currentlyConnected: ReadonlyArray<KnownPeer>
  now: number // ms (Date.now())
}

/**
 * Score [0..1] de um peer candidate. Função pura, manifesto §7.
 *
 * Combina:
 * - Reliability (0.35): conn_count / (conn + fail). Sem dados → 0.5.
 * - Latency (0.25): linear interp (2000-lat)/1950. Sem dado → 1000ms.
 * - Recency (0.15): exp(-ageDays/7). Decay 7d.
 * - Diversity bonus (0.25): ASN/country saturation entre conectados.
 *
 * Manifesto §11: nenhum input vem de "afinidade de conteúdo".
 */
export function scorePeer(inputs: ScoreInputs): number {
  const { candidate: c, currentlyConnected, now } = inputs

  // 1. Reliability (0..1)
  const total = c.connCount + c.failCount
  const reliability = total === 0 ? 0.5 : c.connCount / total

  // 2. Latency (linear interp)
  const lat = c.latencyMs ?? 1000
  const latencyScore = Math.max(0, Math.min(1, (2000 - lat) / 1950))

  // 3. Recency (decay 7d)
  const ageDays = (now / 1000 - c.lastSeen) / 86400
  const recency = Math.exp(-ageDays / 7)

  // 4. Diversity bonus (manifesto §20)
  const asnSat = currentlyConnected.filter(p => p.asn === c.asn).length
  const countrySat = currentlyConnected.filter(p => p.country === c.country).length
  const diversityBonus =
    (c.asn != null ? 1 / (1 + asnSat) : 0.5) * 0.5 +
    (c.country != null ? 1 / (1 + countrySat) : 0.5) * 0.5

  return 0.35 * reliability + 0.25 * latencyScore + 0.15 * recency + 0.25 * diversityBonus
}

/**
 * Shannon entropy normalizada da distribuição de ASNs entre peers
 * conectados. 0 = todos no mesmo ASN (péssimo, vetor eclipse). 1 = N
 * peers em N ASNs distintos (ideal). Manifesto §20.
 */
export function pathDiversityScore(connected: ReadonlyArray<KnownPeer>): number {
  if (connected.length === 0) return 0
  const asnCounts = new Map<string, number>()
  for (const p of connected) {
    const key = p.asn != null ? String(p.asn) : 'unknown'
    asnCounts.set(key, (asnCounts.get(key) ?? 0) + 1)
  }
  const total = connected.length
  let entropy = 0
  for (const count of asnCounts.values()) {
    const p = count / total
    entropy -= p * Math.log2(p)
  }
  // Normaliza por log2(N) — entropy max teórico
  const maxEntropy = Math.log2(asnCounts.size)
  return maxEntropy === 0 ? 0 : entropy / maxEntropy
}

/**
 * Sample sem reposição de N elementos aleatórios de um array.
 * Determinístico se receber RNG injectada (pra testes).
 */
export function sampleWithoutReplacement<T>(
  arr: ReadonlyArray<T>,
  n: number,
  rng: () => number = Math.random,
): T[] {
  const copy = [...arr]
  const out: T[] = []
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length)
    out.push(copy.splice(idx, 1)[0]!)
  }
  return out
}
