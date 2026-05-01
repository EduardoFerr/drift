import { describe, expect, it, vi } from 'vitest'

// Mock do db pra que importar useSpreadMap.ts não dispare worker SQLite.
// O módulo do hook importa `../lib/db` no topo; precisamos do stub
// antes do import dos test subjects.
vi.mock('../src/lib/db', () => ({
  db: {
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
  },
}))

import { _computeBounds } from '../src/components/Feed/SpreadMap'

// Fixtures geográficos com sinais distintos (evita confundir lat/lng).
const SP_LNG = -46.63
const SP_LAT = -23.55
const RJ_LNG = -43.17
const RJ_LAT = -22.9
const PA_LNG = 2.35
const PA_LAT = 48.85
const NY_LNG = -74.0
const NY_LAT = 40.71

describe('_computeBounds', () => {
  it('lista vazia → null', () => {
    expect(_computeBounds([])).toBeNull()
  })

  it('1 ponto → bbox degenerado (sw === ne)', () => {
    // fitBounds com sw === ne é tratado pelo MapLibre (vai pro maxZoom).
    expect(_computeBounds([[10, 20]])).toEqual([
      [10, 20],
      [10, 20],
    ])
  })

  it('N pontos → bbox cobre todos (formato [[swLng,swLat],[neLng,neLat]])', () => {
    // SP (lng=-46.63, lat=-23.55), RJ (lng=-43.17, lat=-22.9)
    const bounds = _computeBounds([
      [SP_LNG, SP_LAT],
      [RJ_LNG, RJ_LAT],
    ])
    expect(bounds).toEqual([
      [SP_LNG, SP_LAT], // sudoeste = mais a oeste e mais ao sul
      [RJ_LNG, RJ_LAT], // nordeste = mais a leste e mais ao norte
    ])
  })

  it('hemisférios mistos — coordenadas com sinais opostos', () => {
    // NY (lng=-74, lat=40.71), Paris (lng=2.35, lat=48.85)
    const bounds = _computeBounds([
      [NY_LNG, NY_LAT],
      [PA_LNG, PA_LAT],
    ])
    expect(bounds).toEqual([
      [NY_LNG, NY_LAT], // sw = NY (mais a oeste, mais ao sul)
      [PA_LNG, PA_LAT], // ne = Paris (mais a leste, mais ao norte)
    ])
  })

  it('é determinístico (manifesto §7)', () => {
    const points: [number, number][] = [
      [SP_LNG, SP_LAT],
      [RJ_LNG, RJ_LAT],
      [PA_LNG, PA_LAT],
    ]
    expect(_computeBounds(points)).toEqual(_computeBounds(points))
  })
})
