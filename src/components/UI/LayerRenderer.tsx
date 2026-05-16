import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useLayerStack, popLayer } from '../../lib/layer-stack'
import { LazyBoundary } from './LazyBoundary'
import { DriftSkeleton } from './DriftSkeleton'

export function LayerRenderer() {
  const layers = useLayerStack((s) => s.layers)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const current = useLayerStack.getState().layers
      if (current.length === 0) return
      const top = findTopmostDismissible(current)
      if (!top) return
      e.stopImmediatePropagation()
      e.preventDefault()
      popLayer({ id: top.id })
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  if (layers.length === 0) return null

  return (
    <AnimatePresence>
      {layers.map((layer) => (
        <LazyBoundary key={layer.id} fallback={<DriftSkeleton variant="card" />}>
          <layer.component
            {...layer.props}
            onClose={() => popLayer({ id: layer.id })}
          />
        </LazyBoundary>
      ))}
    </AnimatePresence>
  )
}

function findTopmostDismissible(
  layers: { id: string; dismiss?: ('esc' | 'backdrop')[] }[],
) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer) continue
    const d = layer.dismiss ?? ['esc']
    if (d.includes('esc')) return layer
  }
  return null
}
