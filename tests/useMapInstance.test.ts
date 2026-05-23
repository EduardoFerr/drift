// useMapInstance — LOCK_VIA_TEST conformance.
//
// Source: Ted refactor B 2026-05-22 (audit ted-maps-review-2026-05-21
// refactor #2). Hook compartilhado pra setup MapLibre + Deck.gl overlay
// shared entre PostModeMap e GlobalModeMap em SpreadMap.tsx.
//
// Em jsdom não dá pra rodar MapLibre real (WebGL); este test é
// structural — valida export + signature + invariantes do contrato.
// Behavioral test (cleanup, RAF cancel, etc) acontece em integration
// manual + LOC behavioral parity vs PostModeMap pré-refactor.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HOOK = readFileSync('src/components/Feed/useMapInstance.ts', 'utf8')
const SPREAD_MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

describe('useMapInstance — exports + signature', () => {
  it('exporta useMapInstance hook', () => {
    expect(HOOK).toMatch(/export function useMapInstance/)
  })

  it('exporta UseMapInstanceOptions interface', () => {
    expect(HOOK).toMatch(/export interface UseMapInstanceOptions/)
  })

  it('exporta MapInstanceHandle interface', () => {
    expect(HOOK).toMatch(/export interface MapInstanceHandle/)
  })

  it('options aceita containerRef + style + center + zoom + onReady + deps', () => {
    expect(HOOK).toMatch(/containerRef:\s*React\.RefObject<HTMLDivElement>/)
    expect(HOOK).toMatch(/center:\s*\[number,\s*number\]/)
    expect(HOOK).toMatch(/zoom:\s*number/)
    expect(HOOK).toMatch(/onReady:/)
    expect(HOOK).toMatch(/deps:\s*ReadonlyArray<unknown>/)
  })

  it('onReady recebe handle com map + overlay + deps (deck deps)', () => {
    expect(HOOK).toMatch(/onReady:\s*\(handle:\s*MapInstanceHandle\)/)
    expect(HOOK).toMatch(/map:\s*unknown/)
    expect(HOOK).toMatch(/overlay:\s*OverlayInstance/)
    expect(HOOK).toMatch(/deps:\s*MapDeps/)
  })

  it('chama loadMapDeps async (DRY com useMapDeps)', () => {
    expect(HOOK).toMatch(/from\s+'\.\/useMapDeps'/)
    expect(HOOK).toMatch(/await\s+loadMapDeps\(\)/)
  })

  it('cleanup chama map.remove() defensivamente (try/catch)', () => {
    expect(HOOK).toMatch(/try\s*\{\s*\(map[\s\S]{0,40}\)\.remove\(\)\s*\}\s*catch/)
  })

  it('cleanup honra cancelled flag + chama callerCleanup', () => {
    expect(HOOK).toMatch(/cancelled\s*=\s*true/)
    expect(HOOK).toMatch(/callerCleanup\?\.\(\)|typeof\s+callerCleanup\s*===\s*'function'/)
  })

  it('addControl(overlay) acontece no setup (não no caller)', () => {
    expect(HOOK).toMatch(/addControl\(overlay\)/)
  })
})

describe('Integração useMapInstance no SpreadMap', () => {
  it('SpreadMap importa useMapInstance', () => {
    expect(SPREAD_MAP).toMatch(/from\s+'\.\/useMapInstance'/)
  })

  it('PostModeMap consome useMapInstance (refactor #1)', () => {
    // Aceita match em qualquer ponto do file — hook chamado dentro do
    // componente PostModeMap.
    expect(SPREAD_MAP).toMatch(/useMapInstance\(/)
  })
})
