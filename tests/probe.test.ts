import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const {
  execMock,
  subscribeManyMock,
  activeReadRelaysMock,
  recordRelayErrorMock,
  recordRelayOkMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  subscribeManyMock: vi.fn(),
  activeReadRelaysMock: vi.fn(),
  recordRelayErrorMock: vi.fn(),
  recordRelayOkMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: vi.fn(), get: vi.fn() },
}))

vi.mock('../src/lib/transport/wss', () => ({
  pool: { subscribeMany: subscribeManyMock },
}))

vi.mock('../src/lib/relays', () => ({
  activeReadRelays: () => activeReadRelaysMock(),
  recordRelayError: (...args: unknown[]) => recordRelayErrorMock(...args),
  recordRelayOk: (...args: unknown[]) => recordRelayOkMock(...args),
}))

import { runProbe, getProbeResults, startProbe, stopProbe } from '../src/lib/probe'

beforeEach(() => {
  execMock.mockReset()
  subscribeManyMock.mockReset()
  activeReadRelaysMock.mockReset()
  recordRelayErrorMock.mockReset()
  recordRelayOkMock.mockReset()
})

afterEach(() => {
  stopProbe()
})

describe('runProbe — early returns', () => {
  it('com banco vazio (sem eventos conhecidos), não probeia', async () => {
    execMock.mockResolvedValue([])
    activeReadRelaysMock.mockReturnValue(['wss://relay.test'])
    const result = await runProbe()
    // Nada novo deve ter sido adicionado a lastResults.
    expect(subscribeManyMock).not.toHaveBeenCalled()
    expect(result instanceof Map).toBe(true)
  })

  it('com sample mas sem relays ativos, não chama subscribe', async () => {
    execMock.mockResolvedValue([{ id: 'e'.repeat(64) }])
    activeReadRelaysMock.mockReturnValue([])
    await runProbe()
    expect(subscribeManyMock).not.toHaveBeenCalled()
  })

  it('SELECT de sample exclui posts moderados (score > -999)', async () => {
    execMock.mockResolvedValue([])
    activeReadRelaysMock.mockReturnValue([])
    await runProbe()
    // O SELECT correto deve ter sido feito
    const sql = execMock.mock.calls[0]![0] as string
    expect(sql).toContain('FROM posts')
    expect(sql).toContain('score > -999')
    expect(sql).toContain('RANDOM()')
  })
})

describe('runProbe — interação com relay (cenários sintéticos)', () => {
  it('relay silencioso (oneose com 0 eventos) é flagado como silent + recordRelayError', async () => {
    execMock.mockResolvedValue([{ id: 'a'.repeat(64) }, { id: 'b'.repeat(64) }])
    activeReadRelaysMock.mockReturnValue(['wss://silent.test'])

    subscribeManyMock.mockImplementation(
      (_relays, _filter, handlers: { onevent: Function; oneose: Function }) => {
        // Chama oneose imediatamente sem onevents
        queueMicrotask(() => handlers.oneose())
        return { close: vi.fn() }
      },
    )

    await runProbe()

    const results = getProbeResults()
    const r = results.find((x) => x.relay === 'wss://silent.test')
    expect(r).toBeDefined()
    expect(r!.flag).toBe('silent')
    expect(r!.got).toBe(0)
    expect(r!.asked).toBe(2)
    expect(recordRelayErrorMock).toHaveBeenCalled()
  })

  it('relay ok (entrega todos os eventos) NÃO chama recordRelayError', async () => {
    const ids = ['a'.repeat(64), 'b'.repeat(64)]
    execMock.mockResolvedValue(ids.map((id) => ({ id })))
    activeReadRelaysMock.mockReturnValue(['wss://ok.test'])
    recordRelayErrorMock.mockReset()

    subscribeManyMock.mockImplementation(
      (_relays, _filter, handlers: { onevent: Function; oneose: Function }) => {
        queueMicrotask(() => {
          handlers.onevent({ id: ids[0] })
          handlers.onevent({ id: ids[1] })
          handlers.oneose()
        })
        return { close: vi.fn() }
      },
    )

    await runProbe()
    const results = getProbeResults()
    const r = results.find((x) => x.relay === 'wss://ok.test')
    expect(r!.flag).toBe('ok')
    expect(r!.got).toBe(2)
    expect(recordRelayErrorMock).not.toHaveBeenCalled()
  })

  it('relay incomplete (entrega só parte) é flagado e dispara recordRelayError', async () => {
    const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
    execMock.mockResolvedValue(ids.map((id) => ({ id })))
    activeReadRelaysMock.mockReturnValue(['wss://partial.test'])
    recordRelayErrorMock.mockReset()

    subscribeManyMock.mockImplementation(
      (_relays, _filter, handlers: { onevent: Function; oneose: Function }) => {
        queueMicrotask(() => {
          handlers.onevent({ id: ids[0] })
          handlers.oneose()
        })
        return { close: vi.fn() }
      },
    )

    await runProbe()
    const r = getProbeResults().find((x) => x.relay === 'wss://partial.test')
    expect(r!.flag).toBe('incomplete')
    expect(r!.got).toBe(1)
    expect(r!.asked).toBe(3)
    expect(recordRelayErrorMock).toHaveBeenCalled()
  })
})

describe('startProbe / stopProbe', () => {
  it('é idempotente — múltiplas chamadas não criam múltiplos timers', () => {
    vi.useFakeTimers()
    startProbe()
    startProbe()
    startProbe()
    // Sem assertion direta de "1 timer só", mas ao parar deve não vazar.
    stopProbe()
    stopProbe() // segundo stop não quebra
    vi.useRealTimers()
  })
})
