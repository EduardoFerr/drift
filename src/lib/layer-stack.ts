import type { ComponentType } from 'react'
import { create } from 'zustand'

export type DismissAction = 'esc' | 'backdrop'

export interface LayerDef {
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>
  props?: Record<string, unknown>
  parent?: string
  dismiss?: DismissAction[]
}

interface LayerStackState {
  layers: LayerDef[]
}

export const useLayerStack = create<LayerStackState>(() => ({
  layers: [],
}))

function collectDescendants(layers: LayerDef[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const l of layers) {
      if (l.parent && ids.has(l.parent) && !ids.has(l.id)) {
        ids.add(l.id)
        changed = true
      }
    }
  }
  return ids
}

export function pushLayer(def: LayerDef): void {
  useLayerStack.setState((s) => {
    if (s.layers.some((l) => l.id === def.id)) return s
    return { layers: [...s.layers, def] }
  })
}

export function popLayer(opts?: { id?: string }): void {
  useLayerStack.setState((s) => {
    if (s.layers.length === 0) return s
    if (opts?.id) {
      const ids = collectDescendants(s.layers, opts.id)
      const next = s.layers.filter((l) => !ids.has(l.id))
      return next.length === s.layers.length ? s : { layers: next }
    }
    return { layers: s.layers.slice(0, -1) }
  })
}

export function replaceLayer(oldId: string, next: LayerDef): void {
  useLayerStack.setState((s) => {
    const idx = s.layers.findIndex((l) => l.id === oldId)
    if (idx === -1) return s
    const ids = collectDescendants(s.layers, oldId)
    const filtered = s.layers.filter((l) => !ids.has(l.id))
    filtered.splice(idx, 0, next)
    return { layers: filtered }
  })
}

export function hasLayer(id: string): boolean {
  return useLayerStack.getState().layers.some((l) => l.id === id)
}

export function topLayerId(): string | null {
  const { layers } = useLayerStack.getState()
  const top = layers[layers.length - 1]
  return top ? top.id : null
}

export function clearLayers(): void {
  useLayerStack.setState({ layers: [] })
}
