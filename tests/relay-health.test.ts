/**
 * Tests para `relay-health.ts` — funções puras.
 *
 * Cobrem:
 *  - threshold de demotion (N=3)
 *  - backoff exponencial com cap (15→30→60min)
 *  - filterDemoted preserva ≥1 relay (anti-eclipse §20)
 *  - filterDemoted considera urls unknown como online
 *  - applySuccess reset fails e demote
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEMOTE_THRESHOLD,
  DEMOTE_BASE_MS,
  DEMOTE_CAP_MS,
  backoffMs,
  applySuccess,
  applyFailure,
  isDemoted,
  statusOf,
  filterDemoted,
  hydrateHealth,
  getHealth,
  noteSuccess,
  noteFailure,
  _resetHealthForTests,
  type RelayHealth,
} from '../src/lib/relay-health'

function blank(url: string): RelayHealth {
  return {
    url,
    consecutiveFails: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    demotedUntil: 0,
  }
}

const T0 = 1_700_000_000_000

beforeEach(() => {
  _resetHealthForTests()
})

describe('backoffMs', () => {
  it('retorna 0 abaixo do threshold', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1)).toBe(0)
    expect(backoffMs(DEMOTE_THRESHOLD - 1)).toBe(0)
  })

  it('threshold exato → base (15min)', () => {
    expect(backoffMs(DEMOTE_THRESHOLD)).toBe(DEMOTE_BASE_MS)
  })

  it('dobra a cada falha extra até o cap', () => {
    expect(backoffMs(DEMOTE_THRESHOLD + 1)).toBe(DEMOTE_BASE_MS * 2)
    expect(backoffMs(DEMOTE_THRESHOLD + 2)).toBe(DEMOTE_CAP_MS) // 60min cap
    expect(backoffMs(DEMOTE_THRESHOLD + 5)).toBe(DEMOTE_CAP_MS) // ainda cap
    expect(backoffMs(100)).toBe(DEMOTE_CAP_MS)
  })
})

describe('applyFailure', () => {
  it('incrementa fails sem demotar abaixo do threshold', () => {
    let s = blank('wss://a')
    s = applyFailure(s, T0)
    expect(s.consecutiveFails).toBe(1)
    expect(s.demotedUntil).toBe(0)
    s = applyFailure(s, T0 + 1000)
    expect(s.consecutiveFails).toBe(2)
    expect(s.demotedUntil).toBe(0)
  })

  it('na N-ésima falha (threshold) demota com backoff base', () => {
    let s = blank('wss://a')
    for (let i = 0; i < DEMOTE_THRESHOLD; i++) {
      s = applyFailure(s, T0)
    }
    expect(s.consecutiveFails).toBe(DEMOTE_THRESHOLD)
    expect(s.demotedUntil).toBe(T0 + DEMOTE_BASE_MS)
  })

  it('falhas extras estendem demote com backoff exponencial', () => {
    let s = blank('wss://a')
    for (let i = 0; i < DEMOTE_THRESHOLD; i++) s = applyFailure(s, T0)
    const firstDemote = s.demotedUntil
    s = applyFailure(s, T0 + 100)
    expect(s.demotedUntil).toBeGreaterThan(firstDemote)
    expect(s.demotedUntil).toBe(T0 + 100 + DEMOTE_BASE_MS * 2)
  })

  it('respeita cap de 1h', () => {
    let s = blank('wss://a')
    for (let i = 0; i < 20; i++) s = applyFailure(s, T0)
    expect(s.demotedUntil - T0).toBeLessThanOrEqual(DEMOTE_CAP_MS)
  })
})

describe('applySuccess', () => {
  it('reseta fails e demote', () => {
    let s = blank('wss://a')
    for (let i = 0; i < DEMOTE_THRESHOLD + 2; i++) s = applyFailure(s, T0)
    expect(isDemoted(s, T0 + 100)).toBe(true)

    s = applySuccess(s, T0 + 200)
    expect(s.consecutiveFails).toBe(0)
    expect(s.demotedUntil).toBe(0)
    expect(s.lastSuccessAt).toBe(T0 + 200)
    expect(isDemoted(s, T0 + 200)).toBe(false)
  })
})

describe('isDemoted / statusOf', () => {
  it('unknown quando nunca teve sucesso e não demoted', () => {
    expect(statusOf(blank('w'), T0)).toBe('unknown')
  })

  it('online após sucesso', () => {
    const s = applySuccess(blank('w'), T0)
    expect(statusOf(s, T0 + 1000)).toBe('online')
  })

  it('demoted enquanto dentro da janela', () => {
    let s = blank('w')
    for (let i = 0; i < DEMOTE_THRESHOLD; i++) s = applyFailure(s, T0)
    expect(statusOf(s, T0 + 1000)).toBe('demoted')
    expect(statusOf(s, T0 + DEMOTE_BASE_MS + 1)).not.toBe('demoted')
  })
})

describe('filterDemoted — anti-eclipse', () => {
  function makeDemoted(url: string, until: number): RelayHealth {
    return {
      ...blank(url),
      consecutiveFails: DEMOTE_THRESHOLD,
      demotedUntil: until,
    }
  }

  it('remove demoted quando há ativos disponíveis', () => {
    const map = new Map<string, RelayHealth>([
      ['wss://a', makeDemoted('wss://a', T0 + 1000)],
      ['wss://b', applySuccess(blank('wss://b'), T0)],
    ])
    const out = filterDemoted(['wss://a', 'wss://b'], (u) => map.get(u) ?? null, T0)
    expect(out).toEqual(['wss://b'])
  })

  it('trata urls unknown (sem state) como online', () => {
    const out = filterDemoted(
      ['wss://novo'],
      () => null,
      T0,
    )
    expect(out).toEqual(['wss://novo'])
  })

  it('quando TODOS demoted, preserva 1 (o que vai re-tentar mais cedo)', () => {
    const map = new Map<string, RelayHealth>([
      ['wss://a', makeDemoted('wss://a', T0 + 5000)],
      ['wss://b', makeDemoted('wss://b', T0 + 1000)], // re-tenta mais cedo
      ['wss://c', makeDemoted('wss://c', T0 + 3000)],
    ])
    const out = filterDemoted(
      ['wss://a', 'wss://b', 'wss://c'],
      (u) => map.get(u) ?? null,
      T0,
    )
    expect(out).toEqual(['wss://b'])
  })

  it('input vazio retorna vazio', () => {
    expect(filterDemoted([], () => null, T0)).toEqual([])
  })

  it('relays cujo demotedUntil já passou são tratados como online', () => {
    const map = new Map<string, RelayHealth>([
      ['wss://expired', makeDemoted('wss://expired', T0 - 1000)],
    ])
    const out = filterDemoted(['wss://expired'], (u) => map.get(u) ?? null, T0)
    expect(out).toEqual(['wss://expired'])
  })
})

describe('store in-memory (noteSuccess / noteFailure / hydrateHealth)', () => {
  it('noteFailure persiste state e dobra ao cruzar threshold', () => {
    let s = noteFailure('wss://x', T0)
    expect(s.consecutiveFails).toBe(1)
    s = noteFailure('wss://x', T0 + 100)
    s = noteFailure('wss://x', T0 + 200)
    expect(s.demotedUntil).toBe(T0 + 200 + DEMOTE_BASE_MS)
    expect(getHealth('wss://x')!.consecutiveFails).toBe(3)
  })

  it('noteSuccess limpa demote', () => {
    for (let i = 0; i < DEMOTE_THRESHOLD; i++) noteFailure('wss://x', T0)
    expect(getHealth('wss://x')!.demotedUntil).toBeGreaterThan(0)
    noteSuccess('wss://x', T0 + 1000)
    expect(getHealth('wss://x')!.demotedUntil).toBe(0)
    expect(getHealth('wss://x')!.consecutiveFails).toBe(0)
  })

  it('hydrateHealth substitui state e converte nulls', () => {
    noteFailure('wss://old', T0) // state stale
    hydrateHealth([
      {
        url: 'wss://new',
        consecutive_fails: 2,
        demoted_until: T0 + 9999,
        last_ok_at: null,
        last_err_at: T0,
      },
    ])
    expect(getHealth('wss://old')).toBeNull()
    const h = getHealth('wss://new')!
    expect(h.consecutiveFails).toBe(2)
    expect(h.demotedUntil).toBe(T0 + 9999)
  })

  it('hydrateHealth lida com colunas null como zero (back-compat)', () => {
    hydrateHealth([
      {
        url: 'wss://legacy',
        consecutive_fails: null,
        demoted_until: null,
        last_ok_at: null,
        last_err_at: null,
      },
    ])
    const h = getHealth('wss://legacy')!
    expect(h.consecutiveFails).toBe(0)
    expect(h.demotedUntil).toBe(0)
  })
})
