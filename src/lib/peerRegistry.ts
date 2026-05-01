/**
 * Peer Registry WebRTC (Fase 6.2 — manifesto §20 anti-eclipse)
 *
 * Persistência SQLite (tabela `peers_known`) de peers WebRTC conhecidos.
 * Substitui `Map<peerId, PeerState>` em memória do 6.1a no que toca
 * estado durável: scoring, blacklist, ASN/country diversity. O hot
 * path do data channel continua na Map em transport/webrtc.ts —
 * esta camada é low-frequency (handshake / failure / latency rolling),
 * portanto **zero cache em memória**: cada call bate SQLite.
 *
 * Justificativa do design (sem cache):
 *  - Reload-safe: SQLite é a fonte da verdade.
 *  - Sem deriva cache↔db (próximo handshake após reload já vê estado).
 *  - Frequência de chamada baixa (handshake é ~minutos, não ms).
 *
 * Threshold de cross-proto auto-blacklist (50 ocorrências → 1h) está
 * codificado aqui pra simplificar callsites — `webrtc.ts` só chama
 * `recordCrossProto(npub)` e o registry decide quando blacklistar.
 * Ver `Docs/archive/webrtc-6.2-plan.md` §3 e §7.
 */

import { db } from './db'

/** Peso da amostra nova no EWMA de latência (smoothing). */
const LATENCY_EWMA_ALPHA = 0.3

/** Limiar de cross-protocol kind injection antes de auto-blacklist. */
const CROSS_PROTO_THRESHOLD = 50

/** TTL (ms) do auto-blacklist por cross-protocol abuse. */
const CROSS_PROTO_BLACKLIST_TTL_MS = 60 * 60 * 1000 // 1h

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

interface PeerRow {
  npub: string
  last_seen: number
  conn_count: number
  fail_count: number
  latency_ms: number | null
  asn: number | null
  country: string | null
  blacklisted_until: number
  cross_proto_count: number
}

function rowToPeer(row: PeerRow): KnownPeer {
  return {
    npub: row.npub,
    lastSeen: row.last_seen,
    connCount: row.conn_count,
    failCount: row.fail_count,
    latencyMs: row.latency_ms,
    asn: row.asn,
    country: row.country,
    blacklistedUntil: row.blacklisted_until,
    crossProtoCount: row.cross_proto_count,
  }
}

/** `Date.now()` indireto pra permitir override em testes futuros. */
function now(): number {
  return Date.now()
}

/**
 * Registra um handshake bem-sucedido (DC aberto). UPSERT — primeira
 * vez insere com conn_count=1; subsequente incrementa e atualiza
 * last_seen. ASN/country usam COALESCE: novo lookup sobrescreve
 * apenas se não-null (evita perder dado bom por leitura ruim).
 */
export async function recordHandshake(
  npub: string,
  meta?: { asn?: number; country?: string },
): Promise<void> {
  const ts = now()
  const asn = meta?.asn ?? null
  const country = meta?.country ?? null
  await db.run(
    `INSERT INTO peers_known
       (npub, last_seen, conn_count, fail_count, latency_ms, asn, country, blacklisted_until, cross_proto_count)
     VALUES (?, ?, 1, 0, NULL, ?, ?, 0, 0)
     ON CONFLICT(npub) DO UPDATE SET
       conn_count = conn_count + 1,
       last_seen  = excluded.last_seen,
       asn        = COALESCE(excluded.asn, asn),
       country    = COALESCE(excluded.country, country)`,
    [npub, ts, asn, country],
  )
}

/**
 * Registra falha de conexão (ICE timeout, DC close anormal, etc.).
 * NÃO atualiza last_seen — só conexão real conta como "visto".
 * `reason` é informativo (futuro: métrica). Hoje só incrementa contador.
 */
export async function recordFailure(
  npub: string,
  _reason: 'ice' | 'dc' | 'timeout',
): Promise<void> {
  await db.run(
    `INSERT INTO peers_known
       (npub, last_seen, conn_count, fail_count, latency_ms, asn, country, blacklisted_until, cross_proto_count)
     VALUES (?, 0, 0, 1, NULL, NULL, NULL, 0, 0)
     ON CONFLICT(npub) DO UPDATE SET
       fail_count = fail_count + 1`,
    [npub, npub],
  )
}

/**
 * Atualiza latência via EWMA (alpha=0.3): primeira amostra seta
 * direto; subsequentes suavizam. Fórmula:
 *   latency_ms = (latency_ms IS NULL) ? new : 0.7 * prev + 0.3 * new
 */
export async function recordLatency(npub: string, rttMs: number): Promise<void> {
  // Cast para INTEGER preserva o storage do schema (latency_ms INTEGER).
  await db.run(
    `UPDATE peers_known
       SET latency_ms = CAST(
         CASE WHEN latency_ms IS NULL
              THEN ?
              ELSE (1.0 - ?) * latency_ms + ? * ?
         END
         AS INTEGER
       )
     WHERE npub = ?`,
    [rttMs, LATENCY_EWMA_ALPHA, LATENCY_EWMA_ALPHA, rttMs, npub],
  )
}

/**
 * Registra tentativa de cross-protocol abuse (peer enviou kind não-Drift
 * via DC). Ao atingir CROSS_PROTO_THRESHOLD, auto-blacklista 1h.
 * Manifesto §14 — WebRTC só multiplexa Nostr, não inventa protocolo.
 */
export async function recordCrossProto(npub: string): Promise<void> {
  await db.run(
    `INSERT INTO peers_known
       (npub, last_seen, conn_count, fail_count, latency_ms, asn, country, blacklisted_until, cross_proto_count)
     VALUES (?, 0, 0, 0, NULL, NULL, NULL, 0, 1)
     ON CONFLICT(npub) DO UPDATE SET
       cross_proto_count = cross_proto_count + 1`,
    [npub],
  )

  const row = await db.get<{ cross_proto_count: number }>(
    `SELECT cross_proto_count FROM peers_known WHERE npub = ?`,
    [npub],
  )

  if (row && row.cross_proto_count >= CROSS_PROTO_THRESHOLD) {
    await blacklist(npub, CROSS_PROTO_BLACKLIST_TTL_MS)
  }
}

/**
 * Marca peer como blacklisted por `ttlMs` a partir de agora. Idempotente:
 * setar de novo sobrescreve (TTL não acumula).
 */
export async function blacklist(npub: string, ttlMs: number): Promise<void> {
  const until = now() + ttlMs
  await db.run(
    `INSERT INTO peers_known
       (npub, last_seen, conn_count, fail_count, latency_ms, asn, country, blacklisted_until, cross_proto_count)
     VALUES (?, 0, 0, 0, NULL, NULL, NULL, ?, 0)
     ON CONFLICT(npub) DO UPDATE SET
       blacklisted_until = excluded.blacklisted_until`,
    [npub, until],
  )
}

/**
 * Checa se um peer está blacklisted (blacklisted_until > now).
 * Usado por `seeder.ts` (Fase 7.1a R2 — Barney) pra evitar gastar slot
 * MAX_PEERS conectando a peer punido por cross-protocol abuse.
 *
 * Custo: 1 SELECT pontual por candidato — chamado em batch antes de
 * `connectTo`, frequência baixa (handshake-time, não hot path).
 */
export async function isBlacklisted(npub: string): Promise<boolean> {
  const row = await db.get<{ blacklisted_until: number }>(
    `SELECT blacklisted_until FROM peers_known WHERE npub = ?`,
    [npub],
  )
  if (!row) return false
  return row.blacklisted_until > now()
}

/**
 * Lista peers conhecidos ordenados por `last_seen DESC`. Filtra
 * blacklisted (where blacklisted_until > now) quando opt-in.
 *
 * `limit` default=500 — suficiente pra alimentar `pickCandidates`
 * sem trazer todos os peers já vistos (seria O(N) na visão; raro
 * superar 500 em runtime real).
 */
export async function getKnownPeers(opts?: {
  limit?: number
  excludeBlacklisted?: boolean
}): Promise<KnownPeer[]> {
  const limit = opts?.limit ?? 500
  const excludeBL = opts?.excludeBlacklisted ?? false

  if (excludeBL) {
    const rows = await db.exec<PeerRow>(
      `SELECT * FROM peers_known
        WHERE blacklisted_until <= ?
        ORDER BY last_seen DESC
        LIMIT ?`,
      [now(), limit],
    )
    return rows.map(rowToPeer)
  }

  const rows = await db.exec<PeerRow>(
    `SELECT * FROM peers_known
      ORDER BY last_seen DESC
      LIMIT ?`,
    [limit],
  )
  return rows.map(rowToPeer)
}
