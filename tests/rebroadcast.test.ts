import { describe, expect, it, vi, beforeEach } from 'vitest'

const { execMock, publishMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  publishMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: vi.fn(), get: vi.fn() },
}))

vi.mock('../src/lib/transport/wss', () => ({
  pool: { publish: (...args: unknown[]) => publishMock(...args) },
}))

import { rebroadcastToRelay } from '../src/lib/rebroadcast'

const ME = 'a'.repeat(64)
const RELAY = 'wss://relay.test'

beforeEach(() => {
  execMock.mockReset()
  publishMock.mockReset().mockResolvedValue(undefined)
})

function makeRawEvent(id: string): string {
  return JSON.stringify({
    id,
    pubkey: ME,
    kind: 9078,
    created_at: 1714000000,
    tags: [],
    content: '',
    sig: 's'.repeat(128),
  })
}

describe('rebroadcastToRelay', () => {
  it('retorna stats zeradas quando o user não tem nenhum evento próprio', async () => {
    execMock.mockResolvedValue([])
    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats).toEqual({ sent: 0, failed: 0, durationMs: 0 })
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('republica cada evento único uma vez (dedup por id)', async () => {
    // Mesmo id duplicado simula post próprio + spread do mesmo post.
    const id1 = 'b'.repeat(64)
    const id2 = 'c'.repeat(64)
    execMock.mockResolvedValue([
      { raw_event: makeRawEvent(id1) },
      { raw_event: makeRawEvent(id1) }, // duplicado
      { raw_event: makeRawEvent(id2) },
    ])

    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats.sent).toBe(2)
    expect(stats.failed).toBe(0)
    expect(publishMock).toHaveBeenCalledTimes(2)
    // publish chamado com [relayUrl] como array
    expect(publishMock.mock.calls[0]![0]).toEqual([RELAY])
  })

  it('ignora rows sem raw_event (eventos pré-Fase-5)', async () => {
    execMock.mockResolvedValue([
      { raw_event: null },
      { raw_event: makeRawEvent('d'.repeat(64)) },
    ])
    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats.sent).toBe(1)
    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it('ignora rows com raw_event JSON malformado (sem crash)', async () => {
    execMock.mockResolvedValue([
      { raw_event: 'not-valid-json' },
      { raw_event: makeRawEvent('e'.repeat(64)) },
    ])
    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats.sent).toBe(1)
  })

  it('ignora eventos parseados sem campo id', async () => {
    execMock.mockResolvedValue([
      { raw_event: JSON.stringify({ kind: 9078, pubkey: ME }) },
      { raw_event: makeRawEvent('f'.repeat(64)) },
    ])
    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats.sent).toBe(1)
  })

  it('contabiliza failed quando pool.publish lança', async () => {
    execMock.mockResolvedValue([
      { raw_event: makeRawEvent('a'.repeat(64)) },
      { raw_event: makeRawEvent('b'.repeat(64)) },
    ])
    publishMock
      .mockRejectedValueOnce(new Error('relay down'))
      .mockResolvedValueOnce(undefined)
    const stats = await rebroadcastToRelay(RELAY, ME)
    expect(stats.failed).toBe(1)
    expect(stats.sent).toBe(1)
  })

  it('SELECT cobre as 4 fontes (posts próprios, spreads-do-user, spreads-table, buries-table)', async () => {
    execMock.mockResolvedValue([])
    await rebroadcastToRelay(RELAY, ME)
    const sql = execMock.mock.calls[0]![0] as string
    expect(sql).toContain('FROM posts')
    expect(sql).toContain('FROM spreads')
    expect(sql).toContain('FROM buries')
    expect(sql).toContain('UNION ALL')
    // Manifesto §16 — reports NÃO entram (privacidade do reporter)
    expect(sql).not.toContain('FROM reports')
  })

  it('passa npub do user 4x como parâmetro do SELECT (filtra por author/spreader/burier)', async () => {
    execMock.mockResolvedValue([])
    await rebroadcastToRelay(RELAY, ME)
    const params = execMock.mock.calls[0]![1] as unknown[]
    // Os 4 primeiros são o npub; o 5º é LIMIT
    expect(params.slice(0, 4)).toEqual([ME, ME, ME, ME])
  })
})
