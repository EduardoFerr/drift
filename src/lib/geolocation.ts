/**
 * Captura de localização opt-in (manifesto §28 — Privacidade pelo Mínimo).
 *
 * Lê a granularidade declarada pelo user em `prefs.location_granularity`
 * e retorna um GeoPoint adequado, ou `null` se:
 *   - granularity === 'off' (default)
 *   - browser não tem geolocation API
 *   - permissão negada
 *   - timeout
 *
 * Granularidade implementada via **arredondamento de lat/lng** —
 * sem reverse geocoding (que dependeria de serviço externo, violaria §17).
 * Quem precisar de nome real de cidade/país pode adicionar reverse
 * geocoding como plugin opt-in (não no cliente oficial).
 *
 * | granularity | precisão       | uso típico                       |
 * |-------------|----------------|----------------------------------|
 * | off         | sem location   | default — não vaza nada          |
 * | country     | ~111km (0 dec) | "alguém no Brasil postou"        |
 * | city        | ~11km (1 dec)  | "alguém numa região metropolitana" |
 * | precise     | ~1m (5 dec)    | "alguém aqui no quarteirão" — caution |
 *
 * UI (ContentSettings) deve mostrar trade-offs claros antes do user
 * sair do default.
 */

import type { GeoPoint, LocationGranularity } from '../types/drift'

const GEOLOCATION_TIMEOUT_MS = 8000
const HIGH_ACCURACY_THRESHOLD: LocationGranularity = 'precise'

/**
 * Casas decimais por granularidade. Cada decimal corta a precisão por
 * fator de ~10. Grau ≈ 111km, então:
 *   - 0 dec → 111km
 *   - 1 dec → 11km
 *   - 2 dec → 1.1km
 *   - 3 dec → 110m
 *   - 4 dec → 11m
 *   - 5 dec → 1.1m
 */
const DECIMAL_PLACES: Record<Exclude<LocationGranularity, 'off'>, number> = {
  country: 0,
  city: 1,
  precise: 5,
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Captura a coordenada atual do device respeitando a granularidade
 * declarada pelo user. Retorna `null` se não conseguir (granularity off,
 * sem permissão, timeout, browser sem API).
 *
 * Não armazena nada — chamada não-stateful, cada captura é uma nova
 * leitura do GPS. Isso evita "vazar" coordenada antiga depois de o user
 * ter mudado de localização.
 */
export async function getCurrentLocation(
  granularity: LocationGranularity,
): Promise<GeoPoint | null> {
  if (granularity === 'off') return null
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null

  const decimals = DECIMAL_PLACES[granularity]

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        // Só pede high accuracy em precise — outros granularities aceitam
        // qualquer fix (network, IP-based) sem ligar GPS.
        enableHighAccuracy: granularity === HIGH_ACCURACY_THRESHOLD,
        timeout: GEOLOCATION_TIMEOUT_MS,
        // Aceita um fix recente do cache do browser (até 1 min) — evita
        // re-prompt em sequência rápida de spreads.
        maximumAge: 60_000,
      })
    })

    return {
      lat: roundTo(position.coords.latitude, decimals),
      lng: roundTo(position.coords.longitude, decimals),
      // city/country vazios — granularidade já está expressa no
      // arredondamento, sem reverse geocoding. Plugin pode preencher.
      city: '',
      country: '',
    }
  } catch (err) {
    // Diagnóstico explícito por motivo de falha (Lily peer review 29-04 —
    // user reportou "GPS não pega" sem feedback). Cada motivo distinto
    // ajuda debugar via DevTools console. Manter `null` como retorno
    // mantém location opt-in silencioso na UI.
    if (err instanceof GeolocationPositionError) {
      switch (err.code) {
        case err.PERMISSION_DENIED:
          console.warn(
            '[geolocation] PERMISSION_DENIED — browser bloqueou. ' +
              'Ícone de cadeado na URL → Site settings → Geolocation → Permitir.',
          )
          break
        case err.POSITION_UNAVAILABLE:
          console.warn(
            '[geolocation] POSITION_UNAVAILABLE — GPS indisponível ' +
              '(indoor sem rede? device sem GPS? VPN?).',
          )
          break
        case err.TIMEOUT:
          console.warn(
            `[geolocation] TIMEOUT após ${GEOLOCATION_TIMEOUT_MS}ms — ` +
              'GPS lock demorou; tentar de novo ou aproximar de janela/wifi.',
          )
          break
        default:
          console.warn('[geolocation] erro desconhecido:', err)
      }
    } else {
      console.warn('[geolocation] erro inesperado:', err)
    }
    return null
  }
}

/**
 * Warm-up GPS no idle (fire-and-forget). Dispara uma chamada em background
 * pra que o browser pré-aqueça o cache de fix de localização (até
 * `maximumAge: 60_000` ms). Próxima chamada de `getCurrentLocation` num
 * spread/publish pega o cache em ~50ms ao invés de 1-3s de GPS lock.
 *
 * IMPORTANTE: NÃO chamar se permissão ainda não foi concedida — o browser
 * mostraria prompt no boot, UX terrível. Caller deve checar
 * `navigator.permissions.query({name: 'geolocation'})` antes.
 *
 * Não retorna Promise — silenciosamente swallow de erros. Manifesto §28
 * (privacidade pelo mínimo): warm-up só roda se user já optou em
 * `prefs.location_granularity !== 'off'` E já concedeu permissão.
 */
export function warmUpGpsLocation(granularity: LocationGranularity): void {
  if (granularity === 'off') return
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  // Fire-and-forget. Erros silenciados — é só pré-aquecimento.
  void getCurrentLocation(granularity).catch(() => {})
}
