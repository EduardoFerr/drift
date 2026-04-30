import { describe, expect, it, vi } from 'vitest'

// Mock do db pra que importar useSpreadMap.ts não dispare worker SQLite.
// `_buildArcs` é função pura — não toca no banco — mas o módulo do hook
// importa `../lib/db` no topo, então precisamos do stub antes do import.
vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import { _buildArcs } from '../src/hooks/useSpreadMap'
import type { GeoPoint } from '../src/types/drift'

function geo(lat: number, lng: number, country = 'BR', city = ''): GeoPoint {
  return { lat, lng, city, country }
}

function dest(lat: number, lng: number, createdAt: number): {
  point: GeoPoint
  createdAt: number
} {
  return { point: geo(lat, lng), createdAt }
}

const SP = geo(-23.55, -46.63, 'BR', 'São Paulo')
const RJ = geo(-22.9, -43.17, 'BR', 'Rio de Janeiro')
const PA = geo(48.85, 2.35, 'FR', 'Paris')
const NY = geo(40.71, -74.0, 'US', 'New York')

describe('_buildArcs', () => {
  // ─── Caso 1: origin presente + N destinos → 1 arco por destino ───

  it('origin presente + 1 destino → 1 arco partindo de origin', () => {
    const arcs = _buildArcs(SP, [dest(RJ.lat, RJ.lng, 1000)])
    expect(arcs).toHaveLength(1)
    expect(arcs[0]).toEqual({
      origin: [SP.lng, SP.lat],
      destination: [RJ.lng, RJ.lat],
      createdAt: 1000,
    })
  })

  it('origin presente + N destinos → todos os arcos partem de origin', () => {
    const destinations = [
      dest(RJ.lat, RJ.lng, 1000),
      dest(PA.lat, PA.lng, 2000),
      dest(NY.lat, NY.lng, 3000),
    ]
    const arcs = _buildArcs(SP, destinations)
    expect(arcs).toHaveLength(3)
    // Todos partem de SP (origin)
    for (const a of arcs) {
      expect(a.origin).toEqual([SP.lng, SP.lat])
    }
    expect(arcs[0]!.destination).toEqual([RJ.lng, RJ.lat])
    expect(arcs[1]!.destination).toEqual([PA.lng, PA.lat])
    expect(arcs[2]!.destination).toEqual([NY.lng, NY.lat])
    // createdAt é preservado por arco
    expect(arcs.map((a) => a.createdAt)).toEqual([1000, 2000, 3000])
  })

  // ─── Caso 2: origin presente + destinos vazio → [] ───

  it('origin presente + destinos vazio → [] (renderiza só o ponto)', () => {
    expect(_buildArcs(SP, [])).toEqual([])
  })

  // ─── Caso 3: origin null + >=2 destinos → fallback legacy ───

  it('origin null + 2 destinos → fallback: destinations[0] vira origem', () => {
    const arcs = _buildArcs(null, [
      dest(RJ.lat, RJ.lng, 1000),
      dest(PA.lat, PA.lng, 2000),
    ])
    expect(arcs).toHaveLength(1)
    expect(arcs[0]).toEqual({
      origin: [RJ.lng, RJ.lat], // primeiro destino vira origem
      destination: [PA.lng, PA.lat],
      createdAt: 2000,
    })
  })

  it('origin null + 3 destinos → 2 arcos partindo de destinations[0]', () => {
    const arcs = _buildArcs(null, [
      dest(RJ.lat, RJ.lng, 1000),
      dest(PA.lat, PA.lng, 2000),
      dest(NY.lat, NY.lng, 3000),
    ])
    expect(arcs).toHaveLength(2)
    // Ambos partem do primeiro destino (RJ) — fallback legacy
    for (const a of arcs) {
      expect(a.origin).toEqual([RJ.lng, RJ.lat])
    }
    expect(arcs[0]!.destination).toEqual([PA.lng, PA.lat])
    expect(arcs[1]!.destination).toEqual([NY.lng, NY.lat])
    expect(arcs.map((a) => a.createdAt)).toEqual([2000, 3000])
  })

  // ─── Caso 4: origin null + 1 destino → [] ───

  it('origin null + 1 destino → [] (não dá pra inferir origem)', () => {
    expect(_buildArcs(null, [dest(RJ.lat, RJ.lng, 1000)])).toEqual([])
  })

  // ─── Caso 5: origin null + 0 destinos → [] ───

  it('origin null + 0 destinos → []', () => {
    expect(_buildArcs(null, [])).toEqual([])
  })

  // ─── Formato de coordenadas: Deck.gl convention [lng, lat] ───

  it('coords retornadas em [lng, lat] (Deck.gl convention, invertido vs {lat, lng})', () => {
    // SP: lat=-23.55, lng=-46.63
    // Se devolvesse [lat, lng] o primeiro elemento seria -23.55. Garante a inversão.
    const arcs = _buildArcs(SP, [dest(PA.lat, PA.lng, 42)])
    expect(arcs).toHaveLength(1)
    const arc = arcs[0]!
    // origin
    expect(arc.origin[0]).toBe(SP.lng) // -46.63
    expect(arc.origin[1]).toBe(SP.lat) // -23.55
    expect(arc.origin[0]).not.toBe(SP.lat) // sanity: não confundiu
    // destination — Paris: lat=48.85, lng=2.35 (sinais distintos confirmam)
    expect(arc.destination[0]).toBe(PA.lng) // 2.35
    expect(arc.destination[1]).toBe(PA.lat) // 48.85
  })

  // ─── Determinismo (manifesto §7) ───

  it('é determinístico — mesma entrada sempre dá mesma saída', () => {
    const destinations = [dest(RJ.lat, RJ.lng, 1000), dest(PA.lat, PA.lng, 2000)]
    const a = _buildArcs(SP, destinations)
    const b = _buildArcs(SP, destinations)
    expect(a).toEqual(b)
  })
})
