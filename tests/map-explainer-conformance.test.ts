// MapExplainerCard + long-press wiring — LOCK_VIA_TEST conformance.
//
// Source: User pedido 2026-05-22 — "se a gente pressionar por 3
// segundos o botão de ação para exibir o mapa, abre uma tela
// explicando para que serve aquele mapa. Legenda do que significa
// cada coisa se necessário."
//
// Cobre:
//   1. useLongPress hook export + signature estável
//   2. MapExplainerCard exporta + 4 contextos (post/global/network/
//      embedded/overlay-default) com copy + legenda + disclaimer §28
//   3. Long-press wired em PostViewer botão 🗺 (mini-map)
//   4. Long-press wired em NavBar action (App.tsx MAPA)
//   5. Long-press wired em SpreadMap ModeBtn (post/global/network)
//   6. Disclaimer §28 presente em todos os contextos (privacy)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  getMapExplainerCopy,
  type MapExplainerContext,
} from '../src/components/Feed/MapExplainerCard'

const HOOK = readFileSync('src/hooks/useLongPress.ts', 'utf8')
const EXPLAINER = readFileSync('src/components/Feed/MapExplainerCard.tsx', 'utf8')
const POST_VIEWER = readFileSync('src/components/Post/PostViewer.tsx', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')
const SPREAD_MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')
const NAV_BAR = readFileSync('src/components/UI/NavBar.tsx', 'utf8')

describe('useLongPress — hook API', () => {
  it('exporta useLongPress função', () => {
    expect(HOOK).toMatch(/export function useLongPress/)
  })

  it('exporta LONG_PRESS_MS = 3000 (alinhado ao PostViewer)', () => {
    expect(HOOK).toMatch(/export const LONG_PRESS_MS = 3000/)
  })

  it('exporta UseLongPressOptions + UseLongPressResult types', () => {
    expect(HOOK).toMatch(/export interface UseLongPressOptions/)
    expect(HOOK).toMatch(/export interface UseLongPressResult/)
  })

  it('options aceita disabled boolean (opt-out)', () => {
    expect(HOOK).toMatch(/disabled\?:\s*boolean/)
  })

  it('handlers cobrem onPointerDown/Move/Up/Cancel/Leave', () => {
    expect(HOOK).toMatch(/onPointerDown:/)
    expect(HOOK).toMatch(/onPointerMove:/)
    expect(HOOK).toMatch(/onPointerUp:/)
    expect(HOOK).toMatch(/onPointerCancel:/)
    expect(HOOK).toMatch(/onPointerLeave:/)
  })

  it('respeita slopPx (cancela se drag > slop)', () => {
    expect(HOOK).toMatch(/slopPx/)
    expect(HOOK).toMatch(/Math\.hypot\(dx,\s*dy\)/)
  })

  it('default ms = 3000', () => {
    expect(HOOK).toMatch(/ms\s*=\s*3000/)
  })
})

describe('MapExplainerCard — export + copy + legenda', () => {
  it('exporta MapExplainerCard component + getMapExplainerCopy helper', () => {
    expect(EXPLAINER).toMatch(/export function MapExplainerCard/)
    expect(EXPLAINER).toMatch(/export function getMapExplainerCopy/)
  })

  it('exporta MapExplainerContext type', () => {
    expect(EXPLAINER).toMatch(/export type MapExplainerContext/)
  })

  const contexts: MapExplainerContext[] = [
    'embedded',
    'overlay-default',
    'post',
    'global',
    'network',
  ]

  it.each(contexts)('copy do contexto "%s" tem title + purpose + legenda não-vazios', (ctx) => {
    const copy = getMapExplainerCopy(ctx)
    expect(copy.title).toBeTruthy()
    expect(copy.title.length).toBeGreaterThan(0)
    expect(copy.purpose).toBeTruthy()
    expect(copy.purpose.length).toBeGreaterThan(20) // não placeholder
    expect(copy.legend.length).toBeGreaterThan(0)
  })

  it('renderiza disclaimer §28 (privacidade pelo mínimo) no FullPageCard', () => {
    expect(EXPLAINER).toMatch(/§28/)
    expect(EXPLAINER).toMatch(/escolheu publicar/)
    expect(EXPLAINER).toMatch(/nunca.{0,40}infere/i)
  })

  it('usa FullPageCard primitive (slide-up + ESC dismissible)', () => {
    expect(EXPLAINER).toMatch(/from '\.\.\/UI\/FullPageCard'/)
    expect(EXPLAINER).toMatch(/<FullPageCard/)
  })

  it('copy modo post menciona DRIFT (vocabulary user-facing, não SPREAD)', () => {
    const copy = getMapExplainerCopy('post')
    const joined = (copy.purpose + ' ' + copy.legend.map((l) => l.label + ' ' + (l.hint ?? '')).join(' ')).toUpperCase()
    expect(joined).toMatch(/DRIFT/)
  })

  it('copy modo network referencia manifesto §24 (lente local)', () => {
    const copy = getMapExplainerCopy('network')
    expect(copy.purpose).toMatch(/§24/)
  })
})

describe('Long-press wiring — botões de ação dos mapas', () => {
  it('PostViewer importa useLongPress + MapExplainerCard', () => {
    expect(POST_VIEWER).toMatch(/from '\.\.\/\.\.\/hooks\/useLongPress'/)
    expect(POST_VIEWER).toMatch(/MapExplainerCard/)
  })

  it('PostViewer usa useLongPress no botão de mapa (mapLongPress)', () => {
    expect(POST_VIEWER).toMatch(/mapLongPress\s*=\s*useLongPress/)
    expect(POST_VIEWER).toMatch(/\{\.\.\.mapLongPress\.handlers\}/)
  })

  it('PostViewer renderiza MapExplainerCard com context="embedded"', () => {
    expect(POST_VIEWER).toMatch(/<MapExplainerCard[\s\S]{0,200}context="embedded"/)
  })

  it('NavBar action suporta onLongPress opcional', () => {
    expect(NAV_BAR).toMatch(/onLongPress\?:\s*\(\)\s*=>\s*void/)
    expect(NAV_BAR).toMatch(/useLongPress/)
  })

  it('App.tsx MAPA NavBar tem onLongPress abrindo MapExplainerCard', () => {
    // matcher tolerant: aceita qualquer formatting da prop
    expect(APP).toMatch(/onLongPress[\s:]+\(\)\s*=>[\s\S]{0,200}MapExplainerCard/)
  })

  it('SpreadMap ModeBtn aceita onLongPress prop', () => {
    expect(SPREAD_MAP).toMatch(/onLongPress\?:\s*\(\)\s*=>\s*void/)
  })

  it('SpreadMap ModeToggle wira long-press em post/global/network', () => {
    expect(SPREAD_MAP).toMatch(/onLongPress=\{\(\)\s*=>\s*setExplainer\('post'\)\}/)
    expect(SPREAD_MAP).toMatch(/onLongPress=\{\(\)\s*=>\s*setExplainer\('global'\)\}/)
    expect(SPREAD_MAP).toMatch(/onLongPress=\{\(\)\s*=>\s*setExplainer\('network'\)\}/)
  })
})
