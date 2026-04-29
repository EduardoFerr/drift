import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock do db ANTES de importar moderation-local.
const { execMock, runMock, getMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  runMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: {
    exec: execMock,
    run: runMock,
    get: getMock,
  },
}))

import {
  block,
  unblock,
  mute,
  unmute,
  isHidden,
  hiddenReason,
  listBlocked,
  listMuted,
  loadModLocal,
  useModLocalStore,
} from '../src/lib/moderation-local'

function resetStore() {
  useModLocalStore.setState({
    blocked: new Set<string>(),
    muted: new Set<string>(),
    loaded: false,
  })
}

describe('moderation-local: store + checks síncronos', () => {
  beforeEach(() => {
    resetStore()
    execMock.mockReset()
    runMock.mockReset()
  })

  it('isHidden retorna false quando store vazio', () => {
    expect(isHidden('npub-foo')).toBe(false)
  })

  it('isHidden retorna true pra npub bloqueado ou mutado', () => {
    useModLocalStore.setState({
      blocked: new Set(['npub-blocked']),
      muted: new Set(['npub-muted']),
      loaded: true,
    })
    expect(isHidden('npub-blocked')).toBe(true)
    expect(isHidden('npub-muted')).toBe(true)
    expect(isHidden('npub-other')).toBe(false)
  })

  it('hiddenReason distingue blocked/muted/null', () => {
    useModLocalStore.setState({
      blocked: new Set(['npub-b']),
      muted: new Set(['npub-m']),
      loaded: true,
    })
    expect(hiddenReason('npub-b')).toBe('blocked')
    expect(hiddenReason('npub-m')).toBe('muted')
    expect(hiddenReason('npub-other')).toBe(null)
  })

  it("hiddenReason prioriza 'blocked' quando npub está em ambos", () => {
    // Invariante: bloqueio é estado mais forte que silenciar.
    useModLocalStore.setState({
      blocked: new Set(['npub-x']),
      muted: new Set(['npub-x']),
      loaded: true,
    })
    expect(hiddenReason('npub-x')).toBe('blocked')
  })
})

describe('moderation-local: persistência via db', () => {
  beforeEach(() => {
    resetStore()
    execMock.mockReset()
    runMock.mockReset()
    // refresh() vai SEMPRE chamar SELECT em blocked + muted; default vazio
    execMock.mockResolvedValue([])
  })

  it('block insere INSERT...ON CONFLICT com timestamp e reason', async () => {
    runMock.mockResolvedValue(undefined)
    const before = Date.now()
    await block('npub-aaa', 'spam')
    const call = runMock.mock.calls[0]!
    expect(call[0]).toContain('INSERT INTO blocked')
    expect(call[0]).toContain('ON CONFLICT')
    const params = call[1] as unknown[]
    expect(params[0]).toBe('npub-aaa')
    expect(typeof params[1]).toBe('number')
    expect(params[1] as number).toBeGreaterThanOrEqual(before)
    expect(params[2]).toBe('spam')
  })

  it('block sem reason passa null em vez de undefined', async () => {
    runMock.mockResolvedValue(undefined)
    await block('npub-bbb')
    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[2]).toBe(null)
  })

  it('unblock executa DELETE pelo npub', async () => {
    runMock.mockResolvedValue(undefined)
    await unblock('npub-aaa')
    expect(runMock.mock.calls[0]![0]).toContain('DELETE FROM blocked')
    expect(runMock.mock.calls[0]![1]).toEqual(['npub-aaa'])
  })

  it('mute / unmute usam tabela muted (não blocked)', async () => {
    runMock.mockResolvedValue(undefined)
    await mute('npub-mmm')
    expect(runMock.mock.calls[0]![0]).toContain('INTO muted')
    runMock.mockReset()
    runMock.mockResolvedValue(undefined)
    await unmute('npub-mmm')
    expect(runMock.mock.calls[0]![0]).toContain('DELETE FROM muted')
  })

  it('loadModLocal popula store via SELECT em blocked e muted', async () => {
    execMock.mockImplementation(async (sql: string) => {
      if (sql.includes('blocked')) return [{ npub: 'npub-1' }, { npub: 'npub-2' }]
      if (sql.includes('muted')) return [{ npub: 'npub-3' }]
      return []
    })
    await loadModLocal()
    const s = useModLocalStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.blocked).toEqual(new Set(['npub-1', 'npub-2']))
    expect(s.muted).toEqual(new Set(['npub-3']))
  })

  it('listBlocked retorna entries ordenadas DESC e mapeia reason null', async () => {
    execMock.mockResolvedValueOnce([
      { npub: 'npub-1', blocked_at: 2000, reason: 'spam' },
      { npub: 'npub-2', blocked_at: 1000, reason: null },
    ])
    const list = await listBlocked()
    expect(list).toEqual([
      { npub: 'npub-1', at: 2000, reason: 'spam' },
      { npub: 'npub-2', at: 1000, reason: null },
    ])
  })

  it('listMuted força reason=null (mute não tem motivo)', async () => {
    execMock.mockResolvedValueOnce([
      { npub: 'npub-1', muted_at: 555 },
    ])
    const list = await listMuted()
    expect(list).toEqual([{ npub: 'npub-1', at: 555, reason: null }])
  })
})
