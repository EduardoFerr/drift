/**
 * useMapDeps — async loader compartilhado de MapLibre + Deck.gl + layers.
 *
 * DRY refactor 2026-05-21 (Satoshi tech lead B). Antes: PostModeMap e
 * GlobalModeMap tinham bloco `Promise.all([import('maplibre-gl'),
 * import('@deck.gl/mapbox'), import('./spreadMapLayers')])` idêntico.
 * Agora: 1 helper único. Quando NetworkMode usar GlobalModeMap (já
 * faz, item A 2026-05-21), 3 modos consumem 1 import path.
 *
 * Mantido como **helper async** (não hook), porque os 3 modes diferem
 * em options de init do map (container, center, zoom, layers, fitBounds
 * maxZoom, animation loop). Hook completo seria over-engineering
 * pra benefit marginal — extração de imports compartilhados resolve
 * 80% da duplicação com 20% do risco.
 *
 * Ted bundle audit 2026-05-15 §1.8 preserva tree-shake estático via
 * wrapper `./spreadMapLayers` (Contour/SolidPolygon dropped).
 */

import type { ScatterplotLayer, HeatmapLayer, LineLayer } from './spreadMapLayers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MaplibreStatic = { Map: any }
type LayerCtor = new (props: any) => any
type OverlayInstance = { setProps: (p: { layers: unknown[] }) => void }
type OverlayCtor = new (props: { layers: unknown[] }) => OverlayInstance
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface MapDeps {
  maplibregl: MaplibreStatic
  MapboxOverlay: OverlayCtor
  layers: {
    ScatterplotLayer: LayerCtor
    HeatmapLayer: LayerCtor
    LineLayer: LayerCtor
    ArcLayer: LayerCtor
  }
}

export async function loadMapDeps(): Promise<MapDeps> {
  const [maplibreModule, deckMapbox, layersWrapper] = await Promise.all([
    import('maplibre-gl'),
    import('@deck.gl/mapbox'),
    import('./spreadMapLayers'),
  ])
  const maplibregl = maplibreModule.default as unknown as MaplibreStatic
  const { MapboxOverlay } = deckMapbox as unknown as {
    MapboxOverlay: OverlayCtor
  }
  return {
    maplibregl,
    MapboxOverlay,
    layers: {
      ScatterplotLayer: layersWrapper.ScatterplotLayer as unknown as LayerCtor,
      HeatmapLayer: layersWrapper.HeatmapLayer as unknown as LayerCtor,
      LineLayer: layersWrapper.LineLayer as unknown as LayerCtor,
      ArcLayer: layersWrapper.ArcLayer as unknown as LayerCtor,
    },
  }
}

// Re-exports pra reuse de tipos sem duplicar declarações
export type { MaplibreStatic, LayerCtor, OverlayInstance, OverlayCtor }

// Static re-exports (silencia "unused import" no TS strict)
export type {
  ScatterplotLayer as _ScatterplotLayer,
  HeatmapLayer as _HeatmapLayer,
  LineLayer as _LineLayer,
}
