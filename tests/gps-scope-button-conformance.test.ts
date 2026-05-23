// GpsScopeButton primitive — LOCK_VIA_TEST conformance.
//
// Source: 2026-05-23 — manifesto §28 (privacy mínima por inércia
// eliminada). Antes, location era setting persistente em
// `user_prefs.location_granularity` — user habilitava 'precise' uma
// vez por curiosidade no mapa e TODO post subsequente vazava GPS.
// Agora: setting vira "padrão pré-selecionado pra novos posts" + botão
// no header do ComposeOverlay permite override per-post, com permission
// GPS solicitada lazy (só quando user seleciona country/city/precise).
//
// Cobre:
//   1. Primitive existe + exporta GpsScopeButton + requestGpsPermission
//   2. 4 estados (off/country/city/precise) com labels PT-BR + ícones
//   3. Botão tem aria-label com estado atual + aria-haspopup="menu"
//   4. Popover tem role="menu" + radios com role="radio" + aria-checked
//   5. Frase de impacto presente pra cada opção (manifesto §28 trade-off)
//   6. Permission solicitada lazy (só on select, não no mount)
//   7. Selecionar 'off' NÃO requer permission
//   8. Publication path: ComposeOverlay propaga gpsScope via onPublish
//   9. App.tsx usa input.gpsScope (não getPrefs().location_granularity)
//  10. LocationCard re-framado como "padrão" (Settings)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PRIMITIVE = readFileSync(
  'src/components/Create/GpsScopeButton.tsx',
  'utf8',
)
const COMPOSE = readFileSync(
  'src/components/Create/ComposeOverlay.tsx',
  'utf8',
)
const APP = readFileSync('src/App.tsx', 'utf8')
const SETTINGS = readFileSync(
  'src/components/Settings/SettingsCards.tsx',
  'utf8',
)

describe('GpsScopeButton — primitive API', () => {
  it('exporta GpsScopeButton + requestGpsPermission', () => {
    expect(PRIMITIVE).toMatch(/export function GpsScopeButton/)
    expect(PRIMITIVE).toMatch(/export async function requestGpsPermission/)
  })

  it('aceita value/onChange/disabled/onPermissionDenied', () => {
    expect(PRIMITIVE).toMatch(/value:\s*LocationGranularity/)
    expect(PRIMITIVE).toMatch(/onChange:\s*\(next:\s*LocationGranularity\)/)
    expect(PRIMITIVE).toMatch(/disabled\?:\s*boolean/)
    expect(PRIMITIVE).toMatch(/onPermissionDenied\?:\s*\(\)\s*=>\s*void/)
  })
})

describe('GpsScopeButton — 4 estados PT-BR', () => {
  it('tem opções off/country/city/precise com labels PT-BR', () => {
    expect(PRIMITIVE).toMatch(/value:\s*'off'/)
    expect(PRIMITIVE).toMatch(/value:\s*'country'/)
    expect(PRIMITIVE).toMatch(/value:\s*'city'/)
    expect(PRIMITIVE).toMatch(/value:\s*'precise'/)
    // Labels PT-BR (não 'country' literal exposto ao user)
    expect(PRIMITIVE).toMatch(/short:\s*'país'/)
    expect(PRIMITIVE).toMatch(/short:\s*'cidade'/)
    expect(PRIMITIVE).toMatch(/short:\s*'GPS'/)
  })

  it('cada opção tem frase de impacto (manifesto §28 trade-off)', () => {
    // 4 ocorrências de `impact:` (uma por opção)
    const impacts = PRIMITIVE.match(/impact:\s*'/g) ?? []
    expect(impacts.length).toBe(4)
  })
})

describe('GpsScopeButton — a11y shape', () => {
  it('botão tem aria-label dinâmico + aria-haspopup="menu" + aria-expanded', () => {
    expect(PRIMITIVE).toMatch(/aria-label=\{ariaLabel\}/)
    expect(PRIMITIVE).toMatch(/aria-haspopup="menu"/)
    expect(PRIMITIVE).toMatch(/aria-expanded=\{open\}/)
  })

  it('popover tem role="menu" + radiogroup interno', () => {
    expect(PRIMITIVE).toMatch(/role="menu"/)
    expect(PRIMITIVE).toMatch(/role="radiogroup"/)
  })

  it('itens têm role="radio" + aria-checked={active}', () => {
    expect(PRIMITIVE).toMatch(/role="radio"/)
    expect(PRIMITIVE).toMatch(/aria-checked=\{active\}/)
  })

  it('Esc fecha popover', () => {
    expect(PRIMITIVE).toMatch(/e\.key === 'Escape'/)
  })
})

describe('GpsScopeButton — lazy permission', () => {
  it('off NÃO requer permission (early return)', () => {
    expect(PRIMITIVE).toMatch(/if\s*\(next === 'off'\)/)
  })

  it('country/city/precise dispara requestGpsPermission', () => {
    expect(PRIMITIVE).toMatch(/requestGpsPermission\(\)/)
  })

  it('permission negada → onChange("off") + onPermissionDenied callback', () => {
    expect(PRIMITIVE).toMatch(/onPermissionDenied\?\.\(\)/)
    expect(PRIMITIVE).toMatch(/onChange\('off'\)/)
  })

  it('requestGpsPermission usa getCurrentPosition com timeout curto', () => {
    expect(PRIMITIVE).toMatch(/navigator\.geolocation\.getCurrentPosition/)
    expect(PRIMITIVE).toMatch(/timeout:\s*3000/)
  })
})

describe('ComposeOverlay — wire GpsScopeButton no header', () => {
  it('importa GpsScopeButton', () => {
    expect(COMPOSE).toMatch(/import\s*\{\s*GpsScopeButton\s*\}\s*from\s*'\.\/GpsScopeButton'/)
  })

  it('renderiza GpsScopeButton no headerRight', () => {
    expect(COMPOSE).toMatch(/<GpsScopeButton\b/)
  })

  it('mantém botão cancelar lado a lado', () => {
    // Header right tem flex + items-center + gap + DriftButton cancelar
    expect(COMPOSE).toMatch(/aria-label="cancelar"/)
    expect(COMPOSE).toMatch(/cancelar\s*<\/DriftButton>/)
  })

  it('gpsScope state usa setState com default = prefs.location_granularity', () => {
    expect(COMPOSE).toMatch(/useState<LocationGranularity>\(defaultScope\)/)
    expect(COMPOSE).toMatch(/s\.location_granularity/)
  })

  it('onPublish payload inclui gpsScope', () => {
    expect(COMPOSE).toMatch(/onPublish\(\s*\{\s*subposts,\s*contentWarning,\s*imetas,\s*gpsScope\s*\}/)
  })

  it('ComposeOverlayProps onPublish declara gpsScope: LocationGranularity', () => {
    expect(COMPOSE).toMatch(/gpsScope:\s*LocationGranularity/)
  })
})

describe('App.tsx — handlePublish usa input.gpsScope', () => {
  it('aceita gpsScope no input', () => {
    expect(APP).toMatch(/gpsScope:\s*import\('\.\/types\/drift'\)\.LocationGranularity/)
  })

  it('lê granularity de input.gpsScope (não de getPrefs() no flow de publish)', () => {
    // O statement original lia direto de getPrefs() em handlePublish.
    // Agora deve ler de input.gpsScope.
    expect(APP).toMatch(/const granularity = input\.gpsScope/)
  })
})

describe('LocationCard re-framing — "padrão pra novos posts"', () => {
  it('SettingExplainer label re-framado pra "padrão pra novos posts"', () => {
    expect(SETTINGS).toMatch(/label="padrão pra novos posts"/)
  })

  it('copy menciona override per-post no compose', () => {
    expect(SETTINGS).toMatch(/per-post/i)
  })

  it('defaultExplained menciona "Off" como ponto de partida', () => {
    expect(SETTINGS).toMatch(/defaultExplained="Off\./)
  })
})
