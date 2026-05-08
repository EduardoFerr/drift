/**
 * transport/policy/violationWindow — sliding-window tracker (puro).
 *
 * Tests do refactor S2 (Ted/Barney audit 2026-05-08): a util compartilhada
 * extraída de webrtc/peer.ts (cross-proto) e webrtc/rateLimit.ts (rate).
 * Comportamento observável idêntico aos call sites originais — esses
 * tests cobrem só a util isoladamente. Cobertura end-to-end dos
 * comportamentos integrados continua em webrtc-threat-T1 e webrtc-ratelimit.
 */

import { describe, expect, it } from 'vitest'
import {
  recordViolation,
  type ViolationWindowConfig,
} from '../src/lib/transport/policy/violationWindow'

const CFG: ViolationWindowConfig = {
  windowMs: 10_000,
  cap: 16,
  threshold: 5,
}

describe('violationWindow.recordViolation', () => {
  it('push em array vazio: count=1, tripped=false (threshold=5)', () => {
    const arr: number[] = []
    const result = recordViolation(arr, 1000, CFG)
    expect(result.count).toBe(1)
    expect(result.tripped).toBe(false)
    expect(arr).toEqual([1000])
  })

  it('threshold atingido exatamente: tripped=true', () => {
    const arr: number[] = []
    let result
    for (let i = 0; i < 5; i++) {
      result = recordViolation(arr, 1000 + i, CFG)
    }
    expect(result!.count).toBe(5)
    expect(result!.tripped).toBe(true)
  })

  it('threshold-1 violações: tripped=false', () => {
    const arr: number[] = []
    let result
    for (let i = 0; i < 4; i++) {
      result = recordViolation(arr, 1000 + i, CFG)
    }
    expect(result!.count).toBe(4)
    expect(result!.tripped).toBe(false)
  })

  it('prune: violações fora da janela são removidas no próximo push', () => {
    const arr: number[] = []
    // 4 violações em t=0..3
    for (let i = 0; i < 4; i++) {
      recordViolation(arr, i, CFG)
    }
    expect(arr.length).toBe(4)
    // Avança além da janela; novo push deve prunar todas as antigas
    const result = recordViolation(arr, 100_000, CFG)
    expect(result.count).toBe(1)
    expect(result.tripped).toBe(false)
    expect(arr).toEqual([100_000])
  })

  it('janela deslizante: prune parcial mantém apenas as recentes', () => {
    const arr: number[] = []
    // 3 antigas (fora da janela quando o novo timestamp chegar)
    recordViolation(arr, 1000, CFG)
    recordViolation(arr, 2000, CFG)
    recordViolation(arr, 3000, CFG)
    // 2 recentes
    recordViolation(arr, 15_000, CFG)
    const result = recordViolation(arr, 16_000, CFG)
    // Cutoff = 16_000 - 10_000 = 6_000 → 1000/2000/3000 pruned, 15_000+16_000 sobrevivem
    expect(result.count).toBe(2)
    expect(arr).toEqual([15_000, 16_000])
  })

  it('cap defensivo: array nunca cresce além de cfg.cap (mantém os mais novos)', () => {
    const arr: number[] = []
    // 50 timestamps em rajada (todos dentro da janela)
    for (let i = 0; i < 50; i++) {
      recordViolation(arr, 1000 + i, CFG)
    }
    expect(arr.length).toBeLessThanOrEqual(CFG.cap)
    // Os mais novos sobrevivem
    expect(arr).toContain(1049)
  })

  it('cap aplicado ANTES do prune: cap reduz array, prune então olha o front', () => {
    // Garante que a ordem cap → prune mantém compat com call sites originais.
    // Cenário: muitas violações antigas + cap kicks in, depois prune por cutoff.
    const cfg: ViolationWindowConfig = { windowMs: 100, cap: 3, threshold: 2 }
    const arr: number[] = []
    // 5 pushes seguidos dentro da janela
    recordViolation(arr, 1000, cfg)
    recordViolation(arr, 1010, cfg)
    recordViolation(arr, 1020, cfg)
    recordViolation(arr, 1030, cfg)
    const result = recordViolation(arr, 1040, cfg)
    // Cap=3, mais novos: [1020, 1030, 1040]
    expect(arr).toEqual([1020, 1030, 1040])
    expect(result.count).toBe(3)
    expect(result.tripped).toBe(true)
  })

  it('now no passado em relação às violações existentes: cutoff agressivo prune tudo exceto novo', () => {
    // Edge case: caller passa `now` regrida (clock skew, time travel em test).
    const arr: number[] = [10_000, 11_000, 12_000]
    const result = recordViolation(arr, 5000, CFG)
    // cutoff = 5000 - 10_000 = -5000. Nenhum elemento é < -5000.
    // Push de 5000 vai pra trás, mas após prune os antigos sobrevivem.
    // Detalhe: push é unshift? Não — push é no fim. Order = [10_000, 11_000, 12_000, 5000].
    // Prune do front: 10_000 < -5000? Não. Nada é pruned.
    expect(result.count).toBe(4)
    expect(arr).toEqual([10_000, 11_000, 12_000, 5000])
  })

  it('mesma chamada com mesmos inputs é determinística (manifesto §7)', () => {
    const arr1: number[] = []
    const arr2: number[] = []
    for (let i = 0; i < 10; i++) {
      recordViolation(arr1, 1000 + i * 100, CFG)
      recordViolation(arr2, 1000 + i * 100, CFG)
    }
    expect(arr1).toEqual(arr2)
  })

  it('threshold=1: primeira violação já dispara', () => {
    const cfg: ViolationWindowConfig = { ...CFG, threshold: 1 }
    const arr: number[] = []
    const result = recordViolation(arr, 1000, cfg)
    expect(result.tripped).toBe(true)
  })

  it('cap=1: array sempre tem no máximo 1 elemento', () => {
    const cfg: ViolationWindowConfig = { windowMs: 1_000_000, cap: 1, threshold: 100 }
    const arr: number[] = []
    for (let i = 0; i < 5; i++) {
      recordViolation(arr, 1000 + i, cfg)
    }
    expect(arr.length).toBe(1)
    expect(arr[0]).toBe(1004) // último push sobrevive
  })

  it('configuração compatível com cross-proto (24h/32/10) reproduz comportamento T1', () => {
    const cfg: ViolationWindowConfig = {
      windowMs: 24 * 60 * 60 * 1000,
      cap: 32,
      threshold: 10,
    }
    const arr: number[] = []
    const t0 = 1_700_000_000_000
    // 9 violações burst — não trippa
    for (let i = 0; i < 9; i++) {
      const r = recordViolation(arr, t0 + i, cfg)
      expect(r.tripped).toBe(false)
    }
    // Avança 24h+1ms, mais 9 — pruned
    const tFar = t0 + cfg.windowMs + 1
    for (let i = 0; i < 9; i++) {
      const r = recordViolation(arr, tFar + i, cfg)
      expect(r.tripped).toBe(false)
    }
    expect(arr.length).toBe(9)
  })

  it('configuração compatível com rate-limit (60s/16/3) reproduz comportamento ratelimit', () => {
    const cfg: ViolationWindowConfig = {
      windowMs: 60_000,
      cap: 16,
      threshold: 3,
    }
    const arr: number[] = []
    const t0 = 5_000_000
    expect(recordViolation(arr, t0, cfg).tripped).toBe(false)
    expect(recordViolation(arr, t0 + 1, cfg).tripped).toBe(false)
    expect(recordViolation(arr, t0 + 2, cfg).tripped).toBe(true)
  })
})
