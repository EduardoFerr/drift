/**
 * Helia idle timeout — auto-dispose após N min sem chamada.
 *
 * Contexto (Robin/Lily fix 2026-05-08): libp2p autodial mantinha WS
 * connections abertas indefinidamente, gerando ~1033 reqs/3min no boot.
 * Idle watcher dispara `disposeHelia()` quando o singleton fica
 * `IDLE_TIMEOUT_MS` sem ser tocado.
 *
 * Não rodamos Helia real em Node (libp2p depende de runtime browser).
 * Mockamos `helia` + adapters; verificamos a coreografia: touch ↔
 * watcher ↔ dispose.
 *
 * Cobertura:
 *  - touch atualiza lastAccessAt em cada call
 *  - getHelia inicia watcher (idempotente — múltiplas chamadas, 1 watcher)
 *  - depois de IDLE_TIMEOUT_MS sem touch, dispose dispara automaticamente
 *  - chamada após dispose re-inicializa (lazy)
 *  - dispose manual cancela o watcher (sem leak)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dynamic imports do Helia ecosystem. Cada fábrica retorna stubs
// mínimos que `initHelia` consome (createHelia, unixfs, blockstores).
const stopMock = vi.fn(async () => {})
const heliaNode = {
  stop: stopMock,
  pins: { ls: async function* () {} },
  libp2p: { getPeers: () => [], status: 'started' as const },
}

vi.mock('helia', () => ({
  createHelia: vi.fn(async () => heliaNode),
}))
vi.mock('@helia/unixfs', () => ({
  unixfs: vi.fn(() => ({ addBytes: vi.fn(), cat: vi.fn() })),
}))
vi.mock('blockstore-idb', () => ({
  IDBBlockstore: class {
    open = vi.fn(async () => {})
  },
}))
vi.mock('datastore-idb', () => ({
  IDBDatastore: class {
    open = vi.fn(async () => {})
  },
}))

// ───────────────────────────────────────────────────────────────────

describe('helia idle timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stopMock.mockClear()
  })

  afterEach(async () => {
    vi.useRealTimers()
    // Importa fresh + dispose final pra não vazar singleton entre tests.
    const helia = await import('../src/lib/helia')
    await helia.disposeHelia()
    vi.resetModules()
  })

  it('exporta IDLE_TIMEOUT_MS = 5min (default acordado com Robin)', async () => {
    const helia = await import('../src/lib/helia')
    expect(helia.IDLE_TIMEOUT_MS).toBe(5 * 60_000)
  })

  it('init dispara dispose automático após IDLE_TIMEOUT_MS sem touch', async () => {
    vi.resetModules()
    const helia = await import('../src/lib/helia')

    // Ativa o singleton — touch + start watcher.
    await helia.getHelia()
    expect(stopMock).not.toHaveBeenCalled()

    // Avança o relógio além do timeout sem novas chamadas.
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS + 60_000 + 100)

    // Watcher deve ter chamado disposeHelia → node.stop().
    expect(stopMock).toHaveBeenCalledTimes(1)
  })

  it('chamadas frequentes adiam o dispose (touch reseta o relógio)', async () => {
    vi.resetModules()
    const helia = await import('../src/lib/helia')

    await helia.getHelia()
    // Avança quase até o limite, depois toca antes de expirar.
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS - 30_000)
    await helia.getHelia() // touch — adia
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS - 30_000)
    expect(stopMock).not.toHaveBeenCalled()

    // Agora deixa idle suficiente pra disparar.
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS + 60_000 + 100)
    expect(stopMock).toHaveBeenCalledTimes(1)
  })

  it('chamada após auto-dispose re-inicializa (lazy resurrection)', async () => {
    vi.resetModules()
    const helia = await import('../src/lib/helia')

    await helia.getHelia()
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS + 60_000 + 100)
    expect(stopMock).toHaveBeenCalledTimes(1)

    // Próxima chamada deve re-inicializar limpamente — sem throw.
    await expect(helia.getHelia()).resolves.toBeDefined()
  })

  it('dispose manual encerra watcher (sem timer leak)', async () => {
    vi.resetModules()
    const helia = await import('../src/lib/helia')

    await helia.getHelia()
    await helia.disposeHelia()
    expect(stopMock).toHaveBeenCalledTimes(1)

    // Avança bastante; nenhum dispose extra deve ocorrer (watcher parou).
    await vi.advanceTimersByTimeAsync(helia.IDLE_TIMEOUT_MS * 3)
    expect(stopMock).toHaveBeenCalledTimes(1)
  })
})
