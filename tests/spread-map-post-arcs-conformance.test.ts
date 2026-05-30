// Post-mode cascade arcs — LOCK_VIA_TEST conformance (2026-05-30).
//
// P0 bug: post mode = "cascata viral honesta" (§28). `useSpreadMap.buildPostData`
// computa `data.arcs: PropagationArc[]` via `inferCascadeTree` (origin→spreader
// LITERAL, spreader→spreader INFERIDO). Mas `PostModeMap` em SpreadMap.tsx só
// instanciava HeatmapLayer + 2 ScatterplotLayers — NUNCA uma ArcLayer. Logo
// `data.arcs` jamais era desenhado → mapa de post sem propagação.
//
// Este lock garante que o caminho de render do POST mode:
//   1. consome `data.arcs` via o helper compartilhado de gating
//      (buildVisSegs) + fabrica ArcLayers (makeArcLayers).
//   2. é gated pelo relógio único (useTimelineClock), igual ao global —
//      arcos desenham A→B progressivamente; pausa/reduced-motion idênticos.
//   3. distingue arestas inferidas (slate/weak) de literais (mint) via
//      arcColor/glowColor lendo `d.inferred` (honestidade §28).
//
// Source-grep (não runtime): WebGL/deck.gl não roda em jsdom. O lock falharia
// na versão buggy (sem ArcLayer no post mode, sem useTimelineClock no
// PostModeMap, heatmap presente cobrindo os arcos).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

/** Extrai o corpo da função PostModeMap pra assertions escopadas ao post mode. */
function postModeBody(src: string): string {
  const start = src.indexOf('function PostModeMap(')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\nfunction ', start + 1)
  return src.slice(start, end === -1 ? src.length : end)
}

describe('SpreadMap — helpers de arco compartilhados (módulo)', () => {
  it('exporta gating clock-único compartilhado: buildVisSegs + makeArcLayers + DrawArc', () => {
    expect(SRC).toMatch(/function buildVisSegs\(/)
    expect(SRC).toMatch(/function makeArcLayers\(/)
    expect(SRC).toMatch(/type DrawArc = PropagationArc/)
    // lerpPos (rastro A→B) também ao nível do módulo, reusado por ambos modos.
    expect(SRC).toMatch(/function lerpPos\(/)
  })

  it('makeArcLayers fabrica DUAS ArcLayers (glow underlay + corpo)', () => {
    const start = SRC.indexOf('function makeArcLayers(')
    const body = SRC.slice(start, SRC.indexOf('\nfunction ', start + 1))
    const arcLayerCount = (body.match(/new ArcLayer\(/g) ?? []).length
    expect(arcLayerCount).toBe(2)
  })

  it('cores dos arcos distinguem inferred (slate/weak) de literal (mint) via d.inferred', () => {
    // arcColor/glowColor leem d.inferred → ARC_HUE_INFERRED + INFERRED_ALPHA.
    expect(SRC).toMatch(/ARC_HUE_INFERRED/)
    expect(SRC).toMatch(/INFERRED_ALPHA/)
    expect(SRC).toMatch(/d\.inferred\s*\?\s*ARC_HUE_INFERRED/)
  })
})

describe('PostModeMap — renderiza arcos da cascata (P0 fix)', () => {
  const body = postModeBody(SRC)

  it('consome data.arcs via buildVisSegs (gating compartilhado)', () => {
    expect(body).toMatch(/buildVisSegs\(\s*data\.arcs/)
  })

  it('instancia as ArcLayers da cascata via makeArcLayers', () => {
    expect(body).toMatch(/makeArcLayers\(\s*ArcLayer/)
    // id próprio pra não colidir com o 'prop-arcs' do global.
    expect(body).toMatch(/'post-arcs'/)
  })

  it('desestrutura ArcLayer dos deck.gl layers (antes só Scatterplot/Heatmap)', () => {
    expect(body).toMatch(/const \{[^}]*ArcLayer[^}]*\} = mapDeps\.layers/)
  })

  it('é gated pelo relógio único useTimelineClock (igual ao global)', () => {
    expect(body).toMatch(/useTimelineClock\(/)
    expect(body).toMatch(/renderFrameRef\.current\?\.\(currentTime\)/)
  })

  it('respeita reduced-motion (estático sob preferência do user)', () => {
    expect(body).toMatch(/useReducedMotion\(\)/)
    // reducedMotion flui pra buildVisSegs (draw=1 estático).
    expect(body).toMatch(/buildVisSegs\(\s*data\.arcs,\s*p,\s*reducedMotion\s*\)/)
  })

  it('passa o clock pro MapShell (scrubber lê o mesmo cursor, play/pause juntos)', () => {
    expect(body).toMatch(/clock=\{\{\s*currentTime,\s*paused,\s*togglePaused\s*\}\}/)
  })

  it('mantém pin de origem (amber) e dots de destino (mint)', () => {
    expect(body).toMatch(/id: 'spread-origin'/)
    expect(body).toMatch(/\[251, 191, 36, 230\]/) // amber origin
    expect(body).toMatch(/id: 'spread-destinations'/)
    expect(body).toMatch(/\[52, 211, 153, 140\]/) // mint dest
  })

  it('NÃO usa mais HeatmapLayer no post mode (cobria os arcos finos)', () => {
    expect(body).not.toMatch(/new HeatmapLayer\(/)
    expect(body).not.toMatch(/'spread-heat'/)
  })
})
