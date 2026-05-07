/**
 * Tests pra `regionKey()` em `src/hooks/useSpreadMap.ts`.
 *
 * Contexto (Lily 2026-05-07): MapOverlay mostrava "0 países" mesmo com
 * 39 drifts em arcs visíveis. Causa raiz: cliente oficial NUNCA preenche
 * `country` em GeoPoint (geolocation.ts:124-125 hardcoda `''` por
 * privacidade — manifesto §17/§28: sem reverse geocoding). Aggregação
 * `allCountries.add(country)` filtrava empty string e Set sempre ficava
 * vazio.
 *
 * Fix: `regionKey()` retorna nome real de país quando disponível, ou
 * bucket de coordenada arredondada a 0 casas (~111km) como aproximação
 * de "região". Determinístico (manifesto §7) e sem dependência externa.
 */

import { describe, expect, it } from 'vitest'
import { regionKey } from '../src/hooks/useSpreadMap'
import type { GeoPoint } from '../src/types/drift'

const empty = { city: '', country: '' }

describe('regionKey — fallback quando country vazio', () => {
  it('country vazio → bucket lat,lng arredondado', () => {
    const p: GeoPoint = { lat: -15.78, lng: -47.92, ...empty } // Brasília
    expect(regionKey(p)).toBe('-16,-48')
  })

  it('country vazio + coords zero → "0,0" (não confunde com null)', () => {
    const p: GeoPoint = { lat: 0, lng: 0, ...empty }
    expect(regionKey(p)).toBe('0,0')
  })

  it('coords próximas (mesma cidade) caem no mesmo bucket', () => {
    // Dois pontos a < 50km dentro do mesmo bucket arredondado.
    // Evita valores próximos de .5 (Math.round half-up cruza bucket).
    const sp1: GeoPoint = { lat: -23.4, lng: -46.3, ...empty }
    const sp2: GeoPoint = { lat: -23.2, lng: -46.1, ...empty }
    expect(regionKey(sp1)).toBe(regionKey(sp2))
  })

  it('coords distantes (países diferentes) caem em buckets diferentes', () => {
    const brasilia: GeoPoint = { lat: -15.78, lng: -47.92, ...empty }
    const lisboa: GeoPoint = { lat: 38.72, lng: -9.13, ...empty }
    const tokyo: GeoPoint = { lat: 35.68, lng: 139.69, ...empty }
    const set = new Set([brasilia, lisboa, tokyo].map(regionKey))
    expect(set.size).toBe(3)
  })
})

describe('regionKey — prefere country quando presente', () => {
  it('country presente sobrescreve bucket de coord', () => {
    const p: GeoPoint = { lat: -15.78, lng: -47.92, city: 'Brasília', country: 'Brasil' }
    expect(regionKey(p)).toBe('Brasil')
  })

  it('agrupa coords distantes do mesmo país sob um único nome', () => {
    // Manaus e Porto Alegre — mesmo Brasil, coords muito distantes.
    const manaus: GeoPoint = { lat: -3.1, lng: -60.0, city: '', country: 'Brasil' }
    const poa: GeoPoint = { lat: -30.03, lng: -51.23, city: '', country: 'Brasil' }
    expect(regionKey(manaus)).toBe(regionKey(poa))
  })
})

describe('regionKey — regressão: counter ≠ 0 com cliente oficial', () => {
  it('5 spreads em coords distintas com country vazio → 5 buckets distintos', () => {
    // Sintoma original: cliente oficial publica `country: ''`, counter dava 0.
    // Agora derivamos região por coord — counter reflete diversidade real.
    const points: GeoPoint[] = [
      { lat: -15.78, lng: -47.92, ...empty },  // Brasília
      { lat: -23.55, lng: -46.63, ...empty },  // São Paulo
      { lat: 40.71,  lng: -74.00, ...empty },  // NYC
      { lat: 51.51,  lng: -0.13,  ...empty },  // Londres
      { lat: 35.68,  lng: 139.69, ...empty },  // Tokyo
    ]
    const set = new Set(points.map(regionKey))
    expect(set.size).toBe(5)
  })
})
