import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execMock, runMock, getMock, connectToMock, getPeersMock, getPrefsMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  runMock: vi.fn(),
  getMock: vi.fn(),
  connectToMock: vi.fn(),
  getPeersMock: vi.fn(),
  getPrefsMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: {
    exec: execMock,
    run: runMock,
    get: getMock,
  },
}))

vi.mock('../src/lib/transport/webrtc', () => ({
  connectTo: connectToMock,
  getPeers: getPeersMock,
  WEBRTC_LIMITS: {
    MAX_PEERS: 32,
    MAX_PEERS_PER_PUBKEY: 1,
    RATE_LIMIT_MSG_PER_SEC: 100,
    RATE_LIMIT_BURST: 200,
    CROSS_PROTO_THRESHOLD: 50,
    BLACKLIST_TTL_MS: 60 * 60 * 1000,
  },
}))

// Mock prefs — gate por network_mode (§15 anti-IP-leak em modo Tor).
vi.mock('../src/lib/prefs', () => ({
  getPrefs: getPrefsMock,
}))

import { seedFromSpreaders, _resetSeederState } from '../src/lib/seeder'

const POST_ID = 'p'.repeat(64)

function pub(byte: string): string {
  return byte.repeat(64)
}

function peer(id: string) {
  return { id, status: 'connected' as const, latencyMs: 50 }
}

beforeEach(() => {
  execMock.mockReset()
  runMock.mockReset()
  getMock.mockReset()
  connectToMock.mockReset().mockResolvedValue(undefined)
  getPeersMock.mockReset().mockReturnValue([])
  // Default: clearnet — caso ativo. Tests específicos de gate sobrescrevem.
  getPrefsMock.mockReset().mockReturnValue({ network_mode: 'clearnet' })
  _resetSeederState()
})

describe('seedFromSpreaders', () => {
  it('retorna 0 e não chama connectTo quando não há spreaders', async () => {
    execMock.mockResolvedValue([])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(0)
    expect(connectToMock).not.toHaveBeenCalled()
  })

  it('conecta a todos os spreaders únicos quando não há peers conectados', async () => {
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') },
      { spreader_pub: pub('b') },
      { spreader_pub: pub('c') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(3)
    expect(connectToMock).toHaveBeenCalledTimes(3)
    expect(connectToMock).toHaveBeenCalledWith(pub('a'))
    expect(connectToMock).toHaveBeenCalledWith(pub('b'))
    expect(connectToMock).toHaveBeenCalledWith(pub('c'))
  })

  it('skip spreaders já conectados', async () => {
    getPeersMock.mockReturnValue([peer(pub('a'))])
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') }, // já conectado
      { spreader_pub: pub('b') },
      { spreader_pub: pub('c') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(2)
    expect(connectToMock).toHaveBeenCalledTimes(2)
    expect(connectToMock).not.toHaveBeenCalledWith(pub('a'))
    expect(connectToMock).toHaveBeenCalledWith(pub('b'))
    expect(connectToMock).toHaveBeenCalledWith(pub('c'))
  })

  it('respeita MAX_PEERS — só preenche slots disponíveis', async () => {
    // 30 já conectados, MAX_PEERS=32 → slots = 2
    const connected = Array.from({ length: 30 }, (_, i) =>
      peer(pub(String.fromCharCode(0x30 + i))),
    )
    getPeersMock.mockReturnValue(connected)
    execMock.mockResolvedValue([
      { spreader_pub: pub('w') },
      { spreader_pub: pub('x') },
      { spreader_pub: pub('y') },
      { spreader_pub: pub('z') },
      { spreader_pub: pub('a') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(2)
    expect(connectToMock).toHaveBeenCalledTimes(2)
  })

  it('é idempotente — 2ª chamada pro mesmo postId retorna 0 sem novas conexões', async () => {
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') },
      { spreader_pub: pub('b') },
    ])
    const n1 = await seedFromSpreaders(POST_ID)
    expect(n1).toBe(2)
    expect(connectToMock).toHaveBeenCalledTimes(2)

    connectToMock.mockClear()
    const n2 = await seedFromSpreaders(POST_ID)
    expect(n2).toBe(0)
    expect(connectToMock).not.toHaveBeenCalled()
    // Não consulta o DB de novo (early return)
    // (não obrigatório mas é o comportamento atual)
  })

  it('_resetSeederState permite re-seed do mesmo postId', async () => {
    execMock.mockResolvedValue([{ spreader_pub: pub('a') }])
    const n1 = await seedFromSpreaders(POST_ID)
    expect(n1).toBe(1)

    _resetSeederState()
    connectToMock.mockClear()

    const n2 = await seedFromSpreaders(POST_ID)
    expect(n2).toBe(1)
    expect(connectToMock).toHaveBeenCalledTimes(1)
  })

  it('não throwa se connectTo rejeita — best-effort, retorna count normal', async () => {
    connectToMock.mockRejectedValue(new Error('peer offline'))
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') },
      { spreader_pub: pub('b') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(2)
    expect(connectToMock).toHaveBeenCalledTimes(2)
    // micro-task tick pra rejection ser swallowed pelo .catch
    await new Promise((r) => setTimeout(r, 0))
  })

  it('com slots=0 (peers cheios) não chama connectTo', async () => {
    const connected = Array.from({ length: 32 }, (_, i) =>
      peer(`peer-${i}`),
    )
    getPeersMock.mockReturnValue(connected)
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') },
      { spreader_pub: pub('b') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(0)
    expect(connectToMock).not.toHaveBeenCalled()
  })

  it('SELECT usa DISTINCT no spreader_pub para deduplicação', async () => {
    execMock.mockResolvedValue([])
    await seedFromSpreaders(POST_ID)
    expect(execMock).toHaveBeenCalledTimes(1)
    const sql = execMock.mock.calls[0]![0] as string
    expect(sql).toContain('DISTINCT')
    expect(sql).toContain('spreader_pub')
    expect(sql).toContain('FROM spreads')
    expect(sql).toContain('post_id')
    const params = execMock.mock.calls[0]![1] as unknown[]
    expect(params).toEqual([POST_ID])
  })

  it('edge: se DB devolve dups (defesa em profundidade), connecta a cada row retornada', async () => {
    // Hipótese: query DISTINCT falha por algum motivo, DB devolve dups.
    // Comportamento atual do seeder: chama connectTo pra cada candidate
    // (não dedupa em memória). Documenta isso como expectativa.
    execMock.mockResolvedValue([
      { spreader_pub: pub('a') },
      { spreader_pub: pub('a') },
      { spreader_pub: pub('b') },
    ])
    const n = await seedFromSpreaders(POST_ID)
    expect(n).toBe(3)
    expect(connectToMock).toHaveBeenCalledTimes(3)
  })

  // §15 anti-censura — gate por network_mode (mesmo padrão do bootstrap.ts).
  // Sem esse gate, abrir SpreadMap em modo Tor disparava connectTo direto,
  // bypassando o orchestrator → IP leak via STUN/ICE candidates.
  describe('§15 — gate por network_mode (anti-IP-leak em Tor/onion-only)', () => {
    it('em modo tor: NÃO consulta DB nem chama connectTo (early return)', async () => {
      getPrefsMock.mockReturnValue({ network_mode: 'tor' })
      execMock.mockResolvedValue([
        { spreader_pub: pub('a') },
        { spreader_pub: pub('b') },
      ])
      const n = await seedFromSpreaders(POST_ID)
      expect(n).toBe(0)
      expect(execMock).not.toHaveBeenCalled()
      expect(connectToMock).not.toHaveBeenCalled()
    })

    it('em modo onion-only: NÃO consulta DB nem chama connectTo', async () => {
      getPrefsMock.mockReturnValue({ network_mode: 'onion-only' })
      execMock.mockResolvedValue([{ spreader_pub: pub('a') }])
      const n = await seedFromSpreaders(POST_ID)
      expect(n).toBe(0)
      expect(execMock).not.toHaveBeenCalled()
      expect(connectToMock).not.toHaveBeenCalled()
    })

    it('em modo clearnet: comportamento normal (default dos outros tests)', async () => {
      getPrefsMock.mockReturnValue({ network_mode: 'clearnet' })
      execMock.mockResolvedValue([{ spreader_pub: pub('a') }])
      const n = await seedFromSpreaders(POST_ID)
      expect(n).toBe(1)
      expect(connectToMock).toHaveBeenCalledTimes(1)
    })
  })
})
