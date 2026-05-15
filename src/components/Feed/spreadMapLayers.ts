// Ted bundle audit 2026-05-15 §1.8 — wrapper estático pra forçar
// tree-shaking de layers não usados.
//
// Problema: `await import('@deck.gl/aggregation-layers')` + `const {
// HeatmapLayer } = mod` é dinâmico do ponto de vista do Rollup. Mesmo
// com `sideEffects: false` no pacote, Rollup conservadoramente mantém
// TODOS os exports do barrel — incluindo `ContourLayer`, que puxa
// `SolidPolygonLayer` + earcut tesselator (~200 KB raw, chunk próprio).
//
// Solução: este módulo faz `import { HeatmapLayer } from ...` ESTÁTICO,
// e re-exporta. O barrel é resolvido em build-time, Rollup vê
// que só `HeatmapLayer` é referenciado, e drop o resto. O wrapper em
// si é importado dinamicamente por `SpreadMap.tsx` — mantendo lazy.
//
// Submódulos diretos (`@deck.gl/aggregation-layers/dist/heatmap-layer/
// heatmap-layer.js`) seriam mais explícitos mas o package `exports` map
// não os expõe, e Rollup ESM strict rejeita os subpaths.

export { HeatmapLayer } from '@deck.gl/aggregation-layers'
export { ScatterplotLayer, LineLayer } from '@deck.gl/layers'
