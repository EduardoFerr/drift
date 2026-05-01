import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock do db ANTES do import do test subject. Igual padrão de
// spread-map.test.ts. Reset entre testes pra cada cenário ser isolado.
vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import { db } from '../src/lib/db'
import {
  blacklist,
  getKnownPeers,
  recordCrossProto,
  recordFailure,
  recordHandshake,
  recordLatency,
  type KnownPeer,
} from '../src/lib/peerRegistry'

const NPUB_A = 'npub1aaaa'
const NPUB_B = 'npub1bbbb'

beforeEach(() => {
  vi.mocked(db.run).mockReset()
  vi.mocked(db.exec).mockReset()
  vi.mocked(db.get).mockReset()
  vi.mocked(db.run).mockResolvedValue(undefined as unknown as void)
  vi.mocked(db.exec).mockResolvedValue([])
  vi.mocked(db.get).mockResolvedValue(null)
})

describe('recordHandshake', () => {
  it('UPSERT — primeira vez insere com conn_count=1, last_seen=agora', async () => {
    const before = Date.now()
    await recordHandshake(NPUB_A)
    const after = Date.now()

    expect(db.run).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.run).mock.calls[0]!
    expect(sql).toContain('INSERT INTO peers_known')
    expect(sql).toContain('ON CONFLICT(npub) DO UPDATE SET')
    expect(sql).toContain('conn_count = conn_count + 1')

    // [npub, ts, asn, country]
    const [npub, ts, asn, country] = params!
    expect(npub).toBe(NPUB_A)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
    expect(asn).toBeNull()
    expect(country).toBeNull()
  })

  it('passa ASN/country quando fornecidos via meta', async () => {
    await recordHandshake(NPUB_A, { asn: 13335, country: 'BR' })
    const [, params] = vi.mocked(db.run).mock.calls[0]!
    expect(params![2]).toBe(13335)
    expect(params![3]).toBe('BR')
  })

  it('repetido — UPSERT incrementa conn_count e atualiza last_seen', async () => {
    await recordHandshake(NPUB_A)
    await recordHandshake(NPUB_A)
    expect(db.run).toHaveBeenCalledTimes(2)
    // Ambas as chamadas usam o mesmo SQL com cláusula UPDATE no conflito —
    // o SQLite real cuida do incremento; aqui validamos que a SQL emitida
    // tem a semântica correta.
    const sql = vi.mocked(db.run).mock.calls[1]![0]
    expect(sql).toContain('conn_count = conn_count + 1')
    expect(sql).toContain('last_seen  = excluded.last_seen')
  })
})

describe('recordFailure', () => {
  it('incrementa fail_count via UPDATE sem mexer em last_seen', async () => {
    await recordFailure(NPUB_A, 'ice')
    expect(db.run).toHaveBeenCalledTimes(1)
    const [sql] = vi.mocked(db.run).mock.calls[0]!
    expect(sql).toContain('fail_count = fail_count + 1')
    // Garantia explícita: nenhum SET em last_seen no DO UPDATE.
    expect(sql).not.toContain('last_seen  = excluded.last_seen')
    expect(sql).not.toMatch(/SET[\s\S]*last_seen\s*=/)
  })
})

describe('recordLatency (EWMA alpha=0.3)', () => {
  it('emite UPDATE com fórmula EWMA condicional para 1ª amostra', async () => {
    await recordLatency(NPUB_A, 120)
    expect(db.run).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.run).mock.calls[0]!
    expect(sql).toContain('UPDATE peers_known')
    expect(sql).toContain('CASE WHEN latency_ms IS NULL')
    // Sequência: [rttMs, alpha, alpha, rttMs, npub]
    expect(params).toEqual([120, 0.3, 0.3, 120, NPUB_A])
  })

  it('alpha permanece 0.3 entre chamadas (parâmetro fixo)', async () => {
    await recordLatency(NPUB_A, 100)
    await recordLatency(NPUB_A, 200)
    const params2 = vi.mocked(db.run).mock.calls[1]![1]!
    expect(params2[1]).toBe(0.3)
    expect(params2[2]).toBe(0.3)
    expect(params2[0]).toBe(200)
    expect(params2[3]).toBe(200)
  })
})

describe('blacklist', () => {
  it('seta blacklisted_until = now + ttl via UPSERT', async () => {
    const before = Date.now()
    await blacklist(NPUB_A, 60_000)
    const after = Date.now()

    expect(db.run).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.run).mock.calls[0]!
    expect(sql).toContain('blacklisted_until = excluded.blacklisted_until')

    const [npub, until] = params!
    expect(npub).toBe(NPUB_A)
    expect(until).toBeGreaterThanOrEqual(before + 60_000)
    expect(until).toBeLessThanOrEqual(after + 60_000)
  })
})

describe('recordCrossProto', () => {
  it('< threshold (50) — só incrementa, não blacklista', async () => {
    vi.mocked(db.get).mockResolvedValueOnce({ cross_proto_count: 49 })
    await recordCrossProto(NPUB_A)

    // 1 run pra incrementar; sem run de blacklist.
    expect(db.run).toHaveBeenCalledTimes(1)
    const [sql] = vi.mocked(db.run).mock.calls[0]!
    expect(sql).toContain('cross_proto_count = cross_proto_count + 1')
  })

  it('>= threshold (50) — incrementa E auto-blacklista 1h', async () => {
    vi.mocked(db.get).mockResolvedValueOnce({ cross_proto_count: 50 })
    const before = Date.now()
    await recordCrossProto(NPUB_A)
    const after = Date.now()

    // 2 runs: incremento + blacklist.
    expect(db.run).toHaveBeenCalledTimes(2)
    const [, blParams] = vi.mocked(db.run).mock.calls[1]!
    const [npub, until] = blParams!
    expect(npub).toBe(NPUB_A)
    // TTL = 1h.
    expect(until).toBeGreaterThanOrEqual(before + 60 * 60 * 1000)
    expect(until).toBeLessThanOrEqual(after + 60 * 60 * 1000)
  })

  it('> threshold também blacklista (não exige equality exata)', async () => {
    vi.mocked(db.get).mockResolvedValueOnce({ cross_proto_count: 137 })
    await recordCrossProto(NPUB_A)
    expect(db.run).toHaveBeenCalledTimes(2)
  })
})

describe('getKnownPeers', () => {
  const ROW_A = {
    npub: NPUB_A,
    last_seen: 1_700_000_200,
    conn_count: 5,
    fail_count: 1,
    latency_ms: 120,
    asn: 13335,
    country: 'BR',
    blacklisted_until: 0,
    cross_proto_count: 0,
  }
  const ROW_B = {
    npub: NPUB_B,
    last_seen: 1_700_000_100,
    conn_count: 2,
    fail_count: 0,
    latency_ms: null,
    asn: null,
    country: null,
    blacklisted_until: 0,
    cross_proto_count: 0,
  }

  it('mapeia row → KnownPeer (camelCase) preservando ordem', async () => {
    vi.mocked(db.exec).mockResolvedValueOnce([ROW_A, ROW_B])
    const peers = await getKnownPeers()
    expect(peers).toHaveLength(2)
    const a = peers[0]!
    const expected: KnownPeer = {
      npub: NPUB_A,
      lastSeen: 1_700_000_200,
      connCount: 5,
      failCount: 1,
      latencyMs: 120,
      asn: 13335,
      country: 'BR',
      blacklistedUntil: 0,
      crossProtoCount: 0,
    }
    expect(a).toEqual(expected)
    expect(peers[1]!.npub).toBe(NPUB_B)
    expect(peers[1]!.latencyMs).toBeNull()
  })

  it('default — não filtra blacklisted (where ausente)', async () => {
    vi.mocked(db.exec).mockResolvedValueOnce([])
    await getKnownPeers()
    const [sql] = vi.mocked(db.exec).mock.calls[0]!
    expect(sql).not.toContain('WHERE blacklisted_until')
    expect(sql).toContain('ORDER BY last_seen DESC')
  })

  it('excludeBlacklisted=true — adiciona WHERE blacklisted_until <= now', async () => {
    vi.mocked(db.exec).mockResolvedValueOnce([])
    const before = Date.now()
    await getKnownPeers({ excludeBlacklisted: true })
    const after = Date.now()

    const [sql, params] = vi.mocked(db.exec).mock.calls[0]!
    expect(sql).toContain('WHERE blacklisted_until <= ?')
    expect(sql).toContain('ORDER BY last_seen DESC')
    // [now, limit]
    const [nowArg, limitArg] = params!
    expect(nowArg).toBeGreaterThanOrEqual(before)
    expect(nowArg).toBeLessThanOrEqual(after)
    expect(limitArg).toBe(500)
  })

  it('respeita limit custom', async () => {
    vi.mocked(db.exec).mockResolvedValueOnce([])
    await getKnownPeers({ limit: 10 })
    const [, params] = vi.mocked(db.exec).mock.calls[0]!
    expect(params![0]).toBe(10)
  })

  it('limit + excludeBlacklisted — limit é 2º param', async () => {
    vi.mocked(db.exec).mockResolvedValueOnce([])
    await getKnownPeers({ limit: 7, excludeBlacklisted: true })
    const [, params] = vi.mocked(db.exec).mock.calls[0]!
    expect(params![1]).toBe(7)
  })
})
