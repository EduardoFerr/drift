/**
 * Conformance test pra kind 0 NIP-01 (profile metadata).
 *
 * Garante invariants do MVP (HIMYM deliberação 2026-05-17):
 *
 * 1. `buildKind0Payload` SÓ aceita keys em `KIND_0_ALLOWED_KEYS`
 *    — bloqueia injeção de campos privados (nsec, location, gps,
 *    prefs) em kind 0.
 *
 * 2. Kind 0 NUNCA é importado por `scoring.ts` ou `weight.ts`.
 *    Manifesto §22 (ranking pura) + §24 (sem afinidade) — display
 *    name não pode virar fator de ranking.
 *
 * 3. `validateProfilePayload` rejeita URLs http:// (só https://) e
 *    formato inválido de nip05.
 *
 * 4. `KIND_0_ALLOWED_KEYS` espelha NIP-01 puro — Drift não inventa
 *    campos próprios (manifesto §30 compat Nostr).
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildKind0Payload,
  validateProfilePayload,
} from '../src/lib/profiles'
import { KIND_0_ALLOWED_KEYS } from '../src/types/drift'

describe('buildKind0Payload — whitelist enforcement', () => {
  it('aceita todos os campos NIP-01 whitelisted', () => {
    const input = {
      name: 'alias',
      display_name: 'Alias Público',
      about: 'bio curta',
      picture: 'https://example.com/avatar.jpg',
      banner: 'https://example.com/banner.jpg',
      website: 'https://example.com',
      nip05: 'alias@example.com',
      lud16: 'alias@walletofsatoshi.com',
    }
    const out = buildKind0Payload(input)
    for (const key of KIND_0_ALLOWED_KEYS) {
      expect(out[key]).toBe(input[key])
    }
  })

  it('FILTRA chaves fora do whitelist (defesa contra injeção)', () => {
    const malicious = {
      name: 'alias',
      // Campos privados que NUNCA podem vazar em kind 0:
      nsec: 'nsec1evil',
      location: { lat: -23.5, lng: -46.6 },
      gps: 'precise',
      precise_location: true,
      // Campos não-NIP-01 inventados:
      drift_score: 99,
      reputation: 'high',
    } as Record<string, unknown>
    const out = buildKind0Payload(malicious as Parameters<typeof buildKind0Payload>[0])
    expect(out.name).toBe('alias')
    // Nenhuma chave fora do whitelist deve aparecer:
    const outKeys = Object.keys(out)
    for (const key of outKeys) {
      expect(KIND_0_ALLOWED_KEYS).toContain(key as (typeof KIND_0_ALLOWED_KEYS)[number])
    }
    // Specifically NÃO deve ter campos privados:
    expect(outKeys).not.toContain('nsec')
    expect(outKeys).not.toContain('location')
    expect(outKeys).not.toContain('gps')
    expect(outKeys).not.toContain('precise_location')
    expect(outKeys).not.toContain('drift_score')
    expect(outKeys).not.toContain('reputation')
  })

  it('strip whitespace-only e empty strings', () => {
    const out = buildKind0Payload({
      name: '   ',
      display_name: '',
      about: '  real bio  ',
    })
    expect(out.name).toBeUndefined()
    expect(out.display_name).toBeUndefined()
    expect(out.about).toBe('real bio')
  })

  it('ignora valores não-string', () => {
    const out = buildKind0Payload({
      name: 123 as unknown as string,
      about: null as unknown as string,
      picture: undefined,
    })
    expect(out.name).toBeUndefined()
    expect(out.about).toBeUndefined()
    expect(out.picture).toBeUndefined()
  })

  it('KIND_0_ALLOWED_KEYS é NIP-01 puro (sem campos drift-*)', () => {
    const NIP01_CANONICAL = [
      'name',
      'display_name',
      'about',
      'picture',
      'banner',
      'website',
      'nip05',
      'lud16',
    ]
    expect([...KIND_0_ALLOWED_KEYS].sort()).toEqual(NIP01_CANONICAL.sort())
  })
})

describe('validateProfilePayload — gating', () => {
  it('rejeita URLs http:// (só https://)', () => {
    const errors = validateProfilePayload({
      picture: 'http://example.com/avatar.jpg',
    })
    expect(errors.find((e) => e.field === 'picture')).toBeDefined()
  })

  it('aceita URLs https://', () => {
    const errors = validateProfilePayload({
      picture: 'https://example.com/avatar.jpg',
    })
    expect(errors.find((e) => e.field === 'picture')).toBeUndefined()
  })

  it('rejeita nip05 sem @', () => {
    const errors = validateProfilePayload({ nip05: 'noatsignhere' })
    expect(errors.find((e) => e.field === 'nip05')).toBeDefined()
  })

  it('aceita nip05 formato handle@domain', () => {
    const errors = validateProfilePayload({ nip05: 'alias@example.com' })
    expect(errors.find((e) => e.field === 'nip05')).toBeUndefined()
  })

  it('rejeita display_name acima do limite', () => {
    const errors = validateProfilePayload({
      display_name: 'a'.repeat(50),
    })
    expect(errors.find((e) => e.field === 'display_name')).toBeDefined()
  })

  it('aceita about no limite exato', () => {
    const errors = validateProfilePayload({ about: 'a'.repeat(140) })
    expect(errors.find((e) => e.field === 'about')).toBeUndefined()
  })
})

describe('LOCK_VIA_TEST — kind 0 isolation from scoring/weight', () => {
  function readSource(rel: string): string {
    return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
  }

  it('scoring.ts NÃO importa users_metadata, UserMetadata, kind 0 helpers', () => {
    const src = readSource('src/lib/scoring.ts')
    expect(src).not.toMatch(/users_metadata/)
    expect(src).not.toMatch(/UserMetadata\b/)
    expect(src).not.toMatch(/from ['"].*profiles['"]/)
    expect(src).not.toMatch(/buildKind0Payload|publishUserMetadata/)
  })

  it('weight.ts NÃO importa users_metadata, UserMetadata, kind 0 helpers', () => {
    const src = readSource('src/lib/weight.ts')
    expect(src).not.toMatch(/users_metadata/)
    expect(src).not.toMatch(/UserMetadata\b/)
    expect(src).not.toMatch(/from ['"].*profiles['"]/)
    expect(src).not.toMatch(/buildKind0Payload|publishUserMetadata/)
  })

  it('feed.ts NÃO usa users_metadata em ORDER BY / WHERE de ranking', () => {
    const src = readSource('src/lib/feed.ts')
    // Pode JOIN pra mostrar avatar (cosmetic), mas não pode rankear por isso.
    const lines = src.split('\n')
    for (const [i, line] of lines.entries()) {
      if (line.includes('ORDER BY') && line.toLowerCase().includes('metadata')) {
        throw new Error(
          `feed.ts:${i + 1} parece usar metadata em ORDER BY: "${line.trim()}" — manifesto §22 / §24`,
        )
      }
    }
  })
})
