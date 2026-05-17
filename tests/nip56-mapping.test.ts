/**
 * NIP-56 mapping conformance — LOCK_VIA_TEST puro (manifesto §7).
 *
 * Garante:
 *  1. Mapping bidirecional determinístico (same input → same output)
 *  2. Whitelist enforcement (report_type fora do NIP-56 spec retorna null)
 *  3. Cobertura 100% dos 7 NIP-56 report_types e 3 Drift buckets
 *  4. Type guard rejeita non-strings + strings fora do whitelist
 *
 * Deliberação HIMYM 2026-05-17 (Marshall): mapping é função pura,
 * testável sem db. Tabela canônica documentada em nip56-mapping.ts.
 */

import { describe, expect, it } from 'vitest'
import {
  mapDriftToNip56,
  mapNip56ToDrift,
  isNip56ReportType,
  NIP56_REPORT_TYPES,
  type Nip56ReportType,
} from '../src/lib/nip56-mapping'
import type { ReportReason } from '../src/types/drift'

describe('NIP-56 mapping — Drift → NIP-56 (emit path)', () => {
  it('illegal → illegal (1:1)', () => {
    expect(mapDriftToNip56('illegal')).toBe('illegal')
  })

  it('spam → spam (1:1)', () => {
    expect(mapDriftToNip56('spam')).toBe('spam')
  })

  it('harassment → other (NIP-56 sem canônico; fallback honesto)', () => {
    expect(mapDriftToNip56('harassment')).toBe('other')
  })

  it('cobre TODOS os 3 ReportReason Drift', () => {
    const ALL: ReportReason[] = ['illegal', 'spam', 'harassment']
    for (const r of ALL) {
      const result = mapDriftToNip56(r)
      expect(NIP56_REPORT_TYPES).toContain(result)
    }
  })

  it('determinístico — mesmo input dá mesmo output sempre', () => {
    expect(mapDriftToNip56('illegal')).toBe(mapDriftToNip56('illegal'))
    expect(mapDriftToNip56('spam')).toBe(mapDriftToNip56('spam'))
    expect(mapDriftToNip56('harassment')).toBe(mapDriftToNip56('harassment'))
  })
})

describe('NIP-56 mapping — NIP-56 → Drift (ingestão path)', () => {
  it('illegal → illegal', () => {
    expect(mapNip56ToDrift('illegal')).toBe('illegal')
  })

  it('malware → illegal (crime digital)', () => {
    expect(mapNip56ToDrift('malware')).toBe('illegal')
  })

  it('spam → spam', () => {
    expect(mapNip56ToDrift('spam')).toBe('spam')
  })

  it('impersonation → spam (fake identity vector)', () => {
    expect(mapNip56ToDrift('impersonation')).toBe('spam')
  })

  it('profanity → spam (Drift não trata como abuse)', () => {
    expect(mapNip56ToDrift('profanity')).toBe('spam')
  })

  it('nudity → spam (Drift cobre via content-warning §27)', () => {
    expect(mapNip56ToDrift('nudity')).toBe('spam')
  })

  it('other → spam (fallback honesto)', () => {
    expect(mapNip56ToDrift('other')).toBe('spam')
  })

  it('report_type fora do NIP-56 whitelist → null', () => {
    expect(mapNip56ToDrift('hate')).toBeNull()
    expect(mapNip56ToDrift('IllEgaL')).toBeNull() // case-sensitive
    expect(mapNip56ToDrift('')).toBeNull()
    expect(mapNip56ToDrift('arbitrary')).toBeNull()
  })

  it('cobre TODOS os 7 NIP-56 canônicos', () => {
    for (const t of NIP56_REPORT_TYPES) {
      const result = mapNip56ToDrift(t)
      expect(result).not.toBeNull()
      expect(['illegal', 'spam', 'harassment']).toContain(result)
    }
  })

  it('determinístico — mesmo input dá mesmo output sempre', () => {
    for (const t of NIP56_REPORT_TYPES) {
      expect(mapNip56ToDrift(t)).toBe(mapNip56ToDrift(t))
    }
  })
})

describe('NIP-56 mapping — type guard', () => {
  it('aceita os 7 valores canônicos', () => {
    for (const t of NIP56_REPORT_TYPES) {
      expect(isNip56ReportType(t)).toBe(true)
    }
  })

  it('rejeita strings fora do whitelist', () => {
    expect(isNip56ReportType('hate')).toBe(false)
    expect(isNip56ReportType('Illegal')).toBe(false) // case-sensitive
    expect(isNip56ReportType('')).toBe(false)
  })

  it('rejeita non-strings', () => {
    expect(isNip56ReportType(null)).toBe(false)
    expect(isNip56ReportType(undefined)).toBe(false)
    expect(isNip56ReportType(42)).toBe(false)
    expect(isNip56ReportType({})).toBe(false)
    expect(isNip56ReportType(['illegal'])).toBe(false)
  })
})

describe('NIP-56 LOCK_VIA_TEST — invariantes', () => {
  it('Drift→NIP-56→Drift NÃO é round-trip 1:1 (lossy 3→7→3)', () => {
    // illegal → illegal → illegal ✓ (round-trip preservado)
    expect(mapNip56ToDrift(mapDriftToNip56('illegal'))).toBe('illegal')
    // spam → spam → spam ✓
    expect(mapNip56ToDrift(mapDriftToNip56('spam'))).toBe('spam')
    // harassment → other → spam ✗ (LOSSY: harassment some)
    expect(mapNip56ToDrift(mapDriftToNip56('harassment'))).toBe('spam')
    // Este é o trade-off NIP-56 documentado: bucket 'other' é o
    // wildcard, e Drift recebe-o como spam (conservador).
  })

  it('NIP-56→Drift→NIP-56 NÃO é round-trip 1:1 (7→3→7)', () => {
    // Idem — perda de info ao colapsar 7 buckets em 3.
    expect(mapDriftToNip56(mapNip56ToDrift('malware')!)).toBe('illegal') // malware perdido
    expect(mapDriftToNip56(mapNip56ToDrift('nudity')!)).toBe('spam') // nudity perdido
    expect(mapDriftToNip56(mapNip56ToDrift('impersonation')!)).toBe('spam') // perdido
  })

  it('Drift→NIP-56 NUNCA retorna report_type fora do whitelist', () => {
    const reasons: ReportReason[] = ['illegal', 'spam', 'harassment']
    for (const r of reasons) {
      const out = mapDriftToNip56(r)
      expect(isNip56ReportType(out)).toBe(true)
    }
  })

  it('NIP56_REPORT_TYPES tem exatamente 7 valores (spec NIP-56)', () => {
    expect(NIP56_REPORT_TYPES.length).toBe(7)
    expect(new Set(NIP56_REPORT_TYPES).size).toBe(7) // sem duplicatas
  })
})
