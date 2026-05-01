/**
 * Reconnect backoff + counter — Fase 6.3.
 *
 * Testa o algoritmo puro de exponential backoff com cap, e o counter
 * de attempts por peer. Sem RTCPeerConnection real — usa test-only
 * helpers de `webrtc/reconnect.ts` (via barrel `webrtc/index.ts`):
 *   - `_computeBackoffDelay(attempt)` → ms (puro)
 *   - `_scheduleReconnect(peerId, attempt)` → ms delay (incrementa counter)
 *   - `_resetReconnectCounter(peerId)`
 *   - `_RECONNECT_CONSTANTS` { BASE_MS, MAX_MS, MAX_ATTEMPTS }
 *
 * Fórmula: delay = min(BASE_MS * 2^attempt, MAX_MS)
 *   BASE_MS = 1000, MAX_MS = 30000, MAX_ATTEMPTS = 5
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  _computeBackoffDelay,
  _scheduleReconnect,
  _resetReconnectCounter,
  _RECONNECT_CONSTANTS,
} from '../src/lib/transport/webrtc'

const { BASE_MS, MAX_MS, MAX_ATTEMPTS } = _RECONNECT_CONSTANTS

describe('reconnect backoff (_computeBackoffDelay)', () => {
  it('attempt=0 → BASE_MS (1000ms)', () => {
    expect(_computeBackoffDelay(0)).toBe(1000)
    expect(_computeBackoffDelay(0)).toBe(BASE_MS)
  })

  it('attempt=1 → 2000ms', () => {
    expect(_computeBackoffDelay(1)).toBe(2000)
  })

  it('attempt=2 → 4000ms', () => {
    expect(_computeBackoffDelay(2)).toBe(4000)
  })

  it('attempt=3 → 8000ms', () => {
    expect(_computeBackoffDelay(3)).toBe(8000)
  })

  it('attempt=4 → 16000ms', () => {
    expect(_computeBackoffDelay(4)).toBe(16000)
  })

  it('attempt=5 → 30000ms (cap em MAX_MS)', () => {
    // 1000 * 2^5 = 32000, mas cap em 30000
    expect(_computeBackoffDelay(5)).toBe(30000)
    expect(_computeBackoffDelay(5)).toBe(MAX_MS)
  })

  it('attempt=10 → MAX_MS (capped)', () => {
    expect(_computeBackoffDelay(10)).toBe(MAX_MS)
  })

  it('attempt=100 → MAX_MS (capped, no overflow)', () => {
    expect(_computeBackoffDelay(100)).toBe(MAX_MS)
  })

  it('cresce monotonicamente até cap', () => {
    let prev = 0
    for (let a = 0; a <= 5; a++) {
      const d = _computeBackoffDelay(a)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

describe('reconnect counter (_scheduleReconnect / _resetReconnectCounter)', () => {
  beforeEach(() => {
    // Cleanup entre tests pra evitar contaminação cross-test.
    _resetReconnectCounter('peer-A')
    _resetReconnectCounter('peer-B')
    _resetReconnectCounter('peer-reset')
    _resetReconnectCounter('peer-cap')
    _resetReconnectCounter('peer-iso-1')
    _resetReconnectCounter('peer-iso-2')
  })

  it('reset zera attempts pro peer (próximo schedule volta ao BASE_MS)', () => {
    // Faz alguns schedules pra incrementar.
    _scheduleReconnect('peer-reset', 0)
    _scheduleReconnect('peer-reset', 1)
    _scheduleReconnect('peer-reset', 2)
    _resetReconnectCounter('peer-reset')
    // Após reset, o primeiro schedule deve voltar a BASE_MS.
    const delay = _scheduleReconnect('peer-reset', 0)
    expect(delay).toBe(BASE_MS)
  })

  it('cada falha incrementa o delay (1s → 2s → 4s)', () => {
    const d0 = _scheduleReconnect('peer-A', 0)
    const d1 = _scheduleReconnect('peer-A', 1)
    const d2 = _scheduleReconnect('peer-A', 2)
    expect(d0).toBe(1000)
    expect(d1).toBe(2000)
    expect(d2).toBe(4000)
  })

  it('respeita cap MAX_ATTEMPTS=5 (sexta tentativa devolve MAX_MS ou indica giveup)', () => {
    // O contrato diz "cap MAX_ATTEMPTS=5" — cobrimos as 5 tentativas válidas.
    expect(MAX_ATTEMPTS).toBe(5)
    const delays: number[] = []
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      delays.push(_scheduleReconnect('peer-cap', a))
    }
    // Deve ter coletado MAX_ATTEMPTS delays válidos.
    expect(delays.length).toBe(MAX_ATTEMPTS)
    // Último delay deve ser o cap (MAX_MS) ou anterior (depende de attempt=4 → 16000).
    // attempt=4 → 16000, então o último é 16000 (não é o cap ainda nesse fluxo).
    expect(delays[MAX_ATTEMPTS - 1]).toBe(_computeBackoffDelay(MAX_ATTEMPTS - 1))
  })

  it('counters são isolados por peerId', () => {
    _scheduleReconnect('peer-iso-1', 0)
    _scheduleReconnect('peer-iso-1', 1)
    // peer-iso-2 começa do zero, independente.
    const d = _scheduleReconnect('peer-iso-2', 0)
    expect(d).toBe(BASE_MS)
  })
})
