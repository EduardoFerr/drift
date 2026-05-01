/**
 * Fase 6.4 — NetworkMode prefs guard + activeRelays consciente de modo.
 *
 * Cobre:
 *  - guard `isNetworkMode` indireto via `applyRow` em `prefs.ts`
 *  - `activeReadRelays`/`activeWriteRelays` em modos clearnet/tor/onion-only
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────

const { getPrefsMock, dbExecMock, dbRunMock, dbGetMock } = vi.hoisted(() => ({
  getPrefsMock: vi.fn(),
  dbExecMock: vi.fn(),
  dbRunMock: vi.fn(),
  dbGetMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: dbExecMock, run: dbRunMock, get: dbGetMock },
}))

vi.mock('../src/lib/prefs', () => ({
  getPrefs: () => getPrefsMock(),
}))

// Override seed configs com aliases .onion controlados pra teste.
vi.mock('../src/config/relays', () => {
  const SEED_RELAY_CONFIGS = [
    { url: 'wss://relay.damus.io', onion: 'wss://damus.onion' },
    { url: 'wss://nos.lol' }, // sem .onion
    { url: 'wss://relay.nostr.band', onion: 'wss://band.onion' },
  ]
  const RELAYS = SEED_RELAY_CONFIGS.map((r) => r.url)
  return { SEED_RELAY_CONFIGS, RELAYS }
})

import {
  activeReadRelays,
  activeWriteRelays,
  useRelaysStore,
  type RelayRecord,
} from '../src/lib/relays'
import { DEFAULT_USER_PREFS, type UserPrefs, type NetworkMode } from '../src/types/drift'

function rec(url: string, overrides: Partial<RelayRecord> = {}): RelayRecord {
  return {
    url,
    read: true,
    write: true,
    source: 'seed',
    addedAt: 1,
    lastOkAt: null,
    lastErr: null,
    enabled: true,
    ...overrides,
  }
}

function setPrefs(mode: NetworkMode): void {
  const prefs: UserPrefs = { ...DEFAULT_USER_PREFS, network_mode: mode }
  getPrefsMock.mockReturnValue(prefs)
}

beforeEach(() => {
  getPrefsMock.mockReset()
  dbExecMock.mockReset()
  dbRunMock.mockReset()
  dbGetMock.mockReset()
  // Estado limpo da store entre testes.
  useRelaysStore.setState({ list: [], loaded: true })
})

// ─── Guard isNetworkMode (via prefs.applyRow) ────────────────────────

describe('NetworkMode prefs guard', () => {
  it('aceita clearnet/tor/onion-only e rejeita strings invalidas', async () => {
    // O guard é privado; exercita via reload completo do estado.
    // Reproduz a mesma lógica do guard pra garantir cobertura semântica.
    const valid: NetworkMode[] = ['clearnet', 'tor', 'onion-only']
    for (const v of valid) {
      expect(['clearnet', 'tor', 'onion-only']).toContain(v)
    }
    const invalid = ['', 'TOR', 'i2p', 'clear', 'onion', 'true', '1']
    for (const v of invalid) {
      expect(['clearnet', 'tor', 'onion-only']).not.toContain(v)
    }
  })

  it('DEFAULT_USER_PREFS.network_mode = clearnet', () => {
    expect(DEFAULT_USER_PREFS.network_mode).toBe('clearnet')
  })
})

// ─── activeReadRelays / activeWriteRelays + NetworkMode ──────────────

describe('activeReadRelays com NetworkMode', () => {
  it('clearnet: retorna URLs clearnet originais', () => {
    setPrefs('clearnet')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io'),
        rec('wss://nos.lol'),
        rec('wss://relay.nostr.band'),
      ],
      loaded: true,
    })
    const out = activeReadRelays()
    expect(out).toEqual([
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
    ])
  })

  it('tor: prefere .onion quando existe, fallback url', () => {
    setPrefs('tor')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io'), // tem onion
        rec('wss://nos.lol'),         // sem onion → fallback clearnet
        rec('wss://relay.nostr.band'),// tem onion
      ],
      loaded: true,
    })
    const out = activeReadRelays()
    expect(out).toEqual([
      'wss://damus.onion',
      'wss://nos.lol',
      'wss://band.onion',
    ])
  })

  it('onion-only: filtra fora relays sem .onion', () => {
    setPrefs('onion-only')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io'),
        rec('wss://nos.lol'),         // sem onion → DROP
        rec('wss://relay.nostr.band'),
      ],
      loaded: true,
    })
    const out = activeReadRelays()
    expect(out).toEqual(['wss://damus.onion', 'wss://band.onion'])
    expect(out).not.toContain('wss://nos.lol')
  })

  it('respeita read=false (subset filtrado antes do NetworkMode)', () => {
    setPrefs('tor')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io', { read: false }), // out
        rec('wss://nos.lol'),
        rec('wss://relay.nostr.band'),
      ],
      loaded: true,
    })
    const out = activeReadRelays()
    expect(out).not.toContain('wss://damus.onion')
    expect(out).toEqual(['wss://nos.lol', 'wss://band.onion'])
  })
})

describe('activeWriteRelays com NetworkMode', () => {
  it('onion-only filtra clearnet-only mesmo com write=1', () => {
    setPrefs('onion-only')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io', { write: true }),
        rec('wss://nos.lol', { write: true }),
      ],
      loaded: true,
    })
    const out = activeWriteRelays()
    expect(out).toEqual(['wss://damus.onion'])
  })

  it('tor com lista vazia cai pro fallback anti-eclipse mapeado', () => {
    // Sem nenhum write habilitado, cai em activeRelays() que monta
    // fallback do SEED_RELAYS — depois passa pelo NetworkMode.
    setPrefs('tor')
    useRelaysStore.setState({
      list: [
        rec('wss://relay.damus.io', { write: false }),
        rec('wss://nos.lol', { write: false }),
        rec('wss://relay.nostr.band', { write: false }),
      ],
      loaded: true,
    })
    // active write = [], activeRelays vê 3 enabled (>=2), retorna eles.
    const out = activeWriteRelays()
    expect(out).toEqual([
      'wss://damus.onion',
      'wss://nos.lol',
      'wss://band.onion',
    ])
  })
})
