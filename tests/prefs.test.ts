import { describe, expect, it, vi, beforeEach } from 'vitest'

const { execMock, runMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  runMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: runMock },
}))

import { usePrefsStore, getPrefs, setPref, loadPrefs } from '../src/lib/prefs'
import { DEFAULT_USER_PREFS } from '../src/types/drift'

function resetStore() {
  usePrefsStore.setState(DEFAULT_USER_PREFS)
}

beforeEach(() => {
  resetStore()
  execMock.mockReset().mockResolvedValue([])
  runMock.mockReset().mockResolvedValue(undefined)
})

// ─── Default values ──────────────────────────────────────────────────

describe('DEFAULT_USER_PREFS', () => {
  it('show_nsfw_default é false', () => {
    expect(DEFAULT_USER_PREFS.show_nsfw_default).toBe(false)
  })

  it('hide_spoilers é true', () => {
    expect(DEFAULT_USER_PREFS.hide_spoilers).toBe(true)
  })

  it('hide_ads é false', () => {
    expect(DEFAULT_USER_PREFS.hide_ads).toBe(false)
  })

  it('location_granularity é "off"', () => {
    expect(DEFAULT_USER_PREFS.location_granularity).toBe('off')
  })

  it('onboarding_done é false', () => {
    expect(DEFAULT_USER_PREFS.onboarding_done).toBe(false)
  })

  it('map_view é "fit-bounds"', () => {
    expect(DEFAULT_USER_PREFS.map_view).toBe('fit-bounds')
  })

  it('network_mode é "clearnet"', () => {
    expect(DEFAULT_USER_PREFS.network_mode).toBe('clearnet')
  })

  it('thread_coach_seen é false', () => {
    expect(DEFAULT_USER_PREFS.thread_coach_seen).toBe(false)
  })

  it('use_ipfs é false', () => {
    expect(DEFAULT_USER_PREFS.use_ipfs).toBe(false)
  })

  it('thread_view_mode é "list"', () => {
    expect(DEFAULT_USER_PREFS.thread_view_mode).toBe('list')
  })

  it('store inicia com defaults', () => {
    expect(getPrefs()).toEqual(DEFAULT_USER_PREFS)
  })
})

// ─── setPref — serialização ──────────────────────────────────────────

describe('setPref', () => {
  it('serializa boolean true como "1"', async () => {
    await setPref('show_nsfw_default', true)

    expect(runMock).toHaveBeenCalledTimes(1)
    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe('show_nsfw_default')
    expect(params[1]).toBe('1')
  })

  it('serializa boolean false como "0"', async () => {
    await setPref('show_nsfw_default', false)

    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe('0')
  })

  it('serializa string diretamente', async () => {
    await setPref('location_granularity', 'city')

    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe('location_granularity')
    expect(params[1]).toBe('city')
  })

  it('persiste via UPSERT (INSERT ON CONFLICT UPDATE)', async () => {
    await setPref('hide_spoilers', false)

    const sql = runMock.mock.calls[0]![0] as string
    expect(sql).toContain('INSERT INTO user_prefs')
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('DO UPDATE')
  })

  it('atualiza a store Zustand sincronamente após persist', async () => {
    expect(getPrefs().show_nsfw_default).toBe(false)
    await setPref('show_nsfw_default', true)
    expect(getPrefs().show_nsfw_default).toBe(true)
  })

  it('atualiza store para cada key booleana', async () => {
    const boolKeys: (keyof typeof DEFAULT_USER_PREFS)[] = [
      'show_nsfw_default',
      'hide_spoilers',
      'hide_ads',
      'onboarding_done',
      'thread_coach_seen',
      'use_ipfs',
    ]
    for (const key of boolKeys) {
      resetStore()
      await setPref(key, true as never)
      expect(getPrefs()[key]).toBe(true)
    }
  })

  it('atualiza store para enums string', async () => {
    await setPref('location_granularity', 'precise')
    expect(getPrefs().location_granularity).toBe('precise')

    await setPref('map_view', 'open')
    expect(getPrefs().map_view).toBe('open')

    await setPref('network_mode', 'tor')
    expect(getPrefs().network_mode).toBe('tor')
  })

  it('atualiza thread_view_mode', async () => {
    await setPref('thread_view_mode', 'cards')
    expect(getPrefs().thread_view_mode).toBe('cards')

    await setPref('thread_view_mode', 'list')
    expect(getPrefs().thread_view_mode).toBe('list')
  })
})

// ─── loadPrefs — população da store ──────────────────────────────────

describe('loadPrefs', () => {
  // loadPrefs é idempotente (flag `loaded` interno). Como o flag é
  // module-private e não há reset externo, testamos o comportamento
  // em módulo fresh via vi.importMock approach — ou testamos que a
  // store é populada corretamente quando chamamos loadPrefs e o
  // módulo ainda não foi "loaded". Para contornar, reimportamos o
  // módulo isolado em cada teste que precisa do load.

  it('popula store a partir de rows do SQLite', async () => {
    // Precisamos de um módulo fresh onde loaded=false
    vi.resetModules()

    // Re-mock db depois do resetModules
    vi.doMock('../src/lib/db', () => ({
      db: {
        exec: vi.fn().mockResolvedValue([
          { key: 'show_nsfw_default', value: '1' },
          { key: 'hide_spoilers', value: '0' },
          { key: 'location_granularity', value: 'city' },
          { key: 'map_view', value: 'open' },
          { key: 'network_mode', value: 'tor' },
          { key: 'onboarding_done', value: '1' },
          { key: 'thread_coach_seen', value: '1' },
          { key: 'use_ipfs', value: '1' },
          { key: 'thread_view_mode', value: 'cards' },
        ]),
        run: vi.fn(),
      },
    }))

    const mod = await import('../src/lib/prefs')
    await mod.loadPrefs()

    const state = mod.usePrefsStore.getState()
    expect(state.show_nsfw_default).toBe(true)
    expect(state.hide_spoilers).toBe(false)
    expect(state.location_granularity).toBe('city')
    expect(state.map_view).toBe('open')
    expect(state.network_mode).toBe('tor')
    expect(state.onboarding_done).toBe(true)
    expect(state.thread_coach_seen).toBe(true)
    expect(state.use_ipfs).toBe(true)
    expect(state.thread_view_mode).toBe('cards')
  })

  it('é idempotente — segunda chamada é no-op', async () => {
    vi.resetModules()

    const localExec = vi.fn().mockResolvedValue([
      { key: 'show_nsfw_default', value: '1' },
    ])
    vi.doMock('../src/lib/db', () => ({
      db: { exec: localExec, run: vi.fn() },
    }))

    const mod = await import('../src/lib/prefs')
    await mod.loadPrefs()
    expect(localExec).toHaveBeenCalledTimes(1)

    // Segunda chamada não faz query
    await mod.loadPrefs()
    expect(localExec).toHaveBeenCalledTimes(1)
  })

  it('banco vazio resulta em defaults', async () => {
    vi.resetModules()

    vi.doMock('../src/lib/db', () => ({
      db: { exec: vi.fn().mockResolvedValue([]), run: vi.fn() },
    }))

    const mod = await import('../src/lib/prefs')
    await mod.loadPrefs()

    const { DEFAULT_USER_PREFS: defaults } = await import('../src/types/drift')
    expect(mod.usePrefsStore.getState()).toEqual(defaults)
  })
})

// ─── applyRow — validação por key ────────────────────────────────────

describe('applyRow (via loadPrefs)', () => {
  // applyRow é private, então testamos indiretamente via loadPrefs

  async function loadWith(rows: Array<{ key: string; value: string }>) {
    vi.resetModules()
    vi.doMock('../src/lib/db', () => ({
      db: { exec: vi.fn().mockResolvedValue(rows), run: vi.fn() },
    }))
    const mod = await import('../src/lib/prefs')
    await mod.loadPrefs()
    return mod.usePrefsStore.getState()
  }

  it('boolean "1" → true', async () => {
    const state = await loadWith([{ key: 'show_nsfw_default', value: '1' }])
    expect(state.show_nsfw_default).toBe(true)
  })

  it('boolean "0" → false', async () => {
    const state = await loadWith([{ key: 'hide_spoilers', value: '0' }])
    expect(state.hide_spoilers).toBe(false)
  })

  it('boolean qualquer valor != "1" → false', async () => {
    const state = await loadWith([{ key: 'show_nsfw_default', value: 'yes' }])
    expect(state.show_nsfw_default).toBe(false)
  })

  it('location_granularity aceita valores válidos', async () => {
    for (const v of ['off', 'country', 'city', 'precise'] as const) {
      const state = await loadWith([{ key: 'location_granularity', value: v }])
      expect(state.location_granularity).toBe(v)
    }
  })

  it('location_granularity rejeita valor inválido — mantém default', async () => {
    const state = await loadWith([
      { key: 'location_granularity', value: 'galaxy' },
    ])
    expect(state.location_granularity).toBe(DEFAULT_USER_PREFS.location_granularity)
  })

  it('map_view aceita valores válidos', async () => {
    for (const v of ['fit-bounds', 'open'] as const) {
      const state = await loadWith([{ key: 'map_view', value: v }])
      expect(state.map_view).toBe(v)
    }
  })

  it('map_view rejeita valor inválido — mantém default', async () => {
    const state = await loadWith([{ key: 'map_view', value: 'closed' }])
    expect(state.map_view).toBe(DEFAULT_USER_PREFS.map_view)
  })

  it('network_mode aceita valores válidos', async () => {
    for (const v of ['clearnet', 'tor', 'onion-only'] as const) {
      const state = await loadWith([{ key: 'network_mode', value: v }])
      expect(state.network_mode).toBe(v)
    }
  })

  it('network_mode rejeita valor inválido — mantém default', async () => {
    const state = await loadWith([{ key: 'network_mode', value: 'i2p' }])
    expect(state.network_mode).toBe(DEFAULT_USER_PREFS.network_mode)
  })

  it('thread_view_mode aceita "list"', async () => {
    const state = await loadWith([{ key: 'thread_view_mode', value: 'list' }])
    expect(state.thread_view_mode).toBe('list')
  })

  it('thread_view_mode aceita "cards"', async () => {
    const state = await loadWith([{ key: 'thread_view_mode', value: 'cards' }])
    expect(state.thread_view_mode).toBe('cards')
  })

  it('thread_view_mode rejeita valor inválido — mantém default', async () => {
    const state = await loadWith([{ key: 'thread_view_mode', value: 'grid' }])
    expect(state.thread_view_mode).toBe(DEFAULT_USER_PREFS.thread_view_mode)
  })

  it('chave desconhecida é ignorada silenciosamente', async () => {
    const state = await loadWith([
      { key: 'future_setting_v99', value: 'foo' },
      { key: 'show_nsfw_default', value: '1' },
    ])
    expect(state.show_nsfw_default).toBe(true)
    // Chave desconhecida não aparece no estado
    expect((state as Record<string, unknown>)['future_setting_v99']).toBeUndefined()
  })

  it('múltiplas chaves desconhecidas não afetam outras prefs', async () => {
    const state = await loadWith([
      { key: 'unknown1', value: '1' },
      { key: 'unknown2', value: 'bar' },
      { key: 'hide_ads', value: '1' },
    ])
    expect(state.hide_ads).toBe(true)
    expect(state).toEqual({ ...DEFAULT_USER_PREFS, hide_ads: true })
  })

  it('todas as keys booleanas são processadas corretamente', async () => {
    const boolKeys = [
      'show_nsfw_default',
      'hide_spoilers',
      'hide_ads',
      'onboarding_done',
      'thread_coach_seen',
      'use_ipfs',
    ]
    const rows = boolKeys.map((key) => ({ key, value: '1' }))
    const state = await loadWith(rows)
    for (const key of boolKeys) {
      expect((state as Record<string, unknown>)[key]).toBe(true)
    }
  })
})

// ─── getPrefs — acesso síncrono ──────────────────────────────────────

describe('getPrefs', () => {
  it('retorna snapshot síncrono da store', () => {
    const state = getPrefs()
    expect(state).toEqual(DEFAULT_USER_PREFS)
  })

  it('reflete mutações via setPref', async () => {
    await setPref('hide_ads', true)
    expect(getPrefs().hide_ads).toBe(true)
  })
})
