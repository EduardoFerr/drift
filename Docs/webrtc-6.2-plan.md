# Fase 6.2 — Peer Registry + Path Diversity + Multi-Transport

**Status**: depende de 6.1a-D (mock signaling shipped) e 6.1b-E (NIP-44 signaling shipped). Endereça T-WRTC-006/007/008/010/017 do `webrtc-threats.md`.

## 1. Recap escopo

Sai do "WebRTC funciona entre 2 peers" pra "cliente roteia tráfego por N transportes com critério anti-eclipse". Quatro entregas:

1. **`peerRegistry.ts`** — substitui `Map<peerId, PeerState>` em memória do 6.1a por persistência SQLite (`peers_known`). Sobrevive reload, alimenta scoring.
2. **Path diversity scoring** — função pura `scorePeer(known, candidate)` baseada em latência, fail_rate, ASN/country diversity. Casa com `probe.ts` (mesma família §20).
3. **`transport/orchestrator.ts`** — `sync.ts` deixa de falar com `wssTransport` direto. Orchestrator faz race no publish, fan-out no subscribe, agrega `health()`.
4. **Caps + rate-limits** — `MAX_PEERS=32`, 1 conn/pubkey, 100 msg/s/peer, blacklist por cross-protocol kind injection.

**Invariantes citadas**: #11 (sem afinidade — score é técnico, não de conteúdo), #14 (compatibilidade Nostr — orchestrator não inventa kinds, só multiplexa transportes).

## 2. Schema SQLite `peers_known` (migration v7)

```sql
CREATE TABLE IF NOT EXISTS peers_known (
  npub        TEXT PRIMARY KEY,
  last_seen   INTEGER NOT NULL,
  conn_count  INTEGER NOT NULL DEFAULT 0,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  latency_ms  INTEGER,
  asn         INTEGER,
  country     TEXT,
  blacklisted_until INTEGER NOT NULL DEFAULT 0,
  cross_proto_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers_known(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_peers_score_inputs ON peers_known(latency_ms, fail_count);
```

Migration em `db.worker.ts` schema_v 6 → 7: `CREATE TABLE IF NOT EXISTS peers_known (...)` + `INSERT OR REPLACE INTO user_prefs ('schema_v','7')`. Sem rebuild destrutivo.

ASN/country: best-effort via lookup local cacheado (lib `ip-cidr-asn` shipada com bundle, ou fallback `null`). **Nunca** chama API externa.

## 3. `peerRegistry.ts` — API + estado

```typescript
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

export async function recordHandshake(npub: string, meta: { asn?: number; country?: string }): Promise<void>
export async function recordFailure(npub: string, reason: 'ice' | 'dc' | 'timeout'): Promise<void>
export async function recordLatency(npub: string, rttMs: number): Promise<void>  // EWMA
export async function recordCrossProto(npub: string): Promise<void>
export async function blacklist(npub: string, ttlMs: number): Promise<void>
export async function getKnownPeers(opts?: { limit?: number; excludeBlacklisted?: boolean }): Promise<KnownPeer[]>
export async function pickCandidates(n: number, opts: PickOpts): Promise<KnownPeer[]>
```

**Zero cache em memória.** Toda query bate SQLite. Justificativa: registry é low-frequency; evita deriva cache↔db; reload-safe. Hot path de DC continua em `webrtc.ts` com Map em memória.

## 4. Algoritmo de scoring (puro, testável)

```typescript
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

export function pathDiversityScore(connected: ReadonlyArray<KnownPeer>): number {
  // Shannon entropy normalizada sobre ASN distribution
  if (connected.length === 0) return 0
  // ... implementação completa ver código
}
```

**Invariante #11**: nenhum input vem de "afinidade de conteúdo" — só topologia/confiabilidade.

## 5. Random walk policy

```typescript
const RANDOM_WALK_RATIO = 0.25  // 25% das slots são aleatórias

export async function pickCandidates(n: number, opts): Promise<KnownPeer[]> {
  const all = await getKnownPeers({ excludeBlacklisted: true, limit: 500 })
  const pool = all.filter(p => !opts.excludeNpubs.has(p.npub))
  const randomSlots = Math.ceil(n * RANDOM_WALK_RATIO)
  const scoredSlots = n - randomSlots

  const random = sampleWithoutReplacement(pool, randomSlots)
  const remaining = pool.filter(p => !random.includes(p))
  const scored = remaining
    .map(c => ({ p: c, s: scorePeer({ candidate: c, currentlyConnected: [], now: Date.now() }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, scoredSlots)
    .map(x => x.p)

  return [...random, ...scored]
}
```

Gatilhos de re-pick: boot, a cada 30min (alinha com `probe.ts`), após failCount > connCount * 2 em peer ativo.

## 6. `orchestrator.ts` — API

```typescript
export interface TransportOrchestrator extends Transport {
  readonly kind: 'bundle'  // multiplexer
  registerTransport(t: Transport, opts: { weight: number; required: boolean }): void
}
```

**Publish race-to-first-ok**: primeira confirmação `ok>0` resolve o caller; outras propagações continuam em background.

**Subscribe fan-out**: dedup por `event.id` em LRU(1000). EOSE: primeiro EOSE conta.

**Health agg**: concat com prefixo (`webrtc:<npub>`, `wss:<url>`).

`sync.ts` migra de `wssTransport` pra `orchestrator`. Behaviorally idêntico se só WSS está registrado.

## 7. Cap + rate-limit policy

```typescript
export const WEBRTC_LIMITS = {
  MAX_PEERS: 32,
  MAX_PEERS_PER_PUBKEY: 1,
  RATE_LIMIT_MSG_PER_SEC: 100,
  RATE_LIMIT_BURST: 200,
  CROSS_PROTO_THRESHOLD: 50,
  BLACKLIST_TTL_MS: 60 * 60 * 1000,
} as const
```

Behavior overflow:
- `peers.size >= MAX_PEERS` + novo handshake: rejeita (`bye`), exceto se score > P50 dos atuais → ejeta o pior.
- Mesma pubkey já conectada: `bye` no novo, log.
- Rate-limit excedeu: `pc.close()` + `recordFailure(npub, 'dc')` + `blacklist(npub, 5min)`.
- Cross-proto kind injection > 50: `recordCrossProto` → blacklist 1h.

## 8. Sub-fases / commits

- **6.2-A**: migration v7 + `peerRegistry.ts` + tests
- **6.2-B**: `peerScore.ts` puro + tests
- **6.2-C**: random walk + caps em `webrtc.ts` + tests
- **6.2-D**: `orchestrator.ts` + tests
- **6.2-E**: `sync.ts` migra pra orchestrator
- **6.2-F**: DiagnosticPanel métricas + bump 0.6.2-alpha

## 9. Tests Vitest (peças puras)

- `peerRegistry.test.ts`: insert/update, EWMA convergência, blacklist TTL, cross-proto threshold, exclude blacklisted
- `peerScore.test.ts`: 100% reliability vs 50%, ASN saturation, recency decay 7d, entropy edge cases
- `pickCandidates.test.ts`: 25% random slots, excludeNpubs, pool < n
- `webrtcCaps.test.ts`: MAX_PEERS hard cap, mesma pubkey, rate-limit close
- `orchestrator.test.ts`: publish race, dedup cross-transport, health concat

## 10. Critério de aceite e2e

3 peers reais (PC-A, PC-B em ASN diferente via VPN, celular 4G):
- `peers_known` populado em cada após handshake
- `getKnownPeers()` mostra entries com ASNs distintos
- DiagnosticPanel: "Peers WebRTC: 2 open · Path diversity: 1.00 · Random walk: 25%"
- Mata B → score cai mas npub permanece
- Reload A → registry persiste
- Publish spread no A → orchestrator race; B/celular recebem 1x cada (dedup)
- Atacante: 60 eventos kind:1 → blacklist 1h

## 11. Tempo / risco

**12-16h em 3-4 sessões**. Mais ramificações que 6.1b por tocar SQLite + `sync.ts`.

Riscos:
1. **ASN lookup offline**: lib adiciona ~500KB. Adiar pra 6.3 (junto com STUN config); diversity bonus fica country-only/uniform inicialmente.
2. **Migration v7**: schema_v=6→7 só CREATE TABLE, baixo risco. Smoke: rodar atual → atualizar build → confirmar `peers_known` criada.
3. **`sync.ts` refactor quebra teste suite WSS**: orchestrator com só WSS registrado = comportamentalmente equivalente. Snapshot test antes/depois.
4. **`Promise.any` rejeita se TODOS rejeitam**: wrap em `.catch(() => null)` + fallback agregação tradicional.

## 12. Dependências

- **6.1a-D shipped**: webrtc.ts esqueleto, matchFilter, signaling mock. ⏳
- **6.1b-E shipped**: signaling NIP-44, `connectTo(npub)`. Bloqueia teste e2e cross-machine de 6.2 (não bloqueia commits A-D, que rodam com mock).
- **`probe.ts`**: orchestrator pode futuramente expor probe-over-WebRTC; em 6.2 mantém `probe.ts` só sobre WSS.

Recomendação: 6.2-A/B/C podem rodar em paralelo ao 6.1b-B/C/D (módulos disjuntos). 6.2-D/E/F só após 6.1b-E mergear.
