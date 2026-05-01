import { describe, it, expect } from 'vitest'
import {
  scorePeer,
  pathDiversityScore,
  sampleWithoutReplacement,
  type KnownPeer,
} from '../src/lib/peerScore'

const NOW_MS = 1_700_000_000_000 // ms
const NOW_S = NOW_MS / 1000

function peer(opts: Partial<KnownPeer> = {}): KnownPeer {
  return {
    npub: 'p' + Math.random().toString(36).slice(2),
    lastSeen: NOW_S,
    connCount: 0,
    failCount: 0,
    latencyMs: null,
    asn: null,
    country: null,
    blacklistedUntil: 0,
    crossProtoCount: 0,
    ...opts,
  }
}

describe('scorePeer', () => {
  it('returns score in [0..1] for an empty/unknown peer', () => {
    const s = scorePeer({
      candidate: peer(),
      currentlyConnected: [],
      now: NOW_MS,
    })
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
    // reliability=0.5, latency~=0.51, recency=1, diversity=0.5 → mid range
    expect(s).toBeGreaterThan(0.4)
    expect(s).toBeLessThan(0.85)
  })

  it('100% reliability outscores 50% reliability (other things equal)', () => {
    const great = scorePeer({
      candidate: peer({ connCount: 10, failCount: 0 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    const meh = scorePeer({
      candidate: peer({ connCount: 5, failCount: 5 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    expect(great).toBeGreaterThan(meh)
  })

  it('0% reliability scores low', () => {
    const bad = scorePeer({
      candidate: peer({ connCount: 0, failCount: 10 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    const good = scorePeer({
      candidate: peer({ connCount: 10, failCount: 0 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    expect(bad).toBeLessThan(good)
    // bad reliability=0, contribution to total caps below ~0.65
    expect(bad).toBeLessThan(0.7)
  })

  it('low latency outscores high latency', () => {
    const fast = scorePeer({
      candidate: peer({ latencyMs: 50 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    const slow = scorePeer({
      candidate: peer({ latencyMs: 1500 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    expect(fast).toBeGreaterThan(slow)
  })

  it('recency decay matches exp(-ageDays/7)', () => {
    const oneDay = scorePeer({
      candidate: peer({ lastSeen: NOW_S - 86400 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    const fortnight = scorePeer({
      candidate: peer({ lastSeen: NOW_S - 86400 * 14 }),
      currentlyConnected: [],
      now: NOW_MS,
    })
    expect(oneDay).toBeGreaterThan(fortnight)
    // Recency component delta: 0.15 * (e^{-1/7} - e^{-2}) ~= 0.15 * (0.866 - 0.135) ~= 0.11
    expect(oneDay - fortnight).toBeGreaterThan(0.05)
    expect(oneDay - fortnight).toBeLessThan(0.2)
  })

  it('diversity bonus rewards underrepresented ASN', () => {
    const connected: KnownPeer[] = [
      peer({ asn: 100, country: 'BR' }),
      peer({ asn: 100, country: 'BR' }),
      peer({ asn: 100, country: 'BR' }),
    ]
    const unique = scorePeer({
      candidate: peer({ asn: 200, country: 'US' }),
      currentlyConnected: connected,
      now: NOW_MS,
    })
    const saturated = scorePeer({
      candidate: peer({ asn: 100, country: 'BR' }),
      currentlyConnected: connected,
      now: NOW_MS,
    })
    expect(unique).toBeGreaterThan(saturated)
  })
})

describe('pathDiversityScore', () => {
  it('empty list → 0', () => {
    expect(pathDiversityScore([])).toBe(0)
  })

  it('single peer → 0 (entropy normalized by log2(1)=0)', () => {
    expect(pathDiversityScore([peer({ asn: 100 })])).toBe(0)
  })

  it('4 peers in 4 distinct ASNs → 1.0', () => {
    const ps = [
      peer({ asn: 100 }),
      peer({ asn: 200 }),
      peer({ asn: 300 }),
      peer({ asn: 400 }),
    ]
    expect(pathDiversityScore(ps)).toBeCloseTo(1.0, 5)
  })

  it('4 peers in same ASN → 0', () => {
    const ps = [
      peer({ asn: 100 }),
      peer({ asn: 100 }),
      peer({ asn: 100 }),
      peer({ asn: 100 }),
    ]
    expect(pathDiversityScore(ps)).toBe(0)
  })

  it('mixed distribution falls between 0 and 1', () => {
    const ps = [
      peer({ asn: 100 }),
      peer({ asn: 100 }),
      peer({ asn: 100 }),
      peer({ asn: 200 }),
    ]
    const s = pathDiversityScore(ps)
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  it('null ASNs all bucket to "unknown"', () => {
    const ps = [peer({ asn: null }), peer({ asn: null }), peer({ asn: null })]
    expect(pathDiversityScore(ps)).toBe(0)
  })
})

describe('sampleWithoutReplacement', () => {
  it('n=0 → []', () => {
    expect(sampleWithoutReplacement([1, 2, 3], 0)).toEqual([])
  })

  it('n >= arr.length → permutation of all elements', () => {
    const arr = [1, 2, 3, 4, 5]
    const out = sampleWithoutReplacement(arr, 10)
    expect(out).toHaveLength(arr.length)
    expect([...out].sort()).toEqual([...arr].sort())
  })

  it('n < arr.length → length n, all elements from arr', () => {
    const arr = [10, 20, 30, 40, 50]
    const out = sampleWithoutReplacement(arr, 3)
    expect(out).toHaveLength(3)
    for (const x of out) expect(arr).toContain(x)
  })

  it('no replacement: all sampled elements are distinct', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = sampleWithoutReplacement(arr, 5)
    const set = new Set(out)
    expect(set.size).toBe(out.length)
  })

  it('deterministic with injected RNG', () => {
    const arr = ['a', 'b', 'c', 'd', 'e']
    const rng1 = () => 0.5
    const rng2 = () => 0.5
    const a = sampleWithoutReplacement(arr, 3, rng1)
    const b = sampleWithoutReplacement(arr, 3, rng2)
    expect(a).toEqual(b)
  })

  it('source array not mutated', () => {
    const arr = [1, 2, 3, 4]
    const snapshot = [...arr]
    sampleWithoutReplacement(arr, 2)
    expect(arr).toEqual(snapshot)
  })
})
