/**
 * transport/policy/pingPongTracker — ping/pong 1:1 tracker (puro).
 *
 * Tests do refactor S2 (Ted/Barney audit 2026-05-08): a util compartilhada
 * extraída de webrtc/health.ts. Cobre só a util isoladamente; cobertura
 * end-to-end (defense-in-depth: stale, future ts) continua em
 * tests/webrtc-threat-T2-pong-association.test.ts via _markPing/_handlePong.
 */

import { describe, expect, it } from 'vitest'
import {
  markPing,
  validatePong,
} from '../src/lib/transport/policy/pingPongTracker'

const OPTS = { capStale: 16, staleMs: 30_000 }

describe('pingPongTracker.markPing', () => {
  it('push em array vazio: array contém o ping', () => {
    const arr: number[] = []
    markPing(arr, 1000, OPTS)
    expect(arr).toEqual([1000])
  })

  it('múltiplos pings em ordem cronológica preservam ordem', () => {
    const arr: number[] = []
    markPing(arr, 100, OPTS)
    markPing(arr, 200, OPTS)
    markPing(arr, 300, OPTS)
    expect(arr).toEqual([100, 200, 300])
  })

  it('prune stale: pings com ts < now - staleMs são removidos no próximo markPing', () => {
    const arr: number[] = []
    markPing(arr, 1000, OPTS)
    markPing(arr, 5000, OPTS)
    // Avança >staleMs além do mais antigo
    markPing(arr, 35_001, OPTS)
    // Cutoff = 35_001 - 30_000 = 5_001 → 1000 e 5000 < cutoff (1000<5001 sim, 5000<5001 sim)
    // Sobrevive só 35_001
    expect(arr).toEqual([35_001])
  })

  it('prune não remove pings exatamente em now - staleMs (cutoff strict <)', () => {
    const arr: number[] = []
    markPing(arr, 5000, OPTS)
    // cutoff = 35_000 - 30_000 = 5000. arr[0]=5000 < 5000 é false → sobrevive.
    markPing(arr, 35_000, OPTS)
    expect(arr).toContain(5000)
    expect(arr).toContain(35_000)
  })

  it('cap defensivo: array nunca cresce além de capStale (mantém os mais novos)', () => {
    const arr: number[] = []
    // 1000 pings num ms cada — todos dentro da janela 30s
    for (let i = 0; i < 1000; i++) {
      markPing(arr, 1000 + i, OPTS)
    }
    expect(arr.length).toBeLessThanOrEqual(OPTS.capStale)
    // Mais novos sobrevivem
    expect(arr).toContain(1999)
  })

  it('determinismo: mesmas chamadas → mesmo array (manifesto §7)', () => {
    const a: number[] = []
    const b: number[] = []
    for (let i = 0; i < 20; i++) {
      markPing(a, 1000 + i * 1000, OPTS)
      markPing(b, 1000 + i * 1000, OPTS)
    }
    expect(a).toEqual(b)
  })
})

describe('pingPongTracker.validatePong', () => {
  it('array vazio: ok=false, rttMs=null', () => {
    const arr: number[] = []
    const result = validatePong(arr, 1000, 2000)
    expect(result).toEqual({ ok: false, rttMs: null })
  })

  it('pingTs presente: ok=true, rttMs=now-pingTs, ping consumido (1:1)', () => {
    const arr: number[] = [100, 200, 300]
    const result = validatePong(arr, 200, 500)
    expect(result.ok).toBe(true)
    expect(result.rttMs).toBe(300)
    expect(arr).toEqual([100, 300])
  })

  it('pingTs ausente: ok=false, array intacto', () => {
    const arr: number[] = [100, 200, 300]
    const result = validatePong(arr, 999, 500)
    expect(result.ok).toBe(false)
    expect(result.rttMs).toBeNull()
    expect(arr).toEqual([100, 200, 300])
  })

  it('replay: segunda validação do mesmo pingTs falha (consumido)', () => {
    const arr: number[] = [100, 200]
    const r1 = validatePong(arr, 100, 200)
    expect(r1.ok).toBe(true)
    const r2 = validatePong(arr, 100, 300)
    expect(r2.ok).toBe(false)
    expect(arr).toEqual([200])
  })

  it('múltiplos pings em flight: pong correto consome só o seu', () => {
    const arr: number[] = [100, 200, 300]
    validatePong(arr, 200, 350)
    expect(arr).toEqual([100, 300])
    validatePong(arr, 100, 400)
    expect(arr).toEqual([300])
  })

  it('rttMs=0 quando pingTs===now (válido — não é caso especial)', () => {
    const arr: number[] = [500]
    const result = validatePong(arr, 500, 500)
    expect(result.ok).toBe(true)
    expect(result.rttMs).toBe(0)
  })

  it('rttMs negativo permitido (caller que decide, util é pura): pingTs > now', () => {
    // Util não filtra timestamps futuros — defense-in-depth fica no caller.
    const arr: number[] = [1000]
    const result = validatePong(arr, 1000, 500)
    expect(result.ok).toBe(true)
    expect(result.rttMs).toBe(-500)
  })

  it('atacante "spray" (validatePong com TS aleatórios): nenhum entra', () => {
    const arr: number[] = [100]
    for (let attackTs = 1; attackTs < 200; attackTs++) {
      if (attackTs === 100) continue
      const r = validatePong(arr, attackTs, 500)
      expect(r.ok).toBe(false)
    }
    expect(arr).toEqual([100])
    // Pong legítimo ainda passa
    expect(validatePong(arr, 100, 500).ok).toBe(true)
  })
})
