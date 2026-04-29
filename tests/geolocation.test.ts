/**
 * Tests pra src/lib/geolocation.ts.
 *
 * Cobre: granularity 'off' curto-circuita, arredondamento por
 * granularity (country/city/precise), erros (PERMISSION_DENIED, TIMEOUT,
 * POSITION_UNAVAILABLE), e ausência de navigator.geolocation.
 *
 * Manifesto §28 — privacidade pelo mínimo. Granularidade implementada
 * via arredondamento (sem reverse geocoding). Quebrar arredondamento
 * vaza precisão maior do que o user consentiu.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentLocation } from '../src/lib/geolocation'

// ─── Helpers ─────────────────────────────────────────────────────────

interface MockCoords {
  latitude: number
  longitude: number
}

interface MockError {
  code: 1 | 2 | 3
  PERMISSION_DENIED: 1
  POSITION_UNAVAILABLE: 2
  TIMEOUT: 3
  message: string
}

function mockGeolocationSuccess(coords: MockCoords) {
  const getCurrentPosition = vi.fn(
    (
      success: (pos: { coords: MockCoords }) => void,
      _error?: unknown,
      _opts?: unknown,
    ) => {
      success({ coords })
    },
  )
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  return getCurrentPosition
}

function mockGeolocationError(code: 1 | 2 | 3) {
  const err: MockError = {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: 'mock error',
  }
  // Stub global GeolocationPositionError pra o instanceof check em
  // geolocation.ts não dar `false` por causa do mock plain object.
  // Atribuímos uma classe dummy e jogamos seu prototype no err.
  class FakePositionError {
    code = code
    PERMISSION_DENIED = 1
    POSITION_UNAVAILABLE = 2
    TIMEOUT = 3
    message = 'mock error'
  }
  vi.stubGlobal('GeolocationPositionError', FakePositionError)
  Object.setPrototypeOf(err, FakePositionError.prototype)

  const getCurrentPosition = vi.fn(
    (
      _success: unknown,
      error: (e: MockError) => void,
      _opts?: unknown,
    ) => {
      error(err)
    },
  )
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  return getCurrentPosition
}

beforeEach(() => {
  // Silencia console.warn (geolocation.ts loga em PERMISSION_DENIED).
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── Curto-circuito ──────────────────────────────────────────────────

describe('getCurrentLocation — granularity off', () => {
  it("retorna null sem chamar geolocation API quando granularity === 'off'", async () => {
    const fn = mockGeolocationSuccess({ latitude: 10, longitude: 20 })
    const result = await getCurrentLocation('off')
    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('retorna null quando navigator.geolocation é undefined', async () => {
    vi.stubGlobal('navigator', {})
    const result = await getCurrentLocation('precise')
    expect(result).toBeNull()
  })

  it('retorna null quando navigator é undefined', async () => {
    vi.stubGlobal('navigator', undefined)
    const result = await getCurrentLocation('precise')
    expect(result).toBeNull()
  })
})

// ─── Arredondamento por granularidade ────────────────────────────────

describe('getCurrentLocation — arredondamento', () => {
  it("'country' arredonda pra 0 decimais (1.234567 → 1)", async () => {
    mockGeolocationSuccess({ latitude: 1.234567, longitude: -45.678901 })
    const result = await getCurrentLocation('country')
    expect(result).not.toBeNull()
    expect(result!.lat).toBe(1)
    expect(result!.lng).toBe(-46) // -45.678... arredonda pra -46
    expect(result!.city).toBe('')
    expect(result!.country).toBe('')
  })

  it("'city' arredonda pra 1 decimal (1.234567 → 1.2)", async () => {
    mockGeolocationSuccess({ latitude: 1.234567, longitude: -45.678901 })
    const result = await getCurrentLocation('city')
    expect(result!.lat).toBe(1.2)
    expect(result!.lng).toBe(-45.7)
  })

  it("'precise' arredonda pra 5 decimais (1.234567 → 1.23457)", async () => {
    mockGeolocationSuccess({ latitude: 1.234567, longitude: -45.678901 })
    const result = await getCurrentLocation('precise')
    expect(result!.lat).toBe(1.23457)
    expect(result!.lng).toBe(-45.6789)
  })

  it("'precise' pede enableHighAccuracy:true", async () => {
    const fn = mockGeolocationSuccess({ latitude: 0, longitude: 0 })
    await getCurrentLocation('precise')
    const opts = fn.mock.calls[0]![2] as { enableHighAccuracy: boolean }
    expect(opts.enableHighAccuracy).toBe(true)
  })

  it("'city' NÃO pede enableHighAccuracy (economiza GPS)", async () => {
    const fn = mockGeolocationSuccess({ latitude: 0, longitude: 0 })
    await getCurrentLocation('city')
    const opts = fn.mock.calls[0]![2] as { enableHighAccuracy: boolean }
    expect(opts.enableHighAccuracy).toBe(false)
  })

  it('passa timeout de 8000ms', async () => {
    const fn = mockGeolocationSuccess({ latitude: 0, longitude: 0 })
    await getCurrentLocation('city')
    const opts = fn.mock.calls[0]![2] as { timeout: number }
    expect(opts.timeout).toBe(8000)
  })

  it('aceita coordenadas zero (não confunde com null)', async () => {
    mockGeolocationSuccess({ latitude: 0, longitude: 0 })
    const result = await getCurrentLocation('precise')
    expect(result).not.toBeNull()
    expect(result!.lat).toBe(0)
    expect(result!.lng).toBe(0)
  })
})

// ─── Erros ───────────────────────────────────────────────────────────

describe('getCurrentLocation — erros retornam null silencioso', () => {
  it('PERMISSION_DENIED → null', async () => {
    mockGeolocationError(1)
    const result = await getCurrentLocation('city')
    expect(result).toBeNull()
  })

  it('POSITION_UNAVAILABLE → null', async () => {
    mockGeolocationError(2)
    const result = await getCurrentLocation('city')
    expect(result).toBeNull()
  })

  it('TIMEOUT → null', async () => {
    mockGeolocationError(3)
    const result = await getCurrentLocation('city')
    expect(result).toBeNull()
  })
})
